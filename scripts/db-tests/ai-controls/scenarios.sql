-- Migration 198 (Ask AI controls): the tools' modes, the owner's own instructions, the chat's kind and frozen words, and a photo
-- inside a stored message. Setup runs as the superuser, the function's writes as `service_role`, the app's as `authenticated`.
-- test.uid picks the account: 1 = the owner, 2 = a second allowed account, 3 = signed in but not let in, 'none' = none.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate; end $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text) to anon, authenticated, service_role;

-- 1 · what 198 made
select public.t_ok((select relrowsecurity from pg_class where oid = 'public.ai_tool_settings'::regclass), '198: row level security is on for ai_tool_settings');
select public.t_ok((select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'ai_tool_settings' and policyname = 'app_owner_lock'), '198: the owner lock is on ai_tool_settings');
select public.t_ok((select count(*) = 3 and bool_and(cmd in ('SELECT', 'INSERT', 'UPDATE')) from pg_policies where schemaname = 'public' and tablename = 'ai_tool_settings' and policyname <> 'app_owner_lock'), '198: three own-row policies (read, add, change), no delete');
select public.t_ok(has_table_privilege('authenticated', 'public.ai_tool_settings', 'select') and has_table_privilege('authenticated', 'public.ai_tool_settings', 'insert') and has_table_privilege('authenticated', 'public.ai_tool_settings', 'update')
  and not has_table_privilege('authenticated', 'public.ai_tool_settings', 'delete') and not has_table_privilege('authenticated', 'public.ai_tool_settings', 'truncate'), '198: the browser reads, adds and changes its tool modes and cannot delete them');
select public.t_ok(not has_table_privilege('anon', 'public.ai_tool_settings', 'select') and not has_table_privilege('anon', 'public.ai_tool_settings', 'insert') and not has_table_privilege('anon', 'public.ai_tool_settings', 'update') and not has_table_privilege('anon', 'public.ai_tool_settings', 'delete'), '198: a signed-out caller has no right on ai_tool_settings');
select public.t_ok((select count(*) = 2 from pg_trigger where tgrelid = 'public.ai_tool_settings'::regclass and not tgisinternal), '198: ai_tool_settings has its updated_at and audit triggers');
select public.t_ok(not has_any_column_privilege('authenticated', 'public.ai_conversations', 'insert') and not has_any_column_privilege('authenticated', 'public.ai_conversations', 'update'), '198: the browser still writes no column of ai_conversations (mode and owner_instructions are the function''s)');
select public.t_ok((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'ai_conversations' and column_name = 'mode') like '%chat%'
  and (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'ai_settings' and column_name = 'chat_instructions') like '%''''%', '198: a chat is the everyday kind and the instructions are empty until chosen');

-- 2 · the tools' modes: the owner's own rows only, shape bounded
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.ai_tool_settings (tool, mode) values ('get_day_plan', 'off'), ('propose_add_task', 'ask');
select public.t_ok((select count(*) from public.ai_tool_settings) = 2 and (select user_id = '00000000-0000-0000-0000-000000000001' from public.ai_tool_settings limit 1), '198: the owner adds their own tool rows (user_id from the sign-in)');
select public.t_ok(public.t_err($q$insert into public.ai_tool_settings (user_id, tool, mode) values ('00000000-0000-0000-0000-000000000002', 'find_text', 'off')$q$) = '42501', '198: a row for another account is refused (42501)');
select public.t_ok(public.t_err($q$insert into public.ai_tool_settings (tool, mode) values ('find_text', 'always')$q$) = '23514', '198: a mode off the list is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_tool_settings (tool, mode) values ('Bad Tool!', 'off')$q$) = '23514', '198: a tool name with odd characters is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_tool_settings (tool, mode) values ('get_day_plan', 'on')$q$) = '23505', '198: one row per tool (23505)');
update public.ai_tool_settings set mode = 'on' where tool = 'get_day_plan';
select public.t_ok((select mode from public.ai_tool_settings where tool = 'get_day_plan') = 'on', '198: the owner changes their own mode back');
select public.t_ok(public.t_err($q$delete from public.ai_tool_settings$q$) = '42501', '198: the browser cannot delete a tool row');
reset role;
-- the database only bounds the SHAPE: a write tool stored as "on" is accepted here and ignored by the function (its code: a write tool is never on)
insert into public.ai_tool_settings (user_id, tool, mode) values ('00000000-0000-0000-0000-000000000002', 'find_text', 'off');
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok((select count(*) from public.ai_tool_settings where tool = 'find_text') = 0, '198: the owner never sees another account''s tool rows');
update public.ai_tool_settings set mode = 'on' where tool = 'find_text';
reset role;
select public.t_ok((select mode from public.ai_tool_settings where user_id = '00000000-0000-0000-0000-000000000002' and tool = 'find_text') = 'off', '198: …and cannot change them');
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok((select count(*) from public.ai_tool_settings) = 0 and public.t_err($q$insert into public.ai_tool_settings (tool, mode) values ('find_text', 'off')$q$) = '42501', '198: an account the owner lock keeps out reads and writes nothing');
reset role;

-- 3 · the owner's own instructions
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.ai_settings (chat_instructions) values ('Answer in short sentences. Jeg trener om morgenen æøå.') on conflict (user_id) do update set chat_instructions = excluded.chat_instructions;
select public.t_ok((select chat_instructions from public.ai_settings) = 'Answer in short sentences. Jeg trener om morgenen æøå.', '198: the owner saves their words exactly as typed (æøå kept)');
select public.t_ok(public.t_err($q$update public.ai_settings set chat_instructions = repeat('x', 1001)$q$) = '23514', '198: more than 1000 characters is refused (23514)');
update public.ai_settings set chat_instructions = repeat('å', 1000);
select public.t_ok((select char_length(chat_instructions) = 1000 from public.ai_settings), '198: exactly 1000 characters are accepted (counted in characters, not bytes)');
select public.t_ok(public.t_err($q$update public.ai_settings set chat_instructions = null$q$) = '23502', '198: the instructions are never null (23502)');
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.t_ok((select count(*) from public.ai_settings where chat_instructions like 'å%') = 0, '198: another account never reads them');
reset role;

-- 4 · what a chat was started with, and a photo inside a stored message
select set_config('test.uid', 'none', false);
set role service_role;
insert into public.ai_conversations (id, user_id, model, effort, tools_hash, system_hash, tool_names, mode, owner_instructions)
values ('c0000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'claude-haiku-5-5', 'medium', repeat('a', 64), repeat('b', 64), array['get_day_plan', 'get_training_week', 'get_pt_verdicts'], 'coach', 'Keep it short.');
select public.t_ok((select mode = 'coach' and owner_instructions = 'Keep it short.' and cardinality(tool_names) = 3 from public.ai_conversations where id = 'c0000000-0000-4000-8000-0000000000e1'), '198: the function stores a coach chat with its frozen words and its tools');
select public.t_ok(public.t_err($q$insert into public.ai_conversations (user_id, model, effort, tools_hash, system_hash, mode) values ('00000000-0000-0000-0000-000000000001', 'm', 'low', repeat('a', 64), repeat('b', 64), 'admin')$q$) = '23514', '198: a kind of chat that does not exist is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_conversations (user_id, model, effort, tools_hash, system_hash, owner_instructions) values ('00000000-0000-0000-0000-000000000001', 'm', 'low', repeat('a', 64), repeat('b', 64), repeat('x', 1001))$q$) = '23514', '198: frozen words over 1000 characters are refused (23514)');
insert into public.ai_messages (conversation_id, user_id, seq, role, content, digest)
values ('c0000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000001', 1, 'user',
  jsonb_build_array(jsonb_build_object('type', 'image', 'source', jsonb_build_object('type', 'base64', 'media_type', 'image/jpeg', 'data', repeat('A', 900000))), jsonb_build_object('type', 'text', 'text', 'What is this?')), repeat('c', 64));
select public.t_ok((select octet_length(content::text) > 900000 from public.ai_messages where conversation_id = 'c0000000-0000-4000-8000-0000000000e1'), '198: a message with two photos at the function''s cap (900 000 characters) is stored');
select public.t_ok(public.t_err($q$insert into public.ai_messages (conversation_id, user_id, seq, role, content, digest) values ('c0000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000001', 2, 'user', jsonb_build_array(jsonb_build_object('type', 'image', 'source', jsonb_build_object('data', repeat('A', 1100000)))), repeat('d', 64))$q$) = '23514', '198: a message over 1 MB is refused, so a photo can never be larger than the database allows (23514)');
select public.t_ok(public.t_err($q$update public.ai_messages set content = '[]' where seq = 1$q$) = '42501', '198: a message with a photo is as append-only as any other');
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok((select mode from public.ai_conversations where id = 'c0000000-0000-4000-8000-0000000000e1') = 'coach' and (select count(*) from public.ai_messages) = 1, '198: the owner reads their chat''s kind and its message (the photo included)');
select public.t_ok(public.t_err($q$update public.ai_conversations set mode = 'chat'$q$) = '42501' and public.t_err($q$update public.ai_conversations set owner_instructions = 'x'$q$) = '42501', '198: the browser cannot change a chat''s kind or its frozen words');
reset role;
-- the photo goes with the chat: deleting a chat and the retention purge remove its messages (and so the photo) whole
update public.ai_conversations set deleted_at = now() - interval '8 days' where id = 'c0000000-0000-4000-8000-0000000000e1';
set role service_role;
select public.t_ok((select public.ai_chats_purge()) >= 1, '198: the purge removes a chat deleted more than 7 days ago');
reset role;
select public.t_ok((select count(*) from public.ai_messages where conversation_id = 'c0000000-0000-4000-8000-0000000000e1') = 0, '198: …and its photo goes with it (no copy anywhere else)');
