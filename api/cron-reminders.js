import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

/**
 * Vercel Cron Job — runs once per day at 9am UTC (Hobby plan limit).
 * Sends a push notification to all users with notifications enabled.
 *
 * Schedule set in vercel.json: "0 9 * * *"
 */
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

  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, subscription")
    .eq("notifications_enabled", true);

  if (error) {
    console.error("[Forged cron] DB error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  if (!rows || rows.length === 0) {
    return res.status(200).json({ sent: 0, message: "No active subscriptions" });
  }

  const payload = JSON.stringify({
    title: "Forged",
    body: "Time to log your habits \uD83D\uDD25 Keep the streak alive.",
    url: "/",
  });

  let sent = 0;
  let failed = 0;
  const staleIds = [];

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent++;
      } catch (err) {
        failed++;
        if (err.statusCode === 404 || err.statusCode === 410) {
          staleIds.push(row.id);
        } else {
          console.error(`[Forged cron] send error for user ${row.user_id}:`, err.message);
        }
      }
    })
  );

  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
    console.log(`[Forged cron] removed ${staleIds.length} stale subscription(s)`);
  }

  console.log(`[Forged cron] done — sent: ${sent}, failed: ${failed}`);
  return res.status(200).json({ sent, failed });
}
