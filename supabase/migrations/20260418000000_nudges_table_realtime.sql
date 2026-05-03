-- Nudges: persisted events for friend / accountability nudges (API inserts via service role).
-- Recipients read their own rows for catch-up on next app open; realtime optional.

create table if not exists public.nudges (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  sender_name text,
  message text,
  sent_at timestamptz not null default now()
);

create index if not exists nudges_recipient_sent_at_idx
  on public.nudges (recipient_id, sent_at desc);

create index if not exists nudges_sender_recipient_sent_at_idx
  on public.nudges (sender_id, recipient_id, sent_at desc);

alter table public.nudges enable row level security;

drop policy if exists "nudges_select_involved" on public.nudges;
create policy "nudges_select_involved"
  on public.nudges
  for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "nudges_insert_as_sender" on public.nudges;
create policy "nudges_insert_as_sender"
  on public.nudges
  for insert
  to authenticated
  with check (auth.uid() = sender_id);

do $pub$
begin
  alter publication supabase_realtime add table public.nudges;
exception
  when duplicate_object then null;
end
$pub$;
