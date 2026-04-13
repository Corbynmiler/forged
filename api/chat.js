import Anthropic from "@anthropic-ai/sdk";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "AI Coach is not configured yet." });
  }

  try {
    const client = new Anthropic({ apiKey: apiKey.trim() });

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system: system || "",
      messages,
    });

    const reply = response.content?.[0]?.text || "";
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Chat handler error:", err?.status, err?.message, JSON.stringify(err?.error));
    const msg = err?.error?.message || err?.message || "Something went wrong. Try again.";
    return res.status(err?.status || 500).json({ error: msg });
  }
}
