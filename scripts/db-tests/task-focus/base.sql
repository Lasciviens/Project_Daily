-- The tasks table as far as migration 143 needs it
-- (scripts/verify-db-task-focus.mjs builds a throwaway database from this,
-- the real migration and scenarios.sql). The last row is a task closed while
-- focused before 143: the migration clears it once.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'open' check (status in ('open','in_progress','waiting','done','cancelled')),
  is_focused boolean default false
);
insert into public.tasks (id, title, status, is_focused) values
  ('00000000-0000-4000-8000-000000000001', 'Focused, open', 'in_progress', true),
  ('00000000-0000-4000-8000-000000000002', 'Finished on Daily before 143', 'done', true),
  ('00000000-0000-4000-8000-000000000003', 'Cancelled before 143', 'cancelled', true);
