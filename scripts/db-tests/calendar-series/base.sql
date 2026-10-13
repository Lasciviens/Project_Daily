-- What migration 147 needs (scripts/verify-db-calendar-series.mjs builds a
-- throwaway database from this, the REAL migration 135 (the calendar outbox)
-- and the real migration 147 twice, then scenarios.sql): auth, the two block
-- tables with their calendar columns as far as 004/038/081/142/146 made
-- them, the browser's role. Two users: the second one is deleted with a
-- linked plan in the scenarios.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create or replace function public.update_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table public.schedule_blocks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title           text not null,
  days_of_week    int[] not null,
  start_time      time not null,
  end_time        time not null,
  color           text not null default 'blue',
  category        text not null default 'daily',
  effective_from  date not null default current_date,
  except_dates    date[] not null default '{}',
  repeat_kind     text not null default 'weekly',
  repeat_interval integer,
  repeat_unit     text,
  repeat_dates    date[],
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.schedule_blocks enable row level security;
create policy "user owns schedule_blocks" on public.schedule_blocks for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.schedule_blocks to authenticated;

create table public.time_blocks (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date                     date not null,
  title                    text not null,
  start_time               time,
  duration_minutes         integer not null default 60,
  google_calendar_event_id text,
  schedule_block_id        uuid references public.schedule_blocks(id) on delete set null,
  occurrence_date          date
);
grant select, insert, update, delete on public.time_blocks to authenticated;

-- Plans from before 147: a weekly one and a monthly one.
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, effective_from, repeat_kind) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Weekdays walk', '{1,2,3,4,5}', '07:00', '07:40', '2026-01-01', 'weekly'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'Haircut',       '{6}',         '10:00', '11:00', '2026-10-13', 'monthly');
