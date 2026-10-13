-- Migration 144's scenarios: what a delete returns, and that Undo puts the
-- same rows back. Setup runs as the superuser; every delete and restore runs
-- as `authenticated`, under row level security, like the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_snap (k text primary key, v jsonb);
grant all on public.t_snap to authenticated;

-- ── 1. A task with its slot, skip, tag, subtask, wish and a hidden child ────
insert into public.tasks (id, user_id, title, google_task_id, google_sync_enabled, due_date) values
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Parent', 'g-old', true, '2026-10-13'),
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Child', null, false, null),
  ('c0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', 'Other', null, false, null),
  ('d0000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000002', 'Not mine', null, false, null);
update public.tasks set parent_task_id = 'a0000000-0000-0000-0000-00000000000a' where title = 'Child';
insert into public.time_blocks (id, user_id, task_id, date, start_time, title, google_calendar_event_id) values
  ('a1000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '2026-10-13', '10:00', 'Parent', 'ev-old');
insert into public.training_skips (id, user_id, task_id, reason) values
  ('a2000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'sick');
insert into public.wish_items (id, user_id, title, promoted_task_id) values
  ('a3000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Hytte', 'a0000000-0000-0000-0000-00000000000a');
insert into public.task_tags values ('a0000000-0000-0000-0000-00000000000a', 'x'), ('a0000000-0000-0000-0000-00000000000a', 'y');
insert into public.task_secrets (task_id, secret) values ('a0000000-0000-0000-0000-00000000000a', 's');

set role authenticated;
do $$
declare s jsonb; tables text[];
begin
  s := public.app_delete_rows('tasks', array['a0000000-0000-0000-0000-00000000000a']);
  insert into public.t_snap values ('task', s);
  perform public.t_ok((s ->> 'deleted')::int = 1, 'a task delete reports one row deleted');
  select array_agg(g ->> 'table' order by (g ->> 'table') collate "C") into tables from jsonb_array_elements(s -> 'groups') g;
  perform public.t_ok(tables = array['task_tags','tasks','time_blocks','training_skips'], 'it returns the task and every row deleted with it (' || array_to_string(tables, ',') || ')');
  perform public.t_ok((s -> 'groups' -> 0 ->> 'table') = 'tasks', 'the task comes first (parents first)');
  select array_agg(g ->> 'table' order by (g ->> 'table') collate "C") into tables from jsonb_array_elements(s -> 'links') g;
  perform public.t_ok(tables = array['tasks','wish_items'], 'links: the subtask and the wish that pointed at it');
  perform public.t_ok(s -> 'hidden' = '["task_secrets"]', 'a child the caller cannot read is named, not returned');
  perform public.t_ok(not exists (select 1 from public.tasks where title = 'Parent'), 'the task is gone');
  perform public.t_ok(not exists (select 1 from public.time_blocks), 'its slot went with it');
  perform public.t_ok((select parent_task_id from public.tasks where title = 'Child') is null, 'the subtask lost its parent');
end $$;
reset role;
select public.t_ok((select count(*) from public.task_secrets) = 0, 'the hidden child was deleted by the cascade all the same');
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_restore_rows((select v from public.t_snap where k = 'task'),
         '{"tasks": {"google_task_id": null}, "time_blocks": {"google_calendar_event_id": null}}');
  perform public.t_ok((r ->> 'restored')::int = 5, 'Undo puts back 5 rows (task, slot, skip, two tags): ' || r::text);
  perform public.t_ok((r ->> 'relinked')::int = 2, 'and re-links 2 (subtask, wish)');
  perform public.t_ok(exists (select 1 from public.tasks where id = 'a0000000-0000-0000-0000-00000000000a' and title = 'Parent' and due_date = '2026-10-13'), 'the task is back with the same id and values');
  perform public.t_ok((select google_task_id from public.tasks where title = 'Parent') is null, 'an override replaced its old Google id');
  perform public.t_ok((select google_sync_enabled from public.tasks where title = 'Parent'), 'columns not overridden keep their value');
  perform public.t_ok(exists (select 1 from public.time_blocks where id = 'a1000000-0000-0000-0000-00000000000a' and google_calendar_event_id is null and start_time = '10:00'), 'the slot is back, its old event id replaced');
  perform public.t_ok((select reason from public.training_skips where id = 'a2000000-0000-0000-0000-00000000000a') = 'sick', 'the skip is back');
  perform public.t_ok((select count(*) from public.task_tags) = 2, 'both tags (a composite-key child) are back');
  perform public.t_ok((select parent_task_id from public.tasks where title = 'Child') = 'a0000000-0000-0000-0000-00000000000a', 'the subtask points at it again');
  perform public.t_ok((select promoted_task_id from public.wish_items) = 'a0000000-0000-0000-0000-00000000000a', 'the wish points at it again');
  r := public.app_restore_rows((select v from public.t_snap where k = 'task'));
  perform public.t_ok((r ->> 'restored')::int = 0 and (r ->> 'relinked')::int = 0, 'a second Undo changes nothing');
end $$;

-- ── 2. A link changed after the delete is left alone ─────────────────────────
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('tasks', array['a0000000-0000-0000-0000-00000000000a']);
  update public.tasks set parent_task_id = 'c0000000-0000-0000-0000-00000000000c' where title = 'Child';
  perform public.app_restore_rows(s, '{"tasks": {"google_task_id": null}}');
  perform public.t_ok((select parent_task_id from public.tasks where title = 'Child') = 'c0000000-0000-0000-0000-00000000000c', 'a subtask moved under another task meanwhile stays there');
end $$;

-- ── 3. Nothing to delete ─────────────────────────────────────────────────────
do $$
begin
  perform public.t_ok(public.app_delete_rows('tasks', array['e0000000-0000-0000-0000-00000000000e']) is null, 'an id that is not there returns NULL');
  perform public.t_ok(public.app_delete_rows('tasks', array['d0000000-0000-0000-0000-00000000000d']) is null, 'another user''s row returns NULL');
  perform public.t_ok(public.app_delete_rows('tasks', array[]::text[]) is null, 'no ids returns NULL');
  begin
    perform public.app_delete_rows('no_such_table', array['x']);
    perform public.t_ok(false, 'an unknown table is refused');
  exception when undefined_table then
    perform public.t_ok(true, 'an unknown table is refused');
  end;
end $$;
reset role;
select public.t_ok(exists (select 1 from public.tasks where title = 'Not mine'), 'another user''s row is still there');

-- ── 4. A project: phases, items, and the items' slots (rule 043) ─────────────
insert into public.projects (id, user_id, name) values ('f0000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000001', 'House');
insert into public.project_phases (id, project_id, name) values ('f1000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f', 'Plan');
insert into public.project_items (id, project_id, phase_id, title) values
  ('f2000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f', 'f1000000-0000-0000-0000-00000000000f', 'Draw'),
  ('f3000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f', null, 'Buy');
insert into public.time_blocks (id, user_id, date, title, source_type, source_id, google_calendar_event_id) values
  ('f4000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000001', '2026-10-14', 'Draw', 'project_item', 'f2000000-0000-0000-0000-00000000000f', 'ev-p');
set role authenticated;
do $$
declare s jsonb; r jsonb; tables text[];
begin
  s := public.app_delete_rows('projects', array['f0000000-0000-0000-0000-00000000000f']);
  select array_agg(distinct (g ->> 'table') collate "C" order by (g ->> 'table') collate "C") into tables from jsonb_array_elements(s -> 'groups') g;
  perform public.t_ok(tables = array['project_items','project_phases','projects','time_blocks'], 'a project returns its phases, items and the items'' slots');
  perform public.t_ok(not exists (select 1 from public.time_blocks where source_type = 'project_item'), 'rule 043 deleted the slot');
  -- the groups' order is put to the test: items before phases still restores
  s := jsonb_set(s, '{groups}', (select jsonb_agg(g order by (g ->> 'table') = 'project_phases', (g ->> 'table') = 'projects') from jsonb_array_elements(s -> 'groups') g));
  r := public.app_restore_rows(s);
  perform public.t_ok((r ->> 'restored')::int = 5, 'Undo puts back the project, phase, two items and the slot, whatever their order');
  perform public.t_ok((select google_calendar_event_id from public.time_blocks where id = 'f4000000-0000-0000-0000-00000000000f') = 'ev-p', 'the slot keeps its event (the queued Calendar delete then skips it)');
  perform public.t_ok((select phase_id from public.project_items where title = 'Draw') = 'f1000000-0000-0000-0000-00000000000f', 'the item is back in its phase');
end $$;

-- ── 5. A food from the library (rules 107 and 123) ───────────────────────────
reset role;
insert into public.recipe_ingredient_library (id, user_id, name, kcal) values ('e1000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000001', 'Oats', 380);
insert into public.recipes (id, user_id, title, macro_mode, calories) values ('e2000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000001', 'Porridge', 'from_ingredients', 300);
insert into public.recipe_ingredients (id, recipe_id, library_ingredient_id, name) values ('e3000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-00000000000e', 'Oats');
insert into public.food_log_entries (id, user_id, library_ingredient_id, calories) values ('e4000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000e', 190);
set role authenticated;
do $$
declare s jsonb; r jsonb;
begin
  s := public.app_delete_rows('recipe_ingredient_library', array['e1000000-0000-0000-0000-00000000000e']);
  perform public.t_ok((select macro_mode from public.recipes) = 'manual', 'rule 123 switched the recipe to typed macros');
  perform public.t_ok((select custom_title from public.food_log_entries) = 'Oats', 'rule 107 left the name on the diary row');
  perform public.t_ok(s -> 'touched' -> 0 ->> 'table' = 'recipes', 'the recipe the rule changed is returned as touched');
  r := public.app_restore_rows(s);
  perform public.t_ok((select macro_mode from public.recipes) = 'from_ingredients', 'Undo switches the recipe back');
  perform public.t_ok((select library_ingredient_id from public.recipe_ingredients) = 'e1000000-0000-0000-0000-00000000000e', 'the recipe line points at the food again');
  perform public.t_ok((select library_ingredient_id is not null and custom_title is null from public.food_log_entries), 'the diary row points at it again, without the copied name');
  perform public.t_ok((select kcal_x2 from public.food_log_entries) = 380, 'a generated column is computed again, not written');
end $$;

-- ── 6. Arrays and a SET NULL link from a weekly plan ─────────────────────────
reset role;
insert into public.schedule_blocks (id, user_id, title, days_of_week, except_dates) values
  ('c1000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', 'Gym', '{1,3,5}', '{2026-10-12}');
insert into public.time_blocks (id, user_id, schedule_block_id, occurrence_date, date, title) values
  ('c2000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c', '2026-10-12', '2026-10-12', 'Gym');
set role authenticated;
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('schedule_blocks', array['c1000000-0000-0000-0000-00000000000c']);
  perform public.t_ok((select schedule_block_id from public.time_blocks where id = 'c2000000-0000-0000-0000-00000000000c') is null, 'the day it became loses its link');
  perform public.app_restore_rows(s);
  perform public.t_ok((select days_of_week = '{1,3,5}' and except_dates = '{2026-10-12}' from public.schedule_blocks), 'arrays come back as they were');
  perform public.t_ok((select schedule_block_id from public.time_blocks where id = 'c2000000-0000-0000-0000-00000000000c') = 'c1000000-0000-0000-0000-00000000000c', 'the day is linked to its weekly plan again');
end $$;

-- ── 7. All or nothing; a forged snapshot can't write another user's rows ─────
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('tasks', array['c0000000-0000-0000-0000-00000000000c']);
  s := s || jsonb_build_object('groups', (s -> 'groups') || '[{"table": "training_skips", "pk": "id", "rows": [{"id": "a9000000-0000-0000-0000-00000000000a", "user_id": "00000000-0000-0000-0000-000000000001", "reason": null}]}]'::jsonb);
  begin
    perform public.app_restore_rows(s);
    perform public.t_ok(false, 'a restore that breaks a rule is refused');
  exception when not_null_violation then
    perform public.t_ok(true, 'a restore that breaks a rule is refused');
  end;
  perform public.t_ok(not exists (select 1 from public.tasks where id = 'c0000000-0000-0000-0000-00000000000c'), 'and nothing of it was put back');
  begin
    perform public.app_restore_rows('{"v": 1, "groups": [{"table": "tasks", "pk": "id", "rows": [{"id": "a8000000-0000-0000-0000-00000000000a", "user_id": "00000000-0000-0000-0000-000000000002", "title": "forged"}]}]}'::jsonb);
  exception when others then null;
  end;
  perform public.t_ok(not exists (select 1 from public.tasks where title = 'forged'), 'a row for another user is not written');
  begin
    perform public.app_restore_rows('{"groups": []}'::jsonb);
    perform public.t_ok(false, 'something that is not a delete snapshot is refused');
  exception when invalid_parameter_value then
    perform public.t_ok(true, 'something that is not a delete snapshot is refused');
  end;
end $$;

-- ── 8. A delete too big to hold for Undo still deletes, and says so ─────────
reset role;
insert into public.tasks (id, user_id, title) values ('aa000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', 'Huge');
insert into public.task_tags select 'aa000000-0000-0000-0000-0000000000aa', 't' || g from generate_series(1, 10001) g;
set role authenticated;
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('tasks', array['aa000000-0000-0000-0000-0000000000aa']);
  perform public.t_ok((s ->> 'too_big')::boolean and (s ->> 'deleted')::int = 1, 'over 10,000 rows: deleted, marked too big');
  perform public.t_ok(jsonb_array_length(s -> 'groups') = 0, 'and no rows are returned');
  perform public.t_ok(not exists (select 1 from public.tasks where title = 'Huge'), 'the task is gone');
end $$;
reset role;
