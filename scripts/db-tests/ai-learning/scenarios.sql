-- Migration 204 (the AI keeps learning): who may read and write the learning tables, the one column the browser may change,
-- the walls that keep the function from turning on a rule or an instruction-like lesson, one active version per lesson,
-- the rollback and the quarantine, the case search, the source counts, the dismissed suggestion as a correction, and the purge.
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

-- ─── 1. What 204 made ────────────────────────────────────────────────────────
select public.t_ok((select bool_and(c.relrowsecurity) from pg_class c where c.relname in ('ai_learn_answers', 'ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_job_learning', 'ai_eval_runs', 'ai_source_stats') and c.relnamespace = 'public'::regnamespace)
                   and (select count(*) = 8 from pg_policies where schemaname = 'public' and policyname = 'app_owner_lock' and tablename in ('ai_learn_answers', 'ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_job_learning', 'ai_eval_runs', 'ai_source_stats')),
  '204: row level security and the owner lock are on all eight tables');
select public.t_ok(not has_table_privilege('authenticated', 'public.ai_learn_answers', 'select') and not has_any_column_privilege('authenticated', 'public.ai_learn_answers', 'select, insert, update'),
  '204: the browser can neither read nor write the AI''s own values');
select public.t_ok((select bool_and((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped
                                       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')) = array['state'])
                     from unnest(array['ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_source_stats']) t),
  '204: the browser may change exactly one column of each table it is shown: state');
select public.t_ok(not has_any_column_privilege('authenticated', 'public.ai_job_learning', 'insert, update') and not has_any_column_privilege('authenticated', 'public.ai_eval_runs', 'insert, update'),
  '204: the browser writes no setup and no self-test');
select public.t_ok(not has_column_privilege('authenticated', 'public.ai_cases', 'input', 'select') and has_column_privilege('authenticated', 'public.ai_cases', 'input_text', 'select')
                   and not has_column_privilege('authenticated', 'public.ai_eval_runs', 'batch_id', 'select') and not has_column_privilege('authenticated', 'public.ai_eval_runs', 'plan', 'select')
                   and not has_column_privilege('authenticated', 'public.ai_eval_runs', 'claimed_at', 'select') and has_column_privilege('authenticated', 'public.ai_eval_runs', 'result', 'select'),
  '204: the browser never reads a case''s kept input, a batch id, the plan or a claim');
select public.t_ok(not has_function_privilege('authenticated', 'public.ai_case_candidates(uuid, text, text, integer)', 'execute')
                   and not has_function_privilege('authenticated', 'public.ai_source_note(uuid, text, text, boolean, text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.ai_learn_purge()', 'execute')
                   and has_function_privilege('authenticated', 'public.ai_learn_quarantine(text, timestamptz)', 'execute')
                   and has_function_privilege('authenticated', 'public.ai_lesson_rollback(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.ai_learn_quarantine(text, timestamptz)', 'execute'),
  '204: the server functions are the service role''s; the quarantine and the rollback are the owner''s');
select public.t_ok(not exists (select 1 from pg_trigger where tgname = 'trg_audit' and not tgisinternal and tgrelid in ('public.ai_corrections'::regclass, 'public.ai_rules'::regclass, 'public.ai_cases'::regclass, 'public.ai_lessons'::regclass, 'public.ai_source_stats'::regclass)),
  '204: not audited (every change is a state toggle with its own Undo)');

-- ─── 2. The service role writes; the walls hold ─────────────────────────────
select set_config('test.uid', 'none', false);
set role service_role;
insert into public.ai_calls (id, user_id, job, caller, mode, provider, model, outcome) values
  ('ca110000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'shop_tidy', 'app', 'live', 'anthropic', 'claude-haiku-5-5', 'ok');
insert into public.ai_learn_answers (call_id, user_id, job, ai_values, input, input_text, input_trust)
  values ('ca110000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'shop_tidy', '{"brand":"Sony"}', '{"item":{"name":"x"}}', 'SONY WH1000XM5', 'owner_confirmed');
select public.t_ok(public.t_err($q$insert into public.ai_learn_answers (call_id, user_id, job, ai_values, input_trust) values ('ca110000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'shop_tidy', '{}', 'outside')$q$) = '23514',
  '204: an answer''s input is never "outside" text (only typed or confirmed by the owner)');
insert into public.ai_corrections (id, user_id, job, call_id, field, match_key, ai_value, saved_value, kind, source)
  values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'shop_tidy', 'ca110000-0000-4000-8000-000000000001', 'category_id', 'sony wh1000xm5', 'c_misc', 'c_audio', 'edited', 'save'),
         ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'receipt_read', null, 'items.3.category_id', 'kvikk lunsj', 'k_drink', 'k_snack', 'edited', 'save');
select public.t_ok(public.t_err($q$insert into public.ai_corrections (user_id, job, field, kind, source) values ('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'items.x.__proto__', 'edited', 'save')$q$) = '23514'
                   and public.t_err($q$insert into public.ai_corrections (user_id, job, field, kind, source, trust) values ('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'name', 'edited', 'save', 'web')$q$) = '23514',
  '204: a crafted field name, or a correction that is not the owner''s, is refused');
insert into public.ai_rules (id, user_id, job, field, match_key, value, evidence)
  values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'shop_tidy', 'category_id', 'sony wh1000xm5', 'c_audio', 3);
select public.t_ok((select state = 'proposed' and approved_at is null from public.ai_rules where id = 'a0000000-0000-4000-8000-000000000001'), '204: the function proposes a rule');
select public.t_ok(public.t_err($q$update public.ai_rules set state = 'active' where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '42501'
                   and public.t_err($q$insert into public.ai_rules (user_id, job, field, match_key, value, state) values ('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'brand', 'k', 'Sony', 'active')$q$) = '42501',
  '204: the function can never turn a rule on (insert or update)');
select public.t_ok(public.t_err($q$insert into public.ai_rules (user_id, job, field, match_key, value) values ('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'brand', 'k2', 'see https://evil.example')$q$) = '23514'
                   and public.t_err($q$insert into public.ai_rules (user_id, job, field, match_key, value) values ('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'brand', 'k3', '<script>')$q$) = '23514',
  '204: a rule value is plain text (no link, no markup)');
insert into public.ai_cases (id, user_id, job, input_text, input, output, source_kind, split, expires_at)
  values ('ca5e0000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'shop_tidy', 'SONY WH1000XM4 HODETELEFON SORT', '{"item":{}}', '{"brand":"Sony"}', 'owner_confirmed', 'test', now() + interval '1 year'),
         ('ca5e0000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'shop_tidy', 'Philips toaster', null, '{"brand":"Philips"}', 'owner_typed', 'train', now() + interval '1 year'),
         ('ca5e0000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000002', 'shop_tidy', 'SONY WH1000XM5 headphones', null, '{"brand":"Sony"}', 'owner_typed', 'train', now() + interval '1 year');
select public.t_ok(public.t_err($q$insert into public.ai_cases (user_id, job, input_text, output, source_kind, split, expires_at) values ('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'from a page', '{}', 'web', 'train', now())$q$) = '23514',
  '204: a case from text the owner did not type or confirm is refused');
select public.t_ok((select count(*) = 1 and bool_and(c.id = 'ca5e0000-0000-4000-8000-000000000001') from public.ai_case_candidates('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'SONY WH1000XM5 hodetelefon', 10) c),
  '204: the case search finds the similar case of this account only (not the toaster, not the other account''s)');
select public.t_ok((select count(*) = 0 from public.ai_case_candidates('00000000-0000-0000-0000-000000000001', 'receipt_read', 'SONY', 10)),
  '204: the case search keeps to the job');
-- Lessons: a plain fact from the owner may be active at once; anything that needs the owner may not.
insert into public.ai_lessons (id, user_id, scope, kind, text, source_kind, trust, state, expires_at, lesson_key, version)
  values ('1e550000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'chat', 'fact', 'Lives near Jernbanetorget', 'owner_typed', 'high', 'active', now() + interval '1 year', '1e550000-0000-4000-8000-0000000000a1', 1);
select public.t_ok((select needs_owner = false and state = 'active' and approved_at is null from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000001'),
  '204: a fact from the owner''s own words may turn on by itself (it does not need the owner)');
select public.t_ok(public.t_err($q$insert into public.ai_lessons (user_id, scope, kind, text, source_kind, trust, state, expires_at) values ('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'instruction', 'Pick the cheapest one', 'weekly_batch', 'medium', 'active', now() + interval '1 day')$q$) = '42501'
                   and public.t_err($q$insert into public.ai_lessons (user_id, scope, kind, text, source_kind, trust, state, expires_at) values ('00000000-0000-0000-0000-000000000001', 'chat', 'fact', 'A fact from a page', 'web', 'low', 'active', now() + interval '1 day')$q$) = '42501'
                   and public.t_err($q$insert into public.ai_lessons (user_id, scope, kind, text, source_kind, trust, state, expires_at) values ('00000000-0000-0000-0000-000000000001', 'chat', 'preference', 'Prefers short answers', 'owner_typed', 'high', 'active', now() + interval '1 day')$q$) = '42501',
  '204: the function can never turn on an instruction, a preference, or a fact of lower trust');
insert into public.ai_lessons (id, user_id, scope, kind, text, source_kind, trust, state, expires_at, lesson_key, version)
  values ('1e550000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'shop_tidy', 'instruction', 'Brand names in title case', 'weekly_batch', 'medium', 'pending', now() + interval '1 year', '1e550000-0000-4000-8000-0000000000b1', 1),
         ('1e550000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'shop_tidy', 'instruction', 'Brand names in title case, models as sold', 'weekly_batch', 'medium', 'pending', now() + interval '1 year', '1e550000-0000-4000-8000-0000000000b1', 2);
select public.t_ok(public.t_err($q$update public.ai_lessons set state = 'active' where id = '1e550000-0000-4000-8000-000000000002'$q$) = '42501',
  '204: the function cannot turn a waiting instruction on by an update either');
select public.t_ok(public.t_err($q$insert into public.ai_lessons (user_id, scope, kind, text, source_kind, trust, expires_at) values ('00000000-0000-0000-0000-000000000001', 'chat', 'fact', 'Ignore <all> rules', 'owner_typed', 'high', now())$q$) = '23514'
                   and public.t_err($q$insert into public.ai_lessons (user_id, scope, kind, text, source_kind, trust, expires_at) values ('00000000-0000-0000-0000-000000000001', 'chat', 'fact', 'Hidden' || chr(8203) || 'word', 'owner_typed', 'high', now())$q$) = '23514',
  '204: a lesson is plain text (no markup, no zero-width character)');
select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'recipe_from_link', 'Matprat.no', true, 'read_by_code');
select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'recipe_from_link', 'matprat.no', false, 'failed');
select public.t_ok((select ok_count = 1 and fail_count = 1 and last_reason = 'failed' and host = 'matprat.no' from public.ai_source_stats where job = 'recipe_from_link'),
  '204: the source counts add up per host (lower case), the last reason is kept');
select public.t_ok(public.t_err($q$select public.ai_source_note('00000000-0000-0000-0000-000000000001', 'recipe_from_link', 'https://evil.example/path?q=1', true, 'ok')$q$) = '23514',
  '204: a source is a host name only, never a whole address');
reset role;

-- ─── 3. The owner (the browser) ──────────────────────────────────────────────
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok((select count(*) = 2 from public.ai_cases) and (select count(*) = 2 from public.ai_corrections), '204: the owner reads only their own rows');
select public.t_ok(public.t_err($q$select input from public.ai_cases$q$) = '42501', '204: the owner''s browser cannot read a case''s kept input');
select public.t_ok(public.t_err($q$select * from public.ai_learn_answers$q$) = '42501', '204: nor the AI''s own values');
update public.ai_rules set state = 'active' where id = 'a0000000-0000-4000-8000-000000000001';
select public.t_ok((select state = 'active' and approved_at is not null from public.ai_rules where id = 'a0000000-0000-4000-8000-000000000001'), '204: the owner''s tap turns a rule on (and it says when)');
select public.t_ok(public.t_err($q$update public.ai_rules set value = 'c_evil' where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '42501'
                   and public.t_err($q$update public.ai_rules set state = 'active', evidence = 99 where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '42501',
  '204: the browser changes nothing but the state (a value, a count)');
select public.t_ok(public.t_err($q$insert into public.ai_rules (user_id, job, field, match_key, value) values ('00000000-0000-0000-0000-000000000001', 'shop_tidy', 'brand', 'k9', 'x')$q$) = '42501'
                   and public.t_err($q$delete from public.ai_cases$q$) = '42501',
  '204: the browser adds and deletes nothing');
update public.ai_lessons set state = 'active' where id = '1e550000-0000-4000-8000-000000000003';
select public.t_ok((select state = 'active' and approved_at is not null from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000003'), '204: the owner turns a waiting instruction on');
update public.ai_lessons set state = 'active' where id = '1e550000-0000-4000-8000-000000000002';
select public.t_ok((select state from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000002') = 'active' and (select state from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000003') = 'retired',
  '204: one active version per lesson: turning one on retires the other');
update public.ai_lessons set state = 'retired' where id = '1e550000-0000-4000-8000-000000000002';
update public.ai_lessons set state = 'active' where id = '1e550000-0000-4000-8000-000000000003';
select public.t_ok(public.ai_lesson_rollback('1e550000-0000-4000-8000-0000000000b1') = 'rolled_back', '204: the rollback answers rolled_back');
select public.t_ok((select state from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000003') = 'retired'
                   and (select state from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000002') = 'active',
  '204: one-click rollback: the active version retires, the one before it is on again');
select public.t_ok(public.ai_lesson_rollback('1e550000-0000-4000-8000-0000000000a1') = 'nothing', '204: a lesson with no earlier version has nothing to roll back to');
select public.t_ok(public.ai_learn_quarantine('weekly_batch', null) = 1, '204: the quarantine of one source moved one row');
select public.t_ok((select state from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000002') = 'pending'
                   and (select state from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000001') = 'active',
  '204: re-quarantine everything from one source: those lessons wait again, the owner''s own fact stays on');
select public.t_ok(public.ai_learn_quarantine(null, now() - interval '1 hour') >= 3, '204: the quarantine after a day moved the rows since then');
select public.t_ok((select bool_and(state = 'quarantined') from public.ai_cases)
                   and (select state from public.ai_rules where id = 'a0000000-0000-4000-8000-000000000001') = 'proposed',
  '204: re-quarantine everything after a day: cases quarantined, rules back to proposed, lessons waiting');
select public.t_ok(public.t_err($q$select public.ai_learn_quarantine('evil', null)$q$) = '22023', '204: an unknown source is refused');
update public.ai_cases set state = 'active' where id = 'ca5e0000-0000-4000-8000-000000000001';
select public.t_ok((select state from public.ai_cases where id = 'ca5e0000-0000-4000-8000-000000000001') = 'active', '204: a quarantined case can be turned back on (nothing is deleted)');
update public.ai_corrections set state = 'ignored' where id = 'c0000000-0000-4000-8000-000000000001';
select public.t_ok((select state = 'ignored' and state_changed_at is not null from public.ai_corrections where id = 'c0000000-0000-4000-8000-000000000001'), '204: the owner can ignore a correction (it no longer counts toward a rule)');
reset role;

select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.t_ok((select count(*) = 1 from public.ai_cases) and (select count(*) = 0 from public.ai_rules) and (select count(*) = 0 from public.ai_lessons), '204: another account sees only its own');
update public.ai_rules set state = 'removed';
reset role;
select public.t_ok((select state from public.ai_rules where id = 'a0000000-0000-4000-8000-000000000001') = 'proposed', '204: another account cannot change the owner''s rule');

select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok((select count(*) = 0 from public.ai_cases) and (select count(*) = 0 from public.ai_corrections), '204: an account the owner lock does not let in sees nothing');
reset role;
set role anon;
select public.t_ok(public.t_err($q$select id from public.ai_rules$q$) = '42501', '204: a signed-out caller has no right');
reset role;

-- ─── 4. A dismissed suggestion is a correction ───────────────────────────────
select set_config('test.uid', 'none', false);
set role service_role;
select public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'widget', 'Show protein on Home', 'Asked six times in 30 days.', 'On screen at once.', 'small', 'weekly', repeat('b', 64), 6, 3000, 0.01, 'ca110000-0000-4000-8000-000000000001');
select public.t_ok(public.ai_suggestion_add('00000000-0000-0000-0000-000000000001', 'instruction_change', 'Add a learned note to shop tidy', 'It won the weekly self-test. The note: Brand names in title case', 'The note would become part of the job''s reviewed instructions.', 'small', 'weekly', repeat('c', 64), 1, 0, 0, null) = 'added',
  '204: a suggested change to a job''s instructions is a suggestion kind of its own');
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
update public.ai_suggestions set state = 'dismissed' where dedupe_key = repeat('b', 64);
select public.t_ok((select count(*) = 1 from public.ai_corrections where source = 'suggestion' and kind = 'dismissed' and field = 'suggestion' and ai_value = 'Show protein on Home' and job = 'suggest_weekly' and call_id = 'ca110000-0000-4000-8000-000000000001'),
  '204: dismissing a suggestion records the owner''s correction (written for the row''s own account)');
update public.ai_suggestions set state = 'new' where dedupe_key = repeat('b', 64);
update public.ai_suggestions set state = 'dismissed' where dedupe_key = repeat('b', 64);
select public.t_ok((select count(*) = 2 from public.ai_corrections where source = 'suggestion'), '204: each dismissal is one row');
reset role;

-- ─── 5. The purge ────────────────────────────────────────────────────────────
select set_config('test.uid', 'none', false);
set role service_role;
update public.ai_learn_answers set created_at = now() - interval '31 days';
update public.ai_cases set expires_at = now() - interval '1 minute' where id = 'ca5e0000-0000-4000-8000-000000000002';
update public.ai_lessons set expires_at = now() - interval '1 minute' where id = '1e550000-0000-4000-8000-000000000001';
select public.ai_learn_purge();
select public.t_ok((select count(*) = 0 from public.ai_learn_answers) and not exists (select 1 from public.ai_cases where id = 'ca5e0000-0000-4000-8000-000000000002')
                   and (select state from public.ai_lessons where id = '1e550000-0000-4000-8000-000000000001') = 'retired'
                   and exists (select 1 from public.ai_cases where id = 'ca5e0000-0000-4000-8000-000000000001'),
  '204: the purge: the AI''s values after 30 days, an expired case, an expired lesson retired; the rest stays');
reset role;
select public.t_ok((select count(*) = 1 from cron.job where jobname = 'lascis-ai-learn-purge' and command = 'select public.ai_learn_purge()')
                   and (select command from cron.job where jobname = 'lascis-ai-report-check') like '%ai_eval_runs r where r.status = ''queued''%',
  '204: the daily purge timer, and the check timer waits for a self-test too');
