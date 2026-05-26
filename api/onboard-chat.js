import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
// Anon key is public — safe to hardcode (matches src/supabase.js).
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

// Cap message history sent to Anthropic. Mirrors api/chat.js (messages.slice(-12))
// so a single onboarding session can't be abused into an unbounded thread.
const ONBOARD_MSG_WINDOW = 12;

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Not configured" });

  // ── Auth: REQUIRED ───────────────────────────────────────────────────────────
  // Onboarding happens AFTER Supabase signup, so by the time this route fires
  // the caller has a session. We validate the JWT here so anonymous traffic
  // can't burn Anthropic credit. We deliberately do NOT touch chat_usage —
  // onboarding chat is intentionally exempt from the 3/day free coach cap so
  // a new user can keep chatting during setup without burning their allowance.
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user?.id) return res.status(401).json({ error: "Invalid token" });
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { name, coachName, habitName, habitType, messages = [], arcIdentity } = req.body || {};

  // Defense-in-depth: cap the incoming message history. Onboarding never needs
  // more than a handful of turns; this stops a malicious payload from billing
  // an oversized prompt.
  const trimmedMessages = Array.isArray(messages)
    ? messages.slice(-ONBOARD_MSG_WINDOW)
    : [];

  const isOpener = trimmedMessages.length === 0;

  let system = `You are ${coachName || "a habit coach"} — the AI coach inside Forged, a personal habit tracking app. You are meeting ${name || "someone"} for the very first time.

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

  const arcIdentityTrimmed = typeof arcIdentity === "string" ? arcIdentity.trim() : "";
  if (arcIdentityTrimmed) {
    system += `\n\nThis person just defined an 8-week Arc — they said they're becoming: ${arcIdentityTrimmed}. Reference it naturally in your opener.`;
  }

  // For the opener, use a neutral trigger so the assistant goes first.
  // For follow-ups, the caller sends the alternating conversation history,
  // capped at the most recent ONBOARD_MSG_WINDOW turns.
  const apiMessages = isOpener
    ? [{ role: "user", content: "." }]
    : trimmedMessages;

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
