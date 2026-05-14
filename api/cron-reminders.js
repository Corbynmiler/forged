import webpush from "web-push";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

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

function hasAnyLogOnDate(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr);
}

/** Matches client `isSatisfiedForTodayRing` for non-log habits (Today ring %). */
function forgedRingSatisfiedTodayRow(h, todayYmd) {
  if (h.habit_type === "log") return false;
  const logs = h.logs || [];
  if (h.habit_type === "weekly") {
    const target = Math.max(1, Number(h.weekly_target) || 1);
    if (hasRestDay(h, todayYmd)) return true;
    const ws = weekStartMondayFromYmd(todayYmd);
    const weekEnd = addCalendarDays(ws, 6);
    const count = logs.filter(l => l.date >= ws && l.date <= weekEnd && l.value === true).length;
    if (count >= target) return true;
    return logs.some(l => l.date === todayYmd && l.value === true);
  }
  if (h.habit_type === "daily") {
    return hasDailyCompletion(h, todayYmd) || hasRestDay(h, todayYmd);
  }
  return hasAnyLogOnDate(h, todayYmd);
}

/**
 * Stricter "real progress today" for AI copy — aligns with the Today forged ring
 * (weekly: session, rest day, or weekly target already met).
 */
function strictLoggedProgressToday(h, todayYmd) {
  if (h.habit_type === "log") return false;
  const logs = h.logs || [];

  if (h.habit_type === "daily") {
    return hasDailyCompletion(h, todayYmd) || hasRestDay(h, todayYmd);
  }
  if (h.habit_type === "weekly") {
    return forgedRingSatisfiedTodayRow(h, todayYmd);
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

// ── Normal-user fixed send hours ───────────────────────────────────────────────

function isWeekend(todayYmd) {
  const day = new Date(todayYmd + "T12:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}


// ── Normal-user fixed send hours ───────────────────────────────────────────────
// Every regular user gets a notification at these three local-time hours per day
// (instead of their configured reminder_time). The cron's 5-minute windowed check
// filters to :00 buckets at these hours only.
const NORMAL_FIRE_HOURS = [7, 12, 19];

/** Map a local hour → the slot label used for dedup keys and pool selection. */
function normalUserSlot(hour) {
  if (hour < 11) return "morning";
  if (hour < 16) return "noon";
  return "evening";
}

// ── Normal-user message pools ─────────────────────────────────────────────────
// Tone: coach-voiced, direct, warm — not a generic app notification.
// Use {coach} where the coach name should appear — replaced at send time.
// Pools are weekday / weekend × morning / noon / evening.
const NORMAL_POOLS = {
  morning: {
    weekday: [
      "Morning. Before the day gets loud — quick check-in. How are you feeling? — {coach}",
      "New day. Let's make it count. Log when you're ready. — {coach}",
      "Good morning. Small wins early set the tone for everything after. — {coach}",
      "Hey — hope you slept well. Log your habits when you get a sec. — {coach}",
      "Morning nudge. Don't let the day get away from you before you've checked in. — {coach}",
      "Up and at it. Your habits are what separate a good day from a wasted one. — {coach}",
      "Morning. Even 5 minutes of intentional work beats an unfocused hour. Log when you can. — {coach}",
      "Hey — another chance to show up for yourself. Don't overthink it, just start. — {coach}",
      "Good morning. The way you start the day usually sets the tone. Log when you're ready. — {coach}",
      "Morning check-in. Whatever's on your plate today — your habits come first. — {coach}",
      "Hey, it's a new day. Log early if you can — it makes everything easier later. — {coach}",
      "Morning. You've built something worth protecting. Don't let today slip through. — {coach}",
    ],
    weekend: [
      "Morning. No alarm, no pressure — but don't let the weekend slip by without checking in. — {coach}",
      "Weekend morning. Slower pace is fine — same habits. Log when the coffee kicks in. — {coach}",
      "Hey — hope the weekend's starting well. A quick log before the day takes off. — {coach}",
      "Free day ahead. Do something you love and log it. — {coach}",
      "Weekend nudge. The habits don't know it's Saturday — keep the streak going. — {coach}",
      "Morning. Weekends are for recharging, not losing the thread. Log when you're ready. — {coach}",
      "Hey — rest if you need it, move if you want to. Either way, check in before the day escapes. — {coach}",
      "Hope the weekend's starting well. Quick habit log whenever you're up for it. — {coach}",
      "Free day! Hope it's a good one — just don't let it slip by without logging. — {coach}",
      "Weekend morning. Your future self will thank you for not skipping today. Log when you can. — {coach}",
    ],
  },
  noon: {
    weekday: [
      "Midday. How's the morning been? Log your habits before the afternoon runs away. — {coach}",
      "Lunchtime. Halfway through — you're doing great. Log when you can. — {coach}",
      "Noon check-in. Take a breath, eat something decent, and log your habits. — {coach}",
      "Hey — hope lunchtime finds you well. Quick log when you get a sec. — {coach}",
      "Morning's behind you. The afternoon is still yours to make count — start by logging. — {coach}",
      "Lunchtime. Habits don't log themselves. Two minutes, that's all it takes. — {coach}",
      "Midday nudge — how's the day shaping up? Log your progress when you get a moment. — {coach}",
      "Don't let the afternoon sneak past without ticking off your habits. — {coach}",
      "Halfway there. Log your habits, take a breath, finish strong. — {coach}",
      "Hey — quick midday check-in. A log now means you won't be scrambling at night. — {coach}",
      "Midday. If the morning was rough, the afternoon can turn it around. Log and carry on. — {coach}",
      "Noon. Take a moment for yourself today — habits included. — {coach}",
    ],
    weekend: [
      "Lunchtime. Hope the morning was a good one. Quick habit check before the afternoon slips away. — {coach}",
      "Midday check-in. How's the weekend going? Log when you get a moment. — {coach}",
      "Hope you're having a relaxed one. Quick log whenever it suits you. — {coach}",
      "Lunchtime on a free day. Log your habits and enjoy the afternoon. — {coach}",
      "Noon — weekend or not, your habits are what keep the good stuff compounding. — {coach}",
      "Hey — whatever you've been up to this morning, log it and keep going. — {coach}",
      "Lunchtime nudge. Eat well, log your habits, make the most of the afternoon. — {coach}",
      "Midday. Hope the weekend's treating you well. Quick habit check when you get a sec. — {coach}",
      "Halfway through a free day. Don't forget to log — even the easy days matter. — {coach}",
      "Noon on a free day. Log your habits, enjoy the rest. That's the whole plan. — {coach}",
    ],
  },
  evening: {
    weekday: [
      "How was today? Whatever it threw at you — you showed up. Log before you switch off. — {coach}",
      "Evening. Take a moment to log the day and let it go. — {coach}",
      "End of the day. Some days are hard, some are great — log it either way. — {coach}",
      "You made it through another one. Log your habits and give yourself a moment. — {coach}",
      "Hey — hope tonight finds you well. Quick log before you call it a day. — {coach}",
      "Day's winding down. Log your habits before you switch off — takes about a minute. — {coach}",
      "How'd today go? Log your habits and take a breath. — {coach}",
      "Evening check-in — before the day closes out. Log and rest well. — {coach}",
      "The day's behind you now. Log what you did, even the small stuff — it all adds up. — {coach}",
      "Hope you're winding down nicely. Quick habit log before you call it a night. — {coach}",
      "You showed up today. Make sure you log it before you forget. — {coach}",
      "Whatever happened today — take a moment to reflect, log, and recharge. — {coach}",
      "Day done. A quick log keeps the momentum alive for tomorrow. — {coach}",
      "Evening check-in. Log your habits, be proud of what you did, and rest up. — {coach}",
    ],
    weekend: [
      "Hope the weekend's been a good one. Log your habits before you call it a day. — {coach}",
      "Evening. Whatever today looked like — adventurous, restful, or in between — log it. — {coach}",
      "Weekend's winding down. Log your habits and soak up the rest of the evening. — {coach}",
      "End of a free day. How was it? Log it before the memory fades. — {coach}",
      "Whether you made the most of it or just needed the rest — both count. Log it. — {coach}",
      "Weekend evening. The week starts again soon — log and finish on a good note. — {coach}",
      "Hope tonight's been a good one. Quick log before you call it a night. — {coach}",
      "Whatever you got up to today — log it and rest well. — {coach}",
      "Don't let the weekend slip by without logging — even the easy days matter. — {coach}",
      "Weekend's almost done. Log before you drift off — literally takes a minute. — {coach}",
      "Log it, reflect on the weekend, and get ready to go again. — {coach}",
      "How was the weekend? Log before you wind down — you'll be glad you did. — {coach}",
    ],
  },
};

// Shown when every habit is already logged for the day.
const NORMAL_ALL_LOGGED = [
  "Every habit logged today — that's how it's done. — {coach}",
  "All habits in. You showed up and got it done. — {coach}",
  "Full house today. Keep this up and nothing stops you. — {coach}",
  "All done for the day. That's the stuff. — {coach}",
  "Locked in. Every habit logged. — {coach}",
];

/**
 * Resolve the {coach} placeholder in a message body.
 * Falls back to "Forged" if no coach name is set.
 */
function applyCoachName(body, coachName) {
  return body.replace(/\{coach\}/g, coachName || "Forged");
}

/**
 * Message picker for normal users — time-slot aware, weekday/weekend aware,
 * coach-name personalised. Data-driven shoutouts fire first (all-logged,
 * streak, urgent goal); pool message is the fallback.
 */
function pickNormalMessage(habits, goals, todayYmd, localHour, coachName) {
  const TRACKABLE = ["daily", "weekly", "project", "limit"];
  const trackableHabits = (habits || []).filter(
    h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log"
  );

  const resolve = body => applyCoachName(body, coachName);

  // All habits logged today — congratulate them.
  if (trackableHabits.length > 0 && trackableHabits.every(h => forgedRingSatisfiedTodayRow(h, todayYmd))) {
    const idx = parseInt(todayYmd.replace(/-/g, ""), 10) % NORMAL_ALL_LOGGED.length;
    return { title: "Forged ✅", body: resolve(NORMAL_ALL_LOGGED[idx]) };
  }

  // Streak shoutout — only for daily habits with a meaningful run.
  let bestStreak = 0;
  let bestStreakHabit = null;
  for (const h of habits || []) {
    if (h.habit_type !== "daily") continue;
    const s = getDailyStreak(h, todayYmd);
    if (s > bestStreak) { bestStreak = s; bestStreakHabit = h; }
  }
  if (bestStreakHabit && bestStreak >= 3) {
    const e = bestStreakHabit.emoji || "🔥";
    return {
      title: "Forged 🔥",
      body: resolve(`${e} ${bestStreak} days of ${bestStreakHabit.name} — don't break the streak now. — {coach}`),
    };
  }

  // Urgent goal deadline within 7 days.
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
      body: resolve(`${e} "${g.name}" is due ${when}. Log your progress and give it a push. — {coach}`),
    };
  }

  // Pool-based fallback — deterministic so same slot picks same message within a day.
  const weekend = isWeekend(todayYmd);
  const slot = normalUserSlot(localHour ?? 7);
  const poolKey = weekend ? "weekend" : "weekday";
  const pool = (NORMAL_POOLS[slot] || NORMAL_POOLS.morning)[poolKey];
  const dateSeed = parseInt(todayYmd.replace(/-/g, ""), 10);
  const seed = dateSeed * 11 + (localHour ?? 0) * 7;
  const body = pool[Math.abs(seed) % pool.length];
  return { title: "Forged", body: resolve(body) };
}

async function aiPickMessage(name, coachName, habits, goals, todayYmd, localHour) {
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

  const hour = localHour ?? 12;
  const timeLabel = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const toneHint = hour >= 19
    ? "It's evening — lean into a warm end-of-day check-in. Ask how they're doing, acknowledge the day, be supportive. Less command, more care."
    : hour < 10
    ? "It's morning — be upbeat and gently encouraging. Help set a positive tone for the day ahead."
    : "It's midday — be friendly and motivating. Acknowledge they're in the thick of the day.";

  const signOff = `— ${coachName || "Forged"}`;

  const prompt = `You are ${coachName || "a habit coach"}, sending ${name} a push notification for their Forged app.

Time of day: ${timeLabel} (local hour: ${hour})
Date: ${todayYmd}

Their habits:
${summaries || "No habits yet"}
${goalLine}

Write ONE push notification body (max 110 chars). Start with "Hey ${name}," to feel personal and warm. Vary your tone — sometimes check how they're doing, sometimes gently celebrate what's going well, sometimes offer a light nudge. ${toneHint}

No hashtags. No quotes around the message. Always end with "${signOff}" — no exceptions.

Hard rules:
- NEVER open with a command like "Log one habit right now" — be warmer and more natural than that.
- NEVER claim they completed a habit today unless that habit's line explicitly shows logged today: true.
- NEVER invent numbers, streaks, or events not present in the data above.
- If every line shows logged today: false, gently nudge them to log — do not congratulate.
- "log"-type habits are omitted; do not mention them.
- End with exactly: ${signOff}`;

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

async function handler(req, res) {
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
  //   - "windowed" (default): only send to users whose configured local
  //                          HH:MM (5-minute bucket) matches NOW in their
  //                          timezone. Pair with the `*/5 * * * *` Vercel
  //                          cron schedule. This is the only mode that
  //                          actually delivers each user a reminder at
  //                          their chosen local time.
  //   - "hourly"            : alias for "windowed" (back-compat).
  //   - "daily"             : legacy mode — send once per cron invocation
  //                          to every enabled subscriber. Only correct
  //                          when paired with a once-per-day cron schedule
  //                          (e.g. `0 7 * * *`). Leaves it impossible to
  //                          honour per-user reminder times, so we no
  //                          longer default to it.
  // Every mode also dedupes via last_reminder_sent_date so the same user
  // never gets two daily reminders on the same local calendar day.
  const cronMode = (process.env.CRON_MODE || "windowed").toLowerCase().trim();
  const isWindowed = cronMode === "hourly" || cronMode === "windowed";

  const debug = process.env.DEBUG_CRON === "1" || process.env.DEBUG_CRON === "true";

  console.log("[Forged cron] start", {
    mode: cronMode,
    isWindowed,
    cron_secret_present: Boolean(cronSecret),
    vapid_public_present: Boolean(process.env.VAPID_PUBLIC_KEY),
    vapid_private_present: Boolean(process.env.VAPID_PRIVATE_KEY),
    anthropic_present: Boolean(process.env.ANTHROPIC_API_KEY),
    debug,
    now_utc: new Date().toISOString(),
  });

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
    .select("id, name, is_pro, coach_name")
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
  // Per-user trace populated when DEBUG_CRON=1; surfaced in the response so
  // you can hit the cron manually with curl + Bearer CRON_SECRET to see who
  // got picked and why.
  const trace = [];

  console.log(`[Forged cron] subscribers loaded count=${subs.length}`);

  for (const sub of subs) {
    const tz = tzByUser[sub.user_id] || "UTC";
    const todayYmd = ymdNowInTimeZone(tz);
    const now = hourMinuteNowInTimeZone(tz);

    // ── Per-category gate: skip users who turned off daily reminders ────
    if (sub.daily_reminders_enabled === false) {
      if (debug) trace.push({ user_id: sub.user_id, skipped: "category_disabled" });
      skippedCategory++;
      continue;
    }

    // ── Windowed mode: only fire at 7am, 12pm, 7pm local time (:00 bucket) ──
    if (isWindowed) {
      if (!NORMAL_FIRE_HOURS.includes(now.hour) || bucketMinute(now.minute) !== 0) {
        if (debug) trace.push({
          user_id: sub.user_id, skipped: "window_miss",
          tz, now_local: now, fire_hours: NORMAL_FIRE_HOURS,
        });
        skippedWindow++;
        continue;
      }
    }

    // ── Dedupe: one send per slot (morning|noon|evening) per day ────────
    const dedupKey = `${todayYmd}_${normalUserSlot(now.hour)}`;
    if (sub.last_reminder_sent_date && sub.last_reminder_sent_date === dedupKey) {
      if (debug) trace.push({ user_id: sub.user_id, skipped: "dedup", dedup_key: dedupKey, last: sub.last_reminder_sent_date });
      skippedDedup++;
      continue;
    }

    const habits = habitsByUser[sub.user_id] || [];
    const goals = goalsByUser[sub.user_id] || [];
    const profile = profileByUser[sub.user_id] || {};
    const coachName = profile.coach_name || null;

    let title;
    let body;
    if (profile.is_pro && process.env.ANTHROPIC_API_KEY) {
      const aiMsg = await aiPickMessage(profile.name || "there", coachName, habits, goals, todayYmd, now.hour);
      ({ title, body } = aiMsg || pickNormalMessage(habits, goals, todayYmd, now.hour, coachName));
    } else {
      ({ title, body } = pickNormalMessage(habits, goals, todayYmd, now.hour, coachName));
    }

    const payload = JSON.stringify({ title, body, url: "/", tag: "forged-reminder" });

    try {
      await webpush.sendNotification(sub.subscription, payload);
      sent++;
      if (debug) trace.push({ user_id: sub.user_id, sent: true, title, dedup_key: dedupKey });
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
      // FCM/APNS returns 404/410 for a subscription the browser has rotated,
      // unsubscribed, or the user revoked. The DB row is now garbage — purge
      // it so we don't keep hammering an endpoint that will never deliver.
      // The user's app re-subscribes automatically on next open (sw + UI),
      // but if the row stays around the cron will keep failing on it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        staleIds.push(sub.id);
        console.warn(`[Forged cron] stale subscription for ${sub.user_id} status=${err.statusCode} — deleting row, user must re-enable in app`);
        if (debug) trace.push({ user_id: sub.user_id, sent: false, error: "stale_subscription", statusCode: err.statusCode });
      } else {
        console.error(`[Forged cron] push error for ${sub.user_id}:`, err.message, "statusCode=", err.statusCode);
        if (debug) trace.push({ user_id: sub.user_id, sent: false, error: err.message, statusCode: err.statusCode });
      }
    }
  }

  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  console.log(
    `[Forged cron] done mode=${cronMode} sent=${sent} failed=${failed} skipped_dedup=${skippedDedup} skipped_window=${skippedWindow} skipped_category=${skippedCategory} stale_removed=${staleIds.length}`
  );
  return res.status(200).json({
    mode: cronMode,
    subs_total: subs.length,
    sent,
    failed,
    skippedDedup,
    skippedWindow,
    skippedCategory,
    staleRemoved: staleIds.length,
    ...(debug ? { trace } : {}),
  });
}

export default withSentry(handler, "cron-reminders");
