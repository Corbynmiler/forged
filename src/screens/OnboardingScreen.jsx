import { useState, useEffect, useRef } from "react";
import { T } from "../theme.js";
import {
  resolveArcTitle,
  clampArcDurationDays,
  arcDurationWeeksLabel,
  normalizeChatInput,
  bubbleContentForDisplay,
  normalizeProofActionEntry,
  proofActionDisplayName,
  inferHabitTypeFromProofName,
} from "../arcProofMatch.js";
import { ArcDurationEditor } from "../components/ArcDurationEditor.jsx";
import ArcSuggestionPills from "../components/ArcSuggestionPills.jsx";
import {
  inferArcCoachStage,
  getArcSuggestionPills,
  onboardingConversationOpener,
} from "../arcCoachSuggestions.js";
import { supabase } from "../supabase.js";
import { todayStr, daysAgo } from "../utils.js";
import { useSpeechInput, MicBtn, mergeDictationIntoText, polishInterimDisplay } from "../hooks/useSpeechInput.jsx";
import { useScrollLock } from "../hooks/useScrollLock.js";
import { useArcChatScroll } from "../hooks/useArcChatScroll.js";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function cssPadXSafe(basePx) {
  return {
    paddingLeft: `max(${basePx}px, env(safe-area-inset-left, 0px))`,
    paddingRight: `max(${basePx}px, env(safe-area-inset-right, 0px))`,
  };
}

// ─── ARC DRAFT / OPTIONS PARSING ──────────────────────────────────────────────
// onboard-chat ends its reply with <arc_draft>{json}</arc_draft> (single, used
// by the in-app ArcCoachSheet) or <arc_options>[{…},{…}]</arc_options> (2–3
// proposals, used by conversation-first onboarding). These split the bubble
// prose from the structured payload and validate shapes before trusting them.
const ARC_DRAFT_RE = /<arc_draft>([\s\S]*?)<\/arc_draft>/i;
const ARC_OPTIONS_RE = /<arc_options>([\s\S]*?)<\/arc_options>/i;

function sanitizeArcDraftObject(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const identity = String(parsed.identity ?? "").trim();
  if (!identity) return null;
  const proofActions = Array.isArray(parsed.proofActions)
    ? parsed.proofActions.map(normalizeProofActionEntry).filter(Boolean).slice(0, 5)
    : [];
  return {
    title:        resolveArcTitle(String(parsed.title ?? "").trim(), identity),
    durationDays: clampArcDurationDays(parsed.durationDays ?? parsed.duration_days),
    identity:     identity.slice(0, 250),
    why:          String(parsed.why ?? "").trim().slice(0, 250),
    oldPattern:   String(parsed.oldPattern ?? "").trim().slice(0, 200),
    minimumProof: String(parsed.minimumProof ?? "").trim().slice(0, 150),
    proofActions,
  };
}

export function parseArcDraftFromText(text) {
  if (!text) return { prose: "", draft: null };
  const m = String(text).match(ARC_DRAFT_RE);
  if (!m) return { prose: String(text), draft: null };
  const prose = String(text).replace(ARC_DRAFT_RE, "").trim();
  try {
    return { prose, draft: sanitizeArcDraftObject(JSON.parse(m[1].trim())) };
  } catch {
    return { prose, draft: null };
  }
}

export function parseArcOptionsFromText(text) {
  if (!text) return { prose: "", options: null };
  const m = String(text).match(ARC_OPTIONS_RE);
  if (!m) {
    // Model occasionally falls back to a single draft — accept it as one option.
    const single = parseArcDraftFromText(text);
    return { prose: single.prose, options: single.draft ? [single.draft] : null };
  }
  const prose = String(text).replace(ARC_OPTIONS_RE, "").trim();
  try {
    const arr = JSON.parse(m[1].trim());
    if (!Array.isArray(arr)) return { prose, options: null };
    const options = arr.map(sanitizeArcDraftObject).filter(Boolean).slice(0, 3);
    return { prose, options: options.length ? options : null };
  } catch {
    return { prose, options: null };
  }
}

// ─── PROOF ACTIONS → HABITS ──────────────────────────────────────────────────
// The selected Arc proposal's proofActions become real daily habits so the
// evidence loop works from day one. Everything starts as a simple daily habit
// (binary "did it / didn't"), which is the cleanest first loop — the coach can
// evolve types later.
const PROOF_COLORS = ["#C0392B", "#27AE60", "#2980B9", "#8E44AD", "#E67E22"];

function emojiForProofAction(name) {
  const n = String(name || "").toLowerCase();
  if (/gym|lift|strength|train|workout|push.?up/.test(n)) return "🏋️";
  if (/run|jog|cardio|walk|steps/.test(n)) return "🏃";
  if (/eat|meal|breakfast|lunch|dinner|protein|cook/.test(n)) return "🥗";
  if (/water|hydrat/.test(n)) return "💧";
  if (/sleep|bed|wake/.test(n)) return "🌙";
  if (/read|book|pages/.test(n)) return "📚";
  if (/write|journal|note/.test(n)) return "✍️";
  if (/build|ship|code|project|create|work on/.test(n)) return "⚒️";
  if (/meditat|breath|stretch|yoga/.test(n)) return "🧘";
  if (/limit|less|fewer|no |quit|cut|reduce|nicotine|alcohol|vape|smoke|pouch/.test(n)) return "🎯";
  if (/money|save|budget|spend/.test(n)) return "💰";
  return "🔨";
}

export function habitsFromProofActions(proofActions) {
  return (proofActions || []).map((raw, i) => {
    const norm = normalizeProofActionEntry(raw) || { name: String(raw || "").trim(), cadence: "daily" };
    const name = norm.name.slice(0, 40);
    const habitType = norm.cadence || inferHabitTypeFromProofName(name);
    const base = {
      id: `${Date.now()}-${i}-${Math.random()}`,
      name,
      emoji: emojiForProofAction(name),
      habitType,
      color: PROOF_COLORS[i % PROOF_COLORS.length],
      reflection: true,
      reflectionPrompt: "How did it go today?",
      streak: 0, bestStreak: 0, logs: [],
    };
    if (habitType === "weekly") base.weeklyTarget = 1;
    if (habitType === "limit") {
      base.dailyBudget = 1;
      base.unit = "unit";
      base.goalAim = "reduce";
    }
    if (habitType === "project") base.dailyTargetMinutes = 60;
    return base;
  });
}

// ─── EXPORTS KEPT FOR OTHER SCREENS ──────────────────────────────────────────
// Concrete identity examples — used by ArcSetupSheet's manual form.
export const ARC_IDENTITY_EXAMPLES = [
  "Gain 3kg without skipping breakfast.",
  "Build income outside work.",
  "Cut back nicotine and eat properly.",
  "Get back to football fitness.",
  "Stretch every morning before work.",
  "Stop relying on old crutches.",
];

export function buildDemoHabits() {
  return [
    {
      id:"demo-1", name:"Gym", emoji:"🏋️", habitType:"weekly", weeklyTarget:3,
      color:"#C0392B", streak:4, bestStreak:4, reflection:true,
      reflectionPrompt:"What felt strong? What needs work?",
      logs:[
        { date:daysAgo(1), value:true, note:"", reflection:"Bench felt heavy but got through it." },
        { date:daysAgo(3), value:true, note:"", reflection:"Best squat session in weeks." },
        { date:daysAgo(5), value:true, note:"" },
        { date:daysAgo(8), value:true, note:"" },
        { date:daysAgo(10), value:true, note:"", reflection:"Low energy — skipped isolation work." },
      ],
    },
    {
      id:"demo-2", name:"Water (2L-ish)", emoji:"💧", habitType:"daily",
      color:"#2980B9", streak:5, bestStreak:9, reflection:false,
      reflectionPrompt:"Hydration check — how did you feel today?",
      logs:[
        { date:todayStr(), value:true, note:"" },
        { date:daysAgo(1), value:true, note:"" },
        { date:daysAgo(2), value:true, note:"" },
        { date:daysAgo(3), value:true, note:"" },
        { date:daysAgo(4), value:true, note:"" },
        { date:daysAgo(6), value:true, note:"" },
        { date:daysAgo(8), value:true, note:"" },
      ],
    },
    {
      id:"demo-3", name:"In bed by 11:30", emoji:"🌙", habitType:"daily",
      color:"#8E44AD", streak:3, bestStreak:7, reflection:false,
      reflectionPrompt:"How's your sleep quality?",
      logs:[
        { date:daysAgo(1), value:true, note:"" },
        { date:daysAgo(2), value:true, note:"" },
        { date:daysAgo(3), value:true, note:"" },
        { date:daysAgo(5), value:true, note:"" },
        { date:daysAgo(7), value:true, note:"" },
      ],
    },
    {
      id:"demo-4", name:"Weight", emoji:"⚖️", habitType:"progress",
      startValue:215.7, targetValue:210, unit:"lbs",
      color:"#E67E22", streak:0, bestStreak:0, reflection:true,
      reflectionPrompt:"How many meals today? Energy levels?",
      logs:[
        { date:daysAgo(2), value:215.2, note:"", reflection:"3 meals, felt good." },
        { date:daysAgo(5), value:215.5, note:"" },
        { date:daysAgo(8), value:215.9, note:"" },
        { date:daysAgo(12), value:216.4, note:"", reflection:"Big dinner on the weekend." },
      ],
    },
  ];
}
// ─── ONBOARDING SCREEN ────────────────────────────────────────────────────────
// Conversation-first flow:
//   welcome → name → conversation (coach asks, user talks, 2–3 Arc proposals,
//   pick + edit one) → first evidence (voice/text) → notifications → final.
// No Pro upsell anywhere in onboarding. Admin preview renders this same
// component with a no-op onSaveProgress.
const STEP_WELCOME  = "welcome";
const STEP_NAME     = "name";
const STEP_CHAT     = "chat";
const STEP_EVIDENCE = "evidence";
const STEP_NOTIF    = "notif";
const STEP_FINAL    = "final";

const STEP_NUMBERS = { [STEP_WELCOME]:1, [STEP_NAME]:2, [STEP_CHAT]:3, [STEP_EVIDENCE]:4, [STEP_NOTIF]:5, [STEP_FINAL]:6 };
const DISPLAY_TOTAL = 5; // final screen isn't a "step"

export function OnboardingScreen({ onComplete, onSkip, onSaveProgress, onCheckout, notifEnabled, notifLoading, notifPermission, onNotifToggle, isCoachClient = false, topInset = 0 }) {
  const [step, setStep] = useState(STEP_WELCOME);
  const [name, setName] = useState("");

  // ── Conversation state ──
  const [msgs,        setMsgs]        = useState([]);
  const [input,       setInput]       = useState("");
  const [sending,     setSending]     = useState(false);
  const [arcOptions,  setArcOptions]  = useState(null);   // [{…}, {…}, {…}] | null
  const [selectedIdx, setSelectedIdx] = useState(null);   // which option is open
  const [editedArc,   setEditedArc]   = useState(null);   // editable copy of the pick
  const [editingArc,  setEditingArc]  = useState(false);  // confirm card edit mode
  const [skipConfirmVisible, setSkipConfirmVisible] = useState(false);

  // ── Evidence + final state ──
  const [evidenceText,      setEvidenceText]      = useState("");
  const [enteringApp,       setEnteringApp]       = useState(false);
  const [emailUpdatesOptIn, setEmailUpdatesOptIn] = useState(true);

  const textareaRef = useRef(null);
  const evidenceRef = useRef(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  useScrollLock(step === STEP_CHAT);

  const { scrollRef, bottomRef, onScroll, onComposerFocus } = useArcChatScroll(
    step === STEP_CHAT ? [msgs, sending, arcOptions, selectedIdx] : [],
    { inputDockId: step === STEP_CHAT ? "onboard-chat-input-dock" : null },
  );

  const speech = useSpeechInput((text) => {
    if (stepRef.current === STEP_EVIDENCE) {
      setEvidenceText(prev => mergeDictationIntoText(prev, text));
    } else {
      setInput(prev => mergeDictationIntoText(prev, text));
    }
  }, { autoRestart: true });

  // Seed the coach's opening question locally (no API cost) on entering chat.
  useEffect(() => {
    if (step !== STEP_CHAT || msgs.length > 0) return;
    setMsgs([{ role: "assistant", content: onboardingConversationOpener(name) }]);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send a chat message ────────────────────────────────────────────────────
  async function sendMessage(overrideText) {
    const inputText = overrideText !== undefined
      ? normalizeChatInput(overrideText)
      : normalizeChatInput(input);
    if (!inputText || sending) return;
    if (speech.listening) speech.toggle();
    if (!overrideText) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }

    const withUser = [...msgs, { role: "user", content: inputText }];
    setMsgs(withUser);
    setSending(true);
    // A new message invalidates previously shown options.
    setArcOptions(null);
    setSelectedIdx(null);

    try {
      // Hidden "." trigger keeps the alternating sequence valid:
      // user:"." → assistant:opener → user:msg1 → …
      const apiMessages = [{ role: "user", content: "." }, ...withUser];
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("No session");

      const res = await fetch("/api/onboard-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim() || "there",
          coachName: "Coach",
          messages: apiMessages,
          multiOptions: true,
        }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setSending(false);
      const raw = data.reply || "";
      const { prose, options } = parseArcOptionsFromText(raw);
      setMsgs(p => [...p, { role: "assistant", content: prose || raw }]);
      if (options?.length) setArcOptions(options);
    } catch {
      setSending(false);
      setMsgs(p => [...p, { role: "assistant", content: "Something went wrong on my end — say that again?" }]);
    }
  }

  function handleSuggestionPill(pill) {
    if (!pill || sending) return;
    if (pill.mode === "insert") {
      setInput(pill.text);
      textareaRef.current?.focus();
      return;
    }
    sendMessage(pill.text);
  }

  function pickOption(idx) {
    const opt = arcOptions?.[idx];
    if (!opt) return;
    setSelectedIdx(idx);
    setEditedArc({ ...opt, proofActions: [...(opt.proofActions || [])] });
    setEditingArc(false);
  }

  function confirmArc() {
    if (!editedArc?.identity?.trim()) return;
    setStep(STEP_EVIDENCE);
  }

  // ── Save everything and enter the app ──────────────────────────────────────
  async function finishOnboarding() {
    if (enteringApp) return;
    setEnteringApp(true);
    const habits = editedArc ? habitsFromProofActions(editedArc.proofActions) : [];
    try {
      await Promise.race([
        onSaveProgress({
          name: name.trim() || "You",
          habits,
          coachName: "Coach",
          emailUpdatesOptIn,
          arc: editedArc ? {
            title:        editedArc.title || resolveArcTitle("", editedArc.identity),
            durationDays: clampArcDurationDays(editedArc.durationDays),
            identity:     (editedArc.identity || "").trim(),
            why:          (editedArc.why || "").trim(),
            oldPattern:   (editedArc.oldPattern || "").trim(),
            minimumProof: (editedArc.minimumProof || "").trim(),
          } : { identity: "" },
          firstEvidence: evidenceText.trim() || null,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
      ]);
      onComplete();
    } catch {
      onComplete();
    }
  }

  const styleInp = {
    width:"100%", border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm,
    background:T.surface, padding:"10px 12px", fontSize:16, color:T.text,
    outline:"none", boxSizing:"border-box", fontFamily:T.font,
  };

  const wrap = {
    fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100dvh", background:T.bg, display:"flex", flexDirection:"column",
    paddingTop: "env(safe-area-inset-top, 0px)",
  };

  function ProgressHeader({ currentNum, total = DISPLAY_TOTAL }) {
    const pct = Math.max(0, Math.min(100, Math.round((currentNum / total) * 100)));
    return (
      <div style={{ paddingTop: 24, paddingBottom: 0, ...cssPadXSafe(24) }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
          <div style={{ fontSize:10, fontWeight:600, color:T.muted, textTransform:"uppercase", letterSpacing:"0.12em" }}>
            Step {currentNum} of {total}
          </div>
          <div style={{ fontSize:10, fontWeight:500, color:T.hint, letterSpacing:"0.04em" }}>{pct}%</div>
        </div>
        <div style={{ height:3, width:"100%", background:T.surface, borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:T.accent, borderRadius:2, transition:"width 0.35s cubic-bezier(0.22,1,0.36,1)" }}/>
        </div>
      </div>
    );
  }

  // ── FINAL: you're in (no Pro upsell) ───────────────────────────────────────
  if (step === STEP_FINAL) {
    return (
      <div style={wrap}>
        <style>{`
          @keyframes finalHeroIn { from { opacity:0; transform:translateY(14px) scale(0.96); } to { opacity:1; transform:none; } }
          @keyframes finalItemIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        `}</style>
        <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", padding:"48px 24px 32px", overflowY:"auto" }}>
          <div style={{ width:"100%", maxWidth:360, margin:"0 auto", textAlign:"center" }}>
            <div style={{ animation:"finalHeroIn 0.6s cubic-bezier(0.22,1,0.36,1) both" }}>
              <div style={{ position:"relative", display:"inline-block", marginBottom:22 }}>
                <div style={{ position:"absolute", inset:-18, background:"radial-gradient(circle, rgba(200,144,42,0.22) 0%, rgba(200,144,42,0) 70%)", borderRadius:"50%", zIndex:0, pointerEvents:"none" }}/>
                <div style={{ position:"relative", fontSize:56, lineHeight:1, zIndex:1 }}>⚒️</div>
              </div>
              <div style={{ fontSize:11, fontWeight:600, color:T.gold, textTransform:"uppercase", letterSpacing:"0.14em", marginBottom:12 }}>
                {editedArc ? "Your Arc is live" : "You're in"}
              </div>
              <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, marginBottom:12, lineHeight:1.15, letterSpacing:"-0.005em" }}>
                Let&apos;s build, {name.trim() || "you"}.
              </div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7, maxWidth:300, margin:"0 auto 28px" }}>
                {editedArc
                  ? <>“{editedArc.title || "Your Arc"}” — {arcDurationWeeksLabel(editedArc.durationDays)}, starting today. Show proof, talk to your coach, and let the weekly Review tell you the truth.</>
                  : "Track what matters, talk to your coach, and start an Arc whenever you're ready."}
              </div>
            </div>

            {isCoachClient && (
              <div style={{
                position:"relative",
                background:"linear-gradient(145deg, rgba(39,174,96,0.13) 0%, rgba(39,174,96,0.04) 100%)",
                border:"1px solid rgba(39,174,96,0.45)",
                borderRadius:18,
                padding:"18px 18px 16px",
                marginBottom:16,
                textAlign:"left",
                animation:"finalItemIn 0.55s 0.15s cubic-bezier(0.22,1,0.36,1) both",
              }}>
                <div style={{ position:"absolute", top:-10, left:14, background:"#27AE60", color:"#fff", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", padding:"3px 9px", borderRadius:6 }}>
                  Included with your coach
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, marginTop:4 }}>
                  <div style={{ fontSize:22 }}>⚡</div>
                  <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, lineHeight:1.2 }}>Forged Pro — Free</div>
                  <div style={{ marginLeft:"auto", fontSize:12, color:"#27AE60", fontWeight:600 }}>$0/mo</div>
                </div>
                <div style={{ fontSize:12, color:T.sub, lineHeight:1.65 }}>
                  Your coach has unlocked full access for you — unlimited coaching, spoken replies, and complete history.
                </div>
              </div>
            )}

            <button
              onClick={finishOnboarding}
              disabled={enteringApp}
              style={{
                width:"100%", padding:"15px 0", borderRadius:12,
                border:"none",
                background: enteringApp ? T.raised : T.accent,
                color: enteringApp ? T.muted : "#fff",
                fontSize:15, fontWeight:600,
                cursor: enteringApp ? "not-allowed" : "pointer",
                fontFamily:T.font,
                marginBottom:18,
                opacity: enteringApp ? 0.7 : 1,
                transition:"opacity 0.15s, background 0.15s",
                animation:"finalItemIn 0.55s 0.22s cubic-bezier(0.22,1,0.36,1) both",
              }}
            >
              {enteringApp ? "Setting up…" : "Start using Forged →"}
            </button>

            <label style={{
              display:"flex", alignItems:"flex-start", gap:10,
              padding:"11px 13px", borderRadius:12,
              border:`0.5px solid ${T.border}`, background:T.surface,
              cursor:"pointer", textAlign:"left",
              animation:"finalItemIn 0.55s 0.3s cubic-bezier(0.22,1,0.36,1) both",
            }}>
              <input
                type="checkbox"
                checked={emailUpdatesOptIn}
                onChange={e => setEmailUpdatesOptIn(e.target.checked)}
                style={{ marginTop:3, width:15, height:15, accentColor:T.gold, flexShrink:0, cursor:"pointer" }}
              />
              <span style={{ fontSize:12, color:T.sub, lineHeight:1.55 }}>
                <span style={{ color:T.text, fontWeight:500 }}>Get Forged weekly updates by email.</span>
                <br/>
                <span style={{ color:T.muted }}>See new features and how user feedback is shaping the app.</span>
              </span>
            </label>
          </div>
        </div>
      </div>
    );
  }

  // ── NOTIFICATIONS — asked only after the Arc + first evidence exist ────────
  if (step === STEP_NOTIF) {
    const blocked = notifPermission === "denied";
    const already = notifEnabled;
    const goNext = () => setStep(STEP_FINAL);

    return (
      <div style={wrap}>
        <ProgressHeader currentNum={STEP_NUMBERS[STEP_NOTIF]} />
        <div style={{ flex:1, padding:"40px 24px 16px", overflowY:"auto", display:"flex", flexDirection:"column", justifyContent:"center" }}>
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:52, marginBottom:14, lineHeight:1 }}>🔔</div>
            <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, lineHeight:1.2, marginBottom:10 }}>
              Protect the Arc
            </div>
            <div style={{ fontSize:14, color:T.muted, lineHeight:1.6, maxWidth:300, margin:"0 auto" }}>
              One reminder a day, sent when you still have time to show proof. That&apos;s it — no spam.
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:28 }}>
            {[
              { icon:"🔥", title:"Evidence protection", desc:"A nudge before the day closes empty." },
              { icon:"🗓️", title:"Weekly Review", desc:"Know when your Review is ready." },
              { icon:"✅", title:"Daily check-in", desc:"A quick tap to log and close the day." },
            ].map(({ icon, title, desc }) => (
              <div key={title} style={{ display:"flex", alignItems:"center", gap:14, background:T.raised, border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"14px 16px" }}>
                <div style={{ fontSize:22, flexShrink:0 }}>{icon}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:2 }}>{title}</div>
                  <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {blocked && (
            <div style={{ background:"rgba(224,92,92,0.08)", border:"0.5px solid rgba(224,92,92,0.25)", borderRadius:T.rsm, padding:"10px 14px", marginBottom:16 }}>
              <div style={{ fontSize:12, color:"#e05c5c", lineHeight:1.6 }}>
                Notifications are blocked in your browser settings. To enable them, open Settings → Safari/Chrome → Notifications and allow Forged.
              </div>
            </div>
          )}
        </div>

        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          {already ? (
            <button onClick={goNext}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", marginBottom:10 }}>
              Reminders on — let&apos;s go ✓
            </button>
          ) : (
            <button
              onClick={async () => { if (onNotifToggle) await onNotifToggle(); goNext(); }}
              disabled={notifLoading || blocked}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:blocked?T.surface:T.gold, color:blocked?T.muted:"#0F0F0D", fontSize:16, fontWeight:600, cursor:blocked?"not-allowed":"pointer", opacity:(notifLoading||blocked)?0.7:1, marginBottom:10, transition:"opacity 0.15s" }}>
              {notifLoading ? "Enabling…" : blocked ? "Notifications blocked" : "Enable daily reminders 🔔"}
            </button>
          )}
          <button onClick={goNext}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer" }}>
            Skip notifications
          </button>
        </div>
      </div>
    );
  }

  // ── FIRST EVIDENCE — say one true thing before entering the app ────────────
  if (step === STEP_EVIDENCE) {
    const identityShort = (editedArc?.identity || "").trim();
    const canContinue = evidenceText.trim().length > 0;
    return (
      <div style={wrap}>
        <ProgressHeader currentNum={STEP_NUMBERS[STEP_EVIDENCE]} />
        <div style={{ flex:1, padding:"36px 24px 16px", overflowY:"auto", display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:22 }}>
            <div style={{ width:34, height:34, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>🤖</div>
            <div style={{ background:T.surface, borderRadius:"14px 14px 14px 3px", padding:"12px 16px", fontSize:14.5, color:T.text, lineHeight:1.65 }}>
              Locked in. Before we go — what&apos;s one thing you&apos;ve already done today, or yesterday, that counts toward
              {identityShort ? <> &ldquo;{identityShort.slice(0, 80)}&rdquo;</> : " this"}?
              Even something small. Say it out loud or type it — that&apos;s your first piece of evidence.
            </div>
          </div>

          <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
            {speech.supported && (
              <div style={{ flexShrink:0, alignSelf:"flex-end", marginBottom:1 }}>
                <MicBtn speech={speech} color={T.gold} size={44} prominent/>
              </div>
            )}
            <textarea
              ref={evidenceRef}
              value={speech.listening && speech.interim?.trim()
                ? mergeDictationIntoText(evidenceText, polishInterimDisplay(speech.interim))
                : evidenceText}
              onChange={e => setEvidenceText(e.target.value)}
              onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px"; }}
              placeholder={speech.listening ? "Listening…" : "e.g. Made breakfast instead of skipping it…"}
              style={{
                ...styleInp, resize:"none", minHeight:64, maxHeight:130,
                lineHeight:1.55, fontSize:16,
              }}
            />
          </div>
          {speech.speechError ? (
            <div style={{ fontSize:11, color:T.accent, marginTop:8, lineHeight:1.5, whiteSpace:"pre-line" }}>{speech.speechError}</div>
          ) : null}
          <div style={{ fontSize:11, color:T.hint, marginTop:12, lineHeight:1.55 }}>
            This gets saved as the first entry in your Evidence — the trail your weekly Review is built from.
          </div>
        </div>

        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button
            onClick={() => setStep(STEP_NOTIF)}
            disabled={!canContinue}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:canContinue?T.accent:T.surface, color:canContinue?"#fff":T.muted, fontSize:16, fontWeight:600, cursor:canContinue?"pointer":"default", marginBottom:10, transition:"background 0.15s" }}>
            Save my first evidence →
          </button>
          <button
            onClick={() => { setEvidenceText(""); setStep(STEP_NOTIF); }}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer" }}>
            Nothing yet — skip
          </button>
        </div>
      </div>
    );
  }

  // ── CONVERSATION — coach chat with Arc proposals ───────────────────────────
  if (step === STEP_CHAT) {
    const chatInputShown = speech.listening && speech.interim?.trim()
      ? mergeDictationIntoText(input, polishInterimDisplay(speech.interim))
      : input;
    const canSend = chatInputShown.trim() && !sending;
    const stage = inferArcCoachStage({
      msgs,
      arcPayload: {},
      isEdit: false,
      priorTurns: msgs.filter(m => m.role === "assistant").length,
    });
    const pills = !sending && !arcOptions ? getArcSuggestionPills(stage) : [];
    const showConfirmCard = selectedIdx != null && editedArc;

    return (
      <div style={{ position:"fixed", top:topInset, left:0, right:0, bottom:0, background:T.bg, display:"flex", flexDirection:"column", fontFamily:T.font, maxWidth:430, margin:"0 auto", overflow:"hidden", height:`calc(100dvh - ${topInset}px)` }}>
        <style>{`@keyframes obDot{0%,60%,100%{opacity:.2;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}`}</style>

        {skipConfirmVisible && (
          <div
            style={{ position:"absolute", inset:0, zIndex:200, background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
            onClick={() => setSkipConfirmVisible(false)}
          >
            <div style={{ background:T.raised, borderRadius:T.r, padding:24, maxWidth:320, width:"100%", boxShadow:"0 8px 32px rgba(0,0,0,0.4)" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize:17, fontWeight:700, color:T.text, marginBottom:10 }}>Skip the setup?</div>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.65, marginBottom:22 }}>
                This conversation is how your first Arc gets built. Skipping means starting with a blank app — you can set up an Arc later from Today.
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <button
                  onClick={() => { setSkipConfirmVisible(false); setTimeout(() => textareaRef.current?.focus(), 80); }}
                  style={{ padding:13, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>
                  Keep talking
                </button>
                <button
                  onClick={() => { setSkipConfirmVisible(false); setEditedArc(null); setStep(STEP_NOTIF); }}
                  style={{ padding:13, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
                  Skip anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ flexShrink:0, paddingTop:"max(12px, env(safe-area-inset-top, 12px))", paddingBottom:12, paddingLeft:20, paddingRight:20, borderBottom:`0.5px solid ${T.border}`, display:"flex", alignItems:"center", gap:10, background:T.bg, minWidth:0 }}>
          <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🤖</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.text, lineHeight:1.25 }}>Coach</div>
            <div style={{ fontSize:11, color:T.gold, marginTop:1 }}>Step {STEP_NUMBERS[STEP_CHAT]} of {DISPLAY_TOTAL}</div>
          </div>
          <button
            type="button"
            onClick={() => setSkipConfirmVisible(true)}
            style={{ flexShrink:0, background:"none", border:"none", color:T.hint, fontSize:12, cursor:"pointer", fontFamily:T.font, padding:"6px 4px", whiteSpace:"nowrap" }}>
            Skip
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={onScroll} style={{ flex:1, minHeight:0, overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch", padding:"20px 16px 8px", display:"flex", flexDirection:"column", gap:12 }}>
          {msgs.map((msg, i) =>
            msg.role === "assistant" ? (
              <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, flexShrink:0 }}>🤖</div>
                <div style={{ background:T.surface, borderRadius:"14px 14px 14px 3px", padding:"10px 16px", fontSize:15, color:T.text, lineHeight:1.65, maxWidth:"82%", whiteSpace:"pre-wrap" }}>
                  {bubbleContentForDisplay(msg.content)}
                </div>
              </div>
            ) : (
              <div key={i} style={{ display:"flex", justifyContent:"flex-end" }}>
                <div style={{ background:T.accent, borderRadius:"14px 14px 3px 14px", padding:"10px 16px", fontSize:15, color:"#fff", lineHeight:1.65, maxWidth:"82%", whiteSpace:"pre-wrap" }}>
                  {bubbleContentForDisplay(msg.content)}
                </div>
              </div>
            )
          )}

          {sending && (
            <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, flexShrink:0 }}>🤖</div>
              <div style={{ padding:"10px 16px", background:T.surface, borderRadius:"14px 14px 14px 3px", display:"flex", gap:5, alignItems:"center" }}>
                {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.muted, animation:`obDot 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
              </div>
            </div>
          )}

          {/* Arc option cards */}
          {arcOptions && !showConfirmCard && (
            <div style={{ display:"flex", flexDirection:"column", gap:10, margin:"4px 0 6px" }}>
              {arcOptions.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickOption(i)}
                  style={{
                    textAlign:"left", padding:"14px 16px", borderRadius:T.r,
                    border:"0.5px solid rgba(200,144,42,0.45)",
                    background:"linear-gradient(180deg, rgba(200,144,42,0.08), rgba(26,26,22,0.96))",
                    cursor:"pointer", fontFamily:T.font,
                  }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                    <span style={{ fontFamily:T.serif, fontSize:19, color:T.text, lineHeight:1.2 }}>
                      {opt.title || resolveArcTitle("", opt.identity)}
                    </span>
                    <span style={{ fontSize:11, color:T.gold, fontWeight:700, flexShrink:0, marginLeft:10 }}>
                      {arcDurationWeeksLabel(opt.durationDays)}
                    </span>
                  </div>
                  <div style={{ fontSize:13, color:T.sub, lineHeight:1.5, marginBottom:8 }}>{opt.identity}</div>
                  {opt.proofActions?.length > 0 && (
                    <div style={{ fontSize:12, color:T.muted, lineHeight:1.55 }}>
                      {opt.proofActions.map(p => `· ${proofActionDisplayName(p)}`).join("  ")}
                    </div>
                  )}
                  <div style={{ fontSize:12, color:T.gold, fontWeight:600, marginTop:9 }}>Pick this one →</div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setArcOptions(null); setTimeout(() => textareaRef.current?.focus(), 60); }}
                style={{ padding:"8px 0", background:"none", border:"none", color:T.muted, fontSize:12, cursor:"pointer", fontFamily:T.font }}>
                None of these fit — keep talking
              </button>
            </div>
          )}

          {/* Selected option — review / edit / confirm */}
          {showConfirmCard && (
            <div style={{
              margin:"4px 0 6px", padding:"16px 16px 14px", borderRadius:T.r,
              border:"0.5px solid rgba(200,144,42,0.5)",
              background:"linear-gradient(180deg, rgba(200,144,42,0.10), rgba(26,26,22,0.97))",
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em", textTransform:"uppercase" }}>
                  Your Arc
                </div>
                <button type="button" onClick={() => setEditingArc(e => !e)}
                  style={{ background:"none", border:"none", color:T.gold, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:T.font, padding:"2px 4px" }}>
                  {editingArc ? "Done editing" : "Edit"}
                </button>
              </div>

              {editingArc ? (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <input style={styleInp} value={editedArc.title} maxLength={40}
                    onChange={e => setEditedArc(a => ({ ...a, title: e.target.value }))} placeholder="Arc title"/>
                  <textarea style={{ ...styleInp, minHeight:56, resize:"vertical", lineHeight:1.5 }} value={editedArc.identity} maxLength={250}
                    onChange={e => setEditedArc(a => ({ ...a, identity: e.target.value }))} placeholder="Direction — one concrete sentence"/>
                  <textarea style={{ ...styleInp, minHeight:44, resize:"vertical", lineHeight:1.5 }} value={editedArc.why} maxLength={250}
                    onChange={e => setEditedArc(a => ({ ...a, why: e.target.value }))} placeholder="Why it matters (optional)"/>
                  <input style={styleInp} value={editedArc.minimumProof} maxLength={150}
                    onChange={e => setEditedArc(a => ({ ...a, minimumProof: e.target.value }))} placeholder="Bad-day minimum (optional)"/>
                  <ArcDurationEditor
                    durationDays={editedArc.durationDays}
                    onChange={d => setEditedArc(a => ({ ...a, durationDays: d }))}
                  />
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Proof actions</div>
                    {editedArc.proofActions.map((p, i) => (
                      <div key={i} style={{ display:"flex", gap:6, marginBottom:6 }}>
                        <input style={{ ...styleInp, flex:1, padding:"8px 10px", fontSize:14 }} value={proofActionDisplayName(p)} maxLength={40}
                          onChange={e => setEditedArc(a => {
                            const next = [...a.proofActions]; next[i] = e.target.value;
                            return { ...a, proofActions: next };
                          })}/>
                        <button type="button" aria-label="Remove proof action"
                          onClick={() => setEditedArc(a => ({ ...a, proofActions: a.proofActions.filter((_, j) => j !== i) }))}
                          style={{ width:34, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:T.surface, color:T.muted, fontSize:14, cursor:"pointer" }}>
                          ✕
                        </button>
                      </div>
                    ))}
                    {editedArc.proofActions.length < 5 && (
                      <button type="button"
                        onClick={() => setEditedArc(a => ({ ...a, proofActions: [...a.proofActions, ""] }))}
                        style={{ padding:"7px 12px", borderRadius:T.rsm, border:`0.5px dashed ${T.borderStrong}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer", fontFamily:T.font }}>
                        + Add proof action
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, lineHeight:1.2, marginBottom:4 }}>
                    {editedArc.title || resolveArcTitle("", editedArc.identity)}
                  </div>
                  <div style={{ fontSize:11, color:T.muted, marginBottom:12 }}>
                    {arcDurationWeeksLabel(editedArc.durationDays)} · starts today
                  </div>
                  <div style={{ fontSize:14, color:T.sub, lineHeight:1.5, marginBottom:12 }}>{editedArc.identity}</div>
                  {editedArc.minimumProof ? (
                    <div style={{ fontSize:12, color:T.muted, lineHeight:1.5, marginBottom:10 }}>
                      <span style={{ color:T.green, fontWeight:600 }}>Bad-day minimum:</span> {editedArc.minimumProof}
                    </div>
                  ) : null}
                  {editedArc.proofActions?.filter(p => proofActionDisplayName(p).trim()).length > 0 && (
                    <div style={{ marginBottom:4 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:T.hint, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>
                        Daily proof
                      </div>
                      {editedArc.proofActions.filter(p => proofActionDisplayName(p).trim()).map((p, i) => (
                        <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", marginBottom:3 }}>
                          <span style={{ fontSize:11, color:T.gold, fontWeight:700, marginTop:2, flexShrink:0 }}>·</span>
                          <span style={{ fontSize:13, color:T.text, lineHeight:1.45 }}>{proofActionDisplayName(p)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:14 }}>
                <button type="button" onClick={confirmArc}
                  disabled={!editedArc.identity?.trim()}
                  style={{ width:"100%", padding:14, borderRadius:T.rsm, border:"none", background:T.gold, color:"#0F0F0D", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:T.font }}>
                  Start this Arc →
                </button>
                <button type="button" onClick={() => { setSelectedIdx(null); setEditedArc(null); }}
                  style={{ width:"100%", padding:8, background:"none", border:"none", color:T.muted, fontSize:12, cursor:"pointer", fontFamily:T.font }}>
                  ← Back to the options
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef}/>
        </div>

        {/* Input bar */}
        {!showConfirmCard && (
          <div id="onboard-chat-input-dock" style={{ flexShrink:0, borderTop:`0.5px solid ${T.border}`, padding:"10px 14px", paddingBottom:"max(10px, env(safe-area-inset-bottom, 10px))", background:T.bg }}>
            <ArcSuggestionPills pills={pills} onPill={handleSuggestionPill} disabled={sending}/>
            <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
              {speech.supported && (
                <div style={{ flexShrink:0, alignSelf:"flex-end", marginBottom:1 }}>
                  <MicBtn speech={speech} color={T.gold} size={44} prominent/>
                </div>
              )}
              <div style={{ flex:1, position:"relative" }}>
                <textarea
                  ref={textareaRef}
                  value={chatInputShown}
                  onChange={e => setInput(e.target.value)}
                  onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px"; }}
                  onFocus={onComposerFocus}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatInputShown); } }}
                  placeholder={speech.listening ? "Listening…" : "Say it however it comes out…"}
                  disabled={sending}
                  style={{
                    width:"100%", boxSizing:"border-box",
                    background:T.surface, border:`0.5px solid ${T.borderStrong}`,
                    borderRadius:T.rsm, padding:"10px 14px",
                    // 16px font prevents iOS zoom on focus
                    fontSize:16, color:T.text, resize:"none",
                    fontFamily:T.font, lineHeight:1.5, outline:"none",
                    minHeight:"42px", maxHeight:"88px", overflowY:"auto", height:"auto",
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => sendMessage(chatInputShown)}
                disabled={!canSend}
                style={{
                  width:36, height:36, borderRadius:"50%", border:`0.5px solid ${T.border}`,
                  flexShrink:0, alignSelf:"flex-end",
                  background:canSend ? T.gold : T.surface,
                  cursor:canSend ? "pointer" : "default",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"background 0.2s",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                  <path d="M2 9h14M9 2l7 7-7 7" stroke={canSend ? "#1a1a16" : T.hint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            {speech.speechError ? (
              <div style={{ fontSize:11, color:T.accent, marginTop:8, lineHeight:1.5, whiteSpace:"pre-line" }}>{speech.speechError}</div>
            ) : null}
            {!speech.supported ? (
              <div style={{ fontSize:11, color:T.muted, marginTop:8, lineHeight:1.5 }}>Voice typing isn&apos;t available in this browser — type instead.</div>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  // ── WELCOME + NAME ──────────────────────────────────────────────────────────
  const isWelcome = step === STEP_WELCOME;
  return (
    <div style={wrap}>
      <ProgressHeader currentNum={STEP_NUMBERS[step] || 1} />

      <div style={{ flex:1, padding:"32px 24px 16px", display:"flex", flexDirection:"column", overflowY:"auto" }}>
        {isWelcome ? (
          <>
            <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, lineHeight:1.2, marginBottom:10 }}>Forged.</div>
            <div style={{ fontSize:14, color:T.muted, marginBottom:24, lineHeight:1.6 }}>
              A companion for a season of change.
            </div>
            <div style={{ background:T.raised, borderRadius:T.r, padding:"16px 18px", marginBottom:24, borderLeft:`3px solid ${T.accent}` }}>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.7 }}>
                You run your life in Arcs — a few focused weeks with one direction. You show daily proof, your coach
                keeps you honest, and every week you get a straight Review of what actually happened. Talk to it
                like a person; the mic works everywhere.
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, lineHeight:1.2, marginBottom:10 }}>First — who are you?</div>
            <div style={{ fontSize:14, color:T.muted, marginBottom:24, lineHeight:1.6 }}>Your name. That&apos;s it.</div>
            <input
              style={{ ...styleInp, fontSize:18, padding:"14px 16px", marginBottom:8 }}
              placeholder="e.g. Alex"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && name.trim()) setStep(STEP_CHAT); }}
              autoFocus
            />
          </>
        )}
      </div>

      <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
        <button
          onClick={() => {
            if (isWelcome) { setStep(STEP_NAME); return; }
            if (!name.trim()) return;
            setStep(STEP_CHAT);
          }}
          style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s" }}>
          {isWelcome ? "Let's begin" : "That's me"}
        </button>
      </div>
    </div>
  );
}
