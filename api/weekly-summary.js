import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const SUPABASE_ANON_KEY =
  "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

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

const SIGNALS_START = "SIGNALS_JSON";
const SIGNALS_END = "END_SIGNALS_JSON";

/** Strip structured signals from model output; return prose + validated [{ habit_name, signal }]. */
function parseBriefAndSignals(raw) {
  const full = String(raw || "").trim();
  const start = full.indexOf(SIGNALS_START);
  const end = full.indexOf(SIGNALS_END);
  if (start === -1 || end === -1 || end <= start) {
    return { prose: full, signals: [] };
  }
  const before = full.slice(0, start).trim();
  const after = full.slice(end + SIGNALS_END.length).trim();
  const prose = [before, after].filter(Boolean).join("\n\n").trim();
  const jsonSlice = full.slice(start + SIGNALS_START.length, end).trim();
  let signals = [];
  try {
    const parsed = JSON.parse(jsonSlice);
    if (Array.isArray(parsed)) {
      signals = parsed
        .filter((x) => x && typeof x.habit_name === "string" && typeof x.signal === "string")
        .map((x) => ({ habit_name: x.habit_name.trim(), signal: x.signal.trim() }));
    }
  } catch {
    /* keep [] */
  }
  return { prose, signals };
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function parseLocalYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function arcDayAndWeek(activeBlock, clientDate) {
  const today = (clientDate && DATE_RE.test(clientDate)) ? clientDate : new Date().toISOString().slice(0, 10);
  const start = activeBlock?.startDate;
  const duration = Math.max(1, activeBlock?.durationDays || 56);
  const totalWeeks = Math.max(1, Math.ceil(duration / 7));
  if (!start || !DATE_RE.test(start)) return { dayX: 1, weekN: 1, duration, totalWeeks };
  const daysElapsed = Math.floor((parseLocalYmd(today) - parseLocalYmd(start)) / 86400000);
  const dayX = Math.min(duration, Math.max(1, daysElapsed + 1));
  const weekN = Math.min(totalWeeks, Math.max(1, Math.ceil((daysElapsed + 1) / 7)));
  return { dayX, weekN, duration, totalWeeks };
}

function proofActionsWeekLines(habits, activeBlock, weekStart, weekEnd) {
  const track = (habits || []).filter(
    (h) => h && h.habitType !== "log" && h.isProofAction === true && h.blockId === activeBlock.id,
  );
  if (!track.length) return ["- (none linked yet)"];
  return track.map((h) => {
    const realLogs = (h.logs || []).filter(
      (l) =>
        l.date >= weekStart &&
        l.date <= weekEnd &&
        l.value !== "skip" &&
        l.value !== "quicknote" &&
        l.value !== false &&
        l.value != null,
    );
    if (h.habitType === "weekly") {
      const sessions = realLogs.filter((l) => l.value === true).length;
      const target = h.weeklyTarget || 3;
      return `- ${h.emoji || ""} ${h.name}: ${sessions}/${target} sessions this week`;
    }
    const uniqueDays = new Set(realLogs.map((l) => l.date)).size;
    return `- ${h.emoji || ""} ${h.name}: ${uniqueDays} of 7 days this week`;
  });
}

function buildArcContextSection(activeBlock, habits, clientDate, weekStart, weekEnd) {
  const { dayX, duration } = arcDayAndWeek(activeBlock, clientDate);
  const dash = "—";
  const lines = [
    "Active Arc:",
    `- They said they are becoming: ${activeBlock.identity || dash}`,
    `- Why it matters: ${(activeBlock.whyStatement || "").trim() || dash}`,
    `- Day ${dayX} of ${duration} (Arc started ${activeBlock.startDate})`,
    `- Old pattern they're weakening: ${(activeBlock.oldPattern || "").trim() || dash}`,
    "Proof actions logged this week:",
    ...proofActionsWeekLines(habits, activeBlock, weekStart, weekEnd),
    "",
  ];
  return lines.join("\n");
}

function buildContext({ habits = [], goals = [], journalEntries = [], name = "there", clientDate, activeBlock = null, weekStart = null, weekEnd = null }) {
  const today = (clientDate && DATE_RE.test(clientDate)) ? clientDate : new Date().toISOString().slice(0, 10);
  const day7  = daysAgoStr(7);
  const day14 = daysAgoStr(14);
  const ws = weekStart && DATE_RE.test(weekStart) ? weekStart : day7;
  const we = weekEnd && DATE_RE.test(weekEnd) ? weekEnd : today;

  const lines = [];
  lines.push(`User: ${name}`);
  lines.push(`Today: ${today}`);
  lines.push("");

  if (activeBlock?.id) {
    lines.push(buildArcContextSection(activeBlock, habits, today, ws, we));
  }

  // ── Habits — last 14 days of real logs ──────────────────────────────────────
  if (habits.length > 0) {
    lines.push("Habits (last 14 days):");
    for (const h of habits) {
      // Real completions only — exclude skip, quicknote, false, null
      const realLogs = (h.logs || [])
        .filter(l => l.date >= day14 && l.value !== "skip" && l.value !== "quicknote" && l.value !== false && l.value != null);
      const skipLogs = (h.logs || [])
        .filter(l => l.date >= day14 && l.value === "skip");

      const thisWeekReal = realLogs.filter(l => l.date >= day7);
      const restThisWeek = skipLogs.filter(l => l.date >= day7).length;

      let line;
      if (h.habitType === "weekly") {
        // Weekly: sessions can be multiple per day — count raw sessions vs target
        const sessionsThisWeek = thisWeekReal.filter(l => l.value === true).length;
        const sessionsLast14 = realLogs.filter(l => l.value === true).length;
        const target = h.weeklyTarget || 3;
        line = `- ${h.emoji || ""} ${h.name} (weekly, target ${target}x/wk): ${sessionsThisWeek}/${target} sessions this week` +
          (restThisWeek > 0 ? `, ${restThisWeek} rest day(s) marked` : "") +
          `, ${sessionsLast14} sessions in last 14 days`;
      } else {
        // Daily/project/limit/log: count unique days logged, not raw entry count
        const uniqueDaysThisWeek = new Set(thisWeekReal.map(l => l.date)).size;
        const uniqueDaysLast14 = new Set(realLogs.map(l => l.date)).size;
        line = `- ${h.emoji || ""} ${h.name} (${h.habitType}): ${uniqueDaysThisWeek} of 7 days this week` +
          (restThisWeek > 0 ? ` (${restThisWeek} intentional rest)` : "") +
          `, ${uniqueDaysLast14} of 14 days in last 14`;
      }

      // Collect meaningful writing from last 14 days
      const writings = realLogs.flatMap(l => {
        const pieces = [];
        if (l.reflection) pieces.push(`reflection: "${l.reflection}"`);
        if (l.note)       pieces.push(`note: "${l.note}"`);
        if (l.value?.win)       pieces.push(`win: "${l.value.win}"`);
        if (l.value?.hardPart)  pieces.push(`hard part: "${l.value.hardPart}"`);
        return pieces;
      }).slice(0, 6);
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

function buildPrompt(context, habitNamesForSignals) {
  const namesBlock =
    habitNamesForSignals.length > 0
      ? `
Active habits (use these EXACT habit_name strings in SIGNALS_JSON — one object per line below, same order):
${habitNamesForSignals.map((n) => `- ${n}`).join("\n")}
`
      : `
No active habits listed — output SIGNALS_JSON as an empty array: [] between the markers.
`;

  return `You are reviewing a week of habit tracking data for someone using Forged.

${context}
---
${namesBlock}
Write them a 4–6 sentence weekly brief. Be specific to their actual data — names of habits, real numbers, what they actually wrote.

Cover:
1. What they consistently showed up for this week (or what held strong)
2. Where there was a gap or a slip — name the habit if relevant
3. A pattern from what they wrote (from wins, notes, or struggles if any) — skip this if there's nothing to say
4. One specific thing worth paying attention to or doing differently next week

Tone: direct, grounded, a bit like a coach who's been watching. Not cheerleader energy. Not corporate wellness. Short sentences. No filler. Do not start with "This week".

After the prose brief only (no extra commentary before or after the block), output momentum signals on separate lines exactly like this:

SIGNALS_JSON
[{"habit_name": "Running", "signal": "4 of 7 days — your best week this month"}]
END_SIGNALS_JSON

Rules for the JSON array:
- One object per habit in the "Active habits" list (same order as listed). habit_name must match the list exactly.
- Each "signal" is one short clause (under ~90 characters) grounded strictly in the numbers above.
- For daily habits: lead with "X of 7 days" where X = days logged this week (rest days don't count as logged).
- For weekly habits: lead with "X of Y sessions" where Y = the stated weekly target.
- Only add a characterisation (e.g. "— best week yet", "— missed target", "— zero contact this week") when the data clearly supports it. Do NOT use subjective labels like "slipping" or "holding steady" unless comparing to a clear trend in the last 14 days.
- Do not invent numbers. Every figure in the signal must come from the data provided.
- Valid JSON only between SIGNALS_JSON and END_SIGNALS_JSON. No markdown fences.`;
}

function arcReviewPrompt(context, habitNamesForSignals) {
  const namesBlock =
    habitNamesForSignals.length > 0
      ? `
Active habits (use these EXACT habit_name strings in SIGNALS_JSON — one object per line below, same order):
${habitNamesForSignals.map((n) => `- ${n}`).join("\n")}
`
      : `
No active habits listed — output SIGNALS_JSON as an empty array: [] between the markers.
`;

  return `You are writing a Weekly Arc Review for someone using Forged — comparing what they actually did this week against the identity they chose at the start of their Arc.

${context}
---
${namesBlock}
Write them a SHORT Review — at most 8 lines total, not a report. Be specific to their actual data.

Format (follow this structure):
VERDICT: one honest sentence — did this week move them toward their Arc identity or not?
PROOF: 1–2 sentences on what actually showed up (name habits/numbers).
PATTERN: 1 sentence on what keeps derailing them, if visible in the data — or what trade-off showed up.
NEXT: one concrete instruction for next week (one action, one boundary, or one proof to protect).

Tone: direct, grounded, like someone who's been watching. Not cheerleader energy. No "future you", "your journey", "warrior", or motivational-guru phrasing. Do not start with "This week".

After the prose only, output momentum signals on separate lines exactly like this:

SIGNALS_JSON
[{"habit_name": "Running", "signal": "4 of 7 days — your best week this month"}]
END_SIGNALS_JSON

Rules for the JSON array:
- One object per habit in the "Active habits" list (same order as listed). habit_name must match the list exactly.
- Each "signal" is one short clause (under ~90 characters) grounded strictly in the numbers above.
- For daily habits: lead with "X of 7 days" where X = days logged this week (rest days don't count as logged).
- For weekly habits: lead with "X of Y sessions" where Y = the stated weekly target.
- Only add a characterisation when the data clearly supports it. Do NOT use subjective labels like "slipping" unless comparing to a clear trend in the last 14 days.
- Do not invent numbers. Every figure in the signal must come from the data provided.
- Valid JSON only between SIGNALS_JSON and END_SIGNALS_JSON. No markdown fences.`;
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
  let isAdmin = false;
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
    isAdmin = !!prof?.is_admin;
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

  // Free users now get 1 Arc Review per ISO week (not 1 ever).
  // The Arc loop is the core product — free users must be able to feel the
  // weekly verdict for the current week. Pro keeps multi-regen + history.
  if (!isPro) {
    const { data: thisWeekRow } = await db
      .from("weekly_brief_generation_usage")
      .select("generation_count, brief_text, brief_generated_at")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .maybeSingle();
    const thisWeekUsed = typeof thisWeekRow?.generation_count === "number" ? thisWeekRow.generation_count : 0;
    const usedThisWeek = thisWeekUsed >= 1;

    if (req.method === "GET") {
      const { data: momentumRow, error: momentumReadErr } = await db
        .from("weekly_briefs")
        .select("momentum_signals")
        .eq("user_id", userId)
        .eq("week_start", weekStart)
        .maybeSingle();
      if (momentumReadErr) {
        console.warn("[weekly-summary] weekly_briefs read (free):", momentumReadErr.message);
      }
      const momentumOut =
        !momentumReadErr && Array.isArray(momentumRow?.momentum_signals) ? momentumRow.momentum_signals : [];
      return res.json({
        free_trial: true,
        free_trial_used: usedThisWeek,
        limit: 1,
        used: usedThisWeek ? 1 : 0,
        week_start: weekStart,
        can_generate: !usedThisWeek,
        text: thisWeekRow?.brief_text || null,
        generated_at: thisWeekRow?.brief_generated_at || null,
        momentum_signals: momentumOut,
      });
    }

    if (usedThisWeek) {
      return res.status(403).json({
        error: "You've already generated this week's Arc Review. Your next free Arc Review is available Monday.",
        free_trial_used: true,
      });
    }
    // This week's free review unused — fall through to generation with used=0
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
      const { data: momentumRow, error: momentumReadErr } = await db
        .from("weekly_briefs")
        .select("momentum_signals")
        .eq("user_id", userId)
        .eq("week_start", weekStart)
        .maybeSingle();
      if (momentumReadErr) {
        console.warn("[weekly-summary] weekly_briefs read (pro):", momentumReadErr.message);
      }
      const momentumOut =
        !momentumReadErr && Array.isArray(momentumRow?.momentum_signals) ? momentumRow.momentum_signals : [];
      return res.json({
        limit: WEEKLY_BRIEF_GEN_LIMIT,
        used,
        week_start: weekStart,
        can_generate: used < WEEKLY_BRIEF_GEN_LIMIT,
        text: usageRow?.brief_text || null,
        generated_at: usageRow?.brief_generated_at || null,
        momentum_signals: momentumOut,
      });
    }

    if (!isAdmin && used >= WEEKLY_BRIEF_GEN_LIMIT) {
      return res.status(429).json({
        error: `You’ve used all ${WEEKLY_BRIEF_GEN_LIMIT} weekly brief generations for this week. They reset next Monday.`,
        limit: WEEKLY_BRIEF_GEN_LIMIT,
        used,
        week_start: weekStart,
      });
    }
  }

  const { habits, goals, journalEntries, name, client_date: bodyClientDate, activeBlock } = req.body || {};
  const anchorDate = bodyClientDate || anchor;
  const weekEnd = anchorDate;

  const context = buildContext({
    habits,
    goals,
    journalEntries,
    name,
    clientDate: anchorDate,
    activeBlock: activeBlock?.id ? activeBlock : null,
    weekStart,
    weekEnd,
  });
  const habitNamesForSignals = (habits || [])
    .filter((h) => h && typeof h.name === "string" && h.name.trim())
    .map((h) => h.name.trim());
  const prompt = activeBlock?.id
    ? arcReviewPrompt(context, habitNamesForSignals)
    : buildPrompt(context, habitNamesForSignals);

  const client = new Anthropic({ apiKey: apiKey.trim() });

  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!raw) return res.status(500).json({ error: "Empty response from AI" });

    const { prose, signals } = parseBriefAndSignals(raw);
    const proseOut =
      prose ||
      raw.replace(/\s*SIGNALS_JSON[\s\S]*/i, "").trim() ||
      raw.trim();
    if (!proseOut) return res.status(500).json({ error: "Empty prose after parsing brief" });

    const nextCount = used + 1;
    const generatedAt = new Date().toISOString();
    const { error: upsertErr } = await db.from("weekly_brief_generation_usage").upsert(
      {
        user_id: userId,
        week_start: weekStart,
        generation_count: nextCount,
        brief_text: proseOut,
        brief_generated_at: generatedAt,
        updated_at: generatedAt,
      },
      { onConflict: "user_id,week_start" },
    );
    if (upsertErr) {
      console.error("[weekly-summary] quota upsert:", upsertErr.message);
      captureException(upsertErr, { route: "weekly-summary", userId, step: "quota-upsert" });
    }

    const { error: momentumErr } = await db.from("weekly_briefs").upsert(
      {
        user_id: userId,
        week_start: weekStart,
        momentum_signals: signals,
        updated_at: generatedAt,
      },
      { onConflict: "user_id,week_start" },
    );
    if (momentumErr) {
      console.error("[weekly-summary] weekly_briefs upsert:", momentumErr.message);
      captureException(momentumErr, { route: "weekly-summary", userId, step: "weekly_briefs-upsert" });
    }

    console.log(JSON.stringify({
      level: "info",
      msg: "weekly-summary generated",
      userId,
      words: proseOut.split(/\s+/).length,
      weekStart,
      genCount: nextCount,
      isPro,
      momentumCount: signals.length,
    }));
    return res.json({
      text: proseOut,
      momentum_signals: signals,
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
