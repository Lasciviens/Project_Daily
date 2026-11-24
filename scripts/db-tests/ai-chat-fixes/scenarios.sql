-- Migration 205 (Ask AI fixes): the two new kinds of proposal and the `replaced` state are accepted where 197 and 198 were
-- strict, nothing else is let in, the browser still writes no proposal, and the new write tools can never be "on".
-- Setup runs as the superuser, the function's writes as `service_role`, the app's reads as `authenticated`.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate; end $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text) to anon, authenticated, service_role;

-- 1 · the catalogue
select public.t_ok((select count(*) = 1 from pg_constraint where conrelid = 'public.ai_chat_proposals'::regclass and conname = 'ai_chat_proposals_tool_check'
  and pg_get_constraintdef(oid) like '%update_food%' and pg_get_constraintdef(oid) like '%update_task%'), '205: one tool check, with the two change kinds');
select public.t_ok((select count(*) = 1 from pg_constraint where conrelid = 'public.ai_chat_proposals'::regclass and conname = 'ai_chat_proposals_status_check'
  and pg_get_constraintdef(oid) like '%replaced%'), '205: one status check, with replaced');
select public.t_ok((select count(*) = 1 from pg_constraint where conrelid = 'public.ai_chat_proposals'::regclass and conname = 'ai_chat_proposals_decided'),
  '205: 197''s rule that a decided proposal says when is still there');
select public.t_ok(has_table_privilege('authenticated', 'public.ai_chat_proposals', 'select') and not has_table_privilege('authenticated', 'public.ai_chat_proposals', 'insert, update, delete')
  and not has_any_column_privilege('authenticated', 'public.ai_chat_proposals', 'insert, update'), '205: the browser still reads proposals and writes none');

select public.t_ok((select mode = 'ask' from public.ai_tool_settings where user_id = '00000000-0000-0000-0000-000000000002' and tool = 'propose_update_task'),
  '205: a stray "on" row of a new write tool saved before 205 is "ask" after it');

-- 2 · the function writes
select set_config('test.uid', 'none', false);
set role service_role;
insert into public.ai_conversations (id, user_id, title, model, effort, tools_hash, system_hash, tool_names)
values ('c5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Lunch', 'claude-haiku-5-5', 'medium', repeat('a', 64), repeat('b', 64), array['find_food', 'propose_log_food', 'propose_update_food']);
insert into public.ai_chat_proposals (id, user_id, conversation_id, tool_use_id, tool, args, summary, expires_at)
values ('95000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'toolu_f1', 'log_food', '{"title":"Cottage cheese"}', 'Log "Cottage cheese"', now() + interval '1 day'),
       ('95000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'toolu_f2', 'update_food', '{"entry_id":"x"}', 'Change today''s lunch line', now() + interval '1 day'),
       ('95000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'toolu_f3', 'update_task', '{"task_id":"x"}', 'Rename the task', now() + interval '1 day');
select public.t_ok((select count(*) = 3 from public.ai_chat_proposals where conversation_id = 'c5000000-0000-4000-8000-000000000001'), '205: the function stores a food line, a food line change and a task rename');
select public.t_ok(public.t_err($q$insert into public.ai_chat_proposals (user_id, conversation_id, tool_use_id, tool, args, summary, expires_at) values ('00000000-0000-0000-0000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'toolu_f4', 'delete_food', '{}', 's', now())$q$) = '23514',
  '205: any other kind of proposal is still refused (23514)');
update public.ai_chat_proposals set status = 'replaced', decided_at = now() where id = '95000000-0000-4000-8000-000000000001' and status = 'pending';
select public.t_ok((select status = 'replaced' and decided_at is not null from public.ai_chat_proposals where id = '95000000-0000-4000-8000-000000000001'), '205: a pending proposal can be marked replaced, with its time');
select public.t_ok(public.t_err($q$update public.ai_chat_proposals set status = 'replaced' where id = '95000000-0000-4000-8000-000000000002'$q$) = '23514',
  '205: replaced without a time is refused (197''s decided rule, 23514)');
select public.t_ok(public.t_err($q$update public.ai_chat_proposals set status = 'superseded', decided_at = now() where id = '95000000-0000-4000-8000-000000000002'$q$) = '23514',
  '205: a state off the list is refused (23514)');
reset role;

-- 3 · the browser
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok((select count(*) = 3 from public.ai_chat_proposals), '205: the owner reads their proposals of every kind');
select public.t_ok(public.t_err($q$update public.ai_chat_proposals set status = 'pending', decided_at = null where id = '95000000-0000-4000-8000-000000000001'$q$) = '42501',
  '205: the browser cannot bring a replaced proposal back (42501)');
select public.t_ok(public.t_err($q$insert into public.ai_chat_proposals (user_id, conversation_id, tool_use_id, tool, args, summary, expires_at) values ('00000000-0000-0000-0000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'toolu_f9', 'update_food', '{}', 's', now() + interval '1 day')$q$) = '42501',
  '205: the browser cannot store a change proposal itself (42501)');
-- the owner's tool switches: a new write tool is ask first or off, never on
insert into public.ai_tool_settings (user_id, tool, mode) values ('00000000-0000-0000-0000-000000000001', 'propose_update_food', 'ask'), ('00000000-0000-0000-0000-000000000001', 'find_food', 'off');
select public.t_ok((select count(*) = 2 from public.ai_tool_settings where tool in ('propose_update_food', 'find_food')), '205: the owner sets a fix tool to ask first and find_food off');
select public.t_ok(public.t_err($q$insert into public.ai_tool_settings (user_id, tool, mode) values ('00000000-0000-0000-0000-000000000001', 'propose_update_task', 'on')$q$) = '23514',
  '205: propose_update_task can never be on (23514)');
select public.t_ok(public.t_err($q$update public.ai_tool_settings set mode = 'on' where tool = 'propose_update_food'$q$) = '23514',
  '205: propose_update_food can never be switched on (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_tool_settings (user_id, tool, mode) values ('00000000-0000-0000-0000-000000000001', 'propose_log_food', 'on')$q$) = '23514',
  '205: the older write tools still can never be on (23514)');
reset role;
