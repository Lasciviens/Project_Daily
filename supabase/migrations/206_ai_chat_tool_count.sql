-- 206 · Ask AI: a new chat could not be started (24.11.2026, after 205 deployed). 197 let a chat's frozen tool list hold
-- at most 12 names; 205 brought the everyday chat to 15 tools that are on by default, so every NEW chat's row was
-- refused (23514) and the function answered "The chat could not be started". Chats begun before kept working.
--
-- The list's limit becomes 40: room above the function's 18 tools, still a bound on a column the function writes. The
-- names' shape check stays exactly as 197 made it. `verify-claude-chat` fails when the function's tool list is longer
-- than this limit, so the next tool cannot do this again.
--
-- Idempotent: the constraint is dropped if it exists and made again. No BEGIN/COMMIT. Every existing row passes.

alter table public.ai_conversations drop constraint if exists ai_conversations_tool_names_check;
alter table public.ai_conversations add constraint ai_conversations_tool_names_check
  check (cardinality(tool_names) <= 40 and pg_catalog.array_to_string(tool_names, ',') ~ '^[a-z_,]*$');

-- If the old CHECK had another name, the drop above skipped it and the cap of 12 would stay: fail the deploy out loud.
do $$
begin
  if exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.ai_conversations'::regclass and contype = 'c'
             and conname <> 'ai_conversations_tool_names_check' and pg_catalog.pg_get_constraintdef(oid) like '%tool_names%') then
    raise exception 'ai_conversations has another CHECK on tool_names: 206 cannot lift the cap';
  end if;
end $$;
