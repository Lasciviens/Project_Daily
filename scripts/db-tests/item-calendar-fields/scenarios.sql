-- Migration 193 (Apple's extra fields on an item: End Repeat, Alert + Second Alert, Show As, URL, Travel Time) on the
-- live item, repeat, Google and Apple rules (135–186, built by scripts/verify-db-item-calendar-fields.mjs), after 193
-- ran twice. Setup and checks run as the superuser; app writes as `authenticated` (test.uid picks the caller: unset =
-- the owner, user 2 = another allowed account, user 3 = an account the owner lock keeps out). Links are example.com.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
-- A write that must be refused: its error's code and text, or 'written'.
create or replace function public.t_refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'written';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function public.t_refused(text) to authenticated;
create or replace function public.t_save_refused(p jsonb) returns text language plpgsql as $$
begin
  perform public.app_save_item(p);
  return 'saved';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function public.t_save_refused(jsonb) to authenticated;
create or replace function public.t_block(p_block uuid) returns public.time_blocks language sql security definer set search_path = '' as $$
  select * from public.time_blocks where id = p_block
$$;
grant execute on function public.t_block(uuid) to authenticated;
create or replace function public.t_plan(p_plan uuid) returns public.schedule_blocks language sql security definer set search_path = '' as $$
  select * from public.schedule_blocks where id = p_plan
$$;
grant execute on function public.t_plan(uuid) to authenticated;
-- A one-off item's base fields; `extra` adds or overrides keys.
create or replace function public.t_item(p_title text, p_date text, p_time text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'domain', 'personal', 'priority', 'medium', 'date', p_date, 'time', p_time,
    'durationMinutes', case when p_time is null then null else 60 end, 'google', 'calendar', 'today', '2026-11-02') || extra
$$;
grant execute on function public.t_item(text, text, text, jsonb) to authenticated;

-- ═══ C0. The migration ═══════════════════════════════════════════════════════
select t_ok((select count(*) = 8 from information_schema.columns where table_schema = 'public'
              and table_name in ('time_blocks', 'schedule_blocks') and column_name in ('alerts', 'show_as', 'url', 'travel_minutes')
              and is_nullable = 'YES')
        and (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'schedule_blocks'
              and column_name in ('repeat_until', 'repeat_count') and is_nullable = 'YES'),
  'C0 the four fields on both tables and End Repeat on a repeat, null allowed');
select t_ok((select string_agg(column_name || '=' || coalesce(column_default, 'null'), ' ' order by column_name) from information_schema.columns
              where table_schema = 'public' and table_name = 'time_blocks' and column_name in ('alerts', 'show_as', 'url', 'travel_minutes'))
            = 'alerts=''{-1}''::integer[] show_as=''''::text travel_minutes=''-1''::integer url=''''::text'
        and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'schedule_blocks'
              and column_name in ('alerts', 'show_as', 'url', 'travel_minutes', 'repeat_until', 'repeat_count') and column_default is not null),
  'C0 a new slot''s defaults say "not given"; a repeat''s default to none');
select t_ok((select count(*) = 11 from pg_constraint where conname in ('time_blocks_alerts_ok', 'time_blocks_show_as_ok', 'time_blocks_url_ok',
              'time_blocks_travel_ok', 'schedule_blocks_alerts_ok', 'schedule_blocks_show_as_ok', 'schedule_blocks_url_ok', 'schedule_blocks_travel_ok',
              'schedule_blocks_repeat_count_ok', 'schedule_blocks_repeat_until_ok', 'time_blocks_place_ok')),
  'C0 one check per field and table after two runs');
select t_ok((select count(*) = 2 from pg_trigger where tgname in ('trg_time_block_calendar_fill', 'trg_schedule_block_repeat_end') and not tgisinternal),
  'C0 one fill trigger and one End Repeat trigger after two runs');
select t_ok(not exists (select 1 from public.time_blocks where alerts is not null or show_as is not null or url is not null or travel_minutes is not null)
        and not exists (select 1 from public.schedule_blocks where alerts is not null or show_as is not null or url is not null
                          or travel_minutes is not null or repeat_until is not null or repeat_count is not null),
  'C0 nothing is backfilled');

-- ═══ C1. What the fields may hold ════════════════════════════════════════════
select t_ok(public.item_alerts_ok(null) and public.item_alerts_ok('{}') and public.item_alerts_ok('{0}') and public.item_alerts_ok('{60,10}')
        and public.item_alerts_ok('{10080,1440}') and public.item_alerts_ok('{120}'),
  'C1 alerts: none of its own, none, at the time, two in order, day offsets');
select t_ok(not public.item_alerts_ok('{-5}') and not public.item_alerts_ok('{-1}') and not public.item_alerts_ok('{7}')
        and not public.item_alerts_ok('{10,10}') and not public.item_alerts_ok('{5,10,15}') and not public.item_alerts_ok('{NULL}')
        and not public.item_alerts_ok('{5,NULL}') and not public.item_alerts_ok('{{5},{10}}') and not public.item_alerts_ok('[0:1]={5,10}')
        and not public.item_alerts_ok('{40320}') and not public.item_alerts_ok('{2147483647}'),
  'C1 alerts refused: a negative one, the "not given" marker, one off the list, the same twice, three, a null, two dimensions, a shifted array, too far');
select t_ok(public.item_url_ok(null) and public.item_url_ok('https://example.com') and public.item_url_ok('https://example.com/a/b?c=d&e=f#g')
        and public.item_url_ok('https://sub.example.com:8443/x%20y') and public.item_url_ok('https://example.com/' || repeat('a', 2028))
        and public.item_url_ok('https://xn--kbenhavn-54a.example/') and public.item_url_ok('https://example.com/path;a=1,b=2/@x'),
  'C1 links: https with a path, query and fragment, a port and %20, 2048 characters, a punycode host, ; , @ in the path');
select t_ok(not public.item_url_ok('http://example.com') and not public.item_url_ok('javascript:alert(1)')
        and not public.item_url_ok(E'https://example.com/\r\nATTENDEE:mailto:x@example.com') and not public.item_url_ok(E'https://example.com/\nX')
        and not public.item_url_ok(E'https://example.com/\rX') and not public.item_url_ok('https://example.com/' || chr(8232) || 'X')
        and not public.item_url_ok('https://example.com/' || repeat('a', 10000)) and not public.item_url_ok('https://example.com/' || repeat('a', 2029))
        and not public.item_url_ok('https://example.com/a b') and not public.item_url_ok('https://example.com/"x"')
        and not public.item_url_ok('https://example.com/<script>') and not public.item_url_ok('https://user:pw@example.com/')
        and not public.item_url_ok('https://example.com@evil.example/') and not public.item_url_ok('https://[::1]/')
        and not public.item_url_ok('https://example.com/%zz') and not public.item_url_ok('https://example.com/a\b')
        and not public.item_url_ok('https://københavn.example/') and not public.item_url_ok('') and not public.item_url_ok(' https://example.com')
        and not public.item_url_ok('HTTPS://example.com') and not public.item_url_ok('https://-bad.example/') and not public.item_url_ok('https:///x'),
  'C1 links refused: http, javascript:, CRLF, LF, CR, U+2028, 10 000 and 2 049 characters, a space, a quote, angle brackets, a user name, an @ host, an IP literal, a broken escape, a backslash, a raw non-ASCII host, empty, a leading space, upper case, a bad host');

-- ═══ C2. Every writer is checked (the assistant's db tools, a sync, plain SQL) ════════════════════════════
set role authenticated;
select t_ok(public.t_refused($q$insert into public.time_blocks (date, title, start_time, duration_minutes, alerts) values ('2026-11-12', 'Bad', '09:00', 30, '{-5}')$q$) like '23514 %',
  'C2 a slot with a negative alert is refused');
select t_ok(public.t_refused(format('insert into public.time_blocks (date, title, start_time, duration_minutes, url) values (%L, %L, %L, 30, %L)',
              '2026-11-12', 'Bad', '09:00', E'https://example.com/\r\nATTENDEE;RSVP=TRUE:mailto:x@example.com')) like '23514 %',
  'C2 a slot whose link smuggles a line in (CRLF) is refused');
select t_ok(public.t_refused(format('insert into public.time_blocks (date, title, start_time, duration_minutes, url) values (%L, %L, %L, 30, %L)',
              '2026-11-12', 'Bad', '09:00', 'https://example.com/' || repeat('a', 10000))) like '23514 %',
  'C2 a slot with a 10 000-character link is refused');
select t_ok(public.t_refused($q$insert into public.time_blocks (date, title, start_time, duration_minutes, travel_minutes) values ('2026-11-12', 'Bad', '09:00', 30, 45)$q$) like '23514 %'
        and public.t_refused($q$insert into public.time_blocks (date, title, start_time, duration_minutes, show_as) values ('2026-11-12', 'Bad', '09:00', 30, 'maybe')$q$) like '23514 %',
  'C2 a travel time or Show As off the list is refused');
select t_ok(public.t_refused($q$insert into public.schedule_blocks (title, days_of_week, start_time, end_time, effective_from, repeat_until) values ('Bad', '{1}', '09:00', '10:00', '2026-11-02', '2026-11-01')$q$) like '23514 %',
  'C2 a repeat whose End Repeat is before its start is refused');
select t_ok(public.t_refused($q$insert into public.schedule_blocks (title, days_of_week, start_time, end_time, effective_from, repeat_until) values ('Bad', '{1}', '09:00', '10:00', '2026-11-02', '12026-01-01')$q$) like '23514 %',
  'C2 an End Repeat past the year 9999 (no calendar can write it) is refused');
select t_ok(public.t_refused($q$insert into public.schedule_blocks (title, days_of_week, start_time, end_time, effective_from, repeat_count) values ('Bad', '{1}', '09:00', '10:00', '2026-11-02', 0)$q$) like '23514 %'
        and public.t_refused($q$insert into public.schedule_blocks (title, days_of_week, start_time, end_time, effective_from, repeat_count) values ('Bad', '{1}', '09:00', '10:00', '2026-11-02', 1000)$q$) like '23514 %',
  'C2 "after 0 times" and "after 1000 times" are refused');
select t_ok(public.t_refused($q$insert into public.schedule_blocks (title, days_of_week, start_time, end_time, effective_from, alerts, url) values ('Bad', '{1}', '09:00', '10:00', '2026-11-02', '{5,5}', 'https://example.com')$q$) like '23514 %',
  'C2 a repeat with the same alert twice is refused');
reset role;

-- ═══ C3. Row level security and the owner lock ══════════════════════════════
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_save_item(public.t_item('Dentist', '2026-11-12', '10:00', '{"alerts": [60, 10], "showAs": "busy", "url": "https://example.com/booking", "travelMinutes": 15}'));
  insert into public.t_keep values ('dentist', r);
end $$;
reset role;
set test.uid = '00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$
declare n integer;
begin
  update public.time_blocks set url = 'https://evil.example/', alerts = '{}' where title = 'Dentist';
  get diagnostics n = row_count;
  perform t_ok(n = 0, 'C3 another account can''t change the owner''s link or alerts (row level security: 0 rows)');
  perform t_ok(not exists (select 1 from public.time_blocks where title = 'Dentist'), 'C3 …nor see them');
end $$;
reset role;
set test.uid = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select t_ok(public.t_refused($q$insert into public.time_blocks (date, title, start_time, duration_minutes, url) values ('2026-11-12', 'Locked out', '09:00', 30, 'https://example.com')$q$) like '42501 %',
  'C3 an account the owner lock keeps out can''t write one at all');
reset role;
reset test.uid;
select t_ok((select url = 'https://example.com/booking' and alerts = '{60,10}' from public.time_blocks where title = 'Dentist'),
  'C3 the owner''s row is as the owner saved it');

-- ═══ C4. The one item save ══════════════════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; e text; b public.time_blocks;
begin
  r := (select x.v from public.t_keep x where x.k = 'dentist');
  b := public.t_block((r ->> 'blockId')::uuid);
  perform t_ok(b.alerts = '{60,10}' and b.show_as = 'busy' and b.url = 'https://example.com/booking' and b.travel_minutes = 15,
    'C4 a new item keeps the alerts (in order), Show As, link and travel time the sheet sends');
  perform t_ok((r ->> 'calendarFields')::boolean, 'C4 the save says it took the calendar fields (a browser can tell a database without 193)');
  r := public.app_save_item(public.t_item('Dentist (moved)', '2026-11-13', '11:00', jsonb_build_object('taskId', r ->> 'taskId', 'blockId', r ->> 'blockId')));
  b := public.t_block((r ->> 'blockId')::uuid);
  perform t_ok(b.alerts = '{60,10}' and b.show_as = 'busy' and b.url = 'https://example.com/booking' and b.travel_minutes = 15,
    'C4 an edit that sends none of them keeps them all (Plan it, quick add, an older screen)');
  r := public.app_save_item(public.t_item('Dentist (moved)', '2026-11-13', '11:00', jsonb_build_object('taskId', r ->> 'taskId', 'blockId', r ->> 'blockId',
    'alerts', '[]'::jsonb, 'showAs', 'free', 'url', null, 'travelMinutes', 0)));
  b := public.t_block((r ->> 'blockId')::uuid);
  perform t_ok(b.alerts = '{}' and b.show_as = 'free' and b.url is null and b.travel_minutes = 0,
    'C4 an edit sets None, Free, no link and no travel time');
  r := public.app_save_item(public.t_item('Dentist (moved)', '2026-11-13', '11:00', jsonb_build_object('taskId', r ->> 'taskId', 'blockId', r ->> 'blockId',
    'alerts', null, 'showAs', null, 'travelMinutes', null)));
  b := public.t_block((r ->> 'blockId')::uuid);
  perform t_ok(b.alerts is null and b.show_as is null and b.travel_minutes is null,
    'C4 …and null puts each back to none of its own (the area''s alert, by its length, automatic)');
  insert into public.t_keep values ('dentist2', r) on conflict (k) do update set v = excluded.v;
  -- Hostile values stop the save with a message, and nothing of it is kept.
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', jsonb_build_object('taskId', r ->> 'taskId', 'blockId', r ->> 'blockId',
    'url', E'https://example.com/\r\nATTENDEE:mailto:x@example.com', 'alerts', '[30]'::jsonb)));
  perform t_ok(e like '22023 That link can''t be saved%', 'C4 a link with CRLF stops the save with a message (' || e || ')');
  perform t_ok((public.t_block((r ->> 'blockId')::uuid)).alerts is null, 'C4 …and nothing of that save is kept');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', jsonb_build_object('url', 'https://example.com/' || repeat('a', 10000))));
  perform t_ok(e like '22023 That link%', 'C4 a 10 000-character link is refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"url": "http://example.com"}'));
  perform t_ok(e like '22023 That link%', 'C4 a link that isn''t https is refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"url": 5}'));
  perform t_ok(e like '22023 That link%', 'C4 a link that is no text is refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"alerts": [-5]}'));
  perform t_ok(e like '22023 Those alerts%', 'C4 a negative alert is refused (' || e || ')');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"alerts": [5, 10, 15]}'));
  perform t_ok(e like '22023 Those alerts%', 'C4 three alerts are refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"alerts": [10.5]}'));
  perform t_ok(e like '22023 Those alerts%', 'C4 a fraction of a minute is refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"alerts": ["10"]}'));
  perform t_ok(e like '22023 Those alerts%', 'C4 an alert as text is refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"alerts": 10}'));
  perform t_ok(e like '22023 Those alerts%', 'C4 alerts that are no list are refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"showAs": "tentative"}'));
  perform t_ok(e like '22023 Show As%', 'C4 a Show As off the list is refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"travelMinutes": 45}'));
  perform t_ok(e like '22023 That travel time%', 'C4 a travel time off the list is refused');
  e := public.t_save_refused(public.t_item('X', '2026-11-13', '11:00', '{"travelMinutes": -1}'));
  perform t_ok(e like '22023 That travel time%', 'C4 the "not given" marker is refused as a travel time');
  perform t_ok(not exists (select 1 from public.tasks where title = 'X'), 'C4 no refused save left an item behind');
end $$;
reset role;

-- ═══ C5. End Repeat ═════════════════════════════════════════════════════════
select t_ok(public.repeat_count_end('weekly', '{2,4}', null, null, null, '2026-11-03', 4) = '2026-11-12'
        and public.repeat_count_end('weekly', '{2,4}', null, null, null, '2026-11-04', 1) = '2026-11-05'
        and public.repeat_count_end('interval', '{}', 3, 'day', null, '2026-11-02', 3) = '2026-11-08'
        and public.repeat_count_end('interval', '{1}', 2, 'week', null, '2026-11-02', 3) = '2026-11-30'
        and public.repeat_count_end('monthly', '{}', null, null, null, '2026-01-31', 2) = '2026-02-28'
        and public.repeat_count_end('dates', '{}', null, null, '{2026-12-24,2026-11-20,2026-11-20,2026-11-01}', '2026-11-02', 2) = '2026-12-24'
        and public.repeat_count_end('dates', '{}', null, null, '{2026-11-20}', '2026-11-02', 2) is null
        and public.repeat_count_end('weekly', '{}', null, null, null, '2026-11-02', 1) is null
        and public.repeat_count_end('weekly', '{1}', null, null, null, '2026-11-02', 0) is null,
  'C5 the Nth day per kind (weekly, every 3 days, every 2 weeks, monthly clamped, picked dates once each); none when it never comes');
set role authenticated;
do $$
declare r jsonb; e text; v_plan uuid; p public.schedule_blocks;
begin
  r := public.app_save_item('{"title": "Run", "domain": "personal", "priority": "medium", "date": "2026-11-03", "time": "07:00",
    "durationMinutes": 45, "google": "calendar", "today": "2026-11-02", "repeat": {"kind": "weekly", "daysOfWeek": [2, 4]},
    "repeatEnd": {"count": 4}, "alerts": [30], "url": "https://example.com/route", "travelMinutes": 30, "showAs": "free"}');
  v_plan := (r ->> 'scheduleBlockId')::uuid;
  insert into public.t_keep values ('run', r);
  p := public.t_plan(v_plan);
  perform t_ok(p.repeat_count = 4 and p.repeat_until = '2026-11-12' and p.alerts = '{30}' and p.url = 'https://example.com/route'
               and p.travel_minutes = 30 and p.show_as = 'free' and (r ->> 'calendarFields')::boolean,
    'C5 a new repeat "after 4 times" ends on its 4th day (Tue/Thu from 03.11: 12.11), with its own alerts, link, travel time and Show As');
  perform t_ok(public.repeat_occurs_on(p, '2026-11-12') and not public.repeat_occurs_on(p, '2026-11-17') and not public.repeat_occurs_on(p, '2026-11-19'),
    'C5 its 4th day is a day of it; none after it');
  -- A rule edit moves the end with it (still 4 times).
  r := public.app_save_item(jsonb_build_object('title', 'Run', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-03',
    'time', '07:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'all', 'scheduleBlockId', v_plan,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(2))));
  p := public.t_plan(v_plan);
  perform t_ok(p.repeat_count = 4 and p.repeat_until = '2026-11-24' and p.alerts = '{30}' and p.url = 'https://example.com/route',
    'C5 a rule edit (Tuesdays only) that sends no End Repeat keeps "4 times" — now ending 24.11 — and keeps the fields');
  update public.schedule_blocks set repeat_until = '2030-01-01' where id = v_plan;
  perform t_ok((public.t_plan(v_plan)).repeat_until = '2026-11-24', 'C5 with a count, an end day written by hand is the database''s again');
  r := public.app_save_item(jsonb_build_object('title', 'Run', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-03',
    'time', '07:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'all', 'scheduleBlockId', v_plan,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(2)), 'repeatEnd', jsonb_build_object('until', '2026-12-01')));
  p := public.t_plan(v_plan);
  perform t_ok(p.repeat_count is null and p.repeat_until = '2026-12-01' and public.repeat_occurs_on(p, '2026-12-01') and not public.repeat_occurs_on(p, '2026-12-08'),
    'C5 "on a day": its last day is that day, included');
  e := public.t_save_refused(jsonb_build_object('title', 'Run', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-03',
    'time', '07:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'all', 'scheduleBlockId', v_plan,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(2)), 'repeatEnd', jsonb_build_object('until', '2026-11-01')));
  perform t_ok(e like 'IT007 The repeat ends before it starts%', 'C5 an end before the start (UNTIL before DTSTART) is refused with a message (' || e || ')');
  e := public.t_save_refused(jsonb_build_object('title', 'Run', 'domain', 'personal', 'priority', 'medium', 'date', '2026-12-08',
    'time', '07:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'all', 'scheduleBlockId', v_plan,
    'repeat', jsonb_build_object('kind', 'monthly', 'daysOfWeek', jsonb_build_array())));
  perform t_ok(e like 'IT007 %', 'C5 moving a repeat''s start past its stored end is refused too, with the same message');
  e := public.t_save_refused('{"title": "Y", "domain": "personal", "priority": "medium", "date": "2026-11-03", "time": "07:00",
    "google": "calendar", "today": "2026-11-02", "repeat": {"kind": "weekly", "daysOfWeek": [2]}, "repeatEnd": {"until": "2026-12-01", "count": 3}}');
  perform t_ok(e like '22023 End Repeat%', 'C5 a day AND a count are refused (one end only)');
  e := public.t_save_refused('{"title": "Y", "domain": "personal", "priority": "medium", "date": "2026-11-03", "time": "07:00",
    "google": "calendar", "today": "2026-11-02", "repeat": {"kind": "weekly", "daysOfWeek": [2]}, "repeatEnd": {"count": 1000}}');
  perform t_ok(e like '22023 End Repeat%', 'C5 1000 times are refused');
  e := public.t_save_refused('{"title": "Y", "domain": "personal", "priority": "medium", "date": "2026-11-03", "time": "07:00",
    "google": "calendar", "today": "2026-11-02", "repeat": {"kind": "weekly", "daysOfWeek": [2]}, "repeatEnd": {"until": "01.12.2026"}}');
  perform t_ok(e like '22023 End Repeat%', 'C5 a day in any other form is refused');
  e := public.t_save_refused('{"title": "Y", "domain": "personal", "priority": "medium", "date": "2026-11-03", "time": "07:00",
    "google": "calendar", "today": "2026-11-02", "repeat": {"kind": "weekly", "daysOfWeek": [2]}, "repeatEnd": {"until": "2026-12-01", "x": 1}}');
  perform t_ok(e like '22023 End Repeat%', 'C5 an unknown key is refused');
  r := public.app_save_item(jsonb_build_object('title', 'Run', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-03',
    'time', '07:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'all', 'scheduleBlockId', v_plan,
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(2)), 'repeatEnd', null));
  p := public.t_plan(v_plan);
  perform t_ok(p.repeat_until is null and p.repeat_count is null and public.repeat_occurs_on(p, '2027-06-01'), 'C5 End Repeat "Never" takes the end off');
end $$;
reset role;
-- No day of a repeat after its end: the server's own rules ask repeat_occurs_on (156's day tasks).
do $$
declare v_plan uuid := ((select x.v from public.t_keep x where x.k = 'run') ->> 'scheduleBlockId')::uuid; n integer;
begin
  update public.schedule_blocks set repeat_until = '2026-11-17' where id = v_plan;
  select count(*) into n from public.repeat_day_task(v_plan, '2026-11-24', '2026-11-24', '00000000-0000-0000-0000-000000000001');
  perform t_ok(n = 0 and not exists (select 1 from public.tasks where schedule_block_id = v_plan and occurrence_date = '2026-11-24'),
    'C5 a repeat''s day after its end gets no task (repeat_day_task)');
  select count(*) into n from public.repeat_day_task(v_plan, '2026-11-17', '2026-11-17', '00000000-0000-0000-0000-000000000001');
  perform t_ok(n = 1, 'C5 …its last day does');
  update public.schedule_blocks set repeat_until = null where id = v_plan;
end $$;

-- ═══ C6. A day split off a plan takes the plan's fields ══════════════════════
set role authenticated;
do $$
declare r jsonb; v uuid; v_plan uuid := ((select x.v from public.t_keep x where x.k = 'run') ->> 'scheduleBlockId')::uuid; b public.time_blocks;
begin
  r := public.app_save_item(jsonb_build_object('title', 'Run (this day)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-10',
    'time', '08:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'day', 'scheduleBlockId', v_plan,
    'occurrenceDate', '2026-11-10'));
  b := public.t_block((r ->> 'blockId')::uuid);
  perform t_ok(b.alerts = '{30}' and b.url = 'https://example.com/route' and b.travel_minutes = 30 and b.show_as = 'free',
    'C6 a day split off the repeat ("This day") has the repeat''s alerts, link, travel time and Show As');
  r := public.app_save_item(jsonb_build_object('title', 'Run (elsewhere)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-17',
    'time', '08:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'day', 'scheduleBlockId', v_plan,
    'occurrenceDate', '2026-11-17', 'alerts', '[5]'::jsonb, 'url', null, 'repeatEnd', jsonb_build_object('count', 1)));
  b := public.t_block((r ->> 'blockId')::uuid);
  perform t_ok(b.alerts = '{5}' and b.url is null and b.travel_minutes = 30, 'C6 …or what that day''s sheet says');
  perform t_ok((public.t_plan(v_plan)).alerts = '{30}' and (public.t_plan(v_plan)).repeat_count is null,
    'C6 …and the repeat keeps its own (a "This day" save never changes the rule''s End Repeat)');
  insert into public.time_blocks (date, title, start_time, duration_minutes, schedule_block_id, occurrence_date)
    values ('2026-11-24', 'Run', '07:00', 45, v_plan, '2026-11-24') returning id into v;
  b := public.t_block(v);
  perform t_ok(b.alerts = '{30}' and b.url = 'https://example.com/route' and b.travel_minutes = 30 and b.show_as = 'free',
    'C6 a day any writer splits off the plan (a training move, the read-back) takes its fields');
  insert into public.time_blocks (date, title, start_time, duration_minutes) values ('2026-11-12', 'Lunch', '12:00', 30) returning id into v;
  b := public.t_block(v);
  perform t_ok(b.alerts is null and b.show_as is null and b.url is null and b.travel_minutes is null,
    'C6 a slot of no plan that names none has none (never a marker)');
  insert into public.t_keep values ('lunch', jsonb_build_object('blockId', v));
  update public.time_blocks set alerts = '{-1}', show_as = '', url = '', travel_minutes = -1 where id = v;
  b := public.t_block(v);
  perform t_ok(b.alerts is null and b.show_as is null and b.url is null and b.travel_minutes is null, 'C6 the markers are never stored, on an update either');
  insert into public.time_blocks (date, title, start_time, duration_minutes, schedule_block_id, occurrence_date, alerts, url)
    values ('2026-12-01', 'Run', '07:00', 45, v_plan, '2026-12-01', null, null) returning id into v;
  perform t_ok((public.t_block(v)).alerts is null and (public.t_block(v)).url is null and (public.t_block(v)).travel_minutes = 30,
    'C6 an explicit null on a split day stays null (Undo); a field not named still takes the plan''s');
end $$;
reset role;

-- ═══ C7. A one-off turned into a repeat, and back, keeps its fields ══════════
set role authenticated;
do $$
declare r jsonb; v_plan uuid; b public.time_blocks;
begin
  r := public.app_save_item(public.t_item('Swim', '2026-11-20', '07:00', '{"alerts": [15], "url": "https://example.com/pool", "travelMinutes": 60, "showAs": "busy"}'));
  r := public.app_save_item(public.t_item('Swim', '2026-11-20', '07:00', jsonb_build_object('taskId', r ->> 'taskId', 'blockId', r ->> 'blockId',
    'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(5)))));
  v_plan := (r ->> 'scheduleBlockId')::uuid;
  perform t_ok((select alerts = '{15}' and url = 'https://example.com/pool' and travel_minutes = 60 and show_as = 'busy' from public.schedule_blocks where id = v_plan),
    'C7 a one-off turned into a repeat keeps its fields, though the save sent none');
  r := public.app_save_item(jsonb_build_object('title', 'Swim', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-27',
    'time', '07:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'all', 'scheduleBlockId', v_plan));
  b := public.t_block((r ->> 'blockId')::uuid);
  perform t_ok(b.alerts = '{15}' and b.url = 'https://example.com/pool' and b.travel_minutes = 60 and b.show_as = 'busy',
    'C7 …and turned back into a one-off it keeps them too');
end $$;
reset role;

-- ═══ C8. A changed field reaches Apple and Google ═══════════════════════════
insert into public.calendar_prefs (user_id, prefs) values ('00000000-0000-0000-0000-000000000001',
  '{"areas": {"personal": {"app": "apple", "enabled": true}}}')
  on conflict (user_id) do update set prefs = excluded.prefs;
update public.time_blocks set icloud_area = 'personal', icloud_etag = '"v1"' where id = ((select x.v from public.t_keep x where x.k = 'lunch') ->> 'blockId')::uuid;
update public.schedule_blocks set icloud_area = 'personal', icloud_etag = '"p1"' where id = ((select x.v from public.t_keep x where x.k = 'run') ->> 'scheduleBlockId')::uuid;
delete from public.icloud_outbox;
set role authenticated;
update public.time_blocks set alerts = null, url = null where id = ((select x.v from public.t_keep x where x.k = 'lunch') ->> 'blockId')::uuid;
reset role;
select t_ok(not exists (select 1 from public.icloud_outbox), 'C8 the same (no) values written again send nothing');
do $$
declare v uuid := ((select x.v from public.t_keep x where x.k = 'lunch') ->> 'blockId')::uuid; f text;
begin
  foreach f in array array['alerts = ''{10}''', 'show_as = ''free''', 'url = ''https://example.com/menu''', 'travel_minutes = 5'] loop
    delete from public.icloud_outbox;
    execute format('set role authenticated; update public.time_blocks set %s where id = %L; reset role;', f, v);
    perform t_ok((select count(*) = 1 from public.icloud_outbox where entity = 'slot' and entity_id = v), 'C8 a slot''s ' || split_part(f, ' ', 1) || ' changed queues its Apple event once');
  end loop;
end $$;
do $$
declare v_plan uuid := ((select x.v from public.t_keep x where x.k = 'run') ->> 'scheduleBlockId')::uuid; f text;
begin
  foreach f in array array['alerts = ''{}''', 'show_as = ''busy''', 'url = ''https://example.com/other''', 'travel_minutes = 0', 'repeat_until = ''2027-01-05''', 'repeat_count = 3'] loop
    delete from public.icloud_outbox;
    execute format('set role authenticated; update public.schedule_blocks set %s where id = %L; reset role;', f, v_plan);
    perform t_ok((select count(*) = 1 from public.icloud_outbox where entity = 'plan' and entity_id = v_plan), 'C8 a plan''s ' || split_part(f, ' ', 1) || ' changed queues its Apple series once');
  end loop;
  update public.schedule_blocks set repeat_count = null, repeat_until = null where id = v_plan;
end $$;
delete from public.calendar_outbox;
update public.time_blocks set google_calendar_event_id = 'lasci0fields0test' where id = ((select x.v from public.t_keep x where x.k = 'dentist2') ->> 'blockId')::uuid;
select t_ok(not exists (select 1 from public.calendar_outbox where operation = 'upsert'), 'C8 setup: linking an event (the browser''s own call) queues no upsert');
set role authenticated;
update public.time_blocks set url = 'https://example.com/new', travel_minutes = 90 where id = ((select x.v from public.t_keep x where x.k = 'dentist2') ->> 'blockId')::uuid;
reset role;
select t_ok(not exists (select 1 from public.calendar_outbox where operation = 'upsert'), 'C8 a link or travel time changed sends Google nothing (it has neither)');
set role authenticated;
update public.time_blocks set alerts = '{120}' where id = ((select x.v from public.t_keep x where x.k = 'dentist2') ->> 'blockId')::uuid;
reset role;
select t_ok((select count(*) = 1 from public.calendar_outbox where operation = 'upsert' and event_id = 'lasci0fields0test'),
  'C8 a linked slot''s alerts changed queue its Google event once (every writer)');
delete from public.calendar_outbox;
set role authenticated;
update public.time_blocks set show_as = 'busy' where id = ((select x.v from public.t_keep x where x.k = 'dentist2') ->> 'blockId')::uuid;
reset role;
select t_ok((select count(*) = 1 from public.calendar_outbox where operation = 'upsert' and event_id = 'lasci0fields0test'),
  'C8 …and so does its Show As');

-- ═══ C9. Google's read-back ═════════════════════════════════════════════════
do $$
declare v uuid := ((select x.v from public.t_keep x where x.k = 'dentist2') ->> 'blockId')::uuid; o text; b public.time_blocks;
begin
  -- dentist2: 13.11 11:00, 60 min, busy, Show As Busy (C8), linked to lasci0fields0test.
  o := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', jsonb_build_object('id', 'lasci0fields0test', 'status', 'confirmed',
    'title', 'Dentist (moved)', 'allDay', false, 'date', '2026-11-13', 'time', '11:00:00', 'minutes', 60, 'busy', true, 'showAs', 'busy'));
  perform t_ok(o = 'same', 'C9 the app''s own push read back changes nothing (' || o || ')');
  o := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', jsonb_build_object('id', 'lasci0fields0test', 'status', 'confirmed',
    'title', 'Dentist (moved)', 'allDay', false, 'date', '2026-11-13', 'time', '11:00:00', 'minutes', 60, 'busy', false, 'showAs', 'free'));
  b := public.t_block(v);
  perform t_ok(o = 'changed' and b.show_as = 'free' and b.busy and b.duration_minutes = 60,
    'C9 Free set in Google on an item whose Show As is set: Show As follows, its length stays (' || o || ')');
  update public.time_blocks set show_as = null where id = v;
  o := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', jsonb_build_object('id', 'lasci0fields0test', 'status', 'confirmed',
    'title', 'Dentist (moved)', 'allDay', false, 'date', '2026-11-13', 'time', '11:00:00', 'minutes', 60, 'busy', false, 'showAs', 'free'));
  b := public.t_block(v);
  perform t_ok(b.show_as is null and not b.busy, 'C9 an item with no Show As reads Free as before 193 (no length) — nothing new is stored');
end $$;

-- ═══ C10. Apple's read-back ═════════════════════════════════════════════════
delete from public.icloud_outbox;
do $$
declare v uuid := ((select x.v from public.t_keep x where x.k = 'lunch') ->> 'blockId')::uuid; v_plan uuid := ((select x.v from public.t_keep x where x.k = 'run') ->> 'scheduleBlockId')::uuid;
  o text; b public.time_blocks; p public.schedule_blocks;
begin
  -- lunch: 12.11 12:00, 30 min, in Apple (personal), alerts {10}, Free, a link, 5 min travel (C8).
  b := public.t_block(v);
  o := public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', v, 'personal', jsonb_build_object(
    'allDay', false, 'date', '2026-11-12', 'time', '12:00', 'minutes', 30, 'busy', false, 'title', b.title, 'titleBare', b.title,
    'showAs', 'busy', 'alerts', '[60, 0]'::jsonb, 'url', 'https://example.com/changed-on-iphone', 'travelMinutes', 15), '"v2"');
  perform t_ok(o = 'stale', 'C10 a change with no stamp and a version the app knew is never applied — its fields neither (' || o || ')');
  perform t_ok((public.t_block(v)).alerts = '{10}', 'C10 …the alerts stay');
  o := public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', v, 'personal', jsonb_build_object(
    'allDay', false, 'date', '2026-11-12', 'time', '12:00', 'minutes', 30, 'busy', true, 'title', b.title, 'titleBare', b.title,
    'lastModified', '2026-11-05T10:00:00Z', 'showAs', 'busy', 'alerts', '[60, 0]'::jsonb, 'url', 'https://example.com/changed-on-iphone', 'travelMinutes', 15), '"v3"');
  b := public.t_block(v);
  perform t_ok(o = 'changed' and b.show_as = 'busy' and b.alerts = '{60,0}' and b.url = 'https://example.com/changed-on-iphone'
               and b.travel_minutes = 15 and b.duration_minutes = 30,
    'C10 an iPhone change: Show As, both alerts (in order), the link and the travel time follow; the length stays (' || o || ')');
  perform t_ok(not exists (select 1 from public.icloud_outbox), 'C10 …and nothing is queued back (the iPhone has it)');
  o := public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', v, 'personal', jsonb_build_object(
    'allDay', false, 'date', '2026-11-12', 'time', '12:00', 'minutes', 30, 'busy', true, 'title', b.title, 'titleBare', b.title,
    'lastModified', '2026-11-05T11:00:00Z', 'alerts', '[-5]'::jsonb, 'url', E'https://example.com/\r\nATTENDEE:mailto:x@example.com', 'travelMinutes', 45, 'showAs', 'maybe'), '"v4"');
  b := public.t_block(v);
  perform t_ok(o = 'same' and b.alerts = '{60,0}' and b.url = 'https://example.com/changed-on-iphone' and b.travel_minutes = 15 and b.show_as = 'busy',
    'C10 hostile values from iCloud (a negative alert, CRLF in the link, travel off the list, an unknown Show As) are left out — never applied');
  o := public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', v, 'personal', jsonb_build_object(
    'allDay', false, 'date', '2026-11-12', 'time', '12:00', 'minutes', 30, 'busy', true, 'title', b.title, 'titleBare', b.title,
    'lastModified', '2026-11-05T12:00:00Z', 'alerts', null, 'url', null, 'travelMinutes', null), '"v5"');
  b := public.t_block(v);
  perform t_ok(o = 'changed' and b.alerts is null and b.url is null and b.travel_minutes is null,
    'C10 the iPhone back on what the app writes for none of its own (the area''s alert, the day link, automatic): back to none');
  -- A plan: its fields follow; its End Repeat is its rule (never in a change).
  p := public.t_plan(v_plan);
  o := public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'plan', v_plan, 'personal', jsonb_build_object(
    'title', p.title, 'titleBare', p.title, 'lastModified', '2026-11-05T12:00:00Z', 'days', '[]'::jsonb,
    'alerts', '[1440]'::jsonb, 'url', 'https://example.com/series', 'travelMinutes', 120, 'showAs', 'free', 'repeatUntil', '2026-11-01'), '"p2"');
  p := public.t_plan(v_plan);
  perform t_ok(o = 'changed' and p.alerts = '{1440}' and p.url = 'https://example.com/series' and p.travel_minutes = 120 and p.show_as = 'free'
               and p.repeat_until is null,
    'C10 a series'' alerts, link, travel time and Show As follow; an End Repeat sent along is not read (' || o || ')');
end $$;

-- ═══ C11. Undo puts a row back as it was ════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; d jsonb; b public.time_blocks;
begin
  r := public.app_save_item(public.t_item('Haircut', '2026-11-13', '11:00', '{"alerts": [30, 5], "url": "https://example.com/salon", "travelMinutes": 15, "showAs": "free"}'));
  insert into public.t_keep values ('haircut', r);
  r := public.app_save_item(jsonb_build_object('title', 'Run (day of)', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-19',
    'time', '07:00', 'durationMinutes', 45, 'google', 'calendar', 'today', '2026-11-02', 'scope', 'day',
    'scheduleBlockId', (select x.v ->> 'scheduleBlockId' from public.t_keep x where x.k = 'run'), 'occurrenceDate', '2026-11-19', 'alerts', null, 'url', null));
  insert into public.t_keep values ('runday', r);
  b := public.t_block((r ->> 'blockId')::uuid);
  perform t_ok(b.alerts is null and b.url is null, 'C11 setup: a day of the repeat with its alerts and link taken off');
  d := public.app_delete_rows('tasks', array[(select x.v ->> 'taskId' from public.t_keep x where x.k = 'haircut'), (select x.v ->> 'taskId' from public.t_keep x where x.k = 'runday')]);
  perform t_ok(not exists (select 1 from public.time_blocks where id in (((select x.v from public.t_keep x where x.k = 'haircut') ->> 'blockId')::uuid,
                                                                          ((select x.v from public.t_keep x where x.k = 'runday') ->> 'blockId')::uuid)),
    'C11 deleting both items takes their slots too');
  perform public.app_restore_rows(d);
  b := public.t_block(((select x.v from public.t_keep x where x.k = 'haircut') ->> 'blockId')::uuid);
  perform t_ok(b.alerts = '{30,5}' and b.url = 'https://example.com/salon' and b.travel_minutes = 15 and b.show_as = 'free',
    'C11 Undo of a delete puts every field back');
  b := public.t_block(((select x.v from public.t_keep x where x.k = 'runday') ->> 'blockId')::uuid);
  perform t_ok(b.alerts is null and b.url is null and b.travel_minutes = 120,
    'C11 …and a day whose alerts and link were taken off comes back without them — never the plan''s');
end $$;
reset role;
-- Activity's Undo of one save puts the fields it changed back.
set role authenticated;
do $$
declare r jsonb := (select x.v from public.t_keep x where x.k = 'haircut');
begin
  perform public.app_save_item(public.t_item('Haircut', '2026-11-13', '11:00', jsonb_build_object('taskId', r ->> 'taskId', 'blockId', r ->> 'blockId',
    'alerts', '[]'::jsonb, 'url', 'https://example.com/other-salon', 'travelMinutes', 0, 'showAs', 'busy')));
end $$;
reset role;
do $$
declare v uuid := ((select x.v from public.t_keep x where x.k = 'haircut') ->> 'blockId')::uuid; tx bigint; p jsonb; b public.time_blocks;
begin
  select a.tx_id into tx from public.audit_logs a where a.table_name = 'time_blocks' and a.row_id = v::text and a.operation = 'UPDATE'
   order by a.id desc limit 1;
  b := public.t_block(v);
  perform t_ok(tx is not null and b.alerts = '{}' and b.url = 'https://example.com/other-salon', 'C11 setup: the save is in the activity log');
  set local test.uid = '00000000-0000-0000-0000-000000000001';
  p := public.app_undo_transaction(tx);
  p := public.app_undo_transaction(tx, true, p ->> 'confirm');
  b := public.t_block(v);
  perform t_ok(p ->> 'error' is null and b.alerts = '{30,5}' and b.url = 'https://example.com/salon' and b.travel_minutes = 15 and b.show_as = 'free',
    'C11 Undo this save: the alerts, link, travel time and Show As are back as they were (' || coalesce(p ->> 'error', 'ok') || ')');
end $$;
