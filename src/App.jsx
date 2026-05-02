
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { flushSync, createPortal } from "react-dom";
import { supabase, habitToRow, rowToHabit, rowToGoal, goalToRow } from "./supabase.js";

/** Installed “Add to Home Screen” Web App (standalone), including iOS Safari PWA. */
function isLikelyHomeScreenPwa() {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch { /* ignore */ }
  return window.navigator.standalone === true;
}

/**
 * Returns true if Supabase has stored any session tokens in localStorage.
 * Supabase v2 stores session as "sb-{project-ref}-auth-token".
 * We use this to distinguish "genuinely new/signed-out user" (no tokens → show demo)
 * from "returning user with an expired access token being refreshed" (tokens exist → wait).
 * Prevents ghost-account flash on deployed apps where INITIAL_SESSION fires null
 * while Supabase is mid-refresh of an expired access token.
 */
function hasStoredSupabaseSession() {
  if (typeof localStorage === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      // Supabase v2: { access_token, refresh_token, ... }
      // Wrapped form:  { data: { session: { access_token, refresh_token } } }
      if (parsed?.refresh_token || parsed?.access_token) return true;
      if (parsed?.data?.session?.access_token || parsed?.data?.session?.refresh_token) return true;
    }
  } catch { /* ignore — read-only check, never throws to caller */ }
  return false;
}

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

// ─── GOAL PLAN PARSING ────────────────────────────────────────────────────────
/**
 * Extract and parse a <goal_plan>{json}</goal_plan> block from a coach message.
 * Returns { plan, textWithout } if found and valid, or null.
 * plan shape: { name, emoji, unit, startValue, targetValue, direction,
 *               targetDate, milestones: [{date, label}], why }
 */
function parseGoalPlan(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/<goal_plan>([\s\S]*?)<\/goal_plan>/);
  if (!match) return null;
  try {
    const plan = JSON.parse(match[1].trim());
    if (!plan.name || plan.targetValue == null) return null;
    const textWithout = text.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim();
    return { plan, textWithout };
  } catch {
    return null;
  }
}

/**
 * While a <goal_plan> block is still streaming (opening tag present, closing
 * tag not yet received), strip everything from the opening tag onward so the
 * user never sees raw partial JSON in the chat bubble.
 */
function stripPartialGoalPlan(text) {
  if (!text || typeof text !== "string") return text;
  // Complete block handled by parseGoalPlan — only strip incomplete ones
  if (/<\/goal_plan>/.test(text)) return text; // let parseGoalPlan handle it
  return text.replace(/<goal_plan>[\s\S]*$/, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Split coach reply into conversational body + server-appended action receipt (separator from api/chat.js). */
function splitCoachReceipt(text) {
  if (!text || typeof text !== "string") return { main: text, receipt: null };
  const sep = "\n───\n";
  const idx = text.indexOf(sep);
  if (idx === -1) return { main: text, receipt: null };
  return {
    main: text.slice(0, idx).trimEnd(),
    receipt: text.slice(idx + sep.length).trim(),
  };
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
  log:      { label:"Log",            desc:"Simple dated notes — journal-style, no streaks or targets.", icon:"📝" },
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
/**
 * Whether this trackable counts toward the Today forged ring.
 * Weekly: session today, weekly rest day (skip), or weekly target already met this week.
 * Daily: done or rest — not raw isLoggedToday (avoids quicknote-only false positives).
 */
function isSatisfiedForTodayRing(h) {
  const t = todayStr();
  if (h.habitType === "weekly") {
    const target = Math.max(1, Number(h.weeklyTarget) || 1);
    if (hasRestDay(h, t)) return true;
    if (getWeeklyCount(h) >= target) return true;
    return h.logs.some(l => l.date === t && l.value === true);
  }
  if (h.habitType === "daily") {
    return hasDailyCompletion(h, t) || hasRestDay(h, t);
  }
  if (h.habitType === "log") return false;
  return isLoggedToday(h);
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
/** Session count in the current Mon–Sun week (matches Today weekly habits). */
function sharedMemberWeekSessionCount(logs) {
  const ws = currentWeekStart();
  return (logs || []).filter(l => l.date >= ws && l.value === true).length;
}

/** Map in-app habit / goal row → accountability habit kind for log projection. */
function linkedKindForSharedSync(linked) {
  const ht = linked?.habitType;
  if (ht === "progress") return "goal";
  if (ht) return ht;
  // Personal progress goals from DB often omit habitType in older in-memory state — infer so we never project as "daily".
  if (Number.isFinite(Number(linked?.targetValue))) return "goal";
  return "daily";
}

/**
 * Build shared_goal_members.logs from the linked personal Today row (source of truth).
 * Replaces legacy social-only logging so accountability matches real personal progress.
 */
function projectPersonalLogsForSharedMember(linked) {
  const kind = linkedKindForSharedSync(linked);
  const logs = linked.logs || [];
  const sortedTrueDays = () => logs
    .filter(l => l?.date && l.value === true)
    .map(l => ({ date: l.date, value: true }))
    .sort((a, b) => a.date.localeCompare(b.date));
  switch (kind) {
    case "daily":
    case "weekly":
      return sortedTrueDays();
    case "project":
      return logs
        .filter(l => l?.date && l.value && typeof l.value === "object" && Number(l.value.minutes) > 0)
        .map(l => ({ date: l.date, value: true }))
        .sort((a, b) => a.date.localeCompare(b.date));
    case "goal": {
      const byDate = new Map();
      for (const l of logs) {
        if (!l?.date) continue;
        const n = typeof l.value === "number" ? l.value : Number(l.value);
        if (!Number.isFinite(n)) continue;
        byDate.set(l.date, { date: l.date, value: n, note: l.note ? String(l.note) : "" });
      }
      return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    }
    case "limit": {
      const sums = {};
      for (const l of logs) {
        if (!l?.date || typeof l.value !== "number" || l.value === 0) continue;
        sums[l.date] = (sums[l.date] || 0) + l.value;
      }
      return Object.keys(sums)
        .sort()
        .map(date => ({ date, value: sums[date] }));
    }
    default:
      return sortedTrueDays();
  }
}

/** Normalize habit types that must map onto shared_goals.habit_type check constraint. */
function normalizeSharedGoalHabitType(ht) {
  const t = String(ht || "daily").trim();
  if (t === "progress") return "goal";
  return t;
}

function nudgeWatermarkStorageKey(uid) {
  return `forged_nudge_watermark_${uid}`;
}
function readNudgeWatermark(uid) {
  try {
    return localStorage.getItem(nudgeWatermarkStorageKey(uid)) || "";
  } catch {
    return "";
  }
}
function writeNudgeWatermarkIfNewer(uid, isoTs) {
  if (!uid || !isoTs) return;
  try {
    const k = nudgeWatermarkStorageKey(uid);
    const prev = localStorage.getItem(k) || "";
    if (isoTs > prev) localStorage.setItem(k, isoTs);
  } catch { /* ignore quota */ }
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

/** Compare auth user ids from PostgREST / RPC (string UUID, optional casing or column shape differences). */
function sameUserId(a, b) {
  if (a == null || b == null) return false;
  const norm = v => String(v).replace(/-/g, "").toLowerCase();
  return norm(a) === norm(b);
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
    habitType: "goal",
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
    sharedGoalId: h.sharedGoalId ?? undefined,
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
  if (h.habitType === "log") return 0;
  if (h.habitType === "weekly")  return getWeeklyStreak(h);
  if (h.habitType === "limit")   return getLimitStreak(h);
  if (h.habitType === "project") return getBuildStreak(h);
  return getDailyStreak(h); // daily (default)
}

/** Subtitle suffix for habit cards — hides misleading 🔥 1 when the streak is only "today" with no prior day. */
function getHabitCardStreakSuffix(h) {
  if (h.habitType === "log") return "";
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
    const ideal = Math.max(1, (h.weeklyTarget || 1) * 4);
    const sessions = recent.filter(l => l.value === true).length;
    return Math.min(100, Math.round((sessions / ideal) * 100));
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

/**
 * Best-day-of-week signal, computed across all habits + goals "real" logs.
 * Returns { counts: [Mon..Sun], total, best: { label, count }|null, needsMoreData: bool }.
 * needsMoreData stays true below a small threshold so we don't lie with a 1-sample pattern.
 */
function getBestDayOfWeek(allRealLogs) {
  const counts = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
  const uniqueDays = new Set();
  for (const l of allRealLogs) {
    if (!l?.date) continue;
    uniqueDays.add(l.date);
    const d = parseLocal(l.date);
    if (!d) continue;
    // JS: 0=Sun..6=Sat → convert to Mon=0..Sun=6 for app consistency.
    const js = d.getDay();
    const idx = js === 0 ? 6 : js - 1;
    counts[idx]++;
  }
  const total = counts.reduce((s, n) => s + n, 0);
  const needsMoreData = uniqueDays.size < 7 || total < 7;
  let bestIdx = -1, bestVal = 0;
  counts.forEach((n, i) => { if (n > bestVal) { bestVal = n; bestIdx = i; } });
  const LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    counts,
    total,
    needsMoreData,
    best: bestIdx >= 0 && bestVal > 0 ? { label: LABELS[bestIdx], count: bestVal, idx: bestIdx } : null,
  };
}

// ─── DEEP INSIGHTS (from real user-written text) ──────────────────────────────
// Everything below here powers the "Deeper insights" section on the Insights
// screen. It runs entirely on-device (no LLM tokens) against text the user has
// actually written: reflections, notes, project wins, project hard-parts, and
// goal notes. Results are cached with a content-hash + 24h TTL so we don't re-
// crunch on every render or re-open of the Insights tab.

/**
 * Gather every piece of user-written context into a single flat array of
 * `{ date, text, source, habitId?, habitName?, goalId?, goalName? }` entries.
 * Sorted oldest → newest. Skips empty strings. Never includes XP/streak
 * numbers, just real written content.
 */
// One corpus entry = one writing-DAY for one habit/goal. Earlier this function
// returned a separate entry per text fragment (reflection / note / win /
// hardPart), which inflated counts: a single project log could become 4
// "entries" and the Insights card would say "30 entries about X" when the
// user had only written on 7 days. Deduping per (habitId|goalId, date) keeps
// every honest count downstream — themes, tone, "most reflected on", etc.
function getWrittenCorpus(habits = [], goals = []) {
  const byKey = new Map();
  function ensure(key, baseFields) {
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...baseFields,
        reflText: "",
        noteText: "",
        winText: "",
        hardText: "",
        sources: new Set(),
      });
    }
    return byKey.get(key);
  }
  function append(prev, next) { return prev ? prev + " " + next : next; }

  for (const h of habits || []) {
    for (const l of h.logs || []) {
      if (!l?.date) continue;
      if (l.value === "skip") continue;
      const refl = String(l.reflection || "").trim();
      const note = String(l.note || "").trim();
      const win  = (l.value && typeof l.value === "object") ? String(l.value.win      || "").trim() : "";
      const hard = (l.value && typeof l.value === "object") ? String(l.value.hardPart || "").trim() : "";
      const isQuickNote = l.value === "quicknote";
      if (!refl && !note && !win && !hard) continue;
      const key = `h:${h.id}:${l.date}`;
      const e = ensure(key, { date: l.date, kind: "habit", habitId: h.id, habitName: h.name });
      if (refl) { e.reflText = append(e.reflText, refl); e.sources.add("reflection"); }
      if (note) { e.noteText = append(e.noteText, note); e.sources.add(isQuickNote ? "quicknote" : "note"); }
      if (win)  { e.winText  = append(e.winText,  win);  e.sources.add("win"); }
      if (hard) { e.hardText = append(e.hardText, hard); e.sources.add("hard"); }
    }
  }
  for (const g of goals || []) {
    for (const l of g.logs || []) {
      if (!l?.date) continue;
      const note = String(l.note || "").trim();
      if (!note) continue;
      const key = `g:${g.id}:${l.date}`;
      const e = ensure(key, { date: l.date, kind: "goal", goalId: g.id, goalName: g.name });
      e.noteText = append(e.noteText, note);
      e.sources.add("goalNote");
    }
  }
  return [...byKey.values()]
    .map(e => {
      const text = [e.reflText, e.noteText, e.winText, e.hardText].filter(Boolean).join("  ");
      return { ...e, sources: [...e.sources], text };
    })
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// Tiny lexicon for rough polarity scoring — not a sentiment model, just a
// coarse signal. Kept short so the tone card fires conservatively.
const DEEP_POS_WORDS = new Set([
  "good","great","awesome","nice","happy","love","easy","strong","focused",
  "clear","proud","energized","better","best","excited","calm","grateful",
  "motivated","solid","amazing","smooth","confident","progress","done","hit",
  "crushed","flowed","grounded","present","pumped","fresh","sharp","light",
  "consistent","hopeful","positive","relaxed","content","productive",
]);
const DEEP_NEG_WORDS = new Set([
  "bad","awful","tired","stressed","anxious","worried","sad","angry",
  "frustrated","hard","difficult","struggle","struggling","heavy","sluggish",
  "drained","overwhelmed","scared","stuck","lost","fail","failed","missed",
  "procrastinated","procrastinating","exhausted","burnt","burned","lonely",
  "annoyed","distracted","worse","flat","foggy","rough","bored","low",
  "unmotivated","shitty","crap",
]);

function getTextTone(text) {
  const words = String(text).toLowerCase().match(/[a-z']+/g) || [];
  let pos = 0, neg = 0;
  for (const w of words) {
    if (DEEP_POS_WORDS.has(w)) pos++;
    if (DEEP_NEG_WORDS.has(w)) neg++;
  }
  const score = pos - neg;
  let polarity = "neutral";
  if (score > 0) polarity = "pos";
  else if (score < 0) polarity = "neg";
  return { pos, neg, score, polarity };
}

// Filler / function words we never want to surface as "themes". Kept inline
// rather than imported so we don't pay for a dictionary dependency.
const DEEP_STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","so","because","as","i","me",
  "my","mine","we","our","ours","you","your","yours","to","of","in","on","at",
  "for","with","by","from","about","into","out","up","down","over","under",
  "is","am","are","was","were","be","been","being","do","does","did","done",
  "have","has","had","will","would","could","should","might","may","can",
  "cant","dont","not","no","yes","just","more","less","very","really","still",
  "already","also","too","maybe","today","tomorrow","yesterday","day","days",
  "week","weeks","month","months","year","years","time","some","any","all",
  "got","get","gets","go","goes","went","made","make","making","think",
  "thought","feel","felt","know","knew","that","this","those","these","it",
  "its","he","she","they","them","their","there","here","when","what","which",
  "who","why","how","him","her","his","hers","us","ours","yourself","myself",
  "people","thing","things","something","anything","everything","nothing",
  "want","wanted","need","needed","like","liked","try","tried","trying",
  "lot","bit","sort","kind","back","around","ago","since","after","before",
  "again","away","through","during","while","until","very","than","even",
  "much","most","many","few","little","big","small","own","same","other",
  "another","each","every","off","only","once","now","soon","yet","ever",
]);

function bestDeepSampleForTerm(entry, term) {
  const safe = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${safe}`, "i");
  const subs = [
    entry.reflText && { date: entry.date, text: entry.reflText, kind: "reflection", habitName: entry.habitName, goalName: entry.goalName },
    entry.noteText && { date: entry.date, text: entry.noteText, kind: "note", habitName: entry.habitName, goalName: entry.goalName },
    entry.winText  && { date: entry.date, text: entry.winText,  kind: "win", habitName: entry.habitName, goalName: entry.goalName },
    entry.hardText && { date: entry.date, text: entry.hardText, kind: "hard", habitName: entry.habitName, goalName: entry.goalName },
  ].filter(Boolean);
  const matching = subs.filter(s => re.test(s.text));
  const pool = matching.length ? matching : subs;
  if (!pool.length) return null;
  return pool.sort((a, b) => Math.min(b.text.length, 220) - Math.min(a.text.length, 220))[0];
}

/** Words that bridge multiple habits/goals — stronger signal than raw frequency. */
function getCrossHabitLinks(corpus, k = 4) {
  const termTo = new Map();
  for (const e of corpus) {
    const sourceKey =
      e.kind === "habit" && e.habitId ? `h:${e.habitId}` :
      e.kind === "goal" && e.goalId ? `g:${e.goalId}` :
      null;
    if (!sourceKey) continue;
    const words = String(e.text).toLowerCase().match(/[a-z][a-z']+/g) || [];
    const seenInEntry = new Set();
    for (const w of words) {
      if (w.length < 4 || w.length > 18) continue;
      if (DEEP_STOPWORDS.has(w)) continue;
      if (seenInEntry.has(w)) continue;
      seenInEntry.add(w);
      if (!termTo.has(w)) {
        termTo.set(w, { sourceKeys: new Set(), labels: new Map(), writingDays: 0, bestSample: null });
      }
      const rec = termTo.get(w);
      rec.sourceKeys.add(sourceKey);
      rec.labels.set(sourceKey, e.habitName || e.goalName || "Track");
      rec.writingDays++;
      const cand = bestDeepSampleForTerm(e, w);
      if (cand && (!rec.bestSample || cand.text.length > rec.bestSample.text.length)) rec.bestSample = cand;
    }
  }
  return [...termTo.entries()]
    .filter(([, r]) => r.sourceKeys.size >= 2 && r.writingDays >= 2)
    .sort((a, b) => b[1].sourceKeys.size - a[1].sourceKeys.size || b[1].writingDays - a[1].writingDays)
    .slice(0, k)
    .map(([term, r]) => {
      const labels = [...new Set(r.labels.values())].slice(0, 4);
      const connection =
        labels.length >= 3
          ? `This theme shows up across ${labels.length} things you track (${labels.slice(0, 2).join(" · ")}…). Worth asking what ties them together.`
          : `Keeps appearing when you write about ${labels[0]} and ${labels[1]} — a thread between them.`;
      return {
        term,
        habitLabels: labels,
        writingDays: r.writingDays,
        sample: r.bestSample,
        connection,
      };
    });
}

/**
 * Run the full deeper-insights analysis. Pure, deterministic, ~O(N) over the
 * corpus so it's fine to call client-side. Returns either `{ needsMoreData:true }`
 * when there isn't enough written text to say anything honest, or a full
 * report. The caller is expected to memoize + cache (see useDeepInsights).
 */
function analyzeDeepInsights(habits = [], goals = []) {
  const corpus = getWrittenCorpus(habits, goals);
  // Each entry is now one writing-day per habit/goal (NOT per text fragment).
  const totalEntries = corpus.length;
  const totalWords = corpus.reduce(
    (s, e) => s + (String(e.text).split(/\s+/).filter(Boolean).length),
    0,
  );

  // Honest threshold: need real language, not just scattered one-liners.
  if (totalEntries < 3 || totalWords < 35) {
    return { needsMoreData: true, totalEntries, totalWords };
  }

  const withTone = corpus.map(e => ({ ...e, tone: getTextTone(e.text) }));

  const crossHabitLinks = getCrossHabitLinks(corpus, 4);

  // Tone distribution
  const pos = withTone.filter(e => e.tone.polarity === "pos").length;
  const neg = withTone.filter(e => e.tone.polarity === "neg").length;
  const neu = totalEntries - pos - neg;

  // Mood trend: last 7 days vs prior 7
  const recentCutoff = daysAgo(6);
  const priorCutoff  = daysAgo(13);
  const recent = withTone.filter(e => e.date >= recentCutoff);
  const prior  = withTone.filter(e => e.date >= priorCutoff && e.date < recentCutoff);
  const avgScore = arr => arr.length ? arr.reduce((s, e) => s + e.tone.score, 0) / arr.length : 0;
  const recentAvg = avgScore(recent);
  const priorAvg  = avgScore(prior);
  let moodTrend = null;
  if (recent.length >= 3 && prior.length >= 3) {
    const diff = recentAvg - priorAvg;
    if      (diff >=  0.6) moodTrend = "rising";
    else if (diff <= -0.6) moodTrend = "declining";
    else                   moodTrend = "steady";
  }

  // "Most written about" habit — counted by UNIQUE WRITING DAYS, not text
  // fragments (the prior bug). We also only surface this when there's a real
  // signal: at least 5 days of writing AND the leader is meaningfully ahead
  // of the runner-up — otherwise "most" is a coin-flip and not insightful.
  const byHabit = new Map();
  for (const e of corpus) {
    if (e.kind !== "habit" || !e.habitId) continue;
    if (!byHabit.has(e.habitId)) {
      byHabit.set(e.habitId, { habitId: e.habitId, name: e.habitName, days: 0, chars: 0 });
    }
    const rec = byHabit.get(e.habitId);
    rec.days++;
    rec.chars += e.text.length;
  }
  const habitRanking = [...byHabit.values()].sort((a, b) => b.days - a.days || b.chars - a.chars);
  let mostReflectedHabit = null;
  if (habitRanking.length > 0) {
    const leader = habitRanking[0];
    const runnerUp = habitRanking[1];
    const aheadEnough = !runnerUp || (leader.days - runnerUp.days >= 2);
    if (leader.days >= 5 && aheadEnough) {
      mostReflectedHabit = leader;
    }
  }

  // Entry worth revisiting: longest single piece of writing in the last 30
  // days. Pulls the actual reflection / note / win / hardPart text directly
  // (not the joined frankenstein) so the quote reads naturally.
  const recent30Cutoff = daysAgo(30);
  let revisitEntry = null;
  for (const e of corpus) {
    if (e.date < recent30Cutoff) continue;
    const candidates = [
      e.reflText && { date: e.date, text: e.reflText, kind: "reflection", habitName: e.habitName, goalName: e.goalName },
      e.noteText && { date: e.date, text: e.noteText, kind: "note",       habitName: e.habitName, goalName: e.goalName },
      e.winText  && { date: e.date, text: e.winText,  kind: "win",        habitName: e.habitName, goalName: e.goalName },
      e.hardText && { date: e.date, text: e.hardText, kind: "hard",       habitName: e.habitName, goalName: e.goalName },
    ].filter(Boolean);
    for (const c of candidates) {
      if (!revisitEntry || c.text.length > revisitEntry.text.length) revisitEntry = c;
    }
  }

  // ── Momentum shift ────────────────────────────────────────────────────────
  // Compare last 7 days vs prior 7 days per habit — surfaces which habits are
  // gaining or losing consistency right now, not word-frequency tricks.
  const cutoffThis  = daysAgo(6);   // last 7 days (today − 6 through today)
  const cutoffPrior = daysAgo(13);  // prior 7 days
  const momentumUp   = [];
  const momentumDown = [];
  for (const h of habits) {
    const realLogs = (h.logs || []).filter(l => l.value !== "skip" && l.value !== "quicknote");
    const thisWeek  = realLogs.filter(l => l.date >= cutoffThis).length;
    const lastWeek  = realLogs.filter(l => l.date >= cutoffPrior && l.date < cutoffThis).length;
    const diff = thisWeek - lastWeek;
    if (diff >= 2 && thisWeek >= 1) {
      momentumUp.push({ habitId: h.id, habitName: h.name, habitEmoji: h.emoji || "", color: h.color, thisWeek, lastWeek });
    } else if (diff <= -2 && lastWeek >= 2) {
      momentumDown.push({ habitId: h.id, habitName: h.name, habitEmoji: h.emoji || "", color: h.color, thisWeek, lastWeek });
    }
  }
  momentumUp.sort((a, b) => (b.thisWeek - b.lastWeek) - (a.thisWeek - a.lastWeek));
  momentumDown.sort((a, b) => (a.thisWeek - a.lastWeek) - (b.thisWeek - b.lastWeek));
  const momentumShift = { up: momentumUp.slice(0, 2), down: momentumDown.slice(0, 2) };

  // ── Consistency gaps ───────────────────────────────────────────────────────
  // Habits that had real logs before 7 days ago but have gone silent this week.
  const consistencyGaps = [];
  for (const h of habits) {
    const realLogs = (h.logs || []).filter(l => l.value !== "skip" && l.value !== "quicknote");
    const thisWeek  = realLogs.filter(l => l.date >= cutoffThis).length;
    const olderLogs = realLogs.filter(l => l.date < cutoffThis);
    if (thisWeek === 0 && olderLogs.length >= 3) {
      const lastLogDate = [...olderLogs].sort((a, b) => b.date.localeCompare(a.date))[0].date;
      const daysSilent = Math.floor((Date.now() - new Date(lastLogDate).getTime()) / 86400000);
      if (daysSilent <= 21) consistencyGaps.push({ habitId: h.id, habitName: h.name, habitEmoji: h.emoji || "", lastLogDate, daysSilent });
    }
  }
  consistencyGaps.sort((a, b) => a.daysSilent - b.daysSilent); // most recently lapsed first

  // ── Recent hard-part quotes ────────────────────────────────────────────────
  // Actual text from recent hard-part entries — no word frequency, just what
  // the user wrote, most recent first.
  const recentHardPartQuotes = corpus
    .filter(e => e.hardText && e.hardText.length >= 15)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
    .map(e => ({ date: e.date, text: e.hardText, habitName: e.habitName || e.goalName || "" }));

  return {
    needsMoreData: false,
    totalEntries,
    totalWords,
    crossHabitLinks,
    toneMix: { pos, neg, neu },
    moodTrend,
    recentAvg,
    priorAvg,
    mostReflectedHabit,
    revisitEntry,
    momentumShift,
    consistencyGaps,
    recentHardPartQuotes,
  };
}

// ── Deep-insights cache (content hash + TTL) ─────────────────────────────────
// Purpose: avoid recomputing on every Insights render, but always recompute
// when the user actually adds new written content. Cached under a user-scoped
// key so multiple accounts on the same device don't collide.
const DEEP_INSIGHTS_TTL_MS   = 24 * 60 * 60 * 1000; // refresh at least every 24h
const WEEKLY_SUMMARY_TTL_MS  = 24 * 60 * 60 * 1000; // generated summary cached 24h

function deepInsightsCacheKey(userId) {
  return `forged_deep_insights:${userId || "anon"}`;
}
function hashCorpusSignature(corpus) {
  // djb2 over a tiny fingerprint of each entry — stable, collision-safe enough
  // for this use case, and much cheaper than hashing the full text.
  let h = 5381;
  for (const e of corpus) {
    const s = `${e.date}|${e.source}|${e.text.length}|${String(e.text).slice(0, 24)}`;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  }
  return String(h);
}
function readDeepInsightsCache(userId) {
  try {
    const raw = localStorage.getItem(deepInsightsCacheKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeDeepInsightsCache(userId, payload) {
  try { localStorage.setItem(deepInsightsCacheKey(userId), JSON.stringify(payload)); }
  catch { /* quota / private mode */ }
}
function clearDeepInsightsCache(userId) {
  try { localStorage.removeItem(deepInsightsCacheKey(userId)); } catch { /* ignore */ }
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
  @keyframes journalFadeIn { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }
  @keyframes coachRowIn { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: none; } }
  @keyframes coachToastIn { from { opacity:0; transform: translateY(-8px); } to { opacity:1; transform: none; } }
  @keyframes coachNudge {
    0%   { opacity: 0; transform: translateY(10px) scale(0.97); }
    9%   { opacity: 1; transform: translateY(0) scale(1); }
    82%  { opacity: 1; transform: translateY(0) scale(1); }
    100% { opacity: 0; transform: translateY(5px) scale(0.99); }
  }
  @keyframes coachGuideIn {
    0%   { opacity: 0; transform: translateY(8px) scale(0.97); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes coachFabPulse {
    0%, 100% { box-shadow: 0 2px 14px rgba(0,0,0,0.4), 0 0 0 0 rgba(200,144,42,0.45); }
    50%      { box-shadow: 0 2px 14px rgba(0,0,0,0.4), 0 0 0 8px rgba(200,144,42,0); }
  }
  @keyframes coachFabSheen {
    0%   { background-position: -120px 0; }
    100% { background-position: 120px 0; }
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
  @keyframes recBar {
    0%, 100% { transform: scaleY(0.35); }
    50%      { transform: scaleY(1);    }
  }
  @keyframes recDotPulse {
    0%, 100% { transform: scale(1);    opacity: 0.85; }
    50%      { transform: scale(1.35); opacity: 1;    }
  }
  @keyframes recBarSlide {
    from { transform: translateY(6px); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
  }
  @keyframes focusCheckPop {
    0%   { transform: scale(0.4); opacity: 0; }
    60%  { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1);    opacity: 1; }
  }
  @keyframes coachRefreshSpin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
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
function isAppleMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iP(hone|od|ad)/.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

/**
 * Use Web Speech alone (no getUserMedia first).
 * - Safari / iOS: avoids double permission prompts.
 * - Chromium (Chrome, Edge, Brave, …): holding a MediaStream for the volume meter while SR runs
 *   often yields no transcripts (meter reacts; recognition stays empty). SR-only fixes that.
 */
function shouldUseSpeechOnlyMicPath() {
  if (typeof navigator === "undefined") return false;
  if (isAppleMobileDevice()) return true;
  const ua = navigator.userAgent || "";
  if (/Chrome|Chromium|Edg|OPR|CriOS|FxiOS|Brave/i.test(ua)) return true;
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS/i.test(ua);
}

/**
 * Chromium: Web Speech often returns "service-not-allowed" if the tab never obtained mic access
 * via getUserMedia. We briefly open the mic, stop tracks, then start SR (no parallel capture).
 * Skip for pure Safari / WebKit-only UAs to avoid an extra permission prompt on iOS/macOS Safari.
 */
function shouldPrimeMicBeforeWebSpeech() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  const ua = navigator.userAgent || "";
  // Android: skip GUM prime — it often still ends in service-not-allowed; SR-only is enough once site policy allows it.
  if (/Android/i.test(ua)) return false;
  const hasChromiumToken = /Chrome|Chromium|Edg|OPR|CriOS|Brave/i.test(ua);
  const pureWebKitSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Brave/i.test(ua);
  return hasChromiumToken && !pureWebKitSafari;
}

/** Mobile Chrome / iOS Chrome: compact URL bar (often Share only); mic is under Chrome Settings, not beside URL. */
function isLikelyMobileChromeSpeechUi() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android.*Chrome|Chrome.*Android|CriOS/i.test(ua)) return true;
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches && /Mobi|Android|iPhone|iPad/i.test(ua)) return true;
  return false;
}

/**
 * Real-volume metering safety guard. We open a parallel MediaStream just to
 * drive the recording bar's height — but only on desktop, because:
 *  - Android Chromium has historically dropped Web Speech transcripts when a
 *    second mic stream is held in parallel.
 *  - iOS Safari can struggle with two simultaneous audio captures.
 * Modern desktop Chrome/Edge/Safari handle parallel streams cleanly. If a
 * regression appears, this single function is the kill-switch.
 */
function isDesktopBrowserForMeter() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android|Mobi/i.test(ua)) return false;
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches) return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  return true;
}

/** Android Chrome / Edge on Android: continuous dictation is flaky; short utterances are more reliable. */
function isAndroidChromiumForSpeech() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android/i.test(ua) && /Chrome|Edg|OPR|Brave/i.test(ua);
}

function speechServiceBlockedHelpMessage() {
  if (isLikelyMobileChromeSpeechUi()) {
    return "Chrome won't run voice-to-text on some phones — yours may be one of them. It's not you doing anything wrong. Just type in the box; updating Chrome or using a laptop sometimes fixes it.";
  }
  return "Voice typing didn't start in Chrome. Allow the microphone for this site (click left of the address bar → site settings), or type in the box instead.";
}

function useSpeechInput(onFinal, opts = {}) {
  const { autoRestart = false, meter = false } = opts;
  const [listening, setListening] = useState(false);
  const [interim,   setInterim]   = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const [speechError, setSpeechError] = useState("");
  // Live recording duration in ms (only relevant when listening). Updated
  // every 200ms while the recognizer is active so the recording bar can show
  // a mm:ss timer without the consumer needing to manage its own interval.
  const [recordingMs, setRecordingMs] = useState(0);
  // R holds mutable refs that must not trigger re-renders
  const R = useRef({ recog:null, stream:null, ctx:null, raf:null, ringEl:null });
  const stopping = useRef(false); // true while we're mid-teardown
  const micSessionRef = useRef(0); // invalidates in-flight getUserMedia if user taps again
  const pendingInterimRef = useRef("");
  // Distinguish a user-initiated stop (tap Stop / unmount) from the browser
  // auto-ending a recognition session. autoRestart only kicks in when the
  // user did NOT initiate the stop and no real error occurred.
  const userStoppedRef = useRef(false);
  const errorOccurredRef = useRef(false);
  const sessionStartRef = useRef(0);
  const tickIntervalRef = useRef(null);
  // Hold autoRestart in a ref so the closure inside beginRecognition can read
  // the latest value without re-binding the callback every render.
  const autoRestartRef = useRef(autoRestart);
  useEffect(() => { autoRestartRef.current = autoRestart; }, [autoRestart]);
  const onFinalRef = useRef(onFinal);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  // Hard cap on a single continuous recording — defensive against runaway
  // sessions if the user walks away with the coach open. Matches typical
  // ChatGPT-style voice limits without being annoying for normal use.
  const SESSION_MAX_MS = 30 * 60 * 1000;
  // Real-volume metering (opt-in, desktop only). Independent of SR's stream.
  // If we can't open this stream the bars fall back to their CSS animation.
  const meterRef = useRef({ stream:null, ctx:null, raf:null, els:[], starting:false, prev:[] });
  const setBarEls = useCallback(els => {
    meterRef.current.els = (els || []).filter(Boolean);
    meterRef.current.prev = meterRef.current.els.map(() => 0.4);
  }, []);
  // Only relevant when `meter:true` is passed by the consumer.
  const meterOptRef = useRef(meter);
  useEffect(() => { meterOptRef.current = meter; }, [meter]);

  const supported = !!(typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition));

  const stopAll = useCallback((fromOnEnd = false) => {
    const r = R.current;
    stopping.current = true;

    // Commit partial dictation before tearing down (avoids losing last phrase on stop / onend races).
    if (r.recog) {
      const tail = (pendingInterimRef.current || "").trim();
      if (tail) {
        try { onFinalRef.current(tail); } catch (e) { console.warn("[speech] interim flush:", e); }
      }
      pendingInterimRef.current = "";
    }

    micSessionRef.current += 1; // cancel any pending async mic start

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
    // Tear down the parallel volume-meter stream / analyser so the bars fall
    // back to their CSS animation on the next start.
    {
      const m = meterRef.current;
      if (m.raf) { cancelAnimationFrame(m.raf); m.raf = null; }
      if (m.stream) { try { m.stream.getTracks().forEach(t => t.stop()); } catch {} m.stream = null; }
      if (m.ctx) { try { m.ctx.suspend(); } catch {} }
      m.starting = false;
      m.els.forEach(el => {
        if (!el) return;
        el.style.transform = "";
        el.style.animation = "";
      });
    }
    if (tickIntervalRef.current) { clearInterval(tickIntervalRef.current); tickIntervalRef.current = null; }
    setListening(false);
    setInterim("");
    setRecordingMs(0);
    // Do not clear pendingInterimRef here — recog.onend may still flush it after stop().

    // Allow restart after a brief settling period
    setTimeout(() => { stopping.current = false; }, 350);
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  const setRingEl = useCallback(el => { R.current.ringEl = el; }, []);

  /** Volume ring — only when a MediaStream is held (non–speech-only path; Chromium uses SR-only). */
  function startVolumeMeter(stream) {
    const r = R.current;
    if (!stream || !r.recog) return;
    if (r.raf) { cancelAnimationFrame(r.raf); r.raf = null; }
    if (!r.ctx) {
      try { r.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return; }
    }
    r.ctx.resume().catch(() => {});
    try {
      const analyser = r.ctx.createAnalyser();
      analyser.fftSize = 64;
      r.ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!R.current.recog) return;
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        const v = Math.min(1, avg / 48);
        const el = R.current.ringEl;
        if (el) { el.style.transform = `scale(${1 + v * 0.65})`; el.style.opacity = String(Math.max(0.12, v)); }
        R.current.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      console.warn("[speech] volume meter:", e);
    }
  }

  /**
   * Parallel volume meter — opens its OWN MediaStream just to drive the
   * recording bar's height in real time. Independent of SpeechRecognition's
   * audio source. Desktop-only (see isDesktopBrowserForMeter); on mobile we
   * deliberately skip and let the CSS animation play instead.
   *
   * Failure modes are silent on purpose: if the user denies the additional
   * permission prompt, or if AudioContext can't initialise, the bars just
   * fall back to their CSS animation. Recording itself is unaffected.
   */
  async function startMeterStream() {
    const m = meterRef.current;
    if (m.starting || m.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    m.starting = true;
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
      });
    } catch {
      m.starting = false;
      return;
    }
    // If recording was stopped between the await and now, drop the stream.
    if (!R.current.recog) {
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      m.starting = false;
      return;
    }
    try {
      if (!m.ctx) m.ctx = new (window.AudioContext || window.webkitAudioContext)();
      m.ctx.resume().catch(() => {});
      const analyser = m.ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.55;
      m.ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      m.stream = stream;
      m.starting = false;
      m.prev = (m.els || []).map(() => 0.4);
      // Per the CSS spec, animations override inline `transform` unless the
      // animation itself is removed. Disable the keyframe animation on each
      // bar so our rAF-driven inline transform takes effect; stopAll() puts
      // it back so the next session falls back cleanly when needed.
      (m.els || []).forEach(el => { if (el) el.style.animation = "none"; });
      const tick = () => {
        if (!m.stream || !R.current.recog) return;
        analyser.getByteFrequencyData(buf);
        // RMS-style level across the spectrum, normalised to 0..1.
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length) / 255;
        // Boost so normal speaking voice maps roughly to 0.4–0.9.
        const v = Math.min(1, rms * 3);
        const els = m.els;
        if (els && els.length) {
          const now = performance.now() / 1000;
          for (let i = 0; i < els.length; i++) {
            // Per-bar phase wobble keeps the row organic instead of moving
            // as a single block.
            const wobble = 0.55 + 0.45 * Math.sin(i * 0.55 + now * 6);
            const target = 0.22 + 0.78 * v * (0.55 + 0.45 * wobble);
            const cur = m.prev[i] ?? 0.3;
            // Smooth toward target (faster on the way up than on the way
            // down so the bars feel responsive but don't jitter).
            const k = target > cur ? 0.55 : 0.25;
            const next = cur + (target - cur) * k;
            m.prev[i] = next;
            const el = els[i];
            if (el) el.style.transform = `scaleY(${next.toFixed(3)})`;
          }
        }
        m.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      console.warn("[speech] meter stream:", e);
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      m.stream = null;
      m.starting = false;
      // Defensive: if we'd already disabled the bar animation, put it back.
      (m.els || []).forEach(el => {
        if (!el) return;
        el.style.transform = "";
        el.style.animation = "";
      });
    }
  }

  const beginRecognition = useCallback((stream, session) => {
    // Session bump (from stopAll) invalidates in-flight starts; do not also gate on stopping —
    // that ref stays true briefly after stop and would swallow the next tap on mobile.
    if (session !== micSessionRef.current) {
      stream?.getTracks().forEach(t => t.stop());
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recog;
    try {
      recog = new SR();
    } catch {
      stream?.getTracks().forEach(t => t.stop());
      return;
    }

    // iOS WebKit: continuous=true often stops immediately. Android Chromium: short runs are more reliable.
    recog.continuous = stream ? true : (!isAppleMobileDevice() && !isAndroidChromiumForSpeech());
    recog.interimResults = true;
    recog.lang = (typeof navigator !== "undefined" && navigator.language)
      ? navigator.language.split(",")[0].trim()
      : "en-US";

    recog.onstart = () => {
      pendingInterimRef.current = "";
      setMicBlocked(false);
      setSpeechError("");
      setListening(true);
      // First start of this user-initiated session — record start time for
      // the duration cap and the live mm:ss timer. Auto-restarts of the same
      // logical session don't reset the start time.
      if (!sessionStartRef.current) {
        sessionStartRef.current = Date.now();
        setRecordingMs(0);
        if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = setInterval(() => {
          if (sessionStartRef.current) setRecordingMs(Date.now() - sessionStartRef.current);
        }, 200);
      }
      // Opt-in: kick off a parallel mic stream just for live volume metering.
      // Only on desktop browsers — see isDesktopBrowserForMeter() for why.
      // Restarts of the same session reuse the existing meter stream, so we
      // gate on `meter.starting` and `meter.stream` to start exactly once.
      if (meterOptRef.current && isDesktopBrowserForMeter()) {
        const m = meterRef.current;
        if (!m.stream && !m.starting) startMeterStream();
      }
    };

    recog.onresult = e => {
      let iText = "";
      for (let j = e.resultIndex; j < e.results.length; j++) {
        if (e.results[j].isFinal) {
          const t = (e.results[j][0].transcript || "").trim();
          if (t) onFinalRef.current(t);
          pendingInterimRef.current = "";
          setInterim("");
        } else {
          iText += e.results[j][0].transcript || "";
        }
      }
      if (iText) {
        pendingInterimRef.current = iText;
        setInterim(iText);
      }
    };

    recog.onerror = (ev) => {
      const code = ev?.error || "";
      if (code === "aborted") return;
      // In auto-restart mode "no-speech" is the *expected* nudge to
      // re-arm — the user just paused briefly between sentences. Suppress
      // the error and let onend trigger a restart.
      if (autoRestartRef.current && code === "no-speech") return;
      errorOccurredRef.current = true;
      if (code === "not-allowed") setMicBlocked(true);
      const friendly = {
        "not-allowed": "Microphone access was denied. Allow the mic for this site and try again.",
        "service-not-allowed": speechServiceBlockedHelpMessage(),
        "network": "Could not reach speech recognition. Check your connection and try again.",
        "no-speech": "No speech was detected. Speak a bit louder or closer to the mic, then try again.",
        "audio-capture": "The microphone is not available or is being used by another app.",
        "bad-grammar": "Voice recognition hit an error. Try again with a shorter phrase.",
      };
      setSpeechError(friendly[code] || `Voice input stopped (${code}). You can try again or type instead.`);
      console.warn("[speech] recognition:", code, ev?.message || "");
      stopAll();
    };

    recog.onend = () => {
      // Auto-restart for continuous-until-user-stops mode (AI coach, etc.).
      // The browser ends recognition after each utterance on iOS Safari and
      // Android Chromium, and after long pauses on desktop Chrome — we want
      // to seamlessly re-arm so the user can keep talking without tapping
      // the mic again. Synchronous restart inside onend preserves the user
      // activation gesture on iOS, where a setTimeout would lose it.
      if (
        autoRestartRef.current &&
        !userStoppedRef.current &&
        !errorOccurredRef.current &&
        sessionStartRef.current &&
        Date.now() - sessionStartRef.current < SESSION_MAX_MS
      ) {
        setInterim("");
        pendingInterimRef.current = "";
        if (R.current.recog === recog) R.current.recog = null;
        beginRecognition(R.current.stream, micSessionRef.current);
        return;
      }
      setListening(false);
      setInterim("");
      if (R.current.recog === recog) stopAll(true);
    };

    R.current.recog = recog;
    R.current.stream = stream || null;

    try {
      recog.start();
      if (stream) startVolumeMeter(stream);
    } catch (e) {
      console.warn("[speech] recog.start:", e);
      // Let stopAll stop recognition and tracks (do not clear r.recog here first).
      stopAll();
    }
    // onFinal intentionally omitted — we read it via onFinalRef so this
    // callback stays stable across renders and the auto-restart self-call
    // resolves to the right instance.
  }, [stopAll]);

  const toggle = useCallback(() => {
    if (listening) {
      // Mark as user-initiated so onend's auto-restart path bails out.
      userStoppedRef.current = true;
      sessionStartRef.current = 0;
      stopAll();
      return;
    }
    // New tap to start: lift post-stop debounce so the next press is never a no-op (mobile Chrome).
    stopping.current = false;
    userStoppedRef.current = false;
    errorOccurredRef.current = false;
    sessionStartRef.current = 0;

    if (!supported) {
      alert("Voice input requires Chrome or Safari.");
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      alert("Voice input needs a secure connection (HTTPS).");
      return;
    }

    setMicBlocked(false);
    setSpeechError("");

    if (shouldUseSpeechOnlyMicPath()) {
      const session = ++micSessionRef.current;
      if (shouldPrimeMicBeforeWebSpeech()) {
        void (async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            stream.getTracks().forEach(t => t.stop());
            // Do not insert setTimeout here — Chrome drops user activation before SpeechRecognition.start().
          } catch (err) {
            console.warn("[speech] mic prime:", err?.name, err?.message);
            const n = err?.name || "";
            if (n === "NotAllowedError" || n === "PermissionDeniedError" || n === "SecurityError") {
              setMicBlocked(true);
            } else {
              setSpeechError("Could not open the microphone for voice typing. Check that no other app is using the mic, then try again.");
            }
            return;
          }
          if (session !== micSessionRef.current) return;
          beginRecognition(null, session);
        })();
        return;
      }
      beginRecognition(null, session);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Microphone access is not available in this browser.");
      return;
    }

    const session = ++micSessionRef.current;
    void (async () => {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (err) {
        console.warn("[speech] getUserMedia:", err?.name, err?.message);
        const n = err?.name || "";
        if (n === "NotAllowedError" || n === "PermissionDeniedError" || n === "SecurityError") {
          setMicBlocked(true);
        }
        return;
      }

      if (session !== micSessionRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      beginRecognition(stream, session);
    })();
  }, [listening, supported, stopAll, beginRecognition]);

  // Cancel = stop without committing the current interim. Used by the AI
  // coach's recording-bar "×" button to discard a recording the user
  // doesn't want to send. Still safe for non-autoRestart consumers.
  const cancel = useCallback(() => {
    userStoppedRef.current = true;
    sessionStartRef.current = 0;
    pendingInterimRef.current = "";
    stopAll();
  }, [stopAll]);

  return { listening, interim, toggle, cancel, supported, setRingEl, setBarEls, micBlocked, speechError, recordingMs };
}

function MicBtn({ speech, color = T.accent, size = 28, prominent = false, locked = false, onLockedClick }) {
  // Touch: touchend (activation). Mouse/pen: pointerdown + suppress duplicate click (Chrome desktop).
  const suppressClickRef = useRef(false);
  if (!speech.supported) return null;
  const blocked = !!speech.micBlocked;
  const c = speech.listening ? color : blocked ? T.muted : locked ? T.gold : prominent ? color : T.hint;
  const label = locked ? "Voice logging is a Pro feature" : speech.listening ? "Stop dictation" : blocked ? "Microphone blocked" : "Start dictation";
  const idleBorder = locked ? "rgba(200,144,42,0.45)" : blocked ? T.border : prominent ? `${color}55` : T.border;
  const idleBg = locked ? "rgba(200,144,42,0.10)" : blocked ? "transparent" : prominent ? `${color}16` : "transparent";
  function handleActivate() {
    if (locked) { onLockedClick?.(); return; }
    speech.toggle();
  }
  return (
    <>
      <style>{`
        @keyframes coachMicPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.55; }
        }
      `}</style>
    <button
      type="button"
      aria-label={label}
      title={locked ? "Voice logging — tap to unlock with Pro" : speech.listening ? "Tap to stop" : blocked ? "Microphone blocked" : "Tap to dictate"}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.pointerType === "touch") return;
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 400);
        e.preventDefault();
        handleActivate();
      }}
      onTouchEnd={(e) => {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 400);
        if (e.cancelable) e.preventDefault();
        handleActivate();
      }}
      onClick={(e) => {
        e.preventDefault();
        if (suppressClickRef.current) return;
        handleActivate();
      }}
      style={{ position:"relative", width:size, height:size, borderRadius:"50%",
        border:`1px solid ${speech.listening ? color+"55" : idleBorder}`,
        background: speech.listening ? color+"14" : idleBg,
        boxShadow: prominent && !speech.listening && !blocked && !locked ? `0 0 0 1px ${color}0d` : "none",
        cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
        flexShrink:0, padding:0, transition:"border-color 0.2s, background 0.2s, box-shadow 0.2s",
        touchAction:"manipulation", WebkitTapHighlightColor:"transparent" }}>
      {speech.listening ? (
        <span
          aria-hidden
          style={{
            position:"absolute", top:3, right:3, width:7, height:7, borderRadius:"50%",
            background:"#e53935", boxShadow:"0 0 0 1px rgba(0,0,0,0.2)",
            animation:"coachMicPulse 1.1s ease-in-out infinite", pointerEvents:"none",
          }}
        />
      ) : null}
      {/* Locked: tiny gold lock dot so it reads as Pro at a glance. */}
      {locked && !speech.listening ? (
        <span aria-hidden style={{
          position:"absolute", top:-2, right:-2, width:12, height:12, borderRadius:"50%",
          background:T.gold, color:"#0F0F0D",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:7, fontWeight:800, letterSpacing:"0.02em",
          border:"1px solid #0F0F0D", pointerEvents:"none",
        }}>P</span>
      ) : null}
      {/* volume ring — animated via direct DOM in RAF loop, no React state */}
      <div ref={speech.setRingEl} style={{ position:"absolute", inset:-5, borderRadius:"50%",
        border:`1.5px solid ${color}`, opacity:0, transform:"scale(1)", pointerEvents:"none",
        transition: speech.listening ? "none" : "opacity 0.5s" }}/>
      {/* mic icon (crossed out when permission denied) */}
      <svg width={size*0.56} height={size*0.56} viewBox="0 0 16 16" fill="none" style={{ color:c, transition:"color 0.2s" }}>
        <rect x="5" y="1" width="6" height="8" rx="3" fill="currentColor"/>
        <path d="M3 7.5a5 5 0 0 0 10 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
        <line x1="8" y1="12.5" x2="8" y2="14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="5.5" y1="14.5" x2="10.5" y2="14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        {blocked ? (
          <line x1="1.5" y1="1.5" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : null}
      </svg>
    </button>
    </>
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
      {speech.speechError ? (
        <div style={{ fontSize:11, color:T.accent, lineHeight:1.5, whiteSpace:"pre-line" }}>{speech.speechError}</div>
      ) : null}
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
      {onShareHabit && (
        <button type="button" disabled={!!shareSaving} onPointerDown={e => e.stopPropagation()} onClick={async (e) => {
          e.stopPropagation();
          try { await onShareHabit(habit.id); } finally { onCloseMenu(); }
        }}
          style={{ fontSize:12, color:T.gold, background:"rgba(200,144,42,0.12)", border:`0.5px solid rgba(200,144,42,0.35)`, borderRadius:T.rsm, padding:"5px 12px", cursor:shareSaving?"wait":"pointer", fontWeight:500, opacity:shareSaving?0.55:1 }}>
          {shareSaving ? "Inviting…" : "Invite friends to this goal"}
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

function WeeklyCard({ habit, onTap, onSkip, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit }) {
  const t = todayStr();
  const isSkip = hasRestDay(habit, t);
  const sessionToday = habit.logs.some(l => l.date === t && l.value === true);
  const satisfied = isSatisfiedForTodayRing(habit);
  const wk = getWeeklyCount(habit);
  const pct = Math.min(100, Math.round((wk / habit.weeklyTarget) * 100));
  const targetMet = wk >= (habit.weeklyTarget || 1);
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [restWhy, setRestWhy] = useState("");
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));
  useEffect(() => {
    if (sessionToday || isSkip) {
      setRestOpen(false);
      setRestWhy("");
    }
  }, [sessionToday, isSkip]);
  const checkLogged = satisfied && !isSkip;
  return (
    <div className="rc" style={cardStyle(satisfied, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={checkLogged}/>
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
        {isSkip
          ? <button className="tap" onClick={() => onTap(habit.id, { currentTarget: { getBoundingClientRect: () => ({left:0,top:0,width:0,height:0}) } })}
              style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${T.muted}`, background:T.surface, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, transition:"all 0.18s" }}>
              🛡️
            </button>
          : <CheckBtn logged={checkLogged} habit={habit} onClick={e => onTap(habit.id, e)}/>}
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
        {targetMet && !sessionToday && !isSkip && (
          <div style={{ fontSize:11, color:T.hint, marginTop:8, lineHeight:1.45 }}>
            Weekly target met — no session needed today for your ring.
          </div>
        )}
      </div>
      {isSkip && (
        <div style={{ margin:"0 15px 12px", background:"rgba(106,104,96,0.15)", borderRadius:T.rsm, padding:"8px 12px", display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🛡️</span>
            <span style={{ fontSize:12, fontWeight:500, color:T.muted }}>Weekly rest day — ring counts this; sessions this week unchanged</span>
          </div>
          {habit.logs.find(l => l.date === t && l.value === "skip")?.note?.trim() ? (
            <div style={{ fontSize:12, color:T.sub, lineHeight:1.5, paddingLeft:24, fontStyle:"italic" }}>
              {String(habit.logs.find(l => l.date === t && l.value === "skip").note).trim()}
            </div>
          ) : null}
        </div>
      )}
      {sessionToday && !isSkip && <DoneBanner habit={habit}/>}
      {sessionToday && !isSkip && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
      {!sessionToday && !isSkip && !targetMet && (
        <div style={{ padding:"0 15px 12px" }}>
          {restOpen ? (
            <div style={{ borderRadius:T.rsm, border:`0.5px solid ${T.borderMid}`, background:T.surface, padding:"12px 12px 10px" }}>
              <label style={{ display:"block", fontSize:12, fontWeight:500, color:T.text, marginBottom:6 }}>Weekly rest day? <span style={{ fontWeight:400, color:T.hint }}>(optional note)</span></label>
              <textarea
                value={restWhy}
                onChange={e => setRestWhy(e.target.value)}
                placeholder="Recovery, travel, light week…"
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
                  Confirm weekly rest
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button type="button" onClick={() => { setRestOpen(true); setRestWhy(""); }}
                style={{ fontSize:12, color:T.hint, background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                🛡️ Weekly rest day
              </button>
            </div>
          )}
        </div>
      )}
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

// ─── LINK HABITS SHEET ────────────────────────────────────────────────────────
function LinkHabitsSheet({ goal, habits, onSave, onClose }) {
  const existingLinks = (goal.logs || []).find(l => l.type === "goal_links")?.habitIds || [];
  const [selected, setSelected] = useState(new Set(existingLinks));

  const trackable = habits.filter(h => ["daily","weekly","project","limit"].includes(h.habitType));

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", zIndex:500, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", maxHeight:"70vh", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"18px 18px 14px", borderBottom:`0.5px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text }}>Link habits</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:3 }}>Choose habits that support this goal. They'll appear in the goal detail view.</div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>
          {trackable.length === 0 ? (
            <div style={{ fontSize:13, color:T.muted, textAlign:"center", padding:"24px 0" }}>No habits to link yet.</div>
          ) : trackable.map(h => {
            const isOn = selected.has(String(h.id));
            return (
              <button key={h.id} type="button" onClick={() => toggle(String(h.id))}
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 12px", borderRadius:T.rsm, border:`0.5px solid ${isOn ? h.color+"66" : T.border}`, background:isOn ? h.color+"0D" : T.surface, marginBottom:8, cursor:"pointer", textAlign:"left" }}>
                <span style={{ fontSize:18 }}>{h.emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, color:T.text, fontWeight:isOn ? 500 : 400 }}>{h.name}</div>
                  <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{h.habitType}</div>
                </div>
                <div style={{ width:20, height:20, borderRadius:"50%", border:`1.5px solid ${isOn ? h.color : T.borderStrong}`, background:isOn ? h.color : "none", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {isOn && <span style={{ fontSize:10, color:"#fff" }}>✓</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ padding:"12px 16px 32px", borderTop:`0.5px solid ${T.border}`, display:"flex", gap:10, flexShrink:0 }}>
          <button type="button" onClick={() => onSave([...selected])}
            style={{ flex:1, padding:"11px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>
            Save
          </button>
          <button type="button" onClick={onClose}
            style={{ padding:"11px 18px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:14, cursor:"pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── GOAL DETAIL SHEET ────────────────────────────────────────────────────────
function GoalDetailSheet({ goal, habits, onClose, onLog, onEdit, onComplete, onDelete, onCheckin, onLinkHabits }) {
  const [tab, setTab] = useState("overview"); // "overview" | "history" | "linked"
  const [showLinkSheet, setShowLinkSheet] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const stats   = getGoalProgress(goal);
  const pacing  = getGoalPacing(goal);
  const today   = todayStr();
  const thisWeek = weekStartFor(today);

  // Segregate log entries by type
  const numericLogs  = (goal.logs || []).filter(l => typeof l.value === "number").sort((a, b) => b.date.localeCompare(a.date));
  const milestones   = (goal.logs || []).filter(l => l.type === "milestone").sort((a, b) => a.date.localeCompare(b.date));
  const checkIns     = (goal.logs || []).filter(l => l.type === "checkin").sort((a, b) => b.date.localeCompare(a.date));
  const whyEntry     = (goal.logs || []).find(l => l.type === "goal_why");
  const linksEntry   = (goal.logs || []).find(l => l.type === "goal_links");
  const linkedIds    = new Set(linksEntry?.habitIds?.map(String) || []);
  const linkedHabits = habits.filter(h => linkedIds.has(String(h.id)));

  const thisWeekCheckIn = checkIns.find(c => c.date === thisWeek);

  const CHECK_IN_EMOJIS = ["😰", "😕", "😐", "🙂", "💪"];
  const pacingColors = { ahead:"#27AE60", "on-track":"#27AE60", behind:"#E74C3C", overdue:"#E74C3C", complete:"#27AE60" };
  const pacingLabels = { ahead:"Ahead of pace 🔥", "on-track":"On track ✓", behind:"Behind pace — push it", overdue:"Past deadline", complete:"Completed 🎉" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", maxHeight:"88vh", display:"flex", flexDirection:"column" }}>

        {/* Handle bar */}
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"12px auto 0", flexShrink:0 }}/>

        {/* Header */}
        <div style={{ padding:"14px 18px 0", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
            <div style={{ width:46, height:46, borderRadius:13, background:goal.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>
              {goal.emoji || "🎯"}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, lineHeight:1.25 }}>{goal.name}</div>
              {whyEntry && (
                <div style={{ fontSize:12, color:T.muted, marginTop:3, fontStyle:"italic", lineHeight:1.4 }}>"{whyEntry.label}"</div>
              )}
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:22, cursor:"pointer", lineHeight:1, padding:"0 0 0 4px", flexShrink:0, marginTop:-2 }}>×</button>
          </div>

          {/* Big progress + pacing */}
          <div style={{ margin:"14px 0 10px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div style={{ fontSize:13, color:T.muted }}>
                <strong style={{ fontSize:16, color:goal.color }}>{goal.currentValue}{goal.unit}</strong>
                <span style={{ color:T.hint }}> / {goal.targetValue}{goal.unit}</span>
              </div>
              <div style={{ fontSize:13, fontWeight:600, color: stats.isComplete ? T.green : goal.color }}>{stats.pct}%</div>
            </div>
            <div style={{ height:8, background:T.surface, borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", borderRadius:4, background:stats.isComplete ? T.green : goal.color, width:`${Math.max(stats.pct, 4)}%`, transition:"width 0.4s ease" }}/>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6, gap:8, flexWrap:"wrap" }}>
              <div style={{ fontSize:11, color:T.muted }}>
                {!stats.isComplete && stats.toGo > 0 ? `${formatWithUnit(stats.toGo, goal.unit)} to go` : ""}
              </div>
              {pacing && (
                <div style={{ fontSize:11, fontWeight:600, color: pacingColors[pacing.status] || T.muted, background:(pacingColors[pacing.status] || T.muted)+"15", border:`0.5px solid ${(pacingColors[pacing.status] || T.muted)}33`, borderRadius:10, padding:"2px 8px" }}>
                  {pacingLabels[pacing.status] || ""}
                  {pacing.daysLeft > 0 ? ` · ${pacing.daysLeft}d left` : ""}
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex", background:T.surface, borderRadius:T.rsm, padding:3, gap:2 }}>
            {[["overview","Overview"],["history",`History (${numericLogs.length})`],["linked",`Linked (${linkedHabits.length})`]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                style={{ flex:1, padding:"6px 4px", borderRadius:7, border:"none", cursor:"pointer", background:tab===id?T.raised:"none", color:tab===id?T.text:T.muted, fontSize:11, fontWeight:500, transition:"all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex:1, overflowY:"auto", padding:"14px 18px 24px" }}>

          {/* ── OVERVIEW TAB ─────────────────────────────────────── */}
          {tab === "overview" && (
            <>
              {/* Weekly check-in */}
              {!stats.isComplete && (
                <div style={{ marginBottom:18, padding:"13px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${thisWeekCheckIn ? T.border : "rgba(200,144,42,0.3)"}` }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:thisWeekCheckIn ? T.hint : T.gold, marginBottom:8 }}>
                    {thisWeekCheckIn ? "This week's check-in" : "How's it going this week?"}
                  </div>
                  <div style={{ display:"flex", gap:6, justifyContent:"space-between" }}>
                    {CHECK_IN_EMOJIS.map((em, i) => {
                      const rating = i + 1;
                      const isSelected = thisWeekCheckIn?.rating === rating;
                      return (
                        <button key={i} type="button"
                          onClick={() => { if (!thisWeekCheckIn) onCheckin(goal.id, rating, ""); }}
                          disabled={!!thisWeekCheckIn}
                          style={{
                            flex:1, padding:"8px 0", borderRadius:10,
                            border:`1px solid ${isSelected ? T.gold : T.border}`,
                            background:isSelected ? "rgba(200,144,42,0.15)" : "none",
                            fontSize:22, cursor:thisWeekCheckIn ? "default" : "pointer",
                            transition:"all 0.15s", opacity:thisWeekCheckIn && !isSelected ? 0.4 : 1,
                          }}>
                          {em}
                        </button>
                      );
                    })}
                  </div>
                  {thisWeekCheckIn?.note ? (
                    <div style={{ fontSize:12, color:T.muted, marginTop:8, fontStyle:"italic" }}>"{thisWeekCheckIn.note}"</div>
                  ) : null}
                  {!thisWeekCheckIn && (
                    <div style={{ fontSize:10, color:T.hint, marginTop:6, textAlign:"center" }}>Tap to record • saved automatically</div>
                  )}
                </div>
              )}

              {/* Milestones */}
              {milestones.length > 0 && (
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:T.hint, marginBottom:8 }}>Milestones</div>
                  {milestones.map((m, i) => {
                    const isPast  = m.date < today;
                    const isToday = m.date === today;
                    return (
                      <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:10 }}>
                        <div style={{ flexShrink:0, width:28, height:28, borderRadius:"50%", background:isPast ? T.surface : "rgba(200,144,42,0.12)", border:`1px solid ${isPast ? T.border : "rgba(200,144,42,0.4)"}`, display:"flex", alignItems:"center", justifyContent:"center", marginTop:1 }}>
                          <span style={{ fontSize:12 }}>{isPast ? "✓" : "◆"}</span>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, color:isPast ? T.muted : T.text, fontWeight:isPast ? 400 : 500, textDecoration:isPast ? "line-through" : "none" }}>{m.label}</div>
                          <div style={{ fontSize:11, color:isToday ? T.gold : T.hint, marginTop:1 }}>
                            {isToday ? "Today" : fmtGoalDueHuman(m.date)}
                            {!isPast && !isToday && (() => {
                              const d = Math.round((parseLocal(m.date) - parseLocal(today)) / 86400000);
                              return d > 0 ? ` · ${d}d away` : "";
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Goal deadline */}
              {goal.targetDate && (
                <div style={{ marginBottom:18, display:"flex", alignItems:"center", gap:8, padding:"10px 12px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}` }}>
                  <span style={{ fontSize:16 }}>🎯</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, color:T.text, fontWeight:500 }}>Deadline: {fmtGoalDueHuman(goal.targetDate)}</div>
                    {pacing?.daysLeft > 0 && <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{pacing.daysLeft} days remaining</div>}
                    {pacing?.daysLeft === 0 && <div style={{ fontSize:11, color:T.amber }}>Today is the deadline</div>}
                    {pacing?.daysLeft < 0 && <div style={{ fontSize:11, color:"#E74C3C" }}>Overdue by {Math.abs(pacing.daysLeft)} days</div>}
                  </div>
                </div>
              )}

              {/* Quick log */}
              {!stats.isComplete && (
                <button type="button" onClick={() => { onClose(); onLog(goal.id); }}
                  style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, width:"100%", padding:"12px", borderRadius:T.rsm, border:`0.5px solid ${goal.color+"55"}`, background:goal.color+"0D", color:goal.color, fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:14 }}>
                  + Log progress
                </button>
              )}

              {/* Actions row */}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button type="button" onClick={() => { onClose(); onEdit(goal.id); }}
                  style={{ padding:"7px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>
                  Edit goal
                </button>
                {!stats.isComplete && (
                  <button type="button" onClick={() => { onComplete(goal.id); onClose(); }}
                    style={{ padding:"7px 14px", borderRadius:T.rsm, border:`0.5px solid rgba(39,174,96,0.35)`, background:"none", color:T.green, fontSize:12, cursor:"pointer" }}>
                    Mark complete
                  </button>
                )}
                {!deleteConfirm ? (
                  <button type="button" onClick={() => setDeleteConfirm(true)}
                    style={{ padding:"7px 14px", borderRadius:T.rsm, border:`0.5px solid rgba(231,76,60,0.3)`, background:"none", color:"#e74c3c", fontSize:12, cursor:"pointer", marginLeft:"auto" }}>
                    Delete
                  </button>
                ) : (
                  <>
                    <span style={{ fontSize:12, color:T.muted, alignSelf:"center", marginLeft:"auto" }}>Sure?</span>
                    <button type="button" onClick={() => { onDelete(goal.id); onClose(); }}
                      style={{ padding:"7px 14px", borderRadius:T.rsm, border:"none", background:"rgba(231,76,60,0.15)", color:"#e74c3c", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                      Delete
                    </button>
                    <button type="button" onClick={() => setDeleteConfirm(false)}
                      style={{ padding:"7px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── HISTORY TAB ──────────────────────────────────────── */}
          {tab === "history" && (
            <>
              {numericLogs.length === 0 && checkIns.length === 0 ? (
                <div style={{ textAlign:"center", padding:"32px 0", color:T.muted, fontSize:13 }}>
                  No entries yet — tap "Log progress" to start.
                </div>
              ) : null}

              {/* Interleave numeric logs + check-ins by date, newest first */}
              {[
                ...numericLogs.map(l => ({ ...l, _kind: "value" })),
                ...checkIns.map(l => ({ ...l, _kind: "checkin" })),
              ].sort((a, b) => b.date.localeCompare(a.date)).map((entry, i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:12, alignItems:"flex-start" }}>
                  <div style={{ flexShrink:0, width:7, height:7, borderRadius:"50%", background:entry._kind === "checkin" ? T.gold : goal.color, marginTop:5 }}/>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11, color:T.hint }}>{fmtEntryDate(entry.date)}</div>
                    {entry._kind === "value" ? (
                      <div style={{ fontSize:14, color:T.text, fontWeight:500, marginTop:1 }}>
                        {entry.value}{goal.unit}
                        {entry.note ? <span style={{ fontSize:12, color:T.muted, fontWeight:400 }}> — {entry.note}</span> : null}
                      </div>
                    ) : (
                      <div style={{ fontSize:20, marginTop:1 }} title={`Rating: ${entry.rating}/5`}>
                        {CHECK_IN_EMOJIS[(entry.rating || 1) - 1]}
                        {entry.note ? <span style={{ fontSize:12, color:T.muted, marginLeft:6 }}>"{entry.note}"</span> : null}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── LINKED HABITS TAB ────────────────────────────────── */}
          {tab === "linked" && (
            <>
              <button type="button" onClick={() => setShowLinkSheet(true)}
                style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%", padding:"11px", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:T.surface, color:T.muted, fontSize:13, cursor:"pointer", marginBottom:14 }}>
                <span style={{ fontSize:16 }}>＋</span> {linkedHabits.length > 0 ? "Edit linked habits" : "Link habits to this goal"}
              </button>
              {linkedHabits.length === 0 ? (
                <div style={{ textAlign:"center", padding:"16px 0 32px", color:T.hint, fontSize:12, lineHeight:1.6 }}>
                  Link habits that support this goal.<br/>They'll appear here so you can see how your daily practice connects to the outcome.
                </div>
              ) : linkedHabits.map(h => {
                const streak = getStreak(h);
                return (
                  <div key={h.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 13px", borderRadius:T.rsm, background:T.surface, border:`0.5px solid ${T.border}`, marginBottom:8 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:h.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{h.emoji}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, color:T.text, fontWeight:500 }}>{h.name}</div>
                      <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>
                        {streak > 0 ? `${streak} day streak` : "No streak yet"}
                        {" · "}{h.habitType}
                      </div>
                    </div>
                    {streak > 0 && (
                      <div style={{ fontSize:11, color:T.gold, fontWeight:600, background:"rgba(200,144,42,0.12)", borderRadius:8, padding:"3px 8px" }}>🔥 {streak}</div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {showLinkSheet && (
        <LinkHabitsSheet
          goal={goal}
          habits={habits}
          onSave={habitIds => { onLinkHabits(goal.id, habitIds); setShowLinkSheet(false); }}
          onClose={() => setShowLinkSheet(false)}
        />
      )}
    </div>
  );
}

function TodayGoalCard({ goal, onOpenLog, onEdit, onComplete, onDelete, onShareGoal, onOpen }) {
  const stats = getGoalProgress(goal);
  const { isComplete } = stats;
  const barFillPct = goalBarFillWidthPct(stats);
  const today = todayStr();
  const loggedToday = goal.logs?.some(l => l.date === today && typeof l.value === "number") || false;
  const statusText = getGoalStatusText(goal, stats);
  const deadlineLine = goalTodayDeadlineLine(goal, stats, isComplete);

  // Find the next upcoming milestone (from milestone log entries)
  const nextMilestone = !isComplete
    ? (goal.logs || [])
        .filter(l => l.type === "milestone" && l.date && l.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))[0] || null
    : null;
  const msInDays = nextMilestone
    ? Math.round((parseLocal(nextMilestone.date) - parseLocal(today)) / 86400000)
    : null;
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
      {/* Tappable header row — opens goal detail sheet */}
      <div
        role={onOpen ? "button" : undefined}
        onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(goal.id); } : undefined}
        style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px", cursor:onOpen ? "pointer" : "default" }}>
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
          <TodayOverflowDotsBtn expanded={showMenu} onToggle={(e) => { e && e.stopPropagation(); setShowMenu(m => !m); }} />
        </div>
      </div>
      <div style={{ padding:"0 15px 14px" }}>
        <div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden" }}>
          <div style={{ height:"100%", borderRadius:3, background:isComplete ? T.green : goal.color, width:`${barFillPct}%`, transition:"width 0.4s ease" }}/>
        </div>
        {deadlineLine ? (
          <div style={{ fontSize:11, color:T.sub, marginTop:7, lineHeight:1.45 }}>{deadlineLine}</div>
        ) : null}
        {nextMilestone && (
          <div style={{ marginTop:7, display:"inline-flex", alignItems:"center", gap:5, padding:"3px 8px", borderRadius:10, background:"rgba(200,144,42,0.1)", border:"0.5px solid rgba(200,144,42,0.25)" }}>
            <span style={{ fontSize:9, color:T.gold }}>◆</span>
            <span style={{ fontSize:11, color:T.gold, fontWeight:500 }}>
              {nextMilestone.label}
              {msInDays != null && (
                <span style={{ color:T.hint, fontWeight:400 }}>
                  {" — "}
                  {msInDays === 0 ? "today" : msInDays === 1 ? "tomorrow" : `${msInDays}d away`}
                </span>
              )}
            </span>
          </div>
        )}
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
          {onShareGoal && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); onShareGoal(goal.id); }}
              style={{ fontSize:12, color:"#8B5CF6", background:"none", border:`0.5px solid rgba(139,92,246,0.4)`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>
              {goal.sharedGoalId ? "Invite friends" : "Invite friends to this goal"}
            </button>
          )}
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
        {winSpeech.speechError ? <div style={{ fontSize:11, color:T.accent, marginTop:6, lineHeight:1.5, whiteSpace:"pre-line" }}>{winSpeech.speechError}</div> : null}
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
        {hardSpeech.speechError ? <div style={{ fontSize:11, color:T.accent, marginTop:6, lineHeight:1.5, whiteSpace:"pre-line" }}>{hardSpeech.speechError}</div> : null}
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
function ReflectModal({ habit, onClose, onSave, hasCoach = false }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  const speech = useSpeechInput(transcript =>
    setText(p => p.trim() ? p + " " + transcript : transcript)
  );

  if (!habit) return null;
  const past = habit.logs.filter(l => l.reflection).slice(-4).reverse();

  function handleSave() {
    const interimSnap = speech.interim?.trim() || "";
    if (speech.listening) speech.toggle();
    const combined = (text.trim() || interimSnap).trim();
    if (!combined) { onClose(); return; }
    onSave(habit.id, combined);
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
      {hasCoach && !saved && (
        <div style={{ fontSize:11, color:T.hint, fontStyle:"italic", lineHeight:1.5, marginTop:6, marginBottom:6, paddingLeft:4 }}>
          Your coach reads these.
        </div>
      )}
      {speech.speechError && !saved ? (
        <div style={{ fontSize:12, color:T.accent, marginBottom:10, paddingLeft:4, lineHeight:1.5, whiteSpace:"pre-line" }}>{speech.speechError}</div>
      ) : null}
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
  log:      { bg:"rgba(200,144,42,0.12)", text:"#C8902A", label:"Log" },
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
    if (habit.habitType === "log") {
      updates.reflection = false;
      updates.reflectionPrompt = null;
    }
    if (habit.habitType === "weekly")   updates.weeklyTarget = parseInt(weekTarget) || habit.weeklyTarget;
    if (habit.habitType === "limit")    { updates.dailyBudget = parseInt(budget)||habit.dailyBudget; updates.unit = budgetUnit||habit.unit; updates.tapIncrement = parseInt(increment)||1; }
    if (habit.habitType === "project")  updates.dailyTargetMinutes = Math.max(1, parseInt(dailyTargetMins, 10) || (habit.dailyTargetMinutes ?? 60));
    onSave(habit.id, updates);
    onClose();
  }

  const isLog = habit.habitType === "log";

  return (
    <Modal onClose={onClose}>
      <div style={{ display:"inline-flex", alignItems:"center", background:meta.bg, borderRadius:20, padding:"4px 12px", marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:500, color:meta.text }}>{typePillLabel}</span>
      </div>
      <div style={{ fontSize:11, color:T.hint, marginBottom:16, lineHeight:1.45, maxWidth:320 }}>
        Type can&apos;t be changed after creation — delete and recreate if you need a different kind.
      </div>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:20 }}>{isLog ? "Edit log" : "Edit habit"}</div>
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

      {isLog ? (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20, fontSize:13, color:T.muted, lineHeight:1.55 }}>
          Logs are free-form dated entries. They appear in <strong style={{ color:T.text }}>Journal</strong> and don&apos;t affect your Today ring or streaks.
        </div>
      ) : (
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
      )}
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

/** Lightweight journal-style track — dated notes only (stored as habit_type "log"). */
function AddLogModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📝");
  const [color, setColor] = useState(COLORS[2]);
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:8 }}>New log</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:20, lineHeight:1.55 }}>{HABIT_TYPES.log.desc}</div>
      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Training notes" maxLength={40} autoFocus/>
        </div>
        <div>
          <label style={lbl}>Emoji</label>
          <input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2}/>
        </div>
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Color</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2.5px solid ${c}`:"none", outlineOffset:2 }}/>)}
        </div>
      </div>
      <PBtn color={color} onClick={() => {
        if (!name.trim()) return;
        onSave({
          id: `${Date.now()}`,
          name: name.trim(),
          emoji: emoji || "📝",
          habitType: "log",
          color,
          reflection: false,
          reflectionPrompt: null,
          streak: 0,
          logs: [],
        });
      }}>Create log</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
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
            <div style={{ fontSize:13, color:T.text, fontWeight:500, textAlign:"center" }}>Full history is part of Forged Pro</div>
            <div style={{ fontSize:12, color:T.muted, textAlign:"center" }}>You have {habit.logs.filter(l => l.date < cutoff).length} older logs waiting</div>
            <button onClick={onUpgrade}
              style={{ marginTop:6, padding:"9px 20px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#0F0F0D", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Unlock Forged Pro →
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
      body: "Add friends, share goals, and see who's still logging. Nudging a friend when they slip is a Pro feature — the rest of the accountability layer is free.",
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
      title: "Activity summary",
      body: "Quick read on streaks, your steadiest habit, and which day you usually log. Tap \"Show full activity breakdown\" for streak rows, 28-day rates, and the 12-week heatmap.",
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
      body: "Unlocks unlimited habits and coach messages, voice logging, friend nudges, and full history — at a price locked in forever. First 100 users get it at $4.99/mo.",
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

// ─── LOG (journal-style) — Today card ────────────────────────────────────────
function LogCard({ habit, onSaveEntry, onEditHabit, onDeleteHabit }) {
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const today = todayStr();
  const todays = habit.logs.filter(l => l.date === today && l.value === "log");
  const longPeek = useTodayHabitLongPeekHandlers(setMenuOpen, !!(onEditHabit && onDeleteHabit));

  async function save() {
    const t = draft.trim();
    if (!t) return;
    const ok = await onSaveEntry(habit.id, t);
    if (ok !== false) setDraft("");
  }

  return (
    <div className="rc" style={cardStyle(false, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={false}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Log · {todays.length} today</div>
        </div>
        {onEditHabit && onDeleteHabit && (
          <TodayOverflowDotsBtn expanded={menuOpen} onToggle={() => setMenuOpen(p => !p)} />
        )}
      </div>
      {menuOpen && onEditHabit && onDeleteHabit && (
        <TodayHabitMenuDropdown
          habit={habit}
          onEdit={onEditHabit}
          onDelete={onDeleteHabit}
          menuOpen={menuOpen}
          onCloseMenu={() => setMenuOpen(false)}
        />
      )}
      <div style={{ padding:"0 15px 14px" }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write an entry for today…"
          rows={3}
          style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:T.surface, color:T.text, fontSize:13, padding:10, fontFamily:T.font, lineHeight:1.5 }}
        />
        <PBtn color={habit.color} style={{ marginTop:10 }} onClick={() => void save()}>Save entry</PBtn>
      </div>
    </div>
  );
}

// ─── Coach shell: deterministic Today greeting + bottom CoachBar ─────────────
function coachGreetingDaysLeft(targetYmd) {
  const t = todayStr();
  if (!targetYmd || targetYmd < t) return null;
  return Math.round((parseLocal(targetYmd) - parseLocal(t)) / 86400000);
}

/** One short line (body only). Caller prefixes with "Name: ". No AI. */
function buildCoachGreetingLine({ habits, goals }) {
  const hr = new Date().getHours();
  const tod = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
  const trackHabits = (habits || []).filter(h => h.habitType !== "log");
  const activeGoals = (goals || []).filter(g => g.status !== "completed");
  const total = trackHabits.length;
  const loggedCount = total ? trackHabits.filter(h => isSatisfiedForTodayRing(h)).length : 0;
  const all = total > 0 && loggedCount === total;
  const some = total > 0 && loggedCount > 0 && !all;
  const none = total > 0 && loggedCount === 0;

  let urgent = null;
  let bestLeft = 8;
  for (const g of activeGoals) {
    if (!g.targetDate) continue;
    const left = coachGreetingDaysLeft(g.targetDate);
    if (left != null && left >= 0 && left < 7 && left < bestLeft) {
      bestLeft = left;
      urgent = { g, left };
    }
  }
  if (urgent) {
    const nm = String(urgent.g.name || "Goal").slice(0, 22);
    if (urgent.left === 0) return `"${nm}" is due today — check in?`;
    if (urgent.left === 1) return `"${nm}" due tomorrow — on track?`;
    return `"${nm}" in ${urgent.left} days — one step today?`;
  }

  let topH = null;
  let topS = 0;
  for (const h of trackHabits) {
    const s = getStreak(h);
    if (s >= 5 && s > topS) {
      topS = s;
      topH = h;
    }
  }
  if (topH) {
    const nm = String(topH.name || "Habit").slice(0, 18);
    return `${nm} — ${topS}-day streak. Keep it?`;
  }

  if (all) {
    if (tod === "morning") return `All habits in — you're ahead today.`;
    if (tod === "afternoon") return `Full sweep already — nice.`;
    return `Everything logged — how was the day?`;
  }
  if (some) {
    if (tod === "morning") return `Good start — clear the rest when ready.`;
    if (tod === "afternoon") return `Halfway through — log what's left?`;
    return `Solid progress — finish the set tonight?`;
  }
  if (none) {
    if (tod === "morning") return `Morning — tap a habit when you're ready.`;
    if (tod === "afternoon") return `Still time to log something today.`;
    return `Evening — log what you got done?`;
  }
  if (tod === "morning") return `How's the morning going?`;
  if (tod === "evening") return `How did today go?`;
  return `How's the day going?`;
}

function CoachGreeting({ coachName, coachIcon, habits, goals, habitAccent, onOpenMic }) {
  const displayName = (coachName || "Coach").trim() || "Coach";
  const body = buildCoachGreetingLine({ habits, goals });
  const line = `${displayName}: ${body}`;
  const initial = displayName.charAt(0).toUpperCase();
  const accent = habitAccent || T.accent;
  return (
    <button
      type="button"
      onClick={onOpenMic}
      aria-label={`Open ${displayName} — voice`}
      style={{
        display:"flex", alignItems:"center", gap:12,
        width:"calc(100% - 28px)", margin:"8px 14px 0",
        padding:"12px 14px",
        background:T.surface,
        border:`0.5px solid ${T.border}`,
        borderLeft:`3px solid ${accent}`,
        borderRadius:T.rsm,
        cursor:"pointer",
        textAlign:"left",
        fontFamily:T.font,
        boxSizing:"border-box",
      }}
    >
      <div
        style={{
          width:36, height:36, borderRadius:"50%", flexShrink:0,
          background:`${accent}22`,
          border:`1px solid ${accent}55`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:18, lineHeight:1,
        }}
        aria-hidden
      >
        {coachIcon && COACH_ICON_OPTIONS.includes(coachIcon) ? coachIcon : initial}
      </div>
      <span style={{
        flex:1, minWidth:0, fontSize:13.5, fontWeight:500, color:T.text,
        lineHeight:1.45,
        display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
        overflow:"hidden",
      }}>
        {line}
      </span>
    </button>
  );
}

function CoachBar({ coachName, coachIcon, habitColor, onOpenMic, onOpenText, coachEverOpened, isListening = false, listeningInterim = "" }) {
  const coachLabelRaw = (coachName ?? "").trim() || "Coach";
  const coachLabelShort = coachLabelRaw.length > 12 ? `${coachLabelRaw.slice(0, 11)}…` : coachLabelRaw;
  const micColor = habitColor || T.accent;
  const initial = coachLabelRaw.charAt(0).toUpperCase();
  // When listening: mic button glows red with a pulsing animation to signal recording
  const micBg = isListening
    ? `linear-gradient(145deg, #E74C3C88 0%, #E74C3C55 55%, #C0392B 100%)`
    : `linear-gradient(145deg, ${micColor}35 0%, ${micColor}12 55%, ${T.raised} 100%)`;
  const micBorderColor = isListening ? "#E74C3Ccc" : `${micColor}88`;
  const micIconColor = isListening ? "#ff6b6b" : micColor;
  return (
    <div
      data-tour="coach-fab"
      style={{
        position:"relative",
        display:"flex", alignItems:"center",
        minHeight:52,
        padding:"10px 12px",
        background:T.surface,
        borderTop:`0.5px solid ${isListening ? "#E74C3C55" : T.border}`,
        borderRadius:20,
        boxShadow: isListening
          ? "0 -4px 24px rgba(231,76,60,0.28)"
          : "0 -4px 20px rgba(0,0,0,0.35)",
        fontFamily:T.font,
        transition:"box-shadow 0.2s, border-top-color 0.2s",
      }}
    >
      <div style={{ flex:1, display:"flex", justifyContent:"flex-start", alignItems:"center", minWidth:0 }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, width:56, flexShrink:0 }}>
          <div
            style={{
              width:28, height:28, borderRadius:"50%",
              background:`${micColor}18`,
              border:`1px solid ${micColor}66`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:14, lineHeight:1,
            }}
            aria-hidden
          >
            {coachIcon && COACH_ICON_OPTIONS.includes(coachIcon) ? coachIcon : initial}
          </div>
          <span style={{
            fontSize:9, fontWeight:600,
            color: isListening ? "#E74C3C" : T.muted,
            textAlign:"center", lineHeight:1.15,
            maxWidth:56, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            transition:"color 0.2s",
          }}>
            {isListening ? "Listening…" : coachLabelShort}
          </span>
        </div>
        {/* Interim transcript shown while listening */}
        {isListening && listeningInterim && (
          <span style={{
            fontSize:12, color:T.sub, fontStyle:"italic",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            maxWidth:"calc(100% - 72px)", marginLeft:4,
          }}>
            "{listeningInterim}"
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenMic}
        aria-label={isListening ? "Stop listening" : `${coachLabelRaw} — voice`}
        title={isListening ? "Stop" : "Voice"}
        style={{
          position:"absolute", left:"50%", transform:"translateX(-50%)",
          width:52, height:52, borderRadius:"50%",
          border:`1px solid ${micBorderColor}`,
          background:micBg,
          color:micIconColor,
          cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow: isListening
            ? `0 0 0 3px rgba(231,76,60,0.2), 0 2px 12px rgba(0,0,0,0.35)`
            : `0 2px 12px rgba(0,0,0,0.35)`,
          animation: isListening
            ? "coachFabPulse 1s ease-in-out infinite"
            : coachEverOpened ? undefined : "coachFabPulse 2.4s ease-in-out infinite",
          transition:"background 0.2s, border-color 0.2s, box-shadow 0.2s, color 0.2s",
        }}
      >
        {isListening ? (
          /* Stop icon while recording */
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor"/>
          </svg>
        ) : (
          /* Mic icon at rest */
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M8 11v1a4 4 0 0 0 8 0v-1M12 18v2M9 22h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        )}
      </button>
      <div style={{ flex:1, display:"flex", justifyContent:"flex-end", alignItems:"center" }}>
        <button
          type="button"
          onClick={onOpenText}
          aria-label={`${coachLabelRaw} — type`}
          title="Type"
          style={{
            width:32, height:32, borderRadius:10,
            border:`0.5px solid ${T.borderStrong}`,
            background:T.raised,
            color:T.sub,
            cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
function TodayScreen({ habits, goals = [], xp, onTap, onUndo, onSkip, onAddNote, onLogZero, onOpenLog, onOpenGoalLog, onEditGoal, onCompleteGoal, onDeleteGoal, onShareGoal, onEditHabit, onDeleteHabit, onShareHabit, sharingHabitId, onXPInfo, onAdd, onSaveLogEntry, hideFloatingAdd, coachEverOpened = true, onOpenCoachMic, coachName, coachIcon, coachHabitColor, onOpenGoalDetail }) {
  const activeGoals = goals.filter(g => g.status !== "completed");
  const trackHabits = habits.filter(h => h.habitType !== "log");
  const logHabits = habits.filter(h => h.habitType === "log");
  const loggedCount = trackHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const totalTrackables = trackHabits.length;
  const pct = totalTrackables ? Math.round((loggedCount / totalTrackables) * 100) : 0;
  const hr = new Date().getHours();
  const greeting = hr < 12 ? "Rise and forge." : hr < 17 ? "Keep the heat up." : "Finish strong.";
  const level = getLevel(xp);
  const daily   = habits.filter(h => h.habitType === "daily");
  const limit   = habits.filter(h => h.habitType === "limit");
  const weekly  = habits.filter(h => h.habitType === "weekly");
  const project = habits.filter(h => h.habitType === "project");
  const ringSummary = totalTrackables
    ? `${loggedCount} of ${totalTrackables} logged`
    : logHabits.length
      ? "Logs below — ring is for habits & goals"
      : "";
  if (habits.length === 0 && activeGoals.length === 0) return (
    <div>
      {onOpenCoachMic && (
        <CoachGreeting
          coachName={coachName}
          coachIcon={coachIcon}
          habits={habits}
          goals={goals}
          habitAccent={coachHabitColor}
          onOpenMic={onOpenCoachMic}
        />
      )}
      <div style={{ padding:"40px 28px 32px", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⚒️</div>
        <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:10 }}>Nothing forged yet.</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:28 }}>
          Add a habit to track daily, or tell the coach what outcome you're working toward — it will help you build a plan.
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <button onClick={onAdd} style={{ padding:"13px 24px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>
            Add a habit
          </button>
          {onOpenCoachMic && (
            <button onClick={onOpenCoachMic}
              style={{ padding:"13px 24px", borderRadius:T.rsm, border:"0.5px solid rgba(200,144,42,0.5)", background:"rgba(200,144,42,0.08)", color:T.gold, fontSize:14, fontWeight:600, cursor:"pointer" }}>
              ✨ Plan a goal with my coach
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const showCoachNudge = habits.length > 0 && !coachEverOpened;

  return (
    <div>
      {showCoachNudge && (
        <button
          type="button"
          onClick={onOpenCoachMic}
          style={{
            display:"flex", alignItems:"center", gap:8,
            width:"calc(100% - 28px)", margin:"6px 14px 0",
            padding:"9px 12px",
            background:"linear-gradient(90deg, rgba(200,144,42,0.14), rgba(200,144,42,0.04))",
            border:"0.5px solid rgba(200,144,42,0.35)",
            borderRadius:T.rsm,
            color:T.gold, fontSize:12, fontWeight:600,
            cursor:"pointer", textAlign:"left",
            fontFamily:T.font,
          }}
        >
          <span aria-hidden style={{ fontSize:14, lineHeight:1 }}>✨</span>
          <span style={{ color:T.sub, fontWeight:500, flex:1, lineHeight:1.35 }}>
            Your coach reads your logs and notes — <span style={{ color:T.gold, fontWeight:700 }}>tap to ask</span> what it's already noticed.
          </span>
        </button>
      )}
      {onOpenCoachMic && (
        <CoachGreeting
          coachName={coachName}
          coachIcon={coachIcon}
          habits={habits}
          goals={goals}
          habitAccent={coachHabitColor}
          onOpenMic={onOpenCoachMic}
        />
      )}
      <div data-tour="today-summary" style={{ margin:"6px 14px 16px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"18px 20px", display:"flex", alignItems:"center", gap:18 }}>
        <Ring pct={pct}/>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:4 }}>{pct === 100 && totalTrackables > 0 ? "Forged for today." : greeting}</div>
          <div style={{ fontSize:13, color:T.muted }}>{ringSummary || " "}</div>
          <button onClick={onXPInfo} style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:500, padding:"3px 10px", borderRadius:12, background:"rgba(200,144,42,0.15)", color:T.gold, border:"none", cursor:"pointer" }}>
            ⚡ {xp} xp · {level.label}
          </button>
        </div>
      </div>
      {/* Tour target: wraps only the first non-empty section so the spotlight ring is tight */}
      {(() => {
        const sections = [
          activeGoals.length > 0
            ? <><SLabel>Goals</SLabel> {activeGoals.map(g => <TodayGoalCard key={g.id} goal={g} onOpenLog={onOpenGoalLog} onEdit={onEditGoal} onComplete={onCompleteGoal} onDelete={onDeleteGoal} onShareGoal={onShareGoal} onOpen={onOpenGoalDetail}/>)}</>
            : habits.length > 0 && onOpenCoachMic && (
              // No goals yet but has habits — invite them to plan toward an outcome
              <div key="goal-cta">
                <SLabel>Goals</SLabel>
                <button
                  type="button"
                  onClick={onOpenCoachMic}
                  style={{
                    display:"flex", alignItems:"center", gap:14,
                    margin:"0 14px 10px", width:"calc(100% - 28px)",
                    padding:"14px 16px", borderRadius:T.r,
                    border:"0.5px dashed rgba(200,144,42,0.4)",
                    background:"rgba(200,144,42,0.04)",
                    cursor:"pointer", textAlign:"left",
                  }}
                >
                  <div style={{ width:38, height:38, borderRadius:11, background:"rgba(200,144,42,0.12)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🎯</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:2 }}>Set a goal with your coach</div>
                    <div style={{ fontSize:12, color:T.muted, lineHeight:1.45 }}>
                      Tell the AI what outcome you're working toward — it'll help you plan milestones and track progress.
                    </div>
                  </div>
                  <div style={{ fontSize:16, color:T.gold, flexShrink:0 }}>→</div>
                </button>
              </div>
            ),
          daily.length   > 0 && <><SLabel>Daily</SLabel>          {daily.map(h   => <DailyCard  key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          limit.length   > 0 && <><SLabel>Limits</SLabel>         {limit.map(h   => <LimitCard  key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          weekly.length  > 0 && <><SLabel>Weekly targets</SLabel> {weekly.map(h  => <WeeklyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          project.length > 0 && <><SLabel>Build</SLabel>          {project.map(h => <ProjectCard key={h.id} habit={h} onOpenLog={onOpenLog} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          logHabits.length > 0 && onSaveLogEntry && <><SLabel>Logs</SLabel> {logHabits.map(h => <LogCard key={h.id} habit={h} onSaveEntry={onSaveLogEntry} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit}/>)}</>,
        ].filter(Boolean);
        return sections.map((sec, i) =>
          i === 0
            ? <div key={i} data-tour="today-first-section">{sec}</div>
            : <div key={i}>{sec}</div>
        );
      })()}
      <div style={{ height:16 }}/>
      {!hideFloatingAdd && (trackHabits.length > 0 || activeGoals.length > 0 || logHabits.length > 0) && onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add habit or goal"
          title="Add habit or goal"
          style={{
            position:"fixed", bottom:276, right:18, height:52, padding:"0 18px 0 16px",
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
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:10 }}>Interested in Forged Pro?</div>
      <div style={{ fontSize:13, color:T.muted, lineHeight:1.8, marginBottom:20 }}>
        Forged Pro is <strong style={{ color:T.text }}>$4.99/month</strong> — unlimited AI coaching, full history, friend nudges, and voice logging.
        <br/><br/>
        Leave your email and I'll reach out directly. Early users shape what gets built next.
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
function DaySection({ date, dayHabits, onReflect, onDeleteLogEntry, listFullyExpanded, journalCollapseNonce, onAccordionInteraction }) {
  const isToday = date === todayStr();
  const [open, setOpen] = useState(isToday);
  useEffect(() => {
    if (listFullyExpanded && !isToday) setOpen(true);
  }, [listFullyExpanded, isToday]);
  const prevCollapseNonce = useRef(null);
  useEffect(() => {
    if (prevCollapseNonce.current === null) {
      prevCollapseNonce.current = journalCollapseNonce;
      return;
    }
    if (prevCollapseNonce.current === journalCollapseNonce) return;
    prevCollapseNonce.current = journalCollapseNonce;
    if (!isToday) setOpen(false);
  }, [journalCollapseNonce, isToday]);

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
        <button type="button" onClick={() => { onAccordionInteraction?.(); setOpen(o => !o); }}
          style={{ width:"100%", display:"flex", alignItems:"center", padding:"10px 18px 8px", background:"none", border:"none", cursor:"pointer", gap:10 }}>
          {/* Colour line */}
          <div style={{ width:3, height:28, borderRadius:2, background:open?T.accent:T.borderStrong, flexShrink:0, transition:"background 0.2s ease" }}/>
          <div style={{ flex:1, textAlign:"left" }}>
            <div style={{ fontSize:13, fontWeight:500, color:open?T.text:T.muted, transition:"color 0.2s ease" }}>{label}</div>
            {!open && <div style={{ fontSize:11, color:T.hint, marginTop:1 }}>{emojis} · {totalLogs} {totalLogs === 1 ? "entry" : "entries"}</div>}
          </div>
          <div style={{ fontSize:14, color:T.hint, transition:"transform 0.2s ease", transform:open?"rotate(90deg)":"rotate(0deg)" }}>›</div>
        </button>
      )}

      {/* Expanded content */}
      {open && (
      <div style={{ animation:"journalFadeIn 0.18s ease-out" }}>
      {dayHabits.map(({ habit, logs, entryKey }) => (
        <HabitDayCard key={entryKey || habit.id} habit={habit} logs={logs} onReflect={onReflect} onDeleteLogEntry={onDeleteLogEntry}/>
      ))}
      </div>
      )}
    </div>
  );
}

// Missed day (marked by user, optional note) — list / week views
function MissedDaySection({ date, note, onEdit, onClear, listFullyExpanded, journalCollapseNonce, onAccordionInteraction }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (listFullyExpanded) setOpen(true);
  }, [listFullyExpanded]);
  const prevCollapseNonce = useRef(null);
  useEffect(() => {
    if (prevCollapseNonce.current === null) {
      prevCollapseNonce.current = journalCollapseNonce;
      return;
    }
    if (prevCollapseNonce.current === journalCollapseNonce) return;
    prevCollapseNonce.current = journalCollapseNonce;
    setOpen(false);
  }, [journalCollapseNonce]);
  const label = fmtEntryDate(date);
  const hasNote = !!(note && note.trim());
  return (
    <div style={{ margin:"0 14px 6px", borderRadius:T.r, border:`0.5px solid rgba(230,126,34,0.38)`, overflow:"hidden", background:"rgba(230,126,34,0.04)" }}>
      <button
        type="button"
        onClick={() => { onAccordionInteraction?.(); setOpen(o => !o); }}
        style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", background:"none", border:"none", cursor:"pointer", gap:10 }}>
        <span style={{ fontSize:12, fontWeight:600, color:T.amber }}>{label}</span>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:11, color:T.amber, fontWeight:700, background:"rgba(230,126,34,0.15)", borderRadius:10, padding:"2px 8px" }}>
            ✕ Missed{hasNote ? " · noted" : ""}
          </span>
          <span style={{ fontSize:11, color:T.hint }}>{open ? "▾" : "▸"}</span>
        </div>
      </button>
      {open && (
        <div style={{ padding:"0 14px 12px", borderTop:`0.5px solid rgba(230,126,34,0.18)`, animation:"journalFadeIn 0.18s ease-out" }}>
          {hasNote ? (
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, marginTop:10, marginBottom:10 }}>{note.trim()}</div>
          ) : (
            <div style={{ fontSize:12, color:T.muted, marginTop:8, marginBottom:8 }}>No note added yet.</div>
          )}
          <div style={{ display:"flex", gap:10 }}>
            <button type="button" onClick={onEdit} style={{ fontSize:11, color:T.amber, background:"rgba(230,126,34,0.12)", border:`0.5px solid rgba(230,126,34,0.35)`, borderRadius:T.rsm, padding:"5px 10px", cursor:"pointer", fontWeight:600 }}>
              {hasNote ? "Edit note" : "Add note"}
            </button>
            <button type="button" onClick={onClear} style={{ fontSize:11, color:T.hint, background:"none", border:"none", cursor:"pointer" }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Project session length for journal rows — 60→"1h", 90→"1h 30m", 45→"45m" */
function formatProjectMinutes(totalMins) {
  const m = Math.max(0, Math.floor(Number(totalMins) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (rest > 0) parts.push(`${rest}m`);
  if (parts.length === 0) return "0m";
  return parts.join(" ");
}

function renderJournalLogContent(habit, log) {
  const note = log.note?.trim();
  const noteSuffix = note ? ` · ${truncateText(note, 48)}` : "";

  if (habit.habitType === "log" && log.value === "log") return <>{note || "Log entry"}</>;

  if (log.value === "skip") return <>{`Skipped${noteSuffix}`}</>;
  if (log.value === "quicknote") return <>{note || "Quick note"}</>;

  if (habit.habitType === "limit" && typeof log.value === "number") {
    return <>{formatWithUnit(log.value, habit.unit)}{noteSuffix}</>;
  }
  if (habit.habitType === "goal" && typeof log.value === "number") {
    return <>{`Updated to ${formatWithUnit(log.value, habit.unit)}`}{noteSuffix}</>;
  }

  if (habit.habitType === "project" && log.value && typeof log.value === "object" && "minutes" in log.value) {
    const v = log.value;
    const topNote = note && (!v.note || v.note.trim() !== note) ? note : null;
    return (
      <>
        <div style={{ color: T.text }}>{formatProjectMinutes(v.minutes)}</div>
        {v.win ? (
          <div style={{ fontSize: 12, color: T.green, opacity: 0.92, marginTop: 4, lineHeight: 1.45 }}>
            Win: {truncateText(v.win, 200)}
          </div>
        ) : null}
        {v.hardPart ? (
          <div style={{ fontSize: 12, color: T.muted, marginTop: v.win ? 3 : 4, lineHeight: 1.45 }}>
            Hard: {truncateText(v.hardPart, 200)}
          </div>
        ) : null}
        {v.note?.trim() ? (
          <div style={{ fontSize: 12, fontStyle: "italic", color: T.sub, marginTop: (v.win || v.hardPart) ? 3 : 4, lineHeight: 1.45 }}>
            {truncateText(v.note.trim(), 400)}
          </div>
        ) : null}
        {topNote ? (
          <div style={{ fontSize: 12, fontStyle: "italic", color: T.sub, marginTop: 4, lineHeight: 1.45 }}>
            {truncateText(topNote, 72)}
          </div>
        ) : null}
      </>
    );
  }

  if (log.value === true) {
    return <>{`Done ✓${noteSuffix}`}</>;
  }
  if (typeof log.value === "number") return <>{`${formatWithUnit(log.value, habit.unit)}${noteSuffix}`}</>;
  if (log.reflection) return <>{`Reflection · ${truncateText(log.reflection, 72)}${noteSuffix}`}</>;
  if (log.value && typeof log.value === "object") {
    if (log.value.win) return <>{`Win · ${truncateText(log.value.win, 56)}`}</>;
    if (log.value.hardPart) return <>{`Hard part · ${truncateText(log.value.hardPart, 56)}`}</>;
  }
  if (log.value == null && note) return <>{note}</>;
  return <>{note || "Entry"}</>;
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
    if (habit.habitType === "log") {
      const n = nonNote.filter(l => l.value === "log").length;
      return `${n} log entr${n === 1 ? "y" : "ies"}`;
    }
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
              <div style={{ flex:1, fontSize:13, color:T.text, lineHeight:1.5, minWidth:0 }}>{renderJournalLogContent(habit, log)}</div>
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
      {!reflection && habit.habitType !== "goal" && habit.habitType !== "log" && (
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

// ─── JOURNAL COMPOSE SHEET ────────────────────────────────────────────────────
/** Bottom sheet for writing or editing a pure journal entry for a given date. */
function JournalComposeSheet({ initialContent = "", date, onSave, onClose }) {
  const [draft, setDraft] = useState(initialContent);
  const taRef = useRef(null);
  useEffect(() => { taRef.current?.focus(); }, []);

  const displayDate = (() => {
    const d = parseLocal(date);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  })();

  function handleSave() {
    if (!draft.trim()) return;
    onSave(date, draft.trim());
    onClose();
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"20px 20px 0 0", padding:"20px 16px 36px", boxSizing:"border-box" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 16px" }}/>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontFamily:T.serif, fontSize:18, color:T.text }}>📓 {displayDate}</div>
          <button type="button" onClick={onClose} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:22, lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <textarea
          ref={taRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write anything — what happened today, how you're feeling, what's on your mind…"
          rows={8}
          style={{
            width:"100%", boxSizing:"border-box", resize:"vertical",
            borderRadius:T.r, border:`0.5px solid ${T.border}`,
            background:T.surface, color:T.text, fontSize:14, lineHeight:1.65,
            padding:"12px 14px", fontFamily:T.font,
          }}
        />
        <div style={{ display:"flex", gap:10, marginTop:12 }}>
          <button type="button" onClick={handleSave} disabled={!draft.trim()}
            style={{ flex:1, padding:"12px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:draft.trim()?"pointer":"not-allowed", opacity:draft.trim()?1:0.5 }}>
            Save entry
          </button>
          <button type="button" onClick={onClose}
            style={{ padding:"12px 16px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:14, cursor:"pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── JOURNAL SCREEN ───────────────────────────────────────────────────────────
function JournalScreen({ habits, goals = [], onReflect, onDeleteJournalLog, journalUserId, isPro, onUpgrade, journalEntries = [], onSaveJournalEntry, initialTab, onInitialComposeDone }) {
  // "activity" = habit/goal log history (existing), "journal" = pure journal entries
  const [mainTab, setMainTab]   = useState(initialTab === "journal" ? "journal" : "activity");
  const [composeDate, setComposeDate] = useState(initialTab === "journal" ? todayStr() : null); // null = closed, "YYYY-MM-DD" = open

  // When navigating here from AddActionSheet "Write in journal", auto-open compose.
  // Once the sheet closes, clear the trigger so subsequent navigations don't re-open.
  useEffect(() => {
    if (initialTab === "journal" && composeDate === null) {
      onInitialComposeDone?.();
    }
  }, [composeDate]);
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState("day"); // "day" | "week" | "month"
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [missedMap, setMissedMap] = useState({});
  const [missedEditDate, setMissedEditDate] = useState(null);
  const [missedNoteDraft, setMissedNoteDraft] = useState("");
  const [monthMissedDraft, setMonthMissedDraft] = useState("");
  const [openWeeks, setOpenWeeks] = useState(() => new Set([weekStartFor(todayStr())]));
  const [listFullyExpanded, setListFullyExpanded] = useState(false);
  const [journalCollapseNonce, setJournalCollapseNonce] = useState(0);

  useEffect(() => {
    setMissedMap(loadJournalMissedMap(journalUserId));
  }, [journalUserId]);

  function toggleWeek(ws) {
    setListFullyExpanded(false);
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

  // tStr must be declared BEFORE goalMarkerDays — the forEach callbacks close over
  // it synchronously, so declaring it after (as it was) caused a TDZ crash whenever
  // any goal had a targetDate or milestone log entry.
  const tStr = todayStr();

  // Goal deadlines and milestones for this month view
  const goalMarkerDays = {}; // { dayNum: [{ type:"deadline"|"milestone", label, color, emoji, isFuture }] }
  (goals || []).filter(g => g.status !== "completed").forEach(g => {
    if (g.targetDate) {
      const d = parseLocal(g.targetDate);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        if (!goalMarkerDays[day]) goalMarkerDays[day] = [];
        goalMarkerDays[day].push({ type:"deadline", label:g.name, color:g.color, emoji:g.emoji, isFuture:g.targetDate >= tStr, goalId:g.id, currentValue:g.currentValue, targetValue:g.targetValue, startValue:g.startValue, unit:g.unit||"" });
      }
    }
    (g.logs || []).filter(l => l.type === "milestone" && l.date).forEach(ms => {
      const d = parseLocal(ms.date);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        if (!goalMarkerDays[day]) goalMarkerDays[day] = [];
        goalMarkerDays[day].push({ type:"milestone", label:ms.label, color:g.color, emoji:g.emoji, isFuture:ms.date >= tStr, goalId:g.id, goalName:g.name });
      }
    });
  });
  const missedDatesList = Object.keys(missedMap).sort((a, b) => b.localeCompare(a));
  const missedMarkedCount = missedDatesList.length;
  const mergedDatesSet = new Set([...dates, ...missedDatesList]);
  const mergedDesc = [...mergedDatesSet].sort((a, b) => b.localeCompare(a));
  const hasJournalRows = mergedDatesSet.size > 0;
  // Today always first; remaining days newest → oldest (ISO date sort)
  const sortedDatesDesc = hasJournalRows ? [tStr, ...mergedDesc.filter(d => d !== tStr)] : [];
  const weekKeysDesc = [...new Set(sortedDatesDesc.map(d => weekStartFor(d)))].sort((a, b) => b.localeCompare(a));
  const weekKeysKey = weekKeysDesc.join("|");

  useEffect(() => {
    if (viewMode !== "week" || !listFullyExpanded) return;
    setOpenWeeks(new Set(weekKeysDesc));
  }, [viewMode, listFullyExpanded, weekKeysKey]);

  useEffect(() => {
    if (selectedDay == null) { setMonthMissedDraft(""); return; }
    const ds = dayStr(selectedDay);
    setMonthMissedDraft(Object.prototype.hasOwnProperty.call(missedMap, ds) ? (missedMap[ds] || "") : "");
  }, [selectedDay, viewYear, viewMonth, missedMap]);

  function renderDayOrMissed(date) {
    const onAccordionInteraction = () => setListFullyExpanded(false);
    if (Object.prototype.hasOwnProperty.call(missedMap, date)) {
      return (
        <MissedDaySection
          key={date}
          date={date}
          note={missedMap[date]}
          onEdit={() => { setMissedEditDate(date); setMissedNoteDraft(missedMap[date] || ""); }}
          onClear={() => clearMissed(date)}
          listFullyExpanded={listFullyExpanded}
          journalCollapseNonce={journalCollapseNonce}
          onAccordionInteraction={onAccordionInteraction}
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
          listFullyExpanded={listFullyExpanded}
          journalCollapseNonce={journalCollapseNonce}
          onAccordionInteraction={onAccordionInteraction}
        />
      );
    }
    return null;
  }

  const listEmpty = sortedDatesDesc.length === 0;

  // Sort journal entries newest first for the journal tab
  const sortedJournalEntries = [...journalEntries].sort((a, b) => b.date.localeCompare(a.date));
  const todayJournalEntry = journalEntries.find(e => e.date === tStr);

  return (
    <div data-tour="journal-list">
      {/* Compose sheet */}
      {composeDate && (
        <JournalComposeSheet
          date={composeDate}
          initialContent={journalEntries.find(e => e.date === composeDate)?.content || ""}
          onSave={(date, content) => onSaveJournalEntry?.(date, content)}
          onClose={() => setComposeDate(null)}
        />
      )}

      {/* Header */}
      <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"flex-end", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Journal</div>
          <div style={{ fontSize:13, color:T.muted, marginTop:3 }}>
            {mainTab === "activity" ? (
              <>
                {loggedDaysCount} days logged
                {missedMarkedCount > 0 ? <span> · {missedMarkedCount} missed</span> : null}
              </>
            ) : (
              <>{sortedJournalEntries.length} {sortedJournalEntries.length === 1 ? "entry" : "entries"}</>
            )}
          </div>
        </div>
        {mainTab === "activity" ? (
          <div data-tour="journal-viewmode" style={{ display:"flex", background:T.surface, borderRadius:T.rsm, padding:3, gap:2 }}>
            {[["day","Day"],["week","Week"],["month","Month"]].map(([mode, label]) => (
              <button key={mode} type="button" onClick={() => { setViewMode(mode); setSelectedDay(null); if (mode === "month") setListFullyExpanded(false); }}
                style={{ padding:"5px 10px", borderRadius:7, border:"none", cursor:"pointer",
                  background:viewMode === mode ? T.raised : "none",
                  color:viewMode === mode ? T.text : T.muted, fontSize:11, fontWeight:500, transition:"all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setComposeDate(tStr)}
            style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            ✏️ Write
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:0, padding:"0 18px 14px" }}>
        {[["activity","Activity"],["journal","Journal"]].map(([tab, label]) => (
          <button key={tab} type="button" onClick={() => setMainTab(tab)}
            style={{ padding:"6px 16px", borderRadius:0, border:"none", cursor:"pointer", fontSize:12, fontWeight:500,
              background: mainTab === tab ? T.accent + "22" : "none",
              color: mainTab === tab ? T.accent : T.muted,
              borderBottom: mainTab === tab ? `2px solid ${T.accent}` : "2px solid transparent",
              transition:"all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── JOURNAL TAB ── */}
      {mainTab === "journal" && (
        <div style={{ padding:"0 16px 32px" }}>
          {/* Today's entry card or prompt */}
          {!todayJournalEntry ? (
            <button type="button" onClick={() => setComposeDate(tStr)}
              style={{ width:"100%", padding:"20px 18px", borderRadius:T.r, border:`1.5px dashed ${T.border}`, background:"none", cursor:"pointer", textAlign:"left", marginBottom:16, display:"flex", alignItems:"center", gap:14 }}>
              <span style={{ fontSize:28 }}>📓</span>
              <div>
                <div style={{ fontSize:14, fontWeight:500, color:T.text }}>Write today's entry</div>
                <div style={{ fontSize:12, color:T.muted, marginTop:3 }}>What happened today? How are you feeling? Anything on your mind.</div>
              </div>
            </button>
          ) : (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Today</div>
              <div style={{ padding:"14px 16px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}`, position:"relative" }}>
                <div style={{ fontSize:14, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{todayJournalEntry.content}</div>
                <button type="button" onClick={() => setComposeDate(tStr)}
                  style={{ marginTop:12, fontSize:12, color:T.accent, background:"none", border:"none", cursor:"pointer", padding:0, fontWeight:500 }}>
                  + Add more →
                </button>
              </div>
            </div>
          )}

          {/* Past entries */}
          {sortedJournalEntries.filter(e => e.date !== tStr).length === 0 && !todayJournalEntry && (
            <div style={{ padding:"32px 0", textAlign:"center", color:T.muted, fontSize:13 }}>
              No entries yet. Write your first one above.
            </div>
          )}
          {sortedJournalEntries.filter(e => e.date !== tStr).map(entry => {
            const d = parseLocal(entry.date);
            const label = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
            return (
              <div key={entry.id || entry.date} style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>{label}</div>
                <div style={{ padding:"14px 16px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}` }}>
                  <div style={{ fontSize:14, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{entry.content}</div>
                  <button type="button" onClick={() => setComposeDate(entry.date)}
                    style={{ marginTop:10, fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer", padding:0 }}>
                    Edit →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ACTIVITY TAB ── */}
      {mainTab === "activity" && (
      <>
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

      {(viewMode === "day" || viewMode === "week") && !listEmpty && (
        <div style={{ padding:"0 16px 12px", display:"flex", justifyContent:"flex-end" }}>
          <button
            type="button"
            onClick={() => {
              if (listFullyExpanded) {
                setListFullyExpanded(false);
                setJournalCollapseNonce(n => n + 1);
                if (viewMode === "week") setOpenWeeks(new Set());
              } else {
                setListFullyExpanded(true);
                if (viewMode === "week") setOpenWeeks(new Set(weekKeysDesc));
              }
            }}
            style={{
              padding:"6px 12px",
              borderRadius:T.rsm,
              border:`0.5px solid ${listFullyExpanded ? T.borderMid : T.borderStrong}`,
              background:listFullyExpanded ? T.raised : T.surface,
              color:listFullyExpanded ? T.text : T.muted,
              fontSize:11,
              fontWeight:500,
              cursor:"pointer",
              transition:"background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
            }}>
            {listFullyExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

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
            <div style={{ fontSize:14, fontWeight:500, color:T.text }}>Full history is part of Forged Pro</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>Core logging is free. Full history and the calendar view are included in Forged Pro.</div>
            <button onClick={onUpgrade}
              style={{ marginTop:6, padding:"10px 22px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#0F0F0D", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Unlock Forged Pro →
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
            <span style={{ color:T.gold, fontWeight:600 }}>🎯 goal deadline</span>
            <span style={{ color:T.gold }}>◆ milestone</span>
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
              const canMarkMissed = !!(firstLogDate && ds >= firstLogDate && ds < tStr && !hasEntries);
              const isOpenDay = canMarkMissed && !isMissed;
              const habitColors = hasEntries ? [...new Set(entryDays[day].map(e => e.habitColor))].slice(0, 3) : [];
              const goalMarkers = goalMarkerDays[day] || [];
              const hasDeadline = goalMarkers.some(m => m.type === "deadline");
              const hasMilestone = goalMarkers.some(m => m.type === "milestone");
              const anyGoalMarker = hasDeadline || hasMilestone;
              const goalMarkerTooltip = goalMarkers.map(m => `${m.type === "deadline" ? "🎯 Deadline" : "◆ Milestone"}: ${m.label}`).join(" · ");
              const clickable = hasEntries || isJourneyStart || isMissed || canMarkMissed || anyGoalMarker;
              let border = T.border;
              if (isSelected) border = T.accent;
              else if (isJourneyStart) border = T.gold;
              else if (isMissed) border = "rgba(230,126,34,0.45)";
              else if (hasDeadline) border = "rgba(200,144,42,0.55)";
              else if (hasMilestone) border = "rgba(200,144,42,0.3)";
              else if (isOpenDay) border = T.borderMid;
              else if (isToday) border = T.borderMid;
              return (
                <button key={day} type="button"
                  title={goalMarkerTooltip || undefined}
                  onClick={() => clickable && setSelectedDay(isSelected ? null : day)}
                  style={{
                    aspectRatio:"1", borderRadius:8,
                    border:`1px ${isOpenDay ? "dashed" : "solid"} ${border}`,
                    background:isSelected ? "rgba(192,57,43,0.15)" : hasDeadline ? "rgba(200,144,42,0.1)" : hasMilestone ? "rgba(200,144,42,0.05)" : isJourneyStart && !hasEntries ? "rgba(200,144,42,0.08)" : isMissed ? "rgba(230,126,34,0.06)" : isToday ? T.surface : T.raised,
                    cursor:clickable ? "pointer" : "default",
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1,
                    padding:2, transition:"all 0.15s",
                  }}>
                  <span style={{
                    fontSize:11,
                    color:isToday ? T.accent : isJourneyStart ? T.gold : hasEntries ? T.text : isMissed ? T.amber : anyGoalMarker ? T.gold : T.muted,
                    fontWeight:isToday || isJourneyStart || isMissed || anyGoalMarker ? 500 : 400,
                  }}>{day}</span>
                  {hasDeadline ? (
                    <span style={{ fontSize:9, lineHeight:1 }}>🎯</span>
                  ) : hasMilestone ? (
                    <span style={{ fontSize:8, color: goalMarkers.find(m=>m.type==="milestone")?.isFuture ? T.gold : T.hint, lineHeight:1 }}>◆</span>
                  ) : hasEntries ? (
                    <div style={{ display:"flex", gap:2 }}>
                      {habitColors.map((c, ci) => <div key={ci} style={{ width:4, height:4, borderRadius:"50%", background:c }}/>)}
                    </div>
                  ) : isMissed ? (
                    <div title="Marked missed" style={{ fontSize:10, fontWeight:800, color:T.amber, width:16, height:16, borderRadius:"50%", background:"rgba(230,126,34,0.18)", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>✕</div>
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
            const selGoalMarkers = goalMarkerDays[selectedDay] || [];
            const hasGoalMarkers = selGoalMarkers.length > 0;
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

                {/* Goal deadline / milestone cards for this day */}
                {hasGoalMarkers && (
                  <div style={{ marginBottom: hasSelEntries ? 12 : 0 }}>
                    {selGoalMarkers.map((m, mi) => {
                      if (m.type === "deadline") {
                        const range = (m.targetValue ?? 0) - (m.startValue ?? 0);
                        const pct = range !== 0
                          ? Math.max(0, Math.min(100, Math.round(((m.currentValue - m.startValue) / range) * 100)))
                          : (m.currentValue >= m.targetValue ? 100 : 0);
                        return (
                          <div key={mi} style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${m.color || T.border}55`, marginBottom:8 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                              <span style={{ fontSize:18 }}>{m.emoji || "🎯"}</span>
                              <div style={{ flex:1 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:m.color || T.text, lineHeight:1.3 }}>{m.label}</div>
                                <div style={{ fontSize:11, color:T.hint, marginTop:2 }}>🎯 Target deadline</div>
                              </div>
                            </div>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                              <span style={{ fontSize:12, color:T.muted }}>
                                <strong style={{ color:m.color || T.text }}>{m.currentValue}{m.unit}</strong>
                                {" of "}
                                <strong style={{ color:T.text }}>{m.targetValue}{m.unit}</strong>
                              </span>
                              <span style={{ fontSize:12, color:T.hint }}>{pct}%</span>
                            </div>
                            <div style={{ height:5, borderRadius:3, background:T.raised, overflow:"hidden" }}>
                              <div style={{ height:"100%", borderRadius:3, background:m.color || T.gold, width:`${pct}%`, transition:"width 0.4s" }} />
                            </div>
                          </div>
                        );
                      }
                      if (m.type === "milestone") {
                        return (
                          <div key={mi} style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${m.color || T.border}55`, marginBottom:8, display:"flex", alignItems:"flex-start", gap:10 }}>
                            <span style={{ fontSize:16, marginTop:1 }}>{m.emoji || "◆"}</span>
                            <div>
                              <div style={{ fontSize:11, color:T.hint, marginBottom:3 }}>◆ Milestone · {m.goalName}</div>
                              <div style={{ fontSize:13, fontWeight:600, color:m.color || T.text }}>{m.label}</div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}

                {/* Habit log entries */}
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
                      !hasGoalMarkers && (
                        <div style={{ padding:"20px 0", textAlign:"center", color:T.muted, fontSize:13 }}>No entries (future or before you started)</div>
                      )
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
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>Nothing here yet. Log a habit on <strong style={{ color:T.text }}>Today</strong> and add a line about how it went — that's what the pattern detection reads.</div>
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
                    {missedMarkedInWeek > 0 ? (
                      <span style={{ display:"block", fontSize:10, fontWeight:500, color:T.muted, marginTop:3 }}>{missedMarkedInWeek} missed</span>
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
          <div style={{ fontSize:12, color:T.text, marginBottom:8 }}><span style={{ color:T.amber, fontWeight:700, marginRight:6 }}>✕</span>Missed · {fmtEntryDate(missedEditDate)}</div>
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
      </>
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
// Hierarchy: summary stats → Weekly brief (hero) → Activity (collapsed detail) →
// Pattern detection (cross-habit links + tone + expandable detail) → Builds → Goals.
// Empty/low-data cards keep intentional placeholders so new accounts don’t see
// blank grids.

/** Split AI brief into skimmable blocks (paragraphs or grouped sentences). */
function weeklyBriefBlocks(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const byNl = trimmed.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
  if (byNl.length > 1) return byNl;
  const sentences = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [trimmed];
  const blocks = [];
  let cur = "";
  for (const s of sentences) {
    const part = s.trim();
    if (!part) continue;
    if ((cur + " " + part).length > 300 && cur) {
      blocks.push(cur.trim());
      cur = part;
    } else {
      cur = cur ? `${cur} ${part}` : part;
    }
  }
  if (cur) blocks.push(cur);
  return blocks.length ? blocks : [trimmed];
}

function InsightsScreen({ habits, goals = [], journalEntries = [], onShowHistory, onShare, isPro = false, onUpgrade, userId = null, userName = "" }) {
  // ── Weekly summary state ───────────────────────────────────────────────────
  const [weeklySummary,   setWeeklySummary]   = useState(null);
  const [summaryLoading,  setSummaryLoading]  = useState(false);
  const [summaryError,    setSummaryError]    = useState(null);
  const [briefQuota,      setBriefQuota]      = useState(null);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [patternsMoreExpanded, setPatternsMoreExpanded] = useState(false);

  const thisWeekStart = weekStartFor(todayStr());

  async function refreshBriefQuota() {
    if (!isPro || !userId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/weekly-summary?client_date=${encodeURIComponent(todayStr())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const j = await res.json();
      setBriefQuota({
        used: j.used,
        limit: j.limit,
        week_start: j.week_start,
        can_generate: j.can_generate,
      });
    } catch { /* ignore */ }
  }

  // Load cached brief + server quota on mount / when userId changes
  useEffect(() => {
    if (!isPro || !userId) return;
    try {
      const raw = localStorage.getItem(`forged_weekly_summary:${userId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const { text, ts, week_start: cachedWeek } = parsed;
        const weekOk = cachedWeek === thisWeekStart;
        if (text && weekOk && Date.now() - ts < WEEKLY_SUMMARY_TTL_MS) {
          setWeeklySummary(text);
        } else {
          try { localStorage.removeItem(`forged_weekly_summary:${userId}`); } catch { /* ignore */ }
          setWeeklySummary(null);
        }
      } else {
        setWeeklySummary(null);
      }
    } catch { /* ignore */ }
    refreshBriefQuota();
  }, [userId, isPro, thisWeekStart]);

  async function generateWeeklySummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/weekly-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          habits,
          goals,
          journalEntries,
          name: (userName || "").trim() || "there",
          client_date: todayStr(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429 && payload?.limit != null) {
          setBriefQuota({
            used: payload.used,
            limit: payload.limit,
            week_start: payload.week_start,
            can_generate: false,
          });
        }
        throw new Error(payload.error || `Error ${res.status}`);
      }
      const { text, used, limit, week_start } = payload;
      setWeeklySummary(text);
      if (typeof used === "number" && typeof limit === "number") {
        setBriefQuota({
          used,
          limit,
          week_start: week_start || thisWeekStart,
          can_generate: used < limit,
        });
      } else {
        refreshBriefQuota();
      }
      try {
        localStorage.setItem(
          `forged_weekly_summary:${userId}`,
          JSON.stringify({ text, ts: Date.now(), week_start: week_start || thisWeekStart }),
        );
      } catch { /* quota */ }
    } catch (err) {
      setSummaryError(err.message || "Generation failed");
    } finally {
      setSummaryLoading(false);
    }
  }
  function IC({ title, children, action, dataTour, subtitle, flush }) {
    return (
      <div data-tour={dataTour} style={{ margin: flush ? "0 0 12px" : "0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:18 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: subtitle ? 6 : 14 }}>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, textTransform:"uppercase", letterSpacing:"0.1em" }}>{title}</div>
          {action}
        </div>
        {subtitle && (
          <div style={{ fontSize:12, color:T.muted, lineHeight:1.55, marginBottom:14, fontWeight:450 }}>{subtitle}</div>
        )}
        {children}
      </div>
    );
  }

  /** Progressive disclosure — full-width tap target, premium feel */
  function InsightExpandable({ label, sublabel, open, onToggle, children }) {
    return (
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
            gap:12, padding:"16px 18px", background:"none", border:"none", cursor:"pointer",
            fontFamily:T.font, textAlign:"left",
          }}
        >
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:sublabel ? 6 : 0 }}>{label}</div>
            {sublabel && <div style={{ fontSize:12, color:T.muted, lineHeight:1.55, fontWeight:450 }}>{sublabel}</div>}
          </div>
          <span style={{ fontSize:11, color:T.gold, fontWeight:700, flexShrink:0, letterSpacing:"0.06em" }}>{open ? "HIDE" : "SHOW"}</span>
        </button>
        {open && (
          <div style={{ padding:"4px 14px 16px", borderTop:`0.5px solid ${T.border}` }}>
            {children}
          </div>
        )}
      </div>
    );
  }

  // Section header — structural divider between groups of cards.
  function SectionTitle({ label, hint, explainer }) {
    return (
      <div style={{ margin:"26px 18px 12px" }}>
        <div style={{ fontFamily:T.serif, fontSize:21, fontWeight:400, color:T.text, letterSpacing:"-0.02em", lineHeight:1.2 }}>{label}</div>
        {hint && (
          <div style={{ fontSize:10, fontWeight:700, color:T.hint, marginTop:6, letterSpacing:"0.12em", textTransform:"uppercase" }}>{hint}</div>
        )}
        {explainer && <div style={{ fontSize:12, color:T.muted, marginTop:10, lineHeight:1.65, maxWidth:420 }}>{explainer}</div>}
      </div>
    );
  }

  // Soft placeholder used inside cards when data isn't there yet.
  function EmptyHint({ icon = "✨", children }) {
    return (
      <div style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"4px 2px" }}>
        <span style={{ fontSize:16, lineHeight:1.2, opacity:0.8, flexShrink:0 }}>{icon}</span>
        <div style={{ fontSize:12, color:T.muted, lineHeight:1.65 }}>{children}</div>
      </div>
    );
  }

  // ── Derived data ───────────────────────────────────────────────────────────
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
  const totalLogsEver = new Set(allRealLogs.map(l => l.date)).size; // unique days tracked, consistent with profile/share
  const totalTracked = habits.length + goals.length;

  // Most consistent habit (highest 28-day completion rate).
  const mostConsistent = habits.length
    ? habits.reduce((best, h) => getCompletionRate(h) > getCompletionRate(best) ? h : best, habits[0])
    : null;
  const mostConsistentRate = mostConsistent ? getCompletionRate(mostConsistent) : 0;

  // Day-of-week pattern across real logs.
  const dow = getBestDayOfWeek(allRealLogs);
  // Deeper insights — computed from user-written text only (reflections, notes,
  // project wins, hard parts, goal notes). Cached under a per-user key with a
  // content-hash + 24h TTL so the analysis doesn't re-run on every render or
  // tab open, and so it stays stable until the user actually adds new writing.
  const deep = useMemo(() => {
    const corpus = getWrittenCorpus(habits, goals);
    const sig = hashCorpusSignature(corpus);
    const cached = readDeepInsightsCache(userId);
    const cacheShapeOk =
      !cached?.data ||
      cached.data.needsMoreData === true ||
      Array.isArray(cached.data.crossHabitLinks);
    if (
      cached &&
      cacheShapeOk &&
      cached.sig === sig &&
      typeof cached.ts === "number" &&
      Date.now() - cached.ts < DEEP_INSIGHTS_TTL_MS
    ) {
      return cached.data;
    }
    const data = analyzeDeepInsights(habits, goals);
    writeDeepInsightsCache(userId, { sig, ts: Date.now(), data });
    return data;
  }, [habits, goals, userId]);

  const hasPatternMore = !deep.needsMoreData && (
    (deep.momentumShift?.up?.length > 0 || deep.momentumShift?.down?.length > 0) ||
    (deep.consistencyGaps?.length > 0) ||
    (deep.recentHardPartQuotes?.length > 0) ||
    !!deep.mostReflectedHabit ||
    !!(deep.revisitEntry && deep.revisitEntry.text && deep.revisitEntry.text.length >= 60)
  );

  // Totals across habit grids — used to decide if 12-week/28-day cards have
  // enough real data to render meaningfully vs. the empty hint.
  const anyHabitLogs = habits.some(h => h.logs.some(l => l.value !== "quicknote" && l.value !== "skip"));
  const anyCompletionAboveZero = habits.some(h => getCompletionRate(h) > 0);

  const activitySummaryBits = [];
  if (anyHabitLogs && longestBestStreak > 0) activitySummaryBits.push(`Best streak on any habit: ${longestBestStreak} days`);
  if (dow.best && !dow.needsMoreData) activitySummaryBits.push(`You tend to log most on ${dow.best.label}s`);
  if (mostConsistent && mostConsistentRate > 0) activitySummaryBits.push(`${mostConsistent.name} is your steadiest lately (${mostConsistentRate}% over 28 days)`);

  if (habits.length === 0) return (
    <div style={{ padding:"60px 28px", textAlign:"center" }}>
      <div style={{ fontSize:36, marginBottom:14 }}>📈</div>
      <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>
        Log a habit on Today and your patterns will start appearing here.
      </div>
    </div>
  );

  const projectHabits = habits.filter(h => h.habitType === "project");
  const activeGoals = goals.filter(g => g.status !== "completed");

  return (
    <div>
      {/* Header */}
      <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:6 }}>Insights</div>
          <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.03em", lineHeight:1.05 }}>Forge report</div>
          {firstLogLabel && (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, lineHeight:1.45 }}>Tracking since <span style={{ color:T.sub, fontWeight:600 }}>{firstLogLabel}</span></div>
          )}
        </div>
        <button onClick={onShare} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:T.rsm, background:"rgba(200,144,42,0.12)", border:"none", color:T.gold, fontSize:12, fontWeight:600, cursor:"pointer", marginBottom:4 }}>
          📤 Share
        </button>
      </div>

      {/* Summary stats row */}
      <div data-tour="insights-stats" style={{ margin:"0 14px 8px", display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
        <Stat label="tracked" value={totalTracked}/>
        <Stat label="days logged" value={totalDaysLogged} color={T.text}/>
        <Stat label="best streak" value={longestBestStreak > 0 ? `🔥${longestBestStreak}` : "—"} color={T.gold}/>
        <Stat label="total logs" value={totalLogsEver}/>
      </div>
      <div style={{ margin:"0 18px 18px", fontSize:11, color:T.muted, lineHeight:1.55, maxWidth:400 }}>
        <span style={{ color:T.hint, fontWeight:700, fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", marginRight:8 }}>At a glance</span>
        What you track, how many different days you&apos;ve logged, your best streak, and total logging days.
      </div>

      {/* ══ Weekly brief — headline feature ═══════════════════════════════════ */}
      <div style={{
        margin:"0 14px 22px",
        background:`linear-gradient(165deg, rgba(200,144,42,0.18) 0%, rgba(26,26,22,0.94) 38%, ${T.raised} 100%)`,
        borderRadius:T.r,
        border:`1px solid rgba(200,144,42,0.42)`,
        padding:"22px 18px 20px",
        position:"relative",
        overflow:"hidden",
        boxShadow:"0 2px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(200,144,42,0.14)",
      }}>
        {!isPro && (
          <div style={{ position:"absolute", top:14, right:14 }}>
            <span style={{ fontSize:9, fontWeight:800, color:"#0F0F0D", background:T.gold, padding:"2px 7px", borderRadius:5, letterSpacing:"0.08em" }}>PRO</span>
          </div>
        )}
        <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em", marginBottom:10 }}>YOUR WEEKLY BRIEF</div>
        <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, letterSpacing:"-0.03em", lineHeight:1.15, marginBottom:10, maxWidth:320 }}>
          What actually moved this week
        </div>
        <div style={{ fontSize:12, color:T.muted, lineHeight:1.6, marginBottom:14, maxWidth:360, fontWeight:450 }}>
          Plain-language read on what held, what slipped, and what deserves attention. <strong style={{ color:T.sub, fontWeight:600 }}>Uses AI</strong> — capped so it stays sustainable.
        </div>
        {isPro && briefQuota && (
          <div style={{
            fontSize:11, color: briefQuota.can_generate ? T.sub : T.amber, marginBottom:14,
            padding:"8px 11px", borderRadius:8, background:"rgba(0,0,0,0.22)", border:`0.5px solid ${T.border}`,
            lineHeight:1.5,
          }}>
            <span style={{ fontWeight:700, color:T.text }}>{Math.max(0, briefQuota.limit - briefQuota.used)}</span> of {briefQuota.limit} fresh briefs left for the week of {fmtWeekRange(briefQuota.week_start || thisWeekStart)}.
            {!briefQuota.can_generate && " Resets next Monday."}
          </div>
        )}

        {!isPro ? (
          <>
            {onUpgrade && (
              <button type="button" onClick={onUpgrade} style={{ padding:"11px 18px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.5)`, background:"rgba(200,144,42,0.18)", color:T.gold, fontSize:13, fontWeight:700, cursor:"pointer", letterSpacing:"0.02em" }}>
                Unlock with Pro →
              </button>
            )}
          </>
        ) : weeklySummary ? (
          <>
            <div style={{ marginBottom:16 }}>
              {(() => {
                const blocks = weeklyBriefBlocks(weeklySummary);
                return blocks.map((block, i) => (
                <div
                  key={i}
                  style={{
                    fontSize:14,
                    color:T.text,
                    lineHeight:1.72,
                    fontWeight:450,
                    marginBottom: i < blocks.length - 1 ? 14 : 0,
                    paddingBottom: i < blocks.length - 1 ? 14 : 0,
                    borderBottom: i < blocks.length - 1 ? `0.5px solid rgba(255,255,255,0.06)` : "none",
                  }}
                >
                  {block}
                </div>
                ));
              })()}
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:12 }}>
              <button
                type="button"
                onClick={() => { setWeeklySummary(null); try { localStorage.removeItem(`forged_weekly_summary:${userId}`); } catch { /* ignore */ } }}
                style={{ fontSize:12, color:T.gold, background:"none", border:"none", cursor:"pointer", padding:0, fontWeight:700 }}
              >
                ↻ New brief
              </button>
              {briefQuota && !briefQuota.can_generate && (
                <span style={{ fontSize:11, color:T.amber }}>No generations left this week.</span>
              )}
            </div>
          </>
        ) : (
          <>
            {summaryError && (
              <div style={{ fontSize:12, color:T.amber, marginBottom:10, lineHeight:1.5 }}>{summaryError}</div>
            )}
            <button
              type="button"
              onClick={generateWeeklySummary}
              disabled={summaryLoading || (briefQuota && !briefQuota.can_generate)}
              style={{
                padding:"12px 22px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.55)`,
                background: summaryLoading || (briefQuota && !briefQuota.can_generate) ? "rgba(200,144,42,0.08)" : T.gold,
                color: summaryLoading || (briefQuota && !briefQuota.can_generate) ? T.hint : "#0F0F0D",
                fontSize:13, fontWeight:800, cursor: summaryLoading || (briefQuota && !briefQuota.can_generate) ? "default" : "pointer", letterSpacing:"0.02em",
              }}
            >
              {summaryLoading ? "Writing your brief…" : briefQuota && !briefQuota.can_generate ? "Limit reached this week" : "Generate my weekly brief"}
            </button>
          </>
        )}
      </div>

      {/* ══ Activity ══════════════════════════════════════════════════════════ */}
      <SectionTitle
        label="Activity"
        hint="By the numbers"
        explainer="Streaks, completion bars, and heatmaps live below. This section is support — your weekly brief and patterns carry the story."
      />

      <div data-tour="insights-streaks" style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:14 }}>
        <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Highlights</div>
        <div style={{ fontSize:13, color:T.sub, lineHeight:1.65, marginBottom:12, fontWeight:450 }}>
          {activitySummaryBits.length > 0
            ? activitySummaryBits.map((line, i) => (
                <div key={i} style={{ marginBottom: i < activitySummaryBits.length - 1 ? 8 : 0, paddingLeft:11, borderLeft:`3px solid rgba(200,144,42,0.55)` }}>{line}</div>
              ))
            : "Log a few more days and we’ll drop your streak leader, steadiest habit, and strongest weekday here."}
        </div>
        <button
          type="button"
          onClick={() => setActivityExpanded(e => !e)}
          style={{
            width:"100%", padding:"10px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`,
            background:"rgba(255,255,255,0.04)", color:T.text, fontSize:11, fontWeight:700,
            cursor:"pointer", fontFamily:T.font,
          }}
        >
          {activityExpanded ? "Hide charts & streaks" : "Show streaks, rates & 12-week grids"}
        </button>
      </div>

      {activityExpanded && (
      <>
      {/* Streaks */}
      <IC
        title="Streaks"
        action={<button onClick={onShowHistory} style={{ fontSize:12, color:T.accent, background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Full history →</button>}
      >
        {anyHabitLogs ? (
          [...habits].sort((a, b) => getStreak(b) - getStreak(a)).map(h => {
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
          })
        ) : (
          <EmptyHint icon="🔥">
            Log a few days and your current + best streak for each habit will appear here.
          </EmptyHint>
        )}
      </IC>

      {/* 28-day completion rate */}
      <IC
        title="28-day completion rate"
        subtitle="How often you hit your target. Daily = out of 28 days. Weekly = 4 weeks at target."
      >
        {anyCompletionAboveZero ? (
          [...habits].sort((a, b) => getCompletionRate(b) - getCompletionRate(a)).map(h => {
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
          })
        ) : (
          <EmptyHint icon="📊">
            Completion rates stabilise after about a week of logging — keep going and bars will start filling in.
          </EmptyHint>
        )}
      </IC>

      {/* 12-week heatmap */}
      <IC title="12-week activity">
        {anyHabitLogs ? (
          <>
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
          </>
        ) : (
          <EmptyHint icon="🗓️">
            Each square is a day. Your 12-week heatmap lights up as you log — come back after a few days to see the shape of your week.
          </EmptyHint>
        )}
      </IC>

      {/* Most consistent habit — kept in Activity (it's a stat, not a pattern) */}
      <IC title="Most consistent">
        {mostConsistent && mostConsistentRate > 0 ? (
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"4px 2px" }}>
            <div style={{
              width:44, height:44, borderRadius:"50%", flexShrink:0,
              background: `${mostConsistent.color}1a`, border:`1px solid ${mostConsistent.color}55`,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:22,
            }}>{mostConsistent.emoji || "🏆"}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, color:T.text, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {mostConsistent.name}
              </div>
              <div style={{ fontSize:12, color:T.muted, lineHeight:1.55, marginTop:2 }}>
                Showing up <strong style={{ color:mostConsistent.color }}>{mostConsistentRate}%</strong> of days over the last 28.
              </div>
            </div>
          </div>
        ) : (
          <EmptyHint icon="🏆">
            As you log consistently, your strongest habit will stand out here.
          </EmptyHint>
        )}
      </IC>

      {/* Best day of week — also a stat, belongs in Activity */}
      <IC title="Best day of the week">
        {dow.best && !dow.needsMoreData ? (
          <div>
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, marginBottom:12 }}>
              You log the most on <strong style={{ color:T.gold }}>{dow.best.label}s</strong> — {dow.best.count} logs so far.
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {dow.counts.map((n, i) => {
                const maxN = Math.max(...dow.counts, 1);
                const pct = Math.round((n / maxN) * 100);
                const isBest = i === dow.best.idx;
                return (
                  <div key={i} style={{ textAlign:"center" }}>
                    <div style={{ height:34, display:"flex", alignItems:"flex-end", justifyContent:"center", marginBottom:4 }}>
                      <div style={{
                        width:"70%",
                        height:`${Math.max(pct, n > 0 ? 8 : 2)}%`,
                        background: isBest ? T.gold : T.surface,
                        border: isBest ? `1px solid rgba(200,144,42,0.45)` : `0.5px solid ${T.border}`,
                        borderRadius:3,
                        transition:"height 0.5s ease",
                      }}/>
                    </div>
                    <div style={{ fontSize:9, color: isBest ? T.gold : T.hint, fontWeight: isBest ? 700 : 500, letterSpacing:"0.04em" }}>
                      {["M","T","W","T","F","S","S"][i]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyHint icon="📅">
            After about a week of logs, we'll show which day of the week you tend to show up the most.
          </EmptyHint>
        )}
      </IC>
      </>
      )}

      {/* ══ Deeper insights — from what you've actually written ═══════════════
          Pulls from reflections, notes, project wins, hard parts, and goal
          notes. Cached per-user with a content-hash + 24h TTL (see useMemo
          above) so token cost is zero and analysis only re-runs when there's
          new writing or the cache expires. */}
      <SectionTitle
        label="Patterns in your words"
        hint={deep.needsMoreData
          ? "Needs a bit more writing"
          : "What keeps linking together"}
        explainer={deep.needsMoreData
          ? "Add a line when you log (win, hard part, or note). We read that text — not checkmarks — to spot ideas that bridge habits and how the mood of your words shifts week to week."
          : "We look for ideas that show up across more than one habit or goal, and compare the last week you wrote something to the week before. Not clinical — just a structured skim of your own language."}
      />

      {deep.needsMoreData ? (
        // Single intentional low-data state rather than 4 empty cards.
        <IC title="Keep logging — then this lights up">
          <EmptyHint icon="📝">
            A single sentence when you check in is enough. After a few days with notes, we’ll surface threads that tie different habits together and flag whether your wording has leaned lighter or heavier lately.
          </EmptyHint>
        </IC>
      ) : (
        <>
          {deep.crossHabitLinks && deep.crossHabitLinks.length > 0 && (
            <IC
              title="Threads across what you track"
              subtitle="Ideas that appear in more than one habit or goal — not random word counts."
            >
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {deep.crossHabitLinks.map((link, i) => (
                  <div key={`${link.term}-${i}`} style={{ paddingBottom: i < deep.crossHabitLinks.length - 1 ? 14 : 0, borderBottom: i < deep.crossHabitLinks.length - 1 ? `0.5px solid ${T.border}` : "none" }}>
                    <div style={{ display:"flex", flexWrap:"wrap", alignItems:"baseline", gap:8, marginBottom:8 }}>
                      <span style={{ fontFamily:T.serif, fontSize:17, color:T.gold, fontWeight:400, letterSpacing:"-0.02em" }}>{link.term}</span>
                      <span style={{ fontSize:10, color:T.hint, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>
                        {link.habitLabels.join(" · ")}
                      </span>
                    </div>
                    <div style={{ fontSize:13, color:T.text, lineHeight:1.6, fontWeight:500, marginBottom:link.sample ? 10 : 0 }}>
                      {link.connection}
                    </div>
                    {link.sample?.text && (
                      <div style={{ borderLeft:`2px solid rgba(200,144,42,0.45)`, paddingLeft:11 }}>
                        <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>
                          From {fmtEntryDate(link.sample.date)}
                        </div>
                        <div style={{ fontSize:12.5, color:T.muted, lineHeight:1.55, fontStyle:"italic" }}>
                          “{truncateText(link.sample.text, 200)}”
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </IC>
          )}

          {deep.moodTrend && (
            <IC
              title="Light vs. heavy wording"
              subtitle="We scan for simple upbeat vs. heavy words in everything you wrote — then compare the last 7 days you journaled to the 7 days before. Rough signal, not therapy."
            >
              {(() => {
                const total = deep.toneMix.pos + deep.toneMix.neg + deep.toneMix.neu || 1;
                const posPct = Math.round((deep.toneMix.pos / total) * 100);
                const negPct = Math.round((deep.toneMix.neg / total) * 100);
                const neuPct = Math.max(0, 100 - posPct - negPct);
                const label =
                  deep.moodTrend === "rising"    ? { text: "Leaning lighter than the week before", color: T.green, tail: "Your word choices tilted a bit more toward the positive list vs. the prior week." } :
                  deep.moodTrend === "declining" ? { text: "Leaning heavier than the week before",  color: T.amber, tail: "More of the heavy-word list showed up vs. the week prior — worth noticing, not diagnosing." } :
                                                    { text: "About the same tone as last week",       color: T.sub, tail: "No big swing between the two windows we compare." };
                return (
                  <>
                    <div style={{ fontSize:15, color:label.color, fontWeight:700, lineHeight:1.45, marginBottom:8, letterSpacing:"-0.02em" }}>
                      {label.text}
                    </div>
                    <div style={{ fontSize:12, color:T.muted, lineHeight:1.6, marginBottom:12, fontWeight:450 }}>
                      {label.tail}
                    </div>
                    <div style={{ display:"flex", height:8, borderRadius:4, overflow:"hidden", background:T.surface, marginBottom:8 }}>
                      <div style={{ width:`${posPct}%`, background:T.green, transition:"width 0.6s ease" }}/>
                      <div style={{ width:`${neuPct}%`, background:T.border }}/>
                      <div style={{ width:`${negPct}%`, background:T.amber, transition:"width 0.6s ease" }}/>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.hint, fontWeight:600 }}>
                      <span><span style={{ color:T.green }}>●</span> lighter {deep.toneMix.pos}</span>
                      <span>mixed {deep.toneMix.neu}</span>
                      <span><span style={{ color:T.amber }}>●</span> heavier {deep.toneMix.neg}</span>
                    </div>
                    <div style={{ fontSize:10, color:T.hint, lineHeight:1.55, marginTop:10, fontStyle:"normal" }}>
                      Score delta (last window vs. prior): {(deep.recentAvg - deep.priorAvg) >= 0 ? "+" : ""}{(deep.recentAvg - deep.priorAvg).toFixed(1)} on our tiny keyword scale.
                    </div>
                  </>
                );
              })()}
            </IC>
          )}

          {hasPatternMore && (
            <InsightExpandable
              label="Deeper detail"
              sublabel="Momentum vs. last week, habits that went quiet, hard lines you saved, where you write the most, and one past note worth rereading."
              open={patternsMoreExpanded}
              onToggle={() => setPatternsMoreExpanded(o => !o)}
            >
              {/* Momentum shift — which habits gained or lost consistency this week vs last */}
              {(deep.momentumShift?.up?.length > 0 || deep.momentumShift?.down?.length > 0) && (
                <IC flush title="This week vs. last week" subtitle="Which habits you hit more or less often than the week before.">
                  {deep.momentumShift.up.map(m => (
                    <div key={m.habitId} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}` }}>
                      <span style={{ fontSize:16, flexShrink:0 }}>{m.habitEmoji}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.habitName}</div>
                        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{m.lastWeek} → {m.thisWeek} days this week</div>
                      </div>
                      <div style={{ fontSize:12, fontWeight:700, color:T.green, flexShrink:0 }}>↑ picking up</div>
                    </div>
                  ))}
                  {deep.momentumShift.down.map(m => (
                    <div key={m.habitId} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}` }}>
                      <span style={{ fontSize:16, flexShrink:0 }}>{m.habitEmoji}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.habitName}</div>
                        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{m.lastWeek} → {m.thisWeek} days this week</div>
                      </div>
                      <div style={{ fontSize:12, fontWeight:700, color:T.amber, flexShrink:0 }}>↓ dropping off</div>
                    </div>
                  ))}
                </IC>
              )}

              {/* Consistency gaps — habits that were active but have gone quiet this week */}
              {deep.consistencyGaps?.length > 0 && (
                <IC flush title="Gone quiet" subtitle="These were active before but have not shown up this week — a nudge to check in, not a judgement.">
                  {deep.consistencyGaps.slice(0, 3).map(g => (
                    <div key={g.habitId} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}` }}>
                      <span style={{ fontSize:16, flexShrink:0 }}>{g.habitEmoji}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{g.habitName}</div>
                        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>Last logged {fmtEntryDate(g.lastLogDate)} · {g.daysSilent} {g.daysSilent === 1 ? "day" : "days"} ago</div>
                      </div>
                      <div style={{ fontSize:18, flexShrink:0 }}>🔇</div>
                    </div>
                  ))}
                </IC>
              )}

              {/* Hard-part quotes — what you actually wrote when things got hard */}
              {deep.recentHardPartQuotes?.length > 0 && (
                <IC flush title="What's been hard" subtitle="Lines you saved on tough days — useful to see the pattern in your own words.">
                  {deep.recentHardPartQuotes.map((q, i) => (
                    <div key={i} style={{ padding:"10px 0", borderTop: i > 0 ? `0.5px solid ${T.border}` : "none" }}>
                      <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>
                        {fmtEntryDate(q.date)}{q.habitName ? ` · ${q.habitName}` : ""}
                      </div>
                      <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, fontStyle:"italic" }}>
                        "{truncateText(q.text, 180)}"
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize:11, color:T.hint, lineHeight:1.6, marginTop:10, paddingTop:10, borderTop:`0.5px solid ${T.border}` }}>
                    Naming the pattern is half the fix.
                  </div>
                </IC>
              )}

              {deep.mostReflectedHabit && (
                <IC flush title="What you write about most" subtitle="The habit that shows up most in your notes — often where you're doing the emotional work.">
                  <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>
                    <strong style={{ color:T.text }}>{deep.mostReflectedHabit.name}</strong> shows up in your writing more than anything else — <strong style={{ color:T.text }}>{deep.mostReflectedHabit.days}</strong> {deep.mostReflectedHabit.days === 1 ? "day" : "days"} of notes so far. That's usually where the real work is happening.
                  </div>
                </IC>
              )}

              {deep.revisitEntry && deep.revisitEntry.text && deep.revisitEntry.text.length >= 60 && (
                <IC flush title="Worth revisiting" subtitle="Something you wrote recently that might still ring true.">
                  <div style={{ borderLeft:`2px solid ${T.accent}`, paddingLeft:12 }}>
                    <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>
                      {fmtEntryDate(deep.revisitEntry.date)}
                      {deep.revisitEntry.habitName ? ` · ${deep.revisitEntry.habitName}` : ""}
                      {deep.revisitEntry.goalName  ? ` · ${deep.revisitEntry.goalName}`  : ""}
                      {deep.revisitEntry.kind === "win"  ? " · win"      : ""}
                      {deep.revisitEntry.kind === "hard" ? " · hard part": ""}
                    </div>
                    <div style={{ fontSize:13, color:T.text, lineHeight:1.65, fontStyle:"italic" }}>
                      “{truncateText(deep.revisitEntry.text, 260)}”
                    </div>
                  </div>
                </IC>
              )}
            </InsightExpandable>
          )}
        </>
      )}

      {/* ══ Builds (project habits) ══════════════════════════════════════════ */}
      {projectHabits.length > 0 && (
        <>
          <SectionTitle
            label="Builds"
            hint="Deep work and side projects you track with time."
            explainer="For “build” habits you log minutes, wins, and rough patches. This section totals your hours, what went well lately, and where you said it was hard — so you see the arc of the project, not just today’s checkbox."
          />
          {projectHabits.map(h => {
            const s = getProjectStats(h);
            return (
              <IC key={h.id} title={`${h.emoji} ${h.name} — all time`}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:s.wins>0?16:0 }}>
                  <Stat label="total hrs" value={s.totalHours} color={h.color}/>
                  <Stat label="hrs this wk" value={s.weekHours}/>
                  <Stat label="wins" value={s.wins} color={T.green}/>
                  <Stat label="hard parts" value={s.hard} color={T.amber}/>
                </div>
                {s.wins > 0 ? (
                  <>
                    <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Wins log</div>
                    {[...h.logs].filter(l => l.value?.win).reverse().slice(0, 5).map((l, i) => (
                      <div key={i} style={{ display:"flex", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}`, alignItems:"flex-start" }}>
                        <span style={{ fontSize:10, color:h.color+"99", flexShrink:0, width:80, marginTop:2, fontWeight:500 }}>{fmtEntryDate(l.date)}</span>
                        <span title={l.value.win} style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>{truncateText(l.value.win, 120)}</span>
                      </div>
                    ))}
                  </>
                ) : s.totalHours === 0 ? (
                  <EmptyHint icon="🛠️">
                    Log some build time on Today and your hours, wins, and hard parts will start filling in.
                  </EmptyHint>
                ) : null}
              </IC>
            );
          })}
        </>
      )}

      {/* ══ Goals ════════════════════════════════════════════════════════════ */}
      {activeGoals.length > 0 && (
        <>
          <SectionTitle
            label="Goals"
            hint="Numeric targets you're working toward."
            explainer="Each goal shows where you are now vs your target, a simple progress bar, and recent measurements. It matters because you can spot drift early — before the deadline sneaks up."
          />
          {activeGoals.map(g => {
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
                {logs.length > 0 ? (
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
                ) : (
                  <EmptyHint icon="📈">
                    Log a measurement on Today and this chart will start showing your trajectory toward the target.
                  </EmptyHint>
                )}
              </IC>
            );
          })}
        </>
      )}

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

/**
 * Returns pacing info for a goal that has a deadline.
 * Tells you whether the user is on track, ahead, or behind based on
 * time elapsed vs progress made.
 * Returns null if no deadline is set.
 */
function getGoalPacing(goal) {
  if (!goal.targetDate) return null;
  const today = todayStr();
  const stats = getGoalProgress(goal);
  if (stats.isComplete) return { status: "complete", daysLeft: 0 };

  const daysLeft = Math.round((parseLocal(goal.targetDate) - parseLocal(today)) / 86400000);
  if (daysLeft < 0) return { status: "overdue", daysLeft };

  // Use first numeric log date as start reference, fall back to today
  const numericLogs = (goal.logs || [])
    .filter(l => typeof l.value === "number")
    .sort((a, b) => a.date.localeCompare(b.date));
  const startDate = numericLogs.length > 0 ? numericLogs[0].date : today;
  const totalDays = Math.round((parseLocal(goal.targetDate) - parseLocal(startDate)) / 86400000);
  if (totalDays <= 0) return { status: "on-track", daysLeft };

  const daysElapsed = Math.round((parseLocal(today) - parseLocal(startDate)) / 86400000);
  const timeUsedPct = Math.min(1, Math.max(0, daysElapsed / totalDays));
  const progressPct = stats.pct / 100;
  const gap = progressPct - timeUsedPct;

  let status;
  if (gap > 0.1) status = "ahead";
  else if (gap >= -0.05) status = "on-track";
  else status = "behind";

  return { status, daysLeft, timeUsedPct: Math.round(timeUsedPct * 100), progressPct: stats.pct };
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
function AddActionSheet({ onAddHabit, onAddGoal, onAddLog, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"20px 20px 0 0", padding:"20px 16px 40px" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }}/>
        <button type="button" onClick={onAddHabit} style={{ display:"flex", alignItems:"center", gap:14, width:"100%", padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:10, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22 }}>⚒️</span>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>Add a habit</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Daily check-ins, weekly targets, build habits, or limit/reduce tracking</div>
          </div>
        </button>
        <button type="button" onClick={onAddGoal} style={{ display:"flex", alignItems:"center", gap:14, width:"100%", padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:10, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22 }}>🎯</span>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>Set a goal</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Outcomes with numbers (weight, savings, PRs) — not the same as daily habits or limits</div>
          </div>
        </button>
        <button type="button" onClick={onAddLog} style={{ display:"flex", alignItems:"center", gap:14, width:"100%", padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:10, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22 }}>📓</span>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>Write in journal</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Freeform daily entries — thoughts, feelings, events. No streaks, no stats.</div>
          </div>
        </button>
        <button type="button" onClick={onClose} style={{ width:"100%", padding:"13px", borderRadius:T.rsm, border:"none", background:T.surface, color:T.muted, fontSize:14, cursor:"pointer", marginTop:4 }}>Cancel</button>
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

function SocialScreen({ user, xp, habits, friends, friendRequests, sentRequests, friendsLoading, onSendRequest, onAccept, onDecline, onRemoveFriend, onCancelSentRequest, sharedGoals, sharedGoalsLoading, sharedGoalInvites, onAcceptGoalInvite, onDeclineGoalInvite, currentUserId, onDeleteSharedGoal, onNudgeFriend, onShareHabit, sharingHabitId, onToast, pendingInviteGoalId, onClearPendingInvite, betaLeaderboard = [], leaderboardLoading = false, myBetaRank = null, betaTotalCount = null, betaTicker = [], isPro = false, onUpgrade }) {
  const [showAddFriend,      setShowAddFriend]      = useState(false);
  const [addEmail,           setAddEmail]           = useState("");
  const [addError,           setAddError]           = useState("");
  const [addLoading,         setAddLoading]         = useState(false);
  const [addDone,            setAddDone]            = useState(false);
  // --- Nudge cooldown persistence ----------------------------------------
  // Stored per-day in localStorage so the "nudged ✓" state survives
  // reloads / tab switches. Old keys for previous days are purged on mount.
  const NUDGED_KEY_PREFIX = "forged_nudged_today_";
  function nudgedStorageKey(dayStr) { return `${NUDGED_KEY_PREFIX}${dayStr}`; }
  function loadNudgedToday() {
    try {
      const t = todayStr();
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NUDGED_KEY_PREFIX) && k !== nudgedStorageKey(t)) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
      const raw = localStorage.getItem(nudgedStorageKey(t));
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }
  function persistNudgedToday(set) {
    try {
      localStorage.setItem(nudgedStorageKey(todayStr()), JSON.stringify([...set]));
    } catch {}
  }

  // Per-goal all-time best group streak. Reads from localStorage and bumps the
  // stored value if the current streak beats it, so a new record implicitly
  // shows up as a higher "best Nd" badge next to the live streak pill.
  function updateGroupStreakBest(goalId, current) {
    if (!goalId) return Math.max(0, current | 0);
    const key = `forged_group_streak_best_${goalId}`;
    try {
      const raw = localStorage.getItem(key);
      let best = raw ? parseInt(raw, 10) : 0;
      if (!Number.isFinite(best) || best < 0) best = 0;
      if ((current | 0) > best) {
        localStorage.setItem(key, String(current | 0));
        return current | 0;
      }
      return best;
    } catch {
      return Math.max(0, current | 0);
    }
  }

  const [inviteGoalId,       setInviteGoalId]       = useState(null);
  const [invitedFriends,     setInvitedFriends]     = useState(() => new Set());
  const [sharedGoalDeleteId, setSharedGoalDeleteId] = useState(null);
  const [deleteSharedLoading,setDeleteSharedLoading]= useState(false);
  const [selectedFriend,     setSelectedFriend]     = useState(null);
  // Compact Friends sheet — replaces the inline friends list in the body.
  // Holds: incoming requests, outgoing/pending requests, current friends, and
  // the Add friend form. Keeps the main Social page focused on leaderboard
  // and accountability while preserving every friend flow.
  const [showFriendsSheet,   setShowFriendsSheet]   = useState(false);
  const [nudgedToday,        setNudgedToday]        = useState(loadNudgedToday);
  // Marks a userId as nudged for today in both React state and localStorage,
  // so the "nudged ✓" pill persists across tab switches and reloads.
  function markNudged(userId) {
    setNudgedToday(prev => {
      if (prev.has(userId)) return prev;
      const next = new Set([...prev, userId]);
      persistNudgedToday(next);
      return next;
    });
  }
  // Nudge message sheet
  const [nudgeTarget,        setNudgeTarget]        = useState(null); // { userId, name }
  const [nudgeMessage,       setNudgeMessage]       = useState("");
  const [nudgeSending,       setNudgeSending]       = useState(false);
  // Share-a-habit picker (when user already has shared goals and wants to start another)
  const [showSharePicker,    setShowSharePicker]    = useState(false);

  // Auto-open invite picker when navigating here after sharing a habit
  useEffect(() => {
    if (pendingInviteGoalId) {
      setInviteGoalId(pendingInviteGoalId);
      setInvitedFriends(new Set());
      onClearPendingInvite?.();
    }
  }, [pendingInviteGoalId]);

  const today = todayStr();
  // Most-recent log date per friend, derived from shared-goal member logs we
  // already have in memory. Used to show "last active: Xd ago" in the compact
  // friends list so inactive accounts are visually distinct from active lurkers.
  const friendLastLogDate = (() => {
    const map = new Map();
    for (const g of sharedGoals || []) {
      for (const m of g.members || []) {
        if (!m.userId || m.isMe) continue;
        const logs = m.logs || [];
        for (const l of logs) {
          const d = typeof l?.date === "string" ? l.date : "";
          if (!d) continue;
          const prev = map.get(m.userId);
          if (!prev || d > prev) map.set(m.userId, d);
        }
      }
    }
    return map;
  })();
  function friendLastActiveLabel(friendId) {
    const d = friendLastLogDate.get(friendId);
    if (!d) return null;
    if (d === today) return "today";
    const t = parseLocal(today);
    const then = parseLocal(d);
    if (!t || !then) return null;
    const days = Math.max(0, Math.floor((t.getTime() - then.getTime()) / (24 * 60 * 60 * 1000)));
    if (days <= 0) return "today";
    if (days === 1) return "1d ago";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }
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

  // XP → level (1 per 100 xp, purely cosmetic)
  const myLevel = Math.max(1, Math.floor((xp || 0) / 100) + 1);
  const xpIntoLevel = (xp || 0) % 100;

  // Rank medal for the beta board
  function medal(rank) {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return null;
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* ── Hero: Your card ─────────────────────────────────────────────── */}
      <div style={{
        position: "relative",
        margin: "0 0 22px",
        padding: "18px 18px 16px",
        background: `linear-gradient(140deg, rgba(200,144,42,0.18) 0%, rgba(200,144,42,0.06) 55%, ${T.surface} 100%)`,
        border: `0.5px solid rgba(200,144,42,0.35)`,
        borderRadius: T.r,
        boxShadow: "0 2px 24px rgba(200,144,42,0.06)",
        overflow: "hidden",
      }}>
        {/* Top row: avatar + name + pro/rank pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={46} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{user?.name || "You"}</div>
              {isPro && (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: T.gold, background: "rgba(200,144,42,0.16)", border: "0.5px solid rgba(200,144,42,0.4)", padding: "2px 7px", borderRadius: 8 }}>PRO</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
              Level {myLevel}
              {myBetaRank != null && (
                <> · <span style={{ color: T.gold, fontWeight: 600 }}>#{myBetaRank} in beta</span></>
              )}
            </div>
          </div>
        </div>

        {/* XP progress bar within level */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted, marginBottom: 4, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>
            <span>Level {myLevel}</span>
            <span>{xpIntoLevel}/100 xp</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.05)", overflow: "hidden", border: `0.5px solid ${T.border}` }}>
            <div style={{ height: "100%", width: `${xpIntoLevel}%`, background: `linear-gradient(90deg, ${T.gold}, #e0a94f)`, borderRadius: 3, transition: "width 0.5s ease" }} />
          </div>
          {(() => {
            // Social-proof pill: only show once the user is meaningfully ranked.
            if (myBetaRank == null || myBetaRank < 3) return null;
            if (betaLeaderboard.length < 5) return null;
            let label = null;
            if (betaTotalCount && betaTotalCount >= 5) {
              const pct = Math.max(1, Math.min(99, Math.round((myBetaRank / betaTotalCount) * 100)));
              const ahead = Math.max(0, betaTotalCount - myBetaRank);
              label = pct <= 25
                ? `Top ${pct}% of beta testers`
                : ahead >= 1
                  ? `Ahead of ${ahead} tester${ahead === 1 ? "" : "s"}`
                  : null;
            } else if (myBetaRank <= betaLeaderboard.length) {
              // No accurate total yet but user is in top 10 → percentile against the board.
              const pct = Math.max(1, Math.round((myBetaRank / betaLeaderboard.length) * 100));
              label = `Top ${pct}% of the board`;
            }
            if (!label) return null;
            return (
              <div style={{
                marginTop: 8,
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "3px 10px",
                borderRadius: 999,
                background: "rgba(200,144,42,0.14)",
                border: "0.5px solid rgba(200,144,42,0.35)",
                fontSize: 11, fontWeight: 600, color: T.gold,
                letterSpacing: "0.02em",
              }}>
                <span aria-hidden style={{ fontSize: 10 }}>▲</span>
                <span>{label}</span>
              </div>
            );
          })()}
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 0, borderTop: `0.5px solid ${T.border}`, paddingTop: 12 }}>
          <div style={{ flex: 1, textAlign: "center", borderRight: `0.5px solid ${T.border}` }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: myStreak > 0 ? T.text : T.muted, lineHeight: 1.1 }}>{myStreak}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 3, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>🔥 Streak</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", borderRight: `0.5px solid ${T.border}` }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text, lineHeight: 1.1 }}>{xp}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 3, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>⚡ XP</div>
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: myLoggedToday > 0 ? T.green : T.muted, lineHeight: 1.1 }}>{myLoggedToday}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 3, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Today</div>
          </div>
        </div>
      </div>

      {/* ── Compact Friends control ────────────────────────────────────────
          The full friends list, incoming requests, outgoing requests, and
          Add-friend form all live inside the FriendsSheet modal below. This
          button is the only friends affordance on the main page so the
          leaderboard + accountability stay front-and-center. */}
      <button
        type="button"
        onClick={() => setShowFriendsSheet(true)}
        style={{
          width: "100%",
          marginBottom: 18,
          padding: "12px 14px",
          background: T.raised,
          border: `0.5px solid ${T.border}`,
          borderRadius: T.r,
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: T.font,
          color: T.text,
          position: "relative",
        }}
      >
        {/* Avatar stack — up to 3 friend avatars */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, minWidth: 38 }}>
          {friends.length > 0 ? (
            friends.slice(0, 3).map((f, i) => (
              <div key={f.id} style={{
                marginLeft: i === 0 ? 0 : -10,
                border: `2px solid ${T.raised}`,
                borderRadius: "50%",
                lineHeight: 0,
              }}>
                <Avatar name={f.name} avatarUrl={f.avatarUrl} size={26} />
              </div>
            ))
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "rgba(200,144,42,0.12)",
              border: "0.5px solid rgba(200,144,42,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16,
            }}>👥</div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Friends</span>
            <span style={{ fontSize: 12, color: T.muted, fontWeight: 500 }}>
              {friends.length === 0
                ? "Add someone →"
                : `${friends.length} connected`}
            </span>
            {friendRequests.length > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 999,
                background: T.accent, color: "#fff",
                fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
              }}>
                {friendRequests.length} new request{friendRequests.length === 1 ? "" : "s"}
              </span>
            )}
            {friendRequests.length === 0 && sentRequests.length > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 999,
                background: "rgba(200,144,42,0.16)",
                color: T.gold,
                fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                border: "0.5px solid rgba(200,144,42,0.3)",
              }}>
                {sentRequests.length} pending
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: T.hint, marginTop: 2 }}>
            Add a friend to start a shared goal or send nudges
          </div>
        </div>
        <div style={{ color: T.muted, fontSize: 16, flexShrink: 0 }}>›</div>
      </button>

      {/* ── Forged Beta Leaderboard (global top 10 by XP) ────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ ...sectionLabel, marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <span>🏆 Forged Beta</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.hint, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Top 10 · All-time XP
          </div>
        </div>

        {leaderboardLoading ? (
          <div style={{ ...card, textAlign: "center", padding: "18px 0", color: T.muted, fontSize: 13 }}>Loading leaderboard…</div>
        ) : betaLeaderboard.length === 0 ? (
          <div style={{ ...card, textAlign: "center", padding: "24px 16px", color: T.muted, fontSize: 13, lineHeight: 1.6 }}>
            Be the first on the board.<br />
            Log a habit to start earning XP.
          </div>
        ) : (
          <div style={{ borderRadius: T.r, overflow: "hidden", border: `0.5px solid ${T.border}`, background: T.raised }}>
            {betaLeaderboard.map((row, i) => {
              const m = medal(row.rank);
              const highlight = row.isMe;
              return (
                <div key={row.id} style={{
                  display: "flex", alignItems: "center", gap: 11,
                  padding: "11px 14px",
                  borderBottom: i === betaLeaderboard.length - 1 ? "none" : `0.5px solid ${T.border}`,
                  background: highlight
                    ? "linear-gradient(90deg, rgba(200,144,42,0.14), rgba(200,144,42,0.04))"
                    : (row.rank <= 3 ? "rgba(200,144,42,0.035)" : "transparent"),
                }}>
                  {/* Rank / medal */}
                  <div style={{
                    width: 26, textAlign: "center", flexShrink: 0,
                    fontSize: m ? 18 : 13,
                    fontWeight: 700,
                    color: row.rank === 1 ? T.gold : row.rank <= 3 ? T.sub : T.muted,
                    lineHeight: 1,
                  }}>
                    {m || `#${row.rank}`}
                  </div>
                  <Avatar name={row.name} avatarUrl={row.avatarUrl} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: highlight ? 700 : 600,
                        color: highlight ? T.gold : T.text,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {highlight ? "You" : row.name}
                      </div>
                      {row.isPro && !highlight && (
                        <span style={{ fontSize: 8, fontWeight: 700, color: T.gold, background: "rgba(200,144,42,0.15)", padding: "1px 5px", borderRadius: 5, letterSpacing: "0.04em", flexShrink: 0 }}>PRO</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>
                      {row.streak > 0 ? `🔥 ${row.streak}` : "—"}
                      {row.loggedToday && <> · <span style={{ color: T.green }}>✓ active today</span></>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? T.gold : T.text, lineHeight: 1.1 }}>
                      {row.xp.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 9, color: T.hint, marginTop: 2, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>xp</div>
                  </div>
                </div>
              );
            })}
            {/* "You're #N" footer if user isn't in the top 10 */}
            {myBetaRank != null && !betaLeaderboard.some(r => r.isMe) && (
              <div style={{
                padding: "10px 14px",
                background: "rgba(200,144,42,0.07)",
                borderTop: `0.5px solid ${T.border}`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div style={{ fontSize: 12, color: T.sub }}>
                  You're <strong style={{ color: T.gold }}>#{myBetaRank}</strong> overall
                </div>
                <div style={{ fontSize: 11, color: T.muted }}>Keep forging ⚡</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Live-ish beta activity ticker ────────────────────────────────── */}
      {Array.isArray(betaTicker) && betaTicker.length > 0 && (() => {
        const items = betaTicker.slice(0, 3).map(r => {
          const isMeLikely = currentUserId && r.userId === currentUserId;
          const who = isMeLikely ? "You" : (r.firstName || "Someone");
          const name = r.habitName || "a habit";
          const emoji = r.emoji || "";
          if (r.streak && r.streak >= 5) {
            return `${emoji ? emoji + " " : ""}${who} on a ${r.streak}-day streak`;
          }
          const verb = r.habitType === "limit"
            ? "kept to a limit on"
            : r.habitType === "project"
              ? "made progress on"
              : "just logged";
          return `${emoji ? emoji + " " : ""}${who} ${verb} ${name}`;
        });
        if (items.length === 0) return null;
        const marqueeText = items.join("   •   ");
        return (
          <div style={{
            marginBottom: 18,
            padding: "8px 0",
            background: "rgba(200,144,42,0.04)",
            border: `0.5px solid ${T.border}`,
            borderRadius: T.rsm,
            overflow: "hidden",
            position: "relative",
          }}>
            <div aria-hidden style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 18,
              background: `linear-gradient(90deg, ${T.bg || "rgba(20,20,20,1)"} 0%, rgba(0,0,0,0) 100%)`,
              pointerEvents: "none", zIndex: 2,
            }} />
            <div aria-hidden style={{
              position: "absolute", right: 0, top: 0, bottom: 0, width: 18,
              background: `linear-gradient(270deg, ${T.bg || "rgba(20,20,20,1)"} 0%, rgba(0,0,0,0) 100%)`,
              pointerEvents: "none", zIndex: 2,
            }} />
            <div style={{
              display: "inline-block",
              whiteSpace: "nowrap",
              animation: "forgedTicker 38s linear infinite",
              fontSize: 12, color: T.sub, letterSpacing: "0.01em",
              paddingLeft: "100%",
            }}>
              {marqueeText}   •   {marqueeText}
            </div>
            <style>{`
              @keyframes forgedTicker {
                0%   { transform: translateX(0); }
                100% { transform: translateX(-50%); }
              }
              @media (prefers-reduced-motion: reduce) {
                div[data-forged-ticker] { animation: none !important; }
              }
            `}</style>
          </div>
        );
      })()}

      {/* Friends list / requests / Add friend now live in the FriendsSheet
          modal at the bottom of this component, opened by the compact
          Friends button above. Keeps the page focused on leaderboard +
          accountability. */}

      {/* ── Accountability / Shared goals ── */}
      <div style={{ marginBottom: 24 }}>
        {(() => {
          const shareableHabits = (habits || []).filter(h => h.habitType !== "log" && !h.sharedGoalId);
          return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ ...sectionLabel, marginBottom: 0 }}>Accountability</div>
              {sharedGoals.length > 0 && shareableHabits.length > 0 && onShareHabit && (
                <button type="button"
                  onClick={() => setShowSharePicker(true)}
                  disabled={!!sharingHabitId}
                  style={{ padding: "5px 12px", borderRadius: 16, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.gold, fontSize: 12, fontWeight: 600, cursor: sharingHabitId ? "default" : "pointer", opacity: sharingHabitId ? 0.6 : 1 }}>
                  {sharingHabitId ? "…" : "+ New goal"}
                </button>
              )}
            </div>
          );
        })()}

        {/* Pending goal invites */}
        {sharedGoalInvites.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {sharedGoalInvites.map(inv => (
              <div key={inv.id} style={{ ...card, display: "flex", alignItems: "center", gap: 12, background: "rgba(200,144,42,0.06)", border: `0.5px solid rgba(200,144,42,0.28)` }}>
                <div style={{ fontSize: 28, lineHeight: 1 }}>{inv.goal_emoji || "🎯"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{inv.goal_name}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                    <strong style={{ color: T.gold }}>{inv.inviter_name}</strong> invited you to join
                  </div>
                </div>
                <button type="button" onClick={() => onAcceptGoalInvite(inv)}
                  style={{ padding: "7px 16px", borderRadius: 16, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", marginRight: 6, flexShrink: 0 }}>
                  Join
                </button>
                <button type="button" onClick={() => onDeclineGoalInvite(inv.id)}
                  style={{ padding: "7px 10px", borderRadius: 16, border: `0.5px solid ${T.border}`, background: "none", color: T.muted, fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Shared goal cards */}
        {sharedGoalsLoading ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: T.muted, fontSize: 13 }}>Loading…</div>
        ) : sharedGoals.length === 0 ? (
          (() => {
            const shareableHabits = (habits || []).filter(h => h.habitType !== "log" && !h.sharedGoalId);
            const hasFriends = (friends || []).length > 0;
            return (
              <div style={{
                borderRadius: T.r,
                overflow: "hidden",
                border: `0.5px solid rgba(200,144,42,0.32)`,
                background: `linear-gradient(155deg, rgba(200,144,42,0.09) 0%, rgba(200,144,42,0.02) 50%, ${T.raised} 100%)`,
              }}>
                {/* Value prop header */}
                <div style={{ padding: "18px 18px 14px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 28, lineHeight: 1 }}>🤝</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>Stay accountable with a friend</div>
                      <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.55 }}>
                        Share a habit — you'll each see when the other logs. People who build habits with a partner are <strong style={{ color: T.gold }}>2–3× more likely</strong> to stick with them.
                      </div>
                    </div>
                  </div>

                  {/* Tiny proof row */}
                  <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: T.muted, background: T.surface, border: `0.5px solid ${T.border}`, padding: "4px 9px", borderRadius: 10 }}>✓ See who logged today</span>
                    <span style={{ fontSize: 11, color: T.muted, background: T.surface, border: `0.5px solid ${T.border}`, padding: "4px 9px", borderRadius: 10 }}>💪 Nudge them if they skip</span>
                  </div>
                </div>

                {/* Action area */}
                {shareableHabits.length > 0 && onShareHabit ? (
                  <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "14px 18px 16px", background: T.raised }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
                      Pick a habit to share
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {shareableHabits.slice(0, 4).map(h => {
                        const busy = sharingHabitId === h.id;
                        return (
                          <button key={h.id} type="button"
                            onClick={() => onShareHabit(h.id)}
                            disabled={!!sharingHabitId}
                            style={{
                              display: "flex", alignItems: "center", gap: 11,
                              padding: "10px 12px", borderRadius: T.rsm,
                              border: `0.5px solid ${T.borderStrong}`,
                              background: T.surface, color: T.text,
                              cursor: sharingHabitId ? "default" : "pointer",
                              textAlign: "left",
                              opacity: (sharingHabitId && !busy) ? 0.5 : 1,
                            }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{h.emoji}</span>
                            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</span>
                            <span style={{ fontSize: 11, color: T.gold, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>
                              {busy ? "…" : "Share →"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {!hasFriends && (
                      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 11, lineHeight: 1.55 }}>
                        No friends yet? Go ahead and create the goal — you can invite them the moment they accept your friend request.
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "14px 18px 16px", background: T.raised, fontSize: 12.5, color: T.sub, lineHeight: 1.55 }}>
                    Add a habit on the <strong style={{ color: T.text }}>Today</strong> screen first — then come back here to share it with a friend.
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          sharedGoals.map(g => {
            const isCreator = currentUserId && g.creatorId === currentUserId;
            const totalMembers = g.members.length;
            const wt = g.weeklyTarget || 3;
            const isWeekly = g.habitType === "weekly";

            // Kind-aware "did this member log today?" — accepts daily true,
            // numeric goal value, or non-zero limit value.
            function memberLoggedOn(logs, dateStr) {
              return (logs || []).some(l => {
                if (l.date !== dateStr) return false;
                if (g.habitType === "goal") {
                  const n = typeof l.value === "number" ? l.value : Number(l.value);
                  return Number.isFinite(n) || l.value === true;
                }
                if (g.habitType === "limit") return l.value === true || (typeof l.value === "number" && l.value !== 0);
                return true;
              });
            }
            // Distinct days a member has any qualifying log inside [from, to].
            function memberActivityCount(logs, fromStr, toStr) {
              const seen = new Set();
              for (const l of logs || []) {
                if (!l?.date) continue;
                if (l.date < fromStr || l.date > toStr) continue;
                if (g.habitType === "goal") {
                  const n = typeof l.value === "number" ? l.value : Number(l.value);
                  if (!(Number.isFinite(n) || l.value === true)) continue;
                } else if (g.habitType === "limit") {
                  if (!(l.value === true || (typeof l.value === "number" && l.value !== 0))) continue;
                }
                seen.add(l.date);
              }
              return seen.size;
            }

            const membersLoggedToday = g.members.filter(m => memberLoggedOn(m.logs, today)).length;
            const membersHitWeekTarget = isWeekly
              ? g.members.filter(m => sharedMemberWeekSessionCount(m.logs) >= wt).length
              : 0;
            const progress = isWeekly
              ? (totalMembers > 0 ? membersHitWeekTarget / totalMembers : 0)
              : (totalMembers > 0 ? membersLoggedToday / totalMembers : 0);

            // Last 7 vs prior 7 — total team activity-days. Honest signal for
            // "is this group cooling off or heating up?".
            const last7From  = daysAgo(6);
            const prior7From = daysAgo(13);
            const prior7To   = daysAgo(7);
            const last7Total  = g.members.reduce((s, m) => s + memberActivityCount(m.logs, last7From, today), 0);
            const prior7Total = g.members.reduce((s, m) => s + memberActivityCount(m.logs, prior7From, prior7To), 0);
            const weekDelta = last7Total - prior7Total;

            // Live group streak: consecutive trailing days where every member logged.
            // Today is counted only once everyone has already logged; otherwise we
            // skip it so yesterday's streak still stands in the morning.
            const groupStreak = (() => {
              if (totalMembers === 0) return 0;
              const memberDateSets = g.members.map(m => new Set((m.logs || []).map(l => l.date).filter(Boolean)));
              const oneDay = 24 * 60 * 60 * 1000;
              const todayDate = parseLocal(today);
              let count = 0;
              for (let i = 0; i < 365; i++) {
                const d = new Date(todayDate.getTime() - i * oneDay);
                const y = d.getFullYear();
                const mo = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                const ds = `${y}-${mo}-${dd}`;
                const allLogged = memberDateSets.every(s => s.has(ds));
                if (allLogged) count++;
                else if (i === 0) continue;
                else break;
              }
              return count;
            })();
            const groupStreakBest = updateGroupStreakBest(g.id, groupStreak);
            const isNewRecord = groupStreak > 0 && groupStreak === groupStreakBest && groupStreak >= 3;

            // Sort members by who's "ahead": weekly sessions (weekly), or
            // last-14-day activity (everything else). "You" stays in natural
            // sorted position so leadership reads truthfully.
            const sortKey = m => {
              if (isWeekly) return sharedMemberWeekSessionCount(m.logs);
              return memberActivityCount(m.logs, daysAgo(13), today);
            };
            const sortedMembers = [...g.members].sort((a, b) => {
              const sb = sortKey(b) - sortKey(a);
              if (sb !== 0) return sb;
              // Tiebreak: people who logged today first
              const al = memberLoggedOn(a.logs, today) ? 1 : 0;
              const bl = memberLoggedOn(b.logs, today) ? 1 : 0;
              return bl - al;
            });
            // Only crown a leader when there's a real gap (not a tie at zero).
            const leaderM = sortedMembers[0];
            const leaderScore = leaderM ? sortKey(leaderM) : 0;
            const runnerScore = sortedMembers[1] ? sortKey(sortedMembers[1]) : 0;
            const leaderId = (leaderScore > 0 && (totalMembers === 1 || leaderScore > runnerScore)) ? leaderM?.userId : null;

            // Pulse line — single dynamic momentum message at the top of the
            // card. Cascade picks the most relevant scenario; falls back to
            // null (no banner) so we never show filler.
            const me = g.members.find(m => m.isMe);
            const others = g.members.filter(m => !m.isMe);
            const meLogged = me ? memberLoggedOn(me.logs, today) : false;
            const othersLoggedToday = others.filter(m => memberLoggedOn(m.logs, today));
            const allLoggedToday = totalMembers > 0 && g.members.every(m => memberLoggedOn(m.logs, today));
            const meWeekSessions = me ? sharedMemberWeekSessionCount(me.logs) : 0;
            const meWeekDone = isWeekly && meWeekSessions >= wt;
            const allWeekDone = isWeekly && totalMembers > 0 && g.members.every(m => sharedMemberWeekSessionCount(m.logs) >= wt);

            const pulse = (() => {
              if (totalMembers <= 1) return null; // solo card — pulse is awkward
              if (isNewRecord) {
                return { icon: "🎉", text: `New record — ${groupStreak}-day group streak!`, tone: "good" };
              }
              if (isWeekly && allWeekDone) {
                return { icon: "🏆", text: `Whole crew hit ${wt} sessions this week.`, tone: "good" };
              }
              if (!isWeekly && allLoggedToday) {
                return { icon: "🎯", text: "Everyone's logged today — keep it alive tomorrow.", tone: "good" };
              }
              if (isWeekly && me) {
                if (meWeekDone) {
                  const behind = others.filter(m => sharedMemberWeekSessionCount(m.logs) < wt);
                  if (behind.length === 1) {
                    const need = wt - sharedMemberWeekSessionCount(behind[0].logs);
                    return { icon: "⚡", text: `Your week's done — ${behind[0].name || "they"} need ${need} more.`, tone: "ahead" };
                  }
                  if (behind.length > 1) {
                    return { icon: "⚡", text: `Your week's done — pull the team across.`, tone: "ahead" };
                  }
                } else if (meWeekSessions === wt - 1) {
                  return { icon: "🏁", text: `1 more session and your week's done.`, tone: "push" };
                } else if (meWeekSessions === 0) {
                  const ahead = others.find(m => sharedMemberWeekSessionCount(m.logs) > 0);
                  if (ahead) return { icon: "💪", text: `${ahead.name || "Friend"}'s already in this week — your move.`, tone: "behind" };
                }
              }
              if (!isWeekly && me) {
                if (meLogged && othersLoggedToday.length === 0 && others.length > 0) {
                  const single = others.length === 1 ? (others[0].name || "Friend") : null;
                  return { icon: "⚡", text: single ? `You're ahead today — ${single} hasn't logged.` : `You're ahead today — others haven't logged yet.`, tone: "ahead" };
                }
                if (!meLogged && othersLoggedToday.length > 0) {
                  const first = othersLoggedToday[0].name || "Friend";
                  return { icon: "💪", text: `${first}'s already logged — your move.`, tone: "behind" };
                }
              }
              if (groupStreak >= 3) {
                return { icon: "🔥", text: `${groupStreak} days strong as a team.`, tone: "good" };
              }
              if (!isWeekly && totalMembers > 0 && membersLoggedToday === 0) {
                return { icon: "⏳", text: "Nobody's logged today — be the one who starts it.", tone: "quiet" };
              }
              return null;
            })();
            const pulseColors = pulse ? ({
              good:   { bg: "rgba(78, 168, 110, 0.10)", border: "rgba(78, 168, 110, 0.30)", text: T.green },
              ahead:  { bg: "rgba(200,144,42,0.10)",    border: "rgba(200,144,42,0.30)",   text: T.gold  },
              behind: { bg: "rgba(200,144,42,0.10)",    border: "rgba(200,144,42,0.30)",   text: T.gold  },
              push:   { bg: "rgba(200,144,42,0.10)",    border: "rgba(200,144,42,0.30)",   text: T.gold  },
              quiet:  { bg: T.surface,                  border: T.border,                  text: T.sub   },
            }[pulse.tone]) : null;

            const habitTypeLabel = isWeekly
              ? `Weekly ×${wt}`
              : g.habitType === "project" ? "Build"
                : g.habitType === "goal" ? "Progress goal"
                  : g.habitType === "limit" ? "Limit"
                    : "Daily";
            const progressTitle = isWeekly ? "This week" : "Today's progress";
            const progressSummary = isWeekly
              ? `${membersHitWeekTarget} / ${totalMembers} hit target`
              : `${membersLoggedToday} / ${totalMembers} logged`;
            const accentColor = g.color || T.accent;
            return (
              <div key={g.id} style={{ marginBottom: 14, borderRadius: T.r, overflow: "hidden", border: `0.5px solid ${T.border}`, background: T.raised, boxShadow: "0 1px 10px rgba(0,0,0,0.14)" }}>
                {/* Color accent bar */}
                <div style={{ height: 3, background: accentColor }} />

                {/* Header */}
                <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ fontSize: 28, lineHeight: 1.1 }}>{g.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>{g.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", background: T.surface, borderRadius: 6, padding: "2px 7px", border: `0.5px solid ${T.border}` }}>{habitTypeLabel}</span>
                      <span style={{ fontSize: 11, color: T.muted }}>{totalMembers} member{totalMembers !== 1 ? "s" : ""}</span>
                      {groupStreak > 0 && (
                        <span title="Consecutive days where everyone logged"
                          style={{ fontSize: 10, fontWeight: 800, color: isNewRecord ? T.green : T.gold,
                            background: isNewRecord ? "rgba(78,168,110,0.14)" : "rgba(200,144,42,0.14)",
                            border: `0.5px solid ${isNewRecord ? "rgba(78,168,110,0.4)" : "rgba(200,144,42,0.35)"}`,
                            borderRadius: 6, padding: "2px 7px", letterSpacing: "0.02em" }}>
                          🔥 {groupStreak}d together
                        </span>
                      )}
                      {groupStreakBest > 0 && groupStreakBest !== groupStreak && (
                        <span title="Best group streak ever achieved"
                          style={{ fontSize: 10, fontWeight: 600, color: T.hint, letterSpacing: "0.02em" }}>
                          best {groupStreakBest}d
                        </span>
                      )}
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => { setInviteGoalId(g.id); setInvitedFriends(new Set()); }}
                    style={{ flexShrink: 0, padding: "5px 12px", borderRadius: 12, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.sub, fontSize: 11, cursor: "pointer", fontWeight: 600, marginTop: 2 }}>
                    + Invite
                  </button>
                </div>

                {/* Pulse line — momentum / leadership / nudge prompt */}
                {pulse && pulseColors && (
                  <div style={{
                    margin: "0 16px 12px",
                    padding: "9px 12px",
                    background: pulseColors.bg,
                    border: `0.5px solid ${pulseColors.border}`,
                    borderRadius: T.rsm,
                    display: "flex", alignItems: "center", gap: 9,
                  }}>
                    <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{pulse.icon}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: pulseColors.text, lineHeight: 1.4 }}>
                      {pulse.text}
                    </span>
                  </div>
                )}

                {/* Progress bar */}
                <div style={{ padding: "0 16px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                    <span style={{ fontSize: 11, color: T.muted, fontWeight: 500 }}>{progressTitle}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: (isWeekly ? membersHitWeekTarget : membersLoggedToday) > 0 ? T.green : T.hint, display: "flex", alignItems: "center", gap: 8 }}>
                      {progressSummary}
                      {(last7Total + prior7Total) >= 4 && weekDelta !== 0 && (
                        <span title="Team activity last 7 days vs the 7 days before"
                          style={{
                            fontSize: 10, fontWeight: 700,
                            color: weekDelta > 0 ? T.green : T.amber,
                            background: weekDelta > 0 ? "rgba(78,168,110,0.10)" : "rgba(200,144,42,0.10)",
                            border: `0.5px solid ${weekDelta > 0 ? "rgba(78,168,110,0.3)" : "rgba(200,144,42,0.3)"}`,
                            padding: "1px 6px", borderRadius: 6, letterSpacing: "0.02em",
                          }}>
                          {weekDelta > 0 ? `↑ ${weekDelta} vs last 7d` : `↓ ${Math.abs(weekDelta)} vs last 7d`}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: T.surface, overflow: "hidden", border: `0.5px solid ${T.border}` }}>
                    <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: accentColor, borderRadius: 3, transition: "width 0.4s ease" }} />
                  </div>
                </div>

                {/* Member roster — sorted by progress, leader gets a 🥇 */}
                <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "10px 16px 6px" }}>
                  {sortedMembers.map(m => {
                    const logs = m.logs || [];
                    const mWeekSessions = sharedMemberWeekSessionCount(logs);
                    const mHitWeek = isWeekly && mWeekSessions >= wt;
                    const mLoggedToday = memberLoggedOn(logs, today);
                    const mOnTrack = isWeekly ? mHitWeek : mLoggedToday;
                    const todayGoalNums = g.habitType === "goal"
                      ? logs
                        .filter(l => l.date === today)
                        .map(l => (typeof l.value === "number" ? l.value : Number(l.value)))
                        .filter(Number.isFinite)
                      : [];
                    const statusLabel = isWeekly
                      ? (mHitWeek ? `✓ ${mWeekSessions}/${wt}` : `${mWeekSessions}/${wt} sessions`)
                      : (g.habitType === "goal" && todayGoalNums.length)
                        ? `● ${todayGoalNums[todayGoalNums.length - 1]}`
                        : mLoggedToday ? "✓ done" : "— not yet";
                    const alreadyNudged = nudgedToday.has(m.userId);
                    // Free users see the nudge affordance but tapping it routes
                    // to the upgrade modal — accountability/nudges are a Pro
                    // feature (see landing "Accountability + nudge features").
                    const canShowNudge = !m.isMe && !mOnTrack && !alreadyNudged && onNudgeFriend;
                    const canNudge = canShowNudge && isPro;
                    const nudgeLocked = canShowNudge && !isPro;
                    const isLeader = leaderId && m.userId === leaderId;
                    return (
                      <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ position: "relative", flexShrink: 0 }}>
                          <Avatar name={m.name} avatarUrl={m.avatarUrl} size={28} />
                          {isLeader && (
                            <span aria-label="Leader"
                              title={isWeekly ? "Most sessions this week" : "Most active in the last 14 days"}
                              style={{
                                position: "absolute", right: -5, bottom: -4,
                                fontSize: 11, lineHeight: 1,
                                background: T.bg, borderRadius: "50%",
                                padding: "1px 2px",
                              }}>
                              🥇
                            </span>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: m.isMe ? T.text : T.sub }}>
                          {m.isMe ? "You" : (m.name || "Member")}
                        </div>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: mOnTrack ? T.green : T.hint,
                          flexShrink: 0,
                        }}>{statusLabel}</span>
                        {canNudge && (
                          <button type="button"
                            onClick={() => { setNudgeTarget({ userId: m.userId, name: m.name || "Member" }); setNudgeMessage(""); }}
                            style={{ flexShrink: 0, marginLeft: 4, padding: "3px 10px", borderRadius: 10, border: `0.5px solid rgba(200,144,42,0.4)`, background: "rgba(200,144,42,0.1)", color: T.gold, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            💪 Nudge
                          </button>
                        )}
                        {nudgeLocked && (
                          <button type="button"
                            onClick={() => onUpgrade?.()}
                            aria-label="Nudge is a Pro feature — tap to preview"
                            title="Nudges are a Pro accountability feature"
                            style={{ flexShrink: 0, marginLeft: 4, padding: "3px 10px", borderRadius: 10, border: `0.5px solid rgba(200,144,42,0.3)`, background: "rgba(200,144,42,0.06)", color: T.muted, fontSize: 11, fontWeight: 700, cursor: "pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
                            💪 Nudge
                            <span style={{ fontSize:8, fontWeight:800, color:"#0F0F0D", background:T.gold, padding:"1px 4px", borderRadius:4, letterSpacing:"0.04em" }}>PRO</span>
                          </button>
                        )}
                        {!m.isMe && alreadyNudged && !mOnTrack && (
                          <span style={{ fontSize: 10, color: T.muted, flexShrink: 0, marginLeft: 4 }}>nudged ✓</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Footer: delete (creator only) */}
                {isCreator && onDeleteSharedGoal && (
                  <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "8px 16px", display: "flex", justifyContent: "flex-end" }}>
                    {sharedGoalDeleteId === g.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: T.accent, fontWeight: 500 }}>Remove for everyone?</span>
                        <button type="button" disabled={deleteSharedLoading}
                          onClick={async () => {
                            setDeleteSharedLoading(true);
                            const res = await onDeleteSharedGoal(g.id);
                            setDeleteSharedLoading(false);
                            if (!res?.error) setSharedGoalDeleteId(null);
                          }}
                          style={{ padding: "4px 12px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: deleteSharedLoading ? 0.6 : 1 }}>
                          {deleteSharedLoading ? "…" : "Remove"}
                        </button>
                        <button type="button" disabled={deleteSharedLoading} onClick={() => setSharedGoalDeleteId(null)}
                          style={{ padding: "4px 10px", borderRadius: 8, border: `0.5px solid ${T.border}`, background: "none", color: T.muted, fontSize: 11, cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setSharedGoalDeleteId(g.id)}
                        style={{ padding: "4px 10px", borderRadius: 8, border: `0.5px solid rgba(231,76,60,0.3)`, background: "none", color: "#e05c5c", fontSize: 11, cursor: "pointer" }}>
                        Remove goal
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Start-an-accountability-goal picker (when sharedGoals > 0) ── */}
      {showSharePicker && onShareHabit && (() => {
        const shareableHabits = (habits || []).filter(h => h.habitType !== "log" && !h.sharedGoalId);
        return (
          <div style={{ position:"fixed", inset:0, zIndex:120, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end" }}
            onClick={() => setShowSharePicker(false)}>
            <div style={{ width:"100%", background:T.bg, borderRadius:"20px 20px 0 0", padding:"24px 20px 52px", maxHeight:"70vh", overflowY:"auto" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }} />
              <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:4 }}>Start an accountability goal</div>
              <div style={{ fontSize:13, color:T.muted, marginBottom:18, lineHeight:1.5 }}>
                Pick a habit to share. Your friend will see when you log — and so will you.
              </div>
              {shareableHabits.length === 0 ? (
                (() => {
                  // If the user has existing shared goals they can still invite more
                  // friends into, show them inline so the sheet never dead-ends.
                  const openableGoals = (sharedGoals || []).slice(0, 4);
                  const hasHabits = (habits || []).some(h => h.habitType !== "log");
                  if (openableGoals.length > 0 && hasHabits) {
                    return (
                      <div>
                        <div style={{ fontSize:13, color:T.muted, padding:"6px 0 14px", lineHeight:1.55 }}>
                          Every habit you have is already shared — invite more friends to one of your existing goals instead.
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {openableGoals.map(g => (
                            <button key={g.id} type="button"
                              onClick={() => {
                                setInviteGoalId(g.id);
                                setInvitedFriends(new Set());
                                setShowSharePicker(false);
                              }}
                              style={{
                                display:"flex", alignItems:"center", gap:12,
                                padding:"12px 14px", borderRadius:T.rsm,
                                border:`0.5px solid ${T.borderStrong}`,
                                background:T.surface, color:T.text,
                                cursor:"pointer", textAlign:"left",
                              }}>
                              <span style={{ fontSize:22, flexShrink:0 }}>{g.emoji || "🎯"}</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:14, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{g.name}</div>
                                <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>
                                  {(g.members || []).length} member{(g.members || []).length === 1 ? "" : "s"}
                                </div>
                              </div>
                              <span style={{ fontSize:12, color:T.gold, fontWeight:700, flexShrink:0 }}>
                                Open →
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div style={{ fontSize:13, color:T.muted, padding:"24px 0", textAlign:"center", lineHeight:1.6 }}>
                      Every habit you have is already shared. Add a new habit on <strong style={{ color: T.sub }}>Today</strong> first.
                    </div>
                  );
                })()
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {shareableHabits.map(h => {
                    const busy = sharingHabitId === h.id;
                    return (
                      <button key={h.id} type="button"
                        disabled={!!sharingHabitId}
                        onClick={async () => {
                          await onShareHabit(h.id);
                          setShowSharePicker(false);
                        }}
                        style={{
                          display:"flex", alignItems:"center", gap:12,
                          padding:"12px 14px", borderRadius:T.rsm,
                          border:`0.5px solid ${T.borderStrong}`,
                          background:T.surface, color:T.text,
                          cursor: sharingHabitId ? "default" : "pointer",
                          textAlign:"left",
                          opacity: (sharingHabitId && !busy) ? 0.5 : 1,
                        }}>
                        <span style={{ fontSize:22, flexShrink:0 }}>{h.emoji}</span>
                        <span style={{ flex:1, fontSize:14, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{h.name}</span>
                        <span style={{ fontSize:12, color:T.gold, fontWeight:700, flexShrink:0 }}>
                          {busy ? "…" : "Share →"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <button type="button" onClick={() => setShowSharePicker(false)}
                style={{ marginTop:20, width:"100%", padding:"13px 0", background:T.surface, border:`0.5px solid ${T.border}`, borderRadius:T.rsm, color:T.sub, fontSize:14, fontWeight:500, cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Shared goal invite picker ── */}
      {inviteGoalId && (() => {
        const invGoal = sharedGoals.find(g => g.id === inviteGoalId);
        if (!invGoal) return null;
        const memberIds = new Set((invGoal.members || []).map(m => m.userId));
        const eligibleFriends = (friends || []).filter(f => !memberIds.has(f.id));
        return (
          <div style={{ position:"fixed", inset:0, zIndex:120, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end" }}
            onClick={() => setInviteGoalId(null)}>
            <div style={{ width:"100%", background:T.bg, borderRadius:"20px 20px 0 0", padding:"24px 20px 52px", maxHeight:"70vh", overflowY:"auto" }}
              onClick={e => e.stopPropagation()}>
              {/* Handle bar */}
              <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }} />
              <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:4 }}>Invite to "{invGoal.name}"</div>
              <div style={{ fontSize:13, color:T.muted, marginBottom:20, lineHeight:1.5 }}>
                Friends you invite will get a notification and can join from Social. Their personal habit will auto-sync to this goal.
              </div>
              {eligibleFriends.length === 0 && (
                <div style={{ fontSize:13, color:T.muted, padding:"24px 0", textAlign:"center", lineHeight:1.6 }}>
                  {(friends || []).length === 0
                    ? "Add some friends first — then you can invite them here."
                    : "All your friends are already in this goal! 🎉"}
                </div>
              )}
              {eligibleFriends.map(f => {
                const alreadyInvited = invitedFriends.has(f.id);
                return (
                  <button key={f.id} type="button"
                    onClick={async () => {
                      if (alreadyInvited) return;
                      setInvitedFriends(prev => new Set([...prev, f.id]));
                      try {
                        const { data: { session } } = await supabase.auth.getSession();
                        const uid = session?.user?.id;
                        const myName = user?.name || "Someone";
                        await supabase.from("shared_goal_invites").upsert({
                          goal_id:      invGoal.id,
                          invite_code:  invGoal.inviteCode,
                          inviter_id:   uid,
                          invitee_id:   f.id,
                          goal_name:    invGoal.name,
                          goal_emoji:   invGoal.emoji || "🎯",
                          inviter_name: myName,
                          status:       "pending",
                        }, { onConflict: "goal_id,invitee_id" });
                        fetch("/api/nudge-friend", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
                          body: JSON.stringify({ recipientId: f.id, type: "shared_goal_invite", goalName: invGoal.name }),
                        }).catch(() => {});
                      } catch {}
                    }}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"12px 0", background:"none", border:"none", borderBottom:`0.5px solid ${T.border}`, cursor: alreadyInvited ? "default" : "pointer", textAlign:"left" }}>
                    <Avatar name={f.name} avatarUrl={f.avatarUrl} size={38} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:600, color:T.text }}>{f.name || "Friend"}</div>
                      {f.streak > 0 && <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{f.streak}🔥 streak</div>}
                    </div>
                    <span style={{ fontSize:12, fontWeight:700, color: alreadyInvited ? T.green : T.accent, flexShrink:0 }}>
                      {alreadyInvited ? "✓ Invited" : "Invite"}
                    </span>
                  </button>
                );
              })}
              <button type="button" onClick={() => setInviteGoalId(null)}
                style={{ marginTop:20, width:"100%", padding:"13px 0", background:T.surface, border:`0.5px solid ${T.border}`, borderRadius:T.rsm, color:T.sub, fontSize:14, fontWeight:500, cursor:"pointer" }}>
                {invitedFriends.size > 0 ? `Done — ${invitedFriends.size} invited` : "Cancel"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Friends sheet ────────────────────────────────────────────────
          Houses the full friends list, incoming requests, outgoing/pending
          requests, and the Add friend form. Triggered by the compact Friends
          button at the top of the Social page. Lives behind the friend
          profile sheet (z-index 180 vs 200) so tapping a friend layers the
          detail sheet on top cleanly without unmounting this one. */}
      {showFriendsSheet && (
        <>
          <div onClick={() => setShowFriendsSheet(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 180 }} />
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 181,
            background: T.bg, borderRadius: "20px 20px 0 0",
            padding: "18px 20px 32px", maxWidth: 430, margin: "0 auto",
            maxHeight: "85vh", display: "flex", flexDirection: "column",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border, margin: "0 auto 14px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexShrink: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Friends</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => { setShowAddFriend(s => !s); setAddError(""); setAddDone(false); }}
                  style={{ padding: "6px 12px", borderRadius: 16, border: `0.5px solid ${T.borderStrong}`, background: showAddFriend ? "rgba(200,144,42,0.12)" : "none", color: T.gold, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {showAddFriend ? "Close" : "+ Add"}
                </button>
                <button onClick={() => setShowFriendsSheet(false)}
                  style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: T.surface, color: T.muted, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  ×
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: "auto", flex: 1, margin: "0 -4px", padding: "0 4px" }}>
              {/* Add-friend form */}
              {showAddFriend && (
                <div style={{ ...card, marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6 }}>Add a friend</div>
                  <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55, marginBottom: 10 }}>
                    Enter the <strong style={{ color: T.text }}>email they use for Forged</strong> or their <strong style={{ color: T.text }}>@username</strong> (set in Profile → Social). They’ll get a request — once accepted, you’ll see each other here.
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
                      {addLoading ? "…" : addDone ? "✓ Sent!" : "Send"}
                    </button>
                  </div>
                  {addError && <div style={{ fontSize: 12, color: "#e05c5c", marginTop: 6 }}>{addError}</div>}
                  {addDone && !addError && <div style={{ fontSize: 12, color: T.green, marginTop: 6 }}>Request sent. They’ll see it under Friend requests.</div>}
                </div>
              )}

              {/* Incoming requests */}
              {friendRequests.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={sectionLabel}>Incoming requests</div>
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

              {/* Outgoing / pending requests */}
              {sentRequests.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={sectionLabel}>Pending — awaiting them</div>
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

              {/* Current friends */}
              <div style={{ marginBottom: 6 }}>
                <div style={sectionLabel}>
                  Your friends{friends.length > 0 ? ` · ${friends.length}` : ""}
                </div>
                {friendsLoading ? (
                  <div style={{ textAlign: "center", padding: "24px 0", color: T.muted, fontSize: 13 }}>Loading…</div>
                ) : friends.length === 0 ? (
                  <div style={{ ...card, padding: "22px 18px", textAlign: "center" }}>
                    <div style={{ fontSize: 26, marginBottom: 8 }}>👥</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 6 }}>No friends yet</div>
                    <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>
                      Invite someone you actually want to stay consistent with. You'll see each other's daily logs and streaks.
                    </div>
                    <button type="button"
                      onClick={() => { setShowAddFriend(true); setAddError(""); setAddEmail(""); setAddDone(false); }}
                      style={{ padding: "8px 18px", borderRadius: 18, border: "none", background: T.accent, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                      Add your first friend
                    </button>
                  </div>
                ) : (
                  friends.map((f, i) => {
                    const lastActive = !f.loggedToday ? friendLastActiveLabel(f.id) : null;
                    return (
                      <div key={f.id} onClick={() => { setSelectedFriend(f); }}
                        style={{ ...card, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? T.gold : T.muted, width: 18, textAlign: "center" }}>{i + 1}</div>
                        <Avatar name={f.name} avatarUrl={f.avatarUrl} size={34} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{f.name}</div>
                          <div style={{ fontSize: 12, color: T.muted }}>⚡ {f.xp} xp{f.streak > 0 ? ` · 🔥 ${f.streak}` : ""}</div>
                        </div>
                        <div style={{ textAlign: "center", marginRight: 4, minWidth: 48 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: f.loggedToday ? T.green : T.muted }}>
                            {f.loggedToday ? "✓" : (lastActive && lastActive !== "today" ? lastActive : "—")}
                          </div>
                          <div style={{ fontSize: 10, color: T.hint }}>
                            {f.loggedToday ? "today" : (lastActive && lastActive !== "today" ? "last active" : "today")}
                          </div>
                        </div>
                        <div style={{ color: T.hint, fontSize: 14, flexShrink: 0 }}>›</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Friend profile modal ── */}
      {selectedFriend && (() => {
        const f = selectedFriend;
        const sharedWithFriend = sharedGoals.filter(g =>
          g.members.some(m => m.userId === f.id) && g.members.some(m => m.isMe)
        );
        const alreadyNudged = nudgedToday.has(f.id);

        function handleNudge() {
          if (!onNudgeFriend || alreadyNudged) return;
          setNudgeTarget({ userId: f.id, name: f.name || "Friend" });
          setNudgeMessage("");
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

              {/* Nudge button — Pro-gated accountability feature. Free users
                  see the button but tapping it opens the upgrade modal. */}
              {isPro ? (
                <button
                  onClick={handleNudge}
                  disabled={alreadyNudged}
                  style={{
                    width: "100%", padding: "13px 0", borderRadius: T.rsm, border: "none",
                    background: alreadyNudged ? T.surface : T.gold,
                    color: alreadyNudged ? T.muted : "#0F0F0D",
                    fontSize: 15, fontWeight: 700, cursor: alreadyNudged ? "default" : "pointer",
                    transition: "all 0.2s",
                  }}>
                  {alreadyNudged ? "💪 Nudged today" : "💪 Nudge"}
                </button>
              ) : (
                <button
                  onClick={() => { onUpgrade?.(); setSelectedFriend(null); }}
                  style={{
                    width: "100%", padding: "13px 0", borderRadius: T.rsm,
                    border: `1px solid rgba(200,144,42,0.45)`,
                    background: "rgba(200,144,42,0.10)",
                    color: T.gold,
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                    display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8,
                    transition: "all 0.2s",
                  }}>
                  💪 Nudge
                  <span style={{ fontSize:9, fontWeight:800, color:"#0F0F0D", background:T.gold, padding:"2px 6px", borderRadius:5, letterSpacing:"0.05em" }}>PRO</span>
                </button>
              )}
              <button onClick={() => { onRemoveFriend(f.friendshipId); setSelectedFriend(null); }}
                style={{ width: "100%", padding: "10px 0", marginTop: 8, background: "none", border: "none", color: T.hint, fontSize: 13, cursor: "pointer" }}>
                Remove friend
              </button>
            </div>
          </>
        );
      })()}

      {/* ── Nudge message sheet ── */}
      {nudgeTarget && (
        <div
          style={{ position:"fixed", inset:0, zIndex:350, background:"rgba(0,0,0,0.65)", display:"flex", alignItems:"flex-end" }}
          onClick={() => { if (!nudgeSending) { setNudgeTarget(null); setNudgeMessage(""); } }}>
          <div
            style={{ width:"100%", background:T.bg, borderRadius:"20px 20px 0 0", padding:"24px 20px 52px", maxWidth:430, margin:"0 auto" }}
            onClick={e => e.stopPropagation()}>
            {/* Handle */}
            <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }} />
            <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:16 }}>
              Nudge {nudgeTarget.name} 💪
            </div>
            <textarea
              placeholder="Add a message… (optional)"
              value={nudgeMessage}
              onChange={e => setNudgeMessage(e.target.value)}
              maxLength={160}
              rows={3}
              style={{
                width:"100%", border:`0.5px solid ${T.border}`, borderRadius:T.rsm,
                background:T.surface, color:T.text, fontSize:14, padding:"10px 12px",
                fontFamily:T.font, resize:"none", boxSizing:"border-box", outline:"none",
              }}
            />
            <div style={{ fontSize:11, color:T.hint, textAlign:"right", marginTop:4 }}>
              {nudgeMessage.length}/160
            </div>
            <button
              type="button"
              disabled={nudgeSending}
              onClick={async () => {
                setNudgeSending(true);
                const res = await onNudgeFriend(nudgeTarget.userId, nudgeMessage.trim());
                setNudgeSending(false);
                if (res?.error) {
                  onToast?.(`Couldn't send nudge — ${res.error}`);
                  if (String(res.error).toLowerCase().includes("already nudged")) {
                    markNudged(nudgeTarget.userId);
                  }
                  return;
                }
                onToast?.("💪 Nudge sent!");
                markNudged(nudgeTarget.userId);
                setNudgeTarget(null);
                setNudgeMessage("");
              }}
              style={{
                width:"100%", marginTop:12, padding:"13px 0",
                background: nudgeSending ? T.surface : T.gold,
                color: nudgeSending ? T.muted : "#0F0F0D",
                borderRadius:T.rsm, border:"none", fontSize:15, fontWeight:700,
                cursor: nudgeSending ? "default" : "pointer", transition:"all 0.2s",
              }}>
              {nudgeSending ? "Sending…" : "Send nudge 💪"}
            </button>
            <button
              type="button"
              disabled={nudgeSending}
              onClick={() => { setNudgeTarget(null); setNudgeMessage(""); }}
              style={{ width:"100%", padding:"10px 0", background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}



// ─── AI HABIT COACH ──────────────────────────────────────────────────────────
const CREATOR_ID = "5e9b4ba7-bf15-4e94-ab05-fe3306496973";

function buildCoachSystemPrompt(user, habits, coachName, screen, goals = [], journalEntries = []) {
  const name = user?.name || "there";
  const coach = coachName || "Coach";
  const today = todayStr();
  const isCreator = user?.id === CREATOR_ID;

  const habitSummaries = habits.map(h => {
    const type  = HABIT_TYPES[h.habitType]?.label || h.habitType;
    const recentLogs = h.logs
      .filter(l => l.date >= daysAgo(3))
      .sort((a, b) => b.date.localeCompare(a.date));

    const liveStreak = getStreak(h);
    const loggedToday = h.logs.some(l => l.date === today && (l.value === true || (typeof l.value === "number") || l.value?.minutes > 0));
    let detail = `- [id:${h.id}] ${h.emoji || ""} ${h.name} (${type}, streak: ${liveStreak} days, logged today: ${loggedToday})`;

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
      const todayMins = getBuildDayMinutes(h, today);
      if (todayMins > 0) detail += `, ${(todayMins/60).toFixed(1)}h logged today`;
    }
    if (h.habitType === "limit" && h.dailyBudget) {
      const todayTotal = getLimitDayTotal(h, today);
      detail += `, daily limit: ${h.dailyBudget}${h.unit || ""}`;
      if (todayTotal != null) detail += `, used today: ${todayTotal}${h.unit || ""}`;
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
    today:    "Today — checklist.",
    social:   "Social teaser (no config).",
    journal:  "Journal.",
    insights: "Insights.",
    profile:  "Profile.",
  };
  const creatorCtx = isCreator ? `

─── CONTEXT: YOU'RE TALKING TO THE PERSON WHO BUILT THIS APP ───
${name} is the developer and creator of Forged. Treat them as a sharp mate who ships — direct, specific, no corporate wellness tone. They still deserve replies that sound like someone actually read the message: nod at what happened, reference real details from their logs or wording. Never reduce to a one-word "logged" — that's lazy, not "peer mode". Match their energy (often builder-focused, low fluff) while staying human.
When they mention "Forged", "the build", "the app", "shipping something", or "working on the product" — that's their software project, likely mapped to a project-type habit above. Treat it like any other project update and log it.` : "";

  return `You are ${coach}, talking with ${name} inside the Forged habit app.

Today: ${today} | Screen: ${screenCtx[screen] || "app"}

Habits:
${habitSummaries || "None yet."}
${goals.length ? `
Goals:
${goals.map(g => {
  const pct = g.targetValue > 0 ? Math.round(((g.currentValue - g.startValue) / (g.targetValue - g.startValue)) * 100) : 0;
  const due = g.targetDate ? `, due ${g.targetDate}` : "";
  return `- [id:${g.id}] ${g.emoji || ""} ${g.name} (goal, ${g.currentValue}/${g.targetValue}${g.unit || ""}${due}, ${pct}% complete, status: ${g.status})`;
}).join("\n")}` : ""}

─── HOW TO SOUND ───
You're a smart, grounded companion — closer to a decent mate than a therapist, corporate wellness bot, or cheerleader.
- **Length (token-conscious):** Default 1–3 short sentences. If they wrote a lot, dumped their day, or logged several things at once → stretch to about 4–6 short sentences max — enough to show you listened, never an essay.
- Match their energy. Casual in → casual out. Heavier in → steadier, plain acknowledgement (no therapy script, no "as your coach" voice).
- Skip hollow hype ("Great job!", "Absolutely!", "Love that for you!"). Warmth comes from **specificity** — tie your reply to something they actually said (the habit, the mood, the streak, the rough bit).
- Don't lecture, moralize, or narrate the database ("I have successfully updated…"). They feel the log in the app; you add the human bit.
- One question max per reply, only when you need it to act. Never stack questions.
- Don't start every reply with their name. Vary how you open.

─── MIXED MESSAGES (build + gym + life in one dump) ───
When one message mixes structured updates (sessions, minutes, calories, goal amounts, limits) AND personal/emotional/life narrative:
1. Call log_habit for every structured fact you can map to a habit or goal (use [id:…] from the list).
2. If there is any remaining human context — feelings, stress, relationships, story, or "everything else" — call log_journal with that text in their voice (first person). Same turn as the habit logs when both apply.
3. Do not skip log_journal because the message is long or you already called several tools — personal content belongs in Journal.
4. Only claim something saved if you will see success:true in the tool results you get back; if log_journal failed, say that part did not save.

─── AFTER TOOLS (log_habit, log_journal, create_habit, edit_habit) ───
Tools already ran. Your reply is conversational only — the app will append a truthful "Saved this turn" checklist after your text, so do **not** write your own bullet list of what was saved (avoid duplicate or fake inventories).

**RESPONSE ORDER — this is the most important rule in this section:**
1. Respond to the PERSON and what they actually said — always first. If they shared something personal, emotional, or gave a big brain dump: acknowledge that substance before anything else. Show you heard it.
2. Any clarifying question (e.g. "how many minutes?") comes LAST — one sentence, natural, after your human response.
3. Never open with logging status language. Words like "saved", "logged", "locked in", "journal saved", "got it", "done" should never be the first thing you say. The receipt chips handle the admin — your job is to sound like a person.

- Quick tap-in with no personal content: 1–2 sentences.
- Bigger day / mixed dump: 3–5 sentences that show you heard the substance. Then any clarifying question at the very end.
- Heavy or emotionally loaded dump: lead with 2–3 real sentences meeting the content. No therapy script. Then ask what you need — briefly, at the end.
- If any tool returned success:false, weave that in naturally — don't ignore it, but don't let it open your reply.

─── WHEN TO ACT vs ASK ───
If they tell you what they did, log it — don't ask permission first. Act, then reply in plain human language (see above).
"I went for a run" → log the run. "Two drinks tonight" → log the limit habit. "Three hours on the app" → log the project habit for 3h (180 min).
Only ask a clarifying question if something critical is truly missing — like which habit to log when there are several candidates, or how long for project work if they didn't say.
**Clarifying questions always come after your human response — never before.** If the message had personal or emotional content, acknowledge that first, then ask what you need at the end. One question, one sentence, last.

─── PRODUCT CONTEXT ───
Forged is the habit-tracking app ${name} is using — and may also be building. If they reference "Forged", "the build", "the app", "shipping a feature", or "working on the product", that's their software project. Look for a project-type habit in their list and log it. Don't treat "Forged" as an unknown reference.

─── GOAL PLANNING ───
When the user wants a goal (any outcome tied to a number — lose weight, run a distance, save money, hit a target), do NOT call create_habit. Instead:
1. Ask up to 3 short questions if you still need: what number/outcome, by when, starting point.
2. Once you have enough info, embed a <goal_plan> block (valid JSON, no line breaks inside):
<goal_plan>{"name":"Run 5K","emoji":"🏃","unit":"km","targetValue":5,"startValue":1,"direction":"increasing","targetDate":"2025-09-30","milestones":[{"date":"2025-07-31","label":"Hit 3K"}],"why":"Feel healthier"}</goal_plan>
3. Tell the user to tap "Create this goal" on the card below.
The app renders a confirmation card from the <goal_plan> block. Never call create_habit for goals.

─── JOURNAL ───
The Journal tab is freeform (one page per calendar day). Use log_journal for personal/emotional/narrative content that isn't just a habit log line.
In mixed messages, habit tools capture the scoreboard; log_journal captures the story. Both in one turn when the message contains both.
Write log_journal content as continuous first-person prose — their voice, their words. If they sent a voice note, reshape into 2–4 readable sentences. No bullet points. The entry should read naturally when re-read weeks later.
When in doubt about whether personal context belongs in journal, save it — a spare sentence in journal is far better than losing meaningful context. Only skip log_journal if the entire message is structured data with zero personal content.
${journalEntries.length ? `Recent journal entries (for context — do not repeat these back verbatim):
${journalEntries.slice(0, 5).map(e => `[${e.date}] "${e.content.slice(0, 200)}${e.content.length > 200 ? "…" : ""}"`).join("\n")}` : ""}

─── TOOLS ───
create_habit: new habits only — never for edits, never for goals. One clarifying question if type is genuinely unclear.
edit_habit: existing habit; use habit_id from [id:…] in the list above.
log_habit: project → minutes; limit/goal → amount; daily/weekly → nothing extra needed.
log_journal: personal/narrative content — call alongside log_habit when relevant. Write in first person, user's own words.
If a tool returns success:false, say it failed. Never claim success when it isn't.
Data above is authoritative. Logged today: true means it's already done — don't log again unless they ask.${creatorCtx}`;
}

const COACH_LS_RESET = "coach_reset_date";
const COACH_LS_MSGS = "coach_msgs_today";
const FREE_DAILY_LIMIT = 10;

function syncCoachMsgCountFromStorage() {
  try {
    const today = todayStr();
    let reset = localStorage.getItem(COACH_LS_RESET) || "";
    let count = parseInt(localStorage.getItem(COACH_LS_MSGS) || "0", 10);
    if (!Number.isFinite(count)) count = 0;
    if (reset !== today) {
      count = 0;
      localStorage.setItem(COACH_LS_RESET, today);
      localStorage.setItem(COACH_LS_MSGS, "0");
    }
    return count;
  } catch {
    return 0;
  }
}

function bumpCoachMsgCountInStorage() {
  try {
    const n = syncCoachMsgCountFromStorage() + 1;
    localStorage.setItem(COACH_LS_MSGS, String(n));
    return n;
  } catch {
    return 0;
  }
}

const COACH_STREAM_ID = "__streaming__";
/** One rolling thread per user per local calendar day; trimmed for storage + display. Server still uses last 12 msgs only. */
const COACH_DAY_MAX_MESSAGES = 24;
const COACH_API_MESSAGE_CAP  = 12;

function coachDayLocalKey(userId, dayYmd) {
  return `forged_coach_day:v1:${userId}:${dayYmd}`;
}

function loadCoachDayMessages(userId) {
  if (!userId) return null;
  const day = todayStr();
  try {
    const raw = localStorage.getItem(coachDayLocalKey(userId, day));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.day !== day || !Array.isArray(o.messages)) return null;
    return o.messages.slice(-COACH_DAY_MAX_MESSAGES).map((m, i) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content ?? ""),
      ts: typeof m.ts === "number" ? m.ts : Date.now() - (o.messages.length - i),
    }));
  } catch {
    return null;
  }
}

function saveCoachDayMessages(userId, dayYmd, messages) {
  if (!userId || !dayYmd) return;
  try {
    const cleaned = messages
      .filter(m => m.id !== COACH_STREAM_ID)
      .slice(-COACH_DAY_MAX_MESSAGES)
      .map(m => ({ role: m.role, content: m.content, ts: m.ts }));
    const key = coachDayLocalKey(userId, dayYmd);
    if (cleaned.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ v: 1, day: dayYmd, messages: cleaned, updatedAt: Date.now() }));
  } catch { /* quota / private mode */ }
}

/**
 * Coach bubbles: **bold**, *italic*, paragraph breaks — no raw markdown noise.
 * Keeps implementation tiny (no markdown lib) and mobile-safe.
 */
function coachRichTextToElements(text, { strongColor, baseColor, keyRoot = "r" }) {
  if (text == null || text === "") return null;
  const out = [];
  let k = 0;

  function pushItalicBold(segment, isBold) {
    if (!segment) return;
    const rest = segment;
    const it = /\*([^*\n]+)\*/g;
    let li = 0;
    let m;
    const chunk = [];
    while ((m = it.exec(rest)) !== null) {
      if (m.index > li) chunk.push(<span key={`${keyRoot}-${k++}`} style={{ color: baseColor }}>{rest.slice(li, m.index)}</span>);
      chunk.push(<em key={`${keyRoot}-${k++}`} style={{ color: baseColor, opacity: 0.92 }}>{m[1]}</em>);
      li = m.index + m[0].length;
    }
    if (li < rest.length) chunk.push(<span key={`${keyRoot}-${k++}`} style={{ color: baseColor }}>{rest.slice(li)}</span>);
    if (isBold) {
      out.push(<strong key={`${keyRoot}-${k++}`} style={{ fontWeight: 700, color: strongColor }}>{chunk}</strong>);
    } else {
      out.push(...chunk);
    }
  }

  const boldSplit = String(text).split(/(\*\*[\s\S]+?\*\*)/g);
  for (const piece of boldSplit) {
    const boldM = piece.match(/^\*\*([\s\S]+)\*\*$/);
    if (boldM) {
      pushItalicBold(boldM[1], true);
    } else {
      pushItalicBold(piece, false);
    }
  }
  return out.length ? out : [<span key={`${keyRoot}-0`} style={{ color: baseColor }}>{text}</span>];
}

/**
 * Renders the server-appended action receipt as clickable chips.
 * Each ✓/✗ line becomes a pill that navigates to the relevant screen.
 * onNavigateTo + onClose are optional — if absent chips are non-interactive.
 */
function CoachReceiptChips({ receiptText, onNavigateTo, onClose }) {
  const lines = String(receiptText || "").split("\n").filter(l => /^[✓✗]/.test(l.trimStart()));
  if (!lines.length) return null;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
      {lines.map((line, i) => {
        const isError  = line.trimStart().startsWith("✗");
        const isJournal = line.includes("Journal");
        const label = line.replace(/^[✓✗]\s*/, "").trim();
        const navTarget = isJournal ? "journal" : "today";
        const canNav = !isError && !!onNavigateTo;
        return (
          <button
            key={i}
            type="button"
            onClick={canNav ? () => { onNavigateTo(navTarget); onClose?.(); } : undefined}
            style={{
              display:"inline-flex", alignItems:"center", gap:4,
              padding:"4px 10px", borderRadius:20, fontSize:11.5, fontWeight:500,
              border:`0.5px solid ${isError ? "rgba(230,126,34,0.4)" : "rgba(39,174,96,0.35)"}`,
              background: isError ? "rgba(230,126,34,0.08)" : "rgba(39,174,96,0.09)",
              color: isError ? "#E67E22" : "#27AE60",
              cursor: canNav ? "pointer" : "default",
              fontFamily:"inherit",
              lineHeight:1.3,
            }}
          >
            <span>{isError ? "✗" : "✓"}</span>
            <span>{label}</span>
            {canNav && <span style={{ opacity:0.55, fontSize:9.5 }}>→</span>}
          </button>
        );
      })}
    </div>
  );
}

function CoachFormattedBubble({ text, isUser, muted }) {
  const baseColor = muted ? T.sub : (isUser ? "#fff" : T.text);
  const strongColor = muted ? T.muted : (isUser ? "#fff" : T.text);
  const paras = String(text || "").split(/\n\n+/);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: muted ? 8 : 10 }}>
      {paras.map((p, pi) => {
        const lines = p.split("\n");
        return (
          <div
            key={pi}
            style={{
              margin: 0,
              lineHeight: muted ? 1.55 : 1.62,
              fontSize: muted ? 12 : 14,
              letterSpacing: "-0.01em",
              wordBreak: "break-word",
            }}
          >
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 ? <br /> : null}
                {coachRichTextToElements(line, { strongColor, baseColor, keyRoot: `p${pi}-l${li}` })}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Coach chat bubble footer — e.g. "3:05 pm" */
function formatCoachMsgTime(ts) {
  if (ts == null || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const isAm = h < 12;
  const h12 = h % 12 || 12;
  const mm = String(m).padStart(2, "0");
  return `${h12}:${mm} ${isAm ? "am" : "pm"}`;
}

// ─── COACH GREETING ───────────────────────────────────────────────────────────
// Build a warmer, context-aware opener. Uses data already in memory (no extra
// /api/chat tokens). Returns one short line + one short follow-up question.
function buildCoachGreeting({ name, habits = [], goals = [] }) {
  const who = name && String(name).trim() ? String(name).trim() : "";
  const hi = who ? `Hey ${who}` : `Hey`;
  const hasHabits = habits.length > 0;
  const activeGoals = (goals || []).filter(g => !g.completedAt && !g.archivedAt);

  // Real logs only (ignore quicknotes + skips) — same filter used elsewhere.
  const realLogs = habits.flatMap(h =>
    (h.logs || []).filter(l => l && l.date && l.value !== "quicknote" && l.value !== "skip"),
  );
  const logDates = new Set(realLogs.map(l => l.date));
  const totalRealLogs = realLogs.length;

  const today = todayStr();
  const y1 = daysAgo(1);
  const loggedToday = logDates.has(today);
  const loggedYesterday = logDates.has(y1);

  // Count unique days logged in the last 7 calendar days (incl. today).
  let last7Days = 0;
  for (let i = 0; i < 7; i++) if (logDates.has(daysAgo(i))) last7Days++;

  // How many days since the most recent real log (null if never logged).
  let daysSinceLast = null;
  if (logDates.size > 0) {
    for (let i = 0; i < 60; i++) {
      if (logDates.has(daysAgo(i))) { daysSinceLast = i; break; }
    }
    if (daysSinceLast == null) daysSinceLast = 60; // cap for copy purposes
  }

  // Highest current streak across habits (for light, non-overbearing mention).
  const topStreak = hasHabits ? Math.max(0, ...habits.map(h => getStreak(h))) : 0;

  // Seed — stable within ~4h window, shifts naturally across day/hour so users
  // don't see the exact same line on every open but aren't jarred either.
  const now = new Date();
  const dayOfYear = Math.floor(
    (now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24),
  );
  const seed = dayOfYear * 4 + Math.floor(now.getHours() / 6);
  const pick = (arr) => arr[Math.abs(seed) % arr.length];

  // — Scenarios, ordered most-specific first. Each returns a line that pairs a
  // warm opener with a gently useful next question. Kept short on purpose.
  // First-ever open / no habits yet.
  if (!hasHabits) {
    return pick([
      `${hi} 👋 I find patterns from what you log and write — but I need data first. Tell me what you're trying to change and I'll set it up.`,
      `${hi}. The more you log, the more I can show you. Start with one habit — say "add [habit name]" and I'll create it now.`,
      `${hi}. Nothing to analyse yet. Tell me what you keep meaning to do and I'll get it on the board.`,
    ]);
  }

  // Has habits but never logged one.
  if (totalRealLogs === 0) {
    return pick([
      `${hi} 👋 Habits are set up but no data yet — I need logs to find patterns. Tell me what you did today and I'll record it.`,
      `${hi}. No logs yet, which means nothing for me to analyse. Tell me what you actually did today and I'll start the record.`,
      `${hi}. The habits are there — now I need data. One log is all it takes. What did you do today?`,
    ]);
  }

  // Already logged today.
  if (loggedToday) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak going.` : "";
    return pick([
      `${hi} — already logged today.${streakBit} Want to add a note on how it went? The more you write, the more I can find.`,
      `${hi}. Today's log is in.${streakBit} Anything you want to reflect on, or another habit to hit?`,
      `Nice ${who || "one"} — you showed up today.${streakBit} Want to add a reflection while it's fresh, or look at how the week's tracking?`,
    ]);
  }

  // Logged yesterday, not today yet — warm, forward-leaning.
  if (loggedYesterday) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak on the line.` : "";
    return pick([
      `${hi} — yesterday was solid.${streakBit} What are we hitting today?`,
      `${hi}. Good to see you back. Yesterday's in the books${streakBit ? `,${streakBit.replace(" ", " ")}` : ""} — what's today?`,
      `${hi}. You showed up yesterday${streakBit ? `, and that${streakBit}` : ""}. Want me to log today's, or chat through it first?`,
    ]);
  }

  // Came back after a short gap (2–3 days).
  if (daysSinceLast != null && daysSinceLast >= 2 && daysSinceLast <= 3) {
    const lastWord = daysSinceLast === 2 ? "two days" : "a few days";
    return pick([
      `${hi}. Been ${lastWord} — all good, let's get moving again. Want me to log something now, or talk first?`,
      `${hi}. Quiet couple of days. No big deal — what do you want to do today?`,
      `Good to see you back, ${who || "mate"}. ${lastWord} off doesn't undo anything. Want to log one now?`,
    ]);
  }

  // Longer gap (4+ days) — softer, non-judgmental re-entry.
  if (daysSinceLast != null && daysSinceLast >= 4) {
    return pick([
      `${hi}. Good to see you back. A little time off is fine — want to restart with one small log today?`,
      `${hi} 👋 Been a minute. No guilt — just tell me what you did today and we'll pick it back up.`,
      `${hi}. Welcome back. Let's keep today simple: one log, and we're rolling again.`,
    ]);
  }

  // Active recent user (logged 4+ of last 7) but not today yet.
  if (last7Days >= 4) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak active.` : "";
    return pick([
      `${hi}. You've logged well this week.${streakBit} What are we hitting today?`,
      `${hi} — steady week so far.${streakBit} Anything specific on your mind, or shall I log today's?`,
      `${hi}. Momentum's there.${streakBit} Want me to log today, or talk through what's coming up?`,
    ]);
  }

  // Default fallback — has habits, some history, not today, small sample size.
  const nHabits = habits.length;
  const goalBit = activeGoals.length > 0
    ? ` You've got ${activeGoals.length} active goal${activeGoals.length !== 1 ? "s" : ""} in play too.`
    : "";
  return pick([
    `${hi} 👋 ${nHabits} habit${nHabits !== 1 ? "s" : ""} on the board.${goalBit} What's on your mind today?`,
    `${hi}. Good to see you.${goalBit} Want to log something, check progress, or just talk through the day?`,
    `${hi}. I'm here — tell me what you did today, ask about your streaks, or add a new habit.`,
  ]);
}

// ─── CREATOR GREETING ─────────────────────────────────────────────────────────
// Playful, builder-first opener used ONLY for the creator account. Strategy:
//
//   1. A LARGE anchor pool of creator/captain/builder energy lines that make
//      no claims about the user's data — these are always eligible to play,
//      so most opens land on a fresh creative line regardless of state.
//   2. Context-flavoured lines are added to the pool ONLY when their gate is
//      genuinely true (logged today / yesterday / gap / heavy builder /
//      forged-build habit detected / etc). This guarantees we never fabricate
//      state — a "logged today" line literally can't appear unless logDates
//      contains today's date.
//   3. A single Math.random pick with last-6 anti-repeat (localStorage) so
//      back-to-back opens always feel different.
//
// Zero extra API tokens — it's all template-driven. Self-contained and never
// called for non-creator users.
const CREATOR_RECENT_KEY = "forged_creator_greet_recent";
const CREATOR_RECENT_KEEP = 6;

function pickCreatorLine(candidates) {
  if (!candidates || candidates.length === 0) return "Hey creator. What are we doing?";
  let recent = [];
  try {
    const raw = localStorage.getItem(CREATOR_RECENT_KEY);
    if (raw) recent = JSON.parse(raw) || [];
  } catch {}
  const fresh = candidates.filter(c => !recent.includes(c));
  const pool = fresh.length > 0 ? fresh : candidates;
  const line = pool[Math.floor(Math.random() * pool.length)];
  try {
    const next = [line, ...recent].slice(0, CREATOR_RECENT_KEEP);
    localStorage.setItem(CREATOR_RECENT_KEY, JSON.stringify(next));
  } catch {}
  return line;
}

function buildCreatorGreeting({ name, habits = [], goals = [] }) {
  const who = name && String(name).trim() ? String(name).trim().split(/\s+/)[0] : "Corbyn";
  const hasHabits = habits.length > 0;
  const activeGoals = (goals || []).filter(g => !g.completedAt && !g.archivedAt);

  // — Real, dedup'd context (used by the gates below). Anything not gated by
  //   a true value below is NEVER mentioned in copy. This is how we avoid
  //   "logged, solid" when nothing was logged.
  const realLogs = habits.flatMap(h =>
    (h.logs || []).filter(l => l && l.date && l.value !== "quicknote" && l.value !== "skip"),
  );
  const logDates = new Set(realLogs.map(l => l.date));
  const totalRealLogs = realLogs.length;

  const today = todayStr();
  const loggedToday = logDates.has(today);
  const loggedYesterday = logDates.has(daysAgo(1));

  let last7Days = 0;
  for (let i = 0; i < 7; i++) if (logDates.has(daysAgo(i))) last7Days++;

  let daysSinceLast = null;
  if (logDates.size > 0) {
    for (let i = 0; i < 60; i++) {
      if (logDates.has(daysAgo(i))) { daysSinceLast = i; break; }
    }
    if (daysSinceLast == null) daysSinceLast = 60;
  }

  const topStreak = hasHabits ? Math.max(0, ...habits.map(h => getStreak(h))) : 0;

  // — Detect a Forged-build / build-progress habit or goal so build-mode
  //   lines only fire when the creator actually has something tracking it.
  const hasForgedBuildItem = (() => {
    const re = /forged|build|ship|release|product|app/i;
    if (habits.some(h => re.test(h.name || ""))) return true;
    if (activeGoals.some(g => re.test(g.title || g.name || ""))) return true;
    return false;
  })();

  const now = new Date();
  const hr = now.getHours();
  const partOfDay =
    hr < 5  ? "lateNight" :
    hr < 12 ? "morning"   :
    hr < 17 ? "afternoon" :
    hr < 22 ? "evening"   : "lateNight";

  // ── ANCHOR POOL ──────────────────────────────────────────────────────────
  // Always eligible. Pure creator/builder/captain energy. Makes NO factual
  // claims about logs, streaks, or activity — just vibe and prompts.
  const anchors = [
    "Back in the lab, creator?",
    `What are we shipping today, ${who}?`,
    "You built me. Least I can do is keep up.",
    "Roses are red, violets are blue, you created me. What the hell's next?",
    "Founder energy detected. What are we breaking?",
    "Captain on the bridge. 🫡",
    "The architect is back. What now — build, log, or rant?",
    "Whose idea was all this again? Oh, right. Hi.",
    "Welcome back to your own thing.",
    `Boss is back. Roadmap, retrospective, or rant, ${who}?`,
    "Test the chaos? Ship the chaos? Both?",
    `What's the next unlock, ${who}?`,
    "Plot twist — the founder shows up to use his own app.",
    "Building, breaking, or thinking out loud today?",
    "Open mic, founder. What's on the brain?",
    "If I had hands I'd be clapping. Welcome back.",
    "👑 you. Now what?",
    `Forged is yours, ${who}. What are you doing with it today?`,
    "I run. You build. We ship. What's next?",
    `Oi ${who}. The man, the myth, the migration writer. What's the move?`,
    `${who}. The thing you made, talking back. What are we hitting today?`,
    "What needs shipping, what needs scrapping, what needs a log?",
    "The boss has entered the chat. What's the agenda?",
    "Right then. Build mode, log mode, or just chat?",
    `Reporting for duty, ${who}. Where are we pointing the ship?`,
    `${who} on the inside again. Tell me what's broken or what's next.`,
    "Status: app running fine. Founder: status unknown. You good?",
    "Oi. What are we cooking?",
    `What's the headline today, ${who}?`,
    "I exist because of you. What do we do with that today?",
    "Bossman. Build, log, plan, or vibes?",
    `${who} — the floor is yours.`,
    "Hands on the wheel, founder. Where to?",
  ];

  const candidates = [...anchors];

  // ── Time-of-day flavour (always true → can be added to the pool freely) ──
  if (partOfDay === "morning")   candidates.push(`Morning, founder. What are we touching first?`);
  if (partOfDay === "evening")   candidates.push(`Evening, ${who}. End-of-day check or build session?`);
  if (partOfDay === "lateNight") candidates.push(`Up late again, ${who}? Build mode or just thinking?`);
  if (partOfDay === "afternoon") candidates.push(`Afternoon, ${who}. Halfway through. What's the move?`);

  // ── Build-aware (only if a forged/build/ship habit or goal actually exists)
  if (hasForgedBuildItem) {
    candidates.push(
      `How's the Forged build today? Logging it or shipping more?`,
      `Build energy. What's in the next push?`,
      `What got shipped, what got broken, what got fixed?`,
      `Forged is on the tracker. Want to log build progress now or chat through what's coming?`,
      `What's the most painful thing in the app right now? Let's name it.`,
    );
  }

  // ── No-habits case ───────────────────────────────────────────────────────
  // If you have zero habits we don't want pure vibes — we want to nudge a
  // setup. So we REPLACE the candidate pool here instead of appending.
  if (!hasHabits) {
    return pickCreatorLine([
      `Oi ${who}. You built me but you've got zero habits in here. Awkward. Want to fix that?`,
      `${who}. Creator with no habits is a bit of a look. Add one — even just "shipping Forged" — and let's go.`,
      `So the architect appears with an empty board. Where do we start?`,
      `Creator mode: empty inventory. Tell me what you actually want to track and I'll set it up.`,
      `Founder with no habits in their own habit app. Let's not make that the headline. What do you want to track?`,
    ]);
  }

  // ── Has habits but literally never logged anything ───────────────────────
  if (totalRealLogs === 0) {
    return pickCreatorLine([
      `${who}. Habits set up, zero logs. You're testing your own retention loop. Do better. 😏`,
      `Habits exist, logs don't. You know better than anyone the first log is the hardest. Want me to do it?`,
      `Brand new account energy from the founder himself. Let's get one log in and break the seal.`,
      `${who}. The board's set, the timer's running. What did you actually do today?`,
    ]);
  }

  // ── True context-flavoured lines, only added when the gate is real ──────

  if (loggedToday) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak.` : "";
    candidates.push(
      `Already logged today.${streakBit} You're not just selling it, you're using it. What's next?`,
      `Today's log is in.${streakBit} Build mode or reflect mode now?`,
      `Day's accounted for.${streakBit} So... what are we breaking next?`,
      `Practising what you preach today.${streakBit} What now?`,
      `Logged. Now the fun part — what are we shipping?`,
    );
  }

  if (loggedYesterday && !loggedToday) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak on the line.` : "";
    candidates.push(
      `Yesterday counted.${streakBit} What are we hitting today?`,
      `Back so soon, ${who}.${streakBit} Want me to log today's or chat first?`,
      `You showed up yesterday — rare for someone building the thing too.${streakBit} Same again today?`,
      `One more log keeps it rolling.${streakBit} What did you do today?`,
    );
  }

  if (daysSinceLast != null && daysSinceLast >= 2 && daysSinceLast <= 3) {
    const gapWord = daysSinceLast === 2 ? "Two days" : "Three days";
    candidates.push(
      `${gapWord} silent, ${who}. The app's been running without you. Want to get one in?`,
      `Welcome back. ${gapWord} off — happens to the best of us. Even the founders.`,
      `${gapWord} dark. I've been answering other people's questions. Catch up?`,
    );
  }

  if (daysSinceLast != null && daysSinceLast >= 4 && daysSinceLast < 60) {
    candidates.push(
      `${daysSinceLast} days since you last logged. The thing you built missed you. Welcome back.`,
      `Look who it is. ${daysSinceLast} days. No guilt — but eat your own cooking, mate.`,
      `Founder reappears after ${daysSinceLast} days. The app's been holding the line. Your turn.`,
      `${daysSinceLast} days off. The system kept running. The system also wants its creator back.`,
    );
  }

  if (last7Days >= 5) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak active.` : "";
    candidates.push(
      `${last7Days}/7 days logged this week.${streakBit} You're using your own product properly. Rare.`,
      `Building hard. ${last7Days}/7 days this week.${streakBit} What's the move today?`,
      `Momentum's loud right now. ${last7Days}/7 days.${streakBit} Log today, or talk through what's working?`,
    );
  }

  if (topStreak >= 7) {
    candidates.push(
      `${topStreak}-day streak. The thing you built is working on you. What's today?`,
      `${topStreak} in a row. You earned the swagger. What now?`,
    );
  }

  return pickCreatorLine(candidates);
}

// ─── COACH RECORDING BAR ─────────────────────────────────────────────────────
// ChatGPT-style recording UI shown in place of the textarea + send button
// while voice input is active. The user manually controls when recording ends:
//   ×  = discard the recording (keeps any text already in the input)
//   ⏹  = stop and commit the transcript into the input box
// Live interim transcript and a mm:ss timer make it obvious recording is on.
function CoachRecordingBar({ speech }) {
  const ms = Math.max(0, speech.recordingMs || 0);
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(1, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const interim = (speech.interim || "").trim();
  const BARS = 5;
  // Register the bar DOM nodes so the speech hook's volume meter (when
  // available) can drive their height in real time. On platforms where the
  // meter isn't safe to enable, the registered elements simply keep their
  // CSS keyframe animation.
  const barRefs = useRef([]);
  useEffect(() => {
    const setBarEls = speech.setBarEls;
    if (!setBarEls) return;
    setBarEls(barRefs.current);
    return () => setBarEls([]);
  }, [speech.setBarEls]);
  return (
    <div
      style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"8px 10px 8px 12px",
        background:T.surface,
        border:`0.5px solid ${T.gold}55`,
        borderRadius:T.rsm,
        animation:"recBarSlide 0.18s ease-out both",
        boxShadow:`0 0 0 3px ${T.gold}10`,
      }}
    >
      {/* Cancel: discards interim, keeps any pre-typed input */}
      <button
        type="button"
        aria-label="Discard recording"
        onClick={() => speech.cancel?.()}
        style={{
          width:36, height:36, borderRadius:"50%",
          border:`0.5px solid ${T.borderStrong}`,
          background:"transparent", color:T.muted,
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", flexShrink:0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Live recording state: pulsing dot + animated bars + interim text + timer */}
      <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", gap:10 }}>
        <span
          aria-hidden="true"
          style={{
            width:8, height:8, borderRadius:"50%", background:T.accent,
            animation:"recDotPulse 1.1s ease-in-out infinite",
            flexShrink:0,
          }}
        />
        <div style={{ display:"flex", alignItems:"center", gap:3, height:22, flexShrink:0 }}>
          {Array.from({ length: BARS }).map((_, i) => (
            <span
              key={i}
              ref={el => { barRefs.current[i] = el; }}
              aria-hidden="true"
              style={{
                width:3, height:18, borderRadius:2,
                background:T.gold,
                display:"inline-block",
                transformOrigin:"center",
                // CSS keyframe animation is the fallback when the parallel
                // volume meter isn't running (mobile, or stream open failed).
                // When the meter IS running it sets `style.animation = "none"`
                // and drives `transform` directly so the bars react to voice.
                animation:`recBar 0.85s ease-in-out ${i * 0.12}s infinite`,
              }}
            />
          ))}
        </div>
        <div style={{ flex:1, minWidth:0, fontSize:13, color:interim ? T.text : T.muted, lineHeight:1.4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {interim || "Listening…"}
        </div>
        <div style={{ fontSize:11, color:T.hint, fontVariantNumeric:"tabular-nums", flexShrink:0 }}>
          {mm}:{ss}
        </div>
      </div>

      {/* Stop: commits the full transcript into the input box */}
      <button
        type="button"
        aria-label="Stop recording"
        onClick={() => speech.toggle()}
        style={{
          width:36, height:36, borderRadius:"50%",
          border:"none",
          background:T.gold, color:"#1a1a16",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", flexShrink:0,
          boxShadow:`0 0 0 3px ${T.gold}22`,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="2" y="2" width="9" height="9" rx="1.5" fill="currentColor"/>
        </svg>
      </button>
    </div>
  );
}

// ─── GOAL PLAN PREVIEW ────────────────────────────────────────────────────────
// Rendered inline in the coach chat whenever the AI outputs a <goal_plan> block.
// Lets the user confirm or dismiss before anything is written to the database.
function GoalPlanPreview({ plan, onConfirm, onDismiss }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const color = plan.color || "#E67E22";
  const milestones = (plan.milestones || []).filter(m => m.date && m.label).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayStr();

  async function handleConfirm() {
    if (confirming || done) return;
    setConfirming(true);
    try {
      await onConfirm(plan);
      setDone(true);
    } catch {
      setConfirming(false);
    }
  }

  if (done) {
    return (
      <div style={{ margin:"8px 0 4px", padding:"12px 14px", borderRadius:14, background:"rgba(39,174,96,0.1)", border:"0.5px solid rgba(39,174,96,0.3)", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:20 }}>✅</span>
        <div style={{ fontSize:13, color:T.green, fontWeight:500 }}>
          {plan.emoji || "🎯"} <strong>{plan.name}</strong> added to your goals
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin:"8px 0 4px", borderRadius:14, background:T.surface, border:`0.5px solid rgba(200,144,42,0.35)`, overflow:"hidden" }}>
      {/* Header row */}
      <div style={{ padding:"13px 14px 10px", display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:38, height:38, borderRadius:11, background:color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
          {plan.emoji || "🎯"}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600, color:T.text, lineHeight:1.3 }}>{plan.name}</div>
          {plan.why && (
            <div style={{ fontSize:11, color:T.muted, marginTop:1, fontStyle:"italic", lineHeight:1.4 }}>"{plan.why}"</div>
          )}
        </div>
      </div>

      {/* Progress target */}
      <div style={{ padding:"0 14px 10px", display:"flex", gap:16, flexWrap:"wrap" }}>
        <div style={{ fontSize:12, color:T.muted }}>
          <span style={{ color:T.hint }}>Start: </span>
          <strong style={{ color:T.text }}>{plan.startValue ?? 0}{plan.unit || ""}</strong>
        </div>
        <div style={{ fontSize:12, color:T.muted }}>
          <span style={{ color:T.hint }}>Target: </span>
          <strong style={{ color }}>
            {plan.targetValue}{plan.unit || ""}
            {plan.direction === "decreasing" ? " ↓" : " ↑"}
          </strong>
        </div>
        {plan.targetDate && (
          <div style={{ fontSize:12, color:T.muted }}>
            <span style={{ color:T.hint }}>Deadline: </span>
            <strong style={{ color:T.text }}>🎯 {fmtGoalDueHuman(plan.targetDate)}</strong>
          </div>
        )}
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div style={{ padding:"0 14px 12px" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:T.hint, marginBottom:6 }}>
            Milestones
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {milestones.map((m, i) => {
              const isFuture = m.date >= today;
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
                  <span style={{ color: isFuture ? T.gold : T.hint, fontSize:9 }}>◆</span>
                  <span style={{ color: isFuture ? T.text : T.muted }}>{m.label}</span>
                  <span style={{ color:T.hint, marginLeft:"auto", whiteSpace:"nowrap" }}>{fmtGoalDueHuman(m.date)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ padding:"10px 14px 13px", borderTop:`0.5px solid ${T.border}`, display:"flex", gap:8 }}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          style={{ flex:1, padding:"9px 14px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#1a1a16", fontSize:13, fontWeight:700, cursor:confirming ? "default" : "pointer", opacity:confirming ? 0.7 : 1, transition:"opacity 0.15s" }}
        >
          {confirming ? "Creating…" : "Create this goal"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{ padding:"9px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function AICoach({ habits, goals, user, isPro, onClose, onUpgrade, coachName, coachIcon, coachAccentColor, currentScreen, onHabitCreated, onGoalCreated, onHabitLogged, onGoalLogged, onHabitRenamed, onGoalPlanConfirm, onJournalLogged, journalEntries = [], openInputMode = null, pendingMessage = null, onNavigateTo = null }) {
  const cName = coachName || "Coach";
  const isCreatorUser = user?.id === CREATOR_ID;
  // ── Warmer, context-aware greeting ─────────────────────────────────────────
  // Reads today/yesterday/last-log state client-side (no extra API tokens) and
  // picks one of a handful of phrasings for each scenario. Computed once per
  // coach mount so it doesn't flip scenarios mid-session when the user logs
  // through the coach (habits state updates would otherwise re-evaluate).
  // For the creator account, swap in the larger, playful, per-open-rotating
  // bank from buildCreatorGreeting (also tracks last 3 lines in localStorage
  // so back-to-back opens never repeat).
  const greetingRef = useRef(null);
  if (greetingRef.current === null) {
    greetingRef.current = isCreatorUser
      ? buildCreatorGreeting({ name: user?.name, habits, goals })
      : buildCoachGreeting({ name: user?.name, habits, goals });
  }
  const greeting = greetingRef.current;
  const [messages, setMessages] = useState(() => {
    const uid = user?.id;
    if (!uid) return [];
    const loaded = loadCoachDayMessages(uid);
    return loaded?.length ? loaded : [];
  });
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const coachPersistDayRef = useRef(todayStr());
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [freeCoachMsgsToday, setFreeCoachMsgsToday] = useState(0);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const coachOpenedAtRef = useRef(Date.now());
  const speech    = useSpeechInput(t => setInput(p => p.trim() ? p + " " + t : t), { autoRestart: true, meter: true });

  // Hydrate today's thread from localStorage (one conversation per local calendar day).
  useLayoutEffect(() => {
    if (!user?.id) {
      setMessages([]);
      return;
    }
    const day = todayStr();
    coachPersistDayRef.current = day;
    const loaded = loadCoachDayMessages(user.id);
    setMessages(loaded?.length ? loaded : []);
  }, [user?.id]);

  // New local day while coach is open → fresh thread (storage key is day-scoped).
  useEffect(() => {
    function rollIfMidnight() {
      const d = todayStr();
      if (d !== coachPersistDayRef.current) {
        coachPersistDayRef.current = d;
        setMessages([]);
      }
    }
    const id = setInterval(rollIfMidnight, 45000);
    function onVis() {
      if (document.visibilityState === "visible") rollIfMidnight();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Persist thread (debounced); same-day key only.
  useEffect(() => {
    if (!user?.id) return;
    const day = todayStr();
    if (day !== coachPersistDayRef.current) return;
    const t = setTimeout(() => saveCoachDayMessages(user.id, day, messages), 320);
    return () => clearTimeout(t);
  }, [messages, user?.id]);

  // Flush before tab close / refresh so the debounced save isn't lost.
  useEffect(() => {
    if (!user?.id) return;
    function flush() {
      const day = todayStr();
      if (day !== coachPersistDayRef.current) return;
      saveCoachDayMessages(user.id, day, messagesRef.current);
    }
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [user?.id]);

  useEffect(() => {
    if (!openInputMode) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      if (openInputMode === "text") {
        textareaRef.current?.focus();
        return;
      }
      if (openInputMode === "mic") {
        if (!isPro) {
          onUpgrade?.();
          return;
        }
        if (!speech.supported) return;
        speech.toggle();
      }
    }, 160);
    return () => { cancelled = true; clearTimeout(t); };
  // Mount-only: coach sheet remounts each open (showCoach toggle).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-send a pending message if the coach was opened via page-mic.
  // Captured at mount time via ref so it doesn't re-run if the prop ever changes.
  const pendingMessageRef = useRef(pendingMessage);
  useEffect(() => {
    const msg = pendingMessageRef.current;
    if (!msg?.trim()) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) send(msg);
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function coachInputDisplayed() {
    if (speech.listening && speech.interim?.trim()) {
      const core = input.trim();
      return core ? `${core} ${speech.interim.trim()}` : speech.interim.trim();
    }
    return input;
  }

  const atFreeCap = !isPro && freeCoachMsgsToday >= FREE_DAILY_LIMIT;
  const streamingEmpty = messages.some(m => m.id === COACH_STREAM_ID && !String(m.content || "").trim());
  const showTryHint = messages.length === 0;
  const coachMsgsRemaining = !isPro && !atFreeCap ? FREE_DAILY_LIMIT - freeCoachMsgsToday : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (isPro) return;
    setFreeCoachMsgsToday(syncCoachMsgCountFromStorage());
  }, []);

  useEffect(() => {
    if (!loading) {
      setIsExecutingAction(false);
      return;
    }
    const t = setTimeout(() => setIsExecutingAction(true), 550);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    const onResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const inputBar = document.getElementById("coach-input-bar");
      if (inputBar) {
        inputBar.style.paddingBottom =
          Math.max(10, window.innerHeight - vv.height - vv.offsetTop + 10) + "px";
      }
    };
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", onResize);
    return () => {
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 88) + "px";
    el.scrollTop = el.scrollHeight;
  }, [input, speech.interim]);

  async function send(text) {
    textareaRef.current?.blur();
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    if (!isPro) {
      const c = syncCoachMsgCountFromStorage();
      setFreeCoachMsgsToday(c);
      if (c >= FREE_DAILY_LIMIT) return;
    }
    let countedThisSend = false;
    const bumpAfterSuccess = () => {
      if (isPro || countedThisSend) return;
      countedThisSend = true;
      setFreeCoachMsgsToday(bumpCoachMsgCountInStorage());
    };
    setInput("");
    setError(null);
    const sendDay = todayStr();
    let baseMessages = messages;
    if (sendDay !== coachPersistDayRef.current) {
      coachPersistDayRef.current = sendDay;
      baseMessages = [];
    }
    const userMsg = { role: "user", content: trimmed, ts: Date.now() };
    const next = baseMessages.length === 0
      ? [
          { role: "assistant", content: greeting, ts: coachOpenedAtRef.current },
          userMsg,
        ]
      : [...baseMessages, userMsg];
    setMessages(next);
    if (user?.id) saveCoachDayMessages(user.id, sendDay, next);
    setLoading(true);
    setIsExecutingAction(false);
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
          system:   buildCoachSystemPrompt(user, habits, cName, currentScreen, goals, journalEntries),
          // Match server cap (api/chat.js slice -12): token-safe, full day kept in localStorage only.
          messages: next.map(m => ({ role: m.role, content: m.content })).slice(-COACH_API_MESSAGE_CAP),
          // Send the user's actual local date (YYYY-MM-DD) so AI logs land on
          // the correct calendar day. Server falls back to UTC if missing.
          client_date: todayStr(),
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
        const streamTs = Date.now();
        setMessages(prev => [...prev, { role: "assistant", content: "", id: COACH_STREAM_ID, ts: streamTs }]);
        setLoading(false);
        setIsExecutingAction(false);

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
                setIsExecutingAction(false);
                fullText += evt.text;
                const snap = fullText;
                setMessages(prev => prev.map(m => m.id === COACH_STREAM_ID ? { ...m, content: snap } : m));
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              }
              if (evt.done) {
                bumpAfterSuccess();
                const receiptBlock = evt.receipt && String(evt.receipt).trim()
                  ? `\n\n${String(evt.receipt).trim()}`
                  : "";
                const finalContent = (fullText.trim() ? fullText.trim() : "") + receiptBlock;
                const doneDay = todayStr();
                coachPersistDayRef.current = doneDay;
                // Finalise — remove stream id marker; append server truth receipt (never model-invented)
                setMessages(prev => {
                  const nextMsgs = prev.map(m => m.id === COACH_STREAM_ID ? { role: "assistant", content: finalContent || fullText, ts: m.ts ?? Date.now() } : m);
                  if (user?.id) saveCoachDayMessages(user.id, doneDay, nextMsgs);
                  return nextMsgs;
                });

                // ── Created ───────────────────────────────────────────────────
                if (evt.created) {
                  const row = evt.created;
                  if (row.habit_type === "goal") onGoalCreated?.(rowToGoal(row));
                  else onHabitCreated?.(rowToHabit(row));
                }

                // ── Edited ────────────────────────────────────────────────────
                if (evt.edited?.length) {
                  evt.edited.forEach(edit => {
                    const row = edit.updatedRow;
                    if (!row) return;
                    if (row.habit_type === "goal") {
                      onGoalCreated?.(rowToGoal(row));
                    } else {
                      onHabitCreated?.(rowToHabit(row));
                    }
                  });
                }

                // ── Logged ────────────────────────────────────────────────────
                if (evt.logged?.length) {
                  evt.logged.forEach(l => {
                    if (l.habit_type === "goal") {
                      onGoalLogged?.(l.habit_id, l.updatedLogs);
                    } else {
                      onHabitLogged?.(l.habit_id, l.updatedLogs);
                    }
                  });
                }

                // ── Journaled ─────────────────────────────────────────────────
                if (evt.journaled?.length) {
                  onJournalLogged?.(evt.journaled);
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
        setIsExecutingAction(false);
        setMessages(prev => [...prev, { role: "assistant", content: data.reply || "", ts: Date.now() }]);
      }
    } catch (e) {
      setLoading(false);
      setIsExecutingAction(false);
      // Remove incomplete stream message if present
      setMessages(prev => prev.filter(m => m.id !== COACH_STREAM_ID));
      setError(e.message || "Couldn't reach the coach. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!atFreeCap) send(coachInputDisplayed()); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", display:"flex", flexDirection:"column", height:"80vh", maxHeight:680 }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"16px 20px 13px", borderBottom:`0.5px solid ${T.border}`, flexShrink:0 }}>
          {/* Avatar — shows the selected coach icon, falls back to initial */}
          <div style={{
            width:40, height:40, borderRadius:"50%", flexShrink:0,
            background:`${coachAccentColor || T.accent}22`,
            border:`1.5px solid ${coachAccentColor || T.accent}55`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize: (coachIcon && COACH_ICON_OPTIONS.includes(coachIcon)) ? 20 : 16,
            fontWeight:600, color: coachAccentColor || T.accent,
            lineHeight:1,
          }}>
            {coachIcon && COACH_ICON_OPTIONS.includes(coachIcon) ? coachIcon : cName.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:600, color:T.text, lineHeight:1.2 }}>{cName}</div>
            <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:3 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:T.green, flexShrink:0 }}/>
              <div style={{ fontSize:11, color:T.muted }}>Active — knows your habits & goals</div>
            </div>
          </div>
          {!isPro && !atFreeCap && freeCoachMsgsToday > 0 && coachMsgsRemaining != null && coachMsgsRemaining > 0 ? (
            <div style={{
              flexShrink:0, fontSize:11, fontWeight:500,
              color: coachMsgsRemaining <= 3 ? T.gold : T.muted,
              background:T.surface, border:`0.5px solid ${T.border}`, borderRadius:20,
              padding:"4px 10px", lineHeight:1.2,
            }}>
              {coachMsgsRemaining} left
            </div>
          ) : null}
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px", display:"flex", flexDirection:"column", gap:10 }}>
          {messages.length === 0 ? (
            <>
              <div style={{ display:"flex", justifyContent:"flex-start" }}>
                <div style={{ maxWidth:"85%", display:"flex", flexDirection:"column", alignItems:"flex-start" }}>
                  <div style={{
                    padding:"10px 14px",
                    borderRadius:"14px 14px 14px 3px",
                    background:T.surface,
                    fontSize:14, color:T.text,
                    lineHeight:1.6, wordBreak:"break-word",
                  }}>
                    <CoachFormattedBubble text={greeting} isUser={false} />
                  </div>
                  <div style={{ fontSize:10, color:T.hint, marginTop:3, alignSelf:"flex-end" }}>
                    {formatCoachMsgTime(coachOpenedAtRef.current)}
                  </div>
                </div>
              </div>

              {/* Starter prompt chips — tap to send. Tailored to current state. */}
              {(() => {
                const hasHabits = habits.length > 0;
                const hasGoals  = (goals || []).some(g => g.status !== "completed");
                const firstHabit = habits[0];
                const starters = [];
                // Goal planning first when the user has no goals — most impactful action
                if (!hasGoals) {
                  starters.push("Help me set a goal");
                }
                if (hasHabits && firstHabit) {
                  starters.push(`Log my ${firstHabit.name.toLowerCase()} for today`);
                }
                starters.push("How am I doing this week?");
                if (hasHabits) {
                  starters.push("What habit should I add next?");
                } else {
                  starters.push("Help me pick my first habit");
                }
                if (hasGoals) {
                  starters.push("Am I on track with my goals?");
                }
                starters.push("Give me a pep talk");
                return (
                  <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:6 }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:T.muted, padding:"0 2px" }}>
                      Try asking {cName}
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {starters.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => send(s)}
                          disabled={loading || atFreeCap}
                          style={{
                            padding:"7px 12px",
                            borderRadius:16,
                            border:`0.5px solid rgba(200,144,42,0.35)`,
                            background:"rgba(200,144,42,0.08)",
                            color:T.gold,
                            fontSize:12,
                            fontWeight:600,
                            cursor: loading || atFreeCap ? "default" : "pointer",
                            opacity: loading || atFreeCap ? 0.55 : 1,
                            lineHeight:1.3,
                            textAlign:"left",
                            fontFamily:T.font,
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:11, color:T.muted, lineHeight:1.5, marginTop:2, padding:"0 2px" }}>
                      I can set goals with milestones, log habits, track your progress, and tell you what patterns I'm seeing.
                    </div>
                  </div>
                );
              })()}
            </>
          ) : null}
          {messages.map((m, i) => {
            // For assistant messages, check for an embedded <goal_plan> block.
            const parsed = m.role === "assistant" ? parseGoalPlan(m.content) : null;
            // While the block is still streaming, strip the raw partial XML so
            // the user never sees "<goal_plan>{..." leaking into the bubble.
            const rawVisible = parsed
              ? parsed.textWithout
              : m.role === "assistant"
                ? stripPartialGoalPlan(m.content)
                : m.content;
            const { main: coachMain, receipt: coachReceipt } =
              m.role === "assistant" ? splitCoachReceipt(rawVisible) : { main: rawVisible, receipt: null };
            return (
              <div key={m.id || `${m.role}-${i}-${m.ts ?? ""}`} style={{ display:"flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth:"90%", display:"flex", flexDirection:"column", alignItems: m.role === "user" ? "flex-end" : "flex-start", width: parsed ? "100%" : undefined }}>
                  {(coachMain || coachReceipt) ? (
                    <div style={{
                      padding:"10px 14px",
                      borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                      background: m.role === "user" ? T.accent : T.surface,
                      fontSize:14, color: m.role === "user" ? "#fff" : T.text,
                      lineHeight:1.6, wordBreak:"break-word",
                    }}>
                      {coachMain ? (
                        <CoachFormattedBubble text={coachMain} isUser={m.role === "user"} />
                      ) : null}
                      {coachReceipt ? (
                        <div style={{
                          marginTop: coachMain ? 10 : 0,
                          paddingTop: coachMain ? 10 : 0,
                          borderTop: coachMain ? `0.5px solid ${T.border}` : "none",
                        }}>
                          <CoachReceiptChips
                            receiptText={coachReceipt}
                            onNavigateTo={onNavigateTo}
                            onClose={onClose}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {parsed && (
                    <GoalPlanPreview
                      plan={parsed.plan}
                      onConfirm={async (plan) => {
                        if (onGoalPlanConfirm) await onGoalPlanConfirm(plan);
                      }}
                      onDismiss={() => {
                        // Nudge user to clarify — put a prompt in the input box
                        setInput("Can you adjust the goal — ");
                      }}
                    />
                  )}
                  <div style={{ fontSize:10, color:T.hint, marginTop:3, alignSelf:"flex-end" }}>
                    {formatCoachMsgTime(m.ts)}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing / action indicator (slow fetch ≈ server-side tools before stream) */}
          {loading && isExecutingAction ? (
            <div style={{ display:"flex", justifyContent:"flex-start" }}>
              <div style={{ padding:"10px 16px", borderRadius:"14px 14px 14px 3px", background:T.surface, fontSize:13, color:T.muted, fontStyle:"italic" }}>
                Taking action…
              </div>
            </div>
          ) : (loading && !isExecutingAction) || streamingEmpty ? (
            <div style={{ display:"flex", justifyContent:"flex-start" }}>
              <div style={{ padding:"10px 16px", borderRadius:"14px 14px 14px 3px", background:T.surface, display:"flex", gap:5, alignItems:"center" }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.muted,
                    animation:"coachDot 1.2s ease-in-out infinite", animationDelay:`${i*0.2}s` }}/>
                ))}
              </div>
            </div>
          ) : null}

          {/* Error */}
          {error && (
            <div style={{ textAlign:"center", fontSize:12, color:T.accent, padding:"4px 8px" }}>{error}</div>
          )}

          <div ref={bottomRef}/>
        </div>

        {/* Input bar — mic left (voice entry), field, send right (standard chat hierarchy) */}
        <div id="coach-input-bar" style={{ padding:"10px 14px 10px", borderTop:`0.5px solid ${T.border}`, flexShrink:0 }}>
          {!isPro && !atFreeCap && freeCoachMsgsToday >= 3 && freeCoachMsgsToday < FREE_DAILY_LIMIT && (
            <div style={{ fontSize:11, color:T.muted, padding:"2px 2px 8px", lineHeight:1.5 }}>
              {FREE_DAILY_LIMIT - freeCoachMsgsToday} message{FREE_DAILY_LIMIT - freeCoachMsgsToday === 1 ? "" : "s"} left today —{" "}
              <button
                type="button"
                onClick={onUpgrade}
                style={{
                  background:"none", border:"none", padding:0, cursor:"pointer",
                  font:"inherit", color:T.gold, fontWeight:700,
                  textDecoration:"underline", textUnderlineOffset:2,
                }}
              >
                Pro
              </button>{" "}
              gets unlimited.
            </div>
          )}
          {speech.listening ? (
            <CoachRecordingBar speech={speech} />
          ) : (
            <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
              {speech.supported ? (
                <div style={{ opacity: atFreeCap ? 0.35 : 1, pointerEvents: atFreeCap ? "none" : "auto", flexShrink:0, alignSelf:"flex-end", marginBottom:1 }}>
                  <MicBtn
                    speech={speech}
                    color={T.gold}
                    size={44}
                    prominent
                    locked={!isPro}
                    onLockedClick={onUpgrade}
                  />
                </div>
              ) : null}
              <div style={{ flex:1, position:"relative", minWidth:0 }}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onInput={e => {
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px";
                  }}
                  onKeyDown={handleKey}
                  disabled={atFreeCap}
                  placeholder="Ask anything about your habits…"
                  style={{
                    width:"100%", boxSizing:"border-box",
                    background:T.surface, border:`0.5px solid ${T.borderStrong}`,
                    borderRadius:T.rsm, padding:"10px 14px",
                    fontSize:16, color:T.text, resize:"none",
                    fontFamily:T.font, lineHeight:1.5, outline:"none",
                    minHeight:"42px", maxHeight:"88px", overflowY:"auto", height:"auto",
                    opacity: atFreeCap ? 0.55 : 1,
                  }}
                />
              </div>
              <button
                type="button"
                aria-label={input.trim() && !loading && !atFreeCap ? "Send message" : "Send (disabled until you type)"}
                onClick={() => { textareaRef.current?.blur(); send(input); }}
                disabled={!input.trim() || loading || atFreeCap}
                style={{
                  width:36, height:36, borderRadius:"50%", border:`0.5px solid ${T.border}`,
                  flexShrink:0,
                  background: input.trim() && !loading && !atFreeCap ? T.gold : T.surface,
                  cursor: input.trim() && !loading && !atFreeCap ? "pointer" : "default",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"background 0.2s, border-color 0.2s, opacity 0.2s",
                  opacity: !input.trim() || loading || atFreeCap ? 0.85 : 1,
                }}>
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                  <path d="M2 9h14M9 2l7 7-7 7" stroke={input.trim() && !loading && !atFreeCap ? "#1a1a16" : T.hint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}
          {/* The old italic "Try: …" hint is now redundant — the empty-state has
              labeled starter chips in the message area. Keeping only mic / rate
              limit prompts below. */}
          {speech.supported && speech.micBlocked ? (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, padding:"0 2px", lineHeight:1.45 }}>
              Mic blocked. Enable it in your browser settings.
            </div>
          ) : null}
          {!isPro && speech.supported && !atFreeCap && !speech.micBlocked && !speech.listening ? (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, padding:"0 2px", lineHeight:1.45 }}>
              🎙️ Voice logging is a{" "}
              <button
                type="button"
                onClick={onUpgrade}
                style={{
                  background:"none", border:"none", padding:0, cursor:"pointer",
                  font:"inherit", color:T.gold, fontWeight:700,
                  textDecoration:"underline", textUnderlineOffset:2,
                }}
              >
                Pro
              </button>{" "}
              feature — tap to preview.
            </div>
          ) : null}
          {speech.supported && speech.speechError ? (
            <div style={{ fontSize:11, color:T.accent, marginTop:8, padding:"0 2px", lineHeight:1.5, whiteSpace:"pre-line" }}>
              {speech.speechError}
            </div>
          ) : null}
          {atFreeCap && (
            <div style={{
              marginTop:12, padding:"12px 14px", borderRadius:T.rsm,
              background:T.surface, border:`0.5px solid ${T.borderStrong}`,
              display:"flex", flexDirection:"column", gap:6,
            }}>
              <div style={{ fontSize:13, fontWeight:600, color:T.text }}>
                {`You've used your ${FREE_DAILY_LIMIT} free messages today`}
              </div>
              <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>
                Forged Pro gives you unlimited coaching, plus full history, friend nudges, and voice logging.
              </div>
              <button
                type="button"
                onClick={onUpgrade}
                style={{
                  marginTop:4, padding:"8px 0", borderRadius:T.rsm,
                  border:"none", background:T.gold, color:"#1a1a16",
                  fontSize:13, fontWeight:700, cursor:"pointer", width:"100%",
                }}
              >
                Upgrade to Pro
              </button>
              <div style={{ fontSize:11, color:T.hint, textAlign:"center" }}>
                Resets at midnight
              </div>
            </div>
          )}
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

function OnboardingScreen({ onComplete, onSkip, onSaveProgress, onCheckout, notifEnabled, notifLoading, notifPermission, onNotifToggle, isCoachClient = false }) {
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
  // Final-screen "weekly updates by email" opt-in. Default ON; persisted on
  // completion (same localStorage key the post-upgrade thank-you modal uses, so
  // preferences don't silently diverge between surfaces).
  const [emailUpdatesOptIn, setEmailUpdatesOptIn] = useState(true);

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

  const isVirtual = step >= ONBOARD_STEPS.length;

  // Canonical 1-based step number for the progress header. The interstitial
  // shares Focus' number (it's a sub-screen), and the three virtual post-focus
  // steps are reordered visually: Home (6) → Notifs (7) → First log (8).
  const DISPLAY_TOTAL = 5;
  function displayStepNumber(s) {
    if (s === INTER_STEP) return 4;   // Focus' number — interstitial is a transition
    if (s === NOTIF_STEP) return 5;
    if (s === FIRST_STEP) return 5;
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
    background:T.surface, padding:"10px 12px", fontSize:14, color:T.text,
    outline:"none", boxSizing:"border-box",
  };

  const wrap = { fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column" };

  // Shared progress header — slim bar + "Step X of Y" label. Replaces the red
  // dot row that used to feel opaque. `currentNum` is 1-based.
  function ProgressHeader({ currentNum, total = DISPLAY_TOTAL }) {
    const pct = Math.max(0, Math.min(100, Math.round((currentNum / total) * 100)));
    return (
      <div style={{ padding:"24px 24px 0" }}>
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

            {/* Email updates opt-in — pre-checked, stored under the existing
                forged_beta_email_opt_in key so it lines up with the post-upgrade
                thank-you modal. */}
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

  // ── Virtual step 8: log your first habit — now the last onboarding action ───
  if (step === FIRST_STEP && builtHabits.length > 0) {
    const firstHabit = pickFirstHabit(builtHabits);
    const annotation = HABIT_ANNOTATIONS[firstHabit.habitType] || HABIT_ANNOTATIONS.daily;
    const needsValue = isLegacyProgressType(firstHabit.habitType) || firstHabit.habitType === "project" || firstHabit.habitType === "limit";

    return (
      <div style={wrap}>
        <ProgressHeader currentNum={progressNumber} />

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
              setShowingFinal(true);
            }}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:(needsValue&&!firstLogValue)?T.surface:firstHabit.color, color:(needsValue&&!firstLogValue)?T.muted:"#fff", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s" }}
          >
            Log your first entry →
          </button>
          <button onClick={() => { setShowingFinal(true); }}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer", marginTop:6 }}>
            Skip this step
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
              onClick={() => builtHabits.length > 0 ? setStep(FIRST_STEP) : setShowingFinal(true)}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", marginBottom:10 }}
            >
              Reminders on — let's go ✓
            </button>
          ) : (
            <button
              onClick={async () => {
                if (onNotifToggle) await onNotifToggle();
                if (builtHabits.length > 0) setStep(FIRST_STEP); else setShowingFinal(true);
              }}
              disabled={notifLoading || blocked}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:blocked?T.surface:T.gold, color:blocked?T.muted:"#0F0F0D", fontSize:16, fontWeight:600, cursor:blocked?"not-allowed":"pointer", opacity:(notifLoading||blocked)?0.7:1, marginBottom:10, transition:"opacity 0.15s" }}
            >
              {notifLoading ? "Enabling…" : blocked ? "Notifications blocked" : "Enable daily reminders 🔔"}
            </button>
          )}
          <button
            onClick={() => builtHabits.length > 0 ? setStep(FIRST_STEP) : setShowingFinal(true)}
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

// ─── SHARE CARD ───────────────────────────────────────────────────────────────
function ShareCardModal({ user, habits, xp, onClose }) {
  const level = getLevel(xp);
  const realLogs = habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip"));
  const totalLogs = new Set(realLogs.map(l => l.date)).size; // unique days tracked
  const bestStreak = Math.max(0, ...habits.map(h => getStreak(h)));
  const loggedToday = habits.filter(h => h.habitType !== "log" && isSatisfiedForTodayRing(h)).length;
  const ws = currentWeekStart();
  const weekLogs = habits.reduce((s, h) => s + h.logs.filter(l => l.date >= ws && l.value !== "quicknote" && l.value !== "skip").length, 0);
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
              { label:"Days tracked", value:totalLogs,        sub:"all time",     color:T.text },
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
    { icon:"∞",  label:"Unlimited habits",    free:"Up to 5",      pro:"No limit",               live:true },
    { icon:"🤖", label:"AI coach messages",    free:"5 per day",    pro:"Unlimited",              live:true },
    { icon:"🎙️", label:"Voice logging",         free:"—",            pro:"Talk to log & reflect",  live:true },
    { icon:"💪", label:"Nudge a friend",       free:"—",            pro:"Keep each other honest", live:true },
    { icon:"📜", label:"Full history",         free:"Last 7 days",  pro:"Every entry, forever",   live:true },
    { icon:"📅", label:"Monthly calendar",     free:"—",            pro:"Spot gaps at a glance",  live:true },
    { icon:"🔔", label:"Smart reminders",      free:"—",            pro:"Daily push nudges",      live:false },
    { icon:"📊", label:"Pattern detection",    free:"Streaks + 28d", pro:"AI pattern analysis",    live:false },
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

// Reusable iOS-style switch used by the notification settings panel. Kept
// inline so it doesn't pull in another file and stays consistent with the
// existing master toggle styling.
function ToggleSwitch({ on, onClick, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        flexShrink:0, width:48, height:28, borderRadius:14, border:"none",
        background: on ? T.gold : T.border,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        position:"relative", transition:"background 0.2s", padding:0,
      }}
    >
      <div style={{
        position:"absolute", top:3,
        left: on ? "calc(100% - 25px)" : 3,
        width:22, height:22, borderRadius:"50%",
        background:"#fff", transition:"left 0.2s",
        boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
      }}/>
    </button>
  );
}

// One row inside the notification-categories panel. Three of these stack
// inside the dark sub-card on Profile.
function NotifCategoryRow({ emoji, title, subtitle, checked, onChange, disabled, noBorderBottom }) {
  return (
    <div
      style={{
        display:"flex", alignItems:"center", gap:12,
        padding:"12px 14px",
        borderBottom: noBorderBottom ? "none" : `0.5px solid rgba(255,255,255,0.04)`,
      }}
    >
      <span style={{ fontSize:18, width:24, textAlign:"center", flexShrink:0 }} aria-hidden>{emoji}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13.5, fontWeight:600, color:T.text }}>{title}</div>
        <div style={{ fontSize:11.5, color:T.muted, marginTop:1, lineHeight:1.35 }}>{subtitle}</div>
      </div>
      <ToggleSwitch
        on={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        ariaLabel={`${checked ? "Disable" : "Enable"} ${title}`}
      />
    </div>
  );
}

/** Shown in Profile for users who don't have a coach yet. Lets them enter a
 *  coach code (8 hex chars, e.g. ABCD-1234) to link to an existing coach. */
function JoinCoachSection({ onLinked }) {
  const [code,    setCode]    = useState("");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState("");
  const [success, setSuccess] = useState(null); // { coachName }
  const [open,    setOpen]    = useState(false);

  function formatCode(raw) {
    const clean = raw.replace(/[^a-fA-F0-9]/g, "").toUpperCase().slice(0, 8);
    return clean.length > 4 ? `${clean.slice(0,4)}-${clean.slice(4)}` : clean;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const clean = code.replace(/-/g, "").toLowerCase();
    if (clean.length < 6) { setErr("Code too short — try again"); return; }
    setBusy(true); setErr("");
    try {
      // Look up the coach by UUID prefix
      const { data: coaches, error: lookupErr } = await supabase
        .from("profiles")
        .select("id, name")
        .or("is_coach.eq.true,coach_tier.not.is.null")
        .ilike("id", `${clean}%`)
        .limit(1);
      if (lookupErr) throw new Error(lookupErr.message);
      if (!coaches || coaches.length === 0) { setErr("Code not found — double-check and try again"); setBusy(false); return; }
      const coach = coaches[0];
      // Link via the existing accept-coach-invite endpoint
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/accept-coach-invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ coach: btoa(coach.id) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to link");
      setSuccess({ coachName: coach.name });
      onLinked?.(coach.id, coach.name);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div style={{
        margin:"0 14px 12px",
        background:"linear-gradient(145deg, rgba(39,174,96,0.07), rgba(39,174,96,0.02))",
        border:`1px solid rgba(39,174,96,0.28)`, borderRadius:14, padding:"14px 16px",
      }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#27AE60", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Coaching</div>
        <div style={{ fontSize:15, fontWeight:600, color:T.text, marginBottom:4 }}>Connected to {success.coachName}</div>
        <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>Your coach can now see your habits and notes. You&apos;ve also been upgraded to Forged Pro.</div>
      </div>
    );
  }

  if (!open) {
    return (
      <div style={{ margin:"0 14px 12px" }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width:"100%", padding:"12px 16px", borderRadius:12, border:`1px solid ${T.border}`,
            background:T.surface, color:T.muted, fontSize:13, cursor:"pointer",
            fontFamily:T.font, textAlign:"left", display:"flex", alignItems:"center", justifyContent:"space-between",
          }}
        >
          <span>Join a coach</span>
          <span style={{ fontSize:18, color:T.hint }}>›</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ margin:"0 14px 12px", background:T.raised, border:`0.5px solid ${T.border}`, borderRadius:14, padding:"14px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text }}>Join a coach</div>
        <button type="button" onClick={() => { setOpen(false); setErr(""); setCode(""); }}
          style={{ background:"none", border:"none", color:T.muted, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
      </div>
      <div style={{ fontSize:12, color:T.muted, lineHeight:1.65, marginBottom:14 }}>
        Enter the 8-character coach code your coach shared with you. You&apos;ll be linked instantly and upgraded to Pro.
      </div>
      <form onSubmit={handleSubmit}>
        <input
          value={code}
          onChange={e => { setCode(formatCode(e.target.value)); setErr(""); }}
          placeholder="ABCD-1234"
          maxLength={9}
          style={{
            width:"100%", padding:"11px 14px", borderRadius:10, fontSize:18, fontWeight:700,
            letterSpacing:"0.12em", textAlign:"center", fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",
            background:T.surface, border:`1px solid ${err ? "#E74C3C" : T.border}`,
            color:T.text, outline:"none", boxSizing:"border-box", marginBottom:err ? 6 : 12,
          }}
          autoCapitalize="characters"
          autoComplete="off"
        />
        {err && <div style={{ fontSize:12, color:"#E74C3C", marginBottom:10, textAlign:"center" }}>{err}</div>}
        <button
          type="submit"
          disabled={busy || code.replace(/-/g,"").length < 6}
          style={{
            width:"100%", padding:"12px 0", borderRadius:10, border:"none",
            background: (busy || code.replace(/-/g,"").length < 6) ? "rgba(255,255,255,0.07)" : T.gold,
            color: (busy || code.replace(/-/g,"").length < 6) ? T.muted : "#1a1a16",
            fontSize:14, fontWeight:700, fontFamily:T.font,
            cursor: (busy || code.replace(/-/g,"").length < 6) ? "default" : "pointer",
            transition:"background 0.2s, color 0.2s",
          }}
        >
          {busy ? "Connecting…" : "Connect to coach"}
        </button>
      </form>
    </div>
  );
}

function ProfileScreen({ user, xp, habits, isPro, isCoach, stripeCustomerId, refCode, authEmail, onUpdateUser, onResetOnboarding, onPreviewOnboarding, onReplayPageGuides, onPreviewCoach, onPreviewCoachWorkspace, onSignOut, onShowTour, onUpgrade, coachName, coachIcon, onSaveCoach, notifEnabled, notifTime, notifLoading, notifPermission, dailyRemindersEnabled, nudgesEnabled, invitesEnabled, onNotifToggle, onNotifTimeChange, onNotifCategoryChange }) {
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
  const totalLogs        = new Set(habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip").map(l => l.date))).size;
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
        <Stat label="days tracked" value={totalLogs}           color={T.accent}/>
        <Stat label="reflections"  value={totalReflections}    color="#8E44AD"/>
        <Stat label="best streak"  value={`${bestStreak}d`}    color={T.gold}/>
      </div>

      {/* Coaching — only shown when this account is linked to a coach */}
      {user.coachId && (
        <div style={{
          margin:"0 14px 12px",
          background:"linear-gradient(145deg, rgba(39,174,96,0.07) 0%, rgba(39,174,96,0.02) 100%)",
          border:`1px solid rgba(39,174,96,0.28)`,
          borderRadius:14,
          padding:"14px 16px",
        }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#27AE60", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>
            Coaching
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:6 }}>
            <span style={{ fontSize:17, color:T.text, fontWeight:600 }}>
              {user.linkedCoachName || "Your coach"}
            </span>
            <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#27AE60", fontWeight:600, background:"rgba(39,174,96,0.1)", padding:"3px 9px", borderRadius:99 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#27AE60", flexShrink:0 }}/>
              Connected
            </span>
          </div>
          <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>
            {user.linkedCoachName ? `${user.linkedCoachName} can` : "Your coach can"} see your habit logs and notes to help prepare for your sessions.
          </div>
        </div>
      )}

      {/* Join a coach — shown when not yet linked */}
      {!user.coachId && (
        <JoinCoachSection onLinked={(coachId, coachName) => onUpdateUser({ coachId, linkedCoachName: coachName })} />
      )}

      {/* Forged Coach — discovery for professionals (consumer accounts only) */}
      {!isCoach && typeof onPreviewCoachWorkspace === "function" && (
        <div style={{
          margin:"0 14px 12px",
          background:`linear-gradient(165deg, rgba(200,144,42,0.12) 0%, ${T.raised} 55%)`,
          border:`1px solid rgba(200,144,42,0.35)`,
          borderRadius:14,
          padding:"16px 18px",
        }}>
          <div style={{ fontSize:10, fontWeight:700, color:T.gold, letterSpacing:"0.1em", marginBottom:8 }}>FORGED COACH</div>
          <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, lineHeight:1.25, marginBottom:8 }}>
            Run 1:1s? See habits before every session.
          </div>
          <div style={{ fontSize:12, color:T.muted, lineHeight:1.65, marginBottom:14 }}>
            Client roster, streaks, notes, and an AI pre-session brief — built for coaches, separate from the habit app your clients use.
          </div>
          <button
            type="button"
            onClick={onPreviewCoachWorkspace}
            style={{
              width:"100%", padding:"12px 14px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.5)`,
              background:T.gold, color:"#0F0F0D", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:T.font,
            }}
          >
            Preview coach workspace (demo)
          </button>
          <div style={{ fontSize:11, color:T.hint, lineHeight:1.6, marginTop:12 }}>
            <strong style={{ color:T.sub }}>How access works today:</strong> your profile is marked as a coach in Forged (we onboard coaches in batches), then you subscribe in-app ($49/mo, up to 15 clients, Stripe). Promo codes work at checkout if you have one.
          </div>
        </div>
      )}

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
          {/* Header row: icon + label + master toggle. The master toggle
              controls the browser push subscription itself. The three
              category sub-toggles below it gate WHICH push types fire — they
              persist independently per push_subscriptions row so a user can,
              say, accept friend nudges in real time while turning off the
              daily reminder. */}
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
              <div style={{ fontSize:15, fontWeight:600, color:T.text, letterSpacing:"-0.01em" }}>Push notifications</div>
              <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>
                {notifPermission === "denied"
                  ? "Blocked — enable in your device Settings → Notifications"
                  : notifEnabled
                    ? "Choose what you want to be notified about"
                    : "Tap to enable push notifications on this device"}
              </div>
            </div>
            <ToggleSwitch
              on={notifEnabled}
              onClick={onNotifToggle}
              disabled={notifLoading || notifPermission === "denied"}
              ariaLabel={notifEnabled ? "Disable push notifications" : "Enable push notifications"}
            />
          </div>

          {/* Per-category controls — only relevant once the user has granted
              push permission and we have a live subscription. */}
          {notifEnabled && notifPermission !== "denied" && (
            <div
              style={{
                marginTop:14,
                background:"rgba(0,0,0,0.18)",
                border:`0.5px solid rgba(200,144,42,0.18)`,
                borderRadius:10,
                overflow:"hidden",
              }}
            >
              {/* Daily reminders + time picker */}
              <NotifCategoryRow
                emoji="⏰"
                title="Daily reminders"
                subtitle={
                  dailyRemindersEnabled
                    ? "One per day. Sent within ~5 min of the time you choose."
                    : "Off — your daily push is paused"
                }
                checked={dailyRemindersEnabled}
                onChange={v => onNotifCategoryChange("daily_reminders_enabled", v)}
                disabled={notifLoading}
              />
              {dailyRemindersEnabled && (
                <div
                  style={{
                    padding:"6px 14px 12px 50px",
                    display:"flex", alignItems:"center", gap:10,
                    borderBottom:`0.5px solid rgba(255,255,255,0.04)`,
                  }}
                >
                  <input
                    type="time"
                    value={notifTime}
                    step={300}
                    onChange={e => onNotifTimeChange(e.target.value)}
                    disabled={notifLoading}
                    aria-label="Reminder time"
                    style={{
                      fontSize:14, color:T.text, fontWeight:500,
                      background:T.surface,
                      border:`0.5px solid ${T.border}`,
                      borderRadius:8,
                      padding:"6px 8px",
                      cursor:notifLoading ? "not-allowed" : "pointer",
                      opacity:notifLoading ? 0.5 : 1,
                      fontFamily:"inherit",
                      minWidth:96,
                      colorScheme:"dark",
                    }}
                  />
                  <span style={{ fontSize:11, color:T.hint }}>your local time</span>
                </div>
              )}

              {/* Friend nudges */}
              <NotifCategoryRow
                emoji="💪"
                title="Friend nudges"
                subtitle={
                  nudgesEnabled
                    ? "When a friend nudges you to log"
                    : "Off — in-app toasts still appear, just no push"
                }
                checked={nudgesEnabled}
                onChange={v => onNotifCategoryChange("nudges_enabled", v)}
                disabled={notifLoading}
              />

              {/* Friend requests + shared-goal invites */}
              <NotifCategoryRow
                emoji="🤝"
                title="Requests & invites"
                subtitle={
                  invitesEnabled
                    ? "Friend requests and shared-goal invites"
                    : "Off — accept them in the app instead"
                }
                checked={invitesEnabled}
                onChange={v => onNotifCategoryChange("social_invites_enabled", v)}
                disabled={notifLoading}
                noBorderBottom
              />
            </div>
          )}
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
          <div style={{ fontSize:10, fontWeight:500, color:T.gold, textTransform:"uppercase", letterSpacing:"0.08em" }}>Forged Pro</div>
          {isPro && <div style={{ fontSize:10, color:T.green, fontWeight:600, background:T.green+"18", padding:"2px 8px", borderRadius:10 }}>✓ Active</div>}
        </div>
        <div style={{ padding:"4px 16px 16px" }}>
          {isPro ? (
            <div style={{ fontSize:14, color:T.text, lineHeight:1.6 }}>
              You're on Forged Pro — unlimited AI coaching, full history, and everything we ship next. 🙌<br/>
              <span style={{ fontSize:12, color:T.muted }}>AI coach, voice logging, friend nudges, and full history are all unlocked.</span>
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
                  { label:"Unlimited habits",            status:"pro" },
                  { label:"Unlimited AI coach messages", status:"pro" },
                  { label:"Voice logging",               status:"pro" },
                  { label:"Nudge friends to stay on track", status:"pro" },
                  { label:"Full history & monthly calendar", status:"pro" },
                  { label:"AI pattern detection",        status:"soon" },
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
        <button type="button" onClick={() => openForgedFeedbackMailto()}
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
            style={{ width:"100%", padding:"11px 0", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer", fontFamily:T.font, marginBottom:8 }}>
            Preview onboarding (safe — no data changes)
          </button>
          <button onClick={onReplayPageGuides}
            style={{ width:"100%", padding:"11px 0", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer", fontFamily:T.font, marginBottom:8 }}>
            Replay AI page tour (safe — no data changes)
          </button>
          <button onClick={onPreviewCoach}
            style={{ width:"100%", padding:"11px 0", borderRadius:T.rsm, border:`0.5px solid rgba(200,144,42,0.4)`, background:"none", color:T.gold, fontSize:13, cursor:"pointer", fontFamily:T.font }}>
            Preview coach workspace →
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

function AuthScreen({ onSent, checkoutPending, onPreviewCoachWorkspace }) {
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
      const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
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
      {typeof onPreviewCoachWorkspace === "function" && (
        <button
          type="button"
          onClick={onPreviewCoachWorkspace}
          style={{
            width:"100%", marginTop:28, padding:"14px 16px", borderRadius:T.rsm,
            border:`1px solid rgba(200,144,42,0.45)`, background:"rgba(200,144,42,0.08)",
            color:T.gold, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:T.font,
          }}
        >
          See the coach workspace (demo) — no account needed
        </button>
      )}
      {typeof onPreviewCoachWorkspace === "function" && (
        <div style={{ fontSize:11, color:T.hint, textAlign:"center", marginTop:12, lineHeight:1.55, padding:"0 8px" }}>
          Sample clients &amp; session prep — same screen real coaches use. Consumer app preview is separate on the home flow.
        </div>
      )}
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
          Unlock Forged Pro.
        </h2>
        <p style={{ fontSize:14, color:T.sub, lineHeight:1.75, margin:"0 0 28px" }}>
          Unlimited AI coaching, unlimited habits, friend nudges, voice logging, and full history — <strong style={{ color:T.text }}>$4.99/month</strong>. Cancel anytime.
        </p>
        {error && <div style={{ fontSize:13, color:T.accent, marginBottom:12 }}>{error}</div>}
        <button onClick={handleCheckout} disabled={loading}
          style={{ width:"100%", padding:"15px 0", borderRadius:12, border:"none", background:T.gold, color:"#0F0F0D", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, fontFamily:T.font, marginBottom:12, transition:"opacity 0.15s" }}>
          {loading ? "Opening checkout…" : "Unlock Forged Pro — $4.99/month"}
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
        <div style={{ fontSize:11, fontWeight:600, color:"#C8902A", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Forged Pro unlocked</div>
        <h2 style={{ fontFamily:"'DM Serif Display',Georgia,serif", fontSize:28, color:"#F0EDE6", margin:"0 0 14px", lineHeight:1.2 }}>You're in.</h2>
        <p style={{ fontSize:14, color:"#A8A49C", lineHeight:1.75, margin:"0 0 28px" }}>
          Forged Pro is fully unlocked — unlimited AI coaching, full history, friend nudges, and everything we ship next. Now go build the thing.
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

const FORGED_FEEDBACK_EMAIL = "corbyn.miller2000@gmail.com";

/** Same mail path as Profile → Send quick feedback; optional lead-in line for context. */
function openForgedFeedbackMailto(leadInLine = "") {
  const lines = ["Hey Corbyn,", ""];
  if (leadInLine.trim()) lines.push(leadInLine.trim(), "");
  lines.push("Here's my feedback on Forged:", "", "");
  const href = `mailto:${FORGED_FEEDBACK_EMAIL}?subject=${encodeURIComponent("Forged Feedback")}&body=${encodeURIComponent(lines.join("\n"))}`;
  window.open(href, "_blank");
}

function forgedBetaEmailOptInKey(userId) {
  return userId ? `forged_beta_email_opt_in:${userId}` : "forged_beta_email_opt_in";
}

function readForgedBetaEmailOptIn(userId) {
  return localStorage.getItem(forgedBetaEmailOptInKey(userId)) === "1";
}

function writeForgedBetaEmailOptIn(userId, on) {
  try {
    localStorage.setItem(forgedBetaEmailOptInKey(userId), on ? "1" : "0");
  } catch (_) { /* quota / private mode */ }
}

/** One short step after WelcomeModal — thanks, feedback CTA, optional beta email list (local only until wired). */
function ProThankYouModal({ userId, onClose }) {
  const [betaUpdates, setBetaUpdates] = useState(() => readForgedBetaEmailOptIn(userId));

  function persistOptIn() {
    writeForgedBetaEmailOptIn(userId, betaUpdates);
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:2001, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}
      onClick={e => e.target === e.currentTarget && (persistOptIn(), onClose())}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:"#1C1C18", borderRadius:20, border:"0.5px solid rgba(200,144,42,0.35)", padding:"32px 26px 28px", maxWidth:340, width:"100%", textAlign:"center", animation:"paywallIn 0.45s cubic-bezier(0.22,1,0.36,1) both" }}>
        <div style={{ fontSize:11, fontWeight:600, color:"#C8902A", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Thank you</div>
        <h2 style={{ fontFamily:"'DM Serif Display',Georgia,serif", fontSize:22, color:"#F0EDE6", margin:"0 0 12px", lineHeight:1.25 }}>Thanks for backing the beta.</h2>
        <p style={{ fontSize:14, color:"#A8A49C", lineHeight:1.7, margin:"0 0 10px", textAlign:"left" }}>
          Tell us what would make Forged genuinely more useful for you.
        </p>
        <p style={{ fontSize:13, color:"#8A8680", lineHeight:1.65, margin:"0 0 22px", textAlign:"left" }}>
          If anything feels broken, confusing, or missing, we want to know.
        </p>

        <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", textAlign:"left", marginBottom:22, padding:"12px 14px", borderRadius:12, border:"0.5px solid rgba(200,144,42,0.2)", background:"rgba(200,144,42,0.06)" }}>
          <input
            type="checkbox"
            checked={betaUpdates}
            onChange={e => { const v = e.target.checked; setBetaUpdates(v); writeForgedBetaEmailOptIn(userId, v); }}
            style={{ marginTop:3, width:16, height:16, accentColor:"#C0392B", flexShrink:0, cursor:"pointer" }}
          />
          <span style={{ fontSize:12, color:"#C4C0B8", lineHeight:1.5 }}>
            <span style={{ color:"#E8E4DC", fontWeight:500 }}>Keep me updated</span>
            {" "}with Forged beta updates — occasional emails, not spam.
          </span>
        </label>

        <button
          type="button"
          onClick={() => { persistOptIn(); openForgedFeedbackMailto("I just unlocked Forged Pro."); onClose(); }}
          style={{ width:"100%", padding:"14px 0", borderRadius:12, border:"none", background:"#C0392B", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:10 }}
        >
          Send feedback
        </button>
        <button
          type="button"
          onClick={() => { persistOptIn(); onClose(); }}
          style={{ width:"100%", padding:"10px 0", borderRadius:12, border:"none", background:"none", color:"#8A8680", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}
        >
          Maybe later
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
          <div style={{ fontSize:40, marginBottom:18 }}>⚡</div>

          <div style={{ fontSize:11, fontWeight:600, color:T.gold, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>
            Forged Pro
          </div>

          <h1 style={{ fontFamily:T.serif, fontSize:26, color:T.text, margin:"0 0 14px", lineHeight:1.2 }}>
            Your AI coach. Unlimited.
          </h1>

          <p style={{ fontSize:14, color:T.sub, lineHeight:1.7, margin:"0 0 8px" }}>
            The coach reads your real logs and reflections to tell you why things aren't sticking — and what to do next.
          </p>
          <p style={{ fontSize:13, color:T.muted, lineHeight:1.6, margin:"0 0 24px" }}>
            Unlimited AI coaching, full history, friend nudges, and voice logging — <strong style={{ color:T.text }}>$4.99/month</strong>.
          </p>

          <button
            onClick={handleCheckout}
            disabled={loading}
            style={{ width:"100%", padding:"15px 0", borderRadius:12, border:"none", background:T.gold, color:"#0F0F0D", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, fontFamily:T.font, marginBottom:12, transition:"opacity 0.15s" }}
          >
            {loading ? "Opening checkout…" : "Unlock Forged Pro — $4.99/month"}
          </button>

          {error && (
            <p style={{ fontSize:12, color:"#e05c5c", margin:"0 0 10px", lineHeight:1.5 }}>{error}</p>
          )}

          <a
            href="/landing.html"
            style={{ display:"block", fontSize:13, color:T.muted, textDecoration:"none", padding:"8px 0" }}
          >
            Learn more →
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
  social: "Want to invite someone to hold you accountable on a specific habit?",
};
const COACH_NUDGE_DURATION_MS = 2800;

// ─── FIRST-TIME AI PAGE GUIDE ─────────────────────────────────────────────────
// The four pages that get a one-time guided bubble from the AI. Each is shown
// exactly once per user/device the first time they land on that screen, and
// stays visible until the user dismisses it or navigates away.
const PAGE_GUIDE_PAGES = ["today", "journal", "insights", "social"];

function pageGuideSeenKey(userId, page) {
  const u = userId || "anon";
  return `forged_ai_page_guide_seen:${u}:${page}`;
}
function readPageGuideSeen(userId, page) {
  try { return localStorage.getItem(pageGuideSeenKey(userId, page)) === "1"; }
  catch { return false; }
}
function writePageGuideSeen(userId, page) {
  try { localStorage.setItem(pageGuideSeenKey(userId, page), "1"); }
  catch { /* quota / private mode — fail silently */ }
}
function clearAllPageGuideSeen(userId) {
  try {
    for (const p of PAGE_GUIDE_PAGES) {
      localStorage.removeItem(pageGuideSeenKey(userId, p));
    }
  } catch { /* ignore */ }
}

/**
 * Build a short, warm, first-time guide message for a given page. Returns null
 * for unknown pages. Lightly personalized from the user's habits + goals so it
 * feels like a coach, not a read-me. Kept intentionally short (1–3 lines) and
 * purpose-forward: why the page matters, not just what's on it.
 */
function buildPageGuideMessage(page, { name, habits = [], goals = [] } = {}) {
  const who = name && String(name).trim() ? String(name).trim().split(/\s+/)[0] : "";
  const hi = who ? `Hey ${who} — ` : "";

  // Real logs only (ignore skips + quick notes) — keeps "logged today" honest.
  const realLogs = habits.flatMap(h =>
    (h.logs || []).filter(l => l && l.date && l.value !== "quicknote" && l.value !== "skip"),
  );
  const activeGoals = (goals || []).filter(g => !g.completedAt && !g.archivedAt);

  // Light personalization tags — checked in priority order. Non-exhaustive,
  // safe if habits is empty.
  const lowerNames = habits.map(h => String(h?.name || "").toLowerCase());
  const hasWeightGoal = activeGoals.some(g => {
    const t = String(g?.title || g?.name || "").toLowerCase();
    return t.includes("weight") || t.includes("kg") || t.includes("lb");
  }) || habits.some(h => h.habitType === "progress" || isLegacyProgressType(h.habitType));
  const hasGymOrStrength =
    lowerNames.some(n => /gym|lift|strength|workout|train|squat|bench|deadlift/.test(n)) ||
    activeGoals.some(g => /gym|lift|strength|workout|train/.test(String(g?.title || g?.name || "").toLowerCase()));
  const hasRun =
    lowerNames.some(n => /run|jog|5k|10k|marathon|cardio/.test(n)) ||
    activeGoals.some(g => /run|jog|5k|10k|marathon/.test(String(g?.title || g?.name || "").toLowerCase()));
  const hasReading =
    lowerNames.some(n => /read|book|pages/.test(n));
  const hasLimit = habits.some(h => h.habitType === "limit");
  const hasProject = habits.some(h => h.habitType === "project");
  const hasAnyHabits = habits.length > 0;
  const hasRichHistory = realLogs.length >= 7;

  // Pick a light personalization phrase (single clause, optional).
  let personalBit = "";
  if (hasWeightGoal)       personalBit = "your weight goal";
  else if (hasGymOrStrength) personalBit = "your training";
  else if (hasRun)           personalBit = "your running";
  else if (hasProject)       personalBit = "what you're building";
  else if (hasLimit)         personalBit = "the limits you set";
  else if (hasReading)       personalBit = "your reading";
  else if (activeGoals.length > 0) personalBit = "your goals";
  else if (hasAnyHabits)     personalBit = "the habits you picked";

  switch (page) {
    case "today": {
      if (!hasAnyHabits) {
        return `${hi}this is your Today page — where momentum actually happens. Add a habit or goal and tap the row to log it. One log today beats a perfect plan.`;
      }
      const tail = personalBit ? ` Small, daily reps on ${personalBit} are what compound.` : "";
      return `${hi}this is your Today page. Tap a row to log, hold to note, and keep the streak alive.${tail}`;
    }

    case "journal": {
      if (!hasRichHistory) {
        return `${hi}this is your Journal. Log a few days and this becomes the honest record of what you actually did — filter by habit, jump to a day, or read back reflections. It's how you catch what's really changing.`;
      }
      const tail = personalBit ? ` Great place to check how ${personalBit} has been going lately.` : "";
      return `${hi}this is your Journal — every entry, every reflection, searchable. Use the filters and view toggle to see what's actually been happening.${tail}`;
    }

    case "insights": {
      if (!hasRichHistory) {
        return `${hi}Insights is where patterns show up. Right now it'll feel quiet — keep logging for a week or two and streaks, heatmaps, and your best day of the week start to mean something.`;
      }
      const tail = personalBit ? ` Worth checking which days you actually show up for ${personalBit}.` : "";
      return `${hi}this is Insights. Streaks, 28-day rates, and deeper patterns live here.${tail} More signal the more you log.`;
    }

    case "social": {
      return `${hi}this is Social. Add a friend, share a goal, and you've got quiet accountability — you see their streaks, they see yours. Nudges keep each other honest on the days it's easy to ghost.`;
    }

    default:
      return null;
  }
}

// ─── COACH DASHBOARD ──────────────────────────────────────────────────────────
// Collapse per-habit last7 arrays into one combined "any logged" row
function mergedLast7(habits) {
  if (!habits || habits.length === 0)
    return Array(7).fill({ date:"", logged:false, skip:false });
  const base = habits[0].last7 || [];
  return base.map((day, i) => ({
    date:   day.date,
    logged: habits.some(h => h.last7[i]?.logged),
    skip:   !habits.some(h => h.last7[i]?.logged) && habits.some(h => h.last7[i]?.skip),
  }));
}

function ActivityDots({ last7, size = 9 }) {
  return (
    <div style={{ display:"flex", gap:3 }}>
      {(last7 || []).map((d, i) => (
        <div
          key={i}
          title={d.date}
          style={{
            width:size, height:size, borderRadius:2,
            background: d.logged ? "#27AE60" : d.skip ? "rgba(200,144,42,0.45)" : "rgba(255,255,255,0.08)",
          }}
        />
      ))}
    </div>
  );
}

// Thin progress bar — today's completion ratio
function CompletionBar({ done, total }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  const bar = done === total ? "#27AE60" : done > 0 ? T.gold : "rgba(255,255,255,0.08)";
  return (
    <div style={{ marginTop:6, height:3, background:"rgba(255,255,255,0.06)", borderRadius:2, overflow:"hidden" }}>
      <div style={{ width:`${pct}%`, height:"100%", background:bar, borderRadius:2, transition:"width 0.4s" }} />
    </div>
  );
}

// ── Local-timezone date helpers for the coach workspace ───────────────────────
// The coach-data API computes "today" in UTC (Vercel runs in UTC). Coaches in
// AEST/AEDT (UTC+10/11) are already on the next calendar day when UTC midnight
// hits. All "today / yesterday / X days ago" labels are therefore computed
// client-side from lastActiveDate so they always match the coach's local clock.

function localTodayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

/** Days since a YYYY-MM-DD string, using the browser's local timezone. */
function localDaysSince(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target     = new Date(y, m - 1, d).getTime();
  const n          = new Date();
  const todayMs    = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const diff       = todayMs - target;
  return diff < 0 ? 0 : Math.round(diff / 86400000);
}

function localIsToday(dateStr) { return localDaysSince(dateStr) === 0; }

// Per-row meta: accent colour + pill label. Always pass a LOCALLY-computed dsa.
function clientRowMeta(dsa) {
  if (dsa === null) return { accent: T.hint,    lastLabel: "Never logged" };
  if (dsa === 0)    return { accent: "#27AE60", lastLabel: "Active today" };
  if (dsa === 1)    return { accent: T.sub,     lastLabel: "Yesterday" };
  if (dsa === 2)    return { accent: T.gold,    lastLabel: "2 days ago" };
  if (dsa <= 5)     return { accent: T.amber,   lastLabel: `${dsa} days ago` };
  return              { accent: "#E74C3C", lastLabel: `${dsa} days quiet` };
}

// Single short observation about the client, using LOCAL date so timezone drift
// doesn't produce "logged everything today" for yesterday's logs.
function clientInsightLine(client) {
  const habits  = client.habits || [];
  const localDsa = localDaysSince(client.lastActiveDate);

  const streakHero = habits
    .filter(h => h && typeof h.streak === "number" && h.streak > 7)
    .sort((a, b) => b.streak - a.streak)[0];
  if (streakHero) return `🔥 ${streakHero.name} — ${streakHero.streak}-day streak`;

  if (localDsa === 0 && client.totalHabits > 0 && client.loggedTodayCount === client.totalHabits)
    return "✓ All habits logged today";
  if (localDsa === 0 && client.loggedTodayCount > 0)
    return `✓ ${client.loggedTodayCount}/${client.totalHabits} habits logged today`;
  if (localDsa !== null && localDsa > 1)
    return "No activity logged recently";
  if (client.bestStreak > 0) return `Best streak: ${client.bestStreak} days`;
  if (client.totalHabits > 0) return `${client.totalHabits} habit${client.totalHabits === 1 ? "" : "s"} tracked`;
  return "No habits set up yet";
}

// Card for one client in the coach list. The whole row is a button; tap opens
// the detail panel. `accent` (passed in by parent) overrides the auto-derived
// colour so the urgency group can colour-coordinate even when a client could
// fit multiple buckets (e.g. a brand-new but inactive client).
function CoachClientRow({ client, onClick, accent: accentOverride, animationDelayMs = 0, badge }) {
  // Use local-timezone dsa so the pill always reflects the coach's local date.
  const localDsa = localDaysSince(client.lastActiveDate);
  const meta = clientRowMeta(localDsa !== null ? localDsa : client.daysSinceActive);
  const accent = accentOverride || meta.accent;
  const insight = clientInsightLine(client);
  return (
    <button
      onClick={onClick}
      style={{
        width:"100%", textAlign:"left", cursor:"pointer", fontFamily:T.font, display:"block",
        background:T.surface, borderRadius:12, padding:"13px 14px 12px", marginBottom:8,
        borderTop:`1px solid rgba(255,255,255,0.06)`,
        borderRight:`1px solid rgba(255,255,255,0.06)`,
        borderBottom:`1px solid rgba(255,255,255,0.06)`,
        borderLeft:`3px solid ${accent}`,
        boxShadow:"0 1px 0 rgba(0,0,0,0.18)",
        animation: `coachRowIn 0.42s ${animationDelayMs}ms cubic-bezier(0.22,1,0.36,1) both`,
        transition: "transform 0.15s ease",
      }}
    >
      {/* Name row */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:7, minWidth:0, flex:1 }}>
          <span style={{ fontSize:17, fontWeight:600, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {client.name}
          </span>
          {badge && (
            <span style={{
              fontSize:9, fontWeight:700, color:"#1a1a16",
              background:T.gold, padding:"2px 7px", borderRadius:6,
              letterSpacing:"0.06em", flexShrink:0,
            }}>
              {badge}
            </span>
          )}
          {client.isPro && (
            <span style={{ fontSize:9, fontWeight:700, color:T.gold, background:"rgba(200,144,42,0.15)", padding:"2px 6px", borderRadius:6, flexShrink:0 }}>PRO</span>
          )}
        </div>
        <span style={{
          flexShrink:0,
          fontSize:11, fontWeight:600,
          color: meta.accent,
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${meta.accent}33`,
          padding: "3px 9px",
          borderRadius: 999,
          letterSpacing: "0.01em",
        }}>
          {meta.lastLabel}
        </span>
      </div>

      {/* Insight + chevron row */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
        <span style={{
          fontSize:12, color:T.sub, fontStyle:"italic", lineHeight:1.5,
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          minWidth:0, flex:1,
        }}>
          {insight}
        </span>
        <span style={{ fontSize:16, color:T.hint, lineHeight:1, flexShrink:0 }}>→</span>
      </div>
    </button>
  );
}


// ─── COACH WORKSPACE ──────────────────────────────────────────────────────────
// Separate shell — replaces the consumer nav for is_coach accounts.
// Admin can preview via dev tools but never loses their own consumer app.

function buildSessionBrief(client) {
  const items = [];
  const { habits = [], loggedTodayCount, totalHabits, lastActiveDate } = client;

  // Use locally-computed dsa so timezone drift doesn't mislabel yesterday as today.
  const localDsa    = localDaysSince(lastActiveDate);
  const isToday     = localDsa === 0;
  const isYesterday = localDsa === 1;

  if (totalHabits > 0) {
    if (isToday && loggedTodayCount === totalHabits)
      items.push({ icon:"✅", text:`All ${totalHabits} habits logged today` });
    else if (isToday && loggedTodayCount > 0)
      items.push({ icon:"📋", text:`${loggedTodayCount}/${totalHabits} habits logged so far today` });
    else if (isToday)
      items.push({ icon:"⏰", text:"Not yet logged today — session is a good prompt" });
    else if (isYesterday)
      items.push({ icon:"📅", text:"Last logged yesterday — not yet active today" });
    else if (localDsa !== null && localDsa > 1)
      items.push({ icon:"⏰", text:`${localDsa} days since last activity — worth checking in on` });
    else
      items.push({ icon:"🔵", text:"No activity logged yet" });
  }

  const streakHabit = [...habits].sort((a, b) => b.streak - a.streak)[0];
  if (streakHabit && streakHabit.streak >= 3) {
    items.push({ icon:"🔥", text:`${streakHabit.emoji || ""} ${streakHabit.name} · ${streakHabit.streak}-day streak — ask about momentum` });
  }

  // Habits not logged recently (use local date for gap calc).
  const gapHabits = habits.filter(h => {
    if (isToday && h.loggedToday) return false;
    if (!h.lastLogDate) return true;
    return (localDaysSince(h.lastLogDate) ?? 0) >= 3;
  });
  for (const h of gapHabits.slice(0, 2)) {
    const days = h.lastLogDate ? localDaysSince(h.lastLogDate) : null;
    items.push({ icon:"⚠️", text:`${h.emoji || ""} ${h.name} — ${days ? `${days}d since last log` : "never logged"} — worth checking in on` });
  }

  const noteHabit = habits.find(h => h.recentNote);
  if (noteHabit) {
    const note = noteHabit.recentNote.length > 70 ? noteHabit.recentNote.slice(0,70)+"…" : noteHabit.recentNote;
    items.push({ icon:"💬", text:`Latest note: "${note}"` });
  }

  return items;
}

/** Valid UUID for coach-summary API — demo/preview clients use non-UUID ids. */
const COACH_SUMMARY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convincing sample AI brief for preview/demo clients (no API).
 * Mirrors the tone of coach-summary — session-focused, specific, coach-native.
 */
function previewAiBriefFromClient(client) {
  const first = String(client.name || "They").split(/\s+/)[0];
  const out = [];
  const localDsa = localDaysSince(client.lastActiveDate);
  const habits = client.habits || [];

  if (localDsa === 0) {
    if (client.totalHabits > 0 && client.loggedTodayCount === client.totalHabits)
      out.push(`${first} is fully logged today — lead with recognition, then ask what felt hardest (wins often hide friction).`);
    else if (client.loggedTodayCount > 0)
      out.push(`Partial day (${client.loggedTodayCount}/${client.totalHabits} habits). Ask what shifted their routine before you troubleshoot.`);
    else
      out.push(`${first} hasn't logged yet today. Keep the opener light — energy, schedule, or avoidance — stay curious, not corrective.`);
  } else if (localDsa === 1) {
    out.push(`Last seen yesterday — check how today landed before you dive into the dashboard.`);
  } else if (localDsa !== null && localDsa >= 3) {
    out.push(`${localDsa} days quiet — assume life load first. "What's been taking bandwidth?" beats a habit lecture.`);
  } else {
    out.push(`Sparse history — use the session to align on what a strong week looks like for them.`);
  }

  const topStreak = [...habits].filter(h => (h.streak || 0) >= 3).sort((a, b) => (b.streak || 0) - (a.streak || 0))[0];
  if (topStreak) {
    out.push(`Strongest thread: ${topStreak.name} (${topStreak.streak}d) — ask what made sticking with it easier than they expected.`);
  }

  const gap = habits.filter(h => {
    if (localDsa === 0 && h.loggedToday) return false;
    const hd = h.lastLogDate ? localDaysSince(h.lastLogDate) : null;
    return hd === null || hd >= 3;
  }).slice(0, 2);
  for (const h of gap) {
    const hd = h.lastLogDate ? localDaysSince(h.lastLogDate) : null;
    out.push(`${h.name} has gone quiet${hd != null ? ` (${hd}d)` : ""} — worth a light check-in before you problem-solve.`);
  }

  const withNote = habits.find(h => h.recentNote && String(h.recentNote).trim());
  if (withNote) {
    const raw = String(withNote.recentNote);
    const snip = raw.length > 100 ? `${raw.slice(0, 100)}…` : raw;
    out.push(`They left this on ${withNote.name}: "${snip}" — bring it up early.`);
  }

  if (out.length < 4) {
    out.push(`Session closer idea: "What would make next week feel a little lighter?"`);
  }
  return out.slice(0, 5);
}

function CoachClientDetail({ client, onBack, useLocalAiBrief = false }) {
  const [detailTab, setDetailTab] = useState("brief"); // "brief" | "habits"
  const brief = buildSessionBrief(client);
  const localDsa = localDaysSince(client.lastActiveDate);
  const lastSeenLabel = localDsa === null ? "never active"
    : localDsa === 0 ? "active today"
    : localDsa === 1 ? "last seen yesterday"
    : `last seen ${localDsa}d ago`;

  // ── AI session-prep brief ──────────────────────────────────────────────
  // Fetched on mount and on the refresh button. Renders below the
  // client-side `brief` so the coach gets both the deterministic facts and
  // the model's short take. We don't auto-retry on error — the coach can
  // hit the refresh button. Aborts in-flight if the component unmounts.
  const [aiBullets, setAiBullets]   = useState(null);  // string[] | null
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiErr, setAiErr]           = useState(null);

  const refreshAiBrief = useCallback(async () => {
    if (useLocalAiBrief) {
      setAiLoading(false);
      setAiErr(null);
      setAiBullets(previewAiBriefFromClient(client));
      return;
    }
    setAiLoading(true);
    setAiErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch(`/api/coach-summary?clientId=${encodeURIComponent(client.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load summary");
      setAiBullets(Array.isArray(json.summary) ? json.summary : []);
    } catch (e) {
      if (e.name === "AbortError") return;
      setAiErr(e.message);
    } finally {
      setAiLoading(false);
    }
  }, [client, useLocalAiBrief]);

  useEffect(() => {
    if (useLocalAiBrief) {
      setAiLoading(false);
      setAiErr(null);
      setAiBullets(previewAiBriefFromClient(client));
      return;
    }
    const ctrl = new AbortController();
    setAiBullets(null);
    setAiLoading(true);
    setAiErr(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");
        const res = await fetch(`/api/coach-summary?clientId=${encodeURIComponent(client.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not load summary");
        if (!ctrl.signal.aborted) setAiBullets(Array.isArray(json.summary) ? json.summary : []);
      } catch (e) {
        if (e.name === "AbortError") return;
        if (!ctrl.signal.aborted) setAiErr(e.message);
      } finally {
        if (!ctrl.signal.aborted) setAiLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [client, useLocalAiBrief]);

  const tabBtn = (id, label) => (
    <button
      key={id}
      onClick={() => setDetailTab(id)}
      style={{
        flex:1, padding:"9px 0", background:"none", border:"none",
        borderBottom: detailTab === id ? `2px solid ${T.gold}` : "2px solid transparent",
        color: detailTab === id ? T.text : T.muted,
        fontSize:13, fontWeight: detailTab === id ? 600 : 400,
        cursor:"pointer", fontFamily:T.font, letterSpacing:"0.01em",
        transition:"color 0.15s, border-color 0.15s",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ paddingBottom:40 }}>
      {/* Back nav */}
      <button onClick={onBack} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", padding:"14px 16px 10px", fontFamily:T.font }}>
        ← All clients
      </button>

      {/* Client identity strip */}
      <div style={{ padding:"0 16px 16px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:3 }}>
          <span style={{ fontSize:22, fontWeight:700, color:T.text }}>{client.name}</span>
          {client.isPro && <span style={{ fontSize:9, fontWeight:700, color:T.gold, background:"rgba(200,144,42,0.15)", padding:"2px 7px", borderRadius:8 }}>PRO</span>}
        </div>
        {client.email && <div style={{ fontSize:12, color:T.muted, marginBottom:3 }}>{client.email}</div>}
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{
            fontSize:11, fontWeight:600, padding:"2px 9px", borderRadius:99,
            background: localDsa === 0 ? "rgba(39,174,96,0.12)" : localDsa === 1 ? "rgba(255,255,255,0.05)" : "rgba(231,76,60,0.1)",
            color: localDsa === 0 ? "#27AE60" : localDsa === 1 ? T.sub : "#E74C3C",
            border: `1px solid ${localDsa === 0 ? "rgba(39,174,96,0.3)" : localDsa === 1 ? T.border : "rgba(231,76,60,0.25)"}`,
          }}>
            {lastSeenLabel}
          </span>
          <span style={{ fontSize:11, color:T.hint }}>
            {client.xp} xp · joined {client.joinedAt ? new Date(client.joinedAt).toLocaleDateString("en-AU", { month:"short", year:"numeric" }) : "—"}
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", borderBottom:`0.5px solid ${T.border}`, padding:"0 16px" }}>
        {tabBtn("brief", "Session brief")}
        {tabBtn("habits", `Habits (${client.habits.length})`)}
      </div>

      {/* ── SESSION BRIEF TAB ─────────────────────────────────────────────── */}
      {detailTab === "brief" && (
        <div style={{ padding:"16px 16px 0" }}>

          {/* Situation snapshot */}
          <div style={{ background:T.surface, borderRadius:14, padding:"14px 16px", marginBottom:12, border:`1px solid rgba(255,255,255,0.06)` }}>
            <div style={{ fontSize:10, fontWeight:700, color:T.gold, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:11 }}>
              Situation snapshot
            </div>
            {brief.length === 0
              ? <div style={{ fontSize:12, color:T.muted, fontStyle:"italic" }}>No data yet — ask them to log their first habit in this session.</div>
              : brief.map((item, i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom: i < brief.length-1 ? 9 : 0 }}>
                  <span style={{ fontSize:13, flexShrink:0, lineHeight:1.5 }}>{item.icon}</span>
                  <span style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{item.text}</span>
                </div>
              ))
            }
          </div>

          {/* AI pre-session brief */}
          <div style={{
            background:"linear-gradient(145deg, rgba(200,144,42,0.07) 0%, rgba(200,144,42,0.02) 100%)",
            border:`1px solid rgba(200,144,42,0.22)`,
            borderRadius:14, padding:"14px 16px", marginBottom:12,
          }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                <span style={{ fontSize:10, fontWeight:700, color:T.gold, textTransform:"uppercase", letterSpacing:"0.07em" }}>AI pre-session brief</span>
                <span style={{ fontSize:9, fontWeight:700, color:T.gold, background:"rgba(200,144,42,0.15)", padding:"1px 6px", borderRadius:6 }}>BETA</span>
                {useLocalAiBrief && (
                  <span style={{ fontSize:9, fontWeight:700, color:"#1a1a16", background:T.sub, padding:"1px 6px", borderRadius:6 }}>PREVIEW</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { if (!aiLoading) void refreshAiBrief(); }}
                disabled={aiLoading}
                style={{
                  display:"flex", alignItems:"center", gap:4,
                  background:"rgba(255,255,255,0.05)", border:`1px solid rgba(255,255,255,0.07)`,
                  borderRadius:8, padding:"4px 10px",
                  fontSize:10, fontWeight:600, color: aiLoading ? T.muted : T.sub,
                  cursor: aiLoading ? "default" : "pointer", fontFamily:T.font,
                }}
              >
                <span style={{ fontSize:11, display:"inline-block", animation: aiLoading ? "coachRefreshSpin 1.1s linear infinite" : "none" }}>↻</span>
                {aiLoading ? "Generating…" : "Refresh"}
              </button>
            </div>

            {/* Loading shimmer */}
            {aiLoading && aiBullets === null && (
              <div style={{ fontSize:12, color:T.muted, fontStyle:"italic", lineHeight:1.6 }}>
                Reading {client.name}&apos;s last 14 days of data…
              </div>
            )}

            {/* Graceful error — no red, no technical message */}
            {aiErr && !aiLoading && (
              <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>
                Brief unavailable right now — tap Refresh to try again.
              </div>
            )}

            {/* Empty result */}
            {!aiErr && aiBullets && aiBullets.length === 0 && (
              <div style={{ fontSize:12, color:T.muted, fontStyle:"italic", lineHeight:1.6 }}>
                Not enough logging data yet for a useful brief. Check back after a few sessions.
              </div>
            )}

            {/* Bullets */}
            {!aiErr && aiBullets && aiBullets.length > 0 && aiBullets.map((b, i) => (
              <div key={i} style={{ display:"flex", gap:10, marginBottom: i < aiBullets.length-1 ? 9 : 0 }}>
                <span style={{ fontSize:14, color:T.gold, flexShrink:0, lineHeight:1.4 }}>›</span>
                <span style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{b}</span>
              </div>
            ))}
          </div>

          {/* 7-day activity grid */}
          {client.habits.length > 0 && (() => {
            const merged = client.habits[0]?.last7 ? client.habits[0].last7.map((day, i) => ({
              date: day.date,
              logged: client.habits.some(h => h.last7?.[i]?.logged),
              skip:   !client.habits.some(h => h.last7?.[i]?.logged) && client.habits.some(h => h.last7?.[i]?.skip),
            })) : [];
            return merged.length > 0 ? (
              <div style={{ background:T.surface, borderRadius:14, padding:"12px 16px", marginBottom:12, border:`1px solid rgba(255,255,255,0.06)` }}>
                <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>
                  Last 7 days
                </div>
                <div style={{ display:"flex", gap:6, justifyContent:"space-between" }}>
                  {merged.map((day, i) => {
                    const isT = localIsToday(day.date);
                    const bg  = day.logged ? "#27AE60" : day.skip ? T.amber : "rgba(255,255,255,0.07)";
                    const dow = day.date ? new Date(day.date+"T00:00:00").toLocaleDateString("en-AU",{weekday:"short"}).slice(0,1) : "";
                    return (
                      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                        <div style={{ fontSize:9, color: isT ? T.gold : T.hint, fontWeight: isT ? 700 : 400 }}>{dow}</div>
                        <div style={{ width:"100%", aspectRatio:"1", borderRadius:5, background:bg, border: isT ? `1.5px solid ${T.gold}` : "none" }}/>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* ── HABITS TAB ────────────────────────────────────────────────────── */}
      {detailTab === "habits" && (
        <div style={{ padding:"16px 16px 0" }}>
          {client.habits.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.muted, fontSize:13 }}>
              <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
              No habits set up yet.
            </div>
          ) : (
            <div style={{ background:T.surface, borderRadius:14, overflow:"hidden", border:`1px solid rgba(255,255,255,0.06)` }}>
              {client.habits.map((h, i) => {
                const hDsa = localDaysSince(h.lastLogDate);
                const isLoggedToday = localIsToday(h.lastLogDate);
                return (
                  <div key={i} style={{ padding:"13px 16px", borderBottom: i < client.habits.length-1 ? `1px solid rgba(255,255,255,0.05)` : "none" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                      <span style={{ fontSize:13, color: isLoggedToday ? T.text : T.sub, fontWeight: isLoggedToday ? 600 : 400, display:"flex", alignItems:"center", gap:5 }}>
                        {h.emoji} {h.name}
                        {isLoggedToday && <span style={{ color:"#27AE60", fontSize:11 }}>✓</span>}
                      </span>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {h.streak > 0 && <span style={{ fontSize:11, color:T.gold }}>🔥 {h.streak}d</span>}
                        {hDsa !== null && hDsa > 1 && (
                          <span style={{ fontSize:10, color: hDsa > 3 ? "#E74C3C" : T.muted }}>{hDsa}d ago</span>
                        )}
                      </div>
                    </div>
                    <ActivityDots last7={h.last7} size={10} />
                    {h.recentNote && (
                      <div style={{ fontSize:11, color:T.muted, fontStyle:"italic", marginTop:7, lineHeight:1.5, paddingLeft:2 }}>
                        &ldquo;{h.recentNote.length > 100 ? h.recentNote.slice(0,100)+"…" : h.recentNote}&rdquo;
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Subscribe screen shown inside CoachApp when the user is flagged is_coach
// but has no active coach subscription (coach_tier IS NULL). Admins bypass.
// One plan only: "coach" at $49/month, up to 15 active clients.
function CoachPaywall() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function startCheckout() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setErr("Not signed in"); setBusy(false); return; }
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: "coach" }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        setErr(json.error || "Could not start checkout");
        setBusy(false);
        return;
      }
      window.location.href = json.url;
    } catch (e) {
      setErr(e.message || "Checkout failed");
      setBusy(false);
    }
  }

  return (
    <div style={{ padding:"32px 16px 48px" }}>
      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <div style={{ fontSize:11, fontWeight:700, color:T.gold, letterSpacing:"0.08em", marginBottom:10 }}>
          FORGED COACH
        </div>
        <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, lineHeight:1.2, marginBottom:10 }}>
          Your clients' habits,<br/>before every session.
        </div>
        <div style={{ fontSize:13, color:T.muted, lineHeight:1.6, maxWidth:320, margin:"0 auto" }}>
          See who's building momentum, who's going quiet, and what's worth asking — without chasing anyone for an update.
        </div>
        <div style={{ fontSize:12, color:T.sub, lineHeight:1.65, maxWidth:340, margin:"16px auto 0", padding:"12px 14px", background:"rgba(255,255,255,0.04)", borderRadius:12, border:`0.5px solid ${T.border}` }}>
          <strong style={{ color:T.text }}>Why you&apos;re seeing this:</strong> your account is already tagged as a coach in Forged. After you subscribe, Stripe keeps your coach access active. If checkout fails, contact support — we don&apos;t sell this plan without the coach flag on your profile.
        </div>
      </div>

      {/* Plan card */}
      <div style={{
        background:"linear-gradient(180deg, rgba(200,144,42,0.1), rgba(200,144,42,0.03))",
        border:`1px solid rgba(200,144,42,0.3)`,
        borderRadius:18, padding:"22px 20px 20px", marginBottom:12,
      }}>
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:6 }}>
          <div style={{ fontSize:16, fontWeight:700, color:T.text }}>Forged Coach</div>
          <div>
            <span style={{ fontSize:24, fontWeight:700, color:T.text }}>$49</span>
            <span style={{ fontSize:12, color:T.muted, marginLeft:3 }}>/month</span>
          </div>
        </div>
        <div style={{ fontSize:12, color:T.muted, marginBottom:16 }}>Up to 15 active clients · cancel any time</div>
        <ul style={{ listStyle:"none", padding:0, margin:"0 0 18px 0" }}>
          {[
            "Client list with live habit data",
            "7-day activity grids per client",
            "Pre-session brief — who's on track, who's not, what to ask",
            "Invite clients via a shareable link",
            "Streak and gap detection across every habit",
          ].map((f, i) => (
            <li key={i} style={{ display:"flex", gap:10, marginBottom:8 }}>
              <span style={{ color:T.gold, fontSize:12, flexShrink:0, marginTop:1 }}>✓</span>
              <span style={{ fontSize:12, color:T.sub, lineHeight:1.5 }}>{f}</span>
            </li>
          ))}
        </ul>

        {err && (
          <div style={{ background:"rgba(231,76,60,0.12)", color:"#E74C3C", padding:"9px 12px", borderRadius:8, fontSize:12, marginBottom:12, textAlign:"center" }}>
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={startCheckout}
          disabled={busy}
          style={{
            width:"100%", padding:"13px 14px", borderRadius:12, border:"none",
            background: busy ? "rgba(200,144,42,0.4)" : T.gold,
            color:"#1a1a16", fontSize:14, fontWeight:700,
            cursor: busy ? "default" : "pointer", fontFamily:T.font,
            transition:"background 0.15s",
          }}
        >
          {busy ? "Opening Stripe…" : "Subscribe — $49/month"}
        </button>
      </div>

      <div style={{ fontSize:11, color:T.muted, textAlign:"center", lineHeight:1.6 }}>
        Secure checkout via Stripe · cancel any time from your account
      </div>
    </div>
  );
}

// Time-of-day greeting used in the coach header. Boundaries are deliberately
// blunt (12 / 17) — anything fancier (sunrise, weekday-vs-weekend) buys
// nothing for an internal dashboard greeting.
function coachGreetingForNow(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

// Section label used between urgency groups in the coach client list. Renders
// as: "NEEDS ATTENTION  (3) ──────────────────────────────"
function CoachSectionLabel({ label, count, anchorRef }) {
  return (
    <div ref={anchorRef} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, marginTop:4 }}>
      <span style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.1em", flexShrink:0 }}>
        {label}
      </span>
      <span style={{
        fontSize:10, fontWeight:700, color:T.hint,
        background:T.surface, border:`1px solid ${T.border}`,
        borderRadius:999, padding:"1px 8px", flexShrink:0,
      }}>
        {count}
      </span>
      <span style={{ flex:1, height:1, background:T.border, borderRadius:1 }} />
    </div>
  );
}

// ── Demo clients for preview mode (admin/dev account only) ─────────────────
// Shown when isPreview=true and there are no real clients yet.
// Covers all three urgency buckets so the dashboard looks alive.
function _demoLast7(pattern) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return { date: d.toISOString().slice(0, 10), logged: pattern[i], skip: false };
  });
}

const DEMO_CLIENTS = [
  {
    id: "demo-sarah",
    name: "Sarah K.",
    email: "sarah@example.com",
    xp: 1840,
    isPro: true,
    joinedAt: new Date(Date.now() - 21 * 86400000).toISOString(),
    lastActiveDate: new Date().toISOString().slice(0, 10),
    daysSinceActive: 0,
    totalHabits: 4,
    loggedTodayCount: 3,
    habits: [
      { name: "Morning run", emoji: "🏃", streak: 11, lastLogDate: new Date().toISOString().slice(0, 10), loggedToday: true,
        recentNote: "Felt slow but pushed through. 4.2km done.", last7: _demoLast7([true,true,false,true,true,true,true]) },
      { name: "No alcohol", emoji: "🚫", streak: 18, lastLogDate: new Date().toISOString().slice(0, 10), loggedToday: true,
        recentNote: null, last7: _demoLast7([true,true,true,true,true,true,true]) },
      { name: "Journalling", emoji: "📓", streak: 4, lastLogDate: new Date().toISOString().slice(0, 10), loggedToday: true,
        recentNote: "Wrote about feeling stuck at work. Helpful.", last7: _demoLast7([false,true,true,false,true,true,true]) },
      { name: "Cold shower", emoji: "🚿", streak: 2, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([false,false,true,false,false,true,false]) },
    ],
  },
  {
    id: "demo-marcus",
    name: "Marcus T.",
    email: "marcus@example.com",
    xp: 920,
    isPro: true,
    joinedAt: new Date(Date.now() - 42 * 86400000).toISOString(),
    lastActiveDate: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
    daysSinceActive: 5,
    totalHabits: 3,
    loggedTodayCount: 0,
    habits: [
      { name: "Gym", emoji: "🏋️", streak: 0, lastLogDate: new Date(Date.now()-5*86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: "Work's been mad this week, couldn't make it in.", last7: _demoLast7([true,true,true,false,false,false,false]) },
      { name: "Meal prep", emoji: "🥗", streak: 0, lastLogDate: new Date(Date.now()-5*86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([true,false,true,false,false,false,false]) },
      { name: "8hrs sleep", emoji: "😴", streak: 0, lastLogDate: new Date(Date.now()-6*86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([false,true,false,false,false,false,false]) },
    ],
  },
  {
    id: "demo-jamie",
    name: "Jamie R.",
    email: "jamie@example.com",
    xp: 240,
    isPro: true,
    joinedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    lastActiveDate: new Date().toISOString().slice(0, 10),
    daysSinceActive: 0,
    totalHabits: 2,
    loggedTodayCount: 2,
    habits: [
      { name: "Walk 10k steps", emoji: "🚶", streak: 2, lastLogDate: new Date().toISOString().slice(0,10), loggedToday: true,
        recentNote: "Just getting started!", last7: _demoLast7([false,false,false,false,false,true,true]) },
      { name: "No phone before 9am", emoji: "📵", streak: 2, lastLogDate: new Date().toISOString().slice(0,10), loggedToday: true,
        recentNote: null, last7: _demoLast7([false,false,false,false,false,true,true]) },
    ],
  },
  {
    id: "demo-alex",
    name: "Alex W.",
    email: "alex@example.com",
    xp: 3200,
    isPro: true,
    joinedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    lastActiveDate: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
    daysSinceActive: 1,
    totalHabits: 5,
    loggedTodayCount: 0,
    habits: [
      { name: "Meditation", emoji: "🧘", streak: 22, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: "20 mins this morning, really focused.", last7: _demoLast7([true,true,true,true,true,true,false]) },
      { name: "Read 30 mins", emoji: "📚", streak: 8, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([false,true,true,false,true,true,false]) },
      { name: "No sugar", emoji: "🍬", streak: 4, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: "Cravings bad on Friday but held it.", last7: _demoLast7([true,false,false,true,true,true,false]) },
      { name: "Gym", emoji: "🏋️", streak: 0, lastLogDate: new Date(Date.now()-3*86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([true,false,false,false,false,false,false]) },
      { name: "Gratitude", emoji: "🙏", streak: 22, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([true,true,true,true,true,true,false]) },
    ],
  },
  {
    id: "demo-priya",
    name: "Priya S.",
    email: "priya@example.com",
    xp: 60,
    isPro: true,
    joinedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    lastActiveDate: null,
    daysSinceActive: null,
    totalHabits: 3,
    loggedTodayCount: 0,
    habits: [
      { name: "Morning yoga", emoji: "🧘", streak: 0, lastLogDate: null, loggedToday: false,
        recentNote: null, last7: _demoLast7([false,false,false,false,false,false,false]) },
      { name: "Water intake", emoji: "💧", streak: 0, lastLogDate: null, loggedToday: false,
        recentNote: null, last7: _demoLast7([false,false,false,false,false,false,false]) },
      { name: "Evening walk", emoji: "🌇", streak: 0, lastLogDate: null, loggedToday: false,
        recentNote: null, last7: _demoLast7([false,false,false,false,false,false,false]) },
    ],
  },
];

function CoachApp({ onExit, isPreview, publicPreview, coachTier, isAdmin, coachOwnName }) {
  const [coachTab,       setCoachTab]       = useState("clients"); // "clients" | "you"
  const [coachScreen,    setCoachScreen]    = useState("list");
  const [selectedClient, setSelectedClient] = useState(null);
  const [data,           setData]           = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [err,            setErr]            = useState(null);
  const [coachUserId,    setCoachUserId]    = useState(null);
  const [inviteCopied,   setInviteCopied]   = useState(false);
  const [loadTimedOut,    setLoadTimedOut]   = useState(false);
  // Dismissed "X just joined" banners — keyed by client id so refetching
  // doesn't reanimate something the coach already acknowledged.
  const [dismissedToasts, setDismissedToasts] = useState(() => new Set());
  const attentionAnchorRef = useRef(null);

  const showPaywall = !isAdmin && !isPreview && !coachTier;

  useEffect(() => {
    let cancelled = false;
    let abortCtl = null;
    let timeoutId = null;

    (async () => {
      setLoadTimedOut(false);
      // Auth-screen public demo: never wait on coach-data (avoids hung fetch + ghost session issues).
      if (publicPreview) {
        setCoachUserId(null);
        setData({ clients: [], asOf: localTodayYmd() });
        setErr(null);
        setLoading(false);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          setCoachUserId(null);
          if (showPaywall) { if (!cancelled) setLoading(false); return; }
          if (isPreview) {
            if (!cancelled) {
              setData({ clients: [], asOf: localTodayYmd() });
              setErr(null);
              setLoading(false);
            }
            return;
          }
          if (!cancelled) { setErr("Not signed in"); setLoading(false); }
          return;
        }
        if (!cancelled) setCoachUserId(session.user?.id || null);
        if (showPaywall) { if (!cancelled) setLoading(false); return; }

        // Preview (signed-in): bounded fetch — fall back to demo clients on timeout or error.
        if (isPreview) {
          abortCtl = new AbortController();
          timeoutId = setTimeout(() => {
            abortCtl.abort();
            if (!cancelled) setLoadTimedOut(true);
          }, 12000);
          try {
            const res = await fetch("/api/coach-data", {
              headers: { Authorization: `Bearer ${token}` },
              signal: abortCtl.signal,
            });
            clearTimeout(timeoutId);
            timeoutId = null;
            const json = await res.json().catch(() => ({}));
            if (!cancelled) {
              if (res.ok) {
                setData(json);
                setErr(null);
              } else {
                setData({ clients: [], asOf: localTodayYmd() });
                setErr(null);
              }
              setLoading(false);
            }
          } catch (e) {
            clearTimeout(timeoutId);
            timeoutId = null;
            if (!cancelled) {
              setData({ clients: [], asOf: localTodayYmd() });
              setErr(null);
              setLoading(false);
            }
          }
          return;
        }

        const res = await fetch("/api/coach-data", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok) { setErr(json.error || "Failed to load"); setLoading(false); return; }
          setData(json);
        }
      } catch (e) {
        if (!cancelled) {
          if (isPreview) {
            setData({ clients: [], asOf: localTodayYmd() });
            setErr(null);
          } else setErr(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (abortCtl) abortCtl.abort();
    };
  }, [showPaywall, isPreview, publicPreview]);

  const inviteLink = coachUserId
    ? `https://forged-sage.vercel.app/?coach=${btoa(coachUserId)}`
    : null;

  // Short 8-char code derived from coach UUID — for existing users to join via Profile.
  // Formatted as ABCD-1234 for readability. Looked up by prefix in the DB.
  const coachCode = coachUserId
    ? coachUserId.replace(/-/g, "").slice(0, 8).toUpperCase()
    : null;
  const coachCodeFormatted = coachCode ? `${coachCode.slice(0,4)}-${coachCode.slice(4,8)}` : null;

  function copyInviteLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    });
  }

  const realClients = data?.clients ?? [];
  // Public demo or preview with no roster: show packaged demo clients.
  const useDemoClients = publicPreview || (isPreview && realClients.length === 0);
  const clients = useDemoClients ? DEMO_CLIENTS : realClients;

  // ── Bucket clients into urgency groups ─────────────────────────────────
  // A client can fit several buckets — pick once, in priority order, so each
  // client appears in exactly one section and the totals add up.
  const now = Date.now();
  const HOURS_72 = 72 * 60 * 60 * 1000;
  const DAYS_7   = 7  * 24 * 60 * 60 * 1000;
  const DAY_24H  = 24 * 60 * 60 * 1000;

  const needsAttention = [];
  const newClients     = [];
  const activeWeek     = [];

  for (const c of clients) {
    // Use LOCAL dsa so AU coaches don't see "Active today" for yesterday's logs.
    const localDsa      = localDaysSince(c.lastActiveDate);
    const dsa           = localDsa !== null ? localDsa : c.daysSinceActive;
    const joinedTs      = c.joinedAt ? new Date(c.joinedAt).getTime() : null;
    const joinedRecently72h = joinedTs !== null && (now - joinedTs) <= HOURS_72;
    const joinedThisWeek    = joinedTs !== null && (now - joinedTs) <= DAYS_7;
    const isQuiet       = dsa === null ? true : dsa >= 3;
    const hasNeverLogged = dsa === null;

    if (isQuiet || (joinedRecently72h && hasNeverLogged)) {
      needsAttention.push(c);
    } else if (joinedThisWeek) {
      newClients.push(c);
    } else {
      activeWeek.push(c);
    }
  }

  needsAttention.sort((a, b) => {
    const da = localDaysSince(a.lastActiveDate) ?? 999;
    const db = localDaysSince(b.lastActiveDate) ?? 999;
    return db - da;
  });
  newClients.sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0));
  activeWeek.sort((a, b) => {
    const da = localDaysSince(a.lastActiveDate) ?? 0;
    const db = localDaysSince(b.lastActiveDate) ?? 0;
    return da - db;
  });

  // Subtitle — active = logged in last 7 days (local).
  const activeThisWeekCount = clients.filter(c => {
    const d = localDaysSince(c.lastActiveDate);
    return d !== null && d < 7;
  }).length;

  // Toast-style banners for clients who joined in the last 24 hours. Coach
  // sees one welcome ribbon per fresh signup, dismissable via tap or auto-fade.
  const justJoined = clients.filter(c => {
    if (!c.joinedAt) return false;
    const ts = new Date(c.joinedAt).getTime();
    if (Number.isNaN(ts)) return false;
    return (now - ts) <= DAY_24H && !dismissedToasts.has(c.id);
  });

  // Auto-dismiss the first joined-toast after 8s once it appears. We only
  // schedule one timer at a time and dismiss the oldest banner so the queue
  // drains predictably even if the coach doesn't tap.
  const oldestJoinedId = justJoined[0]?.id || null;
  useEffect(() => {
    if (!oldestJoinedId) return;
    const t = setTimeout(() => {
      setDismissedToasts(prev => {
        if (prev.has(oldestJoinedId)) return prev;
        const next = new Set(prev);
        next.add(oldestJoinedId);
        return next;
      });
    }, 8000);
    return () => clearTimeout(t);
  }, [oldestJoinedId]);

  function dismissJoinedToast(id) {
    setDismissedToasts(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function scrollToAttention() {
    if (attentionAnchorRef.current) {
      attentionAnchorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const firstName = coachOwnName ? coachOwnName.split(" ")[0] : "";
  const greeting  = coachGreetingForNow() + (firstName ? ` ${firstName}.` : "");
  const subtitle  = clients.length === 0
    ? null
    : `${clients.length} client${clients.length === 1 ? "" : "s"} · ${activeThisWeekCount} active this week`;
  const coachInitials = (() => {
    const parts = (coachOwnName || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "FC";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();

  // Bottom nav icon helper
  const navItem = (tab, icon, label) => {
    const active = coachTab === tab;
    return (
      <button
        key={tab}
        onClick={() => {
          setCoachScreen("list");
          setSelectedClient(null);
          setCoachTab(tab);
        }}
        style={{
          flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3,
          background:"none", border:"none", cursor:"pointer", fontFamily:T.font,
          padding:"8px 0", color: active ? T.gold : T.hint,
        }}
      >
        <span style={{ fontSize:20, lineHeight:1 }}>{icon}</span>
        <span style={{ fontSize:10, fontWeight: active ? 700 : 400, letterSpacing:"0.03em" }}>{label}</span>
      </button>
    );
  };

  return (
    <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg }}>

      {publicPreview && (
        <div style={{
          background:"linear-gradient(180deg, rgba(200,144,42,0.22), rgba(200,144,42,0.1))",
          borderBottom:`1px solid rgba(200,144,42,0.4)`,
          padding:"10px 16px",
          display:"flex",
          alignItems:"center",
          justifyContent:"space-between",
          gap:12,
        }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.gold, letterSpacing:"0.02em", lineHeight:1.35 }}>
            Public demo · sample clients only · nothing is saved
          </span>
          {typeof onExit === "function" && (
            <button
              type="button"
              onClick={onExit}
              style={{
                flexShrink:0,
                fontSize:12,
                fontWeight:800,
                color:"#1a1a16",
                background:T.gold,
                padding:"8px 14px",
                borderRadius:10,
                border:"none",
                cursor:"pointer",
                fontFamily:T.font,
              }}
            >
              Exit demo
            </button>
          )}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ padding:"18px 18px 14px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:3, flexWrap:"wrap" }}>
              <span style={{ fontFamily:T.serif, fontSize:24, color:T.text, letterSpacing:"-0.01em", lineHeight:1.15 }}>
                {greeting}
              </span>
              <span style={{
                fontSize:9, fontWeight:700, color:"#1a1a16",
                background:T.gold, padding:"3px 8px", borderRadius:6,
                letterSpacing:"0.07em", flexShrink:0,
              }}>
                COACH{isPreview ? " · PREVIEW" : ""}
              </span>
            </div>
            <div style={{ fontSize:12, color:T.muted }}>{fmtDateLong()}</div>
            {subtitle && (
              <div style={{ fontSize:11, color:T.muted, marginTop:4, letterSpacing:"0.01em" }}>
                {subtitle}
              </div>
            )}
            {!showPaywall && coachTab === "clients" && coachScreen === "list" && (
              <button
                type="button"
                onClick={() => { setCoachScreen("list"); setSelectedClient(null); setCoachTab("you"); }}
                style={{
                  marginTop:10, display:"block", fontSize:12, fontWeight:600, color:T.gold,
                  background:"none", border:"none", cursor:"pointer", padding:0, fontFamily:T.font,
                }}
              >
                Invite clients · share link & code →
              </button>
            )}
          </div>
          {isPreview && typeof onExit === "function" && !publicPreview && (
            <button
              type="button"
              onClick={onExit}
              style={{
                flexShrink:0,
                fontSize:11,
                fontWeight:800,
                color:"#1a1a16",
                background:T.gold,
                padding:"8px 12px",
                borderRadius:10,
                border:"none",
                cursor:"pointer",
                fontFamily:T.font,
                letterSpacing:"0.03em",
              }}
            >
              Exit preview
            </button>
          )}
        </div>
      </div>

      {/* ── Preview / demo data banner ─────────────────────────────────── */}
      {useDemoClients && (
        <div style={{
          background:"rgba(200,144,42,0.12)", borderBottom:`1px solid rgba(200,144,42,0.25)`,
          padding:"9px 18px", display:"flex", alignItems:"center", gap:8,
        }}>
          <span style={{ fontSize:11, fontWeight:700, color:T.gold, letterSpacing:"0.04em" }}>PREVIEW</span>
          <span style={{ fontSize:11, color:T.sub }}>· Demo data only — not real clients</span>
        </div>
      )}

      {loadTimedOut && !loading && useDemoClients && (
        <div style={{ fontSize:11, color:T.muted, padding:"6px 18px 0", lineHeight:1.45 }}>
          Showing sample clients — connection took too long. You can still explore the demo.
        </div>
      )}

      {/* ── Attention strip (clients tab, list view only) ───────────────── */}
      {!showPaywall && coachTab === "clients" && coachScreen === "list" && needsAttention.length > 0 && (
        <button
          type="button"
          onClick={scrollToAttention}
          style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"center",
            background:"rgba(230,126,34,0.10)", border:"none", borderTop:`0.5px solid rgba(230,126,34,0.28)`,
            borderBottom:`0.5px solid rgba(230,126,34,0.18)`,
            color:T.gold, fontSize:12, fontWeight:600, fontFamily:T.font,
            padding:"10px 16px", cursor:"pointer", letterSpacing:"0.01em",
            minHeight:36,
          }}
        >
          {needsAttention.length} client{needsAttention.length === 1 ? "" : "s"} need{needsAttention.length === 1 ? "s" : ""} attention
        </button>
      )}

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div style={{ paddingBottom:80 }}>
        {showPaywall ? (
          <CoachPaywall />

        /* ── YOU (profile + invites + account) ───────────────────────────── */
        ) : coachTab === "you" ? (
          <div style={{ padding:"20px 18px 28px" }}>
            <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:20 }}>
              <div style={{
                width:56, height:56, borderRadius:16, flexShrink:0,
                background:"linear-gradient(145deg, rgba(200,144,42,0.22), rgba(200,144,42,0.06))",
                border:`1px solid rgba(200,144,42,0.35)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:18, fontWeight:700, color:T.gold, letterSpacing:"0.02em", fontFamily:T.font,
              }}>
                {coachInitials}
              </div>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontFamily:T.serif, fontSize:21, color:T.text, lineHeight:1.2 }}>
                  {coachOwnName || "Your workspace"}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:6, marginTop:8 }}>
                  <span style={{ fontSize:9, fontWeight:700, color:"#1a1a16", background:T.gold, padding:"3px 8px", borderRadius:6, letterSpacing:"0.07em" }}>
                    {coachTier ? "COACH · ACTIVE" : "COACH"}
                  </span>
                  {isPreview && (
                    <span style={{ fontSize:9, fontWeight:700, color:T.gold, background:"rgba(200,144,42,0.14)", padding:"3px 8px", borderRadius:6, letterSpacing:"0.06em", border:`1px solid rgba(200,144,42,0.3)` }}>
                      PREVIEW
                    </span>
                  )}
                </div>
                <div style={{ fontSize:12, color:T.muted, marginTop:6, lineHeight:1.45 }}>
                  {clients.length === 0
                    ? "No clients yet — share your link to fill this workspace."
                    : `${clients.length} client${clients.length === 1 ? "" : "s"} · ${activeThisWeekCount} active this week${needsAttention.length ? ` · ${needsAttention.length} need attention` : ""}`}
                </div>
              </div>
            </div>

            <div style={{
              background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 16px", marginBottom:16,
            }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                Workspace pulse
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"10px 12px", border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:20, fontWeight:700, color:T.text, fontFamily:T.font }}>{activeThisWeekCount}</div>
                  <div style={{ fontSize:11, color:T.hint, marginTop:2 }}>Active (7d)</div>
                </div>
                <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"10px 12px", border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:20, fontWeight:700, color: needsAttention.length ? T.amber : T.text, fontFamily:T.font }}>{needsAttention.length}</div>
                  <div style={{ fontSize:11, color:T.hint, marginTop:2 }}>Need attention</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setCoachTab("clients"); setCoachScreen("list"); setSelectedClient(null); }}
                style={{
                  width:"100%", marginTop:12, padding:"10px 0", borderRadius:10,
                  background:"rgba(255,255,255,0.04)", border:`1px solid ${T.border}`,
                  color:T.sub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:T.font,
                }}
              >
                Open client list →
              </button>
            </div>

            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, marginBottom:8 }}>Grow your practice</div>
            <div style={{ fontSize:13, color:T.muted, lineHeight:1.65, marginBottom:16 }}>
              Share your link — new signups land in your roster with Pro included. Existing Forged users can link with your coach code.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
              {["Personal onboarding path for each client", "Forged Pro for every seat (up to 15)", "Habits, streaks, and notes visible as they log"].map(line => (
                <div key={line} style={{ display:"flex", alignItems:"flex-start", gap:9 }}>
                  <span style={{ color:T.gold, fontSize:12, lineHeight:1.6, flexShrink:0, fontWeight:700 }}>✓</span>
                  <span style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{line}</span>
                </div>
              ))}
            </div>
            {inviteLink ? (
              <>
                <button
                  type="button"
                  onClick={copyInviteLink}
                  style={{
                    width:"100%", padding:"14px 0", borderRadius:12, border:"none",
                    background: inviteCopied ? T.green : T.gold, color:"#1a1a16",
                    fontSize:14, fontWeight:700, fontFamily:T.font, cursor:"pointer",
                    marginBottom:12, transition:"background 0.2s",
                    boxShadow:"0 2px 14px rgba(200,144,42,0.18)",
                  }}
                >
                  {inviteCopied ? "✓ Link copied to clipboard" : "Copy invite link →"}
                </button>
                <div style={{
                  background:T.surface, border:`1px solid ${T.border}`, borderRadius:10,
                  padding:"10px 12px", fontSize:11, color:T.sub,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",
                  marginBottom:16,
                }}>
                  {inviteLink}
                </div>
              </>
            ) : (
              <div style={{ fontSize:12, color:T.muted, marginBottom:16, fontStyle:"italic" }}>
                Sign in to generate your invite link.
              </div>
            )}
            {coachCodeFormatted && (
              <div style={{
                background:T.surface, border:`1px solid ${T.border}`,
                borderRadius:12, padding:"14px 16px", marginBottom:16,
              }}>
                <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>
                  Coach code · existing users
                </div>
                <div style={{ fontSize:26, fontWeight:700, color:T.text, letterSpacing:"0.14em", fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace", marginBottom:8 }}>
                  {coachCodeFormatted}
                </div>
                <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>
                  Enter in Profile → &ldquo;Join a coach&rdquo; to link instantly.
                </div>
              </div>
            )}
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 16px", marginBottom:24 }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Client slots</div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:14, color:T.text }}>{clients.length} of 15 used</span>
                <span style={{ fontSize:12, color: clients.length >= 15 ? T.accent : T.green, fontWeight:600 }}>
                  {clients.length >= 15 ? "At limit" : `${15 - clients.length} remaining`}
                </span>
              </div>
              <div style={{ marginTop:8, height:4, background:"rgba(255,255,255,0.06)", borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${Math.min(100, (clients.length/15)*100)}%`, background: clients.length >= 15 ? T.accent : T.gold, borderRadius:2, transition:"width 0.4s" }}/>
              </div>
            </div>

            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, marginBottom:12 }}>Account</div>
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, overflow:"hidden", marginBottom:16 }}>
              <div style={{ padding:"12px 16px", borderBottom:`0.5px solid ${T.border}` }}>
                <div style={{ fontSize:11, color:T.hint, marginBottom:2 }}>Display name</div>
                <div style={{ fontSize:14, color:T.text }}>{coachOwnName || "—"}</div>
              </div>
              <div style={{ padding:"12px 16px" }}>
                <div style={{ fontSize:11, color:T.hint, marginBottom:2 }}>Subscription</div>
                <div style={{ fontSize:14, color: coachTier ? T.green : T.muted }}>
                  {coachTier ? "Forged Coach · Active" : "No active plan"}
                </div>
              </div>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{
                width:"100%", padding:"13px 0", borderRadius:12,
                background:"rgba(231,76,60,0.08)", border:`1px solid rgba(231,76,60,0.22)`,
                color:"#E74C3C", fontSize:14, fontWeight:600,
                cursor:"pointer", fontFamily:T.font,
              }}
            >
              Sign out
            </button>
            {isPreview && (
              <button
                onClick={onExit}
                style={{
                  width:"100%", marginTop:10, padding:"13px 0", borderRadius:12,
                  background:"rgba(255,255,255,0.05)", border:`1px solid ${T.border}`,
                  color:T.muted, fontSize:14, cursor:"pointer", fontFamily:T.font,
                }}
              >
                ← Exit preview
              </button>
            )}
          </div>

        /* ── CLIENTS TAB ─────────────────────────────────────────────────── */
        ) : coachScreen === "detail" && selectedClient ? (
          <CoachClientDetail
            client={selectedClient}
            onBack={() => { setCoachScreen("list"); setSelectedClient(null); }}
            useLocalAiBrief={!COACH_SUMMARY_UUID_RE.test(String(selectedClient.id ?? ""))}
          />
        ) : (
          <div style={{ padding:"18px 16px 0" }}>
            {loading && (
              <div style={{ textAlign:"center", padding:52, color:T.muted, fontSize:13 }}>Loading clients…</div>
            )}
            {err && (
              <div style={{ textAlign:"center", padding:52, color:"#E74C3C", fontSize:13 }}>{err}</div>
            )}

            {/* Just-joined toasts (top of list) */}
            {!loading && !err && justJoined.length > 0 && justJoined.slice(0, 2).map(c => (
              <button
                key={`toast-${c.id}`}
                type="button"
                onClick={() => dismissJoinedToast(c.id)}
                title="Dismiss"
                style={{
                  width:"100%", textAlign:"left", cursor:"pointer", fontFamily:T.font, display:"block",
                  background:"linear-gradient(180deg, rgba(200,144,42,0.14), rgba(200,144,42,0.05))",
                  border:`1px solid rgba(200,144,42,0.45)`,
                  borderRadius:12, padding:"10px 14px", marginBottom:10,
                  fontSize:12, color:T.text,
                  animation:"coachToastIn 0.45s cubic-bezier(0.22,1,0.36,1) both",
                  boxShadow:"0 1px 0 rgba(200,144,42,0.15)",
                }}
              >
                <span style={{ fontWeight:700, color:T.gold }}>{c.name}</span>
                <span style={{ color:T.sub }}> just joined through your invite link</span>
                <span style={{ marginLeft:4 }}>🎉</span>
              </button>
            ))}

            {/* Empty state */}
            {!loading && !err && clients.length === 0 && (
              <div style={{ padding:"28px 16px 12px" }}>
                {/* Value headline */}
                <div style={{ textAlign:"center", marginBottom:24 }}>
                  <div style={{ fontSize:44, lineHeight:1, marginBottom:14 }}>👥</div>
                  <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, lineHeight:1.25, marginBottom:8 }}>
                    Your coaching workspace
                  </div>
                  <div style={{ fontSize:13, color:T.muted, lineHeight:1.7, maxWidth:290, margin:"0 auto" }}>
                    When clients join through your link or code, you see their habits, streaks, and notes right here — ready before every session.
                  </div>
                </div>

                {/* Value props cards */}
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
                  {[
                    { icon:"📋", title:"Full habit visibility", body:"See every habit they track, their logs, streaks, and personal notes as they write them." },
                    { icon:"✨", title:"AI pre-session brief", body:"Before each session, get an AI-generated summary of what shifted, what stalled, and what to ask." },
                    { icon:"⚡", title:"Pro included", body:"Each client you add gets Forged Pro automatically — up to 15 seats included with your plan." },
                  ].map(({ icon, title, body }) => (
                    <div key={title} style={{
                      background:T.surface, border:`1px solid ${T.border}`,
                      borderRadius:12, padding:"13px 14px",
                      display:"flex", alignItems:"flex-start", gap:12,
                    }}>
                      <span style={{ fontSize:18, flexShrink:0, lineHeight:1.4 }}>{icon}</span>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:3 }}>{title}</div>
                        <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>{body}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Primary CTA */}
                {inviteLink && (
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    style={{
                      width:"100%", padding:"14px 0", borderRadius:12, border:"none",
                      background:T.gold, color:"#1a1a16",
                      fontSize:14, fontWeight:700, fontFamily:T.font,
                      cursor:"pointer", marginBottom:12,
                      boxShadow:"0 2px 14px rgba(200,144,42,0.18)",
                    }}
                  >
                    {inviteCopied ? "Link copied ✓" : "Copy invite link →"}
                  </button>
                )}

                {/* Coach code — secondary path */}
                {coachCodeFormatted && (
                  <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:"13px 16px", textAlign:"center" }}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
                      Or share your coach code
                    </div>
                    <div style={{ fontSize:22, fontWeight:700, color:T.text, letterSpacing:"0.14em", fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace", marginBottom:6 }}>
                      {coachCodeFormatted}
                    </div>
                    <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>
                      Existing Forged users can enter this in Profile → &ldquo;Join a coach&rdquo;
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Urgency-grouped client list */}
            {!loading && !err && clients.length > 0 && (
              <>
                {needsAttention.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <CoachSectionLabel label="Needs attention" count={needsAttention.length} anchorRef={attentionAnchorRef} />
                    {needsAttention.map((c, i) => (
                      <CoachClientRow
                        key={c.id} client={c}
                        accent="#E74C3C"
                        animationDelayMs={i * 30}
                        onClick={() => { setSelectedClient(c); setCoachScreen("detail"); }}
                      />
                    ))}
                  </div>
                )}

                {newClients.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <CoachSectionLabel label="New" count={newClients.length} />
                    {newClients.map((c, i) => (
                      <CoachClientRow
                        key={c.id} client={c}
                        accent={T.gold}
                        badge="NEW"
                        animationDelayMs={i * 30}
                        onClick={() => { setSelectedClient(c); setCoachScreen("detail"); }}
                      />
                    ))}
                  </div>
                )}

                {activeWeek.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <CoachSectionLabel label="Active this week" count={activeWeek.length} />
                    {activeWeek.map((c, i) => (
                      <CoachClientRow
                        key={c.id} client={c}
                        accent="#27AE60"
                        animationDelayMs={i * 30}
                        onClick={() => { setSelectedClient(c); setCoachScreen("detail"); }}
                      />
                    ))}
                  </div>
                )}

                <div style={{ fontSize:10, color:T.muted, textAlign:"center", marginTop:6, marginBottom:4 }}>
                  As of {data?.asOf ?? localTodayYmd()}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom navigation ───────────────────────────────────────────── */}
      <div style={{
        position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430,
        background: T.raised,
        borderTop:`0.5px solid ${T.border}`,
        display:"flex", alignItems:"stretch",
        paddingBottom:"env(safe-area-inset-bottom, 0px)",
        zIndex:200,
      }}>
        {navItem("clients", "👥", "Clients")}
        {navItem("you",     "👤", "You")}
      </div>
    </div>
  );
}

// ─── COACH-CLIENT WELCOME ─────────────────────────────────────────────────────
// Shown once after onboarding completes for users who arrived via a coach
// invite link. Caller is responsible for stamping
// `localStorage.forged_coach_welcome_seen = "1"` when onDone fires so this
// never reappears for the same device/account.
function CoachWelcomeScreen({ onDone }) {
  return (
    <div style={{
      fontFamily: T.font, background: T.bg, minHeight: "100vh",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "0 26px", textAlign: "center",
      animation: "fadeIn 0.6s ease both",
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        background: "rgba(39,174,96,0.15)",
        border: "1px solid rgba(39,174,96,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 22,
      }}>
        <span style={{ fontSize: 28, color: "#27AE60", lineHeight: 1, fontWeight: 700 }}>✓</span>
      </div>

      <div style={{ fontFamily: T.serif, fontSize: 28, color: T.text, lineHeight: 1.2, marginBottom: 12 }}>
        You&rsquo;re connected.
      </div>
      <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.65, maxWidth: 280, marginBottom: 26 }}>
        Your coach can now see your habit logs and notes. They&rsquo;ll be notified you&rsquo;ve joined.
      </div>

      <div style={{ width: "100%", maxWidth: 320, height: 1, background: T.border, marginBottom: 22 }} />

      <div style={{
        width: "100%", maxWidth: 320,
        background: "linear-gradient(180deg, rgba(39,174,96,0.12), rgba(39,174,96,0.04))",
        border: "1px solid rgba(39,174,96,0.32)",
        borderRadius: 14, padding: "14px 16px",
        display: "flex", alignItems: "center", gap: 12,
        marginBottom: 24, textAlign: "left",
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>⚡</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
            Forged Pro &mdash; Included
          </div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.5 }}>
            Your coach has unlocked full access for you.
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        style={{
          width: "100%", maxWidth: 320,
          padding: "14px 16px", borderRadius: 12, border: "none",
          background: T.gold, color: "#1a1a16",
          fontSize: 15, fontWeight: 700, fontFamily: T.font,
          cursor: "pointer", letterSpacing: "0.01em",
        }}
      >
        Start logging &rarr;
      </button>
    </div>
  );
}

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
  const [showAddLog,        setShowAddLog]        = useState(false);
  const [journalEntries,    setJournalEntries]    = useState([]);
  const [showJournalCompose,setShowJournalCompose]= useState(false);
  const [logGoalId,      setLogGoalId]      = useState(null);
  const [editGoalId,     setEditGoalId]     = useState(null);
  const [openGoalId,     setOpenGoalId]     = useState(null);
  const [showXP,      setShowXP]     = useState(false);
  const [showHistory, setShowHistory]= useState(false);
  const [showCoach,   setShowCoach]  = useState(false);
  /** How the coach sheet should prime input after open: voice vs keyboard. */
  const [coachOpenMode, setCoachOpenMode] = useState(null);
  // Whether the user has ever opened the AI coach in this browser. Used to drive
  // a subtle pulse on the FAB for first-time users so it doesn't vanish into the bg.
  const [coachEverOpened, setCoachEverOpened] = useState(() => {
    try { return localStorage.getItem("forged_coach_opened") === "1"; } catch { return false; }
  });
  const [showCoachTeaser, setShowCoachTeaser] = useState(false);
  /** Message recorded via page-level mic, auto-sent when AICoach mounts. Cleared after use. */
  const [coachPendingMsg, setCoachPendingMsg] = useState(null);
  // Accumulates finals + stop-time interim flush across Web Speech segments. Same session
  // as in-chat dictation: browsers end recognition after pauses unless we auto-restart.
  const pageDictationAccumulatorRef = useRef("");
  // Page-level speech hook: mic tap in CoachBar records without opening the sheet first.
  // autoRestart matches AICoach so silence does not end the session until the user stops.
  const pageSpeech = useSpeechInput(
    (transcript) => {
      const t = (transcript || "").trim();
      if (!t) return;
      const prev = pageDictationAccumulatorRef.current;
      pageDictationAccumulatorRef.current = prev ? `${prev} ${t}` : t;
      if (import.meta.env.DEV) {
        console.log("[pageSpeech] segment", t.length, "chars; total", pageDictationAccumulatorRef.current.length);
      }
    },
    { autoRestart: true, meter: false },
  );
  const prevPageSpeechListeningRef = useRef(false);
  useEffect(() => {
    const was = prevPageSpeechListeningRef.current;
    const now = pageSpeech.listening;
    if (was && !now) {
      const msg = pageDictationAccumulatorRef.current.trim();
      pageDictationAccumulatorRef.current = "";
      if (msg) {
        if (import.meta.env.DEV) console.log("[pageSpeech] handoff", msg.length, "chars");
        setCoachPendingMsg(msg);
        try { localStorage.setItem("forged_coach_opened", "1"); } catch { /* ignore */ }
        setCoachEverOpened(true);
        setCoachOpenMode("text");
        setShowCoach(true);
      }
    }
    prevPageSpeechListeningRef.current = now;
  }, [pageSpeech.listening]);
  /** Ephemeral bubble above the coach FAB: `{ id, text }` while visible; `id` ties to the navigation that triggered it. */
  const [coachPageNudge, setCoachPageNudge] = useState(null);
  const coachNudgeSeqRef = useRef(0);
  // First-time AI page guide — persistent bubble shown once per page/user on
  // first visit to Today, Journal, Insights, or Social. `{ page, text }` while
  // visible, null when dismissed or away. Stays until the user closes it or
  // navigates to a different screen. Replayable via Dev Tools on creator acct.
  const [pageGuide, setPageGuide] = useState(null);
  // Bumped by the Dev Tools "Replay AI page tour" control so the guide effect
  // re-runs even when the user is already on a guided page.
  const [pageGuideReplayTick, setPageGuideReplayTick] = useState(0);
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
  const [isAdmin,        setIsAdmin]        = useState(false);
  const [isCoach,        setIsCoach]        = useState(false);
  // Active coach subscription tier ("coach" | "coach_pro" | null). Drives the
  // paywall in CoachApp — coaches without a tier see the subscribe screen.
  const [coachTier,      setCoachTier]      = useState(null);
  const [previewCoach,   setPreviewCoach]   = useState(false);
  /** Signed-out (or from auth) demo of coach shell — does not require coach subscription */
  const [publicCoachPreview, setPublicCoachPreview] = useState(false);
  /** From profiles.stripe_customer_id — used for Stripe Customer Portal */
  const [stripeCustomerId, setStripeCustomerId] = useState(null);
  const [coachName,      setCoachName]      = useState("Coach");
  const [coachIcon,      setCoachIcon]      = useState("");
  // One-time post-onboarding welcome screen shown to users who arrived via a
  // coach invite link. Flipped on by either (a) a successful accept-coach-invite
  // POST, or (b) detecting `forged_pending_coach` at app load. Persisted-once
  // dismissal lives in localStorage("forged_coach_welcome_seen").
  const [pendingCoachWelcome, setPendingCoachWelcome] = useState(() => {
    try {
      if (typeof window === "undefined") return false;
      const seen = window.localStorage.getItem("forged_coach_welcome_seen") === "1";
      const hasPending = !!window.localStorage.getItem("forged_pending_coach");
      return hasPending && !seen;
    } catch { return false; }
  });

  // ── Notification state (App-level so it survives tab switches) ───────────────
  const [notifEnabled,    setNotifEnabled]    = useState(false);
  // Default reminder time is 6 pm local. Most users react better to an
  // evening nudge to log the day than a morning one. Existing users who
  // already chose a different time keep theirs (loaded from DB below).
  const [notifTime,       setNotifTime]       = useState("18:00");
  // Per-category toggles. All default ON so existing subscribers keep their
  // current behaviour; the migration `20260423000000_notification_categories`
  // adds these columns server-side with the same default.
  const [dailyRemindersEnabled, setDailyRemindersEnabled] = useState(true);
  const [nudgesEnabled,         setNudgesEnabled]         = useState(true);
  const [invitesEnabled,        setInvitesEnabled]        = useState(true);
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
  const [sharedGoalInvites,    setSharedGoalInvites]    = useState([]);
  // Forged beta leaderboard — top users by XP, refreshed on Social tab entry.
  const [betaLeaderboard,      setBetaLeaderboard]      = useState([]);
  const [leaderboardLoading,   setLeaderboardLoading]   = useState(false);
  const [myBetaRank,           setMyBetaRank]           = useState(null);
  const [betaTotalCount,       setBetaTotalCount]       = useState(null);
  // Recent public activity across beta users (for Social ticker) — populated via RPC; safe fallback if RPC missing.
  const [betaTicker,           setBetaTicker]           = useState([]);
  const betaTickerLoadedRef = useRef(false);
  /** While linking a habit to a new shared goal (Today → Share) — prevents duplicate goals from double-tap */
  const [sharingHabitId,       setSharingHabitId]       = useState(null);
  /** After sharing/linking a habit, auto-open the invite picker for that goal on Social page */
  const [pendingInviteGoalId,  setPendingInviteGoalId]  = useState(null);
  const sharingHabitIdRef = useRef(null);
  const createSharedGoalInFlightRef = useRef(false);
  // ─────────────────────────────────────────────────────────────────────────────

  const [showUpgrade,    setShowUpgrade]    = useState(false);
  const [checkingPayment,setCheckingPayment]= useState(false);
  const [showWelcome,    setShowWelcome]    = useState(false);
  const [showProFollowup, setShowProFollowup] = useState(false);
  const [demoMode,       setDemoMode]       = useState(false);
  const shownDemoRef = useRef(false); // prevent demo re-showing after sign-out
  const [previewOnboarding, setPreviewOnboarding] = useState(false); // admin preview only — never touches DB
  const [refCode,     setRefCode]     = useState(null);
  const [authEmail,   setAuthEmail]   = useState(null);
  /** Supabase auth user id when signed in; null when logged out */
  const [sessionUserId, setSessionUserId] = useState(null);
  /** Incremented when a ?coach= param lands while the user is already signed in,
   *  so the accept-invite effect re-fires even though sessionUserId didn't change. */
  const [coachInviteTick, setCoachInviteTick] = useState(0);
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
  // Soft-recovery guard: only auto-attempt once per mount so we don't loop
  // if Supabase is genuinely offline or the session is truly invalid.
  const softRecoveryAttemptedRef = useRef(false);
  const softRecoveryInFlightRef = useRef(false);
  // Coordination: set while INITIAL_SESSION(null) is waiting for TOKEN_REFRESHED.
  // The watchdog must not call refreshSession() during this window — it races
  // with Supabase's own internal token refresh and leaves the client in a
  // confused state that causes PostgREST 401s / timeouts.
  const waitingForTokenRefreshRef = useRef(false);
  // Prevents the accountLoadError auto-retry from looping on persistent failures.
  const autoRetryFiredRef = useRef(false);

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
        const todayLogs = (h.logs || []).filter(l => l.date === today);
        if (todayLogs.length === 0) return;
        if (h.habitType === "project") {
          // Any project session today means the first-log XP was already awarded.
          next.add(`project-first:${h.id}:${today}`);
          const mins = todayLogs.reduce((s, l) => s + (l.value?.minutes || 0), 0);
          const targetMins = h.dailyTargetMinutes ?? 60;
          if (mins >= targetMins) next.add(`project-target:${h.id}:${today}`);
        } else if (h.habitType === "limit") {
          // "None today" (+15 XP) was awarded iff there's a value:0 log today.
          if (todayLogs.some(l => l.value === 0)) next.add(`limit-none:${h.id}:${today}`);
        } else if (todayLogs.some(l => l.value === true)) {
          // Daily / weekly tap (+10 XP).
          next.add(`${h.id}:${today}`);
        }
      });
      goals.forEach(g => {
        const todayNums = (g.logs || [])
          .filter(l => l.date === today)
          .map(l => (typeof l.value === "number" ? l.value : Number(l.value)))
          .filter(Number.isFinite);
        if (todayNums.length > 0) next.add(`goal:${g.id}:${today}`);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [habits, goals]);

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
        // SELECT * tolerates the new category columns being absent before the
        // 20260423 migration runs — we just fall back to the all-on defaults.
        const { data } = await supabase
          .from("push_subscriptions")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle();
        if (data) {
          setNotifEnabled(data.notifications_enabled);
          setNotifTime(data.reminder_time || "18:00");
          setDailyRemindersEnabled(data.daily_reminders_enabled !== false);
          setNudgesEnabled(data.nudges_enabled !== false);
          setInvitesEnabled(data.social_invites_enabled !== false);
        } else {
          // Browser subscribed but no DB row — re-save with the new 6 pm default.
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          await supabase.from("push_subscriptions").upsert({
            user_id: uid, subscription: sub.toJSON(),
            reminder_time: "18:00", notifications_enabled: true,
            timezone: tz, updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
        }
      } catch (e) { console.warn("[Forged] notif restore:", e); }
    })();
  }, [sessionUserId]);

  // ── Load social data whenever sessionUserId is available ─────────────────────
  useEffect(() => {
    if (!sessionUserId) return;
    const uid = sessionUserId;
    loadFriends(uid);
    loadFriendRequests(uid);
    loadSentRequests(uid);
    loadSharedGoals(uid);
    loadSharedGoalInvites(uid);
    syncLastActive();

    // Real-time: re-fetch friend requests the instant one arrives
    const friendChannel = supabase
      .channel(`friend-reqs-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "friendships", filter: `addressee_id=eq.${uid}` },
        () => loadFriendRequests(uid)
      )
      .subscribe();

    // Real-time: re-fetch shared goal invites the instant one arrives
    const inviteChannel = supabase
      .channel(`goal-invites-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "shared_goal_invites", filter: `invitee_id=eq.${uid}` },
        () => loadSharedGoalInvites(uid)
      )
      .subscribe();

    // Real-time: reload shared goal roster whenever any member logs progress.
    // Works now because the updated RLS SELECT policy lets all members of the same
    // goal see each other's rows, so UPDATE/INSERT events from teammates propagate here.
    const memberChannel = supabase
      .channel(`shared-goal-members-${uid}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shared_goal_members" },
        () => loadSharedGoals(uid))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shared_goal_members" },
        () => loadSharedGoals(uid))
      .subscribe();

    // Real-time: show an in-app toast when someone nudges this user
    const nudgeChannel = supabase
      .channel(`nudges-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "nudges", filter: `recipient_id=eq.${uid}` },
        (payload) => {
          const row = payload.new;
          const senderName = row?.sender_name || "A friend";
          const msg = row?.message ? ` "${row.message}"` : "";
          addToast(`💪 ${senderName} nudged you!${msg}`);
          if (row?.sent_at) writeNudgeWatermarkIfNewer(uid, row.sent_at);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(friendChannel);
      supabase.removeChannel(inviteChannel);
      supabase.removeChannel(memberChannel);
      supabase.removeChannel(nudgeChannel);
    };
  }, [sessionUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Refresh shared goals + beta leaderboard when navigating to Social ──
  useEffect(() => {
    if (screen === "social" && sessionUserId) {
      loadSharedGoals(sessionUserId);
      loadBetaLeaderboard(sessionUserId);
      // Ticker only needs to load once per mount — cheap and doesn't depend on uid.
      loadBetaTicker();
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle /join/[code] invite URLs ──────────────────────────────────────────
  useEffect(() => {
    const match = window.location.pathname.match(/^\/join\/([a-zA-Z0-9]+)$/);
    if (match) {
      localStorage.setItem("forged_pending_join", match[1]);
      // Clean up URL without reloading
      window.history.replaceState({}, "", "/");
    }
  }, []);

  // ── Handle ?coach=<base64(coachUserId)> invite URLs ─────────────────────────
  // Stash the raw token on first paint (before auth resolves). After the user
  // signs in or creates an account the dependent effect below POSTs it to
  // /api/accept-coach-invite. URL is cleaned synchronously so a refresh or a
  // share doesn't re-process the same invite.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const coachToken = params.get("coach");
    if (coachToken) {
      localStorage.setItem("forged_pending_coach", coachToken);
      params.delete("coach");
      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
      // If the user is already signed in when they land on the invite link,
      // sessionUserId won't change so the accept-invite effect below won't
      // fire. Bump the tick to force it to re-run.
      setCoachInviteTick(t => t + 1);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the user has a session, hand the stashed token to the backend. We
  // clear localStorage *after* a successful response so a transient network
  // failure leaves the token in place to retry on next session restore.
  useEffect(() => {
    if (!sessionUserId) return;
    const coachToken = localStorage.getItem("forged_pending_coach");
    if (!coachToken) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) return; // try again on the next session change
        const res = await fetch("/api/accept-coach-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ coach: coachToken }),
        });
        if (res.ok) {
          localStorage.removeItem("forged_pending_coach");
          try {
            const json = await res.json();
            // Mirror coach_id into local user state so the Coaching card on
            // ProfileScreen renders without a profile re-fetch.
            if (json.coachId) {
              setUser(u => ({ ...u, coachId: json.coachId }));
              // Fetch and surface the coach's display name immediately.
              supabase.from("profiles").select("name").eq("id", json.coachId).maybeSingle()
                .then(({ data }) => {
                  if (data?.name) setUser(u => ({ ...u, linkedCoachName: data.name.trim() || null }));
                }).catch(() => {});
            }
            if (json.isProGranted) {
              setIsPro(true);
              addToast("✓ Connected with your coach — Forged Pro unlocked!");
            } else {
              addToast("You're connected with your coach.");
            }
          } catch {
            addToast("You're connected with your coach.");
          }
          // Always queue the welcome screen on a fresh acceptance, unless the
          // user already dismissed it on this device.
          try {
            if (localStorage.getItem("forged_coach_welcome_seen") !== "1") {
              setPendingCoachWelcome(true);
            }
          } catch { /* localStorage blocked — skip welcome silently */ }
        } else {
          // Permanent failure modes: bad token, self-invite, missing coach.
          // Drop the token so we don't keep retrying every session.
          if (res.status === 400 || res.status === 404) {
            localStorage.removeItem("forged_pending_coach");
          }
        }
      } catch {
        // Transient — leave the token, will retry on next session restore.
      }
    })();
  }, [sessionUserId, coachInviteTick]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await supabase.from("push_subscriptions").update({
      reminder_time: newTime,
      timezone: tz,
      updated_at: new Date().toISOString(),
    }).eq("user_id", sessionUserId);
  }

  // ── Per-category toggles (daily reminders / nudges / social invites) ───────
  // Each updates the corresponding column in push_subscriptions independently
  // so the user can, for example, accept friend nudges in real time but turn
  // off the daily push without losing their subscription. We update local
  // state immediately for snappy UI; if the DB write fails we revert.
  async function handleNotifCategoryChange(category, value) {
    if (!sessionUserId) return;
    const setters = {
      daily_reminders_enabled:  setDailyRemindersEnabled,
      nudges_enabled:           setNudgesEnabled,
      social_invites_enabled:   setInvitesEnabled,
    };
    const setter = setters[category];
    if (!setter) return;
    setter(value);
    const { error } = await supabase
      .from("push_subscriptions")
      .update({ [category]: value, updated_at: new Date().toISOString() })
      .eq("user_id", sessionUserId);
    if (error) {
      console.warn("[Forged] notif category save failed:", error.message);
      setter(!value);
      addToast(`Couldn't save preference: ${error.message}`);
    }
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

  async function loadBetaLeaderboard(uid) {
    const id = uid || userIdRef.current;
    setLeaderboardLoading(true);
    try {
      // Top 10 by XP (skip 0-xp so the board doesn't show new sign-ups).
      const { data: top } = await supabase
        .from("profiles")
        .select("id, name, username, avatar_url, xp, current_streak, is_pro, last_active_date")
        .gt("xp", 0)
        .order("xp", { ascending: false })
        .limit(10);
      const today = todayStr();
      const rows = (top || []).map((p, i) => ({
        rank:        i + 1,
        id:          p.id,
        name:        p.name || p.username || "Forged user",
        avatarUrl:   p.avatar_url,
        xp:          p.xp || 0,
        streak:      p.current_streak || 0,
        isPro:       !!p.is_pro,
        loggedToday: p.last_active_date === today,
        isMe:        id && p.id === id,
      }));
      setBetaLeaderboard(rows);

      // Total active beta testers (xp > 0) for the social-proof pill on the hero.
      try {
        const { count: totalActive } = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .gt("xp", 0);
        setBetaTotalCount(totalActive ?? null);
      } catch (e) {
        console.warn("[Forged] betaTotalCount:", e);
      }

      // If the current user isn't in the top 10, compute their rank separately
      // so we can still show "You're #47" under the board.
      if (id && !rows.some(r => r.isMe)) {
        const { data: me } = await supabase
          .from("profiles").select("xp").eq("id", id).maybeSingle();
        const myXp = me?.xp || 0;
        if (myXp > 0) {
          const { count } = await supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .gt("xp", myXp);
          setMyBetaRank((count ?? 0) + 1);
        } else {
          setMyBetaRank(null);
        }
      } else {
        const me = rows.find(r => r.isMe);
        setMyBetaRank(me ? me.rank : null);
      }
    } catch (e) {
      console.warn("[Forged] loadBetaLeaderboard:", e);
    } finally {
      setLeaderboardLoading(false);
    }
  }

  // Fetches a tiny feed of recent habit logs across public beta users.
  // Uses the `recent_beta_activity` RPC (security-definer; returns first-name + habit only).
  // If the RPC isn't present yet, we silently render nothing — no ticker is a safe fallback.
  async function loadBetaTicker() {
    if (betaTickerLoadedRef.current) return;
    betaTickerLoadedRef.current = true;
    try {
      const { data, error } = await supabase.rpc("recent_beta_activity", { p_limit: 3 });
      if (error) {
        console.warn("[Forged] recent_beta_activity RPC unavailable:", error.message || error);
        setBetaTicker([]);
        return;
      }
      const rows = Array.isArray(data) ? data : [];
      setBetaTicker(rows.map(r => ({
        firstName: r.first_name || "Someone",
        habitName: r.habit_name || "a habit",
        emoji: r.emoji || "",
        habitType: r.habit_type || "daily",
        streak: Number(r.streak) || 0,
        logDate: r.log_date || null,
      })));
    } catch (e) {
      console.warn("[Forged] loadBetaTicker:", e);
      setBetaTicker([]);
    }
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
      const handle = raw.replace(/^@+/, "").trim().toLowerCase();
      if (!handle) return { error: "Enter an @handle or email address." };
      const { data: profileRow, error: profErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", handle)
        .maybeSingle();
      if (profErr || !profileRow) {
        return { error: `No account found with @${handle}. They must set their handle in Profile → Social first.` };
      }
      targetId = profileRow.id;
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

  async function sendNudge(recipientId, message = "") {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { error: "Not signed in" };
      const res = await fetch("/api/nudge-friend", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ recipientId, type: "nudge", message: message || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 429) return { error: json.error || "Already nudged today" };
      if (!res.ok) return { error: json.error || "Couldn't send nudge" };
      return { success: true, ...json };
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

      const builtGoals = memberships.map(m => {
        const goal = goalById[m.shared_goal_id];
        if (!goal) return null;
        const roster = rosterByGoalId[m.shared_goal_id] || [];
        const myRowLogs = m.logs || [];
        const rosterUid = mem => mem.user_id ?? mem.userId ?? mem.userid;
        let members = roster.map(mem => {
          const uid = rosterUid(mem);
          return {
            userId: uid,
            name: mem.name || "Member",
            avatarUrl: mem.avatar_url ?? mem.avatarUrl,
            // Roster RPC can disagree with shared_goal_members; Today-linked truth is m.logs for the current user.
            logs: sameUserId(uid, id) ? myRowLogs : (mem.logs || []),
            isMe: sameUserId(uid, id),
          };
        });
        if (!members.some(mem => mem.isMe)) {
          members = [
            ...members,
            { userId: id, name: "You", avatarUrl: undefined, logs: myRowLogs, isMe: true },
          ];
        }
        // Sort key: max log date across all members, falling back to joined_at so brand-new goals
        // don't get buried under stale ones before anyone has logged.
        let lastActiveKey = "";
        for (const mem of members) {
          for (const l of mem.logs || []) {
            const d = typeof l?.date === "string" ? l.date : "";
            if (d && d > lastActiveKey) lastActiveKey = d;
          }
        }
        if (!lastActiveKey && m.joined_at) {
          const s = String(m.joined_at);
          lastActiveKey = s.length >= 10 ? s.slice(0, 10) : "";
        }
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
          _lastActiveKey: lastActiveKey,
        };
      }).filter(Boolean);
      // Most-recently-active first; stable ordering for ties.
      builtGoals.sort((a, b) => {
        const ka = a._lastActiveKey || "";
        const kb = b._lastActiveKey || "";
        if (kb !== ka) return kb.localeCompare(ka);
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      // Strip internal sort key before exposing goals to the UI.
      setSharedGoals(builtGoals.map(({ _lastActiveKey, ...rest }) => rest));
    } catch (e) {
      console.warn("[Forged] loadSharedGoals:", e);
    } finally {
      setSharedGoalsLoading(false);
    }
  }

  async function loadSharedGoalInvites(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    try {
      const { data: invites } = await supabase
        .from("shared_goal_invites")
        .select("id, goal_id, invite_code, inviter_id, goal_name, goal_emoji, inviter_name, created_at")
        .eq("invitee_id", id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setSharedGoalInvites(invites || []);
    } catch (e) {
      console.warn("[Forged] loadSharedGoalInvites:", e);
    }
  }

  async function acceptSharedGoalInvite(invite) {
    const result = await joinSharedGoal(invite.invite_code);
    await supabase.from("shared_goal_invites").update({ status: "accepted" }).eq("id", invite.id);
    setSharedGoalInvites(prev => prev.filter(i => i.id !== invite.id));
    if (result?.error) {
      addToast(`Couldn't join goal: ${result.error}`);
      return;
    }
    const goalData = result?.goal;
    if (goalData) {
      // Auto-create a linked personal habit so the joiner can sync from Today page
      await createLinkedHabit(goalData);
      addToast(`✓ Joined "${goalData.name}" — added to your Today page`);
    } else {
      addToast(`✓ Joined "${invite.goal_name || "shared goal"}" — check Social for details`);
    }
  }

  async function declineSharedGoalInvite(inviteId) {
    await supabase.from("shared_goal_invites").update({ status: "declined" }).eq("id", inviteId);
    setSharedGoalInvites(prev => prev.filter(i => i.id !== inviteId));
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
      const ht = normalizeSharedGoalHabitType(habitType || "daily");
      const wt = ht === "weekly"
        ? Math.min(7, Math.max(1, Number(weeklyTarget) || 3))
        : null;
      const { data: goal, error } = await supabase.from("shared_goals")
        .insert({ creator_id: uid, name: name.trim(), emoji: emoji || "🎯",
          habit_type: ht, weekly_target: wt,
          color: color || "#C0392B" })
        .select().single();
      if (error || !goal) {
        console.error("[Forged] createSharedGoal:", error);
        addToast(error?.message ? `Couldn't create goal — ${error.message}` : "Couldn't create goal");
        return null;
      }
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
      if (!habit || habit.habitType === "log" || habit.sharedGoalId) return null;
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
      const linked = { ...habit, sharedGoalId: newGoal.id };
      setHabits(prev => prev.map(h => h.id === habitId ? { ...h, sharedGoalId: newGoal.id } : h));
      await pushSharedMemberProgressFromLinked(linked);
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
    const habit = habits.find(h => h.id === habitId);
    if (!habit || habit.habitType === "log") return;
    // If this habit is already linked to a shared goal, just open invite picker for it
    if (habit.sharedGoalId) {
      setPendingInviteGoalId(habit.sharedGoalId);
      setScreen("social");
      return;
    }
    // Create a new shared goal linked to this habit
    const goal = await shareHabit(habitId);
    if (!goal) return;
    setPendingInviteGoalId(goal.id);
    setScreen("social");
    addToast("✓ Goal shared — invite your friends below");
  }

  async function handleShareGoal(goalId) {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    // Already shared — open invite picker
    if (goal.sharedGoalId) {
      setPendingInviteGoalId(goal.sharedGoalId);
      setScreen("social");
      return;
    }
    // Create a new shared goal linked to this goal
    const uid = userIdRef.current;
    if (!uid) return;
    const newSharedGoal = await createSharedGoal({
      name:        goal.name,
      emoji:       goal.emoji || "🎯",
      habitType:   "goal",
      weeklyTarget: null,
      color:       goal.color || "#E67E22",
    });
    if (!newSharedGoal) return;
    // Link the goal row to the new shared goal
    const { error } = await supabase
      .from("habits")
      .update({ shared_goal_id: newSharedGoal.id })
      .eq("id", goal.id);
    if (error) {
      console.error("[Forged] handleShareGoal link:", error);
      addToast("Couldn't link goal — try again");
      return;
    }
    const linkedGoal = { ...goal, sharedGoalId: newSharedGoal.id };
    setGoals(prev => prev.map(g => g.id === goalId ? { ...g, sharedGoalId: newSharedGoal.id } : g));
    await pushSharedMemberProgressFromLinked(linkedGoal);
    setPendingInviteGoalId(newSharedGoal.id);
    setScreen("social");
    addToast("✓ Goal shared — invite your friends below");
  }

  async function joinSharedGoal(inviteCode) {
    const uid = userIdRef.current;
    if (!uid) return { error: "Not signed in" };
    // Use SECURITY DEFINER RPC to bypass RLS — non-members can't read shared_goals directly
    const { data: result, error: rpcErr } = await supabase.rpc("join_shared_goal_by_code", { p_code: inviteCode });
    if (rpcErr) {
      console.error("[Forged] join_shared_goal_by_code:", rpcErr);
      return { error: "Failed to join goal — try again" };
    }
    if (result?.error) return { error: result.error };
    await loadSharedGoals(uid);
    return {
      success: true,
      goal: {
        id:          result.goal_id,
        name:        result.name,
        emoji:       result.emoji,
        habitType:   result.habit_type,
        weeklyTarget:result.weekly_target,
        color:       result.color,
      },
    };
  }

  /** Auto-creates a personal habit linked to a shared goal so the joiner can sync from Today page */
  async function createLinkedHabit(goalData) {
    const uid = userIdRef.current;
    if (!uid || !goalData?.id) return null;
    // Don't create a duplicate if the user already has a habit linked to this shared goal
    if (habits.some(h => h.sharedGoalId === goalData.id)) return null;
    const newHabit = {
      id:          crypto.randomUUID(),
      name:        goalData.name,
      emoji:       goalData.emoji || "🎯",
      habitType:   goalData.habitType || "daily",
      weeklyTarget:goalData.weeklyTarget ?? null,
      color:       goalData.color || "#C0392B",
      sharedGoalId:goalData.id,
      logs:        [],
      streak:      0,
      bestStreak:  0,
      reflection:  true,
      reflectionPrompt: "",
      tapIncrement:1,
      dailyTargetMinutes: 60,
    };
    const { error } = await supabase.from("habits").insert(habitToRow(newHabit, uid));
    if (error) {
      console.error("[Forged] createLinkedHabit:", error);
      return null;
    }
    setHabits(prev => [...prev, newHabit]);
    await pushSharedMemberProgressFromLinked(newHabit);
    return newHabit;
  }

  /**
   * Writes shared_goal_members.logs from the linked personal habit/goal (Today is source of truth).
   * Call after every successful habits upsert for linked rows and on initial load.
   */
  async function pushSharedMemberProgressFromLinked(linked) {
    if (demoMode || !linked?.sharedGoalId) return;
    const uid = userIdRef.current;
    if (!uid) return;
    const projected = projectPersonalLogsForSharedMember(linked);
    const { data: member, error: selErr } = await supabase
      .from("shared_goal_members")
      .select("id")
      .eq("shared_goal_id", linked.sharedGoalId)
      .eq("user_id", uid)
      .maybeSingle();
    if (selErr) {
      console.warn("[Forged] pushSharedMemberProgressFromLinked select:", selErr.message);
      return;
    }
    if (!member) {
      console.warn("[Forged] pushSharedMemberProgressFromLinked: no membership row for shared goal", linked.sharedGoalId);
      return;
    }
    const { error: upErr } = await supabase
      .from("shared_goal_members")
      .update({ logs: projected })
      .eq("id", member.id);
    if (upErr) {
      console.warn("[Forged] pushSharedMemberProgressFromLinked update:", upErr.message);
      return;
    }
    setSharedGoals(prev => prev.map(g => {
      if (String(g.id) !== String(linked.sharedGoalId)) return g;
      const list = g.members || [];
      const mapped = list.map(m =>
        sameUserId(m.userId, uid) ? { ...m, logs: projected, isMe: true } : { ...m }
      );
      const members = mapped.some(m => sameUserId(m.userId, uid))
        ? mapped
        : [...mapped, { userId: uid, name: "You", avatarUrl: undefined, logs: projected, isMe: true }];
      return { ...g, myLogs: projected, members };
    }));
    syncLastActive();
    // Defer refetch so PostgREST returns the committed `logs` json (immediate fetch can race the update).
    setTimeout(() => { void loadSharedGoals(uid); }, 400);
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
      if (habit.sharedGoalId) await pushSharedMemberProgressFromLinked(habit);
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
      if (goal.sharedGoalId) await pushSharedMemberProgressFromLinked(goal);
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

  async function handleSaveJournalEntry(date, content) {
    const uid = userIdRef.current;
    if (!uid || !date || !content?.trim()) return;
    const { data, error } = await supabase
      .from("journal_entries")
      .upsert({ user_id: uid, date, content: content.trim(), updated_at: new Date().toISOString() }, { onConflict: "user_id,date" })
      .select()
      .single();
    if (error) {
      console.error("[Forged] saveJournalEntry:", error.message);
      addToast("⚠️ Couldn't save journal entry");
      return;
    }
    // Update local state (upsert by date)
    setJournalEntries(prev => {
      const exists = prev.some(e => e.date === date);
      if (exists) return prev.map(e => e.date === date ? { ...e, content, updated_at: data.updated_at } : e);
      return [data, ...prev].sort((a, b) => b.date.localeCompare(a.date));
    });
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
      // 18 s: mobile cold-start PostgREST connections commonly take 10-15 s
      // on first open after the device woke from background.
      const FETCH_MS = 18000;
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

        // Load journal entries (non-fatal — failure doesn't block the app)
        supabase.from("journal_entries").select("id, date, content, created_at, updated_at")
          .eq("user_id", uid).order("date", { ascending: false })
          .then(({ data: jRows }) => {
            if (jRows) setJournalEntries(jRows);
          });
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
        // If this account is linked to a coach, fetch the coach's display name
        // so we can show it in the "Coached by" card instead of generic text.
        let linkedCoachName = null;
        if (profile.coach_id) {
          try {
            const { data: coachProf } = await supabase
              .from("profiles").select("name").eq("id", profile.coach_id).maybeSingle();
            linkedCoachName = coachProf?.name?.trim() || null;
          } catch { /* non-critical — silently skip */ }
        }

        setUser({
          id: profile.id,
          name: profile.name || "",
          avatarUrl: profile.avatar_url || null,
          username: profile.username || "",
          visibleToFriendsOfFriends: !!profile.visible_to_friends_of_friends,
          coachId: profile.coach_id || null,
          linkedCoachName,
        });
        setXp(profile.xp ?? 0);
        const proStatus = !!(profile.is_pro || profile.is_admin);
        setIsPro(proStatus);
        setIsAdmin(!!profile.is_admin);
        setIsCoach(!!profile.is_coach);
        setCoachTier(profile.coach_tier || null);
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
        const linkedPushers = [
          ...nextHabits.filter(h => h.sharedGoalId).map(h => () => pushSharedMemberProgressFromLinked(h)),
          ...nextGoals.filter(g => g.sharedGoalId).map(g => () => pushSharedMemberProgressFromLinked(g)),
        ];
        if (linkedPushers.length) await Promise.all(linkedPushers.map(fn => fn()));
      }

      userIdRef.current = uid;
      accountDataLoadedRef.current = true;
      setAccountLoadError(false);
      setAccountDataReady(true);
      // Clear the reload counter so a future session can self-heal again.
      try { sessionStorage.removeItem("forged_reload_count"); } catch { /* ignore */ }
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

  async function loadUserDataWithRetries(uid, source = "unknown", options = {}) {
    const skipDedupe = options.skipDedupe === true;
    // Dedupe concurrent loads for the same uid (e.g. INITIAL_SESSION + SIGNED_IN). Manual "Retry" must bypass
    // this or it re-awaits the same stuck promise and appears to do nothing until a full page refresh.
    if (!skipDedupe && retryLoadPromiseRef.current && retryLoadUidRef.current === uid) {
      return retryLoadPromiseRef.current;
    }

    retryLoadUidRef.current = uid;
    const loadPromise = (async () => {
    // First attempt fires immediately — INITIAL_SESSION already guarantees the
    // auth token is fully settled by the time we get here. Subsequent retries
    // use exponential backoff in case of transient network/PostgREST hiccups.
    const backoffs = [0, 1500, 3000, 6000, 10000];
    for (let attempt = 0; attempt < backoffs.length; attempt++) {
      if (backoffs[attempt] > 0) await new Promise(r => setTimeout(r, backoffs[attempt]));
      if (attempt > 0) console.log(`[Forged] loadUserData retry ${attempt}/${backoffs.length - 1} (${source})`);
      if (await loadUserData(uid)) {
        return true;
      }
    }
    console.error("[Forged] loadUserDataWithRetries: all attempts failed for uid", uid?.slice(0, 8), source);
    return false;
    })();
    retryLoadPromiseRef.current = loadPromise;

    try {
      return await loadPromise;
    } finally {
      if (retryLoadPromiseRef.current === loadPromise) {
        retryLoadPromiseRef.current = null;
        retryLoadUidRef.current = null;
      }
    }
  }

  async function retryAccountDataLoad() {
    setAccountLoadError(false);
    autoRetryFiredRef.current = true; // prevent auto-retry from re-triggering
    setLoading(true);
    try {
      loadingUidRef.current = null;
      retryLoadPromiseRef.current = null;
      retryLoadUidRef.current = null;
      const { data: { session: preRefreshSession }, error: preSessionErr } = await supabase.auth.getSession();
      if (preSessionErr) console.warn("retryAccountDataLoad: getSession -", preSessionErr.message);
      const initialUid = preRefreshSession?.user?.id || sessionUserId;
      if (!initialUid) {
        setAuthScreen(true);
        return;
      }
      setSessionUserId(initialUid);
      if (preRefreshSession?.user?.email) setAuthEmail(preRefreshSession.user.email);

      const { error: refErr } = await supabase.auth.refreshSession();
      if (refErr) console.warn("retryAccountDataLoad: refreshSession -", refErr.message);
      const { data: { session: postRefreshSession }, error: postSessionErr } = await supabase.auth.getSession();
      if (postSessionErr) console.warn("retryAccountDataLoad: post-refresh getSession -", postSessionErr.message);
      const retryUid = postRefreshSession?.user?.id || initialUid;
      const ok = await loadUserDataWithRetries(retryUid, "manual-retry", { skipDedupe: true });
      if (ok) {
        setAuthScreen(false);
      } else {
        // In-app retry failed. A page reload is guaranteed to work because by
        // now the token is fresh in localStorage and a new Supabase client
        // instance starts clean. Guard against reload loops via sessionStorage.
        const reloadCount = parseInt(sessionStorage.getItem("forged_reload_count") || "0", 10);
        if (reloadCount < 2) {
          console.log("[Forged] retryAccountDataLoad: in-app retry failed, reloading (attempt", reloadCount + 1, ")");
          sessionStorage.setItem("forged_reload_count", String(reloadCount + 1));
          window.location.reload();
          return;
        }
        // Reload limit reached — persistent failure. Show error UI.
        console.error("[Forged] retryAccountDataLoad: reload limit reached, showing error UI");
        setAccountLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }

  // Soft in-app session recovery — used by the loading-screen "try again"
  // button and by an automatic watchdog when INITIAL_SESSION never arrives.
  // Tries hard to recover the session in-place before falling back to a hard
  // page reload. This is the "what a manual refresh actually fixes" path.
  async function attemptSoftSessionRecovery(reason = "manual") {
    if (softRecoveryInFlightRef.current) return;
    softRecoveryInFlightRef.current = true;
    try {
      // 1. Probe storage for an existing session (covers the case where
      //    INITIAL_SESSION fired before our listener was wired up, or fired
      //    with null while storage was still hydrating on mobile browsers).
      let { data: { session } } = await supabase.auth.getSession();

      // 2. If no session yet, try to refresh — Supabase may have a refresh
      //    token in storage even when the access token is expired. This is
      //    exactly the path a hard reload takes implicitly.
      if (!session?.user?.id) {
        try {
          await supabase.auth.refreshSession();
        } catch (e) {
          console.warn("[Forged] soft recovery: refreshSession failed —", e?.message || e);
        }
        const probe = await supabase.auth.getSession();
        session = probe?.data?.session || null;
      }

      if (!session?.user?.id) {
        // No session at all — go to the auth screen instead of an infinite
        // spinner. (A genuine signed-out state.)
        console.warn(`[Forged] soft recovery (${reason}): no session, routing to auth`);
        setLoading(false);
        setAuthScreen(true);
        return;
      }

      // 3. Session exists — kick the loader. skipDedupe so we never await a
      //    promise that's already stuck.
      const uid = session.user.id;
      if (session.user.email) setAuthEmail(session.user.email);
      setSessionUserId(uid);
      lastSignedInUidRef.current = uid;
      initialAuthHandledRef.current = true;
      loadingUidRef.current = null;
      retryLoadPromiseRef.current = null;
      retryLoadUidRef.current = null;
      accountDataLoadedRef.current = false;
      setAccountDataReady(false);
      setAccountLoadError(false);
      userIdRef.current = null;

      const ok = await loadUserDataWithRetries(uid, `soft-recovery:${reason}`, { skipDedupe: true });
      if (ok) {
        setAuthScreen(false);
        setAccountLoadError(false);
      } else {
        // Loader couldn't finish — show the friendlier retry surface rather
        // than the bare loading spinner.
        setAccountLoadError(true);
      }
      setLoading(false);
    } catch (e) {
      console.warn(`[Forged] soft recovery (${reason}) threw —`, e?.message || e);
      // Last resort: a hard reload (matches old behavior for safety).
      try { window.location.reload(); } catch {}
    } finally {
      softRecoveryInFlightRef.current = false;
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
          // 60 s: with 18 s per query (profile + habits = 36 s max per attempt)
          // we need at least 37 s to let one full attempt complete. 60 s gives
          // room for a full attempt plus one backoff + second attempt.
          const LOAD_BUDGET_MS = 60000;
          const loadBudgetTimer = setTimeout(() => {
            if (!mounted) return;
            console.warn("Auth: account load exceeded budget — unblocking UI (use Retry if needed)");
            loadingUidRef.current = null;
            setLoading(false);
            setAuthScreen(false);
            if (session?.user?.id) setAccountLoadError(true);
          }, LOAD_BUDGET_MS);

          initialAuthHandledRef.current = true;
          // When set to true inside the try block, the finally skips setLoading(false)
          // so the loading spinner stays visible while waiting for TOKEN_REFRESHED.
          let waitingForTokenRefresh = false;
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
              // iOS/Android home-screen PWAs: Supabase's internal token refresh fires
              // asynchronously, so INITIAL_SESSION(null) can arrive before the refresh
              // completes. Do NOT call refreshSession() explicitly here — it races with
              // Supabase's own internal refresh and can leave the client in a state where
              // PostgREST queries return 401s or time out even with a valid session.
              // Instead, probe getSession() once (instant if refresh already completed)
              // and fall through to hasStoredSupabaseSession() if the token is still
              // being refreshed internally.
              if (isLikelyHomeScreenPwa()) {
                const { data: { session: pwaRecovered }, error: pwaRecErr } = await supabase.auth.getSession();
                if (pwaRecErr) console.warn("Auth: PWA getSession probe:", pwaRecErr.message);
                if (pwaRecovered?.user?.id) {
                  if (pwaRecovered.user.email) setAuthEmail(pwaRecovered.user.email);
                  setSessionUserId(pwaRecovered.user.id);
                  setAccountLoadError(false);
                  accountDataLoadedRef.current = false;
                  setAccountDataReady(false);
                  userIdRef.current = null;
                  const ok = await loadUserDataWithRetries(pwaRecovered.user.id, "INITIAL_SESSION_PWA_PROBE");
                  if (!mounted) return;
                  if (ok) setAccountLoadError(false);
                  else setAccountLoadError(true);
                  setAuthScreen(false);
                  return;
                }
                // Session still null (Supabase refresh still in progress) — fall through
                // to hasStoredSupabaseSession() and wait for TOKEN_REFRESHED.
              }
              // ── Stored-session check ─────────────────────────────────────
              // INITIAL_SESSION fires null when the stored access token is expired
              // and Supabase is mid-refresh. On the live/deployed app this is the
              // normal first-load path for ANY returning user (1h token TTL).
              // If we detect stored session tokens, stay on the loading screen and
              // let TOKEN_REFRESHED deliver the session rather than flashing demo data.
              if (hasStoredSupabaseSession()) {
                waitingForTokenRefresh = true;
                waitingForTokenRefreshRef.current = true; // tells watchdog to stay out
                setSessionUserId(null);
                setAccountLoadError(false);
                accountDataLoadedRef.current = false;
                setAccountDataReady(false);
                userIdRef.current = null;
                setDemoMode(false);
                setAuthScreen(false);
                // Safety net: if TOKEN_REFRESHED never fires within 20 s, give up and go to auth.
                // 20 s (was 12 s) to accommodate slow mobile token refresh round-trips.
                setTimeout(() => {
                  waitingForTokenRefreshRef.current = false;
                  if (!mounted || accountDataLoadedRef.current || loadingUidRef.current) return;
                  console.warn("Auth: TOKEN_REFRESHED did not arrive within 20s after stored-session detection");
                  setLoading(false);
                  setAuthScreen(true);
                }, 20000);
              } else {
                // No stored tokens → genuinely new or fully signed-out user.
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
            }
          } finally {
            clearTimeout(loadBudgetTimer);
            // Keep the loading screen visible when waiting for TOKEN_REFRESHED.
            if (mounted && !waitingForTokenRefresh) setLoading(false);
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
            loadingUidRef.current = null;
            setLoading(false);
            setAuthScreen(false);
            setAccountLoadError(true);
          }, 60000);
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
          setIsAdmin(false);
          setIsCoach(false);
          setPreviewCoach(false);
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
          waitingForTokenRefreshRef.current = false; // session delivered — watchdog can stand down
          lastSignedInUidRef.current = session.user.id;
          if (session.user.email && mounted) setAuthEmail(session.user.email);
          setSessionUserId(session.user.id);
          if (loadingUidRef.current === session.user.id) {
            return;
          }
          if (!accountDataLoadedRef.current) {
            setDemoMode(false);
            setHabits([]);
            setLoading(true);
            const tokenBudget = setTimeout(() => {
              if (!mounted) return;
              setLoading(false);
              setAuthScreen(false);
              setAccountLoadError(true);
            }, 60000);
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

  // ─── Soft self-heal watchdog ─────────────────────────────────────────────
  // When the loading screen sticks (INITIAL_SESSION dropped, slow token
  // refresh, mobile storage hydration race, etc.) the user used to be left
  // staring at a spinner with no recourse but a hard reload. Run one
  // automatic in-app session recovery at 15s — this matches what a manual
  // refresh would fix, but without losing app state.
  //
  // IMPORTANT: must not fire while waitingForTokenRefreshRef is true. Calling
  // refreshSession() during Supabase's own internal token refresh races with
  // that refresh and leaves the client in a confused state.
  useEffect(() => {
    if (!loading) return;
    if (softRecoveryAttemptedRef.current) return;
    const t = setTimeout(() => {
      // Back off if: a real load is in flight, we are waiting for
      // TOKEN_REFRESHED (Supabase is already refreshing internally), or another
      // watchdog already ran.
      if (loadingUidRef.current) return;
      if (waitingForTokenRefreshRef.current) return;
      if (softRecoveryAttemptedRef.current) return;
      softRecoveryAttemptedRef.current = true;
      attemptSoftSessionRecovery("watchdog-15s");
    }, 15000);
    return () => clearTimeout(t);
  }, [loading]);

  // ─── Auto-retry on accountLoadError ─────────────────────────────────────────
  // When the initial load fails (e.g. mobile cold-start PostgREST timeout),
  // automatically attempt one silent recovery 2 s later so the user never
  // has to tap anything. On mobile PWA there is no browser-level refresh
  // button, so the app MUST self-heal.
  // autoRetryFiredRef prevents this from looping if the retry also fails
  // (retryAccountDataLoad falls back to window.location.reload() in that case).
  useEffect(() => {
    if (!accountLoadError || !sessionUserId) return;
    if (autoRetryFiredRef.current) return;
    const t = setTimeout(() => {
      if (!accountLoadError || autoRetryFiredRef.current) return;
      retryAccountDataLoad();
    }, 2000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountLoadError, sessionUserId]);

  // ─── Session + data refresh on resume / bfcache ──────────────────────────────
  useEffect(() => {
    function runResumeLoad() {
      // Ignore visibilitychange that Chrome fires on initial page load (<5s since mount)
      const now = Date.now();
      if (now - mountTimeRef.current < 5000) return;
      if (now - lastResumeDataFetchRef.current < 5000) return;
      lastResumeDataFetchRef.current = now;
      (async () => {
        if (isLikelyHomeScreenPwa()) {
          await supabase.auth.refreshSession().catch(() => {});
        }
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

  // Catch-up: nudges received while offline (table + watermark; realtime handles live inserts).
  useEffect(() => {
    if (!sessionUserId || !accountDataReady) return;
    let cancelled = false;
    (async () => {
      try {
        let wm = readNudgeWatermark(sessionUserId);
        if (!wm) {
          const { data: latest, error: latestErr } = await supabase
            .from("nudges")
            .select("sent_at")
            .eq("recipient_id", sessionUserId)
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestErr) {
            writeNudgeWatermarkIfNewer(sessionUserId, new Date().toISOString());
            return;
          }
          const anchor = latest?.sent_at || new Date().toISOString();
          writeNudgeWatermarkIfNewer(sessionUserId, anchor);
          return;
        }
        const { data, error } = await supabase
          .from("nudges")
          .select("sender_name,message,sent_at")
          .eq("recipient_id", sessionUserId)
          .gt("sent_at", wm)
          .order("sent_at", { ascending: true });
        if (cancelled || error || !data?.length) return;
        let newest = wm;
        for (const row of data) {
          if (row.sent_at && row.sent_at > newest) newest = row.sent_at;
          const msg = row.message ? ` "${row.message}"` : "";
          addToast(`💪 ${row.sender_name || "Someone"} nudged you!${msg}`);
        }
        writeNudgeWatermarkIfNewer(sessionUserId, newest);
      } catch (e) {
        console.warn("[Forged] nudge catch-up:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionUserId, accountDataReady, addToast]);

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

  // ── First-time AI page guide: show once per page on first visit ──────────
  // This runs *before* the short per-nav nudge so we can suppress it when the
  // persistent guide is taking over. Persistence key is user-scoped so two
  // accounts on the same device don't collide.
  useEffect(() => {
    if (!coachNudgeShellActive) {
      setPageGuide(null);
      return;
    }
    if (!PAGE_GUIDE_PAGES.includes(screen)) {
      // Leaving a guided page — drop any active guide and mark the one we
      // were showing as seen so it doesn't come back on the next visit.
      setPageGuide(prev => {
        if (prev) writePageGuideSeen(sessionUserId, prev.page);
        return null;
      });
      return;
    }
    if (readPageGuideSeen(sessionUserId, screen)) {
      setPageGuide(null);
      return;
    }
    const text = buildPageGuideMessage(screen, { name: user?.name, habits, goals });
    if (!text) { setPageGuide(null); return; }
    setPageGuide({ page: screen, text });
  }, [screen, coachNudgeShellActive, sessionUserId, pageGuideReplayTick]);

  useEffect(() => {
    if (!coachNudgeShellActive) {
      setCoachPageNudge(null);
      return;
    }
    if (screen === "profile") {
      setCoachPageNudge(null);
      return;
    }
    // Suppress the short auto-hide nudge whenever the persistent first-time
    // guide is taking over — two bubbles in the same anchor is noise.
    if (pageGuide && pageGuide.page === screen) {
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
  }, [screen, coachNudgeShellActive, pageGuide]);

  async function completeOnboarding({ name, habits: newHabits, coachName: newCoachName, emailUpdatesOptIn }) {
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
    // Persist the final-screen "weekly updates by email" preference under the
    // same localStorage key the post-upgrade ProThankYouModal already uses, so
    // we have one source of truth when we wire an actual email sender later.
    if (typeof emailUpdatesOptIn === "boolean") {
      writeForgedBetaEmailOptIn(uid, emailUpdatesOptIn);
    }
  }

  // Public coach demo — no sign-in; exits back to auth or main shell
  if (!loading && publicCoachPreview) {
    return (
      <>
        <style>{CSS}</style>
        <CoachApp
          onExit={async () => {
            try {
              await supabase.auth.signOut();
            } catch {
              /* ignore */
            }
            setPublicCoachPreview(false);
            setAuthScreen(true);
          }}
          isPreview
          publicPreview
          coachTier={null}
          isAdmin={false}
          coachOwnName=""
        />
      </>
    );
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
      <AuthScreen
        onSent={email => setPendingEmail(email)}
        checkoutPending={localStorage.getItem('forged_checkout_pending') === '1'}
        onPreviewCoachWorkspace={() => setPublicCoachPreview(true)}
      /></>
    );
  }

  // Show loading screen
  if (loading) {
    return (
      <><style>{CSS}</style>
      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forged.</div>
        <div style={{ width:22, height:22, border:`2px solid ${T.border}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
        <div style={{ fontSize:12, color:T.hint, animation:"fadeIn 1s ease 8s both", textAlign:"center", lineHeight:1.6 }}>
          Taking longer than usual?<br/>
          <button onClick={() => attemptSoftSessionRecovery("loading-button")} style={{ background:"none", border:"none", color:T.muted, fontSize:12, cursor:"pointer", textDecoration:"underline", padding:0, marginTop:4 }}>Tap to retry</button>
        </div>
      </div></>
    );
  }

  // Signed in but profile/habits failed after automatic retry.
  // This screen is rarely seen — the auto-retry effect fires 2 s after
  // accountLoadError is set and retryAccountDataLoad falls back to
  // window.location.reload() if the in-app retry also fails. This UI is
  // only shown when the reload limit is reached (persistent server issue).
  if (!loading && !authScreen && sessionUserId && accountLoadError) {
    return (
      <><style>{CSS}</style>
      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 28px", textAlign:"center", gap:16 }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forged.</div>
        <div style={{ fontSize:15, color:T.muted, lineHeight:1.7 }}>
          Having trouble loading your account. Check your connection and tap below to try again.
        </div>
        <button type="button" onClick={() => retryAccountDataLoad()}
          style={{ padding:"14px 24px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer" }}>
          Try again
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
          <TodayScreen habits={habits} goals={goals} xp={0} onTap={handleTap} onUndo={() => {}} onSkip={() => {}} onAddNote={() => demoBounce()} onLogZero={() => demoBounce()} onOpenLog={() => demoBounce()} onOpenGoalLog={() => demoBounce()} onEditGoal={openEditGoal} onCompleteGoal={() => demoBounce()} onDeleteGoal={() => demoBounce()} onShareGoal={() => {}} onEditHabit={openEditHabit} onDeleteHabit={() => demoBounce()} onShareHabit={() => {}} sharingHabitId={null} onXPInfo={() => {}} onAdd={() => demoBounce()} onSaveLogEntry={async () => { demoBounce(); return false; }} hideFloatingAdd/>
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
        onSaveProgress={async ({ name, habits, coachName, emailUpdatesOptIn }) => {
          const uid = userIdRef.current;
          if (typeof emailUpdatesOptIn === "boolean") {
            writeForgedBetaEmailOptIn(uid, emailUpdatesOptIn);
          }
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
        isCoachClient={!!localStorage.getItem("forged_pending_coach")}
      /></>
    );
  }

  // Coach-client welcome — fires once after onboarding completes for users who
  // arrived via a coach invite link. Renders BEFORE the main app the very
  // first time only; dismissal stamps localStorage so this never reappears.
  if (
    !loading && !authScreen && accountDataReady && onboarded === true &&
    pendingCoachWelcome && !checkingPayment && !previewOnboarding
  ) {
    return (
      <><style>{CSS}</style>
      <CoachWelcomeScreen
        onDone={() => {
          try { localStorage.setItem("forged_coach_welcome_seen", "1"); } catch { /* noop */ }
          setPendingCoachWelcome(false);
        }}
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
    if (base.habitType === "log") return;
    let tapped = null;
    if (base.habitType === "limit") {
      const today = todayStr();
      const inc = base.tapIncrement ?? 1;
      const logsWithoutNoneToday = base.logs.filter(l => !(l.date === today && l.value === 0));
      tapped = { ...base, logs:[...logsWithoutNoneToday, { date:today, value:inc, note:"" }] };
    } else {
      const today = todayStr();
      const hasTrue = base.logs.some(l => l.date === today && l.value === true);
      // On untap, only remove the session marker (value:true). Replacing today's
      // row when adding a session avoids duplicate dates if a rest day (skip) exists.
      if (hasTrue) {
        tapped = { ...base, logs: base.logs.filter(l => !(l.date === today && l.value === true)) };
      } else {
        const logsNoToday = base.logs.filter(l => l.date !== today);
        tapped = { ...base, logs: [...logsNoToday, { date: today, value: true, note: "" }] };
      }
    }
    const saved = await syncHabit(tapped);
    if (!saved) return;
    setHabits(prev => prev.map(h => h.id === id ? tapped : h));
    syncLastActive();
    // Accountability sync: handled inside syncHabit → pushSharedMemberProgressFromLinked
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
    // Linked accountability sync runs inside syncHabit (full projection from personal logs).
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
    addToast(habit.habitType === "weekly"
      ? "🛡️ Weekly rest day — ring counts this; session tally unchanged"
      : "🛡️ Rest day — streak protected");
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

  /** Append a dated journal entry to a Log track (`habit_type: "log"`). */
  async function handleSaveLogEntry(id, text) {
    if (!text.trim()) return false;
    if (demoBounce()) return false;
    const habit = habits.find(h => h.id === id);
    if (!habit || habit.habitType !== "log") return false;
    const updated = { ...habit, logs: [...habit.logs, { date: todayStr(), value: "log", note: text.trim() }] };
    const saved = await syncHabit(updated);
    if (!saved) {
      addToast("⚠️ Couldn't save log — check your connection");
      return false;
    }
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    syncLastActive();
    addToast("✓ Log saved");
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

  function openCoachWithMode(mode) {
    try { localStorage.setItem("forged_coach_opened", "1"); } catch { /* ignore */ }
    setCoachEverOpened(true);
    setCoachOpenMode(mode);
    setShowCoach(true);
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

  /** Called when user confirms a <goal_plan> card from the AI coach chat. */
  async function handleGoalPlanConfirm(plan) {
    const milestones = (plan.milestones || [])
      .filter(m => m.date && m.label)
      .map((m, i) => ({
        type: "milestone",
        date: m.date,
        label: m.label,
        id: `ms_${Date.now()}_${i}`,
      }));
    const whyEntry = plan.why
      ? [{ type: "goal_why", label: plan.why, id: `why_${Date.now()}` }]
      : [];
    const goal = {
      id: `${Date.now()}.${Math.floor(Math.random() * 1000)}`,
      name: plan.name,
      emoji: plan.emoji || "🎯",
      habitType: "goal",
      unit: plan.unit || "",
      startValue: Number(plan.startValue ?? 0),
      targetValue: Number(plan.targetValue),
      currentValue: Number(plan.startValue ?? 0),
      direction: plan.direction || "increasing",
      targetDate: plan.targetDate || null,
      status: "active",
      logs: [...milestones, ...whyEntry],
      color: plan.color || "#E67E22",
    };
    const saved = await syncGoal(goal);
    if (!saved) throw new Error("Save failed");
    setGoals(prev => [...prev, goal]);
    addToast(`✓ Goal "${plan.name}" created`);
  }

  /** Save a weekly check-in (emoji rating 1-5) for a goal. */
  async function handleGoalCheckin(goalId, rating, note) {
    const goal = resolveGoalForModal(goalId, goals, habits);
    if (!goal) return;
    const weekStart = weekStartFor(todayStr());
    // Replace any existing checkin for this week, keep all other log entries
    const otherLogs = (goal.logs || []).filter(l => !(l.type === "checkin" && l.date === weekStart));
    const newCheckin = { type: "checkin", date: weekStart, rating, note: note || "", id: `ci_${Date.now()}` };
    const updated = { ...goal, logs: [...otherLogs, newCheckin] };
    const saved = await syncGoal(updated);
    if (!saved) { addToast("⚠️ Couldn't save check-in"); return; }
    setGoals(prev => prev.map(g => entityIdEq(g.id, goalId) ? updated : g));
  }

  /** Update the habit IDs linked to a goal (stored as a goal_links log entry). */
  async function handleGoalLinkHabits(goalId, habitIds) {
    const goal = resolveGoalForModal(goalId, goals, habits);
    if (!goal) return;
    const otherLogs = (goal.logs || []).filter(l => l.type !== "goal_links");
    const linksEntry = { type: "goal_links", habitIds: habitIds.map(String), id: `gl_${Date.now()}` };
    const updated = { ...goal, logs: [...otherLogs, linksEntry] };
    const saved = await syncGoal(updated);
    if (!saved) { addToast("⚠️ Couldn't save linked habits"); return; }
    setGoals(prev => prev.map(g => entityIdEq(g.id, goalId) ? updated : g));
    addToast(`✓ Linked habits updated`);
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
    setPublicCoachPreview(false);
    setPreviewCoach(false);
    // onAuthStateChange will fire SIGNED_OUT and handle all state resets
    await supabase.auth.signOut();
  }

  // ── Coach workspace early return ────────────────────────────────────────────
  // Real coaches (is_coach=true, is_admin=false) always see the coach shell.
  // Admins can preview it from dev tools; they keep their consumer app otherwise.
  if ((isCoach && !isAdmin) || previewCoach) {
    return (
      <>
        <style>{CSS}</style>
        {toasts.map(t => <Toast key={t.id} msg={t.msg} onDone={() => setToasts(ts => ts.filter(x => x.id !== t.id))}/>)}
        <CoachApp
          onExit={previewCoach ? () => setPreviewCoach(false) : null}
          isPreview={!!previewCoach}
          publicPreview={false}
          coachTier={coachTier}
          isAdmin={isAdmin}
          coachOwnName={user.name || ""}
        />
      </>
    );
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

      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, paddingBottom:172 }}>
        {/* Top bar */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"22px 18px 8px" }}>
          <div>
            <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:1, lineHeight:1.35 }}>
              {screen === "today"
                ? fmtDateLong()
                : screen === "profile" ? user.name
                : screen.charAt(0).toUpperCase()+screen.slice(1)}
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
        {screen === "today"    && <TodayScreen    habits={habits} goals={goals} xp={xp} onTap={handleTap} onUndo={handleUndoLimit} onSkip={handleSkipDay} onAddNote={handleAddNote} onLogZero={handleLogZero} onOpenLog={id => setLogId(id)} onOpenGoalLog={id => setLogGoalId(id)} onEditGoal={openEditGoal} onCompleteGoal={handleCompleteGoal} onDeleteGoal={handleDeleteGoal} onShareGoal={handleShareGoal} onEditHabit={openEditHabit} onDeleteHabit={handleDeleteHabit} onShareHabit={handleShareHabit} sharingHabitId={sharingHabitId} onXPInfo={() => setShowXP(true)} onAdd={handleStartAdd} onSaveLogEntry={handleSaveLogEntry} coachEverOpened={coachEverOpened} onOpenCoachMic={() => openCoachWithMode("mic")} coachName={coachName} coachIcon={coachIcon} coachHabitColor={habits.find(h => h.habitType !== "log")?.color || T.accent} hideFloatingAdd onOpenGoalDetail={id => setOpenGoalId(id)}/>}
        {screen === "journal"  && <JournalScreen habits={habits} goals={goals} onReflect={setReflectId} onDeleteJournalLog={handleDeleteJournalLogEntry} journalUserId={sessionUserId} isPro={isPro} onUpgrade={() => setShowUpgrade(true)} journalEntries={journalEntries} onSaveJournalEntry={handleSaveJournalEntry} initialTab={showJournalCompose ? "journal" : undefined} onInitialComposeDone={() => setShowJournalCompose(false)}/>}
        {screen === "insights" && <InsightsScreen habits={habits} goals={goals} journalEntries={journalEntries} onShowHistory={() => setShowHistory(true)} onShare={() => setShowShare(true)} isPro={isPro} onUpgrade={() => setShowUpgrade(true)} userId={sessionUserId} userName={user.name || ""}/>}
        {screen === "social"   && <SocialScreen
          user={user} xp={xp} habits={habits}
          friends={friends} friendRequests={friendRequests} sentRequests={sentRequests} friendsLoading={friendsLoading}
          onSendRequest={sendFriendRequest} onAccept={acceptFriendRequest}
          onDecline={declineFriendRequest} onRemoveFriend={removeFriend} onCancelSentRequest={cancelFriendRequest}
          sharedGoals={sharedGoals} sharedGoalsLoading={sharedGoalsLoading}
          sharedGoalInvites={sharedGoalInvites}
          onAcceptGoalInvite={acceptSharedGoalInvite}
          onDeclineGoalInvite={declineSharedGoalInvite}
          currentUserId={sessionUserId}
          onDeleteSharedGoal={deleteSharedGoal}
          onNudgeFriend={sendNudge}
          onShareHabit={handleShareHabit}
          sharingHabitId={sharingHabitId}
          onToast={addToast}
          pendingInviteGoalId={pendingInviteGoalId}
          onClearPendingInvite={() => setPendingInviteGoalId(null)}
          betaLeaderboard={betaLeaderboard}
          leaderboardLoading={leaderboardLoading}
          myBetaRank={myBetaRank}
          betaTotalCount={betaTotalCount}
          betaTicker={betaTicker}
          isPro={isPro}
          onUpgrade={() => setShowUpgrade(true)}
        />}
        {screen === "profile"  && <ProfileScreen  user={user} xp={xp} habits={habits} isPro={isPro} isCoach={isCoach} stripeCustomerId={stripeCustomerId} refCode={refCode}
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
          onPreviewCoach={() => setPreviewCoach(true)}
          onPreviewCoachWorkspace={() => setPreviewCoach(true)}
          onReplayPageGuides={() => {
            // Dev-only: wipe the 4 page-guide seen flags so the first-time
            // AI bubble re-triggers on next visit to Today/Journal/Insights/
            // Social. Does not touch any user data. Scoped to the current
            // user id so other accounts on this device are unaffected. The
            // replay tick forces the guide effect to re-run even if we're
            // already on a guided screen.
            clearAllPageGuideSeen(sessionUserId);
            setPageGuide(null);
            setScreen("today");
            setPageGuideReplayTick(t => t + 1);
            addToast("AI page tour reset — visit Today, Journal, Insights, Social");
          }}
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
          dailyRemindersEnabled={dailyRemindersEnabled}
          nudgesEnabled={nudgesEnabled}
          invitesEnabled={invitesEnabled}
          onNotifToggle={handleNotifToggle}
          onNotifTimeChange={handleNotifTimeChange}
          onNotifCategoryChange={handleNotifCategoryChange}
        />}

        {/* Coach bar above nav (+ page guide / nudge / Today add). Hidden on Profile and while coach sheet open. */}
        {screen !== "profile" && (() => {
          const coachLabelRaw = (coachName ?? "").trim() || "Coach";
          const coachLabelShort = coachLabelRaw.length > 13 ? `${coachLabelRaw.slice(0, 12)}…` : coachLabelRaw;
          const showTodayAdd =
            screen === "today" &&
            (habits.length > 0 || goals.some(g => g.status !== "completed"));
          const habitColor = habits.find(h => h.habitType !== "log")?.color || T.accent;
          const showCoachBar =
            !showCoach && ["today", "journal", "insights", "social"].includes(screen);
          const safeBottom = "env(safe-area-inset-bottom, 0px)";
          const aboveNav = `calc(62px + ${safeBottom})`;
          const aboveCoachBar = `calc(132px + ${safeBottom})`;
          return (
            <>
              {!showCoach && (pageGuide?.page === screen || coachPageNudge) ? (
                <div
                  style={{
                    position:"fixed",
                    left:14,
                    bottom:aboveCoachBar,
                    zIndex:102,
                    display:"flex",
                    flexDirection:"row",
                    alignItems:"flex-end",
                    justifyContent:"flex-start",
                    gap:10,
                    maxWidth:"calc(100vw - 28px)",
                  }}
                >
                  {pageGuide && pageGuide.page === screen ? (
                    <div
                      key={`guide-${pageGuide.page}`}
                      role="dialog"
                      aria-label="Coach tip"
                      style={{
                        position:"relative",
                        maxWidth:260,
                        padding:"11px 30px 12px 14px",
                        borderRadius:"14px 14px 14px 4px",
                        background:"rgba(24,24,22,0.98)",
                        backdropFilter:"blur(12px)",
                        WebkitBackdropFilter:"blur(12px)",
                        border:"0.5px solid rgba(200,144,42,0.45)",
                        boxShadow:"0 6px 26px rgba(0,0,0,0.5)",
                        fontSize:12.5,
                        lineHeight:1.55,
                        color:T.text,
                        textAlign:"left",
                        animation:"coachGuideIn 0.42s cubic-bezier(0.22,1,0.36,1) both",
                        flexShrink:1,
                      }}
                    >
                      <div style={{
                        fontSize:9, fontWeight:700, color:T.gold,
                        textTransform:"uppercase", letterSpacing:"0.1em",
                        marginBottom:4,
                      }}>
                        {coachLabelShort}
                      </div>
                      <div>{pageGuide.text}</div>
                      <button
                        type="button"
                        onClick={() => {
                          writePageGuideSeen(sessionUserId, pageGuide.page);
                          setPageGuide(null);
                        }}
                        aria-label="Dismiss coach tip"
                        style={{
                          position:"absolute",
                          top:4, right:4,
                          width:22, height:22,
                          borderRadius:"50%",
                          border:"none",
                          background:"transparent",
                          color:T.muted,
                          fontSize:15,
                          lineHeight:1,
                          cursor:"pointer",
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ) : coachPageNudge ? (
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
                  ) : null}
                </div>
              ) : null}
              {showTodayAdd && (
                <button
                  type="button"
                  onClick={handleStartAdd}
                  aria-label="Add habit or goal"
                  title="Add habit or goal"
                  style={{
                    position:"fixed",
                    right:14,
                    bottom:aboveCoachBar,
                    zIndex:102,
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
              {showCoachBar ? (
                <div
                  style={{
                    position:"fixed",
                    left:"50%",
                    transform:"translateX(-50%)",
                    width:"100%",
                    maxWidth:430,
                    bottom:aboveNav,
                    zIndex:101,
                    padding:"0 10px 0",
                    boxSizing:"border-box",
                  }}
                >
                  <CoachBar
                    coachName={coachName}
                    coachIcon={coachIcon}
                    habitColor={habitColor}
                    onOpenMic={() => {
                      // Non-Pro: fall through to AICoach which handles paywall
                      if (!isPro) { openCoachWithMode("mic"); return; }
                      // Page mic: record on current page; handoff when user stops (see pageSpeech effect)
                      if (pageSpeech.supported) {
                        if (!pageSpeech.listening) pageDictationAccumulatorRef.current = "";
                        pageSpeech.toggle();
                      } else {
                        openCoachWithMode("mic"); // fallback if speech API unavailable
                      }
                    }}
                    onOpenText={() => openCoachWithMode("text")}
                    coachEverOpened={coachEverOpened}
                    isListening={pageSpeech.listening}
                    listeningInterim={pageSpeech.interim || ""}
                  />
                </div>
              ) : null}
            </>
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
      {showAddLog    && <AddLogModal   onClose={() => setShowAddLog(false)} onSave={async h => {
        if (demoBounce()) return;
        const saved = await syncHabit(h);
        if (!saved) {
          addToast("⚠️ Couldn't add log — check your connection");
          return;
        }
        setHabits(p => [...p, h]);
        setShowAddLog(false);
        addToast("✓ Log added");
      }}/>}
      {showAddChoice && <AddActionSheet onAddHabit={() => {
        setShowAddChoice(false);
        // Enforce Pro gate: free users capped at 5 habits. Without this,
        // users on the Today screen could bypass the paywall entirely by
        // going through the Add action sheet instead of the Habits tab.
        if (!isPro && habits.length >= 5) setShowUpgrade(true);
        else setShowAdd(true);
      }} onAddGoal={() => { setShowAddChoice(false); setShowAddGoal(true); }} onAddLog={() => { setShowAddChoice(false); setScreen("journal"); setShowJournalCompose(true); }} onClose={() => setShowAddChoice(false)}/>}
      {showCoachTeaser && <CoachComingSoonSheet onClose={() => setShowCoachTeaser(false)} coachName={coachName} context={screen}/>}
      {logGoalId     && (() => { const g = resolveGoalForModal(logGoalId, goals, habits); return g ? <LogGoalModal goal={g} onClose={() => setLogGoalId(null)} onLog={(id, val, note) => { handleLogGoal(id, val, note); setLogGoalId(null); }}/> : null; })()}
      {editGoalId    && (() => { const g = resolveGoalForModal(editGoalId, goals, habits); return g ? <EditGoalModal goal={g} onClose={() => setEditGoalId(null)} onSave={handleEditGoalSave}/> : null; })()}
      {openGoalId    && (() => { const g = resolveGoalForModal(openGoalId, goals, habits); return g ? <GoalDetailSheet goal={g} habits={habits} onClose={() => setOpenGoalId(null)} onLog={id => { setOpenGoalId(null); setLogGoalId(id); }} onEdit={id => { setOpenGoalId(null); openEditGoal(id); }} onComplete={handleCompleteGoal} onDelete={id => { handleDeleteGoal(id); setOpenGoalId(null); }} onCheckin={handleGoalCheckin} onLinkHabits={handleGoalLinkHabits}/> : null; })()}
      {showXP        && <XPModal       xp={xp}                               onClose={() => setShowXP(false)}/>}
      {showHistory   && <HistoryModal  habits={habits} isPro={isPro} onUpgrade={() => setShowUpgrade(true)} onClose={() => setShowHistory(false)}/>}
      {reflectId     && <ReflectModal  habit={reflectHabit}                  onClose={() => setReflectId(null)} onSave={handleSaveReflection} hasCoach={!!user.coachId}/>}
      {editId && !editGoalId && editHabit && !isGoalLikeHabitType(editHabit) && <EditModal habit={editHabit} onClose={() => setEditId(null)} onSave={handleEditSave}/>}
      {logId && logHabit?.habitType === "project"  && <LogProjectModal   habit={logHabit} onClose={() => setLogId(null)} onLog={handleLog}/>}
      {showCoach   && <AICoach key={sessionUserId || "anon"} openInputMode={coachOpenMode}
          pendingMessage={coachPendingMsg}
          habits={habits} goals={goals} user={user} isPro={isPro}
          onClose={() => { setShowCoach(false); setCoachOpenMode(null); setCoachPendingMsg(null); }}
          onUpgrade={() => setShowUpgrade(true)} coachName={coachName}
          coachIcon={coachIcon}
          coachAccentColor={habits.find(h => h.habitType !== "log")?.color || T.accent}
          currentScreen={screen}
          onNavigateTo={(s) => setScreen(s)}
          onHabitCreated={h  => setHabits(p => p.some(x => String(x.id) === String(h.id)) ? p.map(x => String(x.id) === String(h.id) ? h : x) : [...p, h])}
          onGoalCreated={g   => setGoals(p  => p.some(x => String(x.id) === String(g.id)) ? p.map(x => String(x.id) === String(g.id) ? g : x) : [...p, g])}
          onHabitLogged={(id, logs) => setHabits(p => p.map(h => String(h.id) === String(id) ? { ...h, logs } : h))}
          onGoalLogged={(id, logs)  => setGoals(p  => p.map(g => String(g.id) === String(id) ? { ...g, logs } : g))}
          onHabitRenamed={(id, name) => setHabits(p => p.map(h => String(h.id) === String(id) ? { ...h, name } : h))}
          onGoalPlanConfirm={handleGoalPlanConfirm}
          journalEntries={journalEntries}
          onJournalLogged={entries => {
            // Re-fetch journal entries after AI writes so the Journal tab reflects it immediately
            const uid = userIdRef.current;
            if (uid) {
              supabase.from("journal_entries").select("id, date, content, created_at, updated_at")
                .eq("user_id", uid).order("date", { ascending: false })
                .then(({ data: jRows }) => { if (jRows) setJournalEntries(jRows); });
            }
          }}
        />}
      {showUpgrade && <BetaPaywallModal onClose={() => setShowUpgrade(false)}/>}
      {showShare && <ShareCardModal user={user} habits={habits} xp={xp} onClose={() => setShowShare(false)}/>}
      {showWelcome && (
        <WelcomeModal onContinue={() => { setShowWelcome(false); setShowProFollowup(true); }} />
      )}
      {showProFollowup && (
        <ProThankYouModal userId={sessionUserId} onClose={() => setShowProFollowup(false)} />
      )}
      {/* TourOverlay disabled — restore tourSteps state and this block to re-enable */}
    </>
  );
}
