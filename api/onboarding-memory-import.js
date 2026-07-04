import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
// Anon key is public — safe to hardcode (matches src/supabase.js).
const SUPABASE_ANON_KEY = "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

// Defensive cap on pasted text — ChatGPT memory exports are short prose,
// not novels. Keeps a single onboarding paste from costing more than a
// few cents even in the worst case.
const MAX_PASTE_CHARS = 8000;
const MAX_FACTS_RETURNED = 12;
const FACT_KINDS = new Set(["fact", "commitment", "preference", "project", "person", "event", "emotional_pattern"]);

function parseModelJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Not configured" });

  // Auth required — this hits the Anthropic API, so anonymous traffic must
  // not be able to burn credit. No chat_usage/quota table needed beyond
  // this: the input-length cap below bounds cost per call, and this is an
  // onboarding-only action a real user fires at most once or twice.
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user?.id) return res.status(401).json({ error: "Invalid token" });
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const pasted = String(req.body?.text || "").trim();
  if (!pasted) return res.status(400).json({ error: "No text provided" });
  const clipped = pasted.slice(0, MAX_PASTE_CHARS);

  try {
    const client = new Anthropic({ apiKey: apiKey.trim() });
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: [{
        type: "text",
        text:
          "The user is importing memory they've exported or copied from another AI assistant (e.g. ChatGPT's Memory feature) into a new app. The pasted text is UNSTRUCTURED — it may be prose, bullet points, a raw JSON dump, or a mix. Do not assume any particular format.\n\n" +
          "Extract atomic, durable facts worth remembering long-term about this person: who they are, what they're working on, people/relationships that matter, preferences, ongoing projects, things they're trying to change or quit, recurring patterns. Skip anything that reads like AI assistant chatter, meta-commentary about ChatGPT itself, or throwaway one-off context with no lasting value.\n\n" +
          "For each fact return: kind (one of \"fact\"|\"commitment\"|\"preference\"|\"project\"|\"person\"|\"event\"|\"emotional_pattern\"), content (a short third-person sentence), importance (1-5). Return at most " + MAX_FACTS_RETURNED + " facts — pick the most durable and important ones if there are more candidates than that.\n\n" +
          "Return ONLY valid JSON, no markdown fences: { \"facts\": [{ \"kind\": \"...\", \"content\": \"...\", \"importance\": 1 }] }. If nothing worth keeping is in the text, return { \"facts\": [] }.",
        cache_control: { type: "ephemeral" },
      }],
      messages: [{ role: "user", content: clipped }],
    });

    const textOut = (resp.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const parsed = parseModelJson(textOut);
    if (!parsed || !Array.isArray(parsed.facts)) {
      console.error("[onboarding-memory-import] unparseable model output");
      return res.status(502).json({ error: "Could not read that — try pasting again, or skip this step" });
    }

    const facts = parsed.facts
      .filter(f => f && typeof f.content === "string" && f.content.trim() && FACT_KINDS.has(f.kind))
      .map(f => ({
        kind: f.kind,
        content: f.content.trim().slice(0, 500),
        importance: Number.isFinite(f.importance) ? Math.min(5, Math.max(1, Math.round(f.importance))) : 3,
      }))
      .slice(0, MAX_FACTS_RETURNED);

    return res.status(200).json({ facts });
  } catch (err) {
    console.error("[onboarding-memory-import]", err?.message || err);
    captureException(err, { route: "onboarding-memory-import" });
    return res.status(500).json({ error: "Import failed — try again, or skip this step" });
  }
}

export default withSentry(handler, "onboarding-memory-import");
