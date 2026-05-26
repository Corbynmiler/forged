-- Short display name for an Arc (1–3 words), shown on Today instead of the full identity sentence.
alter table public.forge_blocks add column if not exists title text;
