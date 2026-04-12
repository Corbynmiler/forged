import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

/**
 * Vercel Cron Job — runs every hour at :00
 * Finds all users whose reminder_time matches the current hour (in their timezone)
 * and sends them a push notification.
 *
 * Schedule set in vercel.json: "0 * * * *"
 */
export default async function handler(req, res) {
  // Vercel cron jobs call with GET; block anything else except our own test POST
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

  // Fetch all enabled subscriptions
  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, subscription, reminder_time, timezone")
    .eq("notifications_enabled", true);

  if (error) {
    console.error("[Forged cron] DB error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  if (!rows || rows.length === 0) {
    return res.status(200).json({ sent: 0, skipped: 0, message: "No active subscriptions" });
  }

  const nowUtc = new Date();

  // Find subscriptions whose reminder_time hour matches right now in the user's timezone
  const due = rows.filter(row => {
    try {
      const tz = row.timezone || "UTC";
      const [remHour, remMin] = (row.reminder_time || "09:00").split(":").map(Number);

      // Get the current hour:minute in the user's timezone
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const parts = formatter.formatToParts(nowUtc);
      const localHour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
      const localMin  = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);

      // Match if we're in the same hour (cron fires at :00 so minute will be 0-2)
      return localHour === remHour && localMin < 10;
    } catch {
      return false;
    }
  });

  if (due.length === 0) {
    return res.status(200).json({ sent: 0, skipped: rows.length, message: "No reminders due this hour" });
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
    due.map(async (row) => {
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

  // Clean up dead subscriptions
  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
    console.log(`[Forged cron] removed ${staleIds.length} stale subscription(s)`);
  }

  console.log(`[Forged cron] done — sent: ${sent}, failed: ${failed}, skipped: ${rows.length - due.length}`);
  return res.status(200).json({ sent, failed, skipped: rows.length - due.length });
}
