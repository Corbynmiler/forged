-- Product email list: onboarding "Get Forged weekly updates by email" + Pro thank-you checkbox.
-- Export addresses in SQL Editor (auth is not shown in Table Editor for profiles alone):
--
--   select u.email,
--          p.weekly_updates_email_opt_in,
--          p.weekly_updates_email_opt_in_at
--   from public.profiles p
--   join auth.users u on u.id = p.id
--   where p.weekly_updates_email_opt_in = true
--   order by p.weekly_updates_email_opt_in_at desc nulls last;

alter table public.profiles
  add column if not exists weekly_updates_email_opt_in boolean not null default false;

alter table public.profiles
  add column if not exists weekly_updates_email_opt_in_at timestamptz;

comment on column public.profiles.weekly_updates_email_opt_in is
  'User opted in to Forged weekly product/update emails.';

comment on column public.profiles.weekly_updates_email_opt_in_at is
  'Timestamp when opt-in was last set to true (null if never or after opt-out).';

create index if not exists profiles_weekly_updates_email_opt_in_true_idx
  on public.profiles (weekly_updates_email_opt_in)
  where weekly_updates_email_opt_in = true;
