-- Scenarios for migration 145 (Google Tasks pull fixes).
-- Each `ok` raises on a mismatch; the runner fails on the first one.
create or replace function ok(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;
grant execute on function ok(text, text, text) to anon, authenticated, service_role;

-- The cron path: the service role names the user.
select set_config('test.role', 'service_role', false), set_config('test.uid', '', false);

-- G1 Google may hold two lists of one name (any case): both are mirrored.
insert into google_task_lists (user_id, google_id, title) values
  ('00000000-0000-4000-8000-0000000000a1', 'gl-work-1', 'Work'),
  ('00000000-0000-4000-8000-0000000000a1', 'gl-work-2', 'Work'),
  ('00000000-0000-4000-8000-0000000000a1', 'gl-work-3', 'work');
select ok('G1 three lists named Work/work are all mirrored',
  (select count(*)::text from google_task_lists where lower(title) = 'work'), '3');
select ok('G1 the unique title index is gone',
  (select count(*)::text from pg_indexes where indexname = 'google_task_lists_user_lower_title'), '0');

-- G2 one upsert function, no overload left for PostgREST to trip over.
select ok('G2 exactly one upsert_task_from_google',
  (select count(*)::text from pg_proc where proname = 'upsert_task_from_google'), '1');
select ok('G2 it takes p_google_links last',
  (select (proargnames)[16] from pg_proc where proname = 'upsert_task_from_google'), 'p_google_links');
select ok('G2 the sync state has last_full_sync_at',
  (select count(*)::text from information_schema.columns where table_name = 'google_tasks_sync_state' and column_name = 'last_full_sync_at'), '1');

-- G3 a new Google task is imported for that user, with its links.
select ok('G3 import returns an id', (select (upsert_task_from_google(
  p_google_task_id => 'g-email', p_title => 'Reply to Ola', p_notes => 'about the invoice', p_due_date => '2026-10-20',
  p_status => 'needsAction', p_google_updated_at => '2026-10-13T08:00:00Z',
  p_google_tasklist_id => '00000000-0000-4000-8000-00000000c001',
  p_google_web_view_link => 'https://tasks.google.com/task/g-email',
  p_user_id => '00000000-0000-4000-8000-0000000000a1',
  p_google_links => '[{"type":"email","description":"Invoice","link":"https://mail.google.com/mail/#all/abc"}]'
)) is not null)::text, 'true');
select ok('G3 owner, section, sync flag',
  (select user_id || ' ' || section || ' ' || google_sync_enabled from tasks where google_task_id = 'g-email'),
  '00000000-0000-4000-8000-0000000000a1 inbox true');
select ok('G3 the email link is kept', (select google_links -> 0 ->> 'type' from tasks where google_task_id = 'g-email'), 'email');
select ok('G3 the import queued nothing back to Google', (select count(*)::text from google_tasks_outbox), '0');

-- G4 a task without a title comes in with an empty one (tasks.title is NOT NULL).
select upsert_task_from_google('g-blank', null, null, null, 'needsAction', '2026-10-13T08:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('G4 a title-less Google task is imported', (select title from tasks where google_task_id = 'g-blank'), '');

-- G5 links that aren't a list are ignored, never stored.
select upsert_task_from_google('g-blank', '', null, null, 'needsAction', '2026-10-13T08:01:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1', p_google_links => '{"oops":1}');
select ok('G5 a non-array links value is not stored', (select coalesce(google_links::text, 'null') from tasks where google_task_id = 'g-blank'), 'null');

-- G6 new deleted/hidden tasks need no local row.
select ok('G6 an unknown tombstone is skipped', (select coalesce(upsert_task_from_google('g-gone', 'x', null, null, 'needsAction',
  '2026-10-13T08:00:00Z', p_google_deleted => true, p_user_id => '00000000-0000-4000-8000-0000000000a1')::text, 'null')), 'null');
select ok('G6 an unknown hidden (completed in Google''s app) task is skipped', (select coalesce(upsert_task_from_google('g-hidden', 'x', null, null, 'completed',
  '2026-10-13T08:00:00Z', p_google_hidden => true, p_user_id => '00000000-0000-4000-8000-0000000000a1')::text, 'null')), 'null');

-- G7 the service role must name the user.
do $$
begin
  perform upsert_task_from_google('g-nobody', 'x', null, null, 'needsAction', '2026-10-13T08:00:00Z');
  raise exception 'FAIL G7 an upsert without a user did not fail';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok  G7 an upsert without a user fails loudly (%)', sqlerrm;
end $$;

-- G8 completed on Google -> done with Google's time; reopened -> open.
select upsert_task_from_google('g-email', 'Reply to Ola', 'about the invoice', '2026-10-20', 'completed', '2026-10-13T09:00:00Z',
  p_completed_at => '2026-10-13T08:59:00Z', p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('G8 completed -> done', (select status from tasks where google_task_id = 'g-email'), 'done');
select ok('G8 with Google''s completion time', (select completed_at = '2026-10-13T08:59:00Z' from tasks where google_task_id = 'g-email')::text, 'true');
select ok('G8 links survive a pull that sends none', (select google_links -> 0 ->> 'type' from tasks where google_task_id = 'g-email'), 'email');
-- G8b done here at 23:50, our push reached Google at 00:10: the pull keeps 23:50.
select set_config('app.google_sync_write', 'true', false);
update tasks set completed_at = '2026-10-12T21:50:00Z' where google_task_id = 'g-email';
select set_config('app.google_sync_write', '', false);
select upsert_task_from_google('g-email', 'Reply to Ola', 'about the invoice', '2026-10-20', 'completed', '2026-10-13T09:30:00Z',
  p_completed_at => '2026-10-12T22:10:00Z', p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('G8b a task done here keeps its own close time', (select completed_at = '2026-10-12T21:50:00Z' from tasks where google_task_id = 'g-email')::text, 'true');

-- G9 deleted on Google -> cancelled, and a re-read tombstone of that completed
--    task keeps it cancelled (it used to flip to done on the next full pull).
select upsert_task_from_google('g-email', 'Reply to Ola', null, null, 'completed', '2026-10-13T10:00:00Z',
  p_completed_at => '2026-10-13T08:59:00Z', p_google_deleted => true, p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('G9 deleted on Google -> cancelled', (select status || ' ' || google_deleted from tasks where google_task_id = 'g-email'), 'cancelled true');
select upsert_task_from_google('g-email', 'Reply to Ola', null, null, 'completed', '2026-10-13T10:00:00Z',
  p_completed_at => '2026-10-13T08:59:00Z', p_google_deleted => true, p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('G9 the same tombstone read again stays cancelled', (select status from tasks where google_task_id = 'g-email'), 'cancelled');

-- G10 Google brings it back (deleted false again) -> open again.
select upsert_task_from_google('g-email', 'Reply to Ola', null, null, 'needsAction', '2026-10-13T11:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('G10 restored on Google -> open', (select status || ' ' || google_deleted from tasks where google_task_id = 'g-email'), 'open false');
select ok('G10 and no longer closed', (select coalesce(completed_at::text, 'null') from tasks where google_task_id = 'g-email'), 'null');

-- G11 a task cancelled in the app (not by Google) stays cancelled.
select set_config('app.google_sync_write', 'true', false);
update tasks set status = 'cancelled' where google_task_id = 'g-blank';
select set_config('app.google_sync_write', '', false);
select upsert_task_from_google('g-blank', 'Now named', null, null, 'needsAction', '2026-10-13T11:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('G11 a local cancel is not undone by a pull', (select status from tasks where google_task_id = 'g-blank'), 'cancelled');

-- G12 a pending outbox row protects the local edit AND the opt-out.
select set_config('app.google_sync_write', 'true', false);
update tasks set title = 'Local title', google_sync_enabled = false where google_task_id = 'g-email';
select set_config('app.google_sync_write', '', false);
insert into google_tasks_outbox (user_id, task_id, operation, payload)
  select user_id, id, 'delete', jsonb_build_object('google_task_id', google_task_id) from tasks where google_task_id = 'g-email';
select upsert_task_from_google('g-email', 'Google title', null, null, 'needsAction', '2026-10-13T12:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
select ok('G12 pending row: the local title stays', (select title from tasks where google_task_id = 'g-email'), 'Local title');
select ok('G12 pending opt-out: the pull does not switch sync back on', (select google_sync_enabled::text from tasks where google_task_id = 'g-email'), 'false');
select ok('G12 Google''s metadata still lands', (select google_updated_at = '2026-10-13T12:00:00Z' from tasks where google_task_id = 'g-email')::text, 'true');

-- G13 set_task_parent_from_google: pending row -> untouched; otherwise set; a no-op writes nothing.
select set_task_parent_from_google((select id from tasks where google_task_id = 'g-email'),
  (select id from tasks where google_task_id = 'g-blank'), '00000000-0000-4000-8000-0000000000a1');
select ok('G13 a task with a pending row keeps its parent', (select coalesce(parent_task_id::text, 'null') from tasks where google_task_id = 'g-email'), 'null');
delete from google_tasks_outbox;
select set_task_parent_from_google((select id from tasks where google_task_id = 'g-email'),
  (select id from tasks where google_task_id = 'g-blank'), '00000000-0000-4000-8000-0000000000a1');
select ok('G13 without one the parent is set',
  (select (parent_task_id = (select id from tasks where google_task_id = 'g-blank'))::text from tasks where google_task_id = 'g-email'), 'true');
select ok('G13 and nothing was queued', (select count(*)::text from google_tasks_outbox), '0');

-- G14 a signed-in caller writes only as itself: p_user_id is ignored.
select set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-4000-8000-0000000000b2', false);
set role authenticated;
select upsert_task_from_google('g-other', 'Mine', null, null, 'needsAction', '2026-10-13T08:00:00Z',
  p_user_id => '00000000-0000-4000-8000-0000000000a1');
reset role;
select ok('G14 a browser call lands on the caller, not the named user',
  (select user_id::text from tasks where google_task_id = 'g-other'), '00000000-0000-4000-8000-0000000000b2');

-- G15 grants: signed-out callers can't run either function.
select ok('G15 anon cannot upsert', has_function_privilege('anon', 'public.upsert_task_from_google(text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb)', 'execute')::text, 'false');
select ok('G15 authenticated can upsert', has_function_privilege('authenticated', 'public.upsert_task_from_google(text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb)', 'execute')::text, 'true');
select ok('G15 service_role can upsert', has_function_privilege('service_role', 'public.upsert_task_from_google(text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid, jsonb)', 'execute')::text, 'true');
select ok('G15 anon cannot set a parent', has_function_privilege('anon', 'public.set_task_parent_from_google(uuid, uuid, uuid)', 'execute')::text, 'false');
select ok('G15 service_role can set a parent', has_function_privilege('service_role', 'public.set_task_parent_from_google(uuid, uuid, uuid)', 'execute')::text, 'true');
