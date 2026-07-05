import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const SUPABASE_ANON_KEY =
  "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

/** Same fallback default as api/tts.js (matches the real ElevenLabs free-tier limit) — keep in sync if that changes. */
const TTS_MONTHLY_CHAR_LIMIT = parseInt(process.env.TTS_MONTHLY_CHAR_LIMIT || "10000", 10);

/**
 * Preview-only developer endpoint: how much of the ElevenLabs quota is left.
 * Tries the real account-wide number first (ElevenLabs' own
 * GET /v1/user/subscription — a documented, stable endpoint that reports
 * character_count/character_limit for the API key's account), since that's
 * the actual constraint that matters on a free-tier account shared across
 * every user of this app. Falls back to our own per-user tts_usage tracking
 * (already written by api/tts.js on every synthesis) if the ElevenLabs call
 * fails for any reason — clearly labeled as a local estimate on the client,
 * since it measures a different thing (this app's own per-user cap, not
 * ElevenLabs' real account-wide limit).
 */
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let userId = null;
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user?.id) return res.status(401).json({ error: "Invalid token" });
    userId = user.id;
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (apiKey) {
    try {
      const elevenRes = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
        headers: { "xi-api-key": apiKey.trim() },
      });
      if (elevenRes.ok) {
        const sub = await elevenRes.json();
        const used = Number(sub.character_count);
        const limit = Number(sub.character_limit);
        if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) {
          return res.status(200).json({
            source: "elevenlabs",
            used,
            limit,
            remaining: Math.max(0, limit - used),
            resetsAt: Number.isFinite(sub.next_character_count_reset_unix)
              ? sub.next_character_count_reset_unix * 1000
              : null,
            tier: typeof sub.tier === "string" ? sub.tier : null,
          });
        }
        // Response shape didn't match what's expected — fall through to the
        // local estimate rather than surfacing a broken/empty reading.
        captureException(new Error("tts-usage: unexpected ElevenLabs subscription shape"), { route: "tts-usage", userId });
      }
    } catch (err) {
      captureException(err, { route: "tts-usage", userId });
      // fall through to local estimate
    }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(503).json({ error: "Usage tracking not configured." });
  const db = createClient(SUPABASE_URL, serviceRoleKey);
  const monthKey = new Date().toISOString().slice(0, 7);
  const { data: usageRow } = await db.from("tts_usage").select("chars_used").eq("user_id", userId).eq("month", monthKey).maybeSingle();
  const used = usageRow?.chars_used ?? 0;
  return res.status(200).json({
    source: "local_estimate",
    used,
    limit: TTS_MONTHLY_CHAR_LIMIT,
    remaining: Math.max(0, TTS_MONTHLY_CHAR_LIMIT - used),
    resetsAt: null,
    tier: null,
  });
}

export default withSentry(handler, "tts-usage");
