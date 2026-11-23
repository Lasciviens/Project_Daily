-- Migration 200 (trakt_manual_matches). Setup runs as the superuser, the function's reads as `service_role`, the app's as
-- `authenticated`. test.uid picks the account: 1 = the owner, 2 = a second allowed account, 3 = signed in but not let in.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate; end $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text) to anon, authenticated, service_role;

-- 1 · what 200 made
select public.t_ok((select relrowsecurity from pg_class where oid = 'public.trakt_manual_matches'::regclass), '200: row level security is on');
select public.t_ok((select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'trakt_manual_matches' and policyname = 'app_owner_lock'), '200: the owner lock is on the table');
select public.t_ok(not has_table_privilege('anon', 'public.trakt_manual_matches', 'select') and not has_table_privilege('anon', 'public.trakt_manual_matches', 'insert'), '200: a signed-out caller has no right on it');
select public.t_ok(has_table_privilege('authenticated', 'public.trakt_manual_matches', 'delete') and has_table_privilege('service_role', 'public.trakt_manual_matches', 'select'), '200: the browser and the function have their rights');
select public.t_ok((select count(*) = 1 from pg_trigger where tgrelid = 'public.trakt_manual_matches'::regclass and tgname = 'trg_audit'), '200: the table is audited');

-- 2 · the owner's own rows
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('movie', 111, 9001), ('show', 111, 9002);
select public.t_ok((select count(*) = 2 and bool_and(user_id = '00000000-0000-0000-0000-000000000001') from public.trakt_manual_matches), '200: the owner adds a pick per kind (user_id from the sign-in; a movie and a show may share a Trakt id)');
select public.t_ok(public.t_err($q$insert into public.trakt_manual_matches (user_id, kind, trakt_id, tmdb_id) values ('00000000-0000-0000-0000-000000000002', 'movie', 5, 5)$q$) = '42501', '200: a row for another account is refused (42501)');
select public.t_ok(public.t_err($q$insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('episode', 5, 5)$q$) = '23514', '200: a kind off the list is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('movie', 0, 5)$q$) = '23514', '200: a Trakt id of 0 is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('movie', 5, -1)$q$) = '23514', '200: a negative TMDB id is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('movie', 5, 3000000000)$q$) = '22003', '200: a TMDB id past the integer range is refused (22003)');
select public.t_ok(public.t_err($q$insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('movie', 5, 'abc')$q$) = '22P02', '200: a TMDB id that is not a number is refused (22P02)');
select public.t_ok(public.t_err($q$insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('movie', 111, 9003)$q$) = '23505', '200: one pick per Trakt item (23505)');
select public.t_ok(public.t_err($q$insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('movie', 222, 9001)$q$) = '23505', '200: two Trakt items cannot share one catalogue title (23505)');
update public.trakt_manual_matches set tmdb_id = 9010 where kind = 'movie' and trakt_id = 111;
select public.t_ok((select tmdb_id = 9010 from public.trakt_manual_matches where kind = 'movie'), '200: the owner changes a pick');
reset role;

-- 3 · nobody else reads or changes them
insert into public.trakt_manual_matches (user_id, kind, trakt_id, tmdb_id) values ('00000000-0000-0000-0000-000000000002', 'movie', 333, 9100);
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok((select count(*) from public.trakt_manual_matches where trakt_id = 333) = 0, '200: the owner never sees another account''s picks');
update public.trakt_manual_matches set tmdb_id = 1 where trakt_id = 333;
delete from public.trakt_manual_matches where trakt_id = 333;
reset role;
select public.t_ok((select tmdb_id = 9100 from public.trakt_manual_matches where trakt_id = 333), '200: …and cannot change or delete them');
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok((select count(*) from public.trakt_manual_matches) = 0 and public.t_err($q$insert into public.trakt_manual_matches (kind, trakt_id, tmdb_id) values ('movie', 7, 7)$q$) = '42501', '200: an account the owner lock keeps out reads and writes nothing');
reset role;

-- 4 · the function (service role) reads one account's picks by an explicit filter
set role service_role;
select public.t_ok((select count(*) = 2 from public.trakt_manual_matches where user_id = '00000000-0000-0000-0000-000000000001'), '200: the function reads the owner''s picks');
reset role;

-- 5 · Undo: a delete through the app's own function brings the row back
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok(public.t_err($q$delete from public.trakt_manual_matches where kind = 'show' and trakt_id = 111$q$) is null, '200: the owner removes a pick');
select public.t_ok((select count(*) = 1 from public.trakt_manual_matches), '200: one pick is left');
reset role;
select public.t_ok((select count(*) = 1 from public.audit_logs where table_name = 'trakt_manual_matches' and operation = 'DELETE'), '200: the removal is in the activity log, so Activity can undo it');
