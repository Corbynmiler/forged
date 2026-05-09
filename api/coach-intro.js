import Anthropic from "@anthropic-ai/sdk";
import { withSentry } from "./_lib/sentry.js";

const HABIT_TYPE_LABELS = {
  daily:   "daily habit",
  weekly:  "weekly target",
  project: "build/project habit",
  limit:   "limit/reduction habit",
};

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length < 20) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const name      = String(body?.name      || "").trim().slice(0, 40) || "there";
  const habitName = String(body?.habitName || "").trim().slice(0, 40);
  const habitType = String(body?.habitType || "daily");
  const typeLabel = HABIT_TYPE_LABELS[habitType] || "habit";

  if (!habitName) return res.status(400).json({ error: "habitName required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API not configured" });

  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 110,
    system: "You are a concise, direct habit coach. Write exactly 2 sentences — no more. Reference the specific habit name and type. Be practical and warm, not generic or cheesy. Do not use the word 'journey'.",
    messages: [{
      role: "user",
      content: `The user's name is ${name}. They just set up "${habitName}" (a ${typeLabel}) as their first habit. Write a 2-sentence coach welcome that sets a realistic expectation for the first week.`,
    }],
  });

  const text = msg.content?.[0]?.text?.trim() || "";
  if (!text) return res.status(500).json({ error: "No response generated" });

  return res.status(200).json({ message: text });
}

export default withSentry(handler, "coach-intro");
