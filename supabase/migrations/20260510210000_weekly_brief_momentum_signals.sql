-- Weekly brief momentum lines (JSON from AI), keyed like the quota row.

create table if not exists public.weekly_briefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  momentum_signals jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create index if not exists weekly_briefs_user_week_idx
  on public.weekly_briefs (user_id, week_start desc);

alter table public.weekly_briefs enable row level security;

drop policy if exists "weekly_briefs_select_own" on public.weekly_briefs;
create policy "weekly_briefs_select_own"
  on public.weekly_briefs for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "weekly_briefs_insert_own" on public.weekly_briefs;
create policy "weekly_briefs_insert_own"
  on public.weekly_briefs for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "weekly_briefs_update_own" on public.weekly_briefs;
create policy "weekly_briefs_update_own"
  on public.weekly_briefs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "weekly_briefs_delete_own" on public.weekly_briefs;
create policy "weekly_briefs_delete_own"
  on public.weekly_briefs for delete to authenticated
  using (auth.uid() = user_id);

comment on table public.weekly_briefs is
  'Per-user per-week momentum signal lines generated with the AI weekly brief.';
comment on column public.weekly_briefs.momentum_signals is
  'JSON array of { habit_name, signal } from weekly brief generation.';
