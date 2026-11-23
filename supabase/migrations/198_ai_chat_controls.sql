-- 198 · Ask AI controls: what each chat tool may do, the owner's own instructions, coach chats and photos
-- (AI rebuild, phase 4b, 23.11.2026 — docs/features/ai-plan.md §2, §5 and §6, docs/features/ai.md).
--
-- 1. ai_tool_settings — one row per account and chat tool: `on` (a read tool the assistant may use), `ask` (a write tool:
--    it may only PROPOSE, the owner taps Confirm) or `off` (not offered to a new chat, refused if it is called anyway).
--    The owner's to write, so every row is INPUT to the `claude` function: a name that is not one of its tools is
--    ignored, and a mode the tool cannot have (a write tool `on`) falls back to the code's default. This CHECK only bounds
--    the shape. Settings apply to chats started after the change: a chat's tools are frozen when it starts (the
--    prompt cache and Anthropic's check of thinking blocks both need the very same tool list on every request).
-- 2. ai_settings.chat_instructions — the owner's own words for the assistant ("answer in short sentences", "I train in
--    the mornings"), at most 1000 characters, saved as typed. The function freezes a copy into each NEW chat
--    (ai_conversations.owner_instructions) and sends it as a second, cached system block.
-- 3. ai_conversations.owner_instructions and .mode — the frozen copy of those words, and whether the chat is the
--    everyday one (`chat`) or the Training coach's (`coach`: its own instructions and tool set). Written only by the
--    function, at the start of a chat; the owner reads them (the app shows which set a chat uses).
-- Photos need no schema: a photo is an `image` block inside the user message in ai_messages, whose content check
-- (1 MB a message) already caps it, and which the retention purge (`ai_chats_purge`) removes with the whole chat.
--
-- Safe to re-run. Changes no existing row. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1. The tools' modes ─────────────────────────────────────────────────────
create table if not exists public.ai_tool_settings (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tool       text not null check (tool ~ '^[a-z][a-z0-9_]{1,39}$'),
  mode       text not null check (mode in ('on', 'ask', 'off')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, tool)
);
alter table public.ai_tool_settings enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_tool_settings' and policyname = 'Users read own ai_tool_settings'
  ) then
    create policy "Users read own ai_tool_settings" on public.ai_tool_settings
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_tool_settings' and policyname = 'Users add own ai_tool_settings'
  ) then
    create policy "Users add own ai_tool_settings" on public.ai_tool_settings
      for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_tool_settings' and policyname = 'Users change own ai_tool_settings'
  ) then
    create policy "Users change own ai_tool_settings" on public.ai_tool_settings
      for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_tool_settings from anon, authenticated;
grant select, insert, update on public.ai_tool_settings to authenticated;
grant select, insert, update, delete on public.ai_tool_settings to service_role;

drop trigger if exists trg_ai_tool_settings_updated_at on public.ai_tool_settings;
create trigger trg_ai_tool_settings_updated_at before update on public.ai_tool_settings
  for each row execute function public.update_updated_at();
drop trigger if exists trg_audit on public.ai_tool_settings;
create trigger trg_audit after insert or update or delete on public.ai_tool_settings
  for each row execute function public.log_audit();

comment on table public.ai_tool_settings is
  'The owner''s mode for each Ask AI tool, one row per account and tool: on (a read tool), ask (a write tool: a proposal the owner confirms) or off. Input to the claude function, which takes only the tools and modes it knows and never lets a write tool be on. Applies to chats started after the change.';

-- ─── 2. The owner's own instructions ─────────────────────────────────────────
alter table public.ai_settings add column if not exists chat_instructions text not null default ''
  check (char_length(chat_instructions) <= 1000);
comment on column public.ai_settings.chat_instructions is
  'The owner''s own words for Ask AI (tone, facts about themselves), at most 1000 characters, saved as typed. The function copies them into each new chat as a second system block; they never change its fixed rules.';

-- ─── 3. What a chat was started with ─────────────────────────────────────────
alter table public.ai_conversations add column if not exists mode text not null default 'chat'
  check (mode in ('chat', 'coach'));
alter table public.ai_conversations add column if not exists owner_instructions text not null default ''
  check (char_length(owner_instructions) <= 1000);
comment on column public.ai_conversations.mode is 'chat = the everyday Ask AI, coach = the Training coach''s chat (its own instructions and tools). Frozen when the chat starts.';
comment on column public.ai_conversations.owner_instructions is 'The copy of ai_settings.chat_instructions this chat was started with (frozen: a chat keeps the same system blocks for its whole life). Written only by the function.';

select public.owner_lock_apply('public.ai_tool_settings');
