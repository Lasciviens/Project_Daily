-- Migration 199 (AI suggestions): who may read and write ai_suggestions and ai_suggest_runs, the one column the browser may
-- change, the plain-text CHECKs, the dedupe and caps of ai_suggestion_add, the counting function, and the check timer.
-- test.uid picks the account: 1 = the owner, 2 = a second allowed account, 3 = signed in but not let in, 'none' = the service role.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text) to anon, authenticated, service_role;

-- ─── 1. What 199 made ────────────────────────────────────────────────────────
select public.t_ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.ai_suggestions'::regclass, 'public.ai_suggest_runs'::regclass))
                   and (select count(*) = 2 from pg_policies where schemaname = 'public' and policyname = 'app_owner_lock' and tablename in ('ai_suggestions', 'ai_suggest_runs')),
  '199: row level security and the owner lock are on both tables');
select public.t_ok((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = 'public.ai_suggestions'::regclass and a.attnum > 0 and not a.attisdropped
                     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')) = array['state'],
  '199: the browser may change exactly one column of ai_suggestions: state');
select public.t_ok(not has_table_privilege('authenticated', 'public.ai_suggestions', 'insert, delete, truncate')
                   and not has_any_column_privilege('authenticated', 'public.ai_suggestions', 'insert'),
  '199: the browser cannot add or delete an idea');
select public.t_ok((select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = 'public.ai_suggest_runs'::regclass and a.attnum > 0 and not a.attisdropped
                     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select'))
                   = array['added', 'call_id', 'created_at', 'failure', 'finished_at', 'id', 'made_by', 'patterns', 'sent_text', 'status', 'user_id', 'week_start'],
  '199: the browser reads the finished columns of a run, never batch_id or claimed_at');
select public.t_ok(not has_any_column_privilege('authenticated', 'public.ai_suggest_runs', 'insert, update, references'), '199: the browser writes no run');
select public.t_ok(not has_table_privilege('anon', 'public.ai_suggestions', 'select, update') and not has_any_column_privilege('anon', 'public.ai_suggestions', 'select, update, insert')
                   and not has_any_column_privilege('anon', 'public.ai_suggest_runs', 'select, insert, update'), '199: a signed-out caller has no right on either table');
select public.t_ok(not has_function_privilege('authenticated', 'public.ai_suggestion_add(uuid, text, text, text, text, text, integer, integer, numeric, uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.ai_suggestion_add(uuid, text, text, text, text, text, integer, integer, numeric, uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.ai_suggest_patterns(uuid, integer, integer)', 'execute')
                   and not has_function_privilege('anon', 'public.ai_suggest_patterns(uuid, integer, integer)', 'execute')
                   and has_function_privilege('service_role', 'public.ai_suggestion_add(uuid, text, text, text, text, text, integer, integer, numeric, uuid)', 'execute')
                   and has_function_privilege('service_role', 'public.ai_suggest_patterns(uuid, integer, integer)', 'execute'),
  '199: only the service role may call the two functions');
select public.t_ok(not (select prosecdef from pg_proc where oid = 'public.ai_suggestion_add(uuid, text, text, text, text, text, integer, integer, numeric, uuid)'::regprocedure)
                   and not (select prosecdef from pg_proc where oid = 'public.ai_suggest_patterns(uuid, integer, integer)'::regprocedure),
  '199: both functions are SECURITY INVOKER (no rights of their own)');
select public.t_ok((select a.atthasdef from pg_attribute a where a.attrelid = 'public.ai_suggestions'::regclass and a.attname = 'user_id') = false,
  '199: user_id has no default (the function sets it from the account it verified)');
select public.t_ok(exists (select 1 from pg_trigger where tgrelid = 'public.ai_suggestions'::regclass and tgname = 'trg_audit' and not tgisinternal),
  '199: a change of state is audited');

-- ─── 2. Writing ideas (the service role) ─────────────────────────────────────
select set_config('test.uid', 'none', false);
set role service_role;
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'Show today''s protein on Home', 'It was asked for five times in a month.', 'answer', repeat('a', 64), 1, 3000, 0.0042, null) = 'added',
  '199: a new idea is added');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'Reworded title the same idea', 'Again.', 'answer', repeat('a', 64), 1, 3000, 0.0042, null) = 'seen',
  '199: the same key is seen again');
select public.t_ok((select times_seen = 2 and title = 'Show today''s protein on Home' and count(*) over () = 1 from public.ai_suggestions where dedupe_key = repeat('a', 64)),
  '199: the same key is a count, never a second row, and the first text stays');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000002', 'widget', 'Show today''s protein on Home', 'Other account.', 'answer', repeat('a', 64), 1, 0, 0, null) = 'added',
  '199: the same key in another account is its own idea');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'gadget', 'A thing', 'Because.', 'answer', repeat('b', 64), 1, 0, 0, null) = 'invalid',
  '199: an unknown kind is refused');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'Has <b>markup</b>', 'Because.', 'answer', repeat('c', 64), 1, 0, 0, null) = 'invalid'
                   and public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'A link idea', 'See https://example.com now', 'answer', repeat('c', 64), 1, 0, 0, null) = 'invalid'
                   and public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'A link idea', 'See WWW.example.com now', 'answer', repeat('c', 64), 1, 0, 0, null) = 'invalid'
                   and public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', E'Two\nlines', 'Because.', 'answer', repeat('c', 64), 1, 0, 0, null) = 'invalid'
                   and public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'ab', 'Because.', 'answer', repeat('c', 64), 1, 0, 0, null) = 'invalid'
                   and public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', repeat('x', 121), 'Because.', 'answer', repeat('c', 64), 1, 0, 0, null) = 'invalid',
  '199: a title or text with markup, a link, a new line, or the wrong length is refused (plain text only)');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'chart', 'Vi viser søvn og skritt i én graf', 'Ofte spurt om, æøå.', 'answer', repeat('d', 64), 1, 0, 0, null) = 'added',
  '199: letters like æ, ø and å pass');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'A thing', 'Because.', 'answer', 'not-a-hash', 1, 0, 0, null) = 'invalid'
                   and public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'A thing', 'Because.', 'answer', repeat('e', 64), 1, 0, 0, '99999999-0000-4000-8000-000000000009') = 'invalid',
  '199: a key that is not a 64-character hash, or a call that does not exist, is refused');
select public.t_ok(public.t_err($q$select public.ai_suggestion_add(null, 'widget', 'A thing', 'Because.', 'answer', repeat('f', 64), 1, 0, 0, null)$q$) = '42501',
  '199: no account, no write');
select public.t_ok(public.t_err($q$update public.ai_suggestions set times_seen = 5 where dedupe_key = repeat('a', 64)$q$) is null, '199: the service role changes a count');
select public.t_ok((select state_changed_at is null and state = 'new' from public.ai_suggestions where dedupe_key = repeat('a', 64) limit 1), '199: and leaves the state alone');

-- ─── 3. The owner changes the state, and nothing else ────────────────────────
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok((select count(*) = 2 from public.ai_suggestions), '199: the owner reads their own ideas, not the other account''s');
select public.t_ok(public.t_err($q$update public.ai_suggestions set state = 'kept' where dedupe_key = repeat('a', 64)$q$) is null, '199: the owner keeps an idea');
select public.t_ok((select state = 'kept' and state_changed_at is not null from public.ai_suggestions where user_id = '00000000-0000-0000-0000-000000000001' and dedupe_key = repeat('a', 64)),
  '199: the time of the change follows');
select public.t_ok(public.t_err($q$update public.ai_suggestions set times_seen = 999 where dedupe_key = repeat('a', 64)$q$) = '42501'
                   and public.t_err($q$update public.ai_suggestions set title = 'Build this now' where dedupe_key = repeat('a', 64)$q$) = '42501'
                   and public.t_err($q$update public.ai_suggestions set cost_each_usd = 0, tokens_each = 0, why = 'x y z' where dedupe_key = repeat('a', 64)$q$) = '42501'
                   and public.t_err($q$update public.ai_suggestions set first_call_id = null, dedupe_key = repeat('9', 64) where dedupe_key = repeat('a', 64)$q$) = '42501'
                   and public.t_err($q$update public.ai_suggestions set user_id = '00000000-0000-0000-0000-000000000002' where dedupe_key = repeat('a', 64)$q$) = '42501',
  '199: the browser cannot forge a count, a text, a saving, a key or an owner (permission denied)');
select public.t_ok(public.t_err($q$update public.ai_suggestions set state = 'deleted' where dedupe_key = repeat('a', 64)$q$) = '23514', '199: an unknown state is refused');
select public.t_ok(public.t_err($q$insert into public.ai_suggestions (user_id, kind, title, why, source, dedupe_key) values ('00000000-0000-0000-0000-000000000001', 'widget', 'Forged idea', 'Forged.', 'answer', repeat('7', 64))$q$) = '42501'
                   and public.t_err($q$delete from public.ai_suggestions where dedupe_key = repeat('a', 64)$q$) = '42501',
  '199: the browser can neither add nor delete an idea');
update public.ai_suggestions set state = 'dismissed' where user_id = '00000000-0000-0000-0000-000000000002';
reset role;
select public.t_ok((select state = 'new' from public.ai_suggestions where user_id = '00000000-0000-0000-0000-000000000002'), '199: the owner cannot change another account''s idea');
set role authenticated;
select public.t_ok(public.t_err($q$update public.ai_suggestions set state = 'dismissed' where dedupe_key = repeat('d', 64)$q$) is null, '199: the owner dismisses an idea');
select public.t_ok(public.t_err($q$select * from public.ai_suggest_runs$q$) = '42501', '199: the browser has no table-wide read of the runs');
select public.t_ok(public.t_err($q$select public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001')$q$) = '42501', '199: the browser cannot call the counting');
reset role;
select public.t_ok((select count(*) from public.audit_logs where table_name = 'ai_suggestions') >= 2, '199: the owner''s state changes are in the audit log');
select public.t_ok(not exists (select 1 from public.audit_logs where table_name = 'ai_suggestions' and new_data ? 'times_seen'), '199: a counter bump is not audited');

-- ─── 4. A signed-in account that is not let in, and a signed-out caller ──────
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok((select count(*) = 0 from public.ai_suggestions), '199: an account that is not let in reads nothing');
reset role;
set role anon;
select public.t_ok(public.t_err($q$select * from public.ai_suggestions$q$) = '42501', '199: a signed-out caller is refused');
reset role;

-- ─── 5. Dismissed never comes back; the caps ─────────────────────────────────
select set_config('test.uid', 'none', false);
set role service_role;
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'chart', 'Vi viser søvn og skritt i én graf', 'Ofte spurt om.', 'weekly', repeat('d', 64), 4, 0, 0, null) = 'dismissed',
  '199: a dismissed idea is refused');
select public.t_ok((select times_seen = 1 and state = 'dismissed' from public.ai_suggestions where dedupe_key = repeat('d', 64) and user_id = '00000000-0000-0000-0000-000000000001'),
  '199: a dismissed idea is never written again, not even as a count');
insert into public.ai_suggestions (user_id, kind, title, why, source, dedupe_key)
  select '00000000-0000-0000-0000-000000000004', 'widget', 'Idea number ' || g, 'Because.', 'answer', encode(sha256(g::text::bytea), 'hex') from generate_series(1, 19) g;
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000004', 'widget', 'Idea twenty', 'Because.', 'answer', repeat('1', 64), 1, 0, 0, null) = 'added'
                   and public.ai_suggestion_add('00000000-0000-0000-0000-000000000004', 'widget', 'Idea twenty-one', 'Because.', 'answer', repeat('2', 64), 1, 0, 0, null) = 'limit',
  '199: at most 20 new ideas a day from answers (the 21st is refused)');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000004', 'widget', 'A weekly idea', 'Because.', 'weekly', repeat('3', 64), 1, 0, 0, null) = 'added',
  '199: the weekly job is not held by the answers'' daily cap');
update public.ai_suggestions set created_at = now() - interval '3 days' where user_id = '00000000-0000-0000-0000-000000000004';
insert into public.ai_suggestions (user_id, kind, title, why, source, dedupe_key)
  select '00000000-0000-0000-0000-000000000004', 'widget', 'Old idea ' || g, 'Because.', 'weekly', encode(sha256(('o' || g)::bytea), 'hex') from generate_series(1, 300) g
  on conflict do nothing;
select public.t_ok((select count(*) from public.ai_suggestions where user_id = '00000000-0000-0000-0000-000000000004') >= 300, '199: the account is now at 300 ideas');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000004', 'widget', 'One too many', 'Because.', 'weekly', repeat('4', 64), 1, 0, 0, null) = 'full',
  '199: at most 300 ideas in all');

-- ─── 6. The runs ─────────────────────────────────────────────────────────────
insert into public.ai_suggest_runs (user_id, week_start, made_by) values ('00000000-0000-0000-0000-000000000001', '2026-11-16', 'schedule');
select public.t_ok(public.t_err($q$insert into public.ai_suggest_runs (user_id, week_start, made_by) values ('00000000-0000-0000-0000-000000000001', '2026-11-16', 'schedule')$q$) = '23505',
  '199: one scheduled run a week');
select public.t_ok(public.t_err($q$insert into public.ai_suggest_runs (user_id, week_start, made_by) values ('00000000-0000-0000-0000-000000000001', '2026-11-17', 'app')$q$) = '23514', '199: a week starts on a Monday');
select public.t_ok(public.t_err($q$update public.ai_suggest_runs set added = 6$q$) = '23514' and public.t_err($q$update public.ai_suggest_runs set batch_id = 'a/b'$q$) = '23514',
  '199: at most five added; a batch id of the right characters');
reset role;

-- ─── 7. The counting ─────────────────────────────────────────────────────────
-- Owner: 4 answers of get_week_figures > get_food_day, 3 answers that ran the same fallback query, a job that cost much, a job
-- that sent much and used little. Account 2 has the same shapes but only twice. A forged tool name is dropped.
set role service_role;
insert into public.ai_calls (id, user_id, run_id, step, job, caller, model, outcome, input_tokens, cache_read_tokens, output_tokens, cost_usd, tools, created_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000001', r, s, 'chat', 'app', 'claude-haiku-5-5', 'ok', 2000, 8000, 100, 0.01,
       case s when 1 then '[{"name":"get_week_figures","fields":["section","week"],"ok":true,"rows":null,"bytes":900,"ms":40},{"name":"Bad Name<x>","fields":[],"ok":true}]'::jsonb
              else '[{"name":"get_food_day","fields":["date"],"ok":true,"rows":null,"bytes":500,"ms":30}]'::jsonb end,
       now() - interval '2 days'
  from (select gen_random_uuid() r from generate_series(1, 4)) runs, generate_series(1, 2) s;
insert into public.ai_calls (id, user_id, run_id, step, job, caller, model, outcome, input_tokens, output_tokens, cost_usd, tools, created_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000001', gen_random_uuid(), 1, 'chat', 'app', 'claude-haiku-5-5', 'ok', 3000, 200, 0.02,
       '[{"name":"ask_database","fields":["sql"],"ok":true,"rows":3,"bytes":400,"ms":50,"fingerprint":"select sum(protein_g) from food_log_entries where day = ?"}]'::jsonb, now() - interval '1 day'
  from generate_series(1, 3);
insert into public.ai_calls (id, user_id, run_id, step, job, caller, model, outcome, input_tokens, output_tokens, cost_usd, created_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000001', gen_random_uuid(), 1, 'recipe_macros', 'app', 'claude-haiku-5-5', 'ok', 20000, 150, 0.04, now() - interval '3 days' from generate_series(1, 4);
insert into public.ai_calls (id, user_id, run_id, step, job, caller, model, outcome, input_tokens, output_tokens, cost_usd, tools, created_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000002', gen_random_uuid(), 1, 'chat', 'app', 'claude-haiku-5-5', 'ok', 3000, 200, 0.02,
       '[{"name":"get_food_day","fields":["date"],"ok":true}]'::jsonb, now() - interval '1 day' from generate_series(1, 2);
insert into public.ai_calls (id, user_id, run_id, step, job, caller, model, outcome, input_tokens, output_tokens, cost_usd, tools, created_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000001', gen_random_uuid(), 1, 'chat', 'app', 'claude-haiku-5-5', 'ok', 3000, 200, 0.02,
       '[{"name":"get_day_plan","fields":["date"],"ok":true}]'::jsonb, now() - interval '45 days' from generate_series(1, 5);
select public.t_ok((select count(*) = 1 from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001') where pattern_kind = 'tool_sequence' and pattern_key = 'get_week_figures > get_food_day' and times = 4),
  '199: the same two tools in the same order in 4 answers are one tool_sequence of 4');
select public.t_ok((select count(*) = 1 from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001') where pattern_kind = 'question_shape' and pattern_key = 'get_week_figures(section+week) > get_food_day(date)' and times = 4 and avg_cost_usd = 0.02),
  '199: the same tools with the same fields are a question_shape (a run''s cost is the sum of its rounds)');
select public.t_ok((select count(*) = 1 from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001') where pattern_kind = 'database_fingerprint' and times = 3 and pattern_key = 'select sum(protein_g) from food_log_entries where day = ?'),
  '199: the same fallback query, values taken out, in 3 answers is a database_fingerprint');
select public.t_ok(not exists (select 1 from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001') where pattern_key ~ '<|Bad|Name'), '199: a tool name the model made up is dropped');
select public.t_ok((select count(*) = 1 from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001') where pattern_kind = 'big_input_small_output' and pattern_key = 'recipe_macros' and times = 4),
  '199: a job with 20 000 input and 150 output tokens is big_input_small_output');
select public.t_ok((select pattern_key from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001') where pattern_kind = 'costly_job' order by total_cost_usd desc limit 1) = 'recipe_macros'
                   and (select count(*) = 2 from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001') where pattern_kind = 'costly_job'),
  '199: the dearest job is listed first as costly_job');
select public.t_ok(not exists (select 1 from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000001') where pattern_key = 'get_day_plan(date)'),
  '199: nothing older than 30 days is counted');
select public.t_ok(not exists (select 1 from public.ai_suggest_patterns('00000000-0000-0000-0000-000000000002')), '199: two times is not a pattern (the threshold is 3), and another account''s rows never count');
select public.t_ok(public.t_err($q$select public.ai_suggest_patterns(null)$q$) = '42501', '199: no account, no counting');
reset role;

-- ─── 8. The check timer ──────────────────────────────────────────────────────
select public.t_ok((select command ~ 'ai_suggest_runs' and command ~ 'claude-schedule-v1' and command !~ 'x-cron-secret' from cron.job where jobname = 'lascis-ai-report-check'),
  '199: the check timer also runs while a suggestion batch waits, with the same credential');
select public.t_ok((select count(*) = 1 from cron.job where jobname = 'lascis-ai-report-check'), '199: one check timer');
