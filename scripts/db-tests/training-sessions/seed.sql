-- Migration 213's "before" (scripts/verify-db-training-sessions.mjs loads it after 211, on the item chain): the four
-- routines of a made-up upper/lower program in the current program (084), a routine of the second account, and — for
-- 213's look-again of the last two weeks — a session done a day early, which 211's rules left open. Made-up data only.
insert into public.hevy_routines (id, user_id, title) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Upper A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Lower A'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Upper B'),
  ('bbbbbbbb-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Lower B'),
  ('bbbbbbbb-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Mobility'),
  ('bbbbbbbb-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', 'Upper A');
insert into public.current_program_routines (user_id, routine_id) values
  ('00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000009');

-- Done a day early, three days ago: under 211 the session stays open.
insert into public.tasks (id, user_id, title, source_type, hevy_routine_id, due_date) values
  ('96000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Upper B', 'training_session',
   'bbbbbbbb-0000-0000-0000-000000000003', (now() at time zone 'Europe/Oslo')::date - 2);
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('back-1', '00000000-0000-0000-0000-000000000001', 'Upper B', 'bbbbbbbb-0000-0000-0000-000000000003',
   ((now() at time zone 'Europe/Oslo')::date - 3 + time '17:00') at time zone 'Europe/Oslo',
   ((now() at time zone 'Europe/Oslo')::date - 3 + time '18:00') at time zone 'Europe/Oslo');
