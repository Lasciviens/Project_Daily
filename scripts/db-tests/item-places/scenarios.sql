-- Migration 186 (a place on an item) on the live item, repeat, Google and Apple rules (135–183, built by
-- scripts/verify-db-item-places.mjs), after 186 ran twice. Setup and checks run as the superuser; app writes as
-- `authenticated`. Places are made-up public ones (Jernbanetorget).
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
create or replace function public.t_place(p_block uuid) returns jsonb language sql security definer set search_path = '' as $$
  select place from public.time_blocks where id = p_block
$$;
grant execute on function public.t_place(uuid) to authenticated;
-- The save must refuse: returns the error's code, or 'saved'.
create or replace function public.t_save_refused(p jsonb) returns text language plpgsql as $$
begin
  perform public.app_save_item(p);
  return 'saved';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function public.t_save_refused(jsonb) to authenticated;

-- ═══ P0. The migration ═══════════════════════════════════════════════════════
select t_ok((select count(*) = 2 from information_schema.columns where table_schema = 'public' and column_name = 'place'
              and table_name in ('time_blocks', 'schedule_blocks') and data_type = 'jsonb' and is_nullable = 'YES'
              and column_default = '''{}''::jsonb'),
  'P0 time_blocks.place and schedule_blocks.place: jsonb, null allowed, default {} ("not given")');
select t_ok((select count(*) = 2 from pg_constraint where conname in ('time_blocks_place_ok', 'schedule_blocks_place_ok')),
  'P0 one place check per table after two runs');
select t_ok((select count(*) = 2 from pg_trigger where tgname in ('trg_time_block_place', 'trg_schedule_block_place') and not tgisinternal),
  'P0 one place trigger per table after two runs');
select t_ok(not exists (select 1 from public.time_blocks where place is not null)
        and not exists (select 1 from public.schedule_blocks where place is not null),
  'P0 nothing is backfilled');

-- ═══ P1. What a place may hold ══════════════════════════════════════════════
select t_ok(public.place_ok('{"name": "Oslo S"}') and public.place_ok(null) and public.place_ok('{}')
        and public.place_ok('{"name": "Oslo S", "locality": "Oslo", "lat": 59.910357, "lon": 10.752245, "id": "NSR:StopPlace:337"}')
        and public.place_ok('{"name": "Café Løkka – bak", "lat": -33.8688, "lon": -151.2093}')
        and public.place_ok('{"name": "Karl Johans gate 1", "id": "KVE:PostalAddress:0301-12345-1"}')
        and public.place_ok('{"name": "Somewhere \"quoted\"; with, punctuation"}'),
  'P1 a name alone, a full EnTur place, negative coordinates, an address id and punctuation pass (the writer handles quotes)');
select t_ok(not public.place_ok('"Oslo S"') and not public.place_ok('[]') and not public.place_ok('{"title": "x"}')
        and not public.place_ok('{"name": "Oslo S", "url": "https://example.com"}')
        and not public.place_ok('{"name": ""}') and not public.place_ok('{"name": "   "}') and not public.place_ok('{"name": 5}')
        and not public.place_ok(jsonb_build_object('name', repeat('a', 121)))
        and not public.place_ok(jsonb_build_object('name', E'Oslo S\nX-INJECTED:1'))
        and not public.place_ok(jsonb_build_object('name', E'Oslo S\rX'))
        and not public.place_ok(jsonb_build_object('name', 'Oslo S' || chr(8232) || 'X'))
        and not public.place_ok(jsonb_build_object('name', 'Oslo S', 'locality', repeat('b', 81)))
        and not public.place_ok(jsonb_build_object('name', 'Oslo S', 'locality', E'Oslo\nX')),
  'P1 not an object, an unknown key, an empty or long name, a line break, CR or U+2028, a long or broken town are refused');
select t_ok(not public.place_ok('{"name": "Oslo S", "lat": 59.9}') and not public.place_ok('{"name": "Oslo S", "lon": 10.7}')
        and not public.place_ok('{"name": "Oslo S", "lat": "59.9", "lon": 10.7}') and not public.place_ok('{"name": "Oslo S", "lat": 91, "lon": 10}')
        and not public.place_ok('{"name": "Oslo S", "lat": 59, "lon": -181}') and not public.place_ok('{"name": "Oslo S", "id": "javascript:alert(1)"}')
        and not public.place_ok('{"name": "Oslo S", "id": "NSR:StopPlace:337 X"}')
        and not public.place_ok(jsonb_build_object('name', 'Oslo S', 'locality', repeat('c', 80), 'id', 'NSR:StopPlace:' || repeat('9', 80),
                                                   'lat', 59.9, 'lon', 10.7, 'name2', 1)),
  'P1 a lone or textual coordinate, coordinates out of range, a bad id and an oversized place are refused');

-- ═══ P2. Every writer is checked (the assistant's db tools, a sync) ════════
set role authenticated;
do $$
begin
  begin
    insert into public.time_blocks (date, title, start_time, duration_minutes, place)
      values ('2026-11-12', 'Bad', '09:00', 30, jsonb_build_object('name', E'Gym\nX-INJECTED:1'));
    perform t_ok(false, 'P2 a slot with a broken place is refused');
  exception when check_violation then perform t_ok(true, 'P2 a slot with a broken place is refused'); end;
  begin
    insert into public.schedule_blocks (title, days_of_week, start_time, end_time, effective_from, place)
      values ('Bad', '{1}', '09:00', '10:00', '2026-11-02', '{"name": "Gym", "lat": 999, "lon": 0}');
    perform t_ok(false, 'P2 a plan with a broken place is refused');
  exception when check_violation then perform t_ok(true, 'P2 a plan with a broken place is refused'); end;
end $$;
reset role;

-- ═══ P3. The one item save ══════════════════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; e text;
begin
  r := public.app_save_item('{"title": "Gym", "domain": "personal", "priority": "medium", "date": "2026-11-12", "time": "17:00",
    "durationMinutes": 60, "google": "calendar", "today": "2026-11-02",
    "place": {"name": "Jernbanetorget", "locality": "Oslo", "lat": 59.911, "lon": 10.75, "id": "NSR:StopPlace:58366"}}');
  insert into public.t_keep values ('gym', r);
  perform t_ok(public.t_place((r ->> 'blockId')::uuid) = '{"name": "Jernbanetorget", "locality": "Oslo", "lat": 59.911, "lon": 10.75, "id": "NSR:StopPlace:58366"}',
    'P3 a new item keeps the place the sheet sends');
  r := public.app_save_item(jsonb_build_object('title', 'Gym (renamed)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-12',
    'time', '18:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02',
    'taskId', (select v ->> 'taskId' from public.t_keep where k = 'gym'), 'blockId', (select v ->> 'blockId' from public.t_keep where k = 'gym')));
  perform t_ok(public.t_place((r ->> 'blockId')::uuid) ->> 'name' = 'Jernbanetorget', 'P3 an edit that sends no place keeps the item''s (Plan it, quick add)');
  r := public.app_save_item(jsonb_build_object('title', 'Gym (renamed)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-12',
    'time', '18:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'place', jsonb_build_object('name', 'The other gym'),
    'taskId', (select v ->> 'taskId' from public.t_keep where k = 'gym'), 'blockId', (select v ->> 'blockId' from public.t_keep where k = 'gym')));
  perform t_ok(public.t_place((r ->> 'blockId')::uuid) = '{"name": "The other gym"}', 'P3 an edit that picks another place (typed, no pin) changes it');
  e := public.t_save_refused(jsonb_build_object('title', 'Gym (renamed)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-12',
    'time', '18:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'place', jsonb_build_object('name', E'Gym\nX-INJECTED:1'),
    'taskId', (select v ->> 'taskId' from public.t_keep where k = 'gym'), 'blockId', (select v ->> 'blockId' from public.t_keep where k = 'gym')));
  perform t_ok(e like '22023 That place can''t be saved%', 'P3 a place smuggling a line in stops the save with a message (' || e || ')');
  perform t_ok(public.t_place(((select v from public.t_keep where k = 'gym') ->> 'blockId')::uuid) = '{"name": "The other gym"}',
    'P3 …and nothing of that save is kept');
  e := public.t_save_refused('{"title": "X", "domain": "personal", "priority": "medium", "date": "2026-11-12", "time": "10:00",
    "google": "calendar", "today": "2026-11-02", "place": "Oslo S"}');
  perform t_ok(e like '22023 %', 'P3 a place that is a bare string is refused');
  e := public.t_save_refused('{"title": "X", "domain": "personal", "priority": "medium", "date": "2026-11-12", "time": "10:00",
    "google": "calendar", "today": "2026-11-02", "place": {}}');
  perform t_ok(e like '22023 %', 'P3 an empty place object is refused (the column''s "not given" is not a place)');
  r := public.app_save_item(jsonb_build_object('title', 'Gym (renamed)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-12',
    'time', '18:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'place', null,
    'taskId', (select v ->> 'taskId' from public.t_keep where k = 'gym'), 'blockId', (select v ->> 'blockId' from public.t_keep where k = 'gym')));
  perform t_ok(public.t_place((r ->> 'blockId')::uuid) is null, 'P3 place null takes it off');
  r := public.app_save_item('{"title": "Coffee", "domain": "personal", "priority": "medium", "date": "2026-11-12", "time": "10:00",
    "durationMinutes": 30, "google": "calendar", "today": "2026-11-02"}');
  insert into public.t_keep values ('coffee', r);
  perform t_ok(public.t_place((r ->> 'blockId')::uuid) is null, 'P3 a new item with no place has none (never the {} marker)');
end $$;
reset role;

-- ═══ P4. A repeat's place, and its days ════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; v uuid; v_plan uuid;
begin
  r := public.app_save_item('{"title": "Run", "domain": "personal", "priority": "medium", "date": "2026-11-03", "time": "07:00",
    "durationMinutes": 45, "google": "calendar", "today": "2026-11-02", "repeat": {"kind": "weekly", "daysOfWeek": [2, 4]},
    "place": {"name": "Frognerparken", "locality": "Oslo", "lat": 59.927, "lon": 10.702}}');
  v_plan := (r ->> 'scheduleBlockId')::uuid;
  insert into public.t_keep values ('run', r);
  perform t_ok((select place ->> 'name' from public.schedule_blocks where id = v_plan) = 'Frognerparken', 'P4 a new repeat keeps its place');
  r := public.app_save_item(jsonb_build_object('title', 'Run (longer)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-03',
    'time', '07:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'all', 'scheduleBlockId', v_plan,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(2, 4))));
  perform t_ok((select place ->> 'name' from public.schedule_blocks where id = v_plan) = 'Frognerparken', 'P4 editing a repeat''s rule without a place keeps it');
  r := public.app_save_item(jsonb_build_object('title', 'Run (this day)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-05',
    'time', '08:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'day', 'scheduleBlockId', v_plan,
    'occurrenceDate', '2026-11-05'));
  perform t_ok(public.t_place((r ->> 'blockId')::uuid) ->> 'name' = 'Frognerparken', 'P4 a day split off the repeat ("This day") is where the repeat is');
  r := public.app_save_item(jsonb_build_object('title', 'Run (elsewhere)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-10',
    'time', '08:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'day', 'scheduleBlockId', v_plan,
    'occurrenceDate', '2026-11-10', 'place', jsonb_build_object('name', 'Sognsvann')));
  perform t_ok(public.t_place((r ->> 'blockId')::uuid) = '{"name": "Sognsvann"}', 'P4 …or where that day''s sheet says');
  perform t_ok((select place ->> 'name' from public.schedule_blocks where id = v_plan) = 'Frognerparken', 'P4 …and the repeat stays where it was');
  -- A day split by a rule of the database (a training move, the read-back): no place named → the plan's.
  insert into public.time_blocks (date, title, start_time, duration_minutes, schedule_block_id, occurrence_date)
    values ('2026-11-12', 'Run', '07:00', 60, v_plan, '2026-11-12') returning id into v;
  perform t_ok(public.t_place(v) ->> 'name' = 'Frognerparken', 'P4 a day any writer splits off the plan takes its place');
  insert into public.time_blocks (date, title, start_time, duration_minutes) values ('2026-11-12', 'Lunch', '12:00', 30) returning id into v;
  perform t_ok(public.t_place(v) is null, 'P4 a slot of no plan that names no place has none');
  update public.time_blocks set place = '{}'::jsonb where id = v;
  perform t_ok(public.t_place(v) is null, 'P4 the {} marker is never stored, on an update either');
end $$;
reset role;
update public.schedule_blocks set place = null where title = 'Run (longer)';
set role authenticated;
do $$
declare v uuid; v_plan uuid := (select id from public.schedule_blocks where title = 'Run (longer)');
begin
  insert into public.time_blocks (date, title, start_time, duration_minutes, schedule_block_id, occurrence_date)
    values ('2026-11-17', 'Run', '07:00', 60, v_plan, '2026-11-17') returning id into v;
  perform t_ok(public.t_place(v) is null, 'P4 a day of a plan with no place has none');
end $$;
reset role;

-- ═══ P5. A changed place reaches Apple and Google ══════════════════════════
insert into public.calendar_prefs (user_id, prefs) values ('00000000-0000-0000-0000-000000000001',
  '{"areas": {"personal": {"app": "apple", "enabled": true}}}')
  on conflict (user_id) do update set prefs = excluded.prefs;
delete from public.icloud_outbox;
update public.time_blocks set icloud_area = 'personal', icloud_etag = '"v1"' where id = ((select v from public.t_keep where k = 'coffee') ->> 'blockId')::uuid;
update public.schedule_blocks set icloud_area = 'personal', icloud_etag = '"p1"' where title = 'Run (longer)';
select t_ok(not exists (select 1 from public.icloud_outbox), 'P5 setup: the drain''s own writes queue nothing');
set role authenticated;
update public.time_blocks set place = null where id = ((select v from public.t_keep where k = 'coffee') ->> 'blockId')::uuid;
reset role;
select t_ok(not exists (select 1 from public.icloud_outbox), 'P5 the same (no) place written again sends nothing');
set role authenticated;
update public.time_blocks set place = '{"name": "Jernbanetorget", "lat": 59.911, "lon": 10.75}' where id = ((select v from public.t_keep where k = 'coffee') ->> 'blockId')::uuid;
update public.schedule_blocks set place = '{"name": "Sognsvann"}' where title = 'Run (longer)';
reset role;
select t_ok((select count(*) = 1 from public.icloud_outbox where entity = 'slot' and entity_id = ((select v from public.t_keep where k = 'coffee') ->> 'blockId')::uuid),
  'P5 a slot''s place changed queues its Apple event once');
select t_ok((select count(*) = 1 from public.icloud_outbox where entity = 'plan' and entity_id = (select id from public.schedule_blocks where title = 'Run (longer)')),
  'P5 a plan''s place changed queues its Apple series once');
delete from public.calendar_outbox;
update public.time_blocks set google_calendar_event_id = 'lasci0place0test' where id = ((select v from public.t_keep where k = 'gym') ->> 'blockId')::uuid;
select t_ok(not exists (select 1 from public.calendar_outbox where operation = 'upsert'), 'P5 setup: linking an event (the browser''s own call) queues no upsert');
set role authenticated;
update public.time_blocks set place = '{"name": "The other gym"}' where id = ((select v from public.t_keep where k = 'gym') ->> 'blockId')::uuid;
reset role;
select t_ok((select count(*) = 1 from public.calendar_outbox where operation = 'upsert' and event_id = 'lasci0place0test'),
  'P5 a linked slot''s place changed queues its Google event once (every writer, not only the sheet)');

-- ═══ P6. Undo puts a row back as it was ═════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; d jsonb;
begin
  r := public.app_save_item('{"title": "Haircut", "domain": "personal", "priority": "medium", "date": "2026-11-13", "time": "11:00",
    "durationMinutes": 30, "google": "calendar", "today": "2026-11-02", "place": {"name": "Jernbanetorget"}}');
  insert into public.t_keep values ('haircut', r);
  r := public.app_save_item(jsonb_build_object('title', 'Run (day of)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-19',
    'time', '07:00', 'durationMinutes', 60, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'day',
    'scheduleBlockId', (select v ->> 'scheduleBlockId' from public.t_keep where k = 'run'), 'occurrenceDate', '2026-11-19', 'place', null));
  insert into public.t_keep values ('runday', r);
  perform t_ok(public.t_place((r ->> 'blockId')::uuid) is null, 'P6 setup: a day of the repeat with its place taken off');
  d := public.app_delete_rows('tasks', array[(select v ->> 'taskId' from public.t_keep where k = 'haircut'), (select v ->> 'taskId' from public.t_keep where k = 'runday')]);
  perform t_ok(not exists (select 1 from public.time_blocks where id in (((select v from public.t_keep where k = 'haircut') ->> 'blockId')::uuid,
                                                                          ((select v from public.t_keep where k = 'runday') ->> 'blockId')::uuid)),
    'P6 deleting both items takes their slots too');
  perform public.app_restore_rows(d);
  perform t_ok(public.t_place(((select v from public.t_keep where k = 'haircut') ->> 'blockId')::uuid) = '{"name": "Jernbanetorget"}',
    'P6 Undo puts the place back');
  perform t_ok(public.t_place(((select v from public.t_keep where k = 'runday') ->> 'blockId')::uuid) is null,
    'P6 …and a day whose place was taken off comes back without one — never the plan''s');
end $$;
reset role;
