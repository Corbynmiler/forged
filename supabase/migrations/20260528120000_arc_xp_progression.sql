-- Arc XP progression (XP-1): separate proof-based Arc XP from lifetime profiles.xp.

alter table public.forge_blocks
  add column if not exists arc_xp integer not null default 0;

alter table public.forge_blocks
  add column if not exists completion_score numeric;

alter table public.forge_blocks
  add column if not exists arc_rank text;

comment on column public.forge_blocks.arc_xp is 'XP earned during this Arc from proof actions only; resets per Arc.';
comment on column public.forge_blocks.completion_score is 'Proof completion ratio 0–100 at Arc end or snapshot.';
comment on column public.forge_blocks.arc_rank is 'Arc rank label (Spark/Kindling/…) from proof completion.';

create table if not exists public.arc_daily_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  block_id uuid not null references public.forge_blocks(id) on delete cascade,
  date date not null,
  proof_total integer not null default 0,
  proof_done integer not null default 0,
  arc_xp_awarded integer not null default 0,
  perfect_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_id, date)
);

create index if not exists arc_daily_scores_block_date_idx
  on public.arc_daily_scores (block_id, date desc);

alter table public.arc_daily_scores enable row level security;

drop policy if exists "Own arc_daily_scores" on public.arc_daily_scores;
create policy "Own arc_daily_scores"
  on public.arc_daily_scores
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
