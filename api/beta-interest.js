export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, why, feedback, pay } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }

  const supabaseUrl = "https://apdmvbzfjuvxworjepze.supabase.co";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return res.status(500).json({ error: "Server not configured." });
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/beta_signups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ name, email, why: why || null, feedback: feedback || null, pay: pay || null }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Supabase insert error:", err);
    return res.status(500).json({ error: "Failed to save signup." });
  }

  return res.status(200).json({ ok: true });
}
