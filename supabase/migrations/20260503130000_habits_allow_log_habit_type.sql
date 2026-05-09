-- App supports habit_type = 'log' (journal-style track on habits); align DB check.
alter table public.habits drop constraint if exists habits_habit_type_check;

alter table public.habits
  add constraint habits_habit_type_check
  check (habit_type in ('daily', 'weekly', 'project', 'limit', 'goal', 'progress', 'log'));
