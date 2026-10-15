-- Migration 156 (a repeat's day is a real task on its day): first what 156
-- itself did (nothing), then the job day by day — 13.10.2026 (Tue, the first
-- run), 14.10 and 15.10 (Thu) —, the days that are never made again
-- (skipped, deleted, moved, taken out), a training day as the row 142 makes,
-- missed days and a late Hevy workout, the Google choices, the item save,
-- deleting a repeat, and the app's own call. The job runs as its owner (no
-- user, like pg_cron); every app call runs as `authenticated` under row level
-- security and the owner lock.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
create or replace function public.t_v(p_k text) returns jsonb language sql stable as $$ select v from public.t_keep where k = p_k $$;
grant execute on function public.t_v(text) to authenticated;
-- is the day taken out of the repeat (except_dates)?
create or replace function public.t_out(p_plan uuid, p_day date) returns boolean language sql stable as $$
  select p_day = any (except_dates) from public.schedule_blocks where id = p_plan
$$;
grant execute on function public.t_out(uuid, date) to authenticated;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
-- the day's tasks of a repeat on a day
create or replace function public.t_day(p_plan uuid, p_day date) returns setof public.tasks language sql stable as $$
  select * from public.tasks where schedule_block_id = p_plan and occurrence_date = p_day
$$;
create or replace function public.t_n(p_plan uuid, p_day date) returns bigint language sql stable as $$
  select count(*) from public.tasks where schedule_block_id = p_plan and occurrence_date = p_day
$$;
create or replace function public.t_id(p_plan uuid, p_day date) returns uuid language sql stable as $$
  select id from public.tasks where schedule_block_id = p_plan and occurrence_date = p_day
$$;
grant execute on function public.t_day(uuid, date), public.t_n(uuid, date), public.t_id(uuid, date) to authenticated;

-- The job as pg_cron runs it: no user (auth.uid() is null).
create or replace function public.t_run(p_day date) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', 'none', true);
  r := public.repeat_days_run(p_day);
  perform set_config('test.uid', '', true);
  return r;
end $$;

-- The repeats (seed.sql)
create table public.t_plan (k text primary key, id uuid);
insert into public.t_plan values
  ('water', '00000000-0000-4000-8000-0000000001a1'), ('gym', '00000000-0000-4000-8000-0000000001a2'),
  ('read', '00000000-0000-4000-8000-0000000001a3'), ('stretch', '00000000-0000-4000-8000-0000000001a4'),
  ('haircut', '00000000-0000-4000-8000-0000000001a5'), ('standup', '00000000-0000-4000-8000-0000000001a6'),
  ('piano', '00000000-0000-4000-8000-0000000001a7'), ('swim', '00000000-0000-4000-8000-0000000001a8'),
  ('course', '00000000-0000-4000-8000-0000000001a9'), ('legs', '00000000-0000-4000-8000-0000000001aa'),
  ('theirs', '00000000-0000-4000-8000-0000000002a1'), ('locked', '00000000-0000-4000-8000-0000000003a1');
grant select on public.t_plan to authenticated;
create or replace function public.t_p(p_k text) returns uuid language sql stable as $$ select id from public.t_plan where k = p_k $$;
grant execute on function public.t_p(text) to authenticated;

-- ═══ 0. Migration 156 itself ═══════════════════════════════════════════════
select public.t_ok(not exists (
  select 1 from public.snap_tasks s full join public.tasks t on t.id = s.id
   where to_jsonb(s) is distinct from (to_jsonb(t) - 'schedule_block_id' - 'occurrence_date' - 'closed_reason')),
  '156: every existing task as it was (no task added, lost or changed)');
select public.t_ok(not exists (
  select 1 from public.snap_blocks s full join public.time_blocks b on b.id = s.id where to_jsonb(s) is distinct from to_jsonb(b)),
  '156: every slot as it was');
select public.t_ok(not exists (
  select 1 from public.snap_plans s full join public.schedule_blocks p on p.id = s.id where to_jsonb(s) is distinct from to_jsonb(p)),
  '156: every repeat as it was (its days taken out, its series, its Google choice)');
select public.t_ok((select count(*) from public.calendar_outbox) = (select calendar_rows from public.snap_counts)
  and (select count(*) from public.google_tasks_outbox) = (select tasks_rows from public.snap_counts)
  and (select count(*) from public.audit_logs) = (select audit_rows from public.snap_counts),
  '156: queued nothing for Google and wrote nothing (both outboxes and the activity log as they were)');
select public.t_ok(not exists (select 1 from public.tasks where schedule_block_id is not null or occurrence_date is not null or closed_reason is not null),
  '156: no existing task is marked as a day of a repeat or missed');
select public.t_ok((select count(*) from cron.job where jobname = 'lascis-repeat-days') = 1
  and (select schedule = '2 * * * *' and command = 'select public.repeat_days_run()' from cron.job where jobname = 'lascis-repeat-days'),
  '156: the hourly job is scheduled once (applied twice), calling the SQL function directly');

select public.t_ok(public.t_err($$update public.schedule_blocks set google_target = 'sheets' where id = public.t_p('water')$$) = '23514',
  '156: a repeat''s Google choice is still one of tasks / calendar / both / none');
-- The owner moves three repeats to Google Tasks ("one per day") and both — only possible since 156.
update public.schedule_blocks set google_target = 'tasks' where id in (public.t_p('water'), public.t_p('theirs'));
update public.schedule_blocks set google_target = 'both' where id = public.t_p('read');

-- ═══ 1. The first run (13.10.2026, a Tuesday) ═══════════════════════════════
insert into public.t_keep values ('run13', public.t_run('2026-10-13'));
select public.t_ok((public.t_v('run13') ->> 'created')::int = 6 and (public.t_v('run13') ->> 'missed')::int = 0
  and (public.t_v('run13') ->> 'users')::int = 2,
  'first run: six days made (water, gym, stretch, standup, legs + the second account''s), nothing missed; the locked-out account is skipped');
select public.t_ok(public.t_n(public.t_p('water'), '2026-10-13') = 1 and public.t_n(public.t_p('gym'), '2026-10-13') = 1
  and public.t_n(public.t_p('stretch'), '2026-10-13') = 1 and public.t_n(public.t_p('standup'), '2026-10-13') = 1
  and public.t_n(public.t_p('legs'), '2026-10-13') = 1 and public.t_n(public.t_p('theirs'), '2026-10-13') = 1
  and public.t_n(public.t_p('read'), '2026-10-13') = 0 and public.t_n(public.t_p('haircut'), '2026-10-13') = 0
  and public.t_n(public.t_p('course'), '2026-10-13') = 0 and public.t_n(public.t_p('locked'), '2026-10-13') = 0,
  'first run: a task for every repeat that has 13.10, none for one that hasn''t (Thursdays, the monthly one, one that starts 20.10)');
select public.t_ok(not exists (select 1 from public.tasks where occurrence_date is not null and occurrence_date <> '2026-10-13'),
  'first run: only today''s tasks — no past day backfilled (the repeats run since 01.09), no day ahead made');
select public.t_ok((select count(*) from public.time_blocks) = (select count(*) from public.snap_blocks)
  and not exists (select 1 from public.snap_plans s join public.schedule_blocks p on p.id = s.id where p.except_dates is distinct from s.except_dates),
  'no slot made and no day taken out of a repeat: its Google series keeps the day (no EXDATE, no extra event)');
select public.t_ok((select title = 'Water plants' and description = 'The big fern too' and domain = 'personal' and priority = 'low'
  and section = 'today' and status = 'open' and due_date = '2026-10-13' and due_time is null and source_type = 'manual'
  and google_target = 'tasks' and google_sync_enabled from public.t_day(public.t_p('water'), '2026-10-13')),
  'the day''s task: title, notes, domain and priority from the repeat; Today; due on its day; on Google Tasks (connected)');
select public.t_ok((select source_type = 'training_session' and hevy_routine_id = 'r-gym' and due_time = '17:30' and domain = 'personal'
  and google_target = 'calendar' and not google_sync_enabled from public.t_day(public.t_p('gym'), '2026-10-13')),
  'a training day: a training session linked to its routine (141/142), at the repeat''s time, its series its only Google entry');
select public.t_ok((select google_target = 'calendar' and not google_sync_enabled and domain = 'work' from public.t_day(public.t_p('standup'), '2026-10-13'))
  and (select google_target = 'none' and not google_sync_enabled from public.t_day(public.t_p('stretch'), '2026-10-13')),
  'a repeat saved before 155 on its series reads as Calendar (where it is); "Not on Google" stays off');
select public.t_ok((select google_target = 'tasks' and not google_sync_enabled from public.t_day(public.t_p('theirs'), '2026-10-13')),
  'an account with no Google connection: the choice is kept, nothing is sent');
select public.t_ok((select count(*) from public.google_tasks_outbox o where o.operation = 'create'
                     and o.task_id = public.t_id(public.t_p('water'), '2026-10-13')) = 1
  and not exists (select 1 from public.google_tasks_outbox o where o.task_id in (
        public.t_id(public.t_p('gym'), '2026-10-13'), public.t_id(public.t_p('standup'), '2026-10-13'),
        public.t_id(public.t_p('stretch'), '2026-10-13'), public.t_id(public.t_p('theirs'), '2026-10-13')))
  and (select count(*) from public.calendar_outbox) = (select calendar_rows from public.snap_counts),
  'Google: the tasks repeat''s day goes to the Google Tasks outbox (071); calendar / none / not connected send nothing; nothing to the calendar outbox');
select public.t_ok((select count(*) from public.audit_logs where table_name = 'tasks' and operation = 'INSERT' and actor = 'service') = 6,
  'audit: the job''s six new tasks are in the activity log (actor service)');

insert into public.t_keep values ('run13b', public.t_run('2026-10-13'));
select public.t_ok((public.t_v('run13b') ->> 'created')::int = 0 and (public.t_v('run13b') ->> 'missed')::int = 0
  and (select count(*) from public.tasks where occurrence_date is not null) = 6,
  'run twice: nothing made the second time — one task per day of a repeat');
select public.t_ok(exists (select 1 from pg_indexes where indexname = 'tasks_occurrence_key')
  and (select count(*) from public.tasks t group by t.schedule_block_id, t.occurrence_date having t.schedule_block_id is not null order by 1 desc limit 1) = 1,
  'the unique (repeat, day) index holds');

-- Water plants on 13.10 ticked from its row (app_repeat_day done): the same task, no slot
set role authenticated;
do $$
declare r jsonb; v uuid := public.t_id(public.t_p('water'), '2026-10-13');
begin
  r := public.app_repeat_day(public.t_p('water'), '2026-10-13', 'done', '2026-10-13');
  perform public.t_ok((r ->> 'taskId')::uuid = v and r ->> 'blockId' is null and (r ->> 'changed')::boolean
    and (select status from public.tasks where id = v) = 'done'
    and not exists (select 1 from public.time_blocks where task_id = v)
    and not (public.t_out(public.t_p('water'), '2026-10-13')),
    'done on a repeat''s row ticks the day''s task — no slot, the day stays in the repeat (its series without an EXDATE)');
end $$;
reset role;

-- ═══ 2. 14.10: yesterday's unticked days are missed ═════════════════════════
insert into public.t_keep values ('run14', public.t_run('2026-10-14'));
select public.t_ok((public.t_v('run14') ->> 'missed')::int = 5 and (public.t_v('run14') ->> 'created')::int = 3,
  '14.10: the five unticked days of 13.10 closed as missed; three made for 14.10 (water, standup, theirs)');
select public.t_ok((select status = 'cancelled' and closed_reason = 'missed' and completed_at = '2026-10-13 23:59:59+02'
  from public.t_day(public.t_p('stretch'), '2026-10-13')),
  'a missed day: cancelled, marked missed, closed at the last second of ITS day (it shows on 13.10, never on Today)');
select public.t_ok((select status from public.t_day(public.t_p('water'), '2026-10-13')) = 'done',
  'a day ticked done stays done');
select public.t_ok(not exists (select 1 from public.training_skips where task_id in
    (public.t_id(public.t_p('gym'), '2026-10-13'), public.t_id(public.t_p('legs'), '2026-10-13')))
  and (select status = 'cancelled' and closed_reason = 'missed' from public.t_day(public.t_p('legs'), '2026-10-13')),
  'a missed training day gets no skip row (it wasn''t skipped — 142''s "no reason given" is for a cancel)');
select public.t_ok((select status = 'open' and closed_reason is null from public.tasks where id = '00000000-0000-4000-8000-0000000001d2'),
  'an ordinary overdue task is not a day of a repeat: never closed as missed');
insert into public.t_keep values ('run14b', public.t_run('2026-10-14'));
select public.t_ok((public.t_v('run14b') ->> 'missed')::int = 0 and (public.t_v('run14b') ->> 'created')::int = 0,
  '14.10 again: nothing to close, nothing to make');
-- reopened, a missed day is closed again: never carried over
update public.tasks set status = 'open' where id = public.t_id(public.t_p('standup'), '2026-10-13');
select public.t_ok((select closed_reason is null and completed_at is null from public.t_day(public.t_p('standup'), '2026-10-13')),
  'reopening a missed day clears the marker');
insert into public.t_keep values ('run14c', public.t_run('2026-10-14'));
select public.t_ok((public.t_v('run14c') ->> 'missed')::int = 1
  and (select status = 'cancelled' and closed_reason = 'missed' from public.t_day(public.t_p('standup'), '2026-10-13')),
  '…and the next run closes it again (a past day is never carried over to today)');

-- Water plants on 14.10 moved to 16.10 (a plain move: Move, the assistant, a Google Tasks due)
set role authenticated;
update public.tasks set due_date = '2026-10-16', section = 'backlog' where id = public.t_id(public.t_p('water'), '2026-10-14');
reset role;
select public.t_ok(public.t_out(public.t_p('water'), '2026-10-14'),
  'a day''s task moved to another day: its own day leaves the repeat (it no longer shows there)');
insert into public.t_keep values ('run14d', public.t_run('2026-10-14'));
select public.t_ok((public.t_v('run14d') ->> 'created')::int = 0 and public.t_n(public.t_p('water'), '2026-10-14') = 1,
  '…and is never made again on its old day');

-- ═══ 3. 15.10 (a Thursday) ═══════════════════════════════════════════════════
insert into public.t_keep values ('run15', public.t_run('2026-10-15'));
select public.t_ok((public.t_v('run15') ->> 'missed')::int = 2 and (public.t_v('run15') ->> 'created')::int = 6,
  '15.10: standup and theirs of 14.10 missed (the moved one is due 16.10: not missed); six made');
select public.t_ok((select status from public.t_day(public.t_p('water'), '2026-10-14')) = 'open',
  'a day moved forward is not missed on its old day');
select public.t_ok(public.t_n(public.t_p('water'), '2026-10-15') = 1 and public.t_n(public.t_p('gym'), '2026-10-15') = 1
  and public.t_n(public.t_p('read'), '2026-10-15') = 1 and public.t_n(public.t_p('stretch'), '2026-10-15') = 1
  and public.t_n(public.t_p('standup'), '2026-10-15') = 1 and public.t_n(public.t_p('theirs'), '2026-10-15') = 1,
  '15.10: water, gym, read, stretch, standup and theirs made');
select public.t_ok(public.t_n(public.t_p('piano'), '2026-10-15') = 0,
  'a day taken out of its repeat ("Only this day", except_dates) is never made');
select public.t_ok(public.t_n(public.t_p('swim'), '2026-10-15') = 0
  and (select count(*) from public.tasks where id = '00000000-0000-4000-8000-0000000001b8' and status = 'done') = 1
  and (select count(*) from public.time_blocks where schedule_block_id = public.t_p('swim') and occurrence_date = '2026-10-15') = 1,
  'a day already acted on (142''s slot and task) is never made again — its own task stays the day''s');
select public.t_ok((select google_target = 'both' and google_sync_enabled and priority = 'high' and domain = 'media' and due_time = '21:00'
  from public.t_day(public.t_p('read'), '2026-10-15'))
  and exists (select 1 from public.google_tasks_outbox where operation = 'create' and task_id = public.t_id(public.t_p('read'), '2026-10-15')),
  'Google both: the day''s Google Task is queued (the series keeps the day too)');

-- ═══ 4. Deleted, taken out, skipped: never made again ════════════════════════
set role authenticated;
do $$
declare s jsonb; v uuid := public.t_id(public.t_p('stretch'), '2026-10-15');
begin
  s := public.app_delete_rows('tasks', array[v::text]);
  insert into public.t_keep values ('stretchDel', s);
  perform public.t_ok(not exists (select 1 from public.tasks where id = v)
    and public.t_out(public.t_p('stretch'), '2026-10-15'),
    'a day''s task deleted: the day leaves the repeat (except_dates) — "Only this day" from the task itself');
end $$;
reset role;
insert into public.t_keep values ('run15b', public.t_run('2026-10-15'));
select public.t_ok((public.t_v('run15b') ->> 'created')::int = 0 and public.t_n(public.t_p('stretch'), '2026-10-15') = 0,
  '…and the job never makes it again');
set role authenticated;
do $$
declare r jsonb; v uuid := ((public.t_v('stretchDel') -> 'groups' -> 0 -> 'rows' -> 0) ->> 'id')::uuid;
begin
  r := public.app_restore_rows(public.t_v('stretchDel'));
  perform public.t_ok(exists (select 1 from public.tasks where id = v and schedule_block_id = public.t_p('stretch') and occurrence_date = '2026-10-15')
    and not (public.t_out(public.t_p('stretch'), '2026-10-15')),
    'Undo of the delete: the same task is back and the day is in the repeat again');
end $$;
reset role;
insert into public.t_keep values ('run15c', public.t_run('2026-10-15'));
select public.t_ok((public.t_v('run15c') ->> 'created')::int = 0 and public.t_n(public.t_p('stretch'), '2026-10-15') = 1,
  '…still one task for the day');

-- Skip (a repeat's row): 142's split, the day's own task reused
set role authenticated;
do $$
declare r jsonb; v uuid := public.t_id(public.t_p('read'), '2026-10-15'); r2 jsonb;
begin
  r := public.app_repeat_day(public.t_p('read'), '2026-10-15', 'skip', '2026-10-15');
  perform public.t_ok((r ->> 'taskId')::uuid = v and r ->> 'blockId' is not null and (r ->> 'created')::boolean
    and (select status = 'cancelled' and closed_reason is null from public.tasks where id = v)
    and (select task_id = v and date = '2026-10-15' and start_time = '21:00' from public.time_blocks where id = (r ->> 'blockId')::uuid)
    and public.t_out(public.t_p('read'), '2026-10-15'),
    'skip: the day becomes its own item (142) holding the SAME task — skipped, its day out of the series');
  r2 := public.app_repeat_day(public.t_p('read'), '2026-10-15', 'undo', '2026-10-15');
  perform public.t_ok((r2 ->> 'changed')::boolean and (select status from public.tasks where id = v) = 'open',
    'Undo skip: the same task opens again');
end $$;
reset role;
insert into public.t_keep values ('run15d', public.t_run('2026-10-15'));
select public.t_ok((public.t_v('run15d') ->> 'created')::int = 0 and public.t_n(public.t_p('read'), '2026-10-15') = 1,
  '…a skipped (or split-off) day is never made again');

-- Done on a future day: the day's task is made then (no slot), and the job reuses it on its day
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_repeat_day(public.t_p('read'), '2026-10-22', 'done', '2026-10-15');
  insert into public.t_keep values ('read22', r);
  perform public.t_ok((r ->> 'created')::boolean and r ->> 'blockId' is null
    and (select status = 'done' and section = 'backlog' and due_date = '2026-10-22' from public.tasks where id = (r ->> 'taskId')::uuid),
    'done ahead (22.10): that day''s task is made and ticked — no slot');
end $$;
reset role;
insert into public.t_keep values ('run22', public.t_run('2026-10-22'));
select public.t_ok(public.t_n(public.t_p('read'), '2026-10-22') = 1
  and (select status from public.t_day(public.t_p('read'), '2026-10-22')) = 'done',
  '…on its day the job finds it: still one task, still done');

-- ═══ 5. A training day is the row 142 makes or reuses ═══════════════════════
-- (22.10's run closed 15.10 as missed for the rest; the training scenarios
-- below take the gym and legs days as they are.)
set role authenticated;
do $$
declare v uuid := public.t_id(public.t_p('gym'), '2026-10-15'); o record; o2 record;
begin
  -- item_occurrence is 142's split (trainingPlanApi.ensurePlanTask calls it for a weekly day)
  select * into o from public.item_occurrence(public.t_p('gym'), '2026-10-15', '2026-10-15');
  perform public.t_ok(o.task_id = v and o.created
    and (select date = '2026-10-15' and start_time = '17:30' and schedule_block_id = public.t_p('gym') from public.time_blocks where id = o.block_id)
    and public.t_n(public.t_p('gym'), '2026-10-15') = 1,
    'training: 142''s split of the day reuses the day''s task (one task, its slot made)');
  select * into o2 from public.item_occurrence(public.t_p('gym'), '2026-10-15', '2026-10-15');
  perform public.t_ok(o2.task_id = v and o2.block_id = o.block_id and not o2.created,
    '…a second tap gets the same rows');
  -- reopen it (the 22.10 run closed it as missed), then skip with a reason
  update public.tasks set status = 'open' where id = v;
  insert into public.training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
  values ('00000000-0000-0000-0000-000000000001', null, '2026-10-12', 'Sore knee', v, '2026-10-15');
  perform public.t_ok((select status = 'cancelled' and closed_reason is null from public.tasks where id = v)
    and (select count(*) from public.training_skips where task_id = v and reason = 'Sore knee') = 1,
    'training skip with its reason cancels the day''s task (142), one skip row');
  delete from public.training_skips where task_id = v;
  perform public.t_ok((select status from public.tasks where id = v) = 'open', 'Undo skip reopens it');
end $$;
reset role;
-- Hevy (141): the workout on its day completes the day's task
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-gym15', '00000000-0000-0000-0000-000000000001', 'Gym', 'r-gym', '2026-10-15 16:00+00', '2026-10-15 17:00+00');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w-gym15' from public.t_day(public.t_p('gym'), '2026-10-15'))
  and (select status = 'cancelled' and closed_reason = 'missed' and hevy_workout_id is null from public.t_day(public.t_p('gym'), '2026-10-13')),
  'Hevy: the workout completes ITS day''s task (141), not the missed one before it');
-- …and a late one still completes a missed training day (141's six days)
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('w-legs', '00000000-0000-0000-0000-000000000001', 'Legs', 'r-legs', '2026-10-15 16:30+00', '2026-10-15 17:30+00');
select public.t_ok((select status = 'done' and closed_reason is null and hevy_workout_id = 'w-legs' and completed_at = '2026-10-15 17:30+00'
  from public.t_day(public.t_p('legs'), '2026-10-13')),
  'a Hevy workout logged late (15.10) completes the missed training day of 13.10 — done, the marker gone, closed at the workout''s end');

-- ═══ 6. The item save ═══════════════════════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; v uuid; p uuid;
begin
  r := public.app_save_item('{"title":"Vitamins","domain":"personal","priority":"medium","date":"2026-10-15","time":null,"durationMinutes":null,
    "repeat":{"kind":"weekly","daysOfWeek":[0,1,2,3,4,5,6],"startsOn":"2026-10-15"},"google":"tasks","today":"2026-10-15","googleConnected":true}');
  insert into public.t_keep values ('vit', r);
  p := (r ->> 'scheduleBlockId')::uuid;
  v := (r ->> 'dayTaskId')::uuid;
  perform public.t_ok((select google_target from public.schedule_blocks where id = p) = 'tasks'
    and v is not null and v = public.t_id(p, '2026-10-15')
    and (select google_sync_enabled and google_target = 'tasks' and section = 'today' from public.tasks where id = v)
    and exists (select 1 from public.google_tasks_outbox where task_id = v and operation = 'create'),
    'a repeat on "Google Tasks · one per day" saves (no longer refused) and today''s task is made at once, on Google Tasks');
  r := public.app_save_item(jsonb_build_object('scheduleBlockId', p, 'scope', 'all', 'title', 'Vitamin D', 'notes', 'With food',
    'domain', 'personal', 'priority', 'high', 'date', '2026-10-15', 'time', '08:00', 'durationMinutes', null,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(0,1,2,3,4,5,6), 'startsOn', '2026-10-15'),
    'google', 'tasks', 'today', '2026-10-15', 'googleConnected', true));
  perform public.t_ok((r ->> 'dayTaskId')::uuid = v
    and (select title = 'Vitamin D' and description = 'With food' and priority = 'high' and due_time = '08:00' from public.tasks where id = v),
    'editing the repeat: today''s untouched day follows (title, notes, priority, time)');
  r := public.app_save_item(jsonb_build_object('scheduleBlockId', p, 'scope', 'all', 'title', 'Vitamin D', 'domain', 'personal',
    'priority', 'high', 'date', '2026-10-15', 'time', '08:00', 'durationMinutes', null,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(0,1,2,3,4,5,6), 'startsOn', '2026-10-15'),
    'google', 'none', 'today', '2026-10-15', 'googleConnected', true));
  perform public.t_ok((select not google_sync_enabled and google_target = 'none' from public.tasks where id = v),
    '…"Not on Google": today''s day leaves Google Tasks');
  r := public.app_save_item(jsonb_build_object('scheduleBlockId', p, 'scope', 'all', 'title', 'Vitamin D', 'domain', 'personal',
    'priority', 'high', 'date', '2026-10-15', 'time', '08:00', 'durationMinutes', null,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(1,3), 'startsOn', '2026-10-15'),
    'google', 'none', 'today', '2026-10-15', 'googleConnected', true));
  perform public.t_ok(not exists (select 1 from public.tasks where id = v) and r ->> 'dayTaskId' is null
    and not public.t_out(p, '2026-10-15'),
    '…a repeat that no longer has today: its untouched day goes (and no day is taken out)');
end $$;

-- Tasks → Calendar: once the series is confirmed, the browser turns its days' Google Tasks off
do $$
declare r jsonb; v uuid; p uuid; n1 integer; n2 integer;
begin
  r := public.app_save_item('{"title":"Floss","domain":"personal","priority":"medium","date":"2026-10-15","time":null,"durationMinutes":null,
    "repeat":{"kind":"weekly","daysOfWeek":[0,1,2,3,4,5,6],"startsOn":"2026-10-15"},"google":"tasks","today":"2026-10-15","googleConnected":true}');
  p := (r ->> 'scheduleBlockId')::uuid;
  v := (r ->> 'dayTaskId')::uuid;
  r := public.app_save_item(jsonb_build_object('scheduleBlockId', p, 'scope', 'all', 'title', 'Floss', 'domain', 'personal',
    'priority', 'medium', 'date', '2026-10-15', 'time', null, 'durationMinutes', null,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(0,1,2,3,4,5,6), 'startsOn', '2026-10-15'),
    'google', 'calendar', 'today', '2026-10-15', 'googleConnected', true));
  perform public.t_ok((select google_sync_enabled from public.tasks where id = v),
    'moving a repeat to Calendar keeps its day on Google Tasks until the series is confirmed (the new copy first)');
  n1 := public.app_repeat_days_google_tasks(p, '2026-10-15', false);
  n2 := public.app_repeat_days_google_tasks(p, '2026-10-15', false);
  perform public.t_ok(n1 = 1 and n2 = 0 and not (select google_sync_enabled from public.tasks where id = v),
    '…then its days still to do leave Google Tasks (once)');
end $$;

-- A day's task opened as a plain item (Home's list) and saved: it is that day of its repeat
do $$
declare r jsonb; v uuid := public.t_id(public.t_p('water'), '2026-10-15');
begin
  update public.tasks set status = 'open' where id = v;
  r := public.app_save_item(jsonb_build_object('taskId', v, 'scope', 'item', 'title', 'Water plants', 'domain', 'personal',
    'priority', 'low', 'date', '2026-10-15', 'time', '18:00', 'durationMinutes', null, 'google', 'tasks', 'today', '2026-10-15',
    'googleConnected', true));
  perform public.t_ok((r ->> 'taskId')::uuid = v and (r ->> 'occurrence')::boolean
    and (select schedule_block_id = public.t_p('water') and occurrence_date = '2026-10-15' and start_time = '18:00' and task_id = v
           from public.time_blocks where id = (r ->> 'blockId')::uuid)
    and public.t_n(public.t_p('water'), '2026-10-15') = 1
    and (select google_target = 'tasks' and google_sync_enabled from public.tasks where id = v),
    'a day''s task saved as a plain item runs as "This day" (142''s split, the same task) and keeps Google Tasks');
end $$;
reset role;

-- ═══ 7. Deleting a repeat ════════════════════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; p uuid; v15 uuid; v14 uuid; s jsonb;
begin
  r := public.app_save_item('{"title":"Temp","domain":"personal","priority":"medium","date":"2026-10-14","time":null,"durationMinutes":null,
    "repeat":{"kind":"weekly","daysOfWeek":[0,1,2,3,4,5,6],"startsOn":"2026-10-14"},"google":"none","today":"2026-10-15"}');
  p := (r ->> 'scheduleBlockId')::uuid;
  v15 := (r ->> 'dayTaskId')::uuid;
  v14 := (public.app_repeat_day(p, '2026-10-14', 'done', '2026-10-15') ->> 'taskId')::uuid;
  s := public.app_delete_rows('schedule_blocks', array[p::text]);
  perform public.t_ok(not exists (select 1 from public.tasks where id = v15)
    and (select status = 'done' and schedule_block_id is null and occurrence_date = '2026-10-14' from public.tasks where id = v14),
    'deleting a repeat takes its untouched open day (15.10) with it; a day done (14.10) stays, its link gone');
  r := public.app_restore_rows(s);
  perform public.t_ok(exists (select 1 from public.schedule_blocks where id = p)
    and exists (select 1 from public.tasks where id = v15 and schedule_block_id = p and occurrence_date = '2026-10-15' and status = 'open')
    and (select schedule_block_id from public.tasks where id = v14) = p,
    'Undo: the repeat, its open day (same id) and the done day''s link are back');
end $$;
reset role;

-- ═══ 8. Taken out and put back ("Only this day" on a day with no task) ═════
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_repeat_day(public.t_p('stretch'), '2026-10-17', 'remove', '2026-10-15');
  perform public.t_ok((r ->> 'changed')::boolean, '"Only 17.10": the day leaves the repeat');
end $$;
reset role;
insert into public.t_keep values ('run17', public.t_run('2026-10-17'));
select public.t_ok(public.t_n(public.t_p('stretch'), '2026-10-17') = 0, '…and is never made on its day');
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_repeat_day(public.t_p('stretch'), '2026-10-17', 'restore', '2026-10-17');
  perform public.t_ok((r ->> 'changed')::boolean and (r ->> 'taskId') is not null and public.t_n(public.t_p('stretch'), '2026-10-17') = 1,
    'Undo ("put back") on its day: the day is in again and its task is made at once');
end $$;
reset role;
insert into public.t_keep values ('run17b', public.t_run('2026-10-17'));
select public.t_ok((public.t_v('run17b') ->> 'created')::int = 0 and public.t_n(public.t_p('stretch'), '2026-10-17') = 1,
  '…still one task for the day');

-- ═══ 9. Existing rows ═══════════════════════════════════════════════════════
select public.t_ok((select to_jsonb(s) from public.snap_tasks s where s.id = '00000000-0000-4000-8000-0000000001d1')
  = (select to_jsonb(t) - 'schedule_block_id' - 'occurrence_date' - 'closed_reason' from public.tasks t where t.id = '00000000-0000-4000-8000-0000000001d1'),
  'an ordinary task (on Google Tasks) is untouched by every run');
select public.t_ok((select to_jsonb(s) from public.snap_blocks s where s.id = '00000000-0000-4000-8000-0000000001c8')
  = (select to_jsonb(b) from public.time_blocks b where b.id = '00000000-0000-4000-8000-0000000001c8')
  and (select status from public.tasks where id = '00000000-0000-4000-8000-0000000001b8') = 'done',
  'a day split off before 156 (142) is untouched: its slot and its done task');

-- ═══ 10. The app's call ═════════════════════════════════════════════════════
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_repeat_days_today((now() at time zone 'Europe/Oslo')::date);
  perform public.t_ok((r ->> 'created')::int = 0, 'the owner lock: a locked-out account''s call makes nothing');
end $$;
reset role;
set test.uid = '';
select public.t_ok(not exists (select 1 from public.tasks where user_id = '00000000-0000-0000-0000-000000000003'),
  '…and the job made nothing for it either');
insert into public.t_keep values ('theirsBefore', to_jsonb((select count(*) from public.tasks where user_id = '00000000-0000-0000-0000-000000000002')));
set role authenticated;
do $$
declare r jsonb; r2 jsonb; v_today date := (now() at time zone 'Europe/Oslo')::date;
begin
  r := public.app_repeat_days_today('2031-01-01');
  r2 := public.app_repeat_days_today(v_today);
  perform public.t_ok((r ->> 'today')::date = v_today and (r2 ->> 'created')::int = 0 and public.t_n(public.t_p('water'), v_today) = 1,
    'the app''s call: a clock far off reads as Oslo''s today; called twice, one task for the day');
end $$;
reset role;
select public.t_ok((select count(*) from public.tasks where user_id = '00000000-0000-0000-0000-000000000002') = (public.t_v('theirsBefore'))::bigint,
  '…and only the caller''s own repeats (the other account''s untouched)');
