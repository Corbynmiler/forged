// ─── COMPANION SCREEN — the new home ─────────────────────────────────────────
// This is not a chat screen with a mic bolted on. The transcript is not the
// product — it's demoted to a secondary "History" view. The default surface
// is a living greeting, a breathing presence (the "ember" — this app is
// called Forged; shaped by fire), and whatever's being said right now,
// ephemeral. Reuses the coach's tuned personality/prompt logic (exported
// from ../coach/AICoach.jsx) rather than forking it — this screen owns its
// own presentation and streaming loop, not the personality itself.
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { T, FREE_DAILY_LIMIT } from "../theme.js";
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
  formatCoachMsgTime,
} from "../coach/AICoach.jsx";

// ── Situations — purpose-driven lenses over one shared memory. Steering text
// is appended to the cached system_stable block; retrieval, memory, and XP
// stay identical across situations — only tone/behavior changes. ──
const SITUATIONS = [
  { id: "chat",        label: "Just chat",         steer: null },
  { id: "planning",    label: "I'm planning",      steer: "The user has flagged this as a planning conversation. Help them think through the decision: surface the real tradeoffs and criteria, ask a clarifying question before you offer a take, and don't rush to a conclusion." },
  { id: "building",    label: "I'm building",      steer: "The user has flagged this as a building/execution conversation. Be terse and concrete. Help them turn what they say into a specific next action. Track anything they commit to." },
  { id: "stuck",       label: "I'm stuck",         steer: "The user has flagged that they're stuck. Slow down. Don't jump to advice or solutions. Look for a pattern or loop in what they're describing — reference relevant history if you know it — and ask a clarifying question only if it would genuinely help them see the loop." },
  { id: "perspective", label: "I need perspective", steer: "The user has flagged that they want perspective, not fixing. Listen first. Don't rush to advice — offer an outside view only once it feels like they want one, and hold space for them to just talk it through." },
];

const STREAM_ID = "__companion_stream__";

function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good evening";
}

/**
 * Composes the living homepage greeting from real, already-extracted data —
 * no new LLM call. Reads the most recent daily_summaries row's `structured`
 * (wins, written in natural phrasing by the tightened rollover prompt) or
 * falls back to `summary`/`title`. Never shows raw/mechanical backend text —
 * if nothing usable exists yet, falls back to a plain opener.
 */
// Returns { opener, bullets, closer } rather than one flat string — a
// bulleted list reads badly if every line gets center-justified on its own,
// so the caller renders `bullets` as a left-aligned block while `opener`/
// `closer` stay centered.
function composeGreeting(recentSummaries) {
  const hi = timeOfDayGreeting();
  const list = Array.isArray(recentSummaries) ? recentSummaries : [];
  const last = list[list.length - 1]; // oldest-first — last entry is most recent
  const wins = Array.isArray(last?.structured?.wins) ? last.structured.wins.filter(w => typeof w === "string" && w.trim()) : [];
  const closer = "What's on your mind?";
  if (wins.length) {
    return { opener: `${hi}. Yesterday you:`, bullets: wins.slice(0, 4).map(w => w.trim()), closer };
  }
  const title = (last?.title || "").trim();
  const summary = (last?.summary || "").trim();
  if (title || summary) {
    return { opener: `${hi}. ${title ? `Yesterday: ${title}.` : summary}`, bullets: [], closer };
  }
  return { opener: `${hi}.`, bullets: [], closer };
}

/** Most recent day's title, for the quiet status line above the greeting. */
function latestDayTitle(recentSummaries) {
  const list = Array.isArray(recentSummaries) ? recentSummaries : [];
  const last = list[list.length - 1];
  return (last?.title || "").trim() || null;
}

// ── The Ember — the companion's presence. Not a mic icon: a living, breathing
// glow that reacts to what's actually happening. Tapping it toggles the mic
// (press to talk, press to stop — stopping sends). States are visually
// distinct, not just a single pulse animation reused everywhere:
//  - idle: slow, quiet breathing — waiting.
//  - listening: brighter, tighter rhythm; real mic amplitude layers on top
//    where the browser provides it (desktop), CSS-only rhythm elsewhere.
//  - thinking: a shimmer/color-shift, no breathing — processing, not waiting.
//  - speaking: pulses toward the audio output's real amplitude where Web
//    Audio access succeeds, otherwise a steady rhythmic pulse.
// A handful of tiny sparks drifting up off the ember, staggered so they never
// look mechanically synced — this is what tips the read from "glowing orb"
// to "small fire," more than the gradient alone.
const EMBER_SPARKS = [
  { left: "20%", delay: "0s",   dur: "3.2s" },
  { left: "74%", delay: "0.9s", dur: "3.8s" },
  { left: "46%", delay: "1.6s", dur: "3.0s" },
  { left: "82%", delay: "2.3s", dur: "3.5s" },
  { left: "30%", delay: "1.1s", dur: "4.1s" },
];

function Ember({ state, onTap, ringRef, coreRef, label }) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={label}
      style={{
        position: "relative", width: 180, height: 200,
        border: "none", background: "none", cursor: "pointer", padding: 0,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        WebkitTapHighlightColor: "transparent", flexShrink: 0,
      }}
    >
      {EMBER_SPARKS.map((s, i) => (
        <div key={i} aria-hidden style={{
          position: "absolute", left: s.left, bottom: "62%", width: 3, height: 3, borderRadius: "50%",
          background: "radial-gradient(circle, #FFF4D6 0%, #F5C842 60%, transparent 100%)",
          animation: `emberSpark ${s.dur} ease-in infinite`, animationDelay: s.delay, opacity: 0,
        }} />
      ))}
      <div style={{ position: "relative", width: 168, height: 168, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* outer soft glow — organic wobble via SVG turbulence filter, breathes/reacts via direct style writes (ringRef) */}
        <div
          ref={ringRef}
          aria-hidden
          data-ember-state={state}
          style={{
            position: "absolute", inset: -6, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(245,200,66,0.6) 0%, rgba(200,144,42,0.32) 40%, rgba(139,40,20,0.14) 70%, transparent 100%)",
            filter: "blur(7px) url(#emberWobble)",
            animation: state === "idle" ? "emberBreathe 4.2s ease-in-out infinite"
              : state === "listening" ? "emberListen 1.3s ease-in-out infinite"
              : state === "thinking" ? "emberThink 1.7s ease-in-out infinite"
              : "emberSpeak 0.45s ease-in-out infinite",
          }}
        />
        {/* inner core — hot white center cooling to a charred edge, not a uniform gradient sphere */}
        <div
          ref={coreRef}
          aria-hidden
          style={{
            position: "absolute", width: "58%", height: "58%", borderRadius: "50%",
            background: "radial-gradient(circle at 40% 34%, #FFFFFF 0%, #FFEBB0 9%, #F5C842 24%, #E67E22 48%, #B33A22 72%, #3A1408 100%)",
            filter: "url(#emberWobble2)",
            boxShadow: "0 0 34px rgba(245,200,66,0.55), 0 0 60px rgba(230,126,34,0.25)",
          }}
        />
      </div>
      {state === "listening" ? (
        <span aria-hidden style={{ position: "absolute", bottom: "30%", right: "24%", width: 8, height: 8, borderRadius: "50%", background: "#E74C3C", boxShadow: "0 0 8px #E74C3C" }} />
      ) : null}
    </button>
  );
}

export function CompanionScreen({
  habits, goals, user, isPro, activeBlock, coachName, coachIcon,
  journalEntries = [], coachMemory = null, voiceRepliesEnabled = false, coachVoiceId = null,
  onNavigateTo, onHabitCreated, onGoalCreated, onCoachLogsApplied, onHabitRenamed,
  onJournalLogged, onOpenEditArc, onUpgrade, previewNormalCoachGreeting = false,
  onOpenProgress,
}) {
  const cName = coachName || "Coach";
  const greeting = composeGreeting(coachMemory?.recentSummaries);
  const dayTitle = latestDayTitle(coachMemory?.recentSummaries);

  const [situation, setSituation] = useState(SITUATIONS[0].id);
  const [showSituations, setShowSituations] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);

  const [messages, setMessages] = useState(() => (user?.id ? loadCoachDayMessages(user.id) || [] : []));
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const coachPersistDayRef = useRef(todayStr());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [captureSaving, setCaptureSaving] = useState(false);
  const [error, setError] = useState(null);
  const streamActiveRef = useRef(false);
  const lastStreamTextAtRef = useRef(0);
  const [freeMsgsToday, setFreeMsgsToday] = useState(0);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const coachTts = useCoachTts({ enabled: voiceRepliesEnabled === true, isPro, voiceId: coachVoiceId });
  const speech = useSpeechInput(t => setInput(p => mergeDictationIntoText(p, t)), { autoRestart: true, meter: true });

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
  // Lazily attaches a Web Audio analyser to the TTS <audio> element the
  // first time speech actually starts, so the ember's core scales with the
  // AI's own voice rather than a fixed rhythm. Never allowed to affect
  // playback itself — any failure here just leaves the CSS pulse running.
  const audioAnalyserSetupRef = useRef(false);
  const audioAnalyserRef = useRef(null);
  const audioRafRef = useRef(null);
  useEffect(() => {
    if (!coachTts.speaking) {
      if (audioRafRef.current) { cancelAnimationFrame(audioRafRef.current); audioRafRef.current = null; }
      if (emberCoreRef.current) emberCoreRef.current.style.transform = "";
      return;
    }
    const audioEl = coachTts.audioElRef?.current;
    if (!audioEl) return;
    if (!audioAnalyserSetupRef.current) {
      audioAnalyserSetupRef.current = true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const source = ctx.createMediaElementSource(audioEl);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyser.connect(ctx.destination); // required — otherwise routing through an analyser silences output
        audioAnalyserRef.current = analyser;
      } catch {
        audioAnalyserRef.current = null; // fine — falls back to the CSS-only emberSpeak rhythm
      }
    }
    const analyser = audioAnalyserRef.current;
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
  }, [coachTts.speaking, coachTts.audioElRef]);

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
    setInput("");
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const prompts = buildCoachSystemPrompts(user, habits, cName, "companion", goals, journalEntries, activeBlock, coachMemory);
      const situationDef = SITUATIONS.find(s => s.id === situation);
      const stableWithSituation = situationDef?.steer
        ? `${prompts.stable}\n\n─── CURRENT SITUATION (user-selected lens) ───\n${situationDef.steer}`
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

  const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant" && String(m.content || "").trim());
  const streamingMsg = messages.find(m => m.id === STREAM_ID);
  const showLiveExchange = messages.length > 0 && !showHistory;

  return (
    <div style={{ position: "relative", minHeight: "100dvh", display: "flex", flexDirection: "column", paddingTop: "calc(env(safe-area-inset-top, 0px) + 28px)", paddingBottom: 8 }}>
      {/* Organic wobble for the ember's edges — a plain circle reads as "AI
          orb" (every assistant has one now); a slightly irregular, flickering
          edge is what actually reads as fire. Zero-size, purely a filter def. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="emberWobble">
          <feTurbulence type="fractalNoise" baseFrequency="0.015 0.03" numOctaves="2" seed="7" result="noise">
            <animate attributeName="baseFrequency" dur="9s" values="0.015 0.03;0.022 0.04;0.015 0.03" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" />
        </filter>
        <filter id="emberWobble2">
          <feTurbulence type="fractalNoise" baseFrequency="0.03 0.05" numOctaves="2" seed="3" result="noise2">
            <animate attributeName="baseFrequency" dur="6s" values="0.03 0.05;0.04 0.06;0.03 0.05" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise2" scale="6" />
        </filter>
      </svg>
      <style>{`
        @keyframes emberBreathe {
          0%, 100% { transform: scale(1); opacity: 0.78; }
          50%      { transform: scale(1.08); opacity: 0.98; }
        }
        @keyframes emberListen {
          0%, 100% { transform: scale(1.04); opacity: 0.94; }
          50%      { transform: scale(1.2); opacity: 1; }
        }
        @keyframes emberThink {
          0%, 100% { filter: blur(7px) url(#emberWobble) hue-rotate(0deg) brightness(1); opacity: 0.85; }
          50%      { filter: blur(7px) url(#emberWobble) hue-rotate(-14deg) brightness(1.25); opacity: 1; }
        }
        @keyframes emberSpeak {
          0%, 100% { transform: scale(1.05); }
          50%      { transform: scale(1.16); }
        }
        @keyframes emberSpark {
          0%   { transform: translate(0, 0) scale(1); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translate(6px, -90px) scale(0.3); opacity: 0; }
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

      {!showHistory ? (
        <>
          {/* Situation pill — top right, quiet, collapsed by default */}
          <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 4px)", right: 4, zIndex: 20 }}>
            <button type="button" onClick={() => setShowSituations(o => !o)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, border: `0.5px solid ${T.borderStrong}`, background: T.raised, color: T.sub, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
              {SITUATIONS.find(s => s.id === situation)?.label}
              <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
            </button>
            {showSituations ? (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: T.raised, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: 6, minWidth: 168, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                {SITUATIONS.map(s => (
                  <button key={s.id} type="button" onClick={() => { setSituation(s.id); setShowSituations(false); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", background: s.id === situation ? "rgba(200,144,42,0.12)" : "none", color: s.id === situation ? T.gold : T.text, fontSize: 13, cursor: "pointer", fontFamily: T.font }}>
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 28, padding: "0 28px" }}>
            {!showLiveExchange ? (
              <div style={{ textAlign: "center", maxWidth: 340 }}>
                {dayTitle ? (
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.hint, marginBottom: 10 }}>
                    {dayTitle}
                  </div>
                ) : null}
                <div style={{ fontFamily: T.serif, fontSize: 21, color: T.text, lineHeight: 1.5 }}>
                  <div>{greeting.opener}</div>
                  {greeting.bullets.length ? (
                    <div style={{ display: "inline-block", textAlign: "left", marginTop: 10 }}>
                      {greeting.bullets.map((b, i) => (
                        <div key={i}>•  {b}</div>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ marginTop: greeting.bullets.length ? 16 : 10 }}>{greeting.closer}</div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", maxWidth: 340, minHeight: 90 }}>
                {speech.listening && speech.interim?.trim() ? (
                  <div style={{ fontSize: 15, color: T.sub, lineHeight: 1.6, fontStyle: "italic" }}>
                    &ldquo;{polishInterimDisplay(speech.interim)}&rdquo;
                  </div>
                ) : loading || (streamingMsg && !String(streamingMsg.content || "").trim()) ? (
                  <div style={{ display: "flex", justifyContent: "center", gap: 5 }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: T.muted, animation: "companionDot 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </div>
                ) : (
                  <div style={{ animation: "companionFadeIn 0.3s ease" }}>
                    {lastUserMsg ? (
                      <div style={{ fontSize: 12.5, color: T.hint, marginBottom: 10, lineHeight: 1.5 }}>
                        You: {lastUserMsg.content}
                      </div>
                    ) : null}
                    {streamingMsg?.content || lastAssistantMsg ? (
                      <div style={{ fontSize: 15.5, color: T.text, lineHeight: 1.6 }}>
                        <CoachFormattedBubble text={formatCoachChatDisplay(splitCoachReceipt(stripPartialGoalPlan(streamingMsg?.content || lastAssistantMsg?.content || "")).main)} isUser={false} />
                      </div>
                    ) : null}
                    {captureSaving ? <div style={{ marginTop: 8 }}><CaptureSavingLine /></div> : null}
                    {lastAssistantMsg?.captured?.length && !streamingMsg ? (
                      <div style={{ marginTop: 8, display: "inline-block", textAlign: "left" }}>
                        <CapturedLine items={lastAssistantMsg.captured} onNavigateTo={onNavigateTo} />
                      </div>
                    ) : null}
                  </div>
                )}
                {error ? <div style={{ fontSize: 12, color: T.accent, marginTop: 10 }}>{error}</div> : null}
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
            <div style={{ fontSize: 11.5, color: T.muted, minHeight: 16, textAlign: "center" }}>
              {atFreeCap ? null
                : speech.listening ? "Listening — tap to stop and send"
                : loading ? "Thinking…"
                : coachTts.speaking ? "Speaking…"
                : "Tap to talk"}
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
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !atFreeCap) { e.preventDefault(); send(input); } }}
                  placeholder="Type instead…"
                  style={{ flex: 1, background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "10px 14px", fontSize: 16, color: T.text, resize: "none", fontFamily: T.font, lineHeight: 1.5, outline: "none", minHeight: 42, maxHeight: 88 }}
                />
                <button type="button" onClick={() => send(input)} disabled={!input.trim() || loading || atFreeCap}
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

            <div style={{ display: "flex", gap: 18 }}>
              {messages.length > 0 ? (
                <button type="button" onClick={() => setShowHistory(true)}
                  style={{ background: "none", border: "none", color: T.hint, fontSize: 11.5, cursor: "pointer", fontFamily: T.font, padding: "4px 8px" }}>
                  Today's conversation →
                </button>
              ) : null}
              {onOpenProgress ? (
                <button type="button" onClick={onOpenProgress}
                  style={{ background: "none", border: "none", color: T.hint, fontSize: 11.5, cursor: "pointer", fontFamily: T.font, padding: "4px 8px" }}>
                  Progress →
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        // ── History — the full transcript, demoted to a secondary view ──
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "0 4px" }}>
          <button type="button" onClick={() => setShowHistory(false)}
            style={{ alignSelf: "flex-start", background: "none", border: "none", color: T.sub, fontSize: 13, cursor: "pointer", fontFamily: T.font, padding: "4px 8px", marginBottom: 10 }}>
            ← Back
          </button>
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingBottom: 16 }}>
            {messages.map((m, i) => {
              const rawVisible = m.role === "assistant" ? stripPartialGoalPlan(m.content) : m.content;
              const { main: coachMainRaw } = m.role === "assistant" ? splitCoachReceipt(rawVisible) : { main: rawVisible };
              const coachMain = m.role === "assistant" ? formatCoachChatDisplay(coachMainRaw) : coachMainRaw;
              return (
                <div key={m.id || `${m.role}-${i}-${m.ts ?? ""}`} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "88%", display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                    {coachMain ? (
                      <div style={{
                        padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                        background: m.role === "user" ? T.accent : T.surface, fontSize: 14, color: m.role === "user" ? "#fff" : T.text, lineHeight: 1.6,
                      }}>
                        <CoachFormattedBubble text={coachMain} isUser={m.role === "user"} />
                      </div>
                    ) : null}
                    {m.role === "assistant" && m.captured?.length ? (
                      <CapturedLine items={m.captured} onNavigateTo={onNavigateTo} />
                    ) : null}
                    <div style={{ fontSize: 10, color: T.hint, marginTop: 3 }}>{formatCoachMsgTime(m.ts)}</div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
