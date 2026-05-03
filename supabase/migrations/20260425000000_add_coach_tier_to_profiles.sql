-- Coach subscription tier. Set by /api/stripe-webhook on a successful
-- checkout where session.metadata.plan is "coach" or "coach_pro". Cleared on
-- subscription.deleted. Independent of is_pro, which gates the consumer app.
--
-- Null means "no active coach subscription" — used to show a paywall in the
-- coach workspace.
--
-- Additive, safe to run live.

alter table profiles
  add column if not exists coach_tier text;

-- Use a deferrable constraint via DO so re-running migration doesn't blow up
-- when the constraint already exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_coach_tier_check'
  ) then
    alter table profiles
      add constraint profiles_coach_tier_check
      check (coach_tier is null or coach_tier in ('coach', 'coach_pro'));
  end if;
end$$;

comment on column profiles.coach_tier is
  'Active coach subscription plan: ''coach'' ($29/mo) or ''coach_pro'' ($79/mo). NULL = no active coach subscription. Set by /api/stripe-webhook from session.metadata.plan; cleared on customer.subscription.deleted.';
