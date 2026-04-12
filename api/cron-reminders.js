import webpush from "web-push";
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
// We start from yesterday because the notification fires before the user logs today.

function calcDailyStreak(logs) {
  const loggedDates = new Set(
    (logs || []).filter(l => l.value === true).map(l => l.date)
  );
  let streak = 0;
  for (let i = 1; i <= 365; i++) {
    if (loggedDates.has(daysAgo(i))) streak++;
    else break;
  }
  return streak;
}

// ── Message picker ─────────────────────────────────────────────────────────────
// Returns { title, body } for a single user based on their habits + goals.
// Priority: streak protection → goal deadline → re-engagement → default.

function pickMessage(habits, goals) {
  const today = todayStr();

  // ── 1. Streak protection (≥ 3 days) ────────────────────────────────────────
  let bestStreak = 0;
  let bestStreakHabit = null;
  for (const h of habits) {
    if (h.habit_type !== "daily") continue;
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

  // ── 3. Re-engagement — habit not logged in 2+ days ─────────────────────────
  let worstGap = 0;
  let gapHabit = null;
  for (const h of habits) {
    if (h.habit_type !== "daily") continue;
    const trueLogs = (h.logs || [])
      .filter(l => l.value === true)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (trueLogs.length === 0) continue;
    const gap = daysBetween(trueLogs[0].date, today);
    if (gap >= 2 && gap > worstGap) { worstGap = gap; gapHabit = h; }
  }
  if (gapHabit) {
    const e = gapHabit.emoji || "💪";
    return {
      title: "Forged",
      body: `${e} ${gapHabit.name} — ${worstGap} days since your last log. Today's the day.`,
    };
  }

  // ── 4. Default: habit count ─────────────────────────────────────────────────
  const dailyCount = habits.filter(h => h.habit_type === "daily").length;
  if (dailyCount > 0) {
    return {
      title: "Forged",
      body: `${dailyCount} habit${dailyCount === 1 ? "" : "s"} to log today. Let's build. 🔨`,
    };
  }

  return { title: "Forged", body: "Time to log your habits 🔥" };
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

  // 3. Group by user
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

  // 4. Send personalized push per subscriber
  let sent = 0;
  let failed = 0;
  const staleIds = [];

  await Promise.all(
    subs.map(async (sub) => {
      const habits = habitsByUser[sub.user_id] || [];
      const goals  = goalsByUser[sub.user_id]  || [];
      const { title, body } = pickMessage(habits, goals);

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
    })
  );

  // 5. Clean up dead subscriptions
  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  console.log(`[Forged cron] sent: ${sent}, failed: ${failed}, stale removed: ${staleIds.length}`);
  return res.status(200).json({ sent, failed });
}
