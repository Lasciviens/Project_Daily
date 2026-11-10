-- 189 · The assistant's read query watches 187's app.shop_restored too (the guardian review of 187, 10.11.2026).
--
-- 187's shop_restore_price_history (SECURITY DEFINER, callable by the browser) writes only for the ids that
-- shop_restore_items hands it in the transaction-local setting app.shop_restored. 185's read query refuses
-- set_config by name, and its last line returns nothing — and undoes the change — when a query changed a setting
-- the database's own code reads: the role, the claims and the flags in its `watched` list. This adds
-- app.shop_restored to that list, so a read query that set it anyway (for the whole connection, where a later
-- request could find it) gives nothing back. 187 also ties the value to its own transaction, so one left on a
-- connection never counts; this is the second wall.
--
-- ai_run_read_query is 185's word for word but for that one name (scripts/verify-db-read-query.mjs compares
-- them), re-created with its comment and grants inside one block: replacing it needs the right to act as its
-- owner, which 185's wall made `authenticated` (on Supabase `postgres` is a member). Where the migration's role
-- lacks that right, a WARNING says so and 185's function stays exactly as it is. Then 185's wall again
-- (CREATE OR REPLACE makes it SECURITY INVOKER): SECURITY DEFINER owned by authenticated where the platform
-- allows, else SECURITY INVOKER with a WARNING. Re-runnable. No BEGIN/COMMIT: the deploy runs it as one
-- transaction.

do $replace$
begin
  execute $fn$
create or replace function public.ai_run_read_query(query_text text)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
set statement_timeout = '5000'
as $$
declare
  q text := coalesce(query_text, '');
  result jsonb;
  -- Who the query runs as, and the flags the database's triggers read.
  watched constant text[] := array['role', 'request.jwt.claims', 'request.jwt.claim.sub', 'app.google_sync_write',
    'app.trakt_sync', 'app.calendar_readback', 'app.icloud_readback', 'app.icloud_look', 'app.media_watch_cache',
    'app.media_watch_bulk', 'app.repeat_deleting', 'app.shop_restored'];
  before_run text;
  after_run text;
begin
  if not coalesce(public.is_app_user(), false) then
    raise exception 'ai_run_read_query: only the app''s own account can run a read query' using errcode = '42501';
  end if;
  if strpos(q, '/*') > 0 or strpos(q, '--') > 0 or q ~ '[;"]' then
    raise exception 'ai_run_read_query: comments, quoted names and ";" are not allowed in a read query' using errcode = '42501';
  end if;
  if q ~* '^\s*(set|reset|discard)\y' or q ~* '\y(set_config|current_setting|set_limit|setseed)\y' then
    raise exception 'ai_run_read_query: settings cannot be read or changed from a read query' using errcode = '42501';
  end if;
  if q ~* '\y(\w*_to_xml\w*|ts_stat|ts_rewrite|dblink\w*|ai_run_read_query)\y' then
    raise exception 'ai_run_read_query: that function is not allowed in a read query' using errcode = '42501';
  end if;
  if q ~* '\ypg_' or q ~* '\y(information_schema|auth|vault|storage|extensions|net|cron|graphql|graphql_public|realtime|pgsodium|pgsodium_masks|supabase_functions|supabase_migrations|deploy)\s*\.' then
    raise exception 'ai_run_read_query: system catalogs and other schemas are not allowed in a read query (an alias or CTE may not be named auth, cron, deploy, extensions, graphql, net, realtime, storage or vault either)' using errcode = '42501';
  end if;

  select current_user || '|' || string_agg(coalesce(current_setting(n, true), '<unset>'), '|' order by o)
    into before_run from unnest(watched) with ordinality as w(n, o);
  perform set_config('transaction_read_only', 'on', true);
  execute format(
    'select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select * from (%s) _q limit 500) x',
    q
  ) into result;
  select current_user || '|' || string_agg(coalesce(current_setting(n, true), '<unset>'), '|' order by o)
    into after_run from unnest(watched) with ordinality as w(n, o);
  if after_run is distinct from before_run then
    raise exception 'ai_run_read_query: the query changed a setting, so nothing is returned' using errcode = '42501';
  end if;
  -- The outbox triggers pause while these are on; a read never leaves them set.
  perform set_config('app.google_sync_write', '', false);
  perform set_config('app.trakt_sync', '', false);
  return result;
end;
$$;
$fn$;
  comment on function public.ai_run_read_query(text) is
    'The assistant''s opt-in live read query (064): the caller''s own rights, read-only, 500 rows. 185: app users only; '
    'behind Postgres''s role wall (SECURITY DEFINER owned by authenticated) where the platform allows; refuses comments, '
    'quoted names, ";", settings, SQL-running built-ins, pg_ names and system schemas; returns nothing when the query '
    'changed the role, the claims or a trigger flag. 189: app.shop_restored (187) is watched too.';
  revoke all     on function public.ai_run_read_query(text) from public, anon;
  grant  execute on function public.ai_run_read_query(text) to authenticated;
exception when insufficient_privilege then
  raise warning '189: the read query could not be replaced (%), so it keeps 185''s list of watched settings; 187''s own stamp still guards app.shop_restored', sqlerrm;
end
$replace$;

-- 185's wall, again. The owner change needs `authenticated` to hold CREATE on public for that moment only; it is given
-- back at once. Any failure undoes this block alone (the function stays SECURITY INVOKER) and says so in the deploy log.
do $wall$
declare
  v_had boolean := has_schema_privilege('authenticated', 'public', 'CREATE');
begin
  begin
    if not v_had then grant create on schema public to authenticated; end if;
    alter function public.ai_run_read_query(text) owner to authenticated;
    if not v_had then revoke create on schema public from authenticated; end if;
    alter function public.ai_run_read_query(text) security definer;
  exception when others then
    raise warning '189: the read query could not be put behind Postgres''s role wall (%), so it stays SECURITY INVOKER; its name checks and last-line check still guard it', sqlerrm;
  end;
end
$wall$;
