import webpush from "web-push";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

// ── Calendar dates in the user's IANA timezone (must match client `todayStr()` semantics) ──

function ymdNowInTimeZone(timeZone) {
  const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

/**
 * Current hour + minute (0..23 / 0..59) in the user's IANA timezone. Used by
 * the windowed sender so each user gets their daily reminder during the
 * 5-minute window they chose.
 */
function hourMinuteNowInTimeZone(timeZone) {
  const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find(p => p.type === "hour")?.value, 10);
    const m = parseInt(parts.find(p => p.type === "minute")?.value, 10);
    return {
      hour: Number.isFinite(h) ? h % 24 : 0,
      minute: Number.isFinite(m) ? m : 0,
    };
  } catch {
    const now = new Date();
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

/** Parse "HH:MM" → { hour 0..23, minute 0..59 }, falling back to 18:00. */
function parseReminderTime(reminderTime) {
  if (typeof reminderTime !== "string") return { hour: 18, minute: 0 };
  const [hStr, mStr] = reminderTime.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  return {
    hour:   Number.isFinite(h) && h >= 0 && h <= 23 ? h : 18,
    minute: Number.isFinite(m) && m >= 0 && m <= 59 ? m : 0,
  };
}

/** Floor a minute (0..59) into a 5-minute bucket: 0,5,10,…,55. */
const BUCKET_MIN = 5;
function bucketMinute(m) { return Math.floor(m / BUCKET_MIN) * BUCKET_MIN; }

function addCalendarDays(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const u = Date.UTC(y, m - 1, d + deltaDays);
  const dt = new Date(u);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function daysAgoFrom(ymd, n) {
  return addCalendarDays(ymd, -n);
}

/** Monday-start week containing ymd (matches client `weekStartFor`). */
function weekStartMondayFromYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun=0
  const back = day === 0 ? 6 : day - 1;
  return addCalendarDays(ymd, -back);
}

function daysBetween(fromStr, toStr) {
  return Math.round((new Date(toStr) - new Date(fromStr)) / 86400000);
}

// ── Row shape (snake_case from Supabase) ───────────────────────────────────────

function getLimitDayTotal(h, dateStr) {
  const dayLogs = (h.logs || []).filter(l => l.date === dateStr && typeof l.value === "number");
  if (!dayLogs.length) return null;
  return dayLogs.reduce((s, l) => s + l.value, 0);
}

function getBuildDayMinutes(h, dateStr) {
  return (h.logs || [])
    .filter(l => l.date === dateStr)
    .reduce((s, l) => s + (l.value?.minutes || 0), 0);
}

function qualifiesBuildDay(h, dateStr) {
  const targetMins = h.daily_target_minutes ?? 60;
  return getBuildDayMinutes(h, dateStr) >= targetMins;
}

function hasDailyCompletion(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr && l.value === true);
}

function hasRestDay(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr && l.value === "skip");
}

/** Matches client `isLoggedToday`: any saved log row for that calendar day (Today ring %). */
function hasAnyLogOnDate(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr);
}

/**
 * Stricter "real progress today" for AI copy — avoids congratulating a workout that did not happen.
 * Weekly: counts a session only when value === true that day (not a blank row / quicknote alone).
 */
function strictLoggedProgressToday(h, todayYmd) {
  if (h.habit_type === "log") return false;
  const logs = h.logs || [];

  if (h.habit_type === "daily") {
    return hasDailyCompletion(h, todayYmd) || hasRestDay(h, todayYmd);
  }
  if (h.habit_type === "weekly") {
    return logs.some(l => l.date === todayYmd && l.value === true);
  }
  if (h.habit_type === "project") {
    return qualifiesBuildDay(h, todayYmd);
  }
  if (h.habit_type === "limit") {
    const total = getLimitDayTotal(h, todayYmd);
    if (total == null) return false;
    return total <= (h.daily_budget ?? Infinity);
  }
  return false;
}

/** Daily streak ending at yesterday if today not yet completed (matches client `getDailyStreak`). */
function getDailyStreak(h, todayYmd) {
  const logs = h.logs || [];
  const startDay = hasDailyCompletion(h, todayYmd) || hasRestDay(h, todayYmd) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    const dateStr = daysAgoFrom(todayYmd, d);
    if (hasDailyCompletion(h, dateStr) || hasRestDay(h, dateStr)) streak++;
    else break;
  }
  return streak;
}

// ── Dev-owner custom notifications ────────────────────────────────────────────
// Scoped exclusively to this one user UUID. Never applied to anyone else.
// Tone: short, punchy, escape-the-9-to-5 builder framing.
// Swear words intentional — this is a personal dev customisation.
const DEV_OWNER_ID = "5e9b4ba7-bf15-4e94-ab05-fe3306496973";

// Set true to send every hour (for testing whether hourly reminders motivate or annoy).
// When false, reverts to single daily send at DEV_OWNER_SINGLE_HOUR.
const DEV_OWNER_HOURLY_MODE = true;
const DEV_OWNER_SINGLE_HOUR = 5;   // only used when DEV_OWNER_HOURLY_MODE = false

// Day names for in-message references
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isWeekend(todayYmd) {
  const day = new Date(todayYmd + "T12:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

function getDayName(todayYmd) {
  return DAY_NAMES[new Date(todayYmd + "T12:00:00Z").getUTCDay()];
}

// Time-of-day slot — drives which pool is picked
function getTimeSlot(hour) {
  if (hour >= 5  && hour < 7)  return "early_morning"; // 5–7am
  if (hour >= 7  && hour < 9)  return "morning";        // 7–9am
  if (hour >= 9  && hour < 12) return "work_am";        // 9am–noon
  if (hour >= 12 && hour < 14) return "lunch";          // noon–2pm
  if (hour >= 14 && hour < 17) return "work_pm";        // 2–5pm
  if (hour >= 17 && hour < 20) return "after_work";     // 5–8pm
  if (hour >= 20 && hour < 23) return "evening";        // 8–11pm
  return "night";                                         // 11pm–5am
}

// Deterministic hourly pick — same message within a given hour, different each hour/day.
// Prime multiplier keeps the spread varied across small pools.
function devPick(pool, todayYmd, hour) {
  const dateSeed = parseInt(todayYmd.replace(/-/g, ""), 10);
  const seed = dateSeed + hour * 37;
  return pool[seed % pool.length];
}

// ── Message pools ──────────────────────────────────────────────────────────────
// Keys: getTimeSlot() values. Each has `weekday` and `weekend` arrays.
const DEV_POOLS = {
  early_morning: {
    weekday: [
      "5am. You set this alarm. Don't waste it.",
      "Up before the job owns you. That's the edge. Use it.",
      "Early window. Nobody's asking for anything yet. Log it and build.",
      "Most people are asleep. You're not. That's the whole move.",
      "Rise before the boss does. That's how you escape the boss.",
      "5am. Log it, then go earn the commute.",
      "Before the world wants a piece of you — this hour belongs to you.",
    ],
    weekend: [
      "5am on a free day. Dream window. Open the laptop.",
      "Weekend morning. No commute. Just you and the build.",
      "Up early on a weekend — that's not normal. Good. Make it count.",
      "Free time starts now. Don't sleep through the best part of the day.",
      "Weekend 5am. Rarer than you think. Use every minute.",
    ],
  },
  morning: {
    weekday: [
      "Before work takes over — what are you building?",
      "Log it. Then go be employed for a bit.",
      "Quick. Before the day gets away from you.",
      "Morning window closing. Get the habits in.",
      "The inbox can wait 2 minutes. Log it first.",
      "Log before you check your phone. That's the order.",
    ],
    weekend: [
      "Free morning. No meetings. Just time. Use it.",
      "Weekend morning hours are gold. Don't waste them.",
      "Coffee, habits, build. That's the order.",
      "No commute today. Trade the time for something real.",
    ],
  },
  work_am: {
    weekday: [
      "At work. Fine. Remember what you're working toward.",
      "Punched in. Tonight, you work for yourself.",
      "The 9-to-5 pays rent. The side work buys the exit.",
      "Morning shift. Build something tonight.",
      "Survive the morning. Come home and make something.",
      "Clock's ticking on someone else's time. Yours starts later.",
      "If even you don't use this app, who the fuck will? Log it.",
    ],
    weekend: [
      "Mid-morning on a free day. Habits logged? Good. What are you building?",
      "No boss watching. That's a privilege. Don't squander it.",
      "Weekend mid-morning. What have you actually shipped today?",
      "Free hours passing. Log it and open the laptop.",
    ],
  },
  lunch: {
    weekday: [
      "Lunch. Don't scroll — remember the mission.",
      "Half the day gone. Tonight still belongs to you.",
      "Quick log. Then eat. Don't let the day slip.",
      "Midday. Log it now before you forget.",
      "Halfway through someone else's schedule. Keep your own.",
      "One more shift to get through. Then you build.",
    ],
    weekend: [
      "Afternoon already. What have you built today?",
      "Half the day's gone. The other half is yours.",
      "Log it. Then actually build something this afternoon.",
      "Lunchtime on a free day. Time to show up for yourself.",
    ],
  },
  work_pm: {
    weekday: [
      "Home stretch at work. Then your real job starts.",
      "One more shift. Then build your own shit.",
      "Almost out. Don't forget what comes after.",
      "Afternoon at someone else's desk. Soon it'll be your own.",
      "Nearly done. The evening belongs to you — protect it.",
      "Stop fucking drifting at work. Think about what you're building tonight.",
      "End of shift incoming. Line up what you're shipping tonight.",
    ],
    weekend: [
      "Weekend afternoon — still time to build something worth doing.",
      "Free hours passing. Log it and get to work.",
      "This is your time. Don't drift through it.",
      "Afternoon on a free day. Make something real.",
    ],
  },
  after_work: {
    weekday: [
      "Shift's done. Open the laptop.",
      "Home time. Build your thing.",
      "You survived work. Now do your real job.",
      "Evening's yours. Don't give it to Netflix.",
      "This is it — the hours you spent all day waiting for.",
      "No boss from here. Just you and what you're building.",
      "Clock out from them. Clock in for you.",
      "The escape hatch doesn't build itself. Get to it.",
      "You're not going to get out by doing nothing every evening.",
    ],
    weekend: [
      "Weekend evening. Still time. Don't drift.",
      "Evening on a free day — this is the window. Use it.",
      "After-hours on a weekend. Build something.",
      "Free evening. Rarer than it feels. Don't waste it.",
    ],
  },
  evening: {
    weekday: [
      "Evening's ticking. One good hour beats zero.",
      "Stop fucking drifting. Make something tonight.",
      "Don't waste the night. One push.",
      "Last real window today. Use it.",
      "You've still got time. Own it or own the fact that you didn't.",
      "It's not too late. Log it and do one thing.",
      "This is your shot. Don't waste it.",
      "One hour of real work tonight beats a week of good intentions.",
    ],
    weekend: [
      "Weekend's almost done. Make the last hours count.",
      "Sunday evening is both a gift and a threat. Use it.",
      "Last stretch of the weekend. Go hard.",
      "Still building? Good. Don't stop now.",
      "Night closing in on the weekend. What did you actually ship?",
    ],
  },
  night: {
    weekday: [
      "Late. Log it or sleep — both are better than drifting.",
      "Still up? Log it. Then rest. You've got work tomorrow.",
      "Night mode. Quick log, then sleep. Come back sharp.",
      "Late but not wasted if you log it now.",
    ],
    weekend: [
      "Late on a free day. Log it and wind down. Tomorrow's another shot.",
      "Night. Log it quick before you crash.",
      "Late night. Log it. Sleep. Do it again tomorrow.",
    ],
  },
};

// All-habits-logged congratulations — time-aware, kept short
const DEV_ALL_LOGGED_POOLS = {
  weekday: [
    "All habits logged. Now go build before bed.",
    "Full house on a workday. That's discipline. Keep it.",
    "Logged. Done. Ahead of most people. Stay there.",
    "Everything in. You're running a tight ship. Keep going.",
  ],
  weekend: [
    "All habits logged on a free day. Good. Now ship something.",
    "Full house on a weekend. Make the most of it.",
    "Every habit in. What else can you build today?",
    "Done and dusted. Now go actually move the needle.",
  ],
};

function pickDevOwnerMessage(habits, goals, todayYmd, localHour) {
  const TRACKABLE = ["daily", "weekly", "project", "limit"];
  const trackableHabits = (habits || []).filter(
    h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log"
  );
  const allLogged =
    trackableHabits.length > 0 &&
    trackableHabits.every(h => hasAnyLogOnDate(h, todayYmd));

  const weekend = isWeekend(todayYmd);
  const slot = getTimeSlot(localHour ?? 8);
  const poolKey = weekend ? "weekend" : "weekday";

  if (allLogged) {
    const pool = DEV_ALL_LOGGED_POOLS[poolKey];
    return { title: "Forged ✅", body: devPick(pool, todayYmd, localHour ?? 0) };
  }

  const pool = (DEV_POOLS[slot] || DEV_POOLS.morning)[poolKey];
  return { title: "Forged 🔥", body: devPick(pool, todayYmd, localHour ?? 0) };
}

// ── Message picker ─────────────────────────────────────────────────────────────

function pickMessage(habits, goals, todayYmd) {
  const TRACKABLE = ["daily", "weekly", "project", "limit"];
  const trackableHabits = (habits || []).filter(
    h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log"
  );

  if (trackableHabits.length > 0 && trackableHabits.every(h => hasAnyLogOnDate(h, todayYmd))) {
    const CONGRATS = [
      "Every habit logged. That's how it's built. ⚒️",
      "100% today. You showed up and got it done. 🔥",
      "All done for today. You're an absolute weapon. 💪",
      "Full house. Keep this up and nothing stops you. 🏆",
      "Locked in today. Log your progress and keep pushing. ✅",
    ];
    const msg = CONGRATS[new Date().getDate() % CONGRATS.length];
    return { title: "Forged ✅", body: msg };
  }

  let bestStreak = 0;
  let bestStreakHabit = null;
  for (const h of habits || []) {
    if (h.habit_type !== "daily") continue;
    const s = getDailyStreak(h, todayYmd);
    if (s > bestStreak) {
      bestStreak = s;
      bestStreakHabit = h;
    }
  }
  if (bestStreakHabit && bestStreak >= 3) {
    const e = bestStreakHabit.emoji || "🔥";
    return {
      title: "Forged 🔥",
      body: `${e} ${bestStreak}-day ${bestStreakHabit.name} streak. Don't break it today.`,
    };
  }

  const urgentGoals = (goals || [])
    .filter(g => g.goal_status === "active" && g.target_date)
    .map(g => ({ ...g, daysLeft: daysBetween(todayYmd, g.target_date) }))
    .filter(g => g.daysLeft >= 0 && g.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (urgentGoals.length > 0) {
    const g = urgentGoals[0];
    const e = g.emoji || "🎯";
    const when = g.daysLeft === 0 ? "today" : g.daysLeft === 1 ? "tomorrow" : `in ${g.daysLeft} days`;
    return {
      title: "Forged 🎯",
      body: `${e} "${g.name}" is due ${when}. Log your progress.`,
    };
  }

  let worstGap = 0;
  let gapHabit = null;
  for (const h of habits || []) {
    if (!TRACKABLE.includes(h.habit_type) || h.habit_type === "log") continue;
    const recentLogs = (h.logs || [])
      .filter(l => l.value !== null && l.value !== undefined && l.value !== false && l.value !== "skip")
      .sort((a, b) => b.date.localeCompare(a.date));
    if (recentLogs.length === 0) continue;
    const gap = daysBetween(recentLogs[0].date, todayYmd);
    if (gap >= 2 && gap > worstGap) {
      worstGap = gap;
      gapHabit = h;
    }
  }
  if (gapHabit) {
    const e = gapHabit.emoji || "💪";
    return {
      title: "Forged",
      body: `${e} ${gapHabit.name} — ${worstGap} days since your last log. Today's the day.`,
    };
  }

  const totalCount = trackableHabits.length;
  if (totalCount > 0) {
    return {
      title: "Forged",
      body: `${totalCount} habit${totalCount === 1 ? "" : "s"} to log today. Let's build. 🔨`,
    };
  }

  return { title: "Forged", body: "Time to log your habits 🔥" };
}

async function aiPickMessage(name, habits, goals, todayYmd) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const TRACKABLE = ["daily", "weekly", "project", "limit"];

  const summaries = (habits || [])
    .filter(h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log")
    .map(h => {
      const streak = h.habit_type === "daily" ? getDailyStreak(h, todayYmd) : 0;
      const doneToday = strictLoggedProgressToday(h, todayYmd);
      const recentLogs = (h.logs || [])
        .filter(l => l.date >= daysAgoFrom(todayYmd, 7))
        .sort((a, b) => b.date.localeCompare(a.date));
      const reflections = recentLogs.filter(l => l.reflection).slice(0, 2).map(l => l.reflection);
      let line = `- ${h.emoji || ""} ${h.name} (streak: ${streak}d, logged today: ${doneToday})`;
      if (reflections.length) line += `, recent notes: "${reflections.join("; ")}"`;
      return line;
    })
    .join("\n");

  const urgentGoals = (goals || [])
    .filter(g => g.goal_status === "active" && g.target_date)
    .map(g => ({ ...g, daysLeft: daysBetween(todayYmd, g.target_date) }))
    .filter(g => g.daysLeft >= 0 && g.daysLeft <= 7);

  const goalLine = urgentGoals.length
    ? `Upcoming deadlines: ${urgentGoals.map(g => `${g.name} in ${g.daysLeft}d`).join(", ")}`
    : "";

  const prompt = `You are a habit coach sending ${name} a short push notification for their Forged app.

Their habits for local calendar date ${todayYmd}:
${summaries || "No habits yet"}
${goalLine}

Write ONE push notification body (max 90 chars). Be direct, specific to their actual data, motivating but not cheesy. No hashtags, no quotes around it, just the text.

Hard rules:
- NEVER claim they completed a workout, session, or habit TODAY unless that habit's line explicitly shows logged today: true.
- NEVER invent numbers, streaks, or events not present in the data above.
- If every line shows logged today: false, do not congratulate them for finishing today — nudge them to log instead.
- "log" / journal-only lines are omitted; do not mention them.`;

  try {
    const client = new Anthropic({ apiKey: apiKey.trim() });
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content?.[0]?.text?.trim();
    if (text) return { title: "Forged 🔥", body: text };
  } catch (err) {
    console.error("[Forged cron] AI message failed:", err.message);
  }
  return null;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth: reject anyone not holding CRON_SECRET ─────────────────────────────
  // Vercel cron jobs automatically attach `Authorization: Bearer <CRON_SECRET>`
  // when the env var is set on the project. If it isn't set, this endpoint is
  // effectively disabled — we refuse to do AI/push work for unauthenticated
  // callers so nobody can burn our Anthropic budget or spam users.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[Forged cron] CRON_SECRET not set — refusing to run");
    return res.status(503).json({ error: "Cron not configured" });
  }
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: "VAPID keys not configured" });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@forged.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const supabase = createClient(SUPABASE_URL, serviceRoleKey);

  // CRON_MODE controls how we decide *who* to send to on this invocation:
  //   - "daily"   (default): send once to every enabled subscriber. Use only
  //                          when the Vercel cron is daily (`0 7 * * *`).
  //   - "hourly"            : alias for "windowed" (back-compat with the
  //                          original env value).
  //   - "windowed"          : only send to users whose configured local
  //                          HH:MM (5-minute bucket) matches NOW in their
  //                          timezone. Use with `*/5 * * * *` cron.
  // Every mode also dedupes via last_reminder_sent_date so the same user
  // never gets two daily reminders on the same local calendar day.
  const cronMode = (process.env.CRON_MODE || "daily").toLowerCase().trim();
  const isWindowed = cronMode === "hourly" || cronMode === "windowed";

  // SELECT * tolerates the column being absent if the new migration hasn't
  // run yet — we just gracefully skip dedupe in that case.
  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("notifications_enabled", true);

  if (subErr) return res.status(500).json({ error: subErr.message });
  if (!subs || subs.length === 0) return res.status(200).json({ sent: 0, message: "No active subscribers" });

  const userIds = subs.map(s => s.user_id);

  const { data: allRows } = await supabase
    .from("habits")
    .select(
      "user_id, name, emoji, habit_type, logs, target_date, goal_status, weekly_target, daily_budget, daily_target_minutes"
    )
    .in("user_id", userIds);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, is_pro")
    .in("id", userIds);

  const profileByUser = {};
  for (const p of profiles || []) profileByUser[p.id] = p;

  const habitsByUser = {};
  const goalsByUser = {};
  for (const row of allRows || []) {
    if (row.habit_type === "goal" || row.habit_type === "progress") {
      if (!goalsByUser[row.user_id]) goalsByUser[row.user_id] = [];
      goalsByUser[row.user_id].push(row);
    } else {
      if (!habitsByUser[row.user_id]) habitsByUser[row.user_id] = [];
      habitsByUser[row.user_id].push(row);
    }
  }

  const tzByUser = {};
  for (const s of subs) {
    tzByUser[s.user_id] = s.timezone || "UTC";
  }

  let sent = 0;
  let failed = 0;
  let skippedDedup = 0;
  let skippedWindow = 0;
  let skippedCategory = 0;
  const staleIds = [];

  for (const sub of subs) {
    const tz = tzByUser[sub.user_id] || "UTC";
    const todayYmd = ymdNowInTimeZone(tz);
    const now = hourMinuteNowInTimeZone(tz); // needed for both windowed check + message slot
    const isDevOwner = sub.user_id === DEV_OWNER_ID;

    // ── Per-category gate: skip users who turned off daily reminders ────
    if (sub.daily_reminders_enabled === false) {
      skippedCategory++;
      continue;
    }

    // ── Windowed mode ───────────────────────────────────────────────────
    // Dev owner hourly mode: fire at the top of every hour (minute bucket 0).
    // Dev owner single mode: fire at DEV_OWNER_SINGLE_HOUR:00 only.
    // Everyone else: fire at their configured reminder_time bucket.
    if (isWindowed) {
      if (isDevOwner && DEV_OWNER_HOURLY_MODE) {
        // Only the :00 bucket each hour — prevents firing every 5 minutes
        if (bucketMinute(now.minute) !== 0) { skippedWindow++; continue; }
      } else {
        const target = isDevOwner
          ? { hour: DEV_OWNER_SINGLE_HOUR, minute: 0 }
          : parseReminderTime(sub.reminder_time);
        if (now.hour !== target.hour || bucketMinute(now.minute) !== bucketMinute(target.minute)) {
          skippedWindow++;
          continue;
        }
      }
    }

    // ── Dedupe ──────────────────────────────────────────────────────────
    // Dev owner hourly: key = "YYYY-MM-DDH{hour}" — one send per local hour.
    // Everyone else: key = "YYYY-MM-DD" — one send per local day.
    // The hour key never equals a plain date string so regular users are unaffected.
    const dedupKey = (isDevOwner && DEV_OWNER_HOURLY_MODE)
      ? `${todayYmd}H${now.hour}`
      : todayYmd;

    if (sub.last_reminder_sent_date && sub.last_reminder_sent_date === dedupKey) {
      skippedDedup++;
      continue;
    }

    const habits = habitsByUser[sub.user_id] || [];
    const goals = goalsByUser[sub.user_id] || [];
    const profile = profileByUser[sub.user_id] || {};

    let title;
    let body;
    if (isDevOwner) {
      // Personal dev-owner notifications — time-of-day aware, escape-the-9-to-5 framing.
      // Scoped exclusively to DEV_OWNER_ID; never reaches any other user.
      ({ title, body } = pickDevOwnerMessage(habits, goals, todayYmd, now.hour));
    } else if (profile.is_pro && process.env.ANTHROPIC_API_KEY) {
      const aiMsg = await aiPickMessage(profile.name || "there", habits, goals, todayYmd);
      ({ title, body } = aiMsg || pickMessage(habits, goals, todayYmd));
    } else {
      ({ title, body } = pickMessage(habits, goals, todayYmd));
    }

    const payload = JSON.stringify({ title, body, url: "/", tag: "forged-reminder" });

    try {
      await webpush.sendNotification(sub.subscription, payload);
      sent++;
      // Stamp the dedup key (hourly or daily depending on mode) so the next
      // cron run within the same window skips this user.
      try {
        await supabase
          .from("push_subscriptions")
          .update({ last_reminder_sent_date: dedupKey })
          .eq("id", sub.id);
      } catch (markErr) {
        if (!String(markErr?.message || "").includes("last_reminder_sent_date")) {
          console.warn(`[Forged cron] dedupe stamp failed for ${sub.user_id}:`, markErr.message);
        }
      }
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        staleIds.push(sub.id);
      } else {
        console.error(`[Forged cron] push error for ${sub.user_id}:`, err.message);
      }
    }
  }

  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  console.log(
    `[Forged cron] mode=${cronMode} sent=${sent} failed=${failed} skipped_dedup=${skippedDedup} skipped_window=${skippedWindow} skipped_category=${skippedCategory} stale_removed=${staleIds.length}`
  );
  return res.status(200).json({ mode: cronMode, sent, failed, skippedDedup, skippedWindow, skippedCategory });
}
