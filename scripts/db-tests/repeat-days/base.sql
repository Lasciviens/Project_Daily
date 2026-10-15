-- What migration 156 (a repeat's day is a task) needs on top of
-- scripts/db-tests/one-item/base.sql (tasks, slots, plans, the Google Tasks
-- outbox, the audit log, row level security, the owner lock): Hevy's routines
-- and workouts (141 links and completes a training day), 112's skips table
-- (142), the stored Google token (a connected account) and pg_cron's job
-- table — a stand-in with the real cron.schedule / cron.unschedule shape
-- (the throwaway Postgres has no pg_cron).
create table public.hevy_routines (
  id      text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title   text not null
);
create table public.hevy_workouts (
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  routine_id text,
  start_time timestamptz,
  end_time   timestamptz
);
create table public.user_calendar_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  refresh_token text not null
);
alter table public.user_calendar_tokens enable row level security;
revoke all on public.user_calendar_tokens from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['hevy_routines', 'hevy_workouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- pg_cron's job list and its two calls, as the extension has them
create schema if not exists cron;
create table cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null
);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $$;
