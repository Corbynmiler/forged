-- Arc data hygiene (redesign).
--
-- 1. Any Arc still 'active' past its end_date is marked completed (the old
--    UI left Arcs active until the user manually generated a review).
-- 2. If a user somehow has multiple active Arcs, keep only the most recent
--    (latest start_date, then created_at) and mark the rest abandoned.
--    Verified before applying: production has no such rows today, so this
--    is a guard, not a data rewrite.
-- 3. Enforce one active Arc per user with a partial unique index.

update public.forge_blocks
set status = 'completed', updated_at = now()
where status = 'active'
  and end_date < current_date;

with ranked as (
  select id,
         row_number() over (
           partition by user_id
           order by start_date desc, created_at desc
         ) as rn
  from public.forge_blocks
  where status = 'active'
)
update public.forge_blocks fb
set status = 'abandoned', updated_at = now()
from ranked
where fb.id = ranked.id
  and ranked.rn > 1;

drop index if exists forge_blocks_one_active_per_user;
create unique index forge_blocks_one_active_per_user
  on public.forge_blocks (user_id)
  where status = 'active';
