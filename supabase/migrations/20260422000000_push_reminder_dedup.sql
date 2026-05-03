-- Beta-ready notification scheduling prep:
--   1. Track when we last sent a daily reminder so the cron can dedupe by
--      the user's LOCAL calendar day (not UTC). Without this, switching the
--      cron to an hourly schedule on Vercel Pro would risk double-sends if
--      a row is processed across a DST boundary or a retry.
--   2. Flip the default reminder time from 09:00 to 18:00 (6 pm). Most
--      retention research and the user's own brief lands in the evening
--      window; existing rows are NOT modified — users keep whatever time
--      they have already chosen.
--
-- Both changes are additive and safe to run while the app is live; no
-- existing column is renamed or dropped.

alter table push_subscriptions
  add column if not exists last_reminder_sent_date text;

comment on column push_subscriptions.last_reminder_sent_date is
  'YYYY-MM-DD in the user''s local timezone — set by the cron after a successful daily reminder send. Used to prevent double-sends when the cron runs more than once per day (Vercel Pro hourly schedule).';

alter table push_subscriptions
  alter column reminder_time set default '18:00';
