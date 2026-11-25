-- Migration 209 (icloud_invite_test_actions: the invite test's daily cap). Setup runs as the superuser, the function's
-- calls as `service_role`, the app's as `authenticated`. test.uid picks the account: 1 = the owner, 2 = a second allowed
-- account, 3 = signed in but not let in.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate; end $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text) to anon, authenticated, service_role;

-- 1 · what 209 made
select public.t_ok((select relrowsecurity from pg_class where oid = 'public.icloud_invite_test_actions'::regclass), '209: row level security is on');
select public.t_ok((select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'icloud_invite_test_actions' and policyname = 'app_owner_lock'), '209: the owner lock is on the table');
select public.t_ok((select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'icloud_invite_test_actions'), '209: no browser policy (the owner lock only)');
select public.t_ok(not has_table_privilege('anon', 'public.icloud_invite_test_actions', 'select') and not has_table_privilege('anon', 'public.icloud_invite_test_actions', 'insert')
  and not has_table_privilege('anon', 'public.icloud_invite_test_actions', 'delete'), '209: a signed-out caller has no right on it');
select public.t_ok(not has_table_privilege('authenticated', 'public.icloud_invite_test_actions', 'select') and not has_table_privilege('authenticated', 'public.icloud_invite_test_actions', 'insert')
  and not has_table_privilege('authenticated', 'public.icloud_invite_test_actions', 'update') and not has_table_privilege('authenticated', 'public.icloud_invite_test_actions', 'delete'),
  '209: the browser (and the assistant''s read, which runs with its rights) has no right on it');
select public.t_ok(has_table_privilege('service_role', 'public.icloud_invite_test_actions', 'select') and has_table_privilege('service_role', 'public.icloud_invite_test_actions', 'insert'), '209: the function reads and counts');
select public.t_ok(not has_function_privilege('authenticated', 'public.icloud_invite_test_reserve(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.icloud_invite_test_reserve(uuid, text)', 'execute'), '209: reserve is no RPC of the browser');
select public.t_ok(not has_function_privilege('authenticated', 'public.icloud_invite_test_used(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.icloud_invite_test_used(uuid)', 'execute'), '209: …nor the count');
select public.t_ok(has_function_privilege('service_role', 'public.icloud_invite_test_reserve(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.icloud_invite_test_used(uuid)', 'execute'), '209: the function calls both');
select public.t_ok((select count(*) = 0 from pg_trigger where tgrelid = 'public.icloud_invite_test_actions'::regclass and tgname = 'trg_audit'), '209: not audited (Activity''s Undo can never reset the cap)');
select public.t_ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.icloud_invite_test_reserve(uuid, text)'::regprocedure), '209: reserve is SECURITY INVOKER with an empty search_path');

-- 2 · five a day, then refused
select set_config('test.uid', 'none', false);
set role service_role;
select public.t_ok(public.icloud_invite_test_used('00000000-0000-0000-0000-000000000001') = 0, '209: nothing used yet');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'send') = 1, '209: a send is the 1st today');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'rewrite') = 2, '209: a rewrite counts too (2nd)');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'remove') = 3, '209: a guest removed counts too (3rd)');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'send') = 4, '209: 4th');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'rewrite') = 5, '209: 5th');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'send') is null, '209: the 6th today is refused (null)');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'remove') is null, '209: …whatever the action');
select public.t_ok(public.icloud_invite_test_used('00000000-0000-0000-0000-000000000001') = 5, '209: the count says 5, a refusal adds no row');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000002', 'send') = 1, '209: another account has its own 5');
select public.t_ok(public.t_err($q$select public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'delete')$q$) = '22023', '209: delete is not a counted action (22023)');
select public.t_ok(public.t_err($q$select public.icloud_invite_test_reserve(null, 'send')$q$) = '22023', '209: no account is refused (22023)');
select public.t_ok(public.t_err($q$select public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', null)$q$) = '22023', '209: no action is refused (22023)');
select public.t_ok(public.t_err($q$insert into public.icloud_invite_test_actions (user_id, action) values ('00000000-0000-0000-0000-000000000001', 'mail')$q$) = '23514', '209: an action outside the list is refused by the table (23514)');
reset role;

-- 3 · yesterday's (Oslo) don't count; today's started at Oslo's midnight
delete from public.icloud_invite_test_actions where user_id = '00000000-0000-0000-0000-000000000004';
insert into public.icloud_invite_test_actions (user_id, action, created_at)
  select '00000000-0000-0000-0000-000000000004', 'send', (date_trunc('day', now() at time zone 'Europe/Oslo') at time zone 'Europe/Oslo') - interval '1 second'
  from generate_series(1, 5);
set role service_role;
select public.t_ok(public.icloud_invite_test_used('00000000-0000-0000-0000-000000000004') = 0, '209: five from just before Oslo''s midnight count for yesterday');
select public.t_ok(public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000004', 'send') = 1, '209: …and today starts again at 1');
reset role;

-- 4 · the browser can't read, add, change or delete a counted action, nor call the functions
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok(public.t_err($q$select * from public.icloud_invite_test_actions$q$) = '42501', '209: the owner''s browser cannot read the count (42501)');
select public.t_ok(public.t_err($q$delete from public.icloud_invite_test_actions$q$) = '42501', '209: …nor delete rows to reset the cap (42501)');
select public.t_ok(public.t_err($q$update public.icloud_invite_test_actions set created_at = now() - interval '2 days'$q$) = '42501', '209: …nor age them (42501)');
select public.t_ok(public.t_err($q$insert into public.icloud_invite_test_actions (action) values ('send')$q$) = '42501', '209: …nor add one (42501)');
select public.t_ok(public.t_err($q$select public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'send')$q$) = '42501', '209: …nor reserve through the function (42501)');
select public.t_ok(public.t_err($q$select public.icloud_invite_test_used('00000000-0000-0000-0000-000000000001')$q$) = '42501', '209: …nor read the count through it (42501)');
reset role;
set role anon;
select public.t_ok(public.t_err($q$select public.icloud_invite_test_reserve('00000000-0000-0000-0000-000000000001', 'send')$q$) = '42501', '209: a signed-out caller reserves nothing (42501)');
reset role;

-- 5 · deleting an account takes only its own rows
select set_config('test.uid', 'none', false);
delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
select public.t_ok((select count(*) = 0 from public.icloud_invite_test_actions where user_id = '00000000-0000-0000-0000-000000000002'), '209: a deleted account''s rows go with it');
select public.t_ok((select count(*) = 5 from public.icloud_invite_test_actions where user_id = '00000000-0000-0000-0000-000000000001'), '209: …and nobody else''s');
