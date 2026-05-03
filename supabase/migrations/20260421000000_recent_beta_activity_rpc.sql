-- Recent public beta activity for the Social-screen ticker.
-- Returns a small, de-identified snapshot of the most-recent habit logs across
-- beta users (first-name only, no last name, no email). Runs as security
-- definer so callers can see the aggregate without breaking per-row RLS on
-- habits/profiles. If this migration isn't applied, the frontend silently
-- renders no ticker.

create or replace function public.recent_beta_activity(p_limit int default 3)
returns table(
  user_id uuid,
  first_name text,
  habit_name text,
  emoji text,
  habit_type text,
  streak int,
  log_date date
)
language sql
security definer
set search_path = public
as $$
  with elements as (
    select
      h.user_id,
      coalesce(nullif(split_part(p.name, ' ', 1), ''), p.username, 'Someone') as first_name,
      h.name as habit_name,
      coalesce(h.emoji, '') as emoji,
      h.habit_type as habit_type,
      coalesce(p.current_streak, 0) as streak,
      (log_elem ->> 'date')::date as log_date
    from public.habits h
    join public.profiles p on p.id = h.user_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(h.logs) = 'array' then h.logs else '[]'::jsonb end
    ) as log_elem
    where (log_elem ->> 'date') is not null
      and (log_elem ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
      and (log_elem ->> 'date')::date >= (current_date - interval '3 days')::date
      and coalesce(p.xp, 0) > 0
  ),
  ranked as (
    select distinct on (user_id, habit_name)
      user_id, first_name, habit_name, emoji, habit_type, streak, log_date
    from elements
    order by user_id, habit_name, log_date desc
  )
  select user_id, first_name, habit_name, emoji, habit_type, streak, log_date
  from ranked
  order by log_date desc, random()
  limit greatest(coalesce(p_limit, 3), 1);
$$;

revoke all on function public.recent_beta_activity(int) from public;
grant execute on function public.recent_beta_activity(int) to authenticated, anon;
