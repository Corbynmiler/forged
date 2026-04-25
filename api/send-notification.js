import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@forged.app",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function handler(req, res) {
  // Allow GET so the cron job can hit it directly, POST for manual sends
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth: internal-only — must hold CRON_SECRET ─────────────────────────────
  // Previously this endpoint had no auth: anyone could POST with a userId and
  // send arbitrary push-notification text to that user. Now it is gated behind
  // the same CRON_SECRET as the cron endpoint, so only server-side callers
  // (cron, internal workers) can trigger pushes.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[Forged] CRON_SECRET not set — refusing to send pushes");
    return res.status(503).json({ error: "Push service not configured" });
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

  const supabase = createClient(SUPABASE_URL, serviceRoleKey);

  // Body can contain: userId (optional), title, body, url
  // If no userId, send to all subscriptions passed in (used internally by cron)
  const { userId, subscriptions: rawSubs, title, body, url } = req.body || {};

  let subscriptions = rawSubs || [];

  // If a userId was given, look up their subscription from DB
  if (userId && subscriptions.length === 0) {
    const { data } = await supabase
      .from("push_subscriptions")
      .select("id, subscription")
      .eq("user_id", userId)
      .eq("notifications_enabled", true);
    subscriptions = (data || []).map(r => ({ dbId: r.id, sub: r.subscription }));
  }

  if (subscriptions.length === 0) {
    return res.status(200).json({ sent: 0, failed: 0, message: "No subscriptions to send to" });
  }

  const payload = JSON.stringify({
    title: title || "Forged",
    body:  body  || "Time to log your habits \uD83D\uDD25",
    url:   url   || "/",
  });

  let sent = 0;
  let failed = 0;
  const staleIds = []; // subscriptions that are expired / unsubscribed

  await Promise.all(
    subscriptions.map(async ({ dbId, sub }) => {
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err) {
        failed++;
        // 404 or 410 means the subscription is gone — clean it up
        if (err.statusCode === 404 || err.statusCode === 410) {
          if (dbId) staleIds.push(dbId);
        } else {
          console.error("[Forged] push send error:", err.message);
        }
      }
    })
  );

  // Remove expired subscriptions so we don't keep sending to dead endpoints
  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
    console.log(`[Forged] removed ${staleIds.length} stale subscription(s)`);
  }

  return res.status(200).json({ sent, failed });
}

export default withSentry(handler, "send-notification");
