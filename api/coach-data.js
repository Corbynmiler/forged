import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

// ── Date helpers ───────────────────────────────────────────────────────────────
function ymdToday() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const u = Date.UTC(y, m - 1, d - n);
  const dt = new Date(u);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function getDailyStreak(logs, todayYmd) {
  const logDates = new Set(
    logs.filter(l => l.value === true || l.value === "skip").map(l => l.date)
  );
  const startDay = logDates.has(todayYmd) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    if (logDates.has(daysAgo(todayYmd, d))) streak++;
    else break;
  }
  return streak;
}

function getLast7Days(logs, todayYmd) {
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const date = daysAgo(todayYmd, i);
    const dayLogs = logs.filter(l => l.date === date);
    const logged = dayLogs.some(
      l => l.value === true || (typeof l.value === "number" && l.value > 0)
    );
    const skip = dayLogs.some(l => l.value === "skip");
    result.push({ date, logged, skip });
  }
  return result;
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ── Authenticate the caller ──────────────────────────────────────────────
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify JWT and resolve user
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  // Guard: caller must be a coach OR admin. Accept any of three signals:
  //  • is_admin  — dev / support override
  //  • is_coach  — boolean flag set by Stripe webhook on checkout
  //  • coach_tier IS NOT NULL — belt-and-suspenders in case is_coach got out of sync
  const { data: callerProfile, error: profileErr } = await supabase
    .from("profiles")
    .select("is_admin, is_coach, coach_tier")
    .eq("id", user.id)
    .single();

  const hasAccess =
    callerProfile?.is_admin ||
    callerProfile?.is_coach ||
    !!callerProfile?.coach_tier;

  if (!hasAccess) {
    console.warn("[coach-data] 403 for user", user.id,
      "| callerProfile:", JSON.stringify(callerProfile),
      "| profileErr:", profileErr?.message ?? "none");
    return res.status(403).json({ error: "Forbidden" });
  }

  const todayYmd = ymdToday();

  // ── Fetch profiles assigned to this coach ────────────────────────────────
  // Filter happens in SQL via coach_id = caller.id (set when a user signs up
  // via this coach's invite link, see /api/accept-coach-invite). Profiles
  // with coach_id IS NULL are excluded by the equality predicate, which is
  // what we want — unaffiliated users should not appear in any coach's list.
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, name, xp, is_pro, is_admin, current_streak, created_at")
    .eq("coach_id", user.id)
    .order("xp", { ascending: false });
  if (profilesErr) return res.status(500).json({ error: profilesErr.message });

  const userIds = (profiles || []).map(p => p.id);
  if (userIds.length === 0) return res.status(200).json({ clients: [], stats: {}, asOf: todayYmd });

  // ── Fetch habits (exclude goals / log types) ─────────────────────────────
  const { data: habits, error: habitsErr } = await supabase
    .from("habits")
    .select("user_id, name, emoji, habit_type, logs, streak, best_streak")
    .in("user_id", userIds)
    .not("habit_type", "in", '("goal","progress","log")');
  if (habitsErr) return res.status(500).json({ error: habitsErr.message });

  // ── Fetch emails via admin API ───────────────────────────────────────────
  const emailById = {};
  try {
    const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of authData?.users || []) emailById[u.id] = u.email;
  } catch (e) {
    console.warn("[coach-data] Could not fetch emails:", e.message);
  }

  // ── Group habits by user ─────────────────────────────────────────────────
  const habitsByUser = {};
  for (const h of habits || []) {
    if (!habitsByUser[h.user_id]) habitsByUser[h.user_id] = [];
    habitsByUser[h.user_id].push(h);
  }

  // ── Build client summaries ───────────────────────────────────────────────
  const TRACKABLE = ["daily", "weekly", "project", "limit"];

  // No further JS-side filtering needed — the coach_id = caller.id SQL
  // predicate already scopes the result to this coach's assigned clients.
  const clients = (profiles || [])
    .map(p => {
      const userHabits = (habitsByUser[p.id] || []).filter(h => TRACKABLE.includes(h.habit_type));

      const habitSummaries = userHabits.map(h => {
        const logs = h.logs || [];
        const streak = h.habit_type === "daily" ? getDailyStreak(logs, todayYmd) : (h.streak || 0);
        const loggedToday = logs.some(
          l => l.date === todayYmd && (l.value === true || (typeof l.value === "number" && l.value > 0))
        );
        const sortedLogs = [...logs].sort((a, b) => b.date.localeCompare(a.date));
        const lastLogDate = sortedLogs[0]?.date ?? null;
        const recentNote = sortedLogs.find(l => l.note || l.reflection)?.note
          || sortedLogs.find(l => l.note || l.reflection)?.reflection
          || null;
        return {
          name: h.name,
          emoji: h.emoji || "",
          habitType: h.habit_type,
          streak,
          loggedToday,
          lastLogDate,
          last7: getLast7Days(logs, todayYmd),
          recentNote,
        };
      });

      const loggedTodayCount = habitSummaries.filter(h => h.loggedToday).length;
      const bestStreak = habitSummaries.reduce((m, h) => Math.max(m, h.streak), 0);
      const lastActiveDate = habitSummaries
        .map(h => h.lastLogDate).filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0] ?? null;
      const daysSinceActive = lastActiveDate
        ? Math.round((new Date(todayYmd) - new Date(lastActiveDate)) / 86400000)
        : null;

      return {
        id: p.id,
        name: p.name || "Unnamed",
        email: emailById[p.id] ?? null,
        xp: p.xp || 0,
        isPro: !!(p.is_pro),
        totalHabits: userHabits.length,
        loggedTodayCount,
        bestStreak,
        lastActiveDate,
        daysSinceActive,
        habits: habitSummaries,
        joinedAt: p.created_at,
      };
    })
    .sort((a, b) => {
      if (a.loggedTodayCount > 0 && b.loggedTodayCount === 0) return -1;
      if (b.loggedTodayCount > 0 && a.loggedTodayCount === 0) return 1;
      if (a.lastActiveDate && b.lastActiveDate) return b.lastActiveDate.localeCompare(a.lastActiveDate);
      if (a.lastActiveDate) return -1;
      if (b.lastActiveDate) return 1;
      return 0;
    });

  const stats = {
    totalClients: clients.length,
    activeToday: clients.filter(c => c.loggedTodayCount > 0).length,
    proCount: clients.filter(c => c.isPro).length,
    avgStreak: clients.length > 0
      ? Math.round(clients.reduce((s, c) => s + c.bestStreak, 0) / clients.length)
      : 0,
  };

  return res.status(200).json({ clients, stats, asOf: todayYmd });
}
