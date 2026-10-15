-- The owner's data as it is before 155 (applied after base.sql and the real
-- 135/144/147/150/151, BEFORE 155): tasks on Google Tasks, slots and plans on
-- Google Calendar with their ids, series start days, horizons and zones, a
-- day split off a plan, old standalone slots (future, past, a planned episode,
-- one with no time), work already waiting in both outboxes, and a second
-- account. snap_* keep every Google-facing column so the scenarios can prove
-- 155 lost, duplicated or moved nothing.
insert into public.google_task_lists (id, user_id, google_tasklist_id, title) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'gl-personal', 'Personal');

insert into public.tasks (id, user_id, title, section, status, due_date, due_time, google_task_id, google_sync_enabled,
                          google_tasklist_id, google_etag, google_position, source_type) values
  -- A: on Google Tasks
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Pay rent', 'today', 'open', '2026-10-15', null,
   'gt-A', true, '00000000-0000-4000-8000-0000000000f1', 'etag-A', '0001', 'manual'),
  -- B: on Google Calendar through its slot
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Dentist', 'backlog', 'open', '2026-10-20', '09:00',
   null, false, null, null, null, 'manual'),
  -- C: done, slot with no event
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000001', 'Read chapter', 'today', 'done', '2026-10-14', null,
   null, false, null, null, null, 'manual'),
  -- D: a window task (start_date) — untouched by every rule here
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000001', 'Book hytte', 'backlog', 'open', '2026-11-30', null,
   'gt-D', true, null, null, null, 'manual'),
  -- the training day split off P1 (142)
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'Gym', 'backlog', 'open', '2026-10-20', '17:30',
   null, false, null, null, null, 'training_session'),
  -- the other account's task
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000002', 'Theirs', 'today', 'open', '2026-10-15', null,
   'gt-2', true, null, null, null, 'manual');
update public.tasks set start_date = '2026-11-01' where id = '00000000-0000-4000-8000-00000000000d';

insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from, except_dates,
                                    repeat_kind, repeat_interval, repeat_unit, repeat_dates,
                                    google_calendar_event_id, google_calendar_horizon, google_calendar_time_zone, google_calendar_from) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Gym', '{1,3,5}', '17:30', '18:30', 'training',
   '2026-09-01', '{2026-10-20}', 'weekly', null, null, null, 'evP1', null, 'Europe/Oslo', '2026-10-14'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Haircut', '{6}', '10:00', '11:00', 'other',
   '2026-10-13', '{}', 'monthly', null, null, null, 'evP2', '2027-10-14', 'Europe/Oslo', '2026-10-14'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'Standup', '{1,2,3,4,5}', '09:00', '09:15', 'work',
   '2026-01-01', '{}', 'weekly', null, null, null, null, null, null, null);

insert into public.time_blocks (id, user_id, date, title, start_time, duration_minutes, category, task_id, source_type, source_id,
                                season_number, episode_number, google_calendar_event_id, schedule_block_id, occurrence_date) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000001', '2026-10-20', 'Dentist', '09:00', 45, 'other',
   '00000000-0000-4000-8000-00000000000b', null, null, null, null, 'evB', null, null),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000001', '2026-10-14', 'Read chapter', '20:00', 30, 'other',
   '00000000-0000-4000-8000-00000000000c', null, null, null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-000000000001', '2026-10-20', 'Gym', '17:30', 60, 'training',
   '00000000-0000-4000-8000-0000000000e1', 'training_session', null, null, null, 'evO1', '00000000-0000-4000-8000-0000000000a1', '2026-10-20'),
  -- standalone slots: future with an event, future without, past with an event, a planned episode, no time
  ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-0000-0000-000000000001', '2026-10-18', 'Concert', '19:00', 120, 'other',
   null, 'manual', null, null, null, 'evS1', null, null),
  ('00000000-0000-4000-8000-0000000005a2', '00000000-0000-0000-0000-000000000001', '2026-10-15', 'Call mum', '18:00', 30, 'other',
   null, null, null, null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000005a3', '00000000-0000-0000-0000-000000000001', '2026-10-01', 'Old meeting', '10:00', 60, 'work',
   null, null, null, null, null, 'evS3', null, null),
  ('00000000-0000-4000-8000-0000000005a4', '00000000-0000-0000-0000-000000000001', '2026-10-16', 'The Show S01E02', '21:00', 50, 'media',
   null, 'tv_episode', '00000000-0000-4000-8000-0000000000aa', 1, 2, null, null, null),
  ('00000000-0000-4000-8000-0000000005a5', '00000000-0000-0000-0000-000000000001', '2026-10-17', 'Tidy garage', null, 60, 'other',
   null, 'calendar', null, null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000005a6', '00000000-0000-0000-0000-000000000001', '2026-10-19', 'Watch film', '20:00', 110, 'media',
   null, 'movie', '00000000-0000-4000-8000-0000000000ab', null, null, null, null, null);

-- Work already waiting for Google (155 must leave it exactly as it is)
insert into public.calendar_outbox (user_id, calendar_id, event_id, operation, time_block_id, payload) values
  ('00000000-0000-0000-0000-000000000001', 'primary', 'evOld', 'delete', null, '{"title":"gone"}');
insert into public.google_tasks_outbox (user_id, task_id, operation) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-00000000000a', 'update');

-- Everything Google-facing, before 155
create table public.snap_tasks as
  select id, user_id, title, status, section, due_date, due_time, start_date, google_task_id, google_sync_enabled, google_tasklist_id,
         google_etag, google_position, google_calendar_event_id, source_type, source_id from public.tasks;
create table public.snap_blocks as
  select id, user_id, task_id, date, start_time, duration_minutes, title, google_calendar_event_id, schedule_block_id, occurrence_date,
         source_type, source_id from public.time_blocks;
create table public.snap_plans as
  select id, user_id, title, days_of_week, start_time, end_time, effective_from, except_dates, repeat_kind,
         google_calendar_event_id, google_calendar_horizon, google_calendar_time_zone, google_calendar_from from public.schedule_blocks;
create table public.snap_counts as
  select (select count(*) from public.calendar_outbox) as calendar_rows,
         (select count(*) from public.google_tasks_outbox) as tasks_rows,
         (select count(*) from public.audit_logs) as audit_rows;
