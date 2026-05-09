-- In-app AI coach label (Profile → AI coach). Client reads/writes profiles.coach_name.
alter table public.profiles add column if not exists coach_name text;

comment on column public.profiles.coach_name is
  'Display name for the AI coach (user-editable in Profile).';
