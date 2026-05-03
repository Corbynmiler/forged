-- Coach ↔ client linkage. A profile can be assigned to one coach (the coach
-- who invited them), and is_coach=true profiles can pull the list of their
-- own clients via /api/coach-data.
--
-- - coach_id is a soft pointer to auth.users(id). Nullable: most users have
--   no coach.
-- - on delete set null so deleting a coach account doesn't cascade-delete
--   their clients (we just unlink them).
-- - index on coach_id because the coach client-list query filters on it.
--
-- Additive and safe to run live.

alter table profiles
  add column if not exists coach_id uuid references auth.users(id) on delete set null;

create index if not exists profiles_coach_id_idx
  on profiles(coach_id)
  where coach_id is not null;

comment on column profiles.coach_id is
  'Optional FK to auth.users(id). Set when a user signs up via a coach invite link. The owning coach pulls this user via /api/coach-data filtered on coach_id = caller.id.';
