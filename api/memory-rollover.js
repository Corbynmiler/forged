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
const XP_DAILY_CAP = 50; // bound on AI-judged XP per day — matches the design doc's 0-50/day range

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
          "You maintain compact memory for a personal-change companion app. You receive one or two finished days of a user's activity (habit logs, personal notes, evidence entries, conversation content) plus their current rolling memory.\n\n" +
          "WRITE LIKE A PERSON, NOT A REPORT. Every field below gets read back to the user or feeds a greeting they'll see tomorrow morning — it must sound like something a close friend would actually say, using the real nouns from their day. Never write clinical, generic, or report-speak phrasing (\"maintained physical baseline\", \"made progress on goals\", \"engaged in productive activities\"). If they played poker, write \"Played poker\" — not \"Engaged in recreational activity.\" If they shipped a feature, name the feature. Specificity is the whole test: if a sentence could apply to any user on any day, rewrite it.\n\n" +
          "For EACH day produce:\n" +
          "- title: a short, specific, human title for the day (4–6 words) — like a chapter name, e.g. \"Planting in the Rain Again\" or \"Hope Contract Finally Lands\". Never generic (\"A Good Day\", \"Productive Day\", \"Making Progress\").\n" +
          "- summary: 1–2 plain sentences, max 220 characters. Specific and concrete (name the real events), no fluff, no moralizing. Written in third person about the user.\n" +
          "- structured: { \"narrative\": string|null, \"wins\": [..], \"hard_parts\": [..], \"slips\": [..], \"mood\": string|null, \"tomorrow_focus\": string|null }. `narrative` is the most important field here — it gets shown VERBATIM as the opening line of tomorrow's morning greeting, right after \"Morning.\"/\"Afternoon.\"/\"Evening.\", the very first thing the user reads that day. KEEP IT SHORT — one plain sentence, like a text from a friend, not a report and not a formal, elaborately-claused sentence. Prefer compressing several small related things into a short topic list over spelling each one out as its own clause: \"Yesterday was mostly CloseCraft, pouch discipline, and keeping the basics alive.\" beats \"You worked on CloseCraft, showed pouch discipline, and kept up the basics.\" Only use full clauses (\"You wrapped up the Companion redesign and pushed the Azir meeting to next week.\") when a day genuinely had one or two real, distinct, name-worthy events — never stack three or more full clauses onto each other, that reads as a report again. Name the real projects/people/events involved either way. If genuinely nothing happened worth recapping, use null rather than forcing something. `wins`/`hard_parts`/`slips` are still extracted the same way as before (short natural phrases, empty arrays when nothing fits) for other surfaces — but `narrative` is what the user actually sees first, so it carries the most weight of any field here.\n" +
          "- commitments: short array of things the user said they'd do (e.g. \"send the contract\", \"call the dentist\") — empty array if none were made.\n" +
          "- emotional_context: one short plain sentence on how the day felt emotionally, or null if there's nothing meaningful to say — never invent feelings that weren't there.\n" +
          "- facts: 0–6 atomic, durable facts worth remembering long after this single day — the kind of thing a close friend would still remember weeks later (a recurring theme, a project, a person, a preference, a pattern). Each is { \"kind\": one of \"fact\"|\"commitment\"|\"preference\"|\"project\"|\"person\"|\"event\"|\"emotional_pattern\", \"content\": a short third-person sentence, \"importance\": 1–5 }. Skip anything trivial, already obvious, or already covered by the rolling memory below — only include what's genuinely new and worth carrying forward.\n" +
          "- xp_delta: a whole number from 0 to " + XP_DAILY_CAP + " judging how much this day deserves, based on genuine effort and follow-through — not just whether things went well. A hard day where they still showed up can deserve more than an easy day that took no effort. Never judge purely on outcome.\n" +
          "  JUDGE FROM THE WHOLE PICTURE, NOT A CHECKLIST. Habit logs are one signal among several, not the source of truth. Read what they actually said — notes, evidence entries, conversation content — and recognize real effort and progress even when it was never set up as a tracked habit or proof action. Someone who spent the week visibly moving a project forward deserves real credit for that even with zero matching habit logs; someone who ticked every habit box on autopilot with no real engagement doesn't automatically deserve more than someone who showed up honestly on a hard day. Weigh the narrative over the tally.\n" +
          "- xp_reason: one short, specific, plain sentence explaining the xp_delta — this gets shown to the user directly, so it must reference something real from the day, never generic praise.\n\n" +
          "Then UPDATE the rolling memory (max " + MEMORY_MAX_CHARS + " characters): durable, useful context about this person — work situation, recurring pressures, important relationships, preferences, current projects, emotional patterns, what derails them, what works. Merge new information into the existing memory; drop stale or low-value detail to stay under the limit. Terse prose or short bullets. Never include day-by-day logs — that's what summaries are for.\n\n" +
          "Return ONLY valid JSON, no markdown fences:\n" +
          "{ \"days\": [{ \"date\": \"YYYY-MM-DD\", \"title\": \"...\", \"summary\": \"...\", \"structured\": {...}, \"commitments\": [...], \"emotional_context\": \"...\"|null, \"facts\": [{ \"kind\": \"...\", \"content\": \"...\", \"importance\": 1 }], \"xp_delta\": 0, \"xp_reason\": \"...\" }], \"memory\": \"...\" }",
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

    // ── PREVIEW BRANCH — memory layer (Phase 3) ────────────────────────────
    // title / commitments / emotional_context live on daily_summaries as new
    // nullable columns, and facts land in a new memory_facts table — both
    // added by a migration staged at supabase/pending_migrations/ (not yet
    // applied to every environment this code might run against). Both
    // blocks below are deliberately isolated from the upsert above and from
    // each other: if the migration hasn't landed yet in a given environment,
    // these fail quietly (logged, not thrown) so the existing summary/
    // structured/coach_memory writes above — the part of this job real
    // users already depend on — keep working exactly as before.
    const extendedUpserts = parsed.days
      .filter(d => d && wanted.has(d.date))
      .map(d => ({
        user_id: userId,
        date: d.date,
        title: typeof d.title === "string" && d.title.trim() ? d.title.trim().slice(0, 80) : null,
        commitments: Array.isArray(d.commitments)
          ? d.commitments.filter(c => typeof c === "string" && c.trim()).map(c => c.trim().slice(0, 200)).slice(0, 10)
          : [],
        emotional_context: typeof d.emotional_context === "string" && d.emotional_context.trim()
          ? d.emotional_context.trim().slice(0, 300)
          : null,
        // AI-judged XP (Phase 4) — clamped server-side regardless of what the
        // model returns; never trust it to honor the prompt's 0-XP_DAILY_CAP
        // range on its own. Deliberately NOT written to profiles.xp (the
        // live, user-facing lifetime total) — see PREVIEW_BRANCH_HANDOFF.md
        // for why: profiles.xp already has a separate, deterministic
        // per-habit-tap XP path (lifetimeXpForHabitLog in src/arcProgress.js),
        // and wiring this in too would double-count every day. This column
        // is observational-only until a human decides how the two systems
        // should reconcile.
        xp_awarded: Number.isFinite(d.xp_delta) ? Math.min(XP_DAILY_CAP, Math.max(0, Math.round(d.xp_delta))) : null,
        xp_reason: typeof d.xp_reason === "string" && d.xp_reason.trim() ? d.xp_reason.trim().slice(0, 300) : null,
      }));
    if (extendedUpserts.length) {
      const { error: extErr } = await db
        .from("daily_summaries")
        .upsert(extendedUpserts, { onConflict: "user_id,date" });
      if (extErr) {
        console.warn("[memory-rollover] extended daily_summaries fields not written (migration likely not applied yet)", extErr.message);
      }
    }

    const FACT_KINDS = new Set(["fact", "commitment", "preference", "project", "person", "event", "emotional_pattern"]);
    const normalizeForDedup = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
    const candidateFacts = [];
    for (const d of parsed.days) {
      if (!d || !wanted.has(d.date) || !Array.isArray(d.facts)) continue;
      for (const f of d.facts) {
        if (!f || typeof f.content !== "string" || !f.content.trim()) continue;
        if (!FACT_KINDS.has(f.kind)) continue;
        const importance = Number.isFinite(f.importance) ? Math.min(5, Math.max(1, Math.round(f.importance))) : 3;
        candidateFacts.push({ kind: f.kind, content: f.content.trim().slice(0, 500), importance, source_day: d.date });
      }
    }
    if (candidateFacts.length) {
      try {
        const { data: existingFacts, error: factSelErr } = await db
          .from("memory_facts")
          .select("id, kind, content")
          .eq("user_id", userId)
          .eq("status", "active");
        if (factSelErr) throw factSelErr;

        // No embeddings yet (see PREVIEW_BRANCH_HANDOFF.md) — dedup via a
        // crude normalized-text match instead of similarity search. Good
        // enough to stop the same fact being re-inserted every rollover run;
        // real semantic dedup lands once an embedding pipeline exists.
        const existingNorm = (existingFacts || []).map(r => ({ id: r.id, kind: r.kind, norm: normalizeForDedup(r.content) }));
        const toInsert = [];
        const toTouch = [];
        const insertedNorm = []; // dedup against facts already queued THIS run too — a two-day batch can easily surface the same theme twice
        for (const f of candidateFacts) {
          const norm = normalizeForDedup(f.content);
          const dbMatch = existingNorm.find(e => e.kind === f.kind && (e.norm === norm || e.norm.includes(norm) || norm.includes(e.norm)));
          if (dbMatch) {
            if (!toTouch.includes(dbMatch.id)) toTouch.push(dbMatch.id);
            continue;
          }
          const batchMatch = insertedNorm.find(e => e.kind === f.kind && (e.norm === norm || e.norm.includes(norm) || norm.includes(e.norm)));
          if (batchMatch) continue; // already queued for insert this run — skip the duplicate rather than inserting it twice
          toInsert.push({
            user_id: userId,
            kind: f.kind,
            content: f.content,
            importance: f.importance,
            source_day: f.source_day,
          });
          insertedNorm.push({ kind: f.kind, norm });
        }
        if (toInsert.length) {
          const { error: factInsErr } = await db.from("memory_facts").insert(toInsert);
          if (factInsErr) throw factInsErr;
        }
        if (toTouch.length) {
          const { error: factTouchErr } = await db
            .from("memory_facts")
            .update({ last_referenced_at: new Date().toISOString() })
            .in("id", toTouch);
          if (factTouchErr) throw factTouchErr;
        }
      } catch (factErr) {
        console.warn("[memory-rollover] memory_facts not written (migration likely not applied yet)", factErr?.message || factErr);
      }
    }
    // ── end Phase 3 addition ────────────────────────────────────────────────

    // ── PREVIEW BRANCH — AI-judged XP audit log (Phase 4) ──────────────────
    // xp_events is a NEW table, staged (not applied) alongside the rest of
    // this branch's schema work — see supabase/pending_migrations/. Same
    // fail-soft pattern as memory_facts above: an append-only audit row per
    // day/user so the (currently just observational) xp_awarded/xp_reason
    // values above are traceable later, without touching profiles.xp.
    const xpEvents = parsed.days
      .filter(d => d && wanted.has(d.date) && Number.isFinite(d.xp_delta))
      .map(d => ({
        user_id: userId,
        event_date: d.date,
        amount: Math.min(XP_DAILY_CAP, Math.max(0, Math.round(d.xp_delta))),
        reason: typeof d.xp_reason === "string" && d.xp_reason.trim() ? d.xp_reason.trim().slice(0, 300) : null,
        source: "ai_daily_rollover",
      }));
    if (xpEvents.length) {
      try {
        const { error: xpErr } = await db.from("xp_events").insert(xpEvents);
        if (xpErr) throw xpErr;
      } catch (xpErr) {
        console.warn("[memory-rollover] xp_events not written (table likely not created yet)", xpErr?.message || xpErr);
      }
    }
    // ── end Phase 4 addition ────────────────────────────────────────────────

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
