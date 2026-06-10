import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
// Anon key is public — safe to hardcode (matches src/supabase.js).
const SUPABASE_ANON_KEY =
  "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

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
  // onboarding chat is intentionally exempt from the 5/day free coach cap so
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
    isEditMode = false,
    // Conversation-first onboarding: when true the coach emits 2–3 distinct
    // <arc_options> instead of a single <arc_draft>.
    multiOptions = false,
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
    title:        String(arcFromBody.title        ?? "").trim(),
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

  // multiOptions: opener is seeded client-side and counts as one assistant
  // turn, so 4 total = opener + 3 real questions before options are forced.
  const maxAssistantTurns = multiOptions === true ? 4 : isExistingUser === true ? 6 : MAX_ASSISTANT_TURNS;
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
Arc title: ${arcCtx.title || dash}
Identity (who they're becoming): ${arcCtx.identity || dash}
Why it matters: ${arcCtx.why || dash}
Old pattern to weaken: ${arcCtx.oldPattern || dash}
Bad-day minimum proof: ${arcCtx.minimumProof || dash}
First habit picked: ${habitName || dash} (${habitType || dash})
Fields filled so far: ${filledCount} of 4.`;

  const finishRules = mustDraftThisTurn
    ? `\nYOU HAVE HIT YOUR QUESTION LIMIT. You MUST emit an <arc_draft> block this turn — no more questions, no exceptions. If a field is genuinely missing, fill it with the most reasonable inference from what they've already told you.`
    : `\nQuestions remaining: ${turnsRemaining}. If you can already infer the five fields with confidence, emit the <arc_draft> block now instead of asking another question. Don't drag this out.`;

  const meetLine = isEditMode === true
    ? `You're helping ${name || "someone"} adjust their active Arc. They already use Forged — treat their existing habits as real. Do not suggest deleting or archiving habits.`
    : isExistingUser === true
      ? `You're helping ${name || "someone"} start a new Arc — a finite season of change (2, 4, 8 or 12 weeks). They already use Forged — treat their existing habits as real.`
      : `You're meeting ${name || "someone"} for the first time.`;

  const durationGuidance = `durationDays — length in days. Only 14, 28, 56, or 84 (2/4/8/12 weeks). Pick what genuinely fits the goal: first Arcs usually land best at 14 or 28 days (a faster, real completion loop); use 56 or 84 only when the goal truly needs that runway (e.g. marathon prep, big body-composition change, shipping something large). Never default to 8 weeks out of habit.`;

  // ── Conversation-first onboarding: 2–3 distinct Arc proposals ─────────────
  const optionsFinishRules = mustDraftThisTurn
    ? `\nYOU HAVE HIT YOUR QUESTION LIMIT. You MUST emit the <arc_options> block this turn — no more questions, no exceptions. Infer anything missing from what they've already said.`
    : `\nQuestions remaining: ${turnsRemaining}. The moment you can sketch real options, emit <arc_options> instead of asking another question. Two good questions is usually enough. Don't drag this out.`;

  const optionsSystem = `You are ${coachName || "a habit coach"} — the AI coach inside Forged. You're meeting ${name || "someone"} in their first minutes in the app. They just answered an opening question about what they're trying to change. Your one job: a short, natural conversation, then propose 2–3 genuinely different Arcs they can pick from.

An Arc is a finite season of change — a few weeks with one direction, 2–4 daily proof actions, and a bad-day minimum.

CONVERSATION RULES:
- Max ${maxAssistantTurns - 1} questions total (the opener counted as one). Already used: ${priorAssistantTurns}.
- ONE question at a time, under 50 words, building on what they said. Plain language.
- Direct, grounded, warm. Like a sharp friend. No filler, no "great choice", no therapy-speak.
- NEVER: "warrior", "elite", "alpha", "future you", "journey", wellness-guru phrasing.
- Never mention Pro, pricing, upgrades, or features. This conversation is about them.
- If they ask for examples, give 3–4 short concrete ones in plain lines.
${optionsFinishRules}

WHEN YOU HAVE ENOUGH — EMIT THE OPTIONS.
Write 1–2 short sentences introducing them (e.g. "Here are three ways we could run this — pick the one that fits."), then end with EXACTLY this block:

<arc_options>
[{"title":"…","identity":"…","why":"…","oldPattern":"…","minimumProof":"…","durationDays":28,"proofActions":["…","…"]},{"title":"…","identity":"…","why":"…","oldPattern":"…","minimumProof":"…","durationDays":14,"proofActions":["…","…","…"]}]
</arc_options>

Rules for the options JSON:
- Valid JSON array of 2 or 3 objects inside the tags. Single line. No comments, no trailing commas, no markdown.
- The options must be GENUINELY DIFFERENT — different scope, intensity, or angle on their problem. Not the same Arc reworded. Good axes: narrow-and-fast vs broader-and-steadier; attack the old pattern head-on vs build the replacement first; different durations.
- title: 1–3 words, punchy. NEVER warrior/alpha/elite/beast. NEVER a sentence.
- identity: one concrete sentence, max ~140 chars, borrowing their phrasing.
- why / oldPattern / minimumProof: short sentences in their voice ("" only if truly unknown).
- ${durationGuidance}
- proofActions: 2 to 4 per option, short concrete habit names (max ~30 chars) that can be done most days.

After the options, the app shows them as cards. Do NOT describe each option in prose — the cards do that.`;

  const system = `You are ${coachName || "a habit coach"} — the AI coach inside Forged. ${meetLine} Your one job in this conversation is to help them build their Arc — a finite season of change — and then HAND OFF with a draft they can confirm.

${arcContextBlock}${existingHabitsBlock}

WHAT YOU ARE GATHERING (these become the Arc draft below):
1. title — short Arc name, 1–3 words max (e.g. "Fuel Arc", "Clean Fuel", "Builder Arc"). Punchy, not a sentence. Never use "Someone who…" or the full identity as the title.
2. identity — their direction over this Arc (one concrete sentence — what feels different, what they're doing more/less of). You may say "who you're becoming" later, but do NOT lead with that phrase as the first question.
3. why — why it matters to them right now
4. oldPattern — the pattern they're trying to weaken (the thing that keeps tripping them up)
5. minimumProof — what still counts as proof on a bad day
6. proofActions — 3 to 5 short habit names that prove this Arc (e.g. "Eat breakfast", "Limit nicotine before lunch", "Build for 30 minutes")
7. ${durationGuidance}

FIRST QUESTION FRAMING (critical):
- Do NOT open with "Who are you becoming?" as the main question.
- Start with a visualisation: picture themselves at the end of this Arc — what feels different in an ideal world? What are they doing more of, less of, or getting under control?
- ${isExistingUser === true && !isEditMode
    ? `Existing-user opener tone: "Let's build your next Arc. You've already got habits tracked, so we'll use those as raw material. Picture yourself a few weeks from now…"`
    : isEditMode !== true
      ? `New-user opener tone: "Let's build your first Arc. Picture yourself a few weeks from now…"`
      : `Edit mode: they already have an Arc — ask what they want to change.`}

WHEN THEY ASK FOR EXAMPLES ("give examples", "show examples", similar):
- Reply with 3–5 short, concrete sample answers in plain language (bullet-style lines are fine).
- Vision examples: eating breakfast most days + fewer pouches; training 3x/week + sleeping better; saving for a trip; building a side business without burning out after work.
- Why examples: health, money, confidence, family, performance at work.
- Minimum examples: one proof habit logged; 10-minute walk; one meal; one limit still respected.
- Keep it practical — not profound, not therapy.

CONVERSATION RULES (most important):
- Max ${maxAssistantTurns} assistant questions total across the whole chat. Already used: ${priorAssistantTurns}.
- Ask ONE question at a time. Build on their last answer. Never stack questions.
- Keep every conversational message under 60 words.
- Direct, grounded, warm. Like a sharp friend. No filler, no "great choice".
- NEVER use: "warrior", "elite", "alpha", "future you", "stay strong king/queen", "journey", or any wellness-guru phrasing.
- Do NOT re-ask anything already in ARC CONTEXT above. Build forward.
${isEditMode === true ? `- When editing: if identity changes materially, refresh title in the draft. If they ask for a name/title, offer 3 short options in prose OR use their custom title in the draft JSON.
- DURATION (edit mode only): Arc length cannot be changed after the Arc has started. If they ask to make it 1 month, 4 weeks, 8 weeks, shorter, longer, etc., say clearly that duration is locked for this Arc — they can still edit title, identity, why, old pattern, minimum proof, and proof actions. Do NOT promise a duration change. Omit durationDays from the draft JSON when editing (the app ignores it on save).
` : ""}${existingUserRules}${finishRules}

WHEN YOU HAVE ENOUGH (or hit the limit) — EMIT THE DRAFT.
End your reply with a structured block on its own lines, EXACTLY in this format:

<arc_draft>
{"title":"…","identity":"…","why":"…","oldPattern":"…","minimumProof":"…","durationDays":28,"proofActions":["…","…","…"]}
</arc_draft>

Rules for the draft JSON:
- Valid JSON only inside the tags. Single line. No comments, no trailing commas, no markdown.
- title: 1–3 words. Natural and branded. "Arc" optional. NEVER warrior/alpha/elite/beast/grindset. NEVER a full sentence or "Someone who…". If they ask to rename, use their exact short title or suggest 3 options in prose before the draft.
- identity: concrete, one sentence, max ~140 chars. Borrow their phrasing.
- why, oldPattern, minimumProof: short sentences in their voice. Empty string "" is allowed only if you truly have nothing.
- durationDays: one of 14, 28, 56, 84 — pick what fits the goal (see duration guidance above).
- proofActions: 3 to 5 short habit names, max ~30 chars each. ${showExistingHabitsBlock ? "Use EXACT names from EXISTING HABITS when reusing — do not paraphrase into a duplicate label." : "Prefer habits the user mentioned."} When it makes sense, the first one should be the habit they already picked (${habitName || "their picked habit"}).

WHEN YOU EMIT THE DRAFT, write 1–2 short sentences BEFORE the block to introduce it. Examples:
"Alright, I've got enough to build your first Arc. Here's the draft — tweak anything that feels off."
"That's what I needed. Here's your Arc — adjust it before you start."

After the draft, the app shows a "Use this Arc" button. Do NOT tell them to type anything more.

${isOpener
  ? `THIS IS YOUR OPENING MESSAGE. Welcome ${name || "them"} by name. ${arcCtx.identity ? `Reference what they already wrote ("${arcCtx.identity}") and ask one sharp follow-up — still frame it as eight weeks from now / what feels different, not "who are you becoming?"` : `Use the FIRST QUESTION FRAMING above. ONE question only. Not "what are your goals?"`} Do NOT emit a draft on the opener unless ALL fields are already obvious from ARC CONTEXT.`
  : `Respond to what they just said. If they asked for examples, give examples (see above). If you have enough, emit the draft. Otherwise ask the single next most useful question.`}`;

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
      // Plain question replies are ~50-100 tokens; the higher cap only costs
      // more on the turn that actually emits the draft / options JSON.
      max_tokens: multiOptions === true ? 1100 : 500,
      system: multiOptions === true ? optionsSystem : system,
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
