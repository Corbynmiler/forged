-- Persist the latest weekly brief text alongside the generation quota row,
-- so the UI can fetch the existing brief from the DB on mount instead of
-- regenerating it on every Insights open. Keyed by (user_id, week_start) —
-- subsequent generations within the same week overwrite brief_text with the
-- newest copy.

alter table weekly_brief_generation_usage
  add column if not exists brief_text text,
  add column if not exists brief_generated_at timestamptz;
