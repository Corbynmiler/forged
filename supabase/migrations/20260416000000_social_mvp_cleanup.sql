-- MVP social cleanup: privacy flag, username lookup, creator-only shared goal delete

-- ─── profiles: visible to friends of friends (default off) ─────────────────
alter table public.profiles
  add column if not exists visible_to_friends_of_friends boolean not null default false;

-- ─── find_user_by_username (same security-definer pattern as email RPC) ─────
create or replace function public.find_user_by_username(p_username text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.username is not null
    and length(trim(p_username)) >= 1
    and lower(p.username) = lower(trim(p_username))
  limit 1;
$$;

grant execute on function public.find_user_by_username(text) to authenticated;

-- ─── shared_goals: only creator may delete (members keep "leave" via member row delete later) ─
drop policy if exists "shared_goals_delete_creator_or_member" on public.shared_goals;

create policy "shared_goals_delete_creator_only"
  on public.shared_goals
  for delete
  to authenticated
  using (auth.uid() = creator_id);
