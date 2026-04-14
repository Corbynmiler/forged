import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

// ── Tool definitions ───────────────────────────────────────────────────────────
const COACH_TOOLS = [
  {
    name: "create_habit",
    description:
      "Creates a new habit or goal for the user. Call when they explicitly ask to add, create, or track something new. " +
      "Ask one clarifying question first if type or key details are ambiguous.",
    input_schema: {
      type: "object",
      properties: {
        name:          { type: "string",  description: "Short, clear habit name." },
        emoji:         { type: "string",  description: "A single fitting emoji." },
        habit_type: {
          type: "string",
          enum: ["daily", "weekly", "project", "limit", "goal"],
          description:
            "daily=simple checkbox; weekly=X sessions/week (needs weekly_target); " +
            "project=hour tracking; limit=stay under daily budget; goal=progress toward numeric target.",
        },
        weekly_target: { type: "integer", description: "For weekly: sessions per week (1-7)." },
        daily_budget:  { type: "number",  description: "For limit: daily cap amount." },
        unit:          { type: "string",  description: "Unit e.g. km, mins, calories, hrs, pages." },
        start_value:   { type: "number",  description: "For goals: starting value (default 0)." },
        target_value:  { type: "number",  description: "For goals: target to reach." },
        target_date:   { type: "string",  description: "For goals with deadline: YYYY-MM-DD." },
        color: {
          type: "string",
          description: "Hex colour: '#C0392B' red, '#27AE60' green, '#2980B9' blue, '#E67E22' orange, '#8E44AD' purple.",
        },
      },
      required: ["name", "habit_type"],
    },
  },
  {
    name: "log_habit",
    description:
      "Logs today's completion for one existing habit. Match user's words to the closest habit id from the system prompt. " +
      "You can call this tool multiple times in parallel to log several habits at once when the user mentions multiple.",
    input_schema: {
      type: "object",
      properties: {
        habit_id:   { type: "string",  description: "The [id:...] from the habit in the system prompt." },
        habit_name: { type: "string",  description: "Habit name for confirmation." },
        value:      { type: "boolean", description: "true = done/completed.", default: true },
        note:       { type: "string",  description: "Optional note the user mentioned." },
      },
      required: ["habit_id", "habit_name"],
    },
  },
  {
    name: "rename_habit",
    description: "Renames an existing habit. Use when user asks to rename or change a habit's name.",
    input_schema: {
      type: "object",
      properties: {
        habit_id: { type: "string", description: "The [id:...] from the system prompt." },
        old_name: { type: "string", description: "Current name (for confirmation)." },
        new_name: { type: "string", description: "New name the user wants." },
      },
      required: ["habit_id", "old_name", "new_name"],
    },
  },
];

// ── Tool executors ─────────────────────────────────────────────────────────────
async function executeCreateHabit(input, userId, supabase) {
  const isGoal = input.habit_type === "goal";
  const row = {
    // No id — let Supabase generate via gen_random_uuid()
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
  if (error) throw new Error(error.message);
  return data;
}

async function executeLogHabit(input, userId, supabase) {
  const { data: row, error } = await supabase
    .from("habits").select("logs").eq("id", input.habit_id).eq("user_id", userId).single();
  if (error || !row) throw new Error("Habit not found");
  const today = new Date().toISOString().split("T")[0];
  const logs = Array.isArray(row.logs) ? row.logs : [];
  const filtered = logs.filter(l => l.date !== today);
  const newLog = { date: today, value: input.value ?? true };
  if (input.note) newLog.note = input.note;
  const updatedLogs = [...filtered, newLog];
  const { error: upErr } = await supabase
    .from("habits").update({ logs: updatedLogs, updated_at: new Date().toISOString() })
    .eq("id", input.habit_id).eq("user_id", userId);
  if (upErr) throw new Error(upErr.message);
  return { habit_id: input.habit_id, habit_name: input.habit_name, date: today, updatedLogs };
}

async function executeRenameHabit(input, userId, supabase) {
  const { error } = await supabase
    .from("habits").update({ name: input.new_name, updated_at: new Date().toISOString() })
    .eq("id", input.habit_id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { habit_id: input.habit_id, old_name: input.old_name, new_name: input.new_name };
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
    // ── First call (non-streaming — need to detect tool_use) ─────────────────
    const firstResp = await client.messages.create({
      model: "claude-haiku-4-5", max_tokens: 600, system: system || "", tools, messages,
    });

    // ── Tool use: handle ALL tool blocks (enables parallel logging) ──────────
    if (firstResp.stop_reason === "tool_use" && userId && serviceSupabase) {
      const toolBlocks = firstResp.content.filter(b => b.type === "tool_use");
      const toolResults = [];
      const actions = { created: null, logged: [], renamed: [] };

      // Execute all tools in parallel
      await Promise.all(toolBlocks.map(async (toolBlock) => {
        let result = {};
        try {
          if (toolBlock.name === "create_habit") {
            const row = await executeCreateHabit(toolBlock.input, userId, serviceSupabase);
            actions.created = row;
            result = { success: true, id: row.id, name: row.name, habit_type: row.habit_type };
          } else if (toolBlock.name === "log_habit") {
            const r = await executeLogHabit(toolBlock.input, userId, serviceSupabase);
            actions.logged.push(r);
            result = { success: true, habit_name: r.habit_name, date: r.date };
          } else if (toolBlock.name === "rename_habit") {
            const r = await executeRenameHabit(toolBlock.input, userId, serviceSupabase);
            actions.renamed.push(r);
            result = { success: true, old_name: r.old_name, new_name: r.new_name };
          }
        } catch (err) {
          result = { error: err.message };
        }
        toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify(result) });
      }));

      // Stream the confirmation response
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");

      const stream = await client.messages.stream({
        model: "claude-haiku-4-5", max_tokens: 300, system: system || "", tools,
        messages: [
          ...messages,
          { role: "assistant", content: firstResp.content },
          { role: "user", content: toolResults },
        ],
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
          sseWrite(res, { text: chunk.delta.text });
        }
      }

      // Send action metadata at the end so frontend can update state
      sseWrite(res, {
        done: true,
        created: actions.created,
        logged:  actions.logged.length  > 0 ? actions.logged  : null,
        renamed: actions.renamed.length > 0 ? actions.renamed : null,
      });
      return res.end();
    }

    // ── Normal chat: stream the response ────────────────────────────────────
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
