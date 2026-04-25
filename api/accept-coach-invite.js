// /api/accept-coach-invite
//
// Called once after a user signs in / signs up via a coach invite link
// (https://forged-sage.vercel.app/?coach=<base64(coachUserId)>). Sets
// profiles.coach_id = decoded coach user id for the caller.
//
// Hardening:
//   - Bearer token required; we resolve the actual user via Supabase admin
//     so the caller can never claim someone else's identity.
//   - Decoded coach id must look like a UUID before we touch the DB.
//   - Coach must exist in profiles AND have is_coach = true.
//   - Caller cannot invite themselves (no self-coach loops).
//   - Idempotent — last-invite-wins (we just overwrite coach_id).

import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCoachId(encoded) {
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  // Tolerate base64url variants (- _) the client might produce.
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return UUID_RE.test(decoded) ? decoded.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
  }

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  // Body may arrive parsed (Vercel) or as a string depending on runtime.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const encoded = body?.coach;
  const coachId = decodeCoachId(encoded);
  if (!coachId) return res.status(400).json({ error: "Invalid coach token" });
  if (coachId === user.id) {
    return res.status(400).json({ error: "Cannot invite yourself" });
  }

  // Verify the coach actually exists AND has is_coach = true (or coach_tier set).
  const { data: coachProfile, error: coachErr } = await supabase
    .from("profiles")
    .select("id, is_coach, coach_tier")
    .eq("id", coachId)
    .maybeSingle();
  if (coachErr) return res.status(500).json({ error: coachErr.message });
  if (!coachProfile || (!coachProfile.is_coach && !coachProfile.coach_tier)) {
    return res.status(404).json({ error: "Coach not found" });
  }

  // Count how many clients this coach already has so we can enforce the
  // 15-client limit and decide whether to grant free Pro to this client.
  const COACH_CLIENT_LIMIT = 15;
  const { count: existingCount, error: countErr } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("coach_id", coachId);

  // On count error default to conservative (don't grant Pro) so we never
  // silently over-provision. Coach can still see the client.
  const currentCount = countErr ? COACH_CLIENT_LIMIT : (existingCount ?? 0);
  const isProGranted = currentCount < COACH_CLIENT_LIMIT;

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({
      coach_id: coachId,
      updated_at: new Date().toISOString(),
      ...(isProGranted ? { is_pro: true } : {}),
    })
    .eq("id", user.id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.status(200).json({
    ok: true,
    coachId,
    isProGranted,
    clientsAtLimit: !isProGranted,
  });
}

export default withSentry(handler, "accept-coach-invite");
