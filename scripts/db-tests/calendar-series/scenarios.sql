-- Scenarios for migration 147 (a repeating plan's Google Calendar event).
-- `ok` raises on a mismatch; the runner fails on the first exception.
create or replace function ok(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;

-- C0 the columns, and old rows untouched
select ok('C0 google_calendar_event_id is text, nullable',
  (select data_type || '/' || is_nullable from information_schema.columns where table_name = 'schedule_blocks' and column_name = 'google_calendar_event_id'), 'text/YES');
select ok('C0 google_calendar_horizon is a date, nullable',
  (select data_type || '/' || is_nullable from information_schema.columns where table_name = 'schedule_blocks' and column_name = 'google_calendar_horizon'), 'date/YES');
select ok('C0 no existing plan is linked (nothing is pushed in bulk)',
  (select count(*)::text from schedule_blocks where google_calendar_event_id is not null or google_calendar_horizon is not null), '0');
select ok('C0 the re-run left one trigger, not two',
  (select count(*)::text from pg_trigger where tgrelid = 'public.schedule_blocks'::regclass and tgname = 'trg_enqueue_calendar_series_delete'), '1');
select ok('C0 the trigger function is SECURITY DEFINER',
  (select prosecdef::text from pg_proc where proname = 'enqueue_calendar_series_delete'), 'true');

-- C1 the browser links a plan (its own role, RLS on) and later deletes it
set role authenticated;
update schedule_blocks set google_calendar_event_id = '0000000000004000800000000000000a', google_calendar_horizon = '2027-11-14'
 where id = '00000000-0000-4000-8000-000000000002';
select ok('C1 the browser may write the link on its own plan',
  (select google_calendar_event_id || ' ' || google_calendar_horizon from schedule_blocks where id = '00000000-0000-4000-8000-000000000002'),
  '0000000000004000800000000000000a 2027-11-14');
delete from schedule_blocks where id = '00000000-0000-4000-8000-000000000002';
reset role;
select ok('C1 deleting a linked plan as the browser queues its event (no INSERT grant needed)',
  (select count(*)::text from calendar_outbox where event_id = '0000000000004000800000000000000a'), '1');
select ok('C1 …in primary, as a delete, with no time block',
  (select calendar_id || ' ' || operation || ' ' || coalesce(time_block_id::text, 'none') from calendar_outbox where event_id = '0000000000004000800000000000000a'),
  'primary delete none');
select ok('C1 …and the payload names the plan',
  (select (payload ->> 'series') || ' ' || (payload ->> 'schedule_block_id') || ' ' || (payload ->> 'title') || ' ' || (payload ->> 'effective_from')
     from calendar_outbox where event_id = '0000000000004000800000000000000a'),
  'true 00000000-0000-4000-8000-000000000002 Haircut 2026-10-13');
select ok('C1 the queue row belongs to the plan''s owner',
  (select user_id::text from calendar_outbox where event_id = '0000000000004000800000000000000a'), '00000000-0000-0000-0000-000000000001');

-- C2 a plan that isn't on Google queues nothing
delete from schedule_blocks where id = '00000000-0000-4000-8000-000000000001';
select ok('C2 an unlinked plan queues nothing', (select count(*)::text from calendar_outbox), '1');

-- C3 a blank id queues nothing
insert into schedule_blocks (id, title, days_of_week, start_time, end_time, google_calendar_event_id)
  values ('00000000-0000-4000-8000-000000000003', 'Blank', '{2}', '09:00', '10:00', '  ');
delete from schedule_blocks where id = '00000000-0000-4000-8000-000000000003';
select ok('C3 a blank event id queues nothing', (select count(*)::text from calendar_outbox), '1');

-- C4 an event already waiting is not queued twice (and the delete still goes through)
insert into schedule_blocks (id, title, days_of_week, start_time, end_time, google_calendar_event_id)
  values ('00000000-0000-4000-8000-000000000004', 'Again', '{2}', '09:00', '10:00', '0000000000004000800000000000000a');
delete from schedule_blocks where id = '00000000-0000-4000-8000-000000000004';
select ok('C4 the same event queued again is a no-op', (select count(*)::text from calendar_outbox where event_id = '0000000000004000800000000000000a'), '1');
select ok('C4 …and the plan is gone', (select count(*)::text from schedule_blocks where id = '00000000-0000-4000-8000-000000000004'), '0');

-- C5 a plan's replacement day keeps its own event: deleting the plan leaves
-- the one-off block (SET NULL) and does not queue the block's event
insert into schedule_blocks (id, title, days_of_week, start_time, end_time, google_calendar_event_id)
  values ('00000000-0000-4000-8000-000000000005', 'Upper A', '{1,4}', '17:00', '18:00', '00000000000040008000000000000005');
insert into time_blocks (id, date, title, start_time, google_calendar_event_id, schedule_block_id, occurrence_date)
  values ('00000000-0000-4000-9000-000000000005', '2026-10-15', 'Upper A', '18:00', '000000000000400090000000000000b5', '00000000-0000-4000-8000-000000000005', '2026-10-15');
delete from schedule_blocks where id = '00000000-0000-4000-8000-000000000005';
select ok('C5 the series event is queued', (select count(*)::text from calendar_outbox where event_id = '00000000000040008000000000000005'), '1');
select ok('C5 the replacement block''s own event is not queued', (select count(*)::text from calendar_outbox where event_id = '000000000000400090000000000000b5'), '0');
select ok('C5 the replacement block stays, as an ordinary one-off plan',
  (select coalesce(schedule_block_id::text, 'none') || ' ' || google_calendar_event_id from time_blocks where id = '00000000-0000-4000-9000-000000000005'),
  'none 000000000000400090000000000000b5');

-- C6 135's own trigger still queues a deleted block's event
delete from time_blocks where id = '00000000-0000-4000-9000-000000000005';
select ok('C6 a deleted time block still queues its event (135)',
  (select coalesce(time_block_id::text, 'none') from calendar_outbox where event_id = '000000000000400090000000000000b5'), '00000000-0000-4000-9000-000000000005');

-- C7 deleting the account (auth.users → schedule_blocks cascade) neither
-- aborts nor queues: the token is gone with it
insert into schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, google_calendar_event_id)
  values ('00000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000002', 'Theirs', '{3}', '08:00', '09:00', '00000000000040008000000000000007');
delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
select ok('C7 the account deletion went through', (select count(*)::text from schedule_blocks where user_id = '00000000-0000-0000-0000-000000000002'), '0');
select ok('C7 …and queued nothing', (select count(*)::text from calendar_outbox where event_id = '00000000000040008000000000000007'), '0');

-- C8 Undo puts a plan back with no link (the app's override) — the queue is untouched
insert into schedule_blocks (id, title, days_of_week, start_time, end_time, google_calendar_event_id, google_calendar_horizon)
  values ('00000000-0000-4000-8000-000000000002', 'Haircut', '{6}', '10:00', '11:00', null, null);
select ok('C8 a plan put back leaves the queue as it was', (select count(*)::text from calendar_outbox), '3');
