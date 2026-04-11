import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * Opens Stripe Customer Billing Portal (cancel plan, update payment method, invoices).
 * Requires profiles.stripe_customer_id from a completed Checkout session.
 * Configure the portal at https://dashboard.stripe.com/settings/billing/portal
 */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).end();

    const authHeader = req.headers.authorization || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!token) return res.status(401).json({ error: "Missing Authorization bearer token" });

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey      = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key_Test;
    const appUrl         = process.env.APP_URL || "https://forged-sage.vercel.app";

    if (!serviceRoleKey || !stripeKey) {
      return res.status(500).json({ error: "Server not configured" });
    }

    const supabase = createClient("https://apdmvbzfjuvxworjepze.supabase.co", serviceRoleKey);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user?.id) return res.status(401).json({ error: "Invalid session" });

    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (pErr || !profile?.stripe_customer_id) {
      return res.status(400).json({
        error: "No billing account on file yet. If you subscribed, wait a moment and refresh; otherwise complete checkout first.",
      });
    }

    const stripe = new Stripe(stripeKey);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl.replace(/\/$/, "")}/`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error("create-portal-session error:", err);
    return res.status(500).json({ error: err.message || "Could not open billing portal" });
  }
}
