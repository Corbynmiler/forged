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
// Tone: aggressive, energising, escape-the-9-to-5 builder framing.
// Swear words intentional — this is a personal dev customisation.
const DEV_OWNER_ID = "5e9b4ba7-bf15-4e94-ab05-fe3306496973";
const DEV_OWNER_REMINDER_HOUR = 5;
const DEV_OWNER_REMINDER_MINUTE = 0;

// Day names for in-message references
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isWeekend(todayYmd) {
  const day = new Date(todayYmd + "T12:00:00Z").getUTCDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

function getDayName(todayYmd) {
  const day = new Date(todayYmd + "T12:00:00Z").getUTCDay();
  return DAY_NAMES[day];
}

// Deterministic-but-varied daily pick: same message all day (no flip on re-send),
// different message each day. Index rotates through pool by date number.
function devPick(pool, todayYmd) {
  const seed = parseInt(todayYmd.replace(/-/g, ""), 10);
  return pool[seed % pool.length];
}

function pickDevOwnerMessage(habits, goals, todayYmd) {
  const TRACKABLE = ["daily", "weekly", "project", "limit"];
  const trackableHabits = (habits || []).filter(
    h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log"
  );
  const allLogged =
    trackableHabits.length > 0 &&
    trackableHabits.every(h => hasAnyLogOnDate(h, todayYmd));

  const weekend = isWeekend(todayYmd);
  const day = getDayName(todayYmd);

  // ── All habits logged variants ───────────────────────────────────────────
  if (allLogged) {
    const pool = weekend
      ? [
          `All habits logged on a ${day}. That's how you build an exit ramp while everyone else is sleeping in. Keep going.`,
          `Full house on a ${day}. Logged, building, moving. This is exactly the shit that changes your situation.`,
          `Everything logged on a free ${day}. You're not just tracking habits — you're building the version of you that doesn't need the day job.`,
        ]
      : [
          `All logged before the commute even starts. That's the discipline that builds a way out. Now go earn the rest of the day.`,
          `Full house on a ${day}. Every habit logged. You're doing the work before work. That's exactly how you build something real.`,
          `Habits logged on a ${day} morning. Log it, build it, get out. You're doing the thing. Keep fucking going.`,
        ];
    return { title: "Forged ✅", body: devPick(pool, todayYmd) };
  }

  // ── Weekend pools ────────────────────────────────────────────────────────
  if (weekend) {
    const pool = [
      `It's ${day}. No boss. No commute. No one owns your hours today except you. Log your shit and build the fucking thing.`,
      `${day}! This is the time you grind for all week. Don't waste it. Get your habits logged and ship something that moves you closer to out.`,
      `Weekend hours are rarer than you think. ${day} — this is your real work. The app, the habits, the exit plan. Let's fucking go.`,
      `No meetings today. No Slack pings. Just you and what you're building. ${day} — make it count or Monday hits harder than it should.`,
      `It's ${day} and nobody's asking anything of you. That's rare. Use it. Log your habits. Build the thing that gets you the hell out.`,
      `Free time doesn't mean shit if you don't use it. ${day} — your window to build the life you actually want is wide open right now.`,
      `The 9-to-5 doesn't own ${day}. You do. Log your habits, open the laptop, and build the fucking exit.`,
      `Captain, it's the weekend. The version of you that escapes the grind gets built on ${day}s like this. Don't sleep on it.`,
      `${day} is your competitive advantage. Most people are watching TV. You're supposed to be building. Log it and get after it.`,
      `No alarm for work today — but you set one for a reason. ${day}, let's build something you're actually proud of, not just employed for.`,
      `It's ${day}. Every hour you put in here is an hour closer to never needing a ${day === "Saturday" ? "Monday" : "Monday"} to ruin your weekend again. Let's fucking go.`,
      `${day} morning, captain. Clear runway. Log your habits, shut the noise out, and build the escape hatch. Nobody does it for you.`,
    ];
    return { title: "Forged 🔥", body: devPick(pool, todayYmd) };
  }

  // ── Weekday pools ────────────────────────────────────────────────────────
  const pool = [
    `Oi captain, it's ${day}. Go punch in, survive the shift, then come home and build your actual fucking future. You're not doing this forever.`,
    `${day}. Every day you don't build is another day you have to go back. Log your habits and put in the work when you get home.`,
    `Work pays the bills today. Forged builds the exit. Log it, build it, don't let the day job steal the evening too.`,
    `Clock in. Clock out. Come home. Build. That's the deal you made. ${day} — hold up your end of it.`,
    `The boss can have 8 hours. The rest belongs to you and what you're building. ${day} — log it and protect the evening.`,
    `Another ${day} working for someone else. That ends when you build something better. Log your shit and keep moving.`,
    `${day} grind incoming. Fine. But tonight you work for yourself. Log your habits and remember what you're actually building toward.`,
    `It's ${day}. You're building an escape hatch. Every habit logged, every session shipped — it adds up. Don't miss today.`,
    `Full-time job today, full-time founder tonight. That's the deal you made with yourself. Log it and fucking stick to it.`,
    `You're not just building an app. You're building the reason you don't need to answer to someone else. ${day} — let's go.`,
    `${day} morning. The job is temporary. What you build here is yours. Get your habits logged before the grind swallows the whole day.`,
    `If even you don't use this app, who the fuck will? It's ${day} — log it, improve it, build it. Eat your own cooking.`,
    `${day}. You built this thing to get yourself out. Don't let a busy workday be the excuse you didn't build it for. Log it.`,
    `Five AM on a ${day}. Most people are asleep. You're up because you want something different. Log the habits, go to work, come back and build.`,
  ];
  return { title: "Forged 🔥", body: devPick(pool, todayYmd) };
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

    // ── Per-category gate: skip users who turned off daily reminders ────
    // The column is added by 20260423000000_notification_categories.sql.
    // If the column is absent (pre-migration) we treat it as enabled, which
    // matches the historical default.
    if (sub.daily_reminders_enabled === false) {
      skippedCategory++;
      continue;
    }

    // ── Windowed mode: only fire when local HH:MM bucket matches user ───
    // 5-minute buckets give us minute-level precision in practice without
    // running a per-minute cron. Without this guard, the */5 cron would
    // spam every user 12 times an hour.
    // Dev owner override: always fire at 05:00 regardless of DB reminder_time.
    if (isWindowed) {
      const isDevOwner = sub.user_id === DEV_OWNER_ID;
      const target = isDevOwner
        ? { hour: DEV_OWNER_REMINDER_HOUR, minute: DEV_OWNER_REMINDER_MINUTE }
        : parseReminderTime(sub.reminder_time);
      const now = hourMinuteNowInTimeZone(tz);
      if (now.hour !== target.hour || bucketMinute(now.minute) !== bucketMinute(target.minute)) {
        skippedWindow++;
        continue;
      }
    }

    // ── Local-day dedupe ────────────────────────────────────────────────
    // last_reminder_sent_date is "YYYY-MM-DD" in the user's local TZ. If
    // the migration hasn't run yet the field is undefined and we just send;
    // once the migration is applied this prevents accidental double-sends
    // on hourly schedules / retries / DST transitions.
    if (sub.last_reminder_sent_date && sub.last_reminder_sent_date === todayYmd) {
      skippedDedup++;
      continue;
    }

    const habits = habitsByUser[sub.user_id] || [];
    const goals = goalsByUser[sub.user_id] || [];
    const profile = profileByUser[sub.user_id] || {};

    let title;
    let body;
    if (sub.user_id === DEV_OWNER_ID) {
      // Personal dev-owner notifications — custom tone, escape-the-9-to-5 framing.
      // Scoped exclusively to DEV_OWNER_ID; never applied to any other user.
      ({ title, body } = pickDevOwnerMessage(habits, goals, todayYmd));
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
      // Stamp the local-day watermark so future runs in this calendar day
      // skip this user. Wrapped in try/catch so a missing column (pre-
      // migration) doesn't bubble up — the worst case is no dedupe.
      try {
        await supabase
          .from("push_subscriptions")
          .update({ last_reminder_sent_date: todayYmd })
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
