import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

/** Same public anon key as `src/supabase.js` — JWT auth still required; allows API to work if Vercel env omits anon key. */
const PUBLIC_ANON_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

const anonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  PUBLIC_ANON_FALLBACK;

const vapidPublic = process.env.VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
const hasVapid = !!(vapidPublic && vapidPrivate);
if (hasVapid) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@forged.app",
      vapidPublic,
      vapidPrivate
    );
  } catch (e) {
    console.warn("[nudge-friend] webpush.setVapidDetails failed:", e?.message || e);
  }
}

async function sendPushToRecipient({ recipientId, senderName, type, message, goalName }) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasVapid || !serviceRoleKey) {
    return { delivered: false, reason: !serviceRoleKey ? "no_service_role_push_skipped" : "no_vapid_push_skipped" };
  }

  const admin = createClient(SUPABASE_URL, serviceRoleKey);
  // Pull the whole row so we can respect the recipient's per-category
  // toggles. Pre-migration rows won't have the *_enabled columns; we
  // treat absence as "enabled" so existing users don't lose their pushes.
  const { data: subRow } = await admin
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", recipientId)
    .eq("notifications_enabled", true)
    .maybeSingle();

  if (!subRow?.subscription) {
    return { delivered: false, reason: "no_subscription" };
  }

  // Per-category preference check. The recipient can independently silence
  // friend nudges, friend requests, and shared-goal invites. Returning a
  // delivered:false here still leaves the in-app realtime toast working
  // (the row write happens in the caller, regardless of push delivery).
  const categoryAllows = (() => {
    if (type === "nudge")              return subRow.nudges_enabled !== false;
    if (type === "friend_request")     return subRow.social_invites_enabled !== false;
    if (type === "shared_goal_invite") return subRow.social_invites_enabled !== false;
    return true;
  })();
  if (!categoryAllows) {
    return { delivered: false, reason: "category_disabled" };
  }

  const nudgeBody = message?.trim()
    ? `${senderName}: "${message.trim()}"`
    : `${senderName} nudged you — time to log your habits!`;

  const messages = {
    nudge:              { title: "Forged 💪", body: nudgeBody, url: "/" },
    friend_request:     { title: "Forged 🤝", body: `${senderName} sent you a friend request on Forged`, url: "/" },
    shared_goal_invite: { title: "Forged 🎯", body: `${senderName} invited you to join "${goalName || "a shared goal"}" — check Social`, url: "/" },
  };

  const { title, body, url } = messages[type] || messages.nudge;
  const payload = JSON.stringify({ title, body, url, tag: `forged-social-${type}` });

  try {
    await webpush.sendNotification(subRow.subscription, payload);
    return { delivered: true };
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await admin.from("push_subscriptions").delete().eq("user_id", recipientId);
    }
    return { delivered: false, reason: "push_failed" };
  }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!anonKey) {
    return res.status(500).json({
      error: "Server misconfigured: set SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) on Vercel",
    });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const userSupabase = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authErr } = await userSupabase.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  const senderId = user.id;
  const { recipientId, type = "nudge", message, goalName, client_date: rawClientDate } = req.body || {};
  if (!recipientId) return res.status(400).json({ error: "recipientId required" });
  if (senderId === recipientId) return res.status(400).json({ error: "Cannot nudge yourself" });

  // Use the sender's local date for the "already nudged today" check so the
  // cooldown rolls over at the user's actual midnight, not UTC midnight.
  function safeClientDate(raw) {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const utcToday = new Date().toISOString().slice(0, 10);
    const dayDiff = Math.abs((Date.parse(raw + "T00:00:00Z") - Date.parse(utcToday + "T00:00:00Z")) / 86400000);
    if (!Number.isFinite(dayDiff) || dayDiff > 2) return null;
    return raw;
  }
  const clientDate = safeClientDate(rawClientDate);

  if (type === "friend_request") {
    const { data: pending } = await userSupabase
      .from("friendships")
      .select("id")
      .eq("requester_id", senderId)
      .eq("addressee_id", recipientId)
      .eq("status", "pending")
      .maybeSingle();
    if (!pending) {
      return res.status(403).json({ error: "No pending friend request from you to this person" });
    }
  } else if (type === "shared_goal_invite") {
    const { data: friendship } = await userSupabase
      .from("friendships")
      .select("id")
      .or(`and(requester_id.eq.${senderId},addressee_id.eq.${recipientId}),and(requester_id.eq.${recipientId},addressee_id.eq.${senderId})`)
      .eq("status", "accepted")
      .maybeSingle();
    const { data: invite } = await userSupabase
      .from("shared_goal_invites")
      .select("id")
      .eq("inviter_id", senderId)
      .eq("invitee_id", recipientId)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    if (!friendship && !invite) {
      return res.status(403).json({ error: "Not friends or no pending goal invite" });
    }
  } else if (type === "nudge") {
    const { data: friendship } = await userSupabase
      .from("friendships")
      .select("id")
      .or(`and(requester_id.eq.${senderId},addressee_id.eq.${recipientId}),and(requester_id.eq.${recipientId},addressee_id.eq.${senderId})`)
      .eq("status", "accepted")
      .maybeSingle();

    let allowed = !!friendship;
    if (!allowed) {
      const { data: senderMemberships } = await userSupabase
        .from("shared_goal_members")
        .select("shared_goal_id")
        .eq("user_id", senderId);
      const goalIds = [...new Set((senderMemberships || []).map((r) => r.shared_goal_id).filter(Boolean))];
      if (goalIds.length > 0) {
        const { data: overlap } = await userSupabase
          .from("shared_goal_members")
          .select("id")
          .eq("user_id", recipientId)
          .in("shared_goal_id", goalIds)
          .limit(1)
          .maybeSingle();
        allowed = !!overlap;
      }
    }
    if (!allowed) return res.status(403).json({ error: "Not friends or accountability partners" });
  } else {
    return res.status(400).json({ error: "Unsupported type" });
  }

  const { data: senderProfile } = await userSupabase
    .from("profiles")
    .select("name")
    .eq("id", senderId)
    .maybeSingle();

  const senderName = senderProfile?.name || "Someone";

  if (type === "friend_request" || type === "shared_goal_invite") {
    const push = await sendPushToRecipient({
      recipientId,
      senderName,
      type,
      message,
      goalName: goalName || req.body?.goalName,
    });
    return res.status(200).json({ ...push, saved: false });
  }

  // The nudges row's sent_at is a UTC timestamp written by Postgres (`now()`).
  // Replace the old "since UTC midnight" filter with a strict 24h window so
  // the cooldown is timezone-independent and doesn't roll over awkwardly at
  // UTC midnight for users east of UTC. clientDate is reserved for future
  // local-day-aligned cooldowns when we add a TZ offset to the request.
  void clientDate;
  const oneDayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await userSupabase
    .from("nudges")
    .select("id")
    .eq("sender_id", senderId)
    .eq("recipient_id", recipientId)
    .gte("sent_at", oneDayAgoIso)
    .maybeSingle();

  if (existing) return res.status(429).json({ error: "Already nudged this friend today" });

  const { error: insertErr } = await userSupabase.from("nudges").insert({
    sender_id: senderId,
    recipient_id: recipientId,
    sender_name: senderName,
    message: message?.trim() || null,
  });

  if (insertErr) {
    if (insertErr.code === "23505") return res.status(429).json({ error: "Already nudged today" });
    if (insertErr.code === "42P01" || /relation.*nudges does not exist/i.test(insertErr.message || "")) {
      return res.status(503).json({
        error: "Nudges table missing — run Supabase migration 20260418000000_nudges_table_realtime.sql",
      });
    }
    console.error("[nudge-friend] insert:", insertErr);
    return res.status(500).json({
      error: insertErr.message || "Failed to save nudge",
      code: insertErr.code,
    });
  }

  const push = await sendPushToRecipient({
    recipientId,
    senderName,
    type: "nudge",
    message,
    goalName: req.body?.goalName,
  });

  return res.status(200).json({ ...push, saved: true });
}

export default withSentry(handler, "nudge-friend");
