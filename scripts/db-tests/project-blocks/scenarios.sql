-- Migration 162 (projects for every kind of project): first what 162 did to
-- the owner's data (every old item is one project task, nothing lost, nothing
-- on Daily, a closed item keeps its own close time, the other account's stay
-- theirs), then the new rules: the phase's done time, the status line's
-- time, a task's project and phase kept honest, a block entry's project,
-- area → task domain, a deleted phase keeping its tasks, app_create_project,
-- a project's delete with Undo (144's app_delete_rows / app_restore_rows
-- follow the new keys), row level security and the owner lock. Setup and
-- checks run as the superuser; writes run as `authenticated`, like the app.
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

-- ═══ 0. Migration 162 itself ═══════════════════════════════════════════════
select public.t_ok((select count(*) from public.project_items) = (select count(*) from public.snap_items),
  '162: project_items is left as it was (the record of the old items)');
select public.t_ok((select count(*) from public.tasks t where t.project_id is not null) = 5,
  '162: every old item is exactly one project task (4 of the owner''s, 1 of the other account''s)');
select public.t_ok((select count(*) from public.tasks) = (select count(*) from public.snap_tasks) + 4,
  '162: the planned item reused its task; the other four items got one each');
select public.t_ok((select project_id from public.tasks where id = 'd0000000-0000-0000-0000-000000000002') = 'a0000000-0000-0000-0000-000000000001'
  and (select project_phase_id from public.tasks where id = 'd0000000-0000-0000-0000-000000000002') = 'b0000000-0000-0000-0000-000000000002',
  '162: a planned item''s newest open task becomes the project task, in its phase');
select public.t_ok((select project_id from public.tasks where id = 'd0000000-0000-0000-0000-000000000001') is null,
  '162: its older closed task is left alone');
select public.t_ok(not exists (
  select 1 from public.snap_tasks s join public.tasks t on t.id = s.id
   where (s.title, s.description, s.status, s.section, s.due_date, s.google_task_id, s.google_sync_enabled, s.completed_at, s.domain)
     is distinct from (t.title, t.description, t.status, t.section, t.due_date, t.google_task_id, t.google_sync_enabled, t.completed_at, t.domain)),
  '162: no existing task changed title, notes, status, section, day, Google link or close time (a Google task''s notes stay)');
select public.t_ok((select count(*) from public.tasks t join public.snap_items i on t.source_id = i.id
                     where t.source_type = 'project_item' and t.id not in (select id from public.snap_tasks)
                       and t.title = i.title and t.description is not distinct from i.notes and t.status = i.status
                       and t.priority = i.priority and t.sort_order = i.sort_order and t.project_phase_id = i.phase_id
                       and t.project_id = i.project_id and t.user_id = i.user_id and t.created_at = i.created_at) = 4,
  '162: a new task carries its item''s title, notes, status, priority, order, phase, owner and creation time');
select public.t_ok(not exists (select 1 from public.tasks t where t.id not in (select id from public.snap_tasks)
                                and (t.section <> 'backlog' or t.due_date is not null or t.google_sync_enabled or t.domain <> 'personal')),
  '162: new tasks are undated Backlog tasks, personal, Google sync off (never on Daily or the Today lists)');
select public.t_ok((select completed_at from public.tasks where source_id = 'c0000000-0000-0000-0000-000000000002') = '2026-07-01 10:30+00'
  and (select completed_at from public.tasks where source_id = 'c0000000-0000-0000-0000-000000000004') = '2026-08-20 09:00+00',
  '162: a closed item keeps its own close time, never "closed today"');
select public.t_ok((select user_id from public.tasks where source_id = 'c0000000-0000-0000-0000-000000000005') = '00000000-0000-0000-0000-000000000002',
  '162: the other account''s item became the other account''s task');
select public.t_ok((select (kind, area, started_on) = ('blank', 'personal', '2026-05-02'::date) from public.projects
                     where id = 'a0000000-0000-0000-0000-000000000001'),
  '162: an existing project is blank, personal, started the day it was made');
select public.t_ok((select done_at from public.project_phases where id = 'b0000000-0000-0000-0000-000000000001') = '2026-07-10 12:00+00'
  and (select done_at from public.project_phases where id = 'b0000000-0000-0000-0000-000000000002') is null,
  '162: a phase already done was finished when it was last changed; an open one has no done time');

-- ═══ 1. The rules, as the owner ═════════════════════════════════════════════
set role authenticated;

-- A phase's done time
update public.project_phases set status = 'done' where id = 'b0000000-0000-0000-0000-000000000002';
select public.t_ok((select done_at from public.project_phases where id = 'b0000000-0000-0000-0000-000000000002') > now() - interval '1 minute',
  'marking a phase done stamps its done time');
update public.project_phases set name = 'Version two' where id = 'b0000000-0000-0000-0000-000000000002';
select public.t_ok((select done_at from public.project_phases where id = 'b0000000-0000-0000-0000-000000000002') is not null,
  'renaming a done phase keeps its done time');
update public.project_phases set status = 'in_progress' where id = 'b0000000-0000-0000-0000-000000000002';
select public.t_ok((select done_at from public.project_phases where id = 'b0000000-0000-0000-0000-000000000002') is null,
  'reopening a phase clears its done time');
update public.project_phases set status = 'done', done_at = '2026-10-01 10:00+00' where id = 'b0000000-0000-0000-0000-000000000002';
select public.t_ok((select done_at from public.project_phases where id = 'b0000000-0000-0000-0000-000000000002') = '2026-10-01 10:00+00',
  'a writer that sends its own done time (Undo) keeps it');
update public.project_phases set status = 'in_progress' where id = 'b0000000-0000-0000-0000-000000000002';

-- The status line's time
update public.projects set status_line = '  Stage 1 code ready  ' where id = 'a0000000-0000-0000-0000-000000000001';
select public.t_ok((select status_line = 'Stage 1 code ready' and status_line_at > now() - interval '1 minute'
                     from public.projects where id = 'a0000000-0000-0000-0000-000000000001'),
  'a new status line is trimmed and stamped');
update public.projects set status_line_at = '2026-10-14 09:00+00' where id = 'a0000000-0000-0000-0000-000000000001';
update public.projects set description = 'The app, again' where id = 'a0000000-0000-0000-0000-000000000001';
select public.t_ok((select status_line_at from public.projects where id = 'a0000000-0000-0000-0000-000000000001') = '2026-10-14 09:00+00',
  'another edit leaves the status line''s time');
update public.projects set status_line = 'Waits for the iron' where id = 'a0000000-0000-0000-0000-000000000001';
select public.t_ok((select status_line_at from public.projects where id = 'a0000000-0000-0000-0000-000000000001') > now() - interval '1 minute',
  'a changed status line gets a new time');
update public.projects set status_line = '' where id = 'a0000000-0000-0000-0000-000000000001';
select public.t_ok((select status_line is null and status_line_at is null from public.projects where id = 'a0000000-0000-0000-0000-000000000001'),
  'clearing the status line clears its time');
select public.t_ok(public.t_err($$update public.projects set link_url = 'javascript:alert(1)' where id = 'a0000000-0000-0000-0000-000000000001'$$) = '23514',
  'a main link must be http(s)');

-- A new project from a template
do $$
declare p public.projects;
begin
  p := public.app_create_project('{"name": " Kitchen scale ", "kind": "hardware", "area": "personal", "link_url": "https://github.com/x/y"}',
    '[{"name": "Know the parts", "done_when": "The screen works"}, {"name": " "}, {"name": "Weighing on the bench"}]',
    '[{"kind": "table", "title": "Parts", "settings": {"columns": [{"key": "c1", "label": "Part", "type": "text"}]}}, {"kind": "log", "title": "Log"}]');
  perform public.t_ok(p.name = 'Kitchen scale' and p.kind = 'hardware' and p.started_on = (now() at time zone 'Europe/Oslo')::date
                      and p.user_id = '00000000-0000-0000-0000-000000000001',
    'app_create_project makes the project (trimmed name, its kind, started today, the caller''s)');
  perform public.t_ok((select array_agg(name order by sort_order) from public.project_phases where project_id = p.id)
                      = array['Know the parts', 'Weighing on the bench']
                      and (select done_when from public.project_phases where project_id = p.id and sort_order = 0) = 'The screen works',
    'its phases come in order, a blank one skipped');
  perform public.t_ok((select array_agg(kind || ':' || title order by sort_order) from public.project_blocks where project_id = p.id)
                      = array['table:Parts', 'log:Log']
                      and (select settings -> 'columns' -> 0 ->> 'label' from public.project_blocks where project_id = p.id and kind = 'table') = 'Part',
    'its blocks come in order with their settings');
  perform public.t_ok(p.sort_order > (select sort_order from public.projects where id = 'a0000000-0000-0000-0000-000000000001'),
    'a new project goes after the others');
end $$;
select public.t_ok(public.t_err($$select public.app_create_project('{"name": "  "}')$$) = '22023', 'a project needs a name');
select public.t_ok(public.t_err($$select public.app_create_project('{"name": "X", "kind": "boat"}')$$) = '23514', 'an unknown kind is refused');
select public.t_ok(public.t_err($$select public.app_create_project('{"name": "X"}', '[]', '[{"kind": "kanban", "title": "K"}]')$$) = '23514',
  'an unknown block kind is refused (and nothing of the project is left)');
select public.t_ok((select count(*) from public.projects where name = 'X') = 0, 'a refused create leaves no project behind');

-- A task's project and phase
insert into public.tasks (id, title, section, project_phase_id) values
  ('e0000000-0000-0000-0000-000000000001', 'Solder the pins', 'backlog',
   (select id from public.project_phases where name = 'Weighing on the bench'));
select public.t_ok((select project_id from public.tasks where id = 'e0000000-0000-0000-0000-000000000001')
                   = (select id from public.projects where name = 'Kitchen scale'),
  'a task given only a phase gets that phase''s project');
update public.tasks set project_id = 'a0000000-0000-0000-0000-000000000001', project_phase_id = 'b0000000-0000-0000-0000-000000000002'
 where id = 'e0000000-0000-0000-0000-000000000001';
select public.t_ok((select (project_id, project_phase_id) = ('a0000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-000000000002'::uuid)
                     from public.tasks where id = 'e0000000-0000-0000-0000-000000000001'),
  'a task moves to another project and phase');
update public.tasks set project_id = (select id from public.projects where name = 'Kitchen scale')
 where id = 'e0000000-0000-0000-0000-000000000001';
select public.t_ok((select project_phase_id from public.tasks where id = 'e0000000-0000-0000-0000-000000000001') is null,
  'moved to another project by its project alone, it leaves the old phase behind');
select public.t_ok(public.t_err($$insert into public.tasks (title, project_phase_id) values ('x', 'b0000000-0000-0000-0000-000000000003')$$) = '23503',
  'another account''s phase is refused');
select public.t_ok(public.t_err($$insert into public.tasks (title, project_id) values ('x', 'a0000000-0000-0000-0000-000000000002')$$) = '23503',
  'another account''s project is refused');

-- A block's entries
insert into public.project_entries (id, block_id, project_id, title, entry_date) values
  ('e1000000-0000-0000-0000-000000000001', (select id from public.project_blocks where title = 'Log'),
   'a0000000-0000-0000-0000-000000000001', '  Stage 0 flashed  ', '2026-10-14');
select public.t_ok((select project_id = (select id from public.projects where name = 'Kitchen scale') and title = 'Stage 0 flashed'
                     from public.project_entries where id = 'e1000000-0000-0000-0000-000000000001'),
  'an entry takes its block''s project (whatever the writer sent) and a trimmed title');
insert into public.project_entries (block_id, data) values
  ((select id from public.project_blocks where title = 'Parts'), '{"c1": "HX711"}');
select public.t_ok(public.t_err($$insert into public.project_entries (block_id, url) values ((select id from public.project_blocks where title = 'Log'), 'ftp://x')$$) = '23514',
  'a link must be http(s)');
select public.t_ok(public.t_err($$insert into public.project_entries (block_id, data) values ((select id from public.project_blocks where title = 'Parts'), '[1]')$$) = '23514',
  'a row''s data is an object');

-- Area moves the project's tasks
insert into public.tasks (id, title, domain, project_id) values
  ('e0000000-0000-0000-0000-000000000002', 'A film to watch for it', 'media', (select id from public.projects where name = 'Kitchen scale'));
update public.projects set area = 'work' where name = 'Kitchen scale';
select public.t_ok((select domain from public.tasks where id = 'e0000000-0000-0000-0000-000000000001') = 'work'
  and (select domain from public.tasks where id = 'e0000000-0000-0000-0000-000000000002') = 'media',
  'a project moved to Work takes its personal tasks along; a media task stays');
update public.projects set area = 'personal' where name = 'Kitchen scale';
select public.t_ok((select domain from public.tasks where id = 'e0000000-0000-0000-0000-000000000001') = 'personal',
  'and back to Personal');

-- A deleted phase keeps its tasks in the project
update public.tasks set project_phase_id = (select id from public.project_phases where name = 'Know the parts')
 where id = 'e0000000-0000-0000-0000-000000000001';
delete from public.project_phases where name = 'Know the parts';
select public.t_ok((select (project_id = (select id from public.projects where name = 'Kitchen scale')) and project_phase_id is null
                     from public.tasks where id = 'e0000000-0000-0000-0000-000000000001'),
  'deleting a phase keeps its tasks in the project, with no phase');

-- A project's delete takes everything with it, and Undo brings it back
do $$
declare s jsonb; r jsonb; v_id uuid := (select id from public.projects where name = 'Kitchen scale'); tables text[];
begin
  s := public.app_delete_rows('projects', array[v_id::text]);
  select array_agg(distinct (g ->> 'table') collate "C" order by (g ->> 'table') collate "C") into tables from jsonb_array_elements(s -> 'groups') g;
  perform public.t_ok(tables = array['project_blocks', 'project_entries', 'project_phases', 'projects', 'tasks'],
    'deleting a project takes its phases, tasks, blocks and entries (got ' || array_to_string(tables, ', ') || ')');
  perform public.t_ok(not exists (select 1 from public.tasks where project_id = v_id)
                      and not exists (select 1 from public.project_entries where project_id = v_id),
    'nothing of it is left');
  r := public.app_restore_rows(s);
  perform public.t_ok((select count(*) from public.tasks where project_id = v_id) = 2
                      and (select count(*) from public.project_entries where project_id = v_id) = 2
                      and (select count(*) from public.project_blocks where project_id = v_id) = 2
                      and (select count(*) from public.project_phases where project_id = v_id) = 1,
    'Undo puts back the project, its phase, tasks, blocks and entries');
end $$;

-- A deleted phase's Undo puts its tasks back in it
do $$
declare s jsonb; v_phase uuid := 'b0000000-0000-0000-0000-000000000002';
begin
  s := public.app_delete_rows('project_phases', array[v_phase::text]);
  perform public.t_ok((select project_phase_id from public.tasks where id = 'd0000000-0000-0000-0000-000000000002') is null,
    'a deleted phase''s tasks stay, with no phase');
  perform public.app_restore_rows(s);
  perform public.t_ok((select project_phase_id from public.tasks where id = 'd0000000-0000-0000-0000-000000000002') = v_phase,
    'its Undo puts them back in the phase');
end $$;

-- ═══ 2. Other accounts ══════════════════════════════════════════════════════
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
select public.t_ok((select count(*) from public.project_blocks) = 0 and (select count(*) from public.project_entries) = 0,
  'the second account sees none of the owner''s blocks or entries');
select public.t_ok(public.t_err($$insert into public.project_blocks (project_id, kind, title) values ('a0000000-0000-0000-0000-000000000001', 'log', 'Mine now')$$) = '23503',
  'the second account can''t add a block to the owner''s project');
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
select public.t_ok(public.t_err($$select public.app_create_project('{"name": "Not allowed"}')$$) = '42501',
  'an account the owner lock doesn''t let in can''t create a project');
select public.t_ok((select count(*) from public.project_blocks) = 0, 'nor read a block');
select set_config('test.uid', '', false);
reset role;
