-- Spoken coach replies (ElevenLabs TTS, Pro-only).
--
-- tts_usage: per-user per-calendar-month character counter so server-side
--   caps keep TTS cost bounded. month is 'YYYY-MM' from the user's local
--   client_date, same convention as chat_usage.
-- profiles: voice preference columns. voice_replies_enabled defaults to
--   false — spoken replies are strictly opt-in.

create table if not exists public.tts_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  month       text not null,
  chars_used  integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.tts_usage enable row level security;

drop policy if exists "Own tts_usage" on public.tts_usage;
create policy "Own tts_usage"
  on public.tts_usage
  for select
  using (auth.uid() = user_id);
-- Writes happen via the service role in api/tts.js only.

alter table public.profiles
  add column if not exists coach_voice_id text,
  add column if not exists voice_replies_enabled boolean not null default false;
