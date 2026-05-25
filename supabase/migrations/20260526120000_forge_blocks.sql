-- Forge Blocks — internal name for the user-facing "Arc" (8-week identity sprint).
-- Each row defines who the user said they're becoming, why it matters, the old pattern
-- they're trying to weaken, and the bare-minimum proof on bad days. Habits can be
-- linked to a block as "proof actions" via habits.block_id + habits.is_proof_action.
--
-- v1 fixes duration to 56 days client-side but the column supports 4/8/12/custom later.
-- Schema is additive: existing users with no block continue to function unchanged.

create table if not exists public.forge_blocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  identity      text not null,
  why_statement text,
  old_pattern   text,
  minimum_proof text,
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'active',
  duration_days integer not null default 56,
  review        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Fast lookup of the active block for a given user (one expected per user at a time).
create index if not exists forge_blocks_user_active_idx
  on public.forge_blocks (user_id) where status = 'active';

-- Status enum is enforced in code, not at the DB level, to avoid migration pain
-- if we add 'evolved' / 'abandoned' / 'paused' later. Keep a soft check for safety.
alter table public.forge_blocks
  drop constraint if exists forge_blocks_status_check;
alter table public.forge_blocks
  add constraint forge_blocks_status_check
  check (status in ('active','completed','abandoned','evolved','paused'));

alter table public.forge_blocks enable row level security;

drop policy if exists "Own forge_blocks" on public.forge_blocks;
create policy "Own forge_blocks"
  on public.forge_blocks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Link a habit to a forge block. Nullable so existing habits keep working.
alter table public.habits
  add column if not exists block_id uuid references public.forge_blocks(id) on delete set null;
create index if not exists habits_block_id_idx on public.habits (block_id);

-- Flag a habit as a "proof action" for its linked block. Defaults false so
-- legacy habits don't appear in the new Today proof-action section.
alter table public.habits
  add column if not exists is_proof_action boolean not null default false;

comment on table  public.forge_blocks                is 'User-facing "Arc" — an 8-week identity sprint. One active per user at a time (enforced in code).';
comment on column public.forge_blocks.identity       is 'Who the user said they are becoming (free text, max ~250 chars).';
comment on column public.forge_blocks.why_statement  is 'Why this matters to them right now.';
comment on column public.forge_blocks.old_pattern    is 'The pattern they are trying to weaken.';
comment on column public.forge_blocks.minimum_proof  is 'Bare-minimum proof on bad days. Surfaced when the user has nothing done late in the day.';
comment on column public.forge_blocks.duration_days  is 'Length of the arc. v1 always inserts 56; column kept so 4/8/12/custom are possible later.';
comment on column public.habits.block_id             is 'Optional link to the forge_block (Arc) this habit proves.';
comment on column public.habits.is_proof_action      is 'True when this habit is a "proof action" for its linked block.';
