import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

// ── Tool definitions ───────────────────────────────────────────────────────────
const COACH_TOOLS = [
  // ─── CREATE ──────────────────────────────────────────────────────────────────
  {
    name: "create_habit",
    description:
      "Creates a brand new habit or goal in the user's Forged app. " +
      "Call ONLY when user explicitly asks to add/create/track something NEW. " +
      "Ask one clarifying question first if the type or key details are genuinely ambiguous. " +
      "IMPORTANT: If this tool returns an error, tell the user it failed — do not claim success.",
    input_schema: {
      type: "object",
      properties: {
        name:          { type: "string",  description: "Short, clear habit name." },
        emoji:         { type: "string",  description: "A single fitting emoji." },
        habit_type: {
          type: "string",
          enum: ["daily", "weekly", "project", "limit", "goal"],
          description:
            "daily = simple daily checkbox; " +
            "weekly = X sessions per week (requires weekly_target); " +
            "project = time/session tracking for a project (e.g. building, studying); " +
            "limit = stay under a daily budget (e.g. calories, pouches, screen time); " +
            "goal = track progress toward a numeric target with optional deadline.",
        },
        weekly_target: { type: "integer", description: "For weekly: sessions per week (1-7)." },
        daily_budget:  { type: "number",  description: "For limit: the daily cap (e.g. 7 for 7 pouches, 2000 for calories)." },
        unit:          { type: "string",  description: "Unit e.g. 'km', 'mins', 'calories', 'hrs', 'pages', 'pouches', 'L'." },
        start_value:   { type: "number",  description: "For goals: starting value (default 0)." },
        target_value:  { type: "number",  description: "For goals: the numeric target to reach." },
        target_date:   { type: "string",  description: "For goals with deadline: YYYY-MM-DD." },
        color: {
          type: "string",
          description: "Hex colour: '#C0392B' red (default), '#27AE60' green, '#2980B9' blue, '#E67E22' orange, '#8E44AD' purple.",
        },
      },
      required: ["name", "habit_type"],
    },
  },

  // ─── EDIT ────────────────────────────────────────────────────────────────────
  {
    name: "edit_habit",
    description:
      "Updates properties of an existing habit or goal. Use when user asks to change the name, target, budget, deadline, emoji, or any setting on an existing habit. " +
      "Only include the fields that need changing. " +
      "IMPORTANT: If this tool returns an error, tell the user it failed — do not claim success.",
    input_schema: {
      type: "object",
      properties: {
        habit_id:      { type: "string", description: "The [id:...] from the habit list in the system prompt." },
        habit_name:    { type: "string", description: "Current habit name (for your confirmation message)." },
        name:          { type: "string", description: "New name (if renaming)." },
        emoji:         { type: "string", description: "New emoji (if changing)." },
        target_value:  { type: "number", description: "New target value for goals." },
        daily_budget:  { type: "number", description: "New daily budget for limit habits." },
        weekly_target: { type: "integer", description: "New sessions/week for weekly habits." },
        unit:          { type: "string", description: "New unit of measurement." },
        target_date:   { type: "string", description: "New deadline YYYY-MM-DD for goals." },
        color:         { type: "string", description: "New hex colour." },
      },
      required: ["habit_id", "habit_name"],
    },
  },

  // ─── LOG ─────────────────────────────────────────────────────────────────────
  {
    name: "log_habit",
    description:
      "Logs an entry for an existing habit today. The value format depends on the habit type — " +
      "use 'minutes' for project habits, 'amount' for limit/goal habits, and leave both null for daily/weekly (just marks done). " +
      "Can log a win, note, or reflection at the same time. " +
      "You CAN call this multiple times in one turn to log several habits at once. " +
      "IMPORTANT: If this tool returns an error, tell the user it failed — do not claim success.",
    input_schema: {
      type: "object",
      properties: {
        habit_id:   { type: "string",  description: "The [id:...] from the habit list in the system prompt." },
        habit_name: { type: "string",  description: "Habit name (for confirmation)." },
        minutes:    { type: "number",  description: "For PROJECT habits only: minutes worked this session (e.g. 60 for 1 hour, 120 for 2 hours)." },
        amount:     { type: "number",  description: "For LIMIT habits: amount used/consumed today (e.g. 2 for 2 pouches). For GOAL habits: new current progress value." },
        win:        { type: "string",  description: "For PROJECT habits: a win or achievement to record (max ~100 chars)." },
        hard_part:  { type: "string",  description: "For PROJECT habits: something that was hard or a blocker today." },
        note:       { type: "string",  description: "A short note or reflection to attach to this log entry." },
      },
      required: ["habit_id", "habit_name"],
    },
  },
];

// ── Tool executors ─────────────────────────────────────────────────────────────

async function executeCreateHabit(input, userId, supabase) {
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
  const { data, error } = await supabase.from("habits").insert(row).select().single();
  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data;
}

async function executeEditHabit(input, userId, supabase) {
  // Build only the fields that were actually supplied
  const updates = { updated_at: new Date().toISOString() };
  if (input.name          != null) updates.name           = input.name;
  if (input.emoji         != null) updates.emoji          = input.emoji;
  if (input.target_value  != null) updates.target_value   = input.target_value;
  if (input.daily_budget  != null) updates.daily_budget   = input.daily_budget;
  if (input.weekly_target != null) updates.weekly_target  = input.weekly_target;
  if (input.unit          != null) updates.unit           = input.unit;
  if (input.target_date   != null) updates.target_date    = input.target_date;
  if (input.color         != null) updates.color          = input.color;

  const { data, error } = await supabase
    .from("habits")
    .update(updates)
    .eq("id", input.habit_id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw new Error(`DB update failed: ${error.message}`);
  if (!data) throw new Error("Habit not found or no permission");
  return { habit_id: input.habit_id, habit_name: input.habit_name, updates, updatedRow: data };
}

async function executeLogHabit(input, userId, supabase) {
  // Fetch current row to know the habit_type and existing logs
  const { data: row, error } = await supabase
    .from("habits")
    .select("logs, habit_type")
    .eq("id", input.habit_id)
    .eq("user_id", userId)
    .single();
  if (error || !row) throw new Error(`Habit not found (id: ${input.habit_id})`);

  const today = new Date().toISOString().split("T")[0];
  const logs = Array.isArray(row.logs) ? row.logs : [];

  // Build the correct log value based on habit type
  let logValue;
  const htype = row.habit_type;

  if (htype === "project") {
    // Project habits: value is an object with minutes + optional win/hardPart
    if (input.minutes == null) throw new Error("Project habits require 'minutes' field. Ask the user how long they worked.");
    logValue = { minutes: Math.round(input.minutes) };
    if (input.win)       logValue.win      = input.win;
    if (input.hard_part) logValue.hardPart = input.hard_part;
  } else if (htype === "limit") {
    // Limit habits: value is a number (amount used)
    if (input.amount == null) throw new Error("Limit habits require 'amount' field — ask the user how much they used.");
    logValue = input.amount;
  } else if (htype === "goal") {
    // Goals: value is the new current progress number
    if (input.amount == null) throw new Error("Goal logging requires 'amount' — the new current progress value.");
    logValue = input.amount;
  } else {
    // daily / weekly: just mark done
    logValue = true;
  }

  // For project habits, merge into existing today entry (additive sessions)
  let updatedLogs;
  if (htype === "project") {
    const existingIdx = logs.findIndex(l => l.date === today);
    if (existingIdx >= 0) {
      const existing = logs[existingIdx];
      const existingMins = existing.value?.minutes ?? 0;
      const mergedValue = { ...existing.value, minutes: existingMins + logValue.minutes };
      if (logValue.win)       mergedValue.win      = logValue.win;
      if (logValue.hardPart)  mergedValue.hardPart = logValue.hardPart;
      if (input.note)         mergedValue.note     = input.note;
      updatedLogs = logs.map((l, i) => i === existingIdx ? { ...l, value: mergedValue } : l);
    } else {
      const entry = { date: today, value: logValue };
      if (input.note) entry.note = input.note;
      updatedLogs = [...logs, entry];
    }
  } else {
    // For all other types: replace today's entry
    const filtered = logs.filter(l => l.date !== today);
    const entry = { date: today, value: logValue };
    if (input.note)       entry.note       = input.note;
    if (input.win)        entry.win        = input.win;
    updatedLogs = [...filtered, entry];
  }

  const { error: upErr } = await supabase
    .from("habits")
    .update({ logs: updatedLogs, updated_at: new Date().toISOString() })
    .eq("id", input.habit_id)
    .eq("user_id", userId);
  if (upErr) throw new Error(`DB update failed: ${upErr.message}`);

  return {
    habit_id:    input.habit_id,
    habit_name:  input.habit_name,
    habit_type:  htype,
    date:        today,
    updatedLogs,
    logValue,
  };
}

// ── SSE helper ─────────────────────────────────────────────────────────────────
function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid request body" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "AI Coach is not configured yet." });

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  let userId = null;
  let serviceSupabase = null;
  if (token && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const userClient = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user?.id) {
        userId = user.id;
        serviceSupabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      }
    } catch { /* proceed without tools */ }
  }

  const client = new Anthropic({ apiKey: apiKey.trim() });
  const tools  = userId ? COACH_TOOLS : [];

  try {
    // ── First call: detect tool_use ──────────────────────────────────────────
    const firstResp = await client.messages.create({
      model: "claude-haiku-4-5", max_tokens: 800, system: system || "", tools, messages,
    });

    // ── Tool use: execute ALL tool blocks then stream confirmation ───────────
    if (firstResp.stop_reason === "tool_use" && userId && serviceSupabase) {
      const toolBlocks = firstResp.content.filter(b => b.type === "tool_use");
      const toolResults = [];
      const actions = { created: null, edited: [], logged: [] };

      // Execute all in parallel (safe — they target different habits)
      await Promise.all(toolBlocks.map(async (toolBlock) => {
        let result;
        try {
          if (toolBlock.name === "create_habit") {
            const row = await executeCreateHabit(toolBlock.input, userId, serviceSupabase);
            actions.created = row;
            result = { success: true, id: row.id, name: row.name, habit_type: row.habit_type };

          } else if (toolBlock.name === "edit_habit") {
            const r = await executeEditHabit(toolBlock.input, userId, serviceSupabase);
            actions.edited.push(r);
            result = { success: true, habit_name: r.habit_name, updated_fields: Object.keys(r.updates).filter(k => k !== "updated_at") };

          } else if (toolBlock.name === "log_habit") {
            const r = await executeLogHabit(toolBlock.input, userId, serviceSupabase);
            actions.logged.push(r);
            result = { success: true, habit_name: r.habit_name, habit_type: r.habit_type, date: r.date, value_written: r.logValue };

          } else {
            result = { error: "Unknown tool — this action was NOT performed." };
          }
        } catch (err) {
          // Return structured error so Claude knows the action FAILED
          result = { success: false, error: err.message };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }));

      // Stream confirmation response (Claude now knows exact success/failure per tool)
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");

      const stream = await client.messages.stream({
        model: "claude-haiku-4-5", max_tokens: 400, system: system || "", tools,
        messages: [
          ...messages,
          { role: "assistant", content: firstResp.content },
          { role: "user",      content: toolResults },
        ],
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
          sseWrite(res, { text: chunk.delta.text });
        }
      }

      // Send action metadata — only include successfully completed actions
      sseWrite(res, {
        done:    true,
        created: actions.created,
        edited:  actions.edited.length  > 0 ? actions.edited  : null,
        logged:  actions.logged.length  > 0 ? actions.logged  : null,
      });
      return res.end();
    }

    // ── Normal chat: stream directly ────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await client.messages.stream({
      model: "claude-haiku-4-5", max_tokens: 600, system: system || "", tools, messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        sseWrite(res, { text: chunk.delta.text });
      }
    }

    sseWrite(res, { done: true });
    return res.end();

  } catch (err) {
    console.error("Chat handler error:", err?.status, err?.message);
    const msg = err?.error?.message || err?.message || "Something went wrong.";
    if (!res.headersSent) return res.status(err?.status || 500).json({ error: msg });
    sseWrite(res, { error: msg, done: true });
    return res.end();
  }
}
