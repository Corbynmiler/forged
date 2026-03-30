import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Disable body parsing — Stripe needs the raw body to verify signatures
export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "Missing stripe-signature header" });

  const rawBody = await getRawBody(req);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id;

    if (!userId) {
      console.error("No client_reference_id on checkout session", session.id);
      return res.status(200).json({ received: true }); // still 200 so Stripe doesn't retry
    }

    const supabase = createClient(
      "https://apdmvbzfjuvxworjepze.supabase.co",
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { error } = await supabase
      .from("profiles")
      .update({ is_pro: true, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) {
      console.error("Supabase update failed for userId", userId, error);
      return res.status(500).json({ error: "DB update failed" });
    }

    console.log("Pro activated for userId:", userId);
  }

  // For subscription cancellations (optional future handling)
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    if (userId) {
      const supabase = createClient(
        "https://apdmvbzfjuvxworjepze.supabase.co",
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      await supabase
        .from("profiles")
        .update({ is_pro: false, updated_at: new Date().toISOString() })
        .eq("id", userId);
      console.log("Pro revoked for userId:", userId);
    }
  }

  return res.status(200).json({ received: true });
}
