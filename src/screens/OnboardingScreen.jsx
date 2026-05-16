import { useState, useEffect, useRef } from "react";
import { T, COLORS, HABIT_TYPES } from "../theme.js";
import { supabase, SUPABASE_ANON_KEY } from "../supabase.js";
import { todayStr, daysAgo, isLegacyProgressType, inferProgressDirection, getStreak, isSatisfiedForTodayRing } from "../utils.js";
import { Modal, GBtn, PBtn, Ring } from "../components/ui.jsx";
import { useSpeechInput, MicBtn } from "../hooks/useSpeechInput.jsx";

const ONBOARD_STREAM_ID = "__ob_stream__";

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
    title:"Meet your AI coach",
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
  // Onboarding chat state
  const [onboardMsgs,        setOnboardMsgs]        = useState([]);
  const [onboardInput,       setOnboardInput]        = useState("");
  const [onboardSending,     setOnboardSending]      = useState(false);
  const [habitCreatedInChat, setHabitCreatedInChat]  = useState(false);
  const [skipConfirmVisible, setSkipConfirmVisible]  = useState(false);
  const chatEndRef  = useRef(null);
  const textareaRef = useRef(null);

  const speech = useSpeechInput({
    onTranscript: (text, isFinal) => {
      if (isFinal) setOnboardInput(prev => (prev + " " + text).trim());
    },
  });

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

  // Fetch the onboarding chat opener when the chat screen first appears.
  useEffect(() => {
    if (step !== COACH_INTRO_STEP || builtHabits.length === 0 || onboardMsgs.length > 0) return;
    const firstHabit = pickFirstHabit(builtHabits);
    setCoachIntroLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? SUPABASE_ANON_KEY;
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch("/api/onboard-chat", {
          method: "POST", signal: ctrl.signal,
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({
            name: name.trim() || "there",
            coachName: coachNameInput.trim() || "Coach",
            habitName: firstHabit.name,
            habitType: firstHabit.habitType,
            messages: [],
          }),
        });
        clearTimeout(tid);
        if (res.ok) {
          const j = await res.json();
          if (j.reply) setOnboardMsgs([{ role: "assistant", content: j.reply }]);
        }
      } catch { /* fall through — chat just stays empty until user types */ }
      setCoachIntroLoading(false);
    })();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [onboardMsgs, onboardSending]);

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

  function buildOnboardingSystem(firstName, habitName, habitType, coachName) {
    return `You are ${coachName || "Coach"}, the AI coach inside Forged — a personal habit tracking app. You are having your first conversation with ${firstName || "someone new"}.

They've chosen to track: ${habitName || "a habit"} (${habitType || "daily"} type).

CRITICAL RULE: You must call create_habit or create_goal within 2-3 messages. Do NOT keep asking questions. Ask ONE clarifying question if you need it, then just make something reasonable and create it. You can always adjust later — done is better than perfect here.

How to handle this conversation:
- If you have enough info after their first reply → create the habit/goal immediately, then confirm what you set up
- If you need one more detail → ask exactly one question, then create on the next turn no matter what
- NEVER ask more than one question before creating something
- Keep every message under 55 words — direct, warm, no filler
- Sound like a coach, not a wellness chatbot

After creating, tell them they can log from Today and chat with you anytime.`;
  }

  async function sendOnboardMessage() {
    const inputText = onboardInput.trim();
    if (!inputText || onboardSending) return;
    if (speech.listening) speech.stopListening?.();
    setOnboardInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const firstHabit = builtHabits.length > 0 ? pickFirstHabit(builtHabits) : null;
    const prev = onboardMsgs.filter(m => m.id !== ONBOARD_STREAM_ID);
    const withUser = [...prev, { role: "user", content: inputText }];
    setOnboardMsgs(withUser);
    setOnboardSending(true);

    try {
      // Prepend the hidden opener trigger so the API sees a valid alternating sequence:
      // user:"." → assistant:opener → user:msg1 → assistant:reply1 → user:msg2 …
      const apiMessages = [{ role: "user", content: "." }, ...withUser];

      // Route onboarding chat through /api/onboard-chat (no auth/quota requirements)
      // so it never burns the user's free daily coach limit during setup.
      const res = await fetch("/api/onboard-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "there",
          coachName: coachNameInput.trim() || "Coach",
          habitName: firstHabit?.name || "",
          habitType: firstHabit?.habitType || "daily",
          messages: apiMessages,
        }),
      });

      if (!res.ok) throw new Error("Request failed");

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const streamTs = Date.now();
        setOnboardMsgs(p => [...p, { role: "assistant", content: "", id: ONBOARD_STREAM_ID, ts: streamTs }]);
        setOnboardSending(false);

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
                setOnboardMsgs(p => p.map(m => m.id === ONBOARD_STREAM_ID ? { ...m, content: snap } : m));
                chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
              }
              if (evt.done) {
                const receipt = evt.receipt && String(evt.receipt).trim()
                  ? `\n\n${String(evt.receipt).trim()}` : "";
                const final = (fullText.trim() || "") + receipt;
                setOnboardMsgs(p => p.map(m =>
                  m.id === ONBOARD_STREAM_ID ? { role: "assistant", content: final || fullText, ts: m.ts } : m
                ));
                if (evt.created || evt.edited?.length) setHabitCreatedInChat(true);
              }
            } catch { /* malformed line */ }
          }
        }
      } else {
        const data = await res.json();
        setOnboardSending(false);
        setOnboardMsgs(p => [...p, { role: "assistant", content: data.reply || "" }]);
      }
    } catch {
      setOnboardSending(false);
      setOnboardMsgs(p => [
        ...p.filter(m => m.id !== ONBOARD_STREAM_ID),
        { role: "assistant", content: "Something went wrong on my end. Let's keep going." },
      ]);
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

  // ── Virtual step: onboarding chat — first real interaction with the coach ─────
  if ((step === FIRST_STEP || step === COACH_INTRO_STEP) && builtHabits.length > 0) {
    const coachDisplay  = coachNameInput.trim() || "Coach";
    const isStreaming   = onboardMsgs.some(m => m.id === ONBOARD_STREAM_ID);
    const canSend       = onboardInput.trim() && !onboardSending && !isStreaming;

    return (
      // position:fixed + inset:0 prevents iOS from zooming/scrolling the page when the keyboard opens
      <div style={{ position:"fixed", inset:0, background:T.bg, display:"flex", flexDirection:"column", fontFamily:T.font, maxWidth:430, margin:"0 auto" }}>
        <style>{`@keyframes obDot{0%,60%,100%{opacity:.2;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}`}</style>

        {/* Skip confirmation modal */}
        {skipConfirmVisible && (
          <div
            style={{ position:"absolute", inset:0, zIndex:200, background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
            onClick={() => setSkipConfirmVisible(false)}
          >
            <div style={{ background:T.raised, borderRadius:T.r, padding:24, maxWidth:320, width:"100%", boxShadow:"0 8px 32px rgba(0,0,0,0.4)" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize:17, fontWeight:700, color:T.text, marginBottom:10 }}>Skip this step?</div>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.65, marginBottom:22 }}>
                This is where you set up your first goal with your coach. Skipping means starting without any habits or goals — you can always add them later, but it's easier to do it now.
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <button
                  onClick={() => {
                    setSkipConfirmVisible(false);
                    setTimeout(() => textareaRef.current?.focus(), 80);
                  }}
                  style={{ padding:13, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}
                >
                  Let me chat with my coach
                </button>
                <button
                  onClick={() => { setSkipConfirmVisible(false); setShowingFinal(true); }}
                  style={{ padding:13, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}
                >
                  Skip anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ flexShrink:0, paddingTop:"max(16px, env(safe-area-inset-top, 16px))", paddingBottom:12, paddingLeft:20, paddingRight:20, borderBottom:`0.5px solid ${T.border}`, display:"flex", alignItems:"center", gap:12, background:T.bg }}>
          <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🤖</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.text }}>{coachDisplay}</div>
            <div style={{ fontSize:11, color:T.gold, marginTop:1 }}>Forged AI Coach · Step 5 of 5</div>
          </div>
          <div style={{ width:56, height:3, background:T.surface, borderRadius:2, overflow:"hidden", flexShrink:0 }}>
            <div style={{ width:"100%", height:"100%", background:T.accent, borderRadius:2 }}/>
          </div>
        </div>

        {/* Messages area */}
        <div style={{ flex:1, overflowY:"auto", padding:"20px 16px 8px", display:"flex", flexDirection:"column", gap:12 }}>

          {/* Opener loading */}
          {coachIntroLoading && onboardMsgs.length === 0 && (
            <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, flexShrink:0 }}>🤖</div>
              <div style={{ padding:"10px 16px", background:T.surface, borderRadius:"14px 14px 14px 3px", display:"flex", gap:5, alignItems:"center" }}>
                {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.muted, animation:`obDot 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
              </div>
            </div>
          )}

          {/* All messages */}
          {onboardMsgs.map((msg, i) =>
            msg.role === "assistant" ? (
              <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, flexShrink:0 }}>🤖</div>
                <div style={{ background:T.surface, borderRadius:"14px 14px 14px 3px", padding:"10px 16px", fontSize:15, color:T.text, lineHeight:1.65, maxWidth:"82%" }}>
                  {msg.content || (msg.id === ONBOARD_STREAM_ID
                    ? <div style={{ display:"flex", gap:5 }}>{[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.muted, animation:`obDot 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}</div>
                    : null
                  )}
                </div>
              </div>
            ) : (
              <div key={i} style={{ display:"flex", justifyContent:"flex-end" }}>
                <div style={{ background:T.accent, borderRadius:"14px 14px 3px 14px", padding:"10px 16px", fontSize:15, color:"#fff", lineHeight:1.65, maxWidth:"82%" }}>
                  {msg.content}
                </div>
              </div>
            )
          )}

          {/* Typing indicator (waiting for stream to start) */}
          {onboardSending && !isStreaming && (
            <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, flexShrink:0 }}>🤖</div>
              <div style={{ padding:"10px 16px", background:T.surface, borderRadius:"14px 14px 14px 3px", display:"flex", gap:5, alignItems:"center" }}>
                {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.muted, animation:`obDot 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
              </div>
            </div>
          )}

          <div ref={chatEndRef}/>
        </div>

        {/* Input bar — matches AICoach layout: mic · textarea · send */}
        <div style={{ flexShrink:0, borderTop:`0.5px solid ${T.border}`, padding:"10px 14px", background:T.bg }}>
          <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
            {speech.supported && (
              <div style={{ flexShrink:0, alignSelf:"flex-end", marginBottom:1 }}>
                <MicBtn speech={speech} color={T.gold} size={44} prominent/>
              </div>
            )}
            <div style={{ flex:1, position:"relative" }}>
              <textarea
                ref={textareaRef}
                value={onboardInput}
                onChange={e => setOnboardInput(e.target.value)}
                onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px"; }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendOnboardMessage(); } }}
                placeholder={coachIntroLoading ? "Coach is typing…" : "Tell your coach about yourself…"}
                disabled={onboardSending || isStreaming}
                style={{
                  width:"100%", boxSizing:"border-box",
                  background:T.surface, border:`0.5px solid ${T.borderStrong}`,
                  borderRadius:T.rsm, padding:"10px 14px",
                  // font-size 16px prevents iOS from zooming in when the field is focused
                  fontSize:16, color:T.text, resize:"none",
                  fontFamily:T.font, lineHeight:1.5, outline:"none",
                  minHeight:"42px", maxHeight:"88px", overflowY:"auto", height:"auto",
                }}
              />
            </div>
            <button
              type="button"
              onClick={sendOnboardMessage}
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
        </div>

        {/* CTA — "Start Forged →" unlocks after coach creates something; otherwise show skip with confirmation */}
        <div style={{ flexShrink:0, padding:"8px 16px", paddingBottom:"max(28px, env(safe-area-inset-bottom, 28px))", background:T.bg }}>
          {habitCreatedInChat ? (
            <button
              type="button"
              onClick={() => setShowingFinal(true)}
              style={{ width:"100%", padding:15, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer" }}
            >
              Start Forged →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSkipConfirmVisible(true)}
              style={{ width:"100%", padding:14, borderRadius:T.rsm, border:"none", background:"rgba(255,255,255,0.05)", color:T.muted, fontSize:14, cursor:"pointer" }}
            >
              Skip for now
            </button>
          )}
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
              Stay on track
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
