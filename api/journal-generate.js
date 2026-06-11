import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const SUPABASE_ANON_KEY =
  "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

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

function addCalendarDays(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const u = Date.UTC(y, m - 1, d + deltaDays);
  const dt = new Date(u);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function weekStartMondayFromYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return addCalendarDays(ymd, -back);
}

function getLimitDayTotal(h, dateStr) {
  const dayLogs = (h.logs || []).filter(l => l.date === dateStr && typeof l.value === "number");
  if (!dayLogs.length) return null;
  return dayLogs.reduce((s, l) => s + l.value, 0);
}

function getBuildDayMinutes(h, dateStr) {
  return (h.logs || [])
    .filter(l => l.date === dateStr)
    .reduce((s, l) => s + (l.value?.minutes || 0), 0);
}

function qualifiesBuildDay(h, dateStr) {
  const targetMins = h.daily_target_minutes ?? 60;
  return getBuildDayMinutes(h, dateStr) >= targetMins;
}

function hasDailyCompletion(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr && l.value === true);
}

function hasRestDay(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr && l.value === "skip");
}

function hasAnyLogOnDate(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr);
}

function habitLabel(h) {
  return `${h.emoji || ""} ${h.name}`.trim();
}

function isProofHabitForBlock(h, blockId) {
  return !!blockId && h.is_proof_action === true && h.block_id === blockId;
}

/** Matches client Today ring satisfaction for a given calendar day. */
function forgedRingSatisfiedOnDate(h, dateStr) {
  if (h.habit_type === "log") return false;
  const logs = h.logs || [];
  if (h.habit_type === "weekly") {
    const target = Math.max(1, Number(h.weekly_target) || 1);
    if (hasRestDay(h, dateStr)) return true;
    const ws = weekStartMondayFromYmd(dateStr);
    const weekEnd = addCalendarDays(ws, 6);
    const count = logs.filter(l => l.date >= ws && l.date <= weekEnd && l.value === true).length;
    if (count >= target) return true;
    return logs.some(l => l.date === dateStr && l.value === true);
  }
  if (h.habit_type === "daily") {
    return hasDailyCompletion(h, dateStr) || hasRestDay(h, dateStr);
  }
  if (h.habit_type === "project") return qualifiesBuildDay(h, dateStr);
  if (h.habit_type === "limit") {
    const total = getLimitDayTotal(h, dateStr);
    if (total == null) return false;
    return total <= (h.daily_budget ?? Infinity);
  }
  return hasAnyLogOnDate(h, dateStr);
}

/** Arc proof action genuinely missed on this day (not rest, not weekly-not-yet-due, not within limit). */
function arcProofMissedOnDate(h, dateStr) {
  if (forgedRingSatisfiedOnDate(h, dateStr)) return false;
  if (hasRestDay(h, dateStr)) return false;

  if (h.habit_type === "weekly") {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0) return false;
    const ws = weekStartMondayFromYmd(dateStr);
    const target = Math.max(1, Number(h.weekly_target) || 1);
    const count = (h.logs || []).filter(l => l.date >= ws && l.date <= dateStr && l.value === true).length;
    return count < target;
  }
  if (h.habit_type === "limit") {
    const total = getLimitDayTotal(h, dateStr);
    if (total == null) return false;
    const goalAim = h.goal_aim ?? "maintain";
    if (goalAim === "monitor" || goalAim === "reduce") return false;
    return total > (h.daily_budget ?? Infinity);
  }
  if (h.habit_type === "project") return !qualifiesBuildDay(h, dateStr);
  if (h.habit_type === "daily") return !hasDailyCompletion(h, dateStr);
  return false;
}

function buildArcEvidenceLists({ date, habits, goals, activeBlock }) {
  const blockId = activeBlock?.id;
  const proofHabits = (habits || []).filter(
    h => h.habit_type !== "log" && isProofHabitForBlock(h, blockId),
  );
  const arcProofCompleted = proofHabits
    .filter(h => forgedRingSatisfiedOnDate(h, date))
    .map(habitLabel);
  const arcProofMissed = proofHabits
    .filter(h => arcProofMissedOnDate(h, date))
    .map(habitLabel);

  const completedExtras = [];
  for (const h of habits || []) {
    if (h.habit_type === "log") continue;
    if (isProofHabitForBlock(h, blockId)) continue;
    if (forgedRingSatisfiedOnDate(h, date)) completedExtras.push(habitLabel(h));
  }
  for (const g of goals || []) {
    if (g.goal_status === "completed" || g.status === "completed") continue;
    const logged = (g.logs || []).some(l => l.date === date && typeof l.value === "number");
    if (logged) completedExtras.push(`${g.emoji || ""} ${g.name}`.trim());
  }

  return { arcProofCompleted, arcProofMissed, completedExtras };
}

function buildGenerationPrompt({ date, habits, goals, name, existingNotes, doneTasks = [], pendingTasks = [], activeBlock = null }) {
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
        // For limit habits, add goal_aim context so the journal frames the day correctly
        if (h.habit_type === "limit") {
          const goalAim = h.goal_aim ?? "maintain";
          const budget = h.daily_budget;
          if (goalAim === "reduce") {
            const originalBudget = h.original_budget ?? null;
            const fromStr = originalBudget != null && originalBudget !== budget
              ? `, originally ${originalBudget}${h.unit || ""}`
              : "";
            entry += ` [limit: ${budget}${h.unit || ""}${fromStr}, aim: reducing over time]`;
          } else if (goalAim === "monitor") {
            entry += ` [limit: ${budget}${h.unit || ""}, aim: monitoring only]`;
          } else {
            entry += ` [limit: ${budget}${h.unit || ""}]`;
          }
        }
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

  if (doneTasks.length > 0) {
    lines.push("Loose ends cleared today (one-off tasks, not habits):");
    doneTasks.forEach(t => lines.push(`- ${t}`));
    lines.push("");
  }

  if (pendingTasks.length > 0) {
    lines.push("Loose ends not cleared today:");
    pendingTasks.forEach(t => lines.push(`- ${t}`));
    lines.push("");
  }

  const hasActiveArc = !!activeBlock?.id;
  let arcLists = null;
  if (hasActiveArc) {
    arcLists = buildArcEvidenceLists({ date, habits, goals, activeBlock });
    lines.push(`ACTIVE ARC: ${activeBlock.title || activeBlock.identity || "Current Arc"}`);
    if (activeBlock.minimum_proof) {
      lines.push(`Bad-day minimum proof: ${activeBlock.minimum_proof}`);
    }
    lines.push("");
    lines.push("Arc proof completed today (use EXACTLY for Proof shown — do not add or remove items):");
    lines.push(arcLists.arcProofCompleted.length
      ? arcLists.arcProofCompleted.map(n => `- ${n}`).join("\n")
      : "- (none)");
    lines.push("");
    lines.push("Arc proof genuinely missed today (use EXACTLY for Missed — do not add unrelated habits):");
    lines.push(arcLists.arcProofMissed.length
      ? arcLists.arcProofMissed.map(n => `- ${n}`).join("\n")
      : "- (none)");
    lines.push("");
    if (arcLists.completedExtras.length) {
      lines.push("Completed non-Arc extras (use EXACTLY for Extras — context only, not failures):");
      lines.push(arcLists.completedExtras.map(n => `- ${n}`).join("\n"));
      lines.push("");
    }
    lines.push("Other tracked habits/goals today are context only — never list them under Missed.");
    lines.push("");
  }

  const dataBlock = lines.join("\n");

  const formatBlock = hasActiveArc ? `Write a daily journal entry in this exact format — nothing more, nothing less:

[Title: a short (2–5 word) label for the day — e.g. "Recovery & Reset", "Solid execution", "Proof in, build moved"]

[2–3 sentence narrative — what kind of day this was for the Arc and the person. Be specific to the actual data and context notes. First person. Do not judge non-Arc habits.]

Proof shown: [comma-separated list from "Arc proof completed today" above, or "none"]
Missed: [comma-separated list from "Arc proof genuinely missed today" ONLY, or "none"]
${arcLists?.completedExtras?.length ? "Extras: [comma-separated list from completed non-Arc extras above]" : "Extras: [omit this entire line if there are no completed non-Arc extras]"}
Why: [1 sentence on context if notes explain it — skip if nothing real to say]
Pattern: [see rules below]
Tomorrow: [see rules below]` : `Write a daily journal entry in this exact format — nothing more, nothing less:

[Title: a short (2–5 word) label for the day — e.g. "Recovery & Reset", "Solid execution", "Gym missed, build moved"]

[2–3 sentence narrative — what kind of day this was, the mood and shape of it. Be specific to the actual data and context notes. First person, as if they wrote it. If habits were unlogged and no context notes explain why, do not speculate or editorialize — simply describe what did happen and leave the gaps neutral.]

Wins: [comma-separated list of things completed, or "none"]
Missed: [see rules below]
Why: [1 sentence on context or reason if there are notes that explain it — skip this line entirely if there's nothing real to say]
Pattern: [see rules below]
Tomorrow: [1 specific, forward-looking suggestion — see rules below]`;

  const missedRules = hasActiveArc ? `MISSED field rules (active Arc):
- ONLY list items from "Arc proof genuinely missed today" above — never unrelated habits, goals, or tasks
- If that list is "(none)", write Missed: none
- Rest days / skips / weekly actions not yet due are already excluded — do not second-guess the list` : `MISSED field rules:
- Only label a habit as "Missed" if the data and context suggest the user genuinely intended to do it but didn't
- If "Day type: Rest / recovery / time off" appears above, OR the context notes indicate rest/sick/recovery/time off: list unlogged habits as "Not tracked (rest day)" or simply omit them from Missed — do not frame them as failures
- If "Day type: No logs recorded and no context notes" appears above: write "Not tracked" rather than a list of "Missed" habits — the day went untracked, not necessarily failed
- If some habits were completed and others weren't, list the genuinely unattended ones as Missed normally
- "Rest days / recorded skips" above = explicitly not missed — do not list them under Missed`;

  const extrasRules = hasActiveArc ? `
EXTRAS field rules (active Arc):
- Only completed non-Arc items from the data above
- Never list failed or missed non-Arc habits
- If there are no completed extras, omit the Extras line entirely — no empty heading` : "";

  return `You are writing a daily journal entry for someone using Forged, a personal tracking app.

Here is today's data:

${dataBlock}
---

${formatBlock}

Rules:
- First person throughout ("I", "my")
- Specific and grounded — name real habits, real numbers, real context from the notes
- Tone: direct, honest, human. Like a clear-eyed friend recapping the day, not a wellness app
- No corporate language. No "great job". No filler. No "it's important to remember"
- If not much happened, say so plainly — a short honest entry is better than a padded one
- FACTUAL GROUNDING: Distinguish configured maximum/capacity from actual activity (e.g. "24 emails/day limit" vs "sent 8 emails"). Never state capacity as if it happened.
- Do not invent causal explanations (e.g. "habits disappeared because builds consumed bandwidth") unless the user said it in notes or the evidence clearly supports it. Pattern language may cautiously infer uncertainty ("might be", "looks like").
- Do not duplicate an item across Proof shown and Extras.

${missedRules}${extrasRules}

PATTERN field rules:
- Only write a Pattern line if something genuinely stands out in the actual data or notes — a streak, a recurring miss, a strong day relative to recent history, a clear recovery pattern
- If there is nothing meaningful to observe, skip this line entirely
- NEVER invent a pattern to fill space. "When nothing gets logged it usually means nothing intentional happened" is an assumption — do not write that unless the data clearly supports it

TOMORROW field rules:
- One practical, forward-looking sentence — not a guilt trip
- Priority order: (1) user's explicit stated intention from notes/chat, (2) the Arc's next proof action or bad-day minimum, (3) a recurring Arc-relevant pattern
- Do NOT automatically promote unrelated non-Arc missed habits into Tomorrow

- Skip "Why:", "Pattern:", and "Tomorrow:" lines entirely if there's nothing real to say for them
- Never write speculative filler about unlogged habits. Forbidden phrases: "I'm not sure what happened", "hard to say why", "not sure why I didn't", "unclear why", "must have been", "probably just", "I guess", "not sure what got in the way". If a habit was unlogged with no context, name it once in the Missed field and move on — no editorializing.
- Max 200 words total
- PLAIN TEXT ONLY. No markdown. No asterisks, no bold (**), no underscores, no backticks, no special formatting characters whatsoever. The title is plain text.

LIMIT HABIT TONE rules (apply when a "[limit: ...]" tag appears in the data above):
- "aim: reducing over time" → frame being under the limit as progress, not just compliance. Acknowledge the direction ("tracking down", "continuing to cut back"). If original limit appears, you may reference the gap ("down from X to Y"). Never frame a single day's number as a final verdict.
- "aim: monitoring only" → treat numbers as awareness data, not performance. Do not frame under/over as success or failure. Do not suggest they should be doing better. Just note what was tracked.
- No tag or "aim: [limit]" (maintain) → stay-under is the goal; staying under is a win, going over is worth noting factually, not shaming.
- If a limit habit is unlogged and it's a reduce or monitor habit, write "Not tracked" — do not call it missed.`;
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

  // Accept date and display name from the client; ignore client-sent habits/goals.
  // Habits and logs are always fetched directly from Supabase so journal generation
  // reflects the latest writes from the coach — never stale client state.
  const { date: rawDate, name } = req.body || {};

  const date = DATE_RE.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);

  // ── Fetch authoritative habit + log data from Supabase ────────────────────────
  const { data: habitRows, error: habitsErr } = await db
    .from("habits")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");

  if (habitsErr) {
    console.error("[journal-generate] habits fetch failed:", habitsErr.message);
    return res.status(500).json({ error: "Could not load your habits." });
  }

  // Split into habits and goals. Raw DB rows use snake_case which matches what
  // buildGenerationPrompt() expects (habit_type, goal_aim, daily_budget, etc.).
  const habits = (habitRows || []).filter(
    r => r.habit_type !== "goal" && r.habit_type !== "progress"
  );
  const goals = (habitRows || [])
    .filter(r => r.habit_type === "goal" || r.habit_type === "progress")
    .map(r => {
      const logs = r.logs || [];
      const numericLogs = logs
        .filter(l => typeof l.value === "number")
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const currentValue =
        numericLogs.length > 0
          ? numericLogs[numericLogs.length - 1].value
          : (r.start_value ?? 0);
      return {
        ...r,
        currentValue,
        targetValue: r.target_value ?? 0,
        startValue:  r.start_value  ?? 0,
        status:      r.goal_status  ?? "active",
      };
    });

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

  // Fetch loose ends (tasks) for the date — non-fatal
  let doneTasks = [];
  let pendingTasks = [];
  try {
    const { data: taskRows } = await db
      .from("tasks")
      .select("text, done")
      .eq("user_id", userId)
      .eq("date", date);
    if (taskRows) {
      doneTasks    = taskRows.filter(t => t.done).map(t => t.text);
      pendingTasks = taskRows.filter(t => !t.done).map(t => t.text);
    }
  } catch { /* tasks are non-blocking — proceed without them */ }

  let activeBlock = null;
  try {
    const { data: blockRow } = await db
      .from("forge_blocks")
      .select("id, title, identity, minimum_proof, start_date, duration_days, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (blockRow?.id) {
      activeBlock = {
        id: blockRow.id,
        title: blockRow.title,
        identity: blockRow.identity,
        minimum_proof: blockRow.minimum_proof,
        startDate: blockRow.start_date,
        durationDays: blockRow.duration_days,
      };
    }
  } catch { /* non-blocking — proceed without Arc framing */ }

  const prompt = buildGenerationPrompt({
    date, habits, goals, name, existingNotes, doneTasks, pendingTasks, activeBlock,
  });

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
        "(4) Tomorrow: prioritize the user's stated intention, then Arc proof/minimum, then Arc patterns — not unrelated missed habits. " +
        "(5) Distinguish configured capacity/maximum from actual sends or usage — never state a limit as if it happened. " +
        "(6) Do not invent causal stories unless notes or data support them. " +
        "(7) Plain text only — no markdown, no asterisks, no special characters. " +
        "(8) When habits are unlogged and there are no context notes explaining why, do not speculate — unlogged is just untracked. Never write 'I'm not sure what happened', 'hard to say why', 'not sure why I didn't', 'unclear why', or similar filler. Name the gap once in the Missed field, leave the narrative neutral, and move on.",
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
