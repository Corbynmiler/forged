-- Demo seed: Client Test account
-- Resolves user_id from auth.users by email; safe to re-run.
begin;

do $guard$
begin
  if not exists (select 1 from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com')) then
    raise exception 'No auth.users row for email %', 'cheesefingersathotmail.co.n@gmail.com';
  end if;
end $guard$;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
update public.profiles p
set
  name = 'Client Test',
  onboarded = true,
  xp = 380,
  updated_at = now()
from demo_user u
where p.id = u.user_id;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.habits (id, user_id, name, emoji, habit_type, color, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select 'b1e00001-0001-4001-8001-000000000001'::uuid, (select user_id from demo_user), 'Walk / move', '🚶', 'daily', '#27AE60', '[{"date":"2026-04-20","value":true,"note":"like 12 min. legs felt heavy lol"},{"date":"2026-04-22","value":true,"note":""},{"date":"2026-04-23","value":"skip","note":"rain + lazy combo"},{"date":"2026-04-24","value":true,"note":"","reflection":"noticed when i walk first i dont demolish the pantry after"},{"date":"2026-04-26","value":true,"note":"20 min around the block"},{"date":"2026-04-27","value":true,"note":""},{"date":"2026-04-28","value":true,"note":"park loop"},{"date":"2026-04-30","value":true,"note":""},{"date":"2026-05-01","value":true,"note":"before work. actually helped"},{"date":"2026-05-02","value":true,"note":""},{"date":"2026-05-03","value":true,"note":"short one but i showed up"}]'::jsonb, 4, 4, true, '', null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  emoji = excluded.emoji,
  habit_type = excluded.habit_type,
  color = excluded.color,
  logs = excluded.logs,
  streak = excluded.streak,
  best_streak = excluded.best_streak,
  reflection = excluded.reflection,
  reflection_prompt = excluded.reflection_prompt,
  weekly_target = excluded.weekly_target,
  start_value = excluded.start_value,
  target_value = excluded.target_value,
  unit = excluded.unit,
  daily_budget = excluded.daily_budget,
  tap_increment = excluded.tap_increment,
  daily_target_minutes = excluded.daily_target_minutes,
  shared_goal_id = excluded.shared_goal_id,
  goal_status = excluded.goal_status,
  target_date = excluded.target_date,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.habits (id, user_id, name, emoji, habit_type, color, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select 'b1e00001-0001-4001-8001-000000000002'::uuid, (select user_id from demo_user), 'Water (2L-ish)', '💧', 'daily', '#3498DB', '[{"date":"2026-04-20","value":true,"note":""},{"date":"2026-04-22","value":true,"note":""},{"date":"2026-04-23","value":true,"note":""},{"date":"2026-04-25","value":true,"note":""},{"date":"2026-04-26","value":true,"note":""},{"date":"2026-04-27","value":true,"note":""},{"date":"2026-04-28","value":true,"note":""},{"date":"2026-04-29","value":true,"note":""},{"date":"2026-04-30","value":true,"note":""},{"date":"2026-05-02","value":true,"note":""},{"date":"2026-05-03","value":true,"note":""}]'::jsonb, 2, 7, false, '', null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  emoji = excluded.emoji,
  habit_type = excluded.habit_type,
  color = excluded.color,
  logs = excluded.logs,
  streak = excluded.streak,
  best_streak = excluded.best_streak,
  reflection = excluded.reflection,
  reflection_prompt = excluded.reflection_prompt,
  weekly_target = excluded.weekly_target,
  start_value = excluded.start_value,
  target_value = excluded.target_value,
  unit = excluded.unit,
  daily_budget = excluded.daily_budget,
  tap_increment = excluded.tap_increment,
  daily_target_minutes = excluded.daily_target_minutes,
  shared_goal_id = excluded.shared_goal_id,
  goal_status = excluded.goal_status,
  target_date = excluded.target_date,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.habits (id, user_id, name, emoji, habit_type, color, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select 'b1e00001-0001-4001-8001-000000000003'::uuid, (select user_id from demo_user), 'In bed by 11:30', '🌙', 'daily', '#9B59B6', '[{"date":"2026-04-21","value":true,"note":""},{"date":"2026-04-24","value":true,"note":"","reflection":"took melatonin at 10, slept deeper than usual"},{"date":"2026-04-26","value":true,"note":""},{"date":"2026-04-27","value":true,"note":""},{"date":"2026-04-28","value":true,"note":""},{"date":"2026-04-30","value":true,"note":""},{"date":"2026-05-01","value":true,"note":""},{"date":"2026-05-02","value":true,"note":""},{"date":"2026-05-03","value":true,"note":""}]'::jsonb, 3, 3, true, '', null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  emoji = excluded.emoji,
  habit_type = excluded.habit_type,
  color = excluded.color,
  logs = excluded.logs,
  streak = excluded.streak,
  best_streak = excluded.best_streak,
  reflection = excluded.reflection,
  reflection_prompt = excluded.reflection_prompt,
  weekly_target = excluded.weekly_target,
  start_value = excluded.start_value,
  target_value = excluded.target_value,
  unit = excluded.unit,
  daily_budget = excluded.daily_budget,
  tap_increment = excluded.tap_increment,
  daily_target_minutes = excluded.daily_target_minutes,
  shared_goal_id = excluded.shared_goal_id,
  goal_status = excluded.goal_status,
  target_date = excluded.target_date,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.habits (id, user_id, name, emoji, habit_type, color, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select 'b1e00001-0001-4001-8001-000000000004'::uuid, (select user_id from demo_user), 'Vape hits', '🚭', 'limit', '#E67E22', '[{"date":"2026-04-20","value":22,"note":"stress day at work"},{"date":"2026-04-21","value":18,"note":""},{"date":"2026-04-22","value":20,"note":""},{"date":"2026-04-23","value":14,"note":""},{"date":"2026-04-24","value":19,"note":""},{"date":"2026-04-25","value":17,"note":""},{"date":"2026-04-26","value":12,"note":""},{"date":"2026-04-27","value":11,"note":""},{"date":"2026-04-28","value":15,"note":""},{"date":"2026-04-29","value":10,"note":"wanted one after dinner, stopped at 10"},{"date":"2026-04-30","value":9,"note":""},{"date":"2026-05-01","value":13,"note":""},{"date":"2026-05-02","value":8,"note":""},{"date":"2026-05-03","value":7,"note":""}]'::jsonb, 2, 2, false, '', null, null, null, 'hits', 16, 1, null, null, null, null, now()
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  emoji = excluded.emoji,
  habit_type = excluded.habit_type,
  color = excluded.color,
  logs = excluded.logs,
  streak = excluded.streak,
  best_streak = excluded.best_streak,
  reflection = excluded.reflection,
  reflection_prompt = excluded.reflection_prompt,
  weekly_target = excluded.weekly_target,
  start_value = excluded.start_value,
  target_value = excluded.target_value,
  unit = excluded.unit,
  daily_budget = excluded.daily_budget,
  tap_increment = excluded.tap_increment,
  daily_target_minutes = excluded.daily_target_minutes,
  shared_goal_id = excluded.shared_goal_id,
  goal_status = excluded.goal_status,
  target_date = excluded.target_date,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.habits (id, user_id, name, emoji, habit_type, color, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select 'b1e00001-0001-4001-8001-000000000005'::uuid, (select user_id from demo_user), 'Junk / drive-thru', '🍟', 'limit', '#C0392B', '[{"date":"2026-04-20","value":3,"note":""},{"date":"2026-04-21","value":2,"note":""},{"date":"2026-04-22","value":4,"note":"friend ordered fries, i had a few"},{"date":"2026-04-23","value":1,"note":""},{"date":"2026-04-24","value":2,"note":""},{"date":"2026-04-25","value":2,"note":""},{"date":"2026-04-26","value":1,"note":""},{"date":"2026-04-27","value":1,"note":""},{"date":"2026-04-28","value":0,"note":"logged 0 — proud"},{"date":"2026-04-29","value":1,"note":""},{"date":"2026-04-30","value":1,"note":""},{"date":"2026-05-01","value":2,"note":""},{"date":"2026-05-02","value":1,"note":""},{"date":"2026-05-03","value":1,"note":""}]'::jsonb, 5, 5, false, '', null, null, null, 'servings', 2, 1, null, null, null, null, now()
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  emoji = excluded.emoji,
  habit_type = excluded.habit_type,
  color = excluded.color,
  logs = excluded.logs,
  streak = excluded.streak,
  best_streak = excluded.best_streak,
  reflection = excluded.reflection,
  reflection_prompt = excluded.reflection_prompt,
  weekly_target = excluded.weekly_target,
  start_value = excluded.start_value,
  target_value = excluded.target_value,
  unit = excluded.unit,
  daily_budget = excluded.daily_budget,
  tap_increment = excluded.tap_increment,
  daily_target_minutes = excluded.daily_target_minutes,
  shared_goal_id = excluded.shared_goal_id,
  goal_status = excluded.goal_status,
  target_date = excluded.target_date,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.habits (id, user_id, name, emoji, habit_type, color, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select 'b1e00001-0001-4001-8001-000000000006'::uuid, (select user_id from demo_user), 'Cert study (AWS)', '📚', 'project', '#C8902A', '[{"date":"2026-04-20","value":{"minutes":25,"win":"finished one messy practice quiz","hardPart":"ADHD brain wanted to tab out every 4 min"},"note":""},{"date":"2026-04-22","value":{"minutes":35},"note":""},{"date":"2026-04-24","value":{"minutes":20},"note":""},{"date":"2026-04-25","value":{"minutes":40,"win":"finally understood the vpc section a little"},"note":""},{"date":"2026-04-27","value":{"minutes":30},"note":""},{"date":"2026-04-28","value":{"minutes":55,"hardPart":"started late bc i was scrolling"},"note":""},{"date":"2026-04-29","value":{"minutes":25},"note":""},{"date":"2026-05-01","value":{"minutes":45},"note":""},{"date":"2026-05-02","value":{"minutes":35,"win":"2 pomodoros for real"},"note":""},{"date":"2026-05-03","value":{"minutes":30},"note":""}]'::jsonb, 2, 2, true, '', null, null, null, null, null, 1, 45, null, null, null, now()
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  emoji = excluded.emoji,
  habit_type = excluded.habit_type,
  color = excluded.color,
  logs = excluded.logs,
  streak = excluded.streak,
  best_streak = excluded.best_streak,
  reflection = excluded.reflection,
  reflection_prompt = excluded.reflection_prompt,
  weekly_target = excluded.weekly_target,
  start_value = excluded.start_value,
  target_value = excluded.target_value,
  unit = excluded.unit,
  daily_budget = excluded.daily_budget,
  tap_increment = excluded.tap_increment,
  daily_target_minutes = excluded.daily_target_minutes,
  shared_goal_id = excluded.shared_goal_id,
  goal_status = excluded.goal_status,
  target_date = excluded.target_date,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.habits (id, user_id, name, emoji, habit_type, color, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at)
select 'b1e00001-0001-4001-8001-000000000007'::uuid, (select user_id from demo_user), 'Weight', '⚖️', 'goal', '#E67E22', '[{"date":"2026-04-20","value":218.4,"note":"morning, after coffee"},{"date":"2026-04-23","value":217.9,"note":""},{"date":"2026-04-25","value":217.5,"note":""},{"date":"2026-04-27","value":217,"note":"walked more this week, who knows"},{"date":"2026-04-29","value":216.6,"note":""},{"date":"2026-05-01","value":216.1,"note":""},{"date":"2026-05-03","value":215.7,"note":"scale bounced 216 yesterday, whatever"}]'::jsonb, 0, 0, false, '', null, 218.4, 210, 'lbs', null, 1, null, null, 'active', '2026-06-24', now()
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  emoji = excluded.emoji,
  habit_type = excluded.habit_type,
  color = excluded.color,
  logs = excluded.logs,
  streak = excluded.streak,
  best_streak = excluded.best_streak,
  reflection = excluded.reflection,
  reflection_prompt = excluded.reflection_prompt,
  weekly_target = excluded.weekly_target,
  start_value = excluded.start_value,
  target_value = excluded.target_value,
  unit = excluded.unit,
  daily_budget = excluded.daily_budget,
  tap_increment = excluded.tap_increment,
  daily_target_minutes = excluded.daily_target_minutes,
  shared_goal_id = excluded.shared_goal_id,
  goal_status = excluded.goal_status,
  target_date = excluded.target_date,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-04-21'::date, 'kinda down but trying not to spiral', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-04-22'::date, 'Rough Tuesday. Didn''t sleep enough and everything felt harder — snapped at my roommate over dishes like a loser. I still logged stuff though. That''s new for me.', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-04-24'::date, 'better mood after the walk. not magic but better', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-04-26'::date, 'Weirdly good day? Walked, studied, and I wasn''t as hungry for garbage food. I think the sleep thing is the real boss fight. When I''m tired I reach for everything.', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-04-28'::date, 'irritable until i drank water lol', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-04-29'::date, 'Slipped a little on nic but not catastrophically. I hate that it''s tied to boredom. Gonna try leaving my phone in the kitchen at night again.', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-05-01'::date, 'Two weeks of this app and I''m not ''fixed'' — but I''m paying attention more. The weight number moved a tiny bit. I''ll take it.', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-05-02'::date, 'small win: didnt order delivery tonight', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

with demo_user as (
  select id as user_id from auth.users where lower(email) = lower('cheesefingersathotmail.co.n@gmail.com') limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), '2026-05-03'::date, 'Recording this before bed. Not perfect this week, but more walks than last week and fewer 1am doom-scrolls. Progress isn''t linear blah blah but it''s actually true.', now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;

-- Calendar window used (runner's local TZ when SQL was generated): 2026-04-20 .. 2026-05-03
commit;