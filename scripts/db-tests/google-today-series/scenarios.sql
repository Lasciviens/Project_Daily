-- Scenarios for migration 148: an undated Google task is filed under Today;
-- schedule_blocks.google_calendar_from. Run after 145's own scenarios
-- (scripts/db-tests/google-tasks-pull/scenarios.sql), which must still pass
-- against 148's upsert. Each `ok` raises on a mismatch.
create or replace function ok(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;

-- The cron path again (145's scenarios end signed in as a browser).
select set_config('test.role', 'service_role', false), set_config('test.uid', '', false),
       set_config('app.google_sync_write', '', false);
delete from google_tasks_outbox;

create or replace function sec(g text) returns text language sql as $$
  select coalesce(section, 'null') || ' ' || coalesce(due_date::text, 'undated') from tasks where google_task_id = g
$$;

-- T1 a new task without a date is filed under Today; with one, in the Inbox (as before).
select upsert_task_from_google('t-undated', 'Call the bank', null, null, 'needsAction', '2026-10-14T07:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T1 a new undated Google task is filed under Today', sec('t-undated'), 'today undated');
select upsert_task_from_google('t-dated', 'Pay rent', null, '2026-10-20', 'needsAction', '2026-10-14T07:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T1 a new dated Google task stays in the Inbox (on its day by its date)', sec('t-dated'), 'inbox 2026-10-20');
select upsert_task_from_google('t-done-undated', 'Old errand', null, null, 'completed', '2026-10-14T07:00:00Z',
  p_completed_at => '2026-10-13T10:00:00Z', p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T1 a new completed undated task is done (it shows on the day it was closed)',
  (select status || ' ' || section from tasks where google_task_id = 't-done-undated'), 'done today');
select ok('T1 the imports queued nothing back to Google', (select count(*)::text from google_tasks_outbox), '0');

-- T2 a re-read that changes nothing keeps the section (no churn every 20 minutes).
select upsert_task_from_google('t-undated', 'Call the bank', 'before 12', null, 'needsAction', '2026-10-14T07:20:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select upsert_task_from_google('t-dated', 'Pay rent', null, '2026-10-21', 'needsAction', '2026-10-14T07:20:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T2 an undated Today task stays in Today', sec('t-undated'), 'today undated');
select ok('T2 a dated Inbox task whose date moves stays in the Inbox', sec('t-dated'), 'inbox 2026-10-21');

-- T3 Google takes the date away from a task nobody filed → Today.
select upsert_task_from_google('t-dated', 'Pay rent', null, null, 'needsAction', '2026-10-14T07:40:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T3 date taken away on Google: Inbox → Today', sec('t-dated'), 'today undated');

-- T4 Google gives a date to an undated Today task → the Inbox (so next week's
--    task leaves today's server-side lists, which read section = 'today').
select upsert_task_from_google('t-undated', 'Call the bank', 'before 12', '2026-10-22', 'needsAction', '2026-10-14T08:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T4 a date given on Google: Today → Inbox', sec('t-undated'), 'inbox 2026-10-22');

-- T5 a section the owner chose stays, whatever Google does to the date.
select set_config('app.google_sync_write', 'true', false);
update tasks set section = 'backlog' where google_task_id in ('t-undated', 't-dated');
select set_config('app.google_sync_write', '', false);
select upsert_task_from_google('t-undated', 'Call the bank', 'before 12', null, 'needsAction', '2026-10-14T08:20:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select upsert_task_from_google('t-dated', 'Pay rent', null, '2026-10-25', 'needsAction', '2026-10-14T08:20:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T5 Backlog keeps an undated task in Backlog', sec('t-undated'), 'backlog undated');
select ok('T5 Backlog keeps a newly dated task in Backlog', sec('t-dated'), 'backlog 2026-10-25');
-- …and an undated task the owner put back in the Inbox stays there on the next read.
select set_config('app.google_sync_write', 'true', false);
update tasks set section = 'inbox' where google_task_id = 't-undated';
select set_config('app.google_sync_write', '', false);
select upsert_task_from_google('t-undated', 'Call the bank', 'before 12', null, 'needsAction', '2026-10-14T08:40:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T5 an undated task moved to the Inbox here is not pulled back to Today', sec('t-undated'), 'inbox undated');

-- T6 a pending outbox row (a local edit not yet on Google) holds the date AND the section.
select upsert_task_from_google('t-pending', 'Book dentist', null, null, 'needsAction', '2026-10-14T09:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
insert into google_tasks_outbox (user_id, task_id, operation)
  select user_id, id, 'update' from tasks where google_task_id = 't-pending';
select upsert_task_from_google('t-pending', 'Book dentist', null, '2026-11-02', 'needsAction', '2026-10-14T09:10:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T6 pending row: neither the date nor the section moves', sec('t-pending'), 'today undated');
delete from google_tasks_outbox;

-- T7 the server-side "today" lists (phone-gateway, push-send, ai-proxy read
--    section = 'today' or due today, open ones) now carry the undated import.
select upsert_task_from_google('t-server', 'Buy stamps', null, null, 'needsAction', '2026-10-14T09:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T7 a server-side today list finds the undated Google task',
  (select count(*)::text from tasks
    where user_id = '00000000-0000-4000-8000-0000000000a1' and google_task_id = 't-server'
      and (section = 'today' or due_date = '2026-10-14') and status not in ('cancelled', 'done')), '1');
select upsert_task_from_google('t-server', 'Buy stamps', null, '2026-10-21', 'needsAction', '2026-10-14T09:20:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('T7 …and no longer once Google dated it for next week',
  (select count(*)::text from tasks
    where user_id = '00000000-0000-4000-8000-0000000000a1' and google_task_id = 't-server'
      and (section = 'today' or due_date = '2026-10-14') and status not in ('cancelled', 'done')), '0');

-- T8 still one upsert, still only the service role.
select ok('T8 exactly one upsert_task_from_google', (select count(*)::text from pg_proc where proname = 'upsert_task_from_google'), '1');
select ok('T8 authenticated cannot upsert', has_function_privilege('authenticated', 'public.upsert_task_from_google(text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb)', 'execute')::text, 'false');
select ok('T8 anon cannot upsert', has_function_privilege('anon', 'public.upsert_task_from_google(text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb)', 'execute')::text, 'false');
select ok('T8 service_role can upsert', has_function_privilege('service_role', 'public.upsert_task_from_google(text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb)', 'execute')::text, 'true');

-- S1 schedule_blocks.google_calendar_from: a nullable date; existing plans untouched.
select ok('S1 the column is a nullable date',
  (select data_type || ' ' || is_nullable from information_schema.columns
    where table_name = 'schedule_blocks' and column_name = 'google_calendar_from'), 'date YES');
select ok('S1 a plan linked before 148 has no start day (its next push sets one)',
  (select coalesce(google_calendar_from::text, 'null') || ' ' || google_calendar_event_id from schedule_blocks
    where id = '00000000-0000-4000-8000-00000000d001'), 'null 00000000000040008000000000d001');

-- S2 the browser writes it with the link (setScheduleBlockCalendarLink) and clears it with it.
set role authenticated;
update schedule_blocks set google_calendar_from = '2026-10-14' where id = '00000000-0000-4000-8000-00000000d001';
reset role;
select ok('S2 the browser can store the day',
  (select google_calendar_from::text from schedule_blocks where id = '00000000-0000-4000-8000-00000000d001'), '2026-10-14');
set role authenticated;
update schedule_blocks set google_calendar_event_id = null, google_calendar_horizon = null, google_calendar_from = null
 where id = '00000000-0000-4000-8000-00000000d001' and google_calendar_event_id = '00000000000040008000000000d001';
reset role;
select ok('S2 …and clear it with the link',
  (select coalesce(google_calendar_from::text, 'null') || ' ' || coalesce(google_calendar_event_id, 'null') from schedule_blocks
    where id = '00000000-0000-4000-8000-00000000d001'), 'null null');
