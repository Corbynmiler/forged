-- Allow shared accountability rows for numeric goals and limit habits (Today habit types).
alter table public.shared_goals
  drop constraint if exists shared_goals_habit_type_check;

alter table public.shared_goals
  add constraint shared_goals_habit_type_check
  check (habit_type in ('daily', 'weekly', 'project', 'goal', 'limit'));
