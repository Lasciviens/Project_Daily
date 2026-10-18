-- What migration 162 (projects for every kind of project) meets, on top of
-- scripts/db-tests/one-item/base.sql and the real 135/144/147/150/151/155
-- (scripts/verify-db-project-blocks.mjs): the project tables as 007/040 left
-- them live (one-item's base has a cut-down projects and project_items), and
-- the owner's projects as they are before 162 — items, one of them planned
-- (its task and slot, source project_item), one done, one with notes — plus
-- a second account's project that must stay its own.

alter table public.projects add column description text;
alter table public.projects add column status text not null default 'active'
  check (status in ('active', 'on_hold', 'completed', 'archived'));
alter table public.projects add column color text not null default 'slate'
  check (color in ('slate', 'blue', 'violet', 'emerald', 'amber', 'rose'));
alter table public.projects add column sort_order integer not null default 0;
alter table public.projects add column created_at timestamptz default now();
alter table public.projects add column updated_at timestamptz default now();
alter table public.projects add column notes text;

create table public.project_phases (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  status      text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  sort_order  integer not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.project_phases enable row level security;
create policy own on public.project_phases for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.project_phases to authenticated;
create trigger trg_audit after insert or update or delete on public.project_phases for each row execute function public.log_audit();
select public.owner_lock_apply('public.project_phases');
select public.owner_lock_apply('public.projects');
select public.owner_lock_apply('public.project_items');
select public.owner_lock_apply('public.tasks');

alter table public.project_items add column phase_id uuid references public.project_phases(id) on delete cascade;
alter table public.project_items add column notes text;
alter table public.project_items add column type text not null default 'improvement'
  check (type in ('update', 'improvement', 'ui_request', 'bug', 'wishlist'));
alter table public.project_items add column priority text not null default 'medium'
  check (priority in ('low', 'medium', 'high'));
alter table public.project_items add column sort_order integer not null default 0;
alter table public.project_items add column created_at timestamptz default now();
alter table public.project_items add column updated_at timestamptz default now();

-- The owner's projects before 162.
insert into public.projects (id, user_id, name, description, status, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Lasci''s Board', 'The app', 'active',
   '2026-05-02 09:00+00', '2026-09-01 09:00+00'),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Someone else', null, 'active',
   '2026-06-01 09:00+00', '2026-06-01 09:00+00');
insert into public.project_phases (id, project_id, user_id, name, status, sort_order, created_at, updated_at) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Version 1', 'done', 0, '2026-05-02 09:00+00', '2026-07-10 12:00+00'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Version 2', 'in_progress', 1, '2026-05-02 09:00+00', '2026-09-01 12:00+00'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
   'Theirs', 'pending', 0, '2026-06-01 09:00+00', '2026-06-01 09:00+00');
insert into public.project_items (id, project_id, phase_id, user_id, title, notes, type, status, priority, sort_order, created_at, updated_at) values
  -- planned once (its task below), then planned again (the newer, still open task wins)
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'Dark mode', 'Both themes', 'ui_request', 'in_progress', 'high', 3,
   '2026-08-01 09:00+00', '2026-09-01 09:00+00'),
  -- done long ago
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'Login page', null, 'update', 'done', 'medium', 1,
   '2026-05-03 09:00+00', '2026-07-01 10:30+00'),
  -- open, never planned, with notes
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'Faster lists', 'Page them', 'improvement', 'open', 'low', 2,
   '2026-08-02 09:00+00', '2026-08-02 09:00+00'),
  -- cancelled
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'Old idea', null, 'wishlist', 'cancelled', 'low', 4,
   '2026-08-03 09:00+00', '2026-08-20 09:00+00'),
  -- the other account's
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000002', 'Their item', null, 'bug', 'open', 'medium', 0,
   '2026-06-02 09:00+00', '2026-06-02 09:00+00');
-- The planned item's two tasks: an older closed one and a newer open one on its day, on Google.
insert into public.tasks (id, user_id, title, description, section, status, due_date, source_type, source_id,
                          google_sync_enabled, google_task_id, created_at, completed_at) values
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Dark mode', null, 'backlog', 'done',
   '2026-08-10', 'project_item', 'c0000000-0000-0000-0000-000000000001', false, null, '2026-08-05 09:00+00', '2026-08-10 18:00+00'),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Dark mode', null, 'backlog', 'open',
   '2026-10-25', 'project_item', 'c0000000-0000-0000-0000-000000000001', true, 'g-dark', '2026-09-01 09:00+00', null);
-- An ordinary task that has nothing to do with projects.
insert into public.tasks (id, user_id, title, section, status, domain) values
  ('d0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 'Buy milk', 'today', 'open', 'personal');

-- What the owner had before 162, to compare with after.
create table public.snap_tasks as select * from public.tasks;
create table public.snap_items as select * from public.project_items;
