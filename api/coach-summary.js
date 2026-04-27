// /api/coach-summary
//
// AI-generated session prep brief for the coach workspace. Called from
// CoachClientDetail on mount and on the refresh button.
//
// GET /api/coach-summary?clientId=<uuid>
// Authorization: Bearer <user JWT>
//
// Hardening:
//   - Bearer token required, caller resolved server-side.
//   - Caller's profile.is_coach must be true (or is_admin).
//   - Client's profile.coach_id must equal caller.id — coaches can only
//     summarise their own assigned clients. Admins bypass this check.
//
// Returns: { summary: string[] }  (each entry one short bullet)

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUMMARY_TIMEOUT_MS = 15_000;
const MAX_NOTE_LEN = 240;

/** Same pattern as api/chat.js — cache stable system text on Anthropic's side. */
function cachedSystem(system) {
  const text = typeof system === "string" ? system : "";
  if (!text.trim()) return "";
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function nDaysAgoYmd(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return ymd(d);
}

/** Pull the model output (single text block) into clean bullet strings. */
function parseBullets(text) {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*•\d.]+\s*/, "").trim())
    .filter(line => line.length > 0)
    .slice(0, 5);
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const clientId = String(req.query?.clientId || "").toLowerCase();
  if (!UUID_RE.test(clientId)) {
    return res.status(400).json({ error: "Missing or invalid clientId" });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
  if (!apiKey)         return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  // Caller must be a coach (or admin previewing).
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("is_coach, is_admin")
    .eq("id", user.id)
    .single();
  if (!callerProfile?.is_coach && !callerProfile?.is_admin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Client must be assigned to this coach. Admins bypass the check so they
  // can preview any client (matches the existing dev-tools preview affordance).
  const { data: clientProfile, error: clientErr } = await supabase
    .from("profiles")
    .select("id, name, coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) return res.status(500).json({ error: clientErr.message });
  if (!clientProfile) return res.status(404).json({ error: "Client not found" });
  if (!callerProfile.is_admin && clientProfile.coach_id !== user.id) {
    return res.status(403).json({ error: "Not your client" });
  }

  // ── Pull habits + filter logs to the last 14 days ───────────────────────
  const { data: habits, error: habitsErr } = await supabase
    .from("habits")
    .select("name, emoji, habit_type, logs, streak, best_streak, weekly_target, daily_budget, target_value, start_value, unit")
    .eq("user_id", clientId)
    .not("habit_type", "in", '("goal","progress","log")');
  if (habitsErr) return res.status(500).json({ error: habitsErr.message });

  const cutoff = nDaysAgoYmd(13); // 14-day inclusive window
  const compact = (habits || []).map(h => {
    const recentLogs = (h.logs || [])
      .filter(l => l.date >= cutoff)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(l => {
        const out = { date: l.date };
        if (typeof l.value === "number") out.value = l.value;
        else if (l.value === true) out.done = true;
        else if (l.value === "skip") out.skip = true;
        if (l.note)       out.note       = String(l.note).slice(0, MAX_NOTE_LEN);
        if (l.reflection) out.reflection = String(l.reflection).slice(0, MAX_NOTE_LEN);
        if (l.win)        out.win        = String(l.win).slice(0, MAX_NOTE_LEN);
        if (l.hard_part)  out.hard_part  = String(l.hard_part).slice(0, MAX_NOTE_LEN);
        return out;
      });
    return {
      name: h.name,
      emoji: h.emoji || "",
      type: h.habit_type,
      streak: h.streak || 0,
      best_streak: h.best_streak || 0,
      ...(h.weekly_target ? { weekly_target: h.weekly_target } : {}),
      ...(h.daily_budget != null ? { daily_budget: h.daily_budget, unit: h.unit || null } : {}),
      ...(h.target_value != null ? { target_value: h.target_value, start_value: h.start_value ?? 0, unit: h.unit || null } : {}),
      logs_14d: recentLogs,
    };
  });

  // No-data short circuit — don't burn tokens for a brand new client.
  const totalLogs = compact.reduce((s, h) => s + h.logs_14d.length, 0);
  if (compact.length === 0 || totalLogs === 0) {
    return res.status(200).json({
      summary: [
        compact.length === 0
          ? "No habits tracked yet — first session, focus on getting set up."
          : "No logs in the last 14 days — re-engagement first, no data to debrief.",
      ],
    });
  }

  // ── Call Claude ─────────────────────────────────────────────────────────
  const clientName = clientProfile.name || "the client";
  const system =
    "You are helping a coach prepare for a 1:1 session with their client. " +
    "Be sharp, specific, and grounded in the data. Do NOT fabricate. " +
    "Output up to 5 bullet points, one per line, no numbering, no markdown. " +
    "Each bullet must be under 15 words. " +
    "Cover: what's going well, what's struggling, and end with one question worth asking.";

  const userText =
    `Client: ${clientName}\n` +
    `Last 14 days of habit data (JSON):\n${JSON.stringify(compact)}\n\n` +
    `Write the brief now. Max 5 bullets, each under 15 words. Last bullet is the question.`;

  try {
    const ai = new Anthropic({ apiKey: apiKey.trim() });
    const resp = await Promise.race([
      ai.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 350,
        system: cachedSystem(system),
        messages: [{ role: "user", content: userText }],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Summary request timed out")), SUMMARY_TIMEOUT_MS)
      ),
    ]);

    console.log("[coach-summary] usage", {
      cache_read_input_tokens: resp.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: resp.usage?.cache_creation_input_tokens ?? 0,
      input_tokens: resp.usage?.input_tokens ?? 0,
      output_tokens: resp.usage?.output_tokens ?? 0,
    });

    const textBlock = (resp.content || []).find(b => b.type === "text");
    const summary = parseBullets(textBlock?.text || "");
    if (summary.length === 0) {
      return res.status(502).json({ error: "Empty summary from model" });
    }
    return res.status(200).json({ summary });
  } catch (err) {
    console.error("[coach-summary] Anthropic error:", err?.message || err);
    captureException(err, { route: "coach-summary", clientId });
    return res.status(502).json({ error: "Could not generate summary" });
  }
}

export default withSentry(handler, "coach-summary");
