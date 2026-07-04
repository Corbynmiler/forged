// ─── COMPANION SCREEN — the new home ─────────────────────────────────────────
// Conversation-first landing: one mic button, one conversation, memory quietly
// working underneath. Reuses the coach's tuned personality/prompt logic
// (exported from ../coach/AICoach.jsx) rather than forking it — this screen
// owns its own UI shell and streaming loop, not the personality itself.
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
  buildCoachGreeting,
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

// ── Situations — purpose-driven lenses over one shared memory (see
// PREVIEW_BRANCH_HANDOFF.md for the design rationale on each). Steering text
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

/** Most recent daily_summaries row with either a real title or a summary. */
function latestDayStatus(recentSummaries) {
  const list = Array.isArray(recentSummaries) ? recentSummaries : [];
  if (!list.length) return null;
  const last = list[list.length - 1]; // recentSummaries is oldest-first
  const title = (last?.title || "").trim();
  const summary = (last?.summary || "").trim();
  if (title) return { label: "Yesterday", text: title };
  if (summary) return { label: "Yesterday", text: summary.slice(0, 60) + (summary.length > 60 ? "…" : "") };
  return null;
}

export function CompanionScreen({
  habits, goals, user, isPro, activeBlock, coachName, coachIcon,
  journalEntries = [], coachMemory = null, voiceRepliesEnabled = false, coachVoiceId = null,
  onNavigateTo, onHabitCreated, onGoalCreated, onCoachLogsApplied, onHabitRenamed,
  onJournalLogged, onOpenEditArc, onUpgrade, previewNormalCoachGreeting = false,
  onOpenProgress,
}) {
  const cName = coachName || "Coach";
  const greetingRef = useRef(null);
  if (greetingRef.current === null) {
    greetingRef.current = buildCoachGreeting({ name: user?.name, habits, goals, activeBlock });
  }
  const dayStatus = latestDayStatus(coachMemory?.recentSummaries);

  const [situation, setSituation] = useState(SITUATIONS[0].id);
  const [showSituations, setShowSituations] = useState(false);
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
  const greetingTsRef = useRef(Date.now());
  // Always-current mirror of `input` — stopAll() flushes the last dictation
  // segment via a functional setInput() update, so the *state* is correct
  // immediately, but handleMicToggle's setTimeout would otherwise read a
  // stale closure over `input` from before that flush. Reading the ref
  // instead (updated every render, same object across renders) gets the
  // post-flush value regardless of timing.
  const inputRef = useRef(input);
  inputRef.current = input;

  const coachTts = useCoachTts({ enabled: voiceRepliesEnabled === true, isPro, voiceId: coachVoiceId });
  const speech = useSpeechInput(t => setInput(p => mergeDictationIntoText(p, t)), { autoRestart: true, meter: true });

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, captureSaving]);

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
      const withReply = [
        ...(base.length === 0 ? [{ role: "assistant", content: greetingRef.current, ts: greetingTsRef.current }] : base),
        userMsg,
        { role: "assistant", content: "Yep — I'll open your Arc editor for that.", ts: Date.now() },
      ];
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
    const next = base.length === 0
      ? [{ role: "assistant", content: greetingRef.current, ts: greetingTsRef.current }, userMsg]
      : [...base, userMsg];
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
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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

  function handleMicToggle() {
    if (!speech.supported) { alert(speechUnsupportedHelpMessage()); return; }
    if (speech.listening) {
      // Stopping IS the send trigger — no separate confirm step. Read the
      // ref (not the closed-over `input`) so the flushed trailing segment
      // from stopAll() is included even though it lands via an async
      // functional setState — see inputRef above.
      speech.toggle();
      window.setTimeout(() => {
        const text = inputRef.current.trim();
        if (text) send(text);
      }, 60);
      return;
    }
    speech.toggle();
  }

  const streamingEmpty = messages.some(m => m.id === STREAM_ID && !String(m.content || "").trim());
  const displayedInput = speech.listening && speech.interim?.trim()
    ? `${input.trim()}${input.trim() ? " " : ""}${polishInterimDisplay(speech.interim).trim()}`
    : input;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "60vh", paddingBottom: 8 }}>
      {/* Day status + situation pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 4px 14px" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {dayStatus ? (
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.4 }}>
              <span style={{ color: T.hint }}>{dayStatus.label}: </span>{dayStatus.text}
            </div>
          ) : null}
        </div>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button type="button" onClick={() => setShowSituations(o => !o)}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, border: `0.5px solid ${T.borderStrong}`, background: T.raised, color: T.sub, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
            {SITUATIONS.find(s => s.id === situation)?.label}
            <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
          </button>
          {showSituations ? (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, background: T.raised, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: 6, minWidth: 168, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
              {SITUATIONS.map(s => (
                <button key={s.id} type="button" onClick={() => { setSituation(s.id); setShowSituations(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", background: s.id === situation ? "rgba(200,144,42,0.12)" : "none", color: s.id === situation ? T.gold : T.text, fontSize: 13, cursor: "pointer", fontFamily: T.font }}>
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Transcript */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        {messages.length === 0 ? (
          <div style={{ padding: "8px 4px 24px" }}>
            <div style={{ fontFamily: T.serif, fontSize: 22, color: T.text, lineHeight: 1.3, marginBottom: 8 }}>
              What&apos;s on your mind?
            </div>
            <div style={{ fontSize: 13.5, color: T.sub, lineHeight: 1.6 }}>{greetingRef.current}</div>
          </div>
        ) : (
          messages.map((m, i) => {
            const rawVisible = m.role === "assistant" ? stripPartialGoalPlan(m.content) : m.content;
            const { main: coachMainRaw } = m.role === "assistant"
              ? splitCoachReceipt(rawVisible) : { main: rawVisible };
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
                  {m.role === "assistant" && m.id === STREAM_ID && captureSaving ? <CaptureSavingLine /> : null}
                  {m.role === "assistant" && m.captured?.length ? (
                    <CapturedLine items={m.captured} onNavigateTo={onNavigateTo} />
                  ) : null}
                  <div style={{ fontSize: 10, color: T.hint, marginTop: 3 }}>{formatCoachMsgTime(m.ts)}</div>
                </div>
              </div>
            );
          })
        )}
        {loading || streamingEmpty ? (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ padding: "10px 16px", borderRadius: "14px 14px 14px 3px", background: T.surface, display: "flex", gap: 5 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: T.muted, animation: "coachDot 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
          </div>
        ) : null}
        {error ? <div style={{ textAlign: "center", fontSize: 12, color: T.accent, padding: "4px 8px" }}>{error}</div> : null}
        <div ref={bottomRef} />
      </div>

      {/* Mic — dominant, mic-first, user-controlled: press to start, press to stop, stopping sends. */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 20 }}>
        {atFreeCap ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, color: T.sub, marginBottom: 8 }}>Daily coach limit reached — resets tomorrow</div>
            <button type="button" onClick={onUpgrade} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: T.gold, fontWeight: 600 }}>
              Go Pro for unlimited coach →
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleMicToggle}
              aria-label={speech.listening ? "Stop and send" : "Start talking"}
              style={{
                width: 84, height: 84, borderRadius: "50%",
                border: `1px solid ${speech.listening ? "#E74C3Ccc" : `${T.gold}55`}`,
                background: speech.listening
                  ? "linear-gradient(145deg, #E74C3C88 0%, #E74C3C55 55%, #C0392B 100%)"
                  : `linear-gradient(145deg, ${T.gold}35 0%, ${T.gold}12 55%, ${T.raised} 100%)`,
                color: speech.listening ? "#ff6b6b" : T.gold,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: speech.listening ? "0 0 0 5px rgba(231,76,60,0.16), 0 4px 20px rgba(0,0,0,0.4)" : "0 4px 20px rgba(0,0,0,0.4)",
                transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
              }}
            >
              {speech.listening ? (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg>
              ) : (
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                  <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8 11v1a4 4 0 0 0 8 0v-1M12 18v2M9 22h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <div style={{ fontSize: 11.5, color: T.muted, minHeight: 16 }}>
              {speech.listening ? (speech.interim?.trim() ? `"${polishInterimDisplay(speech.interim)}"` : "Listening — tap to stop and send") : "Tap to talk"}
            </div>
          </>
        )}

        {!showTextInput ? (
          <button type="button" onClick={() => { setShowTextInput(true); requestAnimationFrame(() => textareaRef.current?.focus()); }}
            style={{ background: "none", border: "none", color: T.hint, fontSize: 12.5, cursor: "pointer", fontFamily: T.font, padding: "4px 8px" }}>
            type instead
          </button>
        ) : (
          <div style={{ width: "100%", display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={textareaRef}
              value={displayedInput}
              onChange={e => setInput(e.target.value)}
              onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px"; }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !atFreeCap) { e.preventDefault(); send(displayedInput); } }}
              placeholder="Type instead…"
              style={{ flex: 1, background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "10px 14px", fontSize: 16, color: T.text, resize: "none", fontFamily: T.font, lineHeight: 1.5, outline: "none", minHeight: 42, maxHeight: 88 }}
            />
            <button type="button" onClick={() => send(displayedInput)} disabled={!displayedInput.trim() || loading || atFreeCap}
              aria-label="Send message"
              style={{ width: 40, height: 40, borderRadius: "50%", border: `0.5px solid ${T.border}`, flexShrink: 0, background: displayedInput.trim() && !loading ? T.gold : T.surface, cursor: displayedInput.trim() && !loading ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                <path d="M2 9h14M9 2l7 7-7 7" stroke={displayedInput.trim() && !loading ? "#1a1a16" : T.hint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
            style={{ marginTop: 4, background: "none", border: "none", color: T.hint, fontSize: 11.5, cursor: "pointer", fontFamily: T.font, padding: "4px 8px" }}>
            Progress →
          </button>
        ) : null}
      </div>
    </div>
  );
}
