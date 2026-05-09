-- Ensure `habits.id` auto-generates when omitted (e.g. AI/chat flow inserts).
-- `habits.id` is `text` in this project, so we store UUIDs as strings.
alter table public.habits
  alter column id set default (gen_random_uuid()::text);

