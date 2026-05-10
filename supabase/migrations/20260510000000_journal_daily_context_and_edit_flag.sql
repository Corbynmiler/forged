-- Phase 2: journal consolidation
-- daily_context: bullet-point notes accumulated via chat during the day,
--   consumed by journal-generate.js when building the AI prompt.
--   Chat's add_daily_note tool appends here instead of overwriting content.
-- manually_edited: set true when the user edits an entry via the compose sheet.
--   Checked by JournalScreen before auto-regenerating to avoid clobbering edits.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS daily_context TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manually_edited BOOLEAN DEFAULT false;
