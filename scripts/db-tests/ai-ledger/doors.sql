-- Migration 194 and the app's own doors for deleting, putting back and undoing (the real 144, 150 and 151): none
-- of them moves the AI ledger. They run with the caller's rights, so the ledger's missing grants and policies stop
-- them as they stop a plain write — a forged call, a deleted call and a cost set to 0 all stay impossible from the
-- browser. Then what Developer → Activity's Undo does with the two settings tables: a changed ai_settings row goes
-- back, the first save can't be undone (that would be a delete, and the browser has none), and ai_job_settings is
-- listed as blocked (its key is two columns).
-- Setup runs as the superuser, every attempt as `authenticated` with the owner's id.
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
grant execute on function public.t_ok(boolean, text), public.t_err(text) to authenticated;
create table public.t_tx (k text primary key, tx bigint not null);
grant select, insert on public.t_tx to authenticated;

insert into public.ai_calls (id, user_id, job, caller, model, outcome, cost_usd, input_tokens, request)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'item_fill', 'app', 'claude-haiku-5-5', 'ok', 1.5, 100,
        '{"text": "Dentist on Tuesday at 14:00"}');
select public.t_ok(not exists (select 1 from public.audit_logs where table_name = 'ai_calls'),
  'a call written to the ledger leaves nothing in the audit log, so Activity has no save of it to undo');

set role authenticated;
-- 144's delete with Undo.
select public.t_ok(public.t_err($$select public.app_delete_rows('ai_calls', array['a0000000-0000-0000-0000-000000000001'])$$) = '42501',
  'the app''s delete (app_delete_rows) can''t delete a call');
-- 144's Undo of a delete, handed a snapshot the browser made up: a new call, then an old call's cost.
select public.t_ok((select (r ->> 'restored')::integer = 0 and r -> 'skipped' ? 'ai_calls' from public.app_restore_rows($j${
    "v": "1", "root": "ai_calls", "links": [], "touched": [], "hidden": [],
    "groups": [{"table": "ai_calls", "pk": "id", "rows": [{"id": "a0000000-0000-0000-0000-000000000002",
      "user_id": "00000000-0000-0000-0000-000000000001", "job": "item_fill", "caller": "app", "model": "claude-haiku-5-5", "outcome": "ok", "cost_usd": 0}]}]
  }$j$::jsonb) r),
  'the app''s restore (app_restore_rows) can''t add a made-up call: the table is skipped');
select public.t_ok((select (r ->> 'restored')::integer = 0 and (r ->> 'relinked')::integer = 0 from public.app_restore_rows($j${
    "v": "1", "root": "ai_calls", "groups": [], "links": [], "hidden": [],
    "touched": [{"table": "ai_calls", "pk": "id", "columns": ["cost_usd"],
      "rows": [{"id": "a0000000-0000-0000-0000-000000000001", "cost_usd": 0}],
      "after": [{"id": "a0000000-0000-0000-0000-000000000001", "cost_usd": 1.5}]}]
  }$j$::jsonb) r),
  'nor put a made-up cost back on a call');
-- 151's undo steps, handed steps the browser made up.
select public.t_ok(public.t_err($q$select public.app_undo_steps('[{"t": "ai_calls", "action": "revert", "rows": [{"id": "a0000000-0000-0000-0000-000000000001", "set": {"cost_usd": 0}}]}]'::jsonb)$q$) = '42501',
  'the app''s undo steps (app_undo_steps) can''t change a call''s cost');
select public.t_ok(public.t_err($q$select public.app_undo_steps('[{"t": "ai_calls", "action": "delete", "ids": ["a0000000-0000-0000-0000-000000000001"]}]'::jsonb)$q$) = '42501',
  'nor delete a call');
select public.t_ok(public.t_err($q$select public.app_undo_steps('[{"t": "ai_calls", "action": "reinsert", "rows": [{"id": "a0000000-0000-0000-0000-000000000003", "user_id": "00000000-0000-0000-0000-000000000001", "job": "item_fill", "caller": "app", "model": "claude-haiku-5-5", "outcome": "ok"}]}]'::jsonb)$q$) = '42501',
  'nor add one');
reset role;
select public.t_ok((select count(*) = 1 and bool_and(id = 'a0000000-0000-0000-0000-000000000001' and cost_usd = 1.5 and input_tokens = 100 and request is not null)
                      from public.ai_calls),
  'after every door the ledger holds the one call, as it was written');

-- Activity's Undo and the settings.
set role authenticated;
do $$ begin
  insert into public.ai_settings (monthly_budget_usd) values (7);
  insert into public.t_tx values ('first', txid_current());
end $$;
do $$ begin
  update public.ai_settings set monthly_budget_usd = 20, log_days = 10, log_text = false;
  insert into public.t_tx values ('change', txid_current());
end $$;
select public.t_ok((select p -> 'blocked' = '[]'::jsonb and p -> 'tables' -> 0 ->> 't' = 'ai_settings' and (p -> 'tables' -> 0 ->> 'revert')::integer = 1
                      from public.app_undo_transaction((select tx from public.t_tx where k = 'change')) p),
  'Activity can undo a change of ai_settings: one row to put back, nothing blocked');
select public.t_ok((select (p -> 'result' ->> 'reverted')::integer = 1 from public.app_undo_transaction((select tx from public.t_tx where k = 'change'), true) p),
  'and does');
select public.t_ok((select monthly_budget_usd = 7 and log_days = 30 and log_text from public.ai_settings), 'the budget, the days and the text log are as before the change');
select public.t_ok(public.t_err($$select public.app_undo_transaction((select tx from public.t_tx where k = 'first'), true)$$) = '42501',
  'the first save of ai_settings can''t be undone: that is a delete, and the browser has none');
select public.t_ok((select count(*) = 1 and bool_and(monthly_budget_usd = 7) from public.ai_settings), 'and the row stays');

do $$ begin
  insert into public.ai_job_settings (job, enabled) values ('item_fill', false);
  insert into public.t_tx values ('job_first', txid_current());
end $$;
do $$ begin
  update public.ai_job_settings set enabled = true, effort = 'high';
  insert into public.t_tx values ('job_change', txid_current());
end $$;
select public.t_ok((select p -> 'blocked' -> 0 ->> 't' = 'ai_job_settings' and p -> 'blocked' -> 0 ->> 'reason' = 'no_key'
                      from public.app_undo_transaction((select tx from public.t_tx where k = 'job_change')) p),
  'Activity lists a change of ai_job_settings as blocked (its key is account and job, and Undo needs one column)');
select public.t_ok(public.t_err($$select public.app_undo_transaction((select tx from public.t_tx where k = 'job_change'), true)$$) is not null,
  'and refuses to undo it');
select public.t_ok((select enabled and effort = 'high' from public.ai_job_settings), 'the job''s settings stay as changed');
select public.t_ok(public.t_err($$select public.app_delete_rows('ai_settings', array['00000000-0000-0000-0000-000000000001'])$$) = '42501',
  'the app''s delete can''t delete the settings row either');
reset role;
