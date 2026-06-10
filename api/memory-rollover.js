import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
// Anon key is public — safe to hardcode (already hardcoded in src/supabase.js)
const SUPABASE_ANON_KEY = "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function safeClientDate(raw) {
  if (typeof raw !== "string" || !DATE_RE.test(raw)) return null;
  const utcToday = new Date().toISOString().slice(0, 10);
  const dayDiff = Math.abs((Date.parse(raw + "T00:00:00Z") - Date.parse(utcToday + "T00:00:00Z")) / 86400000);
  if (!Number.isFinite(dayDiff) || dayDiff > 2) return null;
  return raw;
}

function shiftDate(ymd, deltaDays) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

const MEMORY_MAX_CHARS = 1500;
const MAX_DAYS_PER_CALL = 2; // cost bound: at most two day-summaries per call

/** Compact one day of habit logs + notes into a short plain-text digest for the model. */
function buildDayDigest(date, habits, journalRow) {
  const lines = [];
  for (const h of habits || []) {
    const logs = Array.isArray(h.logs) ? h.logs : [];
    const log = logs.find(l => l && l.date === date);
    if (!log) continue;
    const name = h.name || "Habit";
    const v = log.value;
    let desc;
    if (v === true) desc = "done";
    else if (v === "skip") desc = "rest day";
    else if (typeof v === "number") desc = `${v}${h.unit || ""}`;
    else if (v && typeof v === "object" && v.minutes != null) {
      desc = `${v.minutes}m`;
      if (v.win) desc += ` — win: ${String(v.win).slice(0, 120)}`;
      if (v.hardPart) desc += ` — hard: ${String(v.hardPart).slice(0, 120)}`;
    } else continue;
    if (log.note) desc += ` (${String(log.note).slice(0, 120)})`;
    lines.push(`- ${name}: ${desc}`);
  }
  const notes = Array.isArray(journalRow?.daily_context) ? journalRow.daily_context.filter(Boolean) : [];
  for (const n of notes) lines.push(`- note: ${String(n).slice(0, 240)}`);
  const entry = (journalRow?.content || "").trim();
  if (entry) lines.push(`- evidence entry: ${entry.slice(0, 400)}`);
  return lines.join("\n");
}

function parseModelJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !serviceRoleKey) return res.status(500).json({ error: "Not configured" });

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
  const db = createClient(SUPABASE_URL, serviceRoleKey);

  const clientDate = safeClientDate(req.body?.client_date) || new Date().toISOString().slice(0, 10);

  try {
    // Candidate window: the 7 local days before today. Today is never
    // summarized — it isn't finished yet.
    const windowDates = [];
    for (let i = 1; i <= 7; i++) windowDates.push(shiftDate(clientDate, -i));

    const [{ data: existing }, { data: habitRows }, { data: journalRows }, { data: memRow }, { data: blockRow }] = await Promise.all([
      db.from("daily_summaries").select("date").eq("user_id", userId).in("date", windowDates),
      db.from("habits").select("name, unit, habit_type, logs").eq("user_id", userId),
      db.from("journal_entries").select("date, content, daily_context").eq("user_id", userId).in("date", windowDates),
      db.from("coach_memory").select("content").eq("user_id", userId).maybeSingle(),
      db.from("forge_blocks").select("title, identity, why_statement, old_pattern").eq("user_id", userId).eq("status", "active").maybeSingle(),
    ]);

    const summarized = new Set((existing || []).map(r => r.date));
    const journalByDate = new Map((journalRows || []).map(r => [r.date, r]));

    // Most recent un-summarized days that actually have activity.
    const pending = [];
    for (const d of windowDates) {
      if (summarized.has(d)) continue;
      const digest = buildDayDigest(d, habitRows, journalByDate.get(d));
      if (digest.trim()) pending.push({ date: d, digest });
      if (pending.length >= MAX_DAYS_PER_CALL) break;
    }

    if (!pending.length) {
      return res.status(200).json({ updated: false });
    }

    const currentMemory = (memRow?.content || "").trim();
    const arcLine = blockRow
      ? `Active Arc: "${blockRow.title || blockRow.identity}" — direction: ${blockRow.identity || "—"}; old pattern: ${blockRow.old_pattern || "—"}.`
      : "No active Arc.";

    const client = new Anthropic({ apiKey: apiKey.trim() });
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1200,
      system: [{
        type: "text",
        text:
          "You maintain compact memory for a personal-change companion app. You receive one or two finished days of a user's activity (habit logs, personal notes, evidence entries) plus their current rolling memory.\n\n" +
          "For EACH day produce:\n" +
          "- summary: 1–2 plain sentences, max 220 characters. Specific and concrete (name the real events), no fluff, no moralizing. Written in third person about the user.\n" +
          "- structured: { \"wins\": [..], \"hard_parts\": [..], \"slips\": [..], \"mood\": string|null, \"tomorrow_focus\": string|null } — short phrases only, empty arrays when nothing fits.\n\n" +
          "Then UPDATE the rolling memory (max " + MEMORY_MAX_CHARS + " characters): durable, useful context about this person — work situation, recurring pressures, important relationships, preferences, current projects, emotional patterns, what derails them, what works. Merge new information into the existing memory; drop stale or low-value detail to stay under the limit. Terse prose or short bullets. Never include day-by-day logs — that's what summaries are for.\n\n" +
          "Return ONLY valid JSON, no markdown fences:\n" +
          "{ \"days\": [{ \"date\": \"YYYY-MM-DD\", \"summary\": \"...\", \"structured\": {...} }], \"memory\": \"...\" }",
        cache_control: { type: "ephemeral" },
      }],
      messages: [{
        role: "user",
        content:
          `${arcLine}\n\nCURRENT ROLLING MEMORY:\n${currentMemory || "(empty — first run)"}\n\n` +
          pending.map(p => `DAY ${p.date}:\n${p.digest}`).join("\n\n"),
      }],
    });

    const textOut = (resp.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const parsed = parseModelJson(textOut);
    if (!parsed || !Array.isArray(parsed.days)) {
      console.error("[memory-rollover] unparseable model output", { userId });
      return res.status(502).json({ error: "Summary generation failed" });
    }

    const wanted = new Set(pending.map(p => p.date));
    const upserts = parsed.days
      .filter(d => d && wanted.has(d.date) && typeof d.summary === "string")
      .map(d => ({
        user_id: userId,
        date: d.date,
        summary: d.summary.slice(0, 300),
        structured: d.structured && typeof d.structured === "object" ? d.structured : null,
        updated_at: new Date().toISOString(),
      }));

    if (upserts.length) {
      const { error: sumErr } = await db
        .from("daily_summaries")
        .upsert(upserts, { onConflict: "user_id,date" });
      if (sumErr) throw new Error(`daily_summaries upsert failed: ${sumErr.message}`);
    }

    let memoryOut = currentMemory;
    if (typeof parsed.memory === "string" && parsed.memory.trim()) {
      memoryOut = parsed.memory.trim().slice(0, MEMORY_MAX_CHARS);
      const { error: memErr } = await db
        .from("coach_memory")
        .upsert({ user_id: userId, content: memoryOut, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (memErr) throw new Error(`coach_memory upsert failed: ${memErr.message}`);
    }

    console.log("[memory-rollover] updated", {
      userId,
      days: upserts.map(u => u.date),
      memory_chars: memoryOut.length,
      input_tokens: resp.usage?.input_tokens ?? 0,
      output_tokens: resp.usage?.output_tokens ?? 0,
    });

    return res.status(200).json({
      updated: true,
      days: upserts.map(u => ({ date: u.date, summary: u.summary })),
      memory: memoryOut,
    });
  } catch (err) {
    console.error("[memory-rollover] error", { userId, message: err?.message });
    captureException(err, { route: "memory-rollover", userId });
    return res.status(500).json({ error: "Memory update failed" });
  }
}

export default withSentry(handler, "memory-rollover");
