-- 197 · Ask AI on Claude: conversations stored append-only, the writes the assistant proposes, and text search
-- (AI rebuild, phase 4a, 22.11.2026 — docs/features/ai-plan.md §5 and §6, docs/features/ai.md).
--
-- The new assistant (`claude` function, job `chat`) keeps every conversation in the database and sends the SAME
-- history back on every request, byte for byte: Anthropic's prompt cache and its check of thinking blocks (each
-- carries a signature that binds it to the messages before it) both depend on it. So a conversation is a log you only
-- add to. This file adds:
--
-- 1. ai_conversations — one row per chat: its title (the first words you typed), the model and effort it was started
--    with, the hashes of the fixed instructions and the tool list it was started with (a chat keeps both for its whole
--    life; a deploy that changes either makes the function refuse to continue it: "start a new chat"), the names of its
--    tools (an "off" tool is left out when a chat starts and never added later), its status, how big its prompt was
--    last time (the "start a new chat" wall) and what it has cost.
-- 2. ai_messages — the messages themselves: the blocks exactly as they were sent or received (the model's thinking
--    blocks with their signatures, its tool calls, the tool results, the live-context block), the ledger row of the
--    request that produced them (`call_id`), a hash chain (`digest` = sha256 of the previous digest and this message),
--    and `meta` (why the prompt cache missed, how much context editing cleared). Unique (conversation_id, seq):
--    two requests writing at the same moment cannot both take a number.
--    · APPEND-ONLY: a trigger refuses every update, and every delete that is not the account's own cascade (the
--      service role has the usual grants, which the repo's grant check demands, but the trigger is what holds); the
--      browser only reads. Whole conversations disappear only with the account (on delete cascade).
-- 3. ai_chat_proposals — what the assistant PROPOSES to write (add a task, log a food line). A proposal is only a row
--    here until you tap Confirm in the app: the `claude` function then reads it back BY ID AND USER, checks its
--    arguments again with its own code and writes with YOUR rights (your sign-in token, so row level security applies).
--    · Why a new table and not `ai_pending_actions` (140): that one is the old assistant's (its CHECK allows two other
--      tools, it has no link to a conversation) and stays until that assistant is removed (phase 5). A proposal here is
--      bound to its conversation and to the tool call that made it (unique (conversation_id, tool_use_id): a replayed
--      call makes one proposal), expires after 24 hours and can be decided once.
--    · The browser reads its own proposals (it draws the Confirm card from them) and writes NOTHING: a forged "confirmed"
--      row would be a write the owner never agreed to. Every column the assistant may fill is a fixed list in the
--      function's code (title, notes, due date, priority / title, meal, date, calories, macros): no link column (the
--      outside-account ones in AI_NO_WRITE) is among them.
-- 4. ai_find_text(query, kind, limit) — full-text search over your own tasks and diary (Postgres' own, the `simple`
--    configuration: no stemming, so Turkish, Norwegian and English words all work as typed), plus a substring match on
--    titles so a half-typed word still finds. SECURITY INVOKER: it runs with the caller's rights (row level security and
--    the owner lock apply) and names the caller's id itself. It answers at most 10 rows with short snippets: the
--    function's `find_text` tool turns them into citable search results.
--
-- No audit trigger on any of the three (the one trigger is the append-only guard above): they are server-written logs (a chat, its proposals), never edited by the owner;
-- Activity's Undo must never reach them (a proposal's real write, in tasks / food_log_entries, is audited as usual).
--
-- None of these tables ever goes into an assistant's table catalogue or tool list (the model reaches them only through
-- the function's fixed tools, and `ai_find_text` reads tasks and the diary only).
-- Safe to re-run. Changes no existing row. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1. Conversations ────────────────────────────────────────────────────────
create table if not exists public.ai_conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  title            text check (title is null or char_length(title) between 1 and 80),
  model            text not null check (char_length(model) <= 80),
  effort           text not null check (effort in ('low', 'medium', 'high')),
  thinking         text not null default 'adaptive' check (thinking in ('adaptive', 'off')),
  -- sha256 (hex) of the tool definitions and of the fixed instructions this chat was started with.
  tools_hash       text not null check (tools_hash ~ '^[0-9a-f]{64}$'),
  system_hash      text not null check (system_hash ~ '^[0-9a-f]{64}$'),
  tool_names       text[] not null default '{}'::text[]
                     check (cardinality(tool_names) <= 12 and pg_catalog.array_to_string(tool_names, ',') ~ '^[a-z_,]*$'),
  status           text not null default 'open' check (status in ('open', 'full', 'closed')),
  message_count    integer not null default 0 check (message_count >= 0),
  -- The prompt of the last request, in tokens: the "start a new chat" wall reads it.
  last_prompt_tokens integer not null default 0 check (last_prompt_tokens >= 0),
  cost_usd         numeric(12,6) not null default 0 check (cost_usd >= 0 and cost_usd < 1000000),
  -- (id, user_id) is what a message and a proposal point at, so neither can name another account's conversation.
  constraint ai_conversations_id_user unique (id, user_id)
);
alter table public.ai_conversations enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_conversations' and policyname = 'Users read own ai_conversations'
  ) then
    create policy "Users read own ai_conversations" on public.ai_conversations
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_conversations from anon, authenticated;
grant select on public.ai_conversations to authenticated;
grant select, insert, update, delete on public.ai_conversations to service_role;
create index if not exists idx_ai_conversations_user_updated on public.ai_conversations (user_id, updated_at desc);

-- ─── 2. Messages (append-only) ───────────────────────────────────────────────
create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  seq             integer not null check (seq >= 1),
  role            text not null check (role in ('user', 'assistant')),
  -- The content blocks exactly as sent or received. Thinking blocks keep their signature.
  content         jsonb not null check (jsonb_typeof(content) = 'array' and octet_length(content::text) <= 1048576),
  -- sha256 (hex) of the previous message's digest and this content: the history cannot change unseen.
  digest          text not null check (digest ~ '^[0-9a-f]{64}$'),
  call_id         uuid references public.ai_calls(id) on delete set null,
  meta            jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 65536),
  created_at      timestamptz not null default now(),
  constraint ai_messages_in_order unique (conversation_id, seq),
  constraint ai_messages_conversation foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id) on delete cascade
);
alter table public.ai_messages enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_messages' and policyname = 'Users read own ai_messages'
  ) then
    create policy "Users read own ai_messages" on public.ai_messages
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_messages from anon, authenticated;
grant select on public.ai_messages to authenticated;
grant select, insert, update, delete on public.ai_messages to service_role;
-- No update and no delete for anyone: a conversation is only added to. An account's deletion cascades from
-- auth.users through a foreign-key trigger (trigger depth 1), so its delete reaches this one at depth 2 and passes;
-- a direct delete is depth 1 and is refused.
create or replace function public.ai_messages_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ai_messages is append-only' using errcode = '42501';
  end if;
  if pg_catalog.pg_trigger_depth() < 2 then
    raise exception 'ai_messages is append-only' using errcode = '42501';
  end if;
  return old;
end $$;
revoke all on function public.ai_messages_append_only() from public, anon, authenticated;
drop trigger if exists trg_ai_messages_append_only on public.ai_messages;
create trigger trg_ai_messages_append_only before update or delete on public.ai_messages
  for each row execute function public.ai_messages_append_only();
create index if not exists idx_ai_messages_call on public.ai_messages (call_id) where call_id is not null;

-- ─── 3. What the assistant proposes ──────────────────────────────────────────
create table if not exists public.ai_chat_proposals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  -- The model's own id of the tool call that made this proposal (one proposal per call).
  tool_use_id     text not null check (tool_use_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  tool            text not null check (tool in ('add_task', 'log_food')),
  -- What would be written. The function checks it again with its own code before it writes anything.
  args            jsonb not null check (jsonb_typeof(args) = 'object' and octet_length(args::text) <= 4096),
  summary         text not null check (char_length(summary) between 1 and 300),
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'failed')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  decided_at      timestamptz,
  -- The row a confirmed proposal made, for the card's "Open" link.
  result_id       uuid,
  constraint ai_chat_proposals_once unique (conversation_id, tool_use_id),
  constraint ai_chat_proposals_conversation foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id) on delete cascade,
  constraint ai_chat_proposals_decided check ((status = 'pending') = (decided_at is null))
);
alter table public.ai_chat_proposals enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_chat_proposals' and policyname = 'Users read own ai_chat_proposals'
  ) then
    create policy "Users read own ai_chat_proposals" on public.ai_chat_proposals
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_chat_proposals from anon, authenticated;
grant select on public.ai_chat_proposals to authenticated;
grant select, insert, update, delete on public.ai_chat_proposals to service_role;
create index if not exists idx_ai_chat_proposals_conversation on public.ai_chat_proposals (conversation_id, created_at);

select public.owner_lock_apply('public.ai_conversations');
select public.owner_lock_apply('public.ai_messages');
select public.owner_lock_apply('public.ai_chat_proposals');

comment on table public.ai_conversations is
  'Ask AI chats. Written only by the claude function (service role); the owner reads. The tools and instructions are frozen per chat (hashes), so the history can be replayed unchanged.';
comment on table public.ai_messages is
  'The messages of a chat, exactly as sent and received (thinking blocks with signatures included). Append-only: nobody may update or delete a row.';
comment on column public.ai_messages.digest is 'sha256 of the previous message''s digest and this content: the claude function checks the chain before it replays a chat.';
comment on table public.ai_chat_proposals is
  'Writes the assistant proposes, held until the owner taps Confirm in the app. Written only by the claude function; the owner reads. Nothing is written to the owner''s own tables without that tap.';

-- ─── 4. Search your own words ────────────────────────────────────────────────
create or replace function public.ai_find_text(p_query text, p_kind text, p_limit integer)
returns table (kind text, id uuid, title text, snippet text, day date, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_text  text := pg_catalog.left(pg_catalog.btrim(coalesce(p_query, '')), 200);
  v_q     tsquery;
  v_like  text;
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('any', 'task', 'diary') then
    raise exception 'kind must be any, task or diary' using errcode = '22023';
  end if;
  if v_text = '' then return; end if;
  v_q := pg_catalog.websearch_to_tsquery('pg_catalog.simple', v_text);
  v_like := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select r.kind, r.id, r.title, r.snippet, r.day, r.rank
    from (
      select 'task'::text as kind, t.id, t.title,
             pg_catalog.left(coalesce(t.description, ''), 300) as snippet,
             t.due_date as day,
             (pg_catalog.ts_rank(pg_catalog.to_tsvector('pg_catalog.simple', t.title || ' ' || coalesce(t.description, '')), v_q)
               + case when t.title ilike v_like then 0.5 else 0 end)::real as rank
        from public.tasks t
       where p_kind in ('any', 'task') and t.user_id = v_user
         and (pg_catalog.to_tsvector('pg_catalog.simple', t.title || ' ' || coalesce(t.description, '')) @@ v_q or t.title ilike v_like)
      union all
      select 'diary'::text, d.id, ('Diary ' || d.day::text)::text,
             pg_catalog.left(d.body, 300), d.day,
             pg_catalog.ts_rank(pg_catalog.to_tsvector('pg_catalog.simple', d.body), v_q)::real
        from public.diary_entries d
       where p_kind in ('any', 'diary') and d.user_id = v_user
         and (pg_catalog.to_tsvector('pg_catalog.simple', d.body) @@ v_q or d.body ilike v_like)
    ) r
   order by r.rank desc, r.day desc nulls last
   limit v_limit;
end;
$$;
revoke all on function public.ai_find_text(text, text, integer) from public, anon;
grant execute on function public.ai_find_text(text, text, integer) to authenticated, service_role;
comment on function public.ai_find_text(text, text, integer) is
  'Full-text (simple configuration) and substring search over the caller''s own tasks and diary: at most 10 rows, short snippets. SECURITY INVOKER: the caller''s rights apply.';
