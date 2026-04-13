import webpush from "web-push";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

// ── Date helpers ───────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function daysBetween(fromStr, toStr) {
  return Math.round((new Date(toStr) - new Date(fromStr)) / 86400000);
}

// ── Streak calculation ─────────────────────────────────────────────────────────
// Counts consecutive days ending *yesterday* with value===true.
// We start from yesterday because the notification fires at end of day.

function calcDailyStreak(logs) {
  const loggedDates = new Set(
    (logs || []).filter(l => l.value === true).map(l => l.date)
  );
  let streak = 0;
  // Start from today (7pm — user has had time to log)
  for (let i = 0; i <= 365; i++) {
    if (loggedDates.has(daysAgo(i))) streak++;
    else break;
  }
  return streak;
}

// ── "Logged today" check ───────────────────────────────────────────────────────

function weekStartStr(todayISO) {
  const d = new Date(todayISO);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  return d.toISOString().split("T")[0];
}

function isHabitDoneToday(h, today) {
  const logs = h.logs || [];
  if (h.habit_type === "weekly") {
    const ws = weekStartStr(today);
    return logs.some(l => l.date >= ws && l.value === true);
  }
  const todayLog = logs.find(l => l.date === today);
  if (!todayLog) return false;
  if (h.habit_type === "daily") return todayLog.value === true;
  // build / limit / project — any non-null numeric or truthy value counts
  return todayLog.value !== null && todayLog.value !== undefined && todayLog.value !== false;
}

// ── Message picker ─────────────────────────────────────────────────────────────
// Returns { title, body } for a single user based on their habits + goals.
// Priority: all done → streak → goal deadline → re-engagement → default.

function pickMessage(habits, goals) {
  const today = todayStr();

  const TRACKABLE = ["daily", "weekly", "build", "limit", "project"];

  // ── 0. All habits logged today → congrats ──────────────────────────────────
  const trackableHabits = habits.filter(h => TRACKABLE.includes(h.habit_type));
  if (trackableHabits.length > 0 && trackableHabits.every(h => isHabitDoneToday(h, today))) {
    const CONGRATS = [
      "Every habit logged. That's how it's built. ⚒️",
      "100% today. You showed up and got it done. 🔥",
      "All done for today. You're an absolute weapon. 💪",
      "Full house. Keep this up and nothing stops you. 🏆",
      "Locked in today. Log your progress and keep pushing. ✅",
    ];
    const msg = CONGRATS[new Date().getDate() % CONGRATS.length]; // rotates daily
    return { title: "Forged ✅", body: msg };
  }

  // ── 1. Streak protection (≥ 3 days, all daily-style habits) ────────────────
  let bestStreak = 0;
  let bestStreakHabit = null;
  for (const h of habits) {
    if (h.habit_type !== "daily") continue; // only daily habits have day-based streaks
    const s = calcDailyStreak(h.logs);
    if (s > bestStreak) { bestStreak = s; bestStreakHabit = h; }
  }
  if (bestStreakHabit && bestStreak >= 3) {
    const e = bestStreakHabit.emoji || "🔥";
    return {
      title: "Forged 🔥",
      body: `${e} ${bestStreak}-day ${bestStreakHabit.name} streak. Don't break it today.`,
    };
  }

  // ── 2. Goal deadline within 7 days ─────────────────────────────────────────
  const urgentGoals = (goals || [])
    .filter(g => g.goal_status === "active" && g.target_date)
    .map(g => ({ ...g, daysLeft: daysBetween(today, g.target_date) }))
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

  // ── 3. Re-engagement — any habit not logged in 2+ days ─────────────────────
  let worstGap = 0;
  let gapHabit = null;
  for (const h of habits) {
    if (!TRACKABLE.includes(h.habit_type)) continue;
    const recentLogs = (h.logs || [])
      .filter(l => l.value !== null && l.value !== undefined && l.value !== false)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (recentLogs.length === 0) continue;
    const gap = daysBetween(recentLogs[0].date, today);
    if (gap >= 2 && gap > worstGap) { worstGap = gap; gapHabit = h; }
  }
  if (gapHabit) {
    const e = gapHabit.emoji || "💪";
    return {
      title: "Forged",
      body: `${e} ${gapHabit.name} — ${worstGap} days since your last log. Today's the day.`,
    };
  }

  // ── 4. Default: total habit count (all types) ───────────────────────────────
  const totalCount = habits.filter(h => TRACKABLE.includes(h.habit_type)).length;
  if (totalCount > 0) {
    return {
      title: "Forged",
      body: `${totalCount} habit${totalCount === 1 ? "" : "s"} to log today. Let's build. 🔨`,
    };
  }

  return { title: "Forged", body: "Time to log your habits 🔥" };
}

// ── AI-personalised message (Pro users only) ───────────────────────────────────

async function aiPickMessage(name, habits, goals) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const today = todayStr();
  const TRACKABLE = ["daily", "weekly", "build", "limit", "project"];

  const summaries = habits.filter(h => TRACKABLE.includes(h.habit_type)).map(h => {
    const streak = calcDailyStreak(h.logs);
    const doneToday = isHabitDoneToday(h, today);
    const recentLogs = (h.logs || [])
      .filter(l => l.date >= daysAgo(7))
      .sort((a, b) => b.date.localeCompare(a.date));
    const reflections = recentLogs.filter(l => l.reflection).slice(0, 2).map(l => l.reflection);
    let line = `- ${h.emoji || ""} ${h.name} (streak: ${streak}d, logged today: ${doneToday})`;
    if (reflections.length) line += `, recent notes: "${reflections.join("; ")}"`;
    return line;
  }).join("\n");

  const urgentGoals = (goals || [])
    .filter(g => g.goal_status === "active" && g.target_date)
    .map(g => ({ ...g, daysLeft: daysBetween(today, g.target_date) }))
    .filter(g => g.daysLeft >= 0 && g.daysLeft <= 7);

  const goalLine = urgentGoals.length
    ? `Upcoming deadlines: ${urgentGoals.map(g => `${g.name} in ${g.daysLeft}d`).join(", ")}`
    : "";

  const prompt = `You are a habit coach sending ${name} a short push notification for their Forged app.

Their habits today (${today}):
${summaries || "No habits yet"}
${goalLine}

Write ONE push notification body (max 90 chars). Be direct, specific to their actual data, motivating but not cheesy. No hashtags, no quotes around it, just the text. Reference a real habit or streak if you can.`;

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

  // 1. Get all subscribers
  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, subscription")
    .eq("notifications_enabled", true);

  if (subErr) return res.status(500).json({ error: subErr.message });
  if (!subs || subs.length === 0) return res.status(200).json({ sent: 0, message: "No active subscribers" });

  const userIds = subs.map(s => s.user_id);

  // 2. Fetch all habits + goals for these users in one query
  const { data: allRows } = await supabase
    .from("habits")
    .select("user_id, name, emoji, habit_type, logs, target_date, goal_status")
    .in("user_id", userIds);

  // 3. Fetch profiles to get name + is_pro
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, is_pro")
    .in("id", userIds);

  const profileByUser = {};
  for (const p of (profiles || [])) profileByUser[p.id] = p;

  // 4. Group habits/goals by user
  const habitsByUser = {};
  const goalsByUser  = {};
  for (const row of (allRows || [])) {
    if (row.habit_type === "goal" || row.habit_type === "progress") {
      if (!goalsByUser[row.user_id])  goalsByUser[row.user_id]  = [];
      goalsByUser[row.user_id].push(row);
    } else {
      if (!habitsByUser[row.user_id]) habitsByUser[row.user_id] = [];
      habitsByUser[row.user_id].push(row);
    }
  }

  // 5. Send personalised push per subscriber
  // Pro users get AI-generated copy; free users get rule-based copy.
  // Run AI calls serially to stay within cron timeout.
  let sent = 0;
  let failed = 0;
  const staleIds = [];

  for (const sub of subs) {
    const habits  = habitsByUser[sub.user_id] || [];
    const goals   = goalsByUser[sub.user_id]  || [];
    const profile = profileByUser[sub.user_id] || {};

    let title, body;
    if (profile.is_pro && process.env.ANTHROPIC_API_KEY) {
      const aiMsg = await aiPickMessage(profile.name || "there", habits, goals);
      ({ title, body } = aiMsg || pickMessage(habits, goals));
    } else {
      ({ title, body } = pickMessage(habits, goals));
    }

    const payload = JSON.stringify({ title, body, url: "/" });

    try {
      await webpush.sendNotification(sub.subscription, payload);
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        staleIds.push(sub.id);
      } else {
        console.error(`[Forged cron] push error for ${sub.user_id}:`, err.message);
      }
    }
  }

  // 5. Clean up dead subscriptions
  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  console.log(`[Forged cron] sent: ${sent}, failed: ${failed}, stale removed: ${staleIds.length}`);
  return res.status(200).json({ sent, failed });
}
