import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { habits, goals, journalEntries, name, client_date } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Not configured." });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "Not configured." });

  // Auth — require valid Supabase JWT
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let userId = null;
  let isPro = false;
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user?.id) return res.status(401).json({ error: "Invalid token" });
    userId = user.id;

    const db = createClient(SUPABASE_URL, serviceRoleKey);
    const { data: prof } = await db.from("profiles").select("is_pro, is_admin").eq("id", userId).maybeSingle();
    isPro = !!(prof?.is_pro || prof?.is_admin);
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  if (!isPro) {
    return res.status(403).json({ error: "Weekly summaries are a Pro feature." });
  }

  const context = buildContext({ habits, goals, journalEntries, name, clientDate: client_date });
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

    console.log(JSON.stringify({ level: "info", msg: "weekly-summary generated", userId, words: text.split(/\s+/).length }));
    return res.json({ text });
  } catch (err) {
    console.error("[weekly-summary] error:", err?.message);
    captureException(err, { route: "weekly-summary", userId });
    return res.status(500).json({ error: err?.message || "Generation failed" });
  }
}

export default withSentry(handler, "weekly-summary");
