-- Daily build target for project habits (minutes). Nullable; DB default 60 for new rows.
ALTER TABLE habits
  ADD COLUMN IF NOT EXISTS daily_target_minutes integer DEFAULT 60;

COMMENT ON COLUMN habits.daily_target_minutes IS 'Project/build: minutes per day for streaks and bonus XP (nullable).';
