-- Rows that exist before 141/142 run (as on production).
insert into hevy_routines values ('aaaaaaaa-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Lower B'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Upper A');
-- A plan whose block was moved (+1d in the agenda) before 142: the task kept
-- its old deadline. 142 aligns it to the block.
insert into tasks (id,user_id,title,due_date,due_time,source_type,source_id) values
  ('99999999-0000-4000-8000-000000000099', '00000000-0000-0000-0000-000000000001', 'Lower B', '2026-10-16', '18:00', 'training_session', 'aaaaaaaa-0000-4000-8000-00000000000a');
insert into time_blocks (id,user_id,task_id,date,start_time,title) values
  ('b9999999-0000-4000-8000-000000000099', '00000000-0000-0000-0000-000000000001', '99999999-0000-4000-8000-000000000099', '2026-10-14', '17:00', 'Lower B');
-- A skip of a missed routine (Missed sessions), made under 112.
insert into training_skips (user_id, routine_id, week_start, reason) values
  ('00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000000b', '2026-10-05', 'Holiday');
