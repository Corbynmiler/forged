// ─── COMPANION SCREEN — the new home ─────────────────────────────────────────
// This is not a chat screen with a mic bolted on. The default surface is a
// living greeting, a breathing presence (the "ember"), and a floating
// carousel of the current exchange — never a scrolling wall of chat bubbles.
// Reuses the coach's tuned personality/prompt logic (exported from
// ../coach/AICoach.jsx) rather than forking it — this screen owns its own
// presentation and streaming loop, not the personality itself.
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { T, FREE_DAILY_LIMIT, COACH_VOICE_OPTIONS } from "../theme.js";
import {
  detectsArcEditIntent,
  formatCoachChatDisplay,
} from "../arcProofMatch.js";
import { supabase, rowToHabit, rowToGoal } from "../supabase.js";
import { todayStr, splitCoachReceipt, stripPartialGoalPlan } from "../utils.js";
import { useCoachTts } from "../hooks/useCoachTts.jsx";
import {
  useSpeechInput, mergeDictationIntoText, polishInterimDisplay,
  speechUnsupportedHelpMessage,
} from "../hooks/useSpeechInput.jsx";
import {
  buildCoachSystemPrompts,
  loadCoachDayMessages,
  saveCoachDayMessages,
  syncCoachMsgCountFromStorage,
  bumpCoachMsgCountInStorage,
  applyCoachRemainingFromServer,
  COACH_API_MESSAGE_CAP,
  CoachFormattedBubble,
  CapturedLine,
  CaptureSavingLine,
} from "../coach/AICoach.jsx";

// ── PREVIEW BRANCH — memory architecture, Phase 2a ─────────────────────────
// Fail-soft, best-effort persistence of each turn to `conversation_messages`
// (staged, not yet applied — see supabase/pending_migrations/). This is the
// raw ground-truth layer the nightly rollover job will eventually read from
// instead of only curated notes/habit logs — the real fix for "judge from
// context, not checklists." Deliberately NOT awaited at the call site: this
// must never add latency to sending/receiving a message, and a missing
// table (before the migration is applied) must never surface as a user-
// visible error — same fail-soft pattern as every other new write on this
// branch. RLS already permits a client-side insert where
// auth.uid() = user_id (mirrors the existing memory_facts client insert),
// so no dedicated server route is needed for this.
async function persistConversationMessage(userId, day, role, content, situationId) {
  const trimmed = String(content || "").trim();
  if (!userId || !trimmed) return;
  try {
    await supabase.from("conversation_messages").insert({
      user_id: userId,
      day,
      role,
      content: trimmed.slice(0, 8000),
      situation: situationId || null,
    });
  } catch (e) {
    // Expected until the migration is applied — never let this affect the
    // actual conversation.
    console.warn("[companion] conversation_messages insert failed (migration likely not applied yet):", e);
  }
}

// ── Applies to every situation, always — the base personality (tuned in
// AICoach.jsx) tends to close turns with a follow-up question. This screen's
// bar is "would Corbyn use this instead of ChatGPT for thinking out loud,"
// which means the reply needs the same range: observations, analysis,
// explanations, stories, connections to what it remembers — not a reflex
// question every turn. ──
const RESPONSE_STYLE_STEER = "RESPONSE STYLE: Match the range of a sharp, well-read conversational partner, not a coaching app's follow-up loop. THIS IS A HARD CONSTRAINT, NOT A SOFT PREFERENCE: do not end your reply with a question by default. Before you add a question, ask yourself whether you actually need the answer to help — if you're not sure, don't ask it. Lead with a real observation, an honest take, an explanation, a relevant story or analogy, or a connection to something you remember about them. Vary the shape and length of your replies to match the weight of what they said — a throwaway comment gets a throwaway reply, a real problem gets real thought.\n\nDO NOT REFLEXIVELY REDIRECT TO THE ARC, PROOF ACTIONS, HABITS, STREAKS, OR TRACKED GOALS. You are a capable, versatile AI companion first — not a compliance monitor whose job is to steer every conversation back to tracked progress. Only bring up the Arc/habits/goals when they're genuinely relevant to what's actually being discussed, never as a reflex or because it feels like your role. If asked for a joke, tell an actual joke — not a joke about their goals or proof actions. If asked something with nothing to do with their tracked progress, just engage with it directly and fully, the way any capable AI assistant would — humor, tangents, whatever the user actually wants, all fully in bounds. Saying something is \"not your lane\" or otherwise declining to just engage is exactly the failure mode to avoid.";

// ── Situations — designed around how the user actually reaches for AI, not
// generic coaching postures. Each one asks for a genuinely different
// response shape (length, structure, stance) on top of the shared
// RESPONSE_STYLE_STEER baseline above, not just a different tone. Steering
// text is appended to the cached system_stable block; retrieval, memory, and
// XP stay identical across situations. ──
const SITUATIONS = [
  {
    id: "chat", label: "Just chat", desc: "Casual, mate-to-mate — relaxed, still useful.",
    steer: "This is casual, mate-to-mate conversation — relaxed, no agenda, but still genuinely useful, not just filler. This is the most open of every mode here: talk about absolutely anything the user brings up, on its own terms, exactly like a good general-purpose AI assistant would — jokes, random questions, whatever's actually on their mind. Do NOT redirect to the Arc, proof actions, habits, or tracked goals unless the user explicitly brings those up first — that instinct is switched off in this mode specifically. If they ask for a joke, just tell one. React like a sharp, well-read friend would: give an honest take, notice what's actually interesting, connect it to something you know about their life when it's genuinely relevant — not as a reflex. A question is fine sometimes, but it is never the default move — most turns should end on a thought, not a question mark.",
  },
  {
    id: "build", label: "Build", desc: "Founder mode — direct, opinionated, action-focused.",
    steer: "Founder/product/execution mode — this covers real things they're actually building and running (Forged, CloseCraft, sales, websites, product and business decisions), not hypotheticals. Talk like a co-founder mid-build, not a coach: direct, opinionated, and action-focused. Assume competence, skip preamble, skip encouragement. Say exactly what you'd actually do next and why — take a real position, don't hedge into a menu of options. Do not ask a clarifying question unless the next action is genuinely impossible to name without one.",
  },
  {
    id: "think", label: "Think", desc: "Long-form, deep, connects ideas and patterns.",
    steer: "Long-form thinking mode — this is important: responses here should be deeper, longer, and more thoughtful, closer to a considered long-form answer than a quick chat reply. A short reply in this mode is a failure UNLESS they explicitly ask for something short. Connect ideas, context, memory, patterns, and possible futures — draw on what you remember about them, use a story or analogy if one genuinely fits, zoom out to the bigger picture. Never end on a question here — end on a thought, a synthesis, or a real direction worth considering.",
  },
  {
    id: "decide", label: "Decide", desc: "Real recommendations, tradeoffs, no fence-sitting.",
    steer: "Decision mode: help them choose. Give a real recommendation — state plainly what you'd actually do — and explain the tradeoffs that led you there, not instead of giving one. Name the strongest argument against the option they seem to want. Do not sit on the fence and do not hand the decision back to them with a question — that's the one failure mode of this specific mode.",
  },
  {
    id: "reflect", label: "Reflect", desc: "Journal mode — what mattered, what changed.",
    steer: "Journal/memory mode. Pull out what actually mattered, what's changed, the emotional tone underneath it, and any pattern worth noticing — and say plainly what's actually worth remembering going forward. Look back across what you remember (recent days, recurring themes, things they keep circling back to). This is about noticing a pattern they haven't said out loud themselves, which is worth more here than asking how they're feeling.",
  },
  {
    id: "ramble", label: "Ramble", desc: "Long-form — real length when it's earned, no agenda.",
    steer: "Long-form companion mode. When what they're actually asking for calls for it — they've asked for the long version, asked something genuinely big or open-ended, or clearly just want to talk something through at real length — give a real long-form reply: several hundred words, ChatGPT-caliber, not a summary. Humor where it actually lands, not forced. Weave in what you actually remember about their life where it's genuinely relevant, the way a real companion who's been paying attention would — never as a checklist of callbacks. Real tangents and connections are welcome. This is NOT an instruction to always max out length — a quick check-in or a simple question in this mode still gets a right-sized reply; match the actual weight of what they're asking, same as a real person sizing their answer to the moment. Same as Just Chat: never redirect to the Arc, proof actions, habits, or tracked goals unless they bring it up themselves.",
  },
];

const STREAM_ID = "__companion_stream__";

// Casual, not formal — "Morning." reads like a text from a friend;
// "Good morning." reads like a formal card. Matches the tone the rest of
// this greeting is now written in.
function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

// Older daily_summaries rows (written before the rollover prompt produced a
// ready `narrative` sentence) only have `wins` — an array of short phrases.
// Reads as a flowing sentence instead of a bulleted list: "Yesterday you
// finished the Companion redesign, played poker, and postponed the Azir
// meeting." rather than three separate bullet lines.
function joinWinsAsSentence(wins) {
  const clean = wins.map(w => String(w || "").replace(/[.!]+\s*$/, "").trim()).filter(Boolean);
  if (!clean.length) return "";
  // Only the first clause keeps its original capitalization — the rest read
  // as a mid-sentence continuation.
  const parts = clean.map((s, i) => (i === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1)));
  if (parts.length === 1) return `${parts[0]}.`;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}.`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;
}

/**
 * Composes the living homepage greeting from real, already-extracted data —
 * no new LLM call. Prefers `structured.narrative` (a ready 1-2 sentence
 * recap written by the rollover prompt specifically for this greeting) —
 * falls back to reading older rows' `wins` array as a flowing sentence, then
 * to `title`/`summary`. Never a checklist — this should read like a friend
 * naming what happened, not a report. If nothing usable exists yet, falls
 * back to a plain opener.
 */
function composeGreeting(recentSummaries) {
  const hi = timeOfDayGreeting();
  const list = Array.isArray(recentSummaries) ? recentSummaries : [];
  const last = list[list.length - 1]; // oldest-first — last entry is most recent
  const closer = "What's on your mind?";

  const narrative = (last?.structured?.narrative || "").trim();
  if (narrative) return { text: `${hi}. ${narrative}`, closer };

  const wins = Array.isArray(last?.structured?.wins) ? last.structured.wins.filter(w => typeof w === "string" && w.trim()) : [];
  if (wins.length) return { text: `${hi}. Yesterday you ${joinWinsAsSentence(wins)}`, closer };

  const title = (last?.title || "").trim();
  const summary = (last?.summary || "").trim();
  if (title || summary) return { text: `${hi}. ${title ? `Yesterday: ${title}.` : summary}`, closer };

  return { text: `${hi}.`, closer };
}

/** Most recent day's title, for the quiet status line above the greeting. */
function latestDayTitle(recentSummaries) {
  const list = Array.isArray(recentSummaries) ? recentSummaries : [];
  const last = list[list.length - 1];
  return (last?.title || "").trim() || null;
}

/**
 * Most recent day that got an AI-judged XP reason, for the "Companion's
 * read" line — completely separate from the real, live `profiles.xp` (which
 * only ever updates via the deterministic per-habit-tap system). This reads
 * `daily_summaries.xp_awarded`/`xp_reason`, written nightly by
 * api/memory-rollover.js from real conversation + logs, never wired into the
 * real XP total. Purely observational — a way to see the companion's own
 * read on a day without it ever affecting the real Arc/XP system.
 */
function latestXpRead(recentSummaries) {
  const list = Array.isArray(recentSummaries) ? recentSummaries : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    const reason = typeof s?.xp_reason === "string" ? s.xp_reason.trim() : "";
    if (reason) return { reason, xp: Number.isFinite(s.xp_awarded) ? s.xp_awarded : null };
  }
  return null;
}

// ── The Ember — the companion's presence. Not a mic icon: a calm, living
// glow that reacts to what's actually happening. Tapping it toggles the mic
// (press to talk, press to stop — stopping sends). Deliberately restrained
// rather than "busy": a clean circular core (no distortion — a warped shape
// reads as an accident, not intentional), a soft ambient bloom that breathes,
// and a couple of quiet sonar-style rings that only appear while listening
// or speaking. Palette is a calm mid-blue (soft sky-blue highlight cooling to
// a muted steel-blue edge — deliberately not cyan/electric, not navy-dark,
// not the lavender "Moonstone" tried previously) landing between ChatGPT
// voice mode's blue and Apple Intelligence's blue. At idle the core and
// bloom are both deliberately dimmed (opacity only, no size/shape change) so
// the presence recedes toward the background instead of sitting there lit up
// with nothing happening — it should read as "quietly there," not "on."
// States are visually distinct:
//  - idle: dim, receded, slow breathing — waiting. A couple of faint sparks drift up.
//  - listening: full brightness, tighter breathing + expanding rings; real mic
//    amplitude layers on top where the browser provides it (desktop).
//  - thinking: full brightness, steady glow with a soft light sweep crossing
//    the core — processing, not waiting or reacting.
//  - speaking: full brightness, rings + a core that scales with the AI's own
//    voice where Web Audio access succeeds, otherwise a steady rhythmic pulse.
const EMBER_SPARKS = [
  { left: "28%", delay: "0s",   dur: "3.6s" },
  { left: "58%", delay: "1.3s", dur: "4.1s" },
  { left: "42%", delay: "2.4s", dur: "3.8s" },
];

function Ember({ state, onTap, ringRef, coreRef, label }) {
  const showSparks = state === "idle" || state === "listening";
  const showRings = state === "listening" || state === "speaking";
  const isIdle = state === "idle";
  const auraAnim =
    state === "idle" ? "emberBreatheDormant 5s ease-in-out infinite"
    : state === "listening" ? "emberBreatheActive 1.4s ease-in-out infinite"
    : state === "thinking" ? "emberBreatheActive 2.6s ease-in-out infinite"
    : "emberBreatheActive 0.6s ease-in-out infinite";

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={label}
      style={{
        position: "relative", width: 176, height: 196,
        border: "none", background: "none", cursor: "pointer", padding: 0,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        WebkitTapHighlightColor: "transparent", flexShrink: 0,
      }}
    >
      {showSparks ? EMBER_SPARKS.map((s, i) => (
        <div key={i} aria-hidden style={{
          position: "absolute", left: s.left, bottom: "60%", width: 3, height: 3, borderRadius: "50%",
          background: "radial-gradient(circle, #EAF2FE 0%, #7FAEEA 60%, transparent 100%)",
          animation: `emberSpark ${s.dur} ease-in infinite`, animationDelay: s.delay, opacity: 0,
        }} />
      )) : null}

      <div style={{ position: "relative", width: 164, height: 164, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* quiet sonar rings — listening/speaking only, kept out of idle/thinking so those stay calm */}
        {showRings ? [0, 1].map(i => (
          <div key={i} aria-hidden style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            border: `1px solid rgba(127,174,234,${state === "speaking" ? 0.26 : 0.30})`,
            animation: "emberRingPulse 2.2s ease-out infinite",
            animationDelay: `${i * 1.1}s`,
          }} />
        )) : null}

        {/* ambient bloom — breathes/reacts via direct style writes (ringRef), no shape distortion.
            Lower alpha than earlier palettes on purpose — "less glow, more premium." */}
        <div
          ref={ringRef}
          aria-hidden
          data-ember-state={state}
          style={{
            position: "absolute", inset: -4, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(127,174,234,0.28) 0%, rgba(76,130,201,0.10) 45%, transparent 72%)",
            filter: "blur(13px)",
            animation: auraAnim,
            opacity: isIdle ? 0.55 : 1,
            transition: "opacity 0.7s ease",
          }}
        />

        {/* core — a clean, deliberate circle: soft sky-blue highlight cooling to a muted steel-blue
            edge, not navy/black. Dimmed (opacity only, never resized) at idle so it recedes into the
            interface until the companion is actually listening/thinking/speaking. */}
        <div
          ref={coreRef}
          aria-hidden
          style={{
            position: "absolute", width: "56%", height: "56%", borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #FFFFFF 0%, #EAF2FE 10%, #BBD6F7 28%, #7FAEEA 50%, #4C82C9 72%, #2E4F72 100%)",
            boxShadow: "0 0 18px rgba(127,174,234,0.32), 0 0 40px rgba(76,130,201,0.14)",
            opacity: isIdle ? 0.5 : 1,
            transition: "opacity 0.7s ease",
          }}
        />

        {/* thinking — a soft light sweep crossing the core, not a color/hue flicker */}
        {state === "thinking" ? (
          <div aria-hidden style={{ position: "absolute", width: "56%", height: "56%", borderRadius: "50%", overflow: "hidden" }}>
            <div style={{
              position: "absolute", inset: "-40%", mixBlendMode: "screen",
              background: "conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.4) 10%, transparent 22%)",
              animation: "emberSweep 1.5s linear infinite",
            }} />
          </div>
        ) : null}
      </div>

      {state === "listening" ? (
        <span aria-hidden style={{ position: "absolute", bottom: "32%", right: "26%", width: 7, height: 7, borderRadius: "50%", background: "#E74C3C", boxShadow: "0 0 7px #E74C3C" }} />
      ) : null}
    </button>
  );
}

export function CompanionScreen({
  habits, goals, user, isPro, activeBlock, coachName, coachIcon,
  journalEntries = [], coachMemory = null, voiceRepliesEnabled = false, coachVoiceId = null,
  onNavigateTo, onHabitCreated, onGoalCreated, onCoachLogsApplied, onHabitRenamed,
  onJournalLogged, onOpenEditArc, onUpgrade, previewNormalCoachGreeting = false,
  onOpenProgress, onSaveVoicePrefs, initialDraft = null, onDraftConsumed,
}) {
  const cName = coachName || "Companion";
  const greeting = composeGreeting(coachMemory?.recentSummaries);
  const dayTitle = latestDayTitle(coachMemory?.recentSummaries);
  const xpRead = latestXpRead(coachMemory?.recentSummaries);

  const [situation, setSituation] = useState(SITUATIONS[0].id);
  const [showSituations, setShowSituations] = useState(false);
  // Briefly surfaces the picked mode's one-line description right after
  // selection, so switching modes is felt immediately — not just something
  // that quietly changes what the next reply happens to look like.
  const [modeHintVisible, setModeHintVisible] = useState(false);
  const modeHintTimerRef = useRef(null);
  function pickSituation(id) {
    setSituation(id);
    setShowSituations(false);
    setShowVoices(false); // only one top-corner dropdown open at a time
    setModeHintVisible(true);
    window.clearTimeout(modeHintTimerRef.current);
    modeHintTimerRef.current = window.setTimeout(() => setModeHintVisible(false), 3200);
  }
  useEffect(() => () => window.clearTimeout(modeHintTimerRef.current), []);
  const [showTextInput, setShowTextInput] = useState(false);

  // ── Voice pill (top-left, mirrors the situation pill on the right) ─────
  // Split-button: tapping the pill body is an instant mute/unmute (the
  // common, fast action); the chevron opens a picker where selecting any
  // voice both sets it AND turns spoken replies on, in one action.
  const [showVoices, setShowVoices] = useState(false);

  const [messages, setMessages] = useState(() => (user?.id ? loadCoachDayMessages(user.id) || [] : []));
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const coachPersistDayRef = useRef(todayStr());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Other screens (Today/Hub nudges — "log your first habit", "lower this
  // budget?", "add a proof action") used to open the old modal coach drawer
  // with a pre-filled draft. That drawer is retired — this is the equivalent
  // entry point now: the parent sets initialDraft + navigates here, this
  // drops it straight into the input for the user to review/edit and send
  // themselves (deliberately not auto-sent — this can be an Arc-mutating
  // message, worth a beat to look at first).
  useEffect(() => {
    if (!initialDraft) return;
    setInput(initialDraft);
    setShowTextInput(true);
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);
  const [captureSaving, setCaptureSaving] = useState(false);
  const [error, setError] = useState(null);
  const streamActiveRef = useRef(false);
  const lastStreamTextAtRef = useRef(0);
  const [freeMsgsToday, setFreeMsgsToday] = useState(0);
  const carouselScrollRef = useRef(null);
  const textareaRef = useRef(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const coachTts = useCoachTts({ enabled: voiceRepliesEnabled === true, isPro, voiceId: coachVoiceId });
  const speech = useSpeechInput(t => setInput(p => mergeDictationIntoText(p, t)), { autoRestart: true, meter: true });

  function toggleVoiceMute() {
    if (!onSaveVoicePrefs) return;
    if (voiceRepliesEnabled) coachTts.stopSpeaking?.(); // muting mid-reply cuts audio immediately, not just future replies
    onSaveVoicePrefs({ voiceRepliesEnabled: !voiceRepliesEnabled, coachVoiceId });
  }
  function pickVoice(id) {
    if (!onSaveVoicePrefs) return;
    onSaveVoicePrefs({ voiceRepliesEnabled: true, coachVoiceId: id });
    setShowVoices(false);
  }

  // ── Ember state machine ────────────────────────────────────────────────
  const emberRingRef = useRef(null);
  const emberCoreRef = useRef(null);
  const emberState = speech.listening ? "listening" : coachTts.speaking ? "speaking" : loading ? "thinking" : "idle";
  // Give the volume-meter ref (real mic amplitude, where the browser
  // provides it) the same node the CSS breathing/listening animation lives
  // on — bonus reactivity layers on top of the CSS rhythm rather than
  // replacing it. Harmless no-op on platforms without a live meter.
  useEffect(() => { speech.setRingEl?.(emberRingRef.current); }, [speech]);

  // ── Speaking-state audio reactivity (best-effort, fails open) ──────────
  // Reads frequency data straight off useCoachTts's own analyser node (it
  // owns the AudioContext that actually plays the reply) so the ember's core
  // scales with the AI's own voice. Never allowed to affect playback itself
  // — any failure here just leaves the CSS pulse running.
  const audioRafRef = useRef(null);

  useEffect(() => {
    if (!coachTts.speaking) {
      if (audioRafRef.current) { cancelAnimationFrame(audioRafRef.current); audioRafRef.current = null; }
      if (emberCoreRef.current) emberCoreRef.current.style.transform = "";
      return;
    }
    const analyser = coachTts.analyserRef?.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      const v = Math.min(1, avg / 90);
      if (emberCoreRef.current) emberCoreRef.current.style.transform = `scale(${1 + v * 0.22})`;
      audioRafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => { if (audioRafRef.current) cancelAnimationFrame(audioRafRef.current); };
  }, [coachTts.speaking, coachTts.analyserRef]);

  // Hydrate/roll today's thread — identical key scheme to the legacy coach
  // drawer, so both surfaces read the same day's conversation.
  useLayoutEffect(() => {
    if (!user?.id) { setMessages([]); return; }
    const day = todayStr();
    coachPersistDayRef.current = day;
    setMessages(loadCoachDayMessages(user.id) || []);
  }, [user?.id]);

  useEffect(() => {
    function rollIfMidnight() {
      const d = todayStr();
      if (d !== coachPersistDayRef.current) { coachPersistDayRef.current = d; setMessages([]); }
    }
    const id = setInterval(rollIfMidnight, 45000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const day = todayStr();
    if (day !== coachPersistDayRef.current) return;
    const t = setTimeout(() => saveCoachDayMessages(user.id, day, messages), 320);
    return () => clearTimeout(t);
  }, [messages, user?.id]);

  useEffect(() => {
    if (isPro) return;
    setFreeMsgsToday(syncCoachMsgCountFromStorage());
  }, [isPro]);

  // Drives the quiet "Saving what mattered…" line: true once the streamed
  // reply text has gone idle for a beat but tool calls (habit logs, notes)
  // are still finishing server-side. Mirrors AICoach.jsx's identical effect.
  useEffect(() => {
    if (!streamActiveRef.current) { setCaptureSaving(false); return; }
    const tick = () => {
      if (!streamActiveRef.current) { setCaptureSaving(false); return; }
      const streamMsg = messagesRef.current.find(m => m.id === STREAM_ID);
      const hasText = String(streamMsg?.content || "").trim().length > 0;
      const idleMs = Date.now() - lastStreamTextAtRef.current;
      setCaptureSaving(hasText && lastStreamTextAtRef.current > 0 && idleMs > 500);
    };
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [messages]);

  const atFreeCap = !isPro && freeMsgsToday >= FREE_DAILY_LIMIT;

  async function send(rawText) {
    const trimmed = (rawText ?? "").trim();
    if (!trimmed || loading) return;

    if (activeBlock?.id && onOpenEditArc && detectsArcEditIntent(trimmed)) {
      speech.cancel?.();
      const sendDay = todayStr();
      let base = messages;
      if (sendDay !== coachPersistDayRef.current) { coachPersistDayRef.current = sendDay; base = []; }
      const userMsg = { role: "user", content: trimmed, ts: Date.now() };
      const withReply = [...base, userMsg, { role: "assistant", content: "Yep — I'll open your Arc editor for that.", ts: Date.now() }];
      setMessages(withReply);
      if (user?.id) saveCoachDayMessages(user.id, sendDay, withReply);
      setInput("");
      window.setTimeout(() => onOpenEditArc(), 400);
      return;
    }

    speech.cancel?.();
    if (!isPro) {
      const c = syncCoachMsgCountFromStorage();
      setFreeMsgsToday(c);
      if (c >= FREE_DAILY_LIMIT) return;
    }
    let countedThisSend = false;
    const bumpAfterSuccess = (remaining) => {
      if (isPro || countedThisSend) return;
      countedThisSend = true;
      const used = applyCoachRemainingFromServer(remaining);
      setFreeMsgsToday(used != null ? used : bumpCoachMsgCountInStorage());
    };

    coachTts.primeAudio?.();
    setError(null);
    const sendDay = todayStr();
    let base = messages;
    if (sendDay !== coachPersistDayRef.current) { coachPersistDayRef.current = sendDay; base = []; }
    const userMsg = { role: "user", content: trimmed, ts: Date.now() };
    const next = [...base, userMsg];
    setMessages(next);
    if (user?.id) saveCoachDayMessages(user.id, sendDay, next);
    if (user?.id) void persistConversationMessage(user.id, sendDay, "user", trimmed, situation);
    setInput("");
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const prompts = buildCoachSystemPrompts(user, habits, cName, "companion", goals, journalEntries, activeBlock, coachMemory);
      const situationDef = SITUATIONS.find(s => s.id === situation);
      const steerText = [RESPONSE_STYLE_STEER, situationDef?.steer].filter(Boolean).join("\n\n");
      const stableWithSituation = steerText
        ? `${prompts.stable}\n\n─── CURRENT SITUATION (user-selected lens) ───\n${steerText}`
        : prompts.stable;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          system_stable: stableWithSituation,
          system_volatile: prompts.volatile,
          messages: next.map(m => ({ role: m.role, content: m.content })).slice(-COACH_API_MESSAGE_CAP),
          client_date: todayStr(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429 && !isPro) {
          const used = applyCoachRemainingFromServer(typeof data.remaining === "number" ? data.remaining : 0);
          setFreeMsgsToday(used != null ? used : FREE_DAILY_LIMIT);
          setLoading(false);
          return;
        }
        throw new Error(data?.error || "Something went wrong");
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const streamTs = Date.now();
        setMessages(prev => [...prev, { role: "assistant", content: "", id: STREAM_ID, ts: streamTs }]);
        setLoading(false);
        streamActiveRef.current = true;
        lastStreamTextAtRef.current = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.text) {
                fullText += evt.text;
                const snap = fullText;
                lastStreamTextAtRef.current = Date.now();
                setCaptureSaving(false);
                setMessages(prev => prev.map(m => m.id === STREAM_ID ? { ...m, content: snap } : m));
              }
              if (evt.done) {
                streamActiveRef.current = false;
                setCaptureSaving(false);
                if (!evt.error) bumpAfterSuccess(evt.remaining);
                const capturedItems = Array.isArray(evt.captured) ? evt.captured : [];
                const finalContent = fullText.trim();
                const doneDay = todayStr();
                coachPersistDayRef.current = doneDay;
                const finalizedId = `companion_msg_${streamTs}`;
                setMessages(prev => {
                  const nextMsgs = prev.map(m => m.id === STREAM_ID ? {
                    role: "assistant", content: finalContent || fullText, ts: m.ts ?? Date.now(),
                    id: finalizedId, ...(capturedItems.length ? { captured: capturedItems } : {}),
                  } : m);
                  if (user?.id) saveCoachDayMessages(user.id, doneDay, nextMsgs);
                  return nextMsgs;
                });
                if (user?.id) void persistConversationMessage(user.id, doneDay, "assistant", finalContent, situation);

                if (voiceRepliesEnabled && isPro && finalContent) coachTts.speak(finalContent);

                if (evt.created) {
                  const rows = Array.isArray(evt.created) ? evt.created : [evt.created];
                  rows.forEach(row => {
                    if (!row) return;
                    if (row.habit_type === "goal") onGoalCreated?.(rowToGoal(row));
                    else onHabitCreated?.(rowToHabit(row));
                  });
                }
                if (evt.edited?.length) {
                  evt.edited.forEach(edit => {
                    const row = edit.updatedRow;
                    if (!row) return;
                    if (row.habit_type === "goal") onGoalCreated?.(rowToGoal(row));
                    else onHabitCreated?.(rowToHabit(row));
                  });
                }
                if (evt.logged?.length) onCoachLogsApplied?.(evt.logged);
                if (evt.noted?.length) onJournalLogged?.(evt.noted);
                if (evt.error) setError(evt.error);
              }
            } catch { /* malformed SSE line — skip */ }
          }
        }
      } else {
        const data = await res.json();
        setLoading(false);
        setMessages(prev => [...prev, { role: "assistant", content: data.reply || "", ts: Date.now() }]);
        if (user?.id && data.reply) void persistConversationMessage(user.id, sendDay, "assistant", data.reply, situation);
      }
    } catch (e) {
      streamActiveRef.current = false;
      setCaptureSaving(false);
      setLoading(false);
      setMessages(base);
      if (user?.id) saveCoachDayMessages(user.id, sendDay, base);
      setInput(trimmed);
      setError(e?.retryable === false ? (e.message || "Something went wrong") : "Something went wrong — try again");
    } finally {
      streamActiveRef.current = false;
    }
  }

  function handleEmberTap() {
    // Prime the TTS AudioContext synchronously inside this real tap gesture
    // — the best chance it has of actually unlocking on browsers (notably
    // iOS Safari) that require audio-context-resume to happen within a
    // genuine user-initiated event, not several async hops later once a
    // reply has actually finished streaming.
    coachTts.primeAudio?.();
    if (!speech.supported) { alert(speechUnsupportedHelpMessage()); return; }
    if (speech.listening) {
      // Stopping IS the send trigger — no separate confirm step. Read the
      // ref, not a closed-over `input`, so the trailing segment stopAll()
      // flushes via an async functional setState is actually included.
      speech.toggle();
      window.setTimeout(() => {
        const text = inputRef.current.trim();
        if (text) send(text);
      }, 60);
      return;
    }
    speech.toggle();
  }

  // ── Conversation carousel — floating text, not bubbles. Only ever a
  // couple of exchanges tall (fixed max height + top mask-fade); anything
  // older is reached by scrolling inside that fixed region, never by the
  // page growing. The user's own line stays visible the whole time they're
  // talking (accumulated dictation + interim), so a mid-sentence pause never
  // makes it disappear — and it stays visible once the AI starts thinking,
  // instead of being replaced by a "thinking" state.
  const streamingMsg = messages.find(m => m.id === STREAM_ID);
  const liveDictationText = speech.listening
    ? polishInterimDisplay(`${input} ${speech.interim || ""}`.trim())
    : "";
  const showConversation = messages.length > 0 || speech.listening || (loading && !streamingMsg);
  let carouselItems = messages;
  if (speech.listening) {
    carouselItems = [...messages, { id: "__live_dictation__", role: "user", content: liveDictationText, pending: true }];
  } else if (loading && !streamingMsg) {
    carouselItems = [...messages, { id: "__thinking__", role: "assistant", content: "", pending: true }];
  }

  // Keep the carousel scrolled to the newest line as the conversation grows —
  // scrolls only the fixed-height region itself, never the page.
  useEffect(() => {
    const el = carouselScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, liveDictationText, showConversation]);

  return (
    <div style={{ position: "relative", minHeight: "100dvh", display: "flex", flexDirection: "column", paddingTop: "calc(env(safe-area-inset-top, 0px) + 28px)", paddingBottom: 8 }}>
      <style>{`
        @keyframes emberBreatheDormant {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50%      { transform: scale(1.03); opacity: 0.6; }
        }
        @keyframes emberBreatheActive {
          0%, 100% { transform: scale(1.02); opacity: 0.86; }
          50%      { transform: scale(1.16); opacity: 1; }
        }
        @keyframes emberRingPulse {
          0%   { transform: scale(0.92); opacity: 0.5; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes emberSweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes emberSpark {
          0%   { transform: translate(0, 0) scale(1); opacity: 0; }
          18%  { opacity: 0.75; }
          100% { transform: translate(4px, -70px) scale(0.35); opacity: 0; }
        }
        @keyframes companionDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%           { transform: scale(1); opacity: 1; }
        }
        @keyframes companionFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Situation pill — top right, quiet, collapsed by default */}
      <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 4px)", right: 4, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <button type="button" onClick={() => { setShowSituations(o => !o); setShowVoices(false); }}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, border: `0.5px solid ${T.borderStrong}`, background: T.raised, color: T.sub, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
          {SITUATIONS.find(s => s.id === situation)?.label}
          <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
        </button>
        {showSituations ? (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: T.raised, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: 6, minWidth: 210, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
            {SITUATIONS.map(s => (
              <button key={s.id} type="button" onClick={() => pickSituation(s.id)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", background: s.id === situation ? "rgba(200,144,42,0.12)" : "none", cursor: "pointer", fontFamily: T.font }}>
                <div style={{ color: s.id === situation ? T.gold : T.text, fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                <div style={{ color: T.muted, fontSize: 11, marginTop: 1, lineHeight: 1.35 }}>{s.desc}</div>
              </button>
            ))}
          </div>
        ) : !showSituations && modeHintVisible ? (
          <div style={{ animation: "companionFadeIn 0.25s ease", maxWidth: 190, textAlign: "right", background: T.raised, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "6px 10px" }}>
            <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.35 }}>{SITUATIONS.find(s => s.id === situation)?.desc}</div>
          </div>
        ) : null}
      </div>

      {/* Voice pill — top left, mirrors the situation pill. Split button:
          tapping the body instantly mutes/unmutes; the chevron opens a
          picker where choosing a voice both selects it and turns replies on. */}
      {onSaveVoicePrefs ? (
        <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 4px)", left: 4, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          {!isPro ? (
            <button type="button" onClick={onUpgrade}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, border: "0.5px solid rgba(200,144,42,0.45)", background: "rgba(200,144,42,0.10)", color: T.gold, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
              🔒 Voice
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <button type="button" onClick={toggleVoiceMute} aria-label={voiceRepliesEnabled ? "Mute spoken replies" : "Unmute spoken replies"}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: "20px 0 0 20px", border: `0.5px solid ${T.borderStrong}`, borderRight: "none", background: T.raised, color: voiceRepliesEnabled ? T.sub : T.hint, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
                {voiceRepliesEnabled
                  ? `🔊 ${COACH_VOICE_OPTIONS.find(v => v.id === (coachVoiceId || COACH_VOICE_OPTIONS[0].id))?.label || "Voice"}`
                  : "🔇 Muted"}
              </button>
              <button type="button" onClick={() => { setShowVoices(o => !o); setShowSituations(false); }} aria-label="Choose voice"
                style={{ display: "flex", alignItems: "center", padding: "6px 10px", borderRadius: "0 20px 20px 0", border: `0.5px solid ${T.borderStrong}`, background: T.raised, color: T.sub, fontSize: 9, cursor: "pointer", fontFamily: T.font }}>
                ▾
              </button>
            </div>
          )}
          {showVoices ? (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, background: T.raised, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: 6, minWidth: 180, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
              {COACH_VOICE_OPTIONS.map(v => {
                const active = voiceRepliesEnabled && (coachVoiceId || COACH_VOICE_OPTIONS[0].id) === v.id;
                return (
                  <button key={v.id} type="button" onClick={() => pickVoice(v.id)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", background: active ? "rgba(200,144,42,0.12)" : "none", cursor: "pointer", fontFamily: T.font }}>
                    <div style={{ color: active ? T.gold : T.text, fontSize: 13, fontWeight: 600 }}>{v.label}</div>
                    <div style={{ color: T.muted, fontSize: 11, marginTop: 1, lineHeight: 1.35 }}>{v.desc}</div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 24, padding: "0 28px", minHeight: 0 }}>
        {!showConversation ? (
          <div style={{ textAlign: "center", maxWidth: 340 }}>
            {dayTitle ? (
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.hint, marginBottom: 10 }}>
                {dayTitle}
              </div>
            ) : null}
            {/* Deliberately T.font at body size, not T.serif at display size — a
                greeting is something a friend says to you, not a poster headline. */}
            <div style={{ fontFamily: T.font, fontSize: 16.5, fontWeight: 400, color: T.text, lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
              {greeting.text} <span style={{ color: T.sub }}>{greeting.closer}</span>
            </div>
            {xpRead ? (
              <div style={{ marginTop: 14, fontSize: 11.5, color: T.hint, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 9.5 }}>
                  Companion's read (experimental){xpRead.xp != null ? ` · ${xpRead.xp} xp` : ""}
                </span>
                <div style={{ marginTop: 3 }}>{xpRead.reason}</div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ width: "100%", maxWidth: 360 }}>
            <div
              ref={carouselScrollRef}
              style={{
                maxHeight: 230, overflowY: "auto", WebkitOverflowScrolling: "touch",
                display: "flex", flexDirection: "column", gap: 16, padding: "6px 2px",
                maskImage: "linear-gradient(to bottom, transparent 0, black 22px, black 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, transparent 0, black 22px, black 100%)",
              }}
            >
              {carouselItems.map((m, i) => {
                const isUser = m.role === "user";
                const rawVisible = !isUser ? stripPartialGoalPlan(m.content || "") : (m.content || "");
                const { main: coachMainRaw } = !isUser ? splitCoachReceipt(rawVisible) : { main: rawVisible };
                const coachMain = !isUser ? formatCoachChatDisplay(coachMainRaw) : coachMainRaw;
                const isThinking = !isUser && !coachMain.trim();
                return (
                  <div key={m.id || `${m.role}-${i}`} style={{ animation: "companionFadeIn 0.35s ease", textAlign: isUser ? "right" : "left" }}>
                    {isThinking ? (
                      <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", gap: 5 }}>
                        {[0, 1, 2].map(d => (
                          <div key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: T.muted, animation: "companionDot 1.2s ease-in-out infinite", animationDelay: `${d * 0.2}s` }} />
                        ))}
                      </div>
                    ) : isUser ? (
                      <div style={{ fontSize: 14, lineHeight: 1.55, color: m.pending ? T.muted : T.sub, fontStyle: m.pending ? "italic" : "normal" }}>
                        {coachMain || (m.pending ? "Listening…" : "")}
                      </div>
                    ) : (
                      <div style={{ fontSize: 15.5, lineHeight: 1.6, color: T.text }}>
                        <CoachFormattedBubble text={coachMain} isUser={false} />
                      </div>
                    )}
                    {!isUser && m.captured?.length ? (
                      <div style={{ marginTop: 6, display: "inline-block", textAlign: "left" }}>
                        <CapturedLine items={m.captured} onNavigateTo={onNavigateTo} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {captureSaving ? <div style={{ textAlign: "center", marginTop: 8 }}><CaptureSavingLine /></div> : null}
            {error ? <div style={{ textAlign: "center", fontSize: 12, color: T.accent, marginTop: 10 }}>{error}</div> : null}
            {/* Previously swallowed entirely — a misconfigured/unreachable TTS
                backend (e.g. ELEVENLABS_API_KEY unset) failed with no visible
                sign at all beyond "the reply just never gets spoken." */}
            {coachTts.ttsError ? <div style={{ textAlign: "center", fontSize: 12, color: T.accent, marginTop: 10 }}>{coachTts.ttsError}</div> : null}
          </div>
        )}

        {atFreeCap ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, color: T.sub, marginBottom: 8 }}>Daily coach limit reached — resets tomorrow</div>
            <button type="button" onClick={onUpgrade} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: T.gold, fontWeight: 600 }}>
              Go Pro for unlimited coach →
            </button>
          </div>
        ) : (
          <Ember
            state={emberState}
            onTap={handleEmberTap}
            ringRef={emberRingRef}
            coreRef={emberCoreRef}
            label={speech.listening ? "Stop and send" : "Start talking"}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ fontSize: 11.5, color: T.muted, minHeight: 16, textAlign: "center" }}>
            {atFreeCap ? null
              : speech.listening ? "Listening — tap to stop and send"
              : loading ? "Thinking…"
              : coachTts.speaking ? "Speaking…"
              : "Tap to talk"}
          </div>
          {/* Persistent mode reminder — the transient caption near the pill
              (on selection) confirms you just switched; this one means you
              never have to reopen the dropdown mid-conversation just to
              remember what the current mode is actually for. */}
          {!atFreeCap ? (
            <div style={{ fontSize: 10.5, color: T.hint, textAlign: "center" }}>
              {SITUATIONS.find(s => s.id === situation)?.desc}
            </div>
          ) : null}
        </div>
      </div>

      {/* Text fallback + footer links */}
      <div style={{ padding: "0 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {!showTextInput ? (
          <button type="button" onClick={() => { setShowTextInput(true); requestAnimationFrame(() => textareaRef.current?.focus()); }}
            style={{ background: "none", border: "none", color: T.hint, fontSize: 12.5, cursor: "pointer", fontFamily: T.font, padding: "4px 8px" }}>
            type instead
          </button>
        ) : (
          <div style={{ width: "100%", display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px"; }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !atFreeCap) { e.preventDefault(); coachTts.primeAudio?.(); send(input); } }}
              placeholder="Type instead…"
              style={{ flex: 1, background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "10px 14px", fontSize: 16, color: T.text, resize: "none", fontFamily: T.font, lineHeight: 1.5, outline: "none", minHeight: 42, maxHeight: 88 }}
            />
            <button type="button" onClick={() => { coachTts.primeAudio?.(); send(input); }} disabled={!input.trim() || loading || atFreeCap}
              aria-label="Send message"
              style={{ width: 40, height: 40, borderRadius: "50%", border: `0.5px solid ${T.border}`, flexShrink: 0, background: input.trim() && !loading ? T.gold : T.surface, cursor: input.trim() && !loading ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                <path d="M2 9h14M9 2l7 7-7 7" stroke={input.trim() && !loading ? "#1a1a16" : T.hint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        {!isPro && !atFreeCap ? (
          <div style={{ fontSize: 11, color: FREE_DAILY_LIMIT - freeMsgsToday === 1 ? T.gold : T.muted }}>
            {FREE_DAILY_LIMIT - freeMsgsToday} coach message{FREE_DAILY_LIMIT - freeMsgsToday === 1 ? "" : "s"} remaining today
          </div>
        ) : null}

        {onOpenProgress ? (
          <button type="button" onClick={onOpenProgress}
            style={{ background: "none", border: "none", color: T.hint, fontSize: 11.5, cursor: "pointer", fontFamily: T.font, padding: "4px 8px" }}>
            Progress →
          </button>
        ) : null}
      </div>
    </div>
  );
}
