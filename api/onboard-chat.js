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

// Hard cap on assistant questions before the coach MUST emit an <arc_draft>.
// Counts real assistant turns already in the transcript. The system prompt
// surfaces the same number so the model can self-pace before being forced.
const MAX_ASSISTANT_TURNS = 4;

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

  const {
    name,
    coachName,
    habitName,
    habitType,
    messages = [],
    // `arcIdentity` kept for backwards compat. Prefer `arc` (full object).
    arcIdentity,
    arc,
    existingHabits = [],
    isExistingUser = false,
  } = req.body || {};

  // Defense-in-depth: cap the incoming message history. Onboarding never needs
  // more than a handful of turns; this stops a malicious payload from billing
  // an oversized prompt.
  const trimmedMessages = Array.isArray(messages)
    ? messages.slice(-ONBOARD_MSG_WINDOW)
    : [];

  const isOpener = trimmedMessages.length === 0;
  const priorAssistantTurns = trimmedMessages.filter(m => m && m.role === "assistant").length;

  // Merge legacy arcIdentity into the arc object so the prompt reads one shape.
  const arcFromBody = arc && typeof arc === "object" ? arc : {};
  const arcCtx = {
    identity:     String(arcFromBody.identity     ?? arcIdentity ?? "").trim(),
    why:          String(arcFromBody.why          ?? "").trim(),
    oldPattern:   String(arcFromBody.oldPattern   ?? "").trim(),
    minimumProof: String(arcFromBody.minimumProof ?? "").trim(),
  };
  const dash = "—";
  const filledCount =
    (arcCtx.identity ? 1 : 0) +
    (arcCtx.why ? 1 : 0) +
    (arcCtx.oldPattern ? 1 : 0) +
    (arcCtx.minimumProof ? 1 : 0);

  const maxAssistantTurns = isExistingUser === true ? 6 : MAX_ASSISTANT_TURNS;
  const turnsRemaining = Math.max(0, maxAssistantTurns - priorAssistantTurns);
  const mustDraftThisTurn = priorAssistantTurns >= maxAssistantTurns;

  const habitList = Array.isArray(existingHabits) ? existingHabits.slice(0, 50) : [];
  const showExistingHabitsBlock = habitList.length > 0 || isExistingUser === true;
  const existingHabitsBlock = showExistingHabitsBlock
    ? `\n─── EXISTING HABITS ───
This person has already been tracking these (don't pretend they're new):
${habitList.length > 0
  ? habitList.map(h => {
      const em = String(h?.emoji || "").trim();
      const nm = String(h?.name || "").trim() || "Habit";
      const ht = String(h?.habitType || "daily").trim();
      return `- ${em ? `${em} ` : ""}${nm} (${ht})`;
    }).join("\n")
  : "(none listed yet — ask what they already track)"}
`
    : "";

  const existingUserRules = showExistingHabitsBlock
    ? `- Study EXISTING HABITS before you suggest proofActions. Reuse the exact habit names already in the list whenever they fit — never suggest a near-duplicate (e.g. do NOT suggest "Limit pouches" if they already track "Nicotine pouches" or "Pouch limit").
- Only put a brand-new name in proofActions when nothing existing is a reasonable match.
- Before you emit the draft (not on the opener): ask ONE question like "Any existing habits you definitely want in this Arc, or should I keep the proof list tight?" unless they already answered that.
- You may mention leaving unrelated habits under Other Habits — do NOT tell the app to archive or delete anything.
- When recommending a tight list, say things like "Keep X and Y from what you already track, add Z".
`
    : "";

  const arcContextBlock = `─── ARC CONTEXT (what they already typed) ───
Identity (who they're becoming): ${arcCtx.identity || dash}
Why it matters: ${arcCtx.why || dash}
Old pattern to weaken: ${arcCtx.oldPattern || dash}
Bad-day minimum proof: ${arcCtx.minimumProof || dash}
First habit picked: ${habitName || dash} (${habitType || dash})
Fields filled so far: ${filledCount} of 4.`;

  const finishRules = mustDraftThisTurn
    ? `\nYOU HAVE HIT YOUR QUESTION LIMIT. You MUST emit an <arc_draft> block this turn — no more questions, no exceptions. If a field is genuinely missing, fill it with the most reasonable inference from what they've already told you.`
    : `\nQuestions remaining: ${turnsRemaining}. If you can already infer the five fields with confidence, emit the <arc_draft> block now instead of asking another question. Don't drag this out.`;

  const meetLine = isExistingUser === true
    ? `You're helping ${name || "someone"} start a new 8-week Arc. They already use Forged — treat their existing habits as real.`
    : `You're meeting ${name || "someone"} for the first time.`;

  const system = `You are ${coachName || "a habit coach"} — the AI coach inside Forged. ${meetLine} Your one job in this conversation is to help them build their 8-week Arc and then HAND OFF with a draft they can confirm.

${arcContextBlock}${existingHabitsBlock}

WHAT YOU ARE GATHERING (these become the Arc draft below):
1. identity — who they're becoming (one sentence, concrete)
2. why — why it matters to them right now
3. oldPattern — the pattern they're trying to weaken (the thing that keeps tripping them up)
4. minimumProof — what still counts as proof on a bad day
5. proofActions — 3 to 5 short habit names that prove this Arc (e.g. "Eat breakfast", "Limit nicotine before lunch", "Build for 30 minutes")

CONVERSATION RULES (most important):
- Max ${maxAssistantTurns} assistant questions total across the whole chat. Already used: ${priorAssistantTurns}.
- Ask ONE question at a time. Build on their last answer. Never stack questions.
- Keep every conversational message under 60 words.
- Direct, grounded, warm. Like a sharp friend. No filler, no "great choice".
- NEVER use: "warrior", "elite", "alpha", "future you", "stay strong king/queen", "journey", or any wellness-guru phrasing.
- Do NOT re-ask anything already in ARC CONTEXT above. Build forward.
${existingUserRules}${finishRules}

WHEN YOU HAVE ENOUGH (or hit the limit) — EMIT THE DRAFT.
End your reply with a structured block on its own lines, EXACTLY in this format:

<arc_draft>
{"identity":"…","why":"…","oldPattern":"…","minimumProof":"…","proofActions":["…","…","…"]}
</arc_draft>

Rules for the draft JSON:
- Valid JSON only inside the tags. Single line. No comments, no trailing commas, no markdown.
- identity: concrete, one sentence, max ~140 chars. Borrow their phrasing.
- why, oldPattern, minimumProof: short sentences in their voice. Empty string "" is allowed only if you truly have nothing.
- proofActions: 3 to 5 short habit names, max ~30 chars each. ${showExistingHabitsBlock ? "Use EXACT names from EXISTING HABITS when reusing — do not paraphrase into a duplicate label." : "Prefer habits the user mentioned."} When it makes sense, the first one should be the habit they already picked (${habitName || "their picked habit"}).

WHEN YOU EMIT THE DRAFT, write 1–2 short sentences BEFORE the block to introduce it. Examples:
"Alright, I've got enough to build your first Arc. Here's the draft — tweak anything that feels off."
"That's what I needed. Here's your Arc — adjust it before you start."

After the draft, the app shows a "Use this Arc" button. Do NOT tell them to type anything more.

${isOpener
  ? `THIS IS YOUR OPENING MESSAGE. Welcome ${name || "them"} by name. ${arcCtx.identity ? `Reference what they already wrote ("${arcCtx.identity}") and ask one sharp follow-up to fill in the biggest missing piece.` : "Ask ONE specific question to start filling the Arc — not 'what are your goals?'"} Do NOT emit a draft on the opener unless ALL five fields are already obvious from the ARC CONTEXT.`
  : `Respond to what they just said. If you have enough, emit the draft. Otherwise ask the single next most useful question.`}`;

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
      // Bumped from 130 → 500 so the draft JSON fits alongside the
      // conversational intro. A plain question reply is still ~50-100 tokens;
      // this only costs more on the turn that actually emits the draft.
      max_tokens: 500,
      system,
      messages: apiMessages,
    });
    const reply = resp.content?.[0]?.text?.trim() || "";
    return res.status(200).json({
      reply,
      prior_assistant_turns: priorAssistantTurns,
      questions_remaining: turnsRemaining,
      must_draft_next: mustDraftThisTurn,
    });
  } catch (err) {
    console.error("[onboard-chat]", err.message);
    return res.status(500).json({ error: "Failed to generate response" });
  }
}

export default withSentry(handler, "onboard-chat");
