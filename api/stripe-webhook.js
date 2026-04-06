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

  // Support both canonical and variant env var names
  const stripeKey     = process.env.STRIPE_SECRET_KEY   || process.env.Stripe_Secret_Key_Test;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_KEY;

  if (!stripeKey || !webhookSecret) {
    console.error("Missing Stripe env vars — stripeKey:", !!stripeKey, "webhookSecret:", !!webhookSecret);
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const rawBody = await getRawBody(req);
  const stripe  = new Stripe(stripeKey);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const supabase = createClient(
    "https://apdmvbzfjuvxworjepze.supabase.co",
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId  = session.client_reference_id;

    if (!userId) {
      console.error("No client_reference_id on checkout session", session.id);
      return res.status(200).json({ received: true });
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        is_pro: true,
        stripe_customer_id:     session.customer     ?? null,
        stripe_subscription_id: session.subscription ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      console.error("Supabase update failed for userId", userId, error);
      return res.status(500).json({ error: "DB update failed" });
    }
    console.log("Beta access activated for userId:", userId);
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    if (userId) {
      await supabase
        .from("profiles")
        .update({ is_pro: false, stripe_subscription_id: null, updated_at: new Date().toISOString() })
        .eq("id", userId);
      console.log("Beta access revoked for userId:", userId);
    }
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    if (userId) {
      const active = subscription.status === "active" || subscription.status === "trialing";
      await supabase
        .from("profiles")
        .update({ is_pro: active, updated_at: new Date().toISOString() })
        .eq("id", userId);
      console.log(`Subscription updated for userId: ${userId} — status: ${subscription.status}`);
    }
  }

  return res.status(200).json({ received: true });
}
