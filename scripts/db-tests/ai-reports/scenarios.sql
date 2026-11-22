-- Migration 196 (the weekly reports): who may read and write ai_reports, what each CHECK refuses, the unique key, the
-- ledger link, and the two timers (what they send, to whom, and when they stay quiet). Setup and catalogue checks run
-- as the superuser, the reports are written as `service_role` (the claude function) and read as `authenticated`.
-- test.uid picks the account: 1 = the owner, 2 = a second allowed account, 3 = signed in but not let in, 'none' = none.
-- :expected_make / :expected_check are what Node computes for HMAC-SHA256('claude-schedule-v1', 'test-push-secret').
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

-- ─── 1. What 196 made ────────────────────────────────────────────────────────
select public.t_ok((select c.relrowsecurity from pg_class c where c.oid = 'public.ai_reports'::regclass)
                   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_reports' and policyname = 'app_owner_lock'),
  '196: row level security and the owner lock are on ai_reports');
select public.t_ok((select count(*) = 1 and bool_and(cmd = 'SELECT' and roles = '{authenticated}') from pg_policies
                     where schemaname = 'public' and tablename = 'ai_reports' and policyname <> 'app_owner_lock'),
  '196: ai_reports has one policy, and it only reads');
select public.t_ok(not has_table_privilege('authenticated', 'public.ai_reports', 'select')
                   and not has_table_privilege('authenticated', 'public.ai_reports', 'insert, update, delete, truncate, references, trigger')
                   and not has_any_column_privilege('authenticated', 'public.ai_reports', 'insert, update, references'),
  '196: the browser has no table-wide right on ai_reports and writes no column');
select public.t_ok((select array_agg(a.attname::text order by a.attname) from pg_attribute a
                     where a.attrelid = 'public.ai_reports'::regclass and a.attnum > 0 and not a.attisdropped
                       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select'))
                   = array['call_id', 'content', 'created_at', 'facts', 'failure', 'id', 'made_by', 'pushed_at', 'ready_at', 'status', 'user_id', 'week_start'],
  '196: the browser reads exactly the finished columns: never batch_id, never claimed_at');
select public.t_ok((select bool_and(not has_table_privilege('anon', 'public.ai_reports', p)) from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p)
                   and not has_any_column_privilege('anon', 'public.ai_reports', 'select, insert, update, references'),
  '196: a signed-out caller has no right on ai_reports');
select public.t_ok(has_table_privilege('service_role', 'public.ai_reports', 'select') and has_table_privilege('service_role', 'public.ai_reports', 'insert')
                   and has_table_privilege('service_role', 'public.ai_reports', 'update') and has_table_privilege('service_role', 'public.ai_reports', 'delete'),
  '196: the service role reads and writes ai_reports');
select public.t_ok(not exists (select 1 from pg_trigger where tgrelid = 'public.ai_reports'::regclass and not tgisinternal),
  '196: no trigger on ai_reports (a server-written log: no audit, Undo never reaches it)');
select public.t_ok((select a.atthasdef from pg_attribute a where a.attrelid = 'public.ai_reports'::regclass and a.attname = 'user_id') = false,
  '196: user_id has no default (the function sets it from the account it verified)');

-- ─── 2. The service role writes; every CHECK, with good and bad values ───────
select set_config('test.uid', 'none', false);
set role service_role;
insert into public.ai_reports (id, user_id, week_start, made_by, facts)
  values ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-11-16', 'schedule', '{"week_start":"2026-11-16"}');
select public.t_ok((select status = 'queued' and batch_id is null and content is null and pushed_at is null and claimed_at is null
                     from public.ai_reports where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '196: a new report is queued, with nothing yet');
select public.t_ok(public.t_err($q$insert into public.ai_reports (user_id, week_start, made_by) values ('00000000-0000-0000-0000-000000000001', '2026-11-16', 'schedule')$q$) = '23505',
  '196: a second scheduled report for the same week is refused (23505): one report a week, never two');
select public.t_ok(public.t_err($q$insert into public.ai_reports (user_id, week_start, made_by) values ('00000000-0000-0000-0000-000000000001', '2026-11-16', 'app')$q$) is null,
  '196: the button''s report of the same week is its own row');
select public.t_ok(public.t_err($q$insert into public.ai_reports (user_id, week_start, made_by) values ('00000000-0000-0000-0000-000000000001', '2026-11-17', 'app')$q$) = '23514',
  '196: a week that does not start on a Monday is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_reports (user_id, week_start, made_by) values ('00000000-0000-0000-0000-000000000002', '2026-11-16', 'robot')$q$) = '23514',
  '196: an unknown maker is refused');
select public.t_ok(public.t_err($q$insert into public.ai_reports (user_id, week_start, made_by, status) values ('00000000-0000-0000-0000-000000000002', '2026-11-16', 'app', 'done')$q$) = '23514',
  '196: an unknown status is refused');
select public.t_ok(public.t_err($q$insert into public.ai_reports (user_id, week_start, made_by, status) values ('00000000-0000-0000-0000-000000000002', '2026-11-16', 'app', 'ready')$q$) = '23514',
  '196: a ready report with no text is refused');
select public.t_ok(public.t_err($q$update public.ai_reports set batch_id = 'msgbatch_01/../x' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) = '23514'
                   and public.t_err($q$update public.ai_reports set batch_id = '' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) = '23514'
                   and public.t_err($q$update public.ai_reports set batch_id = repeat('a', 101) where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) = '23514',
  '196: a batch id with a slash, a space or no character, or over 100, is refused');
select public.t_ok(public.t_err($q$update public.ai_reports set batch_id = 'msgbatch_01AbC-xyz' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) is null,
  '196: a batch id of the characters Anthropic uses is accepted');
select public.t_ok(public.t_err($q$update public.ai_reports set content = repeat('x', 6001) where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) = '23514'
                   and public.t_err($q$update public.ai_reports set failure = repeat('x', 301) where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) = '23514'
                   and public.t_err($q$update public.ai_reports set facts = '[]'::jsonb where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) = '23514'
                   and public.t_err($q$update public.ai_reports set facts = jsonb_build_object('x', repeat('y', 70000)) where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) = '23514',
  '196: a report over 6000 characters, a failure over 300, facts that are not an object or over 64 KB are refused');
select public.t_ok(public.t_err($q$update public.ai_reports set status = 'ready', content = 'Training. Fine.', ready_at = now() where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) is null,
  '196: a report becomes ready with its text');
reset role;

-- The ledger link: a row of ai_calls, and what happens when that row goes.
insert into public.ai_calls (id, user_id, job, caller, mode, model, outcome)
  values ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'weekly_report', 'schedule', 'batch', 'claude-haiku-5-5', 'pending');
update public.ai_reports set call_id = 'bbbbbbbb-0000-4000-8000-000000000001' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select public.t_ok(public.t_err($q$update public.ai_reports set call_id = 'cccccccc-0000-4000-8000-00000000dead' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$) = '23503',
  '196: a report cannot point at a ledger row that does not exist');
delete from public.ai_calls where id = 'bbbbbbbb-0000-4000-8000-000000000001';
select public.t_ok((select call_id is null from public.ai_reports where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '196: a deleted ledger row leaves the report, with no cost link');

-- ─── 3. The owner's browser, a second account, a locked-out account, no one ──
update public.ai_reports set batch_id = 'msgbatch_secret', claimed_at = now() where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select set_config('test.uid', '', false);
set role authenticated;
select public.t_ok((select count(*) = 2 from (select id, user_id, week_start, made_by, status, failure, content, facts, call_id, created_at, ready_at, pushed_at from public.ai_reports) r),
  '196: the owner reads their own reports, by the finished columns');
select public.t_ok(public.t_err('select batch_id from public.ai_reports') = '42501' and public.t_err('select claimed_at from public.ai_reports') = '42501' and public.t_err('select * from public.ai_reports') = '42501',
  '196: the owner''s browser cannot read batch_id or claimed_at, not even through select *');
select public.t_ok(public.t_err($q$insert into public.ai_reports (user_id, week_start, made_by) values ('00000000-0000-0000-0000-000000000001', '2026-11-09', 'app')$q$) = '42501'
                   and public.t_err($q$update public.ai_reports set content = 'forged' where true$q$) = '42501'
                   and public.t_err($q$update public.ai_reports set batch_id = 'msgbatch_forged' where true$q$) = '42501'
                   and public.t_err($q$delete from public.ai_reports where true$q$) = '42501',
  '196: the owner''s browser cannot add, change (not content, not batch_id) or delete a report');
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.t_ok((select count(*) from (select id from public.ai_reports) r) = 0, '196: a second account sees none of the owner''s reports');
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok((select count(*) from (select id from public.ai_reports) r) = 0, '196: an account the owner lock keeps out sees nothing');
reset role;
select set_config('test.uid', 'none', false);
set role anon;
select public.t_ok(public.t_err('select id from public.ai_reports') = '42501', '196: a signed-out caller is refused');
reset role;

-- ─── 4. The two timers ───────────────────────────────────────────────────────
select public.t_ok((select count(*) = 2 from cron.job where jobname in ('lascis-ai-report-make', 'lascis-ai-report-check')),
  '196: both timers are scheduled');
select public.t_ok((select schedule = '30 21,22 * * 0' from cron.job where jobname = 'lascis-ai-report-make')
                   and (select schedule = '*/15 * * * *' from cron.job where jobname = 'lascis-ai-report-check'),
  '196: the make timer runs Sundays 21:30 and 22:30 UTC, the check every 15 minutes');
select public.t_ok((select command like '%functions/v1/claude%' and command like '%''report_make''%' and command like '%PUSH_CRON_SECRET%' and command like '%vault.decrypted_secrets%'
                           and command not like '%test-push-secret%' from cron.job where jobname = 'lascis-ai-report-make')
                   and (select command like '%functions/v1/claude%' and command like '%''report_check''%' and command not like '%test-push-secret%' from cron.job where jobname = 'lascis-ai-report-check'),
  '196: each timer calls the claude function for its own action and reads the secret from Vault inside the job');
select public.t_ok((select command like '%where exists (select 1 from public.ai_reports r where r.status = ''queued'')%' from cron.job where jobname = 'lascis-ai-report-check'),
  '196: the check timer calls only while a report is queued');
-- Run the timers' own SQL. First with no secret in Vault: the header is empty (the function refuses it).
create or replace function public.t_run_timer(p_name text) returns void language plpgsql as $$
declare c text;
begin
  select command into c from cron.job where jobname = p_name;
  execute c;
end $$;
select public.t_run_timer('lascis-ai-report-make');
select public.t_ok((select count(*) = 1 and bool_and(headers ->> 'x-claude-schedule-key' = '') from net.sent),
  '196: with no PUSH_CRON_SECRET in Vault the header is empty, which the function refuses');
delete from net.sent;
insert into vault.decrypted_secrets values ('PUSH_CRON_SECRET', 'test-push-secret');
select public.t_run_timer('lascis-ai-report-make');
select public.t_ok((select count(*) = 1 and bool_and(url = 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/claude' and body = '{"action": "report_make"}'::jsonb
                           and headers ->> 'x-claude-schedule-key' = :'expected_key' and headers ->> 'Content-Type' = 'application/json') from net.sent),
  '196: the make timer sends HMAC-SHA256(claude-schedule-v1, the secret) as hex, the same value Node computes, and only the action');
select public.t_ok((select not (headers::text like '%test-push-secret%') from net.sent limit 1), '196: the secret itself is not in the request');
delete from net.sent;
delete from public.ai_reports where status = 'queued';
select public.t_run_timer('lascis-ai-report-check');
select public.t_ok((select count(*) = 0 from net.sent), '196: with no queued report the check timer calls nothing');
insert into public.ai_reports (user_id, week_start, made_by, status) values ('00000000-0000-0000-0000-000000000004', '2026-11-16', 'schedule', 'queued');
select public.t_run_timer('lascis-ai-report-check');
select public.t_ok((select count(*) = 1 and bool_and(body = '{"action": "report_check"}'::jsonb and headers ->> 'x-claude-schedule-key' = :'expected_key') from net.sent),
  '196: with a queued report the check timer calls once, with the same credential');
update public.ai_reports set status = 'failed', failure = 'x' where user_id = '00000000-0000-0000-0000-000000000004';
delete from net.sent;
select public.t_run_timer('lascis-ai-report-check');
select public.t_ok((select count(*) = 0 from net.sent), '196: a report that is no longer queued stops the check timer');

-- ─── 5. Deleting an account takes its reports ────────────────────────────────
delete from auth.users where id = '00000000-0000-0000-0000-000000000004';
select public.t_ok(not exists (select 1 from public.ai_reports where user_id = '00000000-0000-0000-0000-000000000004'),
  '196: deleting an account deletes its reports');
