import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { userId, email, plan = "monthly" } = req.body || {};
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const priceId =
    plan === "annual"
      ? process.env.STRIPE_ANNUAL_PRICE_ID
      : process.env.STRIPE_MONTHLY_PRICE_ID;

  if (!priceId) return res.status(500).json({ error: "Stripe price not configured" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: userId,
      ...(email ? { customer_email: email } : {}),
      success_url: `${process.env.APP_URL || "https://forged-sage.vercel.app"}/?checkout=success`,
      cancel_url: `${process.env.APP_URL || "https://forged-sage.vercel.app"}/`,
      subscription_data: {
        metadata: { userId },
      },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return res.status(500).json({ error: "Could not create checkout session" });
  }
}
