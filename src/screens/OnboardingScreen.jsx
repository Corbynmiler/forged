import { useState, useEffect, useRef } from "react";
import { T, COLORS, HABIT_TYPES } from "../theme.js";
import { supabase, SUPABASE_ANON_KEY } from "../supabase.js";
import { todayStr, daysAgo, isLegacyProgressType, inferProgressDirection, getStreak, isSatisfiedForTodayRing } from "../utils.js";
import { Modal, GBtn, PBtn, Ring } from "../components/ui.jsx";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function cssPadXSafe(basePx) {
  return {
    paddingLeft: `max(${basePx}px, env(safe-area-inset-left, 0px))`,
    paddingRight: `max(${basePx}px, env(safe-area-inset-right, 0px))`,
  };
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const ONBOARD_STEPS = [
  {
    id:"welcome",
    title:"Forged.",
    sub:"Most habit apps track what you do. Forged helps you understand why you keep stopping.",
    body:"You already know what you want to change. The hard part is figuring out what's actually getting in the way — and why the same patterns keep derailing you. Forged is built to help you see that.",
    cta:"Let's build",
  },
  {
    id:"name",
    title:"First — who are you?",
    sub:"Your name. That's it.",
    body:null,
    cta:"That's me",
  },
  {
    id:"coach",
    title:"Meet your AI coach.",
    sub:"It reads your logs and reflections — then tells you what you can't see yourself.",
    body:null,
    cta:"Continue",
  },
  {
    id:"focus",
    title:"What are you forging?",
    sub:"Pick what matters right now. You can always add more later.",
    body:null,
    cta:"Start forging",
  },
];

const FOCUS_OPTIONS = [
  { label:"Getting stronger",     emoji:"🏋️", habitType:"weekly",   name:"Gym",         weeklyTarget:3, color:"#C0392B", reflectionPrompt:"What felt strong? What needs work?" },
  { label:"Eating better",        emoji:"🥗", habitType:"daily",    name:"Eat better",  color:"#27AE60", reflectionPrompt:"What did you actually eat today?" },
  { label:"Building something",   emoji:"⚒️", habitType:"project",  name:"My project",  color:"#2980B9", reflectionPrompt:"What did you build? Any wins or blockers?" },
  { label:"Daily movement",       emoji:"🏃", habitType:"daily",    name:"Move daily",  color:"#8E44AD", reflectionPrompt:"How did your body feel?" },
  { label:"Hitting a weight goal",emoji:"⚖️", habitType:"progress", name:"Weight goal", startValue:0, targetValue:0, unit:"kg", color:"#E67E22", reflectionPrompt:"How many meals today? Energy levels?" },
  { label:"Reading more",         emoji:"📚", habitType:"daily",    name:"Read",        color:"#C8902A", reflectionPrompt:"What's one idea worth keeping?" },
  { label:"Reducing something",   emoji:"🎯", habitType:"limit",    name:"Limit",       dailyBudget:60, unit:"min", color:"#8E44AD", reflectionPrompt:"What triggered the urge?" },
  { label:"Something else",       emoji:"✨", habitType:"daily",    name:"My habit",    color:"#C0392B", reflectionPrompt:"How did it go today?" },
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

const HABIT_ANNOTATIONS = {
  daily: "Daily habits work best when you attach them to something you already do — morning coffee, after lunch, before bed. The streak counter tracks consecutive completed days (or protected rest days).",
  weekly: "Weekly targets give you flexibility without losing accountability. You have a target number of sessions to hit each week. Log each one after it happens. Missing a day doesn't break anything — missing a week resets the streak.",
  progress: "Progress habits track a number over time — you log where you actually are today, not where you 'should' be. The trend line shows the real picture. Consistency of logging matters more than the direction of the number.",
  project: "Build habits track time spent and what you got from it. Log your minutes, a win, and what was hard. Set a daily minute target (default 60) — streaks count days you hit it, and crossing it can earn bonus XP.",
  limit: "Limit habits track what you're reducing. Each tap logs one unit against your daily budget. Streaks increase only on days you log and stay at or under your limit.",
};

export function OnboardingScreen({ onComplete, onSkip, onSaveProgress, onCheckout, notifEnabled, notifLoading, notifPermission, onNotifToggle, isCoachClient = false }) {
  const [step,            setStep]            = useState(0);
  const [name,            setName]            = useState("");
  const [coachNameInput,  setCoachNameInput]  = useState("");
  const [selected,        setSelected]        = useState([]);
  const [weightGoal,      setWeightGoal]      = useState({ start:"", target:"", unit:"kg" });
  const [limitBudget,     setLimitBudget]     = useState({ budget:"60", unit:"min", name:"" });
  const [builtHabits,     setBuiltHabits]     = useState([]);
  const [firstLogDone,    setFirstLogDone]    = useState(false);
  const [firstLogValue,   setFirstLogValue]   = useState("");
  const [showingFinal,    setShowingFinal]    = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError,   setCheckoutError]   = useState(null);
  const [enteringApp,     setEnteringApp]     = useState(false);
  // Final-screen "weekly updates by email" opt-in. Default ON; persisted to
  // profiles.weekly_updates_email_opt_in (+ _at) and localStorage (same key as
  // ProThankYouModal so both surfaces stay aligned).
  const [emailUpdatesOptIn, setEmailUpdatesOptIn] = useState(true);
  const [coachIntroMsg,     setCoachIntroMsg]     = useState(null);
  const [coachIntroLoading, setCoachIntroLoading] = useState(false);

  const current   = ONBOARD_STEPS[step];
  const isLast    = step === ONBOARD_STEPS.length - 1;
  const FOCUS_STEP = ONBOARD_STEPS.findIndex(s => s.id === "focus");
  const COACH_STEP = ONBOARD_STEPS.findIndex(s => s.id === "coach");
  const INTER_STEP = ONBOARD_STEPS.length;       // virtual step 5 (transition)
  // After the interstitial we now run Home → Notifs → First-log so that the
  // very last action inside onboarding is the user actually logging a habit —
  // a direct handoff into the real app rather than ending on a setup screen.
  const FIRST_STEP = ONBOARD_STEPS.length + 1;   // virtual: log first habit
  const HOME_STEP  = ONBOARD_STEPS.length + 2;   // virtual: add to home screen
  const NOTIF_STEP = ONBOARD_STEPS.length + 3;   // virtual: enable notifications
  const COACH_INTRO_STEP = ONBOARD_STEPS.length + 4; // templated coach message before final screen

  // Kick off the AI coach intro message as soon as we hit the interstitial —
  // that gives the API time to respond while the user reads the notif screen.
  useEffect(() => {
    if ((step !== INTER_STEP && step !== COACH_INTRO_STEP) || builtHabits.length === 0 || coachIntroMsg) return;
    const firstHabit = pickFirstHabit(builtHabits);
    setCoachIntroLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? SUPABASE_ANON_KEY;
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch("/api/coach-intro", {
          method: "POST", signal: ctrl.signal,
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ name: name.trim() || "there", habitName: firstHabit.name, habitType: firstHabit.habitType }),
        });
        clearTimeout(tid);
        if (res.ok) {
          const j = await res.json();
          if (j.message) setCoachIntroMsg(j.message);
        }
      } catch { /* fall through to static text */ }
      setCoachIntroLoading(false);
    })();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const isVirtual = step >= ONBOARD_STEPS.length;

  // Canonical 1-based step number for the progress header. The interstitial
  // shares Focus' number (it's a sub-screen), and the three virtual post-focus
  // steps are reordered visually: Home (6) → Notifs (7) → First log (8).
  const DISPLAY_TOTAL = 5;
  function displayStepNumber(s) {
    if (s === INTER_STEP) return 4;   // Focus' number — interstitial is a transition
    if (s === NOTIF_STEP) return 4;   // notifications is still part of setup
    if (s === FIRST_STEP) return 5;   // (kept for safety, not shown in normal flow)
    if (s === COACH_INTRO_STEP) return 5; // merged coach+first-log is the finale
    return Math.min(s + 1, 4);        // standard steps 0..3 → 1..4
  }
  const progressNumber = displayStepNumber(step);

  function toggleFocus(label) {
    setSelected(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]);
  }

  // ── One-tap focus picker ─────────────────────────────────────────────────────
  // Tapping a focus tile now:
  //   1. (If we haven't already built a starter habit this session) builds one
  //      synchronously from the tile's own per-tile defaults via
  //      buildHabitFromOption — preserves habitType (weekly/project/limit/etc),
  //      emoji, color, and reflectionPrompt. No DB write here; the habit is
  //      committed atomically with the rest of onboarding via onSaveProgress
  //      at the very end, so a user who bails out of onboarding doesn't leave
  //      orphan rows behind.
  //   2. Marks the tile as selected (drives the existing checkmark UI) and
  //      runs a brief confirm-pulse so the tap feels acknowledged.
  //   3. Advances to INTER_STEP after a short beat.
  // If a starter habit already exists in builtHabits (e.g. user navigated back
  // to FOCUS_STEP somehow), we skip the build and just advance.
  const [tappedFocus, setTappedFocus] = useState(null);
  const [advancing,   setAdvancing]   = useState(false);
  function pickFocusAndAdvance(opt) {
    if (advancing) return; // guard against double-tap
    if (builtHabits.length === 0) {
      const habit = buildHabitFromOption(opt, weightGoal, limitBudget);
      setBuiltHabits([habit]);
    }
    setSelected([opt.label]);
    setTappedFocus(opt.label);
    setAdvancing(true);
    setTimeout(() => setStep(INTER_STEP), 280);
  }

  function buildHabitFromOption(opt, wg, lb) {
    const base = {
      id: Date.now() + Math.random() + "",
      name:opt.name, emoji:opt.emoji, habitType:opt.habitType,
      color:opt.color, reflection:true, reflectionPrompt:opt.reflectionPrompt,
      streak:0, bestStreak:0, logs:[],
    };
    if (opt.habitType === "weekly")   return { ...base, weeklyTarget:opt.weeklyTarget || 3 };
    if (isLegacyProgressType(opt.habitType)) {
      const start = parseFloat(wg.start)||70;
      const target = parseFloat(wg.target)||80;
      return { ...base, startValue:start, targetValue:target, direction:inferProgressDirection(start, target), unit:wg.unit||"kg" };
    }
    if (opt.habitType === "limit")    return { ...base, name:lb.name||opt.name, dailyBudget:parseInt(lb.budget)||60, unit:lb.unit||"min" };
    if (opt.habitType === "project")  return { ...base, dailyTargetMinutes: 60 };
    return base;
  }

  // Pick the most interesting habit to feature first
  function pickFirstHabit(habits) {
    const priority = ["progress","project","weekly","limit","daily"];
    for (const type of priority) {
      const found = habits.find(h => h.habitType === type);
      if (found) return found;
    }
    return habits[0];
  }

  function handleContinue() {
    if (step === 1 && !name.trim()) return;
    if (isLast) {
      // Build habits and move to virtual interstitial step
      const selectedOptions = FOCUS_OPTIONS.filter(o => selected.includes(o.label));
      const habits = selectedOptions.map(opt => buildHabitFromOption(opt, weightGoal, limitBudget));
      setBuiltHabits(habits);
      setStep(INTER_STEP);
      return;
    }
    setStep(s => s + 1);
  }

  function habitsSaved() {
    // Build the log entry if the user filled it in during FIRST_STEP
    if (builtHabits.length === 0) return builtHabits;
    const firstHabit = pickFirstHabit(builtHabits);
    if (!firstLogDone) return builtHabits;
    const logEntry = buildFirstLog(firstHabit, firstLogValue);
    return builtHabits.map(h => h.id === firstHabit.id ? { ...h, logs:[logEntry] } : h);
  }

  async function handleEnterApp() {
    if (enteringApp) return;
    setEnteringApp(true);
    try {
      await Promise.race([
        onSaveProgress({ name:name.trim()||"You", habits:habitsSaved(), coachName:coachNameInput.trim()||"Coach", emailUpdatesOptIn }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
      ]);
      onComplete();
    } catch {
      onComplete();
    }
  }

  async function handleGoPro() {
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      await onSaveProgress({ name:name.trim()||"You", habits:habitsSaved(), coachName:coachNameInput.trim()||"Coach", emailUpdatesOptIn });
      await onCheckout();
    } catch(err) {
      setCheckoutError(err.message || "Something went wrong. Try again.");
      setCheckoutLoading(false);
    }
  }

  function buildFirstLog(habit, rawVal) {
    const today = todayStr();
    if (habit.habitType === "daily" || habit.habitType === "weekly") {
      return { date:today, value:true, note:"" };
    }
    if (isLegacyProgressType(habit.habitType)) {
      return { date:today, value:parseFloat(rawVal) || (habit.startValue || 0), note:"" };
    }
    if (habit.habitType === "project") {
      return { date:today, value:{ minutes:parseInt(rawVal)||30, win:null, hardPart:null }, note:"" };
    }
    if (habit.habitType === "limit") {
      return { date:today, value:parseInt(rawVal)||1, note:"" };
    }
    return { date:today, value:true, note:"" };
  }

  const hasWeight = selected.includes("Hitting a weight goal");
  const hasLimit  = selected.includes("Reducing something");

  const styleInp = {
    width:"100%", border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm,
    background:T.surface, padding:"10px 12px", fontSize:16, color:T.text,
    outline:"none", boxSizing:"border-box",
  };

  const wrap = {
    fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100dvh", background:T.bg, display:"flex", flexDirection:"column",
    paddingTop: "env(safe-area-inset-top, 0px)",
  };

  // Shared progress header — slim bar + "Step X of Y" label. Replaces the red
  // dot row that used to feel opaque. `currentNum` is 1-based.
  function ProgressHeader({ currentNum, total = DISPLAY_TOTAL }) {
    const pct = Math.max(0, Math.min(100, Math.round((currentNum / total) * 100)));
    return (
      <div style={{ paddingTop: 24, paddingBottom: 0, ...cssPadXSafe(24) }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
          <div style={{ fontSize:10, fontWeight:600, color:T.muted, textTransform:"uppercase", letterSpacing:"0.12em" }}>
            Step {currentNum} of {total}
          </div>
          <div style={{ fontSize:10, fontWeight:500, color:T.hint, letterSpacing:"0.04em" }}>
            {pct}%
          </div>
        </div>
        <div style={{ height:3, width:"100%", background:T.surface, borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:T.accent, borderRadius:2, transition:"width 0.35s cubic-bezier(0.22,1,0.36,1)" }}/>
        </div>
      </div>
    );
  }

  // ── Final screen: you're in ──────────────────────────────────────────────────
  if (showingFinal) {
    return (
      <div style={wrap}>
        <style>{`
          @keyframes finalHeroIn { from { opacity:0; transform:translateY(14px) scale(0.96); } to { opacity:1; transform:none; } }
          @keyframes finalItemIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        `}</style>
        <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", padding:"48px 24px 32px", overflowY:"auto" }}>
          <div style={{ width:"100%", maxWidth:360, margin:"0 auto", textAlign:"center" }}>
            {/* Hero */}
            <div style={{ animation:"finalHeroIn 0.6s cubic-bezier(0.22,1,0.36,1) both" }}>
              <div style={{ position:"relative", display:"inline-block", marginBottom:22 }}>
                <div style={{ position:"absolute", inset:-18, background:"radial-gradient(circle, rgba(200,144,42,0.22) 0%, rgba(200,144,42,0) 70%)", borderRadius:"50%", zIndex:0, pointerEvents:"none" }}/>
                <div style={{ position:"relative", fontSize:56, lineHeight:1, zIndex:1 }}>⚒️</div>
              </div>
              <div style={{ fontSize:11, fontWeight:600, color:T.gold, textTransform:"uppercase", letterSpacing:"0.14em", marginBottom:12 }}>
                You&apos;re forged in
              </div>
              <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, marginBottom:12, lineHeight:1.15, letterSpacing:"-0.005em" }}>
                Let&apos;s build, {name.trim() || "you"}.
              </div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7, maxWidth:300, margin:"0 auto 28px" }}>
                Your habits are ready. Log consistently, reflect when it matters, and let the patterns show you what&apos;s working.
              </div>
            </div>

            {/* Coach client: skip paywall, show "full access included" card */}
            {isCoachClient ? (
              <div style={{
                position:"relative",
                background:"linear-gradient(145deg, rgba(39,174,96,0.13) 0%, rgba(39,174,96,0.04) 100%)",
                border:"1px solid rgba(39,174,96,0.45)",
                borderRadius:18,
                padding:"18px 18px 16px",
                marginBottom:16,
                textAlign:"left",
                boxShadow:"0 8px 28px rgba(39,174,96,0.08)",
                animation:"finalItemIn 0.55s 0.15s cubic-bezier(0.22,1,0.36,1) both",
              }}>
                <div style={{ position:"absolute", top:-10, left:14, background:"#27AE60", color:"#fff", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", padding:"3px 9px", borderRadius:6 }}>
                  Included with your coach
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, marginTop:4 }}>
                  <div style={{ fontSize:22 }}>⚡</div>
                  <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, lineHeight:1.2 }}>
                    Forged Pro — Free
                  </div>
                  <div style={{ marginLeft:"auto", fontSize:12, color:"#27AE60", fontWeight:600 }}>
                    $0/mo
                  </div>
                </div>
                <div style={{ fontSize:12, color:T.sub, lineHeight:1.65 }}>
                  Your coach has unlocked full access for you — unlimited habits, AI coaching, voice logging, and complete history.
                </div>
              </div>
            ) : (
              /* Pro upsell card — clearly the premium path, not a footnote. */
              <div style={{
                position:"relative",
                background:"linear-gradient(145deg, rgba(200,144,42,0.12) 0%, rgba(200,144,42,0.04) 100%)",
                border:"1px solid rgba(200,144,42,0.45)",
                borderRadius:18,
                padding:"18px 18px 16px",
                marginBottom:16,
                textAlign:"left",
                boxShadow:"0 8px 28px rgba(200,144,42,0.08)",
                animation:"finalItemIn 0.55s 0.15s cubic-bezier(0.22,1,0.36,1) both",
              }}>
                <div style={{ position:"absolute", top:-10, left:14, background:T.gold, color:"#0F0F0D", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", padding:"3px 9px", borderRadius:6 }}>
                  Recommended
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, marginTop:4 }}>
                  <div style={{ fontSize:22 }}>⚡</div>
                  <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, lineHeight:1.2 }}>
                    Forged Pro
                  </div>
                  <div style={{ marginLeft:"auto", fontSize:12, color:T.gold, fontWeight:600 }}>
                    $4.99/mo
                  </div>
                </div>
                <div style={{ fontSize:12, color:T.sub, lineHeight:1.65, marginBottom:12 }}>
                  Unlimited AI coaching, unlimited habits, voice logging, friend nudges, and full history — everything you need to actually understand your patterns.
                </div>
                <button
                  onClick={handleGoPro}
                  disabled={checkoutLoading}
                  style={{
                    width:"100%", padding:"13px 0", borderRadius:12, border:"none",
                    background:T.gold, color:"#0F0F0D",
                    fontSize:14, fontWeight:700, letterSpacing:"0.01em",
                    cursor:checkoutLoading?"not-allowed":"pointer",
                    opacity:checkoutLoading?0.7:1,
                    fontFamily:T.font,
                    transition:"opacity 0.15s",
                  }}
                >
                  {checkoutLoading ? "Opening checkout…" : "Unlock Forged Pro →"}
                </button>
                {checkoutError && <p style={{ fontSize:12, color:"#e05c5c", marginTop:10, lineHeight:1.5 }}>{checkoutError}</p>}
              </div>
            )}

            {/* Primary CTA — enter app */}
            <button
              onClick={handleEnterApp}
              disabled={enteringApp}
              style={{
                width:"100%", padding:"15px 0", borderRadius:12,
                border:`1.5px solid ${isCoachClient ? "#27AE60" : T.accent}`,
                background: enteringApp ? T.raised : isCoachClient ? "rgba(39,174,96,0.12)" : T.raised,
                color: enteringApp ? T.muted : T.text,
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

            {/* Email updates opt-in — pre-checked; profiles + forged_beta_email_opt_in */}
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

  // ── Virtual step: merged coach intro + first log ─────────────────────────────
  // FIRST_STEP is no longer a separate screen — we go straight from NOTIF_STEP
  // to COACH_INTRO_STEP, which now handles both the coach welcome and first log.
  if ((step === FIRST_STEP || step === COACH_INTRO_STEP) && builtHabits.length > 0) {
    const firstHabit = pickFirstHabit(builtHabits);
    const ht = firstHabit.habitType === "progress" ? "goal" : firstHabit.habitType;
    const habitTypePhrase =
      ht === "project" ? "build" : ht === "goal" ? "goal" :
      ht === "daily" ? "daily" : ht === "weekly" ? "weekly" :
      ht === "limit" ? "limit" : "habit";
    const coachIntroBody =
      `You've got ${firstHabit.name} set up. Most people who track ${habitTypePhrase} habits find the first two weeks are the hardest — not because of willpower, but because the habit hasn't been tied to anything. Once you've got a few logs in, I can show you exactly where things tend to slip. Ask me anything.`;

    const isProject = firstHabit.habitType === "project";
    const isLimit   = firstHabit.habitType === "limit";
    const isGoal    = isLegacyProgressType(firstHabit.habitType);
    const isSimple  = !isProject && !isLimit && !isGoal; // daily / weekly

    // Limit habit preset buttons: None / half / full
    const limitHalf = Math.round((firstHabit.dailyBudget || 60) / 2);
    const limitFull = firstHabit.dailyBudget || 60;
    const limitUnit = firstHabit.unit || "min";
    const limitPresets = [
      { label: "None yet", value: "0" },
      { label: `${limitHalf} ${limitUnit}`, value: String(limitHalf) },
      { label: `${limitFull} ${limitUnit}`, value: String(limitFull) },
    ];

    // Project needs a time selection before logging; others don't require a value
    const projectReady = isProject && !!firstLogValue;
    const canLog = !isProject || projectReady;

    function doLog() {
      if (!canLog) return;
      setFirstLogDone(true);
      setShowingFinal(true);
    }

    return (
      <div style={wrap}>
        <ProgressHeader currentNum={progressNumber} />

        <div style={{ flex:1, padding:"28px 24px 16px", overflowY:"auto", display:"flex", flexDirection:"column", gap:20 }}>

          {/* Coach bubble */}
          <div style={{ background:"rgba(200,144,42,0.07)", border:`0.5px solid rgba(200,144,42,0.2)`, borderRadius:T.r, padding:"20px 20px 16px" }}>
            <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
              <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🤖</div>
              <div style={{ fontSize:13, fontWeight:500, color:T.text }}>{coachNameInput.trim() || "Coach"}</div>
            </div>
            <div style={{ background:T.surface, borderRadius:"12px 12px 12px 3px", padding:"12px 16px", fontSize:14, color:T.text, lineHeight:1.7, borderLeft:`2px solid rgba(200,144,42,0.35)`, opacity:coachIntroLoading ? 0.45 : 1, transition:"opacity 0.4s" }}>
              {coachIntroMsg || coachIntroBody}
            </div>
          </div>

          {/* First log section */}
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:T.muted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>
              Log your first entry
            </div>

            {/* Habit pill */}
            <div style={{ display:"flex", alignItems:"center", gap:10, background:T.raised, borderRadius:T.rsm, padding:"12px 14px", border:`0.5px solid ${T.border}`, marginBottom:16 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:firstHabit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{firstHabit.emoji}</div>
              <div>
                <div style={{ fontSize:14, fontWeight:500, color:T.text }}>{firstHabit.name}</div>
                <div style={{ fontSize:11, color:T.muted }}>{HABIT_TYPES[firstHabit.habitType]?.label}</div>
              </div>
            </div>

            {/* Daily / weekly — no input needed, just confirm */}
            {isSimple && (
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>
                Tap below to mark today as done — you'll log it the same way every day from the Today screen.
              </div>
            )}

            {/* Project — time buttons */}
            {isProject && (
              <>
                <div style={{ fontSize:13, color:T.sub, marginBottom:12, lineHeight:1.6 }}>
                  How long did you work on it today?
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {[15,30,45,60,90].map(m => (
                    <button key={m} onClick={() => setFirstLogValue(String(m))}
                      style={{ padding:"9px 16px", borderRadius:20, border:`1px solid ${firstLogValue===String(m)?firstHabit.color:T.borderStrong}`, background:firstLogValue===String(m)?firstHabit.color+"22":"none", color:firstLogValue===String(m)?firstHabit.color:T.sub, fontSize:13, cursor:"pointer", transition:"all 0.15s" }}>
                      {m}m
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Limit — clear preset buttons + custom input */}
            {isLimit && (
              <>
                <div style={{ fontSize:13, color:T.sub, marginBottom:12, lineHeight:1.6 }}>
                  How much have you used so far today? Your daily limit is {limitFull} {limitUnit}.
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
                  {limitPresets.map(p => (
                    <button key={p.label} onClick={() => setFirstLogValue(p.value)}
                      style={{ padding:"9px 16px", borderRadius:20, border:`1px solid ${firstLogValue===p.value?firstHabit.color:T.borderStrong}`, background:firstLogValue===p.value?firstHabit.color+"22":"none", color:firstLogValue===p.value?firstHabit.color:T.sub, fontSize:13, cursor:"pointer", transition:"all 0.15s" }}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  placeholder={`Custom (${limitUnit})`}
                  value={firstLogValue}
                  onChange={e => setFirstLogValue(e.target.value)}
                  style={{ ...styleInp, fontSize:15 }}
                />
              </>
            )}

            {/* Progress / goal — number input */}
            {isGoal && (
              <>
                <div style={{ fontSize:13, color:T.sub, marginBottom:10, lineHeight:1.6 }}>
                  What's your current {firstHabit.unit || "value"}?
                </div>
                <input
                  type="number" step="0.1"
                  placeholder={`e.g. ${firstHabit.startValue || 70}`}
                  value={firstLogValue}
                  onChange={e => setFirstLogValue(e.target.value)}
                  style={{ ...styleInp, fontSize:15 }}
                  autoFocus
                />
              </>
            )}
          </div>
        </div>

        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button
            type="button"
            onClick={doLog}
            disabled={!canLog}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:canLog?T.accent:T.surface, color:canLog?"#fff":T.muted, fontSize:16, fontWeight:500, cursor:canLog?"pointer":"default", transition:"all 0.2s" }}
          >
            {isSimple ? "Done today ✓  Start logging →" : "Log it & start →"}
          </button>
          <button
            type="button"
            onClick={() => setShowingFinal(true)}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer", marginTop:6 }}
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // ── Virtual step 5: enable notifications ────────────────────────────────────
  if (step === NOTIF_STEP) {
    const blocked = notifPermission === "denied";
    const already = notifEnabled;

    return (
      <div style={wrap}>
        {/* Progress dots */}
        <ProgressHeader currentNum={progressNumber} />

        <div style={{ flex:1, padding:"40px 24px 16px", overflowY:"auto", display:"flex", flexDirection:"column", justifyContent:"center" }}>
          {/* Hero */}
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:52, marginBottom:14, lineHeight:1 }}>🔔</div>
            <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, lineHeight:1.2, marginBottom:10 }}>
              Stay on track.
            </div>
            <div style={{ fontSize:14, color:T.muted, lineHeight:1.6, maxWidth:300, margin:"0 auto" }}>
              One reminder a day. We send it when it matters most — at the end of the day, when you still have time to log.
            </div>
          </div>

          {/* Benefit rows */}
          <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:28 }}>
            {[
              { icon:"🔥", title:"Streak protection", desc:"Get nudged before your streak breaks." },
              { icon:"🎯", title:"Goal countdowns", desc:"Know when a deadline is approaching." },
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
            <button
              onClick={() => builtHabits.length > 0 ? setStep(COACH_INTRO_STEP) : setShowingFinal(true)}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", marginBottom:10 }}
            >
              Reminders on — let's go ✓
            </button>
          ) : (
            <button
              onClick={async () => {
                if (onNotifToggle) await onNotifToggle();
                if (builtHabits.length > 0) setStep(COACH_INTRO_STEP); else setShowingFinal(true);
              }}
              disabled={notifLoading || blocked}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:blocked?T.surface:T.gold, color:blocked?T.muted:"#0F0F0D", fontSize:16, fontWeight:600, cursor:blocked?"not-allowed":"pointer", opacity:(notifLoading||blocked)?0.7:1, marginBottom:10, transition:"opacity 0.15s" }}
            >
              {notifLoading ? "Enabling…" : blocked ? "Notifications blocked" : "Enable daily reminders 🔔"}
            </button>
          )}
          <button
            onClick={() => builtHabits.length > 0 ? setStep(COACH_INTRO_STEP) : setShowingFinal(true)}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer" }}
          >
            Skip notifications
          </button>
        </div>
      </div>
    );
  }

  // ── Virtual step 5: interstitial ─────────────────────────────────────────────
  if (step === INTER_STEP) {
    const count = builtHabits.length;
    const firstName = name.trim() || "Hey";
    const firstHabit = builtHabits.length > 0 ? pickFirstHabit(builtHabits) : null;

    return (
      <div style={wrap}>
        <ProgressHeader currentNum={progressNumber} />

        <div style={{ flex:1, padding:"48px 24px 16px", display:"flex", flexDirection:"column", justifyContent:"center" }}>
          <div style={{ background:"rgba(200,144,42,0.07)", border:`0.5px solid rgba(200,144,42,0.2)`, borderRadius:T.r, padding:"20px 20px 16px", marginBottom:24 }}>
            <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
              <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🤖</div>
              <div style={{ fontSize:13, fontWeight:500, color:T.text }}>{coachNameInput.trim() || "Coach"}</div>
            </div>
            <div style={{ background:T.surface, borderRadius:"12px 12px 12px 3px", padding:"12px 16px", fontSize:14, color:T.text, lineHeight:1.7, borderLeft:`2px solid rgba(200,144,42,0.35)` }}>
              {firstName}, I've set up {count} habit{count !== 1 ? "s" : ""} based on what you picked. I'll explain what each one means as you go. Let's look at your first one.
            </div>
          </div>

          {firstHabit && (
            <div style={{ background:T.raised, borderRadius:T.rsm, padding:"14px 16px", border:`0.5px solid ${T.border}`, display:"flex", alignItems:"center", gap:12, opacity:0.7 }}>
              <div style={{ fontSize:24 }}>{firstHabit.emoji}</div>
              <div>
                <div style={{ fontSize:14, fontWeight:500, color:T.text }}>{firstHabit.name}</div>
                <div style={{ fontSize:12, color:T.muted }}>{HABIT_TYPES[firstHabit.habitType]?.label}</div>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button onClick={() => setStep(NOTIF_STEP)}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:500, cursor:"pointer" }}>
            Let's go →
          </button>
        </div>
      </div>
    );
  }

  // ── Standard steps 0–4 ───────────────────────────────────────────────────────
  return (
    <div style={wrap}>
      <ProgressHeader currentNum={progressNumber} />

      <div style={{ flex:1, padding:"32px 24px 16px", display:"flex", flexDirection:"column", overflowY:"auto" }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, lineHeight:1.2, marginBottom:10 }}>{current.title}</div>
        <div style={{ fontSize:14, color:T.muted, marginBottom:24, lineHeight:1.6 }}>{current.sub}</div>

        {current.body && (
          <div style={{ background:T.raised, borderRadius:T.r, padding:"16px 18px", marginBottom:24, borderLeft:`3px solid ${T.accent}` }}>
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.7 }}>{current.body}</div>
          </div>
        )}

        {step === 1 && (
          <input
            style={{ ...styleInp, fontSize:18, padding:"14px 16px", marginBottom:8 }}
            placeholder="e.g. Alex"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleContinue()}
            autoFocus
          />
        )}

        {step === COACH_STEP && (
          <div>
            <div style={{ background:"rgba(200,144,42,0.08)", border:`0.5px solid rgba(200,144,42,0.25)`, borderRadius:T.r, padding:"16px 18px", marginBottom:20 }}>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                <div style={{ width:44, height:44, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🤖</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:500, color:T.text }}>Your coach knows your habits</div>
                  <div style={{ fontSize:11, color:T.gold, marginTop:2 }}>⚡ Real context, not generic tips</div>
                </div>
              </div>
              <div style={{ background:T.surface, borderRadius:"12px 12px 12px 3px", padding:"10px 14px", fontSize:13, color:T.muted, lineHeight:1.6, borderLeft:`2px solid rgba(200,144,42,0.3)` }}>
                "Hey {name || "there"} — once you start logging, I can see exactly what's working and where things fall apart. Ask me anything."
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { icon:"🔍", text:"Finds patterns in your logs — like why you always skip Thursdays" },
                { icon:"💬", text:"Answers in plain language, based on your real data" },
                { icon:"⚡", text:"Can log habits, create new ones, and help you reflect" },
              ].map(({ icon, text }) => (
                <div key={text} style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"10px 14px", background:T.raised, borderRadius:T.rsm, border:`0.5px solid ${T.border}` }}>
                  <span style={{ fontSize:16, flexShrink:0, marginTop:1 }}>{icon}</span>
                  <span style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === FOCUS_STEP && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
              {FOCUS_OPTIONS.map(opt => {
                const isOn = selected.includes(opt.label);
                const wasTapped = tappedFocus === opt.label;
                return (
                  <button key={opt.label} onClick={() => pickFocusAndAdvance(opt)}
                    disabled={advancing && !wasTapped}
                    style={{
                      padding:"14px 12px", borderRadius:T.rsm,
                      border:`1.5px solid ${isOn?opt.color:T.borderStrong}`,
                      background:isOn?opt.color+"20":T.surface,
                      cursor: advancing ? "default" : "pointer",
                      textAlign:"left",
                      transition:"transform 0.18s ease-out, background 0.15s, border 0.15s, opacity 0.15s",
                      opacity: advancing && !wasTapped ? 0.4 : 1,
                      transform: wasTapped ? "scale(1.02)" : "scale(1)",
                      position:"relative",
                    }}>
                    {isOn && (
                      <div style={{
                        position:"absolute", top:8, right:8,
                        width:18, height:18, borderRadius:"50%",
                        background:opt.color,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        animation: wasTapped ? "focusCheckPop 0.3s ease-out" : "none",
                      }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    )}
                    <div style={{ fontSize:22, marginBottom:6 }}>{opt.emoji}</div>
                    <div style={{ fontSize:12, fontWeight:500, color:isOn?opt.color:T.text, lineHeight:1.3 }}>{opt.label}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize:12, color:T.muted, textAlign:"center", marginTop:4 }}>
              Tap one to get started — you can add more inside the app.
            </div>
          </>
        )}
      </div>

      {step !== FOCUS_STEP && (
        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button
            onClick={handleContinue}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s" }}>
            {current.cta}
          </button>
        </div>
      )}
    </div>
  );
}
