-- Scenarios for migration 142 (one planned training session, one model).
-- Each `ok` raises on a mismatch; the runner fails on the first one.
\set u '00000000-0000-0000-0000-000000000001'
create or replace function ok(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;

-- A0 the pre-142 drift was aligned once: the block's day and time win
select ok('A0 old task takes its block''s day', (select due_date::text||' '||due_time::text from tasks where id='99999999-0000-4000-8000-000000000099'), '2026-10-14 17:00:00');
select ok('A0 the block did not move', (select date::text||' '||start_time::text from time_blocks where id='b9999999-0000-4000-8000-000000000099'), '2026-10-14 17:00:00');
select ok('A0 112''s routine skip survives', (select reason from training_skips where routine_id='bbbbbbbb-0000-4000-8000-00000000000b' and task_id is null), 'Holiday');

-- S1 moving the block moves the task
insert into tasks (id,user_id,title,due_date,source_type,source_id) values ('11111111-0000-4000-8000-000000000001', :'u', 'Lower B', '2026-10-11', 'training_session', 'aaaaaaaa-0000-4000-8000-00000000000a');
insert into time_blocks (id,user_id,task_id,date,start_time,title) values ('b1111111-0000-4000-8000-000000000001', :'u','11111111-0000-4000-8000-000000000001','2026-10-11','14:30','Lower B');
select ok('S1 a new block stamps the task''s time', (select due_time::text from tasks where id='11111111-0000-4000-8000-000000000001'), '14:30:00');
update time_blocks set date='2026-10-12', start_time='18:00' where id='b1111111-0000-4000-8000-000000000001';
select ok('S1 block move moves the task''s day', (select due_date::text from tasks where id='11111111-0000-4000-8000-000000000001'), '2026-10-12');
select ok('S1 …and its time', (select due_time::text from tasks where id='11111111-0000-4000-8000-000000000001'), '18:00:00');
-- S2 moving the task moves the block
update tasks set due_date='2026-10-14' where id='11111111-0000-4000-8000-000000000001';
select ok('S2 task day moves the block', (select date::text from time_blocks where id='b1111111-0000-4000-8000-000000000001'), '2026-10-14');
select ok('S2 the block keeps its time', (select start_time::text from time_blocks where id='b1111111-0000-4000-8000-000000000001'), '18:00:00');
update tasks set due_time='07:15' where id='11111111-0000-4000-8000-000000000001';
select ok('S2 task time moves the block''s time', (select start_time::text from time_blocks where id='b1111111-0000-4000-8000-000000000001'), '07:15:00');
-- S3 clearing the deadline is not a move
update tasks set due_date=null where id='11111111-0000-4000-8000-000000000001';
select ok('S3 cleared deadline keeps the block''s day', (select date::text from time_blocks where id='b1111111-0000-4000-8000-000000000001'), '2026-10-14');
update time_blocks set date='2026-10-15' where id='b1111111-0000-4000-8000-000000000001';
select ok('S3 a block move restores the task''s day', (select due_date::text from tasks where id='11111111-0000-4000-8000-000000000001'), '2026-10-15');
-- S3b a write that re-sends the same day (a Google Tasks snapshot) never drags the block
update tasks set title='Lower B', due_date=due_date, due_time=due_time where id='11111111-0000-4000-8000-000000000001';
select ok('S3b re-sent deadline: the block stays', (select date::text||' '||start_time::text from time_blocks where id='b1111111-0000-4000-8000-000000000001'), '2026-10-15 07:15:00');
-- S3c a block write that re-sends its own day leaves the task alone
update tasks set due_date='2026-10-15' where id='11111111-0000-4000-8000-000000000001';
update time_blocks set title='Lower B' where id='b1111111-0000-4000-8000-000000000001';
select ok('S3c block edit without a move: task unchanged', (select due_date::text from tasks where id='11111111-0000-4000-8000-000000000001'), '2026-10-15');

-- S4 an ordinary task keeps 077's independence
insert into tasks (id,user_id,title,due_date) values ('44444444-0000-4000-8000-000000000004', :'u', 'Dentist', '2026-10-20');
insert into time_blocks (id,user_id,task_id,date,start_time,title,category) values ('b4444444-0000-4000-8000-000000000004', :'u','44444444-0000-4000-8000-000000000004','2026-10-18','09:00','Dentist','health');
update time_blocks set date='2026-10-19' where id='b4444444-0000-4000-8000-000000000004';
select ok('S4 plain task: deadline untouched', (select due_date::text from tasks where id='44444444-0000-4000-8000-000000000004'), '2026-10-20');
update tasks set due_date='2026-10-25' where id='44444444-0000-4000-8000-000000000004';
select ok('S4 plain task: block untouched', (select date::text from time_blocks where id='b4444444-0000-4000-8000-000000000004'), '2026-10-19');
-- S5 a typed task named like a routine (141) is a training task too
insert into tasks (id,user_id,title,due_date) values ('55555555-0000-4000-8000-000000000005', :'u', 'upper a', '2026-10-13');
select ok('S5 linked by title', (select hevy_routine_id from tasks where id='55555555-0000-4000-8000-000000000005'), 'bbbbbbbb-0000-4000-8000-00000000000b');
insert into time_blocks (id,user_id,task_id,date,start_time,title) values ('b5555555-0000-4000-8000-000000000005', :'u','55555555-0000-4000-8000-000000000005','2026-10-13','17:00','Upper A');
update tasks set due_date='2026-10-16' where id='55555555-0000-4000-8000-000000000005';
select ok('S5 it moves its block', (select date::text from time_blocks where id='b5555555-0000-4000-8000-000000000005'), '2026-10-16');

-- S6 a skip with a task cancels it; deleting the skip reopens it
insert into training_skips (id,user_id,week_start,reason,task_id,plan_date) values ('a6666666-0000-4000-8000-000000000006', :'u','2026-10-12','Sick — flu','11111111-0000-4000-8000-000000000001','2026-10-15');
select ok('S6 skip cancels the task', (select status from tasks where id='11111111-0000-4000-8000-000000000001'), 'cancelled');
select ok('S6 the skip names the task''s routine', (select routine_id from training_skips where id='a6666666-0000-4000-8000-000000000006'), 'aaaaaaaa-0000-4000-8000-00000000000a');
select ok('S6 one skip row, its reason kept', (select count(*)::text||' '||max(reason) from training_skips where task_id='11111111-0000-4000-8000-000000000001'), '1 Sick — flu');
delete from training_skips where id='a6666666-0000-4000-8000-000000000006';
select ok('S6 Undo reopens the task', (select status from tasks where id='11111111-0000-4000-8000-000000000001'), 'open');
-- S7 cancelling a training task by any writer records a skip; reopening removes it
update tasks set status='cancelled' where id='11111111-0000-4000-8000-000000000001';
select ok('S7 cancel records a skip', (select reason from training_skips where task_id='11111111-0000-4000-8000-000000000001'), 'Cancelled — no reason given');
select ok('S7 filed under the planned week', (select week_start::text||' '||plan_date::text from training_skips where task_id='11111111-0000-4000-8000-000000000001'), '2026-10-12 2026-10-15');
update tasks set status='open' where id='11111111-0000-4000-8000-000000000001';
select ok('S7 reopen removes the skip', (select count(*)::text from training_skips where task_id='11111111-0000-4000-8000-000000000001'), '0');
-- S8 an ordinary task cancelled records nothing
update tasks set status='cancelled' where id='44444444-0000-4000-8000-000000000004';
select ok('S8 plain cancel: no skip', (select count(*)::text from training_skips where task_id='44444444-0000-4000-8000-000000000004'), '0');

-- S9 two sessions of one routine in one week each keep their own skip and reason
insert into tasks (id,user_id,title,due_date,source_type,source_id) values ('10101010-0000-4000-8000-000000000010', :'u', 'Lower B', '2026-10-17', 'training_session', 'aaaaaaaa-0000-4000-8000-00000000000a');
insert into training_skips (user_id,week_start,reason,task_id,plan_date) values (:'u','2026-10-12','Sick','11111111-0000-4000-8000-000000000001','2026-10-15');
insert into training_skips (user_id,week_start,reason,task_id,plan_date) values (:'u','2026-10-12','Travel','10101010-0000-4000-8000-000000000010','2026-10-17')
  on conflict (task_id) do update set reason=excluded.reason;
select ok('S9 two rows, two reasons', (select string_agg(reason, ',' order by reason) from training_skips where routine_id='aaaaaaaa-0000-4000-8000-00000000000a' and task_id is not null), 'Sick,Travel');
select ok('S9 both cancelled', (select string_agg(status, ',') from tasks where id in ('11111111-0000-4000-8000-000000000001','10101010-0000-4000-8000-000000000010')), 'cancelled,cancelled');
delete from training_skips where task_id='10101010-0000-4000-8000-000000000010';
select ok('S9 Undo one: the other stays skipped', (select status from tasks where id='11111111-0000-4000-8000-000000000001'), 'cancelled');
select ok('S9 …with its own reason', (select reason from training_skips where task_id='11111111-0000-4000-8000-000000000001'), 'Sick');
-- S9b a missed-routine skip of the same week lives beside them and survives an Undo
insert into training_skips (user_id,routine_id,week_start,reason) values (:'u','aaaaaaaa-0000-4000-8000-00000000000a','2026-10-12','Holiday');
delete from training_skips where task_id='11111111-0000-4000-8000-000000000001';
select ok('S9b the Missed-sessions row survives', (select reason from training_skips where routine_id='aaaaaaaa-0000-4000-8000-00000000000a' and week_start='2026-10-12' and task_id is null), 'Holiday');
do $$ begin
  insert into training_skips (user_id,routine_id,week_start,reason) values ('00000000-0000-0000-0000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a','2026-10-12','Again');
  raise exception 'FAIL S9b one missed-routine skip per routine and week';
exception when unique_violation then raise notice 'ok  S9b one missed-routine skip per routine and week';
end $$;
-- S9c re-skipping the same session replaces its reason (one row per task)
insert into training_skips (user_id,week_start,reason,task_id,plan_date) values (:'u','2026-10-12','First','10101010-0000-4000-8000-000000000010','2026-10-17');
insert into training_skips (user_id,week_start,reason,task_id,plan_date) values (:'u','2026-10-12','Second','10101010-0000-4000-8000-000000000010','2026-10-17')
  on conflict (task_id) do update set reason=excluded.reason;
select ok('S9c one row per session', (select count(*)::text||' '||max(reason) from training_skips where task_id='10101010-0000-4000-8000-000000000010'), '1 Second');

-- S11 a freeform plan (no routine) can be skipped
insert into tasks (id,user_id,title,due_date,source_type) values ('12121212-0000-4000-8000-000000000012', :'u', 'Training', '2026-10-13', 'training_session');
update tasks set status='cancelled' where id='12121212-0000-4000-8000-000000000012';
select ok('S11 freeform skip row', (select coalesce(routine_id,'none') from training_skips where task_id='12121212-0000-4000-8000-000000000012'), 'none');
-- S12 deleting a skipped task removes its skip (cascade)
delete from tasks where id='12121212-0000-4000-8000-000000000012';
select ok('S12 cascade', (select count(*)::text from training_skips where task_id='12121212-0000-4000-8000-000000000012'), '0');
-- S13 a done task is not cancelled by a skip row
update tasks set status='done' where id='55555555-0000-4000-8000-000000000005';
insert into training_skips (user_id,week_start,reason,task_id) values (:'u','2026-10-12','Late','55555555-0000-4000-8000-000000000005');
select ok('S13 done stays done', (select status from tasks where id='55555555-0000-4000-8000-000000000005'), 'done');
-- S14 141 still completes a moved plan
delete from training_skips where task_id='11111111-0000-4000-8000-000000000001';
update tasks set status='open' where id='11111111-0000-4000-8000-000000000001';
update time_blocks set date='2026-10-16' where id='b1111111-0000-4000-8000-000000000001';
insert into hevy_workouts values ('w1', :'u', 'Lower B', 'aaaaaaaa-0000-4000-8000-00000000000a', '2026-10-16 18:00+02', '2026-10-16 19:00+02');
select ok('S14 a workout closes the moved plan', (select status||' '||hevy_workout_id from tasks where id='11111111-0000-4000-8000-000000000001'), 'done w1');

-- S15 one day of a weekly plan as a plan of its own
insert into schedule_blocks (id,user_id,title,days_of_week,start_time,end_time) values ('5c000000-0000-4000-8000-000000000001', :'u','Upper A','{1,4}','17:00','18:00');
insert into time_blocks (user_id,date,start_time,title,schedule_block_id,occurrence_date) values (:'u','2026-10-13','17:00','Upper A','5c000000-0000-4000-8000-000000000001','2026-10-12');
do $$ begin
  insert into time_blocks (user_id,date,start_time,title,schedule_block_id,occurrence_date) values ('00000000-0000-0000-0000-000000000001','2026-10-14','17:00','Upper A','5c000000-0000-4000-8000-000000000001','2026-10-12');
  raise exception 'FAIL S15 duplicate occurrence allowed';
exception when unique_violation then raise notice 'ok  S15 one block per weekly day';
end $$;
select ok('S15 the weekly plan leaves that day out', (select except_dates::text from schedule_blocks where id='5c000000-0000-4000-8000-000000000001'), '{2026-10-12}');
update time_blocks set date='2026-10-20' where occurrence_date='2026-10-12';
select ok('S15 moving keeps the day out', (select except_dates::text from schedule_blocks where id='5c000000-0000-4000-8000-000000000001'), '{2026-10-12}');
delete from schedule_blocks where id='5c000000-0000-4000-8000-000000000001';
select ok('S15 deleting the weekly plan keeps the block', (select count(*)::text||' '||coalesce(max(schedule_block_id::text),'null') from time_blocks where occurrence_date='2026-10-12'), '1 null');
-- S16 a skip needs a routine or a task
do $$ begin
  insert into training_skips (user_id,week_start,reason) values ('00000000-0000-0000-0000-000000000001','2026-10-12','Nothing');
  raise exception 'FAIL S16';
exception when check_violation then raise notice 'ok  S16 a routine or a task is required';
end $$;
-- S17 a training_session task with no routine id links by its title
insert into tasks (id,user_id,title,due_date,source_type) values ('17171717-0000-4000-8000-000000000017', :'u', 'Upper A', '2026-10-20', 'training_session');
select ok('S17 linked by title', (select hevy_routine_id from tasks where id='17171717-0000-4000-8000-000000000017'), 'bbbbbbbb-0000-4000-8000-00000000000b');
