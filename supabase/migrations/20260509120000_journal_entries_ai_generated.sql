-- Add AI generation metadata columns to journal_entries.
-- is_ai_generated: distinguishes AI-written entries from manually written ones.
-- generation_sources: records what data was available when the entry was generated.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS generation_sources JSONB DEFAULT '{}';
