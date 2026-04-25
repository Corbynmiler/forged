import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

/** Verify with STRIPE_WEBHOOK_SECRET (live) when set; STRIPE_WEBHOOK_KEY is legacy fallback. */
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

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "Missing stripe-signature header" });

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

    // Branch on the plan stamped at checkout creation. Coach plans set
    // is_coach + coach_tier and intentionally leave is_pro alone — the coach
    // subscription is independent of the consumer Pro plan.
    const plan = session.metadata?.plan;
    const isCoachPlan = plan === "coach";

    const baseUpdate = {
      stripe_customer_id:     session.customer     ?? null,
      stripe_subscription_id: session.subscription ?? null,
      updated_at: new Date().toISOString(),
    };
    const update = isCoachPlan
      ? { ...baseUpdate, is_coach: true, coach_tier: plan }
      : { ...baseUpdate, is_pro: true };

    const { error } = await supabase
      .from("profiles")
      .update(update)
      .eq("id", userId);

    if (error) {
      console.error("Supabase update failed for userId", userId, error);
      return res.status(500).json({ error: "DB update failed" });
    }
    console.log(
      isCoachPlan
        ? `Coach access (${plan}) activated for userId: ${userId}`
        : `Beta access activated for userId: ${userId}`
    );
  }

  // ── Helper: resolve user id from subscription event ────────────────────────
  // Prefer subscription.metadata.userId (set at checkout) but fall back to
  // looking up profiles.stripe_customer_id — older subscriptions created before
  // we started stamping metadata don't have that field, and Stripe Portal /
  // dashboard-initiated changes can also strip it.
  async function resolveUserId(subscription) {
    const metaUserId = subscription.metadata?.userId;
    if (metaUserId) return metaUserId;
    const customerId = typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
    if (!customerId) return null;
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    return prof?.id || null;
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const userId = await resolveUserId(subscription);
    if (userId) {
      // Read the plan that was stamped at checkout. If absent (legacy subs
      // pre-coach-plan rollout), assume the consumer Pro flow.
      const plan = subscription.metadata?.plan;
      const isCoachPlan = plan === "coach";
      const update = isCoachPlan
        ? { is_coach: false, coach_tier: null, stripe_subscription_id: null, updated_at: new Date().toISOString() }
        : { is_pro: false, stripe_subscription_id: null, updated_at: new Date().toISOString() };
      await supabase.from("profiles").update(update).eq("id", userId);
      console.log(
        isCoachPlan
          ? `Coach access (${plan}) revoked for userId: ${userId}`
          : `Beta access revoked for userId: ${userId}`
      );
    } else {
      console.error("subscription.deleted: could not resolve user id for sub", subscription.id, "customer", subscription.customer);
    }
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object;
    const userId = await resolveUserId(subscription);
    if (userId) {
      const active = subscription.status === "active" || subscription.status === "trialing";
      const plan = subscription.metadata?.plan;
      const isCoachPlan = plan === "coach";
      const update = isCoachPlan
        ? { is_coach: active, coach_tier: active ? plan : null, updated_at: new Date().toISOString() }
        : { is_pro: active, updated_at: new Date().toISOString() };
      await supabase.from("profiles").update(update).eq("id", userId);
      console.log(`Subscription updated for userId: ${userId} — status: ${subscription.status} — plan: ${plan || "consumer"}`);
    } else {
      console.error("subscription.updated: could not resolve user id for sub", subscription.id, "customer", subscription.customer);
    }
  }

  // ── Payment failures ───────────────────────────────────────────────────────
  // Stripe retries failed invoices for a while before canceling the
  // subscription (which would fire subscription.deleted). We log these so we
  // can see in Vercel logs when a user is about to lose Pro access, and email
  // support if we start seeing a pattern.
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    let userId = null;
    if (customerId) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      userId = prof?.id || null;
    }
    console.warn("[stripe] invoice.payment_failed", {
      invoice: invoice.id,
      customer: customerId,
      userId,
      amount_due: invoice.amount_due,
      attempt_count: invoice.attempt_count,
      next_payment_attempt: invoice.next_payment_attempt,
    });
  }

  return res.status(200).json({ received: true });
}

export default withSentry(handler, "stripe-webhook");
