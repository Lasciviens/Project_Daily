-- Migration 184's scenarios (the Trakt sync's own writes are known by who writes them): the real 117 (its outbox
-- triggers on movies, shows and episodes), then the real 184 twice (scripts/verify-db-trakt-sync-writer.mjs).
-- PostgREST's per-request settings are set here as it sets them: request.headers, request.jwt.claims and the role.
-- Each `ok` raises on a mismatch.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated, service_role;
-- One request as PostgREST makes it: its headers, its JWT's claims.
create or replace function public.t_request(p_headers jsonb, p_role text) returns void language sql as $$
  select set_config('request.headers', coalesce(p_headers::text, ''), false),
         set_config('request.jwt.claims', case when p_role is null then '' else jsonb_build_object('role', p_role)::text end, false)
$$;
grant execute on function public.t_request(jsonb, text) to authenticated, service_role;

-- ── 1. The browser can't claim to be the sync ───────────────────────────────
set role authenticated;
select public.t_request('{"x-trakt-sync": "1"}', 'authenticated');
select t_ok(not public.trakt_sync_writing(), 'T1 a browser request that sends x-trakt-sync: 1 is NOT the sync (its change still goes to Trakt)');
-- (Claims and role always agree: PostgREST sets the role from the signed JWT's own role claim — a browser can make
-- neither say service_role.)
select public.t_request('{"x-trakt-sync": "1"}', null);
select t_ok(not public.trakt_sync_writing(), 'T1 …nor with no JWT claims at all while the request runs as the browser''s role');
select public.t_request('{}', 'authenticated');
select t_ok(not public.trakt_sync_writing(), 'T1 a plain browser write is queued for Trakt, as before');
reset role;

-- ── 2. The sync itself (service role) ───────────────────────────────────────
set role service_role;
select public.t_request('{"x-trakt-sync": "1"}', 'service_role');
select t_ok(public.trakt_sync_writing(), 'T2 trakt-api''s own write (service role + the header) is still not queued back — no loop');
select public.t_request('{}', 'service_role');
select t_ok(not public.trakt_sync_writing(), 'T2 another service-role writer without the header is queued (the assistant, the phone gateway)');
select public.t_request('{"x-trakt-sync": "1"}', null);
select t_ok(public.trakt_sync_writing(), 'T2 the role alone also counts when a request carries no JWT claims (PostgREST switched to service_role)');
reset role;

-- ── 3. The database's own flag is unchanged ─────────────────────────────────
set role authenticated;
select public.t_request('{}', 'authenticated');
begin;
select set_config('app.trakt_sync', 'on', true);
select t_ok(public.trakt_sync_writing(), 'T3 a database function that set app.trakt_sync = on (its own import) still writes without queueing');
commit;
select t_ok(not public.trakt_sync_writing(), 'T3 …and only inside its own transaction');
select public.t_request(null, null);
select t_ok(not public.trakt_sync_writing(), 'T3 no request at all (a cron job, SQL): queued, as before');
reset role;

-- ── 4. The function is the one every Trakt trigger asks ─────────────────────
select t_ok((select count(*) from pg_proc where proname = 'trakt_sync_writing' and pronamespace = 'public'::regnamespace) = 1
        and (select prosrc from pg_proc where proname = 'trakt_sync_writing' and pronamespace = 'public'::regnamespace) like '%service_role%',
  'T4 one trakt_sync_writing(), and it asks for the service role');
