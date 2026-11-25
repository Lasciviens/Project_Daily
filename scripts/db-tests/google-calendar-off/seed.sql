-- Items as they are before migration 208 (scripts/verify-db-google-calendar-off.mjs). Made-up data only.
-- User 1 (the owner): Training on Apple, Work and Personal on Google, Media "on Apple" but not in use; iCloud connected,
-- Google connected. User 2: no calendar settings at all (every area on Google, as the app read it), not on iCloud.
insert into public.calendar_prefs (user_id, prefs) values
  ('00000000-0000-0000-0000-000000000001', '{"areas": {"training": {"name": "Lasci · Training", "app": "apple", "enabled": true},
     "work": {"name": "Lasci · Work", "app": "google", "enabled": true, "alertMinutes": 10},
     "personal": {"name": "Lasci · Personal", "enabled": true},
     "media": {"name": "Lasci · Media", "app": "apple", "enabled": false}},
   "notes": "notes", "showMarks": true}');
insert into public.icloud_credentials (user_id, apple_id, app_password) values
  ('00000000-0000-0000-0000-000000000001', 'ola.nordmann@example.com', 'sealed:example');

-- Tasks (the item's Google choice) and their slots: the uuids say what each one is.
insert into public.tasks (id, user_id, title, domain, google_target, google_sync_enabled, source_type, hevy_routine_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Dentist', 'personal', 'calendar', false, 'manual', null),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Post office', 'personal', 'both', true, 'manual', null),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Lower B', 'personal', 'calendar', false, 'training_session', null),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Report', 'work', 'calendar', false, 'manual', null),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Old dentist', 'personal', null, false, 'manual', null),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Old run', 'personal', null, false, 'manual', 'routine-1'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'Old errand', 'personal', null, true, 'manual', null),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'Buy milk', 'personal', 'tasks', true, 'manual', null),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 'Film night', 'media', 'calendar', false, 'manual', null),
  ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Read', 'personal', 'none', false, 'manual', null),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Their dentist', 'personal', 'calendar', false, 'manual', null);
update public.tasks set google_task_id = 'gt-' || right(id::text, 2) where google_sync_enabled;

insert into public.time_blocks (id, user_id, date, title, start_time, duration_minutes, category, task_id, source_type, google_calendar_event_id, icloud_area) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-12-01', 'Dentist', '09:00', 60, 'daily', '10000000-0000-0000-0000-000000000001', null, '110000000000000000000000000000001', null),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '2026-12-01', 'Post office', '10:00', 30, 'daily', '10000000-0000-0000-0000-000000000002', null, '110000000000000000000000000000002', null),
  ('11000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '2026-12-01', 'Lower B', '17:00', 60, 'training', '10000000-0000-0000-0000-000000000003', 'training_session', '110000000000000000000000000000003', null),
  ('11000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '2026-12-02', 'Report', '13:00', 60, 'work', '10000000-0000-0000-0000-000000000004', null, null, 'work'),
  ('11000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '2026-12-02', 'Old dentist', '08:00', 60, 'daily', '10000000-0000-0000-0000-000000000005', null, '110000000000000000000000000000005', null),
  ('11000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '2026-12-03', 'Old run', '07:00', 45, 'daily', '10000000-0000-0000-0000-000000000006', null, '110000000000000000000000000000006', null),
  ('11000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '2026-12-03', 'Old errand', '12:00', 30, 'daily', '10000000-0000-0000-0000-000000000007', null, '110000000000000000000000000000007', null),
  ('11000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', '2026-12-04', 'Film night', '20:00', 120, 'media', '10000000-0000-0000-0000-000000000009', null, '110000000000000000000000000000009', null),
  -- An episode slot with no task (Google's choice is where it is): on Google Calendar only.
  ('11000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '2026-12-05', 'Episode 3', '21:00', 45, 'media', null, 'tv_episode', '110000000000000000000000000000011', null),
  ('21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '2026-12-01', 'Their dentist', '09:00', 60, 'daily', '20000000-0000-0000-0000-000000000001', null, '210000000000000000000000000000001', null);

-- Repeats: Personal on Google (with a day task), Training on Apple (with a day task), a Personal one from before 155.
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from, google_target,
                                    google_calendar_event_id, google_calendar_from, google_calendar_horizon, google_calendar_time_zone, icloud_area) values
  ('12000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Swim', '{1}', '07:00', '08:00', 'daily', '2026-11-02', 'calendar',
   '120000000000000000000000000000001', '2026-11-02', '2027-11-02', 'Europe/Oslo', null),
  ('12000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Upper A', '{2}', '17:00', '18:00', 'training', '2026-11-03', 'calendar',
   null, null, null, null, 'training'),
  ('12000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Old yoga', '{3}', '18:00', '19:00', 'daily', '2026-11-04', null,
   '120000000000000000000000000000003', '2026-11-04', null, 'Europe/Oslo', null);
insert into public.tasks (id, user_id, title, domain, google_target, schedule_block_id, occurrence_date, due_date) values
  ('13000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Swim', 'personal', 'calendar', '12000000-0000-0000-0000-000000000001', '2026-11-30', '2026-11-30'),
  ('13000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Upper A', 'personal', 'calendar', '12000000-0000-0000-0000-000000000002', '2026-12-01', '2026-12-01');

-- Google Tasks' sign-in, and Google Calendar work waiting (made by the triggers above, plus a delete of a gone slot).
insert into public.user_calendar_tokens (user_id, refresh_token) values ('00000000-0000-0000-0000-000000000001', 'example-refresh');
insert into public.calendar_outbox (user_id, calendar_id, event_id, operation, payload)
  values ('00000000-0000-0000-0000-000000000001', 'primary', 'deadbeefdeadbeef', 'delete', '{"title": "Gone"}');
update public.time_blocks set title = 'Dentist (moved)' where id = '11000000-0000-0000-0000-000000000001';

-- User 3: Training on Google with past workouts (never in Apple), iCloud connected.
insert into public.calendar_prefs (user_id, prefs) values
  ('00000000-0000-0000-0000-000000000003', '{"areas": {"training": {"name": "Lasci · Training", "app": "google", "enabled": true}}}');
insert into public.icloud_credentials (user_id, apple_id, app_password) values
  ('00000000-0000-0000-0000-000000000003', 'kari.nordmann@example.com', 'sealed:example');
insert into public.hevy_workouts (id, user_id, title, start_time, end_time) values
  ('hevy-example-1', '00000000-0000-0000-0000-000000000003', 'Lower B', '2026-11-20 16:00+00', '2026-11-20 17:00+00');
delete from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000003';

create table public.t_before as
  select (select count(*) from public.icloud_outbox) as icloud_rows,
         (select count(*) from public.google_tasks_outbox) as tasks_rows,
         (select count(*) from public.calendar_outbox) as calendar_rows;
