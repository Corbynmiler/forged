-- Idempotent repair for databases that never applied older migrations.
-- Profile tab reads/writes these columns; missing columns cause PGRST204 / 42703 on save.

alter table public.profiles
  add column if not exists visible_to_friends_of_friends boolean not null default false;

alter table public.profiles
  add column if not exists coach_name text;

alter table public.profiles
  add column if not exists coach_icon text;

comment on column public.profiles.visible_to_friends_of_friends is
  'When true, profile may be discoverable to friends-of-friends (social privacy).';
