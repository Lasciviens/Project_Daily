-- What migration 148 needs on top of scripts/db-tests/google-tasks-pull/base.sql
-- (the Google Tasks schema 145 needs; scripts/verify-db-google-today-series.mjs
-- applies that one first, then this, the real 145, the real 148 twice, 145's
-- own scenarios against 148's function, then scenarios.sql): the repeating
-- plans table with 147's calendar columns, and the browser's grant on it.
create table public.schedule_blocks (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  title                     text not null,
  days_of_week              int[] not null,
  start_time                time not null,
  end_time                  time not null,
  effective_from            date not null default current_date,
  except_dates              date[] not null default '{}',
  google_calendar_event_id  text,
  google_calendar_horizon   date,
  google_calendar_time_zone text
);
grant select, insert, update, delete on public.schedule_blocks to authenticated;

-- A plan linked before 148 (no start day stored).
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, effective_from, google_calendar_event_id, google_calendar_time_zone) values
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000000a1', 'Upper A', '{2,4}', '16:30', '17:30', '2026-09-01', '00000000000040008000000000d001', 'Europe/Oslo');
