-- 185 · The assistant's live read query can't change who it runs as, and only the app's own account may run it (the
-- guardian review of PR #595 found the hole while checking 184, 02.11.2026; the owner's standing rule: a known security
-- finding is fixed before the feature ships).
--
-- ai_run_read_query (064, 140) runs the SQL text it is given, read-only, with the caller's rights. 140 refused
-- set_config / SET / RESET / DISCARD by a text pattern, but the pattern could be stepped around (a comment between the
-- function's name and its bracket, or a call assembled inside a string that a built-in such as query_to_xml runs). A
-- query that changes the `role` setting then runs as the service role — the server's master key that skips every
-- per-account rule; PostgREST signs in as a user allowed to become it — and reads the token tables (where the app keeps
-- its sign-ins to Google, Trakt and the others) and every account's rows. Any signed-in session could call it straight
-- from the browser, not only the assistant.
--
-- Now:
--   1. Only an app user (`is_app_user()`, the owner lock's own check) may call it.
--   2. Postgres's own wall: the function becomes SECURITY DEFINER owned by `authenticated`, so it runs with exactly the
--      caller's rights (the same RLS and grants) and Postgres itself refuses any change of `role` or
--      `session_authorization` inside it, whatever runs the SQL — an extension enabled later included. Only when the
--      platform lets the migration hand the function to `authenticated` (on Supabase `postgres` is a member of it);
--      otherwise a WARNING, the function stays as it was (SECURITY INVOKER), and 3 and 4 still guard it.
--   3. Name checks, fail closed (when in doubt, refuse): a comment, a quoted name or ";"; a leading SET / RESET /
--      DISCARD; set_config, current_setting (it would read the request's own headers — the caller's sign-in token),
--      set_limit, setseed; a built-in that runs SQL text (query_to_xml and the other *_to_xml*, ts_stat, ts_rewrite,
--      dblink*) or this function itself; a pg_ name; a system schema (so an alias or CTE may not be named like one).
--      Ordinary queries are unchanged; one that merely mentions a refused name, as an alias or inside text, is refused
--      too. ai-proxy already strips comments and refuses quotes and ";", so the assistant never sends those.
--   4. A last line (AGENTS.md): if the query changed who it runs as (the role, the JWT's claims) or one of the database's
--      own trigger flags, nothing is returned and the error undoes the change. It can't catch a query that changes and
--      restores within itself — 2 and 3 are the guards; enabling an extension means checking its functions
--      (.claude/rules/ai.md).
-- Same signature and grants (authenticated only), read-only, at most 500 rows (a row count, not a size cap). The time
-- limit is the role's own statement timeout: the function's 5 s setting can't shorten a statement already running. Its
-- search_path is PostgREST's (public, extensions) with pg_temp last. It still clears the two outbox-pause flags.
-- Re-runnable (CREATE OR REPLACE, then the wall again). No BEGIN/COMMIT: the deploy runs it as one transaction.

-- Created as SECURITY INVOKER first, so a wall that can't be built (2) never leaves a definer owned by anyone else.
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
    'app.media_watch_bulk', 'app.repeat_deleting'];
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

comment on function public.ai_run_read_query(text) is
  'The assistant''s opt-in live read query (064): the caller''s own rights, read-only, 500 rows. 185: app users only; '
  'behind Postgres''s role wall (SECURITY DEFINER owned by authenticated) where the platform allows; refuses comments, '
  'quoted names, ";", settings, SQL-running built-ins, pg_ names and system schemas; returns nothing when the query '
  'changed the role, the claims or a trigger flag.';

revoke all     on function public.ai_run_read_query(text) from public, anon;
grant  execute on function public.ai_run_read_query(text) to authenticated;

-- 2 · The wall. The owner change needs `authenticated` to hold CREATE on public for that moment only; it is given back
-- at once. Any failure undoes this block alone (the function stays SECURITY INVOKER) and says so in the deploy log.
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
    raise warning '185: the read query could not be put behind Postgres''s role wall (%), so it stays SECURITY INVOKER; its name checks and last-line check still guard it', sqlerrm;
  end;
end
$wall$;
