-- Migration 169's training fixes (the 28.10.2026 audit), on the live item save
-- with 141–168, 148's Google Tasks pull and the real Google Tasks triggers
-- (071's local-edit stamp, 140's queue):
--  S1 the database's own training writes reach Google when the move came
--     FROM Google (the Calendar read-back, the Google Tasks pull), and a
--     plain move from Google still sends nothing back;
--  T2 a repeat's session moved 7+ days into a week with no session of its
--     plan gets one there (none when that week's is done or skipped);
--  T5 the app's call from a device a day ahead never closes today;
--  T8 a session 'waiting' is still to do.
-- Each group has its own account (the app's call reads all of an account's
-- rows). Days are relative to today (Europe/Oslo), as the rules read them.
-- Setup and checks run as the superuser; app moves run as `authenticated`;
-- the read-back and the pull run with no user (test.uid 'none', the service
-- role), as google-tasks-sync calls them.
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

-- Accounts 4–6 (1 and 2 come with base.sql; 3 is locked out).
insert into auth.users values ('00000000-0000-0000-0000-000000000004'), ('00000000-0000-0000-0000-000000000005'),
                              ('00000000-0000-0000-0000-000000000006');
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000004'), ('00000000-0000-0000-0000-000000000005'),
                                            ('00000000-0000-0000-0000-000000000006');

-- A one-off session on day n at hh:mm with its slot (its Calendar event, when given).
create or replace function public.t_session(p_user uuid, p_id uuid, p_title text, p_routine text, n integer, hhmm text,
                                            p_event text default null) returns void language plpgsql as $$
begin
  insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id)
  values (p_id, p_user, p_title, 'personal', 'backlog', 'open', 'medium', public.t_d(n), hhmm::time, 'training_session', p_routine);
  insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, category, task_id, source_type,
                                  google_calendar_event_id, updated_at)
  values (p_user, public.t_d(n), p_title, hhmm::time, 60, 'training', p_id, 'training_session', p_event, now() - interval '1 hour');
end $$;
-- A session on Google Tasks (no slot): its Google Task id, sync on.
create or replace function public.t_gtask(p_user uuid, p_id uuid, p_title text, p_routine text, n integer, p_gtask text)
returns void language plpgsql as $$
begin
  insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, source_type, hevy_routine_id,
                            google_task_id, google_sync_enabled)
  values (p_id, p_user, p_title, 'personal', 'backlog', 'open', 'medium', public.t_d(n), 'training_session', p_routine, p_gtask, true);
end $$;
create or replace function public.t_workout(p_user uuid, p_id text, p_routine text, n integer, hhmm text) returns void language plpgsql as $$
begin
  insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time)
  values (p_id, p_user, coalesce(p_routine, 'Free'), p_routine, public.t_at(n, hhmm), public.t_at(n, hhmm) + interval '45 minutes');
end $$;
create or replace function public.t_day_of(p_id uuid) returns date language sql stable as $$
  select coalesce((select min(b.date) from public.time_blocks b where b.task_id = p_id), (select due_date from public.tasks where id = p_id))
$$;
create or replace function public.t_skip_of(p_id uuid) returns text language sql stable as $$
  select reason from public.training_skips where task_id = p_id
$$;
-- The Calendar read-back as google-tasks-sync calls it (155): the event now on day n at hh:mm.
create or replace function public.t_readback(p_user uuid, p_event text, p_title text, n integer, hhmm text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('test.uid', 'none', true);
  r := public.apply_calendar_readback(p_user, jsonb_build_object('id', p_event, 'status', 'confirmed', 'title', p_title,
         'date', public.t_d(n)::text, 'time', hhmm, 'minutes', 60, 'busy', true, 'updated', clock_timestamp()::text));
  perform set_config('test.uid', '', true);
  return r;
end $$;
-- The Google Tasks pull as google-tasks-sync calls it (148): the task now due on day n.
create or replace function public.t_pull(p_user uuid, p_gtask text, p_title text, n integer) returns uuid language plpgsql as $$
declare r uuid;
begin
  perform set_config('test.uid', 'none', true);
  r := public.upsert_task_from_google(p_gtask, p_title, null, public.t_d(n), 'needsAction', clock_timestamp(),
         null, null, null, null, null, null, false, false, p_user, null);
  perform set_config('test.uid', '', true);
  return r;
end $$;
-- What is queued for Google for one slot's event / one task.
create or replace function public.t_cal(p_event text) returns setof public.calendar_outbox language sql stable as $$
  select * from public.calendar_outbox where event_id = p_event
$$;
create or replace function public.t_gt(p_task uuid) returns setof public.google_tasks_outbox language sql stable as $$
  select * from public.google_tasks_outbox where task_id = p_task
$$;

-- ═══ 0. Migration 169 itself ═══════════════════════════════════════════════
select public.t_ok(not has_function_privilege('authenticated', 'public.training_move_past_week(uuid, date, time, time)', 'execute')
                   and not has_function_privilege('authenticated', 'public.training_task_recheck(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.training_task_moved()', 'execute')
                   and not has_function_privilege('authenticated', 'public.training_plan_candidates(uuid, date)', 'execute'),
  '169: the training rules are still not callable from the browser');
select public.t_ok(has_function_privilege('authenticated', 'public.repeat_days_for_user(uuid, date)', 'execute')
                   and has_function_privilege('service_role', 'public.repeat_days_for_user(uuid, date)', 'execute'),
  '169: the account run keeps its grants (the app, the service role)');
select public.t_ok((select count(*) from pg_trigger where tgname = 'trg_training_task_recheck' and tgrelid = 'public.tasks'::regclass) = 1,
  '169: one move trigger on tasks (applied twice)');

-- ═══ S1. The Calendar read-back (account 1) ════════════════════════════════
insert into public.hevy_routines (id, user_id, title) values
  ('r1-lower', '00000000-0000-0000-0000-000000000001', 'Lower C'),
  ('r1-upper', '00000000-0000-0000-0000-000000000001', 'Upper C');
-- Lower C tomorrow (its event ev-a1) and next week (ev-a2): in Google the owner drags ev-a1 9 days on.
select public.t_session('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-0000000a0101', 'Lower C', 'r1-lower', 1, '17:00', 'ev-a1');
select public.t_session('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-0000000a0102', 'Lower C', 'r1-lower', 8, '17:00', 'ev-a2');
delete from public.calendar_outbox;
select public.t_ok(public.t_readback('00000000-0000-0000-0000-000000000001', 'ev-a1', 'Lower C', 10, '17:00') = 'moved',
  'S1 read-back: Google''s 9-day move of a session is applied');
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000a0101')
                   and public.t_day_of('00000000-0000-4000-8000-0000000a0101') = public.t_d(1)
                   and public.t_skip_of('00000000-0000-4000-8000-0000000a0101') = 'Moved 7 or more days, to ' || to_char(public.t_d(10), 'DD.MM.YYYY')
                   and (select status = 'open' from public.tasks where id = '00000000-0000-4000-8000-0000000a0102')
                   and public.t_day_of('00000000-0000-4000-8000-0000000a0102') = public.t_d(10),
  'S1 read-back: 167''s rule ran as for a move in the app — skipped back on its first day, next week''s session on the new day');
select public.t_ok((select count(*) from public.calendar_outbox) = 2
                   and (select operation = 'upsert' and payload ->> 'fields' = 'all' and (payload ->> 'date')::date = public.t_d(1)
                               and (payload ->> 'start_time')::time = '17:00' from public.t_cal('ev-a1'))
                   and (select operation = 'upsert' and payload ->> 'fields' = 'all' and (payload ->> 'date')::date = public.t_d(10)
                               and (payload ->> 'start_time')::time = '17:00' from public.t_cal('ev-a2'))
                   and (select date = public.t_d(1) from public.time_blocks where google_calendar_event_id = 'ev-a1')
                   and (select date = public.t_d(10) from public.time_blocks where google_calendar_event_id = 'ev-a2'),
  'S1 read-back: both events are queued for Google with their final days (ev-a1 back on day 1, ev-a2 on day 10) — 168 queued none');

-- A plain move from Google (3 days, no rule fires): nothing goes back.
select public.t_session('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-0000000a0103', 'Upper C', 'r1-upper', 3, '18:00', 'ev-a3');
delete from public.calendar_outbox;
select public.t_ok(public.t_readback('00000000-0000-0000-0000-000000000001', 'ev-a3', 'Upper C', 6, '19:00') = 'moved',
  'S1 read-back: Google''s 3-day move of a session is applied');
select public.t_ok((select status = 'open' and due_date = public.t_d(6) and due_time = '19:00' and first_plan_date = public.t_d(3)
                          from public.tasks where id = '00000000-0000-4000-8000-0000000a0103')
                   and not exists (select 1 from public.calendar_outbox),
  'S1 read-back: …just moved (to do on its new day, its first day kept), and nothing is queued (no echo)');

-- 166's recheck decides after a move from Google: a session done by its workout, dragged 3 days on in Google.
select public.t_session('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-0000000a0104', 'Upper C', 'r1-upper', -3, '07:00', 'ev-a4');
select public.t_workout('00000000-0000-0000-0000-000000000001', 'w1-upper-3', 'r1-upper', -3, '07:05');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w1-upper-3' from public.tasks where id = '00000000-0000-4000-8000-0000000a0104'),
  'before: the session is done by its workout');
delete from public.calendar_outbox;
select public.t_ok(public.t_readback('00000000-0000-0000-0000-000000000001', 'ev-a4', 'Upper C', 0, '07:00') = 'moved',
  'S1 read-back: Google''s move of a done session 3 days on is applied');
select public.t_ok((select status = 'open' and hevy_workout_id is null from public.tasks where id = '00000000-0000-4000-8000-0000000a0104'),
  'S1 read-back: moved past its workout''s day, the session is to do again (166)');
select public.t_ok((select count(*) from public.calendar_outbox) = 1
                   and (select payload ->> 'fields' = 'title' and (payload ->> 'done')::boolean = false from public.t_cal('ev-a4')),
  'S1 read-back: the reopen reaches Google (its "✓ " goes: a title-only push), the move itself is not sent back');

-- The flag is back on after the rule ran (the rest of the read-back is still not echoed).
select public.t_session('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-0000000a0105', 'Lower C', 'r1-lower', 20, '17:00', 'ev-a5');
do $$
begin
  perform set_config('app.calendar_readback', 'on', true);
  update public.time_blocks set date = public.t_d(30), updated_at = now() where google_calendar_event_id = 'ev-a5';
  perform public.t_ok(current_setting('app.calendar_readback', true) = 'on'
                      and (select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000a0105'),
    'S1 read-back: the rule ran inside it and its flag is on again afterwards');
end $$;

-- The same 9-day move made in the app: unchanged.
select public.t_session('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-0000000a0106', 'Lower C', 'r1-lower', 40, '17:00', 'ev-a6');
select public.t_session('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-0000000a0107', 'Lower C', 'r1-lower', 47, '17:00', 'ev-a7');
delete from public.calendar_outbox;
set test.uid = '00000000-0000-0000-0000-000000000001';
set role authenticated;
update public.time_blocks set date = public.t_d(49) where task_id = '00000000-0000-4000-8000-0000000a0106';
reset role;
set test.uid = '';
select public.t_ok((select count(*) from public.calendar_outbox) = 2
                   and (select (payload ->> 'date')::date = public.t_d(40) from public.t_cal('ev-a6'))
                   and (select (payload ->> 'date')::date = public.t_d(49) from public.t_cal('ev-a7'))
                   and (select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000a0106')
                   and public.t_day_of('00000000-0000-4000-8000-0000000a0107') = public.t_d(49),
  'S1 an app move of 9 days: as before (both events queued with their final days)');

-- ═══ S1. The Google Tasks pull (account 2) ═════════════════════════════════
insert into public.hevy_routines (id, user_id, title) values
  ('r2-lower', '00000000-0000-0000-0000-000000000002', 'Lower D');
select public.t_gtask('00000000-0000-0000-0000-000000000002', '00000000-0000-4000-8000-0000000b0201', 'Lower D', 'r2-lower', 30, 'gt-21');
select public.t_gtask('00000000-0000-0000-0000-000000000002', '00000000-0000-4000-8000-0000000b0202', 'Lower D', 'r2-lower', 37, 'gt-22');
delete from public.google_tasks_outbox;
select public.t_ok(public.t_pull('00000000-0000-0000-0000-000000000002', 'gt-21', 'Lower D', 39) = '00000000-0000-4000-8000-0000000b0201',
  'S1 pull: Google Tasks'' 9-day move of a session is applied');
select public.t_ok((select status = 'cancelled' and due_date = public.t_d(30) from public.tasks where id = '00000000-0000-4000-8000-0000000b0201')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000b0201') = 'Moved 7 or more days, to ' || to_char(public.t_d(39), 'DD.MM.YYYY')
                   and (select status = 'open' and due_date = public.t_d(39) from public.tasks where id = '00000000-0000-4000-8000-0000000b0202'),
  'S1 pull: skipped back on its first day, next week''s session on the new day');
select public.t_ok(exists (select 1 from public.t_gt('00000000-0000-4000-8000-0000000b0201') o
                            where o.operation = 'update' and (o.payload ->> 'due_date')::date = public.t_d(30))
                   and exists (select 1 from public.t_gt('00000000-0000-4000-8000-0000000b0202') o
                                where o.operation = 'update' and (o.payload ->> 'due_date')::date = public.t_d(39))
                   and not exists (select 1 from public.google_tasks_outbox o
                                    where o.task_id not in ('00000000-0000-4000-8000-0000000b0201', '00000000-0000-4000-8000-0000000b0202')),
  'S1 pull: both sessions are queued for Google Tasks with their final days (30 and 39) — 168 queued none');

-- A plain move from Google Tasks (3 days): nothing goes back.
select public.t_gtask('00000000-0000-0000-0000-000000000002', '00000000-0000-4000-8000-0000000b0203', 'Lower D', 'r2-lower', 50, 'gt-23');
delete from public.google_tasks_outbox;
delete from public.calendar_outbox;
select public.t_ok(public.t_pull('00000000-0000-0000-0000-000000000002', 'gt-23', 'Lower D', 53) is not null,
  'S1 pull: Google Tasks'' 3-day move of a session is applied');
select public.t_ok((select status = 'open' and due_date = public.t_d(53) from public.tasks where id = '00000000-0000-4000-8000-0000000b0203')
                   and not exists (select 1 from public.google_tasks_outbox) and not exists (select 1 from public.calendar_outbox),
  'S1 pull: …just moved, and nothing is queued (no echo)');

-- A repeat's day on Google Tasks moved 2 days there: split (a slot on its new day), nothing sent back.
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from, google_target)
values ('00000000-0000-4000-8000-0000000b02e1', '00000000-0000-0000-0000-000000000002', 'Lower D',
        array[extract(dow from public.t_d(60))::int], '17:00', '18:00', 'training', public.t_d(-30), 'tasks');
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id,
                          schedule_block_id, occurrence_date, google_task_id, google_sync_enabled)
values ('00000000-0000-4000-8000-0000000b0204', '00000000-0000-0000-0000-000000000002', 'Lower D', 'personal', 'backlog', 'open', 'medium',
        public.t_d(60), '17:00', 'training_session', 'r2-lower', '00000000-0000-4000-8000-0000000b02e1', public.t_d(60), 'gt-24', true);
delete from public.google_tasks_outbox;
delete from public.calendar_outbox;
select public.t_ok(public.t_pull('00000000-0000-0000-0000-000000000002', 'gt-24', 'Lower D', 62) is not null,
  'S1 pull: Google Tasks'' 2-day move of a repeat''s day is applied');
select public.t_ok((select count(*) = 1 from public.time_blocks b where b.task_id = '00000000-0000-4000-8000-0000000b0204' and b.date = public.t_d(62))
                   and not exists (select 1 from public.google_tasks_outbox) and not exists (select 1 from public.calendar_outbox),
  'S1 pull: …the day is split onto its new day (a slot there, 166) and nothing is queued');

-- The flag is back after the rule ran (the rest of the pull is still not echoed).
select public.t_gtask('00000000-0000-0000-0000-000000000002', '00000000-0000-4000-8000-0000000b0205', 'Lower D', 'r2-lower', 70, 'gt-25');
do $$
begin
  perform set_config('app.google_sync_write', 'true', true);
  update public.tasks set due_date = public.t_d(80) where id = '00000000-0000-4000-8000-0000000b0205';
  perform public.t_ok(current_setting('app.google_sync_write', true) = 'true'
                      and (select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000b0205'),
    'S1 pull: the rule ran inside it and its flag is on again afterwards');
end $$;

-- The same 9-day move made in the app: unchanged.
select public.t_gtask('00000000-0000-0000-0000-000000000002', '00000000-0000-4000-8000-0000000b0206', 'Lower D', 'r2-lower', 90, 'gt-26');
select public.t_gtask('00000000-0000-0000-0000-000000000002', '00000000-0000-4000-8000-0000000b0207', 'Lower D', 'r2-lower', 97, 'gt-27');
delete from public.google_tasks_outbox;
set test.uid = '00000000-0000-0000-0000-000000000002';
set role authenticated;
update public.tasks set due_date = public.t_d(99) where id = '00000000-0000-4000-8000-0000000b0206';
reset role;
set test.uid = '';
select public.t_ok(exists (select 1 from public.t_gt('00000000-0000-4000-8000-0000000b0206') where operation = 'update')
                   and exists (select 1 from public.t_gt('00000000-0000-4000-8000-0000000b0207') o
                                where o.operation = 'update' and (o.payload ->> 'due_date')::date = public.t_d(99))
                   and (select status = 'cancelled' and due_date = public.t_d(90) from public.tasks where id = '00000000-0000-4000-8000-0000000b0206'),
  'S1 an app move of 9 days on Google Tasks: as before (both sessions queued)');

-- ═══ T2. A repeat moved into a week with no session of its plan (account 4) ═
insert into public.hevy_routines (id, user_id, title) values
  ('r4-lower', '00000000-0000-0000-0000-000000000004', 'Lower E'),
  ('r4-upper', '00000000-0000-0000-0000-000000000004', 'Upper E'),
  ('r4-legs',  '00000000-0000-0000-0000-000000000004', 'Legs E');
-- a. Every 2 weeks: its day 3 days from now moved 9 days (the Move popup: its slot); that week has no Lower E.
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from,
                                    repeat_kind, repeat_interval, repeat_unit)
values ('00000000-0000-4000-8000-0000000d04e1', '00000000-0000-0000-0000-000000000004', 'Lower E',
        array[extract(dow from public.t_d(3))::int], '17:00', '18:00', 'training', public.t_d(3), 'interval', 2, 'week');
select public.t_ok(not public.repeat_occurs_on(s, public.t_d(10)) and public.repeat_occurs_on(s, public.t_d(17)), 'before: Lower E repeats every 2 weeks')
  from public.schedule_blocks s where s.id = '00000000-0000-4000-8000-0000000d04e1';
set test.uid = '00000000-0000-0000-0000-000000000004';
set role authenticated;
select 1 from public.item_occurrence('00000000-0000-4000-8000-0000000d04e1', public.t_d(3), public.t_d(0), '00000000-0000-0000-0000-000000000004');
update public.time_blocks set date = public.t_d(12)
 where schedule_block_id = '00000000-0000-4000-8000-0000000d04e1' and occurrence_date = public.t_d(3);
reset role;
set test.uid = '';
select public.t_ok((select status = 'cancelled' and due_date = public.t_d(3) from public.tasks
                     where schedule_block_id = '00000000-0000-4000-8000-0000000d04e1' and occurrence_date = public.t_d(3))
                   and (select reason from public.training_skips k join public.tasks t on t.id = k.task_id
                         where t.schedule_block_id = '00000000-0000-4000-8000-0000000d04e1' and t.occurrence_date = public.t_d(3))
                       = 'Moved 7 or more days, to ' || to_char(public.t_d(12), 'DD.MM.YYYY'),
  'T2 an every-2-weeks repeat moved 9 days: skipped back on its first day');
select public.t_ok((select count(*) = 1 from public.tasks t join public.time_blocks b on b.task_id = t.id
                     where t.user_id = '00000000-0000-0000-0000-000000000004' and t.hevy_routine_id = 'r4-lower' and t.status = 'open'
                       and t.title = 'Lower E' and t.source_type = 'training_session' and t.schedule_block_id is null
                       and t.due_date = public.t_d(12) and t.due_time = '17:00' and t.first_plan_date = public.t_d(12)
                       and b.date = public.t_d(12) and b.start_time = '17:00' and b.category = 'training'),
  'T2 …and a new Lower E session (with its slot) is planned on the new day, as a one-off gets one (167 planned nothing)');

-- b. Weekly, but that week's session is skipped: still none.
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from)
values ('00000000-0000-4000-8000-0000000d04e2', '00000000-0000-0000-0000-000000000004', 'Upper E',
        array[extract(dow from public.t_d(4))::int], '18:00', '19:00', 'training', public.t_d(4));
set test.uid = '00000000-0000-0000-0000-000000000004';
set role authenticated;
select 1 from public.item_occurrence('00000000-0000-4000-8000-0000000d04e2', public.t_d(4), public.t_d(0), '00000000-0000-0000-0000-000000000004');
select 1 from public.item_occurrence('00000000-0000-4000-8000-0000000d04e2', public.t_d(11), public.t_d(0), '00000000-0000-0000-0000-000000000004');
insert into public.training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
select t.user_id, t.hevy_routine_id, date_trunc('week', public.t_d(11))::date, 'Away', t.id, public.t_d(11)
  from public.tasks t where t.schedule_block_id = '00000000-0000-4000-8000-0000000d04e2' and t.occurrence_date = public.t_d(11);
update public.time_blocks set date = public.t_d(13)
 where schedule_block_id = '00000000-0000-4000-8000-0000000d04e2' and occurrence_date = public.t_d(4);
reset role;
set test.uid = '';
select public.t_ok((select status = 'cancelled' and due_date = public.t_d(4) from public.tasks
                     where schedule_block_id = '00000000-0000-4000-8000-0000000d04e2' and occurrence_date = public.t_d(4))
                   and (select status = 'cancelled' and due_date = public.t_d(11) from public.tasks
                         where schedule_block_id = '00000000-0000-4000-8000-0000000d04e2' and occurrence_date = public.t_d(11))
                   and (select reason from public.training_skips k join public.tasks t on t.id = k.task_id
                         where t.schedule_block_id = '00000000-0000-4000-8000-0000000d04e2' and t.occurrence_date = public.t_d(11)) = 'Away'
                   and (select count(*) = 2 from public.tasks where user_id = '00000000-0000-0000-0000-000000000004' and hevy_routine_id = 'r4-upper'),
  'T2 a weekly repeat moved 9 days onto a week whose session is skipped: skipped in its own week, that week''s skip kept, no new session');

-- c. Weekly, that week's day taken out of the repeat: a new session.
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from)
values ('00000000-0000-4000-8000-0000000d04e3', '00000000-0000-0000-0000-000000000004', 'Legs E',
        array[extract(dow from public.t_d(5))::int], '08:00', '09:00', 'training', public.t_d(5));
set test.uid = '00000000-0000-0000-0000-000000000004';
set role authenticated;
update public.schedule_blocks set except_dates = array[public.t_d(12)] where id = '00000000-0000-4000-8000-0000000d04e3';
select 1 from public.item_occurrence('00000000-0000-4000-8000-0000000d04e3', public.t_d(5), public.t_d(0), '00000000-0000-0000-0000-000000000004');
update public.time_blocks set date = public.t_d(13), start_time = '09:30'
 where schedule_block_id = '00000000-0000-4000-8000-0000000d04e3' and occurrence_date = public.t_d(5);
reset role;
set test.uid = '';
select public.t_ok((select status = 'cancelled' and due_date = public.t_d(5) and due_time = '08:00' from public.tasks
                     where schedule_block_id = '00000000-0000-4000-8000-0000000d04e3' and occurrence_date = public.t_d(5))
                   and (select count(*) = 1 from public.tasks t join public.time_blocks b on b.task_id = t.id
                         where t.user_id = '00000000-0000-0000-0000-000000000004' and t.hevy_routine_id = 'r4-legs' and t.status = 'open'
                           and t.due_date = public.t_d(13) and t.due_time = '09:30' and b.date = public.t_d(13) and b.start_time = '09:30'),
  'T2 a weekly repeat moved 8 days onto a week whose day was taken out of it: a new session there, at the new time');

-- ═══ T5. The app's call from a device a day ahead (account 5) ═════════════
insert into public.hevy_routines (id, user_id, title) values
  ('r5-legs',  '00000000-0000-0000-0000-000000000005', 'Legs F'),
  ('r5-upper', '00000000-0000-0000-0000-000000000005', 'Upper F');
-- A daily repeat with today's day made (the hourly job's run of today).
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, effective_from)
values ('00000000-0000-4000-8000-0000000e05e1', '00000000-0000-0000-0000-000000000005', 'Water plants',
        array[0, 1, 2, 3, 4, 5, 6], '08:00', '08:15', 'other', public.t_d(-10));
select public.t_ok((public.repeat_days_for_user('00000000-0000-0000-0000-000000000005', public.t_d(0)) ->> 'created')::int = 1,
  'before: the run of today makes one day');
select public.t_ok(exists (select 1 from public.tasks where schedule_block_id = '00000000-0000-4000-8000-0000000e05e1'
                             and occurrence_date = public.t_d(0) and status = 'open'),
  'before: today''s day of the repeat is open');
-- Legs F first planned 6 days ago, moved inside its week to today (its week's last day).
select public.t_session('00000000-0000-0000-0000-000000000005', '00000000-0000-4000-8000-0000000e0501', 'Legs F', 'r5-legs', -6, '18:00');
set test.uid = '00000000-0000-0000-0000-000000000005';
set role authenticated;
update public.time_blocks set date = public.t_d(0) where task_id = '00000000-0000-4000-8000-0000000e0501';
reset role;
set test.uid = '';
-- Upper F 8 days ago, never done: its week ended yesterday.
select public.t_session('00000000-0000-0000-0000-000000000005', '00000000-0000-4000-8000-0000000e0502', 'Upper F', 'r5-upper', -8, '18:00');
-- 23:30 in Oslo on a phone set to UTC+3: its date is tomorrow.
set test.uid = '00000000-0000-0000-0000-000000000005';
set role authenticated;
create temp table t_run5 as select public.app_repeat_days_today(public.t_d(1)) as r;
reset role;
set test.uid = '';
select public.t_ok((select (r ->> 'today')::date = public.t_d(1) and (r ->> 'missed')::int = 0 and (r ->> 'skipped')::int = 1 from t_run5),
  'T5 the app''s call a day ahead: takes the device''s day, misses nothing, skips one session');
select public.t_ok((select status = 'open' and due_date = public.t_d(0) from public.tasks where id = '00000000-0000-4000-8000-0000000e0501')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000e0501') is null,
  'T5 a session planned for today stays to do (167 skipped it "Not done within 7 days")');
select public.t_ok((select status = 'open' and closed_reason is null from public.tasks
                     where schedule_block_id = '00000000-0000-4000-8000-0000000e05e1' and occurrence_date = public.t_d(0)),
  'T5 today''s day of a repeat stays open (156 closed it as missed)');
select public.t_ok(exists (select 1 from public.tasks where schedule_block_id = '00000000-0000-4000-8000-0000000e05e1'
                             and occurrence_date = public.t_d(1) and status = 'open'),
  'T5 the device''s day is still made (making days ahead is as before)');
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000e0502')
                   and public.t_skip_of('00000000-0000-4000-8000-0000000e0502') = 'Not done within 7 days',
  'T5 a session whose week ended by Oslo''s date is still skipped');

-- ═══ T8. A session 'waiting' is still to do (account 6) ════════════════════
insert into public.hevy_routines (id, user_id, title) values
  ('r6-lower', '00000000-0000-0000-0000-000000000006', 'Lower G'),
  ('r6-upper', '00000000-0000-0000-0000-000000000006', 'Upper G');
-- a. Waiting, then its routine's workout two days later (inside its week).
select public.t_session('00000000-0000-0000-0000-000000000006', '00000000-0000-4000-8000-0000000f0601', 'Lower G', 'r6-lower', -2, '17:00');
update public.tasks set status = 'waiting' where id = '00000000-0000-4000-8000-0000000f0601';
select public.t_workout('00000000-0000-0000-0000-000000000006', 'w6-lower-0', 'r6-lower', 0, '07:00');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w6-lower-0' from public.tasks where id = '00000000-0000-4000-8000-0000000f0601'),
  'T8 a session waiting is completed by its routine''s workout inside its week (141/167 left it waiting)');
-- b. A workout no plan took, then a waiting session moved onto its week (166's recheck offers it).
select public.t_workout('00000000-0000-0000-0000-000000000006', 'w6-upper-2', 'r6-upper', -2, '18:00');
select public.t_session('00000000-0000-0000-0000-000000000006', '00000000-0000-4000-8000-0000000f0602', 'Upper G', 'r6-upper', -4, '18:00');
update public.tasks set status = 'waiting' where id = '00000000-0000-4000-8000-0000000f0602';
select public.t_ok((select status = 'waiting' and hevy_workout_id is null from public.tasks where id = '00000000-0000-4000-8000-0000000f0602'),
  'before: waiting, its routine''s workout of 2 days ago free');
set test.uid = '00000000-0000-0000-0000-000000000006';
set role authenticated;
update public.time_blocks set date = public.t_d(-3) where task_id = '00000000-0000-4000-8000-0000000f0602';
reset role;
set test.uid = '';
select public.t_ok((select status = 'done' and hevy_workout_id = 'w6-upper-2' from public.tasks where id = '00000000-0000-4000-8000-0000000f0602'),
  'T8 a waiting session moved: 166''s recheck finds its routine''s workout and completes it');
-- c. A waiting session with no routine: the one workout of that day stands in (141's step 4).
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, source_type)
values ('00000000-0000-4000-8000-0000000f0603', '00000000-0000-0000-0000-000000000006', 'Gym', 'personal', 'backlog', 'waiting', 'medium',
        public.t_d(-20), 'training_session');
select public.t_workout('00000000-0000-0000-0000-000000000006', 'w6-free-20', null, -20, '10:00');
select public.t_ok((select status = 'done' and hevy_workout_id = 'w6-free-20' from public.tasks where id = '00000000-0000-4000-8000-0000000f0603'),
  'T8 a waiting session with no routine is completed by that day''s workout');
