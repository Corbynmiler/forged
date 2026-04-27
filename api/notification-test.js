// Fire a real test push to the calling user's own subscription. Bypasses
// the cron's window/dedup gates so you can verify the entire pipeline end
// to end on demand:
//   browser permission ✓
//   service worker registered ✓
//   push_subscriptions row exists ✓
//   VAPID keys configured ✓
//   web-push -> FCM/APNS -> sw "push" handler ✓
//
// POST /api/notification-test
//   Headers: Authorization: Bearer <Supabase user access token>
//   Body (optional JSON): { title, body }
//
// Response shape always includes diagnostic fields so even a failure tells
// you exactly which step broke.

import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY missing" });
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({
      error: "VAPID keys not configured",
      env_check: {
        vapid_public_present: Boolean(process.env.VAPID_PUBLIC_KEY),
        vapid_private_present: Boolean(process.env.VAPID_PRIVATE_KEY),
      },
    });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@forged.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  const { data: sub, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("id, subscription, notifications_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subErr) return res.status(500).json({ error: subErr.message });
  if (!sub) {
    return res.status(404).json({
      error: "No push_subscriptions row for your user_id",
      hint: "Open the app, go to Settings → Notifications, toggle Off then On to re-subscribe.",
      user_id: user.id,
    });
  }
  if (!sub.notifications_enabled) {
    return res.status(409).json({
      error: "Your subscription row exists but notifications_enabled is false",
      hint: "Toggle notifications on in Settings.",
    });
  }

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch { body = {}; }

  const title = body.title || "Forged ⚡ Test";
  const messageBody = body.body || "If you can read this, the push pipeline is alive.";

  const payload = JSON.stringify({
    title,
    body: messageBody,
    url: "/",
    tag: "forged-test",
  });

  try {
    const result = await webpush.sendNotification(sub.subscription, payload);
    console.log("[notification-test] sent", { user_id: user.id, statusCode: result.statusCode });
    return res.status(200).json({
      ok: true,
      message: "Push delivered to FCM/APNS. Check your device for the toast.",
      subscription_id: sub.id,
      web_push_status: result.statusCode,
    });
  } catch (err) {
    captureException(err, { route: "notification-test", userId: user.id });
    const stale = err.statusCode === 404 || err.statusCode === 410;
    if (stale) {
      // Delete the broken row so the user re-subscribes on next app open.
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
    }
    return res.status(502).json({
      ok: false,
      error: err.message,
      web_push_status: err.statusCode,
      stale_subscription_deleted: stale,
      hint: stale
        ? "Your browser subscription is dead. Open the app, Settings → Notifications, toggle Off then On."
        : "Push provider rejected the send. Check VAPID config.",
    });
  }
}

export default withSentry(handler, "notification-test");
