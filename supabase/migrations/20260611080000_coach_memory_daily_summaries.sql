-- Layered coach memory (redesign workstream B).
--
-- daily_summaries: one short structured summary per user per local day,
--   generated lazily (first coach message of a new day) or alongside the
--   evidence (journal) generation. Feeds the coach system prompt and the
--   weekly Review.
-- coach_memory: a single rolling personal-memory blob per user (~1,500 chars),
--   updated once per day by the same summarization call.

create table if not exists public.daily_summaries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  summary     text not null default '',
  structured  jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists daily_summaries_user_date_idx
  on public.daily_summaries (user_id, date desc);

alter table public.daily_summaries enable row level security;

drop policy if exists "Own daily_summaries" on public.daily_summaries;
create policy "Own daily_summaries"
  on public.daily_summaries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.coach_memory (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  content     text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.coach_memory enable row level security;

drop policy if exists "Own coach_memory" on public.coach_memory;
create policy "Own coach_memory"
  on public.coach_memory
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
