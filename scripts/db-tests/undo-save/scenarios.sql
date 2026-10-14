-- Migration 150's scenarios: what "Undo this save" plans, that a preview
-- changes nothing, that an undo puts back exactly what the save changed in one
-- transaction, and that it stops at what it can't do safely. Setup runs as
-- the superuser; every save, preview and undo runs as `authenticated`, under
-- row level security, like the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
-- the saves' transaction ids and the plans shown, by name
create table public.t_tx (k text primary key, tx bigint, plan jsonb);
grant all on public.t_tx to authenticated;
create or replace function public.t_tx(p_k text) returns bigint language sql stable as $$ select tx from public.t_tx where k = p_k $$;
grant execute on function public.t_tx(text) to authenticated;
-- an apply that must be refused: returns its SQLSTATE (null = it ran)
create or replace function public.t_refused(p_tx bigint, p_confirm text, p_overrides jsonb default '{}') returns text language plpgsql as $$
begin
  perform public.app_undo_transaction(p_tx, true, p_confirm, p_overrides);
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_refused(bigint, text, jsonb) to authenticated;

select public.t_ok((select count(*) from public.audit_logs) = 0 and exists (
  select 1 from information_schema.columns where table_name = 'audit_logs' and column_name = 'seq'), 'audit_logs has its change order (seq)');

-- ── 1. The 73-episode save: only watched_at changed ─────────────────────────
insert into public.user_tv_entries (id, title) values ('e0000000-0000-0000-0000-000000000001', 'The Show');
insert into public.user_tv_episodes (id, tv_entry_id, season_number, episode_number, watched_at)
select ('10000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'e0000000-0000-0000-0000-000000000001',
       1 + (g - 1) / 10, g, timestamptz '2026-01-01 20:00+00' + make_interval(days => g)
from generate_series(1, 73) g;
create table public.t_eps_before as select id, watched_at from public.user_tv_episodes;
grant select on public.t_eps_before to authenticated;

set role authenticated;
do $$
begin
  update public.user_tv_episodes set watched_at = '2026-10-14 08:30+00' where tv_entry_id = 'e0000000-0000-0000-0000-000000000001';
  insert into public.t_tx values ('eps', txid_current());
end $$;

do $$
declare p jsonb; n_logs bigint := (select count(*) from public.audit_logs);
begin
  p := public.app_undo_transaction(public.t_tx('eps'));
  perform public.t_ok((p ->> 'changes')::int = 73 and (p ->> 'steps')::int = 73, 'the plan sees the 73 changes of the save and 73 rows to put back');
  perform public.t_ok(jsonb_array_length(p -> 'tables') = 1 and (p -> 'tables' -> 0 ->> 't') = 'user_tv_episodes'
                      and (p -> 'tables' -> 0 ->> 'revert')::int = 73, '73 TV episodes to revert');
  perform public.t_ok(p -> 'tables' -> 0 -> 'columns' = '["watched_at"]', 'only watched_at is put back (updated_at is bookkeeping): ' || (p -> 'tables' -> 0 ->> 'columns'));
  perform public.t_ok(p -> 'conflicts' = '[]' and p -> 'blocked' = '[]' and p -> 'collateral' = '[]' and p -> 'kept' = '[]', 'no conflicts, nothing blocked or taken along');
  perform public.t_ok(not (p ->> 'needs_confirm')::boolean and (p ->> 'can_apply')::boolean and p -> 'error' = 'null', 'it can run without confirming');
  perform public.t_ok(length(p ->> 'confirm') = 32 and p ->> 'actors' = '["web"]', 'the plan carries its fingerprint and who saved');
  perform public.t_ok((select count(*) from public.user_tv_episodes where watched_at = '2026-10-14 08:30+00') = 73, 'the preview changed nothing');
  perform public.t_ok((select count(*) from public.audit_logs) = n_logs, 'and left nothing in the log (its trial run was rolled back)');
  insert into public.t_tx values ('eps_plan', null, p);
end $$;

do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('eps'), true);
  insert into public.t_tx values ('eps_undo', txid_current());
  perform public.t_ok((p ->> 'applied')::boolean and (p -> 'result' ->> 'reverted')::int = 73, 'the undo reverts 73 rows');
  perform public.t_ok(p ->> 'confirm' = (select plan ->> 'confirm' from public.t_tx where k = 'eps_plan'), 'what ran is exactly what the preview showed (same fingerprint)');
  perform public.t_ok(not exists (select 1 from public.user_tv_episodes e join public.t_eps_before b using (id) where e.watched_at is distinct from b.watched_at),
                      'every episode has its own old watched date back');
  perform public.t_ok((select count(*) from public.audit_logs where tx_id = txid_current() and operation = 'UPDATE' and table_name = 'user_tv_episodes') = 73,
                      'the undo is in the log itself (73 changes)');
  perform public.t_ok((select bool_and(new_data ?& array['watched_at'] and (select count(*) from jsonb_object_keys(new_data)) = 1)
                       from public.audit_logs where tx_id = txid_current()), 'and changed only watched_at');
  perform public.t_ok(jsonb_array_length(p -> 'result' -> 'reverted_rows') = 73, 'it answers with the rows it wrote');
  perform public.t_ok((p -> 'result' ->> 'undo_tx')::bigint = txid_current(), 'and with its own transaction (the way back)');
end $$;

-- ── 2. Undoing the same save again is a no-op ───────────────────────────────
do $$
declare p jsonb; n_logs bigint := (select count(*) from public.audit_logs);
begin
  p := public.app_undo_transaction(public.t_tx('eps'));
  perform public.t_ok((p ->> 'steps')::int = 0 and (p -> 'tables' -> 0 ->> 'already')::int = 73 and p -> 'conflicts' = '[]',
                      'a second undo of the same save: all 73 already as before, no steps, no conflicts');
  p := public.app_undo_transaction(public.t_tx('eps'), true);
  perform public.t_ok((p -> 'result' ->> 'reverted')::int = 0 and (select count(*) from public.audit_logs) = n_logs, 'applying it changes nothing (no-op, not an error)');
end $$;

-- ── 3. Undo of the undo ─────────────────────────────────────────────────────
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('eps_undo'), true);
  perform public.t_ok((p -> 'result' ->> 'reverted')::int = 73, 'the undo can be undone (73 rows)');
  perform public.t_ok((select count(*) from public.user_tv_episodes where watched_at = '2026-10-14 08:30+00') = 73, 'the save''s watched dates are back');
  -- and the original save can be undone again from here
  p := public.app_undo_transaction(public.t_tx('eps'), true);
  perform public.t_ok((p -> 'result' ->> 'reverted')::int = 73 and not exists (
    select 1 from public.user_tv_episodes e join public.t_eps_before b using (id) where e.watched_at is distinct from b.watched_at),
    'and the save undone once more');
end $$;

-- ── 4. A mixed save: insert + update + delete (with its slot) ───────────────
reset role;
insert into public.tasks (id, title, status, google_task_id, google_sync_enabled, due_date) values
  ('a0000000-0000-0000-0000-00000000000a', 'Keep me', 'open', null, false, null),
  ('b0000000-0000-0000-0000-00000000000b', 'Delete me', 'open', 'g-b', true, '2026-10-20');
insert into public.time_blocks (id, task_id, date, start_time, title, google_calendar_event_id) values
  ('b1000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', '2026-10-20', '09:00', 'Delete me', 'ev-b');
insert into public.task_tags values ('b0000000-0000-0000-0000-00000000000b', 'x');
truncate public.google_tasks_outbox;
set role authenticated;
do $$
begin
  insert into public.tasks (id, title, google_sync_enabled) values ('c0000000-0000-0000-0000-00000000000c', 'New one', false);
  insert into public.time_blocks (id, task_id, date, title) values ('c1000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000c', '2026-10-21', 'New one');
  update public.tasks set title = 'Kept, renamed', status = 'done' where id = 'a0000000-0000-0000-0000-00000000000a';
  delete from public.tasks where id = 'b0000000-0000-0000-0000-00000000000b';
  insert into public.t_tx values ('mixed', txid_current());
end $$;
do $$
declare p jsonb; tk jsonb; tb jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('mixed'), false, null, '{"tasks": {"google_task_id": null}}');
  select value into tk from jsonb_array_elements(p -> 'tables') where value ->> 't' = 'tasks';
  select value into tb from jsonb_array_elements(p -> 'tables') where value ->> 't' = 'time_blocks';
  perform public.t_ok((tk ->> 'revert')::int = 1 and (tk ->> 'delete')::int = 1 and (tk ->> 'reinsert')::int = 1, 'tasks: one to revert, one to delete, one to put back');
  perform public.t_ok((tb ->> 'delete')::int = 1 and (tb ->> 'reinsert')::int = 1, 'slots: the new one to delete, the deleted one to put back');
  perform public.t_ok(tk -> 'columns' = '["status", "title"]', 'the revert names the columns it puts back');
  perform public.t_ok(p -> 'not_logged' = '[{"t": "task_tags", "parent": "tasks"}]', 'a table outside the log that went with the deleted task is named: ' || (p ->> 'not_logged'));
  perform public.t_ok(p -> 'collateral' = '[]' and not (p ->> 'needs_confirm')::boolean, 'the new task''s slot goes with it as the save''s own row, not as collateral');
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('mixed'), true, null, '{"tasks": {"google_task_id": null}}');
  perform public.t_ok((p -> 'result' ->> 'reverted')::int = 1 and (p -> 'result' ->> 'deleted')::int = 2 and (p -> 'result' ->> 'reinserted')::int = 2,
                      'the undo reverted 1, deleted 2, put back 2: ' || (p ->> 'result'));
  perform public.t_ok(not exists (select 1 from public.tasks where id = 'c0000000-0000-0000-0000-00000000000c')
                      and not exists (select 1 from public.time_blocks where id = 'c1000000-0000-0000-0000-00000000000c'), 'the task the save made is gone with its slot');
  perform public.t_ok((select title = 'Keep me' and status = 'open' from public.tasks where id = 'a0000000-0000-0000-0000-00000000000a'), 'the updated task has its old title and status');
  perform public.t_ok((select title = 'Delete me' and due_date = '2026-10-20' and google_task_id is null and google_sync_enabled
                       from public.tasks where id = 'b0000000-0000-0000-0000-00000000000b'), 'the deleted task is back with the same id; the override cleared its old Google id');
  perform public.t_ok((select google_calendar_event_id = 'ev-b' and start_time = '09:00' from public.time_blocks where id = 'b1000000-0000-0000-0000-00000000000b'),
                      'its slot is back with the same id');
  perform public.t_ok((select operation from public.google_tasks_outbox where task_id = 'b0000000-0000-0000-0000-00000000000b' order by id desc limit 1) = 'create',
                      'the normal triggers ran: the outbox queued a new Google Task for it');
  perform public.t_ok(not exists (select 1 from public.task_tags), 'its tag (outside the log) did not come back, as the plan said');
  perform public.t_ok(exists (select 1 from jsonb_array_elements(p -> 'result' -> 'reinserted_rows') r where r -> 'row' ->> 'google_task_id' = 'g-b'),
                      'the answer carries the put-back rows as they were (for the browser''s Google follow-ups)');
  perform public.t_ok(exists (select 1 from jsonb_array_elements(p -> 'result' -> 'deleted_rows') g, jsonb_array_elements(g -> 'rows') r
                              where g ->> 'table' = 'time_blocks' and r ->> 'id' = 'c1000000-0000-0000-0000-00000000000c'), 'and the rows it deleted');
end $$;

-- ── 5. A cascade delete: a project with its items ───────────────────────────
reset role;
insert into public.projects (id, name) values ('f0000000-0000-0000-0000-00000000000f', 'House');
insert into public.project_items (id, project_id, title) values
  ('f1000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f', 'Draw'),
  ('f2000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f', 'Buy');
set role authenticated;
do $$
begin
  delete from public.projects where id = 'f0000000-0000-0000-0000-00000000000f';
  insert into public.t_tx values ('project', txid_current());
end $$;
do $$
declare p jsonb;
begin
  perform public.t_ok((select count(*) from public.audit_logs where tx_id = public.t_tx('project')) = 3, 'the cascade logged 3 deletes in one save');
  p := public.app_undo_transaction(public.t_tx('project'), true);
  perform public.t_ok((p -> 'result' ->> 'reinserted')::int = 3, 'the undo puts back the project and both items');
  perform public.t_ok((select count(*) from public.project_items where project_id = 'f0000000-0000-0000-0000-00000000000f') = 2
                      and exists (select 1 from public.projects where id = 'f0000000-0000-0000-0000-00000000000f' and name = 'House'), 'with the same ids, parents before children');
end $$;

-- ── 6. A later save changed the same row: refused, then confirmed ───────────
reset role;
insert into public.tasks (id, title, status) values
  ('d0000000-0000-0000-0000-00000000000d', 'One', 'open'),
  ('d1000000-0000-0000-0000-00000000000d', 'x', 'open');
set role authenticated;
do $$ begin
  update public.tasks set title = 'Two' where id = 'd0000000-0000-0000-0000-00000000000d';
  update public.tasks set title = 'y' where id = 'd1000000-0000-0000-0000-00000000000d';
  insert into public.t_tx values ('conflict', txid_current());
end $$;
do $$ begin
  update public.tasks set title = 'Three' where id = 'd0000000-0000-0000-0000-00000000000d';
  insert into public.t_tx values ('later', txid_current());
end $$;
do $$ begin
  update public.tasks set status = 'done' where id = 'd1000000-0000-0000-0000-00000000000d';
end $$;
do $$
declare p jsonb; c jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('conflict'));
  perform public.t_ok(jsonb_array_length(p -> 'conflicts') = 1 and (p ->> 'needs_confirm')::boolean, 'one conflict, and it needs confirming');
  c := p -> 'conflicts' -> 0;
  perform public.t_ok(c ->> 'id' = 'd0000000-0000-0000-0000-00000000000d' and c ->> 'reason' = 'changed_later' and c ->> 'action' = 'revert'
                      and c -> 'columns' = '["title"]' and c -> 'now' = '{"title": "Three"}' and c -> 'undo' = '{"title": "One"}' and c ->> 'label' = 'Three',
                      'the conflict says what is there now and what Undo would write: ' || c::text);
  perform public.t_ok(jsonb_array_length(c -> 'later') = 1 and (c -> 'later' -> 0 ->> 'tx')::bigint = public.t_tx('later')
                      and c -> 'later' -> 0 -> 'columns' = '["title"]' and c -> 'later' -> 0 ->> 'op' = 'UPDATE', 'with the later save, its time and what it changed');
  perform public.t_ok(jsonb_array_length(p -> 'kept') = 1 and p -> 'kept' -> 0 ->> 'id' = 'd1000000-0000-0000-0000-00000000000d',
                      'a later edit of another column is listed as kept, not as a conflict');
  insert into public.t_tx values ('conflict_plan', null, p);
  perform public.t_ok(public.t_refused(public.t_tx('conflict'), null) = 'UD001', 'applying without confirming is refused');
  perform public.t_ok(public.t_refused(public.t_tx('conflict'), 'not-the-token') = 'UD002', 'a token that does not match is refused');
  perform public.t_ok((select title from public.tasks where id = 'd0000000-0000-0000-0000-00000000000d') = 'Three', 'a refused undo changed nothing');
end $$;
-- the row changes again between the preview and the confirm: the old token no longer fits
do $$ begin update public.tasks set title = 'Four' where id = 'd0000000-0000-0000-0000-00000000000d'; end $$;
do $$
declare p jsonb;
begin
  perform public.t_ok(public.t_refused(public.t_tx('conflict'), (select plan ->> 'confirm' from public.t_tx where k = 'conflict_plan')) = 'UD002',
                      'a confirm from before the row changed again is refused (look again)');
  p := public.app_undo_transaction(public.t_tx('conflict'));
  p := public.app_undo_transaction(public.t_tx('conflict'), true, p ->> 'confirm');
  perform public.t_ok((p -> 'result' ->> 'reverted')::int = 2, 'confirmed with the fresh token, the undo runs');
  perform public.t_ok((select title from public.tasks where id = 'd0000000-0000-0000-0000-00000000000d') = 'One', 'the conflicting row has its old title (the later one was overwritten, as confirmed)');
  perform public.t_ok((select title = 'x' and status = 'done' from public.tasks where id = 'd1000000-0000-0000-0000-00000000000d'), 'the other row: old title back, the later status kept');
end $$;

-- ── 7. A row the save made got more attached later: collateral ──────────────
do $$ begin
  insert into public.tasks (id, title) values ('e1000000-0000-0000-0000-00000000000e', 'Made by the save');
  insert into public.t_tx values ('made', txid_current());
end $$;
do $$ begin
  insert into public.time_blocks (id, task_id, date, title) values ('e2000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-00000000000e', '2026-10-22', 'Added later');
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('made'));
  perform public.t_ok(p -> 'conflicts' = '[]' and p -> 'collateral' = '[{"t": "time_blocks", "id": "e2000000-0000-0000-0000-00000000000e", "how": "deleted", "label": "Added later"}]',
                      'deleting what the save made would take a later slot with it: listed as collateral ' || (p ->> 'collateral'));
  perform public.t_ok((p ->> 'needs_confirm')::boolean and exists (select 1 from public.time_blocks where id = 'e2000000-0000-0000-0000-00000000000e'),
                      'it needs confirming, and the preview deleted nothing');
  perform public.t_ok(public.t_refused(public.t_tx('made'), null) = 'UD001', 'unconfirmed, it is refused');
  p := public.app_undo_transaction(public.t_tx('made'), true, p ->> 'confirm');
  perform public.t_ok(not exists (select 1 from public.tasks where id = 'e1000000-0000-0000-0000-00000000000e')
                      and not exists (select 1 from public.time_blocks where id = 'e2000000-0000-0000-0000-00000000000e'), 'confirmed: the task and the later slot are gone');
end $$;

-- ── 8. Columns that can't take a value back ─────────────────────────────────
reset role;
insert into public.food_log_entries (id, calories) values ('a6000000-0000-0000-0000-000000000001', 100);
insert into public.wish_items (id, title, note) values ('a7000000-0000-0000-0000-000000000001', 'T', 'a');
set role authenticated;
do $$ begin
  update public.food_log_entries set calories = 200 where id = 'a6000000-0000-0000-0000-000000000001';
  update public.wish_items set title = 'U', note = 'b' where id = 'a7000000-0000-0000-0000-000000000001';
  insert into public.t_tx values ('cols', txid_current());
end $$;
reset role;
alter table public.wish_items drop column note;
set role authenticated;
do $$
declare p jsonb; f jsonb; w jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('cols'));
  select value into f from jsonb_array_elements(p -> 'tables') where value ->> 't' = 'food_log_entries';
  select value into w from jsonb_array_elements(p -> 'tables') where value ->> 't' = 'wish_items';
  perform public.t_ok(f -> 'skipped_columns' = '{"kcal_x2": "generated"}' and f -> 'columns' = '["calories"]', 'a generated column is named, its source column put back');
  perform public.t_ok(w -> 'skipped_columns' = '{"note": "dropped"}' and w -> 'columns' = '["title"]', 'a column dropped since is named, never skipped in silence');
  p := public.app_undo_transaction(public.t_tx('cols'), true);
  perform public.t_ok((select calories = 100 and kcal_x2 = 200 from public.food_log_entries), 'calories back; the generated column follows');
  perform public.t_ok((select title from public.wish_items) = 'T', 'the wish has its old title');
end $$;

-- ── 9. Changes it can't see or address are blocked, not passed over ─────────
do $$ begin
  insert into public.pairs (a, b) values ('k', 'v');
  insert into public.legacy_notes (body) values ('old style');
  insert into public.slots (id, slot, label) values ('a8000000-0000-0000-0000-000000000001', 9, 'nine');
  insert into public.projects (id, name) values ('a8100000-0000-0000-0000-000000000001', 'Locked away');
  insert into public.t_tx values ('blocked', txid_current());
end $$;
reset role;
-- a table the caller may no longer read
revoke select on public.projects from authenticated;
-- a change of the same save written for no account (a service write to a table without user_id)
insert into public.audit_logs (user_id, table_name, operation, row_id, old_data, new_data, actor, tx_id)
values (null, 'slots', 'INSERT', 'a8000000-0000-0000-0000-0000000000ff', null, '{"slot": 10}', 'service', (select tx from public.t_tx where k = 'blocked'));
set role authenticated;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('blocked'));
  perform public.t_ok((p ->> 'hidden')::int = 1 and p -> 'blocked' @> '[{"reason": "hidden", "count": 1}]', 'a change the caller''s log does not show is counted and blocked');
  perform public.t_ok(p -> 'blocked' @> '[{"t": "pairs", "reason": "no_key"}]' and p -> 'blocked' @> '[{"t": "legacy_notes", "reason": "no_key"}]',
                      'rows without a single id key are blocked: ' || (p ->> 'blocked'));
  perform public.t_ok(p -> 'blocked' @> '[{"t": "projects", "reason": "no_access", "count": 1}]', 'a table the caller may not read is blocked, not passed over');
  perform public.t_ok((p ->> 'needs_confirm')::boolean and (p ->> 'steps')::int = 1, 'the rest (the slot) can still be undone, once confirmed');
  perform public.t_ok(public.t_refused(public.t_tx('blocked'), null) = 'UD001', 'unconfirmed, it is refused');
  p := public.app_undo_transaction(public.t_tx('blocked'), true, p ->> 'confirm');
  perform public.t_ok(not exists (select 1 from public.slots where slot = 9) and exists (select 1 from public.pairs), 'confirmed: the slot is gone, the blocked rows stay');
end $$;
reset role;
grant select on public.projects to authenticated;
select public.t_ok(exists (select 1 from public.projects where name = 'Locked away'), 'the unreadable table''s row stays');
set role authenticated;

-- ── 10. The trial run finds what can't work: a parent deleted since ─────────
reset role;
insert into public.tasks (id, title) values ('a9000000-0000-0000-0000-000000000001', 'Parent');
insert into public.time_blocks (id, task_id, date, title) values ('a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', '2026-10-23', 'Slot');
set role authenticated;
do $$ begin
  delete from public.time_blocks where id = 'a9100000-0000-0000-0000-000000000001';
  insert into public.t_tx values ('orphan', txid_current());
end $$;
do $$ begin delete from public.tasks where id = 'a9000000-0000-0000-0000-000000000001'; end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('orphan'));
  perform public.t_ok(not (p ->> 'can_apply')::boolean and p -> 'error' ->> 'code' = '23503', 'the preview says it can''t run, and why: ' || (p -> 'error' ->> 'message'));
  perform public.t_ok(public.t_refused(public.t_tx('orphan'), p ->> 'confirm') = '23503', 'an apply fails as a whole');
end $$;

-- ── 11. Order inside a save: a freed slot filled again; a row changed twice ─
reset role;
insert into public.slots (id, slot, label) values ('aa000000-0000-0000-0000-000000000001', 1, 'first'), ('ab000000-0000-0000-0000-000000000001', 2, 'moved');
set role authenticated;
do $$ begin
  delete from public.slots where id = 'aa000000-0000-0000-0000-000000000001';
  insert into public.slots (id, slot, label) values ('ac000000-0000-0000-0000-000000000001', 1, 'replacement');
  update public.slots set slot = 3 where id = 'ab000000-0000-0000-0000-000000000001';
  update public.slots set slot = 4, label = 'moved twice' where id = 'ab000000-0000-0000-0000-000000000001';
  insert into public.tasks (id, title) values ('ad000000-0000-0000-0000-000000000001', 'made');
  update public.tasks set title = 'made, then renamed' where id = 'ad000000-0000-0000-0000-000000000001';
  insert into public.t_tx values ('order', txid_current());
end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('order'), true);
  perform public.t_ok((p -> 'result' ->> 'deleted')::int = 2 and (p -> 'result' ->> 'reinserted')::int = 1 and (p -> 'result' ->> 'reverted')::int = 1,
                      'replacement and the made task deleted, the first slot back, the moved one reverted: ' || (p ->> 'result'));
  perform public.t_ok((select label from public.slots where slot = 1) = 'first', 'the unique slot went back to its first row (the replacement left first)');
  perform public.t_ok((select slot = 2 and label = 'moved' from public.slots where id = 'ab000000-0000-0000-0000-000000000001'), 'a row changed twice gets its value from before the save');
  perform public.t_ok(not exists (select 1 from public.tasks where id = 'ad000000-0000-0000-0000-000000000001'), 'a row made and then changed in the save is deleted');
end $$;

-- ── 12. Deleted since / back again ──────────────────────────────────────────
do $$ begin
  update public.tasks set title = 'Renamed' where id = 'a0000000-0000-0000-0000-00000000000a';
  insert into public.t_tx values ('renamed', txid_current());
end $$;
do $$ begin delete from public.tasks where id = 'a0000000-0000-0000-0000-00000000000a'; end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('renamed'));
  perform public.t_ok(p -> 'conflicts' -> 0 ->> 'reason' = 'deleted_later' and p -> 'conflicts' -> 0 ->> 'action' = 'skip' and (p ->> 'steps')::int = 0,
                      'a row deleted since can''t take its old values back: a conflict, skipped');
  p := public.app_undo_transaction(public.t_tx('renamed'), true, p ->> 'confirm');
  perform public.t_ok(not exists (select 1 from public.tasks where id = 'a0000000-0000-0000-0000-00000000000a'), 'confirmed, it stays deleted');
end $$;
-- deleted through the one delete flow, then put back by its own Undo toast
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('tasks', array['b0000000-0000-0000-0000-00000000000b']);
  insert into public.t_tx values ('flow_delete', txid_current(), s);
end $$;
do $$ begin perform public.app_restore_rows((select plan from public.t_tx where k = 'flow_delete'), '{"tasks": {"google_task_id": null}}'); end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('flow_delete'), false, null, '{"tasks": {"google_task_id": null}}');
  perform public.t_ok((p ->> 'steps')::int = 0 and p -> 'conflicts' = '[]', 'a delete already undone by its toast: nothing left to do');
end $$;
do $$ begin update public.tasks set title = 'Edited after' where id = 'b0000000-0000-0000-0000-00000000000b'; end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('flow_delete'), false, null, '{"tasks": {"google_task_id": null}}');
  perform public.t_ok(p -> 'conflicts' -> 0 ->> 'reason' = 'exists_again' and p -> 'conflicts' -> 0 ->> 'action' = 'overwrite'
                      and p -> 'conflicts' -> 0 -> 'columns' = '["title"]', 'back and edited since: overwriting it is a conflict (the Google ids it was given are left alone)');
end $$;

-- ── 13. Many rows made by one save: deleted in one call ──────────────────────
do $$ begin
  insert into public.tasks (title) select 'Imported ' || g from generate_series(1, 30) g;
  insert into public.t_tx values ('import', txid_current());
end $$;
do $$ begin delete from public.tasks where title = 'Imported 7'; end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('import'));
  perform public.t_ok((p -> 'tables' -> 0 ->> 'delete')::int = 29 and (p -> 'tables' -> 0 ->> 'already')::int = 1 and (p ->> 'can_apply')::boolean,
                      '30 rows made, one deleted since: 29 to delete, 1 already gone');
  p := public.app_undo_transaction(public.t_tx('import'), true, p ->> 'confirm');
  perform public.t_ok((p -> 'result' ->> 'deleted')::int = 29 and not exists (select 1 from public.tasks where title like 'Imported %'), 'all 29 deleted');
end $$;

-- ── 14. A row row level security won't let it write back ────────────────────
reset role;
insert into public.locked_notes (id, body) values ('a9900000-0000-0000-0000-000000000001', 'before');
do $$ begin
  update public.locked_notes set body = 'after';
  insert into public.t_tx values ('locked', txid_current());
end $$;
set role authenticated;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('locked'));
  perform public.t_ok(not (p ->> 'can_apply')::boolean and p -> 'error' ->> 'code' = 'UD004', 'a row it may not write back: the trial run says so, Undo can''t run');
  perform public.t_ok(public.t_refused(public.t_tx('locked'), p ->> 'confirm') = 'UD004', 'and an apply is refused as a whole');
  perform public.t_ok((select body from public.locked_notes) = 'after', 'nothing changed');
end $$;

-- ── 15. A rule changes a row again after Undo: drift, never "as before" ──────
reset role;
insert into public.guarded (id, value) values ('ae000000-0000-0000-0000-000000000001', 1);
set role authenticated;
do $$ begin
  update public.guarded set value = 2;
  insert into public.t_tx values ('guarded', txid_current());
end $$;
do $$ begin update public.guarded set locked = true; end $$;
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction(public.t_tx('guarded'));
  perform public.t_ok(p -> 'drift' = '[{"t": "guarded", "id": "ae000000-0000-0000-0000-000000000001", "how": "changed", "columns": ["value"], "label": null}]',
                      'the trial run sees the rule keep the value: named as drift ' || (p ->> 'drift'));
  perform public.t_ok((p ->> 'needs_confirm')::boolean and p -> 'conflicts' = '[]', 'it needs confirming (not a conflict: nothing later is overwritten)');
  perform public.t_ok(public.t_refused(public.t_tx('guarded'), null) = 'UD001', 'unconfirmed, it is refused');
  p := public.app_undo_transaction(public.t_tx('guarded'), true, p ->> 'confirm');
  perform public.t_ok(jsonb_array_length(p -> 'drift') = 1 and (select value from public.guarded) = 2, 'confirmed: it ran, and says the rule kept the value');
end $$;

-- ── 16. Another account's save is not there to undo ─────────────────────────
reset role;
set test.uid = '00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$ begin
  insert into public.tasks (title) values ('Theirs');
  insert into public.t_tx values ('theirs', txid_current());
end $$;
reset role;
reset test.uid;
set role authenticated;
do $$
declare v_state text;
begin
  begin
    perform public.app_undo_transaction(public.t_tx('theirs'));
    v_state := null;
  exception when others then v_state := sqlstate;
  end;
  perform public.t_ok(v_state = 'UD003', 'another account''s save is not in your log: refused');
  perform public.t_ok(public.app_undo_hidden_changes(public.t_tx('theirs')) = 0, 'and the hidden-change count says nothing about it');
end $$;
reset role;
select public.t_ok((select count(*) from public.tasks where title = 'Theirs') = 1, 'their task is untouched');
