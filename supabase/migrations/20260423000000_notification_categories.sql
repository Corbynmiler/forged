-- Split push notifications into independently-controllable categories so a
-- user can, for example, accept friend nudges in real time but turn off the
-- daily reminder.
--
-- `notifications_enabled` stays as the MASTER flag (= "we have a live push
-- subscription for this user"). The three new flags are all-default-true so
-- existing subscribers keep getting everything they were getting before this
-- migration shipped.
--
--   notifications_enabled        -> push subscription alive at all
--   daily_reminders_enabled      -> nightly cron sends or skips
--   nudges_enabled               -> friend "nudge" pushes via /api/nudge-friend
--   social_invites_enabled       -> friend-request + shared-goal-invite pushes
--
-- All additive; safe to run live.

alter table push_subscriptions
  add column if not exists daily_reminders_enabled  boolean not null default true,
  add column if not exists nudges_enabled           boolean not null default true,
  add column if not exists social_invites_enabled   boolean not null default true;

comment on column push_subscriptions.daily_reminders_enabled is
  'Whether the user wants the daily reminder cron to push them. When false the row is still kept and the browser subscription stays alive — only the daily push is suppressed.';
comment on column push_subscriptions.nudges_enabled is
  'Whether to deliver "friend nudged you" pushes. Independent of in-app nudge toasts (those still surface via realtime).';
comment on column push_subscriptions.social_invites_enabled is
  'Whether to deliver friend-request and shared-goal-invite pushes.';
