-- Migration 183 (time zones from the phone) on the live item, repeat, Google and Apple rules (135–180, built by
-- scripts/verify-db-time-zones.mjs), after 183 ran twice. Setup and checks run as the superuser; app writes as
-- `authenticated`. The phone's zone arrives as PostgREST hands it over: request.headers' `x-time-zone`.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
-- The phone that sends the next requests (PostgREST sets request.headers per request; here per session).
create or replace function public.t_phone(p_zone text) returns void language sql as $$
  select set_config('request.headers', case when p_zone is null then '' else jsonb_build_object('x-time-zone', p_zone, 'user-agent', 'test')::text end, false)
$$;
grant execute on function public.t_phone(text) to authenticated;
create or replace function public.t_zone(p_block uuid) returns text language sql security definer set search_path = '' as $$
  select time_zone from public.time_blocks where id = p_block
$$;
grant execute on function public.t_zone(uuid) to authenticated;

-- ═══ Z0. The migration ═══════════════════════════════════════════════════════
select t_ok((select count(*) = 2 from information_schema.columns where table_schema = 'public' and column_name = 'time_zone'
              and table_name in ('time_blocks', 'schedule_blocks') and data_type = 'text' and is_nullable = 'YES'),
  'Z0 time_blocks.time_zone and schedule_blocks.time_zone: text, empty allowed (= the home zone)');
select t_ok((select count(*) = 2 from pg_constraint where conname in ('time_blocks_time_zone_shape', 'schedule_blocks_time_zone_shape')),
  'Z0 one shape check per table after two runs');
select t_ok((select count(*) = 2 from pg_trigger where tgname in ('trg_time_block_time_zone', 'trg_schedule_block_time_zone') and not tgisinternal),
  'Z0 one zone trigger per table after two runs');
select t_ok(not exists (select 1 from public.time_blocks where time_zone is not null)
        and not exists (select 1 from public.schedule_blocks where time_zone is not null),
  'Z0 nothing is backfilled (a row with no zone keeps meaning Oslo)');

-- ═══ Z1. Zone names ═════════════════════════════════════════════════════════
select t_ok(public.time_zone_ok('Europe/Istanbul') and public.time_zone_ok('Europe/Oslo') and public.time_zone_ok('America/Argentina/Buenos_Aires')
        and public.time_zone_ok('America/Port-au-Prince') and public.time_zone_ok('Etc/GMT+1') and public.time_zone_ok('UTC')
        and public.time_zone_ok('Asia/Kolkata'),
  'Z1 real zones pass (an old alias like Asia/Calcutta depends on the server''s zone files: the browser sends current names)');
select t_ok(not public.time_zone_ok('Mars/Olympus_Mons') and not public.time_zone_ok('') and not public.time_zone_ok(null)
        and not public.time_zone_ok('Europe/Oslo
X') and not public.time_zone_ok('Europe/Oslo;DROP') and not public.time_zone_ok('Europe/Oslo:20261102T170000')
        and not public.time_zone_ok('europe/oslo ') and not public.time_zone_ok(repeat('A', 65)) and not public.time_zone_ok('+03:00')
        and not public.time_zone_ok('<+03>-3'),
  'Z1 an unknown name, a line break, ; or : (an iCalendar line), spaces, 65 characters, an offset and a POSIX rule are refused');

-- ═══ Z2. The phone's zone of the request ═══════════════════════════════════
select t_phone('Europe/Istanbul');
select t_ok(public.app_request_time_zone() = 'Europe/Istanbul', 'Z2 the request''s x-time-zone is read');
select t_phone('Mars/Olympus_Mons');
select t_ok(public.app_request_time_zone() is null, 'Z2 a zone the database doesn''t know is no zone');
select set_config('request.headers', 'not json', false);
select t_ok(public.app_request_time_zone() is null, 'Z2 headers that aren''t JSON give no zone (never an error)');
select t_phone(null);
select t_ok(public.app_request_time_zone() is null, 'Z2 no headers (a server writer, a cron job): no zone');

-- ═══ Z3. Every new slot gets a zone; only real ones are kept ═══════════════
set role authenticated;
do $$
declare v uuid;
begin
  perform public.t_phone('Europe/Istanbul');
  insert into public.time_blocks (date, title, start_time, duration_minutes) values ('2026-11-12', 'Dinner', '20:00', 90) returning id into v;
  perform t_ok(public.t_zone(v) = 'Europe/Istanbul', 'Z3 a slot made from a phone in Istanbul is in Istanbul''s time');
  insert into public.time_blocks (date, title, start_time, duration_minutes, time_zone) values ('2026-11-12', 'Call NY', '15:00', 30, 'America/New_York') returning id into v;
  perform t_ok(public.t_zone(v) = 'America/New_York', 'Z3 a zone the writer gives is kept');
  perform public.t_phone(null);
  insert into public.time_blocks (date, title, start_time, duration_minutes) values ('2026-11-12', 'From the server', '09:00', 30) returning id into v;
  perform t_ok(public.t_zone(v) is null, 'Z3 a writer that names no zone (a sync, the assistant''s function) leaves the home zone');
  begin
    insert into public.time_blocks (date, title, start_time, time_zone) values ('2026-11-12', 'Bad', '09:00', 'Mars/Olympus_Mons');
    perform t_ok(false, 'Z3 an unknown zone is refused');
  exception when invalid_parameter_value then perform t_ok(true, 'Z3 an unknown zone is refused'); end;
  begin
    insert into public.time_blocks (date, title, start_time, time_zone) values ('2026-11-12', 'Bad', '09:00', 'Europe/Oslo
X-INJECTED:1');
    perform t_ok(false, 'Z3 a zone holding a line break is refused');
  exception when invalid_parameter_value or check_violation then perform t_ok(true, 'Z3 a zone holding a line break is refused'); end;
  begin
    update public.time_blocks set time_zone = 'Atlantis/Lost' where id = v;
    perform t_ok(false, 'Z3 an unknown zone is refused on a change too');
  exception when invalid_parameter_value then perform t_ok(true, 'Z3 an unknown zone is refused on a change too'); end;
  update public.time_blocks set start_time = '10:00' where id = v;
  perform t_ok(public.t_zone(v) is null, 'Z3 a later change of the time keeps the zone the slot has (a move never re-zones)');
end $$;
reset role;

-- ═══ Z4. The one item save ═══════════════════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; v_plan uuid;
begin
  perform public.t_phone('America/New_York');
  r := public.app_save_item('{"title": "Gym", "domain": "personal", "priority": "medium", "date": "2026-11-12", "time": "17:00",
    "durationMinutes": 60, "google": "calendar", "today": "2026-11-02", "timeZone": "Europe/Istanbul"}');
  insert into public.t_keep values ('gym', r);
  perform t_ok(public.t_zone((r ->> 'blockId')::uuid) = 'Europe/Istanbul', 'Z4 a new item keeps the zone the sheet sends');

  perform public.t_phone('Europe/Istanbul');
  r := public.app_save_item('{"title": "Coffee", "domain": "personal", "priority": "medium", "date": "2026-11-12", "time": "10:00",
    "durationMinutes": 30, "google": "calendar", "today": "2026-11-02"}');
  insert into public.t_keep values ('coffee', r);
  perform t_ok(public.t_zone((r ->> 'blockId')::uuid) = 'Europe/Istanbul', 'Z4 a new item with no zone in it takes the phone''s (quick add, Plan it)');

  perform public.t_phone('America/New_York');
  r := public.app_save_item(jsonb_build_object('title', 'Gym (renamed)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-12',
    'time', '18:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02',
    'taskId', (select v ->> 'taskId' from public.t_keep where k = 'gym'), 'blockId', (select v ->> 'blockId' from public.t_keep where k = 'gym')));
  perform t_ok(public.t_zone((r ->> 'blockId')::uuid) = 'Europe/Istanbul', 'Z4 an edit that names no zone keeps the item''s (a phone abroad never re-zones it)');

  r := public.app_save_item(jsonb_build_object('title', 'Gym (renamed)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-12',
    'time', '18:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'timeZone', 'Asia/Tokyo',
    'taskId', (select v ->> 'taskId' from public.t_keep where k = 'gym'), 'blockId', (select v ->> 'blockId' from public.t_keep where k = 'gym')));
  perform t_ok(public.t_zone((r ->> 'blockId')::uuid) = 'Asia/Tokyo', 'Z4 an edit that picks another zone changes it');

  -- A phone reporting a name the database doesn't know (an old alias): the save goes through without it.
  r := public.app_save_item('{"title": "Nowhere", "domain": "personal", "priority": "medium", "date": "2026-11-12", "time": "10:00",
    "google": "calendar", "today": "2026-11-02", "timeZone": "Nowhere/Land"}');
  perform t_ok(public.t_zone((r ->> 'blockId')::uuid) = 'America/New_York', 'Z4 a zone the database doesn''t know is left out: the save goes through (here the request''s zone)');
  r := public.app_save_item(jsonb_build_object('title', 'Gym (renamed)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-12',
    'time', '18:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'timeZone', 'Europe/Oslo
X-INJECTED:1',
    'taskId', (select v ->> 'taskId' from public.t_keep where k = 'gym'), 'blockId', (select v ->> 'blockId' from public.t_keep where k = 'gym')));
  perform t_ok(public.t_zone((r ->> 'blockId')::uuid) = 'Asia/Tokyo', 'Z4 a zone smuggling a line in is never stored: the edit keeps the item''s');

  -- A repeat: its zone, an edit of its rule, and a day split off it.
  perform public.t_phone('Europe/Istanbul');
  r := public.app_save_item('{"title": "Run", "domain": "personal", "priority": "medium", "date": "2026-11-03", "time": "07:00",
    "durationMinutes": 45, "google": "calendar", "today": "2026-11-02", "repeat": {"kind": "weekly", "daysOfWeek": [2, 4]}}');
  v_plan := (r ->> 'scheduleBlockId')::uuid;
  insert into public.t_keep values ('run', r);
  perform t_ok((select time_zone from public.schedule_blocks where id = v_plan) = 'Europe/Istanbul', 'Z4 a new repeat takes the phone''s zone');
  perform public.t_phone('America/New_York');
  r := public.app_save_item(jsonb_build_object('title', 'Run (longer)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-03',
    'time', '07:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'all', 'scheduleBlockId', v_plan,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(2, 4))));
  perform t_ok((select time_zone from public.schedule_blocks where id = v_plan) = 'Europe/Istanbul', 'Z4 editing a repeat''s rule abroad keeps its zone');
  r := public.app_save_item(jsonb_build_object('title', 'Run (this day)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-05',
    'time', '08:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'day', 'scheduleBlockId', v_plan,
    'occurrenceDate', '2026-11-05'));
  perform t_ok(public.t_zone((r ->> 'blockId')::uuid) = 'Europe/Istanbul', 'Z4 a day split off the repeat ("This day") is in the repeat''s zone, never the phone''s');
end $$;
reset role;

-- A day of a plan from before 183 (no zone of its own): the zone its Google series was made in, else the home zone.
update public.schedule_blocks set time_zone = null, google_calendar_time_zone = 'Europe/Oslo' where title = 'Run (longer)';
set role authenticated;
do $$
declare v uuid; v_plan uuid := (select id from public.schedule_blocks where title = 'Run (longer)');
begin
  perform public.t_phone('America/New_York');
  insert into public.time_blocks (date, title, start_time, duration_minutes, schedule_block_id, occurrence_date)
    values ('2026-11-10', 'Run', '07:00', 60, v_plan, '2026-11-10') returning id into v;
  perform t_ok(public.t_zone(v) = 'Europe/Oslo', 'Z4 a day of an older plan takes the zone its Google series uses');
end $$;
reset role;
update public.schedule_blocks set google_calendar_time_zone = null where title = 'Run (longer)';
set role authenticated;
do $$
declare v uuid; v_plan uuid := (select id from public.schedule_blocks where title = 'Run (longer)');
begin
  insert into public.time_blocks (date, title, start_time, duration_minutes, schedule_block_id, occurrence_date)
    values ('2026-11-12', 'Run', '07:00', 60, v_plan, '2026-11-12') returning id into v;
  perform t_ok(public.t_zone(v) is null, 'Z4 a day of a plan with no zone at all keeps the home zone — never the phone''s');
end $$;
reset role;
select public.t_phone(null);

-- ═══ Z5. A changed zone reaches Apple and Google ════════════════════════════
insert into public.calendar_prefs (user_id, prefs) values ('00000000-0000-0000-0000-000000000001',
  '{"areas": {"personal": {"app": "apple", "enabled": true}}}')
  on conflict (user_id) do update set prefs = excluded.prefs;
delete from public.icloud_outbox;
update public.time_blocks set icloud_area = 'personal', icloud_etag = '"v1"' where id = ((select v from public.t_keep where k = 'coffee') ->> 'blockId')::uuid;
update public.schedule_blocks set icloud_area = 'personal', icloud_etag = '"p1"' where title = 'Run (longer)';
select t_ok(not exists (select 1 from public.icloud_outbox), 'Z5 setup: the drain''s own writes queue nothing');
set role authenticated;
update public.time_blocks set time_zone = 'Europe/Istanbul' where id = ((select v from public.t_keep where k = 'coffee') ->> 'blockId')::uuid;
reset role;
select t_ok(not exists (select 1 from public.icloud_outbox), 'Z5 the same zone written again sends nothing');
set role authenticated;
update public.time_blocks set time_zone = 'Europe/Oslo' where id = ((select v from public.t_keep where k = 'coffee') ->> 'blockId')::uuid;
update public.schedule_blocks set time_zone = 'Europe/Oslo' where title = 'Run (longer)';
reset role;
select t_ok((select count(*) = 1 from public.icloud_outbox where entity = 'slot' and entity_id = ((select v from public.t_keep where k = 'coffee') ->> 'blockId')::uuid),
  'Z5 a slot''s zone changed queues its Apple event once');
select t_ok((select count(*) = 1 from public.icloud_outbox where entity = 'plan' and entity_id = (select id from public.schedule_blocks where title = 'Run (longer)')),
  'Z5 a plan''s zone changed queues its Apple series once');

delete from public.calendar_outbox;
update public.time_blocks set google_calendar_event_id = 'lasci0zone0test' where id = ((select v from public.t_keep where k = 'gym') ->> 'blockId')::uuid;
select t_ok(not exists (select 1 from public.calendar_outbox where operation = 'upsert'), 'Z5 setup: linking an event (the browser''s own call) queues no upsert');
set role authenticated;
update public.time_blocks set time_zone = 'Europe/Istanbul' where id = ((select v from public.t_keep where k = 'gym') ->> 'blockId')::uuid;
reset role;
select t_ok((select count(*) = 1 from public.calendar_outbox where operation = 'upsert' and event_id = 'lasci0zone0test'),
  'Z5 a linked slot''s zone changed queues its Google event once (every writer, not only the sheet)');
