import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const SUPABASE_ANON_KEY =
  "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

/**
 * Hard cap per user per local calendar month. Raised for heavy personal
 * testing (explicitly requested, willing to spend ~$20-50/mo on
 * ElevenLabs) — 1,000,000 chars/mo ≈ $50 at Flash pricing. A real, generous
 * ceiling rather than a literal "no limit," so a genuine bug still can't
 * spend unboundedly. This is this APP's own self-imposed cap only — it does
 * NOT raise ElevenLabs' actual account quota; the ElevenLabs account itself
 * needs a paid plan for this number to mean anything (see
 * PREVIEW_BRANCH_HANDOFF.md). Keep in sync with theme.js's copy of this same
 * constant (display-only there) and api/tts-usage.js's fallback.
 */
const TTS_MONTHLY_CHAR_LIMIT = parseInt(process.env.TTS_MONTHLY_CHAR_LIMIT || "1000000", 10);
const ELEVENLABS_MODEL = "eleven_flash_v2_5";
// Matches the first entry in COACH_VOICE_OPTIONS (src/theme.js) — keep in sync if that changes.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_DEFAULT_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
// ElevenLabs' documented range is 0.7-1.2 (1.0 = unmodified). A slight
// speedup reads as more present/engaged rather than sluggish — modest on
// purpose; extreme values start audibly degrading quality per their docs.
const VOICE_SPEED = parseFloat(process.env.ELEVENLABS_VOICE_SPEED || "1.08");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function safeClientDate(raw) {
  if (typeof raw !== "string" || !DATE_RE.test(raw)) return null;
  const utcToday = new Date().toISOString().slice(0, 10);
  const dayDiff = Math.abs((Date.parse(raw + "T00:00:00Z") - Date.parse(utcToday + "T00:00:00Z")) / 86400000);
  if (!Number.isFinite(dayDiff) || dayDiff > 2) return null;
  return raw;
}

function monthKeyFromClientDate(clientDate) {
  return clientDate.slice(0, 7);
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Spoken replies are not configured yet." });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const { text, voice_id: voiceIdRaw, client_date: clientDateRaw } = req.body || {};
  const spoken = String(text || "").trim();
  if (!spoken) return res.status(400).json({ error: "No text to speak." });
  if (spoken.length > 2000) return res.status(400).json({ error: "Text too long for speech." });

  const clientDate = safeClientDate(clientDateRaw) || new Date().toISOString().slice(0, 10);
  const monthKey = monthKeyFromClientDate(clientDate);

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

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "Not configured." });
  const db = createClient(SUPABASE_URL, serviceRoleKey);

  // Profile and usage lookups don't depend on each other's results — run them
  // concurrently instead of back-to-back. Saves one round-trip's worth of
  // latency off every spoken reply, contributing to the delay reported
  // between a reply finishing and audio starting.
  const [{ data: prof, error: profErr }, { data: usageRow }] = await Promise.all([
    db.from("profiles").select("is_pro, is_admin, voice_replies_enabled, coach_voice_id").eq("id", userId).maybeSingle(),
    db.from("tts_usage").select("chars_used").eq("user_id", userId).eq("month", monthKey).maybeSingle(),
  ]);
  if (profErr) return res.status(500).json({ error: "Profile lookup failed." });

  const isPro = !!(prof?.is_pro || prof?.is_admin);
  if (!isPro) return res.status(403).json({ error: "Spoken replies are a Pro feature." });
  if (prof?.voice_replies_enabled !== true) {
    return res.status(403).json({ error: "Spoken replies are off — enable them in You → Coach voice." });
  }

  const charCount = spoken.length;
  const used = usageRow?.chars_used ?? 0;
  if (used + charCount > TTS_MONTHLY_CHAR_LIMIT) {
    return res.status(429).json({
      error: "Monthly spoken-reply limit reached. Text replies still work.",
      limit: TTS_MONTHLY_CHAR_LIMIT,
      used,
      remaining: Math.max(0, TTS_MONTHLY_CHAR_LIMIT - used),
    });
  }

  const voiceId = String(voiceIdRaw || prof?.coach_voice_id || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID;

  try {
    const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey.trim(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: spoken,
        model_id: ELEVENLABS_MODEL,
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true, speed: VOICE_SPEED },
      }),
    });

    if (!elevenRes.ok) {
      const errBody = await elevenRes.text().catch(() => "");
      console.error("[tts] ElevenLabs error", elevenRes.status, errBody.slice(0, 200));
      return res.status(502).json({ error: "Could not generate speech right now." });
    }

    // Buffer the full response here rather than relaying bytes to the client
    // as they arrive. This used to stream-relay on the theory that it cut
    // time-to-first-audio — but the client (useCoachTts.jsx) already calls
    // `await res.blob()`, which waits for the ENTIRE body before it can play
    // anything, so the client never actually benefited from the progressive
    // relay; it was strictly latency-neutral. What the streaming relay DID
    // cost: if the connection to ElevenLabs hiccuped partway through, the
    // client had already been sent a 200 with headers committed, so the
    // reply silently ended up truncated mid-clip with no error surfaced
    // anywhere — reported as audio "cutting out." Buffering first means a
    // failed/incomplete upstream response gets caught HERE and turned into a
    // real error status the client already knows how to show, instead of a
    // truncated-but-200 response.
    let audioBuffer;
    try {
      audioBuffer = Buffer.from(await elevenRes.arrayBuffer());
      if (!audioBuffer.length) throw new Error("empty audio response from ElevenLabs");
    } catch (bufErr) {
      console.error("[tts] failed to read ElevenLabs response", bufErr?.message || bufErr);
      captureException(bufErr, { route: "tts", userId });
      return res.status(502).json({ error: "Could not generate speech right now." });
    }

    await db.from("tts_usage").upsert(
      {
        user_id: userId,
        month: monthKey,
        chars_used: used + charCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,month" },
    );

    // Content-Length must be explicit here — omitting it and relying on
    // res.end(buffer) to imply it was the actual regression this round:
    // without a declared length the response framing was inconsistent in
    // this runtime, and the browser's audio decoder either silently played
    // nothing or fired onerror ("Playback failed") depending on exactly how
    // the truncated/malformed transfer landed. This is the fix.
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audioBuffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-TTS-Chars", String(charCount));
    res.setHeader("X-TTS-Remaining", String(Math.max(0, TTS_MONTHLY_CHAR_LIMIT - used - charCount)));
    res.status(200);
    res.end(audioBuffer);
    return undefined;
  } catch (err) {
    console.error("[tts] stream failed", err?.message || err);
    captureException(err, { route: "tts", userId });
    return res.status(500).json({ error: "Speech generation failed." });
  }
}

export default withSentry(handler, "tts");
