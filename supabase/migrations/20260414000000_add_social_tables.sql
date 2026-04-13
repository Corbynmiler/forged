-- Social: friendships, shared goals + members, and profiles.username lookup
-- New tables only; profiles gets an additive nullable column + partial unique index.

-- ─── profiles.username (nullable unique, for discovery) ─────────────────────
alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_key
  on public.profiles (username)
  where username is not null;

-- ─── friendships ─────────────────────────────────────────────────────────────
create table if not exists public.friendships (
  id             uuid        primary key default gen_random_uuid(),
  requester_id   uuid        not null references auth.users (id) on delete cascade,
  addressee_id   uuid        not null references auth.users (id) on delete cascade,
  status         text        not null default 'pending',
  created_at     timestamptz not null default now(),
  constraint friendships_status_check
    check (status in ('pending', 'accepted', 'declined')),
  constraint friendships_requester_addressee_unique
    unique (requester_id, addressee_id)
);

alter table public.friendships enable row level security;

create policy "friendships_select_participants"
  on public.friendships
  for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "friendships_insert_as_requester"
  on public.friendships
  for insert
  to authenticated
  with check (auth.uid() = requester_id);

create policy "friendships_update_by_addressee"
  on public.friendships
  for update
  to authenticated
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

create policy "friendships_delete_participants"
  on public.friendships
  for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ─── shared_goals (RLS policies after shared_goal_members exists) ────────────
create table if not exists public.shared_goals (
  id              uuid        primary key default gen_random_uuid(),
  creator_id      uuid        not null references auth.users (id) on delete cascade,
  name            text        not null,
  emoji           text        not null default '🎯',
  habit_type      text        not null default 'daily',
  weekly_target   integer,
  target_date     date,
  color           text        not null default '#C0392B',
  invite_code     text        not null default substr(md5(random()::text), 1, 8),
  created_at      timestamptz not null default now(),
  constraint shared_goals_habit_type_check
    check (habit_type in ('daily', 'weekly', 'project'))
);

-- ─── shared_goal_members ─────────────────────────────────────────────────────
create table if not exists public.shared_goal_members (
  id              uuid        primary key default gen_random_uuid(),
  shared_goal_id  uuid        not null references public.shared_goals (id) on delete cascade,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  logs            jsonb       not null default '[]',
  joined_at       timestamptz not null default now(),
  constraint shared_goal_members_goal_user_unique
    unique (shared_goal_id, user_id)
);

alter table public.shared_goal_members enable row level security;

create policy "shared_goal_members_select_if_member"
  on public.shared_goal_members
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.shared_goal_members m
      where m.shared_goal_id = shared_goal_members.shared_goal_id
        and m.user_id = auth.uid()
    )
  );

create policy "shared_goal_members_insert_own_row"
  on public.shared_goal_members
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "shared_goal_members_update_own_row"
  on public.shared_goal_members
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "shared_goal_members_delete_own_row"
  on public.shared_goal_members
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- shared_goals RLS: members via join; INSERT for authenticated creators only.
-- Creator can always access their row (before first member row exists).
alter table public.shared_goals enable row level security;

create policy "shared_goals_select_creator_or_member"
  on public.shared_goals
  for select
  to authenticated
  using (
    auth.uid() = creator_id
    or exists (
      select 1
      from public.shared_goal_members m
      where m.shared_goal_id = shared_goals.id
        and m.user_id = auth.uid()
    )
  );

create policy "shared_goals_insert_authenticated_creator"
  on public.shared_goals
  for insert
  to authenticated
  with check (auth.uid() is not null and auth.uid() = creator_id);

create policy "shared_goals_update_creator_or_member"
  on public.shared_goals
  for update
  to authenticated
  using (
    auth.uid() = creator_id
    or exists (
      select 1
      from public.shared_goal_members m
      where m.shared_goal_id = shared_goals.id
        and m.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = creator_id
    or exists (
      select 1
      from public.shared_goal_members m
      where m.shared_goal_id = shared_goals.id
        and m.user_id = auth.uid()
    )
  );

create policy "shared_goals_delete_creator_or_member"
  on public.shared_goals
  for delete
  to authenticated
  using (
    auth.uid() = creator_id
    or exists (
      select 1
      from public.shared_goal_members m
      where m.shared_goal_id = shared_goals.id
        and m.user_id = auth.uid()
    )
  );
