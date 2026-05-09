import { withSentry } from "./_lib/sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON." });
    }
  }

  const {
    name: nameIn,
    email: emailIn,
    why: whyIn,
    feedback: feedbackIn,
    pay: payIn,
    message,
  } = body || {};

  const email = String(emailIn || "").trim();
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  let name = String(nameIn || "").trim();
  if (!name) name = email.split("@")[0] || "Interested";

  let feedback = feedbackIn != null && feedbackIn !== "" ? String(feedbackIn) : null;
  if (message !== undefined) {
    const m = String(message || "").trim();
    feedback = m || null;
  }

  const why = whyIn != null && whyIn !== "" ? String(whyIn) : null;
  const pay = payIn != null && payIn !== "" ? String(payIn) : null;

  // Anon key — safe to use server-side; RLS policy allows public inserts on beta_signups
  const supabaseUrl = "https://apdmvbzfjuvxworjepze.supabase.co";
  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

  const clientBearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const bearer = clientBearer || anonKey;

  const response = await fetch(`${supabaseUrl}/rest/v1/beta_signups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": anonKey,
      "Authorization": `Bearer ${bearer}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      name,
      email,
      why,
      feedback,
      pay,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Supabase insert error:", err);
    return res.status(500).json({ error: "Failed to save signup." });
  }

  return res.status(200).json({ ok: true });
}

export default withSentry(handler, "beta-interest");
