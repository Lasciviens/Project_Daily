-- 185 · The assistant's live read query can't change a setting, and only the app's own account may run it (the
-- guardian review of PR #595 found this while checking 184, 02.11.2026; the owner's standing rule: a known security
-- finding is fixed before the feature ships).
--
-- ai_run_read_query (064, 140) runs the SQL text it is given as the caller, read-only. 140 refused set_config / SET /
-- RESET / DISCARD by a text pattern, but the pattern could be stepped around (a comment between the function's name
-- and its bracket, or a call assembled inside a string that a built-in such as query_to_xml runs). A query that
-- changes the `role` setting then runs as the service role — PostgREST signs in as a user allowed to become it — and
-- reads the token tables and every account's rows; one that changes request.jwt.claims reads as someone else. Any
-- signed-in session could call it straight from the browser, not only the assistant.
--
-- Now, before anything runs:
--   • only an app user (`is_app_user()`, the owner lock's own check) may call it;
--   • the text is refused — fail closed — when it holds a comment, a quoted name or a ";" (ai-proxy already strips
--     comments and refuses the other two, so the assistant never sends them), starts with SET / RESET / DISCARD,
--     names set_config, a built-in that runs SQL text (query_to_xml and the other *_to_xml*, ts_stat, ts_rewrite,
--     dblink*) or this function itself, names a pg_ catalog, or points into a system schema. With no comments or
--     quotes there is no other way to spell those calls, and nothing else in a read query can change a setting.
-- Same signature, SECURITY INVOKER (RLS applies as before), read-only, 5 s timeout, 500-row cap, the same grants
-- (authenticated only), and it still clears the two outbox-pause flags. Re-runnable (CREATE OR REPLACE). No
-- BEGIN/COMMIT: the deploy runs it as one transaction.

create or replace function public.ai_run_read_query(query_text text)
returns jsonb
language plpgsql
security invoker
set statement_timeout = '5000'
as $$
declare
  q text := coalesce(query_text, '');
  result jsonb;
begin
  if not coalesce(public.is_app_user(), false) then
    raise exception 'ai_run_read_query: only the app''s own account can run a read query' using errcode = '42501';
  end if;
  if strpos(q, '/*') > 0 or strpos(q, '--') > 0 or q ~ '[;"]' then
    raise exception 'ai_run_read_query: comments, quoted names and ";" are not allowed in a read query' using errcode = '42501';
  end if;
  if q ~* '^\s*(set|reset|discard)\y' or q ~* '\yset_config\y' then
    raise exception 'ai_run_read_query: settings cannot be changed from a read query' using errcode = '42501';
  end if;
  if q ~* '\y(\w*_to_xml\w*|ts_stat|ts_rewrite|dblink\w*|ai_run_read_query)\y' then
    raise exception 'ai_run_read_query: that function is not allowed in a read query' using errcode = '42501';
  end if;
  if q ~* '\ypg_' or q ~* '\y(information_schema|auth|vault|storage|extensions|net|cron|graphql|graphql_public|realtime|pgsodium|pgsodium_masks|supabase_functions|supabase_migrations|deploy)\s*\.' then
    raise exception 'ai_run_read_query: system catalogs and other schemas are not allowed in a read query' using errcode = '42501';
  end if;

  perform set_config('transaction_read_only', 'on', true);
  execute format(
    'select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select * from (%s) _q limit 500) x',
    q
  ) into result;
  -- The outbox triggers pause while these are on; a read never leaves them set.
  perform set_config('app.google_sync_write', '', false);
  perform set_config('app.trakt_sync', '', false);
  return result;
end;
$$;

comment on function public.ai_run_read_query(text) is
  'The assistant''s opt-in live read query (064): runs as the caller, read-only, 500 rows. 185: app users only; '
  'refuses comments, quoted names, ";", settings changes, SQL-running built-ins, pg_ catalogs and system schemas.';

revoke all     on function public.ai_run_read_query(text) from public, anon;
grant  execute on function public.ai_run_read_query(text) to authenticated;
