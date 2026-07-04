-- Preview branch — memory layer (Phase 3).
--
-- NOT YET APPLIED. Staged here instead of supabase/migrations/ because that
-- path is protected by this repo's guardrail (schema changes require
-- explicit human sign-off before an agent can create/modify a real
-- migration). To apply: review this file, then either
--   (a) move/rename it into supabase/migrations/ with a fresh timestamp
--       prefix matching this repo's existing convention and run it the
--       normal way this project runs migrations, or
--   (b) paste it into the Supabase SQL editor / run it via the Supabase CLI
--       directly against the project.
--
-- api/memory-rollover.js has already been updated to write to the new
-- columns/table added here, but every new write is wrapped so it fails
-- quietly (logged, not thrown) until this migration is applied — the
-- existing daily_summaries.summary/structured and coach_memory writes that
-- are already in production keep working regardless of whether this has
-- been run yet. See PREVIEW_BRANCH_HANDOFF.md for the full picture.

create extension if not exists vector;

-- Atomic, durable, individually-taggable memories extracted from daily
-- conversations. Distinct from coach_memory (one rolling prose blob per
-- user) and daily_summaries (one row per day) — this is the semantic layer:
-- many small facts per user, meant to eventually be retrieved by similarity
-- instead of keyword ILIKE (the `recall` tool in api/chat.js still does
-- keyword search for now — api/chat.js is itself a protected file, so
-- swapping its retrieval logic to use this table needs the same kind of
-- sign-off as this migration, and is intentionally deferred).
create table if not exists public.memory_facts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  kind               text not null check (kind in ('fact','commitment','preference','project','person','event','emotional_pattern')),
  content            text not null,
  -- 384 dims matches a small/cheap embedding model (e.g. Supabase's built-in
  -- gte-small via an Edge Function, or a similarly-sized model). Left NULL
  -- until an embedding pipeline is chosen and wired up — safe to change via
  -- `alter table public.memory_facts alter column embedding type vector(N)`
  -- for a different model's dimension as long as this is still empty.
  embedding          vector(384),
  importance         smallint not null default 3 check (importance between 1 and 5),
  status             text not null default 'active' check (status in ('active','resolved','archived')),
  source_day         date,
  first_seen_at      timestamptz not null default now(),
  last_referenced_at timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists memory_facts_user_status_idx
  on public.memory_facts (user_id, status);

-- Harmless to create ahead of data — ivfflat's `lists` planning improves
-- once real rows exist; cosine ops matches the similarity search a future
-- retrieval swap will use.
create index if not exists memory_facts_embedding_idx
  on public.memory_facts using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.memory_facts enable row level security;

drop policy if exists "Own memory_facts" on public.memory_facts;
create policy "Own memory_facts"
  on public.memory_facts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Note: api/memory-rollover.js writes via the service-role key, which
-- bypasses RLS entirely — same pattern as every other service-role write in
-- this codebase. These policies only govern direct client-side access.

-- Extend the existing daily_summaries table (created in
-- 20260611080000_coach_memory_daily_summaries.sql) with first-class daily
-- structure. Additive and nullable — no backfill needed, and no existing
-- behavior changes until memory-rollover.js's writes to these columns
-- start succeeding (i.e. once this migration has been applied).
alter table public.daily_summaries add column if not exists title text;
alter table public.daily_summaries add column if not exists commitments jsonb not null default '[]'::jsonb;
alter table public.daily_summaries add column if not exists emotional_context text;
-- xp_awarded / xp_reason are added now (schema-only) so Phase 4's AI-judged
-- XP work won't need a second migration. Not populated by Phase 3 — left
-- NULL until Phase 4 ships the nightly XP-judgment logic.
alter table public.daily_summaries add column if not exists xp_awarded int;
alter table public.daily_summaries add column if not exists xp_reason text;
