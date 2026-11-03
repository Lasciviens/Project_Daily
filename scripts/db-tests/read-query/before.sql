-- 140's read query (scripts/verify-db-read-query.mjs puts it in place before this file): the hole 185 closes is real
-- in this set-up, so the scenarios after 185 would notice it coming back. A signed-in account that is NOT the owner
-- calls the read query the way the browser can (straight through PostgREST) and reads the token table.
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);

select t_ok(strpos(public.ai_run_read_query(
  $q$select set_config/**/('role','service_role',true) a, query_to_xml('select * from public.trakt_tokens',true,false,'') b$q$)::text,
  'T0KEN-NOT-FOR-THE-BROWSER') > 0,
  'B1 140: another account steps around the set_config pattern with a comment, becomes the service role and reads a token');
select t_ok(strpos(public.ai_run_read_query(
  $q$select query_to_xml('select ' || 'set_' || 'config(''role'', ''service_role'', true)', true, false, '') a, query_to_xml('select access_token from public.trak' || 't_tokens', true, false, '') b$q$)::text,
  'T0KEN-NOT-FOR-THE-BROWSER') > 0,
  'B2 140: …or with the call assembled inside a string that query_to_xml runs');

reset role;
reset session authorization;
