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
  const missed = habitsWithLogs.filter(h =>
    h.todayLogs.length === 0 &&
    !logged.find(x => x.id === h.id) &&
    !skipped.find(x => x.id === h.id)
  );

  if (logged.length > 0) {
    lines.push("Completed today:");
    for (const h of logged) {
      const log = h.todayLogs.find(
        l => l.value !== null && l.value !== undefined && l.value !== false && l.value !== "skip"
      );
      let entry = `- ${h.emoji || ""} ${h.name}`.trim();
      if (typeof log?.value === "number") entry += ` (${log.value}${h.unit || ""})`;
      const notes = [log?.note, log?.reflection, log?.value?.win, log?.value?.hardPart]
        .filter(Boolean).join(" / ");
      if (notes) entry += ` — "${notes}"`;
      lines.push(entry);
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push("Rest days / skipped:");
    for (const h of skipped) {
      const log = h.todayLogs.find(l => l.value === "skip");
      let entry = `- ${h.emoji || ""} ${h.name}`.trim();
      if (log?.note) entry += ` — "${log.note}"`;
      lines.push(entry);
    }
    lines.push("");
  }

  if (missed.length > 0) {
    lines.push("Not logged today:");
    lines.push(missed.map(h => `- ${h.emoji || ""} ${h.name}`.trim()).join("\n"));
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

  if (existingNotes?.trim()) {
    lines.push("Context / notes from today's conversations:");
    lines.push(existingNotes.trim());
    lines.push("");
  }

  const dataBlock = lines.join("\n");

  return `You are writing a daily journal entry for someone using Forged, a personal tracking app.

Here is today's data:

${dataBlock}
---

Write a daily journal entry in this exact format — nothing more, nothing less:

[Title: a short (2–5 word) label for the day — e.g. "Recovery & Reset", "Solid execution", "Rough but honest"]

[2–3 sentence narrative — what kind of day this was, the mood and shape of it. Be specific to the actual data. First person, as if they wrote it.]

Wins: [comma-separated list, or "none" if nothing was completed]
Missed: [comma-separated list of unlogged habits, or "none"]
Why: [1 sentence on context or reason if there are notes — skip this line if there's no context]
Pattern: [1 sentence if something stands out — skip this line if there's nothing to note]
Tomorrow: [1 specific, actionable suggestion based on today]

Rules:
- First person throughout ("I", "my")
- Specific and grounded — name real habits and real numbers
- Tone: direct, honest, human. Like a clear-eyed friend recapping the day, not a wellness app
- No corporate language. No "great job". No filler. No "it's important to remember"
- If not much happened, say so plainly — a short honest entry is better than a padded one
- Skip "Why:" and "Pattern:" lines entirely if there's nothing real to say for them
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
    .select("id, content, context_notes, is_ai_generated")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  // Prefer context_notes (chat-captured source material). Fall back to content
  // only if it was manually written (not AI-generated), for backwards compat.
  const existingNotes = existing?.context_notes ||
    (existing && existing.is_ai_generated === false ? existing.content : "") ||
    "";

  const prompt = buildGenerationPrompt({ date, habits, goals, name, existingNotes });

  const client = new Anthropic({ apiKey: apiKey.trim() });

  let generatedText = "";
  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
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
  const notesCount = existingNotes ? 1 : 0;

  const generationSources = {
    generated_at: new Date().toISOString(),
    habit_count: loggedCount,
    goal_count: (goals || []).filter(g => g.status !== "completed").length,
    context_notes_count: notesCount,
    model: "claude-haiku-4-5",
  };

  // Upsert — replace any existing content entirely
  const upsertPayload = {
    user_id: userId,
    date,
    content: generatedText,
    updated_at: new Date().toISOString(),
    is_ai_generated: true,
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
