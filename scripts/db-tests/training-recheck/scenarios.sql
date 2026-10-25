-- Migration 166 (a moved training session is moved): a session completed by
-- another workout and then postponed, a move inside the workout's six days, a
-- session moved onto the day it was done, a missed day moved, a skip moved, a
-- session ticked by hand, a repeat's day moved without its slot (Google
-- Tasks, the assistant), and the one-off repair. Days are relative to today
-- (Europe/Oslo), as the rule reads them. Setup and checks run as the
-- superuser; moves run as `authenticated`, like the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
-- today ± n days, as the rule sees it
create or replace function public.t_d(n integer) returns date language sql stable as $$
  select (now() at time zone 'Europe/Oslo')::date + n
$$;
grant execute on function public.t_d(integer) to authenticated;
-- a moment on day n at hh:mm, Oslo time
create or replace function public.t_at(n integer, hhmm text) returns timestamptz language sql stable as $$
  select ((public.t_d(n)::text || ' ' || hhmm)::timestamp at time zone 'Europe/Oslo')
$$;
grant execute on function public.t_at(integer, text) to authenticated;

insert into public.hevy_routines (id, user_id, title) values
  ('r-lower', '00000000-0000-0000-0000-000000000001', 'Lower B'),
  ('r-upper', '00000000-0000-0000-0000-000000000001', 'Upper B');

-- A one-off session on day n at hh:mm, with its slot (as the Add sheet and 142 make it).
create or replace function public.t_session(p_id uuid, p_title text, p_routine text, n integer, hhmm text) returns void language plpgsql as $$
begin
  insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id)
  values (p_id, '00000000-0000-0000-0000-000000000001', p_title, 'personal', 'backlog', 'open', 'medium',
          public.t_d(n), hhmm::time, 'training_session', p_routine);
  insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, category, task_id, source_type)
  values ('00000000-0000-0000-0000-000000000001', public.t_d(n), p_title, hhmm::time, 60, 'training', p_id, 'training_session');
end $$;

-- ═══ 0. Migration 166 itself ═══════════════════════════════════════════════
select public.t_ok(exists (select 1 from pg_trigger where tgname = 'trg_training_task_recheck' and tgrelid = 'public.tasks'::regclass),
  '166: the trigger is on tasks');
select public.t_ok(not has_function_privilege('authenticated', 'public.training_task_recheck(uuid)', 'execute'),
  '166: the recheck is not callable from the browser');
select public.t_ok('trg_repeat_day_task_moved' < 'trg_training_task_recheck' and 'trg_training_task_moves_block' < 'trg_training_task_recheck',
  '166: it runs after 156''s and 142''s move triggers (name order)');

-- ═══ 1. The report: done by another workout, then postponed ═══════════════
-- Lower B planned 4 days ago; that day only an Upper B workout was logged:
-- 141's "the one plan that day" gave the Lower B session to it.
select public.t_session('00000000-0000-4000-8000-00000000c001', 'Lower B (Hamstrings & Soleus Kalf)', 'r-lower', -4, '13:30');
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-upper-4', '00000000-0000-0000-0000-000000000001', 'Upper B', 'r-upper', public.t_at(-4, '18:00'), public.t_at(-4, '18:50'));
select public.t_ok((select status = 'done' and hevy_workout_id = 'w-upper-4' from public.tasks where id = '00000000-0000-4000-8000-00000000c001'),
  'before: 141 gave the Lower B session to the Upper B workout of its day');
-- Two days ago the real Lower B workout: the session already has a workout, so nothing takes it.
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-lower-2', '00000000-0000-0000-0000-000000000001', 'Lower B', 'r-lower', public.t_at(-2, '17:18'), public.t_at(-2, '17:59'));
select public.t_ok(not exists (select 1 from public.tasks where hevy_workout_id = 'w-lower-2'),
  'before: the Lower B workout two days ago completes nothing');

-- The session is postponed to two days ago (Move: its slot moves, 142 moves the task).
set role authenticated;
update public.time_blocks set date = public.t_d(-2) where task_id = '00000000-0000-4000-8000-00000000c001';
reset role;
select public.t_ok((select status = 'done' and hevy_workout_id = 'w-lower-2' and due_date = public.t_d(-2)
                           and completed_at = public.t_at(-2, '17:59')
                      from public.tasks where id = '00000000-0000-4000-8000-00000000c001'),
  'moved onto the day it was done: completed by that day''s Lower B workout');
select public.t_ok(not exists (select 1 from public.tasks where hevy_workout_id = 'w-upper-4'),
  'the Upper B workout it held is free (no plan of its own that day)');

-- ═══ 2. Postponed to a day still to come ══════════════════════════════════
select public.t_session('00000000-0000-4000-8000-00000000c002', 'Upper B (Shoulder, Back, Arm)', 'r-upper', -3, '18:00');
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-lower-3', '00000000-0000-0000-0000-000000000001', 'Lower B', 'r-lower', public.t_at(-3, '18:05'), public.t_at(-3, '18:45'));
select public.t_ok((select status = 'done' and hevy_workout_id = 'w-lower-3' from public.tasks where id = '00000000-0000-4000-8000-00000000c002'),
  'before: an Upper B session done by a Lower B workout (141''s one plan that day)');
set role authenticated;
update public.time_blocks set date = public.t_d(2) where task_id = '00000000-0000-4000-8000-00000000c002';
reset role;
select public.t_ok((select status = 'open' and hevy_workout_id is null and completed_at is null and due_date = public.t_d(2)
                      from public.tasks where id = '00000000-0000-4000-8000-00000000c002'),
  'postponed past the workout''s days: to do on its new day, no workout, no completion time');
select public.t_ok(not exists (select 1 from public.tasks where hevy_workout_id = 'w-lower-3'),
  'that workout is free again');

-- ═══ 3. Moved inside the workout's six days: nothing changes ═════════════
select public.t_session('00000000-0000-4000-8000-00000000c003', 'Lower B', 'r-lower', -6, '07:00');
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-lower-6', '00000000-0000-0000-0000-000000000001', 'Lower B', 'r-lower', public.t_at(-6, '07:05'), public.t_at(-6, '07:50'));
set role authenticated;
update public.time_blocks set date = public.t_d(-8) where task_id = '00000000-0000-4000-8000-00000000c003';
reset role;
select public.t_ok((select status = 'done' and hevy_workout_id = 'w-lower-6' and completed_at = public.t_at(-6, '07:50')
                      from public.tasks where id = '00000000-0000-4000-8000-00000000c003'),
  'moved two days earlier: the workout still fits (its day is within six days after) — it stays done by it');

-- ═══ 4. An open session moved onto a day whose workout already synced ════
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-upper-1', '00000000-0000-0000-0000-000000000001', 'Upper B', 'r-upper', public.t_at(-1, '12:00'), public.t_at(-1, '12:45'));
select public.t_session('00000000-0000-4000-8000-00000000c004', 'Upper B', 'r-upper', 3, '18:00');
set role authenticated;
-- moved by its day alone (an assistant or Google Tasks write): 142 moves the slot
update public.tasks set due_date = public.t_d(-1) where id = '00000000-0000-4000-8000-00000000c004';
reset role;
select public.t_ok((select status = 'done' and hevy_workout_id = 'w-upper-1' from public.tasks where id = '00000000-0000-4000-8000-00000000c004')
                   and (select date = public.t_d(-1) from public.time_blocks where task_id = '00000000-0000-4000-8000-00000000c004'),
  'moved back onto the day it was done: its slot follows (142) and that day''s workout completes it');

-- ═══ 5. Ticked by hand, then moved: stays done ═══════════════════════════
select public.t_session('00000000-0000-4000-8000-00000000c005', 'Upper B', 'r-upper', 5, '18:00');
update public.tasks set status = 'done' where id = '00000000-0000-4000-8000-00000000c005';
set role authenticated;
update public.time_blocks set date = public.t_d(6) where task_id = '00000000-0000-4000-8000-00000000c005';
reset role;
select public.t_ok((select status = 'done' and hevy_workout_id is null from public.tasks where id = '00000000-0000-4000-8000-00000000c005'),
  'a session ticked by hand (no workout) stays done when moved');

-- ═══ 6. A repeat's day: missed, skipped, moved without its slot ══════════
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'Lower B', '{0,1,2,3,4,5,6}', '17:00', '18:00',
        'training', public.t_d(-30));
-- three of its days made as tasks (156), no slot: one passed unticked (missed), one skipped, one to come
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id,
                          schedule_block_id, occurrence_date, closed_reason, completed_at) values
  ('00000000-0000-4000-8000-00000000c061', '00000000-0000-0000-0000-000000000001', 'Lower B', 'personal', 'backlog', 'cancelled', 'medium',
   public.t_d(-10), '17:00', 'training_session', 'r-lower', '00000000-0000-4000-8000-0000000000e1', public.t_d(-10), 'missed', public.t_at(-10, '23:59')),
  ('00000000-0000-4000-8000-00000000c062', '00000000-0000-0000-0000-000000000001', 'Lower B', 'personal', 'backlog', 'open', 'medium',
   public.t_d(-11), '17:00', 'training_session', 'r-lower', '00000000-0000-4000-8000-0000000000e1', public.t_d(-11), null, null),
  ('00000000-0000-4000-8000-00000000c063', '00000000-0000-0000-0000-000000000001', 'Lower B', 'personal', 'today', 'open', 'medium',
   public.t_d(1), '17:00', 'training_session', 'r-lower', '00000000-0000-4000-8000-0000000000e1', public.t_d(1), null, null);
insert into public.training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
values ('00000000-0000-0000-0000-000000000001', 'r-lower', date_trunc('week', public.t_d(-11))::date, 'Sick', '00000000-0000-4000-8000-00000000c062', public.t_d(-11));
select public.t_ok((select status = 'cancelled' and closed_reason is null from public.tasks where id = '00000000-0000-4000-8000-00000000c062'),
  'before: a skipped day is cancelled with its reason (142)');

set role authenticated;
update public.tasks set due_date = public.t_d(2) where id = '00000000-0000-4000-8000-00000000c061';
update public.tasks set due_date = public.t_d(3) where id = '00000000-0000-4000-8000-00000000c062';
update public.tasks set due_date = public.t_d(4), due_time = '19:00' where id = '00000000-0000-4000-8000-00000000c063';
reset role;

select public.t_ok((select status = 'open' and closed_reason is null and completed_at is null from public.tasks where id = '00000000-0000-4000-8000-00000000c061'),
  'a missed day moved is to do on its new day (moved, not missed)');
select public.t_ok((select status = 'cancelled' and closed_reason is null from public.tasks where id = '00000000-0000-4000-8000-00000000c062')
                   and exists (select 1 from public.training_skips where task_id = '00000000-0000-4000-8000-00000000c062' and reason = 'Sick'),
  'a skipped day moved stays skipped, with its reason');
select public.t_ok((select count(*) = 1 and min(date) = public.t_d(2) from public.time_blocks where task_id = '00000000-0000-4000-8000-00000000c061')
                   and (select count(*) = 1 and min(date) = public.t_d(4) and min(start_time) = '19:00'
                          from public.time_blocks where task_id = '00000000-0000-4000-8000-00000000c063'),
  'a repeat''s day moved without its slot gets one where it went (156''s split), with its new time');
select public.t_ok((select public.t_d(-10) = any (except_dates) and public.t_d(1) = any (except_dates)
                      from public.schedule_blocks where id = '00000000-0000-4000-8000-0000000000e1'),
  'its own days are out of the repeat (the repeat no longer shows them there)');
select public.t_ok((select occurrence_date = public.t_d(1) and schedule_block_id = '00000000-0000-4000-8000-0000000000e1'
                      from public.time_blocks where task_id = '00000000-0000-4000-8000-00000000c063'),
  'the slot is that day of the repeat (one task, one slot — never a second task)');
select public.t_ok((select count(*) from public.tasks where schedule_block_id = '00000000-0000-4000-8000-0000000000e1') = 3,
  'no task made by the split');

-- ═══ 7. Not training: untouched ══════════════════════════════════════════
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, hevy_workout_id)
values ('00000000-0000-4000-8000-00000000c071', '00000000-0000-0000-0000-000000000001', 'Call the bank', 'personal', 'backlog', 'done', 'medium',
        public.t_d(-1), null);
set role authenticated;
update public.tasks set due_date = public.t_d(5) where id = '00000000-0000-4000-8000-00000000c071';
reset role;
select public.t_ok((select status = 'done' from public.tasks where id = '00000000-0000-4000-8000-00000000c071')
                   and not exists (select 1 from public.time_blocks where task_id = '00000000-0000-4000-8000-00000000c071'),
  'a task that isn''t training moves as before');

-- ═══ 8. The one-off repair (docs/deploy-checklist.md) ═════════════════════
-- A session left in the reported state before 166 (written past the trigger, as the old moves did).
select public.t_session('00000000-0000-4000-8000-00000000c081', 'Lower B', 'r-lower', -9, '13:30');
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-upper-9', '00000000-0000-0000-0000-000000000001', 'Upper B', 'r-upper', public.t_at(-9, '18:00'), public.t_at(-9, '18:50'));
-- Its own routine's workout synced first (141's take-over only works for a plan already on the workout's day) …
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-lower-7', '00000000-0000-0000-0000-000000000001', 'Lower B', 'r-lower', public.t_at(-7, '17:18'), public.t_at(-7, '17:59'));
-- … then the session was moved onto that day.
alter table public.tasks disable trigger trg_training_task_recheck;
update public.time_blocks set date = public.t_d(-7) where task_id = '00000000-0000-4000-8000-00000000c081';
alter table public.tasks enable trigger trg_training_task_recheck;
select public.t_ok((select status = 'done' and hevy_workout_id = 'w-upper-9' and due_date = public.t_d(-7)
                      from public.tasks where id = '00000000-0000-4000-8000-00000000c081'),
  'before the repair: done on its new day by the old day''s workout (the report''s state)');
create temp table t_repair as
select t.id
  from public.tasks t
  join public.hevy_workouts w on w.id = t.hevy_workout_id
 where (t.hevy_routine_id is not null or t.source_type = 'training_session')
   and (w.start_time at time zone 'Europe/Oslo')::date not between
       coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id), t.due_date)
       and coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id), t.due_date) + 6;
select public.t_ok((select count(*) from t_repair) = 1, 'the repair''s list finds exactly that session');
select public.training_task_recheck(id) from t_repair;
select public.t_ok((select status = 'done' and hevy_workout_id = 'w-lower-7' from public.tasks where id = '00000000-0000-4000-8000-00000000c081')
                   and not exists (select 1 from public.tasks where hevy_workout_id = 'w-upper-9'),
  'after the repair: completed by its own day''s workout, the other one free');
-- Run twice: nothing changes.
create temp table t_before as select id, status, hevy_workout_id, completed_at from public.tasks;
select public.training_task_recheck(id) from public.tasks where hevy_routine_id is not null;
select public.t_ok(not exists (
  select 1 from t_before b join public.tasks t using (id)
   where (b.status, b.hevy_workout_id, b.completed_at) is distinct from (t.status, t.hevy_workout_id, t.completed_at)),
  'the recheck on rows already right changes nothing');
