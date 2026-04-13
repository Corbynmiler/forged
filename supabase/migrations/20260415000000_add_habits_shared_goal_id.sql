-- Link personal habits to a shared_goals row for friend sync
alter table public.habits
  add column if not exists shared_goal_id uuid references public.shared_goals (id) on delete set null;
