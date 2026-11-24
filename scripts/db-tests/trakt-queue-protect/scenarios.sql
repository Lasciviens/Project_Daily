-- Migration 207 (trakt_queue_lists: the Queue's mark, never deleted). Setup runs as the superuser, the function's writes as
-- `service_role`, the app's as `authenticated`. test.uid picks the account: 1 = the owner, 2 = a second allowed account,
-- 3 = signed in but not let in.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate; end $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text) to anon, authenticated, service_role;

-- 1 · what 207 made
select public.t_ok((select relrowsecurity from pg_class where oid = 'public.trakt_queue_lists'::regclass), '207: row level security is on');
select public.t_ok((select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'trakt_queue_lists' and policyname = 'app_owner_lock'), '207: the owner lock is on the table');
select public.t_ok((select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'trakt_queue_lists'), '207: no browser policy (the owner lock only)');
select public.t_ok(not has_table_privilege('anon', 'public.trakt_queue_lists', 'select') and not has_table_privilege('anon', 'public.trakt_queue_lists', 'delete'), '207: a signed-out caller has no right on it');
select public.t_ok(not has_table_privilege('authenticated', 'public.trakt_queue_lists', 'select') and not has_table_privilege('authenticated', 'public.trakt_queue_lists', 'insert')
  and not has_table_privilege('authenticated', 'public.trakt_queue_lists', 'update') and not has_table_privilege('authenticated', 'public.trakt_queue_lists', 'delete'), '207: the browser (and the assistant''s read, which runs with its rights) has no right on it');
select public.t_ok(has_table_privilege('service_role', 'public.trakt_queue_lists', 'select') and has_table_privilege('service_role', 'public.trakt_queue_lists', 'insert'), '207: the function reads and marks');
select public.t_ok((select count(*) = 0 from pg_trigger where tgrelid = 'public.trakt_queue_lists'::regclass and tgname = 'trg_audit'), '207: not audited (Activity''s Undo can never delete a mark)');
select public.t_ok(not has_function_privilege('authenticated', 'public.trakt_queue_lists_guard()', 'execute'), '207: the guard is no RPC of the browser');

-- 2 · the function marks the Queue
select set_config('test.uid', 'none', false);
set role service_role;
insert into public.trakt_queue_lists (user_id, trakt_list_id) values ('00000000-0000-0000-0000-000000000001', 4242);
insert into public.trakt_queue_lists (user_id, trakt_list_id) values ('00000000-0000-0000-0000-000000000001', 4242) on conflict do nothing;
select public.t_ok((select count(*) = 1 from public.trakt_queue_lists where user_id = '00000000-0000-0000-0000-000000000001'), '207: the function marks a Queue once (a second mark of the same id changes nothing)');
select public.t_ok(public.t_err($q$insert into public.trakt_queue_lists (user_id, trakt_list_id) values ('00000000-0000-0000-0000-000000000001', 0)$q$) = '23514', '207: a list id of 0 is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.trakt_queue_lists (user_id, trakt_list_id) values ('00000000-0000-0000-0000-000000000001', -5)$q$) = '23514', '207: a negative list id is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.trakt_queue_lists (user_id, trakt_list_id) values ('00000000-0000-0000-0000-000000000001', 'queue')$q$) = '22P02', '207: a slug or a name is not a list id (22P02)');

-- 3 · nobody deletes or changes a mark: the function's own role…
select public.t_ok(public.t_err($q$delete from public.trakt_queue_lists where trakt_list_id = 4242$q$) = '42501', '207: the function cannot delete the mark (42501)');
select public.t_ok(public.t_err($q$update public.trakt_queue_lists set trakt_list_id = 9999 where trakt_list_id = 4242$q$) = '42501', '207: …nor point it at another list (42501)');
select public.t_ok(public.t_err($q$update public.trakt_queue_lists set user_id = '00000000-0000-0000-0000-000000000002' where trakt_list_id = 4242$q$) = '42501', '207: …nor move it to another account (42501)');
select public.t_ok(public.t_err($q$update public.trakt_queue_lists set created_at = now() where trakt_list_id = 4242$q$) = '42501', '207: …nor touch any column (42501)');
reset role;

-- …the browser and the assistant (as the owner, the account the lock lets in, and one it keeps out)…
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok(public.t_err($q$delete from public.trakt_queue_lists$q$) = '42501', '207: the owner''s browser cannot delete it (42501)');
select public.t_ok(public.t_err($q$select * from public.trakt_queue_lists$q$) = '42501', '207: …nor read it (42501)');
select public.t_ok(public.t_err($q$insert into public.trakt_queue_lists (trakt_list_id) values (77)$q$) = '42501', '207: …nor mark another list (42501)');
select public.t_ok(public.t_err($q$update public.trakt_queue_lists set trakt_list_id = 1$q$) = '42501', '207: …nor change it (42501)');
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok(public.t_err($q$delete from public.trakt_queue_lists$q$) = '42501', '207: an account the owner lock keeps out deletes nothing (42501)');
reset role;
set role anon;
select public.t_ok(public.t_err($q$delete from public.trakt_queue_lists$q$) = '42501', '207: a signed-out caller deletes nothing (42501)');
reset role;

-- …and not the SQL editor's owner role either, row by row or all at once.
select public.t_ok(public.t_err($q$delete from public.trakt_queue_lists where trakt_list_id = 4242$q$) = '42501', '207: the database owner''s delete is refused too (42501)');
select public.t_ok(public.t_err($q$truncate public.trakt_queue_lists$q$) = '42501', '207: a truncate is refused (42501)');
select public.t_ok(public.t_err($q$truncate public.trakt_queue_lists cascade$q$) = '42501', '207: a truncate cascade is refused (42501)');
select public.t_ok(public.t_err($q$update public.trakt_queue_lists set trakt_list_id = 1$q$) = '42501', '207: the database owner''s update is refused too (42501)');
select public.t_ok((select count(*) = 1 from public.trakt_queue_lists where trakt_list_id = 4242), '207: after every attempt the mark is still there');

-- 4 · a second Queue mark (a new Queue after the old one went on Trakt): both stay protected
set role service_role;
insert into public.trakt_queue_lists (user_id, trakt_list_id) values ('00000000-0000-0000-0000-000000000001', 5151);
select public.t_ok(public.t_err($q$delete from public.trakt_queue_lists where trakt_list_id in (4242, 5151)$q$) = '42501', '207: every mark ever made stays (42501)');
reset role;

-- 5 · deleting the account still works: the cascade takes its marks, and only its marks
insert into public.trakt_queue_lists (user_id, trakt_list_id) values ('00000000-0000-0000-0000-000000000002', 6161);
select public.t_ok(public.t_err($q$delete from auth.users where id = '00000000-0000-0000-0000-000000000002'$q$) is null, '207: deleting an account with a Queue mark works (the cascade passes the guard)');
select public.t_ok((select count(*) = 0 from public.trakt_queue_lists where user_id = '00000000-0000-0000-0000-000000000002'), '207: …and takes that account''s mark with it');
select public.t_ok((select count(*) = 2 from public.trakt_queue_lists where user_id = '00000000-0000-0000-0000-000000000001'), '207: …and no other account''s');
select public.t_ok(public.t_err($q$delete from public.trakt_queue_lists where user_id = '00000000-0000-0000-0000-000000000001'$q$) = '42501', '207: a direct delete still refuses while the account exists (42501)');
