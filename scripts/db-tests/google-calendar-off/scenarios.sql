-- Migration 208 (Google Calendar goes; Google Tasks and Apple Calendar stay) on the live item chain (135–193) with the
-- items of seed.sql, after 208 ran twice (scripts/verify-db-google-calendar-off.mjs). Setup and checks run as the
-- superuser; app writes as `authenticated` (test.uid unset = the owner). Made-up data only.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create or replace function public.t_target(p uuid) returns text language sql as $$ select google_target from public.tasks where id = p $$;

-- ═══ G0. Nothing queues or sends Google Calendar work ════════════════════════
select t_ok(not exists (select 1 from pg_trigger where not tgisinternal and tgname in ('trg_enqueue_calendar_event_delete',
              'trg_enqueue_calendar_event_upsert', 'trg_enqueue_calendar_series_delete', 'trg_enqueue_calendar_series_upsert',
              'trg_enqueue_calendar_done_mark')),
  'G0 the five Google Calendar outbox triggers are gone');
select t_ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
              and p.proname in ('enqueue_calendar_event_delete', 'enqueue_calendar_event_upsert', 'enqueue_calendar_series_delete',
                                'enqueue_calendar_series_upsert', 'enqueue_calendar_done_mark', 'calendar_outbox_request_upsert',
                                'apply_calendar_readback', 'icloud_hand_over')),
  'G0 their functions, the Google read-back and the Apple hand-over of a Google copy are gone');
select t_ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc ~ 'calendar_outbox' and p.proname <> 'app_undo_outbox'),
  'G0 no function but Undo''s preview (a read) names calendar_outbox');
select t_ok((select calendar_rows > 1 from public.t_before) and not exists (select 1 from public.calendar_outbox),
  'G0 the waiting Google Calendar work (a delete and an update) was dropped unsent');
select t_ok(not exists (select 1 from pg_namespace where nspname like 'pg_temp%' and exists (
              select 1 from pg_proc p where p.pronamespace = pg_namespace.oid and p.proname in ('area_of', 'on_apple', 'kept_target'))),
  'G0 the migration''s helpers left nothing behind');

-- ═══ G1. Google Calendar items are only in this app; Apple's keep Calendar ═══
select t_ok(t_target('10000000-0000-0000-0000-000000000001') = 'none', 'G1 Personal (on Google) Calendar → None');
select t_ok(t_target('10000000-0000-0000-0000-000000000002') = 'tasks'
        and (select google_sync_enabled and google_task_id is not null from public.tasks where id = '10000000-0000-0000-0000-000000000002'),
  'G1 Personal Both → Tasks, its Google Task kept');
select t_ok(t_target('10000000-0000-0000-0000-000000000003') = 'calendar', 'G1 a training session (Training on Apple) keeps Calendar = Apple');
select t_ok(t_target('10000000-0000-0000-0000-000000000004') = 'calendar', 'G1 Work (on Google) with an Apple copy keeps Calendar');
select t_ok(t_target('10000000-0000-0000-0000-000000000005') = 'none', 'G1 a Personal item from before 155 on Google Calendar → None');
select t_ok(t_target('10000000-0000-0000-0000-000000000006') = 'calendar', 'G1 an item from before 155 with a Hevy routine (Training, Apple) → Calendar');
select t_ok(t_target('10000000-0000-0000-0000-000000000007') = 'tasks', 'G1 an item from before 155 on Google Calendar and Tasks → Tasks');
select t_ok(t_target('10000000-0000-0000-0000-000000000008') = 'tasks' and t_target('10000000-0000-0000-0000-000000000010') = 'none',
  'G1 Tasks and None are untouched');
select t_ok(t_target('10000000-0000-0000-0000-000000000009') = 'none', 'G1 Media "on Apple" but not in use counted as Google → None');
select t_ok(t_target('20000000-0000-0000-0000-000000000001') = 'none', 'G1 another account with no settings → None');
select t_ok((select google_target from public.schedule_blocks where id = '12000000-0000-0000-0000-000000000001') = 'none'
        and t_target('13000000-0000-0000-0000-000000000001') = 'none',
  'G1 a Personal repeat on Google → None, its day task with it');
select t_ok((select google_target from public.schedule_blocks where id = '12000000-0000-0000-0000-000000000002') = 'calendar'
        and t_target('13000000-0000-0000-0000-000000000002') = 'calendar',
  'G1 a Training repeat in Apple keeps Calendar, its day task too');
select t_ok((select google_target from public.schedule_blocks where id = '12000000-0000-0000-0000-000000000003') = 'none',
  'G1 a repeat from before 155 on Google Calendar → None');

-- ═══ G2. Google's links are forgotten; the rest of the row stays ═════════════
select t_ok(not exists (select 1 from public.time_blocks where google_calendar_event_id is not null)
        and not exists (select 1 from public.schedule_blocks where google_calendar_event_id is not null or google_calendar_from is not null
                          or google_calendar_horizon is not null)
        and not exists (select 1 from public.tasks where google_calendar_event_id is not null),
  'G2 no slot, repeat or task names a Google Calendar event');
select t_ok((select google_calendar_time_zone = 'Europe/Oslo' from public.schedule_blocks where id = '12000000-0000-0000-0000-000000000001')
        and (select title = 'Dentist (moved)' and start_time = '09:00' from public.time_blocks where id = '11000000-0000-0000-0000-000000000001')
        and (select icloud_area = 'work' from public.time_blocks where id = '11000000-0000-0000-0000-000000000004')
        and exists (select 1 from public.time_blocks where id = '11000000-0000-0000-0000-000000000011'),
  'G2 a repeat keeps its zone, a slot its day, time and Apple copy; the episode slot stays (only its link goes)');
select t_ok((select icloud_rows from public.t_before) = (select count(*) from public.icloud_outbox)
        and (select tasks_rows from public.t_before) = (select count(*) from public.google_tasks_outbox),
  'G2 the migration queued nothing for Apple or Google Tasks');

-- ═══ G3. Every area on Apple; iCloud connected = writes on ═══════════════════
select t_ok((select count(*) = 4 and bool_and(v ->> 'app' = 'apple') from public.calendar_prefs cp, jsonb_each(cp.prefs -> 'areas') e(k, v)
              where cp.user_id = '00000000-0000-0000-0000-000000000001'),
  'G3 every saved area is on Apple');
select t_ok((select prefs #>> '{areas,work,alertMinutes}' = '10' and prefs #>> '{areas,media,enabled}' = 'false' and prefs ->> 'notes' = 'notes'
                    and prefs ->> 'showMarks' = 'true' and prefs #>> '{areas,personal,name}' = 'Lasci · Personal'
               from public.calendar_prefs where user_id = '00000000-0000-0000-0000-000000000001'),
  'G3 the rest of the settings stays (an alert, an area not in use, notes, marks, names)');
select t_ok(public.icloud_writes_on('00000000-0000-0000-0000-000000000001') and not public.icloud_writes_on('00000000-0000-0000-0000-000000000002'),
  'G3 writes are on where iCloud is connected, off where it is not');
select t_ok(not has_function_privilege('authenticated', 'public.icloud_writes_on(uuid)', 'execute')
        and has_function_privilege('service_role', 'public.icloud_writes_on(uuid)', 'execute'),
  'G3 icloud_writes_on keeps 174''s rights (service role only)');

-- ═══ G4. A second run changed nothing ════════════════════════════════════════
select t_ok(not exists (
  (select 'task', id, google_target, google_calendar_event_id, null::date from public.tasks
   union all select 'slot', id, null, google_calendar_event_id, null from public.time_blocks
   union all select 'plan', id, google_target, google_calendar_event_id, google_calendar_from from public.schedule_blocks
   union all select 'prefs', user_id, prefs::text, null, null from public.calendar_prefs)
  except select * from public.t_after_one),
  'G4 a second run changed nothing');

select t_ok((select prefs #>> '{areas,training,app}' = 'apple' from public.calendar_prefs where user_id = '00000000-0000-0000-0000-000000000003')
        and not exists (select 1 from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000003'),
  'G4 Training moved from Google to Apple sends no past workout to Apple');
update public.calendar_prefs set prefs = prefs #- '{areas,training,app}' where user_id = '00000000-0000-0000-0000-000000000003';
select t_ok(not exists (select 1 from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000003'),
  'G4 a save without the retired `app` key (the new app) re-sends nothing');
update public.calendar_prefs set prefs = jsonb_set(prefs, '{areas,training,enabled}', 'false') where user_id = '00000000-0000-0000-0000-000000000003';
select t_ok(exists (select 1 from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000003' and entity = 'workout'),
  'G4 Training turned off or on still sends (or takes away) its workouts');
delete from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000003';
update public.calendar_prefs set prefs = jsonb_set(prefs, '{areas,training,enabled}', 'true') where user_id = '00000000-0000-0000-0000-000000000003';


-- ═══ G5. After 208: saves, edits, ticks and deletes reach Apple, never Google Calendar ═══
set role authenticated;
select public.app_save_item(jsonb_build_object('title', 'Haircut', 'domain', 'personal', 'priority', 'medium', 'date', '2026-12-10',
  'time', '11:00', 'durationMinutes', 30, 'google', 'calendar', 'today', '2026-11-25'));
reset role;
select t_ok(exists (select 1 from public.tasks t join public.time_blocks b on b.task_id = t.id
                     where t.title = 'Haircut' and t.google_target = 'calendar' and b.google_calendar_event_id is null)
        and exists (select 1 from public.icloud_outbox o join public.time_blocks b on b.id = o.entity_id where b.title = 'Haircut'),
  'G5 a new Calendar item is saved and queued for Apple Calendar (iCloud connected)');
update public.time_blocks set start_time = '10:00' where id = '11000000-0000-0000-0000-000000000004';
update public.tasks set status = 'done' where id = '10000000-0000-0000-0000-000000000004';
update public.schedule_blocks set title = 'Upper A (heavy)' where id = '12000000-0000-0000-0000-000000000002';
delete from public.time_blocks where id = '11000000-0000-0000-0000-000000000003';
delete from public.schedule_blocks where id = '12000000-0000-0000-0000-000000000003';
select t_ok(not exists (select 1 from public.calendar_outbox),
  'G5 a move, a tick, a repeat''s rename and two deletes queue nothing for Google Calendar');
select t_ok(exists (select 1 from public.icloud_outbox where entity = 'slot' and entity_id = '11000000-0000-0000-0000-000000000004')
        and exists (select 1 from public.icloud_outbox where entity = 'plan' and entity_id = '12000000-0000-0000-0000-000000000002'),
  'G5 the Apple items'' changes are queued for Apple as before');

-- ═══ G6. Google Tasks keeps working ══════════════════════════════════════════
select t_ok(exists (select 1 from public.user_calendar_tokens where user_id = '00000000-0000-0000-0000-000000000001'),
  'G6 Google''s sign-in (Google Tasks'') is kept');
update public.tasks set title = 'Post office (parcel)' where id = '10000000-0000-0000-0000-000000000002';
select t_ok(exists (select 1 from public.google_tasks_outbox where task_id = '10000000-0000-0000-0000-000000000002'),
  'G6 a Google Task''s change is queued for Google Tasks as before');
