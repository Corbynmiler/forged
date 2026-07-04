-- Preview branch — AI-judged XP audit log (Phase 4).
--
-- NOT YET APPLIED. Staged here for the same reason as
-- 20260704120000_pgvector_memory_facts.sql: supabase/migrations/ is
-- protected, and this table needs a human to review and apply it (or move
-- it into supabase/migrations/ with a fresh timestamp) before it exists
-- anywhere.
--
-- api/memory-rollover.js already writes to this table, wrapped so the
-- write fails quietly (logged, not thrown) until it exists — nothing else
-- in this job depends on it.
--
-- IMPORTANT — this table is deliberately NOT wired into profiles.xp (the
-- live, user-facing lifetime XP total). profiles.xp already has a separate,
-- deterministic per-habit-tap XP path (lifetimeXpForHabitLog in
-- src/arcProgress.js) — writing the AI-judged amount into profiles.xp too
-- would double-count every day. xp_events is an audit/observation log only
-- until a human decides how the two XP systems should reconcile. See
-- PREVIEW_BRANCH_HANDOFF.md.

create table if not exists public.xp_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_date date not null,
  amount     int not null check (amount >= 0),
  reason     text,
  source     text not null default 'ai_daily_rollover',
  created_at timestamptz not null default now()
);

create index if not exists xp_events_user_date_idx
  on public.xp_events (user_id, event_date desc);

alter table public.xp_events enable row level security;

drop policy if exists "Own xp_events" on public.xp_events;
create policy "Own xp_events"
  on public.xp_events
  for select
  using (auth.uid() = user_id);
-- Read-only for the client on purpose — this is an audit trail written by
-- the service-role rollover job, not something the client should be able to
-- insert/update/delete directly.
