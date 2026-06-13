-- Demo seed: Molly account — safe to re-run
begin;

do $guard$
begin
  if not exists (select 1 from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com')) then
    raise exception 'No auth.users row for %', 'cheesefingersathotmail.co.n@gmail.com';
  end if;
end $guard$;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
update public.profiles p
set name = 'Molly', coach_name = 'Arlo', is_pro = true, onboarded = true, updated_at = now()
from demo_user u where p.id = u.user_id;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1) delete from public.habits where user_id = (select user_id from demo_user);
with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1) delete from public.journal_entries where user_id = (select user_id from demo_user);
with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1) delete from public.forge_blocks where user_id = (select user_id from demo_user);
with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1) delete from public.weekly_brief_generation_usage where user_id = (select user_id from demo_user);
with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1) delete from public.coach_memory where user_id = (select user_id from demo_user);

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.forge_blocks
  (id, user_id, title, identity, why_statement, old_pattern, minimum_proof, start_date, end_date, status, duration_days, arc_xp, completion_score, arc_rank, created_at, updated_at)
select
  'a0600001-0001-4001-8001-000000000001'::uuid,
  (select user_id from demo_user),
  'Build the System',
  'The person who ships proof, not promises',
  'Because I''ve been ''almost ready'' for two years. This time I''m building evidence instead of waiting for motivation.',
  'Planning without shipping. Starting without finishing. Telling myself I need more preparation.',
  'One focused deep work session. Show up even when it feels mechanical.',
  '2026-05-24'::date,
  '2026-07-04'::date,
  'active', 42, 490, 75, 'Hardened',
  now(), now()
on conflict (id) do update set
  title = excluded.title, identity = excluded.identity,
  why_statement = excluded.why_statement, old_pattern = excluded.old_pattern,
  minimum_proof = excluded.minimum_proof, start_date = excluded.start_date,
  end_date = excluded.end_date, status = excluded.status,
  arc_xp = excluded.arc_xp, completion_score = excluded.completion_score,
  arc_rank = excluded.arc_rank, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.habits (id, user_id, name, emoji, habit_type, color, block_id, is_proof_action, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select
  'a0600001-0001-4001-8001-000000000011'::uuid, (select user_id from demo_user),
  'Deep work session', '🎯', 'daily', '#2980B9',
  'a0600001-0001-4001-8001-000000000001'::uuid, true,
  '[{"date":"2026-06-06","value":true,"note":"65 min, flow midway through"},{"date":"2026-06-07","value":true,"note":"85 min — best session this arc"},{"date":"2026-06-08","value":true,"note":"60 min, meetings cut in but got it done"},{"date":"2026-06-09","value":true,"note":"55 min, slower day"},{"date":"2026-06-10","value":true,"note":"80 min, real flow state"},{"date":"2026-06-11","value":true,"note":"70 min"},{"date":"2026-06-12","value":true,"note":"75 min, closed a loop I''d been avoiding"}]'::jsonb, 7, 12,
  true, '',
  null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, color = excluded.color,
  block_id = excluded.block_id, is_proof_action = excluded.is_proof_action,
  logs = excluded.logs, streak = excluded.streak, best_streak = excluded.best_streak,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.habits (id, user_id, name, emoji, habit_type, color, block_id, is_proof_action, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select
  'a0600001-0001-4001-8001-000000000012'::uuid, (select user_id from demo_user),
  'Move daily', '🏃', 'daily', '#27AE60',
  'a0600001-0001-4001-8001-000000000001'::uuid, true,
  '[{"date":"2026-06-06","value":true,"note":"4km run"},{"date":"2026-06-07","value":true,"note":"6km — furthest this arc"},{"date":"2026-06-09","value":true,"note":"4km"},{"date":"2026-06-10","value":true,"note":"5km run"},{"date":"2026-06-11","value":true,"note":"short loop"},{"date":"2026-06-12","value":true,"note":"4km"}]'::jsonb, 4, 8,
  true, '',
  null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, color = excluded.color,
  block_id = excluded.block_id, is_proof_action = excluded.is_proof_action,
  logs = excluded.logs, streak = excluded.streak, best_streak = excluded.best_streak,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.habits (id, user_id, name, emoji, habit_type, color, block_id, is_proof_action, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select
  'a0600001-0001-4001-8001-000000000013'::uuid, (select user_id from demo_user),
  'No doom scroll before 9am', '📵', 'daily', '#E67E22',
  'a0600001-0001-4001-8001-000000000001'::uuid, true,
  '[{"date":"2026-06-06","value":true,"note":""},{"date":"2026-06-07","value":true,"note":""},{"date":"2026-06-08","value":true,"note":""},{"date":"2026-06-09","value":true,"note":""},{"date":"2026-06-10","value":true,"note":""},{"date":"2026-06-11","value":true,"note":""},{"date":"2026-06-12","value":true,"note":""}]'::jsonb, 7, 7,
  true, '',
  null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, color = excluded.color,
  block_id = excluded.block_id, is_proof_action = excluded.is_proof_action,
  logs = excluded.logs, streak = excluded.streak, best_streak = excluded.best_streak,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.habits (id, user_id, name, emoji, habit_type, color, block_id, is_proof_action, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select
  'a0600001-0001-4001-8001-000000000014'::uuid, (select user_id from demo_user),
  'Post one useful thing', '📤', 'daily', '#9B59B6',
  'a0600001-0001-4001-8001-000000000001'::uuid, true,
  '[{"date":"2026-06-07","value":true,"note":"posted a breakdown on product thinking — 3 DMs"},{"date":"2026-06-08","value":true,"note":"shared rough mental model, got replies"},{"date":"2026-06-12","value":true,"note":"published something rough, it worked"}]'::jsonb, 1, 3,
  true, '',
  null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, color = excluded.color,
  block_id = excluded.block_id, is_proof_action = excluded.is_proof_action,
  logs = excluded.logs, streak = excluded.streak, best_streak = excluded.best_streak,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.habits (id, user_id, name, emoji, habit_type, color, block_id, is_proof_action, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select
  'a0600001-0001-4001-8001-000000000015'::uuid, (select user_id from demo_user),
  'Evening check-in', '🌙', 'daily', '#1ABC9C',
  'a0600001-0001-4001-8001-000000000001'::uuid, true,
  '[{"date":"2026-06-06","value":true,"note":""},{"date":"2026-06-07","value":true,"note":""},{"date":"2026-06-08","value":true,"note":""},{"date":"2026-06-09","value":true,"note":""},{"date":"2026-06-10","value":true,"note":""},{"date":"2026-06-12","value":true,"note":""}]'::jsonb, 1, 6,
  true, '',
  null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, color = excluded.color,
  block_id = excluded.block_id, is_proof_action = excluded.is_proof_action,
  logs = excluded.logs, streak = excluded.streak, best_streak = excluded.best_streak,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-05-24'::date, 5, 3, 18, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-05-25'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-05-26'::date, 5, 5, 40, true, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-05-27'::date, 5, 3, 18, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-05-28'::date, 5, 2, 12, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-05-29'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-05-30'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-05-31'::date, 5, 5, 40, true, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-01'::date, 5, 3, 18, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-02'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-03'::date, 5, 1, 6, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-04'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-05'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-06'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-07'::date, 5, 5, 40, true, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-08'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-09'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-10'::date, 5, 4, 24, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-11'::date, 5, 3, 18, false, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), 'a0600001-0001-4001-8001-000000000001'::uuid,
  '2026-06-12'::date, 5, 5, 40, true, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-05-24'::date, 'Starting this today. Build the System. 42 days to actually show up for the thing I keep saying I''ll do. Committing it here feels real in a way the notes app doesn''t. That''s probably the point.', false, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-05-25'::date, 'Deep work session before checking my phone. First time I''ve done that in months. Did the move thing at lunch. Two days in and I''m already overthinking whether I''m doing it right — but I''m doing it.', false, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-05-27'::date, 'Deep work was hard today. Kept wanting to check Slack. Actually logged it anyway even though it felt half-hearted. That might be the whole point.', false, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-05-28'::date, 'Rough one. Family thing, tired, didn''t get the morning session in properly. 2 out of 5. Yesterday me would have logged nothing and told myself I''d restart Monday.', false, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-05-30'::date, 'Proof shown: Deep work (68 min), run 2.4km, no phone before 9:15am, posted a thread on building in public, evening log done.

Wins: The run felt genuinely good after skipping Wednesday. The post got more traction than expected — reminder that shipping creates surface area.

Hard parts: Focus during deep work wasn''t clean. Kept gravitating to email. Set a 25-min timer which helped more than expected.

Pattern: The morning deep work sets the tone for the whole day. When I skip it I feel behind all afternoon.

Tomorrow: Start the deep work block before making coffee. Phone stays in another room until 9am.', true, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-05-31'::date, 'Proof shown: Deep work (90 min), 5km run, no doom scroll until 9:30am, posted two useful things, evening check-in complete. First 5/5 day.

Wins: Stringing all five together felt different. Not just completing items — actually building something that resembles a system.

Hard parts: Evening check-in nearly missed — had dinner plans and almost called it. Opened the app at 11pm and logged anyway.

Pattern: Perfect days feel possible when I don''t negotiate with myself in the morning.

Tomorrow: Keep the morning sequence tight. See if I can repeat.', true, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-01'::date, 'Tired after a solid week. 3/5 but they were the right 3 — deep work, move, evening. Skipped posting and let myself off the doom scroll thing in the morning. Still counts as showing up.', false, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-03'::date, 'Worst day so far. Work blew up, barely got 1 habit in (just the check-in). Felt like watching the streak die in slow motion. But I didn''t delete the app. That''s the floor and I''m standing on it.', false, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-04'::date, 'Proof shown: Deep work (45 min), short walk ✓, no doom scroll ✓, evening check-in ✓. Back to 4/5.

Wins: Bounced back. One bad day didn''t become two. That''s new.

Hard parts: Yesterday still feels present. The work blowup is unresolved. Hard to concentrate with ambient stress.

Pattern: Bad days don''t undo the system. The system is specifically for the days when motivation is gone.

Tomorrow: Short morning check-in to surface whatever''s blocking before it becomes ambient noise.', true, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-05'::date, 'Proof shown: Deep work (72 min), run 5km ✓, no doom scroll ✓, posted one useful breakdown on product thinking, evening log done.

Wins: The post landed — 3 DMs asking follow-up questions. That''s the proof. Shipping creates surface area.

Hard parts: Almost talked myself out of the post. "Not ready, needs polish." Published it rough and it worked fine.

Pattern: "Not ready" is the old pattern. Posting is the proof action. The post IS the work.

Tomorrow: Follow up on the DMs. They''re signal.', true, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-07'::date, 'Proof shown: Deep work (85 min), 6km run, phone-free until 9am, posted one useful breakdown, evening reflection. 5/5. Third perfect day.

Wins: Ran the furthest I have in months without planning to — just felt like it. That''s compounding. The physical system catching up with the mental one.

Hard parts: Had to cancel a dinner to keep the morning clean. Felt bad for an hour. Fine after.

Pattern: I''m protecting the morning like it means something now. Because it does.

Tomorrow: Week 3 starts. Don''t let the momentum become pressure. Same actions, different week.', true, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-08'::date, 'Proof shown: Deep work (60 min), moved ✓, no doom scroll ✓, posted (rough mental model), evening check-in ✓. 4/5.

Wins: Week 2 complete. Looked back at the timeline for the first time. More green than I expected.

Hard parts: Deep work felt mechanical today. Not inspired, just executing. Fine, but noticeable.

Pattern: Not every day needs to be a highlight. Most days are just days. The system runs anyway.

Tomorrow: Find something actually worth posting. Even a rough idea counts.', true, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-10'::date, 'Proof shown: Deep work (80 min), run 4km ✓, no doom scroll ✓, evening check-in ✓. 4/5. (Missed the post again.)

Wins: Best deep work session in two weeks — 80 minutes felt like 30. Flow state showing up more consistently.

Hard parts: Posting is becoming my weak spot. Need to rethink how I''m generating output worth sharing.

Pattern: Deep work is building well. But deep work without visible output is just spinning. Need to close more loops publicly.

Tomorrow: Whatever comes out of deep work tomorrow goes out that day. Rough draft is fine.', true, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-11'::date, '3/5 again. Starting to notice I do deep work, move, and check-in on autopilot now — but consistently miss the post and sometimes doom scroll in the morning. That asymmetry is interesting. Will ask Arlo about it.', false, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), '2026-06-12'::date, 'Proof shown: Deep work (75 min), run 4km ✓, no doom scroll ✓, posted (mental model thread — got replies), evening check-in ✓. 5/5. Fourth perfect day.

Wins: Published the thing I''ve been sitting on. Three people replied with their own version of the same problem. That''s what posting is for.

Hard parts: Still wrestling with the gap between doing the work and showing the work. They''re not the same muscle but they need each other.

Pattern: The system is working. But a system without an output valve just accumulates. Shipping is part of the proof, not extra credit.

Tomorrow: Tomorrow is Day 21. That felt very far away on Day 1.', true, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.weekly_brief_generation_usage (user_id, week_start, generation_count, brief_text, brief_generated_at, updated_at)
select (select user_id from demo_user), '2026-05-25'::date, 1, 'Week 1 of Build the System is in. Molly held a 71% proof rate across 7 days — including her first perfect day on Saturday. She hit the deep work session on 6 of 7 days and ran more than she has in months. The real signal this week: she showed up on Wednesday with 2/5 instead of abandoning the arc entirely. That floor-holding is new. The morning sequence is forming. The system has a heartbeat.', now(), now()
on conflict (user_id, week_start) do update set
  generation_count = excluded.generation_count, brief_text = excluded.brief_text,
  brief_generated_at = excluded.brief_generated_at, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.weekly_brief_generation_usage (user_id, week_start, generation_count, brief_text, brief_generated_at, updated_at)
select (select user_id from demo_user), '2026-06-01'::date, 1, 'Week 2 complete. Proof rate: 69% — including a bad day on arc day 11 (1/5, work emergency) and a clean bounce back the next morning. That recovery pattern is the clearest proof in the arc so far. Week 2 also had a second perfect day (arc day 15). Deep work is now Molly''s most reliable habit — 6 of 7 days and the sessions are getting longer. Posting publicly is the consistent gap: she''s shipping less than her other proof actions. The system is real. The output valve needs work.', now(), now()
on conflict (user_id, week_start) do update set
  generation_count = excluded.generation_count, brief_text = excluded.brief_text,
  brief_generated_at = excluded.brief_generated_at, updated_at = excluded.updated_at;

with demo_user as (select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1)
insert into public.coach_memory (user_id, content, updated_at)
select (select user_id from demo_user), 'Molly is 20 days into "Build the System" — a 42-day arc around actually shipping proof instead of staying in preparation mode. She''s in the Hardened rank at 75% proof completion with four perfect days. Deep work and daily movement are her strongest habits — both near-automatic in the morning now. No doom scroll before 9am is holding well (7-day streak). Posting one useful thing publicly is her consistent weak spot: she cites "not ready" and delays, which is exactly the old pattern she''s trying to break. She flagged this herself on arc day 19 and said she''d bring it up. The bounce-back pattern is genuinely strong — she doesn''t spiral after bad days anymore. She''s protecting her morning like it matters. 22 days left.', now()
on conflict (user_id) do update set content = excluded.content, updated_at = excluded.updated_at;

commit;