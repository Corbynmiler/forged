import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
// Anon key is public — safe to hardcode (already hardcoded in src/supabase.js)
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

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
      "If this tool returns success:false, tell the user it failed.",
    input_schema: {
      type: "object",
      properties: {
        name:          { type: "string" },
        emoji:         { type: "string", description: "Single emoji." },
        habit_type: {
          type: "string",
          enum: ["daily", "weekly", "project", "limit", "goal"],
          description: "daily=checkbox; weekly=X/week(needs weekly_target); project=time tracking; limit=stay under budget; goal=numeric target.",
        },
        weekly_target: { type: "integer", description: "Sessions/week for weekly habits." },
        daily_budget:  { type: "number",  description: "Daily cap for limit habits." },
        unit:          { type: "string",  description: "e.g. km, mins, calories, pouches, L" },
        start_value:   { type: "number",  description: "Starting value for goals (default 0)." },
        target_value:  { type: "number",  description: "Target to reach for goals." },
        target_date:   { type: "string",  description: "Deadline YYYY-MM-DD for goals." },
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
      "GOAL: pass amount (new current progress value). " +
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
        note:       { type: "string",  description: "Short note or reflection." },
        rest_day:   { type: "boolean", description: "DAILY or WEEKLY only: true = rest/skip for today (optional note). Does not add a weekly session." },
      },
      required: ["habit_id", "habit_name"],
    },
  },
  {
    name: "log_journal",
    description:
      "Saves to the Journal tab (freeform daily page) — personal thoughts, feelings, relationships, stress, life story, " +
      "anything emotional or narrative that is NOT just numbers/sessions to log on a habit. " +
      "If the user sends ONE message that mixes Forged/build/gym/calories (structured) WITH personal/life/emotional content, " +
      "you MUST call log_habit for each structured fact AND log_journal for the human story in the SAME turn when both exist. " +
      "Do not omit log_journal to save tokens — the user expects the personal part in Journal. " +
      "Put structured facts in habits; put feelings, context, and narrative in log_journal (first person, their words). " +
      "Appends to today's page if an entry already exists. " +
      "If this tool returns success:false in the tool result, you did NOT save — say so honestly.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The journal entry text. First person, user's own words. Can be multi-paragraph.",
        },
      },
      required: ["content"],
    },
    // Prompt caching: marking the LAST tool with cache_control caches the
    // entire tools array (~700+ tokens of stable JSON) for ~5 minutes. Repeat
    // chat turns within that window pay ~10% of the normal input price for
    // this prefix. Saves a large fraction of our Anthropic spend on chat.js
    // because the tools schema is identical on every call.
    cache_control: { type: "ephemeral" },
  },
];

// Convert a plain-string system prompt into the typed-array form Anthropic
// expects when attaching cache_control. Returns "" unchanged so we don't
// send an empty cache breakpoint when the client omits a system prompt.
function cachedSystem(system) {
  const text = typeof system === "string" ? system : "";
  if (!text.trim()) return "";
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/** Post-tool confirmation: keep cached client system + a short uncached turn hint (saves repeating the whole prompt in a new cache block). */
function systemBlocksForToolConfirmation(system) {
  const text = typeof system === "string" ? system : "";
  const blocks = [];
  if (text.trim()) {
    blocks.push({ type: "text", text, cache_control: { type: "ephemeral" } });
  }
  blocks.push({
    type: "text",
    text:
      "THIS TURN ONLY: The user message after yours contains JSON tool_result payloads — those are authoritative (success or failure per tool). " +
      "Reply in natural, human language first: meet what they said with specificity. " +
      "If any tool_result has success:false, say clearly that that part failed and why — never imply it saved. " +
      "Do NOT write your own bullet list of what was saved; the client appends an accurate checklist after your text. " +
      "No new tool calls. Match length: quick log → 1–2 sentences; big mixed dump → up to ~6 short sentences. Hard cap ~140 words for your prose.",
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
    } else if (o.tool === "log_journal") {
      lines.push(
        o.mode === "appended"
          ? "✓ Journal — added to today's page"
          : `✓ Journal — saved (${o.date})`,
      );
    } else if (o.tool === "create_habit") {
      lines.push(`✓ Created ${o.name} (${o.habit_type})`);
    } else if (o.tool === "edit_habit") {
      lines.push(`✓ Updated ${o.habit_name}`);
    }
  }
  for (const o of outcomes) {
    if (o.success) continue;
    hasLine = true;
    if (o.tool === "log_journal") {
      lines.push(`✗ Journal — ${o.error || "couldn't save"}`);
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

// ── Executors ──────────────────────────────────────────────────────────────────

async function executeCreateHabit(input, userId, db) {
  const isGoal = input.habit_type === "goal";
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
    start_value:          input.start_value   ?? (isGoal ? 0 : null),
    target_value:         input.target_value  ?? null,
    unit:                 input.unit          ?? null,
    daily_budget:         input.daily_budget  ?? null,
    tap_increment:        1,
    daily_target_minutes: input.habit_type === "project" ? 60 : null,
    goal_status:          isGoal ? "active" : null,
    target_date:          input.target_date   ?? null,
    updated_at:           new Date().toISOString(),
  };
  const { data, error } = await db.from("habits").insert(row).select().single();
  if (error) throw new Error(`Insert failed: ${error.message}`);
  return data;
}

async function executeEditHabit(input, userId, db) {
  const updates = { updated_at: new Date().toISOString() };
  if (input.name          != null) updates.name           = input.name;
  if (input.emoji         != null) updates.emoji          = input.emoji;
  if (input.target_value  != null) updates.target_value   = input.target_value;
  if (input.daily_budget  != null) updates.daily_budget   = input.daily_budget;
  if (input.weekly_target != null) updates.weekly_target  = input.weekly_target;
  if (input.unit          != null) updates.unit           = input.unit;
  if (input.target_date   != null) updates.target_date    = input.target_date;
  if (input.color         != null) updates.color          = input.color;

  const { data, error } = await db
    .from("habits").update(updates)
    .eq("id", input.habit_id).eq("user_id", userId)
    .select().single();
  if (error) throw new Error(`Update failed: ${error.message}`);
  if (!data)  throw new Error("Habit not found or permission denied");
  return { habit_id: input.habit_id, habit_name: input.habit_name, updates, updatedRow: data };
}

async function executeLogHabit(input, userId, db, clientDate) {
  const { data: row, error } = await db
    .from("habits").select("logs, habit_type")
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

async function executeLogJournal(input, userId, db, clientDate) {
  const date = clientDate || new Date().toISOString().slice(0, 10);
  const content = (input.content || "").trim();
  if (!content) throw new Error("Journal content cannot be empty.");

  // Upsert: one entry per user per day. If an entry already exists, append the
  // new content with a blank-line separator so multiple AI turns in a session
  // don't clobber each other.
  const { data: existing } = await db
    .from("journal_entries")
    .select("id, content")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  if (existing) {
    const merged = existing.content
      ? `${existing.content}\n\n${content}`
      : content;
    const { error } = await db
      .from("journal_entries")
      .update({ content: merged, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`Journal save failed: ${error.message}`);
    return { date, mode: "appended", id: existing.id };
  } else {
    const { data: row, error } = await db
      .from("journal_entries")
      .insert({ user_id: userId, date, content })
      .select()
      .single();
    if (error) throw new Error(`Journal save failed: ${error.message}`);
    return { date, mode: "created", id: row.id };
  }
}

// ── SSE helper ─────────────────────────────────────────────────────────────────
function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Free-tier server-side rate limit ───────────────────────────────────────────
// Keep in sync with client-side FREE_DAILY_LIMIT in src/App.jsx.
const FREE_DAILY_LIMIT = 10;

// ── Handler ────────────────────────────────────────────────────────────────────
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, system, client_date: rawClientDate } = req.body;
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
      });
    }
  }

  const client = new Anthropic({ apiKey: apiKey.trim() });
  const tools  = COACH_TOOLS;

  // Cost control: cap history at last 12 messages (6 turns)
  const trimmedMessages = messages.slice(-12);

  try {
    // ── First call — detect tool_use ─────────────────────────────────────────
    // max_tokens MUST be generous enough to fit ALL tool_use blocks the model
    // wants to emit. Mixed dumps (many habits + log_journal) need headroom.
    const firstResp = await client.messages.create({
      model: "claude-haiku-4-5", max_tokens: 2048,
      system: cachedSystem(system), tools,
      messages: trimmedMessages,
    });

    const firstToolBlocks = (firstResp.content || []).filter(b => b.type === "tool_use");
    console.log("[chat] firstResp", {
      userId,
      stop_reason: firstResp.stop_reason,
      tool_blocks: firstToolBlocks.length,
      tools_requested: firstToolBlocks.map(t => t.name),
      input_messages: trimmedMessages.length,
      // Prompt-cache visibility — confirms the tools/system prefix is being
      // re-used across turns. cache_read_input_tokens billed at ~10% of normal.
      cache_read_input_tokens:    firstResp.usage?.cache_read_input_tokens    ?? 0,
      cache_creation_input_tokens:firstResp.usage?.cache_creation_input_tokens?? 0,
      input_tokens:               firstResp.usage?.input_tokens               ?? 0,
      output_tokens:              firstResp.usage?.output_tokens              ?? 0,
    });

    // ── Defensive: tool blocks present but the model was cut off ────────────
    // If max_tokens fires while emitting tool_use, the partial JSON in the
    // input field is usually unparseable. Either way we cannot trust those
    // tool calls. Surface a clear error rather than silently ignoring them.
    if (firstResp.stop_reason !== "tool_use" && firstToolBlocks.length > 0) {
      console.warn("[chat] truncated tool_use detected", {
        userId,
        stop_reason: firstResp.stop_reason,
        partial_tools: firstToolBlocks.map(t => t.name),
      });
      return res.status(502).json({
        error: "That message had too many coach actions for one turn (habits + journal). Try splitting into two messages, or fewer logs at once.",
      });
    }

    // ── Tool path ─────────────────────────────────────────────────────────────
    if (firstResp.stop_reason === "tool_use") {
      const toolBlocks = firstToolBlocks;
      const toolResults = [];
      const actions = { created: null, edited: [], logged: [], journaled: [] };
      /** @type {Array<{ tool: string, success: boolean, error?: string, habit_name?: string, habit_type?: string, name?: string, value_saved?: unknown, date?: string, mode?: string }>} */
      const outcomes = [];

      // Sequential execution: AI sometimes calls create_habit followed by
      // log_habit on that same new habit in a single turn. Running them in
      // parallel causes log_habit to race — the habit row may not exist yet.
      for (const tb of toolBlocks) {
        let result;
        try {
          if (tb.name === "create_habit") {
            const row = await executeCreateHabit(tb.input, userId, db);
            actions.created = row;
            result = { success: true, id: row.id, name: row.name, habit_type: row.habit_type };
            outcomes.push({ tool: "create_habit", success: true, name: row.name, habit_type: row.habit_type });
          } else if (tb.name === "edit_habit") {
            const r = await executeEditHabit(tb.input, userId, db);
            actions.edited.push(r);
            result = { success: true, habit_name: r.habit_name, fields_updated: Object.keys(r.updates).filter(k => k !== "updated_at") };
            outcomes.push({ tool: "edit_habit", success: true, habit_name: r.habit_name });
          } else if (tb.name === "log_habit") {
            const r = await executeLogHabit(tb.input, userId, db, clientDate);
            actions.logged.push(r);
            result = { success: true, habit_name: r.habit_name, habit_type: r.habit_type, date: r.date, value_saved: r.logValue };
            outcomes.push({
              tool: "log_habit",
              success: true,
              habit_name: r.habit_name,
              habit_type: r.habit_type,
              value_saved: r.logValue,
            });
          } else if (tb.name === "log_journal") {
            const r = await executeLogJournal(tb.input, userId, db, clientDate);
            actions.journaled.push(r);
            result = { success: true, date: r.date, mode: r.mode };
            outcomes.push({ tool: "log_journal", success: true, date: r.date, mode: r.mode });
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
          if (tb.name === "log_journal") delete fail.habit_name;
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
        created: actions.created ? 1 : 0,
        edited: actions.edited.length,
        logged: actions.logged.length,
        failures: toolResults.filter(r => {
          try { return JSON.parse(r.content).success === false; } catch { return false; }
        }).length,
      });

      // Stream confirmation — Claude now knows exact success/failure per action.
      // We intentionally leave `tools` available so Claude can chain a follow-up
      // tool call if needed (rare). max_tokens 480: enough for several warm
      // sentences; client prompt + turn hint cap verbosity (~120 words).
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");

      const receiptText = buildActionReceipt(outcomes);

      const confirmStream = client.messages.stream({
        model: "claude-haiku-4-5", max_tokens: 900,
        system: systemBlocksForToolConfirmation(system), tools,
        messages: [
          ...trimmedMessages,
          { role: "assistant", content: firstResp.content },
          { role: "user",      content: toolResults },
        ],
      });

      for await (const chunk of confirmStream) {
        if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
          sse(res, { text: chunk.delta.text });
        }
      }

      sse(res, {
        done:     true,
        created:  actions.created,
        edited:   actions.edited.length    ? actions.edited    : null,
        logged:   actions.logged.length    ? actions.logged    : null,
        journaled:actions.journaled.length ? actions.journaled : null,
        receipt:  receiptText || null,
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

    // ── Normal chat — stream directly (FIX: use .stream() not .create()) ─────
    // max_tokens raised to 1000: goal-plan responses include a <goal_plan>
    // JSON block (~150-200 tokens) + conversational text. At 500 the block was
    // frequently truncated mid-JSON, causing parseGoalPlan to silently fail and
    // the raw XML to leak into the chat bubble.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const chatStream = client.messages.stream({
      model: "claude-haiku-4-5", max_tokens: 1000,
      system: cachedSystem(system), tools,
      messages: trimmedMessages,
    });

    for await (const chunk of chatStream) {
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        sse(res, { text: chunk.delta.text });
      }
    }

    sse(res, { done: true });
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
    console.error("[chat] error:", err?.status, err?.message);
    captureException(err, { route: "chat", userId, status: err?.status });
    const msg = err?.error?.message || err?.message || "Something went wrong.";
    if (!res.headersSent) return res.status(err?.status || 500).json({ error: msg });
    sse(res, { error: msg, done: true });
    return res.end();
  }
}

export default withSentry(handler, "chat");
