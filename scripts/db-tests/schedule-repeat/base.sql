-- schedule_blocks as far as migration 146 needs it (004 + 077 + 081 + 142)
-- (scripts/verify-db-schedule-repeat.mjs builds a throwaway database from
-- this, the real migration twice and scenarios.sql). The rows are weekly
-- plans from before 146, one of them with no day at all: none may change
-- meaning and none may block the migration.
create table public.schedule_blocks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid,
  title          text not null,
  days_of_week   int[] not null,
  start_time     time not null,
  end_time       time not null,
  color          text not null default 'blue',
  category       text not null default 'daily',
  effective_from date not null default current_date,
  except_dates   date[] not null default '{}',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
insert into public.schedule_blocks (id, title, days_of_week, start_time, end_time, effective_from, except_dates) values
  ('00000000-0000-4000-8000-000000000001', 'Weekdays walk', '{1,2,3,4,5}', '07:00', '07:40', '2026-01-01', '{}'),
  ('00000000-0000-4000-8000-000000000002', 'Upper A',       '{1,4}',       '17:00', '18:00', '2026-09-01', '{2026-10-12}'),
  ('00000000-0000-4000-8000-000000000003', 'Never picked',  '{}',          '09:00', '10:00', '2026-02-01', '{}');
