-- Migration 185's scenarios (scripts/verify-db-read-query.mjs runs the real 185 twice first, as the database's own
-- role, so its wall is built). Each request is made the way PostgREST makes it: signed in as authenticator, switched to
-- authenticated, the JWT's claims set. tablefunc (Postgres's contrib) stands for an extension that runs SQL text.
create extension if not exists tablefunc;

-- ── 1. Only the app's own account may run a read query ──────────────────────
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
select t_refused('select 1 as n', 'only the app''s own account',
  'R1 a signed-in account that is not an app user is refused before anything runs');
select t_refused($q$select set_config/**/('role','service_role',true) a, query_to_xml('select * from public.trakt_tokens',true,false,'') b$q$,
  'only the app''s own account', 'R1 …and so is 140''s comment trick from that account');
select set_config('request.jwt.claims', '', false);
select t_refused('select 1 as n', 'only the app''s own account', 'R1 …and a request with no JWT claims');
reset role;
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select t_refused('select 1 as n', 'only the app''s own account',
  'R1 a service-role call (Supabase''s default grant) has no account: refused too — the assistant calls it as the user');
reset role;

-- From here on: the owner, through the browser's door (PostgREST), as the assistant calls it.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);

-- ── 2. The owner's ordinary reads still work ────────────────────────────────
select t_ok(public.ai_run_read_query('select count(*)::int as n from notes') = '[{"n": 1}]'::jsonb,
  'R2 the owner reads their own rows (RLS applies: someone else''s note is not counted)');
select t_ok(jsonb_array_length(public.ai_run_read_query(
  $q$with t as (select body from public.notes) select body from t where body ilike '%set up%' or body ilike '%reset%'$q$)) = 1,
  'R2 words like "set up" and "reset" inside text are fine, and public. is allowed');
select t_ok(public.ai_run_read_query($q$select 'reset' as w, 'my_pg_notes' as p, 'cron job' as c$q$)
         = '[{"c": "cron job", "p": "my_pg_notes", "w": "reset"}]'::jsonb,
  'R2 a word that merely contains pg_, or the word cron without a dot, is fine');
select t_ok(public.ai_run_read_query('select n from generate_series(1, 600) n') ->> 499 is not null
        and jsonb_array_length(public.ai_run_read_query('select n from generate_series(1, 600) n')) = 500,
  'R2 the 500-row cap still holds');

-- ── 3. Every way around 140's pattern is refused ────────────────────────────
select t_refused($q$select set_config/**/('role','service_role',true) a, query_to_xml('select * from public.trakt_tokens',true,false,'') b$q$,
  'comments, quoted names', 'R3 a block comment between set_config and its bracket');
select t_refused(E'select set_config--x\n(''role'',''service_role'',true) as r', 'comments, quoted names',
  'R3 a line comment between them');
select t_refused('select 1 as n /* harmless */', 'comments, quoted names', 'R3 any comment at all (the assistant strips them before sending)');
select t_refused($q$select query_to_xml('select ' || 'set_' || 'config(''role'', ''service_role'', true)', true, false, '') a, query_to_xml('select access_token from public.trak' || 't_tokens', true, false, '') b$q$,
  'that function is not allowed', 'R3 a call assembled inside a string that query_to_xml runs');
select t_refused('select "set_config"(''role'', ''service_role'', true) as r', 'comments, quoted names', 'R3 a quoted function name');
select t_refused($q$select U&"\0073et_config"('role', 'service_role', true) as r$q$, 'comments, quoted names', 'R3 a unicode-escaped name');
select t_refused('select 1 as n; select 2 as m', 'comments, quoted names', 'R3 a second statement');
select t_refused('set role service_role', 'settings cannot be read or changed', 'R3 a SET statement');
select t_refused('  RESET role', 'settings cannot be read or changed', 'R3 a RESET statement');
select t_refused($q$select set_config('role', 'service_role', true) as r$q$, 'settings cannot be read or changed', 'R3 set_config, plainly');
select t_refused(E'select SET_CONFIG\t(''request.jwt.claims'', ''{"sub":"x"}'', true) as r', 'comments, quoted names',
  'R3 set_config in capitals with a tab, forging the claims (refused for the quote in its text first)');
select t_refused(E'select SET_CONFIG\t(''request.jwt.claims'', ''{}'', true) as r', 'settings cannot be read or changed',
  'R3 set_config in capitals with a tab');
select t_refused($q$select pg_catalog.set_config('role', 'service_role', true) as r$q$, 'settings cannot be read or changed', 'R3 set_config named with its schema');
select t_refused($q$select 'set_config' as w$q$, 'settings cannot be read or changed', 'R3 even the bare name inside text (fail closed)');
select t_refused($q$select current_setting('request.headers', true) as h$q$, 'settings cannot be read or changed',
  'R3 current_setting (it would read the request''s own headers: the caller''s sign-in token)');
select t_refused($q$select set_limit(0.99) as l$q$, 'settings cannot be read or changed', 'R3 set_limit (pg_trgm''s session setting)');
select t_refused($q$select setseed(0.5) as s$q$, 'settings cannot be read or changed', 'R3 setseed');

-- ── 4. Built-ins that run SQL text, and system catalogs and schemas ─────────
select t_refused($q$select query_to_xml('select 1', true, false, '') as x$q$, 'that function is not allowed', 'R4 query_to_xml');
select t_refused($q$select query_to_xml_and_xmlschema('select 1', true, false, '') as x$q$, 'that function is not allowed', 'R4 query_to_xml_and_xmlschema');
select t_refused($q$select table_to_xml('public.notes', true, false, '') as x$q$, 'that function is not allowed', 'R4 table_to_xml');
select t_refused($q$select database_to_xml(true, false, '') as x$q$, 'that function is not allowed', 'R4 database_to_xml');
select t_refused($q$select * from ts_stat('select to_tsvector(body) from public.notes')$q$, 'that function is not allowed', 'R4 ts_stat');
select t_refused($q$select ts_rewrite('a'::tsquery, 'select ''a''::tsquery, ''b''::tsquery') as x$q$, 'that function is not allowed', 'R4 ts_rewrite');
select t_refused($q$select dblink('dbname=x', 'select 1') as x$q$, 'that function is not allowed', 'R4 dblink');
select t_refused($q$select public.ai_run_read_query('select 1') as x$q$, 'that function is not allowed', 'R4 the read query calling itself');
select t_refused('select * from pg_settings', 'system catalogs', 'R4 a pg_ catalog');
select t_refused('select pg_sleep(0) as s', 'system catalogs', 'R4 a pg_ function');
select t_refused('select * from information_schema.tables', 'system catalogs', 'R4 information_schema');
select t_refused('select * from auth.users', 'system catalogs', 'R4 the auth schema');
select t_refused('select * from vault.decrypted_secrets', 'system catalogs', 'R4 the vault schema');
select t_refused($q$select net.http_get('https://example.com') as x$q$, 'system catalogs', 'R4 pg_net''s schema');
select t_refused('select * from cron.job', 'system catalogs', 'R4 pg_cron''s schema');
select t_refused('select * from deploy . applied_migrations', 'system catalogs', 'R4 the deploy log, even with spaces around the dot');

-- ── 4b. Postgres's own wall, and the last line ──────────────────────────────
select t_refused($q$select b.v as stolen from crosstab('select ''r''::text, ''c''::text, set_' || 'config(''role'', ''service_role'', true)') as a(r text, v text), lateral crosstab('select ''r''::text, ''c''::text, access_token from trakt_tokens where ''' || a.v || ''' <> ''''') as b(r text, v text)$q$,
  'within security-definer function', 'R4b an extension that runs SQL text (tablefunc''s crosstab) can''t switch to the service role: Postgres refuses it');
select t_refused($q$select public.t_exec('select set_' || 'config(''role'', ''service_role'', true)') as r$q$,
  'within security-definer function', 'R4b …nor any other function that runs SQL text');
select t_refused($q$select public.t_exec('select set_' || 'config(''session_authorization'', ''postgres'', true)') as r$q$,
  'within security-definer function', 'R4b …nor change the session''s user');
select t_refused($q$select public.t_exec('select set_' || 'config(''request.jwt.claims'', ''{"sub":"00000000-0000-0000-0000-00000000000b"}'', true)') as r, (select count(*) from public.notes) as n$q$,
  'comments, quoted names', 'R4b forged claims need a quote in the text: refused first');
select t_refused($q$select public.t_exec('select set_' || 'config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-00000000000b'', true)') as r, (select count(*) from public.notes) as n$q$,
  'changed a setting', 'R4b a changed account id (request.jwt.claim.sub) gives nothing back: the last line');
select t_refused($q$select public.t_exec('select set_' || 'config(''app.icloud_readback'', ''on'', false)') as r$q$,
  'changed a setting', 'R4b a trigger flag switched on for the whole connection gives nothing back…');
select t_ok(coalesce(current_setting('app.icloud_readback', true), '') <> 'on', 'R4b …and the refusal undoes the flag');
select t_refused($q$select public.t_exec('select set_' || 'config(''app.shop_restored'', ''1/1|00000000-0000-0000-0000-00000000000a'', false)') as r$q$,
  'changed a setting', 'R4b 187''s app.shop_restored (the ids a Shop Undo hands its price-history helper) set for the whole connection gives nothing back (189)…');
select t_ok(coalesce(current_setting('app.shop_restored', true), '') = '', 'R4b …and the refusal undoes it');

-- ── 5. What held before still holds ─────────────────────────────────────────
select t_refused('select * from public.trakt_tokens', 'permission denied', 'R5 the token table stays out of reach for the owner''s session too');
select t_refused($q$select (select access_token from public.trakt_tokens)::int as n$q$, 'permission denied',
  'R5 …and a cast error can''t carry the token out');
select t_refused($q$select nextval('public.t_seq') as v$q$, 'read-only', 'R5 the query is read-only');
select t_ok(coalesce(current_setting('app.trakt_sync', true), '') = '' and coalesce(current_setting('app.google_sync_write', true), '') = '',
  'R5 no outbox-pause flag is left on after a read');
select t_ok(current_user = 'authenticated' and current_setting('role') = 'authenticated', 'R5 after every attempt the caller is still the browser''s role');
reset role;
reset session authorization;

-- ── 6. Shape and grants ─────────────────────────────────────────────────────
select t_ok((select count(*) from pg_proc where proname = 'ai_run_read_query' and pronamespace = 'public'::regnamespace) = 1,
  'R6 one ai_run_read_query');
select t_ok((select prosecdef and proowner = 'authenticated'::regrole
                    and proconfig @> array['statement_timeout=5000', 'search_path=public, extensions, pg_temp']
             from pg_proc where proname = 'ai_run_read_query' and pronamespace = 'public'::regnamespace),
  'R6 behind the wall: SECURITY DEFINER owned by authenticated (the caller''s own rights), PostgREST''s search_path');
select t_ok(not has_schema_privilege('authenticated', 'public', 'CREATE'),
  'R6 the browser''s role got CREATE on public only for the owner change, not to keep');
select t_ok(has_function_privilege('authenticated', 'public.ai_run_read_query(text)', 'execute')
        and not has_function_privilege('anon', 'public.ai_run_read_query(text)', 'execute'),
  'R6 the browser''s signed-in role may call it; a signed-out caller may not');
