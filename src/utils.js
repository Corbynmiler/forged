// ─── UTILS ────────────────────────────────────────────────────────────────────
// ALL pure (non-React) utility functions. No JSX, no hooks.
import { T, DAYS, MONTHS, XP_LEVELS, HABIT_TYPES, CREATOR_ID, FREE_DAILY_LIMIT, WEEKLY_SUMMARY_TTL_MS, COACH_PAGE_NUDGES, PAGE_GUIDE_PAGES, COACH_ICON_OPTIONS } from './theme.js';
import { supabase } from './supabase.js';
import { rowToHabit, rowToGoal } from './supabase.js';

// ─── DATE UTILS ───────────────────────────────────────────────────────────────
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function parseLocal(str) {
  const [y,m,d] = str.split("-").map(Number);
  return new Date(y, m-1, d);
}
export function fmtDate(d = new Date()) {
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
/** e.g. "Thursday, April 9" — Today screen subheader */
export function fmtDateLong(d = new Date()) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
/** Goal deadline chip: "May 31" or "Jan 15, 2027" if not this calendar year */
export function fmtGoalDueHuman(dateStr) {
  if (!dateStr) return "";
  const d = parseLocal(dateStr);
  const y = d.getFullYear();
  const thisYear = new Date().getFullYear();
  const mon = MONTHS[d.getMonth()];
  const day = d.getDate();
  return y !== thisYear ? `${mon} ${day}, ${y}` : `${mon} ${day}`;
}
export function goalTodayDeadlineLine(goal, stats, isComplete) {
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
export function weekStartFor(dateStr) {
  const d = parseLocal(dateStr), day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function currentWeekStart() { return weekStartFor(todayStr()); }
/**
 * ISO-8601 week key, e.g. "2026-W19". Two dates land in the same ISO week iff
 * their getISOWeek() strings match — used by InsightsScreen to detect a stale
 * weekly brief (generated in a previous calendar week).
 *
 * Accepts a Date, a YYYY-MM-DD string, or any value `new Date()` understands
 * (e.g. ISO timestamps from Postgres). Returns "" for unparseable input.
 */
export function getISOWeek(date) {
  if (!date) return "";
  let d;
  if (date instanceof Date) {
    d = new Date(date.getTime());
  } else if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    d = parseLocal(date);
  } else {
    d = new Date(date);
  }
  if (isNaN(d.getTime())) return "";
  d.setHours(0, 0, 0, 0);
  // ISO week-numbering year: shift to nearest Thursday in the week.
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
/** Display string for "next Monday from today" — e.g. "Mon, May 18". */
export function fmtNextMondayShort(fromStr = todayStr()) {
  const d = parseLocal(fromStr);
  const day = d.getDay();
  // Days until next Monday (always strictly in the future).
  const delta = day === 1 ? 7 : ((8 - day) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function minsToHrs(m) { return (m / 60).toFixed(1); }
export function fmtEntryDate(dateStr) {
  if (dateStr === todayStr()) return "Today";
  if (dateStr === daysAgo(1)) return "Yesterday";
  const d = parseLocal(dateStr);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function weekEndFromStart(weekStartStr) {
  const d = parseLocal(weekStartStr);
  d.setDate(d.getDate() + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function fmtWeekRange(weekStartStr) {
  const a = parseLocal(weekStartStr);
  const b = parseLocal(weekEndFromStart(weekStartStr));
  if (a.getMonth() === b.getMonth()) return `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}
export function loadJournalMissedMap(userId) {
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
export function saveJournalMissedMap(userId, map) {
  if (!userId) return;
  try {
    localStorage.setItem(`forged_journal_missed_${userId}`, JSON.stringify(map));
  } catch { /* ignore quota */ }
}

/** Date is in missed map but user has not added a note/reason yet (whitespace-only counts as empty). */
export function missedDayNeedsNote(missedMap, dateStr) {
  return Object.prototype.hasOwnProperty.call(missedMap, dateStr) && !(String(missedMap[dateStr] ?? "").trim());
}

// ─── GOAL PLAN PARSING ────────────────────────────────────────────────────────
/**
 * Extract and parse a <goal_plan>{json}</goal_plan> block from a coach message.
 * Returns { plan, textWithout } if found and valid, or null.
 * plan shape: { name, emoji, unit, startValue, targetValue, direction,
 *               targetDate, milestones: [{date, label}], why }
 */
export function parseGoalPlan(text) {
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
export function stripPartialGoalPlan(text) {
  if (!text || typeof text !== "string") return text;
  // Complete block handled by parseGoalPlan — only strip incomplete ones
  if (/<\/goal_plan>/.test(text)) return text; // let parseGoalPlan handle it
  return text.replace(/<goal_plan>[\s\S]*$/, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Split coach reply into conversational body + server-appended action receipt (separator from api/chat.js). */
export function splitCoachReceipt(text) {
  if (!text || typeof text !== "string") return { main: text, receipt: null };
  const sep = "\n───\n";
  const idx = text.indexOf(sep);
  if (idx === -1) return { main: text, receipt: null };
  return {
    main: text.slice(0, idx).trimEnd(),
    receipt: text.slice(idx + sep.length).trim(),
  };
}

// Converts a VAPID base64 public key to the Uint8Array that PushManager.subscribe() expects
export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function normalizeCoachIcon(icon) {
  const t = (icon ?? "").trim();
  return COACH_ICON_OPTIONS.includes(t) ? t : "✦";
}

export function getLevel(xp) {
  return XP_LEVELS.reduce((acc, l) => xp >= l.min ? l : acc, XP_LEVELS[0]);
}
export function nextLevel(xp) {
  return XP_LEVELS.find(l => l.min > xp) || null;
}

// ─── COMPUTED ─────────────────────────────────────────────────────────────────
export function isLoggedToday(h) {
  return h.logs.some(l => l.date === todayStr());
}
/**
 * Whether this trackable counts toward the Today forged ring.
 * Weekly: session today, weekly rest day (skip), or weekly target already met this week.
 * Daily: done or rest — not raw isLoggedToday (avoids quicknote-only false positives).
 */
export function isSatisfiedForTodayRing(h) {
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
export function todayLogs(h) {
  return h.logs.filter(l => l.date === todayStr());
}
export function latestTodayLog(h) {
  const tl = todayLogs(h);
  return tl.length ? tl[tl.length - 1] : null;
}
export function getWeeklyCount(h) {
  return h.logs.filter(l => l.date >= currentWeekStart() && l.value === true).length;
}
/** Session count in the current Mon–Sun week (matches Today weekly habits). */
export function sharedMemberWeekSessionCount(logs) {
  const ws = currentWeekStart();
  return (logs || []).filter(l => l.date >= ws && l.value === true).length;
}

/** Map in-app habit / goal row → accountability habit kind for log projection. */
export function linkedKindForSharedSync(linked) {
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
export function projectPersonalLogsForSharedMember(linked) {
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
export function normalizeSharedGoalHabitType(ht) {
  const t = String(ht || "daily").trim();
  if (t === "progress") return "goal";
  return t;
}

export function nudgeWatermarkStorageKey(uid) {
  return `forged_nudge_watermark_${uid}`;
}
export function readNudgeWatermark(uid) {
  try {
    return localStorage.getItem(nudgeWatermarkStorageKey(uid)) || "";
  } catch {
    return "";
  }
}
export function writeNudgeWatermarkIfNewer(uid, isoTs) {
  if (!uid || !isoTs) return;
  try {
    const k = nudgeWatermarkStorageKey(uid);
    const prev = localStorage.getItem(k) || "";
    if (isoTs > prev) localStorage.setItem(k, isoTs);
  } catch { /* ignore quota */ }
}

export function getTotalSessionLogsCount(h) {
  return h.logs.filter(l => l.value === true).length;
}
export function getLatestValue(h) {
  if (!h.logs.length) return h.startValue ?? 0;
  const sorted = [...h.logs].sort((a, b) => a.date.localeCompare(b.date));
  const numeric = sorted.filter(l => typeof l.value === "number");
  if (numeric.length) return numeric.at(-1).value;
  return h.startValue ?? 0;
}
export function inferProgressDirection(startValue, targetValue) {
  return targetValue < startValue ? "decreasing" : "increasing";
}
export function isLegacyProgressType(type) {
  return type === "progress";
}

/** Compare habit/goal ids — tolerate number vs string, and dots vs underscores (see habitToRow/goalToRow normalizeId). */
export function entityIdEq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const norm = v => String(v).replace(/\./g, "_");
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) return true;
  return norm(sa) === norm(sb);
}

/** Compare auth user ids from PostgREST / RPC (string UUID, optional casing or column shape differences). */
export function sameUserId(a, b) {
  if (a == null || b == null) return false;
  const norm = v => String(v).replace(/-/g, "").toLowerCase();
  return norm(a) === norm(b);
}

/** Split `habits` table rows into in-app `goals` vs `habits` (must stay aligned with loadUserData). */
export function splitDbRowsIntoGoalsAndHabits(rows) {
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
export function goalFromMisplacedHabit(h) {
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

export function resolveGoalForModal(goalId, goals, habits) {
  if (goalId == null) return null;
  const g = goals.find(x => entityIdEq(x.id, goalId));
  if (g) return g;
  const h = habits.find(x => entityIdEq(x.id, goalId));
  return goalFromMisplacedHabit(h);
}

/** Treat as goal/progress for routing to goal editor (handles odd casing / enum stringification). */
export function isGoalLikeHabitType(h) {
  if (!h || h.habitType == null) return false;
  const t = String(h.habitType).trim().toLowerCase();
  return t === "goal" || t === "progress";
}

export function resolveProgressDirection(h) {
  if (h.direction === "decreasing" || h.direction === "increasing") return h.direction;
  return inferProgressDirection(Number(h.startValue ?? 0), Number(h.targetValue ?? 0));
}
export function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
export function formatProgressNumber(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
export function formatWithUnit(value, unit) {
  const n = formatProgressNumber(value);
  return unit ? `${n} ${unit}` : n;
}
export function truncateText(text, max = 72) {
  const s = String(text ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}
export function getProgressStats(h) {
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
export function getProjectStats(h) {
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
export function hasRestDay(h, dateStr) {
  return h.logs.some(l => l.date === dateStr && l.value === "skip");
}
export function hasDailyCompletion(h, dateStr) {
  return h.logs.some(l => l.date === dateStr && l.value === true);
}
export function getLimitDayTotal(h, dateStr) {
  const dayLogs = h.logs.filter(l => l.date === dateStr && typeof l.value === "number");
  if (!dayLogs.length) return null;
  return dayLogs.reduce((s, l) => s + l.value, 0);
}
export function getBuildDayMinutes(h, dateStr) {
  const dayLogs = h.logs.filter(l => l.date === dateStr);
  const mins = dayLogs.reduce((s, l) => s + (l.value?.minutes || 0), 0);
  return mins;
}
export function qualifiesBuildDay(h, dateStr) {
  const targetMins = h.dailyTargetMinutes ?? 60;
  return getBuildDayMinutes(h, dateStr) >= targetMins;
}
// Daily: count consecutive days going back from today where a log exists.
// If today isn't logged yet the day isn't over, so we start from yesterday.
export function getDailyStreak(h) {
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
export function getLimitStreak(h) {
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
export function getBuildStreak(h) {
  const startDay = qualifiesBuildDay(h, todayStr()) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    if (qualifiesBuildDay(h, daysAgo(d))) streak++;
    else break;
  }
  return streak;
}
// Unified getter — returns the right streak type for any habit
export function getStreak(h) {
  if (h.habitType === "log") return 0;
  if (h.habitType === "weekly")  return getWeeklyStreak(h);
  if (h.habitType === "limit")   return getLimitStreak(h);
  if (h.habitType === "project") return getBuildStreak(h);
  return getDailyStreak(h); // daily (default)
}

/** Subtitle suffix for habit cards — hides misleading 🔥 1 when the streak is only "today" with no prior day. */
export function getHabitCardStreakSuffix(h) {
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

export function getWeeklyStreak(h) {
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
export function getBestStreak(h) {
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
export function getCompletionRate(h) {
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
export function get7DayActivity(h) {
  return Array.from({length:7}, (_, i) => {
    const dateStr = daysAgo(6 - i);
    return h.logs.some(l => l.date === dateStr && isRealCompletion(l.value)) ? 1 : 0;
  });
}

/** Returns true if the log value represents a genuine completion (not skip, quicknote, false, or null). */
export function isRealCompletion(v) {
  if (v === "skip" || v === "quicknote" || v === false || v == null) return false;
  if (v === true || v === "log") return true;
  if (typeof v === "number" && v > 0) return true;
  if (typeof v === "object" && v !== null && typeof v.minutes === "number" && v.minutes > 0) return true;
  return false;
}

/**
 * Best-day-of-week signal, computed across all habits + goals "real" logs.
 * Returns { counts: [Mon..Sun], total, best: { label, count }|null, needsMoreData: bool }.
 * needsMoreData stays true below a small threshold so we don't lie with a 1-sample pattern.
 */
export function getBestDayOfWeek(allRealLogs) {
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
export function getWrittenCorpus(habits = [], goals = []) {
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

export function getTextTone(text) {
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

export function bestDeepSampleForTerm(entry, term) {
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
export function getCrossHabitLinks(corpus, k = 4) {
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
export function analyzeDeepInsights(habits = [], goals = []) {
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

export function deepInsightsCacheKey(userId) {
  return `forged_deep_insights:${userId || "anon"}`;
}
export function hashCorpusSignature(corpus) {
  // djb2 over a tiny fingerprint of each entry — stable, collision-safe enough
  // for this use case, and much cheaper than hashing the full text.
  let h = 5381;
  for (const e of corpus) {
    const s = `${e.date}|${e.source}|${e.text.length}|${String(e.text).slice(0, 24)}`;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  }
  return String(h);
}
export function readDeepInsightsCache(userId) {
  try {
    const raw = localStorage.getItem(deepInsightsCacheKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function writeDeepInsightsCache(userId, payload) {
  try { localStorage.setItem(deepInsightsCacheKey(userId), JSON.stringify(payload)); }
  catch { /* quota / private mode */ }
}
export function clearDeepInsightsCache(userId) {
  try { localStorage.removeItem(deepInsightsCacheKey(userId)); } catch { /* ignore */ }
}
export function get12WeekGrid(h) {
  return Array.from({length:12}, (_, w) =>
    Array.from({length:7}, (_, d) => {
      const dateStr = daysAgo((11 - w) * 7 + (6 - d));
      return { date: dateStr, logged: h.logs.some(l => l.date === dateStr && isRealCompletion(l.value)) };
    })
  );
}

// ─── GOAL HELPERS ─────────────────────────────────────────────────────────────
export function getGoalProgress(goal) {
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
export function goalBarFillWidthPct(stats) {
  if (stats.isComplete) return 100;
  return Math.max(stats.pct, 9);
}

/** Recompute goal fields after removing log rows (current value = last numeric log, or start). */
export function goalStateAfterLogRemoval(goal, nextLogs) {
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

export function getGoalEntryCount(goal) {
  return (goal.logs || []).filter(l => typeof l.value === "number").length;
}

/**
 * Returns pacing info for a goal that has a deadline.
 * Tells you whether the user is on track, ahead, or behind based on
 * time elapsed vs progress made.
 * Returns null if no deadline is set.
 */
export function getGoalPacing(goal) {
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

export function getGoalStatusText(goal, stats = getGoalProgress(goal)) {
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

// ─── COACH SYSTEM PROMPT ──────────────────────────────────────────────────────
export function buildCoachSystemPrompt(user, habits, coachName, screen, goals = [], journalEntries = []) {
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

// ─── COACH STORAGE HELPERS ────────────────────────────────────────────────────
const COACH_LS_RESET = "coach_reset_date";
const COACH_LS_MSGS = "coach_msgs_today";

export function syncCoachMsgCountFromStorage() {
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

export function bumpCoachMsgCountInStorage() {
  try {
    const n = syncCoachMsgCountFromStorage() + 1;
    localStorage.setItem(COACH_LS_MSGS, String(n));
    return n;
  } catch {
    return 0;
  }
}

export const COACH_STREAM_ID = "__streaming__";
/** One rolling thread per user per local calendar day; trimmed for storage + display. Server still uses last 12 msgs only. */
export const COACH_DAY_MAX_MESSAGES = 24;
export const COACH_API_MESSAGE_CAP  = 12;

export function coachDayLocalKey(userId, dayYmd) {
  return `forged_coach_day:v1:${userId}:${dayYmd}`;
}

export function loadCoachDayMessages(userId) {
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

export function saveCoachDayMessages(userId, dayYmd, messages) {
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

/** Coach chat bubble footer — e.g. "3:05 pm" */
export function formatCoachMsgTime(ts) {
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
export function buildCoachGreeting({ name, habits = [], goals = [] }) {
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
export const CREATOR_RECENT_KEY = "forged_creator_greet_recent";
export const CREATOR_RECENT_KEEP = 6;

export function pickCreatorLine(candidates) {
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

export function buildCreatorGreeting({ name, habits = [], goals = [] }) {
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

// ─── PAGE GUIDE HELPERS ───────────────────────────────────────────────────────
export const COACH_NUDGE_DURATION_MS = 2800;

export function pageGuideSeenKey(userId, page) {
  const u = userId || "anon";
  return `forged_ai_page_guide_seen:${u}:${page}`;
}
export function readPageGuideSeen(userId, page) {
  try { return localStorage.getItem(pageGuideSeenKey(userId, page)) === "1"; }
  catch { return false; }
}
export function writePageGuideSeen(userId, page) {
  try { localStorage.setItem(pageGuideSeenKey(userId, page), "1"); }
  catch { /* quota / private mode — fail silently */ }
}
export function clearAllPageGuideSeen(userId) {
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
export function buildPageGuideMessage(page, { name, habits = [], goals = [] } = {}) {
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

// ─── COACH DASHBOARD HELPERS ──────────────────────────────────────────────────
// Collapse per-habit last7 arrays into one combined "any logged" row
export function mergedLast7(habits) {
  if (!habits || habits.length === 0)
    return Array(7).fill({ date:"", logged:false, skip:false });
  const base = habits[0].last7 || [];
  return base.map((day, i) => ({
    date:   day.date,
    logged: habits.some(h => h.last7[i]?.logged),
    skip:   !habits.some(h => h.last7[i]?.logged) && habits.some(h => h.last7[i]?.skip),
  }));
}

// ── Local-timezone date helpers for the coach workspace ───────────────────────
// The coach-data API computes "today" in UTC (Vercel runs in UTC). Coaches in
// AEST/AEDT (UTC+10/11) are already on the next calendar day when UTC midnight
// hits. All "today / yesterday / X days ago" labels are therefore computed
// client-side from lastActiveDate so they always match the coach's local clock.

export function localTodayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

/** Days since a YYYY-MM-DD string, using the browser's local timezone. */
export function localDaysSince(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target     = new Date(y, m - 1, d).getTime();
  const n          = new Date();
  const todayMs    = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const diff       = todayMs - target;
  return diff < 0 ? 0 : Math.round(diff / 86400000);
}

export function localIsToday(dateStr) { return localDaysSince(dateStr) === 0; }

// Per-row meta: accent colour + pill label. Always pass a LOCALLY-computed dsa.
export function clientRowMeta(dsa) {
  if (dsa === null) return { accent: T.hint,    lastLabel: "Never logged" };
  if (dsa === 0)    return { accent: "#27AE60", lastLabel: "Active today" };
  if (dsa === 1)    return { accent: T.sub,     lastLabel: "Yesterday" };
  if (dsa === 2)    return { accent: T.gold,    lastLabel: "2 days ago" };
  if (dsa <= 5)     return { accent: T.amber,   lastLabel: `${dsa} days ago` };
  return              { accent: "#E74C3C", lastLabel: `${dsa} days quiet` };
}

// Single short observation about the client, using LOCAL date so timezone drift
// doesn't produce "logged everything today" for yesterday's logs.
export function clientInsightLine(client) {
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

export function buildSessionBrief(client) {
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

export function coachGreetingForNow(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

// ─── AUTH/PROFILE HELPERS ─────────────────────────────────────────────────────
export const FORGED_FEEDBACK_EMAIL = "corbyn.miller2000@gmail.com";

/** Same mail path as Profile → Send quick feedback; optional lead-in line for context. */
export function openForgedFeedbackMailto(leadInLine = "") {
  const lines = ["Hey Corbyn,", ""];
  if (leadInLine.trim()) lines.push(leadInLine.trim(), "");
  lines.push("Here's my feedback on Forged:", "", "");
  const href = `mailto:${FORGED_FEEDBACK_EMAIL}?subject=${encodeURIComponent("Forged Feedback")}&body=${encodeURIComponent(lines.join("\n"))}`;
  window.open(href, "_blank");
}

export function forgedBetaEmailOptInKey(userId) {
  return userId ? `forged_beta_email_opt_in:${userId}` : "forged_beta_email_opt_in";
}

export function readForgedBetaEmailOptIn(userId) {
  return localStorage.getItem(forgedBetaEmailOptInKey(userId)) === "1";
}

export function writeForgedBetaEmailOptIn(userId, on) {
  try {
    localStorage.setItem(forgedBetaEmailOptInKey(userId), on ? "1" : "0");
  } catch (_) { /* quota / private mode */ }
}

/** Valid UUID for coach-summary API — demo/preview clients use non-UUID ids. */
export const COACH_SUMMARY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Convincing sample AI brief for preview/demo clients (no API). */
export function previewAiBriefFromClient(client) {
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
