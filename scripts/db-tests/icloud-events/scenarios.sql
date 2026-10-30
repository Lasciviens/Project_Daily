-- Migration 173 (the app's events in Apple Calendar, the writer): the queue
-- stays empty while every area is on Google; once one is on Apple, a change
-- to a slot, a repeating plan or a slot's task queues it once (one row per
-- item, the latest request time); the function's own write of the icloud_*
-- columns never queues; a deleted item queues its event's address; the
-- read-back flag queues nothing; the browser can't read the queue; Undo
-- knows the links and the bookkeeping. Setup runs as the superuser (the
-- service role); writes as `authenticated`, like the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_err(text) to authenticated;
create or replace function public.t_queue() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.icloud_outbox
$$;
grant execute on function public.t_queue() to authenticated;

select public.t_ok((select count(*) from pg_policies where tablename = 'icloud_outbox' and policyname = 'app_owner_lock') = 1, '173: the owner lock is on the queue');
select public.t_ok((select count(*) from public.time_blocks where icloud_href is not null) = 0 and (select count(*) from public.icloud_outbox where href is not null) = 0,
  '174: a forged address left from 173 is emptied, and nothing it queued stays');
delete from public.time_blocks where id = '20000000-0000-0000-0000-0000000000aa';
-- (Its insert under 173 also queued it without an address — harmless: the drain reads the live row and derives every address.)
delete from public.icloud_outbox where entity_id = '20000000-0000-0000-0000-0000000000aa';
select public.t_ok(not has_table_privilege('authenticated', 'public.icloud_outbox', 'select') and has_table_privilege('service_role', 'public.icloud_outbox', 'delete'),
  '173: the browser can''t read or write the queue; the function can');
select public.t_ok('icloud_area' = any(public.app_undo_links('time_blocks')) and 'icloud_area' = any(public.app_undo_links('schedule_blocks'))
                   and 'google_calendar_event_id' = any(public.app_undo_links('time_blocks')),
  '173/174: Undo leaves the iCloud links as they are (and still the Google ones)');
select public.t_ok(array['icloud_from', 'icloud_horizon', 'google_calendar_from']::text[] <@ public.app_undo_bookkeeping('schedule_blocks')
                   and 'stock_set_at' = any(public.app_undo_bookkeeping('supplement_schedules')),
  '173: the series'' iCloud start and horizon are bookkeeping; 160''s entries kept');

set role authenticated;
insert into public.tasks (id, title, google_target) values ('10000000-0000-0000-0000-000000000001', 'Lower B', 'calendar');
insert into public.time_blocks (id, date, title, start_time, duration_minutes, category, task_id)
values ('20000000-0000-0000-0000-000000000001', '2026-11-02', 'Lower B', '17:30', 60, 'training', '10000000-0000-0000-0000-000000000001');
update public.time_blocks set title = 'Lower B (heavy)' where id = '20000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 0, 'every area on Google: nothing is queued (Google Calendar works as before)');

insert into public.calendar_prefs (prefs) values ('{"areas":{"training":{"app":"apple"}}}')
  on conflict (user_id) do update set prefs = excluded.prefs;
select public.t_ok(public.t_err($$select public.icloud_writes_on('00000000-0000-0000-0000-000000000001')$$) = '42501',
  'the browser can''t ask whether another account writes to Apple (only the triggers do)');
reset role;
select public.t_ok(public.icloud_writes_on('00000000-0000-0000-0000-000000000001') and not public.icloud_writes_on('00000000-0000-0000-0000-000000000002'),
  'an area on Apple turns the writer on for that account only');
set role authenticated;
update public.time_blocks set start_time = '18:00' where id = '20000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 1, 'a slot moved: queued');
update public.time_blocks set title = 'Lower B' where id = '20000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 1, 'changed again: still one row for it (the latest request)');
update public.time_blocks set color = 'red' where id = '20000000-0000-0000-0000-000000000001';
update public.tasks set priority = 'high' where id = '10000000-0000-0000-0000-000000000001';
reset role;
delete from public.icloud_outbox;
set role authenticated;
update public.time_blocks set color = 'blue' where id = '20000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 0, 'a change the event doesn''t show (a colour, a priority) queues nothing');
update public.tasks set status = 'done' where id = '10000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 1, 'its task done: the slot is queued (the ✓ in the title)');
reset role;
delete from public.icloud_outbox;
-- The function writes which area calendar the event is in (as the service role): that never queues.
update public.time_blocks set icloud_area = 'training' where id = '20000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 0, 'the function''s own write of icloud_area queues nothing (no loop)');
select public.t_ok(public.t_err($$update public.time_blocks set icloud_area = '../work' where id = '20000000-0000-0000-0000-000000000001'$$) = '23514',
  'only one of the five area keys can be stored — never an address');

set role authenticated;
insert into public.schedule_blocks (id, title, days_of_week, start_time, end_time, category, google_target)
values ('30000000-0000-0000-0000-000000000001', 'Gym', '{1,3}', '07:00', '08:00', 'training', 'calendar');
select public.t_ok(public.t_queue() = 1, 'a repeating plan saved: queued');
delete from public.time_blocks where id = '20000000-0000-0000-0000-000000000001';
reset role;
select public.t_ok((select area from public.icloud_outbox where entity = 'slot') = 'training',
  'a slot deleted: its event''s area is queued, so the event goes too');
delete from public.icloud_outbox;

set role authenticated;
select set_config('app.icloud_readback', 'on', false);
update public.schedule_blocks set title = 'Gym (moved on the iPhone)' where id = '30000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 0, 'while the read-back writes (app.icloud_readback on), nothing is sent back');
select set_config('app.icloud_readback', '', false);

-- Off again: an item that has an event still queues (so it can be removed); one that hasn't, doesn't.
reset role;
update public.calendar_prefs set prefs = '{"areas":{"training":{"app":"google"}}}';
update public.schedule_blocks set icloud_area = 'training' where id = '30000000-0000-0000-0000-000000000001';
set role authenticated;
update public.schedule_blocks set title = 'Gym' where id = '30000000-0000-0000-0000-000000000001';
insert into public.time_blocks (date, title, start_time, category) values ('2026-11-05', 'Dentist', '09:00', 'daily');
select public.t_ok(public.t_queue() = 1, 'back on Google: only the plan that still has an Apple event is queued (so it can be taken away)');
reset role;

-- Deleting the account: the cascade must not abort on the queue.
insert into auth.users values ('00000000-0000-0000-0000-000000000009');
insert into public.calendar_prefs (user_id, prefs) values ('00000000-0000-0000-0000-000000000009', '{"areas":{"personal":{"app":"apple"}}}');
insert into public.time_blocks (user_id, date, title, start_time, icloud_area) values ('00000000-0000-0000-0000-000000000009', '2026-11-05', 'x', '09:00', 'personal');
select public.t_ok(public.t_err($$delete from auth.users where id = '00000000-0000-0000-0000-000000000009'$$) is null,
  'deleting an account with an Apple event goes through (a gone user queues nothing)');

-- Another account's slot that points at the owner's task (the foreign key allows it) is never queued by the owner's edit.
delete from public.icloud_outbox;
insert into public.calendar_prefs (user_id, prefs) values ('00000000-0000-0000-0000-000000000002', '{"areas":{"personal":{"app":"apple"}}}')
  on conflict (user_id) do update set prefs = excluded.prefs;
insert into public.time_blocks (id, user_id, date, title, start_time, task_id)
values ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', '2026-11-06', 'Borrowed', '10:00', '10000000-0000-0000-0000-000000000001');
delete from public.icloud_outbox;
update public.tasks set description = 'Private note' where id = '10000000-0000-0000-0000-000000000001';
select public.t_ok((select count(*) from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000002') = 0,
  'the owner''s task edit queues only the owner''s own slots (never another account''s)');

-- A change in Settings → Calendar reaches the events already in that area's calendar (and only those).
delete from public.icloud_outbox;
update public.calendar_prefs set prefs = '{"areas":{"training":{"app":"apple","emoji":"💪"}}}' where user_id = '00000000-0000-0000-0000-000000000001';
select public.t_ok((select count(*) from public.icloud_outbox where entity = 'plan' and entity_id = '30000000-0000-0000-0000-000000000001') = 1
                   and (select count(*) from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000001') = 1,
  'an area''s emoji changed: its events already in Apple Calendar are queued');
delete from public.icloud_outbox;
update public.calendar_prefs set prefs = '{"areas":{"training":{"app":"apple","emoji":"💪"},"media":{"emoji":"🎬"}}}' where user_id = '00000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 0, 'another area changed, with nothing of it in Apple Calendar: nothing queued');

-- A plan's stored zone changed: its series is written again.
update public.schedule_blocks set google_calendar_time_zone = 'Europe/Istanbul' where id = '30000000-0000-0000-0000-000000000001';
select public.t_ok(public.t_queue() = 1, 'a plan''s time zone changed: queued');
delete from public.icloud_outbox;

-- Undo's preview names Apple Calendar for what the same transaction queued.
begin;
update public.schedule_blocks set title = 'Gym (undo test)' where id = '30000000-0000-0000-0000-000000000001';
select public.t_ok((public.app_undo_outbox() -> 'rows') @> '[{"s":"apple_calendar"}]', 'Undo''s preview lists the Apple Calendar change it would send');
rollback;

