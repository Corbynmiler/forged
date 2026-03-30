import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, habitToRow, rowToHabit } from "./supabase.js";

// ─── DATE UTILS ───────────────────────────────────────────────────────────────
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseLocal(str) {
  const [y,m,d] = str.split("-").map(Number);
  return new Date(y, m-1, d);
}
function fmtDate(d = new Date()) {
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function weekStartFor(dateStr) {
  const d = parseLocal(dateStr), day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function currentWeekStart() { return weekStartFor(todayStr()); }
function minsToHrs(m) { return (m / 60).toFixed(1); }
function fmtEntryDate(dateStr) {
  if (dateStr === todayStr()) return "Today";
  if (dateStr === daysAgo(1)) return "Yesterday";
  const d = parseLocal(dateStr);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const T = {
  bg:"#0F0F0D", surface:"#1A1A16", raised:"#222220",
  border:"rgba(255,255,255,0.07)", borderMid:"rgba(255,255,255,0.12)", borderStrong:"rgba(255,255,255,0.16)",
  text:"#F0EDE6", sub:"#A8A49C", muted:"#6A6860", hint:"#3E3E3A",
  accent:"#C0392B", gold:"#C8902A", goldBright:"#F5C842", green:"#27AE60", amber:"#E67E22",
  r:16, rsm:10,
  font:"'DM Sans',system-ui,sans-serif",
  serif:"'DM Serif Display',Georgia,serif",
};

const COLORS = ["#C0392B","#E67E22","#27AE60","#8E44AD","#2980B9","#C8902A","#16A085","#D4537E"];

const HABIT_TYPES = {
  daily:    { label:"Daily habit",    desc:"One tap per day. Simple check-in.",              icon:"✓"  },
  weekly:   { label:"Weekly target",  desc:"Hit a session count each week.",                 icon:"📅" },
  progress: { label:"Progress goal",  desc:"Track a number climbing toward a target.",       icon:"📈" },
  project:  { label:"Build",           desc:"Log time spent, wins, and what challenged you.", icon:"⚒️" },
  limit:    { label:"Limit / reduce", desc:"Stay under a daily budget.",                     icon:"🎯" },
};

const XP_LEVELS = [
  { min:0,    label:"Unforged",  color:T.muted   },
  { min:500,  label:"Kindling",  color:"#C8902A" },
  { min:1500, label:"Tempered",  color:"#E67E22" },
  { min:3000, label:"Hardened",  color:"#C0392B" },
  { min:6000, label:"Forged",    color:"#F5C842" },
];
function getLevel(xp) {
  return XP_LEVELS.reduce((acc, l) => xp >= l.min ? l : acc, XP_LEVELS[0]);
}
function nextLevel(xp) {
  return XP_LEVELS.find(l => l.min > xp) || null;
}


// ─── COMPUTED ─────────────────────────────────────────────────────────────────
function isLoggedToday(h) {
  return h.logs.some(l => l.date === todayStr());
}
function todayLogs(h) {
  return h.logs.filter(l => l.date === todayStr());
}
function latestTodayLog(h) {
  const tl = todayLogs(h);
  return tl.length ? tl[tl.length - 1] : null;
}
function getWeeklyCount(h) {
  return h.logs.filter(l => l.date >= currentWeekStart()).length;
}
function getLatestValue(h) {
  if (!h.logs.length) return h.startValue ?? 0;
  return [...h.logs].sort((a, b) => a.date.localeCompare(b.date)).at(-1).value;
}
function getProjectStats(h) {
  const ws = currentWeekStart();
  const total = h.logs.reduce((s, l) => s + (l.value?.minutes || 0), 0);
  const week  = h.logs.filter(l => l.date >= ws).reduce((s, l) => s + (l.value?.minutes || 0), 0);
  return {
    totalHours: parseFloat(minsToHrs(total)),
    weekHours:  parseFloat(minsToHrs(week)),
    wins:       h.logs.filter(l => l.value?.win).length,
    hard:       h.logs.filter(l => l.value?.hardPart).length,
  };
}
// ── Live streak calculations (computed from logs — never stale) ───────────────
// Daily: count consecutive days going back from today where a log exists.
// If today isn't logged yet the day isn't over, so we start from yesterday.
function getDailyStreak(h) {
  const startDay = isLoggedToday(h) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    if (h.logs.some(l => l.date === daysAgo(d))) streak++;
    else break;
  }
  return streak;
}
// Limit: consecutive days where the user came back AND logged under their budget.
// Not logging at all breaks the streak — it incentivises the daily check-in.
// Logging 0 counts as a perfect day (you consciously chose not to use any).
function getLimitStreak(h) {
  const startDay = isLoggedToday(h) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    const dayLogs = h.logs.filter(l => l.date === daysAgo(d));
    if (!dayLogs.length) break;                              // missed — streak over
    const total = dayLogs.reduce((s, l) => s + (l.value || 0), 0);
    if (total <= (h.dailyBudget || Infinity)) streak++;
    else break;
  }
  return streak;
}
// Project/progress: count consecutive days with at least one session logged.
function getSessionStreak(h) {
  const startDay = isLoggedToday(h) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    if (h.logs.some(l => l.date === daysAgo(d))) streak++;
    else break;
  }
  return streak;
}
// Unified getter — returns the right streak type for any habit
function getStreak(h) {
  if (h.habitType === "weekly")  return getWeeklyStreak(h);
  if (h.habitType === "limit")   return getLimitStreak(h);
  if (h.habitType === "project" || h.habitType === "progress") return getSessionStreak(h);
  return getDailyStreak(h); // daily (default)
}
function getWeeklyStreak(h) {
  // Count consecutive Mon–Sun calendar weeks where sessions >= target.
  // Week 0 = current week. A partial current week never breaks the streak.
  const daysSinceMon = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  let streak = 0;
  for (let w = 0; w <= 52; w++) {
    const monBack   = daysSinceMon + w * 7;
    const weekStart = daysAgo(monBack);
    const weekEnd   = daysAgo(Math.max(0, monBack - 6));
    const count = h.logs.filter(l => l.date >= weekStart && l.date <= weekEnd).length;
    if (count >= h.weeklyTarget) streak++;
    else if (w > 0) break; // partial current week doesn't break streak
  }
  return streak;
}
// Longest consecutive-day run in the habit's full log history
function getBestStreak(h) {
  const dates = [...new Set(
    h.logs.filter(l => l.value !== "skip" && l.value !== "quicknote").map(l => l.date)
  )].sort();
  if (!dates.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.round((parseLocal(dates[i]) - parseLocal(dates[i - 1])) / 86400000);
    if (diff === 1) { cur++; if (cur > best) best = cur; }
    else cur = 1;
  }
  return best;
}
function getCompletionRate(h) {
  const cutoff = daysAgo(28);
  const recent = h.logs.filter(l => l.date >= cutoff);
  if (h.habitType === "weekly") {
    // Sessions logged vs ideal (target × 4 weeks)
    const ideal = h.weeklyTarget * 4;
    return Math.min(100, Math.round((recent.length / ideal) * 100));
  }
  // Build/project: ~5 active days per week is the benchmark (20/28 days)
  if (h.habitType === "project")  return Math.min(100, Math.round((recent.length / 20) * 100));
  if (h.habitType === "progress") return Math.min(100, Math.round((recent.length / 14) * 100));
  // Daily & limit: logged out of 28 calendar days
  return Math.min(100, Math.round((recent.length / 28) * 100));
}
function get7DayActivity(h) {
  return Array.from({length:7}, (_, i) => h.logs.some(l => l.date === daysAgo(6 - i)) ? 1 : 0);
}
function get12WeekGrid(h) {
  return Array.from({length:12}, (_, w) =>
    Array.from({length:7}, (_, d) => {
      const dateStr = daysAgo((11 - w) * 7 + (6 - d));
      return { date: dateStr, logged: h.logs.some(l => l.date === dateStr) };
    })
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: ${T.bg}; -webkit-tap-highlight-color: transparent; }
  ::-webkit-scrollbar { width: 0; }
  textarea, input, button { font-family: ${T.font}; }
  textarea:focus, input:focus { outline: none; }
  @keyframes burst {
    0%   { transform: translate(0,0) scale(1); opacity: 1; }
    100% { transform: translate(var(--dx),var(--dy)) scale(0); opacity: 0; }
  }
  @keyframes xpUp {
    0%   { transform: translateY(0); opacity: 1; }
    100% { transform: translateY(-38px); opacity: 0; }
  }
  @keyframes fadeUp {
    from { transform: translateY(8px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes toastSlide {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes savedFade {
    0%   { opacity: 0; transform: translateY(2px); }
    20%  { opacity: 1; transform: translateY(0); }
    70%  { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
  .tap:active { transform: scale(0.86) !important; }
  .rc { transition: border-color 0.2s, background 0.2s; }
  .rc:hover { border-color: ${T.borderMid} !important; }
  @keyframes tourSlide {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes shareSlide {
    from { transform: scale(0.95); opacity: 0; }
    to   { transform: scale(1); opacity: 1; }
  }
`;

// ─── MICRO COMPONENTS ─────────────────────────────────────────────────────────
function Particle({ x, y, color, angle, dist, onDone }) {
  const dx = Math.cos((angle * Math.PI) / 180) * dist;
  const dy = Math.sin((angle * Math.PI) / 180) * dist;
  useEffect(() => { const t = setTimeout(onDone, 600); return () => clearTimeout(t); }, []);
  return <div style={{
    position:"fixed", left:x-4, top:y-4, width:7, height:7,
    borderRadius:"50%", background:color, pointerEvents:"none", zIndex:9999,
    animation:"burst 0.55s ease-out forwards", "--dx":dx+"px", "--dy":dy+"px",
  }}/>;
}
function XPFlash({ x, y, text, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 950); return () => clearTimeout(t); }, []);
  return <div style={{
    position:"fixed", left:x-18, top:y-14, zIndex:9999,
    fontSize:13, fontWeight:500, color:T.goldBright,
    pointerEvents:"none", animation:"xpUp 0.95s ease-out forwards",
  }}>{text}</div>;
}
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, []);
  return <div style={{
    position:"fixed", bottom:92, left:"50%", transform:"translateX(-50%)",
    zIndex:9999, background:T.raised, border:`0.5px solid ${T.borderStrong}`,
    borderRadius:T.rsm, padding:"10px 18px", fontSize:13, color:T.text,
    whiteSpace:"nowrap", animation:"toastSlide 0.3s ease-out",
    boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
  }}>{msg}</div>;
}
function Ring({ pct, size = 88 }) {
  const r = size * 0.4, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth="6" stroke={T.surface}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth="6"
          stroke={pct === 100 ? T.goldBright : T.accent} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off}
          style={{ transition:"stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:16, fontWeight:500, color:T.text }}>{pct}%</span>
        <span style={{ fontSize:9, color:T.muted, letterSpacing:"0.05em", textTransform:"uppercase" }}>forged</span>
      </div>
    </div>
  );
}
function SLabel({ children }) {
  return <div style={{ padding:"4px 18px 8px", fontSize:10, fontWeight:500, letterSpacing:"0.08em", color:T.hint, textTransform:"uppercase" }}>{children}</div>;
}
function Stat({ label, value, color }) {
  return (
    <div style={{ background:T.surface, borderRadius:8, padding:"8px 10px", textAlign:"center", flex:1 }}>
      <div style={{ fontSize:15, fontWeight:500, color:color||T.text }}>{value}</div>
      <div style={{ fontSize:10, color:T.hint, marginTop:2, lineHeight:1.3 }}>{label}</div>
    </div>
  );
}
function Modal({ children, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", maxHeight:"92vh", overflowY:"auto", background:T.raised, borderRadius:"22px 22px 0 0", padding:"0 20px 60px" }}>
        <div style={{ width:36, height:4, background:T.borderStrong, borderRadius:2, margin:"14px auto 22px" }}/>
        {children}
      </div>
    </div>
  );
}
const lbl = { fontSize:10, fontWeight:500, color:T.muted, marginBottom:7, display:"block", textTransform:"uppercase", letterSpacing:"0.07em" };
const inp = { width:"100%", border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm, background:T.surface, padding:"10px 12px", fontSize:14, color:T.text, outline:"none", boxSizing:"border-box" };
function FG({ label, children, mb = 20 }) {
  return <div style={{ marginBottom:mb }}><label style={lbl}>{label}</label>{children}</div>;
}
function PBtn({ onClick, children, color }) {
  return <button onClick={onClick} style={{ width:"100%", padding:14, borderRadius:T.rsm, border:"none", background:color||T.accent, color:"#fff", fontSize:15, fontWeight:500, cursor:"pointer", marginTop:10 }}>{children}</button>;
}
function GBtn({ onClick, children }) {
  return <button onClick={onClick} style={{ width:"100%", padding:12, borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:14, cursor:"pointer", marginTop:8 }}>{children}</button>;
}
function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width:44, height:24, borderRadius:12, border:"none", cursor:"pointer", background:on?T.accent:T.surface, position:"relative", transition:"background 0.2s", flexShrink:0 }}>
      <div style={{ position:"absolute", top:3, left:on?22:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }}/>
    </button>
  );
}

// ─── DONE BANNER ─────────────────────────────────────────────────────────────
function DoneBanner({ habit }) {
  return (
    <div style={{ margin:"0 15px 12px", background:`${habit.color}18`, borderRadius:T.rsm, padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ width:20, height:20, borderRadius:"50%", background:habit.color, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M2 5.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <span style={{ fontSize:12, fontWeight:500, color:habit.color }}>Logged for today</span>
    </div>
  );
}

// ─── SPEECH-TO-TEXT ───────────────────────────────────────────────────────────
function useSpeechInput(onFinal) {
  const [listening, setListening] = useState(false);
  const [interim,   setInterim]   = useState("");
  // R holds mutable refs that must not trigger re-renders
  const R = useRef({ recog:null, stream:null, ctx:null, raf:null, ringEl:null });
  const stopping = useRef(false); // true while we're mid-teardown

  const supported = !!(typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition));

  const stopAll = useCallback((fromOnEnd = false) => {
    const r = R.current;
    stopping.current = true;

    // Cancel volume animation
    if (r.raf) { cancelAnimationFrame(r.raf); r.raf = null; }

    // Stop mic stream
    if (r.stream) { r.stream.getTracks().forEach(t => t.stop()); r.stream = null; }

    // Suspend (not close) AudioContext so it can be reused next time.
    // close() on iOS blocks creation of new contexts for ~300ms and causes silent failures.
    if (r.ctx) { try { r.ctx.suspend(); } catch {} }

    // Null out recog FIRST, then stop — this prevents the onend callback
    // (which fires async after stop()) from calling stopAll a second time.
    const recog = r.recog;
    r.recog = null;
    if (!fromOnEnd && recog) { try { recog.stop(); } catch {} }

    if (r.ringEl) { r.ringEl.style.transform = "scale(1)"; r.ringEl.style.opacity = "0"; }
    setListening(false);
    setInterim("");

    // Allow restart after a brief settling period
    setTimeout(() => { stopping.current = false; }, 350);
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  const setRingEl = useCallback(el => { R.current.ringEl = el; }, []);

  function startVolume() {
    const r = R.current;
    // Reuse existing context if suspended, otherwise create once
    if (!r.ctx) {
      try { r.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return; }
    }
    if (r.ctx.state === "suspended") r.ctx.resume().catch(() => {});

    navigator.mediaDevices?.getUserMedia({ audio:true, video:false }).then(stream => {
      if (!R.current.recog) { stream.getTracks().forEach(t => t.stop()); return; } // stopped before mic granted
      R.current.stream = stream;
      const ctx = R.current.ctx;
      if (!ctx) return;
      try {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!R.current.recog) return; // stopped — bail out of RAF loop
          analyser.getByteFrequencyData(buf);
          const avg = buf.reduce((a,b) => a+b, 0) / buf.length;
          const v   = Math.min(1, avg / 48);
          const el  = R.current.ringEl;
          if (el) { el.style.transform = `scale(${1+v*0.65})`; el.style.opacity = String(Math.max(0.12, v)); }
          R.current.raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {}
    }).catch(() => {});
  }

  function toggle() {
    if (listening || stopping.current) { if (listening) stopAll(); return; }
    if (!supported) { alert("Voice input requires Chrome or Safari."); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recog;
    try { recog = new SR(); } catch { return; }

    recog.continuous     = true;
    recog.interimResults = true;
    recog.lang           = navigator.language || "en-US";

    // Set listening only when the browser confirms recognition has started
    recog.onstart  = () => { setListening(true); };

    recog.onresult = e => {
      let iText = "";
      for (let j = e.resultIndex; j < e.results.length; j++) {
        if (e.results[j].isFinal) { onFinal(e.results[j][0].transcript.trim()); setInterim(""); }
        else iText += e.results[j][0].transcript;
      }
      if (iText) setInterim(iText);
    };

    recog.onerror = () => { stopAll(); };

    // onend fires async after stop() — only clean up if this recog is still current
    recog.onend = () => {
      if (R.current.recog === recog) stopAll(true);
      else { setListening(false); setInterim(""); }
    };

    R.current.recog = recog;
    try {
      recog.start();
      startVolume();
    } catch {
      R.current.recog = null;
      stopAll();
    }
  }

  return { listening, interim, toggle, supported, setRingEl };
}

function MicBtn({ speech, color = T.accent, size = 28 }) {
  if (!speech.supported) return null;
  const c = speech.listening ? color : T.hint;
  return (
    <button onClick={speech.toggle}
      title={speech.listening ? "Tap to stop" : "Tap to dictate"}
      style={{ position:"relative", width:size, height:size, borderRadius:"50%",
        border:`1px solid ${speech.listening ? color+"55" : T.border}`,
        background: speech.listening ? color+"14" : "transparent",
        cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
        flexShrink:0, padding:0, transition:"border-color 0.2s, background 0.2s" }}>
      {/* volume ring — animated via direct DOM in RAF loop, no React state */}
      <div ref={speech.setRingEl} style={{ position:"absolute", inset:-5, borderRadius:"50%",
        border:`1.5px solid ${color}`, opacity:0, transform:"scale(1)", pointerEvents:"none",
        transition: speech.listening ? "none" : "opacity 0.5s" }}/>
      {/* mic icon */}
      <svg width={size*0.56} height={size*0.56} viewBox="0 0 16 16" fill="none" style={{ color:c, transition:"color 0.2s" }}>
        <rect x="5" y="1" width="6" height="8" rx="3" fill="currentColor"/>
        <path d="M3 7.5a5 5 0 0 0 10 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
        <line x1="8" y1="12.5" x2="8" y2="14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="5.5" y1="14.5" x2="10.5" y2="14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    </button>
  );
}

// ─── NOTE STRIP ───────────────────────────────────────────────────────────────
// Type a quick note or dictate it, tap ✓ Done to save as a permanent entry.
// Each Done tap creates a separate note entry — multiple notes per day supported.
// "Go deeper" opens the full reflection modal.
function NoteStrip({ habitId, habit, onAddNote, onReflect }) {
  const [val, setVal] = useState("");
  const [lastSaved, setLastSaved] = useState("");

  const speech = useSpeechInput(text =>
    setVal(p => p.trim() ? p + " " + text : text)
  );

  function handleDone() {
    if (!val.trim()) return;
    speech.listening && speech.toggle(); // stop recording if active
    onAddNote(habitId, val.trim());
    setLastSaved(val.trim());
    setVal("");
  }

  return (
    <div style={{ borderTop:`0.5px solid ${T.border}`, padding:"10px 15px 12px", display:"flex", flexDirection:"column", gap:7 }}>
      {lastSaved && (
        <div style={{ fontSize:12, color:T.muted, fontStyle:"italic", borderLeft:`2px solid ${habit.color}44`, paddingLeft:8, lineHeight:1.5 }}>
          <span style={{ fontSize:10, color:T.hint, display:"block", marginBottom:2 }}>Saved ✓</span>
          {lastSaved}
        </div>
      )}
      <textarea
        rows={2} maxLength={280}
        style={{ width:"100%", border:"none", background:"none", fontSize:13, color:T.text, resize:"none", lineHeight:1.55, minHeight:36, outline:"none" }}
        placeholder={speech.listening ? "Listening…" : "Quick note…"}
        value={val}
        onChange={e => setVal(e.target.value)}
      />
      {speech.interim && (
        <div style={{ fontSize:12, color:T.hint, fontStyle:"italic", lineHeight:1.45, marginTop:-4 }}>
          {speech.interim}…
        </div>
      )}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
        <button onClick={() => onReflect(habitId)}
          style={{ fontSize:12, color:habit.color+"99", background:"none", border:"none", cursor:"pointer", fontWeight:500, padding:0 }}>
          Go deeper →
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <MicBtn speech={speech} color={habit.color} size={26}/>
          <button onClick={handleDone} disabled={!val.trim() && !speech.interim}
            style={{ fontSize:12, color:val.trim()?T.text:T.hint, background:val.trim()?habit.color+"22":"none", border:`0.5px solid ${val.trim()?habit.color+"55":T.border}`, borderRadius:T.rsm, padding:"4px 12px", cursor:val.trim()?"pointer":"default", fontWeight:500, transition:"all 0.15s" }}>
            ✓ Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CARD SHELL ───────────────────────────────────────────────────────────────
function cardStyle(logged, habit) {
  return {
    margin:"0 14px 10px", borderRadius:T.r, overflow:"hidden",
    animation:"fadeUp 0.3s ease-out",
    border:`0.5px solid ${logged ? habit.color+"66" : T.border}`,
    background: logged ? `${habit.color}0D` : T.raised,
  };
}
function IconBox({ habit, logged }) {
  return (
    <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:logged?habit.color+"33":habit.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>
      {habit.emoji}
    </div>
  );
}
function CheckBtn({ logged, habit, onClick }) {
  return (
    <button className="tap" onClick={onClick} style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${logged?habit.color:habit.color+"55"}`, background:logged?habit.color:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.18s" }}>
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
        <path d="M4 8.5l3.5 3.5 6-7" stroke={logged?"#fff":habit.color+"88"} strokeWidth={logged?2.5:1.5} strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}
function PlusBtn({ habit, logged, onClick }) {
  return (
    <button className="tap" onClick={onClick} style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${logged?habit.color:habit.color+"66"}`, background:logged?habit.color+"22":"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:habit.color, fontWeight:300, transition:"all 0.18s" }}>+</button>
  );
}

// ─── HABIT CARDS ─────────────────────────────────────────────────────────────

function DailyCard({ habit, onTap, onSkip, onReflect, onAddNote }) {
  const tLog  = latestTodayLog(habit);
  const logged = isLoggedToday(habit);
  const isSkip = tLog?.value === "skip";
  return (
    <div className="rc" style={cardStyle(logged && !isSkip, habit)}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged && !isSkip}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            Daily{getStreak(habit) > 0 ? ` · 🔥 ${getStreak(habit)} days` : ""}
          </div>
        </div>
        {isSkip
          ? <button className="tap" onClick={() => onTap(habit.id, { currentTarget: { getBoundingClientRect: () => ({left:0,top:0,width:0,height:0}) } })}
              style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${T.muted}`, background:T.surface, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, transition:"all 0.18s" }}>
              🛡️
            </button>
          : <CheckBtn logged={logged} habit={habit} onClick={e => onTap(habit.id, e)}/>
        }
      </div>
      {isSkip && (
        <div style={{ margin:"0 15px 12px", background:"rgba(106,104,96,0.15)", borderRadius:T.rsm, padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>🛡️</span>
          <span style={{ fontSize:12, fontWeight:500, color:T.muted }}>Rest day — streak protected</span>
        </div>
      )}
      {logged && !isSkip && <DoneBanner habit={habit}/>}
      {logged && !isSkip && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote} onReflect={onReflect}/>}
      {!logged && (
        <div style={{ padding:"0 15px 10px", display:"flex", justifyContent:"flex-end" }}>
          <button onClick={() => onSkip(habit.id)}
            style={{ fontSize:12, color:T.hint, background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
            🛡️ Rest day
          </button>
        </div>
      )}
    </div>
  );
}

function WeeklyCard({ habit, onTap, onReflect, onAddNote }) {
  const logged = isLoggedToday(habit);
  const wk = getWeeklyCount(habit);
  const streak = getWeeklyStreak(habit);
  const pct = Math.min(100, Math.round((wk / habit.weeklyTarget) * 100));
  const tLog = latestTodayLog(habit);
  return (
    <div className="rc" style={cardStyle(logged, habit)}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            {wk}/{habit.weeklyTarget} sessions this week
            {streak > 0 ? ` · 🔥 ${streak} wk streak` : ""}
          </div>
        </div>
        <CheckBtn logged={logged} habit={habit} onClick={e => onTap(habit.id, e)}/>
      </div>
      <div style={{ padding:"0 15px 14px" }}>
        <div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden", marginBottom:8 }}>
          <div style={{ height:"100%", borderRadius:3, background:pct>=100?T.goldBright:habit.color, width:`${pct}%`, transition:"width 0.5s ease" }}/>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {Array.from({length:habit.weeklyTarget}, (_, i) => (
            <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:i<wk?habit.color:T.surface, transition:"background 0.3s" }}/>
          ))}
          <span style={{ fontSize:11, color:T.muted, marginLeft:"auto" }}>
            {wk >= habit.weeklyTarget ? "Target hit! 🎉" : `${habit.weeklyTarget - wk} more to go`}
          </span>
        </div>
      </div>
      {logged && <DoneBanner habit={habit}/>}
      {logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote} onReflect={onReflect}/>}
    </div>
  );
}

function ProgressCard({ habit, onOpenLog, onReflect, onAddNote }) {
  const latest = getLatestValue(habit);
  const range = habit.targetValue - habit.startValue;
  const pct = range > 0 ? Math.min(100, Math.round(((latest - habit.startValue) / range) * 100)) : 0;
  const logged = isLoggedToday(habit);
  const tLog = latestTodayLog(habit);
  return (
    <div className="rc" style={cardStyle(logged, habit)}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            <span style={{ color:habit.color, fontWeight:500 }}>{latest}{habit.unit}</span>
            {" → "}
            <span>{habit.targetValue}{habit.unit}</span>
            <span style={{ marginLeft:6, color:T.hint }}>{(habit.targetValue - latest).toFixed(1)}{habit.unit} to go</span>
          </div>
        </div>
        <PlusBtn habit={habit} logged={logged} onClick={() => onOpenLog(habit.id)}/>
      </div>
      <div style={{ padding:"0 15px 14px" }}>
        <div style={{ height:6, background:T.surface, borderRadius:3, overflow:"hidden", marginBottom:6 }}>
          <div style={{ height:"100%", borderRadius:3, background:habit.color, width:`${pct}%`, transition:"width 0.6s ease" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:10, color:T.hint }}>{habit.startValue}{habit.unit}</span>
          <span style={{ fontSize:11, color:habit.color, fontWeight:500 }}>{pct}%</span>
          <span style={{ fontSize:10, color:T.hint }}>{habit.targetValue}{habit.unit}</span>
        </div>
      </div>
      {logged && <DoneBanner habit={habit}/>}
      {logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote} onReflect={onReflect}/>}
    </div>
  );
}

function ProjectCard({ habit, onOpenLog, onReflect, onAddNote }) {
  const stats = getProjectStats(habit);
  const tLogs = todayLogs(habit);
  const logged = tLogs.length > 0;
  const todayMins = tLogs.reduce((s, l) => s + (l.value?.minutes || 0), 0);
  const lastWin = [...habit.logs].filter(l => l.value?.win).pop();
  const tLog = tLogs[tLogs.length - 1];
  return (
    <div className="rc" style={cardStyle(logged, habit)}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            {logged
              ? `${todayMins} min today${tLogs.length > 1 ? ` (${tLogs.length} sessions)` : ""}`
              : "Tap + to log a session"}
            {getStreak(habit) > 0 ? ` · 🔥 ${getStreak(habit)}` : ""}
          </div>
        </div>
        <PlusBtn habit={habit} logged={logged} onClick={() => onOpenLog(habit.id)}/>
      </div>
      <div style={{ padding:"0 15px 14px", display:"flex", gap:8 }}>
        <Stat label="hrs this wk" value={stats.weekHours} color={habit.color}/>
        <Stat label="total hrs" value={stats.totalHours}/>
        <Stat label="wins" value={stats.wins} color={T.green}/>
        <Stat label="hard parts" value={stats.hard} color={T.amber}/>
      </div>
      {lastWin && (
        <div style={{ margin:"0 15px 14px", background:T.surface, borderRadius:T.rsm, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Latest win</div>
          <div style={{ fontSize:13, color:T.sub }}>{lastWin.value.win}</div>
        </div>
      )}
      {logged && <DoneBanner habit={habit}/>}
      {logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote} onReflect={onReflect}/>}
    </div>
  );
}

function LimitCard({ habit, onTap, onUndo, onLogZero, onReflect, onAddNote }) {
  const todayLogsArr = habit.logs.filter(l => l.date === todayStr() && l.value !== "quicknote");
  const used   = todayLogsArr.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0);
  const budget = habit.dailyBudget || 60;
  const pct      = Math.min(120, Math.round((used / budget) * 100));
  const barColor = pct < 60 ? T.green : pct < 90 ? T.amber : T.accent;
  const over     = used > budget;
  // Distinguish: explicitly logged (any numeric entry today) vs truly not logged at all
  const logged   = todayLogsArr.length > 0;
  const inc      = habit.tapIncrement ?? 1;
  return (
    <div className="rc" style={{ ...cardStyle(false, habit), borderColor:over?T.accent+"66":T.border, background:over?`${T.accent}0A`:T.raised }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={false}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            Limit{getLimitStreak(habit) > 0 ? ` · 🔥 ${getLimitStreak(habit)}` : ""}{inc > 1 ? ` · +${inc} per tap` : ""}
          </div>
        </div>
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
          {logged && (
            <button className="tap" onClick={() => onUndo(habit.id)}
              style={{ width:40, height:40, borderRadius:"50%", border:`1.5px solid ${T.borderMid}`, background:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:T.muted, transition:"all 0.18s" }}>−</button>
          )}
          <button className="tap" onClick={e => onTap(habit.id, e)}
            style={{ width:44, height:44, borderRadius:"50%", border:`2px solid ${habit.color+"66"}`, background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:habit.color, fontWeight:300, transition:"all 0.18s" }}>+</button>
        </div>
      </div>

      {logged ? (
        <div style={{ padding:"0 15px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.muted, marginBottom:5 }}>
            <span>{used}/{budget} {habit.unit || "logged"}</span>
            <span style={{ color:barColor, fontWeight:500 }}>{over ? `${used - budget} over limit` : `${budget - used} remaining`}</span>
          </div>
          <div style={{ height:6, background:T.surface, borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:3, background:barColor, width:`${Math.min(100, pct)}%`, transition:"width 0.4s ease" }}/>
          </div>
        </div>
      ) : (
        /* Distinct "not logged" state — greyed out, with an explicit "None today" option */
        <div style={{ padding:"0 15px 14px", display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ height:6, flex:1, background:T.surface, borderRadius:3, opacity:0.3 }}/>
          <span style={{ fontSize:12, color:T.hint, flexShrink:0 }}>– not logged</span>
          <button onClick={() => onLogZero(habit.id)}
            title="Mark that you had none today"
            style={{ fontSize:11, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"3px 9px", cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" }}>
            None today
          </button>
        </div>
      )}

      {logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote} onReflect={onReflect}/>}
    </div>
  );
}

// ─── LOG MODALS ───────────────────────────────────────────────────────────────
function LogProgressModal({ habit, onClose, onLog }) {
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const latest = getLatestValue(habit);
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:4 }}>{habit.emoji} {habit.name}</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:22 }}>
        Now: <strong style={{ color:habit.color }}>{latest}{habit.unit}</strong>{" → "}Goal: <strong style={{ color:T.text }}>{habit.targetValue}{habit.unit}</strong>
      </div>
      <FG label={`Today's ${habit.unit}`}>
        <input style={inp} type="number" step="0.1" placeholder={`e.g. ${latest}`} value={val} onChange={e => setVal(e.target.value)} autoFocus/>
      </FG>
      <FG label="Note (optional)" mb={0}>
        <input style={inp} placeholder="e.g. 3 meals + shake today" value={note} onChange={e => setNote(e.target.value)} maxLength={140}/>
      </FG>
      <PBtn onClick={() => { if (!val) return; onLog(habit.id, { value:parseFloat(val), note }); onClose(); }}>Log it</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

function LogProjectModal({ habit, onClose, onLog }) {
  const [minutes, setMinutes] = useState("");
  const [win,  setWin]  = useState("");
  const [hard, setHard] = useState("");
  const [note, setNote] = useState("");
  const count = todayLogs(habit).length;
  const QUICK_MINS = [15, 30, 45, 60, 90, 120];

  const winSpeech  = useSpeechInput(t => setWin(p  => p.trim() ? p  + " " + t : t));
  const hardSpeech = useSpeechInput(t => setHard(p => p.trim() ? p + " " + t : t));

  return (
    <Modal onClose={onClose}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <div style={{ width:48, height:48, borderRadius:14, background:habit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{habit.emoji}</div>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{count > 0 ? `Session ${count + 1} today` : "How did it go?"}</div>
        </div>
      </div>

      {/* Time — big input with quick-pick chips */}
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Time spent</label>
        <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
          {QUICK_MINS.map(m => (
            <button key={m} onClick={() => setMinutes(String(m))}
              style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${minutes===String(m)?habit.color:T.borderStrong}`, background:minutes===String(m)?habit.color+"22":"none", color:minutes===String(m)?habit.color:T.muted, fontSize:12, fontWeight:minutes===String(m)?500:400, cursor:"pointer", transition:"all 0.15s" }}>
              {m}m
            </button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <input style={{ ...inp, flex:1, fontSize:18, textAlign:"center", padding:"12px" }} type="number" placeholder="or type minutes" value={minutes} onChange={e => setMinutes(e.target.value)} autoFocus/>
          <span style={{ fontSize:13, color:T.muted, flexShrink:0 }}>min</span>
        </div>
      </div>

      {/* Win */}
      <div style={{ marginBottom:12 }}>
        <label style={lbl}>A win <span style={{ color:T.hint, fontWeight:400, textTransform:"none", letterSpacing:0 }}>(optional)</span></label>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ position:"relative", flex:1 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:16 }}>🏆</span>
            <input style={{ ...inp, paddingLeft:38, paddingRight:8 }} placeholder={winSpeech.listening ? "Listening…" : "Something that clicked or worked"} value={win} onChange={e => setWin(e.target.value)} maxLength={140}/>
          </div>
          <MicBtn speech={winSpeech} color={habit.color} size={30}/>
        </div>
        {winSpeech.interim && <div style={{ fontSize:12, color:T.hint, fontStyle:"italic", marginTop:4, paddingLeft:2 }}>{winSpeech.interim}…</div>}
      </div>

      {/* Hard part */}
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>A hard part <span style={{ color:T.hint, fontWeight:400, textTransform:"none", letterSpacing:0 }}>(optional)</span></label>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ position:"relative", flex:1 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:16 }}>🧱</span>
            <input style={{ ...inp, paddingLeft:38, paddingRight:8 }} placeholder={hardSpeech.listening ? "Listening…" : "Something that blocked you"} value={hard} onChange={e => setHard(e.target.value)} maxLength={140}/>
          </div>
          <MicBtn speech={hardSpeech} color={habit.color} size={30}/>
        </div>
        {hardSpeech.interim && <div style={{ fontSize:12, color:T.hint, fontStyle:"italic", marginTop:4, paddingLeft:2 }}>{hardSpeech.interim}…</div>}
      </div>

      <PBtn color={habit.color} onClick={() => {
        onLog(habit.id, { value:{ minutes:parseInt(minutes)||0, win:win.trim()||null, hardPart:hard.trim()||null }, note });
        onClose();
      }}>Log session</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── REFLECT MODAL ────────────────────────────────────────────────────────────
function ReflectModal({ habit, onClose, onSave }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  const speech = useSpeechInput(transcript =>
    setText(p => p.trim() ? p + " " + transcript : transcript)
  );

  if (!habit) return null;
  const past = habit.logs.filter(l => l.reflection).slice(-4).reverse();

  function handleSave() {
    if (speech.listening) speech.toggle();
    if (!text.trim()) { onClose(); return; }
    onSave(habit.id, text.trim());
    setSaved(true);
    setTimeout(onClose, 700);
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
        <span style={{ fontSize:24 }}>{habit.emoji}</span>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text }}>{habit.name}</div>
      </div>
      {getStreak(habit) > 0 && <div style={{ fontSize:12, color:T.gold, marginBottom:16 }}>🔥 {getStreak(habit)} streak</div>}
      <div style={{ background:T.surface, borderRadius:T.rsm, padding:"11px 14px", fontSize:13, color:T.sub, fontStyle:"italic", marginBottom:16, borderLeft:`2px solid ${habit.color}` }}>
        {habit.reflectionPrompt || "How did it go? What do you want to remember?"}
      </div>
      {saved ? (
        <div style={{ textAlign:"center", padding:"28px 0", fontSize:16, color:T.green }}>✓ Saved</div>
      ) : (
        <div style={{ position:"relative", marginBottom:speech.interim ? 6 : 0 }}>
          <textarea value={text} onChange={e => setText(e.target.value)}
            style={{ width:"100%", border:`0.5px solid ${speech.listening ? habit.color+"66" : T.borderStrong}`, borderRadius:T.rsm, background:T.surface, padding:12, paddingBottom:40, fontSize:14, color:T.text, resize:"none", minHeight:130, lineHeight:1.6, boxSizing:"border-box", transition:"border-color 0.2s" }}
            placeholder={speech.listening ? "Listening…" : "Write freely — this is just for you..."}
            rows={5} autoFocus={!speech.listening}/>
          {/* mic button floated inside textarea bottom-right */}
          <div style={{ position:"absolute", bottom:10, right:10 }}>
            <MicBtn speech={speech} color={habit.color} size={30}/>
          </div>
        </div>
      )}
      {speech.interim && !saved && (
        <div style={{ fontSize:13, color:T.hint, fontStyle:"italic", lineHeight:1.5, marginBottom:10, paddingLeft:4 }}>
          {speech.interim}…
        </div>
      )}
      {past.length > 0 && (
        <div style={{ marginTop:22 }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Past reflections</div>
          {past.map((l, i) => (
            <div key={i} style={{ borderTop:`0.5px solid ${T.border}`, padding:"10px 0" }}>
              <div style={{ fontSize:10, color:T.hint, marginBottom:4 }}>{l.date}</div>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{l.reflection}</div>
            </div>
          ))}
        </div>
      )}
      {!saved && <><PBtn onClick={handleSave} color={habit.color}>Save reflection</PBtn><GBtn onClick={onClose}>Close</GBtn></>}
    </Modal>
  );
}

// ─── EDIT MODAL (type-specific) ───────────────────────────────────────────────
const TYPE_META = {
  daily:    { bg:"#27AE6018", text:"#27AE60", label:"Daily habit"    },
  weekly:   { bg:"#C0392B18", text:"#C0392B", label:"Weekly target"  },
  progress: { bg:"#E67E2218", text:"#E67E22", label:"Progress goal"  },
  project:  { bg:"#2980B918", text:"#2980B9", label:"Project habit"  },
  limit:    { bg:"#8E44AD18", text:"#8E44AD", label:"Limit / reduce" },
};
function EditModal({ habit, onClose, onSave }) {
  const [name,        setName]        = useState(habit.name);
  const [emoji,       setEmoji]       = useState(habit.emoji);
  const [color,       setColor]       = useState(habit.color);
  const [reflection,  setReflection]  = useState(habit.reflection ?? true);
  const [reflPrompt,  setReflPrompt]  = useState(habit.reflectionPrompt || "");
  const [weekTarget,  setWeekTarget]  = useState(String(habit.weeklyTarget || 3));
  const [startVal,    setStartVal]    = useState(String(habit.startValue || ""));
  const [targetVal,   setTargetVal]   = useState(String(habit.targetValue || ""));
  const [unit,        setUnit]        = useState(habit.unit || "");
  const [budget,      setBudget]      = useState(String(habit.dailyBudget || 60));
  const [budgetUnit,  setBudgetUnit]  = useState(habit.unit || "min");
  const [increment,   setIncrement]   = useState(String(habit.tapIncrement ?? 1));
  const meta = TYPE_META[habit.habitType] || TYPE_META.daily;

  function save() {
    const updates = { name:name.trim()||habit.name, emoji:emoji||habit.emoji, color, reflection, reflectionPrompt:reflPrompt.trim()||null };
    if (habit.habitType === "weekly")   updates.weeklyTarget = parseInt(weekTarget) || habit.weeklyTarget;
    if (habit.habitType === "progress") { updates.startValue = parseFloat(startVal)||habit.startValue; updates.targetValue = parseFloat(targetVal)||habit.targetValue; updates.unit = unit||habit.unit; }
    if (habit.habitType === "limit")    { updates.dailyBudget = parseInt(budget)||habit.dailyBudget; updates.unit = budgetUnit||habit.unit; updates.tapIncrement = parseInt(increment)||1; }
    onSave(habit.id, updates);
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display:"inline-flex", alignItems:"center", background:meta.bg, borderRadius:20, padding:"4px 12px", marginBottom:14 }}>
        <span style={{ fontSize:11, fontWeight:500, color:meta.text }}>{meta.label}</span>
      </div>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:20 }}>Edit habit</div>
      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}><label style={lbl}>Name</label><input style={inp} value={name} onChange={e => setName(e.target.value)} maxLength={40}/></div>
        <div><label style={lbl}>Emoji</label><input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2}/></div>
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Color</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2.5px solid ${c}`:"none", outlineOffset:2 }}/>)}
        </div>
      </div>

      {/* Type-specific section */}
      {habit.habitType === "daily" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <div style={{ fontSize:13, color:T.muted }}>One tap per day. Currently on a <strong style={{ color:T.text }}>{getDailyStreak(habit)}-day streak</strong>.</div>
        </div>
      )}
      {habit.habitType === "weekly" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <FG label="Sessions per week target" mb={8}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input style={{ ...inp, width:80 }} type="number" min="1" max="7" value={weekTarget} onChange={e => setWeekTarget(e.target.value)}/>
              <span style={{ fontSize:13, color:T.muted }}>sessions / week</span>
            </div>
          </FG>
          <div style={{ fontSize:11, color:T.hint }}>{habit.logs.length} total sessions logged</div>
        </div>
      )}
      {habit.habitType === "progress" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <FG label="Goal" mb={10}>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>START</div>
                <input style={inp} type="number" step="0.1" value={startVal} onChange={e => setStartVal(e.target.value)}/>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>TARGET</div>
                <input style={inp} type="number" step="0.1" value={targetVal} onChange={e => setTargetVal(e.target.value)}/>
              </div>
              <div style={{ width:68 }}>
                <div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>UNIT</div>
                <input style={inp} value={unit} onChange={e => setUnit(e.target.value)}/>
              </div>
            </div>
          </FG>
          <div style={{ fontSize:11, color:T.hint }}>Currently at <strong style={{ color:habit.color }}>{getLatestValue(habit)}{habit.unit}</strong> · {habit.logs.length} measurements</div>
        </div>
      )}
      {habit.habitType === "project" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <div style={{ fontSize:13, color:T.muted, lineHeight:1.6, marginBottom:8 }}>
            Logs time, wins, and hard parts per session. No single daily target — just keep showing up.
          </div>
          {(() => { const s = getProjectStats(habit); return <div style={{ fontSize:11, color:T.hint }}>{s.totalHours} hrs across {habit.logs.length} sessions · {s.wins} wins logged</div>; })()}
        </div>
      )}
      {habit.habitType === "limit" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <FG label="Daily budget" mb={8}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <input style={{ ...inp, width:88 }} type="number" value={budget} onChange={e => setBudget(e.target.value)}/>
              <input style={{ ...inp, width:80 }} value={budgetUnit} onChange={e => setBudgetUnit(e.target.value)} placeholder="pouches"/>
              <span style={{ fontSize:13, color:T.muted }}>/ day</span>
            </div>
          </FG>
          <FG label="Per tap" mb={8}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <input style={{ ...inp, width:80 }} type="number" min="1" value={increment} onChange={e => setIncrement(e.target.value)}/>
              <span style={{ fontSize:13, color:T.muted }}>{budgetUnit || "unit"} per tap</span>
            </div>
          </FG>
          <div style={{ fontSize:11, color:T.hint }}>Each + tap logs {parseInt(increment)||1} {budgetUnit} toward the limit</div>
        </div>
      )}

      <div style={{ marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:reflection?12:0 }}>
          <div>
            <label style={{ ...lbl, margin:0 }}>Reflection prompt</label>
            {!reflection && <div style={{ fontSize:11, color:T.hint, marginTop:3 }}>Off — no Go Deeper shown</div>}
          </div>
          <Toggle on={reflection} onChange={setReflection}/>
        </div>
        {reflection && (
          <input style={inp} value={reflPrompt} onChange={e => setReflPrompt(e.target.value)}
            placeholder={habit.reflectionPrompt || "What do you want to remember from today?"}/>
        )}
      </div>
      <PBtn color={habit.color} onClick={save}>Save changes</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── ADD MODAL ────────────────────────────────────────────────────────────────
function AddModal({ onClose, onSave }) {
  const [step,        setStep]        = useState("type");
  const [habitType,   setHabitType]   = useState(null);
  const [name,        setName]        = useState("");
  const [emoji,       setEmoji]       = useState("");
  const [color,       setColor]       = useState(COLORS[0]);
  const [reflection,  setReflection]  = useState(true);
  const [reflPrompt,  setReflPrompt]  = useState("");
  const [weekTarget,  setWeekTarget]  = useState("3");
  const [startVal,    setStartVal]    = useState("");
  const [targetVal,   setTargetVal]   = useState("");
  const [unit,        setUnit]        = useState("kg");
  const [budget,      setBudget]      = useState("60");
  const [budgetUnit,  setBudgetUnit]  = useState("min");
  const [tapIncrement, setTapIncrement] = useState("1");

  if (step === "type") return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:4 }}>New habit</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:22 }}>What are you forging?</div>
      {Object.entries(HABIT_TYPES).map(([key, { label, desc, icon }]) => (
        <button key={key}
          onClick={() => { setHabitType(key); setStep("details"); }}
          style={{ display:"flex", alignItems:"flex-start", gap:12, width:"100%", padding:"12px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:8, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22, flexShrink:0, marginTop:1 }}>{icon}</span>
          <div>
            <div style={{ fontSize:14, fontWeight:500, color:T.text }}>{label}</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{desc}</div>
          </div>
        </button>
      ))}
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );

  return (
    <Modal onClose={() => setStep("type")}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:22 }}>
        <button onClick={() => setStep("type")} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:13, padding:"4px 8px 4px 0" }}>← Back</button>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text }}>{HABIT_TYPES[habitType]?.label}</div>
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Morning run" maxLength={40} autoFocus/>
        </div>
        <div>
          <label style={lbl}>Emoji</label>
          <input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="💪" maxLength={2}/>
        </div>
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Color</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2.5px solid ${c}`:"none", outlineOffset:2 }}/>)}
        </div>
      </div>
      {habitType === "weekly" && (
        <FG label="Sessions per week">
          <input style={inp} type="number" min="1" max="7" value={weekTarget} onChange={e => setWeekTarget(e.target.value)}/>
        </FG>
      )}
      {habitType === "progress" && (
        <div style={{ display:"flex", gap:10, marginBottom:20 }}>
          <div style={{ flex:1 }}><label style={lbl}>Start value</label><input style={inp} type="number" step="0.1" value={startVal} onChange={e => setStartVal(e.target.value)} placeholder="74.5"/></div>
          <div style={{ flex:1 }}><label style={lbl}>Target</label><input style={inp} type="number" step="0.1" value={targetVal} onChange={e => setTargetVal(e.target.value)} placeholder="80"/></div>
          <div style={{ width:68 }}><label style={lbl}>Unit</label><input style={inp} value={unit} onChange={e => setUnit(e.target.value)} placeholder="kg"/></div>
        </div>
      )}
      {habitType === "limit" && (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", gap:10, marginBottom:10 }}>
            <div style={{ flex:1 }}><label style={lbl}>Daily limit</label><input style={inp} type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="7"/></div>
            <div style={{ width:80 }}><label style={lbl}>Unit</label><input style={inp} value={budgetUnit} onChange={e => setBudgetUnit(e.target.value)} placeholder="pouches"/></div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
            <div style={{ width:80 }}><label style={lbl}>Per tap</label><input style={inp} type="number" min="1" value={tapIncrement} onChange={e => setTapIncrement(e.target.value)} placeholder="1"/></div>
            <div style={{ paddingBottom:10, fontSize:13, color:T.muted }}>{budgetUnit || "unit"} per tap</div>
          </div>
        </div>
      )}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:reflection?12:0 }}>
          <label style={{ ...lbl, margin:0 }}>Reflection prompt</label>
          <Toggle on={reflection} onChange={setReflection}/>
        </div>
        {reflection && (
          <input style={inp} value={reflPrompt} onChange={e => setReflPrompt(e.target.value)} placeholder="e.g. What felt hard today? (leave blank for default)"/>
        )}
      </div>
      <PBtn onClick={() => {
        if (!name.trim()) return;
        const base = { id:Date.now()+"", name:name.trim(), emoji:emoji||"⭐", habitType, color, reflection, reflectionPrompt:reflPrompt.trim()||null, streak:0, logs:[] };
        if (habitType === "weekly")   onSave({ ...base, weeklyTarget:parseInt(weekTarget)||3 });
        else if (habitType === "progress") onSave({ ...base, startValue:parseFloat(startVal)||0, targetValue:parseFloat(targetVal)||100, unit:unit||"kg" });
        else if (habitType === "limit") onSave({ ...base, dailyBudget:parseInt(budget)||60, unit:budgetUnit||"min", tapIncrement:parseInt(tapIncrement)||1 });
        else onSave(base);
      }}>Add habit</PBtn>
      <GBtn onClick={() => setStep("type")}>Back</GBtn>
    </Modal>
  );
}

// ─── XP MODAL ─────────────────────────────────────────────────────────────────
function XPModal({ xp, onClose }) {
  const level = getLevel(xp);
  const next  = nextLevel(xp);
  const pct   = next ? Math.round(((xp - level.min) / (next.min - level.min)) * 100) : 100;
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:4 }}>What is XP?</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:22, lineHeight:1.7 }}>
        XP is your consistency score. Every habit you log earns 10 XP. Limit habits earn 5 XP per tap. It doesn't unlock anything — it's just proof of how much you've shown up.{" "}
        At 1–2 habits a day you'll hit Kindling in ~2 months, Tempered in ~6, Hardened in a year, Forged in 2 years of consistent logging.
      </div>
      <div style={{ background:T.surface, borderRadius:T.rsm, padding:16, marginBottom:20 }}>
        <div style={{ fontSize:11, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Your level</div>
        <div style={{ fontSize:22, fontWeight:500, color:level.color, marginBottom:4 }}>{level.label}</div>
        <div style={{ fontSize:13, color:T.muted, marginBottom:12 }}>{xp} xp{next ? ` · ${next.min - xp} to next level` : " · max level"}</div>
        <div style={{ height:6, background:T.raised, borderRadius:3, overflow:"hidden" }}>
          <div style={{ height:"100%", borderRadius:3, background:level.color, width:`${pct}%`, transition:"width 0.6s ease" }}/>
        </div>
      </div>
      {XP_LEVELS.map((l, i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderTop:i>0?`0.5px solid ${T.border}`:"none" }}>
          <div style={{ width:10, height:10, borderRadius:"50%", background:l.color, flexShrink:0 }}/>
          <div style={{ flex:1, fontSize:13, color:xp>=l.min?T.text:T.muted }}>{l.label}</div>
          <div style={{ fontSize:12, color:T.hint }}>{l.min} xp</div>
        </div>
      ))}
      <GBtn onClick={onClose}>Got it</GBtn>
    </Modal>
  );
}

// ─── HISTORY MODAL ────────────────────────────────────────────────────────────
function HabitGrid({ habit }) {
  const grid = get12WeekGrid(habit);
  const rate = getCompletionRate(habit);
  const weekLabels = grid.map(week => {
    const d = parseLocal(week[0].date);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  });
  const ringC = 2 * Math.PI * 14;
  return (
    <div style={{ marginBottom:26 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
        <div style={{ width:32, height:32, borderRadius:8, background:habit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{habit.emoji}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:11, color:T.muted }}>{habit.logs.length} total · {rate}% last 28 days</div>
        </div>
        <svg width="36" height="36" viewBox="0 0 36 36" style={{ transform:"rotate(-90deg)", flexShrink:0 }}>
          <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" stroke={T.surface}/>
          <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" stroke={habit.color} strokeLinecap="round" strokeDasharray={ringC} strokeDashoffset={ringC * (1 - rate/100)}/>
        </svg>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"46px repeat(7,1fr)", gap:3, marginBottom:4 }}>
        <div/>
        {DAYS.map(d => <div key={d} style={{ fontSize:9, color:T.hint, textAlign:"center" }}>{d}</div>)}
      </div>
      {grid.map((week, wi) => (
        <div key={wi} style={{ display:"grid", gridTemplateColumns:"46px repeat(7,1fr)", gap:3, marginBottom:3, alignItems:"center" }}>
          <div style={{ fontSize:9, color:T.hint }}>{weekLabels[wi]}</div>
          {week.map((day, di) => (
            <div key={di} title={day.date} style={{ aspectRatio:"1", borderRadius:3, background:day.logged?habit.color:T.surface, opacity:day.date>todayStr()?0:day.logged?1:0.15 }}/>
          ))}
        </div>
      ))}
    </div>
  );
}
function HistoryModal({ habits, onClose, isPro, onUpgrade }) {
  const [selected, setSelected] = useState(habits[0]?.id || null);
  const [showBeta, setShowBeta] = useState(false);
  const habit = habits.find(h => h.id === selected);
  const cutoff = daysAgo(6); // free users see last 7 days

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:16 }}>Full history</div>
      {/* Habit filter pills */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
        {habits.map(h => (
          <button key={h.id} onClick={() => setSelected(h.id)}
            style={{ padding:"5px 12px", borderRadius:20, border:`1px solid ${selected===h.id?h.color:T.borderStrong}`, background:selected===h.id?h.color+"22":"none", color:selected===h.id?h.color:T.muted, fontSize:12, fontWeight:selected===h.id?500:400, cursor:"pointer", whiteSpace:"nowrap" }}>
            {h.emoji} {h.name}
          </button>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18 }}>
        <div style={{ width:10, height:10, borderRadius:2, background:habit?.color||T.accent }}/><span style={{ fontSize:11, color:T.muted }}>Logged</span>
        <div style={{ width:10, height:10, borderRadius:2, background:T.surface, opacity:0.4, marginLeft:8 }}/><span style={{ fontSize:11, color:T.muted }}>Missed</span>
      </div>
      {habit && <HabitGrid habit={habit}/>}
      {/* Pro gate: blurred preview + upgrade prompt for history older than 7 days */}
      {!isPro && habit && habit.logs.some(l => l.date < cutoff) && (
        <div style={{ position:"relative", margin:"16px 0", borderRadius:T.rsm, overflow:"hidden" }}>
          {/* Blurred preview rows */}
          <div style={{ filter:"blur(4px)", pointerEvents:"none", userSelect:"none", padding:"10px 0" }}>
            {habit.logs.filter(l => l.date < cutoff).slice(-4).map((l, i) => (
              <div key={i} style={{ padding:"8px 12px", borderBottom:`0.5px solid ${T.border}`, display:"flex", gap:8, alignItems:"center" }}>
                <div style={{ width:8, height:8, borderRadius:2, background:habit.color, flexShrink:0 }}/>
                <div style={{ fontSize:13, color:T.muted }}>████████</div>
                <div style={{ fontSize:12, color:T.hint, marginLeft:"auto" }}>████</div>
              </div>
            ))}
          </div>
          {/* Overlay */}
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, background:"rgba(14,14,14,0.75)", backdropFilter:"blur(2px)", borderRadius:T.rsm, padding:"0 20px" }}>
            <div style={{ fontSize:20 }}>🔒</div>
            <div style={{ fontSize:13, color:T.text, fontWeight:500, textAlign:"center" }}>Full history is coming with Pro</div>
            <div style={{ fontSize:12, color:T.muted, textAlign:"center" }}>You have {habit.logs.filter(l => l.date < cutoff).length} older logs waiting</div>
            <button onClick={() => setShowBeta(true)}
              style={{ marginTop:6, padding:"9px 20px", borderRadius:T.rsm, border:"none", background:"rgba(200,144,42,0.2)", color:T.gold, fontSize:13, fontWeight:600, cursor:"pointer" }}>
              I'm interested in Pro →
            </button>
          </div>
          {showBeta && <BetaModal onClose={() => setShowBeta(false)}/>}
        </div>
      )}
      <GBtn onClick={onClose}>Close</GBtn>
    </Modal>
  );
}

// ─── FIRST-TIME TOUR ──────────────────────────────────────────────────────────
const TOUR_STEPS = [
  { emoji:"✓",  title:"Log every day",          body:"Tap the circle on a habit to log it. That's it. No complicated input needed.",              nav:"today"    },
  { emoji:"📓", title:"Your journal",            body:"Every note and reflection you write gets saved here automatically — sorted by date.",        nav:"journal"  },
  { emoji:"📈", title:"Forge report",            body:"After a few weeks, your insights page fills up with real stats on your consistency.",        nav:"insights" },
  { emoji:"⚒️", title:"Manage your habits",      body:"Tap Habits to add, edit or remove habits. Each type works differently — explore them.",     nav:"habits"   },
  { emoji:"⚡", title:"XP tracks consistency",   body:"Every log earns XP. It takes 2 years of daily logging to hit Forged. Make it mean something.", nav:"profile" },
];
function TourOverlay({ step, onNext, onSkip }) {
  const s = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:500, display:"flex", flexDirection:"column", justifyContent:"flex-end", alignItems:"center", background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", padding:"28px 24px 60px", animation:"tourSlide 0.35s ease-out" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          {TOUR_STEPS.map((_, i) => (
            <div key={i} style={{ height:3, borderRadius:2, flex:1, background:i<=step?T.accent:T.surface, transition:"background 0.3s" }}/>
          ))}
        </div>
        <div style={{ marginTop:24, marginBottom:6, fontSize:40 }}>{s.emoji}</div>
        <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:10 }}>{s.title}</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:32 }}>{s.body}</div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onSkip} style={{ flex:1, padding:14, borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:14, cursor:"pointer" }}>
            Skip tour
          </button>
          <button onClick={onNext} style={{ flex:2, padding:14, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:500, cursor:"pointer" }}>
            {isLast ? "Let's go 🔥" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
function TodayScreen({ habits, xp, onTap, onUndo, onSkip, onReflect, onAddNote, onLogZero, onOpenLog, onAdd, onXPInfo }) {
  const loggedCount = habits.filter(h => isLoggedToday(h)).length;
  const pct = habits.length ? Math.round((loggedCount / habits.length) * 100) : 0;
  const hr = new Date().getHours();
  const greeting = hr < 12 ? "Rise and forge." : hr < 17 ? "Keep the heat up." : "Finish strong.";
  const level = getLevel(xp);
  const daily    = habits.filter(h => h.habitType === "daily");
  const limit    = habits.filter(h => h.habitType === "limit");
  const weekly   = habits.filter(h => h.habitType === "weekly");
  const progress = habits.filter(h => h.habitType === "progress");
  const project  = habits.filter(h => h.habitType === "project");
  if (habits.length === 0) return (
    <div style={{ padding:"48px 28px", textAlign:"center" }}>
      <div style={{ fontSize:48, marginBottom:18 }}>⚒️</div>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:10 }}>Nothing forged yet.</div>
      <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:28 }}>
        Add your first habit and start building something that lasts.
      </div>
      <button onClick={onAdd} style={{ padding:"14px 32px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:500, cursor:"pointer" }}>
        Add your first habit
      </button>
    </div>
  );

  return (
    <div>
      <div style={{ margin:"6px 14px 16px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"18px 20px", display:"flex", alignItems:"center", gap:18 }}>
        <Ring pct={pct}/>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:4 }}>{pct === 100 ? "Forged for today." : greeting}</div>
          <div style={{ fontSize:13, color:T.muted }}>{loggedCount} of {habits.length} logged</div>
          <button onClick={onXPInfo} style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:500, padding:"3px 10px", borderRadius:12, background:"rgba(200,144,42,0.15)", color:T.gold, border:"none", cursor:"pointer" }}>
            ⚡ {xp} xp · {level.label}
          </button>
        </div>
      </div>
      {daily.length    > 0 && <><SLabel>Daily</SLabel>          {daily.map(h    => <DailyCard    key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onReflect={onReflect} onAddNote={onAddNote}/>)}</>}
      {limit.length    > 0 && <><SLabel>Limits</SLabel>         {limit.map(h    => <LimitCard    key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onReflect={onReflect} onAddNote={onAddNote}/>)}</>}
      {weekly.length   > 0 && <><SLabel>Weekly targets</SLabel> {weekly.map(h   => <WeeklyCard   key={h.id} habit={h} onTap={onTap}             onReflect={onReflect} onAddNote={onAddNote}/>)}</>}
      {progress.length > 0 && <><SLabel>Progress goals</SLabel> {progress.map(h => <ProgressCard key={h.id} habit={h} onOpenLog={onOpenLog}     onReflect={onReflect} onAddNote={onAddNote}/>)}</>}
      {project.length  > 0 && <><SLabel>Build</SLabel>          {project.map(h  => <ProjectCard  key={h.id} habit={h} onOpenLog={onOpenLog}     onReflect={onReflect} onAddNote={onAddNote}/>)}</>}
      <button onClick={onAdd} style={{ margin:"8px 14px 0", width:"calc(100% - 28px)", border:`1px dashed ${T.borderStrong}`, background:"none", borderRadius:T.r, padding:14, fontSize:13, color:T.muted, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round"/></svg>
        Add habit
      </button>
    </div>
  );
}

// ─── BETA INTEREST MODAL ─────────────────────────────────────────────────────
function BetaModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit() {
    if (!email.trim()) return;
    // mailto fallback — works immediately, no backend needed
    const subject = encodeURIComponent("Forged Pro — Beta Interest");
    const body = encodeURIComponent(
      `Email: ${email.trim()}\n\n${msg.trim() ? `Message: ${msg.trim()}` : "(No message)"}`
    );
    window.open(`mailto:corbyn.miller2000@gmail.com?subject=${subject}&body=${body}`, "_blank");
    setSent(true);
  }

  if (sent) return (
    <Modal onClose={onClose}>
      <div style={{ textAlign:"center", padding:"10px 0 20px" }}>
        <div style={{ fontSize:36, marginBottom:14 }}>🙌</div>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:10 }}>You're on the list.</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:24 }}>
          Thanks for being early. You'll hear from me directly as things come together — I genuinely appreciate it.
        </div>
        <GBtn onClick={onClose}>Close</GBtn>
      </div>
    </Modal>
  );

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:10 }}>Interested in Pro?</div>
      <div style={{ fontSize:13, color:T.muted, lineHeight:1.8, marginBottom:20 }}>
        I'm gauging interest before charging anything. If you want to be one of the first 100 beta testers,
        it's <strong style={{ color:T.text }}>$5/month</strong> — and that price is yours for life if you sign up early.
        <br/><br/>
        You won't be charged yet. In exchange I'd genuinely love your feedback as I build this out. This is a solo-built app
        and early voices shape everything.
      </div>
      <FG label="Your email">
        <input style={inp} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus/>
      </FG>
      <FG label="Anything you'd love to see? (optional)" mb={0}>
        <textarea style={{ ...inp, resize:"none", lineHeight:1.6 }} rows={3}
          placeholder="Features, questions, feedback — anything goes"
          value={msg} onChange={e => setMsg(e.target.value)}/>
      </FG>
      <PBtn onClick={handleSubmit} style={{ marginTop:16 }}>I'm interested →</PBtn>
      <GBtn onClick={onClose}>Maybe later</GBtn>
      <div style={{ fontSize:11, color:T.hint, marginTop:10, textAlign:"center", lineHeight:1.6 }}>
        This opens your email app with your details pre-filled. No spam, ever.
      </div>
    </Modal>
  );
}

// ─── JOURNAL DAY SECTION ──────────────────────────────────────────────────────
// One section per date in the list view. Today is expanded by default.
// Past days collapse into a single row showing a snapshot.
function DaySection({ date, dayHabits, onReflect }) {
  const isToday = date === todayStr();
  const [open, setOpen] = useState(isToday);

  const label = isToday ? "Today" : date === daysAgo(1) ? "Yesterday" : fmtEntryDate(date);
  // Snapshot: unique habit emojis for this day + total log count
  const totalLogs = dayHabits.reduce((s, dh) => s + dh.logs.length, 0);
  const emojis = dayHabits.slice(0, 4).map(dh => dh.habit.emoji).join(" ");

  return (
    <div style={{ marginBottom: isToday ? 4 : 2 }}>
      {/* Date header — past days are clickable accordions */}
      {isToday ? (
        <div style={{ padding:"12px 18px 6px" }}>
          <div style={{ fontSize:13, fontWeight:600, color:T.text, letterSpacing:"0.01em" }}>Today</div>
        </div>
      ) : (
        <button onClick={() => setOpen(o => !o)}
          style={{ width:"100%", display:"flex", alignItems:"center", padding:"10px 18px 8px", background:"none", border:"none", cursor:"pointer", gap:10 }}>
          {/* Colour line */}
          <div style={{ width:3, height:28, borderRadius:2, background:open?T.accent:T.borderStrong, flexShrink:0, transition:"background 0.2s" }}/>
          <div style={{ flex:1, textAlign:"left" }}>
            <div style={{ fontSize:13, fontWeight:500, color:open?T.text:T.muted, transition:"color 0.2s" }}>{label}</div>
            {!open && <div style={{ fontSize:11, color:T.hint, marginTop:1 }}>{emojis} · {totalLogs} {totalLogs === 1 ? "entry" : "entries"}</div>}
          </div>
          <div style={{ fontSize:14, color:T.hint, transition:"transform 0.2s", transform:open?"rotate(90deg)":"rotate(0deg)" }}>›</div>
        </button>
      )}

      {/* Expanded content */}
      {open && dayHabits.map(({ habit, logs }) => (
        <HabitDayCard key={habit.id} habit={habit} logs={logs} onReflect={onReflect}/>
      ))}
    </div>
  );
}

// Card showing one habit's full activity for a single day
function HabitDayCard({ habit, logs, onReflect }) {
  const nonNote = logs.filter(l => l.value !== "quicknote");
  const notes   = logs.filter(l => l.value === "quicknote" || (l.note && l.note.trim()));
  const uniqueNotes = [...new Set(notes.map(l => l.note).filter(Boolean))];

  // Summary line based on habit type
  function summaryLine() {
    if (habit.habitType === "project") {
      const mins = nonNote.reduce((s, l) => s + (l.value?.minutes || 0), 0);
      const sessions = nonNote.length;
      return mins > 0 ? `${mins} min · ${sessions} session${sessions!==1?"s":""}` : `${sessions} session${sessions!==1?"s":""}`;
    }
    if (habit.habitType === "limit") {
      const total = nonNote.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0);
      return `${total} ${habit.unit || "logged"} of ${habit.dailyBudget} limit`;
    }
    if (habit.habitType === "weekly") return `${nonNote.length} session${nonNote.length!==1?"s":""}`;
    if (habit.habitType === "progress") {
      const latest = nonNote.slice(-1)[0];
      return latest ? `${latest.value}${habit.unit}` : "logged";
    }
    return "logged ✓";
  }

  // Grab wins, hard parts, reflections from any log
  const wins       = nonNote.filter(l => l.value?.win).map(l => l.value.win);
  const hardParts  = nonNote.filter(l => l.value?.hardPart).map(l => l.value.hardPart);
  const reflection = nonNote.map(l => l.reflection).filter(Boolean).join(" ");

  return (
    <div style={{ margin:"0 14px 8px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
      {/* Habit header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px 8px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ width:24, height:24, borderRadius:6, background:habit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>{habit.emoji}</div>
        <span style={{ fontSize:13, fontWeight:500, color:habit.color }}>{habit.name}</span>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.hint }}>{summaryLine()}</span>
      </div>

      {/* Wins */}
      {wins.map((w, i) => (
        <div key={i} style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Win 🏆</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{w}</div>
        </div>
      ))}

      {/* Hard parts */}
      {hardParts.map((h, i) => (
        <div key={i} style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.amber, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Hard part 🧱</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{h}</div>
        </div>
      ))}

      {/* Reflection */}
      {reflection && (
        <div style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Reflection</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{reflection}</div>
        </div>
      )}

      {/* Quick notes — newest first */}
      {[...uniqueNotes].reverse().map((n, i) => (
        <div key={i} style={{ padding:"8px 14px", borderBottom:i<uniqueNotes.length-1?`0.5px solid ${T.border}`:"none", background:`${T.surface}66` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Note</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, fontStyle:"italic" }}>{n}</div>
        </div>
      ))}

      {/* Add reflection prompt if none yet */}
      {!reflection && (
        <div style={{ padding:"8px 14px" }}>
          <button onClick={() => onReflect(habit.id)}
            style={{ fontSize:12, color:habit.color+"99", background:"none", border:"none", cursor:"pointer", fontWeight:500, padding:0 }}>
            Add reflection →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── JOURNAL SCREEN ───────────────────────────────────────────────────────────
function JournalScreen({ habits, onReflect }) {
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState("list"); // "list" | "month"
  const [monthOffset, setMonthOffset] = useState(0); // 0 = current month
  const [selectedDay, setSelectedDay] = useState(null);

  // Build ALL habit activity grouped by date (not just entries with notes)
  const allByDate = {};
  habits.forEach(h => {
    const hLogs = filter === "all" || filter === h.id ? h.logs : [];
    hLogs.forEach(l => {
      if (!allByDate[l.date]) allByDate[l.date] = {};
      if (!allByDate[l.date][h.id]) allByDate[l.date][h.id] = { habit: h, logs: [] };
      allByDate[l.date][h.id].logs.push(l);
    });
  });
  const dates = Object.keys(allByDate).sort((a, b) => b.localeCompare(a));


  // ── Journey start date (earliest log across ALL habits, unfiltered) ──────────
  const allLogDatesRaw = habits.flatMap(h => h.logs.map(l => l.date)).filter(Boolean).sort();
  const firstLogDate  = allLogDatesRaw[0] || null; // e.g. "2025-01-15"
  const firstLogYear  = firstLogDate ? parseInt(firstLogDate.split("-")[0]) : null;
  const firstLogMonth = firstLogDate ? parseInt(firstLogDate.split("-")[1]) - 1 : null; // 0-indexed
  const firstLogDay   = firstLogDate ? parseInt(firstLogDate.split("-")[2]) : null;

  // ── MONTH VIEW helpers ─────────────────────────────────────────────────────
  const now = new Date();
  const viewYear  = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1).getFullYear();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1).getMonth();
  const monthLabel = `${MONTHS[viewMonth]} ${viewYear}`;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  // Adjust for Mon start: shift so Mon=0
  const startPad = (firstDow + 6) % 7;

  function dayStr(d) {
    return `${viewYear}-${String(viewMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  // Calendar: show a dot for every day that has ANY log (not just notes)
  const entryDays = {};
  Object.entries(allByDate).forEach(([dateStr, habitMap]) => {
    const d = parseLocal(dateStr);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      const day = d.getDate();
      entryDays[day] = Object.values(habitMap).map(({ habit }) => ({ habitColor: habit.color }));
    }
  });

  return (
    <div>
      {/* Header */}
      <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Journal</div>
          <div style={{ fontSize:13, color:T.muted, marginTop:3 }}>{dates.length} days logged</div>
        </div>
        {/* View toggle */}
        <div style={{ display:"flex", background:T.surface, borderRadius:T.rsm, padding:3, gap:2 }}>
          {[["list","≡"],["month","▦"]].map(([mode, icon]) => (
            <button key={mode} onClick={() => { setViewMode(mode); setSelectedDay(null); }}
              style={{ padding:"5px 11px", borderRadius:7, border:"none", cursor:"pointer",
                background:viewMode===mode?T.raised:"none",
                color:viewMode===mode?T.text:T.muted, fontSize:14, transition:"all 0.15s" }}>
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* Filter pills — shared between both views */}
      <div style={{ display:"flex", gap:6, padding:"0 16px 14px", overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        {[{ id:"all", name:"All", emoji:"", color:T.accent }, ...habits.map(h => ({ id:h.id, name:h.name, emoji:h.emoji, color:h.color }))].map(f => (
          <button key={f.id} onClick={() => { setFilter(f.id); setSelectedDay(null); }}
            style={{ padding:"5px 12px", borderRadius:20, whiteSpace:"nowrap", flexShrink:0,
              border:`0.5px solid ${filter===f.id?f.color:T.borderStrong}`,
              background:filter===f.id?f.color+"22":"none",
              color:filter===f.id?f.color:T.muted,
              fontSize:12, fontWeight:filter===f.id?500:400, cursor:"pointer" }}>
            {f.emoji ? `${f.emoji} ${f.name}` : f.name}
          </button>
        ))}
      </div>

      {/* ── MONTH VIEW ── */}
      {viewMode === "month" && (
        <div style={{ padding:"0 14px" }}>
          {/* Month nav */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <button onClick={() => { setMonthOffset(o => o+1); setSelectedDay(null); }}
              style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:20, padding:"4px 8px" }}>‹</button>
            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text }}>{monthLabel}</div>
            <button onClick={() => { setMonthOffset(o => Math.max(0, o-1)); setSelectedDay(null); }}
              disabled={monthOffset === 0}
              style={{ background:"none", border:"none", color:monthOffset===0?T.hint:T.muted, cursor:monthOffset===0?"default":"pointer", fontSize:20, padding:"4px 8px" }}>›</button>
          </div>

          {/* Day-of-week labels (Mon–Sun) */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
            {["M","T","W","T","F","S","S"].map((d,i) => (
              <div key={i} style={{ textAlign:"center", fontSize:10, color:T.hint, fontWeight:500 }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:20 }}>
            {/* Padding for first week */}
            {Array.from({length:startPad}, (_, i) => <div key={`pad-${i}`}/>)}
            {Array.from({length:daysInMonth}, (_, i) => {
              const day = i + 1;
              const ds = dayStr(day);
              const hasEntries = !!entryDays[day];
              const isToday = ds === todayStr();
              const isSelected = selectedDay === day;
              const isJourneyStart = firstLogDate === ds;
              const habitColors = hasEntries ? [...new Set(entryDays[day].map(e => e.habitColor))].slice(0,3) : [];
              return (
                <button key={day} onClick={() => (hasEntries || isJourneyStart) && setSelectedDay(isSelected ? null : day)}
                  style={{
                    aspectRatio:"1", borderRadius:8,
                    border:`1px solid ${isSelected?T.accent:isJourneyStart?T.gold:isToday?T.borderMid:T.border}`,
                    background:isSelected?"rgba(192,57,43,0.15)":isJourneyStart&&!hasEntries?"rgba(200,144,42,0.08)":isToday?T.surface:T.raised,
                    cursor:(hasEntries||isJourneyStart)?"pointer":"default",
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2,
                    padding:2, transition:"all 0.15s",
                  }}>
                  <span style={{ fontSize:11, color:isToday?T.accent:isJourneyStart?T.gold:hasEntries?T.text:T.muted, fontWeight:isToday||isJourneyStart?500:400 }}>{day}</span>
                  {hasEntries ? (
                    <div style={{ display:"flex", gap:2 }}>
                      {habitColors.map((c,ci) => <div key={ci} style={{ width:4, height:4, borderRadius:"50%", background:c }}/>)}
                    </div>
                  ) : isJourneyStart ? (
                    <div style={{ fontSize:7, color:T.gold }}>✦</div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Selected day entries */}
          {selectedDay && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                {MONTHS[viewMonth]} {selectedDay}
              </div>
              {firstLogDate && dayStr(selectedDay) === firstLogDate && (
                <div style={{ margin:"0 0 8px", padding:"10px 14px", background:"rgba(200,144,42,0.08)", borderRadius:T.rsm, border:`0.5px solid rgba(200,144,42,0.25)`, display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:14 }}>✦</span>
                  <span style={{ fontSize:12, color:T.gold, fontWeight:500 }}>Day one — this is where your journey began.</span>
                </div>
              )}
              {Object.values(allByDate[dayStr(selectedDay)] || {}).length === 0 ? (
                <div style={{ padding:"20px 0", textAlign:"center", color:T.muted, fontSize:13 }}>No entries this day</div>
              ) : (
                Object.values(allByDate[dayStr(selectedDay)] || {}).map(({ habit, logs }) => (
                  <HabitDayCard key={habit.id} habit={habit} logs={logs} onReflect={onReflect}/>
                ))
              )}
            </div>
          )}

          {Object.keys(entryDays).length === 0 && firstLogDate && (
            viewYear < firstLogYear ||
            (viewYear === firstLogYear && viewMonth < firstLogMonth)
          ) && (
            <div style={{ padding:"40px 20px", textAlign:"center" }}>
              <div style={{ fontSize:34, marginBottom:12 }}>✨</div>
              <div style={{ fontSize:15, color:T.text, fontWeight:500, marginBottom:8, fontFamily:T.serif }}>
                Your journey hadn't started yet
              </div>
              <div style={{ fontSize:13, color:T.muted, lineHeight:1.7 }}>
                You began forging on{" "}
                <span style={{ color:T.text, fontWeight:500 }}>
                  {MONTHS[firstLogMonth]} {firstLogDay}, {firstLogYear}
                </span>
                {" "}— every great streak has a first day.
              </div>
            </div>
          )}
          {Object.keys(entryDays).length === 0 && !(firstLogDate && (
            viewYear < firstLogYear ||
            (viewYear === firstLogYear && viewMonth < firstLogMonth)
          )) && (
            <div style={{ padding:"40px 20px", textAlign:"center" }}>
              <div style={{ fontSize:13, color:T.muted }}>No entries this month</div>
            </div>
          )}
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {viewMode === "list" && (
        <>
          {dates.length === 0 && (
            <div style={{ padding:"60px 30px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:14 }}>📓</div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>No entries yet. Start logging habits — everything shows up here.</div>
            </div>
          )}
          {dates.map(date => (
            <DaySection
              key={date}
              date={date}
              dayHabits={Object.values(allByDate[date])}
              onReflect={onReflect}
            />
          ))}
        </>
      )}
    </div>
  );
}

// Shared journal entry card
function EntryCard({ entry, onReflect }) {
  return (
    <div style={{ margin:"0 14px 10px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 15px 10px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ width:26, height:26, borderRadius:7, background:entry.habitColor+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>{entry.habitEmoji}</div>
        <span style={{ fontSize:12, fontWeight:500, color:entry.habitColor }}>{entry.habitName}</span>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.hint, fontFamily:"monospace" }}>{entry.date}</span>
      </div>
      {entry.reflection && (
        <div style={{ padding:"12px 15px", borderBottom:entry.note&&entry.note.trim()?`0.5px solid ${T.border}`:"none" }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Reflection</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.65 }}>{entry.reflection}</div>
        </div>
      )}
      {entry.win && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Win 🏆</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.55 }}>{entry.win}</div>
        </div>
      )}
      {entry.hardPart && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.amber, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Hard part 🧱</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{entry.hardPart}</div>
        </div>
      )}
      {entry.note && entry.note.trim() && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}`, background:`${T.surface}88` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Note</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, fontStyle:"italic" }}>{entry.note}</div>
        </div>
      )}
      {entry.minutes && (
        <div style={{ padding:"6px 15px 10px" }}>
          <span style={{ fontSize:11, color:T.hint }}>⏱ {entry.minutes} min logged</span>
        </div>
      )}
      {!entry.reflection && (
        <div style={{ padding:"8px 15px" }}>
          <button onClick={() => onReflect(entry.habitId)} style={{ fontSize:12, color:entry.habitColor, background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Add reflection →</button>
        </div>
      )}
    </div>
  );
}

// ─── INSIGHTS SCREEN ──────────────────────────────────────────────────────────
function InsightsScreen({ habits, onShowHistory, onShare }) {
  function IC({ title, children, action }) {
    return (
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:18 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>{title}</div>
          {action}
        </div>
        {children}
      </div>
    );
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const allRealLogs = habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip"));
  const totalDaysLogged = new Set(allRealLogs.map(l => l.date)).size;
  const allLogDates = habits.flatMap(h => h.logs.map(l => l.date)).filter(Boolean).sort();
  const firstLogDate = allLogDates[0] || null;
  const firstLogLabel = firstLogDate
    ? `${MONTHS[parseInt(firstLogDate.split("-")[1])-1]} ${firstLogDate.split("-")[0]}`
    : null;
  const longestBestStreak = habits.reduce((best, h) => Math.max(best, getBestStreak(h)), 0);
  const totalLogsEver = allRealLogs.length;

  // Most consistent habit (highest 28-day completion rate)
  const mostConsistent = habits.length
    ? habits.reduce((best, h) => getCompletionRate(h) > getCompletionRate(best) ? h : best, habits[0])
    : null;

  const last7Labels = Array.from({length:7}, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i)); return DAYS[d.getDay()];
  });

  if (habits.length === 0) return (
    <div style={{ padding:"60px 28px", textAlign:"center" }}>
      <div style={{ fontSize:36, marginBottom:14 }}>📈</div>
      <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>
        Start logging habits and your stats will appear here.
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forge report</div>
          {firstLogLabel && (
            <div style={{ fontSize:12, color:T.muted, marginTop:3 }}>Forging since {firstLogLabel}</div>
          )}
        </div>
        <button onClick={onShare} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:T.rsm, background:"rgba(200,144,42,0.12)", border:"none", color:T.gold, fontSize:12, fontWeight:500, cursor:"pointer", marginBottom:4 }}>
          📤 Share
        </button>
      </div>

      {/* Summary stats row */}
      <div style={{ margin:"0 14px 12px", display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
        <Stat label="habits" value={habits.length}/>
        <Stat label="days logged" value={totalDaysLogged} color={T.text}/>
        <Stat label="best streak" value={longestBestStreak > 0 ? `🔥${longestBestStreak}` : "—"} color={T.gold}/>
        <Stat label="total logs" value={totalLogsEver}/>
      </div>

      {/* Streaks */}
      <IC title="Streaks" action={<button onClick={onShowHistory} style={{ fontSize:12, color:T.accent, background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Full history →</button>}>
        {[...habits].sort((a, b) => getStreak(b) - getStreak(a)).map(h => {
          const cur  = getStreak(h);
          const best = getBestStreak(h);
          const act  = get7DayActivity(h);
          return (
            <div key={h.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
              <span style={{ fontSize:20, width:24, flexShrink:0 }}>{h.emoji}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:5 }}>{h.name}</div>
                <div style={{ display:"flex", gap:3 }}>
                  {act.map((on, i) => (
                    <div key={i} style={{ width:16, height:6, borderRadius:2, background:on ? h.color : T.surface, opacity:on?1:0.2 }}/>
                  ))}
                </div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontSize:16, fontWeight:600, color:cur > 0 ? h.color : T.hint }}>
                  {cur > 0 ? `🔥 ${cur}` : "—"}
                </div>
                {best > cur && best > 1 && (
                  <div style={{ fontSize:10, color:T.hint, marginTop:1 }}>best {best}</div>
                )}
              </div>
            </div>
          );
        })}
        {mostConsistent && (
          <div style={{ marginTop:4, padding:"10px 12px", background:`${mostConsistent.color}10`, borderRadius:T.rsm, border:`0.5px solid ${mostConsistent.color}33`, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🏆</span>
            <span style={{ fontSize:12, color:T.sub, lineHeight:1.5 }}>
              <span style={{ color:mostConsistent.color, fontWeight:500 }}>{mostConsistent.name}</span>
              {" "}is your most consistent habit — {getCompletionRate(mostConsistent)}% over 28 days
            </span>
          </div>
        )}
      </IC>

      {/* 12-week heatmap */}
      <IC title="12-week activity">
        {habits.map(h => {
          const grid = get12WeekGrid(h);
          const sessionCount = h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip").length;
          return (
            <div key={h.id} style={{ marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:12, color:T.sub }}>
                  {h.emoji} <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.name}</span>
                </span>
                <span style={{ fontSize:10, color:T.hint }}>{sessionCount} sessions</span>
              </div>
              <div style={{ display:"flex", gap:3 }}>
                {grid.map((week, wi) => (
                  <div key={wi} style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    {week.map((day, di) => (
                      <div key={di} style={{
                        width:11, height:11, borderRadius:3,
                        background: day.logged ? h.color : T.surface,
                        opacity: day.logged ? 1 : 0.18,
                      }}/>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.hint, marginTop:2 }}>
          <span>← 12 weeks ago</span><span>today →</span>
        </div>
      </IC>

      {/* 28-day completion rate */}
      <IC title="28-day completion rate">
        <div style={{ fontSize:11, color:T.hint, marginBottom:14, lineHeight:1.55 }}>
          How often you hit your goal. Daily = out of 28 days. Weekly = 4 weeks at target. Progress = 14 measurements.
        </div>
        {[...habits].sort((a, b) => getCompletionRate(b) - getCompletionRate(a)).map(h => {
          const rate = getCompletionRate(h);
          return (
            <div key={h.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <span style={{ fontSize:15, width:22, flexShrink:0 }}>{h.emoji}</span>
              <span style={{ fontSize:12, color:T.text, width:90, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.name}</span>
              <div style={{ flex:1, height:7, background:T.surface, borderRadius:4, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:4, background:rate>=80?T.green:rate>=50?h.color:T.amber, width:`${rate}%`, transition:"width 0.7s ease" }}/>
              </div>
              <span style={{ fontSize:12, color:rate>=80?T.green:rate>=50?h.color:T.muted, width:34, textAlign:"right", flexShrink:0, fontWeight:rate>=50?500:400 }}>{rate}%</span>
            </div>
          );
        })}
      </IC>

      {/* Last 7 days grid */}
      <IC title="Last 7 days">
        <div style={{ display:"grid", gridTemplateColumns:"90px repeat(7,1fr)", gap:4, marginBottom:8 }}>
          <div/>{last7Labels.map((d, i) => <div key={i} style={{ fontSize:10, color:T.hint, textAlign:"center" }}>{d}</div>)}
        </div>
        {habits.map(h => {
          const act = get7DayActivity(h);
          return (
            <div key={h.id} style={{ display:"grid", gridTemplateColumns:"90px repeat(7,1fr)", gap:4, marginBottom:5, alignItems:"center" }}>
              <div style={{ fontSize:12, color:T.sub, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingRight:4 }}>{h.emoji} {h.name}</div>
              {act.map((on, i) => <div key={i} style={{ aspectRatio:"1", borderRadius:4, background:on?h.color:T.surface, opacity:on?1:0.2 }}/>)}
            </div>
          );
        })}
      </IC>

      {/* Build (project) stats */}
      {habits.filter(h => h.habitType === "project").map(h => {
        const s = getProjectStats(h);
        return (
          <IC key={h.id} title={`${h.emoji} ${h.name} — all time`}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:s.wins>0?16:0 }}>
              <Stat label="total hrs" value={s.totalHours} color={h.color}/>
              <Stat label="hrs this wk" value={s.weekHours}/>
              <Stat label="wins" value={s.wins} color={T.green}/>
              <Stat label="hard parts" value={s.hard} color={T.amber}/>
            </div>
            {s.wins > 0 && (
              <>
                <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Wins log</div>
                {[...h.logs].filter(l => l.value?.win).reverse().slice(0, 5).map((l, i) => (
                  <div key={i} style={{ display:"flex", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}`, alignItems:"flex-start" }}>
                    <span style={{ fontSize:10, color:h.color+"99", flexShrink:0, width:80, marginTop:2, fontWeight:500 }}>{l.date}</span>
                    <span style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>{l.value.win}</span>
                  </div>
                ))}
              </>
            )}
          </IC>
        );
      })}

      {/* Progress goals */}
      {habits.filter(h => h.habitType === "progress").map(h => {
        const logs = [...h.logs].sort((a, b) => a.date.localeCompare(b.date));
        const latest = getLatestValue(h);
        const range = h.targetValue - h.startValue;
        const pct = range > 0 ? Math.min(100, Math.round(((latest - h.startValue) / range) * 100)) : 0;
        return (
          <IC key={h.id} title={`${h.emoji} ${h.name} — progress`}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:13, color:T.muted }}>Now: <strong style={{ color:h.color }}>{latest}{h.unit}</strong></span>
              <span style={{ fontSize:13, color:T.muted }}>Goal: <strong style={{ color:T.text }}>{h.targetValue}{h.unit}</strong></span>
            </div>
            <div style={{ height:8, background:T.surface, borderRadius:4, overflow:"hidden", marginBottom:6 }}>
              <div style={{ height:"100%", borderRadius:4, background:h.color, width:`${pct}%`, transition:"width 0.5s ease" }}/>
            </div>
            <div style={{ fontSize:11, color:T.muted, marginBottom:16, textAlign:"center" }}>{pct}% · {(h.targetValue - latest).toFixed(1)}{h.unit} remaining</div>
            <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Recent measurements</div>
            {logs.slice(-6).reverse().map((l, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderTop:`0.5px solid ${T.border}` }}>
                <span style={{ fontSize:11, color:h.color+"99", fontWeight:500 }}>{fmtEntryDate(l.date)}</span>
                <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                  <span style={{ fontSize:15, color:T.text, fontWeight:500 }}>{l.value}</span>
                  <span style={{ fontSize:11, color:T.muted }}>{h.unit}</span>
                </div>
              </div>
            ))}
          </IC>
        );
      })}
    </div>
  );
}

// ─── HABITS SCREEN ────────────────────────────────────────────────────────────
function HabitsScreen({ habits, onEdit, onDelete, onAdd, onReflect, onCoach }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const grouped = Object.fromEntries(Object.keys(HABIT_TYPES).map(k => [k, habits.filter(h => h.habitType === k)]));
  function DetailRow({ h }) {
    if (h.habitType === "project") {
      const s = getProjectStats(h);
      return <div style={{ padding:"0 15px 14px", display:"flex", gap:8 }}><Stat label="total hrs" value={s.totalHours} color={h.color}/><Stat label="wins" value={s.wins} color={T.green}/><Stat label="hard parts" value={s.hard} color={T.amber}/></div>;
    }
    if (h.habitType === "progress") {
      const latest = getLatestValue(h), range = h.targetValue - h.startValue;
      const pct = range > 0 ? Math.min(100, Math.round(((latest - h.startValue) / range) * 100)) : 0;
      return <div style={{ padding:"0 15px 14px" }}><div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden" }}><div style={{ height:"100%", borderRadius:3, background:h.color, width:`${pct}%` }}/></div><div style={{ fontSize:11, color:T.muted, marginTop:5 }}>{pct}% · {latest}{h.unit} of {h.targetValue}{h.unit}</div></div>;
    }
    if (h.habitType === "weekly") {
      const wk = getWeeklyCount(h), pct = Math.min(100, Math.round((wk / h.weeklyTarget) * 100));
      return <div style={{ padding:"0 15px 14px" }}><div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden" }}><div style={{ height:"100%", borderRadius:3, background:h.color, width:`${pct}%` }}/></div><div style={{ fontSize:11, color:T.muted, marginTop:5 }}>{wk}/{h.weeklyTarget} sessions this week</div></div>;
    }
    return null;
  }

  return (
    <div>
      <div style={{ padding:"16px 18px 10px" }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Your habits</div>
        <div style={{ fontSize:13, color:T.muted, marginTop:3 }}>{habits.length} active</div>
      </div>
      {Object.entries(grouped).filter(([, arr]) => arr.length > 0).map(([type, arr]) => (
        <div key={type}>
          <SLabel>{HABIT_TYPES[type]?.label}</SLabel>
          {arr.map(h => (
            <div key={h.id} className="rc" style={{ margin:"0 14px 10px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${confirmDelete===h.id?"rgba(231,76,60,0.4)":T.border}`, overflow:"hidden", transition:"border-color 0.2s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
                <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:h.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{h.emoji}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{h.name}</div>
                  <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
                    {getStreak(h)>0?`🔥 ${getStreak(h)} · `:""}
                    {new Set(h.logs.filter(l=>l.value!=="quicknote").map(l=>l.date)).size} days logged
                  </div>
                </div>
                {confirmDelete === h.id ? (
                  <>
                    <button onClick={() => { onDelete(h.id); setConfirmDelete(null); }}
                      style={{ fontSize:12, color:"#e74c3c", background:"rgba(231,76,60,0.1)", border:`0.5px solid rgba(231,76,60,0.4)`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer", fontWeight:500, marginRight:4 }}>
                      Delete
                    </button>
                    <button onClick={() => setConfirmDelete(null)}
                      style={{ fontSize:12, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer" }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => onEdit(h.id)} style={{ fontSize:12, color:h.color, background:"none", border:`0.5px solid ${h.color+"44"}`, borderRadius:T.rsm, padding:"4px 10px", cursor:"pointer", fontWeight:500, marginRight:6 }}>Edit</button>
                    <button onClick={() => setConfirmDelete(h.id)} style={{ fontSize:18, color:T.hint, background:"none", border:"none", cursor:"pointer" }}>×</button>
                  </>
                )}
              </div>
              {confirmDelete === h.id && (
                <div style={{ padding:"0 15px 12px", fontSize:12, color:"rgba(231,76,60,0.8)" }}>
                  This will permanently delete <strong>{h.name}</strong> and all its logs. This can't be undone.
                </div>
              )}
              <DetailRow h={h}/>
            </div>
          ))}
        </div>
      ))}
      <button onClick={onAdd} style={{ margin:"8px 14px 0", width:"calc(100% - 28px)", border:`1px dashed ${T.borderStrong}`, background:"none", borderRadius:T.r, padding:14, fontSize:13, color:T.muted, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round"/></svg>Add habit
      </button>

      {/* AI Coach card */}
      <div onClick={onCoach} style={{ margin:"16px 14px 0", background:T.raised, borderRadius:T.r, border:`0.5px solid rgba(200,144,42,0.25)`, padding:"16px 18px", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🤖</div>
          <div style={{ flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ fontSize:14, fontWeight:500, color:T.text }}>AI Habit Coach</div>
              <div style={{ fontSize:9, color:T.gold, background:"rgba(200,144,42,0.15)", border:`0.5px solid rgba(200,144,42,0.3)`, borderRadius:10, padding:"2px 7px", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>Pro · Soon</div>
            </div>
            <div style={{ fontSize:12, color:T.muted, marginTop:1 }}>Personalised coaching based on your actual habits</div>
          </div>
        </div>
        {/* Preview bubble */}
        <div style={{ background:T.surface, borderRadius:"12px 12px 12px 3px", padding:"10px 14px", fontSize:13, color:T.sub, lineHeight:1.6, borderLeft:`2px solid rgba(200,144,42,0.3)` }}>
          "Hey — I can see what you're working on. I can help you figure out what to focus on next, spot patterns between your habits, or just think through something that's been blocking you."
        </div>
        <div style={{ marginTop:10, fontSize:11, color:T.hint, textAlign:"center", letterSpacing:"0.04em" }}>✦ Available with Forged Pro — coming soon</div>
      </div>
    </div>
  );
}



// ─── AI HABIT COACH ──────────────────────────────────────────────────────────
function buildCoachSystemPrompt(user, habits) {
  const name = user?.name || "there";
  const today = todayStr();

  const habitSummaries = habits.map(h => {
    const type  = HABIT_TYPES[h.habitType]?.label || h.habitType;
    const recentLogs = h.logs
      .filter(l => l.date >= daysAgo(14))
      .sort((a, b) => b.date.localeCompare(a.date));

    let detail = `- ${h.emoji || ""} ${h.name} (${type}, streak: ${h.streak} days)`;

    if (h.habitType === "weekly" && h.weeklyTarget) {
      const weekCount = getWeeklyCount(h);
      detail += `, ${weekCount}/${h.weeklyTarget} sessions this week`;
    }
    if (h.habitType === "progress") {
      detail += `, current: ${getLatestValue(h)}${h.unit || ""}, target: ${h.targetValue}${h.unit || ""}`;
    }
    if (h.habitType === "project") {
      const s = getProjectStats(h);
      detail += `, ${s.totalHours}h total, ${s.weekHours}h this week`;
    }
    if (h.habitType === "limit" && h.dailyBudget) {
      detail += `, daily limit: ${h.dailyBudget}${h.unit || ""}`;
    }

    // Recent reflections
    const reflections = recentLogs
      .filter(l => l.reflection)
      .slice(0, 3)
      .map(l => `  [${l.date}] "${l.reflection}"`);
    if (reflections.length) detail += `\n  Recent reflections:\n${reflections.join("\n")}`;

    // Recent wins & hard parts (project type)
    const wins = recentLogs.filter(l => l.value?.win).slice(0, 2).map(l => `  [${l.date}] Win: "${l.value.win}"`);
    const hard = recentLogs.filter(l => l.value?.hardPart).slice(0, 2).map(l => `  [${l.date}] Hard part: "${l.value.hardPart}"`);
    if (wins.length) detail += `\n${wins.join("\n")}`;
    if (hard.length) detail += `\n${hard.join("\n")}`;

    // Recent notes
    const notes = recentLogs
      .filter(l => l.value === "quicknote" && l.note)
      .slice(0, 2)
      .map(l => `  [${l.date}] Note: "${l.note}"`);
    if (notes.length) detail += `\n${notes.join("\n")}`;

    return detail;
  }).join("\n\n");

  return `You are a personal habit coach inside Forged, a minimalist habit-tracking app. Your job is to help ${name} understand their habits, spot patterns, troubleshoot blocks, and stay motivated — using their actual data below.

Today: ${today}
User: ${name}

Their habits:
${habitSummaries || "No habits yet."}

Guidelines:
- Be conversational, warm, and direct. No fluff or generic advice.
- Reference their actual data when relevant (streaks, reflections, wins, hard parts).
- Ask one focused question at a time rather than overwhelming them.
- Keep responses concise — this is a mobile chat interface.
- If they're struggling with a habit, dig into the why before suggesting tactics.
- Celebrate genuine wins. Don't be sycophantic about small things.
- Never make up data or invent habit details not shown above.`;
}

function AICoach({ habits, user, isPro, onClose, onUpgrade }) {
  const greeting = `Hey ${user?.name || "there"} 👋 I can see you're working on ${habits.length} habit${habits.length !== 1 ? "s" : ""}. What's on your mind?`;
  const [messages, setMessages] = useState([{ role:"assistant", content:greeting }]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const bottomRef = useRef(null);
  const speech    = useSpeechInput(t => setInput(p => p.trim() ? p + " " + t : t));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages, loading]);

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setError(null);
    const next = [...messages, { role:"user", content:trimmed }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          system:   buildCoachSystemPrompt(user, habits),
          messages: next.map(m => ({ role:m.role, content:m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Something went wrong");
      setMessages(prev => [...prev, { role:"assistant", content:data.reply }]);
    } catch (e) {
      setError(e.message || "Couldn't reach the coach. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  // ── Free-user teaser ──────────────────────────────────────────────────────
  if (!isPro) {
    const preview = [
      `Hey ${user?.name || "there"} 👋 I can see you're working on ${habits.length} habit${habits.length !== 1 ? "s" : ""} right now.`,
      "I can help you figure out what to focus on next, spot patterns between your habits, or just think through something that's been blocking you.",
      "What's on your mind?",
    ];
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"18px 20px 14px", borderBottom:`0.5px solid ${T.border}` }}>
            <div style={{ width:38, height:38, borderRadius:"50%", background:"rgba(200,144,42,0.18)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:19 }}>🤖</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15, fontWeight:500, color:T.text }}>AI Habit Coach</div>
              <div style={{ fontSize:11, color:T.gold }}>⚡ Forged Pro</div>
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
          </div>
          <div style={{ padding:"20px 20px 10px", display:"flex", flexDirection:"column", gap:10 }}>
            {preview.map((line, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"flex-start" }}>
                <div style={{ maxWidth:"88%", padding:"10px 14px", borderRadius:"14px 14px 14px 3px", background:T.surface, fontSize:14, color:T.text, lineHeight:1.6 }}>{line}</div>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"flex-end", opacity:0.35 }}>
              <div style={{ padding:"10px 14px", borderRadius:"14px 14px 3px 14px", background:T.accent, fontSize:14, color:"#fff", filter:"blur(3px)" }}>I keep skipping my workouts…</div>
            </div>
          </div>
          <div style={{ margin:"0 20px 10px", background:"rgba(200,144,42,0.07)", border:`0.5px solid rgba(200,144,42,0.25)`, borderRadius:T.r, padding:"16px", textAlign:"center" }}>
            <div style={{ fontSize:26, marginBottom:8 }}>🔒</div>
            <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:4 }}>Coach unlocks with Forged Pro</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.6, marginBottom:14 }}>It knows your actual habits, streaks, and reflections — not generic advice.</div>
            <button onClick={() => { onClose(); onUpgrade(); }}
              style={{ width:"100%", padding:"13px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#1a1a16", fontSize:14, fontWeight:600, cursor:"pointer" }}>
              See Pro pricing →
            </button>
          </div>
          <div style={{ padding:"12px 16px 32px", borderTop:`0.5px solid ${T.border}`, display:"flex", gap:10, opacity:0.3, pointerEvents:"none" }}>
            <div style={{ flex:1, background:T.surface, border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm, padding:"10px 14px", fontSize:14, color:T.hint }}>Ask anything about your habits…</div>
            <div style={{ width:44, height:44, borderRadius:"50%", background:T.surface, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 9h14M9 2l7 7-7 7" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Pro: real chat ────────────────────────────────────────────────────────
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", display:"flex", flexDirection:"column", height:"80vh", maxHeight:680 }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"16px 20px 13px", borderBottom:`0.5px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ width:38, height:38, borderRadius:"50%", background:"rgba(200,144,42,0.18)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:19 }}>🤖</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>AI Habit Coach</div>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:T.green }}/>
              <div style={{ fontSize:11, color:T.muted }}>Knows your habits</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px", display:"flex", flexDirection:"column", gap:10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display:"flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth:"85%", padding:"10px 14px",
                borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                background: m.role === "user" ? T.accent : T.surface,
                fontSize:14, color: m.role === "user" ? "#fff" : T.text,
                lineHeight:1.6, whiteSpace:"pre-wrap", wordBreak:"break-word",
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display:"flex", justifyContent:"flex-start" }}>
              <div style={{ padding:"10px 16px", borderRadius:"14px 14px 14px 3px", background:T.surface, display:"flex", gap:5, alignItems:"center" }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.muted,
                    animation:"coachDot 1.2s ease-in-out infinite", animationDelay:`${i*0.2}s` }}/>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ textAlign:"center", fontSize:12, color:T.accent, padding:"4px 8px" }}>{error}</div>
          )}

          <div ref={bottomRef}/>
        </div>

        {/* Input bar */}
        <div style={{ padding:"10px 14px 32px", borderTop:`0.5px solid ${T.border}`, display:"flex", gap:8, alignItems:"flex-end", flexShrink:0 }}>
          <div style={{ flex:1, position:"relative" }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={speech.listening ? "Listening…" : "Ask anything about your habits…"}
              rows={1}
              style={{
                width:"100%", boxSizing:"border-box",
                background:T.surface, border:`0.5px solid ${T.borderStrong}`,
                borderRadius:T.rsm, padding:"10px 14px",
                fontSize:14, color:T.text, resize:"none",
                fontFamily:T.font, lineHeight:1.5, outline:"none",
                overflowY:"auto", maxHeight:100,
              }}
            />
            {speech.interim && <div style={{ fontSize:11, color:T.hint, fontStyle:"italic", marginTop:3, paddingLeft:2 }}>{speech.interim}…</div>}
          </div>
          <MicBtn speech={speech} color={T.gold} size={42}/>
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            style={{
              width:42, height:42, borderRadius:"50%", border:"none", flexShrink:0,
              background: input.trim() && !loading ? T.gold : T.surface,
              cursor: input.trim() && !loading ? "pointer" : "default",
              display:"flex", alignItems:"center", justifyContent:"center",
              transition:"background 0.2s",
            }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 9h14M9 2l7 7-7 7" stroke={input.trim() && !loading ? "#1a1a16" : T.hint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Dot animation keyframes */}
      <style>{`
        @keyframes coachDot {
          0%,80%,100% { transform:scale(0.6); opacity:0.4; }
          40% { transform:scale(1); opacity:1; }
        }
      `}</style>
    </div>
  );
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────────
// 3 steps: Welcome → Name + focus → First habit suggestion
// Shown only on first launch (onboarded === false in app state)
const ONBOARD_STEPS = [
  {
    id:"welcome",
    title:"Forged.",
    sub:"Most habit apps track what you do. Forged helps you understand why.",
    body:"You already know what you want to change. The hard part is figuring out what's actually getting in the way. Forged is simple: log what you do, reflect when it matters, and let the patterns show you the rest.",
    cta:"Let's build",
  },
  {
    id:"name",
    title:"First — who are you?",
    sub:"Your name. That's it. No email, no password, no bullshit.",
    body:null,
    cta:"That's me",
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

function OnboardingScreen({ onComplete, onSkip }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  // Multi-select: array of selected labels
  const [selected, setSelected] = useState([]);
  const [weightGoal, setWeightGoal] = useState({ start:"", target:"", unit:"kg" });
  const [limitBudget, setLimitBudget] = useState({ budget:"60", unit:"min", name:"" });

  const current = ONBOARD_STEPS[step];
  const isLast = step === ONBOARD_STEPS.length - 1;

  function toggleFocus(label) {
    setSelected(prev =>
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  }

  function buildHabitFromOption(opt, wg, lb) {
    const base = {
      id: Date.now() + Math.random() + "",
      name: opt.name, emoji: opt.emoji, habitType: opt.habitType,
      color: opt.color, reflection: true,
      reflectionPrompt: opt.reflectionPrompt,
      streak: 0, logs: [],
    };
    if (opt.habitType === "weekly")   return { ...base, weeklyTarget: opt.weeklyTarget || 3 };
    if (opt.habitType === "progress") return { ...base, startValue:parseFloat(wg.start)||70, targetValue:parseFloat(wg.target)||80, unit:wg.unit||"kg" };
    if (opt.habitType === "limit")    return { ...base, name:lb.name||opt.name, dailyBudget:parseInt(lb.budget)||60, unit:lb.unit||"min" };
    return base;
  }

  function handleContinue() {
    if (step === 1 && !name.trim()) return;
    if (isLast) {
      const selectedOptions = FOCUS_OPTIONS.filter(o => selected.includes(o.label));
      const habits = selectedOptions.map(opt => buildHabitFromOption(opt, weightGoal, limitBudget));
      onComplete({ name: name.trim() || "You", habits });
      return;
    }
    setStep(s => s + 1);
  }

  const hasWeight = selected.includes("Hitting a weight goal");
  const hasLimit  = selected.includes("Reducing something");

  const styleInp = {
    width:"100%", border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm,
    background:T.surface, padding:"10px 12px", fontSize:14, color:T.text,
    outline:"none", boxSizing:"border-box",
  };

  return (
    <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column" }}>
      {/* Top bar with skip */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"32px 24px 0" }}>
        <div style={{ display:"flex", gap:6 }}>
          {ONBOARD_STEPS.map((_, i) => (
            <div key={i} style={{ width:i===step?20:6, height:6, borderRadius:3, background:i<=step?T.accent:T.surface, transition:"all 0.3s" }}/>
          ))}
        </div>
      </div>

      <div style={{ flex:1, padding:"32px 24px 16px", display:"flex", flexDirection:"column", overflowY:"auto" }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, lineHeight:1.2, marginBottom:10 }}>{current.title}</div>
        <div style={{ fontSize:14, color:T.muted, marginBottom:24, lineHeight:1.6 }}>{current.sub}</div>

        {/* Step 0: Welcome body text */}
        {current.body && (
          <div style={{ background:T.raised, borderRadius:T.r, padding:"16px 18px", marginBottom:24, borderLeft:`3px solid ${T.accent}` }}>
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.7 }}>{current.body}</div>
          </div>
        )}

        {/* Step 1: Name */}
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

        {/* Step 2: Multi-select focus areas */}
        {step === 2 && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
              {FOCUS_OPTIONS.map(opt => {
                const isOn = selected.includes(opt.label);
                return (
                  <button key={opt.label} onClick={() => toggleFocus(opt.label)}
                    style={{ padding:"14px 12px", borderRadius:T.rsm, border:`1.5px solid ${isOn?opt.color:T.borderStrong}`, background:isOn?opt.color+"20":T.surface, cursor:"pointer", textAlign:"left", transition:"all 0.15s", position:"relative" }}>
                    {isOn && (
                      <div style={{ position:"absolute", top:8, right:8, width:18, height:18, borderRadius:"50%", background:opt.color, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    )}
                    <div style={{ fontSize:22, marginBottom:6 }}>{opt.emoji}</div>
                    <div style={{ fontSize:12, fontWeight:500, color:isOn?opt.color:T.text, lineHeight:1.3 }}>{opt.label}</div>
                  </button>
                );
              })}
            </div>

            {/* Weight goal detail */}
            {hasWeight && (
              <div style={{ background:T.raised, borderRadius:T.rsm, padding:14, marginBottom:10 }}>
                <div style={{ fontSize:11, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Weight goal</div>
                <div style={{ display:"flex", gap:8 }}>
                  <div style={{ flex:1 }}><div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>CURRENT</div><input style={styleInp} type="number" step="0.1" placeholder="74.5" value={weightGoal.start} onChange={e => setWeightGoal(g=>({...g,start:e.target.value}))}/></div>
                  <div style={{ flex:1 }}><div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>TARGET</div><input style={styleInp} type="number" step="0.1" placeholder="80" value={weightGoal.target} onChange={e => setWeightGoal(g=>({...g,target:e.target.value}))}/></div>
                  <div style={{ width:60 }}><div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>UNIT</div><input style={styleInp} value={weightGoal.unit} onChange={e => setWeightGoal(g=>({...g,unit:e.target.value}))}/></div>
                </div>
              </div>
            )}

            {/* Limit detail */}
            {hasLimit && (
              <div style={{ background:T.raised, borderRadius:T.rsm, padding:14, marginBottom:10 }}>
                <div style={{ fontSize:11, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>What are you limiting?</div>
                <div style={{ marginBottom:8 }}><div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>NAME</div><input style={styleInp} placeholder="e.g. Social media" value={limitBudget.name} onChange={e => setLimitBudget(b=>({...b,name:e.target.value}))}/></div>
                <div style={{ display:"flex", gap:8 }}>
                  <div style={{ flex:1 }}><div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>DAILY BUDGET</div><input style={styleInp} type="number" value={limitBudget.budget} onChange={e => setLimitBudget(b=>({...b,budget:e.target.value}))}/></div>
                  <div style={{ width:80 }}><div style={{ fontSize:10, color:T.hint, marginBottom:5 }}>UNIT</div><input style={styleInp} value={limitBudget.unit} onChange={e => setLimitBudget(b=>({...b,unit:e.target.value}))}/></div>
                </div>
              </div>
            )}

            {selected.length > 0 && (
              <div style={{ fontSize:12, color:T.muted, textAlign:"center", marginBottom:4 }}>
                {selected.length} selected — you can add more habits later
              </div>
            )}
          </>
        )}
      </div>

      {/* CTA fixed at bottom */}
      <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
        <button onClick={handleContinue}
          style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:step===2&&selected.length===0?T.surface:T.accent, color:step===2&&selected.length===0?T.muted:"#fff", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s" }}>
          {current.cta}
        </button>
        {step === 2 && (
          <button onClick={() => onComplete({ name:name.trim()||"You", habits:[] })}
            style={{ width:"100%", padding:12, borderRadius:T.rsm, border:"none", background:"none", color:T.muted, fontSize:14, cursor:"pointer", marginTop:8 }}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

// ─── SHARE CARD ───────────────────────────────────────────────────────────────
function ShareCardModal({ user, habits, xp, onClose }) {
  const level = getLevel(xp);
  const totalLogs = habits.reduce((s, h) => s + h.logs.length, 0);
  const bestStreak = Math.max(0, ...habits.map(h => getStreak(h)));
  const loggedToday = habits.filter(h => isLoggedToday(h)).length;
  const ws = currentWeekStart();
  const weekLogs = habits.reduce((s, h) => s + h.logs.filter(l => l.date >= ws).length, 0);
  const weekTotal = habits.length * 7;
  const weekPct = weekTotal > 0 ? Math.min(100, Math.round((weekLogs / weekTotal) * 100)) : 0;
  const isEmoji = user.avatarUrl && !user.avatarUrl.startsWith("http");

  return (
    <div style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:"100%", maxWidth:380, animation:"shareSlide 0.3s ease-out" }}>
        {/* The card — designed for screenshotting */}
        <div id="share-card" style={{ background:"linear-gradient(145deg, #1A1A16 0%, #0F0F0D 100%)", borderRadius:24, padding:"32px 28px 28px", border:`1px solid ${T.borderMid}`, boxShadow:"0 20px 60px rgba(0,0,0,0.8)" }}>
          {/* Top row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:28 }}>
            <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
            <div style={{ fontSize:11, color:T.hint, letterSpacing:"0.06em", textTransform:"uppercase" }}>{fmtDate()}</div>
          </div>
          {/* Avatar + name */}
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
            <div style={{ width:52, height:52, borderRadius:"50%", background:T.accent+"22", border:`2px solid ${T.accent}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {isEmoji
                ? <span style={{ fontSize:26 }}>{user.avatarUrl}</span>
                : user.avatarUrl
                ? <img src={user.avatarUrl} style={{ width:"100%", height:"100%", borderRadius:"50%", objectFit:"cover" }}/>
                : <span style={{ fontFamily:T.serif, fontSize:24, color:T.accent }}>{(user.name||"?").charAt(0).toUpperCase()}</span>
              }
            </div>
            <div>
              <div style={{ fontSize:18, fontWeight:500, color:T.text }}>{user.name}</div>
              <div style={{ fontSize:12, color:level.color, fontWeight:500, marginTop:2 }}>⚡ {level.label} · {xp} xp</div>
            </div>
          </div>
          {/* Stats grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {[
              { label:"This week",    value:`${weekPct}%`,    sub:"completion",   color:weekPct>=70?T.green:T.amber },
              { label:"Today",        value:`${loggedToday}/${habits.length}`, sub:"habits logged", color:T.accent },
              { label:"Best streak",  value:`${bestStreak}d`, sub:"consecutive",  color:T.gold },
              { label:"Total logs",   value:totalLogs,        sub:"all time",     color:T.text },
            ].map((s, i) => (
              <div key={i} style={{ background:"rgba(255,255,255,0.04)", borderRadius:14, padding:"14px 16px", border:`0.5px solid ${T.border}` }}>
                <div style={{ fontSize:22, fontWeight:600, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:11, color:T.hint, marginTop:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>{s.sub}</div>
                <div style={{ fontSize:10, color:T.hint, marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {/* Habits row */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
            {habits.slice(0, 8).map(h => (
              <div key={h.id} style={{ fontSize:11, padding:"4px 10px", borderRadius:12, background:h.color+"22", color:h.color, border:`0.5px solid ${h.color+"44"}` }}>
                {h.emoji} {h.name}
              </div>
            ))}
          </div>
          {/* Footer */}
          <div style={{ borderTop:`0.5px solid ${T.border}`, paddingTop:14, fontSize:11, color:T.hint, letterSpacing:"0.04em" }}>
            forged-sage.vercel.app · track what you're forging
          </div>
        </div>
        {/* Instructions */}
        <div style={{ textAlign:"center", marginTop:18, fontSize:13, color:"rgba(255,255,255,0.5)" }}>
          Screenshot this to share 📸
        </div>
        <button onClick={onClose} style={{ width:"100%", marginTop:14, padding:14, borderRadius:T.rsm, border:"none", background:T.raised, color:T.muted, fontSize:14, cursor:"pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}

// ─── AVATAR PICKER ────────────────────────────────────────────────────────────
const AVATARS = [
  "🦁","🐯","🐺","🦊","🐼","🐨",
  "🦋","🦅","🦍","🐉","🦄","🐬",
  "🔥","⚡","🌊","🏔️","🌙","☀️",
  "🎯","💎","🥷","⚒️","🛡️","👑",
];

function AvatarPickerModal({ current, onSelect, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:6 }}>Pick your avatar</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:20 }}>Tap one to set it as your profile picture.</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:10, marginBottom:8 }}>
        {AVATARS.map(a => (
          <button key={a} onClick={() => { onSelect(a); onClose(); }}
            style={{ aspectRatio:"1", borderRadius:12, border:`2px solid ${current===a?T.accent:T.border}`, background:current===a?T.accent+"22":T.surface, fontSize:26, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.12s" }}>
            {a}
          </button>
        ))}
      </div>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── DELETE CONFIRM MODAL ────────────────────────────────────────────────────

// ─── PROFILE / SETTINGS SCREEN ────────────────────────────────────────────────
// ─── UPGRADE MODAL ────────────────────────────────────────────────────────────
function UpgradeModal({ onClose, habitCount = 0, userId, userEmail }) {
  const [spots,        setSpots]        = useState(null);
  const [checkoutPlan, setCheckoutPlan] = useState(null); // "monthly" | "annual" | null = idle

  useEffect(() => {
    supabase.rpc("beta_spot_count").then(({ data }) => {
      if (typeof data === "number") setSpots(data);
    });
  }, []);

  const spotsLeft = spots !== null ? Math.max(0, 100 - spots) : null;
  const spotsPct  = spots !== null ? Math.min(100, (spots / 100) * 100) : 0;

  const features = [
    { icon:"∞",  label:"Unlimited habits",   free:"Up to 5",          pro:"No limit",              live:true },
    { icon:"🤖", label:"AI Habit Coach",      free:"—",                pro:"Personalised coaching", live:true },
    { icon:"📜", label:"Full history",        free:"Last 7 days",      pro:"Every entry, forever",  live:true },
    { icon:"🔔", label:"Push reminders",      free:"—",                pro:"Smart daily nudges",    live:false },
    { icon:"📊", label:"Advanced analytics",  free:"28-day view",      pro:"90-day + connections",  live:false },
  ];

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:500, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"24px 24px 0 0", padding:"24px 22px 44px", overflowY:"auto", maxHeight:"92vh" }}>

        {/* Close */}
        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:4 }}>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:26, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {/* Beta spots urgency bar */}
        <div style={{ background:"rgba(200,144,42,0.08)", border:`1px solid rgba(200,144,42,0.3)`, borderRadius:T.r, padding:"12px 14px", marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
            <span style={{ fontSize:12, fontWeight:600, color:T.gold }}>🔥 Beta pricing — first 100 users only</span>
            {spotsLeft !== null && (
              <span style={{ fontSize:11, color: spotsLeft <= 10 ? "#e74c3c" : T.muted, fontWeight:500 }}>
                {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
              </span>
            )}
          </div>
          <div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:3, background:T.gold, width:`${spotsPct}%`, transition:"width 0.8s ease" }}/>
          </div>
          <div style={{ fontSize:11, color:T.hint, marginTop:6, lineHeight:1.5 }}>
            Lock in <strong style={{ color:T.text }}>$4.99/mo forever</strong> — goes to $7.99 once we hit 100 users.
          </div>
        </div>

        {/* Header */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, marginBottom:4 }}>Forged Pro</div>
          {habitCount >= 5 && (
            <div style={{ fontSize:13, color:T.amber }}>You've hit the 5-habit free limit — Pro removes it.</div>
          )}
        </div>

        {/* Feature comparison */}
        <div style={{ background:T.surface, borderRadius:T.r, overflow:"hidden", marginBottom:20, border:`0.5px solid ${T.border}` }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px", borderBottom:`0.5px solid ${T.border}`, padding:"7px 14px" }}>
            <span style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em" }}>Feature</span>
            <span style={{ fontSize:10, color:T.hint, textAlign:"center", textTransform:"uppercase", letterSpacing:"0.07em" }}>Free</span>
            <span style={{ fontSize:10, color:T.gold, textAlign:"center", textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600 }}>Pro</span>
          </div>
          {features.map((f, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px", padding:"10px 14px", borderBottom: i < features.length-1 ? `0.5px solid ${T.border}` : "none", alignItems:"center" }}>
              <div>
                <span style={{ fontSize:13 }}>{f.icon} </span>
                <span style={{ fontSize:13, color:T.text, fontWeight:500 }}>{f.label}</span>
                {!f.live && <span style={{ fontSize:9, color:T.hint, marginLeft:6, textTransform:"uppercase", letterSpacing:"0.07em" }}>soon</span>}
              </div>
              <span style={{ fontSize:11, color:T.hint, textAlign:"center" }}>{f.free}</span>
              <span style={{ fontSize:11, color: f.live ? T.gold : T.muted, textAlign:"center", fontWeight: f.live ? 500 : 400 }}>{f.pro}</span>
            </div>
          ))}
        </div>

        {/* Pricing tiers */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
          <div style={{ background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"14px 12px", textAlign:"center" }}>
            <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Monthly</div>
            <div style={{ fontSize:28, fontWeight:600, color:T.text, letterSpacing:"-0.02em" }}>$4.99</div>
            <div style={{ fontSize:11, color:T.hint, marginTop:3, textDecoration:"line-through" }}>$7.99/mo after 100 users</div>
          </div>
          <div style={{ background:"rgba(200,144,42,0.08)", borderRadius:T.r, border:`1px solid rgba(200,144,42,0.45)`, padding:"14px 12px", textAlign:"center", position:"relative" }}>
            <div style={{ position:"absolute", top:-10, left:"50%", transform:"translateX(-50%)", background:T.gold, color:"#1a1a16", fontSize:9, fontWeight:700, padding:"3px 9px", borderRadius:20, letterSpacing:"0.08em", textTransform:"uppercase", whiteSpace:"nowrap" }}>Best value</div>
            <div style={{ fontSize:10, color:T.gold, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Annual</div>
            <div style={{ fontSize:28, fontWeight:600, color:T.gold, letterSpacing:"-0.02em" }}>$39.99</div>
            <div style={{ fontSize:11, color:T.green, marginTop:3 }}>$3.33/mo · save 33%</div>
          </div>
        </div>

        {/* CTA */}
        <button
          disabled={!!checkoutPlan}
          onClick={async () => {
            setCheckoutPlan("monthly");
            try {
              const res = await fetch("/api/create-checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, email: userEmail, plan: "monthly" }),
              });
              const { url, error } = await res.json();
              if (url) { window.location.href = url; }
              else { alert(error || "Couldn't start checkout — try again"); setCheckoutPlan(null); }
            } catch { alert("Couldn't connect — try again"); setCheckoutPlan(null); }
          }}
          style={{ display:"block", width:"100%", padding:"16px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#1a1a16", fontSize:16, fontWeight:700, cursor: checkoutPlan ? "wait" : "pointer", marginBottom:10, textAlign:"center", boxSizing:"border-box", letterSpacing:"0.01em", opacity: checkoutPlan ? 0.7 : 1 }}>
          {checkoutPlan === "monthly" ? "Redirecting to checkout…" : "Get Forged Pro — $4.99/mo →"}
        </button>
        <button
          disabled={!!checkoutPlan}
          onClick={async () => {
            setCheckoutPlan("annual");
            try {
              const res = await fetch("/api/create-checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, email: userEmail, plan: "annual" }),
              });
              const { url, error } = await res.json();
              if (url) { window.location.href = url; }
              else { alert(error || "Couldn't start checkout — try again"); setCheckoutPlan(null); }
            } catch { alert("Couldn't connect — try again"); setCheckoutPlan(null); }
          }}
          style={{ display:"block", width:"100%", padding:"12px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.4)`, background:"none", color:T.gold, fontSize:14, fontWeight:600, cursor: checkoutPlan ? "wait" : "pointer", marginBottom:10, textAlign:"center", boxSizing:"border-box", opacity: checkoutPlan ? 0.7 : 1 }}>
          {checkoutPlan === "annual" ? "Redirecting to checkout…" : "Annual — $39.99/yr (save 33%) →"}
        </button>
        <div style={{ fontSize:11, color:T.hint, textAlign:"center", lineHeight:1.7 }}>
          Your price is locked in forever — even after we raise it publicly
        </div>
      </div>
    </div>
  );
}

function ProfileScreen({ user, xp, habits, isPro, refCode, onUpdateUser, onResetOnboarding, onSignOut, onShowTour, onUpgrade }) {
  const [editingName,    setEditingName]    = useState(false);
  const [nameVal,        setNameVal]        = useState(user.name);
  const [showAvatarPick, setShowAvatarPick] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [refCount,       setRefCount]       = useState(null);
  const [refCopied,      setRefCopied]      = useState(false);

  useEffect(() => {
    supabase.rpc("my_referral_count").then(({ data }) => {
      if (typeof data === "number") setRefCount(data);
    });
  }, []);

  const refLink = refCode
    ? `https://forged-sage.vercel.app/landing.html?ref=${refCode}`
    : null;

  function copyRefLink() {
    if (!refLink) return;
    navigator.clipboard.writeText(refLink).then(() => {
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 2000);
    });
  }

  const level = getLevel(xp);
  const next  = nextLevel(xp);
  const pct   = next ? Math.round(((xp - level.min) / (next.min - level.min)) * 100) : 100;
  const totalLogs        = habits.reduce((s, h) => s + h.logs.length, 0);
  const totalReflections = habits.reduce((s, h) => s + h.logs.filter(l => l.reflection).length, 0);
  const bestStreak       = Math.max(0, ...habits.map(h => getStreak(h)));

  const isEmoji = user.avatarUrl && !user.avatarUrl.startsWith("http");
  const isImage = user.avatarUrl && user.avatarUrl.startsWith("http");

  function SRow({ label, value, onPress, destructive, note }) {
    return (
      <button onClick={onPress || undefined} style={{ display:"flex", alignItems:"center", width:"100%", padding:"13px 16px", background:"none", border:"none", cursor:onPress?"pointer":"default", borderBottom:`0.5px solid ${T.border}`, gap:10 }}>
        <span style={{ fontSize:14, color:destructive?T.accent:T.text, flex:1, textAlign:"left" }}>{label}</span>
        {note && <span style={{ fontSize:12, color:T.hint }}>{note}</span>}
        {value && <span style={{ fontSize:13, color:T.muted }}>{value}</span>}
        {onPress && !destructive && <span style={{ fontSize:18, color:T.hint }}>›</span>}
      </button>
    );
  }

  return (
    <div>
      {/* Profile header */}
      <div style={{ padding:"24px 18px 0" }}>
        {/* Avatar */}
        <div style={{ position:"relative", width:72, height:72, marginBottom:14 }}>
          <div onClick={() => setShowAvatarPick(true)} style={{ width:72, height:72, borderRadius:"50%", background:T.accent+"22", border:`2px solid ${T.accent}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden" }}>
            {isImage
              ? <img src={user.avatarUrl} alt="avatar" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
              : isEmoji
              ? <span style={{ fontSize:34 }}>{user.avatarUrl}</span>
              : <span style={{ fontFamily:T.serif, fontSize:32, color:T.accent }}>{user.name.charAt(0).toUpperCase()}</span>
            }
          </div>
          <div onClick={() => setShowAvatarPick(true)} style={{ position:"absolute", bottom:0, right:0, width:22, height:22, borderRadius:"50%", background:T.raised, border:`1px solid ${T.borderMid}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
            <span style={{ fontSize:11 }}>✏️</span>
          </div>
        </div>
        {showAvatarPick && (
          <AvatarPickerModal
            current={user.avatarUrl}
            onSelect={emoji => onUpdateUser({ avatarUrl: emoji })}
            onClose={() => setShowAvatarPick(false)}
          />
        )}

        {/* Name */}
        {editingName ? (
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:4 }}>
            <input style={{ ...inp, fontSize:20, fontFamily:T.serif, flex:1 }} value={nameVal}
              onChange={e => setNameVal(e.target.value)} autoFocus
              onKeyDown={e => { if(e.key==="Enter"){ onUpdateUser({name:nameVal.trim()||user.name}); setEditingName(false); }}}/>
            <button onClick={() => { onUpdateUser({name:nameVal.trim()||user.name}); setEditingName(false); }}
              style={{ padding:"10px 14px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, cursor:"pointer" }}>Save</button>
          </div>
        ) : (
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
            <div style={{ fontFamily:T.serif, fontSize:26, color:T.text }}>{user.name}</div>
            <button onClick={() => setEditingName(true)} style={{ fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer" }}>Edit</button>
          </div>
        )}
        <div style={{ fontSize:13, color:level.color, fontWeight:500, marginBottom:16 }}>⚡ {level.label} · {xp} xp</div>
        <div style={{ height:4, background:T.surface, borderRadius:2, overflow:"hidden", marginBottom:4 }}>
          <div style={{ height:"100%", borderRadius:2, background:level.color, width:`${pct}%`, transition:"width 0.6s ease" }}/>
        </div>
        <div style={{ fontSize:11, color:T.hint, marginBottom:24 }}>{next ? `${next.min - xp} xp to ${next.label}` : "Max level reached"}</div>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, padding:"0 16px 20px" }}>
        <Stat label="total logs"   value={totalLogs}           color={T.accent}/>
        <Stat label="reflections"  value={totalReflections}    color="#8E44AD"/>
        <Stat label="best streak"  value={`${bestStreak}d`}    color={T.gold}/>
      </div>

      {/* Account */}
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>Account</div>
        <SRow label="Display name" value={user.name} onPress={() => setEditingName(true)}/>
        <SRow label="Notifications" note="Coming soon" onPress={null}/>
        <SRow label="Replay app tour" onPress={onShowTour}/>
      </div>

      {/* Pro section */}
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid rgba(200,144,42,0.3)`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:10, fontWeight:500, color:T.gold, textTransform:"uppercase", letterSpacing:"0.08em" }}>Forged Pro</div>
          {isPro && <div style={{ fontSize:10, color:T.green, fontWeight:600, background:T.green+"18", padding:"2px 8px", borderRadius:10 }}>✓ Active</div>}
        </div>
        <div style={{ padding:"4px 16px 16px" }}>
          {isPro ? (
            <div style={{ fontSize:14, color:T.text, lineHeight:1.6 }}>
              You're on Pro — thanks for supporting Forged. 🙌<br/>
              <span style={{ fontSize:12, color:T.muted }}>All features unlocked, including AI Habit Coach.</span>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
                {[
                  { label:"AI Habit Coach",             status:"pro" },
                  { label:"Unlimited habits",            status:"pro" },
                  { label:"Advanced pattern analysis",   status:"soon" },
                  { label:"Push notification reminders", status:"soon" },
                ].map((f, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:18, height:18, borderRadius:"50%", background:f.status==="soon"?T.surface:"rgba(200,144,42,0.15)", border:`1px solid ${f.status==="soon"?T.border:"rgba(200,144,42,0.4)"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      {f.status==="pro" && <span style={{ fontSize:9, color:T.gold, fontWeight:700 }}>P</span>}
                    </div>
                    <span style={{ fontSize:13, color:f.status==="soon"?T.muted:T.text }}>{f.label}</span>
                    {f.status==="soon" && <span style={{ fontSize:10, color:T.hint, marginLeft:"auto", letterSpacing:"0.06em", textTransform:"uppercase" }}>Soon</span>}
                    {f.status==="pro" && <span style={{ fontSize:10, color:T.gold, marginLeft:"auto", letterSpacing:"0.06em", textTransform:"uppercase" }}>Pro</span>}
                  </div>
                ))}
              </div>
              <button onClick={onUpgrade} style={{ width:"100%", padding:"12px", borderRadius:T.rsm, border:"none", background:"rgba(200,144,42,0.15)", color:T.gold, fontSize:14, fontWeight:600, cursor:"pointer", letterSpacing:"0.01em" }}>
                Upgrade to Pro — from $4.99/mo →
              </button>
              <div style={{ fontSize:11, color:T.hint, marginTop:8, textAlign:"center" }}>✦ Early users get this price locked in forever</div>
            </>
          )}
        </div>
      </div>

      {/* Early user feedback */}
      <div style={{ margin:"0 14px 12px", background:"rgba(200,144,42,0.07)", borderRadius:T.r, border:`0.5px solid rgba(200,144,42,0.25)`, padding:"16px 18px" }}>
        <div style={{ fontSize:11, fontWeight:600, color:T.gold, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>⭐ Early user</div>
        <div style={{ fontSize:13, color:T.muted, lineHeight:1.65, marginBottom:12 }}>
          You're one of Forged's first users — thank you. Your feedback shapes what this becomes.
        </div>
        <button onClick={() => window.open("mailto:corbyn.miller2000@gmail.com?subject=Forged%20Feedback&body=Hey%20Corbyn%2C%20here's%20my%20feedback%20on%20Forged%3A%0A%0A", "_blank")}
          style={{ width:"100%", padding:"11px", borderRadius:T.rsm, border:`0.5px solid rgba(200,144,42,0.35)`, background:"none", color:T.gold, fontSize:13, fontWeight:500, cursor:"pointer", textAlign:"center" }}>
          Send quick feedback →
        </button>
      </div>

      {/* Refer a friend */}
      {refLink && (
        <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"16px 18px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:10, fontWeight:600, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em" }}>Refer a friend</div>
            {refCount !== null && refCount > 0 && (
              <div style={{ fontSize:11, color:T.green, fontWeight:600, background:T.green+"18", padding:"2px 9px", borderRadius:10 }}>
                {refCount} joined
              </div>
            )}
          </div>
          <div style={{ fontSize:13, color:T.muted, lineHeight:1.6, marginBottom:14 }}>
            Share your link and every person you bring in helps lock in the beta price for everyone.
          </div>
          {/* Link display + copy */}
          <div style={{ display:"flex", gap:8, alignItems:"stretch" }}>
            <div style={{ flex:1, background:T.surface, border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"10px 12px", fontSize:12, color:T.hint, fontFamily:"monospace", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", letterSpacing:"0.03em" }}>
              {refLink.replace("https://", "")}
            </div>
            <button onClick={copyRefLink}
              style={{ flexShrink:0, padding:"10px 16px", borderRadius:T.rsm, border:"none", background:refCopied ? T.green+"22" : "rgba(255,255,255,0.07)", color:refCopied ? T.green : T.text, fontSize:13, fontWeight:500, cursor:"pointer", transition:"all 0.2s", whiteSpace:"nowrap" }}>
              {refCopied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          {/* Share via native share if available */}
          {typeof navigator.share === "function" && (
            <button onClick={() => navigator.share({ title:"Forged", text:"Track your habits seriously. No fluff.", url: refLink })}
              style={{ width:"100%", marginTop:8, padding:"11px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
              Share →
            </button>
          )}
          <div style={{ fontSize:11, color:T.hint, marginTop:10, textAlign:"center" }}>Your code: <span style={{ color:T.text, fontFamily:"monospace", letterSpacing:"0.1em" }}>{refCode}</span></div>
        </div>
      )}

      {/* Data */}
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>Data</div>
        <SRow label="Export my data" note="JSON" onPress={() => {
          const blob = new Blob([JSON.stringify({habits}, null, 2)], {type:"application/json"});
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
          a.download = "forged-data.json"; a.click();
        }}/>
        <SRow label="Version" note="0.2.0"/>
      </div>

      {/* Sign out */}
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        {showSignOutConfirm ? (
          <div style={{ padding:"14px 16px" }}>
            <div style={{ fontSize:14, color:T.text, marginBottom:12 }}>Sign out of Forged?</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowSignOutConfirm(false)} style={{ flex:1, padding:10, borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>Cancel</button>
              <button onClick={onSignOut} style={{ flex:1, padding:10, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:500, cursor:"pointer" }}>Sign out</button>
            </div>
          </div>
        ) : (
          <SRow label="Sign out" destructive onPress={() => setShowSignOutConfirm(true)}/>
        )}
      </div>

      <div style={{ height:20 }}/>
    </div>
  );
}
// ─── AUTH SCREENS ─────────────────────────────────────────────────────────────
const authInp = { width:"100%", border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm, background:T.surface, padding:"14px 16px", fontSize:16, color:T.text, outline:"none", boxSizing:"border-box", marginBottom:10 };

function SetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);

  async function handleSave() {
    if (!password || password !== confirm || loading) return;
    setLoading(true); setError("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); return; }
    setDone(true);
    setTimeout(onDone, 2000);
  }

  return (
    <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", justifyContent:"center", padding:"0 28px" }}>
      <div style={{ fontFamily:T.serif, fontSize:40, color:T.text, marginBottom:32 }}>Forged.</div>
      {done ? (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>✓</div>
          <div style={{ fontFamily:T.serif, fontSize:22, color:T.green }}>Password updated</div>
          <div style={{ fontSize:14, color:T.muted, marginTop:10 }}>Signing you in…</div>
        </div>
      ) : (
        <>
          <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, marginBottom:8 }}>Set new password</div>
          <div style={{ fontSize:14, color:T.muted, marginBottom:24 }}>Choose something you'll remember.</div>
          <input type="password" placeholder="New password" autoFocus
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()} style={authInp}/>
          <input type="password" placeholder="Confirm password"
            value={confirm} onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()} style={authInp}/>
          {password && confirm && password !== confirm && (
            <div style={{ fontSize:13, color:T.accent, marginBottom:10 }}>Passwords don't match</div>
          )}
          {error && <div style={{ fontSize:13, color:T.accent, marginBottom:10 }}>{error}</div>}
          <button onClick={handleSave} disabled={!password || password !== confirm || loading}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s",
              background: password && password === confirm && !loading ? T.accent : T.surface,
              color: password && password === confirm && !loading ? "#fff" : T.muted }}>
            {loading ? "…" : "Save password"}
          </button>
        </>
      )}
    </div>
  );
}

function AuthScreen({ onSent }) {
  const [mode,       setMode]       = useState("signin"); // "signin" | "signup" | "forgot"
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  async function handleSubmit() {
    if (loading) return;
    // Fall back to reading DOM values directly — browser autofill often populates
    // the DOM without firing React's onChange, leaving state empty.
    const emailEl = document.querySelector('input[type="email"]');
    const passEl  = document.querySelector('input[type="password"]');
    const e = (email.trim() || emailEl?.value?.trim() || "");
    const p = (password     || passEl?.value          || "");
    if (!e || !p) return;
    // Sync state so UI reflects what we're submitting
    if (!email.trim()) setEmail(e);
    if (!password)     setPassword(p);
    setLoading(true); setError("");
    if (mode === "signup") {
      // Double-check: only ever call signUp when mode is explicitly "signup"
      // This prevents any race/accident from creating unintended accounts
      const { error } = await supabase.auth.signUp({ email: e, password: p, options: { emailRedirectTo: window.location.origin } });
      if (error) { setError(error.message); setLoading(false); return; }
      onSent(e);
      setLoading(false);
    } else {
      // Always default to signInWithPassword — never auto-create
      const { data, error } = await supabase.auth.signInWithPassword({ email: e, password: p });
      if (error) {
        // Supabase returns "Invalid login credentials" for both wrong password AND
        // non-existent user — give a clearer message
        const msg = error.message.toLowerCase().includes("invalid login")
          ? "Incorrect email or password. Check your details and try again."
          : error.message;
        setError(msg);
        setLoading(false);
        return;
      }
      // signInWithPassword succeeded — onAuthStateChange(SIGNED_IN) will take it from here
      setLoading(false);
    }
  }

  async function handleForgot() {
    const e = email.trim();
    if (!e || loading) return;
    setLoading(true); setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: window.location.origin });
    if (error) { setError(error.message); setLoading(false); return; }
    setLoading(false);
    setForgotSent(true);
  }

  const wrap = { fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", justifyContent:"center", padding:"0 28px" };

  // ── Forgot password view ──────────────────────────────────────────────
  if (mode === "forgot") return (
    <div style={wrap}>
      <div style={{ fontFamily:T.serif, fontSize:40, color:T.text, marginBottom:32 }}>Forged.</div>
      {forgotSent ? (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📧</div>
          <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:12 }}>Check your inbox</div>
          <div style={{ fontSize:14, color:T.muted, lineHeight:1.8, marginBottom:32 }}>
            Sent a reset link to<br/>
            <span style={{ color:T.text, fontWeight:500 }}>{email}</span><br/><br/>
            Click it, set a new password, then come back and sign in.
          </div>
          <button onClick={() => { setMode("signin"); setForgotSent(false); setError(""); }}
            style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
            ← Back to sign in
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, marginBottom:8 }}>Reset password</div>
          <div style={{ fontSize:14, color:T.muted, marginBottom:24, lineHeight:1.6 }}>Enter your email and we'll send a reset link.</div>
          <input type="email" placeholder="you@example.com" autoFocus
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleForgot()}
            style={authInp}
          />
          {error && <div style={{ fontSize:13, color:T.accent, marginBottom:10 }}>{error}</div>}
          <button onClick={handleForgot} disabled={!email.trim() || loading}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:email.trim()&&!loading?T.accent:T.surface, color:email.trim()&&!loading?"#fff":T.muted, fontSize:16, fontWeight:500, cursor:email.trim()&&!loading?"pointer":"default", transition:"all 0.2s" }}>
            {loading ? "…" : "Send reset link"}
          </button>
          <button onClick={() => { setMode("signin"); setError(""); }}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", marginTop:4 }}>
            ← Back to sign in
          </button>
        </>
      )}
    </div>
  );

  // ── Sign in / Sign up view ────────────────────────────────────────────
  // Note: "ready" only drives button styling — handleSubmit reads DOM values
  // as fallback so browser autofill always works even if React state is empty.
  const ready = (email.trim() || false) && (password || false) && !loading;
  return (
    <div style={wrap}>
      <div style={{ fontFamily:T.serif, fontSize:40, color:T.text, marginBottom:8 }}>Forged.</div>
      <div style={{ fontSize:15, color:T.muted, marginBottom:32 }}>
        {mode === "signin" ? "Welcome back" : "Create your account"}
      </div>
      <input type="email" placeholder="you@example.com" autoFocus
        value={email}
        onChange={e => setEmail(e.target.value)}
        onInput={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSubmit()}
        style={authInp}
      />
      <input type="password" placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        onInput={e => setPassword(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSubmit()}
        style={authInp}
      />
      {error && <div style={{ fontSize:14, color:"#e74c3c", background:"rgba(231,76,60,0.1)", border:"1px solid rgba(231,76,60,0.3)", borderRadius:T.rsm, padding:"10px 14px", marginBottom:12 }}>{error}</div>}
      <button onClick={handleSubmit}
        style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:!loading?T.accent:T.surface, color:!loading?"#fff":T.muted, fontSize:16, fontWeight:500, cursor:!loading?"pointer":"default", transition:"all 0.2s" }}>
        {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      {/* Secondary actions — kept small so users can't accidentally switch mode */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16 }}>
        {mode === "signin" ? (
          <>
            <button onClick={() => { setMode("forgot"); setError(""); setForgotSent(false); }}
              style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", padding:0 }}>
              Forgot password?
            </button>
            <button onClick={() => { setMode("signup"); setError(""); }}
              style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", padding:0 }}>
              New here? Create account
            </button>
          </>
        ) : (
          <button onClick={() => { setMode("signin"); setError(""); }}
            style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", padding:0, width:"100%", textAlign:"center" }}>
            ← Already have an account? Sign in
          </button>
        )}
      </div>
    </div>
  );
}

function CheckEmailScreen({ email, onBack }) {
  return (
    <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", justifyContent:"center", padding:"0 28px", textAlign:"center" }}>
      <div style={{ fontSize:52, marginBottom:20 }}>✉️</div>
      <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, marginBottom:12 }}>Confirm your email</div>
      <div style={{ fontSize:14, color:T.muted, lineHeight:1.8, marginBottom:32 }}>
        We sent a confirmation link to<br/>
        <span style={{ color:T.text, fontWeight:500 }}>{email}</span><br/><br/>
        Tap it to activate your account, then come back and sign in.
      </div>
      <button onClick={onBack} style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
        ← Back to sign in
      </button>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [onboarded,   setOnboarded]  = useState(false);
  const [user,        setUser]        = useState({ name:"", avatarUrl:null });
  const [habits,      setHabits]     = useState([]);
  const [screen,      setScreen]     = useState("today");
  const [xp,          setXp]         = useState(0);
  const [particles,   setParticles]  = useState([]);
  const [flashes,     setFlashes]    = useState([]);
  const [toasts,      setToasts]     = useState([]);
  const [showAdd,     setShowAdd]    = useState(false);
  const [showXP,      setShowXP]     = useState(false);
  const [showHistory, setShowHistory]= useState(false);
  const [showCoach,   setShowCoach]  = useState(false);
  const [reflectId,   setReflectId]  = useState(null);
  const [editId,      setEditId]     = useState(null);
  const [logId,       setLogId]      = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [authScreen,       setAuthScreen]        = useState(false);
  const [pendingEmail,     setPendingEmail]       = useState(null);
  const [passwordRecovery, setPasswordRecovery]  = useState(false);
  const [showTour,  setShowTour]  = useState(false);
  const [tourStep,  setTourStep]  = useState(0);
  const [showShare,   setShowShare]   = useState(false);
  const [isPro,       setIsPro]       = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [refCode,     setRefCode]     = useState(null);
  const [authEmail,   setAuthEmail]   = useState(null);
  const userIdRef     = useRef(null);
  const loadingUidRef = useRef(null); // uid currently being loaded — prevents concurrent loads
  const noteDebounceRef = useRef({});

  // ─── Supabase helpers ──────────────────────────────────────────────────────
  async function syncHabit(habit) {
    const uid = userIdRef.current;
    if (!uid) {
      console.warn("syncHabit: no user id — session not ready yet, skipping save");
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Session loading — please wait a moment and try again" }]);
      return;
    }
    try {
      const { error } = await supabase.from("habits").upsert(habitToRow(habit, uid));
      if (error) {
        console.error("syncHabit error:", error.message);
        const id = Date.now();
        setToasts(t => [...t, { id, msg: "⚠️ Couldn't save — check your connection" }]);
      }
    } catch (err) {
      console.error("syncHabit exception:", err);
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Couldn't save — check your connection" }]);
    }
  }

  async function syncProfile(updates) {
    const uid = userIdRef.current;
    if (!uid) return;
    await supabase.from("profiles").upsert({ id: uid, ...updates, updated_at: new Date().toISOString() });
  }

  async function handleAvatarUpload(file) {
    const uid = userIdRef.current;
    if (!file || !uid) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `${uid}/avatar.${ext}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (error) { console.error('Avatar upload error:', error); return; }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = data.publicUrl;
    setUser(u => ({ ...u, avatarUrl }));
    await syncProfile({ avatar_url: avatarUrl });
  }

  async function loadUserData(uid) {
    // Prevent concurrent loads for the same user (init() and INITIAL_SESSION both fire)
    if (loadingUidRef.current === uid) return;
    loadingUidRef.current = uid;
    userIdRef.current = uid;
    try {
      // Parallel fetch — faster and avoids partial-state flashes
      const [profileRes, habitsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", uid).single(),
        supabase.from("habits").select("*").eq("user_id", uid).order("created_at"),
      ]);

      const { data: profile, error: pErr } = profileRes;
      const { data: rows,    error: hErr  } = habitsRes;

      if (pErr && pErr.code !== "PGRST116") console.error("profile fetch:", pErr.message);
      if (hErr) console.error("habits fetch:", hErr.message);

      let isOnboarded = false;

      if (profile) {
        setUser({ name: profile.name, avatarUrl: profile.avatar_url || null });
        setXp(profile.xp ?? 0);
        setIsPro(!!(profile.is_pro || profile.is_admin));
        setRefCode(profile.ref_code ?? null);
        isOnboarded = profile.onboarded ?? false;
      }

      // Safety net: habits exist → user finished onboarding even if profile flag is wrong
      if (!isOnboarded && rows && rows.length > 0) {
        isOnboarded = true;
        // Repair the flag quietly
        supabase.from("profiles").upsert({ id: uid, onboarded: true, updated_at: new Date().toISOString() });
      }

      setOnboarded(isOnboarded);
      if (rows) setHabits(rows.map(rowToHabit));
    } catch (err) {
      console.error("loadUserData failed:", err);
    } finally {
      loadingUidRef.current = null;
    }
  }

  // ─── Auth init ────────────────────────────────────────────────────────────
  // Two-stage approach:
  // Stage 1: getSession() — reads localStorage, fast, handles the normal case.
  //          Times out after 5s so a hung token refresh never blocks the app.
  // Stage 2: onAuthStateChange — handles SIGNED_IN (new logins), SIGNED_OUT,
  //          TOKEN_REFRESHED (recovery after Stage 1 timeout), PASSWORD_RECOVERY.
  //          INITIAL_SESSION is intentionally ignored — Stage 1 covers it, and
  //          handling both causes a concurrent loadUserData race.
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const timeoutPromise = new Promise(resolve =>
          setTimeout(() => resolve({ data: { session: null }, timedOut: true }), 5000)
        );
        const result = await Promise.race([supabase.auth.getSession(), timeoutPromise]);
        if (!mounted) return;
        if (result?.timedOut) console.warn("getSession timed out — TOKEN_REFRESHED will recover");
        const session = result?.data?.session ?? null;
        if (session?.user?.id) {
          if (mounted && session.user.email) setAuthEmail(session.user.email);
          await loadUserData(session.user.id);
          if (mounted) setAuthScreen(false);
        } else {
          if (mounted) setAuthScreen(true);
        }
      } catch (err) {
        console.error("init error:", err);
        if (mounted) setAuthScreen(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      try {
        if (event === "INITIAL_SESSION") return; // handled by init() above

        if (event === "PASSWORD_RECOVERY") {
          setPasswordRecovery(true);
          setAuthScreen(false);
          setLoading(false);
          return;
        }

        if (event === "SIGNED_OUT") {
          userIdRef.current = null;
          loadingUidRef.current = null;
          setHabits([]);
          setUser({ name: "", avatarUrl: null });
          setXp(0);
          setOnboarded(false);
          setIsPro(false);
          setRefCode(null);
          setAuthEmail(null);
          setAuthScreen(true);
          setLoading(false);
          return;
        }

        if (event === "SIGNED_IN" && session?.user?.id) {
          // New sign-in (different user or first time this session)
          if (session.user.email && mounted) setAuthEmail(session.user.email);
          if (userIdRef.current !== session.user.id) {
            setLoading(true);
            await loadUserData(session.user.id);
            if (mounted) setLoading(false);
          }
          if (mounted) { setAuthScreen(false); setPendingEmail(null); setPasswordRecovery(false); }
          return;
        }

        if (event === "TOKEN_REFRESHED" && session?.user?.id && !userIdRef.current) {
          // Recovery path: init() timed out, token refreshed in background
          if (session.user.email && mounted) setAuthEmail(session.user.email);
          setLoading(true);
          await loadUserData(session.user.id);
          if (mounted) { setLoading(false); setAuthScreen(false); }
        }
      } catch (err) {
        console.error("auth event error:", err);
        if (mounted) setLoading(false);
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // Sync XP to profile whenever it changes (after init)
  const xpInitRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!xpInitRef.current) { xpInitRef.current = true; return; }
    syncProfile({ xp });
  }, [xp, loading]);

  // All hooks must be declared before any conditional returns
  const addToast = useCallback(msg => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg }]);
  }, []);

  const reflectHabit = habits.find(h => h.id === reflectId) || null;
  const editHabit    = habits.find(h => h.id === editId)    || null;
  const logHabit     = habits.find(h => h.id === logId)     || null;

  // Capture ?ref= from URL and handle ?checkout=success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && /^[A-Z2-9]{6}$/.test(ref)) {
      localStorage.setItem("forged_pending_ref", ref);
    }
    if (params.get("checkout") === "success") {
      // Clean URL then reload Pro status from DB
      window.history.replaceState({}, "", window.location.pathname);
      const uid = userIdRef.current;
      if (uid) {
        supabase.from("profiles").select("is_pro, is_admin").eq("id", uid).single().then(({ data }) => {
          if (data && (data.is_pro || data.is_admin)) {
            setIsPro(true);
            const id = Date.now();
            setToasts(t => [...t, { id, msg: "🎉 Welcome to Forged Pro!" }]);
            setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
          }
        });
      }
    }
  }, []);

  async function completeOnboarding({ name, habits: newHabits }) {
    const uid = userIdRef.current;
    setUser({ name });
    setXp(0);
    const habitsToSet = (newHabits && newHabits.length > 0) ? newHabits : [];
    setHabits(habitsToSet);
    setOnboarded(true);
    const pendingRef = localStorage.getItem("forged_pending_ref") || null;
    if (uid) {
      await supabase.from("profiles").upsert({
        id: uid, name, xp: 0, onboarded: true, updated_at: new Date().toISOString(),
        ...(pendingRef ? { referred_by: pendingRef } : {}),
      });
      if (pendingRef) localStorage.removeItem("forged_pending_ref");
      if (habitsToSet.length > 0) {
        await supabase.from("habits").upsert(habitsToSet.map(h => habitToRow(h, uid)));
      }
    }
    // Show tour for brand-new users
    if (!localStorage.getItem('forged_tour_done')) {
      setShowTour(true);
    }
  }

  // Show password recovery screen
  if (!loading && passwordRecovery) {
    return (
      <><style>{CSS}</style>
      <SetPasswordScreen onDone={() => { setPasswordRecovery(false); setAuthScreen(false); }} /></>
    );
  }

  // Show auth screens
  if (!loading && authScreen) {
    if (pendingEmail) {
      return (
        <><style>{CSS}</style>
        <CheckEmailScreen email={pendingEmail} onBack={() => setPendingEmail(null)} /></>
      );
    }
    return (
      <><style>{CSS}</style>
      <AuthScreen onSent={email => setPendingEmail(email)} /></>
    );
  }

  // Show loading screen
  if (loading) {
    return (
      <><style>{CSS}</style>
      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forged.</div>
        <div style={{ width:22, height:22, border:`2px solid ${T.border}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
        <div style={{ fontSize:12, color:T.hint, animation:"fadeIn 1s ease 2.5s both", textAlign:"center", lineHeight:1.6 }}>
          Taking longer than usual?<br/>
          <button onClick={() => window.location.reload()} style={{ background:"none", border:"none", color:T.muted, fontSize:12, cursor:"pointer", textDecoration:"underline", padding:0, marginTop:4 }}>Tap to refresh</button>
        </div>
      </div></>
    );
  }

  // Show onboarding on first launch
  if (!onboarded) {
    return (
      <><style>{CSS}</style>
      <OnboardingScreen
        onComplete={completeOnboarding}
        onSkip={() => {
          setOnboarded(true);
          syncProfile({ onboarded: true, name: user.name || "", xp: 0 });
        }}
      /></>
    );
  }

  function spawnParticles(cx, cy, color) {
    const id = Date.now();
    setParticles(p => [...p, ...Array.from({length:10}, (_, i) => ({ id:id+i, x:cx, y:cy, color, angle:(i/10)*360, dist:24+Math.random()*20 }))]);
  }
  function addFlash(x, y, text) {
    const id = Date.now();
    setFlashes(f => [...f, { id, x, y, text }]);
  }

  // Tap handler: daily, weekly, limit
  function handleTap(id, e) {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let tapped = null;
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      // Limit: each tap adds tapIncrement units (default 1)
      if (h.habitType === "limit") {
        const inc = h.tapIncrement ?? 1;
        tapped = { ...h, logs:[...h.logs, { date:todayStr(), value:inc, note:"" }] };
        return tapped;
      }
      // Daily / weekly: toggle today
      const logged = h.logs.some(l => l.date === todayStr());
      if (logged) {
        tapped = { ...h, logs:h.logs.filter(l => l.date !== todayStr()) };
        return tapped;
      }
      tapped = { ...h, logs:[...h.logs, { date:todayStr(), value:true, note:"" }] };
      return tapped;
    }));
    if (!tapped) return;
    // Side effects outside the updater
    if (tapped.habitType === "limit") {
      spawnParticles(cx, cy, tapped.color);
      addFlash(cx, cy, "+5 xp");
      setXp(x => x + 5);
    } else {
      const wasLogged = habits.find(h => h.id === id)?.logs.some(l => l.date === todayStr());
      if (!wasLogged) { spawnParticles(cx, cy, tapped.color); addFlash(cx, cy, "+10 xp"); setXp(x => x + 10); }
    }
    syncHabit(tapped);
  }

  // Log handler: progress and project
  function handleLog(id, logData) {
    let logged = null;
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const already = h.logs.some(l => l.date === todayStr());
      if (h.habitType === "project" || !already) {
        logged = { isNew: true, updated: { ...h, logs:[...h.logs, { date:todayStr(), ...logData }] } };
      } else {
        logged = { isNew: false, updated: { ...h, logs:h.logs.map(l => l.date === todayStr() ? { ...l, ...logData } : l) } };
      }
      return logged.updated;
    }));
    if (!logged) return;
    if (logged.isNew) { addFlash(window.innerWidth / 2, 120, "+10 xp"); setXp(x => x + 10); }
    syncHabit(logged.updated);
  }

  // Undo last limit tap: remove the most recent today log for a limit habit
  function handleUndoLimit(id) {
    let updated = null;
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const lastIdx = [...h.logs].map(l => l.date).lastIndexOf(todayStr());
      if (lastIdx < 0) return h;
      const newLogs = h.logs.filter((_, i) => i !== lastIdx);
      updated = { ...h, logs: newLogs };
      return updated;
    }));
    if (updated) syncHabit(updated);
    addToast("↩ Last tap removed");
  }

  function handleSkipDay(id) {
    let updated = null;
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const withoutToday = h.logs.filter(l => l.date !== todayStr());
      updated = { ...h, logs:[...withoutToday, { date:todayStr(), value:"skip", note:"" }] };
      return updated;
    }));
    if (updated) syncHabit(updated);
    addToast("🛡️ Rest day — streak protected");
  }

  // Add a quick note as a standalone log entry — each Done tap creates a separate record
  function handleAddNote(id, text) {
    if (!text.trim()) return;
    let updated = null;
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      updated = { ...h, logs: [...h.logs, { date: todayStr(), value: "quicknote", note: text.trim() }] };
      return updated;
    }));
    if (updated) syncHabit(updated);
    addToast("✓ Note saved");
  }

  // Explicitly log 0 for a limit habit — marks "had none today" as a conscious choice
  function handleLogZero(id) {
    let updated = null;
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      if (h.logs.some(l => l.date === todayStr() && typeof l.value === "number")) return h; // already logged
      updated = { ...h, logs: [...h.logs, { date: todayStr(), value: 0, note: "" }] };
      return updated;
    }));
    if (updated) syncHabit(updated);
    addToast("✓ Logged — none today");
  }

  // Reflection: save to most recent today log, or create standalone entry
  function handleSaveReflection(id, text) {
    let reflected = null;
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const logs = [...h.logs];
      const idx = logs.map(l => l.date).lastIndexOf(todayStr());
      if (idx >= 0) { logs[idx] = { ...logs[idx], reflection:text }; }
      else { logs.push({ date:todayStr(), value:null, note:"", reflection:text }); }
      reflected = { ...h, logs };
      return reflected;
    }));
    if (reflected) syncHabit(reflected);
    addToast("✓ Reflection saved");
  }

  // Edit save
  function handleEditSave(id, updates) {
    let edited = null;
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      edited = { ...h, ...updates };
      return edited;
    }));
    if (edited) syncHabit(edited);
    addToast("✓ Habit updated");
  }

  // Gate adding habits at 5 for free users
  function handleStartAdd() {
    if (!isPro && habits.length >= 5) {
      setShowUpgrade(true);
    } else {
      setShowAdd(true);
    }
  }

  // Add a new habit
  function handleAddHabit(h) {
    setHabits(p => [...p, h]);
    setShowAdd(false);
    syncHabit(h);
  }

  // Delete a habit — optimistic remove, restore from DB on failure
  async function handleDeleteHabit(id) {
    const uid = userIdRef.current;
    if (!uid) return;
    setHabits(p => p.filter(h => h.id !== id));
    const { error } = await supabase.from("habits").delete().eq("id", id).eq("user_id", uid);
    if (error) {
      console.error("Delete failed:", error.message);
      addToast("⚠️ Couldn't delete — tap again to retry");
      // Re-sync from DB so nothing is lost
      const { data: rows } = await supabase.from("habits").select("*").eq("user_id", uid).order("created_at");
      if (rows) setHabits(rows.map(rowToHabit));
    }
  }

  async function handleSignOut() {
    // onAuthStateChange will fire SIGNED_OUT and handle all state resets
    await supabase.auth.signOut();
  }

  const NAV = [
    { id:"today",    label:"Today",    icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id:"journal",  label:"Journal",  icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="4" y="3" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
    { id:"insights", label:"Insights", icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 15l4-5 3 3 4-6 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { id:"habits",   label:"Habits",   icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 6h12M4 10h12M4 14h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id:"profile",  label:"Profile",  icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  ];

  return (
    <>
      <style>{CSS}</style>
      {particles.map(p => <Particle key={p.id} {...p} onDone={() => setParticles(ps => ps.filter(x => x.id !== p.id))}/>)}
      {flashes.map(f   => <XPFlash  key={f.id} {...f} onDone={() => setFlashes(fs  => fs.filter(x  => x.id !== f.id))}/>)}
      {toasts.map(t    => <Toast    key={t.id} msg={t.msg} onDone={() => setToasts(ts => ts.filter(x => x.id !== t.id))}/>)}

      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
        {/* Top bar */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"22px 18px 8px" }}>
          <div>
            <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
            <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>
              {screen === "today"
                ? <>{user.name && <span style={{ color:T.sub }}>{user.name} · </span>}{fmtDate()}</>
                : screen === "profile" ? user.name : screen.charAt(0).toUpperCase()+screen.slice(1)}
            </div>
          </div>
          <button onClick={() => setShowXP(true)} style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(200,144,42,0.12)", borderRadius:20, padding:"6px 13px", fontSize:13, fontWeight:500, color:T.gold, border:"none", cursor:"pointer" }}>
            ⚡ {xp} xp
          </button>
        </div>

        {screen === "today"    && <TodayScreen    habits={habits} xp={xp} onTap={handleTap} onUndo={handleUndoLimit} onSkip={handleSkipDay} onReflect={setReflectId} onAddNote={handleAddNote} onLogZero={handleLogZero} onOpenLog={id => setLogId(id)} onAdd={handleStartAdd} onXPInfo={() => setShowXP(true)}/>}
        {screen === "journal"  && <JournalScreen  habits={habits} onReflect={setReflectId}/>}
        {screen === "insights" && <InsightsScreen habits={habits} onShowHistory={() => setShowHistory(true)} onShare={() => setShowShare(true)}/>}
        {screen === "habits"   && <HabitsScreen   habits={habits} onEdit={setEditId} onDelete={handleDeleteHabit} onAdd={handleStartAdd} onReflect={setReflectId} onCoach={() => setShowCoach(true)}/>}
        {screen === "profile"  && <ProfileScreen  user={user} xp={xp} habits={habits} isPro={isPro} refCode={refCode}
          onUpgrade={() => setShowUpgrade(true)}
          onUpdateUser={updates => {
            if (updates._clearData) { setHabits([]); setXp(0); setUser(u => ({...u})); return; }
            setUser(u => {
              const next = { ...u, ...updates };
              const profilePatch = { name: next.name };
              if (updates.avatarUrl !== undefined) profilePatch.avatar_url = updates.avatarUrl;
              syncProfile(profilePatch);
              return next;
            });
          }}
          onResetOnboarding={() => setOnboarded(false)}
          onSignOut={handleSignOut}
          onShowTour={() => { setTourStep(0); setShowTour(true); }}
        />}

        {/* Bottom nav */}
        <nav style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:430, maxWidth:"100vw", background:"rgba(26,26,22,0.96)", backdropFilter:"blur(16px)", borderTop:`0.5px solid ${T.border}`, display:"flex", zIndex:100, paddingBottom:6 }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setScreen(n.id)} style={{ flex:1, padding:"10px 4px 6px", border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, fontSize:10, fontWeight:500, color:screen===n.id?T.accent:T.muted, transition:"color 0.15s" }}>
              {n.icon}{n.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Modals */}
      {showAdd     && <AddModal     onClose={() => setShowAdd(false)}    onSave={handleAddHabit}/>}
      {showXP      && <XPModal      xp={xp}                              onClose={() => setShowXP(false)}/>}
      {showHistory && <HistoryModal habits={habits} isPro={isPro} onUpgrade={() => setShowUpgrade(true)} onClose={() => setShowHistory(false)}/>}
      {reflectId   && <ReflectModal habit={reflectHabit}                 onClose={() => setReflectId(null)} onSave={handleSaveReflection}/>}
      {editId      && editHabit && <EditModal habit={editHabit}          onClose={() => setEditId(null)}    onSave={handleEditSave}/>}
      {logId && logHabit?.habitType === "progress" && <LogProgressModal  habit={logHabit} onClose={() => setLogId(null)} onLog={handleLog}/>}
      {logId && logHabit?.habitType === "project"  && <LogProjectModal   habit={logHabit} onClose={() => setLogId(null)} onLog={handleLog}/>}
      {showCoach   && <AICoach habits={habits} user={user} isPro={isPro} onClose={() => setShowCoach(false)} onUpgrade={() => setShowUpgrade(true)}/>}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} habitCount={habits.length} userId={userIdRef.current} userEmail={authEmail}/>}
      {showShare && <ShareCardModal user={user} habits={habits} xp={xp} onClose={() => setShowShare(false)}/>}
      {showTour && (
        <TourOverlay
          step={tourStep}
          onNext={() => {
            if (tourStep < TOUR_STEPS.length - 1) { setTourStep(s => s + 1); }
            else { localStorage.setItem('forged_tour_done','1'); setShowTour(false); setTourStep(0); }
          }}
          onSkip={() => { localStorage.setItem('forged_tour_done','1'); setShowTour(false); setTourStep(0); }}
        />
      )}
    </>
  );
}
