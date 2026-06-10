import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
// Anon key is public — safe to hardcode (already hardcoded in src/supabase.js)
const SUPABASE_ANON_KEY =
  "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

// ── Local-date helpers ─────────────────────────────────────────────────────────
// Logs must always land on the user's local calendar day. Computing "today"
// server-side from `new Date()` yields the *UTC* date, which is wrong for
// every timezone east of UTC during the early-morning window (e.g. AU/NZ in
// the morning is still "yesterday" in UTC). We accept a client-supplied
// YYYY-MM-DD and fall back to UTC only if it's missing/invalid.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function safeClientDate(raw) {
  if (typeof raw !== "string" || !DATE_RE.test(raw)) return null;
  // Reject obviously bogus values (e.g. clock totally wrong) by sanity-bounding
  // to within ±2 days of UTC. This still allows every legitimate local date.
  const utcToday = new Date().toISOString().slice(0, 10);
  const dayDiff = Math.abs((Date.parse(raw + "T00:00:00Z") - Date.parse(utcToday + "T00:00:00Z")) / 86400000);
  if (!Number.isFinite(dayDiff) || dayDiff > 2) return null;
  return raw;
}

// ── Tool definitions ───────────────────────────────────────────────────────────
const COACH_TOOLS = [
  {
    name: "create_habit",
    description:
      "Creates a brand new HABIT (daily, weekly, project, limit). " +
      "NEVER use this for goals (habit_type='goal') — goals use the <goal_plan> flow described in the system prompt. " +
      "Call ONLY when user asks to add/create/track something NEW. " +
      "Ask one clarifying question first if type or key details are ambiguous. " +
      "For LIMIT habits: before creating, ask what their aim is if they haven't made it clear — " +
      "'stay under this limit' (maintain), 'gradually reduce over time' (reduce), or 'just keep track' (monitor). " +
      "If this tool returns success:false, tell the user it failed.",
    input_schema: {
      type: "object",
      properties: {
        name:          { type: "string" },
        emoji:         { type: "string", description: "Single emoji." },
        habit_type: {
          type: "string",
          enum: ["daily", "weekly", "project", "limit"],
          description: "daily=checkbox; weekly=X/week(needs weekly_target); project=time tracking; limit=stay under budget. Goals are not created by this tool.",
        },
        weekly_target: { type: "integer", description: "Sessions/week for weekly habits." },
        daily_budget:  { type: "number",  description: "Daily cap for limit habits." },
        goal_aim: {
          type: "string",
          enum: ["monitor", "maintain", "reduce"],
          description: "LIMIT habits only. monitor=just tracking, no pressure; maintain=stay under the cap; reduce=gradually lower over time. Ask if unclear.",
        },
        unit:          { type: "string",  description: "e.g. km, mins, calories, pouches, L" },
        target_date:   { type: "string",  description: "Optional deadline YYYY-MM-DD." },
        color:         { type: "string",  description: "#C0392B red, #27AE60 green, #2980B9 blue, #E67E22 orange, #8E44AD purple." },
      },
      required: ["name", "habit_type"],
    },
  },
  {
    name: "edit_habit",
    description:
      "Updates fields on an existing habit or goal. Only pass fields that are changing. " +
      "Use habit_id from the [id:...] in the habits list. " +
      "IMPORTANT: Do NOT change a goal target_value unless the user explicitly asks to change/update/set the goal target AND has confirmed that important edit. " +
      "Never infer target_value from food, calories, weight chatter, vague numbers, or voice transcription. " +
      "If this tool returns success:false, tell the user it failed.",
    input_schema: {
      type: "object",
      properties: {
        habit_id:      { type: "string", description: "The [id:...] value from the habit list." },
        habit_name:    { type: "string", description: "Current name for your confirmation message." },
        name:          { type: "string" },
        emoji:         { type: "string" },
        target_value:  { type: "number" },
        daily_budget:  { type: "number" },
        weekly_target: { type: "integer" },
        unit:          { type: "string" },
        target_date:   { type: "string", description: "YYYY-MM-DD" },
        color:         { type: "string" },
        goal_aim: {
          type: "string",
          enum: ["monitor", "maintain", "reduce"],
          description: "LIMIT habits only. Update if the user explicitly changes their intent for the habit.",
        },
      },
      required: ["habit_id", "habit_name"],
    },
  },
  {
    name: "log_habit",
    description:
      "Logs an entry for an existing habit today. Format depends on type: " +
      "PROJECT: pass minutes (e.g. 60=1hr) + optional win/hard_part. " +
      "LIMIT: pass amount (number used today). " +
      "GOAL: pass amount only when the user clearly gives a current progress/check-in value for that goal. Do not log goal progress from food/calorie mentions, vague numbers, or unclear voice transcription. " +
      "DAILY/WEEKLY: set rest_day true to mark today as a rest day (skip — protects daily streak / counts toward Today ring for weekly without adding a session). Otherwise logs a normal done/session. " +
      "Can be called multiple times in one turn to log several habits at once. " +
      "If this tool returns success:false, tell the user it failed.",
    input_schema: {
      type: "object",
      properties: {
        habit_id:   { type: "string",  description: "The [id:...] value from the habit list." },
        habit_name: { type: "string",  description: "Habit name for your confirmation." },
        minutes:    { type: "number",  description: "PROJECT only: minutes worked (60=1hr, 90=1.5hr)." },
        amount:     { type: "number",  description: "LIMIT: amount used. GOAL: new current value." },
        win:        { type: "string",  description: "PROJECT: win/achievement to record." },
        hard_part:  { type: "string",  description: "PROJECT: blocker or hard part today." },
        note:       { type: "string",  description: "Short useful note — ONLY when the user gives context beyond simply completing the habit (e.g. 'chest and triceps', 'had 10 pulls', 'felt tired'). Omit entirely for plain completions ('I did gym', 'logged water'). Never repeat the habit name or rephrase 'I did it'." },
        rest_day:   { type: "boolean", description: "DAILY or WEEKLY only: true = rest/skip for today (optional note). Does not add a weekly session." },
      },
      required: ["habit_id", "habit_name"],
    },
  },
  {
    name: "add_daily_note",
    description:
      "Saves a short personal note to today's journal context — feelings, stress, story, relationships, or anything the user wants remembered when their daily journal gets written. Use when user says 'remember this for today', 'add this to my journal', 'note this', or shares personal/emotional context that isn't a structured habit/goal log. In a mixed message (structured facts + personal story), call log_habit for the facts AND add_daily_note for the human context in the SAME turn. Do NOT write a full journal entry — just capture the key thought in the user's own words (1–3 sentences). The Forged journal is generated later from these notes plus the day's habit logs. If this tool returns success:false in the tool result, say honestly that the note did not save.",
    input_schema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Short note in the user's own voice (1–3 sentences). First person. No bullet points.",
        },
      },
      required: ["note"],
    },
    // Prompt caching: marking the LAST tool with cache_control caches the
    // entire tools array (~700+ tokens of stable JSON) for ~5 minutes. Repeat
    // chat turns within that window pay ~10% of the normal input price for
    // this prefix. Saves a large fraction of our Anthropic spend on chat.js
    // because the tools schema is identical on every call.
    cache_control: { type: "ephemeral" },
  },
];

// ── System prompt blocks ───────────────────────────────────────────────────────
// The client sends the prompt split into two parts:
//   system_stable   — personality, rules, Arc identity, memory. Changes at most
//                     once per day → carries cache_control so repeat turns pay
//                     ~10% of input price for this prefix.
//   system_volatile — today's snapshot, habit states, logged-today flags.
//                     Changes every turn → never cached (a cache breakpoint
//                     here would write a new cache entry each turn for nothing).
// Older clients send a single `system` string; that falls back to the legacy
// single-cached-block behaviour so nothing breaks mid-deploy.
function buildSystemBlocks(systemStable, systemVolatile, legacySystem) {
  const stable = typeof systemStable === "string" ? systemStable : "";
  const volatile = typeof systemVolatile === "string" ? systemVolatile : "";
  if (stable.trim()) {
    const blocks = [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }];
    if (volatile.trim()) blocks.push({ type: "text", text: volatile });
    return blocks;
  }
  const legacy = typeof legacySystem === "string" ? legacySystem : "";
  if (!legacy.trim()) return "";
  return [{ type: "text", text: legacy, cache_control: { type: "ephemeral" } }];
}

/**
 * Follow-up call after tools ran — used ONLY when a tool failed or the model
 * emitted tools without any reply text. The user has already seen whatever
 * text streamed before the tools, so this writes an addendum, not a reply.
 */
function followupSystemBlocks(systemStable, systemVolatile, legacySystem, hadStreamedText) {
  const base = buildSystemBlocks(systemStable, systemVolatile, legacySystem);
  const blocks = Array.isArray(base) ? [...base] : [];
  blocks.push({
    type: "text",
    text:
      "THIS TURN ONLY: tool results are in the next message.\n" +
      (hadStreamedText
        ? "The user has ALREADY SEEN the reply text you wrote before the tools ran. Do NOT repeat or rephrase it. Write only a short addendum (1–2 sentences) covering what genuinely needs saying — usually that something couldn't be captured and what you need to fix it.\n"
        : "You called tools without writing a reply. Write the reply now — respond to the person first, specific and human, 1–4 short sentences.\n") +
      "Never open with logging status language ('saved', 'logged', 'got it', 'done'). The app shows its own quiet capture line.\n" +
      "If a tool_result has success:false, say plainly what didn't get captured and ask the one thing you need — nothing dramatic.\n" +
      "No new tool calls.",
  });
  return blocks;
}

/** Plain-text receipt derived only from executed tools — never from the model's wording. */
function buildActionReceipt(outcomes) {
  if (!outcomes?.length) return "";
  const lines = ["───", "Saved this turn"];
  let hasLine = false;
  for (const o of outcomes) {
    if (!o.success) continue;
    hasLine = true;
    if (o.tool === "log_habit") {
      const n = o.habit_name || "Habit";
      const ht = o.habit_type;
      let suffix = "";
      if (ht === "project" && o.value_saved && typeof o.value_saved === "object") {
        const mins = o.value_saved.minutes;
        if (mins != null) suffix = ` · ${mins} min`;
      } else if ((ht === "limit" || ht === "goal") && typeof o.value_saved === "number") {
        suffix = ` · ${o.value_saved}`;
      } else if ((ht === "daily" || ht === "weekly") && o.value_saved === "skip") {
        suffix = " · rest day";
      }
      lines.push(`✓ Logged ${n}${suffix}`);
    } else if (o.tool === "add_daily_note") {
      lines.push("✓ Note saved for today's journal");
    } else if (o.tool === "create_habit") {
      lines.push(`✓ Created ${o.name} (${o.habit_type})`);
    } else if (o.tool === "edit_habit") {
      const changedKeys = Object.keys(o.updates || {}).filter(k => k !== "updated_at");
      if (changedKeys.length === 1 && changedKeys[0] === "goal_aim") {
        lines.push(`✓ ${o.habit_name} — intent updated`);
      } else if (changedKeys.includes("daily_budget")) {
        lines.push(`✓ ${o.habit_name} — limit now ${o.updates.daily_budget}`);
      } else {
        lines.push(`✓ Updated ${o.habit_name}`);
      }
    }
  }
  for (const o of outcomes) {
    if (o.success) continue;
    hasLine = true;
    if (o.tool === "add_daily_note") {
      lines.push(`✗ Note — ${o.error || "couldn't save"}`);
    } else if (o.tool === "log_habit") {
      lines.push(`✗ ${o.habit_name || "Habit"} — ${o.error || "couldn't log"}`);
    } else if (o.tool === "create_habit") {
      lines.push(`✗ Create habit — ${o.error || "failed"}`);
    } else if (o.tool === "edit_habit") {
      lines.push(`✗ Edit ${o.habit_name || "habit"} — ${o.error || "failed"}`);
    } else {
      lines.push(`✗ ${o.tool} — ${o.error || "failed"}`);
    }
  }
  if (!hasLine) lines.push("(No changes applied.)");
  return lines.join("\n");
}

/**
 * Structured "Captured:" items for the redesigned receipt line. Same source of
 * truth as buildActionReceipt (executed tool outcomes, never model wording) —
 * the client renders these as one quiet collapsible line under the reply.
 */
function buildCapturedItems(outcomes) {
  if (!outcomes?.length) return [];
  const items = [];
  for (const o of outcomes) {
    if (o.tool === "log_habit") {
      const n = o.habit_name || "Habit";
      const ht = o.habit_type;
      let suffix = "";
      if (o.success) {
        if (ht === "project" && o.value_saved && typeof o.value_saved === "object" && o.value_saved.minutes != null) {
          suffix = ` · ${o.value_saved.minutes}m`;
        } else if ((ht === "limit" || ht === "goal") && typeof o.value_saved === "number") {
          suffix = ` · ${o.value_saved}`;
        } else if ((ht === "daily" || ht === "weekly") && o.value_saved === "skip") {
          suffix = " · rest day";
        }
      }
      items.push({
        kind: "log", ok: !!o.success, nav: "today",
        label: o.success ? `${n}${suffix}` : `${n} — ${o.error || "couldn't log"}`,
      });
    } else if (o.tool === "add_daily_note") {
      items.push({
        kind: "note", ok: !!o.success, nav: "journal",
        label: o.success ? "note kept" : `note — ${o.error || "couldn't save"}`,
      });
    } else if (o.tool === "create_habit") {
      items.push({
        kind: "create", ok: !!o.success, nav: "today",
        label: o.success ? `new: ${o.name}` : `create — ${o.error || "failed"}`,
      });
    } else if (o.tool === "edit_habit") {
      items.push({
        kind: "edit", ok: !!o.success, nav: "today",
        label: o.success ? `updated ${o.habit_name}` : `edit ${o.habit_name || ""} — ${o.error || "failed"}`,
      });
    } else if (!o.success) {
      items.push({ kind: "other", ok: false, nav: null, label: `${o.tool} — ${o.error || "failed"}` });
    }
  }
  return items;
}

function textFromMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(part => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      if (part?.type === "tool_result") return part.content || "";
      return "";
    })
    .join(" ");
}

function latestUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return textFromMessageContent(messages[i].content);
  }
  return "";
}

function previousAssistantTextBeforeLatestUser(messages = []) {
  let seenLatestUser = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!seenLatestUser && messages[i]?.role === "user") {
      seenLatestUser = true;
      continue;
    }
    if (seenLatestUser && messages[i]?.role === "assistant") {
      return textFromMessageContent(messages[i].content);
    }
  }
  return "";
}

function normText(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const FOOD_OR_CALORIE_RE = /\b(ate|eat|eaten|food|meal|breakfast|lunch|dinner|snack|calorie|calories|cals|curry|sandwich|sausage|slice|egg|caramel|chicken|thai)\b/i;
const MISSING_LOGS_RE = /\b(what|which).{0,40}\b(haven't|have not|haven’t|not|missing|left|else).{0,40}\blog|\bwhat else.{0,40}\blog|\bhaven't i logged\b/i;
const GOAL_TARGET_UPDATE_RE = /\b(change|update|set|adjust|edit|bump|move)\b.{0,80}\b(goal target|target weight|target|weight goal)\b|\b(goal target|target weight)\b.{0,80}\b(to|at)\b/i;
const HARD_CONFIRM_RE = /\b(confirm|confirmed)\b/i;
const YES_CONFIRM_RE = /\b(yes|yep|yeah|do it|go ahead|please do|that's right|that is right)\b/i;
const TARGET_CONFIRMATION_PROMPT_RE = /\b(confirm|update your target weight|change.{0,40}target|target.{0,40}important edit)\b/i;
const WEIGHT_PROGRESS_RE = /\b(weigh|weighed|weight|kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)\b/i;
/** Explicit current body-weight check-in (bypasses PROGRESS_LOG_RE-only phrasing like "I am 67kg"). */
const EXPLICIT_CURRENT_WEIGHT_RE =
  /\b(i\s+(?:am|weigh|weight)|i'?m|currently|right\s+now|today|this\s+morning)\s+\d+\s*(kg|lbs|pounds|kilos)\b/i;
const PROGRESS_LOG_RE = /\b(log|logged|check in|check-in|current|progress|today|now|at)\b/i;

function buildActionSafety(messages = []) {
  const userText = latestUserText(messages);
  const previousAssistantText = previousAssistantTextBeforeLatestUser(messages);
  const previousAskedForTargetConfirmation = TARGET_CONFIRMATION_PROMPT_RE.test(previousAssistantText);
  return {
    latestUserText: userText,
    normalizedUserText: normText(userText),
    asksMissingLogs: MISSING_LOGS_RE.test(userText),
    explicitGoalTargetUpdate: GOAL_TARGET_UPDATE_RE.test(userText),
    confirmedImportantEdit: HARD_CONFIRM_RE.test(userText) || (previousAskedForTargetConfirmation && YES_CONFIRM_RE.test(userText)),
  };
}

function significantGoalTokens(name) {
  return normText(name)
    .split(" ")
    .filter(w => w.length >= 4 && !["goal", "habit", "track", "daily", "weekly"].includes(w));
}

function isClearGoalProgressLog(input, goalRow, safety) {
  const text = safety.latestUserText || "";
  const normalized = safety.normalizedUserText || "";
  if (!normalized || safety.asksMissingLogs) return false;

  // Clear "I am / I weigh / currently X kg" check-in — even if they also say "don't change my target"
  // (GOAL_TARGET_UPDATE_RE); target edits remain gated on edit_habit, not here.
  if (EXPLICIT_CURRENT_WEIGHT_RE.test(text)) return true;

  const unit = normText(goalRow?.unit || "");
  const tokens = significantGoalTokens(goalRow?.name || input.habit_name || "");
  const mentionsGoal = tokens.some(token => normalized.includes(token));
  const mentionsUnit = unit && normalized.includes(unit);
  const weightSignal = WEIGHT_PROGRESS_RE.test(text);
  const progressSignal = PROGRESS_LOG_RE.test(text);

  if (FOOD_OR_CALORIE_RE.test(text) && !weightSignal && !mentionsGoal) return false;
  return progressSignal && (mentionsGoal || mentionsUnit || weightSignal);
}

function goalTargetUpdateError(input, safety) {
  if (safety.explicitGoalTargetUpdate && !safety.confirmedImportantEdit) {
    return `Changing ${input.habit_name || "that goal"}'s target is an important edit. Please confirm the new target before I update it.`;
  }
  return "Do you want me to update your target weight, or just log today's food/progress?";
}

// ── Executors ──────────────────────────────────────────────────────────────────

async function executeCreateHabit(input, userId, db) {
  const isGoal = input.habit_type === "goal";
  if (isGoal) {
    throw new Error("Goal creation needs the goal confirmation card. I won't create or change a goal directly from a chat tool call.");
  }
  // For limit habits: resolve goal_aim (default 'maintain') and set
  // original_budget once when goal_aim is 'reduce' so reduction progress
  // can be tracked later. Neither field is written for non-limit types.
  const isLimit = input.habit_type === "limit";
  const goalAim = isLimit ? (input.goal_aim ?? "maintain") : null;
  const originalBudget =
    isLimit && goalAim === "reduce" && input.daily_budget != null
      ? input.daily_budget
      : null;

  const row = {
    user_id:              userId,
    name:                 input.name,
    emoji:                input.emoji ?? "",
    habit_type:           input.habit_type,
    color:                input.color ?? (isGoal ? "#E67E22" : "#C0392B"),
    logs:                 [],
    streak:               0,
    best_streak:          0,
    reflection:           !isGoal,
    reflection_prompt:    "",
    weekly_target:        input.weekly_target ?? null,
    start_value:          null,
    target_value:         null,
    unit:                 input.unit          ?? null,
    daily_budget:         input.daily_budget  ?? null,
    tap_increment:        1,
    daily_target_minutes: input.habit_type === "project" ? 60 : null,
    goal_status:          isGoal ? "active" : null,
    target_date:          input.target_date   ?? null,
    goal_aim:             goalAim,
    original_budget:      originalBudget,
    updated_at:           new Date().toISOString(),
  };
  const { data, error } = await db.from("habits").insert(row).select().single();
  if (error) throw new Error(`Insert failed: ${error.message}`);
  return data;
}

async function executeEditHabit(input, userId, db, safety = buildActionSafety()) {
  const updates = { updated_at: new Date().toISOString() };
  if (input.name          != null) updates.name           = input.name;
  if (input.emoji         != null) updates.emoji          = input.emoji;
  if (input.daily_budget  != null) updates.daily_budget   = input.daily_budget;
  if (input.weekly_target != null) updates.weekly_target  = input.weekly_target;
  if (input.unit          != null) updates.unit           = input.unit;
  if (input.target_date   != null) updates.target_date    = input.target_date;
  if (input.color         != null) updates.color          = input.color;
  if (input.goal_aim      != null) updates.goal_aim       = input.goal_aim;

  if (input.target_value != null) {
    const { data: current, error: currentErr } = await db
      .from("habits")
      .select("habit_type, name")
      .eq("id", input.habit_id)
      .eq("user_id", userId)
      .single();
    if (currentErr || !current) throw new Error("Habit not found or permission denied");
    if (current.habit_type === "goal" && !(safety.explicitGoalTargetUpdate && safety.confirmedImportantEdit)) {
      throw new Error(goalTargetUpdateError({ ...input, habit_name: input.habit_name || current.name }, safety));
    }
    updates.target_value = input.target_value;
  }

  const { data, error } = await db
    .from("habits").update(updates)
    .eq("id", input.habit_id).eq("user_id", userId)
    .select().single();
  if (error) throw new Error(`Update failed: ${error.message}`);
  if (!data)  throw new Error("Habit not found or permission denied");
  return { habit_id: input.habit_id, habit_name: input.habit_name, updates, updatedRow: data };
}

async function executeLogHabit(input, userId, db, clientDate, safety = buildActionSafety()) {
  const { data: row, error } = await db
    .from("habits").select("name, logs, habit_type, unit")
    .eq("id", input.habit_id).eq("user_id", userId).single();
  if (error || !row) throw new Error(`Habit not found (id: ${input.habit_id})`);

  // Prefer the client's local date so logs land on the user's actual
  // calendar day. Fallback to UTC only if no usable client date arrived
  // (defensive for older cached client builds).
  const today = clientDate || new Date().toISOString().split("T")[0];
  const logs  = Array.isArray(row.logs) ? row.logs : [];
  const htype = row.habit_type;
  let logValue;

  if (htype === "project") {
    if (input.minutes == null) throw new Error("Project habits need 'minutes'. Ask the user how long they worked.");
    logValue = { minutes: Math.round(input.minutes) };
    if (input.win)       logValue.win      = input.win;
    if (input.hard_part) logValue.hardPart = input.hard_part;
  } else if (htype === "limit") {
    if (input.amount == null) throw new Error("Limit habits need 'amount'. Ask how much they used today.");
    logValue = input.amount;
  } else if (htype === "goal") {
    if (input.amount == null) throw new Error("Goal logging needs 'amount' — the new current progress value.");
    if (!isClearGoalProgressLog(input, row, safety)) {
      throw new Error("I'm not confident that number is goal progress. Do you want me to update your target weight, or just log today's food/progress?");
    }
    logValue = input.amount;
  } else if (htype === "daily" || htype === "weekly") {
    logValue = input.rest_day === true ? "skip" : true;
  } else {
    logValue = true;
  }

  let updatedLogs;
  if (htype === "project") {
    // Additive: merge minutes into existing today session if present
    const idx = logs.findIndex(l => l.date === today);
    if (idx >= 0) {
      const prev = logs[idx];
      const merged = { ...prev.value, minutes: (prev.value?.minutes ?? 0) + logValue.minutes };
      if (logValue.win)      merged.win      = logValue.win;
      if (logValue.hardPart) merged.hardPart = logValue.hardPart;
      if (input.note)        merged.note     = input.note;
      updatedLogs = logs.map((l, i) => i === idx ? { ...l, value: merged } : l);
    } else {
      const entry = { date: today, value: logValue };
      if (input.note) entry.note = input.note;
      updatedLogs = [...logs, entry];
    }
  } else {
    // Replace today's entry
    const entry = { date: today, value: logValue };
    if (input.note) entry.note = input.note;
    updatedLogs = [...logs.filter(l => l.date !== today), entry];
  }

  const { error: upErr } = await db
    .from("habits").update({ logs: updatedLogs, updated_at: new Date().toISOString() })
    .eq("id", input.habit_id).eq("user_id", userId);
  if (upErr) throw new Error(`Log save failed: ${upErr.message}`);

  return { habit_id: input.habit_id, habit_name: input.habit_name, habit_type: htype, date: today, updatedLogs, logValue };
}

async function executeAddDailyNote(input, userId, db, clientDate) {
  const date = clientDate || new Date().toISOString().slice(0, 10);
  const note = (input.note || "").trim();
  if (!note) throw new Error("Note cannot be empty.");

  // Fetch existing row for this date to append to daily_context array.
  // We never overwrite `content` here — that belongs to journal-generate.js.
  const { data: existing } = await db
    .from("journal_entries")
    .select("id, daily_context")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  const prevContext = Array.isArray(existing?.daily_context) ? existing.daily_context : [];
  const updatedContext = [...prevContext, note];

  if (existing) {
    const { error } = await db
      .from("journal_entries")
      .update({ daily_context: updatedContext, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`Note save failed: ${error.message}`);
    return { date, mode: "appended", id: existing.id };
  } else {
    const { data: row, error } = await db
      .from("journal_entries")
      .insert({ user_id: userId, date, content: "", daily_context: updatedContext })
      .select()
      .single();
    if (error) throw new Error(`Note save failed: ${error.message}`);
    return { date, mode: "created", id: row.id };
  }
}

// ── SSE helper ─────────────────────────────────────────────────────────────────
function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Anthropic overload detection ───────────────────────────────────────────────
// 529 is Anthropic's "overloaded" status. The SDK wraps it as InternalServerError
// (all 5xx share that class). The error body is { type:"error", error:{ type:"overloaded_error" } }
// so err.error.error.type is the reliable check; err.status===529 is the fast path.
function isOverloadedError(err) {
  return err?.status === 529 || err?.error?.error?.type === "overloaded_error";
}

// ── Free-tier server-side rate limit ───────────────────────────────────────────
// Keep in sync with client-side FREE_DAILY_LIMIT in src/theme.js.
const FREE_DAILY_LIMIT = 5;

// ── Handler ────────────────────────────────────────────────────────────────────
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    messages,
    system,
    system_stable: systemStable,
    system_volatile: systemVolatile,
    client_date: rawClientDate,
  } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid request body" });
  // Validated YYYY-MM-DD or null. Used both for log entries (so they land on
  // the user's local day, not UTC) and for daily quota tracking (so quotas
  // reset at the user's local midnight).
  const clientDate = safeClientDate(rawClientDate);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "AI Coach is not configured yet." });

  // ── Auth: REQUIRED ───────────────────────────────────────────────────────────
  // Previously anonymous requests were accepted (without tools). That allowed
  // anyone to burn ANTHROPIC_API_KEY credit by hitting this endpoint with any
  // payload. Now we require a valid Supabase JWT.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "AI Coach is not configured yet." });

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

  // ── Server-side rate limit for free users ───────────────────────────────────
  // Client-side enforces this too but a malicious caller can clear localStorage
  // and re-spam. Authoritative check lives here.
  let isPro = false;
  try {
    const { data: prof } = await db
      .from("profiles")
      .select("is_pro, is_admin")
      .eq("id", userId)
      .maybeSingle();
    isPro = !!(prof?.is_pro || prof?.is_admin);
  } catch { /* treat as free */ }

  // Use the client's local date for quota tracking so the counter resets at
  // the user's actual midnight (matches the client-side cap that uses
  // localStorage keyed by local todayStr()).
  const quotaDate = clientDate || new Date().toISOString().slice(0, 10);
  let usageCount = 0;
  if (!isPro) {
    const { data: usage } = await db
      .from("chat_usage")
      .select("count")
      .eq("user_id", userId)
      .eq("date", quotaDate)
      .maybeSingle();
    usageCount = usage?.count ?? 0;
    if (usageCount >= FREE_DAILY_LIMIT) {
      return res.status(429).json({
        error: `Daily free coach limit reached (${FREE_DAILY_LIMIT}/day). Upgrade to Pro for unlimited messages.`,
        limit: FREE_DAILY_LIMIT,
        used: usageCount,
        remaining: 0,
      });
    }
  }

  const client = new Anthropic({ apiKey: apiKey.trim() });
  const tools  = COACH_TOOLS;

  // Cost control: cap history at last 12 messages (6 turns)
  const trimmedMessages = messages.slice(-12);
  const actionSafety = buildActionSafety(trimmedMessages);

  // Hoisted so the catch block can include them in error context and partial-success SSE.
  // toolsRan = true means tool calls have already executed — do NOT retry (would double-log).
  let toolsRan = false;
  let receiptForCatch = "";
  let capturedForCatch = [];
  let actionsForCatch = { created: [], edited: [], logged: [], noted: [] };
  // True once any reply text has been streamed to the client. Used to decide
  // whether a 529 retry is safe and whether the post-tool follow-up call is
  // needed at all.
  let textEmitted = false;

  try {
    // ── Single-pass loop ──────────────────────────────────────────────────────
    // One streaming call produces BOTH the human reply (streamed to the client
    // immediately) and any tool_use blocks (executed after the text finishes).
    // The prompt instructs the model to write its full reply first, then call
    // tools — so the user reads a human response in ~1s while logging happens
    // quietly behind it. A second model call only happens when a tool fails or
    // the model emitted tools with no reply text.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    let finalMsg = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const stream = client.messages.stream({
          model: "claude-haiku-4-5", max_tokens: 2048,
          system: buildSystemBlocks(systemStable, systemVolatile, system),
          tools,
          messages: trimmedMessages,
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            textEmitted = true;
            sse(res, { text: event.delta.text });
          }
        }
        finalMsg = await stream.finalMessage();
        break;
      } catch (err) {
        // Retry once on 529 overload — but ONLY if nothing has streamed yet.
        // After text has reached the client a retry would duplicate the reply.
        if (isOverloadedError(err) && attempt < 2 && !textEmitted) {
          console.warn("[chat] overload on attempt", attempt, "— retrying in 1500ms");
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        throw err;
      }
    }

    const toolBlocks = (finalMsg.content || []).filter(b => b.type === "tool_use");
    console.log("[chat] firstPass", {
      userId,
      stop_reason: finalMsg.stop_reason,
      tool_blocks: toolBlocks.length,
      tools_requested: toolBlocks.map(t => t.name),
      input_messages: trimmedMessages.length,
      text_emitted: textEmitted,
      // Prompt-cache visibility — confirms the tools/system-stable prefix is
      // re-used across turns. cache_read_input_tokens billed at ~10% of normal.
      cache_read_input_tokens:    finalMsg.usage?.cache_read_input_tokens    ?? 0,
      cache_creation_input_tokens:finalMsg.usage?.cache_creation_input_tokens?? 0,
      input_tokens:               finalMsg.usage?.input_tokens               ?? 0,
      output_tokens:              finalMsg.usage?.output_tokens              ?? 0,
    });

    // ── Defensive: tool blocks present but the model was cut off ────────────
    // If max_tokens fires while emitting tool_use, the partial JSON in the
    // input field is unparseable / untrustworthy. Don't execute those tools.
    if (finalMsg.stop_reason !== "tool_use" && toolBlocks.length > 0) {
      console.warn("[chat] truncated tool_use detected", {
        userId,
        stop_reason: finalMsg.stop_reason,
        partial_tools: toolBlocks.map(t => t.name),
      });
      sse(res, {
        done: true,
        error: "That message had too many coach actions for one turn. Nothing was saved — try splitting it into two messages.",
        ...(!isPro ? { remaining: FREE_DAILY_LIMIT - usageCount } : {}),
      });
      return res.end();
    }

    // ── Tool path ─────────────────────────────────────────────────────────────
    if (finalMsg.stop_reason === "tool_use" && toolBlocks.length > 0) {
      const toolResults = [];
      const actions = { created: [], edited: [], logged: [], noted: [] };
      /** @type {Array<{ tool: string, success: boolean, error?: string, habit_name?: string, habit_type?: string, name?: string, value_saved?: unknown, date?: string, mode?: string }>} */
      const outcomes = [];

      // Sequential execution: AI sometimes calls create_habit followed by
      // log_habit on that same new habit in a single turn. Running them in
      // parallel causes log_habit to race — the habit row may not exist yet.
      //
      // loggedHabitIds deduplicates same-habit log_habit calls within one turn.
      // The model occasionally emits duplicate tool blocks for the same habit
      // (e.g. Drink Water logged twice). The second call is silently skipped so
      // the DB entry isn't double-written and the receipt shows one pill.
      const loggedHabitIds = new Set();
      for (const tb of toolBlocks) {
        let result;
        try {
          if (tb.name === "create_habit") {
            const row = await executeCreateHabit(tb.input, userId, db);
            actions.created.push(row);
            result = { success: true, id: row.id, name: row.name, habit_type: row.habit_type };
            outcomes.push({ tool: "create_habit", success: true, name: row.name, habit_type: row.habit_type });
          } else if (tb.name === "edit_habit") {
            const r = await executeEditHabit(tb.input, userId, db, actionSafety);
            actions.edited.push(r);
            result = { success: true, habit_name: r.habit_name, fields_updated: Object.keys(r.updates).filter(k => k !== "updated_at") };
            outcomes.push({ tool: "edit_habit", success: true, habit_name: r.habit_name, updates: r.updates });
          } else if (tb.name === "log_habit") {
            const habitId = tb.input?.habit_id;
            if (habitId && loggedHabitIds.has(habitId)) {
              // Duplicate call for the same habit in this turn — skip execution,
              // return success so the model doesn't get confused, add no pill.
              console.log("[chat] duplicate log_habit skipped", { userId, habit_id: habitId, habit_name: tb.input?.habit_name });
              result = { success: true, skipped: true, reason: "already_logged_this_turn", habit_name: tb.input?.habit_name };
            } else {
              if (habitId) loggedHabitIds.add(habitId);
              const r = await executeLogHabit(tb.input, userId, db, clientDate, actionSafety);
              actions.logged.push(r);
              result = { success: true, habit_name: r.habit_name, habit_type: r.habit_type, date: r.date, value_saved: r.logValue };
              outcomes.push({
                tool: "log_habit",
                success: true,
                habit_name: r.habit_name,
                habit_type: r.habit_type,
                value_saved: r.logValue,
              });
            }
          } else if (tb.name === "add_daily_note") {
            const r = await executeAddDailyNote(tb.input, userId, db, clientDate);
            actions.noted.push(r);
            result = { success: true, date: r.date, mode: r.mode };
            outcomes.push({ tool: "add_daily_note", success: true, date: r.date, mode: r.mode });
          } else {
            result = { success: false, error: "Unknown tool — action was NOT performed." };
            outcomes.push({ tool: tb.name, success: false, error: result.error });
          }
        } catch (err) {
          result = { success: false, error: err.message };
          const fail = {
            tool: tb.name,
            success: false,
            error: err.message,
            habit_name: tb.input?.habit_name,
          };
          if (tb.name === "add_daily_note") delete fail.habit_name;
          if (tb.name === "create_habit") fail.name = tb.input?.name;
          outcomes.push(fail);
        }
        // Per-tool trace so we can pinpoint failures in Vercel logs without
        // leaking sensitive data (no notes / reflection text).
        console.log("[chat] tool result", {
          userId,
          tool: tb.name,
          habit_name: tb.input?.habit_name || tb.input?.name || null,
          success: result.success,
          error: result.success ? null : result.error,
        });
        toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(result) });
      }

      console.log("[chat] tool summary", {
        userId,
        created: actions.created.length,
        edited: actions.edited.length,
        logged: actions.logged.length,
        failures: toolResults.filter(r => {
          try { return JSON.parse(r.content).success === false; } catch { return false; }
        }).length,
      });

      // Tools have executed — mark so the catch block knows not to suggest retry
      // and can surface the capture line even if a follow-up stream fails.
      toolsRan = true;
      actionsForCatch = actions;

      const receiptText = buildActionReceipt(outcomes);
      const capturedItems = buildCapturedItems(outcomes);
      receiptForCatch = receiptText;
      capturedForCatch = capturedItems;

      // ── Follow-up call — ONLY when something genuinely needs saying ────────
      // The reply already streamed before the tools ran. A second model call
      // happens only if (a) a tool failed in a way the user must hear about,
      // or (b) the model emitted tools without writing any reply text.
      const hadFailure = outcomes.some(o => !o.success);
      if (hadFailure || !textEmitted) {
        try {
          const followStream = client.messages.stream({
            model: "claude-haiku-4-5", max_tokens: 500,
            system: followupSystemBlocks(systemStable, systemVolatile, system, textEmitted),
            tools, // keep the tools prefix identical so the prompt cache still hits
            messages: [
              ...trimmedMessages,
              { role: "assistant", content: finalMsg.content },
              { role: "user",      content: toolResults },
            ],
          });
          let followPrefixSent = false;
          for await (const chunk of followStream) {
            if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta" && chunk.delta.text) {
              // Separate the addendum from already-streamed reply text.
              if (textEmitted && !followPrefixSent) {
                sse(res, { text: "\n\n" });
                followPrefixSent = true;
              }
              sse(res, { text: chunk.delta.text });
            }
          }
        } catch (followErr) {
          // The data is already saved — never fail the turn because the
          // follow-up wording call broke. The capture line tells the truth.
          console.error("[chat] follow-up stream failed:", followErr?.message || followErr);
          captureException(followErr, { route: "chat", phase: "followup", userId });
        }
      }

      sse(res, {
        done:     true,
        ...(!isPro ? { remaining: FREE_DAILY_LIMIT - (usageCount + 1) } : {}),
        created:  actions.created.length ? actions.created : null,
        edited:   actions.edited.length  ? actions.edited  : null,
        logged:   actions.logged.length  ? actions.logged  : null,
        noted:    actions.noted.length   ? actions.noted   : null,
        receipt:  receiptText || null,
        captured: capturedItems.length ? capturedItems : null,
        tool_failures: outcomes.some(o => !o.success) ? outcomes.filter(o => !o.success) : null,
      });
      // Count this as one message against the free-tier daily quota.
      if (!isPro) {
        try {
          await db.from("chat_usage").upsert(
            { user_id: userId, date: quotaDate, count: usageCount + 1 },
            { onConflict: "user_id,date" }
          );
        } catch (e) { console.error("[chat] usage upsert failed:", e?.message || e); }
      }
      return res.end();
    }

    // ── No tools — the reply already streamed above. Close out the turn. ─────
    sse(res, { done: true, ...(!isPro ? { remaining: FREE_DAILY_LIMIT - (usageCount + 1) } : {}) });
    if (!isPro) {
      try {
        await db.from("chat_usage").upsert(
          { user_id: userId, date: quotaDate, count: usageCount + 1 },
          { onConflict: "user_id,date" }
        );
      } catch (e) { console.error("[chat] usage upsert failed:", e?.message || e); }
    }
    return res.end();

  } catch (err) {
    const overloaded = isOverloadedError(err);
    // err.error is the raw Anthropic response body: { type:"error", error:{ type, message } }
    // err.error.error.message is the human-readable string ("Overloaded").
    // err.message is the SDK-formatted string: "529 {json}" — never show that raw.
    const cleanMsg = overloaded
      ? "The coach got overloaded. Your message is safe — try again in a few seconds."
      : (err?.error?.error?.message || err?.message || "Something went wrong.");

    console.error("[chat] error", {
      status:    err?.status,
      errorType: err?.error?.error?.type || err?.type || null,
      retryable: overloaded,
      toolsRan,
      userId,
      message:   err?.message,
    });
    captureException(err, {
      route:     "chat",
      userId,
      status:    err?.status,
      errorType: err?.error?.error?.type || err?.type || null,
      retryable: overloaded,
      toolsRan,
    });

    if (!res.headersSent) {
      // SSE headers may have been set but never flushed — reset for JSON.
      res.setHeader("Content-Type", "application/json");
      return res.status(err?.status || 500).json({ error: cleanMsg, retryable: overloaded });
    }
    // Headers already sent (SSE open) — tools may have run. Send the capture
    // data so the client can show what was saved even though the stream failed.
    sse(res, {
      error:    cleanMsg,
      retryable: overloaded && !toolsRan && !textEmitted, // retry only safe before tools/text
      done:     true,
      receipt:  receiptForCatch || null,
      captured: capturedForCatch.length ? capturedForCatch : null,
      created:  actionsForCatch.created.length ? actionsForCatch.created : null,
      edited:   actionsForCatch.edited.length  ? actionsForCatch.edited  : null,
      logged:   actionsForCatch.logged.length  ? actionsForCatch.logged  : null,
      noted:    actionsForCatch.noted.length   ? actionsForCatch.noted   : null,
    });
    return res.end();
  }
}

export default withSentry(handler, "chat");
