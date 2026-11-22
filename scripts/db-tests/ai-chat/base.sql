-- What migration 197 (Ask AI chats) needs on top of the AI ledger's base (scripts/db-tests/ai-ledger/base.sql; 194 and
-- 195 are applied by the runner): small stand-ins for the two tables ai_find_text reads (tasks, diary_entries), with the
-- columns it uses and the owner policies the real ones have.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, description text, due_date date
);
alter table public.tasks enable row level security;
create policy tasks_owner on public.tasks using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null, body text not null default ''
);
alter table public.diary_entries enable row level security;
create policy diary_owner on public.diary_entries using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.tasks, public.diary_entries to authenticated, service_role;
