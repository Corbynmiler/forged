-- Add context_notes column to journal_entries.
-- This separates chat-captured raw context (context_notes) from the polished
-- AI-generated journal body (content), so chat saves never clobber the
-- Regenerate output.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS context_notes TEXT DEFAULT NULL;
