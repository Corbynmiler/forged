import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { withSentry, captureException } from "./_lib/sentry.js";

/**
 * Env priority (Vercel): use canonical live vars first — STRIPE_SECRET_KEY, STRIPE_MONTHLY_PRICE_ID,
 * STRIPE_ANNUAL_PRICE_ID. Test backups (e.g. Stripe_Secret_Key_Test) are only used if the live var is unset.
 */
async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).end();

    const { plan = "monthly" } = req.body || {};
    const authHeader = req.headers.authorization || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!token) return res.status(401).json({ error: "Missing Authorization bearer token" });

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey      = process.env.STRIPE_SECRET_KEY      || process.env.Stripe_Secret_Key_Test;

    // Plan → price ID. Coach plans are billed independently of the consumer
    // Pro subscription. The webhook reads session.metadata.plan to know which
    // flag(s) to flip on the user's profile.
    let priceId;
    if (plan === "annual") {
      priceId = process.env.STRIPE_ANNUAL_PRICE_ID || process.env.STRIPE_ANNUAL_PRICE_ID_Test;
    } else if (plan === "coach") {
      priceId = process.env.STRIPE_COACH_PRICE_ID;
    } else {
      priceId = process.env.STRIPE_MONTHLY_PRICE_ID || process.env.STRIPE_MONTHLY_PRICE_ID_Test;
    }

    if (!serviceRoleKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
    if (!stripeKey)      return res.status(500).json({ error: "Stripe secret key not configured" });
    if (!priceId)        return res.status(500).json({ error: "Stripe price ID not configured for this plan" });

    const supabase = createClient("https://apdmvbzfjuvxworjepze.supabase.co", serviceRoleKey);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user?.id) {
      return res.status(401).json({ error: "Invalid session" });
    }
    const userId = user.id;
    const email  = user.email || null;

    const stripe  = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_collection: "if_required",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: userId,
      ...(email ? { customer_email: email } : {}),
      success_url: `${process.env.APP_URL || "https://forged-sage.vercel.app"}/?checkout=success`,
      cancel_url:  `${process.env.APP_URL || "https://forged-sage.vercel.app"}/`,
      // Stamp plan onto BOTH the session and the subscription so the webhook
      // can branch on it for any future event (renewal, cancel, failed payment).
      metadata: { plan, userId },
      subscription_data: { metadata: { userId, plan } },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("create-checkout error:", err);
    captureException(err, { route: "create-checkout" });
    return res.status(500).json({ error: err.message || "Could not create checkout session" });
  }
}

export default withSentry(handler, "create-checkout");
