import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@forged.app",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "Missing service role key" });

  // Caller must be authenticated — verify JWT
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  // Use anon client with user's JWT to verify identity
  const { createClient: create } = await import("@supabase/supabase-js");
  const userClient = create(SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  const senderId = user.id;
  const { recipientId, type = "nudge" } = req.body || {};
  if (!recipientId) return res.status(400).json({ error: "recipientId required" });
  if (senderId === recipientId) return res.status(400).json({ error: "Cannot nudge yourself" });

  const supabase = createClient(SUPABASE_URL, serviceRoleKey);

  // Verify they are actually friends
  const { data: friendship } = await supabase
    .from("friendships")
    .select("id")
    .or(`and(requester_id.eq.${senderId},addressee_id.eq.${recipientId}),and(requester_id.eq.${recipientId},addressee_id.eq.${senderId})`)
    .eq("status", "accepted")
    .maybeSingle();

  if (!friendship) return res.status(403).json({ error: "Not friends" });

  // Get sender's name for the notification
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", senderId)
    .single();

  const senderName = senderProfile?.name || "Someone";

  if (type === "nudge") {
    // Rate-limit: one nudge per sender→recipient per UTC day (enforced by DB unique index too)
    const todayUTC = new Date().toISOString().slice(0, 10);
    const { data: existing } = await supabase
      .from("nudges")
      .select("id")
      .eq("sender_id", senderId)
      .eq("recipient_id", recipientId)
      .gte("sent_at", `${todayUTC}T00:00:00Z`)
      .maybeSingle();

    if (existing) return res.status(429).json({ error: "Already nudged this friend today" });

    // Insert nudge record
    const { error: insertErr } = await supabase
      .from("nudges")
      .insert({ sender_id: senderId, recipient_id: recipientId });

    if (insertErr) {
      // Unique constraint violation = already nudged today
      if (insertErr.code === "23505") return res.status(429).json({ error: "Already nudged today" });
      return res.status(500).json({ error: "Failed to save nudge" });
    }
  }

  // Look up recipient's push subscription
  const { data: subRow } = await supabase
    .from("push_subscriptions")
    .select("subscription")
    .eq("user_id", recipientId)
    .eq("notifications_enabled", true)
    .maybeSingle();

  if (!subRow?.subscription) {
    // Nudge saved but no push subscription — that's fine
    return res.status(200).json({ delivered: false, reason: "no_subscription" });
  }

  const messages = {
    nudge: { title: "Forged 💪", body: `${senderName} nudged you — time to log your habits!` },
    friend_request: { title: "Forged 🤝", body: `${senderName} sent you a friend request on Forged` },
  };

  const { title, body } = messages[type] || messages.nudge;
  const payload = JSON.stringify({ title, body, url: "/", tag: `forged-social-${type}` });

  try {
    await webpush.sendNotification(subRow.subscription, payload);
    return res.status(200).json({ delivered: true });
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Stale subscription — clean up
      await supabase.from("push_subscriptions").delete().eq("user_id", recipientId);
    }
    return res.status(200).json({ delivered: false, reason: "push_failed" });
  }
}
