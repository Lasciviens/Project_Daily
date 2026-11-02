-- 185 where its wall can't be built (scripts/verify-db-read-query.mjs ran 185 as a role that may not hand the function
-- to authenticated, as a platform with other rights could): the function stays SECURITY INVOKER, the deploy log says
-- so, and the name checks and the last line still guard it.
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);

select t_ok((select not prosecdef and proowner = 't185_mig'::regrole
             from pg_proc where oid = 'public.ai_run_read_query(text)'::regprocedure),
  'F1 no wall: the function stays SECURITY INVOKER (never a definer owned by the migration''s role)');
select t_ok(public.ai_run_read_query('select count(*)::int as n from notes') = '[{"n": 1}]'::jsonb,
  'F2 the owner''s ordinary reads still work');
select t_refused($q$select set_config('role', 'service_role', true) as r$q$, 'settings cannot be read or changed',
  'F3 the name checks still refuse set_config');
select t_refused($q$select public.t_exec('select set_' || 'config(''role'', ''service_role'', true)') as r$q$,
  'changed a setting', 'F4 an unknown function that runs SQL text switches to the service role — the last line returns nothing');
select t_ok(current_user = 'authenticated', 'F4 …and the switch is undone');
reset role;
reset session authorization;
