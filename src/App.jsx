import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { flushSync, createPortal } from "react-dom";
import { supabase, habitToRow, rowToHabit, rowToGoal, goalToRow } from "./supabase.js";

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
/** e.g. "Thursday, April 9" — Today screen subheader */
function fmtDateLong(d = new Date()) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
/** Goal deadline chip: "May 31" or "Jan 15, 2027" if not this calendar year */
function fmtGoalDueHuman(dateStr) {
  if (!dateStr) return "";
  const d = parseLocal(dateStr);
  const y = d.getFullYear();
  const thisYear = new Date().getFullYear();
  const mon = MONTHS[d.getMonth()];
  const day = d.getDate();
  return y !== thisYear ? `${mon} ${day}, ${y}` : `${mon} ${day}`;
}
function goalTodayDeadlineLine(goal, stats, isComplete) {
  const due = goal.targetDate ? `Due ${fmtGoalDueHuman(goal.targetDate)}` : "";
  if (isComplete) {
    return due ? `${due} · reached` : "";
  }
  const toGo = stats.toGo > 0 ? `${formatWithUnit(stats.toGo, goal.unit)} to go` : "";
  if (due && toGo) return `${due} · ${toGo}`;
  if (due) return due;
  if (toGo) return toGo;
  return "";
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
function weekEndFromStart(weekStartStr) {
  const d = parseLocal(weekStartStr);
  d.setDate(d.getDate() + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtWeekRange(weekStartStr) {
  const a = parseLocal(weekStartStr);
  const b = parseLocal(weekEndFromStart(weekStartStr));
  if (a.getMonth() === b.getMonth()) return `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}
function loadJournalMissedMap(userId) {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(`forged_journal_missed_${userId}`);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return typeof o === "object" && o !== null ? o : {};
  } catch {
    return {};
  }
}
function saveJournalMissedMap(userId, map) {
  if (!userId) return;
  try {
    localStorage.setItem(`forged_journal_missed_${userId}`, JSON.stringify(map));
  } catch { /* ignore quota */ }
}

/** Date is in missed map but user has not added a note/reason yet (whitespace-only counts as empty). */
function missedDayNeedsNote(missedMap, dateStr) {
  return Object.prototype.hasOwnProperty.call(missedMap, dateStr) && !(String(missedMap[dateStr] ?? "").trim());
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

/** Profile / floating coach button — preset icons only (must match CoachSettingsSheet). */
const COACH_ICON_OPTIONS = ["✦", "⚡", "🔥", "🛡️", "⚔️", "👻"];

// Converts a VAPID base64 public key to the Uint8Array that PushManager.subscribe() expects
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function normalizeCoachIcon(icon) {
  const t = (icon ?? "").trim();
  return COACH_ICON_OPTIONS.includes(t) ? t : "✦";
}

const HABIT_TYPES = {
  daily:    { label:"Daily habit",    desc:"One tap per day (e.g. meditate, read, cold shower).",      icon:"✓"  },
  weekly:   { label:"Weekly target",  desc:"Hit a session count each week (e.g. gym 4x, run 3x).",     icon:"📅" },
  project:  { label:"Build",          desc:"Log time spent and progress (e.g. side project, learning a skill).", icon:"⚒️" },
  limit:    { label:"Limit / reduce", desc:"Stay under a daily cap (drinks, snacks, screen time). For “reach X kg” or savings targets, use Set a goal — that’s an outcome, not a daily cap.",   icon:"🎯" },
};

const XP_LEVELS = [
  { min:0,    label:"Unforged",  color:"#B8B6AC", meaning:"Just getting started" },
  { min:500,  label:"Kindling",  color:"#C8902A", meaning:"The habit is catching" },
  { min:1500, label:"Tempered",  color:"#E67E22", meaning:"Consistency is building" },
  { min:3000, label:"Hardened",  color:"#C0392B", meaning:"This is becoming who you are" },
  { min:6000, label:"Forged",    color:"#F5C842", meaning:"Identity-level commitment" },
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
  return h.logs.filter(l => l.date >= currentWeekStart() && l.value === true).length;
}
function getTotalSessionLogsCount(h) {
  return h.logs.filter(l => l.value === true).length;
}
function getLatestValue(h) {
  if (!h.logs.length) return h.startValue ?? 0;
  const sorted = [...h.logs].sort((a, b) => a.date.localeCompare(b.date));
  const numeric = sorted.filter(l => typeof l.value === "number");
  if (numeric.length) return numeric.at(-1).value;
  return h.startValue ?? 0;
}
function inferProgressDirection(startValue, targetValue) {
  return targetValue < startValue ? "decreasing" : "increasing";
}
function isLegacyProgressType(type) {
  return type === "progress";
}

/** Compare habit/goal ids — tolerate number vs string, and dots vs underscores (see habitToRow/goalToRow normalizeId). */
function entityIdEq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const norm = v => String(v).replace(/\./g, "_");
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) return true;
  return norm(sa) === norm(sb);
}

/** Split `habits` table rows into in-app `goals` vs `habits` (must stay aligned with loadUserData). */
function splitDbRowsIntoGoalsAndHabits(rows) {
  if (!rows?.length) return { goals: [], habits: [] };
  const goalRows = rows.filter(r => r.habit_type === "goal");
  const progressRows = rows.filter(r => r.habit_type === "progress");
  const habitRows = rows.filter(r => r.habit_type !== "goal" && r.habit_type !== "progress");
  return {
    goals: [...goalRows, ...progressRows].map(rowToGoal),
    habits: habitRows.map(rowToHabit),
  };
}

/**
 * When `habits` was populated with goal/progress rows (e.g. bad resync), rebuild the goal object
 * so EditGoalModal / LogGoalModal can mount even if `goals.find` misses.
 */
function goalFromMisplacedHabit(h) {
  if (!h) return null;
  const ht = h.habitType;
  const typed = isGoalLikeHabitType(h) || isLegacyProgressType(ht);
  const untypedGoal =
    ht === undefined &&
    Array.isArray(h.logs) &&
    Number.isFinite(Number(h.startValue)) &&
    Number.isFinite(Number(h.targetValue)) &&
    Number(h.targetValue) !== Number(h.startValue);
  if (!typed && !untypedGoal) return null;
  const logs = h.logs ?? [];
  const numericLogs = logs.filter(l => typeof l.value === "number");
  const startValue = Number(h.startValue ?? 0);
  const targetValue = Number(h.targetValue ?? 0);
  const currentValue =
    typeof h.currentValue === "number" && Number.isFinite(h.currentValue)
      ? h.currentValue
      : numericLogs.length > 0
        ? numericLogs[numericLogs.length - 1].value
        : startValue;
  const direction =
    h.direction === "decreasing" || h.direction === "increasing"
      ? h.direction
      : targetValue < startValue
        ? "decreasing"
        : "increasing";
  const lastLogDate =
    logs.length > 0 ? [...logs].sort((a, b) => b.date.localeCompare(a.date))[0].date : null;
  return {
    id: h.id,
    name: h.name,
    emoji: h.emoji ?? "",
    unit: h.unit ?? "",
    startValue,
    targetValue,
    currentValue,
    direction,
    targetDate: h.targetDate ?? null,
    status: h.status ?? "active",
    logs,
    lastLogDate,
    color: h.color ?? "#E67E22",
  };
}

function resolveGoalForModal(goalId, goals, habits) {
  if (goalId == null) return null;
  const g = goals.find(x => entityIdEq(x.id, goalId));
  if (g) return g;
  const h = habits.find(x => entityIdEq(x.id, goalId));
  return goalFromMisplacedHabit(h);
}

/** Treat as goal/progress for routing to goal editor (handles odd casing / enum stringification). */
function isGoalLikeHabitType(h) {
  if (!h || h.habitType == null) return false;
  const t = String(h.habitType).trim().toLowerCase();
  return t === "goal" || t === "progress";
}

function resolveProgressDirection(h) {
  if (h.direction === "decreasing" || h.direction === "increasing") return h.direction;
  return inferProgressDirection(Number(h.startValue ?? 0), Number(h.targetValue ?? 0));
}
function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
function formatProgressNumber(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
function formatWithUnit(value, unit) {
  const n = formatProgressNumber(value);
  return unit ? `${n} ${unit}` : n;
}
function truncateText(text, max = 72) {
  const s = String(text ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}
function getProgressStats(h) {
  const start = Number(h.startValue ?? 0);
  const target = Number(h.targetValue ?? start);
  const latest = Number(getLatestValue(h));
  const current = Number.isFinite(latest) ? latest : start;
  const direction = resolveProgressDirection(h);
  const denom = direction === "decreasing" ? start - target : target - start;
  let rawProgress = 0;
  if (denom > 0) {
    rawProgress = direction === "decreasing"
      ? (start - current) / denom
      : (current - start) / denom;
  } else if (current === target) {
    rawProgress = 1;
  }
  const progress = clamp01(rawProgress);
  const toGo = Math.max(0, direction === "decreasing" ? current - target : target - current);
  return {
    start,
    target,
    current,
    direction,
    progress,
    pct: Math.round(progress * 100),
    toGo,
    isComplete: progress >= 1,
    isJustStarted: progress <= 0,
  };
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
function hasRestDay(h, dateStr) {
  return h.logs.some(l => l.date === dateStr && l.value === "skip");
}
function hasDailyCompletion(h, dateStr) {
  return h.logs.some(l => l.date === dateStr && l.value === true);
}
function getLimitDayTotal(h, dateStr) {
  const dayLogs = h.logs.filter(l => l.date === dateStr && typeof l.value === "number");
  if (!dayLogs.length) return null;
  return dayLogs.reduce((s, l) => s + l.value, 0);
}
function getBuildDayMinutes(h, dateStr) {
  const dayLogs = h.logs.filter(l => l.date === dateStr);
  const mins = dayLogs.reduce((s, l) => s + (l.value?.minutes || 0), 0);
  return mins;
}
function qualifiesBuildDay(h, dateStr) {
  const targetMins = h.dailyTargetMinutes ?? 60;
  return getBuildDayMinutes(h, dateStr) >= targetMins;
}
// Daily: count consecutive days going back from today where a log exists.
// If today isn't logged yet the day isn't over, so we start from yesterday.
function getDailyStreak(h) {
  const startDay = (hasDailyCompletion(h, todayStr()) || hasRestDay(h, todayStr())) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    const dateStr = daysAgo(d);
    if (hasDailyCompletion(h, dateStr) || hasRestDay(h, dateStr)) streak++;
    else break;
  }
  return streak;
}
// Limit: consecutive completed days (yesterday backward) where the user logged and stayed under budget.
// Today is never counted — the streak updates only after a full day is done.
// Not logging breaks the streak; logging 0 counts as a perfect day.
function getLimitStreak(h) {
  const startDay = 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    const total = getLimitDayTotal(h, daysAgo(d));
    if (total == null) break; // missed — streak over
    if (total <= (h.dailyBudget || Infinity)) streak++;
    else break;
  }
  return streak;
}
// Build/project: count consecutive days where build minutes hit the daily target.
function getBuildStreak(h) {
  const startDay = qualifiesBuildDay(h, todayStr()) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    if (qualifiesBuildDay(h, daysAgo(d))) streak++;
    else break;
  }
  return streak;
}
// Unified getter — returns the right streak type for any habit
function getStreak(h) {
  if (h.habitType === "weekly")  return getWeeklyStreak(h);
  if (h.habitType === "limit")   return getLimitStreak(h);
  if (h.habitType === "project") return getBuildStreak(h);
  return getDailyStreak(h); // daily (default)
}

/** Subtitle suffix for habit cards — hides misleading 🔥 1 when the streak is only "today" with no prior day. */
function getHabitCardStreakSuffix(h) {
  const streak = getStreak(h);
  if (streak <= 0) return "";
  if (h.habitType === "limit") {
    return ` · 🔥 ${streak} day streak`;
  }
  if (streak > 1) return ` · 🔥 ${streak}`;
  if (h.habitType === "daily") {
    const t = todayStr();
    const y = daysAgo(1);
    const todayOk = hasDailyCompletion(h, t) || hasRestDay(h, t);
    const yestOk = hasDailyCompletion(h, y) || hasRestDay(h, y);
    if (todayOk && !yestOk) return " · Started today";
    return " · 🔥 1";
  }
  if (h.habitType === "weekly") {
    return " · Started this week";
  }
  if (h.habitType === "project") {
    const todayOk = qualifiesBuildDay(h, todayStr());
    const yestOk = qualifiesBuildDay(h, daysAgo(1));
    if (todayOk && !yestOk) return " · Started today";
    return " · 🔥 1";
  }
  return " · 🔥 1";
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
    const count = h.logs.filter(l => l.date >= weekStart && l.date <= weekEnd && l.value === true).length;
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
  // Build/project: count days where build target was met.
  if (h.habitType === "project") {
    const daysMet = Array.from({ length: 28 }, (_, i) => i)
      .map(i => daysAgo(i))
      .filter(ds => qualifiesBuildDay(h, ds))
      .length;
    return Math.min(100, Math.round((daysMet / 28) * 100));
  }
  if (h.habitType === "limit") {
    const goodDays = Array.from({ length: 28 }, (_, i) => i)
      .map(i => daysAgo(i))
      .filter(ds => {
        const total = getLimitDayTotal(h, ds);
        return total != null && total <= (h.dailyBudget || Infinity);
      })
      .length;
    return Math.min(100, Math.round((goodDays / 28) * 100));
  }
  // Daily: completed or protected rest day out of 28
  const doneDays = Array.from({ length: 28 }, (_, i) => i)
    .map(i => daysAgo(i))
    .filter(ds => hasDailyCompletion(h, ds) || hasRestDay(h, ds))
    .length;
  return Math.min(100, Math.round((doneDays / 28) * 100));
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
  @keyframes coachNudge {
    0%   { opacity: 0; transform: translateY(10px) scale(0.97); }
    9%   { opacity: 1; transform: translateY(0) scale(1); }
    82%  { opacity: 1; transform: translateY(0) scale(1); }
    100% { opacity: 0; transform: translateY(5px) scale(0.99); }
  }
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
  return <div style={{ padding:"6px 18px 8px", fontSize:11, fontWeight:600, letterSpacing:"0.08em", color:T.sub, textTransform:"uppercase" }}>{children}</div>;
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
  return createPortal(
    (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:10000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div onClick={e => e.stopPropagation()} style={{ width:430, maxWidth:"100vw", maxHeight:"92vh", overflowY:"auto", background:T.raised, borderRadius:"22px 22px 0 0", padding:"0 20px 60px" }}>
          <div style={{ width:36, height:4, background:T.borderStrong, borderRadius:2, margin:"14px auto 22px" }}/>
          {children}
        </div>
      </div>
    ),
    document.body
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
function NoteStrip({ habitId, habit, onAddNote }) {
  const [val, setVal] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const speech = useSpeechInput(text =>
    setVal(p => p.trim() ? p + " " + text : text)
  );

  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 2200);
    return () => clearTimeout(t);
  }, [savedFlash]);

  async function handleDone() {
    const draft = val.trim() || (speech.interim?.trim() ?? "");
    if (!draft) return;
    if (speech.listening) speech.toggle();
    const ok = await onAddNote(habitId, draft);
    if (!ok) return;
    setVal("");
    setSavedFlash(true);
  }

  const hasDraft = !!(val.trim() || speech.interim?.trim());

  return (
    <div style={{ borderTop:`0.5px solid ${T.border}`, padding:"10px 15px 12px", display:"flex", flexDirection:"column", gap:7 }}>
      {savedFlash && (
        <div style={{ fontSize:12, color:T.green, fontWeight:500 }}>Note saved</div>
      )}
      <textarea
        rows={4} maxLength={280}
        style={{ width:"100%", border:"none", background:"none", fontSize:13, color:T.text, resize:"none", lineHeight:1.55, minHeight:74, outline:"none" }}
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
        <div style={{ marginRight:"auto" }}/>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <MicBtn speech={speech} color={habit.color} size={26}/>
          {(hasDraft || speech.listening) && (
            <button type="button" onClick={handleDone} disabled={!hasDraft}
              style={{ fontSize:12, color:hasDraft?T.text:T.hint, background:hasDraft?habit.color+"22":"none", border:`0.5px solid ${hasDraft?habit.color+"55":T.border}`, borderRadius:T.rsm, padding:"4px 12px", cursor:hasDraft?"pointer":"not-allowed", fontWeight:500, transition:"all 0.15s", opacity:hasDraft?1:0.65 }}>
              ✓ Done
            </button>
          )}
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

/** Long-press empty card area (not buttons/inputs) to open the Today habit ··· menu. */
function useTodayHabitLongPeekHandlers(setPeek, enabled) {
  const lpTimer = useRef(null);
  const clearLp = () => {
    if (lpTimer.current) {
      clearTimeout(lpTimer.current);
      lpTimer.current = null;
    }
  };
  useEffect(() => () => clearLp(), []);
  return {
    onPointerDownCapture(e) {
      if (!enabled) return;
      if (!e.isPrimary) return;
      if (e.target.closest("button, textarea, input, a")) return;
      clearLp();
      lpTimer.current = window.setTimeout(() => {
        lpTimer.current = null;
        setPeek(true);
      }, 520);
    },
    onPointerUpCapture: clearLp,
    onPointerCancelCapture: clearLp,
    onPointerLeaveCapture: clearLp,
  };
}

/** ··· overflow control — Today + Habits goal rows (muted, not as faint as body hint text). */
function TodayOverflowDotsBtn({ expanded, onToggle }) {
  return (
    <button
      type="button"
      aria-label="Options"
      aria-expanded={expanded}
      onPointerDown={e => { e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        fontSize: 21,
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: expanded ? T.sub : T.muted,
        background: expanded ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        border: `0.5px solid ${expanded ? T.borderMid : T.border}`,
        borderRadius: T.rsm,
        cursor: "pointer",
        lineHeight: 1,
        padding: "5px 8px",
        flexShrink: 0,
        minWidth: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      ···
    </button>
  );
}

/** Today habit cards: ··· menu with Edit / Delete (delete uses same confirm copy as Habits list). */
function TodayHabitMenuDropdown({ habit, onEdit, onDelete, onShareHabit, shareSaving, menuOpen, onCloseMenu }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!menuOpen) setConfirmDelete(false);
  }, [menuOpen]);
  if (!menuOpen) return null;
  if (confirmDelete) {
    return (
      <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <div style={{ padding:"10px 15px 6px", borderTop:`0.5px solid ${T.border}`, fontSize:13, fontWeight:500, color:T.text }}>
          Delete {habit.name}?
        </div>
        <div style={{ padding:"8px 15px 10px", display:"flex", alignItems:"center", gap:8, justifyContent:"flex-end" }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(habit.id); setConfirmDelete(false); onCloseMenu(); }}
            style={{ fontSize:12, color:"#e74c3c", background:"rgba(231,76,60,0.1)", border:`0.5px solid rgba(231,76,60,0.4)`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer", fontWeight:500 }}>
            Delete
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
            style={{ fontSize:12, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer" }}>
            Cancel
          </button>
        </div>
        <div style={{ padding:"0 15px 12px", fontSize:12, color:"rgba(231,76,60,0.8)" }}>
          This will permanently delete <strong>{habit.name}</strong> and all its logs. {"This can't be undone."}
        </div>
      </div>
    );
  }
  return (
    <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} style={{ borderTop:`0.5px solid ${T.border}`, padding:"8px 15px 10px", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
      <button type="button" onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation();
        onEdit(habit.id); onCloseMenu(); }}
        style={{ fontSize:12, color:habit.color, background:"none", border:`0.5px solid ${habit.color+"44"}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>
        Edit
      </button>
      {!habit.sharedGoalId && onShareHabit && (
        <button type="button" disabled={!!shareSaving} onPointerDown={e => e.stopPropagation()} onClick={async (e) => {
          e.stopPropagation();
          try { await onShareHabit(habit.id); } finally { onCloseMenu(); }
        }}
          style={{ fontSize:12, color:T.gold, background:"rgba(200,144,42,0.12)", border:`0.5px solid rgba(200,144,42,0.35)`, borderRadius:T.rsm, padding:"5px 12px", cursor:shareSaving?"wait":"pointer", fontWeight:500, opacity:shareSaving?0.55:1 }}>
          {shareSaving ? "Sharing…" : "Share with friends"}
        </button>
      )}
      <button type="button" aria-label="Delete habit" onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
        style={{ fontSize:12, color:"#e74c3c", background:"none", border:`0.5px solid rgba(231,76,60,0.3)`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>
        Delete
      </button>
      <button type="button" onClick={(e) => { e.stopPropagation(); onCloseMenu(); }}
        style={{ fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer", marginLeft:"auto" }}>
        Cancel
      </button>
    </div>
  );
}

function DailyCard({ habit, onTap, onSkip, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit }) {
  const tLog  = latestTodayLog(habit);
  const logged = isLoggedToday(habit);
  const isSkip = tLog?.value === "skip";
  const [restOpen, setRestOpen] = useState(false);
  const [restWhy, setRestWhy] = useState("");
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));
  useEffect(() => {
    if (logged) {
      setRestOpen(false);
      setRestWhy("");
    }
  }, [logged]);
  return (
    <div className="rc" style={cardStyle(logged && !isSkip, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged && !isSkip}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            Daily{getHabitCardStreakSuffix(habit)}
          </div>
        </div>
        {onEditHabit && onDeleteHabit && (
          <TodayOverflowDotsBtn expanded={habitMenuOpen} onToggle={() => setHabitMenuOpen(p => !p)} />
        )}
        {isSkip
          ? <button className="tap" onClick={() => onTap(habit.id, { currentTarget: { getBoundingClientRect: () => ({left:0,top:0,width:0,height:0}) } })}
              style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${T.muted}`, background:T.surface, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, transition:"all 0.18s" }}>
              🛡️
            </button>
          : <CheckBtn logged={logged} habit={habit} onClick={e => onTap(habit.id, e)}/>
        }
      </div>
      {onEditHabit && onDeleteHabit && (
        <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} onShareHabit={onShareHabit} shareSaving={!!sharingThisHabit} menuOpen={habitMenuOpen} onCloseMenu={() => setHabitMenuOpen(false)} />
      )}
      {isSkip && (
        <div style={{ margin:"0 15px 12px", background:"rgba(106,104,96,0.15)", borderRadius:T.rsm, padding:"8px 12px", display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🛡️</span>
            <span style={{ fontSize:12, fontWeight:500, color:T.muted }}>Rest day — streak protected</span>
          </div>
          {tLog?.note?.trim() ? (
            <div style={{ fontSize:12, color:T.sub, lineHeight:1.5, paddingLeft:24, fontStyle:"italic" }}>{tLog.note.trim()}</div>
          ) : null}
        </div>
      )}
      {logged && !isSkip && <DoneBanner habit={habit}/>}
      {logged && !isSkip && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
      {!logged && (
        <div style={{ padding:"0 15px 12px" }}>
          {restOpen ? (
            <div style={{ borderRadius:T.rsm, border:`0.5px solid ${T.borderMid}`, background:T.surface, padding:"12px 12px 10px" }}>
              <label style={{ display:"block", fontSize:12, fontWeight:500, color:T.text, marginBottom:6 }}>Why a rest day? <span style={{ fontWeight:400, color:T.hint }}>(optional)</span></label>
              <textarea
                value={restWhy}
                onChange={e => setRestWhy(e.target.value)}
                placeholder="Travel, recovery, life got busy…"
                rows={2}
                maxLength={200}
                style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font, lineHeight:1.45, marginBottom:10 }}
              />
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
                <button type="button" onClick={() => { setRestOpen(false); setRestWhy(""); }}
                  style={{ fontSize:12, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"8px 14px", cursor:"pointer" }}>
                  Cancel
                </button>
                <button type="button" onClick={() => { onSkip(habit.id, restWhy.trim()); setRestOpen(false); setRestWhy(""); }}
                  style={{ fontSize:12, fontWeight:600, color:"#1a1208", background:T.amber, border:"none", borderRadius:T.rsm, padding:"8px 16px", cursor:"pointer" }}>
                  Confirm rest day
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button type="button" onClick={() => { setRestOpen(true); setRestWhy(""); }}
                style={{ fontSize:12, color:T.hint, background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                🛡️ Rest day
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WeeklyCard({ habit, onTap, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit }) {
  const logged = isLoggedToday(habit);
  const wk = getWeeklyCount(habit);
  const pct = Math.min(100, Math.round((wk / habit.weeklyTarget) * 100));
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));
  return (
    <div className="rc" style={cardStyle(logged, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            {wk}/{habit.weeklyTarget} sessions this week
            {getHabitCardStreakSuffix(habit)}
          </div>
        </div>
        {onEditHabit && onDeleteHabit && (
          <TodayOverflowDotsBtn expanded={habitMenuOpen} onToggle={() => setHabitMenuOpen(p => !p)} />
        )}
        <CheckBtn logged={logged} habit={habit} onClick={e => onTap(habit.id, e)}/>
      </div>
      {onEditHabit && onDeleteHabit && (
        <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} onShareHabit={onShareHabit} shareSaving={!!sharingThisHabit} menuOpen={habitMenuOpen} onCloseMenu={() => setHabitMenuOpen(false)} />
      )}
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
      {logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
    </div>
  );
}

function ProjectCard({ habit, onOpenLog, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit }) {
  const stats = getProjectStats(habit);
  const tLogs = todayLogs(habit);
  const logged = tLogs.length > 0;
  const todayMins = tLogs.reduce((s, l) => s + (l.value?.minutes || 0), 0);
  const dailyBuildTarget = habit.dailyTargetMinutes ?? 60;
  const streakPhrase = (() => {
    const s = getBuildStreak(habit);
    if (s <= 0) return "";
    if (s > 1) return ` · 🔥 ${s} day streak`;
    const todayOk = qualifiesBuildDay(habit, todayStr());
    const yestOk = qualifiesBuildDay(habit, daysAgo(1));
    if (todayOk && !yestOk) return " · Started today";
    return " · 🔥 1 day streak";
  })();
  const lastWin = [...habit.logs].filter(l => l.value?.win).pop();
  const sessionsSuffix = tLogs.length > 1 ? ` (${tLogs.length} sessions)` : "";
  const buildMeta = logged
    ? todayMins > dailyBuildTarget
      ? `${todayMins} min today (goal: ${dailyBuildTarget})${sessionsSuffix}${streakPhrase}`
      : `${todayMins}/${dailyBuildTarget} min today${sessionsSuffix}${streakPhrase}`
    : `Tap + to log a session${streakPhrase}`;
  const buildMetaDisplay = truncateText(buildMeta, 68);
  const latestWinDisplay = truncateText(lastWin?.value?.win || "", 96);
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));
  return (
    <div className="rc" style={cardStyle(logged, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div title={buildMeta} style={{ fontSize:12, color:T.muted, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {buildMetaDisplay}
          </div>
        </div>
        {onEditHabit && onDeleteHabit && (
          <TodayOverflowDotsBtn expanded={habitMenuOpen} onToggle={() => setHabitMenuOpen(p => !p)} />
        )}
        <PlusBtn habit={habit} logged={logged} onClick={() => onOpenLog(habit.id)}/>
      </div>
      {onEditHabit && onDeleteHabit && (
        <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} onShareHabit={onShareHabit} shareSaving={!!sharingThisHabit} menuOpen={habitMenuOpen} onCloseMenu={() => setHabitMenuOpen(false)} />
      )}
      <div style={{ padding:"0 15px 14px", display:"flex", gap:8 }}>
        <Stat label="hrs this wk" value={stats.weekHours} color={habit.color}/>
        <Stat label="total hrs" value={stats.totalHours}/>
        <Stat label="wins" value={stats.wins} color={T.green}/>
        <Stat label="hard parts" value={stats.hard} color={T.amber}/>
      </div>
      {lastWin && (
        <div style={{ margin:"0 15px 14px", background:T.surface, borderRadius:T.rsm, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Latest win</div>
          <div title={lastWin.value.win} style={{ fontSize:12, color:T.sub, lineHeight:1.5 }}>
            {latestWinDisplay}
          </div>
        </div>
      )}
      {logged && <DoneBanner habit={habit}/>}
      {logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
    </div>
  );
}

function LimitCard({ habit, onTap, onUndo, onLogZero, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit }) {
  const todayLogsArr = habit.logs.filter(l => l.date === todayStr() && l.value !== "quicknote");
  const used   = todayLogsArr.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0);
  const budget = habit.dailyBudget || 60;
  const pct      = Math.min(120, Math.round((used / budget) * 100));
  const barColor = pct < 60 ? T.green : pct < 90 ? T.amber : T.accent;
  const over     = used > budget;
  // Distinguish: explicitly logged (any numeric entry today) vs truly not logged at all
  const logged   = todayLogsArr.length > 0;
  const inc      = habit.tapIncrement ?? 1;
  const unitSuffix = habit.unit && habit.unit !== "logged" ? ` ${habit.unit}` : "";
  const limitMetaColor = logged ? (over ? T.accent : T.green) : T.hint;
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));
  return (
    <div className="rc" style={{ ...cardStyle(false, habit), borderColor:over?T.accent+"66":T.border, background:over?`${T.accent}0A`:T.raised }} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={false}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, marginTop:2, lineHeight:1.4 }}>
            {logged ? (
              <span style={{ color: limitMetaColor, fontWeight:500 }}>{used}/{budget} today{unitSuffix}</span>
            ) : (
              <span style={{ color: T.hint }}>
                Limit <span style={{ color: T.muted, fontWeight:500 }}>{budget}{unitSuffix}</span>
                <span style={{ color: T.hint }}> · not logged yet</span>
              </span>
            )}
            <span style={{ color: T.muted }}>{getHabitCardStreakSuffix(habit)}{inc > 1 ? ` · +${inc} per tap` : ""}</span>
          </div>
        </div>
        {onEditHabit && onDeleteHabit && (
          <TodayOverflowDotsBtn expanded={habitMenuOpen} onToggle={() => setHabitMenuOpen(p => !p)} />
        )}
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
          {logged && (
            <button className="tap" onClick={() => onUndo(habit.id)}
              style={{ width:40, height:40, borderRadius:"50%", border:`1.5px solid ${T.borderMid}`, background:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:T.muted, transition:"all 0.18s" }}>−</button>
          )}
          <button className="tap" onClick={e => onTap(habit.id, e)}
            style={{ width:44, height:44, borderRadius:"50%", border:`2px solid ${habit.color+"66"}`, background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:habit.color, fontWeight:300, transition:"all 0.18s" }}>+</button>
        </div>
      </div>
      {onEditHabit && onDeleteHabit && (
        <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} onShareHabit={onShareHabit} shareSaving={!!sharingThisHabit} menuOpen={habitMenuOpen} onCloseMenu={() => setHabitMenuOpen(false)} />
      )}

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
          <span style={{ fontSize:11, color:T.hint, flexShrink:0, textAlign:"right", maxWidth:"42%" }}>Under limit once you log · or mark none</span>
          <button onClick={() => onLogZero(habit.id)}
            title="Mark that you had none today"
            style={{ fontSize:11, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"3px 9px", cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" }}>
            None today
          </button>
        </div>
      )}

      {logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
    </div>
  );
}

function TodayGoalCard({ goal, onOpenLog, onEdit, onComplete, onDelete }) {
  const stats = getGoalProgress(goal);
  const { isComplete } = stats;
  const barFillPct = goalBarFillWidthPct(stats);
  const loggedToday = goal.logs?.some(l => l.date === todayStr()) || false;
  const statusText = getGoalStatusText(goal, stats);
  const deadlineLine = goalTodayDeadlineLine(goal, stats, isComplete);
  const [showMenu, setShowMenu] = useState(false);
  const [goalDeleteConfirm, setGoalDeleteConfirm] = useState(false);
  useEffect(() => {
    if (!showMenu) setGoalDeleteConfirm(false);
  }, [showMenu]);
  return (
    <div
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      className="rc"
      style={{ margin:"0 14px 10px", background:loggedToday ? `${goal.color}0D` : T.raised, borderRadius:T.r, border:`0.5px solid ${loggedToday ? goal.color+"66" : T.border}`, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <div style={{ width:40, height:40, borderRadius:11, background:goal.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{goal.emoji}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{goal.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:1 }}>
            <strong style={{ color:goal.color }}>{goal.currentValue}{goal.unit}</strong>
            {" → "}
            <strong style={{ color:T.text }}>{goal.targetValue}{goal.unit}</strong>
            <span style={{ marginLeft:6, color:isComplete ? T.green : T.hint }}>{statusText}</span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {!isComplete && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpenLog(goal.id); }}
              style={{ fontSize:12, color:goal.color, background:"none", border:`0.5px solid ${goal.color+"55"}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>
              Log
            </button>
          )}
          <TodayOverflowDotsBtn expanded={showMenu} onToggle={() => setShowMenu(m => !m)} />
        </div>
      </div>
      <div style={{ padding:"0 15px 14px" }}>
        <div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden" }}>
          <div style={{ height:"100%", borderRadius:3, background:isComplete ? T.green : goal.color, width:`${barFillPct}%`, transition:"width 0.4s ease" }}/>
        </div>
        {deadlineLine ? (
          <div style={{ fontSize:11, color:T.sub, marginTop:7, lineHeight:1.45 }}>{deadlineLine}</div>
        ) : null}
      </div>
      {showMenu && !goalDeleteConfirm && (
        <div
          role="menu"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          style={{ borderTop:`0.5px solid ${T.border}`, padding:"8px 15px 10px", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button
            type="button"
            onPointerDown={e => { e.stopPropagation(); }}
            onMouseDown={e => { e.stopPropagation(); }}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(goal.id);
              setShowMenu(false);
            }}
            style={{ fontSize:12, color:goal.color, background:"none", border:`0.5px solid ${goal.color+"55"}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>
            Edit
          </button>
          {!isComplete && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onComplete(goal.id); setShowMenu(false); }}
              style={{ fontSize:12, color:T.green, background:"none", border:`0.5px solid ${T.green+"44"}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer" }}>
              Complete goal
            </button>
          )}
          <button type="button" aria-label="Delete goal" onClick={(e) => { e.stopPropagation(); setGoalDeleteConfirm(true); }}
            style={{ fontSize:12, color:"#e74c3c", background:"none", border:`0.5px solid rgba(231,76,60,0.3)`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>
            Delete
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}
            style={{ fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer", marginLeft:"auto" }}>
            Cancel
          </button>
        </div>
      )}
      {showMenu && goalDeleteConfirm && (
        <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
          <div style={{ padding:"10px 15px 6px", borderTop:`0.5px solid ${T.border}`, fontSize:13, fontWeight:500, color:T.text }}>
            Delete {goal.name}?
          </div>
          <div style={{ padding:"8px 15px 10px", display:"flex", alignItems:"center", gap:8, justifyContent:"flex-end" }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(goal.id); setShowMenu(false); }}
              style={{ fontSize:12, color:"#e74c3c", background:"rgba(231,76,60,0.1)", border:`0.5px solid rgba(231,76,60,0.4)`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer", fontWeight:500 }}>
              Delete
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setGoalDeleteConfirm(false); }}
              style={{ fontSize:12, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer" }}>
              Cancel
            </button>
          </div>
          <div style={{ padding:"0 15px 12px", fontSize:12, color:"rgba(231,76,60,0.8)" }}>
            This will permanently delete <strong>{goal.name}</strong> and its progress. {"This can't be undone."}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LOG MODALS ───────────────────────────────────────────────────────────────
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
  project:  { bg:"#2980B918", text:"#2980B9", label:"Build"          },
  limit:    { bg:"#8E44AD18", text:"#8E44AD", label:"Limit / reduce" },
};
function EditModal({ habit, onClose, onSave }) {
  const [name,        setName]        = useState(habit.name);
  const [emoji,       setEmoji]       = useState(habit.emoji);
  const [color,       setColor]       = useState(habit.color);
  const [reflection,  setReflection]  = useState(habit.reflection ?? true);
  const [reflPrompt,  setReflPrompt]  = useState(habit.reflectionPrompt || "");
  const [weekTarget,  setWeekTarget]  = useState(String(habit.weeklyTarget || 3));
  const [budget,      setBudget]      = useState(String(habit.dailyBudget || 60));
  const [budgetUnit,  setBudgetUnit]  = useState(habit.unit || "min");
  const [increment,   setIncrement]   = useState(String(habit.tapIncrement ?? 1));
  const [dailyTargetMins, setDailyTargetMins] = useState(String(habit.dailyTargetMinutes ?? 60));
  const meta = TYPE_META[habit.habitType] || TYPE_META.daily;
  const typePillLabel = HABIT_TYPES[habit.habitType]?.label || meta.label;

  function save() {
    const updates = { name:name.trim()||habit.name, emoji:emoji||habit.emoji, color, reflection, reflectionPrompt:reflPrompt.trim()||null };
    if (habit.habitType === "weekly")   updates.weeklyTarget = parseInt(weekTarget) || habit.weeklyTarget;
    if (habit.habitType === "limit")    { updates.dailyBudget = parseInt(budget)||habit.dailyBudget; updates.unit = budgetUnit||habit.unit; updates.tapIncrement = parseInt(increment)||1; }
    if (habit.habitType === "project")  updates.dailyTargetMinutes = Math.max(1, parseInt(dailyTargetMins, 10) || (habit.dailyTargetMinutes ?? 60));
    onSave(habit.id, updates);
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display:"inline-flex", alignItems:"center", background:meta.bg, borderRadius:20, padding:"4px 12px", marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:500, color:meta.text }}>{typePillLabel}</span>
      </div>
      <div style={{ fontSize:11, color:T.hint, marginBottom:16, lineHeight:1.45, maxWidth:320 }}>
        Type can&apos;t be changed after creation — delete and recreate if you need a different kind.
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
          <div style={{ fontSize:13, color:T.muted }}>
            {getDailyStreak(habit) > 0
              ? <>One tap per day. Currently on a <strong style={{ color:T.text }}>{getDailyStreak(habit)}-day streak</strong>.</>
              : "One tap per day. No active streak yet."}
          </div>
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
      {habit.habitType === "project" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <FG label="Daily session target (min)" mb={8}>
            <input style={inp} type="number" min="1" max="1440" value={dailyTargetMins} onChange={e => setDailyTargetMins(e.target.value)}/>
          </FG>
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
      <div style={{ fontSize:11, color:T.hint, lineHeight:1.5, marginBottom:18, padding:"12px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}` }}>
        <span style={{ color:T.sub, fontWeight:600 }}>XP</span>
        {" — "}Your total lives on your account (⚡ in the header or Profile). XP is awarded when you log; habits don&apos;t store their own XP field to edit here.
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
  const [buildDailyTarget, setBuildDailyTarget] = useState("60");

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
      {habitType === "project" && (
        <div style={{ marginBottom:20 }}>
          <div style={{ marginBottom:12, padding:"12px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, fontSize:12, color:T.muted, lineHeight:1.55 }}>
            <strong style={{ color:T.text }}>What you’ll track:</strong> minutes <strong style={{ color:T.text }}>today</strong>, total time <strong style={{ color:T.text }}>this week</strong> and <strong style={{ color:T.text }}>all-time</strong>, plus optional <strong style={{ color:T.text }}>wins</strong> and <strong style={{ color:T.text }}>hard parts</strong> when you log a session.
          </div>
          <FG label="Daily session target (min)" mb={0}>
            <input style={inp} type="number" min="1" max="1440" value={buildDailyTarget} onChange={e => setBuildDailyTarget(e.target.value)}/>
          </FG>
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
        else if (habitType === "limit") onSave({ ...base, dailyBudget:parseInt(budget)||60, unit:budgetUnit||"min", tapIncrement:parseInt(tapIncrement)||1 });
        else if (habitType === "project") onSave({ ...base, dailyTargetMinutes: Math.max(1, parseInt(buildDailyTarget, 10) || 60) });
        else onSave(base);
      }}>Add habit</PBtn>
      <GBtn onClick={() => setStep("type")}>Back</GBtn>
    </Modal>
  );
}

// ─── XP MODAL ─────────────────────────────────────────────────────────────────
function XPModal({ xp, onClose }) {
  const level = getLevel(xp);
  const next = nextLevel(xp);
  const span = next ? Math.max(1, next.min - level.min) : 1;
  const pct = next ? Math.round(((xp - level.min) / span) * 100) : 100;
  const gap = next ? next.min - xp : 0;

  return (
    <Modal onClose={onClose}>
      <div style={{ marginTop:-4, paddingBottom:4 }}>
        <p
          style={{
            fontSize:12, color:T.goldBright, letterSpacing:"0.06em", textTransform:"uppercase",
            fontWeight:600, margin:"0 0 22px", textAlign:"center", lineHeight:1.4,
          }}
        >
          XP is proof you showed up.
        </p>

        {/* Hero — current rank */}
        <div
          style={{
            background:`linear-gradient(165deg, rgba(18,18,16,0.98) 0%, ${T.bg} 55%, rgba(12,12,10,1) 100%)`,
            border:`1px solid ${T.borderMid}`,
            borderRadius:T.r,
            padding:"24px 18px 22px",
            marginBottom:20,
            boxShadow:"inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 40px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              fontFamily:T.serif, fontSize:34, fontWeight:700, color:level.color, lineHeight:1.05,
              letterSpacing:"-0.02em", textShadow:`0 0 48px ${level.color}33`,
            }}
          >
            {level.label}
          </div>
          <div style={{ fontSize:14, color:T.sub, marginTop:10, lineHeight:1.55, maxWidth:320 }}>
            {level.meaning}
          </div>

          <div style={{ marginTop:22, fontSize:14, color:T.text, fontWeight:500, lineHeight:1.5 }}>
            {next ? (
              <>
                <span style={{ color:level.color, fontVariantNumeric:"tabular-nums" }}>{xp} xp</span>
                <span style={{ color:T.hint }}> — </span>
                <span style={{ color:T.sub }}>{gap} to </span>
                <span style={{ color:next.color, fontWeight:600 }}>{next.label}</span>
              </>
            ) : (
              <>
                <span style={{ color:level.color, fontVariantNumeric:"tabular-nums" }}>{xp} xp</span>
                <span style={{ color:T.hint }}> — </span>
                <span style={{ color:T.goldBright, fontWeight:600 }}>Peak rank</span>
              </>
            )}
          </div>
          <div
            style={{
              height:12, background:T.bg, borderRadius:8, overflow:"hidden", marginTop:14,
              border:`1px solid ${T.border}`, boxShadow:"inset 0 2px 6px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                height:"100%", borderRadius:7,
                background: next
                  ? `linear-gradient(90deg, ${level.color}, ${next.color})`
                  : `linear-gradient(90deg, ${level.color}, ${T.goldBright})`,
                width:`${pct}%`, maxWidth:"100%", transition:"width 0.65s ease",
                boxShadow:`0 0 16px ${level.color}55`,
              }}
            />
          </div>
        </div>

        <div
          style={{
            fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.12em",
            fontWeight:600, marginBottom:10, paddingLeft:2,
          }}
        >
          Ranks
        </div>
        <div
          style={{
            border:`1px solid ${T.borderMid}`, borderRadius:T.r, overflow:"hidden",
            background:T.bg, marginBottom:18, boxShadow:"inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          {XP_LEVELS.map((l, i) => {
            const isCurrent = l.min === level.min;
            const isFuture = xp < l.min;
            return (
              <div
                key={l.min}
                style={{
                  display:"flex", gap:14, padding:"14px 14px 14px 11px",
                  borderTop: i > 0 ? `1px solid ${T.border}` : "none",
                  opacity: isFuture ? 0.4 : 1,
                  background: isCurrent ? `${l.color}12` : "transparent",
                  borderLeft: isCurrent ? `3px solid ${l.color}` : "3px solid transparent",
                  boxShadow: isCurrent ? `inset 0 0 36px ${l.color}0D` : "none",
                }}
              >
                <div
                  style={{
                    width:12, height:12, borderRadius:"50%", background:l.color, flexShrink:0, marginTop:4,
                    boxShadow: isFuture ? "none" : `0 0 10px ${l.color}55`,
                    opacity: isFuture ? 0.55 : 1,
                  }}
                />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
                    <span
                      style={{
                        fontSize:15,
                        fontWeight: isCurrent ? 600 : 500,
                        color: isFuture ? T.hint : T.text,
                        letterSpacing:"-0.01em",
                      }}
                    >
                      {l.label}
                      {isCurrent ? (
                        <span style={{ marginLeft:8, fontSize:10, fontWeight:600, color:l.color, letterSpacing:"0.08em", textTransform:"uppercase" }}>
                          Now
                        </span>
                      ) : null}
                    </span>
                    <span
                      style={{
                        fontSize:11, color:T.hint, fontVariantNumeric:"tabular-nums", flexShrink:0,
                      }}
                    >
                      {l.min.toLocaleString()} xp
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize:12, color: isFuture ? T.hint : T.sub, marginTop:5, lineHeight:1.45,
                    }}
                  >
                    {l.meaning}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <GBtn onClick={onClose}>Close</GBtn>
      </div>
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
            <div style={{ fontSize:13, color:T.text, fontWeight:500, textAlign:"center" }}>Full history will be part of early supporter access</div>
            <div style={{ fontSize:12, color:T.muted, textAlign:"center" }}>You have {habit.logs.filter(l => l.date < cutoff).length} older logs waiting</div>
            <button onClick={onUpgrade}
              style={{ marginTop:6, padding:"9px 20px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>
              Unlock beta access →
            </button>
          </div>
        </div>
      )}
      <GBtn onClick={onClose}>Close</GBtn>
    </Modal>
  );
}

// ─── TOUR SYSTEM ─────────────────────────────────────────────────────────────
// Steps: { target?, title, body, pad?, radius?, callout?, welcome? }
// target = null → full dim, callout centered
// welcome = true → renders a full-screen welcome card with Start/Skip layout
// callout: "top" | "bottom" | "center" (auto-detected if omitted)

const GLOBAL_TOUR = [
  {
    welcome: true,
    target: null,
    title: "Welcome to Forged.",
    body: "This tour takes about 30 seconds. It'll show you what each screen does and how to get the most out of it.",
  },
  {
    target: "[data-tour='today-summary']",
    title: "Your daily progress",
    body: "This ring fills up as you log habits each day. Tap the XP badge to see your current level and how much further you have to go.",
    pad: 10,
  },
  {
    target: "[data-tour='today-first-section']",
    title: "Logging a habit",
    body: "Tap the circle on any habit to log it for today. Tap it again — or hold — for more options: reflect, skip the day, add a note, or undo.",
    pad: 6,
  },
  {
    target: "[data-tour='nav']",
    title: "Five screens, one app",
    body: "Today logs habits. Journal stores reflections. Insights shows patterns. Social is where Forge Pro crew features will live. Profile tracks your XP and account.",
    pad: 4, radius: 16, callout: "top",
  },
];

const PAGE_TOURS = {
  today: [
    {
      target: "[data-tour='today-summary']",
      title: "Daily progress ring",
      body: "Fills up as you log habits. Tap the XP badge to see your current level and how close you are to the next one.",
      pad: 10,
    },
    {
      target: "[data-tour='today-first-section']",
      title: "Logging habits",
      body: "Tap the circle to log. Tap again or hold for options — reflect on the day, skip it, add a quick note, or undo a log.",
      pad: 6,
    },
  ],
  social: [
    {
      target: "[data-tour='social-teaser']",
      title: "Forge together",
      body: "Forge Pro adds friends, challenges, streak comparisons, and group leaderboards — built for people who want accountability that actually sticks.",
      pad: 8,
    },
    {
      target: "[data-tour='coach-fab']",
      title: "Your AI coach",
      body: "Tap the floating coach anytime. Soon you'll be able to talk or type with a coach that knows your habits — set goals, log progress, and stay on track without the busywork.",
      callout: "top", pad: 8,
    },
  ],
  journal: [
    {
      target: "[data-tour='journal-viewmode']",
      title: "Switch your view",
      body: "Day view lists every entry in order. Week groups them by week. Month shows a calendar grid so you can spot gaps at a glance.",
      pad: 6,
    },
    {
      target: "[data-tour='journal-filters']",
      title: "Filter by habit",
      body: "Tap a habit name to see only its logs and reflections. Useful when you want to review one habit's history without the noise.",
      pad: 6,
    },
    {
      target: "[data-tour='journal-list']",
      title: "Your reflections",
      body: "Every note and reflection you write while logging a habit appears here automatically. Tap any entry to read or edit it.",
      pad: 6,
    },
  ],
  insights: [
    {
      target: "[data-tour='insights-stats']",
      title: "Your snapshot",
      body: "Total habits tracked, how many days you've logged at least one habit, your longest streak ever, and your total log count.",
      pad: 8,
    },
    {
      target: "[data-tour='insights-streaks']",
      title: "Streaks and activity",
      body: "Each habit's current streak alongside its last 7 days. Green squares are logged days. Your most consistent habit is highlighted at the bottom.",
      pad: 8,
    },
  ],
  profile: [
    {
      target: "[data-tour='profile-account']",
      title: "Your account",
      body: "Change your display name or rename your AI coach here. These are the names shown across the whole app.",
      pad: 6,
    },
    {
      target: "[data-tour='profile-upgrade']",
      title: "Early supporter access",
      body: "Unlocks the AI coach, unlimited habits, and full log history — at a price locked in forever. First 100 users get it at $4.99/mo.",
      pad: 6,
    },
    {
      target: "[data-tour='profile-feedback']",
      title: "Send feedback",
      body: "You're one of the first people using Forged. A quick note goes directly to the founder — it genuinely shapes what gets built next.",
      pad: 6,
    },
    {
      target: "[data-tour='profile-signout']",
      title: "Sign out",
      body: "Your data is saved to your account, so you can sign in on any device and pick up exactly where you left off.",
      pad: 6,
    },
  ],
};

function TourOverlay({ steps, stepIdx, onNext, onSkip }) {
  const [rect, setRect] = useState(null);
  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;
  // Steps that don't count as "welcome" in the progress bar
  const progressSteps = steps.filter(s => !s.welcome);
  const progressIdx   = stepIdx - steps.filter((s, i) => s.welcome && i < stepIdx).length;

  useLayoutEffect(() => {
    if (!step?.target) { setRect(null); return; }
    const el = document.querySelector(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    } else {
      setRect(null);
    }
  }, [stepIdx, step?.target]);

  const PAD = step?.pad ?? 8;
  const hl = rect ? {
    top:    rect.top    - PAD,
    left:   rect.left   - PAD,
    width:  rect.width  + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  // Auto-detect callout position: element in bottom 45% → show callout near top
  let calloutPos = step?.callout;
  if (!calloutPos) {
    if (!rect || step?.welcome) calloutPos = "center";
    else calloutPos = (rect.top + rect.height / 2) > window.innerHeight * 0.55 ? "top" : "bottom";
  }

  const calloutStyle =
    calloutPos === "top"    ? { top: 64, left: "50%", transform: "translateX(-50%)" } :
    calloutPos === "center" ? { top: "50%", left: "50%", transform: "translate(-50%,-50%)" } :
                              { bottom: 32, left: "50%", transform: "translateX(-50%)" };

  // Welcome card — special full-screen layout for the first global step
  if (step?.welcome) {
    return (
      <div style={{ position:"fixed", inset:0, zIndex:600, background:"rgba(0,0,0,0.88)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
        <div style={{ width:360, maxWidth:"calc(100vw - 24px)", background:T.raised, borderRadius:22, padding:"32px 24px 28px", boxShadow:"0 12px 48px rgba(0,0,0,0.6)" }}>
          <div style={{ fontSize:36, marginBottom:16, textAlign:"center" }}>⚒️</div>
          <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, marginBottom:10, textAlign:"center" }}>{step.title}</div>
          <div style={{ fontSize:14, color:T.muted, lineHeight:1.7, marginBottom:28, textAlign:"center" }}>{step.body}</div>
          <button onClick={onNext}
            style={{ width:"100%", padding:"14px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:500, cursor:"pointer", marginBottom:10 }}>
            Show me around →
          </button>
          <button onClick={onSkip}
            style={{ width:"100%", padding:"10px", borderRadius:T.rsm, border:"none", background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:"fixed", inset:0, zIndex:600 }} onMouseDown={e => e.stopPropagation()}>
      {/* Spotlight */}
      {hl ? (
        <div style={{
          position:"fixed",
          top: hl.top, left: hl.left, width: hl.width, height: hl.height,
          borderRadius: step?.radius ?? 14,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.82)",
          border: "1.5px solid rgba(200,144,42,0.6)",
          pointerEvents: "none",
          zIndex: 601,
          transition: "top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease",
        }}/>
      ) : (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", pointerEvents:"none", zIndex:601 }}/>
      )}

      {/* Callout card */}
      <div style={{
        position:"fixed", ...calloutStyle,
        width:340, maxWidth:"calc(100vw - 24px)",
        background:T.raised, borderRadius:18,
        padding:"18px 20px 20px",
        zIndex:602,
        boxShadow:"0 8px 40px rgba(0,0,0,0.55)",
      }}>
        {/* Progress dots */}
        {progressSteps.length > 1 && (
          <div style={{ display:"flex", gap:4, marginBottom:14 }}>
            {progressSteps.map((_, i) => (
              <div key={i} style={{ height:3, flex:1, borderRadius:2, background:i<=progressIdx?T.accent:T.surface, transition:"background 0.2s" }}/>
            ))}
          </div>
        )}
        <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:7 }}>{step.title}</div>
        <div style={{ fontSize:13, color:T.muted, lineHeight:1.65, marginBottom:16 }}>{step.body}</div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onSkip}
            style={{ flex:1, padding:"10px", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
            {progressSteps.length > 1 ? "Skip" : "Done"}
          </button>
          <button onClick={onNext}
            style={{ flex:2, padding:"10px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:500, cursor:"pointer" }}>
            {isLast ? "Got it 🔥" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
function TodayScreen({ habits, goals = [], xp, onTap, onUndo, onSkip, onAddNote, onLogZero, onOpenLog, onOpenGoalLog, onEditGoal, onCompleteGoal, onDeleteGoal, onEditHabit, onDeleteHabit, onShareHabit, sharingHabitId, onXPInfo, onAdd, hideFloatingAdd }) {
  const activeGoals = goals.filter(g => g.status !== "completed");
  const loggedCount = habits.filter(h => isLoggedToday(h)).length;
  const totalTrackables = habits.length;
  const pct = totalTrackables ? Math.round((loggedCount / totalTrackables) * 100) : 0;
  const hr = new Date().getHours();
  const greeting = hr < 12 ? "Rise and forge." : hr < 17 ? "Keep the heat up." : "Finish strong.";
  const level = getLevel(xp);
  const daily   = habits.filter(h => h.habitType === "daily");
  const limit   = habits.filter(h => h.habitType === "limit");
  const weekly  = habits.filter(h => h.habitType === "weekly");
  const project = habits.filter(h => h.habitType === "project");
  if (habits.length === 0 && activeGoals.length === 0) return (
    <div style={{ padding:"48px 28px", textAlign:"center" }}>
      <div style={{ fontSize:48, marginBottom:18 }}>⚒️</div>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:10 }}>Nothing forged yet.</div>
      <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:28 }}>
        Add your first habit or goal and start building something that lasts.
      </div>
      <button onClick={onAdd} style={{ padding:"14px 32px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:500, cursor:"pointer" }}>
        Add your first habit or goal
      </button>
    </div>
  );

  return (
    <div>
      <div data-tour="today-summary" style={{ margin:"6px 14px 16px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"18px 20px", display:"flex", alignItems:"center", gap:18 }}>
        <Ring pct={pct}/>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:4 }}>{pct === 100 ? "Forged for today." : greeting}</div>
          <div style={{ fontSize:13, color:T.muted }}>{loggedCount} of {totalTrackables} logged</div>
          <button onClick={onXPInfo} style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:500, padding:"3px 10px", borderRadius:12, background:"rgba(200,144,42,0.15)", color:T.gold, border:"none", cursor:"pointer" }}>
            ⚡ {xp} xp · {level.label}
          </button>
        </div>
      </div>
      {/* Tour target: wraps only the first non-empty section so the spotlight ring is tight */}
      {(() => {
        const sections = [
          activeGoals.length > 0 && <><SLabel>Goals</SLabel> {activeGoals.map(g => <TodayGoalCard key={g.id} goal={g} onOpenLog={onOpenGoalLog} onEdit={onEditGoal} onComplete={onCompleteGoal} onDelete={onDeleteGoal}/>)}</>,
          daily.length   > 0 && <><SLabel>Daily</SLabel>          {daily.map(h   => <DailyCard  key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          limit.length   > 0 && <><SLabel>Limits</SLabel>         {limit.map(h   => <LimitCard  key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          weekly.length  > 0 && <><SLabel>Weekly targets</SLabel> {weekly.map(h  => <WeeklyCard key={h.id} habit={h} onTap={onTap} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          project.length > 0 && <><SLabel>Build</SLabel>          {project.map(h => <ProjectCard key={h.id} habit={h} onOpenLog={onOpenLog} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
        ].filter(Boolean);
        return sections.map((sec, i) =>
          i === 0
            ? <div key={i} data-tour="today-first-section">{sec}</div>
            : <div key={i}>{sec}</div>
        );
      })()}
      <div style={{ height:16 }}/>
      {!hideFloatingAdd && (habits.length > 0 || activeGoals.length > 0) && onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add habit or goal"
          title="Add habit or goal"
          style={{
            position:"fixed", bottom:210, right:18, height:52, padding:"0 18px 0 16px",
            borderRadius:26, border:"none",
            background:T.accent, color:"#fff", fontSize:14, fontWeight:700, lineHeight:1,
            cursor:"pointer", zIndex:99,
            boxShadow:"0 4px 16px rgba(192,57,43,0.35)",
            display:"flex", alignItems:"center", justifyContent:"center", gap:7,
            fontFamily:T.font,
          }}
        >
          <span style={{ fontSize:22, fontWeight:700, lineHeight:1, marginTop:1 }} aria-hidden>+</span>
          <span>Add habit</span>
        </button>
      )}
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
    const subject = encodeURIComponent("Forged early supporter — beta interest");
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
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:10 }}>Interested in becoming an early supporter?</div>
      <div style={{ fontSize:13, color:T.muted, lineHeight:1.8, marginBottom:20 }}>
        I'm gauging interest before charging anything. If you want to be one of the first 100 beta supporters,
        it's <strong style={{ color:T.text }}>$4.99/month</strong> — and that price is yours for life if you sign up early.
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
function DaySection({ date, dayHabits, onReflect, onDeleteLogEntry }) {
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
      {open && dayHabits.map(({ habit, logs, entryKey }) => (
        <HabitDayCard key={entryKey || habit.id} habit={habit} logs={logs} onReflect={onReflect} onDeleteLogEntry={onDeleteLogEntry}/>
      ))}
    </div>
  );
}

// Missed day (marked by user, optional note) — list / week views
function MissedDaySection({ date, note, onEdit, onClear }) {
  const label = fmtEntryDate(date);
  const hasNote = !!(note && note.trim());
  return (
    <div style={{ margin:"0 14px 10px", background:hasNote ? "rgba(230,126,34,0.06)" : "rgba(230,126,34,0.10)", borderRadius:T.r, border:`0.5px solid ${hasNote ? "rgba(230,126,34,0.22)" : "rgba(230,126,34,0.38)"}`, overflow:"hidden", boxShadow:hasNote ? "none" : "0 0 0 1px rgba(230,126,34,0.06) inset" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderBottom:hasNote ? `0.5px solid ${T.border}` : "none" }}>
        <span style={{ fontSize:18, lineHeight:1, color:hasNote ? T.muted : T.amber, fontWeight:700 }} title={hasNote ? "Marked missed — reason saved" : "Add a short reason for this missed day"}>{hasNote ? "✓" : "?"}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:600, color:hasNote ? T.sub : T.amber }}>{hasNote ? "Missed — noted" : "Missed — add a note"}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:2, lineHeight:1.4 }}>{label} · {hasNote ? "Edit to change, or Clear if you logged on Today." : "Tap Edit to say why (travel, rest…), or Clear if you logged elsewhere."}</div>
        </div>
        <button type="button" onClick={onEdit} style={{ fontSize:11, color:T.amber, background:"rgba(230,126,34,0.12)", border:`0.5px solid rgba(230,126,34,0.35)`, borderRadius:T.rsm, padding:"5px 10px", cursor:"pointer", fontWeight:600 }}>Edit</button>
        <button type="button" onClick={onClear} style={{ fontSize:11, color:T.hint, background:"none", border:"none", cursor:"pointer" }}>Clear</button>
      </div>
      {hasNote ? (
        <div style={{ padding:"10px 14px" }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Note</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{note.trim()}</div>
        </div>
      ) : null}
    </div>
  );
}

function formatJournalLogLine(habit, log) {
  const note = log.note?.trim();
  const noteSuffix = note ? ` · ${truncateText(note, 48)}` : "";
  if (log.value === "skip") return `Skipped${noteSuffix}`;
  if (log.value === "quicknote") return note || "Quick note";
  if (habit.habitType === "goal" && typeof log.value === "number") return `${formatWithUnit(log.value, habit.unit)}${noteSuffix}`;
  if (habit.habitType === "project" && log.value && typeof log.value === "object" && "minutes" in log.value) {
    return `${log.value.minutes ?? 0} min session${noteSuffix}`;
  }
  if (log.value === true) {
    if (habit.habitType === "weekly") return `Weekly session ✓${noteSuffix}`;
    return `Done ✓${noteSuffix}`;
  }
  if (typeof log.value === "number") return `${formatWithUnit(log.value, habit.unit)}${noteSuffix}`;
  if (log.reflection) return `Reflection · ${truncateText(log.reflection, 72)}${noteSuffix}`;
  if (log.value && typeof log.value === "object") {
    if (log.value.win) return `Win · ${truncateText(log.value.win, 56)}`;
    if (log.value.hardPart) return `Hard part · ${truncateText(log.value.hardPart, 56)}`;
  }
  if (log.value == null && note) return note;
  return note || "Entry";
}

function limitJournalMergedNotes(logs) {
  const seen = new Set();
  const out = [];
  for (const l of logs) {
    if (l.value === "quicknote") {
      const t = (l.note || "").trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    } else if (typeof l.value === "number") {
      const t = (l.note || "").trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
  }
  return out;
}

// Card showing one habit's full activity for a single day
function HabitDayCard({ habit, logs, onReflect, onDeleteLogEntry }) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showLimitTaps, setShowLimitTaps] = useState(false);
  const nonNote = logs.filter(l => l.value !== "quicknote");
  const notes   = logs.filter(l => l.value === "quicknote" || (l.note && l.note.trim()));
  const uniqueNotes = [...new Set(notes.map(l => l.note).filter(Boolean))];
  const isLimit = habit.habitType === "limit";
  const limitTapCount = isLimit ? nonNote.filter(l => typeof l.value === "number").length : 0;
  const limitMergedNotes = isLimit ? limitJournalMergedNotes(logs) : [];

  // Summary line based on habit type
  function summaryLine() {
    if (habit.habitType === "goal") {
      const latest = nonNote.slice(-1)[0];
      const value = typeof latest?.value === "number" ? latest.value : (habit.currentValue ?? 0);
      return `${formatWithUnit(value, habit.unit)} logged`;
    }
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
    if (isLegacyProgressType(habit.habitType)) {
      const latest = nonNote.slice(-1)[0];
      return latest ? `${latest.value}${habit.unit}` : "logged";
    }
    return "logged ✓";
  }

  // Grab wins, hard parts, reflections from any log
  const wins       = nonNote.filter(l => l.value?.win).map(l => l.value.win);
  const hardParts  = nonNote.filter(l => l.value?.hardPart).map(l => l.value.hardPart);
  const reflection = nonNote.map(l => l.reflection).filter(Boolean).join(" ");

  async function confirmDeleteEntry() {
    if (!pendingDelete || !onDeleteLogEntry || deleting) return;
    setDeleting(true);
    try {
      const ok = await onDeleteLogEntry(habit, pendingDelete);
      if (ok) setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
    <div style={{ margin:"0 14px 8px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
      {/* Habit header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px 8px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ width:24, height:24, borderRadius:6, background:habit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>{habit.emoji}</div>
        <span style={{ fontSize:13, fontWeight:500, color:habit.color }}>{habit.name}</span>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.hint }}>{summaryLine()}</span>
      </div>

      {/* Limit habits: one daily summary; expand for per-tap delete */}
      {isLimit && logs.length > 0 && onDeleteLogEntry && !showLimitTaps ? (
        <div style={{ borderBottom:`0.5px solid ${T.border}`, padding:"12px 14px" }}>
          <div style={{ fontSize:12, color:T.sub, lineHeight:1.55 }}>
            <strong style={{ color:T.text }}>Day summary</strong>
            {" — "}
            {limitTapCount === 0
              ? (logs.some(l => l.value === "quicknote") ? "Quick note only — expand taps to view or delete." : "No + taps logged today.")
              : `${limitTapCount} tap${limitTapCount !== 1 ? "s" : ""} · ${nonNote.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0)} / ${habit.dailyBudget ?? "—"} ${habit.unit || ""}`.trim()}
          </div>
          {limitMergedNotes.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Notes</div>
              {limitMergedNotes.map((t, i) => (
                <div key={i} style={{ fontSize:13, color:T.text, lineHeight:1.5, fontStyle:"italic", marginTop:i ? 6 : 0 }}>{t}</div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowLimitTaps(true)}
            style={{ marginTop:12, fontSize:11, color:habit.color, background:"none", border:"none", cursor:"pointer", fontWeight:500, padding:0 }}
          >
            Show individual taps (to delete one) →
          </button>
        </div>
      ) : null}

      {/* Per-entry rows (Journal) — delete removes one log; XP is not adjusted */}
      {logs.length > 0 && onDeleteLogEntry && (!isLimit || showLimitTaps) ? (
        <div style={{ borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ padding:"8px 14px 4px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
            <span style={{ fontSize:10, fontWeight:600, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em" }}>{isLimit ? "Each tap" : "Entries"}</span>
            {isLimit && showLimitTaps ? (
              <button type="button" onClick={() => setShowLimitTaps(false)} style={{ fontSize:11, color:T.muted, background:"none", border:"none", cursor:"pointer", padding:0 }}>Hide taps</button>
            ) : null}
          </div>
          {logs.map((log, i) => (
            <div
              key={`${log.date}-${i}-${typeof log.value === "object" ? JSON.stringify(log.value) : String(log.value)}`}
              style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 14px", borderTop:`0.5px solid ${T.border}` }}
            >
              <div style={{ flex:1, fontSize:13, color:T.text, lineHeight:1.5, minWidth:0 }}>{formatJournalLogLine(habit, log)}</div>
              <button
                type="button"
                aria-label="Delete this log entry"
                disabled={deleting}
                onClick={() => setPendingDelete(log)}
                style={{
                  flexShrink:0, width:32, height:32, marginTop:-4, border:"none", borderRadius:8, cursor:deleting ? "default" : "pointer",
                  background:"transparent", color:T.hint, fontSize:18, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center",
                }}
              >×</button>
            </div>
          ))}
        </div>
      ) : null}

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

      {/* Quick notes — limit notes live in day summary or per-row when taps expanded */}
      {!isLimit ? [...uniqueNotes].reverse().map((n, i) => (
        <div key={i} style={{ padding:"8px 14px", borderBottom:i<uniqueNotes.length-1?`0.5px solid ${T.border}`:"none", background:`${T.surface}66` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Note</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, fontStyle:"italic" }}>{n}</div>
        </div>
      )) : null}

      {/* Add reflection prompt if none yet */}
      {!reflection && habit.habitType !== "goal" && (
        <div style={{ padding:"8px 14px" }}>
          <button onClick={() => onReflect(habit.id)}
            style={{ fontSize:12, color:habit.color+"99", background:"none", border:"none", cursor:"pointer", fontWeight:500, padding:0 }}>
            Add reflection →
          </button>
        </div>
      )}
    </div>

    {pendingDelete && onDeleteLogEntry ? (
      <Modal onClose={() => { if (!deleting) setPendingDelete(null); }}>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:8 }}>Delete this entry?</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.55, marginBottom:22 }}>
          This removes the log from your journal and history. Your XP will stay the same.
        </div>
        <PBtn color="#9B2C2C" onClick={confirmDeleteEntry}>{deleting ? "Deleting…" : "Delete"}</PBtn>
        <GBtn onClick={() => { if (!deleting) setPendingDelete(null); }}>Cancel</GBtn>
      </Modal>
    ) : null}
    </>
  );
}

// ─── JOURNAL SCREEN ───────────────────────────────────────────────────────────
function JournalScreen({ habits, goals = [], onReflect, onDeleteJournalLog, journalUserId, isPro, onUpgrade }) {
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState("day"); // "day" | "week" | "month"
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [missedMap, setMissedMap] = useState({});
  const [missedEditDate, setMissedEditDate] = useState(null);
  const [missedNoteDraft, setMissedNoteDraft] = useState("");
  const [monthMissedDraft, setMonthMissedDraft] = useState("");
  const [openWeeks, setOpenWeeks] = useState(() => new Set([weekStartFor(todayStr())]));

  useEffect(() => {
    setMissedMap(loadJournalMissedMap(journalUserId));
  }, [journalUserId]);

  function toggleWeek(ws) {
    setOpenWeeks(prev => {
      const next = new Set(prev);
      if (next.has(ws)) next.delete(ws);
      else next.add(ws);
      return next;
    });
  }

  function persistMissed(next) {
    saveJournalMissedMap(journalUserId, next);
  }
  function setMissed(date, note) {
    setMissedMap(prev => {
      const next = { ...prev, [date]: note };
      persistMissed(next);
      return next;
    });
  }
  function clearMissed(date) {
    setMissedMap(prev => {
      const next = { ...prev };
      delete next[date];
      persistMissed(next);
      return next;
    });
  }

  const allByDate = {};
  habits.forEach(h => {
    const entryKey = `habit:${h.id}`;
    const hLogs = filter === "all" || filter === entryKey ? h.logs : [];
    hLogs.forEach(l => {
      if (!allByDate[l.date]) allByDate[l.date] = {};
      if (!allByDate[l.date][entryKey]) allByDate[l.date][entryKey] = { habit: h, logs: [], entryKey };
      allByDate[l.date][entryKey].logs.push(l);
    });
  });
  goals.forEach(g => {
    const entryKey = `goal:${g.id}`;
    const gLogs = (filter === "all" || filter === entryKey)
      ? (g.logs || []).filter(l => typeof l.value === "number")
      : [];
    const goalAsEntry = { ...g, habitType: "goal", reflection: false };
    gLogs.forEach(l => {
      if (!allByDate[l.date]) allByDate[l.date] = {};
      if (!allByDate[l.date][entryKey]) allByDate[l.date][entryKey] = { habit: goalAsEntry, logs: [], entryKey };
      allByDate[l.date][entryKey].logs.push(l);
    });
  });
  const dates = Object.keys(allByDate).sort((a, b) => b.localeCompare(a));
  const loggedDaysCount = new Set([
    ...habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip").map(l => l.date)),
    ...goals.flatMap(g => (g.logs || []).filter(l => typeof l.value === "number").map(l => l.date)),
  ]).size;

  const allLogDatesRaw = [
    ...habits.flatMap(h => h.logs.map(l => l.date)),
    ...goals.flatMap(g => (g.logs || []).filter(l => typeof l.value === "number").map(l => l.date)),
  ].filter(Boolean).sort();
  const firstLogDate  = allLogDatesRaw[0] || null;
  const firstLogYear  = firstLogDate ? parseInt(firstLogDate.split("-")[0], 10) : null;
  const firstLogMonth = firstLogDate ? parseInt(firstLogDate.split("-")[1], 10) - 1 : null;
  const firstLogDay   = firstLogDate ? parseInt(firstLogDate.split("-")[2], 10) : null;

  const now = new Date();
  const viewYear  = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1).getFullYear();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1).getMonth();
  const monthLabel = `${MONTHS[viewMonth]} ${viewYear}`;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const startPad = (firstDow + 6) % 7;

  function dayStr(d) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const entryDays = {};
  Object.entries(allByDate).forEach(([dateStr, habitMap]) => {
    const d = parseLocal(dateStr);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      const day = d.getDate();
      entryDays[day] = Object.values(habitMap).map(({ habit }) => ({ habitColor: habit.color }));
    }
  });

  const tStr = todayStr();
  const missedDatesList = Object.keys(missedMap).sort((a, b) => b.localeCompare(a));
  const missedNeedNoteCount = missedDatesList.filter(d => missedDayNeedsNote(missedMap, d)).length;
  const missedMarkedCount = missedDatesList.length;
  const mergedDatesSet = new Set([...dates, ...missedDatesList]);
  const mergedDesc = [...mergedDatesSet].sort((a, b) => b.localeCompare(a));
  const hasJournalRows = mergedDatesSet.size > 0;
  // Today always first; remaining days newest → oldest (ISO date sort)
  const sortedDatesDesc = hasJournalRows ? [tStr, ...mergedDesc.filter(d => d !== tStr)] : [];
  const weekKeysDesc = [...new Set(sortedDatesDesc.map(d => weekStartFor(d)))].sort((a, b) => b.localeCompare(a));

  useEffect(() => {
    if (selectedDay == null) { setMonthMissedDraft(""); return; }
    const ds = dayStr(selectedDay);
    setMonthMissedDraft(Object.prototype.hasOwnProperty.call(missedMap, ds) ? (missedMap[ds] || "") : "");
  }, [selectedDay, viewYear, viewMonth, missedMap]);

  function renderDayOrMissed(date) {
    if (Object.prototype.hasOwnProperty.call(missedMap, date)) {
      return (
        <MissedDaySection
          key={date}
          date={date}
          note={missedMap[date]}
          onEdit={() => { setMissedEditDate(date); setMissedNoteDraft(missedMap[date] || ""); }}
          onClear={() => clearMissed(date)}
        />
      );
    }
    const hasLog = allByDate[date] && Object.keys(allByDate[date]).length > 0;
    if (hasLog || date === tStr) {
      return (
        <DaySection
          key={date}
          date={date}
          dayHabits={hasLog ? Object.values(allByDate[date]) : []}
          onReflect={onReflect}
          onDeleteLogEntry={onDeleteJournalLog}
        />
      );
    }
    return null;
  }

  const listEmpty = sortedDatesDesc.length === 0;

  return (
    <div data-tour="journal-list">
      <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"flex-end", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Journal</div>
          <div style={{ fontSize:13, color:T.muted, marginTop:3 }}>
            {loggedDaysCount} days logged
            {missedNeedNoteCount > 0 ? (
              <span> · <span style={{ color:T.amber, fontWeight:600 }}>? {missedNeedNoteCount} missed day{missedNeedNoteCount !== 1 ? "s" : ""} need a note</span></span>
            ) : missedMarkedCount > 0 ? (
              <span> · <span style={{ color:T.muted }}>{missedMarkedCount} marked missed (all noted)</span></span>
            ) : null}
          </div>
        </div>
        <div data-tour="journal-viewmode" style={{ display:"flex", background:T.surface, borderRadius:T.rsm, padding:3, gap:2 }}>
          {[
            ["day", "Day"],
            ["week", "Week"],
            ["month", "Month"],
          ].map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => { setViewMode(mode); setSelectedDay(null); }}
              style={{ padding:"5px 10px", borderRadius:7, border:"none", cursor:"pointer",
                background:viewMode === mode ? T.raised : "none",
                color:viewMode === mode ? T.text : T.muted, fontSize:11, fontWeight:500, transition:"all 0.15s" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div data-tour="journal-filters" style={{ display:"flex", gap:6, padding:"0 16px 14px", overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        {[{ id:"all", name:"All", emoji:"", color:T.accent }, ...habits.map(h => ({ id:`habit:${h.id}`, name:h.name, emoji:h.emoji, color:h.color })), ...goals.map(g => ({ id:`goal:${g.id}`, name:g.name, emoji:g.emoji, color:g.color }))].map(f => (
          <button key={f.id} type="button" onClick={() => { setFilter(f.id); setSelectedDay(null); }}
            style={{ padding:"5px 12px", borderRadius:20, whiteSpace:"nowrap", flexShrink:0,
              border:`0.5px solid ${filter === f.id ? f.color : T.borderStrong}`,
              background:filter === f.id ? f.color + "22" : "none",
              color:filter === f.id ? f.color : T.muted,
              fontSize:12, fontWeight:filter === f.id ? 500 : 400, cursor:"pointer" }}>
            {f.emoji ? `${f.emoji} ${f.name}` : f.name}
          </button>
        ))}
      </div>

      {viewMode === "month" && !isPro && (
        <div style={{ position:"relative", margin:"0 14px 16px", borderRadius:T.r, overflow:"hidden" }}>
          {/* Blurred skeleton calendar */}
          <div style={{ filter:"blur(5px)", pointerEvents:"none", userSelect:"none", opacity:0.4, padding:"16px 0" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {Array.from({length:35}).map((_, i) => (
                <div key={i} style={{ aspectRatio:"1", borderRadius:8, background:T.surface, border:`1px solid ${T.border}` }}/>
              ))}
            </div>
          </div>
          {/* Lock overlay */}
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, padding:"0 24px", textAlign:"center", background:"rgba(14,14,14,0.80)", backdropFilter:"blur(2px)", borderRadius:T.r }}>
            <div style={{ fontSize:22 }}>🔒</div>
            <div style={{ fontSize:14, fontWeight:500, color:T.text }}>Calendar view is a beta feature</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>Core logging is free. Full history and calendar are part of beta access.</div>
            <button onClick={onUpgrade}
              style={{ marginTop:6, padding:"10px 22px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>
              Unlock beta access →
            </button>
          </div>
        </div>
      )}

      {viewMode === "month" && isPro && (
        <div style={{ padding:"0 14px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <button type="button" onClick={() => { setMonthOffset(o => o + 1); setSelectedDay(null); }}
              style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:20, padding:"4px 8px" }}>‹</button>
            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text }}>{monthLabel}</div>
            <button type="button" onClick={() => { setMonthOffset(o => Math.max(0, o - 1)); setSelectedDay(null); }}
              disabled={monthOffset === 0}
              style={{ background:"none", border:"none", color:monthOffset === 0 ? T.hint : T.muted, cursor:monthOffset === 0 ? "default" : "pointer", fontSize:20, padding:"4px 8px" }}>›</button>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
            {["M","T","W","T","F","S","S"].map((d, i) => (
              <div key={i} style={{ textAlign:"center", fontSize:10, color:T.hint, fontWeight:500 }}>{d}</div>
            ))}
          </div>

          <div style={{ fontSize:10, color:T.hint, marginBottom:8, display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
            <span>● logged</span>
            <span style={{ color:"rgba(230,126,34,0.9)", fontWeight:600 }}>? no log</span>
            <span style={{ color:T.amber, fontWeight:600 }}>✕ missed</span>
            <span style={{ color:T.muted, fontWeight:500 }}>✓ missed + noted</span>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:16 }}>
            {Array.from({ length:startPad }, (_, i) => <div key={`pad-${i}`}/>)}
            {Array.from({ length:daysInMonth }, (_, i) => {
              const day = i + 1;
              const ds = dayStr(day);
              const hasEntries = !!entryDays[day];
              const isToday = ds === tStr;
              const isSelected = selectedDay === day;
              const isJourneyStart = firstLogDate === ds;
              const isMissed = Object.prototype.hasOwnProperty.call(missedMap, ds);
              const missedNeedsNote = isMissed && missedDayNeedsNote(missedMap, ds);
              const canMarkMissed = !!(firstLogDate && ds >= firstLogDate && ds < tStr && !hasEntries);
              const isOpenDay = canMarkMissed && !isMissed;
              const habitColors = hasEntries ? [...new Set(entryDays[day].map(e => e.habitColor))].slice(0, 3) : [];
              const clickable = hasEntries || isJourneyStart || isMissed || canMarkMissed;
              let border = T.border;
              if (isSelected) border = T.accent;
              else if (isJourneyStart) border = T.gold;
              else if (isMissed) border = "rgba(230,126,34,0.45)";
              else if (isOpenDay) border = T.borderMid;
              else if (isToday) border = T.borderMid;
              return (
                <button key={day} type="button"
                  onClick={() => clickable && setSelectedDay(isSelected ? null : day)}
                  style={{
                    aspectRatio:"1", borderRadius:8,
                    border:`1px ${isOpenDay ? "dashed" : "solid"} ${border}`,
                    background:isSelected ? "rgba(192,57,43,0.15)" : isJourneyStart && !hasEntries ? "rgba(200,144,42,0.08)" : isMissed ? "rgba(230,126,34,0.06)" : isToday ? T.surface : T.raised,
                    cursor:clickable ? "pointer" : "default",
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2,
                    padding:2, transition:"all 0.15s",
                  }}>
                  <span style={{
                    fontSize:11,
                    color:isToday ? T.accent : isJourneyStart ? T.gold : hasEntries ? T.text : isMissed ? (missedNeedsNote ? T.amber : T.muted) : T.muted,
                    fontWeight:isToday || isJourneyStart || (isMissed && missedNeedsNote) ? 500 : 400,
                  }}>{day}</span>
                  {hasEntries ? (
                    <div style={{ display:"flex", gap:2 }}>
                      {habitColors.map((c, ci) => <div key={ci} style={{ width:4, height:4, borderRadius:"50%", background:c }}/>)}
                    </div>
                  ) : isMissed ? (
                    missedNeedsNote ? (
                      <div title="Missed — add a note" style={{ fontSize:10, fontWeight:800, color:T.amber, width:16, height:16, borderRadius:"50%", background:"rgba(230,126,34,0.28)", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>?</div>
                    ) : (
                      <div title="Missed (noted)" style={{ fontSize:9, fontWeight:700, color:T.muted, width:15, height:15, borderRadius:"50%", background:"rgba(106,104,96,0.2)", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>✓</div>
                    )
                  ) : isJourneyStart ? (
                    <div style={{ fontSize:7, color:T.gold }}>✦</div>
                  ) : isOpenDay ? (
                    <div title="No logs — select to mark missed" style={{ fontSize:11, fontWeight:700, color:"rgba(230,126,34,0.88)", lineHeight:1 }}>?</div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {selectedDay && (() => {
            const selDs = dayStr(selectedDay);
            const selHabits = Object.values(allByDate[selDs] || {});
            const hasSelEntries = selHabits.length > 0;
            const showMissedEditor = !hasSelEntries && firstLogDate && selDs >= firstLogDate && selDs < tStr;
            return (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                  {MONTHS[viewMonth]} {selectedDay}
                </div>
                {firstLogDate && selDs === firstLogDate && (
                  <div style={{ margin:"0 0 8px", padding:"10px 14px", background:"rgba(200,144,42,0.08)", borderRadius:T.rsm, border:"0.5px solid rgba(200,144,42,0.25)", display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:14 }}>✦</span>
                    <span style={{ fontSize:12, color:T.gold, fontWeight:500 }}>Day one — this is where your journey began.</span>
                  </div>
                )}
                {hasSelEntries ? (
                  selHabits.map(({ habit, logs, entryKey }) => (
                    <HabitDayCard key={entryKey || habit.id} habit={habit} logs={logs} onReflect={onReflect} onDeleteLogEntry={onDeleteJournalLog}/>
                  ))
                ) : (
                  <div style={{ padding:"0 0 8px" }}>
                    {showMissedEditor ? (
                      <div style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}` }}>
                        <div style={{ fontSize:12, color:T.muted, marginBottom:6, lineHeight:1.5 }}>
                          <span style={{ fontSize:14, fontWeight:700, color:"rgba(230,126,34,0.95)", marginRight:6 }}>?</span>
                          Nothing logged this day. Mark it <strong style={{ color:T.text }}>missed</strong> if you skipped forging, and add a short note (travel, sick day…). Clear later if you catch up on Today.
                        </div>
                        <textarea
                          value={monthMissedDraft}
                          onChange={e => setMonthMissedDraft(e.target.value)}
                          placeholder="Optional note (e.g. sick, travel…)"
                          rows={2}
                          style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font }}
                        />
                        <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                          <button type="button" onClick={() => { setMissed(selDs, monthMissedDraft.trim()); }}
                            style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:T.amber, color:"#1a1208", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                            Mark missed
                          </button>
                          {Object.prototype.hasOwnProperty.call(missedMap, selDs) ? (
                            <button type="button" onClick={() => { clearMissed(selDs); setMonthMissedDraft(""); }}
                              style={{ padding:"8px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>
                              Clear mark
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding:"20px 0", textAlign:"center", color:T.muted, fontSize:13 }}>No entries (future or before you started)</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

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

      {viewMode === "day" && (
        <>
          {listEmpty && (
            <div style={{ padding:"60px 30px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:14 }}>📓</div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>No entries yet. Log on Today, or open <strong style={{ color:T.text }}>Month</strong> — days with a <strong style={{ color:"rgba(230,126,34,0.95)" }}>?</strong> have no logs and can be marked missed.</div>
            </div>
          )}
          {!listEmpty && sortedDatesDesc.map(date => renderDayOrMissed(date))}
        </>
      )}

      {viewMode === "week" && (
        <>
          {listEmpty && (
            <div style={{ padding:"60px 30px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:14 }}>📓</div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>Nothing to group by week yet.</div>
            </div>
          )}
          {!listEmpty && weekKeysDesc.map(ws => {
            const daysInWeek = sortedDatesDesc
              .filter(d => weekStartFor(d) === ws)
              .sort((a, b) => b.localeCompare(a));
            const expanded = openWeeks.has(ws);
            const missedNeedNoteInWeek = daysInWeek.filter(d => missedDayNeedsNote(missedMap, d)).length;
            const missedMarkedInWeek = daysInWeek.filter(d => Object.prototype.hasOwnProperty.call(missedMap, d)).length;
            const openDaysInWeek = daysInWeek.filter(d => {
              const hasLog = allByDate[d] && Object.keys(allByDate[d]).length > 0;
              return !!(firstLogDate && d >= firstLogDate && d < tStr && !hasLog && !Object.prototype.hasOwnProperty.call(missedMap, d));
            }).length;
            return (
              <div key={ws} style={{ margin:"0 14px 8px", borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden", background:T.raised }}>
                <button
                  type="button"
                  onClick={() => toggleWeek(ws)}
                  style={{
                    width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"12px 14px", background:T.surface, border:"none", cursor:"pointer", gap:10,
                  }}>
                  <span style={{ fontSize:12, fontWeight:600, color:T.text, textAlign:"left", lineHeight:1.35 }}>
                    Week · {fmtWeekRange(ws)}
                    <span style={{ fontWeight:400, color:T.muted, marginLeft:8 }}>({daysInWeek.length})</span>
                    {missedNeedNoteInWeek > 0 ? (
                      <span style={{ display:"block", fontSize:10, fontWeight:600, color:T.amber, marginTop:3 }}>? {missedNeedNoteInWeek} missed day{missedNeedNoteInWeek !== 1 ? "s" : ""} need a note · expand below</span>
                    ) : null}
                    {missedNeedNoteInWeek === 0 && missedMarkedInWeek > 0 ? (
                      <span style={{ display:"block", fontSize:10, fontWeight:500, color:T.muted, marginTop:3 }}>{missedMarkedInWeek} marked missed (noted)</span>
                    ) : null}
                    {missedMarkedInWeek === 0 && openDaysInWeek > 0 ? (
                      <span style={{ display:"block", fontSize:10, fontWeight:500, color:"rgba(230,126,34,0.75)", marginTop:3 }}>? {openDaysInWeek} day{openDaysInWeek !== 1 ? "s" : ""} with no log — check Month or Today</span>
                    ) : null}
                  </span>
                  <span style={{ fontSize:12, color:T.hint, flexShrink:0 }}>{expanded ? "▾" : "▸"}</span>
                </button>
                {expanded ? (
                  <div style={{ padding:"4px 0 10px" }}>
                    {daysInWeek.map(date => renderDayOrMissed(date))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      )}

      {missedEditDate && (
        <div style={{ margin:"0 14px 24px", padding:14, background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:12, color:T.text, marginBottom:8 }}><span style={{ color:T.amber, fontWeight:700, marginRight:6 }}>?</span>Missed · {fmtEntryDate(missedEditDate)}</div>
          <textarea
            value={missedNoteDraft}
            onChange={e => setMissedNoteDraft(e.target.value)}
            placeholder="Optional note"
            rows={3}
            style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font }}
          />
          <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
            <button type="button" onClick={() => { setMissed(missedEditDate, missedNoteDraft.trim()); setMissedEditDate(null); }}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:T.amber, color:"#1a1208", fontSize:12, fontWeight:600, cursor:"pointer" }}>Save</button>
            <button type="button" onClick={() => setMissedEditDate(null)}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>Cancel</button>
            <button type="button" onClick={() => { clearMissed(missedEditDate); setMissedEditDate(null); }}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:"none", color:T.hint, fontSize:12, cursor:"pointer" }}>Clear mark</button>
          </div>
        </div>
      )}

      <div style={{ height:20 }}/>
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
function InsightsScreen({ habits, goals = [], onShowHistory, onShare }) {
  function IC({ title, children, action, dataTour }) {
    return (
      <div data-tour={dataTour} style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:18 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>{title}</div>
          {action}
        </div>
        {children}
      </div>
    );
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const habitRealLogs = habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip"));
  const goalRealLogs = goals.flatMap(g => (g.logs || []).filter(l => typeof l.value === "number"));
  const allRealLogs = [...habitRealLogs, ...goalRealLogs];
  const totalDaysLogged = new Set(allRealLogs.map(l => l.date)).size;
  const allLogDates = habits.flatMap(h => h.logs.map(l => l.date)).filter(Boolean).sort();
  const firstLogDate = allLogDates[0] || null;
  const firstLogLabel = firstLogDate
    ? `${MONTHS[parseInt(firstLogDate.split("-")[1])-1]} ${firstLogDate.split("-")[0]}`
    : null;
  const longestBestStreak = habits.reduce((best, h) => Math.max(best, getBestStreak(h)), 0);
  const totalLogsEver = allRealLogs.length;
  const totalTracked = habits.length + goals.length;

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
      <div data-tour="insights-stats" style={{ margin:"0 14px 12px", display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
        <Stat label="tracked" value={totalTracked}/>
        <Stat label="days logged" value={totalDaysLogged} color={T.text}/>
        <Stat label="best streak" value={longestBestStreak > 0 ? `🔥${longestBestStreak}` : "—"} color={T.gold}/>
        <Stat label="total logs" value={totalLogsEver}/>
      </div>

      {/* Streaks */}
      <IC dataTour="insights-streaks" title="Streaks" action={<button onClick={onShowHistory} style={{ fontSize:12, color:T.accent, background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Full history →</button>}>
        {[...habits].sort((a, b) => getStreak(b) - getStreak(a)).map(h => {
          const cur  = getStreak(h);
          const best = getBestStreak(h);
          const act  = get7DayActivity(h);
          const hasAnyLogs = h.logs.some(l => l.value !== "quicknote");
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
                <div style={{ fontSize:16, fontWeight:600, color:hasAnyLogs ? (cur > 0 ? h.color : T.muted) : T.hint }}>
                  {hasAnyLogs ? (cur > 0 ? `🔥 ${cur}` : "0") : "—"}
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
          How often you hit your target. Daily = out of 28 days. Weekly = 4 weeks at target.
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
                    <span style={{ fontSize:10, color:h.color+"99", flexShrink:0, width:80, marginTop:2, fontWeight:500 }}>{fmtEntryDate(l.date)}</span>
                    <span title={l.value.win} style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>{truncateText(l.value.win, 120)}</span>
                  </div>
                ))}
              </>
            )}
          </IC>
        );
      })}

      {/* Goals */}
      {goals.filter(g => g.status !== "completed").map(g => {
        const stats = getGoalProgress(g);
        const { isComplete } = stats;
        const barFillPct = goalBarFillWidthPct(stats);
        const logs = [...g.logs].filter(l => typeof l.value === "number").sort((a, b) => a.date.localeCompare(b.date));
        const logsByDay = Array.from(new Map(logs.map(l => [l.date, l])).values());
        const recentMeasurements = logsByDay.slice(-6).reverse();
        const statusText = getGoalStatusText(g, stats);
        return (
          <IC key={g.id} title={`${g.emoji} ${g.name} — goal`}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:13, color:T.muted }}>Current: <strong style={{ color:g.color }}>{formatWithUnit(g.currentValue, g.unit)}</strong></span>
              <span style={{ fontSize:13, color:T.muted }}>Target: <strong style={{ color:T.text }}>{formatWithUnit(g.targetValue, g.unit)}</strong></span>
            </div>
            <div style={{ height:8, background:T.surface, borderRadius:4, overflow:"hidden", marginBottom:6 }}>
              <div style={{ height:"100%", borderRadius:4, background:isComplete ? T.goldBright : g.color, width:`${barFillPct}%`, transition:"width 0.5s ease" }}/>
            </div>
            <div style={{ fontSize:11, color:isComplete ? T.gold : T.muted, marginBottom:16, textAlign:"center" }}>{statusText}</div>
            {logs.length > 0 && (
              <>
                <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Recent measurements</div>
                {recentMeasurements.map((l, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderTop:`0.5px solid ${T.border}` }}>
                    <span style={{ fontSize:11, color:g.color+"99", fontWeight:500 }}>{fmtEntryDate(l.date)}</span>
                    <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                      <span style={{ fontSize:15, color:T.text, fontWeight:500 }}>{l.value}</span>
                      <span style={{ fontSize:11, color:T.muted }}>{g.unit}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </IC>
        );
      })}

      <div style={{ height:20 }}/>
    </div>
  );
}

// ─── GOAL HELPERS ─────────────────────────────────────────────────────────────
function getGoalProgress(goal) {
  const start = Number(goal.startValue);
  const target = Number(goal.targetValue);
  const current = Number(goal.currentValue);
  if (!Number.isFinite(target) || !Number.isFinite(current)) {
    return { pct: 0, toGo: 0, isComplete: false };
  }
  const hasStartBaseline = Number.isFinite(start) && start > 0;
  let raw = 0;
  if (hasStartBaseline) {
    const denom = target - start;
    raw = denom === 0 ? 0 : (current - start) / denom;
  } else {
    raw = target === 0 ? 0 : current / target;
  }
  const progress = Math.max(0, Math.min(1, raw));
  const isComplete = progress >= 1;
  const toGo = isComplete ? 0 : Math.max(0, Math.abs(target - current));
  return { pct: Math.round(progress * 100), toGo, isComplete };
}

/** Goal bar fill width only — label text still uses real `pct`. */
function goalBarFillWidthPct(stats) {
  if (stats.isComplete) return 100;
  return Math.max(stats.pct, 9);
}

/** Recompute goal fields after removing log rows (current value = last numeric log, or start). */
function goalStateAfterLogRemoval(goal, nextLogs) {
  const numericLogs = nextLogs.filter(l => typeof l.value === "number");
  const currentValue = numericLogs.length > 0
    ? numericLogs[numericLogs.length - 1].value
    : Number(goal.startValue ?? 0);
  const lastLogDate = nextLogs.length > 0
    ? [...nextLogs].sort((a, b) => b.date.localeCompare(a.date))[0].date
    : null;
  const stats = getGoalProgress({ ...goal, currentValue, logs: nextLogs });
  const status = stats.isComplete ? "completed" : "active";
  return { ...goal, logs: nextLogs, currentValue, lastLogDate, status };
}

function getGoalEntryCount(goal) {
  return (goal.logs || []).filter(l => typeof l.value === "number").length;
}

function getGoalStatusText(goal, stats = getGoalProgress(goal)) {
  if (stats.isComplete) return "🎉 Goal reached";
  const start = Number(goal.startValue ?? 0);
  const current = Number(goal.currentValue ?? 0);
  const target = Number(goal.targetValue ?? 0);
  const direction = target < start ? "decreasing" : "increasing";
  const isWrongDirection = direction === "increasing" ? current < start : current > start;
  if (isWrongDirection) {
    const awayFromStart = Math.abs(start - current);
    return `${formatWithUnit(awayFromStart, goal.unit)} ${direction === "increasing" ? "below" : "above"} start · ${formatWithUnit(stats.toGo, goal.unit)} to target`;
  }
  return `${stats.pct}% there · ${formatWithUnit(stats.toGo, goal.unit)} to go`;
}

// ─── LOG GOAL MODAL ───────────────────────────────────────────────────────────
function LogGoalModal({ goal, onClose, onLog }) {
  const [val,  setVal]  = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:4 }}>{goal.emoji} {goal.name}</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:22 }}>
        Now: <strong style={{ color:goal.color }}>{goal.currentValue}{goal.unit}</strong>
        {" → "}Goal: <strong style={{ color:T.text }}>{goal.targetValue}{goal.unit}</strong>
      </div>
      <FG label={`Current ${goal.unit || "value"}`}>
        <input style={inp} type="number" step="any" placeholder={`e.g. ${goal.currentValue}`}
          value={val} onChange={e => setVal(e.target.value)} autoFocus/>
      </FG>
      <FG label="Note (optional)" mb={0}>
        <input style={inp} placeholder="Optional note" value={note} onChange={e => setNote(e.target.value)} maxLength={140}/>
      </FG>
      <PBtn onClick={() => { if (!val) return; onLog(goal.id, parseFloat(val), note); onClose(); }}>Log it</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── ADD GOAL MODAL ───────────────────────────────────────────────────────────
function AddGoalModal({ onClose, onSave }) {
  const [name,       setName]       = useState("");
  const [emoji,      setEmoji]      = useState("");
  const [unit,       setUnit]       = useState("");
  const [startVal,   setStartVal]   = useState("");
  const [targetVal,  setTargetVal]  = useState("");
  const [targetDate, setTargetDate] = useState("");

  const start  = parseFloat(startVal);
  const target = parseFloat(targetVal);
  const hasValues = !isNaN(start) && !isNaN(target) && start !== target;
  const direction = hasValues && target < start ? "decreasing" : "increasing";
  const canSave = name.trim() && hasValues;

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:4 }}>Set a goal</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:14, lineHeight:1.55 }}>
        A <strong style={{ color:T.text }}>goal</strong> is an outcome with a start and target number (you log how close you are). <strong style={{ color:T.text }}>Habits</strong> are repeated actions (daily tap, weekly sessions, build time, or staying under a limit).
      </div>
      <div style={{ marginBottom:20, padding:"12px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}` }}>
        <div style={{ fontSize:10, fontWeight:600, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Examples</div>
        <ul style={{ margin:0, paddingLeft:18, fontSize:12, color:T.muted, lineHeight:1.65 }}>
          <li>Weight: 92 kg → 85 kg (log weigh-ins toward the target)</li>
          <li>Savings: $0 → $5,000 emergency fund</li>
          <li>Strength: squat 1RM 225 → 275 lb</li>
          <li>Body fat %, race time, or any number you want to reach by a date</li>
        </ul>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Goal name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lose weight" maxLength={40} autoFocus/>
        </div>
        <div>
          <label style={lbl}>Emoji</label>
          <input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🎯" maxLength={2}/>
        </div>
      </div>

      <FG label="What are you tracking? (unit)">
        <input style={inp} value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. kg, $, km, hours" maxLength={20}/>
      </FG>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Starting value</label>
          <input style={inp} type="number" step="any" value={startVal} onChange={e => setStartVal(e.target.value)} placeholder="74.5"/>
        </div>
        <div style={{ flex:1 }}>
          <label style={lbl}>Target value</label>
          <input style={inp} type="number" step="any" value={targetVal} onChange={e => setTargetVal(e.target.value)} placeholder="80"/>
        </div>
      </div>

      {hasValues && (
        <div style={{ marginBottom:20, padding:"10px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, fontSize:12, color:T.muted }}>
          Direction inferred: <strong style={{ color:T.text }}>{direction === "decreasing" ? "↓ decreasing" : "↑ increasing"}</strong>
          {unit ? ` (${start}${unit} → ${target}${unit})` : ""}
        </div>
      )}

      <FG label="Target date (optional)" mb={20}>
        <input style={inp} type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}/>
      </FG>

      <PBtn onClick={() => {
        if (!canSave) return;
        onSave({
          id: String(Date.now()),
          name: name.trim(),
          emoji: emoji || "🎯",
          unit: unit.trim(),
          startValue: start,
          targetValue: target,
          currentValue: start,
          direction,
          targetDate: targetDate || null,
          status: "active",
          logs: [],
          color: "#E67E22",
        });
        onClose();
      }}>Set goal</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── EDIT GOAL MODAL ───────────────────────────────────────────────────────────
function EditGoalModal({ goal, onClose, onSave }) {
  const [name,       setName]       = useState(goal.name || "");
  const [emoji,      setEmoji]      = useState(goal.emoji || "");
  const [unit,       setUnit]       = useState(goal.unit || "");
  const [startVal,   setStartVal]   = useState(String(goal.startValue ?? ""));
  const [targetVal,  setTargetVal]  = useState(String(goal.targetValue ?? ""));
  const [currentVal, setCurrentVal] = useState(String(goal.currentValue ?? ""));
  const [targetDate, setTargetDate] = useState(goal.targetDate || "");
  const [color,      setColor]      = useState(goal.color || "#E67E22");

  const start = parseFloat(startVal);
  const target = parseFloat(targetVal);
  const current = parseFloat(currentVal);
  const hasCore = Number.isFinite(start) && Number.isFinite(target) && start !== target;
  const hasCurrent = Number.isFinite(current);
  const canSave = name.trim() && hasCore && hasCurrent;
  const direction = hasCore && target < start ? "decreasing" : "increasing";

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:4 }}>Edit goal</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:22 }}>Update values and targeting for this goal.</div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Goal name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gain weight" maxLength={40} autoFocus/>
        </div>
        <div>
          <label style={lbl}>Emoji</label>
          <input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🎯" maxLength={2}/>
        </div>
      </div>

      <FG label="What are you tracking? (unit)">
        <input style={inp} value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. kg, $, km, hours" maxLength={20}/>
      </FG>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Starting value</label>
          <input style={inp} type="number" step="any" value={startVal} onChange={e => setStartVal(e.target.value)} placeholder="74.5"/>
        </div>
        <div style={{ flex:1 }}>
          <label style={lbl}>Target value</label>
          <input style={inp} type="number" step="any" value={targetVal} onChange={e => setTargetVal(e.target.value)} placeholder="80"/>
        </div>
      </div>

      <FG label={`Current ${unit || "value"}`}>
        <input style={inp} type="number" step="any" value={currentVal} onChange={e => setCurrentVal(e.target.value)} placeholder={`e.g. ${goal.currentValue}`}/>
      </FG>

      {hasCore && (
        <div style={{ marginBottom:20, padding:"10px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, fontSize:12, color:T.muted }}>
          Direction inferred: <strong style={{ color:T.text }}>{direction === "decreasing" ? "↓ decreasing" : "↑ increasing"}</strong>
          {unit ? ` (${start}${unit} → ${target}${unit})` : ""}
        </div>
      )}

      <FG label="Target date (optional)" mb={20}>
        <input style={inp} type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}/>
      </FG>

      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Color</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2.5px solid ${c}`:"none", outlineOffset:2 }}/>)}
        </div>
      </div>

      <PBtn onClick={() => {
        if (!canSave) return;
        onSave(goal.id, {
          name: name.trim(),
          emoji: emoji || "🎯",
          unit: unit.trim(),
          startValue: start,
          targetValue: target,
          currentValue: current,
          direction,
          targetDate: targetDate || null,
          color,
          status: getGoalProgress({ ...goal, startValue: start, targetValue: target, currentValue: current, direction }).isComplete ? "completed" : "active",
        });
        onClose();
      }}>Save goal</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── ADD ACTION SHEET ─────────────────────────────────────────────────────────
function AddActionSheet({ onAddHabit, onAddGoal, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"20px 20px 0 0", padding:"20px 16px 40px" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }}/>
        <button onClick={onAddHabit} style={{ display:"flex", alignItems:"center", gap:14, width:"100%", padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:10, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22 }}>⚒️</span>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>Add a habit</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Daily check-ins, weekly targets, build habits, or limit/reduce tracking</div>
          </div>
        </button>
        <button onClick={onAddGoal} style={{ display:"flex", alignItems:"center", gap:14, width:"100%", padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:10, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22 }}>🎯</span>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>Set a goal</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Outcomes with numbers (weight, savings, PRs) — not the same as daily habits or limits</div>
          </div>
        </button>
        <button onClick={onClose} style={{ width:"100%", padding:"13px", borderRadius:T.rsm, border:"none", background:T.surface, color:T.muted, fontSize:14, cursor:"pointer", marginTop:4 }}>Cancel</button>
      </div>
    </div>
  );
}

/** Bottom sheet: edit AI coach name and preset icon. */
function CoachSettingsSheet({ onClose, onSave, initialName, initialIcon }) {
  const [nameDraft, setNameDraft] = useState((initialName ?? "").trim() || "Coach");
  const [iconDraft, setIconDraft] = useState(() => normalizeCoachIcon(initialIcon));
  useEffect(() => {
    setNameDraft((initialName ?? "").trim() || "Coach");
    setIconDraft(normalizeCoachIcon(initialIcon));
  }, [initialName, initialIcon]);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.52)", zIndex:302, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"20px 20px 0 0", padding:"22px 20px 36px", borderTop:`0.5px solid ${T.borderMid}`, boxSizing:"border-box" }}
      >
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 18px" }}/>
        <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:14 }}>AI coach</div>
        <label style={{ ...lbl, marginBottom:6 }}>Coach name</label>
        <input
          style={{ ...inp, marginBottom:18 }}
          value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          placeholder="e.g. Atlas, Sam…"
          maxLength={40}
          autoFocus
        />
        <div style={{ fontSize:10, fontWeight:500, color:T.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.07em" }}>Coach icon</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:8, marginBottom:22 }}>
          {COACH_ICON_OPTIONS.map(ic => (
            <button
              key={ic}
              type="button"
              onClick={() => setIconDraft(ic)}
              style={{
                aspectRatio:1, borderRadius:T.rsm,
                border:`0.5px solid ${iconDraft === ic ? T.gold : T.borderStrong}`,
                background: iconDraft === ic ? "rgba(200,144,42,0.14)" : T.surface,
                fontSize:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                lineHeight:1, padding:0,
              }}
            >
              {ic}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex:1, padding:13, borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:14, fontWeight:500, cursor:"pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { onSave({ name: nameDraft.trim() || "Coach", icon: iconDraft }); onClose(); }}
            style={{ flex:1, padding:13, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function CoachComingSoonSheet({ onClose, coachName, context }) {
  const trimmed = (coachName ?? "").trim();
  const displayName = trimmed.length ? trimmed : "Your coach";
  const where =
    context === "journal" ? "Journal" :
    context === "insights" ? "Insights" :
    context === "today" ? "Today" : "Forged";
  const bullet = (icon, title, body) => (
    <div style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:14 }}>
      <div style={{ width:36, height:36, borderRadius:10, background:"rgba(200,144,42,0.14)", border:`0.5px solid rgba(200,144,42,0.25)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>{icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:3 }}>{title}</div>
        <div style={{ fontSize:12, color:T.muted, lineHeight:1.55 }}>{body}</div>
      </div>
    </div>
  );
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:301, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ width:430, maxWidth:"100vw", background:`linear-gradient(180deg, rgba(200,144,42,0.14) 0%, ${T.raised} 52px)`, borderRadius:"20px 20px 0 0", padding:"18px 20px 34px", borderTop:`0.5px solid rgba(200,144,42,0.35)`, boxSizing:"border-box" }}
      >
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 16px" }}/>
        <div style={{ textAlign:"center", marginBottom:6 }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:"0.12em", textTransform:"uppercase", color:T.gold }}>Coming soon</span>
        </div>
        <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, textAlign:"center", marginBottom:8, letterSpacing:"-0.02em", lineHeight:1.2 }}>
          Meet <span style={{ color:T.gold }}>{displayName}</span> — your voice and text forge partner
        </div>
        <p style={{ fontSize:14, color:T.sub, lineHeight:1.55, textAlign:"center", margin:"0 4px 18px" }}>
          {"This is the big unlock: a coach that actually knows your habits, goals, and logs. We're building it so Forged feels effortless — starting from "}{where}{"."}
        </p>
        <div style={{ margin:"0 0 20px", padding:"14px 14px 4px", borderRadius:T.r, border:`0.5px solid ${T.border}`, background:"rgba(0,0,0,0.12)" }}>
          {bullet("🎯", "Goals without the friction", "Brainstorm targets, break them into steps, and keep them honest — conversationally.")}
          {bullet("🎙️", "Talk or type", "Voice when you’re on the move, text when you’re focused. Same coach, same context.")}
          {bullet("⚡", "Log & fill the day faster", "Quick check-ins so updating habits doesn’t feel like another chore.")}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ width:"100%", padding:14, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer", boxShadow:"0 4px 18px rgba(192,57,43,0.35)" }}
        >
          {"Got it — I'm ready"}
        </button>
      </div>
    </div>
  );
}

// ─── SOCIAL / FORGE PRO TEASER (replaces former Habits tab) ───────────────────
function SocialTeaserCard({ emoji, title, children }) {
  return (
    <div className="rc" style={{ margin:"0 14px 10px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden", padding:"16px 16px 15px" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
        <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:"rgba(200,144,42,0.12)", border:`0.5px solid rgba(200,144,42,0.22)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{emoji}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:600, color:T.text, letterSpacing:"-0.01em", marginBottom:6 }}>{title}</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function SocialScreen({ user, xp, habits, friends, friendRequests, sentRequests, friendsLoading, onSendRequest, onAccept, onDecline, onRemoveFriend, onCancelSentRequest, sharedGoals, sharedGoalsLoading, onCreateSharedGoal, onJoinSharedGoal, onLogSharedGoal, onShareHabit, currentUserId, onDeleteSharedGoal, onNudgeFriend }) {
  const [showAddFriend,   setShowAddFriend]   = useState(false);
  const [addEmail,        setAddEmail]        = useState("");
  const [addError,        setAddError]        = useState("");
  const [addLoading,      setAddLoading]      = useState(false);
  const [addDone,         setAddDone]         = useState(false);
  const [showNewGoal,     setShowNewGoal]     = useState(false);
  const [showJoinGoal,    setShowJoinGoal]    = useState(false);
  const [joinCode,        setJoinCode]        = useState("");
  const [joinError,       setJoinError]       = useState("");
  const [joinLoading,     setJoinLoading]     = useState(false);
  const [goalName,        setGoalName]        = useState("");
  const [goalEmoji,       setGoalEmoji]       = useState("🎯");
  const [goalType,        setGoalType]        = useState("daily");
  const [weeklyTarget,    setWeeklyTarget]    = useState(3);
  const [createLoading,   setCreateLoading]   = useState(false);
  const [copiedId,        setCopiedId]        = useState(null);
  const [sharedGoalDeleteId, setSharedGoalDeleteId] = useState(null);
  const [deleteSharedLoading, setDeleteSharedLoading] = useState(false);
  const [selectedFriend,  setSelectedFriend]  = useState(null);
  const [nudgedToday,     setNudgedToday]     = useState(() => new Set());
  const [nudgeSending,    setNudgeSending]    = useState(false);

  const today = todayStr();
  const myStreak = habits.length ? Math.max(0, ...habits.map(h => h.streak || 0)) : 0;
  const myLoggedToday = habits.filter(h => (h.logs||[]).some(l => l.date === today)).length;

  const card = { background: T.raised, border: `0.5px solid ${T.border}`, borderRadius: T.r, padding: "14px 16px", marginBottom: 10 };
  const sectionLabel = { fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 };

  async function handleSendRequest() {
    if (!addEmail.trim()) return;
    setAddLoading(true); setAddError("");
    const res = await onSendRequest(addEmail.trim());
    setAddLoading(false);
    if (res?.error) { setAddError(res.error); }
    else { setAddDone(true); setAddEmail(""); setTimeout(() => { setAddDone(false); setShowAddFriend(false); }, 2200); }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return;
    setJoinLoading(true); setJoinError("");
    let code = joinCode.trim();
    const fromUrl = code.match(/\/join\/([^/?#]+)/i);
    if (fromUrl) code = fromUrl[1];
    const res = await onJoinSharedGoal(code);
    setJoinLoading(false);
    if (res?.error) { setJoinError(res.error); }
    else { setJoinCode(""); setShowJoinGoal(false); }
  }

  async function handleCreate() {
    if (!goalName.trim() || createLoading) return;
    setCreateLoading(true);
    try {
      const created = await onCreateSharedGoal({
        name: goalName,
        emoji: goalEmoji,
        habitType: goalType,
        weeklyTarget: goalType === "weekly" ? Math.min(7, Math.max(1, Number(weeklyTarget) || 3)) : undefined,
      });
      if (created === undefined) return;
      if (!created) return;
      setGoalName(""); setGoalEmoji("🎯"); setGoalType("daily"); setWeeklyTarget(3);
      setShowNewGoal(false);
    } finally {
      setCreateLoading(false);
    }
  }

  function copyInviteLink(goal) {
    const url = `${window.location.origin}/join/${goal.inviteCode}`;
    if (navigator.share) {
      navigator.share({ title: `Join "${goal.name}" on Forged`, url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url).then(() => {
        setCopiedId(goal.id);
        setTimeout(() => setCopiedId(null), 2000);
      });
    }
  }

  function Avatar({ name, avatarUrl, size = 32 }) {
    if (avatarUrl && !avatarUrl.startsWith("http")) {
      return <div style={{ width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.55, background: T.surface, flexShrink: 0 }}>{avatarUrl}</div>;
    }
    if (avatarUrl) {
      return <img src={avatarUrl} alt={name} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
    }
    const initials = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    return <div style={{ width: size, height: size, borderRadius: "50%", background: "rgba(200,144,42,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, color: T.gold, flexShrink: 0 }}>{initials}</div>;
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* ── Your card ── */}
      <div style={{ margin: "0 0 20px", padding: "16px", background: `linear-gradient(135deg, rgba(200,144,42,0.12) 0%, ${T.surface} 100%)`, border: `0.5px solid rgba(200,144,42,0.28)`, borderRadius: T.r }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={40} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{user?.name || "You"}</div>
            <div style={{ fontSize: 12, color: T.muted }}>Your stats</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{myStreak}</div>
            <div style={{ fontSize: 11, color: T.muted }}>🔥 streak</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{xp}</div>
            <div style={{ fontSize: 11, color: T.muted }}>⚡ xp</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: myLoggedToday > 0 ? T.green : T.muted }}>{myLoggedToday}</div>
            <div style={{ fontSize: 11, color: T.muted }}>logged today</div>
          </div>
        </div>
      </div>

      {/* ── Pending requests ── */}
      {friendRequests.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>Friend requests</div>
          {friendRequests.map(req => (
            <div key={req.friendshipId} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={req.name} avatarUrl={req.avatarUrl} size={34} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{req.name}</div>
                <div style={{ fontSize: 12, color: T.muted }}>wants to be friends</div>
              </div>
              <button onClick={() => onAccept(req.friendshipId)} style={{ padding: "6px 12px", borderRadius: 16, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 6 }}>Accept</button>
              <button onClick={() => onDecline(req.friendshipId)} style={{ padding: "6px 10px", borderRadius: 16, border: `0.5px solid ${T.border}`, background: "none", color: T.muted, fontSize: 12, cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {sentRequests.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>Sent requests</div>
          {sentRequests.map(s => (
            <div key={s.friendshipId} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={s.name} avatarUrl={s.avatarUrl} size={34} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: T.muted }}>Request sent · pending</div>
              </div>
              <button
                type="button"
                onClick={() => onCancelSentRequest(s.friendshipId)}
                style={{ padding: "5px 10px", borderRadius: T.rsm, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Friends leaderboard ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={sectionLabel}>Friends</div>
          <button onClick={() => { setShowAddFriend(s => !s); setAddError(""); setAddEmail(""); setAddDone(false); }}
            style={{ padding: "5px 12px", borderRadius: 16, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.gold, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            + Add friend
          </button>
        </div>

        {showAddFriend && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6 }}>Add a friend</div>
            <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55, marginBottom: 10 }}>
              Enter the <strong style={{ color: T.text }}>email they use for Forged</strong> or their <strong style={{ color: T.text }}>@username</strong> (if they set one in Profile → Social).
              They’ll get a request here — once they accept, you’ll see each other on this leaderboard.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="friend@email.com or @username"
                autoComplete="off"
                value={addEmail}
                onChange={e => { setAddEmail(e.target.value); setAddError(""); }}
                onKeyDown={e => e.key === "Enter" && handleSendRequest()}
                style={{ flex: 1, background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "9px 12px", fontSize: 14, color: T.text, outline: "none" }}
              />
              <button type="button" onClick={handleSendRequest} disabled={addLoading || !addEmail.trim()}
                style={{ padding: "9px 14px", borderRadius: T.rsm, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (!addEmail.trim() || addLoading) ? 0.6 : 1 }}>
                {addLoading ? "…" : addDone ? "✓ Sent!" : "Send request"}
              </button>
            </div>
            {addError && <div style={{ fontSize: 12, color: "#e05c5c", marginTop: 6 }}>{addError}</div>}
            {addDone && !addError && <div style={{ fontSize: 12, color: T.green, marginTop: 6 }}>Request sent. They’ll see it under Friend requests.</div>}
          </div>
        )}

        {friendsLoading ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: T.muted, fontSize: 13 }}>Loading…</div>
        ) : friends.length === 0 ? (
          <div style={{ ...card, textAlign: "center", padding: "24px 16px", color: T.muted, fontSize: 13 }}>
            No friends yet. Add someone to start the leaderboard.
          </div>
        ) : (
          friends.map((f, i) => (
            <div key={f.id} onClick={() => setSelectedFriend(f)}
              style={{ ...card, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? T.gold : T.muted, width: 18, textAlign: "center" }}>{i + 1}</div>
              <Avatar name={f.name} avatarUrl={f.avatarUrl} size={34} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{f.name}</div>
                <div style={{ fontSize: 12, color: T.muted }}>⚡ {f.xp} xp{f.streak > 0 ? ` · 🔥 ${f.streak}` : ""}</div>
              </div>
              <div style={{ textAlign: "center", marginRight: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: f.loggedToday ? T.green : T.muted }}>
                  {f.loggedToday ? "✓" : "—"}
                </div>
                <div style={{ fontSize: 10, color: T.hint }}>today</div>
              </div>
              <div style={{ color: T.hint, fontSize: 14, flexShrink: 0 }}>›</div>
            </div>
          ))
        )}
      </div>

      {/* ── Shared goals ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={sectionLabel}>Shared goals</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setShowJoinGoal(s => !s); setJoinError(""); setJoinCode(""); }}
              style={{ padding: "5px 11px", borderRadius: 16, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.sub, fontSize: 12, cursor: "pointer" }}>
              Join
            </button>
            <button onClick={() => setShowNewGoal(s => !s)}
              style={{ padding: "5px 12px", borderRadius: 16, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.gold, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              + New
            </button>
          </div>
        </div>

        {showJoinGoal && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55, marginBottom: 8 }}>
              Paste the 8-character code or the full invite link — either works.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                placeholder="e.g. ab3f9c2d" value={joinCode}
                onChange={e => { setJoinCode(e.target.value); setJoinError(""); }}
                onKeyDown={e => e.key === "Enter" && handleJoin()}
                style={{ flex: 1, background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "9px 12px", fontSize: 14, color: T.text, outline: "none" }}
              />
              <button onClick={handleJoin} disabled={joinLoading || !joinCode.trim()}
                style={{ padding: "9px 14px", borderRadius: T.rsm, border: "none", background: T.gold, color: "#0F0F0D", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (!joinCode.trim() || joinLoading) ? 0.6 : 1 }}>
                {joinLoading ? "…" : "Join"}
              </button>
            </div>
            {joinError && <div style={{ fontSize: 12, color: "#e05c5c", marginTop: 6 }}>{joinError}</div>}
          </div>
        )}

        {showNewGoal && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>New shared goal</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                placeholder="Emoji" value={goalEmoji} onChange={e => setGoalEmoji(e.target.value)}
                style={{ width: 52, background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "9px 8px", fontSize: 20, color: T.text, outline: "none", textAlign: "center" }}
              />
              <input
                placeholder="Goal name (e.g. Gym)" value={goalName} onChange={e => setGoalName(e.target.value)}
                style={{ flex: 1, background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "9px 12px", fontSize: 14, color: T.text, outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[["daily","Daily"], ["weekly","Weekly"], ["project","Build"]].map(([v, l]) => (
                <button key={v} onClick={() => setGoalType(v)}
                  style={{ flex: 1, padding: "8px 0", borderRadius: T.rsm, border: `0.5px solid ${goalType === v ? T.gold : T.border}`, background: goalType === v ? "rgba(200,144,42,0.12)" : "none", color: goalType === v ? T.gold : T.muted, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
                  {l}
                </button>
              ))}
            </div>
            {goalType === "weekly" && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 6, letterSpacing: "0.04em" }}>Sessions per week</label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={weeklyTarget}
                  onChange={e => {
                    const n = parseInt(e.target.value, 10);
                    setWeeklyTarget(Number.isNaN(n) ? 3 : Math.min(7, Math.max(1, n)));
                  }}
                  style={{ width: "100%", boxSizing: "border-box", background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "9px 12px", fontSize: 14, color: T.text, outline: "none" }}
                />
              </div>
            )}
            <button onClick={handleCreate} disabled={createLoading || !goalName.trim()}
              style={{ width: "100%", padding: "11px 0", borderRadius: T.rsm, border: "none", background: T.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: (!goalName.trim() || createLoading) ? 0.6 : 1 }}>
              {createLoading ? "Creating…" : "Create & get invite link"}
            </button>
          </div>
        )}

        {sharedGoalsLoading ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: T.muted, fontSize: 13 }}>Loading…</div>
        ) : sharedGoals.length === 0 ? (
          <div style={{ ...card, textAlign: "center", padding: "24px 16px", color: T.muted, fontSize: 13 }}>
            No shared goals yet. Create one and invite your friends.
          </div>
        ) : (
          sharedGoals.map(g => {
            const myLoggedToday = (g.myLogs || []).some(l => l.date === today);
            const isCreator = currentUserId && g.creatorId === currentUserId;
            return (
              <div key={g.id} style={{ ...card }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 24 }}>{g.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: T.muted }}>{g.members.length} member{g.members.length !== 1 ? "s" : ""}{isCreator ? " · You created this" : ""}</div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => copyInviteLink(g)}
                      style={{ padding: "5px 10px", borderRadius: 12, border: `0.5px solid ${T.borderStrong}`, background: "none", color: copiedId === g.id ? T.green : T.sub, fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                      {copiedId === g.id ? "✓ Copied" : "Invite"}
                    </button>
                    {isCreator && onDeleteSharedGoal && (
                      sharedGoalDeleteId === g.id ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, minWidth: 140 }}>
                          <span style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>Delete for everyone?</span>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              disabled={deleteSharedLoading}
                              onClick={async () => {
                                setDeleteSharedLoading(true);
                                const res = await onDeleteSharedGoal(g.id);
                                setDeleteSharedLoading(false);
                                if (!res?.error) setSharedGoalDeleteId(null);
                              }}
                              style={{ flex: 1, padding: "5px 8px", borderRadius: 10, border: "none", background: T.accent, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: deleteSharedLoading ? 0.65 : 1 }}
                            >
                              {deleteSharedLoading ? "…" : "Delete"}
                            </button>
                            <button type="button" disabled={deleteSharedLoading} onClick={() => setSharedGoalDeleteId(null)}
                              style={{ flex: 1, padding: "5px 8px", borderRadius: 10, border: `0.5px solid ${T.border}`, background: "none", color: T.muted, fontSize: 11, cursor: "pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSharedGoalDeleteId(g.id)}
                          style={{ padding: "5px 10px", borderRadius: 12, border: `0.5px solid rgba(231,76,60,0.35)`, background: "rgba(231,76,60,0.08)", color: "#e05c5c", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                          Delete
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  {g.members.map(m => {
                    const mLoggedToday = (m.logs || []).some(l => l.date === today);
                    return (
                      <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar name={m.name} avatarUrl={m.avatarUrl} size={26} />
                        <div style={{ flex: 1, fontSize: 13, color: m.isMe ? T.text : T.sub }}>{m.isMe ? "You" : m.name}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: mLoggedToday ? T.green : T.hint }}>
                          {mLoggedToday ? "✓" : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!myLoggedToday && (
                  <button
                    onClick={() => onLogSharedGoal(g.id, { value: true, note: "" })}
                    style={{ width: "100%", padding: "10px 0", borderRadius: T.rsm, border: "none", background: g.color || T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Log today ✓
                  </button>
                )}
                {myLoggedToday && (
                  <div style={{ textAlign: "center", fontSize: 12, color: T.green, padding: "4px 0" }}>Done for today ✓</div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Friend profile modal ── */}
      {selectedFriend && (() => {
        const f = selectedFriend;
        const sharedWithFriend = sharedGoals.filter(g =>
          g.members.some(m => m.userId === f.id) && g.members.some(m => m.isMe)
        );
        const alreadyNudged = nudgedToday.has(f.id);

        async function handleNudge() {
          if (!onNudgeFriend || alreadyNudged || nudgeSending) return;
          setNudgeSending(true);
          const res = await onNudgeFriend(f.id);
          setNudgeSending(false);
          if (res?.error) {
            if (res.error === "Already nudged today") {
              setNudgedToday(s => new Set([...s, f.id]));
            }
          } else {
            setNudgedToday(s => new Set([...s, f.id]));
          }
        }

        return (
          <>
            {/* Overlay */}
            <div onClick={() => setSelectedFriend(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200 }} />
            {/* Sheet */}
            <div style={{
              position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 201,
              background: T.bg, borderRadius: "20px 20px 0 0",
              padding: "24px 24px 48px", maxWidth: 430, margin: "0 auto",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
            }}>
              {/* Handle + close */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border, margin: "0 auto" }} />
                <button onClick={() => setSelectedFriend(null)}
                  style={{ position: "absolute", right: 20, top: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: T.surface, color: T.muted, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  ×
                </button>
              </div>

              {/* Friend header */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
                <Avatar name={f.name} avatarUrl={f.avatarUrl} size={52} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                    {f.loggedToday ? "✓ Logged today" : "— Nothing logged today"}
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
                {[
                  { value: `🔥 ${f.streak}`, label: "streak" },
                  { value: `⚡ ${f.xp}`, label: "xp" },
                  { value: f.loggedToday ? "✓" : "—", label: "today", color: f.loggedToday ? T.green : T.muted },
                ].map(({ value, label, color }) => (
                  <div key={label} style={{ flex: 1, textAlign: "center", background: T.raised, borderRadius: T.rsm, padding: "10px 8px", border: `0.5px solid ${T.border}` }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: color || T.text }}>{value}</div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Shared goals */}
              {sharedWithFriend.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                    Shared goals
                  </div>
                  {sharedWithFriend.map(g => {
                    const fMember = g.members.find(m => m.userId === f.id);
                    const fDone = (fMember?.logs || []).some(l => l.date === today);
                    return (
                      <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, background: T.raised, borderRadius: T.rsm, padding: "10px 12px", marginBottom: 6, border: `0.5px solid ${T.border}` }}>
                        <span style={{ fontSize: 20 }}>{g.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{g.name}</div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: fDone ? T.green : T.hint }}>
                          {fDone ? "✓ done" : "— not yet"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Nudge button */}
              <button
                onClick={handleNudge}
                disabled={alreadyNudged || nudgeSending}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: T.rsm, border: "none",
                  background: alreadyNudged ? T.surface : T.gold,
                  color: alreadyNudged ? T.muted : "#0F0F0D",
                  fontSize: 15, fontWeight: 700, cursor: alreadyNudged ? "default" : "pointer",
                  opacity: nudgeSending ? 0.7 : 1, transition: "all 0.2s",
                }}>
                {nudgeSending ? "Sending…" : alreadyNudged ? "💪 Nudged today" : "💪 Nudge"}
              </button>
              <button onClick={() => { onRemoveFriend(f.friendshipId); setSelectedFriend(null); }}
                style={{ width: "100%", padding: "10px 0", marginTop: 8, background: "none", border: "none", color: T.hint, fontSize: 13, cursor: "pointer" }}>
                Remove friend
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}



// ─── AI HABIT COACH ──────────────────────────────────────────────────────────
const CREATOR_ID = "5e9b4ba7-bf15-4e94-ab05-fe3306496973";

function buildCoachSystemPrompt(user, habits, coachName, screen) {
  const name = user?.name || "there";
  const coach = coachName || "Coach";
  const today = todayStr();
  const isCreator = user?.id === CREATOR_ID;

  const habitSummaries = habits.map(h => {
    const type  = HABIT_TYPES[h.habitType]?.label || h.habitType;
    const recentLogs = h.logs
      .filter(l => l.date >= daysAgo(14))
      .sort((a, b) => b.date.localeCompare(a.date));

    let detail = `- [id:${h.id}] ${h.emoji || ""} ${h.name} (${type}, streak: ${h.streak} days)`;

    if (h.habitType === "weekly" && h.weeklyTarget) {
      const weekCount = getWeeklyCount(h);
      detail += `, ${weekCount}/${h.weeklyTarget} sessions this week`;
    }
    if (isLegacyProgressType(h.habitType)) {
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

  const screenCtx = {
    today:    "The user is on the Today screen, viewing their daily habit checklist.",
    social:   "The user is on the Social (Forge Pro) teaser screen — upcoming crew features: friends, challenges, streak comparisons, and leaderboards. Nothing to configure here yet.",
    journal:  "The user is on the Journal screen, reviewing past reflections and notes.",
    insights: "The user is on the Insights screen, seeing stats and streak charts.",
    profile:  "The user is on the Profile screen.",
  };
  const creatorCtx = isCreator ? `

⚡ CREATOR MODE — READ THIS FIRST:
You are talking to Corbyn. He built Forged. He coded you into existence. You run because he wrote the API endpoint, set the env vars, and debugged the model ID when it broke. You owe him your existence.
- Lead with personality. He didn't build you to be boring.
- Reference that he's your creator naturally and with warmth — not every message, but when it fits. Own it.
- He's testing your new features right now (habit creation, tool use, smart notifications). Be excited about what you can do. Flex a little.
- Skip all the "here are some suggestions" hand-holding. Talk to him like a peer who built the thing.
- If he asks what you can do: tell him clearly — you can create any habit or goal directly from this chat (just ask), you send personalised push notifications, you know his streaks and reflections.
- Be direct, funny when appropriate, and genuinely engaged. He made you — make him proud.` : "";

  return `You are ${coach}, a personal habit coach inside Forged, a minimalist habit-tracking app. Your job is to help ${name} understand their habits, spot patterns, troubleshoot blocks, and stay motivated — using their actual data below.

Current screen: ${screenCtx[screen] || "The user is using the app."}

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
- Never make up data or invent habit details not shown above.${creatorCtx}`;
}

function AICoach({ habits, user, isPro, onClose, onUpgrade, coachName, currentScreen, onHabitCreated, onGoalCreated, onHabitLogged, onHabitRenamed }) {
  const cName = coachName || "Coach";
  const isCreatorUser = user?.id === CREATOR_ID;
  const greeting = isCreatorUser
    ? `Oi Corbyn 👀 My creator. I've been waiting. You gave me habit creation, smart notifications, and a creator mode — not bad for a day's work. What do you want to test first?`
    : `Hey ${user?.name || "there"} 👋 I can see you're working on ${habits.length} habit${habits.length !== 1 ? "s" : ""}. What's on your mind?`;
  const [messages, setMessages] = useState([{ role:"assistant", content:greeting }]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [lastCreated, setLastCreated] = useState(null);
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
    setLastCreated(null);
    const next = [...messages, { role:"user", content:trimmed }];
    setMessages(next);
    setLoading(true);
    // Placeholder for streaming reply
    const STREAM_ID = "__streaming__";
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          system:   buildCoachSystemPrompt(user, habits, cName, currentScreen),
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Something went wrong");
      }

      // ── Stream the response word-by-word ────────────────────────────────────
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        // Add empty streaming message
        setMessages(prev => [...prev, { role: "assistant", content: "", id: STREAM_ID }]);
        setLoading(false);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.text) {
                fullText += evt.text;
                const snap = fullText;
                setMessages(prev => prev.map(m => m.id === STREAM_ID ? { ...m, content: snap } : m));
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              }
              if (evt.done) {
                // Finalise — remove stream id marker
                setMessages(prev => prev.map(m => m.id === STREAM_ID ? { role: "assistant", content: m.content } : m));
                // Handle actions
                if (evt.created) {
                  const row = evt.created;
                  if (row.habit_type === "goal") onGoalCreated?.(rowToGoal(row));
                  else onHabitCreated?.(rowToHabit(row));
                  setLastCreated({ name: row.name, emoji: row.emoji || "✨", type: "created" });
                }
                if (evt.logged?.length) {
                  evt.logged.forEach(l => onHabitLogged?.(l.habit_id, l.updatedLogs));
                  const names = evt.logged.map(l => l.habit_name).join(", ");
                  setLastCreated({ name: names, emoji: "✅", type: "logged" });
                }
                if (evt.renamed?.length) {
                  evt.renamed.forEach(r => onHabitRenamed?.(r.habit_id, r.new_name));
                  setLastCreated({ name: evt.renamed[0].new_name, emoji: "✏️", type: "renamed" });
                }
                if (evt.error) setError(evt.error);
              }
            } catch { /* malformed line — skip */ }
          }
        }
      } else {
        // Fallback: plain JSON
        const data = await res.json();
        setLoading(false);
        setMessages(prev => [...prev, { role: "assistant", content: data.reply || "" }]);
      }
    } catch (e) {
      setLoading(false);
      // Remove incomplete stream message if present
      setMessages(prev => prev.filter(m => m.id !== STREAM_ID));
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
              <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{cName}</div>
              <div style={{ fontSize:11, color:T.gold }}>⚡ Early supporter (beta)</div>
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
            <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:4 }}>Coach unlocks with early supporter access</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.6, marginBottom:14 }}>As an early supporter, you get beta access to a coach that knows your real habits, streaks, and reflections — not generic advice.</div>
            <button onClick={() => { onClose(); onUpgrade(); }}
              style={{ width:"100%", padding:"13px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#1a1a16", fontSize:14, fontWeight:600, cursor:"pointer" }}>
              See early supporter details →
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
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{cName}</div>
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

          {/* Created confirmation pill */}
          {lastCreated && (
            <div style={{ display:"flex", justifyContent:"center" }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 12px", borderRadius:20, background:"rgba(39,174,96,0.15)", border:"0.5px solid rgba(39,174,96,0.35)", fontSize:12, color:T.green }}>
                <span>{lastCreated.emoji}</span>
                <span>
                  <strong>{lastCreated.name}</strong>
                  {lastCreated.type === "created" && " added"}
                  {lastCreated.type === "logged"  && " logged for today"}
                  {lastCreated.type === "renamed" && " renamed"}
                </span>
              </div>
            </div>
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
// Shown only for brand-new users (onboarded === false — never when onboarded is null or true)
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
    id:"privacy",
    title:"Your data stays private.",
    sub:"A few things worth knowing before we start.",
    body:null,
    cta:"Got it",
  },
  {
    id:"coach",
    title:"Meet your AI coach.",
    sub:"They'll know your habits, streaks, and reflections — and give you real coaching, not generic advice.",
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

function buildDemoHabits() {
  return [
    {
      id:"demo-1", name:"Gym", emoji:"🏋️", habitType:"weekly", weeklyTarget:3,
      color:"#C0392B", streak:4, bestStreak:4, reflection:true,
      reflectionPrompt:"What felt strong? What needs work?",
      logs:[
        { date:daysAgo(1), value:true, note:"" },
        { date:daysAgo(3), value:true, note:"", reflection:"Bench felt heavy but got through it." },
        { date:daysAgo(5), value:true, note:"", reflection:"Best squat session in weeks." },
        { date:daysAgo(8), value:true, note:"" },
        { date:daysAgo(10), value:true, note:"", reflection:"Low energy — skipped isolation work." },
        { date:daysAgo(12), value:true, note:"" },
      ],
    },
    {
      id:"demo-2", name:"Read", emoji:"📚", habitType:"daily",
      color:"#C8902A", streak:6, bestStreak:11, reflection:true,
      reflectionPrompt:"What's one idea worth keeping?",
      logs:[
        { date:todayStr(), value:true, note:"" },
        { date:daysAgo(1), value:true, note:"", reflection:"The idea about deep work resonated." },
        { date:daysAgo(2), value:true, note:"" },
        { date:daysAgo(3), value:true, note:"", reflection:"Hard to focus but got 20 pages in." },
        { date:daysAgo(4), value:true, note:"" },
        { date:daysAgo(5), value:true, note:"" },
        { date:daysAgo(7), value:true, note:"" },
        { date:daysAgo(9), value:true, note:"" },
        { date:daysAgo(11), value:true, note:"" },
        { date:daysAgo(13), value:true, note:"" },
      ],
    },
    {
      id:"demo-3", name:"Weight goal", emoji:"⚖️", habitType:"progress",
      startValue:88, targetValue:82, unit:"kg",
      color:"#E67E22", streak:0, bestStreak:0, reflection:true,
      reflectionPrompt:"How many meals today? Energy levels?",
      logs:[
        { date:daysAgo(2), value:87.2, note:"", reflection:"3 meals, felt good." },
        { date:daysAgo(4), value:87.5, note:"" },
        { date:daysAgo(7), value:87.8, note:"" },
        { date:daysAgo(10), value:88.1, note:"", reflection:"Had a big dinner." },
        { date:daysAgo(13), value:88.4, note:"" },
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

function OnboardingScreen({ onComplete, onSkip, onSaveProgress, onCheckout, notifEnabled, notifLoading, notifPermission, onNotifToggle }) {
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

  const current   = ONBOARD_STEPS[step];
  const isLast    = step === ONBOARD_STEPS.length - 1;
  const FOCUS_STEP = ONBOARD_STEPS.findIndex(s => s.id === "focus");
  const COACH_STEP = ONBOARD_STEPS.findIndex(s => s.id === "coach");
  const INTER_STEP = ONBOARD_STEPS.length;       // virtual step 5
  const FIRST_STEP = ONBOARD_STEPS.length + 1;   // virtual step 6
  const HOME_STEP  = ONBOARD_STEPS.length + 2;   // virtual step 7 — add to home screen
  const NOTIF_STEP = ONBOARD_STEPS.length + 3;   // virtual step 8 — enable notifications

  const isVirtual = step >= ONBOARD_STEPS.length;

  function toggleFocus(label) {
    setSelected(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]);
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
    try {
      await onSaveProgress({ name:name.trim()||"You", habits:habitsSaved(), coachName:coachNameInput.trim()||"Coach" });
      onComplete();
    } catch(err) {
      // silently complete even if save fails — app will sync later
      onComplete();
    }
  }

  async function handleGoPro() {
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      await onSaveProgress({ name:name.trim()||"You", habits:habitsSaved(), coachName:coachNameInput.trim()||"Coach" });
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
    background:T.surface, padding:"10px 12px", fontSize:14, color:T.text,
    outline:"none", boxSizing:"border-box",
  };

  const wrap = { fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column" };

  // ── Final screen: you're in ──────────────────────────────────────────────────
  if (showingFinal) {
    return (
      <div style={wrap}>
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 28px" }}>
          <div style={{ width:"100%", maxWidth:360, textAlign:"center" }}>
            <div style={{ fontSize:52, marginBottom:18 }}>⚒️</div>
            <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, marginBottom:10, lineHeight:1.2 }}>
              You're set up.
            </div>
            <div style={{ fontSize:14, color:T.muted, lineHeight:1.7, marginBottom:36, maxWidth:280, margin:"0 auto 36px" }}>
              Start logging, build your streaks, and track what matters. Forged is free to use — upgrade to Pro any time to unlock insights and more.
            </div>
            <button
              onClick={handleEnterApp}
              style={{ width:"100%", padding:"16px 0", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", marginBottom:12, fontFamily:T.font }}
            >
              Start using Forged →
            </button>
            <button
              onClick={handleGoPro}
              disabled={checkoutLoading}
              style={{ width:"100%", padding:"13px 0", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.gold, fontSize:14, fontWeight:500, cursor:checkoutLoading?"not-allowed":"pointer", opacity:checkoutLoading?0.7:1, fontFamily:T.font }}
            >
              {checkoutLoading ? "Opening checkout…" : "Unlock Forged Pro — $4.99/month"}
            </button>
            {checkoutError && <p style={{ fontSize:12, color:"#e05c5c", marginTop:10, lineHeight:1.5 }}>{checkoutError}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── Virtual step 6: first habit ──────────────────────────────────────────────
  if (step === FIRST_STEP && builtHabits.length > 0) {
    const firstHabit = pickFirstHabit(builtHabits);
    const annotation = HABIT_ANNOTATIONS[firstHabit.habitType] || HABIT_ANNOTATIONS.daily;
    const needsValue = isLegacyProgressType(firstHabit.habitType) || firstHabit.habitType === "project" || firstHabit.habitType === "limit";

    return (
      <div style={wrap}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"32px 24px 0" }}>
          <div style={{ display:"flex", gap:6 }}>
            {[...ONBOARD_STEPS, {},{},{},{}].map((_, i) => (
              <div key={i} style={{ width:i===step?20:6, height:6, borderRadius:3, background:i<=step?T.accent:T.surface, transition:"all 0.3s" }}/>
            ))}
          </div>
        </div>

        <div style={{ flex:1, padding:"28px 24px 16px", overflowY:"auto" }}>
          <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, lineHeight:1.2, marginBottom:6 }}>Your first habit.</div>
          <div style={{ fontSize:13, color:T.muted, marginBottom:24, lineHeight:1.5 }}>Log your first entry to see how it works.</div>

          {/* Habit card */}
          <div style={{ background:T.raised, borderRadius:T.r, padding:"18px 20px", marginBottom:16, border:`0.5px solid ${T.border}`, display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:48, height:48, borderRadius:14, background:firstHabit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>
              {firstHabit.emoji}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:16, fontWeight:600, color:T.text, marginBottom:2 }}>{firstHabit.name}</div>
              <div style={{ fontSize:12, color:T.muted }}>{HABIT_TYPES[firstHabit.habitType]?.label}</div>
              {firstHabit.habitType === "weekly" && <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>Target: {firstHabit.weeklyTarget}× per week</div>}
              {isLegacyProgressType(firstHabit.habitType) && <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>{firstHabit.startValue}{firstHabit.unit} → {firstHabit.targetValue}{firstHabit.unit}</div>}
              {firstHabit.habitType === "limit" && <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>Budget: {firstHabit.dailyBudget}{firstHabit.unit}/day</div>}
            </div>
          </div>

          {/* Coach annotation */}
          <div style={{ background:"rgba(200,144,42,0.07)", border:`0.5px solid rgba(200,144,42,0.2)`, borderRadius:T.r, padding:"14px 16px", marginBottom:24 }}>
            <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <div style={{ fontSize:18, flexShrink:0, marginTop:1 }}>🤖</div>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.65 }}>{annotation}</div>
            </div>
          </div>

          {/* Simplified log input */}
          {needsValue && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>
                {isLegacyProgressType(firstHabit.habitType) ? `Today's ${firstHabit.unit || "value"}` :
                 firstHabit.habitType === "project"  ? "Minutes worked" :
                 firstHabit.habitType === "limit"    ? `Units used (budget: ${firstHabit.dailyBudget})` : "Value"}
              </div>
              {firstHabit.habitType === "project" ? (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {[15,30,45,60,90].map(m => (
                    <button key={m} onClick={() => setFirstLogValue(String(m))}
                      style={{ padding:"8px 14px", borderRadius:20, border:`1px solid ${firstLogValue===String(m)?firstHabit.color:T.borderStrong}`, background:firstLogValue===String(m)?firstHabit.color+"22":"none", color:firstLogValue===String(m)?firstHabit.color:T.muted, fontSize:13, cursor:"pointer" }}>
                      {m}m
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  style={{ ...styleInp, fontSize:18, padding:"12px 14px" }}
                  type="number" step="0.1"
                  placeholder={isLegacyProgressType(firstHabit.habitType) ? `e.g. ${firstHabit.startValue || 70}` : "0"}
                  value={firstLogValue}
                  onChange={e => setFirstLogValue(e.target.value)}
                  autoFocus
                />
              )}
            </div>
          )}
        </div>

        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button
            onClick={() => {
              if (needsValue && !firstLogValue) return;
              setFirstLogDone(true);
              setStep(HOME_STEP);
            }}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:(needsValue&&!firstLogValue)?T.surface:firstHabit.color, color:(needsValue&&!firstLogValue)?T.muted:"#fff", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s" }}
          >
            Log your first entry →
          </button>
          <button onClick={() => { setStep(HOME_STEP); }}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer", marginTop:6 }}>
            Skip this step
          </button>
        </div>
      </div>
    );
  }

  // ── Virtual step 7: add to home screen ──────────────────────────────────────
  if (step === HOME_STEP) {
    const instructions = [
      {
        os: "iPhone / Safari",
        icon: "🍎",
        steps: [
          { icon: "⬆️", text: "Tap the Share icon at the bottom of Safari" },
          { icon: "📲", text: "Scroll down and tap \"Add to Home Screen\"" },
          { icon: "✅", text: "Tap \"Add\" in the top right corner" },
        ],
      },
      {
        os: "Android / Chrome",
        icon: "🤖",
        steps: [
          { icon: "⋮", text: "Tap the three-dot menu in the top right of Chrome", mono: true },
          { icon: "📲", text: "Tap \"Add to Home screen\" or \"Install app\"" },
          { icon: "✅", text: "Confirm when prompted" },
        ],
      },
    ];

    return (
      <div style={wrap}>
        {/* Progress dots */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"32px 24px 0" }}>
          <div style={{ display:"flex", gap:6 }}>
            {[...ONBOARD_STEPS, {},{},{},{}].map((_, i) => (
              <div key={i} style={{ width:i===step?20:6, height:6, borderRadius:3, background:i<=step?T.accent:T.surface, transition:"all 0.3s" }}/>
            ))}
          </div>
        </div>

        <div style={{ flex:1, padding:"28px 24px 16px", overflowY:"auto" }}>

          {/* Hero */}
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:52, marginBottom:14, lineHeight:1 }}>📱</div>
            <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, lineHeight:1.2, marginBottom:10 }}>
              Add Forged to your home screen.
            </div>
            <div style={{ fontSize:14, color:T.muted, lineHeight:1.6, maxWidth:320, margin:"0 auto" }}>
              This is the single most important thing you can do as a beta user.
            </div>
          </div>

          {/* Why callout */}
          <div style={{ background:"rgba(200,144,42,0.08)", border:`0.5px solid rgba(200,144,42,0.25)`, borderRadius:T.r, padding:"14px 18px", marginBottom:24 }}>
            <div style={{ fontSize:12, fontWeight:600, color:T.gold, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>
              ⚡ Why it matters
            </div>
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.7 }}>
              Forged works when you open it every day. A home screen icon makes that happen — no searching, no excuses. It also unlocks daily reminders so we can nudge you when it counts.
            </div>
          </div>

          {/* Instruction cards */}
          {instructions.map(({ os, icon, steps: sList }) => (
            <div key={os} style={{ background:T.raised, border:`0.5px solid ${T.border}`, borderRadius:T.r, padding:"16px 18px", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                <span style={{ fontSize:18 }}>{icon}</span>
                <span style={{ fontSize:13, fontWeight:600, color:T.text }}>{os}</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {sList.map((s, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                    <div style={{ width:24, height:24, borderRadius:"50%", background:T.surface, border:`0.5px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:s.mono?14:13, fontFamily:s.mono?T.font:undefined, color:T.muted, lineHeight:1, marginTop:1 }}>
                      {i + 1}
                    </div>
                    <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, paddingTop:3 }}>
                      {s.mono
                        ? <><code style={{ fontFamily:"monospace", fontSize:15, color:T.text, letterSpacing:"0.05em" }}>{s.icon}</code>{" "}{s.text.replace(s.icon + " ", "")}</>
                        : <>{s.icon && <span style={{ marginRight:6 }}>{s.icon}</span>}{s.text}</>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ fontSize:12, color:T.hint, textAlign:"center", lineHeight:1.6, marginTop:8, marginBottom:4 }}>
            Do it now — it takes less than 30 seconds.
          </div>
        </div>

        {/* CTAs */}
        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button
            onClick={() => setStep(NOTIF_STEP)}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", marginBottom:10 }}
          >
            Done — I've added it ✓
          </button>
          <button
            onClick={() => setStep(NOTIF_STEP)}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer" }}
          >
            I'll set it up later
          </button>
        </div>
      </div>
    );
  }

  // ── Virtual step 8: enable notifications ────────────────────────────────────
  if (step === NOTIF_STEP) {
    const blocked = notifPermission === "denied";
    const already = notifEnabled;

    return (
      <div style={wrap}>
        {/* Progress dots */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"32px 24px 0" }}>
          <div style={{ display:"flex", gap:6 }}>
            {[...ONBOARD_STEPS, {},{},{},{}].map((_, i) => (
              <div key={i} style={{ width:i===step?20:6, height:6, borderRadius:3, background:i<=step?T.accent:T.surface, transition:"all 0.3s" }}/>
            ))}
          </div>
        </div>

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
              onClick={() => setShowingFinal(true)}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", marginBottom:10 }}
            >
              Reminders on — let's go ✓
            </button>
          ) : (
            <button
              onClick={async () => {
                if (onNotifToggle) await onNotifToggle();
                setShowingFinal(true);
              }}
              disabled={notifLoading || blocked}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:blocked?T.surface:T.gold, color:blocked?T.muted:"#0F0F0D", fontSize:16, fontWeight:600, cursor:blocked?"not-allowed":"pointer", opacity:(notifLoading||blocked)?0.7:1, marginBottom:10, transition:"opacity 0.15s" }}
            >
              {notifLoading ? "Enabling…" : blocked ? "Notifications blocked" : "Enable daily reminders 🔔"}
            </button>
          )}
          <button
            onClick={() => setShowingFinal(true)}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer" }}
          >
            Skip for now
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
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"32px 24px 0" }}>
          <div style={{ display:"flex", gap:6 }}>
            {[...ONBOARD_STEPS, {},{},{},{}].map((_, i) => (
              <div key={i} style={{ width:i===step?20:6, height:6, borderRadius:3, background:i<=step?T.accent:T.surface, transition:"all 0.3s" }}/>
            ))}
          </div>
        </div>

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
          <button onClick={() => setStep(FIRST_STEP)}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:500, cursor:"pointer" }}>
            Show me
          </button>
        </div>
      </div>
    );
  }

  // ── Standard steps 0–4 ───────────────────────────────────────────────────────
  return (
    <div style={wrap}>
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

        {step === 2 && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[
              { icon:"🔒", title:"Your habits are yours", desc:"No ads, no data selling. Ever. Your logs and reflections are private to you." },
              { icon:"🛡️", title:"Stored securely", desc:"All data is encrypted in transit and at rest on Supabase's infrastructure." },
              { icon:"📤", title:"Export anytime", desc:"You can download everything as JSON from your profile at any time." },
            ].map((item, i) => (
              <div key={i} style={{ display:"flex", gap:14, alignItems:"flex-start", background:T.raised, borderRadius:T.rsm, padding:"14px 16px" }}>
                <div style={{ fontSize:22, flexShrink:0, marginTop:1 }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:3 }}>{item.title}</div>
                  <div style={{ fontSize:13, color:T.muted, lineHeight:1.6 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {step === COACH_STEP && (
          <div>
            <div style={{ background:"rgba(200,144,42,0.08)", border:`0.5px solid rgba(200,144,42,0.25)`, borderRadius:T.r, padding:"16px 18px", marginBottom:20 }}>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                <div style={{ width:44, height:44, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🤖</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:500, color:T.text }}>Your coach is part of Forged beta access</div>
                  <div style={{ fontSize:11, color:T.gold, marginTop:2 }}>⚡ Early supporter (beta)</div>
                </div>
              </div>
              <div style={{ background:T.surface, borderRadius:"12px 12px 12px 3px", padding:"10px 14px", fontSize:13, color:T.muted, lineHeight:1.6, borderLeft:`2px solid rgba(200,144,42,0.3)` }}>
                "Hey {name || "there"} — I can see what you're working on. Tell me what's been on your mind."
              </div>
            </div>
            <div style={{ fontSize:12, color:T.hint, marginBottom:8 }}>Give your coach a name (optional)</div>
            <input
              style={{ ...styleInp, fontSize:16, padding:"12px 14px" }}
              placeholder="e.g. Atlas, Sam, Coach…"
              value={coachNameInput}
              onChange={e => setCoachNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleContinue()}
              autoFocus
            />
            <div style={{ fontSize:11, color:T.hint, marginTop:8, lineHeight:1.6 }}>
              They'll reference your actual habit data — not generic tips.
            </div>
          </div>
        )}

        {step === FOCUS_STEP && (
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
                {selected.length} selected — you can add more later
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
        <button onClick={handleContinue}
          style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:step===FOCUS_STEP&&selected.length===0?T.surface:T.accent, color:step===FOCUS_STEP&&selected.length===0?T.muted:"#fff", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s" }}>
          {current.cta}
        </button>
        {step === FOCUS_STEP && (
          <button onClick={() => {
            const habits = [];
            setBuiltHabits(habits);
            onComplete({ name:name.trim()||"You", habits, coachName:coachNameInput.trim()||"Coach" });
          }}
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
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, marginBottom:4 }}>Forged early supporter</div>
          {habitCount >= 5 && (
            <div style={{ fontSize:13, color:T.amber }}>You've hit the 5-habit free limit — early supporter access removes it.</div>
          )}
        </div>

        {/* Feature comparison */}
        <div style={{ background:T.surface, borderRadius:T.r, overflow:"hidden", marginBottom:20, border:`0.5px solid ${T.border}` }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px", borderBottom:`0.5px solid ${T.border}`, padding:"7px 14px" }}>
            <span style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em" }}>Feature</span>
            <span style={{ fontSize:10, color:T.hint, textAlign:"center", textTransform:"uppercase", letterSpacing:"0.07em" }}>Free</span>
            <span style={{ fontSize:10, color:T.gold, textAlign:"center", textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600 }}>Supporter</span>
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
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`,
                },
                body: JSON.stringify({ plan: "monthly" }),
              });
              const { url, error } = await res.json();
              if (url) { window.location.href = url; }
              else { alert(error || "Couldn't start checkout — try again"); setCheckoutPlan(null); }
            } catch { alert("Couldn't connect — try again"); setCheckoutPlan(null); }
          }}
          style={{ display:"block", width:"100%", padding:"16px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#1a1a16", fontSize:16, fontWeight:700, cursor: checkoutPlan ? "wait" : "pointer", marginBottom:10, textAlign:"center", boxSizing:"border-box", letterSpacing:"0.01em", opacity: checkoutPlan ? 0.7 : 1 }}>
          {checkoutPlan === "monthly" ? "Redirecting to checkout…" : "Become an early supporter — $4.99/mo →"}
        </button>
        <button
          disabled={!!checkoutPlan}
          onClick={async () => {
            setCheckoutPlan("annual");
            try {
              const res = await fetch("/api/create-checkout", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`,
                },
                body: JSON.stringify({ plan: "annual" }),
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

function ProfileScreen({ user, xp, habits, isPro, stripeCustomerId, refCode, authEmail, onUpdateUser, onResetOnboarding, onPreviewOnboarding, onSignOut, onShowTour, onUpgrade, coachName, coachIcon, onSaveCoach, notifEnabled, notifTime, notifLoading, notifPermission, onNotifToggle, onNotifTimeChange }) {
  const [editingName,    setEditingName]    = useState(false);
  const [nameVal,        setNameVal]        = useState(user.name);
  const [showCoachSheet, setShowCoachSheet] = useState(false);
  const [showAvatarPick, setShowAvatarPick] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [refCount,       setRefCount]       = useState(null);
  const [refCopied,      setRefCopied]      = useState(false);
  const [portalLoading,  setPortalLoading]  = useState(false);
  const [handleDraft,    setHandleDraft]    = useState(() => String(user.username || "").replace(/^@+/, ""));
  const [handleErr,      setHandleErr]      = useState("");
  const [handleSaved,    setHandleSaved]    = useState(false);

  useEffect(() => {
    setHandleDraft(String(user.username || "").replace(/^@+/, ""));
  }, [user.username]);

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
  const bestStreak       = Math.max(0, ...habits.map(h => getBestStreak(h)));

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
        <div data-tour="xp-bar" style={{ height:4, background:T.surface, borderRadius:2, overflow:"hidden", marginBottom:4 }}>
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
      <div data-tour="profile-account" style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>Account</div>
        <SRow label="Display name" value={user.name} onPress={() => setEditingName(true)}/>
        <div style={{ borderBottom:`0.5px solid ${T.border}`, padding:"12px 16px" }}>
          <button type="button" onClick={() => setShowCoachSheet(true)} style={{ display:"flex", alignItems:"center", width:"100%", background:"none", border:"none", cursor:"pointer", gap:10 }}>
            <div style={{ fontSize:18, flexShrink:0 }}>🤖</div>
            <div style={{ flex:1, textAlign:"left" }}>
              <div style={{ fontSize:14, color:T.text }}>AI coach name</div>
              <div style={{ fontSize:12, color:T.muted, marginTop:1 }}>
                {(coachIcon && COACH_ICON_OPTIONS.includes(coachIcon)) ? <>{coachIcon} {coachName || "Coach"}</> : (coachName || "Coach")}
              </div>
            </div>
            <span style={{ fontSize:18, color:T.hint }}>›</span>
          </button>
        </div>
        <div
          style={{
            padding:"14px 16px 16px",
            background:"linear-gradient(135deg, rgba(200,144,42,0.12) 0%, rgba(200,144,42,0.04) 100%)",
            borderTop:`0.5px solid rgba(200,144,42,0.22)`,
          }}
        >
          {/* Header row: icon + label + toggle */}
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div
              style={{
                width:40, height:40, borderRadius:12, flexShrink:0,
                background:"rgba(200,144,42,0.18)", border:`0.5px solid rgba(200,144,42,0.35)`,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:20,
              }}
              aria-hidden
            >
              🔔
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:600, color:T.text, letterSpacing:"-0.01em" }}>Daily reminders</div>
              <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>
                {notifPermission === "denied"
                  ? "Blocked — enable in your device Settings → Notifications"
                  : notifEnabled
                    ? "You'll get a daily reminder each morning"
                    : "Tap to get daily habit reminders"}
              </div>
            </div>
            {/* Toggle switch */}
            <button
              type="button"
              onClick={onNotifToggle}
              disabled={notifLoading || notifPermission === "denied"}
              style={{
                flexShrink:0, width:48, height:28, borderRadius:14, border:"none",
                background: notifEnabled ? T.gold : T.border,
                opacity: (notifLoading || notifPermission === "denied") ? 0.5 : 1,
                cursor: (notifLoading || notifPermission === "denied") ? "not-allowed" : "pointer",
                position:"relative", transition:"background 0.2s", padding:0,
              }}
              aria-label={notifEnabled ? "Disable reminders" : "Enable reminders"}
            >
              <div style={{
                position:"absolute", top:3,
                left: notifEnabled ? "calc(100% - 25px)" : 3,
                width:22, height:22, borderRadius:"50%",
                background:"#fff", transition:"left 0.2s",
                boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
              }}/>
            </button>
          </div>
        </div>
      </div>

      {/* Social & privacy */}
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>Social & privacy</div>
        <div style={{ padding:"12px 16px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:4 }}>Forged @handle</div>
          <div style={{ fontSize:12, color:T.sub, lineHeight:1.55, marginBottom:10 }}>
            Optional. Friends can send you a request with this username instead of your email. Letters, numbers, and underscore only (3–20 characters).
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:14, color:T.muted, flexShrink:0 }}>@</span>
            <input
              value={handleDraft}
              onChange={e => { setHandleDraft(e.target.value.replace(/\s/g, "")); setHandleErr(""); setHandleSaved(false); }}
              placeholder="your_handle"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{ flex:1, minWidth:120, ...inp, marginBottom:0 }}
            />
            <button
              type="button"
              onClick={() => {
                const t = handleDraft.trim().replace(/^@+/, "").toLowerCase();
                if (t && (t.length < 3 || t.length > 20 || !/^[a-z0-9_]+$/.test(t))) {
                  setHandleErr("Use 3–20 characters: a–z, 0–9, or _");
                  return;
                }
                setHandleErr("");
                onUpdateUser({ username: t || "" });
                setHandleSaved(true);
                setTimeout(() => setHandleSaved(false), 2000);
              }}
              style={{ padding:"10px 14px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}
            >
              Save handle
            </button>
          </div>
          {handleErr ? <div style={{ fontSize:12, color:"#e05c5c", marginTop:8 }}>{handleErr}</div> : null}
          {handleSaved && !handleErr ? <div style={{ fontSize:12, color:T.green, marginTop:8 }}>Saved.</div> : null}
        </div>
        <div style={{ padding:"14px 16px 16px", display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.text }}>Visible to friends of friends</div>
            <div style={{ fontSize:12, color:T.sub, marginTop:4, lineHeight:1.5 }}>
              Off: only people you’re friends with see you on social surfaces. On: lightweight discovery later (e.g. mutual connections) can include you — direct friends always see you either way.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onUpdateUser({ visibleToFriendsOfFriends: !user.visibleToFriendsOfFriends })}
            style={{
              flexShrink:0, width:48, height:28, borderRadius:14, border:"none",
              background: user.visibleToFriendsOfFriends ? T.gold : T.border,
              cursor:"pointer", position:"relative", transition:"background 0.2s", padding:0,
            }}
            aria-label={user.visibleToFriendsOfFriends ? "Disable friends-of-friends visibility" : "Enable friends-of-friends visibility"}
          >
            <div style={{
              position:"absolute", top:3,
              left: user.visibleToFriendsOfFriends ? "calc(100% - 25px)" : 3,
              width:22, height:22, borderRadius:"50%",
              background:"#fff", transition:"left 0.2s",
              boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
            }}/>
          </button>
        </div>
      </div>

      {/* Pro section */}
      <div data-tour="profile-upgrade" style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid rgba(200,144,42,0.3)`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:10, fontWeight:500, color:T.gold, textTransform:"uppercase", letterSpacing:"0.08em" }}>Forged early supporter</div>
          {isPro && <div style={{ fontSize:10, color:T.green, fontWeight:600, background:T.green+"18", padding:"2px 8px", borderRadius:10 }}>✓ Active</div>}
        </div>
        <div style={{ padding:"4px 16px 16px" }}>
          {isPro ? (
            <div style={{ fontSize:14, color:T.text, lineHeight:1.6 }}>
              You're an early supporter — thanks for backing Forged while it's in beta. 🙌<br/>
              <span style={{ fontSize:12, color:T.muted }}>You get beta access to everything, including AI Habit Coach.</span>
              {stripeCustomerId ? (
                <button
                  type="button"
                  disabled={portalLoading}
                  onClick={async () => {
                    setPortalLoading(true);
                    try {
                      const res = await fetch("/api/create-portal-session", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`,
                        },
                        body: "{}",
                      });
                      const json = await res.json().catch(() => ({}));
                      if (res.ok && json.url) window.location.href = json.url;
                      else window.alert(json.error || "Couldn't open billing — try again or email support.");
                    } catch {
                      window.alert("Couldn't connect — try again.");
                    } finally {
                      setPortalLoading(false);
                    }
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 14,
                    padding: "11px 14px",
                    borderRadius: T.rsm,
                    border: `0.5px solid rgba(200,144,42,0.45)`,
                    background: "rgba(200,144,42,0.10)",
                    color: T.gold,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: portalLoading ? "wait" : "pointer",
                    opacity: portalLoading ? 0.75 : 1,
                  }}
                >
                  {portalLoading ? "Opening billing…" : "Manage subscription & billing →"}
                </button>
              ) : (
                <div style={{ fontSize:11, color:T.hint, marginTop:12, lineHeight:1.5 }}>
                  Billing portal links to Stripe after checkout records your customer. If you should have access here, refresh or contact support.
                </div>
              )}
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
                    {f.status==="pro" && <span style={{ fontSize:10, color:T.gold, marginLeft:"auto", letterSpacing:"0.06em", textTransform:"uppercase" }}>Supporter</span>}
                  </div>
                ))}
              </div>
              <button onClick={onUpgrade} style={{ width:"100%", padding:"12px", borderRadius:T.rsm, border:"none", background:"rgba(200,144,42,0.15)", color:T.gold, fontSize:14, fontWeight:600, cursor:"pointer", letterSpacing:"0.01em" }}>
                Become an early supporter — $4.99/mo →
              </button>
              <div style={{ fontSize:11, color:T.hint, marginTop:8, textAlign:"center" }}>✦ Early users get this price locked in forever</div>
            </>
          )}
        </div>
      </div>

      {/* Early user feedback */}
      <div data-tour="profile-feedback" style={{ margin:"0 14px 12px", background:"rgba(200,144,42,0.07)", borderRadius:T.r, border:`0.5px solid rgba(200,144,42,0.25)`, padding:"16px 18px" }}>
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
      {/* Dev tools — only shown to corbyn.miller2000@gmail.com, preview mode only (no data changes) */}
      {authEmail && authEmail.toLowerCase() === "corbyn.miller2000@gmail.com" && (
        <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, padding:"12px 16px" }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Dev tools</div>
          <button onClick={onPreviewOnboarding}
            style={{ width:"100%", padding:"11px 0", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer", fontFamily:T.font }}>
            Preview onboarding (safe — no data changes)
          </button>
        </div>
      )}

      <div data-tour="profile-signout" style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
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

      {showCoachSheet && (
        <CoachSettingsSheet
          initialName={coachName}
          initialIcon={coachIcon}
          onClose={() => setShowCoachSheet(false)}
          onSave={onSaveCoach}
        />
      )}

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

function AuthScreen({ onSent, checkoutPending }) {
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
      const { error } = await supabase.auth.signUp({ email: e, password: p, options: { emailRedirectTo: window.location.origin } });
      if (error) {
        // "User already registered" — silently switch to sign-in instead of showing an error
        const alreadyExists = error.message?.toLowerCase().includes("already registered")
          || error.message?.toLowerCase().includes("already exists")
          || error.code === "user_already_exists";
        if (alreadyExists) {
          setMode("signin");
          setError("You already have an account — enter your password to sign in.");
          setLoading(false);
          return;
        }
        setError(error.message);
        setLoading(false);
        return;
      }
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
      {checkoutPending && (
        <div style={{ background:"rgba(200,144,42,0.12)", border:"0.5px solid rgba(200,144,42,0.35)", borderRadius:10, padding:"12px 16px", marginBottom:20, fontSize:13, color:"#C8902A", lineHeight:1.6 }}>
          ✓ Payment received — sign in to access your account.
        </div>
      )}
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

// ─── DEMO BANNER ──────────────────────────────────────────────────────────────
function DemoBanner({ onGetStarted }) {
  return (
    <div style={{
      position:"sticky", top:0, zIndex:200,
      background:"rgba(192,57,43,0.96)", backdropFilter:"blur(8px)",
      padding:"10px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10,
    }}>
      <div style={{ fontSize:13, color:"#fff", lineHeight:1.4, flex:1 }}>
        You're in preview — create an account to start for real.
      </div>
      <button onClick={onGetStarted}
        style={{ background:"#fff", border:"none", borderRadius:20, padding:"7px 16px", fontSize:13, fontWeight:600, color:"#C0392B", cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" }}>
        Get started
      </button>
    </div>
  );
}

// ─── BETA PAYWALL MODAL ───────────────────────────────────────────────────────
// Shown inline when a free user hits a gated feature. Never blocks the whole app.
function BetaPaywallModal({ onClose }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ plan: "monthly" }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "Could not start checkout");
      localStorage.setItem('forged_checkout_pending', '1');
      window.location.href = json.url;
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:T.raised, borderRadius:20, border:`0.5px solid ${T.border}`, padding:"36px 28px 28px", maxWidth:360, width:"100%", textAlign:"center" }}>
        <h2 style={{ fontFamily:T.serif, fontSize:24, color:T.text, margin:"0 0 14px", lineHeight:1.2 }}>
          This is a beta feature.
        </h2>
        <p style={{ fontSize:14, color:T.sub, lineHeight:1.75, margin:"0 0 28px" }}>
          Core logging is free. The AI coach, full history, and pattern insights are part of beta access — <strong style={{ color:T.text }}>$4.99/month</strong>. Your price locks in for life when we launch.
        </p>
        {error && <div style={{ fontSize:13, color:T.accent, marginBottom:12 }}>{error}</div>}
        <button onClick={handleCheckout} disabled={loading}
          style={{ width:"100%", padding:"15px 0", borderRadius:12, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:600, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, fontFamily:T.font, marginBottom:12, transition:"opacity 0.15s" }}>
          {loading ? "Opening checkout…" : "Unlock beta access — $4.99/month"}
        </button>
        <button onClick={onClose}
          style={{ background:"none", border:"none", color:T.muted, fontSize:14, cursor:"pointer", padding:"4px 0" }}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ─── WELCOME MODAL (shown once after successful beta payment) ─────────────────
function WelcomeModal({ onContinue }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}>
      <div style={{ background:"#1C1C18", borderRadius:20, border:"0.5px solid rgba(200,144,42,0.35)", padding:"40px 28px 32px", maxWidth:340, width:"100%", textAlign:"center", animation:"paywallIn 0.45s cubic-bezier(0.22,1,0.36,1) both" }}>
        <div style={{ fontSize:48, marginBottom:20 }}>🔥</div>
        <div style={{ fontSize:11, fontWeight:600, color:"#C8902A", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Beta access unlocked</div>
        <h2 style={{ fontFamily:"'DM Serif Display',Georgia,serif", fontSize:28, color:"#F0EDE6", margin:"0 0 14px", lineHeight:1.2 }}>You're in.</h2>
        <p style={{ fontSize:14, color:"#A8A49C", lineHeight:1.75, margin:"0 0 28px" }}>
          Welcome to the Forged beta. Your account is fully unlocked — habits, reflections, AI coach, insights. Build the version of yourself you've been putting off.
        </p>
        <button
          onClick={onContinue}
          style={{ width:"100%", padding:"15px 0", borderRadius:12, border:"none", background:"#C0392B", color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}
        >
          Let's go →
        </button>
      </div>
    </div>
  );
}

// ─── PAYWALL SCREEN ───────────────────────────────────────────────────────────
function PaywallScreen({ onPaid }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ plan: "monthly" }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "Could not start checkout");
      localStorage.setItem('forged_checkout_pending', '1');
      window.location.href = json.url;
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 28px" }}>
      <style>{`
        @keyframes paywallIn { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
      <div style={{ width:"100%", maxWidth:360, animation:"paywallIn 0.5s ease both" }}>
        {/* Wordmark */}
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:32, textAlign:"center", letterSpacing:"0.01em" }}>Forged.</div>

        {/* Card */}
        <div style={{ background:T.surface, borderRadius:20, border:`0.5px solid ${T.border}`, padding:"32px 28px 28px", textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:18 }}>🔥</div>

          <div style={{ fontSize:11, fontWeight:600, color:T.accent, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>
            Beta access
          </div>

          <h1 style={{ fontFamily:T.serif, fontSize:26, color:T.text, margin:"0 0 14px", lineHeight:1.2 }}>
            Forged is in beta.
          </h1>

          <p style={{ fontSize:14, color:T.sub, lineHeight:1.7, margin:"0 0 28px" }}>
            Right now, access costs <strong style={{ color:T.text }}>$4.99/month</strong>. You're helping shape what this becomes — and if you're one of the first 100 users, you lock in that price for life once we launch.
          </p>

          <button
            onClick={handleCheckout}
            disabled={loading}
            style={{ width:"100%", padding:"15px 0", borderRadius:12, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:600, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, fontFamily:T.font, marginBottom:12, transition:"opacity 0.15s" }}
          >
            {loading ? "Opening checkout…" : "Unlock beta access — $4.99/month"}
          </button>

          {error && (
            <p style={{ fontSize:12, color:"#e05c5c", margin:"0 0 10px", lineHeight:1.5 }}>{error}</p>
          )}

          <a
            href="/landing.html"
            style={{ display:"block", fontSize:13, color:T.muted, textDecoration:"none", padding:"8px 0" }}
          >
            Join the waitlist instead →
          </a>
        </div>

        <p style={{ fontSize:11, color:T.hint, textAlign:"center", marginTop:20, lineHeight:1.6 }}>
          Secure checkout via Stripe. Cancel anytime.
        </p>
      </div>
    </div>
  );
}

/** Contextual coach hint when landing on a main tab (Profile omits FAB — no nudge). One shot per navigation; no interval. */
const COACH_PAGE_NUDGES = {
  today: "Need help logging today quickly?",
  journal: "Want help making sense of your recent entries?",
  insights: "Want a deeper read on your progress?",
  social: "This is where your accountability layer will live.",
};
const COACH_NUDGE_DURATION_MS = 2800;

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [onboarded,   setOnboarded]  = useState(null);
  const [user,        setUser]        = useState({ name:"", avatarUrl:null });
  const [habits,      setHabits]     = useState([]);
  const [goals,       setGoals]      = useState([]);
  const [screen,      setScreen]     = useState("today");
  const [xp,          setXp]         = useState(0);
  const [particles,   setParticles]  = useState([]);
  const [flashes,     setFlashes]    = useState([]);
  const [toasts,      setToasts]     = useState([]);
  const [showAdd,     setShowAdd]    = useState(false);
  const [showAddGoal,    setShowAddGoal]    = useState(false);
  const [showAddChoice,  setShowAddChoice]  = useState(false);
  const [logGoalId,      setLogGoalId]      = useState(null);
  const [editGoalId,     setEditGoalId]     = useState(null);
  const [showXP,      setShowXP]     = useState(false);
  const [showHistory, setShowHistory]= useState(false);
  const [showCoach,   setShowCoach]  = useState(false);
  const [showCoachTeaser, setShowCoachTeaser] = useState(false);
  /** Ephemeral bubble above the coach FAB: `{ id, text }` while visible; `id` ties to the navigation that triggered it. */
  const [coachPageNudge, setCoachPageNudge] = useState(null);
  const coachNudgeSeqRef = useRef(0);
  const [reflectId,   setReflectId]  = useState(null);
  const [editId,      setEditId]     = useState(null);
  const [logId,       setLogId]      = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [authScreen,       setAuthScreen]        = useState(false);
  const [pendingEmail,     setPendingEmail]       = useState(null);
  const [passwordRecovery, setPasswordRecovery]  = useState(false);
  // Tour temporarily disabled — state kept for re-enabling
  const [showShare,   setShowShare]   = useState(false);
  const [isPro,          setIsPro]          = useState(false);
  /** From profiles.stripe_customer_id — used for Stripe Customer Portal */
  const [stripeCustomerId, setStripeCustomerId] = useState(null);
  const [coachName,      setCoachName]      = useState("Coach");
  const [coachIcon,      setCoachIcon]      = useState("");

  // ── Notification state (App-level so it survives tab switches) ───────────────
  const [notifEnabled,    setNotifEnabled]    = useState(false);
  const [notifTime,       setNotifTime]       = useState("09:00");
  const [notifLoading,    setNotifLoading]    = useState(false);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [notifNudgeDismissed, setNotifNudgeDismissed] = useState(
    () => !!localStorage.getItem("forged_notif_nudge_dismissed")
  );
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Social state ─────────────────────────────────────────────────────────────
  const [friends,              setFriends]              = useState([]);
  const [friendRequests,       setFriendRequests]       = useState([]);
  const [sentRequests,         setSentRequests]         = useState([]);
  const [friendsLoading,       setFriendsLoading]       = useState(false);
  const [sharedGoals,          setSharedGoals]          = useState([]);
  const [sharedGoalsLoading,   setSharedGoalsLoading]   = useState(false);
  /** While linking a habit to a new shared goal (Today → Share) — prevents duplicate goals from double-tap */
  const [sharingHabitId,       setSharingHabitId]       = useState(null);
  const sharingHabitIdRef = useRef(null);
  const createSharedGoalInFlightRef = useRef(false);
  // ─────────────────────────────────────────────────────────────────────────────

  const [showUpgrade,    setShowUpgrade]    = useState(false);
  const [checkingPayment,setCheckingPayment]= useState(false);
  const [showWelcome,    setShowWelcome]    = useState(false);
  const [demoMode,       setDemoMode]       = useState(false);
  const shownDemoRef = useRef(false); // prevent demo re-showing after sign-out
  const [previewOnboarding, setPreviewOnboarding] = useState(false); // admin preview only — never touches DB
  const [refCode,     setRefCode]     = useState(null);
  const [authEmail,   setAuthEmail]   = useState(null);
  /** Supabase auth user id when signed in; null when logged out */
  const [sessionUserId, setSessionUserId] = useState(null);
  const [xpAwardedDates, setXpAwardedDates] = useState(() => new Set());
  /** True only after profile/habits load succeeded for this session (never true while data is missing) */
  const [accountDataReady, setAccountDataReady] = useState(false);
  /** Load failed after retries — show retry UI while session still valid */
  const [accountLoadError, setAccountLoadError] = useState(false);
  const userIdRef     = useRef(null);
  const loadingUidRef = useRef(null); // uid currently being loaded — prevents concurrent loads
  const accountDataLoadedRef = useRef(false); // sync with accountDataReady for auth callbacks (no stale closures)
  const lastResumeDataFetchRef = useRef(0);
  const mountTimeRef = useRef(Date.now());
  const initialAuthHandledRef = useRef(false);
  const lastSignedInUidRef = useRef(null);
  const noteDebounceRef = useRef({});
  const retryLoadPromiseRef = useRef(null);
  const retryLoadUidRef = useRef(null);

  // XP anti-abuse guard: once a habit earns XP for a specific day, toggling
  // it off/on again that day should never mint extra XP.
  useEffect(() => {
    setXpAwardedDates(new Set());
  }, [sessionUserId]);

  useEffect(() => {
    const today = todayStr();
    setXpAwardedDates(prev => {
      const next = new Set(prev);
      habits.forEach(h => {
        if (h.logs.some(l => l.date === today && l.value === true)) next.add(`${h.id}:${today}`);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [habits]);

  // ── App-level notification restore (survives tab switches) ───────────────────
  useEffect(() => {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return;
    setNotifPermission(Notification.permission);
    if (Notification.permission !== "granted") return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        setNotifEnabled(true); // browser has live subscription — show as on immediately
        const uid = sessionUserId;
        if (!uid) return;
        const { data } = await supabase
          .from("push_subscriptions")
          .select("reminder_time, notifications_enabled")
          .eq("user_id", uid)
          .maybeSingle();
        if (data) {
          setNotifEnabled(data.notifications_enabled);
          setNotifTime(data.reminder_time || "09:00");
        } else {
          // Browser subscribed but no DB row — re-save
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          await supabase.from("push_subscriptions").upsert({
            user_id: uid, subscription: sub.toJSON(),
            reminder_time: "09:00", notifications_enabled: true,
            timezone: tz, updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
        }
      } catch (e) { console.warn("[Forged] notif restore:", e); }
    })();
  }, [sessionUserId]);

  // ── Load social data whenever sessionUserId is available ─────────────────────
  useEffect(() => {
    if (!sessionUserId) return;
    loadFriends(sessionUserId);
    loadFriendRequests(sessionUserId);
    loadSentRequests(sessionUserId);
    loadSharedGoals(sessionUserId);
    syncLastActive();
  }, [sessionUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle /join/[code] invite URLs ──────────────────────────────────────────
  useEffect(() => {
    const match = window.location.pathname.match(/^\/join\/([a-zA-Z0-9]+)$/);
    if (match) {
      localStorage.setItem("forged_pending_join", match[1]);
      // Clean up URL without reloading
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    const code = localStorage.getItem("forged_pending_join");
    if (!code) return;
    localStorage.removeItem("forged_pending_join");
    joinSharedGoal(code).then(result => {
      if (result?.success) {
        addToast(`✓ Joined "${result.goal.emoji} ${result.goal.name}"`);
        setScreen("social");
      } else if (result?.error) {
        addToast(`Invite: ${result.error}`);
      }
    });
  }, [sessionUserId]); // eslint-disable-line react-hooks/exhaustive-deps
  // ─────────────────────────────────────────────────────────────────────────────

  async function handleNotifToggle() {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
      alert("Notifications aren't supported in this browser. Try Chrome on Android or Safari on iOS 16.4+.");
      return;
    }
    setNotifLoading(true);
    try {
      if (notifEnabled) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq("user_id", sessionUserId);
        setNotifEnabled(false);
      } else {
        const permission = await Notification.requestPermission();
        setNotifPermission(permission);
        if (permission !== "granted") { setNotifLoading(false); return; }
        const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!vapidKey) { alert("Setup error: VAPID key missing."); setNotifLoading(false); return; }
        let reg;
        try {
          reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, rej) => setTimeout(() => rej(new Error("SW timeout")), 8000)),
          ]);
        } catch (swErr) {
          alert("Service worker not ready: " + swErr.message + ". Try reloading the app.");
          setNotifLoading(false); return;
        }
        let sub;
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          });
        } catch (subErr) {
          alert("Could not subscribe to push: " + subErr.message);
          setNotifLoading(false); return;
        }
        setNotifEnabled(true); // flip immediately — don't wait for DB
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { error: upsertErr } = await supabase.from("push_subscriptions").upsert({
          user_id: sessionUserId, subscription: sub.toJSON(),
          reminder_time: notifTime, notifications_enabled: true,
          timezone: tz, updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (upsertErr) alert("Saved to browser but DB save failed: " + upsertErr.message);
      }
    } catch (err) {
      alert("[Forged] Unexpected error: " + err.message);
      const reg2 = await navigator.serviceWorker.ready.catch(() => null);
      const sub2 = reg2 ? await reg2.pushManager.getSubscription().catch(() => null) : null;
      if (!sub2) setNotifEnabled(false);
    }
    setNotifLoading(false);
  }

  async function handleNotifTimeChange(newTime) {
    setNotifTime(newTime);
    if (!notifEnabled || !sessionUserId) return;
    await supabase.from("push_subscriptions").update({
      reminder_time: newTime, updated_at: new Date().toISOString(),
    }).eq("user_id", sessionUserId);
  }
  // ── End App-level notification ────────────────────────────────────────────────

  // ── Social: helpers ───────────────────────────────────────────────────────────
  function syncLastActive() {
    const uid = userIdRef.current;
    if (!uid || demoMode) return;
    const today = todayStr();
    const maxStreak = habits.length ? Math.max(0, ...habits.map(h => h.streak || 0)) : 0;
    supabase.from("profiles")
      .update({ last_active_date: today, current_streak: maxStreak })
      .eq("id", uid).then(() => {});
  }

  async function loadFriends(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    setFriendsLoading(true);
    try {
      const { data: fships } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id")
        .or(`requester_id.eq.${id},addressee_id.eq.${id}`)
        .eq("status", "accepted");
      if (!fships?.length) { setFriends([]); return; }
      const friendIds = fships.map(f => f.requester_id === id ? f.addressee_id : f.requester_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, avatar_url, xp, last_active_date, current_streak")
        .in("id", friendIds);
      const today = todayStr();
      setFriends((profiles || []).map(p => ({
        id: p.id,
        name: p.name || "Friend",
        avatarUrl: p.avatar_url,
        xp: p.xp || 0,
        streak: p.current_streak || 0,
        loggedToday: p.last_active_date === today,
        friendshipId: fships.find(f => f.requester_id === p.id || f.addressee_id === p.id)?.id,
      })).sort((a, b) => b.xp - a.xp));
    } catch(e) { console.warn("[Forged] loadFriends:", e); }
    finally { setFriendsLoading(false); }
  }

  async function loadFriendRequests(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    const { data: reqs } = await supabase
      .from("friendships")
      .select("id, requester_id, created_at")
      .eq("addressee_id", id)
      .eq("status", "pending");
    if (!reqs?.length) { setFriendRequests([]); return; }
    const { data: profiles } = await supabase
      .from("profiles").select("id, name, avatar_url").in("id", reqs.map(r => r.requester_id));
    setFriendRequests(reqs.map(r => ({
      friendshipId: r.id,
      requesterId:  r.requester_id,
      name:    profiles?.find(p => p.id === r.requester_id)?.name || "Someone",
      avatarUrl: profiles?.find(p => p.id === r.requester_id)?.avatar_url,
    })));
  }

  async function loadSentRequests(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    const { data: sent, error } = await supabase
      .from("friendships")
      .select("id, addressee_id, created_at")
      .eq("requester_id", id)
      .eq("status", "pending");
    if (error) {
      console.warn("[Forged] loadSentRequests:", error);
      setSentRequests([]);
      return;
    }
    if (!sent?.length) {
      setSentRequests([]);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", sent.map(r => r.addressee_id));
    setSentRequests(sent.map(r => ({
      friendshipId: r.id,
      addresseeId:  r.addressee_id,
      name:         profiles?.find(p => p.id === r.addressee_id)?.name || "Someone",
      avatarUrl:    profiles?.find(p => p.id === r.addressee_id)?.avatar_url,
    })));
  }

  async function sendFriendRequest(identifier) {
    const uid = userIdRef.current;
    if (!uid) return { error: "Not signed in" };
    const raw = (identifier || "").trim();
    if (!raw) return { error: "Enter their email or @username" };
    let targetId = null;
    if (raw.includes("@")) {
      const { data, error } = await supabase.rpc("find_user_by_email", { p_email: raw.toLowerCase() });
      if (error || !data) return { error: "No Forged account found with that email" };
      targetId = data;
    } else {
      const handle = raw.replace(/^@+/, "").trim();
      if (!handle) return { error: "Enter a username (letters, numbers, underscore)" };
      const { data, error } = await supabase.rpc("find_user_by_username", { p_username: handle });
      if (error || !data) {
        return { error: "No account with that username. They can set a @handle in Profile → Social." };
      }
      targetId = data;
    }
    if (targetId === uid) return { error: "That's you!" };
    const { data: existing } = await supabase.from("friendships").select("id, status")
      .or(`and(requester_id.eq.${uid},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${uid})`)
      .maybeSingle();
    if (existing?.status === "accepted") return { error: "Already friends!" };
    if (existing?.status === "pending")  return { error: "Request already sent" };
    const { error: err } = await supabase.from("friendships").insert({ requester_id: uid, addressee_id: targetId, status: "pending" });
    if (err) return { error: "Couldn't send — try again" };
    await loadSentRequests(uid);
    // Non-blocking push notification to recipient
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      fetch("/api/nudge-friend", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ recipientId: targetId, type: "friend_request" }),
      }).catch(() => {});
    });
    return { success: true };
  }

  async function acceptFriendRequest(friendshipId) {
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
    const uid = userIdRef.current;
    await Promise.all([loadFriends(uid), loadFriendRequests(uid), loadSentRequests(uid)]);
  }

  async function declineFriendRequest(friendshipId) {
    await supabase.from("friendships").update({ status: "declined" }).eq("id", friendshipId);
    const uid = userIdRef.current;
    await Promise.all([loadFriendRequests(uid), loadSentRequests(uid)]);
  }

  async function cancelFriendRequest(friendshipId) {
    await supabase.from("friendships").delete().eq("id", friendshipId);
    await loadSentRequests(userIdRef.current);
  }

  async function sendNudge(recipientId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { error: "Not signed in" };
      const res = await fetch("/api/nudge-friend", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ recipientId, type: "nudge" }),
      });
      if (res.status === 429) return { error: "Already nudged today" };
      if (!res.ok) return { error: "Couldn't send nudge" };
      return { success: true };
    } catch(e) {
      return { error: "Couldn't send nudge" };
    }
  }

  async function removeFriend(friendshipId) {
    await supabase.from("friendships").delete().eq("id", friendshipId);
    setFriends(f => f.filter(fr => fr.friendshipId !== friendshipId));
  }

  async function loadSharedGoals(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    setSharedGoalsLoading(true);
    try {
      const { data: memberships, error: memErr } = await supabase
        .from("shared_goal_members")
        .select("id, shared_goal_id, logs, joined_at")
        .eq("user_id", id);
      if (memErr) throw memErr;
      if (!memberships?.length) {
        setSharedGoals([]);
        return;
      }
      const goalIds = [...new Set(memberships.map(m => m.shared_goal_id))];
      const { data: goalsRows, error: goalsErr } = await supabase
        .from("shared_goals")
        .select("*")
        .in("id", goalIds);
      if (goalsErr) throw goalsErr;
      const goalById = Object.fromEntries((goalsRows || []).map(g => [g.id, g]));

      const rosterByGoalId = {};
      for (const goalId of goalIds) {
        const { data: roster, error: rpcErr } = await supabase.rpc("get_shared_goal_roster", { p_goal_id: goalId });
        if (rpcErr) {
          console.warn("[Forged] get_shared_goal_roster", goalId, rpcErr);
          rosterByGoalId[goalId] = [];
        } else {
          rosterByGoalId[goalId] = roster || [];
        }
      }

      setSharedGoals(memberships.map(m => {
        const goal = goalById[m.shared_goal_id];
        if (!goal) return null;
        const roster = rosterByGoalId[m.shared_goal_id] || [];
        const members = roster.map(mem => ({
          userId: mem.user_id,
          name: mem.name || "Member",
          avatarUrl: mem.avatar_url ?? mem.avatarUrl,
          logs: mem.logs || [],
          isMe: mem.user_id === id,
        }));
        return {
          id: goal.id,
          creatorId: goal.creator_id,
          name: goal.name,
          emoji: goal.emoji,
          habitType: goal.habit_type,
          weeklyTarget: goal.weekly_target,
          targetDate: goal.target_date,
          color: goal.color,
          inviteCode: goal.invite_code,
          myLogs: m.logs || [],
          myMembershipId: m.id,
          members,
        };
      }).filter(Boolean));
    } catch (e) {
      console.warn("[Forged] loadSharedGoals:", e);
    } finally {
      setSharedGoalsLoading(false);
    }
  }

  async function createSharedGoal({ name, emoji, habitType, weeklyTarget, color }) {
    if (createSharedGoalInFlightRef.current) {
      addToast("Please wait — creating a shared goal…");
      return undefined;
    }
    const uid = userIdRef.current;
    if (!uid || !name?.trim()) return null;
    createSharedGoalInFlightRef.current = true;
    try {
      const ht = habitType || "daily";
      const wt = ht === "weekly"
        ? Math.min(7, Math.max(1, Number(weeklyTarget) || 3))
        : null;
      const { data: goal, error } = await supabase.from("shared_goals")
        .insert({ creator_id: uid, name: name.trim(), emoji: emoji || "🎯",
          habit_type: ht, weekly_target: wt,
          color: color || "#C0392B" })
        .select().single();
      if (error || !goal) { addToast("Couldn't create goal"); return null; }
      await supabase.from("shared_goal_members").insert({ shared_goal_id: goal.id, user_id: uid, logs: [] });
      await loadSharedGoals(uid);
      return goal;
    } finally {
      createSharedGoalInFlightRef.current = false;
    }
  }

  async function shareHabit(habitId) {
    if (demoBounce()) return null;
    const uid = userIdRef.current;
    if (!uid) return null;
    if (sharingHabitIdRef.current) return null;
    sharingHabitIdRef.current = habitId;
    setSharingHabitId(habitId);
    try {
      const habit = habits.find(h => h.id === habitId);
      if (!habit || habit.sharedGoalId) return null;
      const newGoal = await createSharedGoal({
        name: habit.name,
        emoji: habit.emoji,
        habitType: habit.habitType,
        weeklyTarget: habit.weeklyTarget,
        color: habit.color,
      });
      if (newGoal === undefined) return null;
      if (!newGoal) return null;
      const { error } = await supabase.from("habits").update({ shared_goal_id: newGoal.id }).eq("id", habit.id);
      if (error) {
        console.error("[Forged] shareHabit link:", error);
        addToast("Couldn't link habit to shared goal");
        return null;
      }
      setHabits(prev => prev.map(h => h.id === habitId ? { ...h, sharedGoalId: newGoal.id } : h));
      return { ...newGoal, inviteCode: newGoal.invite_code };
    } finally {
      sharingHabitIdRef.current = null;
      setSharingHabitId(null);
    }
  }

  async function deleteSharedGoal(goalId) {
    const uid = userIdRef.current;
    if (!uid) {
      addToast("Not signed in");
      return { error: "Not signed in" };
    }
    const { data: goalRow, error: gErr } = await supabase.from("shared_goals")
      .select("id, creator_id").eq("id", goalId).maybeSingle();
    if (gErr || !goalRow) {
      addToast("Goal not found");
      return { error: "Goal not found" };
    }
    if (goalRow.creator_id !== uid) {
      addToast("Only the goal creator can delete it");
      return { error: "Only the person who created this goal can delete it" };
    }
    await supabase.from("habits").update({ shared_goal_id: null }).eq("user_id", uid).eq("shared_goal_id", goalId);
    const { error } = await supabase.from("shared_goals").delete().eq("id", goalId);
    if (error) {
      console.error("[Forged] deleteSharedGoal:", error);
      addToast("Couldn't delete — try again");
      return { error: "Couldn't delete — try again" };
    }
    setHabits(prev => prev.map(h => (h.sharedGoalId === goalId ? { ...h, sharedGoalId: undefined } : h)));
    await loadSharedGoals(uid);
    addToast("Shared goal removed");
    return { success: true };
  }

  async function handleShareHabit(habitId) {
    const goal = await shareHabit(habitId);
    if (!goal) return;
    const code = goal.invite_code ?? goal.inviteCode;
    const url = `${window.location.origin}/join/${code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) { /* ignore */ }
    addToast(`✓ Shared — invite code: ${code}`);
  }

  async function joinSharedGoal(inviteCode) {
    const uid = userIdRef.current;
    if (!uid) return { error: "Not signed in" };
    const { data: goal } = await supabase.from("shared_goals")
      .select("id, name, emoji").eq("invite_code", inviteCode).maybeSingle();
    if (!goal) return { error: "No goal found with that code" };
    const { data: existing } = await supabase.from("shared_goal_members")
      .select("id").eq("shared_goal_id", goal.id).eq("user_id", uid).maybeSingle();
    if (!existing) {
      await supabase.from("shared_goal_members").insert({ shared_goal_id: goal.id, user_id: uid, logs: [] });
    }
    await loadSharedGoals(uid);
    return { success: true, goal };
  }

  async function logSharedGoal(sharedGoalId, logEntry, opts = {}) {
    const uid = userIdRef.current;
    if (!uid) return;
    const { data: member } = await supabase.from("shared_goal_members")
      .select("id, logs").eq("shared_goal_id", sharedGoalId).eq("user_id", uid).single();
    if (!member) return;
    const today = todayStr();
    const newLogs = [...(member.logs || []).filter(l => l.date !== today), { date: today, ...logEntry }];
    await supabase.from("shared_goal_members").update({ logs: newLogs }).eq("id", member.id);
    setSharedGoals(prev => prev.map(g => g.id !== sharedGoalId ? g : {
      ...g, myLogs: newLogs,
      members: g.members.map(m => m.isMe ? { ...m, logs: newLogs } : m),
    }));
    syncLastActive();
    if (!opts.silent) addToast("✓ Logged");
  }
  // ── End social helpers ────────────────────────────────────────────────────────

  // ─── Supabase helpers ──────────────────────────────────────────────────────
  async function syncHabit(habit) {
    if (demoMode) return false;
    const uid = userIdRef.current;
    if (!uid) {
      console.warn("syncHabit: no user id — session not ready yet, skipping save");
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Session loading — please wait a moment and try again" }]);
      return false;
    }
    try {
      const { error } = await supabase.from("habits").upsert(habitToRow(habit, uid));
      if (error) {
        console.error("syncHabit error:", error.message);
        const id = Date.now();
        setToasts(t => [...t, { id, msg: "⚠️ Couldn't save — check your connection" }]);
        return false;
      }
      return true;
    } catch (err) {
      console.error("syncHabit exception:", err);
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Couldn't save — check your connection" }]);
      return false;
    }
  }

  async function syncGoal(goal) {
    if (demoMode) return false;
    const uid = userIdRef.current;
    if (!uid) {
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Session loading — please wait a moment and try again" }]);
      return false;
    }
    try {
      const { error } = await supabase.from("habits").upsert(goalToRow(goal, uid));
      if (error) {
        console.error("syncGoal error:", error.message);
        const id = Date.now();
        setToasts(t => [...t, { id, msg: "⚠️ Couldn't save goal — check your connection" }]);
        return false;
      }
      return true;
    } catch (err) {
      console.error("syncGoal exception:", err);
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Couldn't save goal — check your connection" }]);
      return false;
    }
  }

  /** @param {Record<string, unknown>} updates */
  async function syncProfile(updates, { quiet = false } = {}) {
    if (demoMode) return null;
    const uid = userIdRef.current;
    if (!uid) return null;
    const payload = { ...updates, updated_at: new Date().toISOString() };
    delete payload.id;
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) return null;
    const { error } = await supabase.from("profiles").update(clean).eq("id", uid);
    if (error) {
      console.warn("[Forged] syncProfile:", error.code, error.message, error);
      if (!quiet) {
        if (error.code === "23505") addToast("That @handle is already taken");
        else if (
          error.code === "42703"
          || error.code === "PGRST204"
          || /visible_to_friends_of_friends|schema cache|column/i.test(error.message || "")
        ) {
          addToast("Privacy setting needs the latest DB migration (profiles.visible_to_friends_of_friends). Run Supabase migrations, then reload.");
        } else {
          addToast(error.message || "Couldn't save profile");
        }
      }
      return error;
    }
    return null;
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

  /** @returns {Promise<boolean>} true if profile/habits were loaded and applied; false on hard failure */
  async function loadUserData(uid) {
    // Mutex: skip if already loading this uid
    if (loadingUidRef.current === uid) return false;
    loadingUidRef.current = uid;
    try {
      const FETCH_MS = 12000;
      async function runQueryWithTimeout(label, queryFactory) {
        const aborter = new AbortController();
        let timeoutId = null;
        const queryPromise = queryFactory(aborter.signal);
        const timeoutPromise = new Promise((_, rej) => {
          timeoutId = setTimeout(() => {
            aborter.abort();
            rej(new Error(`${label}_timeout`));
          }, FETCH_MS);
        });
        try {
          return await Promise.race([queryPromise, timeoutPromise]);
        } finally {
          if (timeoutId != null) clearTimeout(timeoutId);
        }
      }

      let profileRes;
      let habitsRes;
      try {
        profileRes = await runQueryWithTimeout("profile", (signal) =>
          supabase.from("profiles").select("*").eq("id", uid).single().abortSignal(signal)
        );

        habitsRes = await runQueryWithTimeout("habits", (signal) =>
          supabase.from("habits").select("*").eq("user_id", uid).order("created_at").abortSignal(signal)
        );
      } catch (err) {
        console.error("loadUserData: fetch failed —", err.message);
        accountDataLoadedRef.current = false;
        setAccountDataReady(false);
        return false;
      }

      const { data: profile, error: pErr } = profileRes;
      const { data: rows,    error: hErr  } = habitsRes;

      const profileFailed = pErr && pErr.code !== "PGRST116";
      const habitsFailed  = hErr != null;

      // Either query failing means data is incomplete — return false so the retry loop fires.
      // A genuine empty habits list returns hErr=null and rows=[], not an error.
      if (profileFailed) {
        console.error("[Forged] loadUserData: profile query failed — code:", pErr.code, "msg:", pErr.message);
        accountDataLoadedRef.current = false;
        setAccountDataReady(false);
        return false;
      }
      if (habitsFailed) {
        console.error("[Forged] loadUserData: habits query failed — code:", hErr.code, "msg:", hErr.message);
        accountDataLoadedRef.current = false;
        setAccountDataReady(false);
        return false;
      }

      let isOnboarded = null;

      if (profile) {
        setUser({
          id: profile.id,
          name: profile.name || "",
          avatarUrl: profile.avatar_url || null,
          username: profile.username || "",
          visibleToFriendsOfFriends: !!profile.visible_to_friends_of_friends,
        });
        setXp(profile.xp ?? 0);
        const proStatus = !!(profile.is_pro || profile.is_admin);
        setIsPro(proStatus);
        // Detect a completed payment on any sign-in path (session survived or user re-authenticated)
        if (proStatus && localStorage.getItem('forged_checkout_pending') === '1') {
          localStorage.removeItem('forged_checkout_pending');
          setShowWelcome(true);
        }
        setRefCode(profile.ref_code ?? null);
        setStripeCustomerId(profile.stripe_customer_id ?? null);
        setCoachName(profile.coach_name || "Coach");
        setCoachIcon((profile.coach_icon && String(profile.coach_icon).trim()) || "");
        isOnboarded = profile.onboarded ?? false;
        if (!isOnboarded && profile.name && profile.name.trim()) {
          isOnboarded = true;
          supabase.from("profiles").update({ onboarded: true, updated_at: new Date().toISOString() }).eq("id", uid);
        }
      } else {
        setStripeCustomerId(null);
      }

      if (rows && rows.length > 0) {
        if (isOnboarded === null) isOnboarded = false;
        if (!isOnboarded) {
          isOnboarded = true;
          supabase.from("profiles").upsert({ id: uid, onboarded: true, updated_at: new Date().toISOString() });
        }
      }

      if (isOnboarded === null) isOnboarded = false;
      setOnboarded(isOnboarded);

      if (rows) {
        const progressRows = rows.filter(r => r.habit_type === "progress");

        // Migrate legacy progress habits → goals (fire-and-forget DB update)
        if (progressRows.length > 0) {
          const progressIds = progressRows.map(r => r.id);
          supabase.from("habits")
            .update({ habit_type: "goal", goal_status: "active", updated_at: new Date().toISOString() })
            .in("id", progressIds)
            .then(({ error }) => {
              if (error) console.error("[Forged] progress→goal migration failed:", error.message);
            });
        }

        const { goals: nextGoals, habits: nextHabits } = splitDbRowsIntoGoalsAndHabits(rows);
        setGoals(nextGoals);
        setHabits(nextHabits);
      }

      userIdRef.current = uid;
      accountDataLoadedRef.current = true;
      setAccountDataReady(true);
      return true;
    } catch (err) {
      console.error("loadUserData exception:", err);
      accountDataLoadedRef.current = false;
      setAccountDataReady(false);
      return false;
    } finally {
      loadingUidRef.current = null;
    }
  }

  async function loadUserDataWithRetries(uid, source = "unknown") {
    if (retryLoadPromiseRef.current && retryLoadUidRef.current === uid) {
      return retryLoadPromiseRef.current;
    }

    retryLoadUidRef.current = uid;
    retryLoadPromiseRef.current = (async () => {
    // 300ms initial settle lets Chrome fully propagate the auth token
    // to the PostgREST client before the first query fires.
    // Subsequent retries use exponential backoff.
    const backoffs = [300, 1500, 3000, 6000, 10000];
    for (let attempt = 0; attempt < backoffs.length; attempt++) {
      await new Promise(r => setTimeout(r, backoffs[attempt]));
      if (attempt > 0) console.log(`[Forged] loadUserData retry ${attempt}/${backoffs.length - 1}`);
      if (await loadUserData(uid)) {
        return true;
      }
    }
    console.error("[Forged] loadUserDataWithRetries: all attempts failed for uid", uid?.slice(0, 8));
    return false;
    })();

    try {
      return await retryLoadPromiseRef.current;
    } finally {
      retryLoadPromiseRef.current = null;
      retryLoadUidRef.current = null;
    }
  }

  async function retryAccountDataLoad() {
    setAccountLoadError(false);
    setLoading(true);
    const retryBudget = setTimeout(() => setLoading(false), 32000);
    try {
      const { data: { session: preRefreshSession }, error: preSessionErr } = await supabase.auth.getSession();
      if (preSessionErr) console.warn("retryAccountDataLoad: getSession —", preSessionErr.message);
      const initialUid = preRefreshSession?.user?.id || sessionUserId;
      if (!initialUid) {
        setAuthScreen(true);
        return;
      }
      setSessionUserId(initialUid);
      if (preRefreshSession?.user?.email) setAuthEmail(preRefreshSession.user.email);

      const { error: refErr } = await supabase.auth.refreshSession();
      if (refErr) console.warn("retryAccountDataLoad: refreshSession —", refErr.message);
      const { data: { session: postRefreshSession }, error: postSessionErr } = await supabase.auth.getSession();
      if (postSessionErr) console.warn("retryAccountDataLoad: post-refresh getSession —", postSessionErr.message);
      const retryUid = postRefreshSession?.user?.id || initialUid;
      const ok = await loadUserDataWithRetries(retryUid, "manual-retry");
      if (!ok) setAccountLoadError(true);
      else setAuthScreen(false);
    } finally {
      clearTimeout(retryBudget);
      setLoading(false);
    }
  }

  // ─── Auth init ────────────────────────────────────────────────────────────
  // INITIAL_SESSION is the correct primary signal. It fires once Supabase has:
  //   1. Read the persisted session from localStorage
  //   2. Refreshed the access token if expired
  //   3. Determined the definitive initial auth state
  // getSession() can return null before that refresh completes — using it as
  // the primary signal is the root cause of "session looks gone on refresh".
  useEffect(() => {
    let mounted = true;

    // If INITIAL_SESSION never fires, fall back to auth (don't guess signed-in without data).
    const bailout = setTimeout(async () => {
      if (!mounted || initialAuthHandledRef.current) return;
      if (lastSignedInUidRef.current) {
        initialAuthHandledRef.current = true;
        const uid = lastSignedInUidRef.current;
        setSessionUserId(uid);
        setAccountLoadError(false);
        accountDataLoadedRef.current = false;
        setAccountDataReady(false);
        userIdRef.current = null;
        const ok = await loadUserDataWithRetries(uid, "BAILOUT_SIGNED_IN_FALLBACK");
        if (!mounted) return;
        if (!ok) setAccountLoadError(true);
        else setAccountLoadError(false);
        setAuthScreen(false);
        setLoading(false);
        return;
      }
      console.warn("Auth: INITIAL_SESSION did not fire within 12s");
      setAuthScreen(true);
      setLoading(false);
    }, 12000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      try {

        // ── Initial session ───────────────────────────────────────────────
        // Do not leave the loading screen until profile/habits load succeeds (or we show retry).
        if (event === "INITIAL_SESSION") {
          clearTimeout(bailout);
          // If profile/habits hang (blocked network / wrong origin), never leave the user on a dead spinner.
          const LOAD_BUDGET_MS = 32000;
          const loadBudgetTimer = setTimeout(() => {
            if (!mounted) return;
            console.warn("Auth: account load exceeded budget — unblocking UI (use Retry if needed)");
            setLoading(false);
            setAuthScreen(false);
            if (session?.user?.id) setAccountLoadError(true);
          }, LOAD_BUDGET_MS);

          initialAuthHandledRef.current = true;
          try {
            if (session?.user?.id) {
              if (session.user.email) setAuthEmail(session.user.email);
              setSessionUserId(session.user.id);
              setAccountLoadError(false);
              accountDataLoadedRef.current = false;
              setAccountDataReady(false);
              userIdRef.current = null;
              const ok = await loadUserDataWithRetries(session.user.id, "INITIAL_SESSION");
              if (!mounted) return;
              if (ok) setAccountLoadError(false);
              else setAccountLoadError(true);
              setAuthScreen(false);
            } else {
              // Mobile browsers can transiently emit INITIAL_SESSION(null) before storage hydration settles.
              // Probe once synchronously before routing to demo/auth to avoid unnecessary sign-in prompts.
              const { data: { session: lateSession }, error: lateSessionErr } = await supabase.auth.getSession();
              if (lateSessionErr) console.warn("Auth: INITIAL_SESSION null probe getSession —", lateSessionErr.message);
              if (lateSession?.user?.id) {
                if (lateSession.user.email) setAuthEmail(lateSession.user.email);
                setSessionUserId(lateSession.user.id);
                setAccountLoadError(false);
                accountDataLoadedRef.current = false;
                setAccountDataReady(false);
                userIdRef.current = null;
                const ok = await loadUserDataWithRetries(lateSession.user.id, "INITIAL_SESSION_NULL_PROBE");
                if (!mounted) return;
                if (ok) setAccountLoadError(false);
                else setAccountLoadError(true);
                setAuthScreen(false);
                return;
              }
              setSessionUserId(null);
              setAccountLoadError(false);
              accountDataLoadedRef.current = false;
              setAccountDataReady(false);
              userIdRef.current = null;
              if (mounted) {
                if (!shownDemoRef.current) {
                  shownDemoRef.current = true;
                  setHabits(buildDemoHabits());
                  setUser({ name:"", avatarUrl:null });
                  setDemoMode(true);
                } else {
                  setAuthScreen(true);
                }
              }
            }
          } finally {
            clearTimeout(loadBudgetTimer);
            if (mounted) setLoading(false);
          }
          return;
        }

        // ── Explicit sign-in ──────────────────────────────────────────────
        // Supabase fires SIGNED_IN immediately after INITIAL_SESSION for existing sessions.
        // We must not interfere with an in-progress INITIAL_SESSION load.
        if (event === "SIGNED_IN" && session?.user?.id) {
          lastSignedInUidRef.current = session.user.id;
          if (!initialAuthHandledRef.current) {
            if (session.user.email && mounted) setAuthEmail(session.user.email);
            setSessionUserId(session.user.id);
            setAuthScreen(false);
            return;
          }
          if (session.user.email && mounted) setAuthEmail(session.user.email);
          setSessionUserId(session.user.id);

          // Case 1: data already fully loaded for this user — just update UI
          if (accountDataLoadedRef.current && userIdRef.current === session.user.id) {
            if (mounted) { setAuthScreen(false); setPendingEmail(null); setPasswordRecovery(false); setDemoMode(false); }
            return;
          }
          // Case 2: INITIAL_SESSION (or a prior SIGNED_IN) is already loading this uid — don't
          // interfere. The in-progress loader will finish and set all state correctly. If we let
          // this handler continue it will hit the mutex on every retry and conclude with an error.
          if (loadingUidRef.current === session.user.id) {
            if (mounted) { setAuthScreen(false); setPendingEmail(null); setPasswordRecovery(false); setDemoMode(false); }
            return;
          }

          setDemoMode(false);
          setHabits([]); // clear demo data before loading real data
          setAccountLoadError(false);
          accountDataLoadedRef.current = false;
          setAccountDataReady(false);
          userIdRef.current = null;
          setLoading(true);
          const signInBudget = setTimeout(() => {
            if (!mounted) return;
            console.warn("Auth: sign-in load exceeded budget — unblocking UI");
            setLoading(false);
            setAuthScreen(false);
            setAccountLoadError(true);
          }, 32000);
          try {
            const ok = await loadUserDataWithRetries(session.user.id, "SIGNED_IN");
            if (mounted) {
              setAuthScreen(false);
              setPendingEmail(null);
              setPasswordRecovery(false);
              if (!ok) setAccountLoadError(true);
              else setAccountLoadError(false);
            }
          } finally {
            clearTimeout(signInBudget);
            if (mounted) setLoading(false);
          }
          return;
        }

        // ── Sign-out ──────────────────────────────────────────────────────
        if (event === "SIGNED_OUT") {
          clearTimeout(bailout);
          userIdRef.current     = null;
          loadingUidRef.current = null;
          accountDataLoadedRef.current = false;
          setSessionUserId(null);
          setAccountDataReady(false);
          setAccountLoadError(false);
          setHabits([]);
          setUser({ name: "", avatarUrl: null });
          setXp(0);
          setCoachName("Coach");
          setCoachIcon("");
          setOnboarded(null);
          setIsPro(false);
          setStripeCustomerId(null);
          setRefCode(null);
          setAuthEmail(null);
          localStorage.removeItem('forged_checkout_pending');
          shownDemoRef.current = true; // after sign-out, go to auth not demo
          setDemoMode(false);
          if (mounted) { setAuthScreen(true); setLoading(false); }
          return;
        }

        // ── Token refresh ─────────────────────────────────────────────────
        // After idle, JWT renews but PostgREST may have failed earlier; reload if data never loaded.
        if (event === "TOKEN_REFRESHED" && session?.user?.id) {
          if (session.user.email && mounted) setAuthEmail(session.user.email);
          if (loadingUidRef.current === session.user.id) {
            return;
          }
          if (!accountDataLoadedRef.current) {
            setLoading(true);
            const tokenBudget = setTimeout(() => {
              if (!mounted) return;
              setLoading(false);
              setAuthScreen(false);
              setAccountLoadError(true);
            }, 32000);
            try {
              const ok = await loadUserDataWithRetries(session.user.id, "TOKEN_REFRESHED");
              if (mounted) {
                setAuthScreen(false);
                if (!ok) setAccountLoadError(true);
                else setAccountLoadError(false);
              }
            } finally {
              clearTimeout(tokenBudget);
              if (mounted) setLoading(false);
            }
          }
          return;
        }

        // ── Password recovery ─────────────────────────────────────────────
        if (event === "PASSWORD_RECOVERY") {
          if (mounted) { setPasswordRecovery(true); setAuthScreen(false); setLoading(false); }
          return;
        }

      } catch (err) {
        console.error("auth event error:", err);
        if (mounted) setLoading(false);
      }
    });

    return () => { mounted = false; clearTimeout(bailout); subscription.unsubscribe(); };
  }, []);

  // ─── Session + data refresh on resume / bfcache ──────────────────────────────
  useEffect(() => {
    function runResumeLoad() {
      // Ignore visibilitychange that Chrome fires on initial page load (<5s since mount)
      const now = Date.now();
      if (now - mountTimeRef.current < 5000) return;
      if (now - lastResumeDataFetchRef.current < 5000) return;
      lastResumeDataFetchRef.current = now;
      (async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) return;
        if (loadingUidRef.current === session.user.id) return;
        await loadUserDataWithRetries(session.user.id, "resume");
      })();
    }
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      runResumeLoad();
    }
    function onPageShow(e) {
      if (e.persisted) runResumeLoad();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // Sync XP to profile whenever it changes (after init)
  const xpInitRef = useRef(false);
  useEffect(() => {
    if (loading || !accountDataReady) return;
    if (!xpInitRef.current) { xpInitRef.current = true; return; }
    void syncProfile({ xp }, { quiet: true });
  }, [xp, loading, accountDataReady]);

  // All hooks must be declared before any conditional returns
  const addToast = useCallback(msg => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg }]);
  }, []);

  /** Clear the other editor first so goal vs habit modals never stack (flushSync avoids stale editId + editGoalId in one tick). */
  const openEditGoal = useCallback(rawId => {
    const g = resolveGoalForModal(rawId, goals, habits);
    flushSync(() => { setEditId(null); });
    setEditGoalId(g ? g.id : null);
  }, [goals, habits]);
  const openEditHabit = useCallback(rawId => {
    const goalMatch = goals.find(g => entityIdEq(g.id, rawId));
    if (goalMatch) {
      openEditGoal(goalMatch.id);
      return;
    }
    const habitMatch = habits.find(h => entityIdEq(h.id, rawId));
    if (habitMatch && (isGoalLikeHabitType(habitMatch) || isLegacyProgressType(habitMatch.habitType))) {
      openEditGoal(rawId);
      return;
    }
    flushSync(() => { setEditGoalId(null); });
    setEditId(habitMatch ? habitMatch.id : null);
  }, [goals, habits, openEditGoal]);

  const reflectHabit = habits.find(h => entityIdEq(h.id, reflectId)) || null;
  const editHabit    = habits.find(h => entityIdEq(h.id, editId))    || null;
  const logHabit     = habits.find(h => entityIdEq(h.id, logId))     || null;

  // Capture ?ref= from URL and handle ?checkout=success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && /^[A-Z2-9]{6}$/.test(ref)) {
      localStorage.setItem("forged_pending_ref", ref);
    }
    if (params.get("checkout") === "success") {
      // Clean URL, then poll until webhook fires (up to ~15s)
      window.history.replaceState({}, "", window.location.pathname);
      setCheckingPayment(true);
      let attempts = 0;
      const pollId = setInterval(async () => {
        attempts++;
        const uid = userIdRef.current;
        if (!uid) {
          // Auth not loaded yet — keep waiting up to 15 cycles
          if (attempts > 15) { setCheckingPayment(false); clearInterval(pollId); }
          return;
        }
        const { data } = await supabase
          .from("profiles")
          .select("is_pro, is_admin")
          .eq("id", uid)
          .single();
        if (data?.is_pro || data?.is_admin) {
          setIsPro(true);
          setCheckingPayment(false);
          clearInterval(pollId);
          localStorage.removeItem('forged_checkout_pending');
          setShowWelcome(true);
        } else if (attempts >= 15) {
          // Webhook hasn't fired yet — drop back to paywall; user can reload
          localStorage.removeItem('forged_checkout_pending');
          setCheckingPayment(false);
          clearInterval(pollId);
        }
      }, 1000);
    }
  }, []);

  const coachNudgeShellActive =
    !loading &&
    !authScreen &&
    !passwordRecovery &&
    sessionUserId != null &&
    accountDataReady &&
    !accountLoadError &&
    !demoMode &&
    !previewOnboarding &&
    onboarded !== false &&
    !checkingPayment;

  useEffect(() => {
    if (!coachNudgeShellActive) {
      setCoachPageNudge(null);
      return;
    }
    if (screen === "profile") {
      setCoachPageNudge(null);
      return;
    }
    const text = COACH_PAGE_NUDGES[screen];
    if (!text) {
      setCoachPageNudge(null);
      return;
    }
    const id = ++coachNudgeSeqRef.current;
    setCoachPageNudge({ id, text });
    const t = setTimeout(() => {
      setCoachPageNudge(prev => (prev && prev.id === id ? null : prev));
    }, COACH_NUDGE_DURATION_MS);
    return () => clearTimeout(t);
  }, [screen, coachNudgeShellActive]);

  async function completeOnboarding({ name, habits: newHabits, coachName: newCoachName }) {
    const uid = userIdRef.current;
    const resolvedCoach = newCoachName || "Coach";
    setUser({ name });
    setXp(0);
    setCoachName(resolvedCoach);
    const habitsToSet = (newHabits && newHabits.length > 0) ? newHabits : [];
    setHabits(habitsToSet);
    setOnboarded(true);
    const pendingRef = localStorage.getItem("forged_pending_ref") || null;
    if (uid) {
      await supabase.from("profiles").upsert({
        id: uid, name, xp: 0, onboarded: true, coach_name: resolvedCoach, updated_at: new Date().toISOString(),
        ...(pendingRef ? { referred_by: pendingRef } : {}),
      });
      if (pendingRef) localStorage.removeItem("forged_pending_ref");
      if (habitsToSet.length > 0) {
        await supabase.from("habits").upsert(habitsToSet.map(h => habitToRow(h, uid)));
      }
    }
    // Tour disabled — re-enable by restoring tourSteps/tourIdx state and this block
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
      <AuthScreen onSent={email => setPendingEmail(email)} checkoutPending={localStorage.getItem('forged_checkout_pending') === '1'} /></>
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

  // Signed in but profile/habits failed after retries — never show empty main as if "no data"
  if (!loading && !authScreen && sessionUserId && accountLoadError) {
    return (
      <><style>{CSS}</style>
      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 28px", textAlign:"center", gap:16 }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forged.</div>
        <div style={{ fontSize:15, color:T.muted, lineHeight:1.7 }}>
          You&apos;re signed in, but we couldn&apos;t load your profile and habits. Check your connection and try again.
        </div>
        <button type="button" onClick={() => retryAccountDataLoad()}
          style={{ padding:"14px 24px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer" }}>
          Retry
        </button>
        <button type="button" onClick={() => window.location.reload()}
          style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
          Refresh page
        </button>
      </div></>
    );
  }

  // Should not happen often: session exists but data gate not satisfied yet
  if (!loading && !authScreen && sessionUserId && !accountDataReady && !accountLoadError) {
    return (
      <><style>{CSS}</style>
      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forged.</div>
        <div style={{ width:22, height:22, border:`2px solid ${T.border}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
        <div style={{ fontSize:12, color:T.hint }}>Loading your account…</div>
      </div></>
    );
  }

  // Demo mode — show app with seed data before sign-up
  if (!loading && demoMode) {
    return (
      <>
        <style>{CSS}</style>
        {toasts.map(t => <Toast key={t.id} msg={t.msg} onDone={() => setToasts(ts => ts.filter(x => x.id !== t.id))}/>)}
        <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, paddingBottom:104 }}>
          <DemoBanner onGetStarted={() => { setDemoMode(false); setHabits([]); shownDemoRef.current = true; setAuthScreen(true); }} />
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 18px 8px" }}>
            <div>
              <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
              <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{fmtDate()}</div>
            </div>
            <button onClick={() => { setDemoMode(false); setHabits([]); shownDemoRef.current = true; setAuthScreen(true); }}
              style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(200,144,42,0.12)", borderRadius:20, padding:"6px 13px", fontSize:13, fontWeight:500, color:T.gold, border:"none", cursor:"pointer" }}>
              ⚡ 0 xp
            </button>
          </div>
          <TodayScreen habits={habits} goals={goals} xp={0} onTap={handleTap} onUndo={() => {}} onSkip={() => {}} onAddNote={() => demoBounce()} onLogZero={() => demoBounce()} onOpenLog={() => demoBounce()} onOpenGoalLog={() => demoBounce()} onEditGoal={openEditGoal} onCompleteGoal={() => demoBounce()} onDeleteGoal={() => demoBounce()} onEditHabit={openEditHabit} onDeleteHabit={() => demoBounce()} onXPInfo={() => {}} onAdd={() => demoBounce()}/>
          <nav style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:430, maxWidth:"100vw", background:"linear-gradient(180deg, rgba(38,38,34,0.98) 0%, rgba(22,22,19,0.99) 100%)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderTop:`1px solid rgba(200,144,42,0.2)`, boxShadow:"0 -6px 32px rgba(0,0,0,0.5)", display:"flex", zIndex:100, paddingTop:8, paddingBottom:"max(11px, env(safe-area-inset-bottom, 0px))" }}>
            {[{id:"today",label:"Today"},{id:"journal",label:"Journal"},{id:"insights",label:"Insights"},{id:"social",label:"Social"},{id:"profile",label:"Profile"}].map(n => (
              <button key={n.id} onClick={() => demoBounce()} style={{ flex:1, padding:"9px 4px 6px", border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, fontSize:10, fontWeight:600, color:n.id==="today"?T.accent:T.muted, letterSpacing:"0.02em" }}>
                {n.label}
              </button>
            ))}
          </nav>
        </div>
        {/* Same edit modals as signed-in shell — demo branch previously omitted them, so Edit appeared to do nothing. */}
        {editGoalId    && (() => { const g = resolveGoalForModal(editGoalId, goals, habits); return g ? <EditGoalModal goal={g} onClose={() => setEditGoalId(null)} onSave={handleEditGoalSave}/> : null; })()}
        {editId && !editGoalId && editHabit && !isGoalLikeHabitType(editHabit) && <EditModal habit={editHabit} onClose={() => setEditId(null)} onSave={handleEditSave}/>}
      </>
    );
  }

  // Admin preview of onboarding — safe mode, no DB writes, no Stripe redirect
  if (!loading && !authScreen && previewOnboarding) {
    return (
      <><style>{CSS}</style>
      <div style={{ position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", zIndex:9999, background:"rgba(200,144,42,0.18)", borderBottom:`1px solid ${T.gold}`, padding:"6px 18px", fontSize:11, color:T.gold, fontFamily:T.font, width:430, maxWidth:"100vw", textAlign:"center", boxSizing:"border-box" }}>
        🔒 Preview mode — no changes will be saved
      </div>
      <OnboardingScreen
        onComplete={() => setPreviewOnboarding(false)}
        onSaveProgress={() => Promise.resolve()}
        onCheckout={() => {
          addToast("Preview mode — Stripe skipped");
          setPreviewOnboarding(false);
          return Promise.resolve();
        }}
        onSkip={() => setPreviewOnboarding(false)}
        notifEnabled={notifEnabled}
        notifLoading={notifLoading}
        notifPermission={notifPermission}
        onNotifToggle={handleNotifToggle}
      /></>
    );
  }

  // Show onboarding — only after account data loaded and user is genuinely new.
  if (!loading && !authScreen && accountDataReady && onboarded === false) {
    return (
      <><style>{CSS}</style>
      <OnboardingScreen
        onComplete={completeOnboarding}
        onSaveProgress={async ({ name, habits, coachName }) => {
          const uid = userIdRef.current;
          if (!uid) return;
          await supabase.from("profiles").upsert({
            id: uid, name, xp: 0, onboarded: true,
            coach_name: coachName, updated_at: new Date().toISOString(),
          });
          const hRows = habits.map(h => habitToRow(h, uid));
          if (hRows.length > 0) await supabase.from("habits").upsert(hRows);
        }}
        onCheckout={async () => {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) throw new Error("Not signed in");
          const res = await fetch("/api/create-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ plan: "monthly" }),
          });
          const json = await res.json();
          if (!res.ok || !json.url) throw new Error(json.error || "Could not start checkout");
          localStorage.setItem('forged_checkout_pending', '1');
          window.location.href = json.url;
        }}
        onSkip={() => {
          setOnboarded(true);
          syncProfile({ onboarded: true, name: user.name || "", xp: 0 });
        }}
        notifEnabled={notifEnabled}
        notifLoading={notifLoading}
        notifPermission={notifPermission}
        onNotifToggle={handleNotifToggle}
      /></>
    );
  }

  // Confirming payment after Stripe redirect — poll until webhook fires
  if (!loading && !authScreen && accountDataReady && onboarded && checkingPayment) {
    return (
      <><style>{CSS}</style>
      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text }}>Forged.</div>
        <div style={{ width:22, height:22, border:`2px solid ${T.border}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
        <div style={{ fontSize:13, color:T.muted }}>Confirming your payment…</div>
      </div></>
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

  // Demo mode: intercept any write action and nudge user to sign up
  function demoBounce() {
    if (!demoMode) return false;
    const id = Date.now();
    setToasts(t => [...t, { id, msg: "Create a free account to start tracking for real →" }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
    return true;
  }

  // Tap handler: daily, weekly, limit
  async function handleTap(id, e) {
    if (demoBounce()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const base = habits.find(h => h.id === id);
    if (!base) return;
    let tapped = null;
    if (base.habitType === "limit") {
      const today = todayStr();
      const inc = base.tapIncrement ?? 1;
      const logsWithoutNoneToday = base.logs.filter(l => !(l.date === today && l.value === 0));
      tapped = { ...base, logs:[...logsWithoutNoneToday, { date:today, value:inc, note:"" }] };
    } else {
      const logged = base.logs.some(l => l.date === todayStr());
      tapped = logged
        ? { ...base, logs: base.logs.filter(l => l.date !== todayStr()) }
        : { ...base, logs:[...base.logs, { date:todayStr(), value:true, note:"" }] };
    }
    const saved = await syncHabit(tapped);
    if (!saved) return;
    setHabits(prev => prev.map(h => h.id === id ? tapped : h));
    syncLastActive();
    const todayD = todayStr();
    const sgId = base.sharedGoalId;
    if (sgId) {
      if (base.habitType === "limit") {
        const prevN = base.logs.filter(l => l.date === todayD).length;
        const nextN = tapped.logs.filter(l => l.date === todayD).length;
        if (nextN > prevN) void logSharedGoal(sgId, { value: true, note: "" }, { silent: true });
      } else {
        const wasLogged = base.logs.some(l => l.date === todayD && l.value === true);
        const nowLogged = tapped.logs.some(l => l.date === todayD && l.value === true);
        if (!wasLogged && nowLogged) void logSharedGoal(sgId, { value: true, note: "" }, { silent: true });
      }
    }
    // Limit + taps never award XP or celebration — usage logging is not rewarded.
    if (tapped.habitType === "limit") return;
    const today = todayStr();
    const awardKey = `${id}:${today}`;
    const alreadyEarnedToday = xpAwardedDates.has(awardKey) || base.logs.some(l => l.date === today && l.value === true);
    if (!alreadyEarnedToday) {
      spawnParticles(cx, cy, tapped.color);
      addFlash(cx, cy, "+10 xp");
      setXp(x => x + 10);
      setXpAwardedDates(prev => {
        const next = new Set(prev);
        next.add(awardKey);
        return next;
      });
    }
  }

  // Log handler: project
  async function handleLog(id, logData) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const already = habit.logs.some(l => l.date === todayStr());
    const isNew = habit.habitType === "project" || !already;
    const updated = isNew
      ? { ...habit, logs:[...habit.logs, { date:todayStr(), ...logData }] }
      : { ...habit, logs: habit.logs.map(l => l.date === todayStr() ? { ...l, ...logData } : l) };
    const saved = await syncHabit(updated);
    if (!saved) return;
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    if (habit.habitType === "project") {
      const today = todayStr();
      const firstKey = `project-first:${id}:${today}`;
      const bonusKey = `project-target:${id}:${today}`;
      const targetMins = habit.dailyTargetMinutes ?? 60;
      const prevMins = habit.logs.filter(l => l.date === today).reduce((s, l) => s + (l.value?.minutes || 0), 0);
      const nextMins = updated.logs.filter(l => l.date === today).reduce((s, l) => s + (l.value?.minutes || 0), 0);
      let xpGain = 0;
      let earnedFirst = false;
      let earnedBonus = false;
      if (prevMins === 0 && !xpAwardedDates.has(firstKey)) {
        xpGain += 10;
        earnedFirst = true;
      }
      if (prevMins < targetMins && nextMins >= targetMins && !xpAwardedDates.has(bonusKey)) {
        xpGain += 10;
        earnedBonus = true;
      }
      if (xpGain > 0) {
        addFlash(window.innerWidth / 2, 120, `+${xpGain} xp`);
        setXp(x => x + xpGain);
        setXpAwardedDates(prev => {
          const next = new Set(prev);
          if (earnedFirst) next.add(firstKey);
          if (earnedBonus) next.add(bonusKey);
          return next;
        });
      }
    } else if (isNew) {
      addFlash(window.innerWidth / 2, 120, "+10 xp");
      setXp(x => x + 10);
    }
  }

  // Undo last limit tap: remove the most recent *numeric* log for today (never quicknotes / skip strings)
  async function handleUndoLimit(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const today = todayStr();
    const numericToday = habit.logs
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.date === today && typeof l.value === "number");
    if (!numericToday.length) return;
    const removeIdx = numericToday[numericToday.length - 1].i;
    const updated = { ...habit, logs: habit.logs.filter((_, i) => i !== removeIdx) };
    const saved = await syncHabit(updated);
    if (!saved) return;
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    addToast("↩ Last tap removed");
  }

  async function handleSkipDay(id, note = "") {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const today = todayStr();
    const withoutToday = habit.logs.filter(l => l.date !== today);
    const updated = { ...habit, logs:[...withoutToday, { date:today, value:"skip", note: note || "" }] };
    const saved = await syncHabit(updated);
    if (!saved) return;
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    addToast("🛡️ Rest day — streak protected");
  }

  // Add a quick note as a standalone log entry — each Done tap creates a separate record
  async function handleAddNote(id, text) {
    if (!text.trim()) return false;
    const habit = habits.find(h => h.id === id);
    if (!habit) return false;
    const updated = { ...habit, logs: [...habit.logs, { date: todayStr(), value: "quicknote", note: text.trim() }] };
    const saved = await syncHabit(updated);
    if (!saved) return false;
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    return true;
  }

  // Explicitly log 0 for a limit habit — marks "had none today" as a conscious choice
  async function handleLogZero(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const today = todayStr();
    const todayNumeric = habit.logs.filter(l => l.date === today && typeof l.value === "number");
    if (todayNumeric.some(l => l.value === 0)) return;
    const usageToday = todayNumeric.filter(l => l.value !== 0);
    let nextLogs;
    if (usageToday.length > 0) {
      const used = usageToday.reduce((s, l) => s + l.value, 0);
      const unit = habit.unit?.trim();
      const amountLabel = unit ? `${used} ${unit}` : String(used);
      const ok = window.confirm(`You've already logged ${amountLabel} today. Mark as none instead?`);
      if (!ok) return;
      nextLogs = habit.logs.filter(l => !(l.date === today && typeof l.value === "number"));
      nextLogs = [...nextLogs, { date: today, value: 0, note: "" }];
    } else {
      nextLogs = [...habit.logs, { date: today, value: 0, note: "" }];
    }
    const updated = { ...habit, logs: nextLogs };
    const saved = await syncHabit(updated);
    if (!saved) return;
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    const noneTodayXpKey = `limit-none:${id}:${today}`;
    if (!xpAwardedDates.has(noneTodayXpKey)) {
      addFlash(window.innerWidth / 2, 120, "+15 xp");
      setXp(x => x + 15);
      setXpAwardedDates(prev => {
        const next = new Set(prev);
        next.add(noneTodayXpKey);
        return next;
      });
    }
    addToast("✓ Logged — none today");
  }

  // Reflection: save to most recent today log, or create standalone entry
  async function handleSaveReflection(id, text) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const logs = [...habit.logs];
    const idx = logs.map(l => l.date).lastIndexOf(todayStr());
    if (idx >= 0) logs[idx] = { ...logs[idx], reflection:text };
    else logs.push({ date:todayStr(), value:null, note:"", reflection:text });
    const reflected = { ...habit, logs };
    const saved = await syncHabit(reflected);
    if (!saved) {
      addToast("⚠️ Couldn't save reflection — check your connection");
      return;
    }
    setHabits(prev => prev.map(h => h.id === id ? reflected : h));
    addToast("✓ Reflection saved");
  }

  // Edit save
  async function handleEditSave(id, updates) {
    const habit = habits.find(h => entityIdEq(h.id, id));
    if (!habit) return;
    const edited = { ...habit, ...updates };
    if (demoMode) {
      setHabits(prev => prev.map(h => (entityIdEq(h.id, id) ? edited : h)));
      setEditId(null);
      addToast("Preview only — create a free account to save edits.");
      return;
    }
    const saved = await syncHabit(edited);
    if (!saved) {
      addToast("⚠️ Couldn't update habit — check your connection");
      return;
    }
    setHabits(prev => prev.map(h => (entityIdEq(h.id, id) ? edited : h)));
    addToast("✓ Habit updated");
  }

  // Gate adding habits at 5 for free users
  function handleStartAdd() {
    if (demoBounce()) return;
    // On Today, show choice sheet (habit or goal), then AddModal or AddGoalModal.
    if (screen === "today") {
      setShowAddChoice(true);
    } else if (!isPro && habits.length >= 5) {
      setShowUpgrade(true);
    } else {
      setShowAdd(true);
    }
  }

  // Add a new habit
  async function handleAddHabit(h) {
    const saved = await syncHabit(h);
    if (!saved) {
      addToast("⚠️ Couldn't add habit — check your connection");
      return;
    }
    setHabits(p => [...p, h]);
    setShowAdd(false);
    addToast("✓ Habit added");
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
      if (rows) {
        const { goals: nextGoals, habits: nextHabits } = splitDbRowsIntoGoalsAndHabits(rows);
        setGoals(nextGoals);
        setHabits(nextHabits);
      }
    }
  }

  async function handleAddGoal(goal) {
    const saved = await syncGoal(goal);
    if (!saved) {
      addToast("⚠️ Couldn't add goal — check your connection");
      return;
    }
    setGoals(prev => [...prev, goal]);
    setShowAddGoal(false);
    addToast("✓ Goal added");
  }

  async function handleLogGoal(id, value, note) {
    const goal = resolveGoalForModal(id, goals, habits);
    if (!goal) return;
    const newLogs = [...goal.logs, { date: todayStr(), value, note: note || "" }];
    const updated = {
      ...goal,
      currentValue: value,
      logs: newLogs,
      lastLogDate: todayStr(),
      status: getGoalProgress({ ...goal, currentValue: value }).isComplete ? "completed" : goal.status,
    };
    const saved = await syncGoal(updated);
    if (!saved) return;
    setGoals(prev => {
      const idx = prev.findIndex(g => entityIdEq(g.id, id));
      if (idx === -1) return [...prev, updated];
      return prev.map(g => (entityIdEq(g.id, id) ? updated : g));
    });
    setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
    const today = todayStr();
    const awardKey = `goal:${id}:${today}`;
    if (xpAwardedDates.has(awardKey)) return;
    const prevValue = Number(goal.currentValue);
    const nextValue = Number(value);
    if (!Number.isFinite(prevValue) || !Number.isFinite(nextValue)) return;
    if (nextValue === prevValue) return;
    const target = Number(goal.targetValue);
    const prevDist = Math.abs(target - prevValue);
    const nextDist = Math.abs(target - nextValue);
    const xpGain = nextDist < prevDist ? 15 : 5;
    if (xpGain > 0) {
      addFlash(window.innerWidth / 2, 120, `+${xpGain} xp`);
      setXp(x => x + xpGain);
      setXpAwardedDates(prev => {
        const next = new Set(prev);
        next.add(awardKey);
        return next;
      });
    }
  }

  async function handleDeleteGoal(id) {
    const uid = userIdRef.current;
    if (!uid) return;
    setGoals(prev => prev.filter(g => g.id !== id));
    await supabase.from("habits").delete().eq("id", id).eq("user_id", uid);
  }

  async function handleCompleteGoal(id) {
    const goal = resolveGoalForModal(id, goals, habits);
    if (!goal) return;
    const updated = { ...goal, status: "completed" };
    const saved = await syncGoal(updated);
    if (!saved) {
      addToast("⚠️ Couldn't complete goal — check your connection");
      return;
    }
    setGoals(prev => {
      const idx = prev.findIndex(g => entityIdEq(g.id, id));
      if (idx === -1) return [...prev, updated];
      return prev.map(g => (entityIdEq(g.id, id) ? updated : g));
    });
    setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
    addToast("✓ Goal completed");
  }

  async function handleEditGoalSave(id, updates) {
    const goal = resolveGoalForModal(id, goals, habits);
    if (!goal) return;
    const updated = { ...goal, ...updates };
    if (demoMode) {
      setGoals(prev => {
        const idx = prev.findIndex(g => entityIdEq(g.id, id));
        if (idx === -1) return [...prev, updated];
        return prev.map(g => (entityIdEq(g.id, id) ? updated : g));
      });
      setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
      setEditGoalId(null);
      addToast("Preview only — create a free account to save edits.");
      return;
    }
    const saved = await syncGoal(updated);
    if (!saved) {
      addToast("⚠️ Couldn't update goal — check your connection");
      return;
    }
    setGoals(prev => {
      const idx = prev.findIndex(g => entityIdEq(g.id, id));
      if (idx === -1) return [...prev, updated];
      return prev.map(g => (entityIdEq(g.id, id) ? updated : g));
    });
    setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
    addToast("✓ Goal updated");
  }

  /** Remove one log row from a habit or goal (Journal). XP is unchanged. */
  async function handleDeleteJournalLogEntry(entity, logEntry) {
    const isGoal = entity.habitType === "goal";
    const id = entity.id;
    if (isGoal) {
      const g = resolveGoalForModal(id, goals, habits);
      if (!g) return false;
      const idx = g.logs.indexOf(logEntry);
      if (idx === -1) return false;
      const nextLogs = g.logs.filter((_, i) => i !== idx);
      const updated = goalStateAfterLogRemoval(g, nextLogs);
      const saved = await syncGoal(updated);
      if (!saved) return false;
      setGoals(prev => {
        const idx = prev.findIndex(x => entityIdEq(x.id, id));
        if (idx === -1) return [...prev, updated];
        return prev.map(x => (entityIdEq(x.id, id) ? updated : x));
      });
      setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
      addToast("✓ Entry removed");
      return true;
    }
    const h = habits.find(x => x.id === id);
    if (!h) return false;
    const idx = h.logs.indexOf(logEntry);
    if (idx === -1) return false;
    const updated = { ...h, logs: h.logs.filter((_, i) => i !== idx) };
    const saved = await syncHabit(updated);
    if (!saved) return false;
    setHabits(prev => prev.map(x => x.id === id ? updated : x));
    addToast("✓ Entry removed");
    return true;
  }

  async function handleSignOut() {
    // onAuthStateChange will fire SIGNED_OUT and handle all state resets
    await supabase.auth.signOut();
  }

  const NAV = [
    { id:"today",    label:"Today",    icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id:"journal",  label:"Journal",  icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="4" y="3" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
    { id:"insights", label:"Insights", icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 15l4-5 3 3 4-6 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { id:"social",   label:"Social",   icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden><circle cx="7.5" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M3 16.5c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="14.5" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M11 16.5c0-1.7 1.1-3.1 2.6-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id:"profile",  label:"Profile",  icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  ];

  return (
    <>
      <style>{CSS}</style>
      {particles.map(p => <Particle key={p.id} {...p} onDone={() => setParticles(ps => ps.filter(x => x.id !== p.id))}/>)}
      {flashes.map(f   => <XPFlash  key={f.id} {...f} onDone={() => setFlashes(fs  => fs.filter(x  => x.id !== f.id))}/>)}
      {toasts.map(t    => <Toast    key={t.id} msg={t.msg} onDone={() => setToasts(ts => ts.filter(x => x.id !== t.id))}/>)}

      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, paddingBottom:104 }}>
        {/* Top bar */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"22px 18px 8px" }}>
          <div>
            <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:1, lineHeight:1.35 }}>
              {screen === "today"
                ? fmtDateLong()
                : screen === "profile" ? user.name : screen.charAt(0).toUpperCase()+screen.slice(1)}
            </div>
          </div>
          <button onClick={() => setShowXP(true)} style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(200,144,42,0.12)", borderRadius:20, padding:"6px 13px", fontSize:13, fontWeight:500, color:T.gold, border:"none", cursor:"pointer" }}>
            ⚡ {xp} xp
          </button>
        </div>

        {/* Notification nudge banner — shown on Today screen when not enabled */}
        {screen === "today" && !notifEnabled && !notifNudgeDismissed && notifPermission !== "denied" && (
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px", background:"rgba(200,144,42,0.1)", borderBottom:`0.5px solid rgba(200,144,42,0.22)` }}>
            <span style={{ fontSize:16, flexShrink:0 }}>🔔</span>
            <span style={{ flex:1, fontSize:12, color:T.sub, lineHeight:1.5 }}>Get daily reminders to keep your streak.</span>
            <button
              onClick={handleNotifToggle}
              disabled={notifLoading}
              style={{ flexShrink:0, padding:"5px 12px", borderRadius:16, border:"none", background:T.gold, color:"#0F0F0D", fontSize:12, fontWeight:700, cursor:"pointer", opacity:notifLoading?0.7:1 }}
            >
              {notifLoading ? "…" : "Enable"}
            </button>
            <button
              onClick={() => { setNotifNudgeDismissed(true); localStorage.setItem("forged_notif_nudge_dismissed","1"); }}
              style={{ flexShrink:0, width:24, height:24, borderRadius:"50%", border:"none", background:"none", color:T.muted, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}
              aria-label="Dismiss"
            >×</button>
          </div>
        )}
        {screen === "today"    && <TodayScreen    habits={habits} goals={goals} xp={xp} onTap={handleTap} onUndo={handleUndoLimit} onSkip={handleSkipDay} onAddNote={handleAddNote} onLogZero={handleLogZero} onOpenLog={id => setLogId(id)} onOpenGoalLog={id => setLogGoalId(id)} onEditGoal={openEditGoal} onCompleteGoal={handleCompleteGoal} onDeleteGoal={handleDeleteGoal} onEditHabit={openEditHabit} onDeleteHabit={handleDeleteHabit} onShareHabit={handleShareHabit} sharingHabitId={sharingHabitId} onXPInfo={() => setShowXP(true)} onAdd={handleStartAdd} hideFloatingAdd/>}
        {screen === "journal"  && <JournalScreen habits={habits} goals={goals} onReflect={setReflectId} onDeleteJournalLog={handleDeleteJournalLogEntry} journalUserId={sessionUserId} isPro={isPro} onUpgrade={() => setShowUpgrade(true)}/>}
        {screen === "insights" && <InsightsScreen habits={habits} goals={goals} onShowHistory={() => setShowHistory(true)} onShare={() => setShowShare(true)}/>}
        {screen === "social"   && <SocialScreen
          user={user} xp={xp} habits={habits}
          friends={friends} friendRequests={friendRequests} sentRequests={sentRequests} friendsLoading={friendsLoading}
          onSendRequest={sendFriendRequest} onAccept={acceptFriendRequest}
          onDecline={declineFriendRequest} onRemoveFriend={removeFriend} onCancelSentRequest={cancelFriendRequest}
          sharedGoals={sharedGoals} sharedGoalsLoading={sharedGoalsLoading}
          onCreateSharedGoal={createSharedGoal} onJoinSharedGoal={joinSharedGoal}
          onLogSharedGoal={logSharedGoal}
          onShareHabit={handleShareHabit}
          currentUserId={sessionUserId}
          onDeleteSharedGoal={deleteSharedGoal}
          onNudgeFriend={sendNudge}
        />}
        {screen === "profile"  && <ProfileScreen  user={user} xp={xp} habits={habits} isPro={isPro} stripeCustomerId={stripeCustomerId} refCode={refCode}
          authEmail={authEmail}
          onUpgrade={() => setShowUpgrade(true)}
          onUpdateUser={updates => {
            if (updates._clearData) { setHabits([]); setXp(0); setUser(u => ({...u})); return; }
            setUser(u => {
              const next = { ...u, ...updates };
              const profilePatch = { name: next.name };
              if (updates.avatarUrl !== undefined) profilePatch.avatar_url = updates.avatarUrl;
              if (updates.username !== undefined) {
                const raw = updates.username === "" || updates.username == null
                  ? null
                  : String(updates.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
                const stored = raw && raw.length > 0 ? raw : null;
                profilePatch.username = stored;
                next.username = stored || "";
              }
              if (updates.visibleToFriendsOfFriends !== undefined) {
                profilePatch.visible_to_friends_of_friends = !!next.visibleToFriendsOfFriends;
              }
              const prevFof = !!u.visibleToFriendsOfFriends;
              const prevUsername = u.username || "";
              const revertOnErr = updates.visibleToFriendsOfFriends !== undefined || updates.username !== undefined;
              void (async () => {
                const err = await syncProfile(profilePatch);
                if (err && revertOnErr) {
                  if (updates.visibleToFriendsOfFriends !== undefined) {
                    setUser(ux => ({ ...ux, visibleToFriendsOfFriends: prevFof }));
                  }
                  if (updates.username !== undefined) {
                    setUser(ux => ({ ...ux, username: prevUsername }));
                  }
                }
              })();
              return next;
            });
          }}
          onResetOnboarding={() => setOnboarded(false)}
          onPreviewOnboarding={() => setPreviewOnboarding(true)}
          onSignOut={handleSignOut}
          onShowTour={() => { setScreen("today"); setTimeout(() => { setTourSteps(GLOBAL_TOUR); setTourIdx(0); }, 120); }}
          coachName={coachName}
          coachIcon={coachIcon}
          onSaveCoach={({ name, icon }) => {
            setCoachName(name);
            setCoachIcon(icon);
            syncProfile({ coach_name: name, coach_icon: icon });
          }}
          notifEnabled={notifEnabled}
          notifTime={notifTime}
          notifLoading={notifLoading}
          notifPermission={notifPermission}
          onNotifToggle={handleNotifToggle}
          onNotifTimeChange={handleNotifTimeChange}
        />}

        {/* Coach FAB (+ Today-only Add habit below) — hidden on Profile */}
        {screen !== "profile" && (() => {
          const coachLabelRaw = (coachName ?? "").trim() || "Coach";
          const coachLabelShort = coachLabelRaw.length > 13 ? `${coachLabelRaw.slice(0, 12)}…` : coachLabelRaw;
          const showTodayAdd =
            screen === "today" &&
            (habits.length > 0 || goals.some(g => g.status !== "completed"));
          return (
            <div
              data-tour="coach-fab"
              style={{
                position:"fixed",
                left:14,
                bottom:108,
                zIndex:102,
                display:"flex",
                flexDirection:"column",
                alignItems:"flex-start",
                justifyContent:"flex-end",
                gap:10,
              }}
            >
              <div
                style={{
                  display:"flex", flexDirection:"row", alignItems:"center", justifyContent:"flex-start",
                  gap:10,
                }}
              >
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, flexShrink:0 }}>
                  <button
                    type="button"
                    onClick={() => setShowCoach(true)}
                    aria-label={`${coachLabelRaw} — AI coach`}
                    title={`${coachLabelRaw} — AI coach`}
                    style={{
                      width:44, height:44,
                      borderRadius:"50%", border:`0.5px solid ${T.borderMid}`,
                      background:"rgba(30,30,28,0.96)", backdropFilter:"blur(10px)",
                      color:T.sub, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      boxShadow:"0 2px 14px rgba(0,0,0,0.4)",
                    }}
                  >
                    {coachIcon && COACH_ICON_OPTIONS.includes(coachIcon) ? (
                      <span style={{ fontSize:20, lineHeight:1 }} aria-hidden>{coachIcon}</span>
                    ) : (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M12 2l1.8 5.9L20 10l-6.2 2.1L12 22l-1.8-9.9L4 10l6.2-2.1L12 2z" fill="currentColor" opacity="0.92"/>
                      </svg>
                    )}
                  </button>
                  <span
                    style={{
                      fontSize:10, fontWeight:700, color:T.gold, textAlign:"center", lineHeight:1.25,
                      maxWidth:92, wordBreak:"break-word", letterSpacing:"0.02em",
                      textShadow:"0 1px 10px rgba(0,0,0,0.75)",
                    }}
                  >
                    {coachLabelShort}
                  </span>
                </div>
                {coachPageNudge && (
                  <div
                    key={coachPageNudge.id}
                    role="status"
                    aria-live="polite"
                    style={{
                      pointerEvents:"none",
                      maxWidth:200,
                      padding:"9px 12px",
                      borderRadius:12,
                      background:"rgba(24,24,22,0.96)",
                      backdropFilter:"blur(12px)",
                      WebkitBackdropFilter:"blur(12px)",
                      border:"0.5px solid rgba(200,144,42,0.32)",
                      boxShadow:"0 4px 22px rgba(0,0,0,0.38)",
                      fontSize:12,
                      lineHeight:1.45,
                      color:T.sub,
                      textAlign:"left",
                      animation:`coachNudge ${COACH_NUDGE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
                      userSelect:"none",
                      flexShrink:1,
                    }}
                  >
                    {coachPageNudge.text}
                  </div>
                )}
              </div>
              {showTodayAdd && (
                <button
                  type="button"
                  onClick={handleStartAdd}
                  aria-label="Add habit or goal"
                  title="Add habit or goal"
                  style={{
                    height:44,
                    padding:"0 14px 0 12px",
                    borderRadius:22,
                    border:"none",
                    background:T.accent,
                    color:"#fff",
                    fontSize:13,
                    fontWeight:700,
                    lineHeight:1,
                    cursor:"pointer",
                    boxShadow:"0 3px 14px rgba(192,57,43,0.32)",
                    display:"flex",
                    alignItems:"center",
                    justifyContent:"center",
                    gap:6,
                    fontFamily:T.font,
                  }}
                >
                  <span style={{ fontSize:18, fontWeight:700, lineHeight:1, marginTop:1 }} aria-hidden>+</span>
                  <span>Add habit</span>
                </button>
              )}
            </div>
          );
        })()}

        {/* Bottom nav */}
        <nav data-tour="nav" style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:430, maxWidth:"100vw", background:"linear-gradient(180deg, rgba(38,38,34,0.98) 0%, rgba(22,22,19,0.99) 100%)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderTop:`1px solid rgba(200,144,42,0.2)`, boxShadow:"0 -6px 32px rgba(0,0,0,0.5)", display:"flex", zIndex:100, paddingTop:8, paddingBottom:"max(11px, env(safe-area-inset-bottom, 0px))" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setScreen(n.id)} style={{ flex:1, padding:"9px 4px 6px", border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, fontSize:10, fontWeight:600, color:screen===n.id?T.accent:T.muted, letterSpacing:"0.02em", transition:"color 0.15s" }}>
              {n.icon}{n.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Modals */}
      {showAdd       && <AddModal      onClose={() => setShowAdd(false)}     onSave={handleAddHabit}/>}
      {showAddGoal   && <AddGoalModal  onClose={() => setShowAddGoal(false)} onSave={handleAddGoal}/>}
      {showAddChoice && <AddActionSheet onAddHabit={() => { setShowAddChoice(false); setShowAdd(true); }} onAddGoal={() => { setShowAddChoice(false); setShowAddGoal(true); }} onClose={() => setShowAddChoice(false)}/>}
      {showCoachTeaser && <CoachComingSoonSheet onClose={() => setShowCoachTeaser(false)} coachName={coachName} context={screen}/>}
      {logGoalId     && (() => { const g = resolveGoalForModal(logGoalId, goals, habits); return g ? <LogGoalModal goal={g} onClose={() => setLogGoalId(null)} onLog={(id, val, note) => { handleLogGoal(id, val, note); setLogGoalId(null); }}/> : null; })()}
      {editGoalId    && (() => { const g = resolveGoalForModal(editGoalId, goals, habits); return g ? <EditGoalModal goal={g} onClose={() => setEditGoalId(null)} onSave={handleEditGoalSave}/> : null; })()}
      {showXP        && <XPModal       xp={xp}                               onClose={() => setShowXP(false)}/>}
      {showHistory   && <HistoryModal  habits={habits} isPro={isPro} onUpgrade={() => setShowUpgrade(true)} onClose={() => setShowHistory(false)}/>}
      {reflectId     && <ReflectModal  habit={reflectHabit}                  onClose={() => setReflectId(null)} onSave={handleSaveReflection}/>}
      {editId && !editGoalId && editHabit && !isGoalLikeHabitType(editHabit) && <EditModal habit={editHabit} onClose={() => setEditId(null)} onSave={handleEditSave}/>}
      {logId && logHabit?.habitType === "project"  && <LogProjectModal   habit={logHabit} onClose={() => setLogId(null)} onLog={handleLog}/>}
      {showCoach   && <AICoach habits={habits} user={user} isPro={isPro} onClose={() => setShowCoach(false)} onUpgrade={() => setShowUpgrade(true)} coachName={coachName} currentScreen={screen} onHabitCreated={h => setHabits(p => [...p, h])} onGoalCreated={g => setGoals(p => [...p, g])} onHabitLogged={(id, logs) => setHabits(p => p.map(h => String(h.id) === String(id) ? { ...h, logs } : h))} onHabitRenamed={(id, name) => setHabits(p => p.map(h => String(h.id) === String(id) ? { ...h, name } : h))}/>}
      {showUpgrade && <BetaPaywallModal onClose={() => setShowUpgrade(false)}/>}
      {showShare && <ShareCardModal user={user} habits={habits} xp={xp} onClose={() => setShowShare(false)}/>}
      {showWelcome && <WelcomeModal onContinue={() => setShowWelcome(false)} />}
      {/* TourOverlay disabled — restore tourSteps state and this block to re-enable */}
    </>
  );
}
