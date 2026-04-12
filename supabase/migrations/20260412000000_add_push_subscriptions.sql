-- Push subscriptions for web push notifications
-- One row per user (last active device wins — MVP approach)

create table if not exists push_subscriptions (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  subscription          jsonb       not null,
  reminder_time         text        not null default '09:00', -- "HH:MM" 24h in user's timezone
  notifications_enabled boolean     not null default true,
  timezone              text        not null default 'UTC',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(user_id)
);

alter table push_subscriptions enable row level security;

create policy "users manage own push subscriptions"
  on push_subscriptions
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
