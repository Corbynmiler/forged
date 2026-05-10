import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Matches App.jsx `weekStartFor` — Monday-start week bucket in local calendar sense. */
function weekStartFromClientYmd(ymd) {
  if (!DATE_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day + (day === 0 ? -6 : 1));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

const WEEKLY_BRIEF_GEN_LIMIT = 2;

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function buildContext({ habits = [], goals = [], journalEntries = [], name = "there", clientDate }) {
  const today = (clientDate && DATE_RE.test(clientDate)) ? clientDate : new Date().toISOString().slice(0, 10);
  const day7  = daysAgoStr(7);
  const day14 = daysAgoStr(14);

  const lines = [];
  lines.push(`User: ${name}`);
  lines.push(`Today: ${today}`);
  lines.push("");

  // ── Habits — last 14 days of real logs ──────────────────────────────────────
  if (habits.length > 0) {
    lines.push("Habits (last 14 days):");
    for (const h of habits) {
      const recentLogs = (h.logs || [])
        .filter(l => l.date >= day14 && l.value !== "skip" && l.value !== "quicknote");
      const logCount = recentLogs.length;
      const last7Count = recentLogs.filter(l => l.date >= day7).length;

      let line = `- ${h.emoji || ""} ${h.name} (${h.habitType}): logged ${logCount} days in last 14 (${last7Count} this week)`;

      // Collect meaningful writing from last 14 days
      const writings = recentLogs.flatMap(l => {
        const pieces = [];
        if (l.reflection) pieces.push(`reflection: "${l.reflection}"`);
        if (l.note)       pieces.push(`note: "${l.note}"`);
        if (l.value?.win)       pieces.push(`win: "${l.value.win}"`);
        if (l.value?.hardPart)  pieces.push(`hard part: "${l.value.hardPart}"`);
        return pieces;
      }).slice(0, 6); // cap per habit
      if (writings.length > 0) line += "\n  " + writings.join("; ");
      lines.push(line);
    }
    lines.push("");
  }

  // ── Goals ───────────────────────────────────────────────────────────────────
  const activeGoals = goals.filter(g => g.status !== "completed");
  if (activeGoals.length > 0) {
    lines.push("Goals:");
    for (const g of activeGoals) {
      const pct = g.targetValue > 0
        ? Math.round(((g.currentValue - (g.startValue || 0)) / (g.targetValue - (g.startValue || 0))) * 100)
        : 0;
      lines.push(`- ${g.emoji || ""} ${g.name}: ${g.currentValue}/${g.targetValue}${g.unit || ""} (${pct}%)${g.targetDate ? `, due ${g.targetDate}` : ""}`);
    }
    lines.push("");
  }

  // ── Journal entries — last 7 days ────────────────────────────────────────────
  const recentJournal = (journalEntries || []).filter(e => e.date >= day7);
  if (recentJournal.length > 0) {
    lines.push("Journal entries (this week):");
    for (const e of recentJournal) {
      const snippet = e.content.length > 300 ? e.content.slice(0, 300) + "…" : e.content;
      lines.push(`- [${e.date}] ${snippet}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildPrompt(context) {
  return `You are reviewing a week of habit tracking data for someone using Forged.

${context}
---

Write them a 4–6 sentence weekly brief. Be specific to their actual data — names of habits, real numbers, what they actually wrote.

Cover:
1. What they consistently showed up for this week (or what held strong)
2. Where there was a gap or a slip — name the habit if relevant
3. A pattern from what they wrote (from wins, notes, or struggles if any) — skip this if there's nothing to say
4. One specific thing worth paying attention to or doing differently next week

Tone: direct, grounded, a bit like a coach who's been watching. Not cheerleader energy. Not corporate wellness. Short sentences. No filler. Do not start with "This week".`;
}

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Not configured." });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "Not configured." });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let userId = null;
  let isPro = false;
  let db = null;
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user?.id) return res.status(401).json({ error: "Invalid token" });
    userId = user.id;

    db = createClient(SUPABASE_URL, serviceRoleKey);
    const { data: prof } = await db.from("profiles").select("is_pro, is_admin").eq("id", userId).maybeSingle();
    isPro = !!(prof?.is_pro || prof?.is_admin);
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  // Parse client date + week bucket (needed by both Pro and free-trial paths)
  const clientDate =
    req.method === "GET"
      ? (typeof req.query?.client_date === "string" ? req.query.client_date : "")
      : (req.body && typeof req.body.client_date === "string" ? req.body.client_date : "");
  const anchor = DATE_RE.test(clientDate) ? clientDate : new Date().toISOString().slice(0, 10);
  const weekStart = weekStartFromClientYmd(anchor);
  if (!weekStart) return res.status(400).json({ error: "Invalid client_date" });

  // Non-Pro users get one free lifetime brief, tracked via the usage table.
  if (!isPro) {
    const { data: allUsage } = await db
      .from("weekly_brief_generation_usage")
      .select("generation_count")
      .eq("user_id", userId);
    const totalEver = (allUsage || []).reduce((s, r) => s + (r.generation_count || 0), 0);
    const freeTrialUsed = totalEver >= 1;

    if (req.method === "GET") {
      // Return this week's stored brief if any (matches Pro path shape).
      const { data: thisWeekRow } = await db
        .from("weekly_brief_generation_usage")
        .select("brief_text, brief_generated_at")
        .eq("user_id", userId)
        .eq("week_start", weekStart)
        .maybeSingle();
      return res.json({
        free_trial: true,
        free_trial_used: freeTrialUsed,
        limit: 1,
        used: freeTrialUsed ? 1 : 0,
        week_start: weekStart,
        can_generate: !freeTrialUsed,
        text: thisWeekRow?.brief_text || null,
        generated_at: thisWeekRow?.brief_generated_at || null,
      });
    }

    if (freeTrialUsed) {
      return res.status(403).json({
        error: "Your free brief has been used. Upgrade to Pro for weekly briefs.",
        free_trial_used: true,
      });
    }
    // Free trial available — fall through to generation with used=0
  }

  // Pro: read this week’s quota + stored brief
  let used = 0;
  if (isPro) {
    const { data: usageRow, error: usageReadErr } = await db
      .from("weekly_brief_generation_usage")
      .select("generation_count, brief_text, brief_generated_at")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (usageReadErr) {
      console.error("[weekly-summary] quota read:", usageReadErr.message);
      captureException(usageReadErr, { route: "weekly-summary", userId, step: "quota-read" });
      return res.status(503).json({
        error: "Weekly brief quota isn’t available yet. Apply the latest Supabase migration (weekly_brief_generation_usage), then try again.",
      });
    }
    used = typeof usageRow?.generation_count === "number" ? usageRow.generation_count : 0;

    if (req.method === "GET") {
      return res.json({
        limit: WEEKLY_BRIEF_GEN_LIMIT,
        used,
        week_start: weekStart,
        can_generate: used < WEEKLY_BRIEF_GEN_LIMIT,
        text: usageRow?.brief_text || null,
        generated_at: usageRow?.brief_generated_at || null,
      });
    }

    if (used >= WEEKLY_BRIEF_GEN_LIMIT) {
      return res.status(429).json({
        error: `You’ve used all ${WEEKLY_BRIEF_GEN_LIMIT} weekly brief generations for this week. They reset next Monday.`,
        limit: WEEKLY_BRIEF_GEN_LIMIT,
        used,
        week_start: weekStart,
      });
    }
  }

  const { habits, goals, journalEntries, name, client_date: bodyClientDate } = req.body || {};

  const context = buildContext({ habits, goals, journalEntries, name, clientDate: bodyClientDate || anchor });
  const prompt  = buildPrompt(context);

  const client = new Anthropic({ apiKey: apiKey.trim() });

  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (resp.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) return res.status(500).json({ error: "Empty response from AI" });

    const nextCount = used + 1;
    const generatedAt = new Date().toISOString();
    const { error: upsertErr } = await db.from("weekly_brief_generation_usage").upsert(
      {
        user_id: userId,
        week_start: weekStart,
        generation_count: nextCount,
        brief_text: text,
        brief_generated_at: generatedAt,
        updated_at: generatedAt,
      },
      { onConflict: "user_id,week_start" },
    );
    if (upsertErr) {
      console.error("[weekly-summary] quota upsert:", upsertErr.message);
      captureException(upsertErr, { route: "weekly-summary", userId, step: "quota-upsert" });
    }

    console.log(JSON.stringify({ level: "info", msg: "weekly-summary generated", userId, words: text.split(/\s+/).length, weekStart, genCount: nextCount, isPro }));
    return res.json({
      text,
      generated_at: generatedAt,
      limit: isPro ? WEEKLY_BRIEF_GEN_LIMIT : 1,
      used: nextCount,
      week_start: weekStart,
      ...(isPro ? {} : { free_trial: true }),
    });
  } catch (err) {
    console.error("[weekly-summary] error:", err?.message);
    captureException(err, { route: "weekly-summary", userId });
    return res.status(500).json({ error: err?.message || "Generation failed" });
  }
}

export default withSentry(handler, "weekly-summary");
