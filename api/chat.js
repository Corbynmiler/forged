import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

// ── Tool definitions ───────────────────────────────────────────────────────────
const COACH_TOOLS = [
  {
    name: "create_habit",
    description:
      "Creates a new habit or goal for the user in Forged. " +
      "Call this when the user explicitly asks to add, create, track, or start a new habit or goal. " +
      "If the type or key details are ambiguous, ask one clarifying question first rather than guessing.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short, clear habit or goal name.",
        },
        emoji: {
          type: "string",
          description: "A single emoji representing the habit (pick something fitting).",
        },
        habit_type: {
          type: "string",
          enum: ["daily", "weekly", "project", "limit", "goal"],
          description:
            "daily = simple daily checkbox; " +
            "weekly = X sessions per week (requires weekly_target); " +
            "project = hour/session tracking (e.g. side-project, study, work); " +
            "limit = stay under a daily budget (e.g. calories, screen time, spending); " +
            "goal = track progress toward a numeric target with optional deadline.",
        },
        weekly_target: {
          type: "integer",
          description: "For weekly habits: sessions per week (1–7).",
        },
        daily_budget: {
          type: "number",
          description: "For limit habits: the daily cap (e.g. 2000 for calories, 120 for screen-time minutes).",
        },
        unit: {
          type: "string",
          description: "Unit of measurement where relevant (e.g. 'km', 'mins', 'calories', 'hrs', 'pages', '£').",
        },
        start_value: {
          type: "number",
          description: "For goals: the starting value (defaults to 0 if omitted).",
        },
        target_value: {
          type: "number",
          description: "For goals: the value to reach.",
        },
        target_date: {
          type: "string",
          description: "For goals with a deadline: YYYY-MM-DD.",
        },
        color: {
          type: "string",
          description:
            "Hex accent colour. Options: '#C0392B' red, '#27AE60' green, '#2980B9' blue, '#E67E22' orange, '#8E44AD' purple, '#1ABC9C' teal. Pick something fitting.",
        },
      },
      required: ["name", "habit_type"],
    },
  },
];

// ── Execute tool ───────────────────────────────────────────────────────────────
async function executeCreateHabit(input, userId, supabase) {
  const id = crypto.randomUUID();
  const isGoal = input.habit_type === "goal";

  const row = {
    id,
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
    weekly_target:        input.weekly_target    ?? null,
    start_value:          input.start_value      ?? (isGoal ? 0 : null),
    target_value:         input.target_value     ?? null,
    unit:                 input.unit             ?? null,
    daily_budget:         input.daily_budget     ?? null,
    tap_increment:        1,
    daily_target_minutes: input.habit_type === "project" ? 60 : null,
    goal_status:          isGoal ? "active" : null,
    target_date:          input.target_date      ?? null,
    updated_at:           new Date().toISOString(),
  };

  const { data, error } = await supabase.from("habits").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "AI Coach is not configured yet." });

  // ── Verify caller identity (optional — tools only enabled when verified) ────
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
    } catch { /* auth failed — proceed without tools */ }
  }

  try {
    const client = new Anthropic({ apiKey: apiKey.trim() });
    const tools = userId ? COACH_TOOLS : [];

    // ── First Claude call ────────────────────────────────────────────────────
    const firstResp = await client.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 600,
      system:     system || "",
      tools,
      messages,
    });

    // ── Tool use? Execute it then get Claude's confirmation ──────────────────
    if (firstResp.stop_reason === "tool_use" && userId && serviceSupabase) {
      const toolBlock = firstResp.content.find(b => b.type === "tool_use");
      let toolResult = {};
      let created = null;

      try {
        if (toolBlock.name === "create_habit") {
          const row = await executeCreateHabit(toolBlock.input, userId, serviceSupabase);
          created = row;
          toolResult = { success: true, id: row.id, name: row.name, habit_type: row.habit_type };
        } else {
          toolResult = { error: "Unknown tool" };
        }
      } catch (err) {
        toolResult = { error: err.message };
      }

      // Second call — Claude acknowledges what it did
      const secondResp = await client.messages.create({
        model:      "claude-haiku-4-5",
        max_tokens: 300,
        system:     system || "",
        tools,
        messages: [
          ...messages,
          { role: "assistant", content: firstResp.content },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify(toolResult) }],
          },
        ],
      });

      const reply = secondResp.content.find(b => b.type === "text")?.text ?? "";
      return res.status(200).json({ reply, created });
    }

    // ── Normal text response ─────────────────────────────────────────────────
    const reply = firstResp.content.find(b => b.type === "text")?.text ?? "";
    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Chat handler error:", err?.status, err?.message, JSON.stringify(err?.error));
    const msg = err?.error?.message || err?.message || "Something went wrong. Try again.";
    return res.status(err?.status || 500).json({ error: msg });
  }
}
