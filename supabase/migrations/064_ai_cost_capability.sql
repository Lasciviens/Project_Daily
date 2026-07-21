-- 064_ai_cost_capability.sql
-- AI layer Phase 1 (cost core) + user-requested additions. MANUAL-APPLY (user):
-- run this in the Supabase SQL editor, THEN redeploy the ai-proxy edge function.
--
-- Adds:
--   1. ai_usage_log   — one row per AI interaction (token counts incl. the
--                       cached-token PROOF that prefix-caching is hitting).
--   2. ai_query_log   — every data-read the AI runs (db_query args + live SQL
--                       text) so hot queries can later be promoted to the UI.
--   3. ai_memory      — durable notes/summaries/facts the AI is asked to keep.
--   4. ai_run_read_query(text) — the LIVE read-only SQL escape hatch, invoked
--                       only on explicit user request. SECURITY INVOKER so it
--                       runs as the calling user with RLS enforced; read-only +
--                       row-capped + statement-timed-out inside; the edge
--                       function additionally validates SELECT-only + allow-list.
--
-- The edge function writes ai_usage_log/ai_query_log via the SERVICE ROLE
-- (bypasses RLS); the RLS policies below are so the USER (browser) can read
-- their own rows. Everything is best-effort in the edge function, so deploying
-- the code before this migration cannot break chat — the writes just no-op.

-- ── 1. Token-usage log ─────────────────────────────────────────────────────
create table if not exists public.ai_usage_log (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  surface       text not null default 'general',
  model         text not null,
  prompt_tokens int  not null default 0,
  cached_tokens int  not null default 0,   -- usageMetadata.cachedContentTokenCount
  output_tokens int  not null default 0,
  tool_turns    int  not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.ai_usage_log enable row level security;
drop policy if exists "own ai_usage_log" on public.ai_usage_log;
create policy "own ai_usage_log" on public.ai_usage_log
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists idx_ai_usage_log_user_created
  on public.ai_usage_log(user_id, created_at desc);

-- ── 2. Query log (drives the "promote hot queries to the UI" analysis) ──────
create table if not exists public.ai_query_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  surface    text not null default 'general',
  tool       text not null,             -- 'db_query' | 'run_read_query'
  table_name text,                       -- for db_query
  sql        text,                       -- for run_read_query (raw SELECT text)
  args       jsonb,                      -- for db_query (filters/select/etc.)
  ok         boolean not null default true,
  row_count  int,
  error      text,
  created_at timestamptz not null default now()
);
alter table public.ai_query_log enable row level security;
drop policy if exists "own ai_query_log" on public.ai_query_log;
create policy "own ai_query_log" on public.ai_query_log
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists idx_ai_query_log_user_created
  on public.ai_query_log(user_id, created_at desc);
create index if not exists idx_ai_query_log_tool on public.ai_query_log(user_id, tool);

-- ── 3. Durable AI memory ────────────────────────────────────────────────────
create table if not exists public.ai_memory (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'note'  check (kind   in ('note','summary','fact','preference')),
  title      text not null,
  content    text not null,
  source     text not null default 'ai'    check (source in ('user','ai','auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_memory enable row level security;
drop policy if exists "own ai_memory" on public.ai_memory;
create policy "own ai_memory" on public.ai_memory
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists idx_ai_memory_user_created
  on public.ai_memory(user_id, created_at desc);

-- ── 4. Live read-only SQL escape hatch ──────────────────────────────────────
-- SECURITY INVOKER: runs as the calling `authenticated` user, so RLS applies
-- (a service-role call would bypass RLS — that is why the edge function calls
-- this through a USER-JWT client, not its service-role client). Inside:
--   • transaction_read_only ON  → any write raises, even if a keyword slipped
--     past the edge function's SELECT-only guard;
--   • statement_timeout 5s      → no runaway query;
--   • hard LIMIT 500            → bounded result;
--   • result returned as jsonb array of row objects.
-- The edge function is the FIRST line of defense (single-statement, SELECT/WITH
-- only, DML/DDL keyword block, sensitive-table/schema block, FROM/JOIN targets
-- restricted to the allow-listed catalog); this function is defense-in-depth.
create or replace function public.ai_run_read_query(query_text text)
returns jsonb
language plpgsql
security invoker
as $$
declare
  result jsonb;
begin
  perform set_config('transaction_read_only', 'on', true);   -- local to this txn
  perform set_config('statement_timeout',     '5000', true); -- 5s cap
  execute format(
    'select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select * from (%s) _q limit 500) x',
    query_text
  ) into result;
  return result;
end;
$$;

revoke all     on function public.ai_run_read_query(text) from public, anon;
grant  execute on function public.ai_run_read_query(text) to authenticated;
