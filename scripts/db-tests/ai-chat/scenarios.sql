-- Migration 197 (Ask AI chats): who may read and write conversations, messages and proposals, the append-only guard,
-- every CHECK, the foreign keys that tie a message to its own account's conversation, and ai_find_text.
-- Setup runs as the superuser, the function's writes as `service_role`, the app's reads as `authenticated`.
-- test.uid picks the account: 1 = the owner, 2 = a second allowed account, 3 = signed in but not let in, 'none' = none.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate; end $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text) to anon, authenticated, service_role;

-- 1 · what 197 made
select public.t_ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.ai_conversations'::regclass, 'public.ai_messages'::regclass, 'public.ai_chat_proposals'::regclass))
  and (select count(*) = 3 from pg_policies where schemaname = 'public' and policyname = 'app_owner_lock' and tablename in ('ai_conversations', 'ai_messages', 'ai_chat_proposals')),
  '197: row level security and the owner lock are on all three tables');
select public.t_ok((select count(*) = 3 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename in ('ai_conversations', 'ai_messages', 'ai_chat_proposals') and policyname <> 'app_owner_lock'),
  '197: each table has one policy besides the lock, and it only reads');
select public.t_ok(bool_and(has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert, update, delete, truncate')
  and not has_any_column_privilege('authenticated', t, 'insert, update')) , '197: the browser reads the three tables and writes none of them')
  from unnest(array['public.ai_conversations', 'public.ai_messages', 'public.ai_chat_proposals']) t;
select public.t_ok(bool_and(not has_table_privilege('anon', t, 'select, insert, update, delete')) , '197: a signed-out caller has no right on them')
  from unnest(array['public.ai_conversations', 'public.ai_messages', 'public.ai_chat_proposals']) t;
select public.t_ok((select a.atthasdef from pg_attribute a where a.attrelid = 'public.ai_conversations'::regclass and a.attname = 'user_id') = false
  and (select a.atthasdef from pg_attribute a where a.attrelid = 'public.ai_messages'::regclass and a.attname = 'user_id') = false
  and (select a.atthasdef from pg_attribute a where a.attrelid = 'public.ai_chat_proposals'::regclass and a.attname = 'user_id') = false,
  '197: user_id has no default on any of them (the function sets it from the account it verified)');
select public.t_ok(not exists (select 1 from pg_trigger where tgrelid in ('public.ai_conversations'::regclass, 'public.ai_chat_proposals'::regclass) and not tgisinternal)
  and (select count(*) = 1 from pg_trigger where tgrelid = 'public.ai_messages'::regclass and not tgisinternal), '197: no audit trigger; one append-only guard on ai_messages');
select public.t_ok(not has_function_privilege('anon', 'public.ai_find_text(text, text, integer)', 'execute'), '197: ai_find_text is not callable signed out');

-- 2 · the function writes
select set_config('test.uid', 'none', false);
set role service_role;
insert into public.ai_conversations (id, user_id, title, model, effort, tools_hash, system_hash, tool_names)
values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'What is on today?', 'claude-haiku-5-5', 'medium', repeat('a', 64), repeat('b', 64), array['get_day_plan', 'find_text']),
       ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000002', 'Other account', 'claude-haiku-5-5', 'medium', repeat('a', 64), repeat('b', 64), '{}');
insert into public.ai_messages (conversation_id, user_id, seq, role, content, digest)
values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 1, 'user', '[{"type":"text","text":"hello"}]', repeat('c', 64)),
       ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 2, 'assistant', '[{"type":"thinking","thinking":"x","signature":"sig"},{"type":"text","text":"hi"}]', repeat('d', 64));
insert into public.ai_chat_proposals (id, user_id, conversation_id, tool_use_id, tool, args, summary, expires_at)
values ('90000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'toolu_01', 'add_task', '{"title":"Buy milk"}', 'Add task "Buy milk"', now() + interval '1 day');
select public.t_ok((select count(*) from public.ai_messages) = 2, '197: the service role adds messages');
select public.t_ok(public.t_err($q$insert into public.ai_messages (conversation_id, user_id, seq, role, content, digest) values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 2, 'user', '[]', repeat('e', 64))$q$) = '23505',
  '197: two messages cannot take the same number in one chat (23505)');
select public.t_ok(public.t_err($q$insert into public.ai_messages (conversation_id, user_id, seq, role, content, digest) values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000002', 3, 'user', '[]', repeat('e', 64))$q$) = '23503',
  '197: a message cannot name another account''s conversation (23503)');
select public.t_ok(public.t_err($q$insert into public.ai_chat_proposals (user_id, conversation_id, tool_use_id, tool, args, summary, expires_at) values ('00000000-0000-0000-0000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'toolu_02', 'add_task', '{}', 's', now())$q$) = '23503',
  '197: a proposal cannot name another account''s conversation (23503)');
select public.t_ok(public.t_err($q$insert into public.ai_chat_proposals (user_id, conversation_id, tool_use_id, tool, args, summary, expires_at) values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'toolu_01', 'add_task', '{}', 's', now())$q$) = '23505',
  '197: one tool call makes one proposal (23505)');
select public.t_ok(public.t_err($q$insert into public.ai_chat_proposals (user_id, conversation_id, tool_use_id, tool, args, summary, expires_at) values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'toolu_03', 'db_delete', '{}', 's', now())$q$) = '23514',
  '197: a proposal can only be add_task or log_food (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_chat_proposals (user_id, conversation_id, tool_use_id, tool, args, summary, expires_at, status) values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'toolu_04', 'add_task', '{}', 's', now(), 'confirmed')$q$) = '23514',
  '197: a decided proposal must say when (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_conversations (user_id, model, effort, tools_hash, system_hash) values ('00000000-0000-0000-0000-000000000001', 'm', 'extreme', repeat('a', 64), repeat('b', 64))$q$) = '23514', '197: an effort off the list is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_conversations (user_id, model, effort, tools_hash, system_hash) values ('00000000-0000-0000-0000-000000000001', 'm', 'low', 'nothex', repeat('b', 64))$q$) = '23514', '197: a hash that is not hex is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_conversations (user_id, model, effort, tools_hash, system_hash, tool_names) values ('00000000-0000-0000-0000-000000000001', 'm', 'low', repeat('a', 64), repeat('b', 64), array['Bad Name!'])$q$) = '23514', '197: a tool name with odd characters is refused (23514)');
select public.t_ok(public.t_err($q$insert into public.ai_messages (conversation_id, user_id, seq, role, content, digest) values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 9, 'user', '{"not":"an array"}', repeat('e', 64))$q$) = '23514', '197: content must be an array of blocks (23514)');
-- append-only
select public.t_ok(public.t_err($q$update public.ai_messages set content = '[]' where seq = 1$q$) = '42501', '197: a message cannot be updated, even by the service role');
select public.t_ok(public.t_err($q$delete from public.ai_messages where seq = 1$q$) = '42501', '197: a message cannot be deleted directly, even by the service role');
select public.t_ok((select count(*) from public.ai_messages) = 2, '197: nothing changed after the refused update and delete');
-- the conversation and a proposal may change (status, counters)
update public.ai_conversations set status = 'full', last_prompt_tokens = 91000, message_count = 2 where id = 'c0000000-0000-4000-8000-000000000001';
update public.ai_chat_proposals set status = 'confirmed', decided_at = now() where id = '90000000-0000-4000-8000-000000000001';
select public.t_ok((select status from public.ai_conversations where id = 'c0000000-0000-4000-8000-000000000001') = 'full', '197: the service role updates a conversation''s status and counters');
reset role;

-- 3 · the app reads its own rows, writes none
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok((select count(*) from public.ai_conversations) = 1 and (select count(*) from public.ai_messages) = 2 and (select count(*) from public.ai_chat_proposals) = 1, '197: the owner reads exactly their own rows');
select public.t_ok(public.t_err($q$insert into public.ai_chat_proposals (user_id, conversation_id, tool_use_id, tool, args, summary, expires_at) values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'toolu_forged', 'add_task', '{}', 's', now())$q$) = '42501', '197: the browser cannot forge a proposal');
select public.t_ok(public.t_err($q$update public.ai_chat_proposals set status = 'confirmed', decided_at = now()$q$) = '42501', '197: the browser cannot decide a proposal');
select public.t_ok(public.t_err($q$insert into public.ai_conversations (user_id, model, effort, tools_hash, system_hash) values ('00000000-0000-0000-0000-000000000001', 'm', 'low', repeat('a', 64), repeat('b', 64))$q$) = '42501', '197: the browser cannot create a conversation');
select public.t_ok(public.t_err($q$delete from public.ai_messages$q$) = '42501', '197: the browser cannot delete messages');
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok((select count(*) from public.ai_conversations) = 0, '197: an account the owner lock keeps out reads nothing');
reset role;

-- 4 · ai_find_text
insert into public.tasks (user_id, title, description, due_date) values
  ('00000000-0000-0000-0000-000000000001', 'Dentist at Jernbanetorget', 'Bring the card', '2026-11-24'),
  ('00000000-0000-0000-0000-000000000001', 'Buy milk', null, null),
  ('00000000-0000-0000-0000-000000000002', 'Dentist of someone else', null, null);
insert into public.diary_entries (user_id, day, body) values
  ('00000000-0000-0000-0000-000000000001', '2026-11-20', 'Walked past the dentist and felt fine'),
  ('00000000-0000-0000-0000-000000000002', '2026-11-20', 'Another account''s dentist diary');
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_ok((select count(*) from public.ai_find_text('dentist', 'any', 10)) = 2, '197: ai_find_text finds the owner''s task and diary line by a word');
select public.t_ok((select count(*) from public.ai_find_text('dentist', 'any', 10) where title like '%someone else%') = 0, '197: ai_find_text never returns another account''s row');
select public.t_ok((select count(*) from public.ai_find_text('dent', 'task', 10)) = 1, '197: a half-typed word still finds a title (substring)');
select public.t_ok((select count(*) from public.ai_find_text('dentist', 'diary', 10)) = 1 and (select count(*) from public.ai_find_text('milk', 'diary', 10)) = 0, '197: kind narrows the search');
select public.t_ok((select count(*) from public.ai_find_text('', 'any', 10)) = 0 and (select count(*) from public.ai_find_text('%', 'any', 10)) = 0, '197: an empty query, or a bare wildcard, finds nothing');
select public.t_ok(public.t_err($q$select * from public.ai_find_text('x', 'everything', 5)$q$) = '22023', '197: an unknown kind is refused (22023)');
select public.t_ok((select count(*) from public.ai_find_text('dentist', 'any', 9999)) <= 10, '197: the limit is held to 10');
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_ok(public.t_err($q$select * from public.ai_find_text('dentist', 'any', 5)$q$) = '42501', '197: ai_find_text refuses an account the owner lock keeps out');
reset role;
select set_config('test.uid', 'none', false);
set role authenticated;
select public.t_ok(public.t_err($q$select * from public.ai_find_text('dentist', 'any', 5)$q$) = '42501', '197: ai_find_text refuses a caller who is not signed in');
reset role;

-- 5 · deleting an account takes its chats with it (the cascade passes the append-only guard)
delete from public.tasks where user_id = '00000000-0000-0000-0000-000000000002';
delete from public.diary_entries where user_id = '00000000-0000-0000-0000-000000000002';
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';
select public.t_ok((select count(*) from public.ai_messages) = 0 and (select count(*) from public.ai_conversations where user_id = '00000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.ai_chat_proposals) = 0, '197: deleting an account deletes its conversations, messages and proposals');
