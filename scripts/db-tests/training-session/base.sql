-- The few tables and stubs migrations 112 → 141 → 142 need, as small as they
-- can be (scripts/verify-db-training-session.mjs builds a throwaway database
-- from this, the real migration files and scenarios.sql).
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
create or replace function public.log_audit() returns trigger language plpgsql as $$ begin return null; end $$;
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text not null,
  domain text not null default 'personal',
  status text not null default 'open' check (status in ('open','in_progress','waiting','done','cancelled')),
  due_date date, due_time time,
  source_type text not null default 'manual', source_id uuid,
  completed_at timestamptz, created_at timestamptz default now()
);
create table public.schedule_blocks (id uuid primary key default gen_random_uuid(), user_id uuid, title text, days_of_week int[], start_time time not null, end_time time);
create table public.time_blocks (id uuid primary key default gen_random_uuid(), user_id uuid, task_id uuid references public.tasks(id) on delete cascade,
  date date not null, start_time time, duration_minutes int default 60, title text, category text default 'training');
create unique index on public.time_blocks(task_id) where task_id is not null;
create table public.hevy_routines (id text primary key, user_id uuid not null, title text not null);
create table public.hevy_workouts (id text primary key, user_id uuid not null, title text not null, routine_id text, start_time timestamptz, end_time timestamptz);
