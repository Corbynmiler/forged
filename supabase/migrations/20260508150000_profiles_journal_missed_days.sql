-- Add journal_missed_days to profiles for cross-device sync.
-- Stores a JSONB map of { "YYYY-MM-DD": "optional note" } per user.
alter table public.profiles
  add column if not exists journal_missed_days jsonb not null default '{}'::jsonb;
