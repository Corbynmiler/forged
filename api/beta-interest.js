export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, why, feedback, pay } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }

  // Anon key — safe to use server-side; RLS policy allows public inserts on beta_signups
  const supabaseUrl = "https://apdmvbzfjuvxworjepze.supabase.co";
  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU";

  const response = await fetch(`${supabaseUrl}/rest/v1/beta_signups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": anonKey,
      "Authorization": `Bearer ${anonKey}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      name,
      email,
      why:      why      || null,
      feedback: feedback || null,
      pay:      pay      || null,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Supabase insert error:", err);
    return res.status(500).json({ error: "Failed to save signup." });
  }

  return res.status(200).json({ ok: true });
}
