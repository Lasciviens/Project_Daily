-- Migration 213 (a workout done early, late or swapped completes its own session) on the item chain with 211 and
-- training-sessions/seed.sql, after 213 ran twice (scripts/verify-db-training-sessions.mjs). Setup and checks run as
-- the superuser (a writer without row security, as the Hevy sync's service role is); browser writes as `authenticated`
-- (test.uid picks the caller: unset = the owner, user 2 = another allowed account). Each scenario has its own week, at
-- least two weeks from the next, so no window reaches another's sessions. Made-up data only.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create or replace function public.t_refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'written';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function public.t_refused(text) to authenticated;
-- The routines: ua, la, ub, lb (the program), mob (outside it).
create or replace function public.t_r(k text) returns text language sql immutable as $$
  select 'bbbbbbbb-0000-0000-0000-00000000000' || case k when 'ua' then '1' when 'la' then '2' when 'ub' then '3' when 'lb' then '4' when 'mob' then '5' end
$$;
create or replace function public.t_plan(n int, k text, d date) returns uuid language sql as $$
  insert into public.tasks (id, user_id, title, source_type, hevy_routine_id, due_date)
  values (('97000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000001', k, 'training_session', public.t_r(k), d)
  returning id
$$;
create or replace function public.t_p(n int) returns uuid language sql immutable as $$
  select ('97000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- A workout at a local Oslo time on a day (the Hevy sync's write).
create or replace function public.t_work(id text, k text, d date, hhmm text default '17:00') returns void language sql as $$
  insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time)
  values (id, '00000000-0000-0000-0000-000000000001', coalesce(k, 'Workout'), case when k is null then null else public.t_r(k) end,
          (d + hhmm::time) at time zone 'Europe/Oslo', (d + hhmm::time + interval '1 hour') at time zone 'Europe/Oslo')
$$;
create or replace function public.t_task(p uuid) returns public.tasks language sql security definer set search_path = '' as $$
  select * from public.tasks where id = p
$$;
grant execute on function public.t_task(uuid) to authenticated;
create or replace function public.t_linked(p uuid) returns text language sql as $$ select hevy_workout_id from public.tasks where id = p $$;

-- ═══ R. The runs ═════════════════════════════════════════════════════════════
select t_ok((select count(*) from public.tasks) = (select count(*) from public.t_before213)
        and not exists (select 1 from public.t_before213 b where not exists (
              select 1 from public.tasks t where t.id = b.id and t.title = b.title and t.due_date is not distinct from b.due_date
                and (t.status = b.status or (t.status = 'done' and t.hevy_workout_id is not null)))),
  'R1 NEVER_HIDES: every task is still there after 213 ran twice, its day, title and status as they were (only a session a workout completed is done now)');
select t_ok(t_linked('96000000-0000-0000-0000-000000000001') = 'back-1'
        and (t_task('96000000-0000-0000-0000-000000000001')).status = 'done'
        and (select count(*) from public.tasks where hevy_workout_id = 'back-1') = 1,
  'R2 the look-again of the last two weeks: a session done a day early (left open by 211) is completed by its workout, once');

-- ═══ M. Matching ═════════════════════════════════════════════════════════════
-- M1 done on its day.
select t_plan(1, 'ua', '2026-01-05');
select t_work('m1', 'ua', '2026-01-05');
select t_ok(t_linked(t_p(1)) = 'm1' and (t_task(t_p(1))).status = 'done'
        and (t_task(t_p(1))).completed_at = '2026-01-05 18:00 Europe/Oslo'::timestamptz,
  'M1 done on its day: Upper A''s workout completes Upper A, at the workout''s end');

-- M2 one day late.
select t_plan(2, 'la', '2026-01-20');
select t_work('m2', 'la', '2026-01-21');
select t_ok(t_linked(t_p(2)) = 'm2' and (t_task(t_p(2))).status = 'done',
  'M2 one day late: Tuesday''s Lower A is completed by Wednesday''s Lower A workout');

-- M3 one day early; three days early with nothing planned that day is not a swap.
select t_plan(3, 'ub', '2026-02-05');
select t_work('m3', 'ub', '2026-02-04');
select t_ok(t_linked(t_p(3)) = 'm3' and (t_task(t_p(3))).status = 'done'
        and (t_task(t_p(3))).completed_at = '2026-02-04 18:00 Europe/Oslo'::timestamptz,
  'M3 one day early: Thursday''s Upper B is completed by Wednesday''s Upper B workout (S20, the early side)');
select t_plan(31, 'ub', '2026-02-19');
select t_work('m31', 'ub', '2026-02-16');
select t_ok(t_linked(t_p(31)) is null and (t_task(t_p(31))).status = 'open',
  'M3 three days early on a day with no other session: not a swap, the session stays to do');

-- M4 swapped: Lower A done on Upper A's day (Thursday's Lower A, 3 days later).
select t_plan(4, 'ua', '2026-03-02');
select t_plan(41, 'la', '2026-03-05');
select t_work('m4', 'la', '2026-03-02');
select t_ok(t_linked(t_p(41)) = 'm4' and (t_task(t_p(41))).status = 'done'
        and t_linked(t_p(4)) is null and (t_task(t_p(4))).status = 'open',
  'M4 swapped: Lower A done on Upper A''s Monday completes Thursday''s Lower A; Upper A stays to do (a workout represents itself)');
-- Not a swap: the day's other session already done, or a routine outside the program.
select t_plan(42, 'ub', '2026-03-09');
select t_plan(43, 'lb', '2026-03-12');
select t_work('m42', 'ub', '2026-03-09', '08:00');
select t_work('m43', 'lb', '2026-03-09', '18:00');
select t_plan(44, 'mob', '2026-03-13');
select t_plan(45, 'ua', '2026-03-10');
select t_work('m44', 'mob', '2026-03-10');
select t_ok(t_linked(t_p(42)) = 'm42' and t_linked(t_p(43)) is null and t_linked(t_p(44)) is null and t_linked(t_p(45)) is null,
  'M4 no swap when the day''s session is already done, nor for a routine outside the current program');

-- M5 three days late inside its week.
select t_plan(5, 'lb', '2026-03-16');
select t_work('m5', 'lb', '2026-03-19');
select t_ok(t_linked(t_p(5)) = 'm5' and (t_task(t_p(5))).status = 'done',
  'M5 three days late inside its week: Monday''s Lower B is completed by Thursday''s Lower B workout (167''s week)');

-- M6 outside the week: 8 days late; and a session moved to Saturday whose week ends Sunday is not completed on Monday.
select t_plan(6, 'lb', '2026-03-30');
select t_work('m6', 'lb', '2026-04-07');
select t_ok(t_linked(t_p(6)) is null,
  'M6 outside the week: a Lower B workout 8 days after the session completes nothing');
select t_plan(61, 'ub', '2026-03-30');
update public.tasks set due_date = '2026-04-04' where id = t_p(61);
select t_work('m61', 'ub', '2026-04-06');
select t_ok((t_task(t_p(61))).first_plan_date = '2026-03-30' and t_linked(t_p(61)) is null,
  'M6 the week is the outer limit: a session moved to Saturday (first day Monday) is not completed 2 days later on the next Monday');

-- M7 two workouts in one day: each completes one session; a third of the same routine completes nothing more.
select t_plan(7, 'ua', '2026-04-13');
select t_plan(71, 'la', '2026-04-14');
select t_work('m7a', 'ua', '2026-04-13', '10:00');
select t_work('m7b', 'la', '2026-04-13', '18:00');
select t_work('m7c', 'ua', '2026-04-13', '19:30');
select t_ok(t_linked(t_p(7)) = 'm7a' and t_linked(t_p(71)) = 'm7b'
        and not exists (select 1 from public.tasks where hevy_workout_id = 'm7c')
        and not exists (select hevy_workout_id from public.tasks where hevy_workout_id is not null group by 1 having count(*) > 1),
  'M7 two workouts in one day: Upper A completes Monday''s, Lower A Tuesday''s (a day early); a second Upper A completes nothing — one workout, one session');

-- M8 another account's session is never touched; its task can't take this account's workout.
insert into public.tasks (id, user_id, title, source_type, hevy_routine_id, due_date) values
  ('97000000-0000-0000-0000-000000000800', '00000000-0000-0000-0000-000000000002', 'Upper A', 'training_session',
   'bbbbbbbb-0000-0000-0000-000000000009', '2026-04-27');
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('m8', '00000000-0000-0000-0000-000000000001', 'Upper A', 'bbbbbbbb-0000-0000-0000-000000000009', '2026-04-27 16:00+00', '2026-04-27 17:00+00');
select t_work('m8b', 'ua', '2026-04-27');
select t_ok(t_linked(t_p(800)) is null and (t_task(t_p(800))).status = 'open',
  'M8 a workout naming another account''s routine, and one of the owner''s on the same day, leave the other account''s session open');
set test.uid = '00000000-0000-0000-0000-000000000002';
set role authenticated;
select t_ok(t_refused($$update public.tasks set hevy_workout_id = 'm8b' where id = '97000000-0000-0000-0000-000000000800'$$) like '23503%',
  'M8 the other account can''t link its session to the owner''s workout (it would block that workout from closing the owner''s session)');
reset role;
reset test.uid;
select t_ok(t_refused($$update public.tasks set hevy_workout_id = 'm8b' where id = '97000000-0000-0000-0000-000000000800'$$) like '23503%'
        and t_linked(t_p(800)) is null,
  'M8 … for every writer, the service role too (refused with 23503)');

-- M10 the session's own day wins: done early, then done on the day.
select t_plan(10, 'ua', '2026-05-13');
select t_work('m10a', 'ua', '2026-05-12');
select t_ok(t_linked(t_p(10)) = 'm10a', 'M10 an Upper A workout a day early completes Wednesday''s Upper A');
select t_work('m10b', 'ua', '2026-05-13');
select t_ok(t_linked(t_p(10)) = 'm10b' and (t_task(t_p(10))).completed_at = '2026-05-13 18:00 Europe/Oslo'::timestamptz
        and not exists (select 1 from public.tasks where hevy_workout_id = 'm10a'),
  'M10 … then an Upper A on Wednesday itself takes it over; the early one is free again (nothing else to complete)');

-- M11 the owner's case: Upper A done on another day, Lower A done a day late.
select t_plan(11, 'ua', '2026-05-25');
select t_plan(111, 'la', '2026-05-26');
select t_plan(112, 'ub', '2026-05-28');
select t_work('m11a', 'ua', '2026-05-27', '07:00');
select t_work('m11b', 'la', '2026-05-27', '18:00');
select t_ok(t_linked(t_p(11)) = 'm11a' and t_linked(t_p(111)) = 'm11b' and t_linked(t_p(112)) is null
        and (t_task(t_p(112))).status = 'open',
  'M11 the owner''s case: Monday''s Upper A done on Wednesday and Tuesday''s Lower A done Wednesday (a day late) are both done; Thursday''s Upper B is still to do');

-- M12 a moved session keeps its early workout only while it still fits.
select t_plan(12, 'ub', '2026-06-11');
select t_work('m12', 'ub', '2026-06-10');
update public.tasks set due_date = '2026-06-12' where id = t_p(12);
select t_ok(t_linked(t_p(12)) = 'm12' and (t_task(t_p(12))).status = 'done',
  'M12 done a day early and moved a day later (2 days early now): still done by that workout');
update public.tasks set due_date = '2026-06-13' where id = t_p(12);
select t_ok(t_linked(t_p(12)) is null and (t_task(t_p(12))).status = 'open',
  'M12 … moved to 3 days after the workout (no swap that day): unlinked, to do again (166''s recheck, 213''s window)');

-- M13 a session moved next to a workout no session took is completed by it.
select t_plan(13, 'la', '2026-06-27');
select t_work('m13', 'la', '2026-06-24');
select t_ok(t_linked(t_p(13)) is null, 'M13 a Lower A workout 3 days before its session (no swap) completes nothing');
update public.tasks set due_date = '2026-06-25' where id = t_p(13);
select t_ok(t_linked(t_p(13)) = 'm13' and (t_task(t_p(13))).status = 'done',
  'M13 … the session moved to the next day: the workout completes it (a day early)');

-- M14 the nearest session first: done between last week's open one (5 days late) and this week's (1 day early).
select t_plan(14, 'ua', '2026-07-06');
select t_plan(141, 'ua', '2026-07-12');
select t_work('m14', 'ua', '2026-07-11');
select t_ok(t_linked(t_p(141)) = 'm14' and t_linked(t_p(14)) is null,
  'M14 the nearest session first: a workout on Saturday completes Sunday''s Upper A (1 day early), not Monday''s (5 days late)');

-- ═══ S. Re-running a sync changes nothing ═══════════════════════════════════
create table public.t_links as select id, status, hevy_workout_id, completed_at from public.tasks;
update public.hevy_workouts set routine_id = routine_id, start_time = start_time;
update public.hevy_workouts set routine_id = routine_id, start_time = start_time;
select t_ok(not exists (select 1 from public.t_links l join public.tasks t on t.id = l.id
                         where (t.status, t.hevy_workout_id, t.completed_at) is distinct from (l.status, l.hevy_workout_id, l.completed_at))
        and (select count(*) from public.tasks) = (select count(*) from public.t_links),
  'S1 re-running a sync (every workout written again, twice): no session''s status, workout or time changes');

-- ═══ D. The functions are the database's own ═════════════════════════════════
set role authenticated;
select t_ok(t_refused($$select public.training_swap_plan('00000000-0000-0000-0000-000000000001', 'x', '2026-01-01')$$) like '42501%'
        and t_refused($$select public.training_swap_day('00000000-0000-0000-0000-000000000001', 'x', '2026-01-01', true)$$) like '42501%'
        and t_refused($$select public.training_workout_relink('m6')$$) like '42501%'
        and t_refused($$select * from public.training_plan_candidates('00000000-0000-0000-0000-000000000001', '2026-01-01')$$) like '42501%',
  'D1 the browser can call none of the matching functions');
reset role;
