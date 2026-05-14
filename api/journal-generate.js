import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}

// Signals in context notes that indicate the day was intentionally untracked
// (rest, recovery, sick, social, time off) rather than a genuine miss.
const REST_DAY_NOTE_RE = /\b(rest day|rest_day|recovery|day off|took the day off|sick|ill|not feeling well|under the weather|rough day|rough physically|tired|exhausted|burnt out|burned out|injury|injured|wrist|back pain|social day|family day|travel day|planned rest|no gym|off day)\b/i;

function buildGenerationPrompt({ date, habits, goals, name, existingNotes }) {
  const displayDate = formatDate(date);
  const lines = [];

  lines.push(`User: ${name || "them"}`);
  lines.push(`Date: ${displayDate} (${date})`);
  lines.push("");

  // Habits with today's logs
  const habitsWithLogs = (habits || []).map(h => {
    const todayLogs = (h.logs || []).filter(l => l.date === date);
    return { ...h, todayLogs };
  });

  const logged = habitsWithLogs.filter(h => h.todayLogs.some(
    l => l.value !== null && l.value !== undefined && l.value !== false && l.value !== "skip"
  ));
  const skipped = habitsWithLogs.filter(h => h.todayLogs.some(l => l.value === "skip"));
  const notLogged = habitsWithLogs.filter(h =>
    h.todayLogs.length === 0 &&
    !logged.find(x => x.id === h.id) &&
    !skipped.find(x => x.id === h.id)
  );

  // Detect whether context notes suggest a rest/recovery/sick day
  const notesText = existingNotes?.trim() || "";
  const hasRestSignal = REST_DAY_NOTE_RE.test(notesText);
  const hasAnyLogs = logged.length > 0 || skipped.length > 0;

  // Surface day-type hint so the journal AI interprets unlogged habits correctly
  if (!hasAnyLogs && hasRestSignal) {
    lines.push("Day type: Rest / recovery / time off — context notes indicate this was intentional.");
    lines.push("");
  } else if (!hasAnyLogs && !notesText) {
    lines.push("Day type: No logs recorded and no context notes — day went untracked.");
    lines.push("");
  }

  if (logged.length > 0) {
    lines.push("Completed today:");
    for (const h of logged) {
      const log = h.todayLogs.find(
        l => l.value !== null && l.value !== undefined && l.value !== false && l.value !== "skip"
      );
      let entry = `- ${h.emoji || ""} ${h.name}`.trim();
      if (h.habit_type === "project" && typeof log?.value === "object" && log.value?.minutes) {
        entry += ` (${log.value.minutes} min)`;
      } else if (typeof log?.value === "number") {
        entry += ` (${log.value}${h.unit || ""})`;
      }
      const notes = [log?.note, log?.reflection, log?.value?.win, log?.value?.hardPart]
        .filter(Boolean).join(" / ");
      if (notes) entry += ` — "${notes}"`;
      lines.push(entry);
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push("Rest days / recorded skips:");
    for (const h of skipped) {
      const log = h.todayLogs.find(l => l.value === "skip");
      let entry = `- ${h.emoji || ""} ${h.name}`.trim();
      if (log?.note) entry += ` — "${log.note}"`;
      lines.push(entry);
    }
    lines.push("");
  }

  if (notLogged.length > 0) {
    lines.push("No entry recorded today (may be missed, may be intentionally untracked):");
    lines.push(notLogged.map(h => `- ${h.emoji || ""} ${h.name}`.trim()).join("\n"));
    lines.push("");
  }

  const activeGoals = (goals || []).filter(g => g.status !== "completed");
  if (activeGoals.length > 0) {
    lines.push("Active goals:");
    for (const g of activeGoals) {
      const pct = g.targetValue > 0
        ? Math.round(((g.currentValue - (g.startValue || 0)) / (g.targetValue - (g.startValue || 0))) * 100)
        : 0;
      lines.push(`- ${g.emoji || ""} ${g.name}: ${g.currentValue}/${g.targetValue}${g.unit || ""} (${pct}%)`.trim());
    }
    lines.push("");
  }

  if (notesText) {
    lines.push("Context / notes from today's conversations:");
    lines.push(notesText);
    lines.push("");
  }

  const dataBlock = lines.join("\n");

  return `You are writing a daily journal entry for someone using Forged, a personal tracking app.

Here is today's data:

${dataBlock}
---

Write a daily journal entry in this exact format — nothing more, nothing less:

[Title: a short (2–5 word) label for the day — e.g. "Recovery & Reset", "Solid execution", "Gym missed, build moved"]

[2–3 sentence narrative — what kind of day this was, the mood and shape of it. Be specific to the actual data and context notes. First person, as if they wrote it.]

Wins: [comma-separated list of things completed, or "none"]
Missed: [see rules below]
Why: [1 sentence on context or reason if there are notes that explain it — skip this line entirely if there's nothing real to say]
Pattern: [see rules below]
Tomorrow: [1 specific, forward-looking suggestion — see rules below]

Rules:
- First person throughout ("I", "my")
- Specific and grounded — name real habits, real numbers, real context from the notes
- Tone: direct, honest, human. Like a clear-eyed friend recapping the day, not a wellness app
- No corporate language. No "great job". No filler. No "it's important to remember"
- If not much happened, say so plainly — a short honest entry is better than a padded one

MISSED field rules:
- Only label a habit as "Missed" if the data and context suggest the user genuinely intended to do it but didn't
- If "Day type: Rest / recovery / time off" appears above, OR the context notes indicate rest/sick/recovery/time off: list unlogged habits as "Not tracked (rest day)" or simply omit them from Missed — do not frame them as failures
- If "Day type: No logs recorded and no context notes" appears above: write "Not tracked" rather than a list of "Missed" habits — the day went untracked, not necessarily failed
- If some habits were completed and others weren't, list the genuinely unattended ones as Missed normally
- "Rest days / recorded skips" above = explicitly not missed — do not list them under Missed

PATTERN field rules:
- Only write a Pattern line if something genuinely stands out in the actual data or notes — a streak, a recurring miss, a strong day relative to recent history, a clear recovery pattern
- If there is nothing meaningful to observe, skip this line entirely
- NEVER invent a pattern to fill space. "When nothing gets logged it usually means nothing intentional happened" is an assumption — do not write that unless the data clearly supports it

TOMORROW field rules:
- One practical, forward-looking sentence
- If it was a rest/recovery day, suggest gently picking up specific habits again
- If it was a productive day, suggest the next logical step
- Not a guilt trip — just useful

- Skip "Why:", "Pattern:", and "Tomorrow:" lines entirely if there's nothing real to say for them
- Max 200 words total
- PLAIN TEXT ONLY. No markdown. No asterisks, no bold (**), no underscores, no backticks, no special formatting characters whatsoever. The title is plain text.`;
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Not configured." });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "Not configured." });

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let userId = null;
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user?.id) return res.status(401).json({ error: "Invalid token" });
    userId = user.id;
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const db = createClient(SUPABASE_URL, serviceRoleKey);

  const { date: rawDate, habits, goals, name } = req.body || {};

  const date = DATE_RE.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);

  // Fetch any existing journal entry for today
  const { data: existing } = await db
    .from("journal_entries")
    .select("id, content, is_ai_generated, daily_context, manually_edited")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  // Build generation context from two sources:
  // 1. daily_context notes accumulated via chat's add_daily_note tool
  // 2. Manually written content (preserved as context, not replaced)
  const contextNotes = Array.isArray(existing?.daily_context)
    ? existing.daily_context.filter(Boolean)
    : [];
  const manualContent = (existing?.manually_edited && existing?.content)
    ? existing.content
    : null;
  const existingNotes = [
    ...contextNotes,
    ...(manualContent ? [`User's manual note: ${manualContent}`] : []),
  ].join("\n");

  const prompt = buildGenerationPrompt({ date, habits, goals, name, existingNotes });

  const client = new Anthropic({ apiKey: apiKey.trim() });

  let generatedText = "";
  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      system:
        "You write concise, honest daily journal entries from habit-tracking data. " +
        "Key rules you always follow: (1) Distinguish between habits that were genuinely missed versus habits that were simply untracked — untracked is not the same as failed. " +
        "(2) If the data or context notes indicate a rest day, sick day, recovery day, or time off, frame the entry accordingly — do not label those unlogged habits as failures. " +
        "(3) Never invent a Pattern observation without clear evidence in the data. If nothing stands out, skip the Pattern line entirely. " +
        "(4) Keep the Tomorrow line constructive and practical, not guilt-inducing. " +
        "(5) Plain text only — no markdown, no asterisks, no special characters.",
      messages: [{ role: "user", content: prompt }],
    });
    generatedText = (resp.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
  } catch (err) {
    console.error("[journal-generate] AI error:", err.message);
    return res.status(500).json({ error: "Failed to generate journal entry." });
  }

  if (!generatedText) {
    return res.status(500).json({ error: "Empty response from AI." });
  }

  // Count source signals for metadata
  const habitsWithLogs = (habits || []).map(h => ({
    ...h,
    todayLogs: (h.logs || []).filter(l => l.date === date),
  }));
  const loggedCount = habitsWithLogs.filter(h =>
    h.todayLogs.some(l => l.value !== null && l.value !== undefined && l.value !== false)
  ).length;
  const generationSources = {
    generated_at: new Date().toISOString(),
    habit_count: loggedCount,
    goal_count: (goals || []).filter(g => g.status !== "completed").length,
    context_notes_count: contextNotes.length,
    model: "claude-haiku-4-5",
  };

  // Upsert — replace content entirely with the new AI entry.
  // manually_edited is reset to false since this is now AI-generated.
  const upsertPayload = {
    user_id: userId,
    date,
    content: generatedText,
    updated_at: new Date().toISOString(),
    is_ai_generated: true,
    manually_edited: false,
    generation_sources: generationSources,
  };

  let savedEntry;
  try {
    const { data, error } = await db
      .from("journal_entries")
      .upsert(upsertPayload, { onConflict: "user_id,date" })
      .select()
      .single();
    if (error) throw error;
    savedEntry = data;
  } catch (err) {
    // Columns might not exist yet (migration pending) — fall back to basic upsert
    console.warn("[journal-generate] Full upsert failed, trying without new columns:", err.message);
    const { data, error: fallbackErr } = await db
      .from("journal_entries")
      .upsert(
        { user_id: userId, date, content: generatedText, updated_at: new Date().toISOString() },
        { onConflict: "user_id,date" }
      )
      .select()
      .single();
    if (fallbackErr) {
      console.error("[journal-generate] Fallback upsert failed:", fallbackErr.message);
      return res.status(500).json({ error: "Failed to save journal entry." });
    }
    savedEntry = data;
  }

  return res.status(200).json({
    entry: savedEntry,
    generated: true,
    sources: generationSources,
  });
}

export default withSentry(handler);
