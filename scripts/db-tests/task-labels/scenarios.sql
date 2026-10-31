-- Migration 180 (your own labels on a task): the column and its one cleaning
-- rule on every writer, the item save setting / keeping / clearing them, the
-- answer saying what was stored, the owner's label list (own rows only).
-- Setup and checks run as the superuser; writes run as `authenticated`, like
-- the app.
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
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;

-- ═══ 0. The migration itself ═══════════════════════════════════════════════
select public.t_ok((select a.atttypid = 'text[]'::regtype and a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = '''{}''::text[]'
                      from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                     where a.attrelid = 'public.tasks'::regclass and a.attname = 'labels' and not a.attisdropped),
  '180: tasks.labels is a text array, never null, empty unless labelled');
select public.t_ok((select count(*) from pg_trigger where tgname = 'trg_tasks_labels_clean' and tgrelid = 'public.tasks'::regclass) = 1,
  '180: one cleaning trigger after two runs');
select public.t_ok((select count(*) from pg_constraint where conname = 'tasks_labels_valid' and conrelid = 'public.tasks'::regclass) = 1,
  '180: one last-line check after two runs');
select public.t_ok(not has_function_privilege('anon', 'public.app_task_labels()', 'execute')
                   and has_function_privilege('authenticated', 'public.app_task_labels()', 'execute'),
  '180: the label list is for signed-in callers only');

-- ═══ 1. The item save ══════════════════════════════════════════════════════
set role authenticated;

insert into public.t_keep select 'new', public.app_save_item(jsonb_build_object(
  'title', 'Buy bulbs', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-03', 'google', 'none', 'today', '2026-10-31',
  'labels', jsonb_build_array('  Errands ', 'errands', E'Phone\tcall', 'Home  Office', repeat('x', 40), '', 7, null)));
select public.t_ok((select labels = array['Errands', 'Phone call', 'Home Office', repeat('x', 30)] from public.tasks
                     where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'new')),
  'a new item keeps its labels cleaned: trimmed, a tab a space, spaces squashed, cut at 30, the same label in another case once, empties and non-text out');
select public.t_ok((select v -> 'labels' = '["Errands", "Phone call", "Home Office", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]'::jsonb from public.t_keep where k = 'new'),
  'the answer says what was stored (a browser can tell an older database kept none)');

insert into public.t_keep select 'kept', public.app_save_item(jsonb_build_object(
  'taskId', (select v ->> 'taskId' from public.t_keep where k = 'new'),
  'title', 'Buy bulbs (2)', 'domain', 'personal', 'priority', 'high', 'date', '2026-11-03', 'google', 'none', 'today', '2026-10-31'));
select public.t_ok((select title = 'Buy bulbs (2)' and priority = 'high' and cardinality(labels) = 4 from public.tasks
                     where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'new')),
  'a save without labels (Plan it, the subscription, the phone) changes the item and keeps its labels');

insert into public.t_keep select 'odd', public.app_save_item(jsonb_build_object(
  'taskId', (select v ->> 'taskId' from public.t_keep where k = 'new'),
  'title', 'Buy bulbs (2)', 'domain', 'personal', 'priority', 'high', 'date', '2026-11-03', 'google', 'none', 'today', '2026-10-31',
  'labels', 'Errands'));
select public.t_ok((select cardinality(labels) = 4 from public.tasks where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'new')),
  'labels that aren''t a list change nothing');

insert into public.t_keep select 'many', public.app_save_item(jsonb_build_object(
  'taskId', (select v ->> 'taskId' from public.t_keep where k = 'new'),
  'title', 'Buy bulbs (2)', 'domain', 'personal', 'priority', 'high', 'date', '2026-11-03', 'google', 'none', 'today', '2026-10-31',
  'labels', (select jsonb_agg('L' || i) from generate_series(1, 12) i)));
select public.t_ok((select labels = array['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10'] from public.tasks
                     where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'new')),
  'twelve labels: the first ten are kept, in order');

insert into public.t_keep select 'cleared', public.app_save_item(jsonb_build_object(
  'taskId', (select v ->> 'taskId' from public.t_keep where k = 'new'),
  'title', 'Buy bulbs (2)', 'domain', 'personal', 'priority', 'high', 'date', '2026-11-03', 'google', 'none', 'today', '2026-10-31',
  'labels', '[]'::jsonb));
select public.t_ok((select labels = '{}' from public.tasks where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'new')),
  'an empty list clears them');

-- A timed item: the labels sit on its task, its slot is as before.
insert into public.t_keep select 'timed', public.app_save_item(jsonb_build_object(
  'title', 'Dentist', 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-04', 'time', '09:30', 'durationMinutes', 45,
  'google', 'none', 'today', '2026-10-31', 'labels', jsonb_build_array('Health')));
select public.t_ok((select t.labels = array['Health'] and b.start_time = '09:30' and b.task_id = t.id
                      from public.tasks t join public.time_blocks b on b.task_id = t.id
                     where t.id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'timed')),
  'a timed item keeps its labels on its task and its slot as always');

-- ═══ 2. Every other writer goes through the same rule ═══════════════════════
update public.tasks set labels = array[E'Bad\u202Eguy', E'\u00A0\u00A0', E'zero\u200Bwidth']
 where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'timed');
select public.t_ok((select labels = array['Badguy', 'zerowidth'] from public.tasks where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'timed')),
  'invisible and direction-changing characters go; a label of only no-break spaces is none');
update public.tasks set labels = array['  a  ', 'A', null, E'b\nc']
 where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'timed');
select public.t_ok((select labels = array['a', 'b c'] from public.tasks where id = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'timed')),
  'a direct write (the assistant) is cleaned the same way: trimmed, the same label once, no empty, a line break a space');
insert into public.tasks (title, labels) values ('Plain insert', array['Errands', 'errands ']);
select public.t_ok((select labels = array['Errands'] from public.tasks where title = 'Plain insert'),
  'an insert is cleaned too');
insert into public.tasks (title) values ('No labels');
select public.t_ok((select labels = '{}' from public.tasks where title = 'No labels'),
  'a task made without labels has none (a Google import, a repeat''s day)');

-- ═══ 3. The owner's labels, most used first, own rows only ═══════════════
update public.tasks set labels = array['errands', 'Phone call'] where title = 'No labels';
reset role;
set test.uid = '00000000-0000-0000-0000-000000000002';
insert into public.tasks (user_id, title, labels) values ('00000000-0000-0000-0000-000000000002', 'Someone else''s', array['Secret']);
reset test.uid;
set role authenticated;
select public.t_ok((select array_agg(lower(label) || ':' || uses order by uses desc, lower(label)) from public.app_task_labels())
                   = array['errands:2', 'a:1', 'b c:1', 'phone call:1'],
  'the label list: each label once whatever its case, most used first, then A–Z');
select public.t_ok(not exists (select 1 from public.app_task_labels() where label = 'Secret'),
  'another account''s labels are never offered');

-- ═══ 4. The size check is the last line ══════════════════════════════════
reset role;
alter table public.tasks disable trigger trg_tasks_labels_clean;
select public.t_ok(public.t_err($$update public.tasks set labels = (select array_agg('x' || i) from generate_series(1, 11) i) where title = 'Plain insert'$$) = '23514',
  'eleven labels are refused even past the cleaning');
select public.t_ok(public.t_err($$update public.tasks set labels = array[repeat('y', 31)] where title = 'Plain insert'$$) = '23514',
  'a label over 30 characters is refused even past the cleaning');
select public.t_ok(public.t_err($$update public.tasks set labels = array[E'a\u202Eb'] where title = 'Plain insert'$$) = '23514',
  'a right-to-left override is refused even past the cleaning');
select public.t_ok(public.t_err($$update public.tasks set labels = array[' padded '] where title = 'Plain insert'$$) = '23514',
  'an untrimmed label is refused even past the cleaning');
alter table public.tasks enable trigger trg_tasks_labels_clean;
