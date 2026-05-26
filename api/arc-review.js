import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86400000;
const MODEL_ID = "claude-haiku-4-5";

function parseLocalYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function addCalendarDays(ymd, delta) {
  const [y, m, d] = ymd.split("-").map(Number);
  const u = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(u);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function arcDayNumber(block, todayYmd) {
  const daysElapsed = Math.floor((parseLocalYmd(todayYmd) - parseLocalYmd(block.start_date)) / MS_PER_DAY);
  return Math.min(block.duration_days || 56, Math.max(1, daysElapsed + 1));
}

function isRealLog(l) {
  return l.value !== "skip" && l.value !== "quicknote" && l.value !== false && l.value != null;
}

function habitArcSummary(h, startDate, endDate) {
  const logs = (h.logs || []).filter((l) => l.date >= startDate && l.date <= endDate && isRealLog(l));
  if (h.habit_type === "weekly") {
    const sessions = logs.filter((l) => l.value === true).length;
    const weeks = Math.max(1, Math.ceil((parseLocalYmd(endDate) - parseLocalYmd(startDate) + 1) / 7));
    const target = h.weekly_target || 3;
    return `- ${h.emoji || ""} ${h.name} (proof: ${h.is_proof_action ? "yes" : "no"}, weekly): ${sessions} sessions across the Arc (~${target}/wk target)`;
  }
  const uniqueDays = new Set(logs.map((l) => l.date)).size;
  const spanDays = Math.max(1, Math.floor((parseLocalYmd(endDate) - parseLocalYmd(startDate)) / MS_PER_DAY) + 1);
  return `- ${h.emoji || ""} ${h.name} (proof: ${h.is_proof_action ? "yes" : "no"}, ${h.habit_type}): ${uniqueDays} of ${spanDays} days with proof logged`;
}

function buildArcReviewContext({ block, habits, weeklyBriefs, journalEntries, name, todayYmd }) {
  const startDate = block.start_date;
  const endDate = block.end_date;
  const duration = block.duration_days || 56;
  const dayX = arcDayNumber(block, todayYmd);
  const lines = [];

  lines.push(`User: ${name || "there"}`);
  lines.push(`Arc window: ${startDate} to ${endDate} (${duration} days)`);
  lines.push(`Today: ${todayYmd} (day ${dayX} of ${duration})`);
  lines.push("");
  lines.push("Day-1 identity (what they said they're becoming):");
  lines.push(block.identity || "—");
  lines.push("");
  lines.push("Why it mattered:");
  lines.push((block.why_statement || "").trim() || "—");
  lines.push("");
  lines.push("Old pattern they were trying to weaken:");
  lines.push((block.old_pattern || "").trim() || "—");
  lines.push("");
  lines.push("Bare minimum on bad days:");
  lines.push((block.minimum_proof || "").trim() || "—");
  lines.push("");

  const proofHabits = habits.filter((h) => h.is_proof_action);
  if (proofHabits.length) {
    lines.push("Proof actions across the Arc:");
    proofHabits.forEach((h) => lines.push(habitArcSummary(h, startDate, endDate)));
    lines.push("");
  }

  const otherLinked = habits.filter((h) => !h.is_proof_action);
  if (otherLinked.length) {
    lines.push("Other habits linked to this Arc:");
    otherLinked.forEach((h) => lines.push(habitArcSummary(h, startDate, endDate)));
    lines.push("");
  }

  if (!habits.length) {
    lines.push("Habits linked to this Arc: none recorded.");
    lines.push("");
  }

  const briefs = (weeklyBriefs || []).filter((b) => (b.brief_text || "").trim());
  if (briefs.length) {
    lines.push("Weekly Arc Review prose from during the Arc:");
    for (const b of briefs) {
      const snippet = b.brief_text.length > 500 ? b.brief_text.slice(0, 500) + "…" : b.brief_text;
      lines.push(`- Week of ${b.week_start}: ${snippet}`);
    }
    lines.push("");
  }

  const journals = (journalEntries || []).filter((e) => (e.content || "").trim());
  if (journals.length) {
    lines.push("Journal entries during the Arc (sample):");
    for (const e of journals.slice(0, 12)) {
      const snippet = e.content.length > 280 ? e.content.slice(0, 280) + "…" : e.content;
      lines.push(`- [${e.date}] ${snippet}`);
    }
    if (journals.length > 12) lines.push(`- … and ${journals.length - 12} more entries`);
    lines.push("");
  }

  return lines.join("\n");
}

function buildArcReviewUserPrompt(context) {
  return `Here is everything logged during this person's 8-week Arc:

${context}

Write the end-of-Arc review now. Plain text only — no markdown, no bullet characters, no headings.`;
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Not configured." });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "Not configured." });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let userId = null;
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user?.id) return res.status(401).json({ error: "Invalid token" });
    userId = user.id;
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { block_id: blockId, name: clientName } = req.body || {};
  if (!blockId) return res.status(400).json({ error: "block_id required" });

  const db = createClient(SUPABASE_URL, serviceRoleKey);

  const { data: block, error: blockErr } = await db
    .from("forge_blocks")
    .select("*")
    .eq("id", blockId)
    .eq("user_id", userId)
    .maybeSingle();

  if (blockErr) {
    console.error("[arc-review] block load:", blockErr.message);
    return res.status(500).json({ error: "Could not load Arc." });
  }
  if (!block) return res.status(404).json({ error: "Arc not found" });

  if (block.status === "completed" && block.review?.text) {
    return res.status(200).json({
      review: block.review,
      block,
      already_completed: true,
    });
  }

  const todayYmd = new Date().toISOString().slice(0, 10);
  const windowEnd = block.end_date < todayYmd ? block.end_date : todayYmd;

  const { data: habitRows, error: habitsErr } = await db
    .from("habits")
    .select("*")
    .eq("user_id", userId)
    .eq("block_id", blockId);

  if (habitsErr) {
    console.error("[arc-review] habits load:", habitsErr.message);
    return res.status(500).json({ error: "Could not load habits." });
  }

  const { data: briefRows } = await db
    .from("weekly_brief_generation_usage")
    .select("week_start, brief_text, brief_generated_at")
    .eq("user_id", userId)
    .gte("week_start", block.start_date)
    .lte("week_start", block.end_date)
    .not("brief_text", "is", null)
    .order("week_start", { ascending: true });

  const { data: journalRows } = await db
    .from("journal_entries")
    .select("date, content")
    .eq("user_id", userId)
    .gte("date", block.start_date)
    .lte("date", windowEnd)
    .order("date", { ascending: true });

  let profileName = clientName;
  if (!profileName) {
    const { data: prof } = await db.from("profiles").select("name").eq("id", userId).maybeSingle();
    profileName = prof?.name || "there";
  }

  const context = buildArcReviewContext({
    block,
    habits: habitRows || [],
    weeklyBriefs: briefRows || [],
    journalEntries: journalRows || [],
    name: profileName,
    todayYmd,
  });

  const system =
    "You write a 6-8 sentence end-of-Arc review. Compare the identity they wrote on day 1 to the proof they actually showed across 56 days. Name what changed. Name what stayed. End with one honest recommendation: continue, evolve, or start a new Arc. Plain text only, no markdown.";

  const client = new Anthropic({ apiKey: apiKey.trim() });
  let reviewText = "";
  try {
    const resp = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: buildArcReviewUserPrompt(context) }],
    });
    reviewText = (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    console.error("[arc-review] AI error:", err.message);
    captureException(err, { route: "arc-review", userId, blockId });
    return res.status(500).json({ error: "Failed to generate Arc review." });
  }

  if (!reviewText) return res.status(500).json({ error: "Empty response from AI." });

  const generatedAt = new Date().toISOString();
  const reviewPayload = {
    text: reviewText,
    generated_at: generatedAt,
    model: MODEL_ID,
  };

  const { data: updatedBlock, error: updateErr } = await db
    .from("forge_blocks")
    .update({
      review: reviewPayload,
      status: "completed",
      updated_at: generatedAt,
    })
    .eq("id", blockId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (updateErr) {
    console.error("[arc-review] save failed:", updateErr.message);
    captureException(updateErr, { route: "arc-review", userId, step: "save" });
    return res.status(500).json({ error: "Failed to save Arc review." });
  }

  return res.status(200).json({
    review: reviewPayload,
    block: updatedBlock,
  });
}

export default withSentry(handler, "arc-review");
