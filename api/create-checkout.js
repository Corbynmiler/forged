import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).end();

    const { plan = "monthly" } = req.body || {};
    const authHeader = req.headers.authorization || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!token) return res.status(401).json({ error: "Missing Authorization bearer token" });

    // Support both canonical and test-suffixed env var names
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey      = process.env.STRIPE_SECRET_KEY      || process.env.Stripe_Secret_Key_Test;
    const priceId        = plan === "annual"
      ? (process.env.STRIPE_ANNUAL_PRICE_ID  || process.env.STRIPE_ANNUAL_PRICE_ID_Test)
      : (process.env.STRIPE_MONTHLY_PRICE_ID || process.env.STRIPE_MONTHLY_PRICE_ID_Test);

    if (!serviceRoleKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
    if (!stripeKey)      return res.status(500).json({ error: "Stripe secret key not configured" });
    if (!priceId)        return res.status(500).json({ error: "Stripe price ID not configured" });

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
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: userId,
      ...(email ? { customer_email: email } : {}),
      success_url: `${process.env.APP_URL || "https://forged-sage.vercel.app"}/?checkout=success`,
      cancel_url:  `${process.env.APP_URL || "https://forged-sage.vercel.app"}/`,
      subscription_data: { metadata: { userId } },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("create-checkout error:", err);
    return res.status(500).json({ error: err.message || "Could not create checkout session" });
  }
}
