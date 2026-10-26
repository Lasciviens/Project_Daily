-- Migration 163 (football): what is followed and how, a match into the day
-- through app_football_plan (one transaction with app_save_item), never
-- twice, a deleted item never added again, a moved kick-off moving the item,
-- delete with Undo across football_plans.task_id (144), row level security
-- and the owner lock; 165's Football category; 168's favourite teams (a team
-- only, several at once, audited, gone with an unfollow and back with Undo).
-- Setup and checks run as the superuser; writes run as `authenticated`, like
-- the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
-- a call that must be refused: its SQLSTATE (null = it ran)
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_err(text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;

-- ═══ 0. Migration 163 itself ═══════════════════════════════════════════════
select public.t_ok((select count(*) from pg_policies where tablename in ('football_follows', 'football_plans') and policyname = 'app_owner_lock') = 2,
  '163: both tables carry the owner lock');
select public.t_ok((select count(*) from pg_trigger where tgname = 'trg_audit'
                     and tgrelid in ('public.football_follows'::regclass, 'public.football_plans'::regclass)) = 2,
  '163: both tables are audited (undoable from Developer → Activity)');
select public.t_ok((select relrowsecurity from pg_class where oid = 'public.football_plans'::regclass),
  '163: row level security is on');
select public.t_ok((select a.atttypid = 'boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = 'false'
                      from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                     where a.attrelid = 'public.football_follows'::regclass and a.attname = 'favourite' and not a.attisdropped),
  '168: favourite is a boolean, never null, false unless starred');
select public.t_ok((select count(*) from pg_constraint where conrelid = 'public.football_follows'::regclass
                     and conname = 'football_follows_favourite_team') = 1,
  '168: its check is there once after two runs');

-- ═══ 1. Following, as the owner ════════════════════════════════════════════
set role authenticated;

insert into public.football_follows (kind, ref, name, league, logo, subscribed)
values ('team', '432', '  Galatasaray ', 'tur.1', 'https://a.espncdn.com/i/teamlogos/soccer/500/432.png', true);
select public.t_ok((select name = 'Galatasaray' and league = 'tur.1' and subscribed and user_id = '00000000-0000-0000-0000-000000000001'
                     from public.football_follows where ref = '432'),
  'a followed team: name trimmed, its league kept, subscribed, the caller''s');
insert into public.football_follows (kind, ref, name, league) values ('league', 'uefa.champions', 'UEFA Champions League', 'tur.1');
select public.t_ok((select league from public.football_follows where ref = 'uefa.champions') = 'uefa.champions',
  'a followed tournament is its own league');
insert into public.football_follows (kind, ref, name) values ('league', 'fifa.worldq.uefa', 'FIFA World Cup Qualifying - UEFA');
select public.t_ok(exists (select 1 from public.football_follows where ref = 'fifa.worldq.uefa'),
  'a slug with two dots is a tournament (the qualifiers)');
select public.t_ok(public.t_err($$insert into public.football_follows (kind, ref, name) values ('team', '432', 'Again')$$) = '23505',
  'the same team can''t be followed twice');
select public.t_ok(public.t_err($$insert into public.football_follows (kind, ref, name) values ('league', '../teams?x=1', 'Bad')$$) = '23514',
  'a ref that would change ESPN''s URL is refused');
select public.t_ok(public.t_err($$insert into public.football_follows (kind, ref, name) values ('team', 'galatasaray', 'Bad')$$) = '23514',
  'a team''s ref is ESPN''s number');
select public.t_ok(public.t_err($$update public.football_follows set subscribed = true where ref = 'uefa.champions'$$) = '23514',
  'a tournament can''t be subscribed');
select public.t_ok(public.t_err($$update public.football_follows set logo = 'http://x/y.png' where ref = '432'$$) = '23514',
  'a logo must be https');
select public.t_ok(public.t_err($$insert into public.football_follows (kind, ref, name) values ('team', '1', '   ')$$) = '23514',
  'a follow needs a name');

-- ═══ 2. A match into the day ═══════════════════════════════════════════════
do $$
declare r jsonb; t record; b record; p record;
begin
  r := public.app_football_plan(
    '{"eventId": "401915396", "league": "uefa.champions", "kickoffAt": "2026-10-21T16:45Z", "timeValid": true, "origin": "subscription"}',
    '{"title": "⚽ Lille – Galatasaray", "notes": "UEFA Champions League · League Phase", "domain": "personal", "priority": "medium",
      "date": "2026-10-21", "time": "18:45", "durationMinutes": 120, "google": "none", "section": "backlog", "today": "2026-10-19"}');
  insert into public.t_keep values ('lille', r);
  select * into t from public.tasks where id = (r ->> 'taskId')::uuid;
  select * into b from public.time_blocks where id = (r ->> 'blockId')::uuid;
  select * into p from public.football_plans where event_id = '401915396';
  perform public.t_ok((r ->> 'planned')::boolean and r ->> 'taskId' is not null,
    'app_football_plan adds the match: app_save_item''s answer, planned');
  perform public.t_ok(t.title = '⚽ Lille – Galatasaray' and t.due_date = '2026-10-21' and t.section = 'backlog' and t.domain = 'personal',
    'the match is a task on its day (letters and ⚽ kept)');
  perform public.t_ok(b.task_id = t.id and b.date = '2026-10-21' and b.start_time = '18:45' and b.duration_minutes = 120,
    'with its two hours from kick-off');
  perform public.t_ok(p.task_id = t.id and p.kickoff_at = '2026-10-21 16:45+00' and p.time_valid and p.origin = 'subscription'
                      and p.league = 'uefa.champions' and p.user_id = '00000000-0000-0000-0000-000000000001',
    'and its record: task, kick-off, origin, tournament');
end $$;

do $$
declare r jsonb; v_tasks bigint := (select count(*) from public.tasks);
begin
  r := public.app_football_plan(
    '{"eventId": "401915396", "league": "uefa.champions", "kickoffAt": "2026-10-21T16:45Z", "timeValid": true, "origin": "manual"}',
    '{"title": "⚽ Lille – Galatasaray", "domain": "personal", "priority": "medium", "date": "2026-10-21", "time": "18:45",
      "durationMinutes": 120, "google": "none", "today": "2026-10-19"}');
  perform public.t_ok(not (r ->> 'planned')::boolean and r ->> 'reason' = 'planned' and (select count(*) from public.tasks) = v_tasks,
    'a match already in the day is never added twice');
  perform public.t_ok((select origin from public.football_plans where event_id = '401915396') = 'subscription',
    '…and its record is left as it was');
end $$;

-- ESPN moves the kick-off: the plan's own task follows, nothing new is made
do $$
declare r jsonb; first jsonb := (select v from public.t_keep where k = 'lille'); v_tasks bigint := (select count(*) from public.tasks);
begin
  r := public.app_football_plan(
    '{"eventId": "401915396", "league": "uefa.champions", "kickoffAt": "2026-10-21T18:00Z", "timeValid": true, "origin": "manual"}',
    jsonb_build_object('taskId', first ->> 'taskId', 'blockId', first ->> 'blockId', 'scope', 'item',
      'title', '⚽ Lille – Galatasaray', 'notes', 'UEFA Champions League · League Phase', 'domain', 'personal', 'priority', 'medium',
      'date', '2026-10-21', 'time', '20:00', 'durationMinutes', 120, 'google', 'none', 'today', '2026-10-19'));
  perform public.t_ok((r ->> 'planned')::boolean and r ->> 'taskId' = first ->> 'taskId' and (select count(*) from public.tasks) = v_tasks,
    'a moved kick-off edits the same task (no second one)');
  perform public.t_ok((select start_time from public.time_blocks where id = (first ->> 'blockId')::uuid) = '20:00',
    '…its slot moves to the new kick-off');
  perform public.t_ok((select kickoff_at = '2026-10-21 18:00+00' and origin = 'subscription' from public.football_plans where event_id = '401915396'),
    '…and the record has the new kick-off, its origin kept');
end $$;

-- A move names only the plan's own task
do $$
declare r jsonb; other jsonb;
begin
  other := public.app_save_item('{"title": "Buy milk", "domain": "personal", "priority": "medium", "date": null, "time": null,
    "durationMinutes": null, "google": "none", "today": "2026-10-19"}');
  r := public.app_football_plan(
    '{"eventId": "401915396", "league": "uefa.champions", "kickoffAt": "2026-10-22T18:00Z", "timeValid": true}',
    jsonb_build_object('taskId', other ->> 'taskId', 'title', 'Hijacked', 'domain', 'personal', 'priority', 'medium',
      'date', '2026-10-22', 'time', '20:00', 'durationMinutes', 120, 'google', 'none', 'today', '2026-10-19'));
  perform public.t_ok(not (r ->> 'planned')::boolean and r ->> 'reason' = 'not-this-match'
                      and (select title from public.tasks where id = (other ->> 'taskId')::uuid) = 'Buy milk'
                      and (select kickoff_at from public.football_plans where event_id = '401915396') = '2026-10-21 18:00+00',
    'a move with another task changes nothing');
  r := public.app_football_plan(
    '{"eventId": "999", "league": "tur.1", "kickoffAt": "2026-10-22T18:00Z", "timeValid": true}',
    jsonb_build_object('taskId', other ->> 'taskId', 'title', 'Hijacked', 'domain', 'personal', 'priority', 'medium',
      'date', '2026-10-22', 'time', null, 'durationMinutes', null, 'google', 'none', 'today', '2026-10-19'));
  perform public.t_ok(not (r ->> 'planned')::boolean and r ->> 'reason' = 'not-this-match'
                      and (select title from public.tasks where id = (other ->> 'taskId')::uuid) = 'Buy milk',
    'a move of a match that isn''t planned changes nothing');
end $$;

select public.t_ok(public.t_err($$select public.app_football_plan('{"eventId": "4019/../x", "league": "tur.1", "kickoffAt": "2026-10-22T18:00Z"}',
  '{"title": "x", "domain": "personal", "priority": "medium", "date": null, "time": null, "durationMinutes": null, "google": "none", "today": "2026-10-19"}')$$) = '22023',
  'a match needs ESPN''s number');
select public.t_ok(public.t_err($$select public.app_football_plan('{"eventId": "1", "league": "tur.1", "kickoffAt": "2026-10-22T18:00Z"}',
  '{"taskId": "not-a-uuid", "title": "x", "domain": "personal", "priority": "medium", "date": null, "time": null, "durationMinutes": null, "google": "none", "today": "2026-10-19"}')$$) = '22023',
  'a bad task id is refused, not a crash');

-- "Plan it" by hand: the Add sheet saves the item, then the record is written
do $$
declare r jsonb;
begin
  r := public.app_save_item('{"title": "⚽ Galatasaray – Fenerbahçe", "domain": "personal", "priority": "medium", "date": "2026-10-26",
    "time": "21:30", "durationMinutes": 120, "google": "none", "today": "2026-10-19"}');
  insert into public.football_plans (event_id, league, task_id, kickoff_at, time_valid, origin)
  values ('401888265', 'tur.1', (r ->> 'taskId')::uuid, '2026-10-26 18:30+00', true, 'manual');
  insert into public.t_keep values ('derby', r);
  perform public.t_ok((select origin = 'manual' and task_id = (r ->> 'taskId')::uuid from public.football_plans where event_id = '401888265'),
    'a match planned by hand has its record');
end $$;

-- Delete the item: the record stays without a task, the match is never added again; Undo links it back
do $$
declare s jsonb; r jsonb; derby jsonb := (select v from public.t_keep where k = 'derby');
begin
  s := public.app_delete_rows('tasks', array[derby ->> 'taskId']);
  perform public.t_ok((select task_id from public.football_plans where event_id = '401888265') is null,
    'deleting the match''s task leaves its record with no task');
  r := public.app_football_plan(
    '{"eventId": "401888265", "league": "tur.1", "kickoffAt": "2026-10-26T18:30Z", "timeValid": true, "origin": "subscription"}',
    '{"title": "⚽ Galatasaray – Fenerbahçe", "domain": "personal", "priority": "medium", "date": "2026-10-26", "time": "21:30",
      "durationMinutes": 120, "google": "none", "today": "2026-10-19"}');
  perform public.t_ok(not (r ->> 'planned')::boolean and r ->> 'reason' = 'deleted'
                      and not exists (select 1 from public.tasks where title = '⚽ Galatasaray – Fenerbahçe'),
    'the subscription never adds a match whose item you deleted');
  perform public.app_restore_rows(s);
  perform public.t_ok((select task_id from public.football_plans where event_id = '401888265') = (derby ->> 'taskId')::uuid,
    'Undo puts the task back and links its record again');
end $$;

-- Unsubscribe (25.10.2026, useStopSubscription): the item, then its record go, so subscribing again adds
-- the match again; Undo puts the record back first, then the item, which links it again (144)
do $$
declare st jsonb; sp jsonb; derby jsonb := (select v from public.t_keep where k = 'derby');
begin
  st := public.app_delete_rows('tasks', array[derby ->> 'taskId']);
  sp := public.app_delete_rows('football_plans', array[(select id::text from public.football_plans where event_id = '401888265')]);
  perform public.t_ok(not exists (select 1 from public.football_plans where event_id = '401888265'),
    'unsubscribe: the record goes with its item');
  perform public.app_restore_rows(sp);
  perform public.app_restore_rows(st);
  perform public.t_ok((select task_id from public.football_plans where event_id = '401888265') = (derby ->> 'taskId')::uuid
                      and exists (select 1 from public.tasks where id = (derby ->> 'taskId')::uuid),
    'unsubscribe''s Undo: the record, then the item — linked again');
end $$;

-- Planned again by hand after a delete: the record takes the new task
do $$
declare r jsonb; derby jsonb := (select v from public.t_keep where k = 'derby');
begin
  delete from public.tasks where id = (derby ->> 'taskId')::uuid;
  r := public.app_save_item('{"title": "⚽ Galatasaray – Fenerbahçe", "domain": "personal", "priority": "medium", "date": "2026-10-26",
    "time": "21:30", "durationMinutes": 120, "google": "none", "today": "2026-10-19"}');
  insert into public.football_plans (event_id, league, task_id, kickoff_at, time_valid, origin)
  values ('401888265', 'tur.1', (r ->> 'taskId')::uuid, '2026-10-26 18:30+00', true, 'manual')
  on conflict (user_id, event_id) do update set task_id = excluded.task_id, kickoff_at = excluded.kickoff_at, time_valid = excluded.time_valid;
  perform public.t_ok((select task_id from public.football_plans where event_id = '401888265') = (r ->> 'taskId')::uuid,
    'planning it again by hand links the new task');
end $$;

-- A follow deleted in the database leaves the planned matches (the app takes a subscription's out first)
delete from public.football_follows where ref = '432';
select public.t_ok((select count(*) from public.football_plans where task_id is not null) = 2,
  'a follow''s row deleted leaves its planned matches in the day');

-- ═══ 2b. The Football category (165) ═══════════════════════════════════════
do $$
declare r jsonb;
begin
  r := public.app_football_plan(
    '{"eventId": "401888259", "league": "tur.1", "kickoffAt": "2026-10-30T17:00Z", "timeValid": true, "origin": "subscription"}',
    '{"title": "⚽ Konyaspor – Galatasaray", "domain": "personal", "priority": "medium", "category": "football", "date": "2026-10-30",
      "time": "18:00", "durationMinutes": 120, "google": "none", "today": "2026-10-19"}');
  perform public.t_ok((select category from public.time_blocks where id = (r ->> 'blockId')::uuid) = 'football'
                      and (select domain from public.tasks where id = (r ->> 'taskId')::uuid) = 'personal',
    '165: a match''s slot is a Football one; its area stays Personal');
  r := public.app_save_item('{"title": "Kitchen", "domain": "personal", "priority": "medium", "category": "nonsense", "date": "2026-10-30",
    "time": "10:00", "durationMinutes": 30, "google": "none", "today": "2026-10-19"}');
  perform public.t_ok((select category from public.time_blocks where id = (r ->> 'blockId')::uuid) <> 'nonsense',
    '165: an unknown category still falls back to the default');
end $$;
select public.t_ok(public.t_err($$insert into public.schedule_blocks (title, days_of_week, start_time, end_time, category, effective_from)
  values ('Weekly match', '{6}', '18:00', '20:00', 'football', '2026-10-19')$$) is null,
  '165: a repeat can be a Football one too');

-- ═══ 2c. Favourite teams (168) ═════════════════════════════════════════════
insert into public.football_follows (kind, ref, name, league)
values ('team', '432', 'Galatasaray', 'tur.1'), ('team', '359', 'Arsenal', 'eng.1');
select public.t_ok((select bool_and(not favourite) from public.football_follows),
  '168: a new follow is not a favourite');
update public.football_follows set favourite = true where ref = '432';
select public.t_ok((select favourite from public.football_follows where ref = '432')
                   and not (select favourite from public.football_follows where ref = '359'),
  '168: a team can be starred; the others stay as they are');
update public.football_follows set favourite = true where ref = '359';
select public.t_ok((select count(*) from public.football_follows where favourite) = 2,
  '168: several teams can be favourites at once');
update public.football_follows set favourite = false where ref = '359';
select public.t_ok(not (select favourite from public.football_follows where ref = '359')
                   and (select favourite from public.football_follows where ref = '432'),
  '168: a favourite can be unstarred');
select public.t_ok(public.t_err($$update public.football_follows set favourite = true where ref = 'uefa.champions'$$) = '23514',
  '168: a tournament can''t be a favourite');
select public.t_ok(public.t_err($$insert into public.football_follows (kind, ref, name, favourite)
                                  values ('league', 'uefa.euro', 'UEFA European Championship', true)$$) = '23514',
  '168: …not even as it is followed');
select public.t_ok(exists (select 1 from public.audit_logs where table_name = 'football_follows' and operation = 'UPDATE'
                            and old_data = '{"favourite": false}'::jsonb and new_data = '{"favourite": true}'::jsonb),
  '168: a star is audited (undoable from Developer → Activity)');

-- Unfollow (useRowsDelete → 144): the row goes and its star with it; Undo puts both back
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('football_follows', array[(select id::text from public.football_follows where ref = '432')]);
  perform public.t_ok(not exists (select 1 from public.football_follows where ref = '432'),
    '168: unfollowing a favourite takes its row, and its star, away');
  perform public.app_restore_rows(s);
  perform public.t_ok((select favourite from public.football_follows where ref = '432'),
    '168: Undo follows it again, still a favourite');
end $$;

-- ═══ 3. Other accounts ══════════════════════════════════════════════════════
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
select public.t_ok((select count(*) from public.football_follows) = 0 and (select count(*) from public.football_plans) = 0,
  'the second account sees none of the owner''s follows or plans');
select public.t_ok(public.t_err(format($$insert into public.football_plans (event_id, league, task_id, kickoff_at) values ('1', 'tur.1', %L, now())$$,
  (select v ->> 'taskId' from public.t_keep where k = 'lille'))) = '23503',
  'the second account can''t record a plan on the owner''s task');
select public.t_ok((select r ->> 'reason' from (select public.app_football_plan(
    '{"eventId": "401915396", "league": "uefa.champions", "kickoffAt": "2026-10-23T18:00Z", "timeValid": true}',
    jsonb_build_object('taskId', (select v ->> 'taskId' from public.t_keep where k = 'lille'), 'title', 'Mine now', 'domain', 'personal',
      'priority', 'medium', 'date', '2026-10-23', 'time', null, 'durationMinutes', null, 'google', 'none', 'today', '2026-10-19')) r) x) = 'not-this-match',
  'nor move the owner''s match');
-- Checked below, as the superuser: the owner's star is still there.
update public.football_follows set favourite = false where ref = '432';
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
select public.t_ok(public.t_err($$insert into public.football_follows (kind, ref, name) values ('team', '432', 'Galatasaray')$$) = '42501',
  'an account the owner lock doesn''t let in can''t follow');
select public.t_ok(public.t_err($$select public.app_football_plan('{"eventId": "5", "league": "tur.1", "kickoffAt": "2026-10-22T18:00Z"}',
  '{"title": "x", "domain": "personal", "priority": "medium", "date": null, "time": null, "durationMinutes": null, "google": "none", "today": "2026-10-19"}')$$) = '42501',
  'nor plan a match');
select set_config('test.uid', '', false);
reset role;
select public.t_ok((select title from public.tasks where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'lille')) = '⚽ Lille – Galatasaray',
  'the owner''s match is untouched by the others');
select public.t_ok((select favourite from public.football_follows where ref = '432' and user_id = '00000000-0000-0000-0000-000000000001'),
  '168: another account can''t unstar the owner''s favourite');
