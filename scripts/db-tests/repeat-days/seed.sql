-- The owner's data before 156 (after 155): repeating items of every kind and
-- Google choice, a day already split off (142), a day taken out, an old task
-- overdue, a second account (no Google connection) and a third one the owner
-- lock keeps out. snap_* keep every row so the scenarios can prove 156 itself
-- changed nothing. Dates: 13.10.2026 is a Tuesday, 15.10.2026 a Thursday.
insert into public.user_calendar_tokens (user_id, refresh_token) values ('00000000-0000-0000-0000-000000000001', 'rt-owner');
insert into public.hevy_routines (id, user_id, title) values
  ('r-gym', '00000000-0000-0000-0000-000000000001', 'Gym'),
  ('r-legs', '00000000-0000-0000-0000-000000000001', 'Legs');

insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from, except_dates,
                                    repeat_kind, repeat_interval, repeat_unit, repeat_dates, google_calendar_event_id,
                                    google_calendar_time_zone, google_calendar_from, google_target, domain, priority, notes, busy) values
  -- R1 every day, no time (on Google Tasks once 156 allows it — scenarios.sql)
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-0000-0000-000000000001', 'Water plants', '{0,1,2,3,4,5,6}', null, null, 'other',
   '2026-09-01', '{}', 'weekly', null, null, null, null, null, null, 'none', 'personal', 'low', 'The big fern too', true),
  -- R2 training Tue + Thu on its Google Calendar series
  ('00000000-0000-4000-8000-0000000001a2', '00000000-0000-0000-0000-000000000001', 'Gym', '{2,4}', '17:30', '18:30', 'training',
   '2026-09-01', '{}', 'weekly', null, null, null, 'evGym', 'Europe/Oslo', '2026-09-01', 'calendar', null, null, null, true),
  -- R3 Thursdays on its series (on both once 156 allows it)
  ('00000000-0000-4000-8000-0000000001a3', '00000000-0000-0000-0000-000000000001', 'Read', '{4}', '21:00', '21:30', 'media',
   '2026-09-01', '{}', 'weekly', null, null, null, 'evRead', 'Europe/Oslo', '2026-09-01', 'calendar', 'media', 'high', null, true),
  -- R4 every 2 days from 13.10 (13, 15, 17 …), not on Google
  ('00000000-0000-4000-8000-0000000001a4', '00000000-0000-0000-0000-000000000001', 'Stretch', '{}', null, null, 'other',
   '2026-10-13', '{}', 'interval', 2, 'day', null, null, null, null, 'none', null, null, null, true),
  -- R5 monthly, the Saturday nearest the 13th (not in these days)
  ('00000000-0000-4000-8000-0000000001a5', '00000000-0000-0000-0000-000000000001', 'Haircut', '{6}', '10:00', '11:00', 'other',
   '2026-10-13', '{}', 'monthly', null, null, null, null, null, null, 'none', null, null, null, true),
  -- R6 saved before 155 (no Google choice), on its series: reads as Calendar
  ('00000000-0000-4000-8000-0000000001a6', '00000000-0000-0000-0000-000000000001', 'Standup', '{1,2,3,4,5}', '09:00', '09:15', 'work',
   '2026-09-01', '{}', 'weekly', null, null, null, 'evStandup', 'Europe/Oslo', '2026-09-01', null, null, null, null, true),
  -- R7 Thursdays, 15.10 taken out ("Only this day")
  ('00000000-0000-4000-8000-0000000001a7', '00000000-0000-0000-0000-000000000001', 'Piano', '{4}', '19:00', '20:00', 'other',
   '2026-09-01', '{2026-10-15}', 'weekly', null, null, null, null, null, null, 'none', null, null, null, true),
  -- R8 Thursdays, 15.10 split off already (142: its slot and task, done)
  ('00000000-0000-4000-8000-0000000001a8', '00000000-0000-0000-0000-000000000001', 'Swim', '{4}', '07:00', '08:00', 'other',
   '2026-09-01', '{}', 'weekly', null, null, null, null, null, null, 'none', null, null, null, true),
  -- R9 starts 20.10
  ('00000000-0000-4000-8000-0000000001a9', '00000000-0000-0000-0000-000000000001', 'Course', '{2,4}', '18:00', '20:00', 'other',
   '2026-10-20', '{}', 'weekly', null, null, null, null, null, null, 'none', null, null, null, true),
  -- R10 training on Tuesdays, not on Google
  ('00000000-0000-4000-8000-0000000001aa', '00000000-0000-0000-0000-000000000001', 'Legs', '{2}', '18:00', '19:00', 'training',
   '2026-09-01', '{}', 'weekly', null, null, null, null, null, null, 'none', null, null, null, true),
  -- the second account: every day (on Google Tasks once 156 allows it), but no Google connection
  ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-0000-0000-000000000002', 'Theirs', '{0,1,2,3,4,5,6}', null, null, 'other',
   '2026-09-01', '{}', 'weekly', null, null, null, null, null, null, 'none', null, null, null, true),
  -- the account the owner lock keeps out
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-0000-0000-000000000003', 'Locked out', '{0,1,2,3,4,5,6}', null, null, 'other',
   '2026-09-01', '{}', 'weekly', null, null, null, null, null, null, 'none', null, null, null, true);

-- R8's 15.10 as an item of its own (142), done
insert into public.tasks (id, user_id, title, section, status, due_date, due_time, source_type) values
  ('00000000-0000-4000-8000-0000000001b8', '00000000-0000-0000-0000-000000000001', 'Swim', 'today', 'done', '2026-10-15', '07:00', 'manual');
insert into public.time_blocks (id, user_id, date, title, start_time, duration_minutes, category, task_id, schedule_block_id, occurrence_date) values
  ('00000000-0000-4000-8000-0000000001c8', '00000000-0000-0000-0000-000000000001', '2026-10-15', 'Swim', '07:00', 60, 'other',
   '00000000-0000-4000-8000-0000000001b8', '00000000-0000-4000-8000-0000000001a8', '2026-10-15');

-- Ordinary tasks: one on Google Tasks, one overdue (the missed rule is not for them)
insert into public.tasks (id, user_id, title, section, status, due_date, google_task_id, google_sync_enabled, source_type) values
  ('00000000-0000-4000-8000-0000000001d1', '00000000-0000-0000-0000-000000000001', 'Pay rent', 'today', 'open', '2026-10-15', 'gt-rent', true, 'manual'),
  ('00000000-0000-4000-8000-0000000001d2', '00000000-0000-0000-0000-000000000001', 'Old overdue', 'backlog', 'open', '2026-10-10', null, false, 'manual');

-- Everything before 156
create table public.snap_tasks as select * from public.tasks;
create table public.snap_blocks as select * from public.time_blocks;
create table public.snap_plans as select * from public.schedule_blocks;
create table public.snap_counts as
  select (select count(*) from public.calendar_outbox) as calendar_rows,
         (select count(*) from public.google_tasks_outbox) as tasks_rows,
         (select count(*) from public.audit_logs) as audit_rows;
