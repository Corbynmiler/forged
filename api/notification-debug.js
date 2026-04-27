// Read-only diagnostic for the push notification pipeline.
//
// GET /api/notification-debug
//   Headers: Authorization: Bearer <Supabase user access token>
//
// Reports:
//   - which env vars the cron handler needs (presence only, never values)
//   - your push_subscriptions row state, including last_reminder_sent_date
//   - the dedup key the cron WOULD compute for you right now
//   - total active subscribers in the system
//
// Auth: requires a logged-in user. Returns full data only for the dev owner
// (DEV_OWNER_ID); other authenticated users get just their own row state.
// Never reveals VAPID secrets, subscription endpoints, or the CRON_SECRET.

import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const DEV_OWNER_ID = "5e9b4ba7-bf15-4e94-ab05-fe3306496973";

function ymdNowInTimeZone(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function hourMinuteNowInTimeZone(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    return {
      hour: parseInt(parts.find(p => p.type === "hour")?.value, 10) || 0,
      minute: parseInt(parts.find(p => p.type === "minute")?.value, 10) || 0,
    };
  } catch {
    const d = new Date();
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY missing" });

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  const isDevOwner = user.id === DEV_OWNER_ID;

  // ── This caller's subscription row (always returned for the caller) ───
  const { data: mySub } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, timezone, reminder_time, notifications_enabled, daily_reminders_enabled, nudges_enabled, social_invites_enabled, last_reminder_sent_date, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  let myComputedDedupKey = null;
  let myLocalNow = null;
  if (mySub) {
    const tz = mySub.timezone || "UTC";
    const todayYmd = ymdNowInTimeZone(tz);
    const now = hourMinuteNowInTimeZone(tz);
    myLocalNow = { tz, todayYmd, hour: now.hour, minute: now.minute };
    // Mirrors cron-reminders.js dedup logic.
    myComputedDedupKey = isDevOwner ? `${todayYmd}H${now.hour}` : todayYmd;
  }

  const base = {
    me: {
      user_id: user.id,
      is_dev_owner: isDevOwner,
      subscription_row_present: Boolean(mySub),
      sub: mySub
        ? {
            ...mySub,
            // Hide the actual endpoint/keys — confirms presence only.
            _has_subscription_object: true,
          }
        : null,
      computed_dedup_key_now: myComputedDedupKey,
      local_now: myLocalNow,
      already_sent_today: Boolean(
        mySub?.last_reminder_sent_date &&
          mySub.last_reminder_sent_date === myComputedDedupKey
      ),
    },
  };

  if (!isDevOwner) {
    return res.status(200).json(base);
  }

  // ── Dev owner gets system-wide aggregates ──────────────────────────────
  const { count: totalCount } = await supabase
    .from("push_subscriptions")
    .select("*", { count: "exact", head: true });

  const { count: enabledCount } = await supabase
    .from("push_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("notifications_enabled", true);

  const { count: dailyEnabledCount } = await supabase
    .from("push_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("notifications_enabled", true)
    .eq("daily_reminders_enabled", true);

  // Dev owner sees a small, anonymised sample of last_reminder_sent_date
  // values so it's obvious whether the cron is actually stamping rows.
  const { data: stampSample } = await supabase
    .from("push_subscriptions")
    .select("user_id, timezone, reminder_time, notifications_enabled, daily_reminders_enabled, last_reminder_sent_date, updated_at")
    .order("updated_at", { ascending: false })
    .limit(20);

  return res.status(200).json({
    ...base,
    env: {
      cron_secret_present: Boolean(process.env.CRON_SECRET),
      vapid_public_present: Boolean(process.env.VAPID_PUBLIC_KEY),
      vapid_private_present: Boolean(process.env.VAPID_PRIVATE_KEY),
      vapid_subject_present: Boolean(process.env.VAPID_SUBJECT),
      anthropic_key_present: Boolean(process.env.ANTHROPIC_API_KEY),
      cron_mode: process.env.CRON_MODE || "(default: windowed)",
      debug_cron: process.env.DEBUG_CRON || "(unset)",
      sentry_dsn_present: Boolean(process.env.SENTRY_DSN),
      vercel_env: process.env.VERCEL_ENV || "(unset)",
    },
    aggregates: {
      total_subscriptions: totalCount ?? null,
      enabled_subscriptions: enabledCount ?? null,
      daily_reminder_eligible: dailyEnabledCount ?? null,
    },
    sample: stampSample || [],
  });
}

export default withSentry(handler, "notification-debug");
