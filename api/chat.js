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
      "Creates a brand new habit or goal. Call ONLY when user asks to add/create/track something NEW. " +
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
      "DAILY/WEEKLY: no extra fields needed — just logs done. " +
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
      },
      required: ["habit_id", "habit_name"],
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
  } else {
    logValue = true; // daily / weekly
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
    // wants to emit. Each tool_use is ~50-100 tokens of JSON. A multi-log
    // request (e.g. build + gym + calories + weight) easily needs 400+. If
    // we run out of tokens mid-response, stop_reason flips to "max_tokens"
    // (NOT "tool_use") and the tool-execution branch below is skipped —
    // which historically caused silent log failures while the model still
    // produced a confirmation-style text reply. 1500 fits ~15 tool calls.
    const firstResp = await client.messages.create({
      model: "claude-haiku-4-5", max_tokens: 1500,
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
        error: "That message had too many actions for one turn. Try logging two or three at a time.",
      });
    }

    // ── Tool path ─────────────────────────────────────────────────────────────
    if (firstResp.stop_reason === "tool_use") {
      const toolBlocks = firstToolBlocks;
      const toolResults = [];
      const actions = { created: null, edited: [], logged: [] };

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
          } else if (tb.name === "edit_habit") {
            const r = await executeEditHabit(tb.input, userId, db);
            actions.edited.push(r);
            result = { success: true, habit_name: r.habit_name, fields_updated: Object.keys(r.updates).filter(k => k !== "updated_at") };
          } else if (tb.name === "log_habit") {
            const r = await executeLogHabit(tb.input, userId, db, clientDate);
            actions.logged.push(r);
            result = { success: true, habit_name: r.habit_name, habit_type: r.habit_type, date: r.date, value_saved: r.logValue };
          } else {
            result = { success: false, error: "Unknown tool — action was NOT performed." };
          }
        } catch (err) {
          result = { success: false, error: err.message };
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
      // tool call if needed (rare). max_tokens raised to 600 — 350 was tight
      // for confirmations covering 4+ actions.
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");

      const confirmStream = client.messages.stream({
        model: "claude-haiku-4-5", max_tokens: 600,
        system: cachedSystem(system), tools,
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
        done:    true,
        created: actions.created,
        edited:  actions.edited.length  ? actions.edited  : null,
        logged:  actions.logged.length  ? actions.logged  : null,
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
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const chatStream = client.messages.stream({
      model: "claude-haiku-4-5", max_tokens: 500,
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
