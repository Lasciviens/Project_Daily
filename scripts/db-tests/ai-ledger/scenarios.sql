-- Migration 194 (the AI ledger): who may write what the budget wall is worked out from, what each CHECK refuses,
-- what a second account, an account the owner lock keeps out and a signed-out caller reach, the numbers ai_usage
-- and ai_gate answer (Oslo days and months, with rows at chosen times) and what the daily purge clears.
-- Setup and catalogue checks run as the superuser. The ledger is written as `service_role` (the claude function),
-- settings as `authenticated` (the app). test.uid picks the account: 1 = the owner, 2 = a second allowed account,
-- 3 = signed in but not let in, 4–6 = the gate's own accounts, 'none' = no user.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
-- Passes when nothing got through; a failure names what did.
create or replace function public.t_none(p_let_in text, msg text) returns void language plpgsql as $$
begin
  if p_let_in is not null then raise exception 'FAIL  % — let in: %', msg, p_let_in; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
-- One ledger row: a plain good call, with the given columns on top. Runs as the caller.
create or replace function public.t_call(p jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.ai_calls
  select * from jsonb_populate_record(null::public.ai_calls, jsonb_build_object(
    'id', gen_random_uuid(), 'user_id', '00000000-0000-0000-0000-000000000001', 'created_at', now(),
    'run_id', gen_random_uuid(), 'step', 1, 'job', 'item_fill', 'caller', 'app', 'mode', 'live', 'provider', 'anthropic',
    'model', 'claude-haiku-5-5', 'outcome', 'ok', 'input_tokens', 0, 'cache_read_tokens', 0, 'cache_write_5m_tokens', 0,
    'cache_write_1h_tokens', 0, 'output_tokens', 0, 'thinking_tokens', 0, 'long_prompt', false, 'cost_usd', 0,
    'tools', '[]'::jsonb) || p)
  returning id into v;
  return v;
end $$;
-- The SQLSTATE that row is refused with, or null when it got in.
create or replace function public.t_call_err(p jsonb) returns text language plpgsql as $$
begin
  perform public.t_call(p);
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_ok(boolean, text), public.t_none(text, text), public.t_err(text),
  public.t_call(jsonb), public.t_call_err(jsonb) to anon, authenticated, service_role;

-- ─── 1. What 194 made ────────────────────────────────────────────────────────
select public.t_ok((select count(*) from pg_policies where schemaname = 'public' and policyname = 'app_owner_lock'
                     and tablename in ('ai_calls', 'ai_settings', 'ai_job_settings')) = 3
                   and (select bool_and(c.relrowsecurity) from pg_class c
                         where c.oid in ('public.ai_calls'::regclass, 'public.ai_settings'::regclass, 'public.ai_job_settings'::regclass)),
  '194: row level security and the owner lock are on all three tables');
select public.t_ok((select count(*) = 1 and bool_and(cmd = 'SELECT' and roles = '{authenticated}') from pg_policies
                     where schemaname = 'public' and tablename = 'ai_calls' and policyname <> 'app_owner_lock'),
  '194: the ledger has one policy, and it only reads');
select public.t_ok((select array_agg(cmd order by cmd) from pg_policies where schemaname = 'public' and tablename = 'ai_settings' and policyname <> 'app_owner_lock')
                     = array['INSERT', 'SELECT', 'UPDATE']
                   and (select array_agg(cmd order by cmd) from pg_policies where schemaname = 'public' and tablename = 'ai_job_settings' and policyname <> 'app_owner_lock')
                     = array['INSERT', 'SELECT', 'UPDATE'],
  '194: the settings tables have a read, an add and a change policy, and none that deletes');
select public.t_ok(has_table_privilege('authenticated', 'public.ai_calls', 'select')
                   and not has_table_privilege('authenticated', 'public.ai_calls', 'insert, update, delete, truncate, references, trigger')
                   and not has_any_column_privilege('authenticated', 'public.ai_calls', 'insert, update, references'),
  '194: the browser may read the ledger and has no other right on it, on no column either');
select public.t_ok((select bool_and(has_table_privilege('authenticated', t, 'select') and has_table_privilege('authenticated', t, 'insert')
                                    and has_table_privilege('authenticated', t, 'update')
                                    and not has_table_privilege('authenticated', t, 'delete, truncate, references, trigger'))
                     from unnest(array['public.ai_settings', 'public.ai_job_settings']) t),
  '194: the browser reads, adds and changes settings, and never deletes them');
select public.t_ok((select bool_and(not has_table_privilege('anon', t, 'select, insert, update, delete, truncate, references, trigger')
                                    and not has_any_column_privilege('anon', t, 'select, insert, update, references'))
                     from unnest(array['public.ai_calls', 'public.ai_settings', 'public.ai_job_settings']) t),
  '194: a signed-out caller has no right on any of the three tables');
select public.t_ok((select bool_and(has_table_privilege('service_role', t, 'select') and has_table_privilege('service_role', t, 'insert')
                                    and has_table_privilege('service_role', t, 'update') and has_table_privilege('service_role', t, 'delete'))
                     from unnest(array['public.ai_calls', 'public.ai_settings', 'public.ai_job_settings']) t),
  '194: the service role reads and writes all three');
select public.t_ok(not exists (select 1 from pg_trigger where tgrelid = 'public.ai_calls'::regclass and not tgisinternal and tgname = 'trg_audit')
                   and (select count(*) from pg_trigger where tgname = 'trg_audit' and not tgisinternal
                         and tgrelid in ('public.ai_settings'::regclass, 'public.ai_job_settings'::regclass)) = 2,
  '194: the settings are audited, the ledger is not (it is a log itself)');
select public.t_ok((select a.atthasdef from pg_attribute a where a.attrelid = 'public.ai_calls'::regclass and a.attname = 'user_id') = false
                   and (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                         where d.adrelid = 'public.ai_settings'::regclass and a.attname = 'user_id') = 'auth.uid()',
  '194: the ledger''s user_id has no default (the function sets it), a settings row takes the caller''s');
select public.t_ok((select count(*) from pg_indexes where schemaname = 'public' and tablename = 'ai_calls'
                     and (indexdef like '%(user_id, created_at DESC)' or indexdef like '%(user_id, run_id)')) = 2,
  '194: the ledger is indexed by account and time, and by account and run');
select public.t_ok((select bool_and(not p.prosecdef and p.proconfig = array['search_path=""'] and p.provolatile = 's')
                     from pg_proc p where p.oid in ('public.ai_usage(timestamptz, timestamptz)'::regprocedure, 'public.ai_gate(text)'::regprocedure)),
  '194: ai_usage and ai_gate run with the caller''s rights, read only, on an empty search path');
select public.t_ok((select p.prosecdef and p.proconfig = array['search_path=""'] and p.pronargs = 0
                     from pg_proc p where p.oid = 'public.ai_calls_purge_text()'::regprocedure),
  '194: ai_calls_purge_text runs with its owner''s rights on an empty search path and takes no input');
select public.t_ok((select bool_and(has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute')
                                    and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute'))
                     from unnest(array['public.ai_usage(timestamptz, timestamptz)', 'public.ai_gate(text)']) f),
  '194: signed-in callers and the service role may call ai_usage and ai_gate, a signed-out caller may not');
select public.t_ok(has_function_privilege('service_role', 'public.ai_calls_purge_text()', 'execute')
                   and not has_function_privilege('authenticated', 'public.ai_calls_purge_text()', 'execute')
                   and not has_function_privilege('anon', 'public.ai_calls_purge_text()', 'execute')
                   and not has_function_privilege('public', 'public.ai_calls_purge_text()', 'execute'),
  '194: only the service role may call ai_calls_purge_text');
select public.t_ok((select count(*) = 1 and bool_and(schedule = '41 3 * * *' and command = 'select public.ai_calls_purge_text()')
                     from cron.job where jobname = 'lascis-ai-log-purge'),
  '194: the purge is scheduled once a day, as plain SQL, and a second run of 194 did not schedule it twice');
select public.t_ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and c.relname ~ 'price' and c.relname ~ '^ai_'),
  '194: there is no price table (prices are code: the wall is worked out from them)');

-- ─── 2. The ledger's CHECKs, as the service role (its only writer) ───────────
select set_config('test.uid', 'none', false);
set role service_role;
select public.t_ok(public.t_call() is not null, 'the service role writes a ledger row');
-- A row that names only what has no default.
insert into public.ai_calls (id, user_id, job, caller, model, outcome)
values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'item_fill', 'app', 'claude-haiku-5-5', 'ok');
select public.t_ok((select step = 1 and mode = 'live' and provider = 'anthropic' and tools = '[]'::jsonb and cost_usd = 0 and not long_prompt
                           and input_tokens = 0 and cache_read_tokens = 0 and cache_write_5m_tokens = 0 and cache_write_1h_tokens = 0
                           and output_tokens = 0 and thinking_tokens = 0 and request is null and response is null and thinking is null
                           and run_id is not null and created_at is not null
                      from public.ai_calls where id = 'd0000000-0000-0000-0000-000000000001'),
  'a ledger row takes its defaults: step 1, live, anthropic, no tools, zero tokens and cost, no text');
select public.t_ok(public.t_err($$insert into public.ai_calls (job, caller, model, outcome) values ('item_fill', 'app', 'claude-haiku-5-5', 'ok')$$) = '23502',
  'a ledger row without its account is refused (no default fills it in)');
select public.t_ok(public.t_call_err('{"user_id": "00000000-0000-0000-0000-0000000000ff"}') = '23503', 'a ledger row for an account that does not exist is refused');

select public.t_none((select string_agg(quote_literal(j), ', ') from unnest(array[
    'Item_fill', 'ITEM', '1job', '_job', 'a', 'item-fill', 'item fill', ' item_fill', E'item_fill\n', E'item\tfill', 'élan', 'ａb', 'item.fill',
    'item_fill;drop', repeat('a', 41), '']) j
  where public.t_call_err(jsonb_build_object('job', j)) is distinct from '23514'),
  'a job name is 2–40 of a–z, 0–9 and _, starting with a letter: capitals, a digit first, a dash, a space, a line break, é and a full-width letter are refused');
select public.t_ok(public.t_call_err(jsonb_build_object('job', 'ab')) is null and public.t_call_err(jsonb_build_object('job', 'a' || repeat('9', 39))) is null
                   and public.t_call_err('{"job": "pt_assessment_2"}') is null,
  'the shortest, the longest and an ordinary job name are taken');
select public.t_ok(public.t_call_err('{"job": null}') = '23502' and public.t_call_err('{"caller": null}') = '23502'
                   and public.t_call_err('{"model": null}') = '23502' and public.t_call_err('{"outcome": null}') = '23502',
  'job, caller, model and outcome must be there');
select public.t_none((select string_agg(quote_literal(v), ', ') from unnest(array['browser', 'App', 'cron', 'web', '', ' app']) v
  where public.t_call_err(jsonb_build_object('caller', v)) is distinct from '23514'), 'a caller outside app, phone, kobo, schedule is refused');
select public.t_ok((select bool_and(public.t_call_err(jsonb_build_object('caller', v)) is null) from unnest(array['app', 'phone', 'kobo', 'schedule']) v),
  'each of the four callers is taken');
select public.t_ok(public.t_call_err('{"mode": "stream"}') = '23514' and public.t_call_err('{"mode": "Live"}') = '23514'
                   and public.t_call_err('{"mode": "batch"}') is null,
  'a mode is live or batch');
select public.t_none((select string_agg(quote_literal(v), ', ') from unnest(array['Anthropic', 'a', '1x', 'open ai', repeat('a', 31), '', E'anthropic\n']) v
  where public.t_call_err(jsonb_build_object('provider', v)) is distinct from '23514'), 'a provider name outside its shape is refused');
select public.t_ok(public.t_call_err('{"provider": "open_ai-2"}') is null, 'a provider name of letters, digits, _ and - is taken');
select public.t_ok(public.t_call_err(jsonb_build_object('model', repeat('m', 81))) = '23514' and public.t_call_err(jsonb_build_object('model', repeat('m', 80))) is null
                   and public.t_call_err(jsonb_build_object('served_model', repeat('m', 81))) = '23514'
                   and public.t_call_err(jsonb_build_object('served_model', repeat('m', 80))) is null,
  'a model and a served model are at most 80 characters');
select public.t_none((select string_agg(quote_literal(v), ', ') from unnest(array['extreme', 'Low', 'none', '']) v
  where public.t_call_err(jsonb_build_object('effort', v)) is distinct from '23514'), 'an effort outside low, medium, high, xhigh, max is refused');
select public.t_ok((select bool_and(public.t_call_err(jsonb_build_object('effort', v)) is null) from unnest(array['low', 'medium', 'high', 'xhigh', 'max', null]) v),
  'each of the five efforts, and none, is taken');
select public.t_none((select string_agg(quote_literal(v), ', ') from unnest(array['busy', 'OK', 'success', 'failed', '', ' ok', E'ok\n']) v
  where public.t_call_err(jsonb_build_object('outcome', v)) is distinct from '23514'),
  'an outcome outside the list is refused (busy too: such a call is never written)');
select public.t_ok((select bool_and(public.t_call_err(jsonb_build_object('outcome', v)) is null)
                      from unnest(array['ok', 'refused', 'cut_off', 'invalid', 'error', 'budget', 'off', 'not_configured', 'bad_input']) v),
  'each of the nine outcomes is taken');
select public.t_ok(public.t_call_err(jsonb_build_object('stop_reason', repeat('x', 61))) = '23514' and public.t_call_err(jsonb_build_object('stop_reason', repeat('x', 60))) is null
                   and public.t_call_err(jsonb_build_object('error', repeat('x', 501))) = '23514' and public.t_call_err(jsonb_build_object('error', repeat('x', 500))) is null
                   and public.t_call_err(jsonb_build_object('request_id', repeat('x', 121))) = '23514' and public.t_call_err(jsonb_build_object('request_id', repeat('x', 120))) is null
                   and public.t_call_err(jsonb_build_object('instructions_version', repeat('x', 41))) = '23514'
                   and public.t_call_err(jsonb_build_object('instructions_version', repeat('x', 40))) is null,
  'stop_reason (60), error (500), request_id (120) and instructions_version (40) are bounded');
select public.t_none((select string_agg(c, ', ') from unnest(array['input_tokens', 'cache_read_tokens', 'cache_write_5m_tokens', 'cache_write_1h_tokens',
    'output_tokens', 'thinking_tokens', 'duration_ms']) c
  where public.t_call_err(jsonb_build_object(c, -1)) is distinct from '23514'), 'a negative token count or duration is refused, each of the seven');
select public.t_ok(public.t_call_err('{"input_tokens": 2147483647, "output_tokens": 0, "duration_ms": 0}') is null, 'zero and a very large count are taken');
select public.t_ok(public.t_call_err('{"cost_usd": -0.000001}') = '23514', 'a negative cost is refused');
select public.t_ok(public.t_call_err('{"cost_usd": "NaN"}') = '23514', 'a cost that is not a number (NaN) is refused: one would turn every sum into NaN');
select public.t_ok(public.t_call_err('{"cost_usd": "Infinity"}') is not null and public.t_call_err('{"cost_usd": 1000000}') is not null,
  'an infinite cost, and one past the column, are refused');
select public.t_ok(public.t_call_err('{"cost_usd": 999999.999999}') is null and public.t_call_err('{"cost_usd": 0.000001}') is null, 'the smallest and the largest cost are taken');
select public.t_ok(public.t_call_err('{"step": 0}') = '23514' and public.t_call_err('{"step": 101}') = '23514' and public.t_call_err('{"step": -1}') = '23514'
                   and public.t_call_err('{"step": 100}') is null,
  'a step is 1–100');
select public.t_ok(public.t_call_err('{"tools": {}}') = '23514' and public.t_call_err('{"tools": "x"}') = '23514' and public.t_call_err('{"tools": 1}') = '23514'
                   and public.t_call_err('{"tools": [{"name": "a"}]}') is null,
  'tools is a list');
-- {"t": "xxx…"} as text is the x's and 9 more characters.
select public.t_ok(public.t_call_err(jsonb_build_object('request', jsonb_build_object('t', repeat('x', 1048576 - 9 + 1)))) = '23514'
                   and public.t_call_err(jsonb_build_object('response', jsonb_build_object('t', repeat('x', 1048576 - 9 + 1)))) = '23514'
                   and public.t_call_err(jsonb_build_object('thinking', repeat('x', 1048577))) = '23514',
  'a request, a response or a thinking text one byte over 1 MB is refused');
select public.t_ok(public.t_call_err(jsonb_build_object('request', jsonb_build_object('t', repeat('é', 524288)))) = '23514',
  'the megabyte counts bytes, not characters');
select public.t_ok(public.t_call_err(jsonb_build_object('request', jsonb_build_object('t', repeat('x', 1048576 - 9)),
                                                          'response', jsonb_build_object('t', repeat('x', 1048576 - 9)),
                                                          'thinking', repeat('x', 1048576))) is null,
  'exactly 1 MB each is taken');
reset role;
truncate public.ai_calls;

-- ─── 3. The settings' CHECKs, as the app ─────────────────────────────────────
select set_config('test.uid', '', false);
set role authenticated;
insert into public.ai_settings default values;
select public.t_ok((select user_id = '00000000-0000-0000-0000-000000000001' and monthly_budget_usd = 5 and log_text and log_days = 30 from public.ai_settings),
  'a settings row with nothing said: the caller''s own, 5 USD a month, the text log on for 30 days');
select public.t_ok(public.t_err($$insert into public.ai_settings default values$$) = '23505', 'one settings row per account');
select public.t_none((select string_agg(v, ', ') from unnest(array['-0.01', '50.01', '51', '1000', '''NaN''', '-1']) v
  where public.t_err(format('update public.ai_settings set monthly_budget_usd = %s', v)) is distinct from '23514'),
  'a monthly budget under 0 or over 50, or NaN, is refused');
select public.t_ok(public.t_err($$update public.ai_settings set monthly_budget_usd = 'Infinity'$$) is not null
                   and public.t_err($$update public.ai_settings set monthly_budget_usd = null$$) = '23502',
  'an infinite budget and no budget at all are refused');
select public.t_ok(public.t_err($$update public.ai_settings set monthly_budget_usd = 0$$) is null and public.t_err($$update public.ai_settings set monthly_budget_usd = 50$$) is null
                   and (select monthly_budget_usd = 50 from public.ai_settings),
  'a budget of 0 (nothing may be spent) and of 50 are taken');
select public.t_none((select string_agg(v, ', ') from unnest(array['0', '91', '-1', '366']) v
  where public.t_err(format('update public.ai_settings set log_days = %s', v)) is distinct from '23514'), 'log_days under 1 or over 90 is refused');
select public.t_ok(public.t_err($$update public.ai_settings set log_days = 1$$) is null and public.t_err($$update public.ai_settings set log_days = 90$$) is null
                   and public.t_err($$update public.ai_settings set log_days = null$$) = '23502' and public.t_err($$update public.ai_settings set log_text = null$$) = '23502',
  'log_days of 1 and of 90 are taken, and neither it nor log_text may be empty');
select pg_sleep(0.01);
update public.ai_settings set log_text = false, log_days = 30, monthly_budget_usd = 5;
select public.t_ok((select updated_at > created_at and not log_text from public.ai_settings), 'a change moves updated_at');

insert into public.ai_job_settings (job) values ('item_fill');
select public.t_ok((select user_id = '00000000-0000-0000-0000-000000000001' and enabled and model is null and effort is null
                           and max_output_tokens is null and monthly_budget_usd is null from public.ai_job_settings),
  'a job''s settings with nothing said: the caller''s own, switched on, everything else the job''s default');
select public.t_ok(public.t_err($$insert into public.ai_job_settings (job) values ('item_fill')$$) = '23505', 'one row per account and job');
select public.t_none((select string_agg(quote_literal(j), ', ') from unnest(array['Item_fill', '1job', 'a', 'item-fill', 'item fill', E'item_fill\n', 'élan', repeat('a', 41), '']) j
  where public.t_err(format('insert into public.ai_job_settings (job) values (%L)', j)) is distinct from '23514'),
  'a job name outside its shape is refused in the settings too');
select public.t_none((select string_agg(quote_literal(m), ', ') from unnest(array['gpt-4', 'claude-', 'claude', 'Claude-haiku-5-5', 'claude-Haiku', 'claude-haiku 5',
    'claude-haiku_5', 'claude-haiku-5.5', E'claude-haiku-5-5\n', ' claude-haiku-5-5', 'xclaude-haiku', 'claude-haiku-5-5/../x', 'claude-' || repeat('a', 61), '']) m
  where public.t_err(format('update public.ai_job_settings set model = %L', m)) is distinct from '23514'),
  'a model that is not claude- and 1–60 of a–z, 0–9 and - is refused');
select public.t_ok(public.t_err($$update public.ai_job_settings set model = 'claude-haiku-5-5'$$) is null
                   and public.t_err(format('update public.ai_job_settings set model = %L', 'claude-' || repeat('a', 60))) is null,
  'a Claude model id is taken (the function''s allow-list decides whether it is used)');
select public.t_none((select string_agg(quote_literal(v), ', ') from unnest(array['xhigh', 'max', 'Low', 'none', '']) v
  where public.t_err(format('update public.ai_job_settings set effort = %L', v)) is distinct from '23514'),
  'an effort outside low, medium, high is refused (xhigh and max are not the owner''s to set)');
select public.t_ok((select bool_and(public.t_err(format('update public.ai_job_settings set effort = %L', v)) is null) from unnest(array['low', 'medium', 'high']) v),
  'low, medium and high are taken');
select public.t_none((select string_agg(v, ', ') from unnest(array['255', '16001', '0', '-1', '1000000']) v
  where public.t_err(format('update public.ai_job_settings set max_output_tokens = %s', v)) is distinct from '23514'),
  'a longest answer under 256 or over 16000 tokens is refused');
select public.t_ok(public.t_err($$update public.ai_job_settings set max_output_tokens = 256$$) is null
                   and public.t_err($$update public.ai_job_settings set max_output_tokens = 16000$$) is null,
  '256 and 16000 tokens are taken');
select public.t_none((select string_agg(v, ', ') from unnest(array['-0.01', '50.01', '''NaN''']) v
  where public.t_err(format('update public.ai_job_settings set monthly_budget_usd = %s', v)) is distinct from '23514'),
  'a job budget under 0 or over 50, or NaN, is refused');
select public.t_ok(public.t_err($$update public.ai_job_settings set monthly_budget_usd = 50, enabled = false$$) is null
                   and public.t_err($$update public.ai_job_settings set enabled = null$$) = '23502',
  'a job budget of 50 is taken, and on/off may not be empty');
select pg_sleep(0.01);
update public.ai_job_settings set model = null, effort = null, max_output_tokens = null, monthly_budget_usd = null, enabled = true;
select public.t_ok((select model is null and effort is null and max_output_tokens is null and monthly_budget_usd is null and enabled and updated_at > created_at
                      from public.ai_job_settings),
  'back to the job''s defaults is an update to nothing, and it moves updated_at');
reset role;
select public.t_ok((select count(*) filter (where table_name = 'ai_settings' and operation = 'INSERT') = 1
                           and count(*) filter (where table_name = 'ai_settings' and operation = 'UPDATE') >= 1
                           and count(*) filter (where table_name = 'ai_job_settings' and operation = 'INSERT') = 1
                           and count(*) filter (where table_name = 'ai_job_settings' and operation = 'UPDATE') >= 1
                           and bool_and(actor = 'web' and user_id = '00000000-0000-0000-0000-000000000001')
                      from public.audit_logs where table_name in ('ai_settings', 'ai_job_settings')),
  'the owner''s settings and their changes are in the audit log (Developer → Activity)');
select public.t_ok(not exists (select 1 from public.audit_logs where table_name = 'ai_calls'), 'no ledger row ever went into the audit log');

-- ─── 4. Who reaches what ─────────────────────────────────────────────────────
-- The ledger: two calls of the owner's, one of the second account's, one of the account that is not let in.
select set_config('test.uid', 'none', false);
set role service_role;
select public.t_call('{"id": "a0000000-0000-0000-0000-000000000001", "cost_usd": 1.25, "input_tokens": 100, "request": {"text": "Dentist on Tuesday at 14:00"}, "response": {"fill": {}}, "thinking": "A dentist visit."}');
select public.t_call('{"id": "a0000000-0000-0000-0000-000000000002", "cost_usd": 0.75, "outcome": "error", "job": "other_job"}');
select public.t_call('{"id": "a0000000-0000-0000-0000-000000000003", "user_id": "00000000-0000-0000-0000-000000000002", "cost_usd": 0.5}');
select public.t_call('{"id": "a0000000-0000-0000-0000-000000000004", "user_id": "00000000-0000-0000-0000-000000000003", "cost_usd": 9}');
reset role;
insert into public.ai_settings (user_id, monthly_budget_usd) values ('00000000-0000-0000-0000-000000000003', 50);
insert into public.ai_job_settings (user_id, job, enabled) values ('00000000-0000-0000-0000-000000000003', 'item_fill', false);

-- The owner's own browser session: reads, and can't move the wall.
select set_config('test.uid', '', false);
set role authenticated;
select public.t_ok((select count(*) = 2 and sum(cost_usd) = 2 from public.ai_calls), 'the owner reads their own two calls, and only those');
select public.t_ok(public.t_call_err('{}') = '42501', 'the owner''s browser can''t add a ledger row (a forged call)');
select public.t_ok(public.t_call_err('{"cost_usd": 0, "outcome": "ok", "user_id": "00000000-0000-0000-0000-000000000002"}') = '42501', 'nor one for another account');
select public.t_ok(public.t_err($$update public.ai_calls set cost_usd = 0$$) = '42501', 'nor change a call''s cost');
select public.t_ok(public.t_err($$update public.ai_calls set created_at = now() - interval '2 months'$$) = '42501', 'nor move a call out of this month');
select public.t_ok(public.t_err($$update public.ai_calls set request = null where id = 'a0000000-0000-0000-0000-000000000001'$$) = '42501', 'nor clear a call''s text');
select public.t_ok(public.t_err($$delete from public.ai_calls where id = 'a0000000-0000-0000-0000-000000000001'$$) = '42501', 'nor delete a call');
select public.t_ok(public.t_err($$truncate public.ai_calls$$) = '42501', 'nor empty the ledger');
select public.t_ok(public.t_err($$select 1 from public.ai_calls for update$$) = '42501', 'nor lock its rows');
select public.t_ok(public.t_err($$select public.ai_calls_purge_text()$$) = '42501', 'nor run the purge');
select public.t_ok(public.t_err($$delete from public.ai_settings$$) = '42501' and public.t_err($$delete from public.ai_job_settings$$) = '42501'
                   and public.t_err($$truncate public.ai_settings$$) = '42501',
  'the owner''s browser can''t delete settings');
select public.t_ok(public.t_err($$update public.ai_settings set user_id = '00000000-0000-0000-0000-000000000002'$$) = '42501'
                   and public.t_err($$update public.ai_job_settings set user_id = '00000000-0000-0000-0000-000000000002'$$) = '42501',
  'nor hand its settings to another account');
select public.t_ok(public.t_err($$insert into public.ai_settings (user_id, monthly_budget_usd) values ('00000000-0000-0000-0000-000000000002', 50)$$) = '42501'
                   and public.t_err($$insert into public.ai_job_settings (user_id, job, enabled) values ('00000000-0000-0000-0000-000000000002', 'item_fill', false)$$) = '42501',
  'nor write settings for another account');
select public.t_ok((select count(*) = 2 and sum(cost_usd) = 2 from public.ai_calls), 'after all of that the owner''s ledger is as it was');
select public.t_ok((select sum(calls) = 2 and sum(failed) = 1 and sum(cost_usd) = 2 from public.ai_usage(now() - interval '1 day', now() + interval '1 day')),
  'ai_usage adds up the owner''s two calls');
select public.t_ok((select count(*) = 1 and bool_and(calls_last_minute = 2) from public.ai_gate('item_fill')),
  'ai_gate counts the owner''s two calls of the last minute (the month and the day: section 6, where the clock stands still)');

-- A second account that the owner lock lets in.
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
select public.t_ok((select count(*) = 1 and bool_and(user_id = '00000000-0000-0000-0000-000000000002') from public.ai_calls)
                   and not exists (select 1 from public.ai_calls where user_id = '00000000-0000-0000-0000-000000000001')
                   and not exists (select 1 from public.ai_calls where id = 'a0000000-0000-0000-0000-000000000001'),
  'a second account reads none of the owner''s calls, by account or by id');
select public.t_ok(not exists (select 1 from public.ai_settings) and not exists (select 1 from public.ai_job_settings),
  'nor the owner''s settings');
select public.t_ok((select sum(calls) = 1 and sum(cost_usd) = 0.5 from public.ai_usage(now() - interval '1 day', now() + interval '1 day')),
  'its ai_usage holds its own call only');
select public.t_ok((select calls_last_minute = 1 and month_cost < 2 from public.ai_gate('item_fill'))
                   and (select job_month_cost = 0 from public.ai_gate('other_job')),
  'its ai_gate counts its own call only: the owner''s calls and the owner''s other_job spend are not in it');
update public.ai_settings set monthly_budget_usd = 0;
update public.ai_job_settings set enabled = false;
insert into public.ai_settings (monthly_budget_usd) values (9);
select public.t_ok(public.t_call_err('{"user_id": "00000000-0000-0000-0000-000000000002"}') = '42501'
                   and public.t_err($$delete from public.ai_calls$$) = '42501', 'it can''t write the ledger either');
reset role;
select public.t_ok((select monthly_budget_usd = 5 from public.ai_settings where user_id = '00000000-0000-0000-0000-000000000001')
                   and (select enabled from public.ai_job_settings where user_id = '00000000-0000-0000-0000-000000000001' and job = 'item_fill')
                   and (select monthly_budget_usd = 9 from public.ai_settings where user_id = '00000000-0000-0000-0000-000000000002'),
  'the second account''s change of "every row" changed nothing of the owner''s, and its own settings are its own');

-- An account the owner lock does not let in, with rows of its own in every table.
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok(not exists (select 1 from public.ai_calls) and not exists (select 1 from public.ai_settings) and not exists (select 1 from public.ai_job_settings),
  'an account the owner lock keeps out reads nothing, not even rows that carry its id');
select public.t_ok(public.t_err($$insert into public.ai_settings (monthly_budget_usd) values (50)$$) = '42501'
                   and public.t_err($$insert into public.ai_job_settings (job) values ('other_job')$$) = '42501',
  'it can''t add settings');
update public.ai_settings set monthly_budget_usd = 1;
update public.ai_job_settings set enabled = true;
select public.t_ok(public.t_err($$select * from public.ai_usage(now() - interval '1 day', now() + interval '1 day')$$) = '42501'
                   and public.t_err($$select * from public.ai_gate('item_fill')$$) = '42501',
  'ai_usage and ai_gate refuse it');
reset role;
select public.t_ok((select monthly_budget_usd = 50 from public.ai_settings where user_id = '00000000-0000-0000-0000-000000000003')
                   and (select not enabled from public.ai_job_settings where user_id = '00000000-0000-0000-0000-000000000003'),
  'and its changes changed nothing');

-- Signed out.
select set_config('test.uid', 'none', false);
set role anon;
select public.t_none((select string_agg(q, ' | ') from unnest(array[
    'select 1 from public.ai_calls', 'select 1 from public.ai_settings', 'select 1 from public.ai_job_settings',
    'insert into public.ai_settings (user_id) values (''00000000-0000-0000-0000-000000000001'')',
    'insert into public.ai_job_settings (user_id, job) values (''00000000-0000-0000-0000-000000000001'', ''other_job'')',
    'update public.ai_settings set monthly_budget_usd = 50', 'update public.ai_job_settings set enabled = false',
    'update public.ai_calls set cost_usd = 0', 'delete from public.ai_calls', 'delete from public.ai_settings', 'delete from public.ai_job_settings',
    'select * from public.ai_usage(now() - interval ''1 day'', now())', 'select * from public.ai_gate(''item_fill'')',
    'select public.ai_calls_purge_text()']) q
  where public.t_err(q) is distinct from '42501'),
  'a signed-out caller reaches nothing: no table, no function');
select public.t_ok(public.t_call_err('{}') = '42501', 'and can''t add a ledger row');

-- The service role without a user (how a mistake in the function would ask): an error, never zeros.
set role service_role;
select public.t_ok(public.t_err($$select * from public.ai_gate('item_fill')$$) = '42501'
                   and public.t_err($$select * from public.ai_usage(now() - interval '1 day', now())$$) = '42501',
  'ai_gate and ai_usage asked by nobody answer an error, never "nothing spent"');
reset role;

-- Were a write grant ever to slip in, row level security alone still refuses: there is no policy to write by.
begin;
grant insert, update, delete on public.ai_calls to authenticated;
select set_config('test.uid', '', true);
set local role authenticated;
select public.t_ok(public.t_call_err('{}') = '42501', 'with a write grant slipped in, row level security still refuses a forged call');
update public.ai_calls set cost_usd = 0;
delete from public.ai_calls;
reset role;
select public.t_ok((select count(*) = 2 and sum(cost_usd) = 2 from public.ai_calls where user_id = '00000000-0000-0000-0000-000000000001'),
  'and a change or a delete then touches no row');
rollback;
truncate public.ai_calls;

-- ─── 5. ai_usage: Oslo days, at chosen times ─────────────────────────────────
-- Winter time from 25.10.2026 (UTC+1), summer time before it (UTC+2).
select set_config('test.uid', 'none', false);
set role service_role;
--   31.10 23:30 in Oslo — the last half hour of October.
select public.t_call('{"created_at": "2026-10-31T23:30:00+01:00", "input_tokens": 100, "cache_read_tokens": 1000, "cache_write_5m_tokens": 10, "cache_write_1h_tokens": 20, "output_tokens": 50, "thinking_tokens": 5, "cost_usd": 0.001}');
--   01.11 00:30 in Oslo — still 31.10 (23:30) in UTC.
select public.t_call('{"created_at": "2026-10-31T23:30:00+00:00", "outcome": "error", "input_tokens": 200, "cache_read_tokens": 2000, "cache_write_5m_tokens": 30, "cache_write_1h_tokens": 40, "output_tokens": 60, "thinking_tokens": 6, "cost_usd": 0.002}');
select public.t_call('{"created_at": "2026-11-01T12:00:00+01:00", "input_tokens": 300, "cache_read_tokens": 3000, "cache_write_5m_tokens": 50, "cache_write_1h_tokens": 60, "output_tokens": 70, "thinking_tokens": 7, "cost_usd": 0.003}');
select public.t_call('{"created_at": "2026-11-01T13:00:00+01:00", "model": "claude-sonnet-5-5", "outcome": "cut_off", "output_tokens": 2000, "cost_usd": 0.5}');
select public.t_call('{"created_at": "2026-11-01T14:00:00+01:00", "mode": "batch", "cost_usd": 0.0005}');
select public.t_call('{"created_at": "2026-11-01T15:00:00+01:00", "job": "other_job", "outcome": "budget"}');
select public.t_call('{"created_at": "2026-11-01T16:00:00+01:00", "job": "other_job", "outcome": "refused", "cost_usd": 0.01}');
--   01.07 00:30 in Oslo in summer — still 30.06 (22:30) in UTC.
select public.t_call('{"created_at": "2026-06-30T22:30:00+00:00", "cost_usd": 0.07}');
--   The second account, at the same time as one of the owner's.
select public.t_call('{"created_at": "2026-11-01T12:00:00+01:00", "user_id": "00000000-0000-0000-0000-000000000002", "cost_usd": 4}');
reset role;
select set_config('test.uid', '', false);
set role authenticated;
select public.t_ok((select jsonb_agg(to_jsonb(u) order by u.day, u.job, u.mode, u.model) from public.ai_usage('2026-10-31T00:00:00+01:00', '2026-11-02T00:00:00+01:00') u) = $j$[
  {"day": "2026-10-31", "job": "item_fill", "mode": "live", "model": "claude-haiku-5-5", "calls": 1, "failed": 0, "input_tokens": 100, "cache_read_tokens": 1000, "cache_write_tokens": 30, "output_tokens": 50, "thinking_tokens": 5, "cost_usd": 0.001000},
  {"day": "2026-11-01", "job": "item_fill", "mode": "batch", "model": "claude-haiku-5-5", "calls": 1, "failed": 0, "input_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cost_usd": 0.000500},
  {"day": "2026-11-01", "job": "item_fill", "mode": "live", "model": "claude-haiku-5-5", "calls": 2, "failed": 1, "input_tokens": 500, "cache_read_tokens": 5000, "cache_write_tokens": 180, "output_tokens": 130, "thinking_tokens": 13, "cost_usd": 0.005000},
  {"day": "2026-11-01", "job": "item_fill", "mode": "live", "model": "claude-sonnet-5-5", "calls": 1, "failed": 1, "input_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "output_tokens": 2000, "thinking_tokens": 0, "cost_usd": 0.500000},
  {"day": "2026-11-01", "job": "other_job", "mode": "live", "model": "claude-haiku-5-5", "calls": 2, "failed": 2, "input_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cost_usd": 0.010000}
]$j$::jsonb,
  'ai_usage: one line per Oslo day, job, mode and model — the call at 00:30 on 01.11 (31.10 in UTC) is 01.11''s, failed counts every outcome but ok, cache writes are the 5-minute and the 1-hour ones together, and the second account''s call is not there');
select public.t_ok((select array_agg(u.day::text || '/' || u.job || '/' || u.mode || '/' || u.model) from public.ai_usage('2026-10-31T00:00:00+01:00', '2026-11-02T00:00:00+01:00') u)
                     = array['2026-10-31/item_fill/live/claude-haiku-5-5', '2026-11-01/item_fill/batch/claude-haiku-5-5', '2026-11-01/item_fill/live/claude-haiku-5-5',
                             '2026-11-01/item_fill/live/claude-sonnet-5-5', '2026-11-01/other_job/live/claude-haiku-5-5'],
  'ai_usage answers in order: day, job, mode, model');
select public.t_ok((select count(*) = 1 and bool_and(u.day = date '2026-07-01' and u.calls = 1 and u.cost_usd = 0.07)
                      from public.ai_usage('2026-06-30T00:00:00+02:00', '2026-07-02T00:00:00+02:00') u),
  'in summer too: 00:30 in Oslo on 01.07 (22:30 on 30.06 in UTC) is 01.07');
select public.t_ok((select coalesce(sum(u.calls), 0) = 0 from public.ai_usage('2026-10-31T00:00:00+01:00', '2026-10-31T23:30:00+01:00') u)
                   and (select sum(u.calls) = 1 from public.ai_usage('2026-10-31T23:30:00+01:00', '2026-10-31T23:30:00.000001+01:00') u),
  'the range takes its start and leaves its end out');
select public.t_ok((select count(*) = 0 from public.ai_usage('2026-01-01T00:00:00+01:00', '2026-02-01T00:00:00+01:00')), 'a range with no calls answers no lines');
select public.t_none((select string_agg(q, ' | ') from unnest(array[
    $$select * from public.ai_usage('2026-11-01T00:00:00+01:00', '2026-11-01T00:00:00+01:00')$$,
    $$select * from public.ai_usage('2026-11-02T00:00:00+01:00', '2026-11-01T00:00:00+01:00')$$,
    $$select * from public.ai_usage(null, '2026-11-01T00:00:00+01:00')$$,
    $$select * from public.ai_usage('2026-11-01T00:00:00+01:00', null)$$,
    $$select * from public.ai_usage('-infinity', '2026-11-01T00:00:00+01:00')$$,
    $$select * from public.ai_usage('2026-11-01T00:00:00+01:00', 'infinity')$$,
    $$select * from public.ai_usage('2025-01-01T00:00:00+00:00', '2026-02-05T00:00:01+00:00')$$,
    $$select * from public.ai_usage('2000-01-01T00:00:00+00:00', '2026-11-01T00:00:00+00:00')$$]) q
  where public.t_err(q) is distinct from '22023'),
  'ai_usage refuses an empty range, a backwards one, one without a start or an end, an endless one, and one over 400 days (by a second, and by years)');
select public.t_ok(public.t_err($$select * from public.ai_usage('2025-01-01T00:00:00+00:00', '2026-02-05T00:00:00+00:00')$$) is null, 'exactly 400 days is taken');
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
select public.t_ok((select count(*) = 1 and bool_and(u.calls = 1 and u.cost_usd = 4) from public.ai_usage('2026-10-31T00:00:00+01:00', '2026-11-02T00:00:00+01:00') u),
  'the second account''s ai_usage over the same days holds its one call');
reset role;
truncate public.ai_calls;

-- ─── 6. ai_gate: this Oslo month, today, the last minute ─────────────────────
-- One transaction, so now() stands still: every row is placed against the same moment the gate reads. The clock
-- can't be set, so the rows are placed around the start of the month and of the day the test runs in: half an hour
-- before the Oslo month starts is 23:30 on the last day of the month before (31.10 23:30 is not November), and
-- half an hour after it is still the month before in UTC. Accounts 4, 5 and 6 each carry one question, so the
-- answer never depends on the day or the minute the test runs.
begin;
create temp table t_at on commit drop as
select now() as n,
       (date_trunc('month', now() at time zone 'Europe/Oslo')) at time zone 'Europe/Oslo' as m,
       (date_trunc('day', now() at time zone 'Europe/Oslo')) at time zone 'Europe/Oslo' as d;
select public.t_ok((select to_char(m at time zone 'Europe/Oslo', 'DD HH24:MI:SS') = '01 00:00:00'
                           and to_char(d at time zone 'Europe/Oslo', 'HH24:MI:SS') = '00:00:00'
                           and to_char((m - interval '30 minutes') at time zone 'Europe/Oslo', 'HH24:MI') = '23:30'
                           and to_char((m - interval '30 minutes') at time zone 'Europe/Oslo', 'YYYY-MM') <> to_char(n at time zone 'Europe/Oslo', 'YYYY-MM')
                           and to_char((m + interval '30 minutes') at time zone 'Europe/Oslo', 'YYYY-MM') = to_char(m at time zone 'Europe/Oslo', 'YYYY-MM')
                           and to_char((m + interval '30 minutes') at time zone 'UTC', 'YYYY-MM') <> to_char(m at time zone 'Europe/Oslo', 'YYYY-MM')
                           and to_char((d + interval '30 minutes') at time zone 'UTC', 'YYYY-MM-DD') <> to_char(d at time zone 'Europe/Oslo', 'YYYY-MM-DD')
                      from t_at),
  'the chosen times: 23:30 in Oslo on the last day of the month before, and 00:30 on the 1st and today, which UTC still counts to the day before');
-- Account 4 — the month. 3.00 before it starts, 0.26 in it: 0.25 for item_fill, 0.01 for other_job.
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000004', 'created_at', m - interval '30 minutes', 'cost_usd', 1)) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000004', 'created_at', m - interval '1 microsecond', 'cost_usd', 2)) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000004', 'created_at', m, 'cost_usd', 0.01, 'job', 'other_job', 'outcome', 'error')) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000004', 'created_at', m + interval '30 minutes', 'cost_usd', 0.25, 'outcome', 'cut_off')) from t_at;
-- Account 5 — today. Two before midnight, two from it on, none of them ok.
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000005', 'created_at', d - interval '30 minutes', 'outcome', 'budget')) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000005', 'created_at', d - interval '1 microsecond', 'outcome', 'off')) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000005', 'created_at', d, 'outcome', 'bad_input')) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000005', 'created_at', d + interval '30 minutes', 'outcome', 'not_configured')) from t_at;
-- Account 6 — the last minute. Two inside the 60 seconds, three outside.
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000006', 'created_at', n - interval '30 seconds', 'outcome', 'budget')) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000006', 'created_at', n - interval '59 seconds', 'outcome', 'error')) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000006', 'created_at', n - interval '60 seconds')) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000006', 'created_at', n - interval '61 seconds')) from t_at;
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000006', 'created_at', n - interval '5 minutes')) from t_at;
-- Another account's spend, right now.
select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000002', 'cost_usd', 40));

set local role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000000004', true);
select public.t_ok((select count(*) = 1 and bool_and(g.month_cost = 0.26 and g.job_month_cost = 0.25) from public.ai_gate('item_fill') g),
  'ai_gate: the month''s cost starts at Oslo''s month start — 23:30 on the last day before it and the microsecond before it are out, the first moment and 00:30 (the month before in UTC) are in — and a failed call''s cost counts');
select public.t_ok((select g.month_cost = 0.26 and g.job_month_cost = 0.01 from public.ai_gate('other_job') g)
                   and (select g.month_cost = 0.26 and g.job_month_cost = 0 from public.ai_gate('no_such_job') g)
                   and (select g.month_cost = 0.26 and g.job_month_cost = 0 from public.ai_gate(null) g),
  'ai_gate: a job''s cost is that job''s only — another job''s, an unknown one''s and no job''s are their own or zero, the total stays');
select set_config('test.uid', '00000000-0000-0000-0000-000000000005', true);
select public.t_ok((select g.calls_today = 2 from public.ai_gate('item_fill') g),
  'ai_gate: today starts at Oslo midnight — 23:30 yesterday and the microsecond before midnight are out, midnight and 00:30 (yesterday in UTC) are in — whatever the outcome');
select set_config('test.uid', '00000000-0000-0000-0000-000000000006', true);
select public.t_ok((select g.calls_last_minute = 2 from public.ai_gate('item_fill') g),
  'ai_gate: the last minute is the 60 seconds before now — 30 and 59 seconds ago are in, 60 and 61 seconds and 5 minutes ago are out — whatever the outcome');
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', true);
select public.t_ok((select g.month_cost = 40 and g.job_month_cost = 40 and g.calls_last_minute = 1 and g.calls_today = 1 from public.ai_gate('item_fill') g),
  'ai_gate: the second account''s one call of 40 USD just now is its month, its job, its minute and its day — and nobody else''s rows are in it');
select set_config('test.uid', '', true);
select public.t_ok((select count(*) = 1 and bool_and(g.month_cost = 0 and g.job_month_cost = 0 and g.calls_last_minute = 0 and g.calls_today = 0)
                      from public.ai_gate('item_fill') g),
  'ai_gate: an account with no calls gets one row of zeros (the other accounts'' calls and 40 USD are not its)');
reset role;
commit;
truncate public.ai_calls;

-- ─── 7. The purge ────────────────────────────────────────────────────────────
-- The owner keeps text 7 days, account 2 has no settings row (30), account 4 keeps 90, account 5 keeps 1.
update public.ai_settings set log_days = 7 where user_id = '00000000-0000-0000-0000-000000000001';
delete from public.ai_settings where user_id = '00000000-0000-0000-0000-000000000002';
insert into public.ai_settings (user_id, log_days) values ('00000000-0000-0000-0000-000000000004', 90), ('00000000-0000-0000-0000-000000000005', 1);
create table public.t_purge (id uuid primary key, goes boolean not null, has_text boolean not null, numbers jsonb);
create or replace function public.t_old(p_user integer, p_age interval, p_goes boolean, p_text jsonb default '{"request": {"text": "Dentist on Tuesday"}, "response": {"fill": {"title": "Dentist"}}, "thinking": "A dentist visit."}'::jsonb)
returns void language sql as $$
  insert into public.t_purge (id, goes, has_text)
  select public.t_call(jsonb_build_object('user_id', '00000000-0000-0000-0000-00000000000' || p_user, 'created_at', now() - p_age,
    'input_tokens', 123, 'output_tokens', 45, 'thinking_tokens', 6, 'cost_usd', 0.004321, 'duration_ms', 900, 'request_id', 'req_test',
    'stop_reason', 'end_turn', 'served_model', 'claude-haiku-5-5', 'effort', 'low', 'instructions_version', 'v1', 'tools', '[{"name": "x"}]'::jsonb) || p_text), p_goes, p_text <> '{}'::jsonb
$$;
select public.t_old(1, interval '8 days', true);
select public.t_old(1, interval '7 days 1 minute', true);
select public.t_old(1, interval '6 days 22 hours', false);
select public.t_old(1, interval '1 hour', false);
select public.t_old(1, interval '30 days', true, '{"thinking": "Only the summary was kept."}');
select public.t_old(1, interval '30 days', true, '{"request": {"text": "Only the request"}}');
select public.t_old(1, interval '40 days', false, '{}');
select public.t_old(2, interval '31 days', true);
select public.t_old(2, interval '29 days', false);
select public.t_old(4, interval '91 days', true);
select public.t_old(4, interval '89 days', false);
select public.t_old(5, interval '2 days', true);
select public.t_old(5, interval '12 hours', false);
update public.t_purge p set numbers = to_jsonb(c) - 'request' - 'response' - 'thinking' from public.ai_calls c where c.id = p.id;

select set_config('test.uid', 'none', false);
set role service_role;
select public.t_ok(public.ai_calls_purge_text() = 7,
  'the purge answers 7: each account''s calls older than its own log_days — 7 for the owner, 30 with no settings row, 90, 1 — and a call with no text is not counted');
reset role;
select public.t_ok((select bool_and(c.request is null and c.response is null and c.thinking is null) from public.ai_calls c join public.t_purge p using (id) where p.goes),
  'request, response and thinking are gone from every one of them');
select public.t_ok((select count(*) = 5 and bool_and(c.request is not null and c.response is not null and c.thinking is not null)
                      from public.ai_calls c join public.t_purge p using (id) where not p.goes and p.has_text),
  'the five calls inside their days keep all three: a minute over the owner''s 7 days goes, two hours under stays');
select public.t_ok((select count(*) = 13 and bool_and(to_jsonb(c) - 'request' - 'response' - 'thinking' = p.numbers) from public.ai_calls c join public.t_purge p using (id)),
  'the numbers of all 13 calls are as they were: tokens, cost, time, outcome, model, tools');
set role service_role;
select public.t_ok(public.ai_calls_purge_text() = 0, 'a second run clears nothing and answers 0');
reset role;
-- The timer's own command, as it is stored.
do $$
declare
  n integer;
begin
  execute (select command from cron.job where jobname = 'lascis-ai-log-purge') into n;
  perform public.t_ok(n = 0, 'the timer''s stored command runs the purge');
end $$;

-- Tables of the same names in a schema put first on the search path change nothing: the purge names its own.
create schema hostile;
create table hostile.ai_settings (user_id uuid, log_days smallint);
insert into hostile.ai_settings select id, 1 from auth.users;
grant usage on schema hostile to service_role;
grant all on all tables in schema hostile to service_role;
set search_path = hostile, public;
set role service_role;
select public.t_ok(public.ai_calls_purge_text() = 0
                   and (select count(*) = 5 from public.ai_calls where request is not null and thinking is not null),
  'a look-alike ai_settings earlier on the search path (1 day for everyone) does not shorten anyone''s days');
reset role;
reset search_path;
drop schema hostile cascade;

-- log_days is held to 1–90 in the purge itself: with the CHECK gone, 0 is 1 and 30000 is 90.
begin;
alter table public.ai_settings drop constraint ai_settings_log_days_check;
update public.ai_settings set log_days = 0 where user_id = '00000000-0000-0000-0000-000000000005';
update public.ai_settings set log_days = 30000 where user_id = '00000000-0000-0000-0000-000000000004';
update public.ai_calls set request = '{"again": true}'::jsonb where user_id = '00000000-0000-0000-0000-000000000004' and created_at < now() - interval '90 days';
select public.t_ok(public.ai_calls_purge_text() = 1
                   and (select request is not null from public.ai_calls where user_id = '00000000-0000-0000-0000-000000000005' and created_at > now() - interval '1 day')
                   and not exists (select 1 from public.ai_calls where user_id = '00000000-0000-0000-0000-000000000004' and created_at < now() - interval '90 days' and request is not null),
  'were the CHECK ever gone: 0 days still keeps a 12-hour-old text (1 day), and 30000 days still clears a 91-day-old one (90 days)');
rollback;
drop function public.t_old(integer, interval, boolean, jsonb);
drop table public.t_purge;

-- ─── 8. Deleting an account ──────────────────────────────────────────────────
delete from auth.users where id = '00000000-0000-0000-0000-000000000005';
select public.t_ok(not exists (select 1 from public.ai_calls where user_id = '00000000-0000-0000-0000-000000000005')
                   and not exists (select 1 from public.ai_settings where user_id = '00000000-0000-0000-0000-000000000005')
                   and exists (select 1 from public.ai_calls where user_id = '00000000-0000-0000-0000-000000000001'),
  'deleting an account takes its calls and settings with it, and nobody else''s');
