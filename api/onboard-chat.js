import Anthropic from "@anthropic-ai/sdk";
import { withSentry } from "./_lib/sentry.js";

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Not configured" });

  const { name, coachName, habitName, habitType, messages = [] } = req.body || {};

  const isOpener = messages.length === 0;

  const system = `You are ${coachName || "a habit coach"} — the AI coach inside Forged, a personal habit tracking app. You are meeting ${name || "someone"} for the very first time.

They just chose to track: ${habitName || "a habit"} (${habitType || "daily"} type).

Your goal right now: have a short, real first conversation. Not a sales pitch. Not generic wellness tips. Just find out who this person actually is and what's going on with this habit for them specifically.

Rules:
- Keep every message under 55 words
- Be direct, specific, warm — reference their actual habit (${habitName}) by name
- Sound like a coach who has worked with real people, not a chatbot that read a self-help book
- No "Great choice!", no filler encouragement, no bullet points, no hashtags, no "journey"
- ${isOpener
    ? `This is your opening message. Welcome ${name || "them"} by name, reference ${habitName} specifically, and end with ONE targeted question — something that actually tells you useful information about their relationship with this habit. Not "what are your goals?" — something more specific and interesting.`
    : `Respond to what they actually said. Don't always ask another question. Sometimes just say something real and direct. Keep the conversation moving forward.`}`;

  // For the opener, use a neutral trigger so the assistant goes first.
  // For follow-ups, the caller sends the full alternating conversation history.
  const apiMessages = isOpener
    ? [{ role: "user", content: "." }]
    : messages;

  try {
    const client = new Anthropic({ apiKey: apiKey.trim() });
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 130,
      system,
      messages: apiMessages,
    });
    const reply = resp.content?.[0]?.text?.trim() || "";
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("[onboard-chat]", err.message);
    return res.status(500).json({ error: "Failed to generate response" });
  }
}

export default withSentry(handler, "onboard-chat");
