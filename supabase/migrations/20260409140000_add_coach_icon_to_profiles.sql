-- Optional avatar for AI coach (emoji preset from app UI)
alter table public.profiles add column if not exists coach_icon text;
