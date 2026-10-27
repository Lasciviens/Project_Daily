-- Migration 167 (a workout represents itself, a session lives one week):
-- only a workout of its own routine completes a session (a stand-in only
-- where a routine is missing), a skipped session done inside its week is
-- done, a skipped session moved to today or later inside its week is to do,
-- a move of 7 or more days skips it in its own week and moves that week's
-- session of the same plan instead (or plans a new one-off), and the end of
-- its week skips a session still to do on its first day. Runs after 166's
-- scenarios, on account 2 (account 1 holds 166's rows). Days are relative
-- to today (Europe/Oslo), as the rules read them. Setup and checks run as
-- the superuser; moves run as `authenticated` (account 2), like the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create or replace function public.t_d(n integer) returns date language sql stable as $$
  select (now() at time zone 'Europe/Oslo')::date + n
$$;
grant execute on function public.t_d(integer) to authenticated;
create or replace function public.t_at(n integer, hhmm text) returns timestamptz language sql stable as $$
  select ((public.t_d(n)::text || ' ' || hhmm)::timestamp at time zone 'Europe/Oslo')
$$;
grant execute on function public.t_at(integer, text) to authenticated;

-- Account 2's one-off session on day n at hh:mm, with its slot.
create or replace function public.t2_session(p_id uuid, p_title text, p_routine text, n integer, hhmm text) returns void language plpgsql as $$
begin
  insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id)
  values (p_id, '00000000-0000-0000-0000-000000000002', p_title, 'personal', 'backlog', 'open', 'medium',
          public.t_d(n), hhmm::time, 'training_session', p_routine);
  insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, category, task_id, source_type)
  values ('00000000-0000-0000-0000-000000000002', public.t_d(n), p_title, hhmm::time, 60, 'training', p_id, 'training_session');
end $$;
create or replace function public.t2_workout(p_id text, p_routine text, n integer, hhmm text) returns void language plpgsql as $$
begin
  insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time)
  values (p_id, '00000000-0000-0000-0000-000000000002', coalesce(p_routine, 'Free run'), p_routine,
          public.t_at(n, hhmm), public.t_at(n, hhmm) + interval '45 minutes');
end $$;
-- The task's day now, and its skip's reason.
create or replace function public.t_day_of(p_id uuid) returns date language sql stable as $$
  select coalesce((select min(b.date) from public.time_blocks b where b.task_id = p_id), (select due_date from public.tasks where id = p_id))
$$;
create or replace function public.t_skip_of(p_id uuid) returns text language sql stable as $$
  select reason from public.training_skips where task_id = p_id
$$;

insert into public.hevy_routines (id, user_id, title) values
  ('r2-lower', '00000000-0000-0000-0000-000000000002', 'Lower B'),
  ('r2-upper', '00000000-0000-0000-0000-000000000002', 'Upper B');

-- ═══ 0. Migration 167 itself ═══════════════════════════════════════════════
select public.t_ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'first_plan_date'),
  '167: tasks.first_plan_date exists');
select public.t_ok(not has_function_privilege('authenticated', 'public.training_move_past_week(uuid, date, time, time)', 'execute')
                   and not has_function_privilege('authenticated', 'public.training_task_recheck(uuid)', 'execute'),
  '167: the move rule and the recheck are not callable from the browser');
select public.t_ok((select count(*) = 0 from public.tasks
                     where (hevy_routine_id is not null or source_type = 'training_session') and first_plan_date is null),
  '167: every training session made before it has its first day (backfill)');
select public.t_ok((select first_plan_date = public.t_d(2) from public.tasks where id = '00000000-0000-4000-8000-00000000c061')
                   and (select first_plan_date = public.t_d(1) from public.tasks where id = '00000000-0000-4000-8000-00000000c063'),
  '167: a repeat''s day moved out of its week before 167 starts its week where it is planned now; one moved inside it keeps its own day');

-- ═══ 1. A session's first day ════════════════════════════════════════════
select public.t2_session('00000000-0000-4000-8000-0000000d0101', 'Lower B', 'r2-lower', 3, '17:00');
select public.t_ok((select first_plan_date = public.t_d(3) from public.tasks where id = '00000000-0000-4000-8000-0000000d0101'),
  'a new session''s first day is the day it is planned for');
set test.uid = '00000000-0000-0000-0000-000000000002';
set role authenticated;
update public.time_blocks set date = public.t_d(5) where task_id = '00000000-0000-4000-8000-0000000d0101';
reset role;
select public.t_ok((select first_plan_date = public.t_d(3) and due_date = public.t_d(5) and status = 'open' from public.tasks where id = '00000000-0000-4000-8000-0000000d0101'),
  'moved 2 days: just moved — to do on its new day, its first day kept');

-- ═══ 2. A workout represents itself ══════════════════════════════════════
-- Lower B planned 5 days ago; that day only an Upper B workout.
select public.t2_session('00000000-0000-4000-8000-0000000d0201', 'Lower B', 'r2-lower', -5, '13:30');
select public.t2_workout('w2-upper-5', 'r2-upper', -5, '18:00');
select public.t_ok((select status = 'open' and hevy_workout_id is null from public.tasks where id = '00000000-0000-4000-8000-0000000d0201')
                   and not exists (select 1 from public.tasks where hevy_workout_id = 'w2-upper-5'),
  'an Upper B workout never completes a Lower B session (no stand-in between two routines)');

-- An Upper B session 3 days ago, still open; that Upper B workout 5 days ago is before it — free.
-- An Upper B workout today completes the open Upper B from 3 days ago (late), not today's Lower B.
select public.t2_session('00000000-0000-4000-8000-0000000d0202', 'Upper B', 'r2-upper', -3, '18:00');
select public.t2_session('00000000-0000-4000-8000-0000000d0203', 'Lower B', 'r2-lower', 0, '07:00');
select public.t2_workout('w2-upper-0', 'r2-upper', 0, '06:00');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-upper-0' from public.tasks where id = '00000000-0000-4000-8000-0000000d0202')
                   and (select status = 'open' and hevy_workout_id is null from public.tasks where id = '00000000-0000-4000-8000-0000000d0203'),
  'its own routine''s open session from earlier that week takes it (done late); the day''s Lower B stays to do');

-- A workout with no routine still stands in for the one session that day.
select public.t2_session('00000000-0000-4000-8000-0000000d0204', 'Lower B', 'r2-lower', -12, '17:00');
select public.t2_workout('w2-free-12', null, -12, '17:05');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-free-12' from public.tasks where id = '00000000-0000-4000-8000-0000000d0204'),
  'a workout with no routine completes the one session that day');
-- A session with no routine is completed by the one workout that day, whatever its routine.
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, source_type)
values ('00000000-0000-4000-8000-0000000d0205', '00000000-0000-0000-0000-000000000002', 'Gym', 'personal', 'backlog', 'open', 'medium',
        public.t_d(-14), 'training_session');
select public.t2_workout('w2-upper-14', 'r2-upper', -14, '10:00');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-upper-14' from public.tasks where id = '00000000-0000-4000-8000-0000000d0205'),
  'a session with no routine is completed by that day''s workout');

-- ═══ 3. Skipped, then done inside its week ═══════════════════════════════
select public.t2_session('00000000-0000-4000-8000-0000000d0301', 'Lower B', 'r2-lower', -20, '17:00');
insert into public.training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
values ('00000000-0000-0000-0000-000000000002', 'r2-lower', date_trunc('week', public.t_d(-20))::date, 'Busy', '00000000-0000-4000-8000-0000000d0301', public.t_d(-20));
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000d0301'),
  'before: skipped (Busy)');
select public.t2_workout('w2-lower-17', 'r2-lower', -17, '18:00');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-lower-17' from public.tasks where id = '00000000-0000-4000-8000-0000000d0301')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0301') is null,
  'skipped, then done 3 days later in its week: done, the skip gone');

-- Skipped and done only after its week: stays skipped.
select public.t2_session('00000000-0000-4000-8000-0000000d0302', 'Upper B', 'r2-upper', -30, '17:00');
insert into public.training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
values ('00000000-0000-0000-0000-000000000002', 'r2-upper', date_trunc('week', public.t_d(-30))::date, 'Sick', '00000000-0000-4000-8000-0000000d0302', public.t_d(-30));
select public.t2_workout('w2-upper-23', 'r2-upper', -23, '18:00');
select public.t_ok((select status = 'cancelled' and hevy_workout_id is null from public.tasks where id = '00000000-0000-4000-8000-0000000d0302')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0302') = 'Sick',
  'skipped, and the workout came 7 days after its first day: still skipped, with its reason');

-- Moved inside its week to a later day: a workout 7 days after its first day is outside its week.
select public.t2_session('00000000-0000-4000-8000-0000000d0303', 'Lower B', 'r2-lower', -35, '17:00');
set role authenticated;
update public.time_blocks set date = public.t_d(-32) where task_id = '00000000-0000-4000-8000-0000000d0303';
reset role;
select public.t2_workout('w2-lower-28', 'r2-lower', -28, '18:00');
select public.t_ok((select status = 'open' and hevy_workout_id is null from public.tasks where id = '00000000-0000-4000-8000-0000000d0303')
                   and not exists (select 1 from public.tasks where hevy_workout_id = 'w2-lower-28'),
  'a workout 4 days after its new day but 7 after its first day does not complete it (its week is over)');

-- ═══ 4. Skipped, then moved ══════════════════════════════════════════════
select public.t2_session('00000000-0000-4000-8000-0000000d0401', 'Upper B', 'r2-upper', -2, '17:00');
insert into public.training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
values ('00000000-0000-0000-0000-000000000002', 'r2-upper', date_trunc('week', public.t_d(-2))::date, 'Travel', '00000000-0000-4000-8000-0000000d0401', public.t_d(-2));
select public.t2_session('00000000-0000-4000-8000-0000000d0402', 'Lower B', 'r2-lower', -4, '17:00');
insert into public.training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
values ('00000000-0000-0000-0000-000000000002', 'r2-lower', date_trunc('week', public.t_d(-4))::date, 'Travel', '00000000-0000-4000-8000-0000000d0402', public.t_d(-4));
set role authenticated;
update public.time_blocks set date = public.t_d(1) where task_id = '00000000-0000-4000-8000-0000000d0401';
update public.time_blocks set date = public.t_d(-3) where task_id = '00000000-0000-4000-8000-0000000d0402';
reset role;
select public.t_ok((select status = 'open' from public.tasks where id = '00000000-0000-4000-8000-0000000d0401')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0401') is null and public.t_day_of('00000000-0000-4000-8000-0000000d0401') = public.t_d(1),
  'skipped, moved to tomorrow inside its week: to do again there');
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000d0402')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0402') = 'Travel',
  'skipped, moved to another past day: still skipped, with its reason');

-- ═══ 5. Moved 9 days: that week skipped, the next week's session moved ══
-- A weekly Lower B on the weekday 10 days from now (and every week); its day 10 days from now made as a task.
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from)
values ('00000000-0000-4000-8000-0000000d05e1', '00000000-0000-0000-0000-000000000002', 'Lower B',
        array[extract(dow from public.t_d(10))::int], '17:00', '18:00', 'training', public.t_d(-60));
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id,
                          schedule_block_id, occurrence_date)
values ('00000000-0000-4000-8000-0000000d0501', '00000000-0000-0000-0000-000000000002', 'Lower B', 'personal', 'backlog', 'open', 'medium',
        public.t_d(10), '17:00', 'training_session', 'r2-lower', '00000000-0000-4000-8000-0000000d05e1', public.t_d(10));
set role authenticated;
update public.tasks set due_date = public.t_d(19), due_time = '19:00' where id = '00000000-0000-4000-8000-0000000d0501';
reset role;
select public.t_ok((select status = 'cancelled' and due_date = public.t_d(10) and due_time = '17:00' from public.tasks where id = '00000000-0000-4000-8000-0000000d0501')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0501') = 'Moved 7 or more days, to ' || to_char(public.t_d(19), 'DD.MM.YYYY'),
  'moved 9 days: back on its first day at its old time, skipped there ("Moved 7 or more days, to …")');
select public.t_ok((select completed_at = ((public.t_d(10) + 1)::timestamp at time zone 'Europe/Oslo') - interval '1 second'
                      from public.tasks where id = '00000000-0000-4000-8000-0000000d0501'),
  'its skip is closed on its own first day — never on the day of the move');
select public.t_ok((select count(*) = 1 from public.tasks t
                     where t.schedule_block_id = '00000000-0000-4000-8000-0000000d05e1' and t.occurrence_date = public.t_d(17)
                       and t.status = 'open' and t.due_date = public.t_d(19) and t.due_time = '19:00' and t.first_plan_date = public.t_d(17))
                   and (select count(*) = 1 from public.time_blocks b join public.tasks t on t.id = b.task_id
                         where t.schedule_block_id = '00000000-0000-4000-8000-0000000d05e1' and t.occurrence_date = public.t_d(17)
                           and b.date = public.t_d(19) and b.start_time = '19:00'),
  'the next week''s day of the repeat became its own and moved 2 days to the new day, at the new time');
select public.t_ok((select public.t_d(17) = any (except_dates) from public.schedule_blocks where id = '00000000-0000-4000-8000-0000000d05e1'),
  'that week''s day is out of the repeat (no second Lower B that week)');

-- Its task already made: that task moves.
select public.t2_session('00000000-0000-4000-8000-0000000d0502', 'Upper B', 'r2-upper', 2, '18:00');
select public.t2_session('00000000-0000-4000-8000-0000000d0503', 'Upper B', 'r2-upper', 9, '18:00');
set role authenticated;
update public.time_blocks set date = public.t_d(12) where task_id = '00000000-0000-4000-8000-0000000d0502';
reset role;
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000d0502')
                   and public.t_day_of('00000000-0000-4000-8000-0000000d0502') = public.t_d(2)
                   and (select status = 'open' and first_plan_date = public.t_d(9) from public.tasks where id = '00000000-0000-4000-8000-0000000d0503')
                   and public.t_day_of('00000000-0000-4000-8000-0000000d0503') = public.t_d(12),
  'moved 10 days onto a week that has its session: skipped on its own day, that week''s session moved 3 days instead');
select public.t_ok((select count(*) = 2 from public.tasks where user_id = '00000000-0000-0000-0000-000000000002' and hevy_routine_id = 'r2-upper'
                       and title = 'Upper B' and first_plan_date in (public.t_d(2), public.t_d(9))),
  'no new session made');

-- A one-off plan, nothing that week: a new session there.
insert into public.hevy_routines (id, user_id, title) values ('r2-legs', '00000000-0000-0000-0000-000000000002', 'Legs day');
select public.t2_session('00000000-0000-4000-8000-0000000d0504', 'Legs day', 'r2-legs', 4, '08:00');
set role authenticated;
update public.time_blocks set date = public.t_d(13), start_time = '09:00' where task_id = '00000000-0000-4000-8000-0000000d0504';
reset role;
select public.t_ok((select status = 'cancelled' and due_time = '08:00' from public.tasks where id = '00000000-0000-4000-8000-0000000d0504')
                   and public.t_day_of('00000000-0000-4000-8000-0000000d0504') = public.t_d(4),
  'a one-off moved 9 days: skipped on its own day');
select public.t_ok((select count(*) = 1 from public.tasks t join public.time_blocks b on b.task_id = t.id
                     where t.user_id = '00000000-0000-0000-0000-000000000002' and t.hevy_routine_id = 'r2-legs' and t.status = 'open'
                       and t.due_date = public.t_d(13) and t.first_plan_date = public.t_d(13) and b.date = public.t_d(13) and b.start_time = '09:00'
                       and b.category = 'training'),
  'and a new Legs day session (with its slot) is planned on the new day');

-- Two short moves that add up past its week.
select public.t2_session('00000000-0000-4000-8000-0000000d0505', 'Legs day', 'r2-legs', 30, '08:00');
set role authenticated;
update public.time_blocks set date = public.t_d(34) where task_id = '00000000-0000-4000-8000-0000000d0505';
reset role;
select public.t_ok((select status = 'open' from public.tasks where id = '00000000-0000-4000-8000-0000000d0505'),
  'first move, 4 days: just moved');
set role authenticated;
update public.time_blocks set date = public.t_d(38) where task_id = '00000000-0000-4000-8000-0000000d0505';
reset role;
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000d0505')
                   and public.t_day_of('00000000-0000-4000-8000-0000000d0505') = public.t_d(30),
  'second move, 4 more (8 from its first day): skipped back on its first day');

-- A session done by its workout, moved past its week: stays done in its week.
select public.t2_session('00000000-0000-4000-8000-0000000d0506', 'Upper B', 'r2-upper', -40, '18:00');
select public.t2_workout('w2-upper-40', 'r2-upper', -40, '18:05');
set role authenticated;
update public.time_blocks set date = public.t_d(-31) where task_id = '00000000-0000-4000-8000-0000000d0506';
reset role;
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-upper-40' from public.tasks where id = '00000000-0000-4000-8000-0000000d0506')
                   and public.t_day_of('00000000-0000-4000-8000-0000000d0506') = public.t_d(-40)
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0506') is null,
  'a session done, moved 9 days: stays done on its own day (never skipped)');

-- ═══ 5b. A session moved out of its week before 167 (the backfill) ═══════
insert into public.hevy_routines (id, user_id, title) values ('r2-push', '00000000-0000-0000-0000-000000000002', 'Push A');
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from)
values ('00000000-0000-4000-8000-0000000d05e2', '00000000-0000-0000-0000-000000000002', 'Push A',
        array[extract(dow from public.t_d(-9))::int], '17:00', '18:00', 'training', public.t_d(-60));
alter table public.tasks disable trigger trg_training_first_plan_date;
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id,
                          schedule_block_id, occurrence_date)
values ('00000000-0000-4000-8000-0000000d0551', '00000000-0000-0000-0000-000000000002', 'Push A', 'personal', 'backlog', 'open', 'medium',
        public.t_d(-1), '17:00', 'training_session', 'r2-push', '00000000-0000-4000-8000-0000000d05e2', public.t_d(-9));
alter table public.tasks enable trigger trg_training_first_plan_date;
select public.training_first_plan_backfill();
select public.t_ok((select first_plan_date = public.t_d(-1) from public.tasks where id = '00000000-0000-4000-8000-0000000d0551'),
  'backfill: a repeat''s day moved 8 days before 167 starts its week on the day it is planned for');
select public.t2_workout('w2-push-1', 'r2-push', -1, '17:05');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-push-1' from public.tasks where id = '00000000-0000-4000-8000-0000000d0551'),
  'its own workout on that day completes it (never skipped back onto its old day)');

-- ═══ 5c. A repeat whose session that week is already done: no extra session ═
insert into public.hevy_routines (id, user_id, title) values ('r2-pull', '00000000-0000-0000-0000-000000000002', 'Pull B');
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from)
values ('00000000-0000-4000-8000-0000000d05e3', '00000000-0000-0000-0000-000000000002', 'Pull B',
        array[extract(dow from public.t_d(-16))::int], '18:00', '19:00', 'training', public.t_d(-60));
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id,
                          schedule_block_id, occurrence_date) values
  ('00000000-0000-4000-8000-0000000d0561', '00000000-0000-0000-0000-000000000002', 'Pull B', 'personal', 'backlog', 'open', 'medium',
   public.t_d(-16), '18:00', 'training_session', 'r2-pull', '00000000-0000-4000-8000-0000000d05e3', public.t_d(-16)),
  ('00000000-0000-4000-8000-0000000d0562', '00000000-0000-0000-0000-000000000002', 'Pull B', 'personal', 'backlog', 'open', 'medium',
   public.t_d(-9), '18:00', 'training_session', 'r2-pull', '00000000-0000-4000-8000-0000000d05e3', public.t_d(-9));
select public.t2_workout('w2-pull-9', 'r2-pull', -9, '18:05');
select public.t_ok((select status = 'done' from public.tasks where id = '00000000-0000-4000-8000-0000000d0562'), 'before: the next week''s Pull B is done');
set role authenticated;
update public.tasks set due_date = public.t_d(-8) where id = '00000000-0000-4000-8000-0000000d0561';
reset role;
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000d0561')
                   and public.t_day_of('00000000-0000-4000-8000-0000000d0561') = public.t_d(-16)
                   and not exists (select 1 from public.tasks where user_id = '00000000-0000-0000-0000-000000000002' and hevy_routine_id = 'r2-pull'
                                     and status = 'open'),
  'moved 8 days onto a week whose Pull B is done: skipped in its own week, and no extra Pull B is made');

-- ═══ 6. The end of a session's week ══════════════════════════════════════
-- a. a one-off never done, its week over
select public.t2_session('00000000-0000-4000-8000-0000000d0601', 'Lower B', 'r2-lower', -50, '17:00');
-- b. moved inside its week to a later day, never done
select public.t2_session('00000000-0000-4000-8000-0000000d0602', 'Upper B', 'r2-upper', -60, '17:00');
alter table public.tasks disable trigger trg_training_task_recheck;
update public.time_blocks set date = public.t_d(-56) where task_id = '00000000-0000-4000-8000-0000000d0602';
alter table public.tasks enable trigger trg_training_task_recheck;
-- c. a repeat's day closed as missed, its week over
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id,
                          schedule_block_id, occurrence_date, closed_reason, completed_at)
values ('00000000-0000-4000-8000-0000000d0603', '00000000-0000-0000-0000-000000000002', 'Lower B', 'personal', 'backlog', 'cancelled', 'medium',
        public.t_d(-70), '17:00', 'training_session', 'r2-lower', '00000000-0000-4000-8000-0000000d05e1', public.t_d(-70), 'missed', public.t_at(-70, '23:59'));
-- d. moved before 167 to a day still to come (planned): left as planned
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id, first_plan_date)
values ('00000000-0000-4000-8000-0000000d0604', '00000000-0000-0000-0000-000000000002', 'Upper B', 'personal', 'backlog', 'open', 'medium',
        public.t_d(1), '17:00', 'training_session', 'r2-upper', public.t_d(-9));
-- e. moved inside its week past the day its routine was done (the workout found nothing: it came before the new day)
select public.t2_session('00000000-0000-4000-8000-0000000d0605', 'Legs day', 'r2-legs', -80, '17:00');
select public.t2_workout('w2-legs-78', 'r2-legs', -78, '17:00');
select public.t_ok((select status = 'done' from public.tasks where id = '00000000-0000-4000-8000-0000000d0605'),
  'before: e is done late by that workout');
alter table public.tasks disable trigger trg_training_task_recheck;
update public.tasks set status = 'open', hevy_workout_id = null, completed_at = null where id = '00000000-0000-4000-8000-0000000d0605';
update public.time_blocks set date = public.t_d(-76) where task_id = '00000000-0000-4000-8000-0000000d0605';
alter table public.tasks enable trigger trg_training_task_recheck;

-- f. a session whose date was cleared by hand: no day to skip it on
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, source_type, hevy_routine_id, first_plan_date)
values ('00000000-0000-4000-8000-0000000d0606', '00000000-0000-0000-0000-000000000002', 'Upper B', 'personal', 'backlog', 'open', 'medium',
        null, 'training_session', 'r2-upper', public.t_d(-30));

create temp table t_run as select public.repeat_days_for_user('00000000-0000-0000-0000-000000000002', public.t_d(0)) as r;
select public.t_ok((select (r ->> 'skipped')::int >= 3 from t_run),
  'the account''s run says how many sessions it skipped');
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000d0601')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0601') = 'Not done within 7 days',
  'a: not done in its week — skipped ("Not done within 7 days")');
select public.t_ok((select completed_at = ((public.t_d(-50) + 1)::timestamp at time zone 'Europe/Oslo') - interval '1 second'
                      from public.tasks where id = '00000000-0000-4000-8000-0000000d0601'),
  'a: closed on its own first day (the day lists file it there), not on the day the job ran');
select public.t_ok((select status = 'open' and due_date is null from public.tasks where id = '00000000-0000-4000-8000-0000000d0606')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0606') is null,
  'f: a session with no date is left as it is');
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000d0602')
                   and public.t_day_of('00000000-0000-4000-8000-0000000d0602') = public.t_d(-60)
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0602') = 'Not done within 7 days',
  'b: moved inside its week and not done — skipped on its own first day');
select public.t_ok((select status = 'cancelled' and closed_reason is null from public.tasks where id = '00000000-0000-4000-8000-0000000d0603')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0603') = 'Not done within 7 days',
  'c: a missed repeat day whose week ended — skipped');
select public.t_ok((select status = 'open' from public.tasks where id = '00000000-0000-4000-8000-0000000d0604')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0604') is null,
  'd: planned for a day still to come — left as planned');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-legs-78' from public.tasks where id = '00000000-0000-4000-8000-0000000d0605')
                   and public.t_day_of('00000000-0000-4000-8000-0000000d0605') = public.t_d(-80),
  'e: back on its first day its week''s workout completes it — done, not skipped');
create temp table t_before7 as select id, status, due_date, hevy_workout_id from public.tasks where user_id = '00000000-0000-0000-0000-000000000002';
select public.t_ok((select (public.repeat_days_for_user('00000000-0000-0000-0000-000000000002', public.t_d(0)) ->> 'skipped')::int = 0),
  'a second run skips nothing');
select public.t_ok(not exists (select 1 from t_before7 b join public.tasks t using (id)
                                where (b.status, b.due_date, b.hevy_workout_id) is distinct from (t.status, t.due_date, t.hevy_workout_id)),
  'and changes nothing');

-- A late sync: the workout of a session skipped at its week's end, from inside that week.
select public.t2_workout('w2-lower-48', 'r2-lower', -48, '18:00');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-lower-48' from public.tasks where id = '00000000-0000-4000-8000-0000000d0601')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000d0601') is null,
  'a workout from inside its week synced late: done after all, the skip gone');

-- ═══ 7. The repair: a link to another routine's workout made before 167 ══
select public.t2_session('00000000-0000-4000-8000-0000000d0701', 'Lower B', 'r2-lower', -90, '13:30');
select public.t2_workout('w2-lower-90', 'r2-lower', -90, '18:00');
select public.t2_workout('w2-upper-90', 'r2-upper', -90, '08:00');
alter table public.tasks disable trigger trg_training_task_recheck;
update public.tasks set hevy_workout_id = null where hevy_workout_id = 'w2-lower-90';
update public.tasks set hevy_workout_id = 'w2-upper-90', status = 'done', completed_at = public.t_at(-90, '08:45') where id = '00000000-0000-4000-8000-0000000d0701';
alter table public.tasks enable trigger trg_training_task_recheck;
create temp table t_repair7 as
select t.id
  from public.tasks t
  join public.hevy_workouts w on w.id = t.hevy_workout_id
 where (t.hevy_routine_id is not null or t.source_type = 'training_session')
   and ((w.start_time at time zone 'Europe/Oslo')::date not between
        coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id), t.due_date)
        and coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id), t.due_date) + 6
     or (t.hevy_routine_id is not null and w.routine_id is not null and w.routine_id <> t.hevy_routine_id));
select public.t_ok((select count(*) = 1 from t_repair7 where id = '00000000-0000-4000-8000-0000000d0701'),
  'the repair''s list finds the session closed by another routine''s workout');
select public.training_task_recheck(id) from t_repair7;
select public.t_ok((select status = 'done' and hevy_workout_id = 'w2-lower-90' from public.tasks where id = '00000000-0000-4000-8000-0000000d0701')
                   and not exists (select 1 from public.tasks where hevy_workout_id = 'w2-upper-90'),
  'after the repair: done by its own routine''s workout of that day; the other workout is free');
