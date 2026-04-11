-- =============================================================================
-- One-time: revoke Forge Pro / beta flags from old Stripe *test* checkouts.
-- Run manually in Supabase SQL Editor (Production) after editing the emails.
--
-- Preview (optional — run first with your real emails):
--   SELECT u.email, p.is_pro, p.is_admin, p.stripe_customer_id, p.stripe_subscription_id
--   FROM profiles p
--   JOIN auth.users u ON u.id = p.id
--   WHERE lower(trim(u.email)) IN ('anders@...', 'james@...');
--
-- What it does:
--   Sets is_pro = false and clears stripe_customer_id / stripe_subscription_id
--   for exactly two auth users (Anders + James).
--
-- What it never does:
--   Does not touch corbyn.miller2000@gmail.com
--   Does not change is_admin (your admin/dev flags stay intact)
--   Does not touch rows where is_admin is true (extra safety)
--
-- After this, Anders/James get Pro only via the current live flow (checkout,
-- promo on live Checkout, or you setting is_admin / is_pro in the dashboard).
-- =============================================================================

DO $body$
DECLARE
  -- Replace with the exact auth.users.email values (case-insensitive match).
  em_anders constant text := 'PUT_ANDERS_EMAIL_HERE';
  em_james  constant text := 'PUT_JAMES_EMAIL_HERE';
  n_updated int;
BEGIN
  IF em_anders IN ('PUT_ANDERS_EMAIL_HERE', '') OR em_james IN ('PUT_JAMES_EMAIL_HERE', '') THEN
    RAISE EXCEPTION 'Edit this script: set em_anders and em_james to real emails before running.';
  END IF;

  IF lower(trim(em_anders)) = 'corbyn.miller2000@gmail.com'
     OR lower(trim(em_james)) = 'corbyn.miller2000@gmail.com' THEN
    RAISE EXCEPTION 'Refusing to run: one of the targets is the protected admin email.';
  END IF;

  UPDATE profiles p
  SET
    is_pro = false,
    stripe_customer_id = null,
    stripe_subscription_id = null,
    updated_at = now()
  FROM auth.users u
  WHERE p.id = u.id
    AND p.is_pro = true
    AND COALESCE(p.is_admin, false) = false
    AND lower(trim(u.email)) IS DISTINCT FROM 'corbyn.miller2000@gmail.com'
    AND lower(trim(u.email)) IN (lower(trim(em_anders)), lower(trim(em_james)));

  GET DIAGNOSTICS n_updated = ROW_COUNT;
  RAISE NOTICE 'revoke-legacy-test-stripe-pro: updated % profile row(s)', n_updated;

  IF n_updated = 0 THEN
    RAISE WARNING 'No rows updated — check emails match auth.users and those users have is_pro=true, is_admin=false.';
  END IF;
END;
$body$;
