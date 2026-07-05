-- Preview branch — memory architecture foundation (Phase 2a).
--
-- NOT YET APPLIED. Staged here for the same reason as the two prior
-- pending migrations (memory_facts/xp_events): supabase/migrations/ is
-- protected, and this table needs a human to review and apply it (or move
-- it into supabase/migrations/ with a fresh timestamp) before it exists
-- anywhere.
--
-- ADDITIVE ONLY. This creates one new table and touches nothing else —
-- no existing table, column, row, or policy is altered. Preview and
-- production/main currently share this database; main's deployed code
-- never references this table, so main's behavior is unaffected whether
-- or not this migration is applied. Real data only ever gets written when
-- an account actually uses the (preview-only) Companion screen.
--
-- WHY THIS TABLE: every prior round of this branch's XP/facts/greeting
-- work has been extracting from curated notes and habit logs, never the
-- actual words of a conversation — because nothing durable persisted them
-- server-side (only a rolling localStorage window on the client, capped to
-- the current day). This table is the raw ground-truth layer: one row per
-- turn, written live as the conversation happens. It is the prerequisite
-- for two things neither of which are wired up yet:
--   1. api/memory-rollover.js reading real conversation content instead of
--      only curated notes — the actual fix for "judge from context, not
--      checklists" (still TODO — this migration only adds the table and
--      wires up the write side in src/screens/CompanionScreen.jsx).
--   2. A future retrieval step (embeddings + similarity search — vendor
--      still undecided) that can answer things like "you changed your
--      opinion on this since April" from something real, instead of
--      whatever survives in the small rolling summary window.
--
-- Deliberately NOT given a vector/embedding column. Per the memory
-- architecture design in PREVIEW_BRANCH_HANDOFF.md, only the compressed,
-- durable memory_facts layer gets embedded for long-term semantic search —
-- this table is a recency-bounded window the rollover job reads from, not
-- something queried directly by similarity at reply-time. Keeps embedding
-- cost/complexity bounded instead of vector-indexing an entire raw
-- transcript of someone's life.
create table if not exists public.conversation_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  -- Which conversation "situation" (Just chat/Build/Think/Decide/Reflect)
  -- was active for this turn — nullable since older rows (if any ever
  -- exist before this column mattered) and non-companion callers won't
  -- have one. Useful context for the rollover job, not load-bearing.
  situation  text,
  created_at timestamptz not null default now()
);

-- The rollover job's access pattern is "give me this user's turns for a
-- given day/date range" — matches memory_facts' (user_id, status) index
-- shape, adapted to this table's actual query pattern.
create index if not exists conversation_messages_user_day_idx
  on public.conversation_messages (user_id, day);

alter table public.conversation_messages enable row level security;

-- Client writes directly from src/screens/CompanionScreen.jsx (same trust
-- model as the existing memory_facts client-side insert from onboarding's
-- ChatGPT import) — no dedicated server route needed for the write itself.
-- "for all" mirrors the memory_facts policy shape for consistency with the
-- rest of this branch's migrations; in practice the client only ever
-- inserts and (potentially, later) selects its own rows.
drop policy if exists "Own conversation_messages" on public.conversation_messages;
create policy "Own conversation_messages"
  on public.conversation_messages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Note: a future server-side reader (api/memory-rollover.js) would use the
-- service-role key, which bypasses RLS entirely — same pattern as every
-- other service-role read/write in this codebase. Not wired up yet; this
-- migration only adds the table and the client-side write path.
