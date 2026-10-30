-- Migrations 173–175 (the app's events in Apple Calendar, the writer): the queue
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
select public.t_ok(not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and ((table_name in ('time_blocks', 'schedule_blocks') and column_name = 'icloud_href')
                          or (table_name = 'icloud_outbox' and column_name = 'href')))
                   and (select icloud_area from public.time_blocks where id = '20000000-0000-0000-0000-0000000000aa') is null,
  '174/175: a forged address left from 173 is gone with its column, and the row it was on points nowhere');
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


-- ── 175: the switch per area ─────────────────────────────────────────────────
delete from public.icloud_outbox;
select public.t_ok(not ('icloud_href' = any(public.app_undo_links('time_blocks')))
                   and 'icloud_area' = any(public.app_undo_links('schedule_blocks')),
  '175: Undo no longer names the dropped column (and still leaves the Apple link as it is)');

-- Moving back to Google: a slot that still has its Apple copy gets its Google copy — queued, so the Apple copy can go.
insert into public.time_blocks (id, user_id, date, title, start_time, category, icloud_area)
values ('20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '2026-11-10', 'Match', '20:00', 'football', 'football');
delete from public.icloud_outbox;
set role authenticated;
update public.time_blocks set google_calendar_event_id = '20000000000000000000000000000011' where id = '20000000-0000-0000-0000-000000000011';
select public.t_ok(public.t_queue() = 1, '175: a Google copy made for an item still in Apple Calendar queues it (the Apple copy goes only after)');

-- Moving to Apple: the Apple copy is in, the Google copy is handed to Google's delete queue.
select public.t_ok(public.t_err($$select public.icloud_hand_over('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000011', '20000000000000000000000000000011')$$) = '42501',
  '175: the browser can''t hand a Google copy over (only the function can)');
reset role;
delete from public.icloud_outbox;
insert into public.calendar_outbox (user_id, event_id, operation, time_block_id)
values ('00000000-0000-0000-0000-000000000001', '20000000000000000000000000000011', 'upsert', '20000000-0000-0000-0000-000000000011');
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000002', 'slot', '20000000-0000-0000-0000-000000000011', '20000000000000000000000000000011') = 'changed'
                   and (select google_calendar_event_id from public.time_blocks where id = '20000000-0000-0000-0000-000000000011') is not null,
  '175: another account can''t hand over the owner''s slot');
-- (The answer and the state are checked in two statements: a statement sees the rows as they were when it began.)
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000011', '20000000000000000000000000000011') = 'handed',
  '175: the owner''s own copy is handed over');
select public.t_ok((select google_calendar_event_id from public.time_blocks where id = '20000000-0000-0000-0000-000000000011') is null
                   and (select operation from public.calendar_outbox where event_id = '20000000000000000000000000000011') = 'delete',
  '175: the Apple copy in, its Google copy is queued for deletion (a delete wins over a waiting update) and the link cleared');
select public.t_ok(public.t_queue() = 0, '175: the hand-over itself queues nothing for Apple (no loop)');
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000011', '20000000000000000000000000000011') = 'changed',
  '175: a second hand-over of the same copy does nothing');
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000001', null, '20000000-0000-0000-0000-000000000011', '20000000000000000000000000000011') = 'changed',
  '175: a hand-over that names no kind of item does nothing');

-- Only the item's own event: an id the app didn't make for this item is never deleted.
update public.time_blocks set google_calendar_event_id = 'meeting4owner' where id = '20000000-0000-0000-0000-000000000011';
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000011', 'meeting4owner') = 'foreign',
  '175: a stored id that isn''t the item''s own (a forged one, a day moved in Google) is foreign');
select public.t_ok((select google_calendar_event_id from public.time_blocks where id = '20000000-0000-0000-0000-000000000011') is null
                   and not exists (select 1 from public.calendar_outbox where event_id = 'meeting4owner'),
  '175: …it is never deleted, but the item lets go of it (Google''s read-back of it can''t take the item off Apple Calendar)');
update public.time_blocks set google_calendar_event_id = 'x20000000000000000000000000000011' where id = '20000000-0000-0000-0000-000000000011';
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000011', 'x20000000000000000000000000000011') = 'foreign',
  '175: the own-id check is exact — no prefix');
update public.time_blocks set google_calendar_event_id = '20000000000000000000000000000011v9' where id = '20000000-0000-0000-0000-000000000011';
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000011', '20000000000000000000000000000011v9') = 'foreign'
                   and not exists (select 1 from public.calendar_outbox where event_id like '%v9'),
  '175: …and no id past the sequence (never deleted)');

-- A plan: its series' Google bookkeeping goes with the link; a later id of its sequence is its own.
update public.schedule_blocks set google_calendar_event_id = '30000000000000000000000000000001v2', google_calendar_horizon = '2027-10-30', google_calendar_from = '2026-10-01'
 where id = '30000000-0000-0000-0000-000000000001';
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000001', 'plan', '30000000-0000-0000-0000-000000000001', '30000000000000000000000000000001v2') = 'handed',
  '175: a later id of a plan''s own sequence is its own');
select public.t_ok((select google_calendar_event_id is null and google_calendar_horizon is null and google_calendar_from is null
                          from public.schedule_blocks where id = '30000000-0000-0000-0000-000000000001')
                   and (select payload ->> 'series' from public.calendar_outbox where event_id = '30000000000000000000000000000001v2') = 'true',
  '175: a plan''s series is handed over the same way (its Google start and horizon forgotten)');

-- On a calendar: Apple's series counts as Google's did (a repeat saved before 155 stays on Calendar).
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, category, icloud_area)
values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Swim', '{2}', '06:30', '07:30', 'training', 'training'),
       ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Read', '{2}', '21:00', '21:30', 'personal', null);
select public.t_ok((select public.repeat_day_presence(sb) from public.schedule_blocks sb where sb.id = '30000000-0000-0000-0000-000000000002') = 'calendar'
                   and (select public.repeat_day_presence(sb) from public.schedule_blocks sb where sb.id = '30000000-0000-0000-0000-000000000003') = 'none',
  '175: a repeat whose series is in Apple Calendar is on Calendar; one in neither is not');

-- Moving to Google Tasks: the Apple copy waits for the Google Task — its appearing queues the slot.
delete from public.icloud_outbox;
insert into public.tasks (id, user_id, title, google_target) values ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Upper A', 'tasks');
insert into public.time_blocks (id, user_id, date, title, start_time, category, task_id, icloud_area)
values ('20000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '2026-11-11', 'Upper A', '17:30', 'training', '10000000-0000-0000-0000-000000000012', 'training');
delete from public.icloud_outbox;
update public.tasks set google_task_id = 'gt-upper-a' where id = '10000000-0000-0000-0000-000000000012';
select public.t_ok((select count(*) from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000001' and entity_id = '20000000-0000-0000-0000-000000000012') = 1
                   and (select count(*) from public.icloud_outbox where user_id = '00000000-0000-0000-0000-000000000002') = 0,
  '175: a Google Task made for an item in Apple Calendar queues its slot (only the owner''s own)');
delete from public.icloud_outbox;
insert into public.tasks (id, user_id, title, schedule_block_id, occurrence_date)
values ('10000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'Swim', '30000000-0000-0000-0000-000000000002', '2026-11-03');
delete from public.icloud_outbox;
update public.tasks set google_sync_enabled = true, google_task_id = 'gt-swim' where id = '10000000-0000-0000-0000-000000000022';
select public.t_ok((select count(*) from public.icloud_outbox where entity = 'plan' and entity_id = '30000000-0000-0000-0000-000000000002') = 1,
  '175: a repeat''s day task getting its Google Task queues the repeat (its Apple series waited for it)');

-- ── 176: changes made in Apple Calendar come back ───────────────────────────
reset role;
set role authenticated;
select public.t_ok(public.t_err($$select public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000011', 'football', '{}', null)$$) = '42501'
                   and public.t_err($$select count(*) from public.icloud_sync_state$$) = '42501',
  '176: the browser can''t apply a read-back change or read the sync state');
reset role;

-- A match moved and renamed on the iPhone: the slot and its task follow, iCloud's version is kept.
insert into public.tasks (id, user_id, title, google_target) values ('10000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'Match', 'calendar');
insert into public.time_blocks (id, user_id, date, title, start_time, duration_minutes, category, task_id, icloud_area)
values ('20000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', '2026-11-12', 'Match', '20:00', 60, 'football', '10000000-0000-0000-0000-000000000021', 'football');
delete from public.icloud_outbox;
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000021', 'football',
  jsonb_build_object('date', '2026-11-13', 'time', '18:30', 'minutes', 90, 'busy', true, 'title', 'Match (moved)', 'lastModified', (now() + interval '1 minute')::text), '"e1"') = 'moved',
  '176: an event moved and renamed on the iPhone: moved');
select public.t_ok((select (date, start_time, duration_minutes, icloud_etag) = ('2026-11-13'::date, '18:30'::time, 90, '"e1"') from public.time_blocks where id = '20000000-0000-0000-0000-000000000021')
                   and (select title from public.tasks where id = '10000000-0000-0000-0000-000000000021') = 'Match (moved)',
  '176: …the slot has the new day, time and length, its task the new title, and iCloud''s version is kept (If-Match)');
select public.t_ok((select count(*) from public.icloud_outbox where entity_id = '20000000-0000-0000-0000-000000000021') = 1,
  '176: …and it is queued once (the same data goes back; a rule the move sets off reaches Apple too)');
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000021', 'football',
  jsonb_build_object('date', '2026-11-20', 'time', '09:00', 'lastModified', '2020-01-01T00:00:00Z'), '"e2"') = 'stale',
  '176: an older change: stale');
select public.t_ok((select date from public.time_blocks where id = '20000000-0000-0000-0000-000000000021') = '2026-11-13',
  '176: a change older than the app''s own last change is not applied (the app''s change wins and is sent)');
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000021', 'football', '{"date":"2026-11-20","time":"09:00"}', '"own"') = 'stale',
  '176: a change with no LAST-MODIFIED stamp (the app''s own write read back) is never applied');
select public.t_ok((select (date, icloud_etag) = ('2026-11-13'::date, '"own"') from public.time_blocks where id = '20000000-0000-0000-0000-000000000021'),
  '176: …only iCloud''s version is kept');
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000021', 'training', '{"date":"2026-11-20"}', null) = 'not_ours'
                   and public.apply_icloud_readback('00000000-0000-0000-0000-000000000002', 'slot', '20000000-0000-0000-0000-000000000021', 'football', '{"date":"2026-11-20"}', null) = 'not_ours',
  '176: only the slot''s own account, and only from the calendar its event is in');
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000021', 'football', '{"date":"20.11.2026"}', null) = 'ignored'
                   and public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000021', '../work', '{}', null) = 'ignored',
  '176: a value that isn''t what it says is ignored, never applied');
select public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000021', 'football',
  jsonb_build_object('title', E'Match\r\nATTENDEE:mailto:ola@example.com', 'lastModified', (now() + interval '2 minutes')::text), null);
select public.t_ok((select title from public.tasks where id = '10000000-0000-0000-0000-000000000021') = 'MatchATTENDEE:mailto:ola@example.com',
  '176: a title with control characters is stored without them');

-- Deleted on the iPhone: the item lets go of Apple Calendar and stays.
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000021', 'football', '{"deleted":true}', null) = 'unlinked',
  '176: an event deleted on the iPhone: unlinked');
select public.t_ok((select icloud_area from public.time_blocks where id = '20000000-0000-0000-0000-000000000021') is null
                   and (select google_target from public.tasks where id = '10000000-0000-0000-0000-000000000021') = 'none',
  '176: an event deleted on the iPhone: the item stays, off the calendar (never deleted)');
insert into public.tasks (id, user_id, title, google_target, due_date) values ('10000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'Birthday', 'calendar', '2026-11-14');
insert into public.time_blocks (id, user_id, date, title, start_time, category, task_id, icloud_area)
values ('20000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', '2026-11-14', 'Birthday', null, 'football', '10000000-0000-0000-0000-000000000023', 'football');
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '20000000-0000-0000-0000-000000000023', 'football', '{"deleted":true}', null) = 'unlinked',
  '176: an all-day presence deleted on the iPhone: unlinked');
select public.t_ok(not exists (select 1 from public.time_blocks where id = '20000000-0000-0000-0000-000000000023')
                   and exists (select 1 from public.tasks where id = '10000000-0000-0000-0000-000000000023'),
  '176: …an all-day slot that only put the item''s day there goes; the item stays');

-- A repeating plan: renamed, one day moved, one day deleted there.
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'plan', '30000000-0000-0000-0000-000000000002', 'training',
  jsonb_build_object('title', 'Swim 2 km', 'lastModified', (now() + interval '1 minute')::text), '"p1"') = 'renamed',
  '176: a repeat renamed on the iPhone: renamed');
select public.t_ok((select (title, icloud_etag) = ('Swim 2 km', '"p1"') from public.schedule_blocks where id = '30000000-0000-0000-0000-000000000002'),
  '176: a repeat renamed on the iPhone: the plan follows');
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'plan', '30000000-0000-0000-0000-000000000002', 'training',
  jsonb_build_object('lastModified', (now() + interval '3 minutes')::text, 'days',
    '[{"originalDate":"2026-11-03","date":"2026-11-04","time":"07:00","minutes":45,"busy":true},{"originalDate":"2026-11-10","cancelled":true},{"originalDate":"2026-11-11","cancelled":true}]'::jsonb), null) = 'days',
  '176: days of a repeat moved or deleted on the iPhone are taken');
select public.t_ok((select (date, start_time, duration_minutes) = ('2026-11-04'::date, '07:00'::time, 45) from public.time_blocks
                     where schedule_block_id = '30000000-0000-0000-0000-000000000002' and occurrence_date = '2026-11-03')
                   and (select '2026-11-03'::date = any (except_dates) from public.schedule_blocks where id = '30000000-0000-0000-0000-000000000002'),
  '176: …a moved day becomes an item of its own at its new day and time (the series leaves the day out)');
select public.t_ok((select google_target from public.tasks where schedule_block_id = '30000000-0000-0000-0000-000000000002' and occurrence_date = '2026-11-10') = 'none'
                   and not exists (select 1 from public.tasks where schedule_block_id = '30000000-0000-0000-0000-000000000002' and occurrence_date = '2026-11-11'),
  '176: …a deleted day is its own item off the calendar; a day that isn''t one of the repeat''s is left alone');
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'plan', '30000000-0000-0000-0000-000000000002', 'training', '{"deleted":true}', null) = 'unlinked',
  '176: a repeat deleted on the iPhone: unlinked');
select public.t_ok((select icloud_area is null and icloud_from is null from public.schedule_blocks where id = '30000000-0000-0000-0000-000000000002'),
  '176: a repeat deleted on the iPhone lets go of Apple Calendar (the plan stays)');
