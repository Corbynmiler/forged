-- Server-enforced cap on AI weekly brief generations per user per calendar week
-- (week bucket is supplied by the client as Monday-start local date string).

create table if not exists weekly_brief_generation_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  generation_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create index if not exists weekly_brief_generation_usage_week_idx
  on weekly_brief_generation_usage (week_start);

alter table weekly_brief_generation_usage enable row level security;
