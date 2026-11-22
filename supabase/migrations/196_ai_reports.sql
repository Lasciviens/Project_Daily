-- 196 · The weekly reports (AI rebuild, phase 3, 22.11.2026 — docs/features/ai-plan.md §6, docs/features/ai.md).
--
-- Every Monday at about 05:00 (Oslo) the `claude` function works out the owner's last week with code (Sunday is
-- complete by then), queues ONE request at the batch price (half) and, when Anthropic has answered, saves the written
-- report; the push for it goes out from 07:00. This file adds:
--
-- 1. ai_reports — one row per report: its week (the Monday, Europe/Oslo), who made it (the Sunday timer or the
--    "Make this week's report now" button), `queued` → `ready` or `failed`, the English text, the figures the model
--    was given (`facts`, the proof of what it read), the ledger row of its cost (`call_id`) and when it was made,
--    finished and announced.
--    · Written ONLY by the service role (the claude function). The browser reads its own finished rows and does
--      nothing else: no insert, update or delete policy and no such grant.
--    · `batch_id` is a link to an outside service (Anthropic's batch). The function asks Anthropic about whatever
--      batch id it reads from this table, so a forged value would point it at another batch: it is therefore never
--      writable by the browser and not even READABLE by it — the browser's grant is a list of columns that leaves
--      out `batch_id` and `claimed_at` (the check's own bookkeeping). No browser-writable table holds a target the
--      function reads back (AGENTS.md, the boxed warning). The assistant never sees this table (it is in no
--      catalogue, and a link column of it would belong in AI_NO_WRITE if it ever were).
--    · unique (user_id, week_start, made_by): a second timer run, a repeated tap or two overlapping runs make one
--      report per week and maker, never two; a failed scheduled week is not tried again by the timer (no loop). The
--      real report is `made_by = 'schedule'` (the button redoes a missing or failed one as that row); a button copy is
--      `made_by = 'app'`, shown as a test, never the real one and never pushed.
--    · `push_due` (server-only, like `batch_id` and `claimed_at`): a push is owed for this finished report (the owner's
--      real report only). The check timer sends it from 07:00 Oslo time, stamping `pushed_at` first, so it goes once.
--    · Every CHECK is the last line behind the function's own: a Monday date, short texts, a batch id of the
--      characters Anthropic's ids have, a ready report with its text.
--    · No audit trigger: it is a server-written log of finished work, never edited by the owner, and Activity's
--      Undo must never reach it. Deleting the account deletes the reports; deleting a ledger row (the purge never
--      does) leaves the report with no cost link.
-- 2. Two timers (pg_cron, UTC), both calling the `claude` function with a value computed from a Vault secret:
--    · lascis-ai-report-make  Mondays 03:00 and 04:00 UTC. Oslo is UTC+1 or UTC+2, so these are 04:00 / 05:00 (winter)
--      or 05:00 / 06:00 (summer); the function acts only from 05:00 to 07:00 Oslo time and answers "not the time" to
--      an earlier run, and a week that already has a report is skipped, so the morning makes one report.
--    · lascis-ai-report-check every 15 minutes, only while a report is queued or a push is owed (`where exists`): it
--      asks the function to read back the batch and to send the owed push from 07:00. Nothing is called otherwise.
--    The header `x-claude-schedule-key` is HMAC-SHA256('claude-schedule-v1', PUSH_CRON_SECRET) as hex, computed in
--    SQL with pgcrypto's hmac from the secret the other timers already keep in Vault (and the functions in their
--    secrets). The secret itself never travels, and a leaked header opens only `claude`'s two schedule actions.
--    No secret in Vault: an empty header, which the function refuses.
--
-- Safe to re-run. Changes no existing row. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1. The reports ──────────────────────────────────────────────────────────
create table if not exists public.ai_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- The Monday of the Oslo week the report covers.
  week_start  date not null check (extract(isodow from week_start) = 1),
  made_by     text not null check (made_by in ('schedule', 'app')),
  status      text not null default 'queued' check (status in ('queued', 'ready', 'failed')),
  -- Why a failed report failed, in one plain sentence.
  failure     text check (failure is null or char_length(failure) <= 300),
  -- The report, in English. Data to show, never an instruction.
  content     text check (content is null or char_length(content) <= 6000),
  -- The figures the model was given (the week's facts, worked out by code).
  facts       jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object' and octet_length(facts::text) <= 65536),
  -- Anthropic's batch: server-only (see the header).
  batch_id    text check (batch_id is null or batch_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  call_id     uuid references public.ai_calls(id) on delete set null,
  -- The check that is working on this report right now (server-only).
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  ready_at    timestamptz,
  pushed_at   timestamptz,
  -- A push is owed (server-only).
  push_due    boolean not null default false,
  constraint ai_reports_week_maker unique (user_id, week_start, made_by),
  constraint ai_reports_ready_has_text check (status <> 'ready' or content is not null)
);
alter table public.ai_reports enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_reports' and policyname = 'Users read own ai_reports'
  ) then
    -- The only policy: reading. With no insert, update or delete policy, row level security refuses those too.
    create policy "Users read own ai_reports" on public.ai_reports
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_reports from anon, authenticated;
-- The browser reads these columns and no others: never batch_id, never claimed_at.
grant select (id, user_id, week_start, made_by, status, failure, content, facts, call_id, created_at, ready_at, pushed_at)
  on public.ai_reports to authenticated;
grant select, insert, update, delete on public.ai_reports to service_role;

-- What the check timer's `where exists` and the check itself read.
create index if not exists idx_ai_reports_queued on public.ai_reports (user_id, created_at) where status = 'queued';
create index if not exists idx_ai_reports_push on public.ai_reports (user_id, created_at) where push_due and pushed_at is null;
create index if not exists idx_ai_reports_user_week on public.ai_reports (user_id, week_start desc);

comment on table public.ai_reports is
  'The weekly reports: one row per week and maker. Written only by the service role (the claude function); the owner reads the finished columns. batch_id and claimed_at are server-only.';
comment on column public.ai_reports.batch_id is 'Anthropic''s batch id: a link to an outside service. Server-only: the browser can neither write nor read it.';
comment on column public.ai_reports.facts is 'The figures the model was given, worked out by code, with the exact text it read (sent_text). Shown in Developer → AI → Batches as Figures sent.';
comment on column public.ai_reports.push_due is 'A push is owed for this finished report (the owner''s real report only). Server-only. Sent from 07:00 Oslo time, once.';
comment on column public.ai_reports.call_id is 'The ledger row of this report''s cost (ai_calls, mode batch).';

-- ─── 2. The two timers ───────────────────────────────────────────────────────
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed here: lascis-ai-report-make and lascis-ai-report-check not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'lascis-ai-report-make') then
    perform cron.unschedule('lascis-ai-report-make');
  end if;
  perform cron.schedule('lascis-ai-report-make', '0 3,4 * * 1', $cron$
    select net.http_post(
      url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/claude',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-claude-schedule-key', coalesce((select encode(extensions.hmac('claude-schedule-v1', decrypted_secret, 'sha256'), 'hex') from vault.decrypted_secrets where name = 'PUSH_CRON_SECRET'), '')
      ),
      body := jsonb_build_object('action', 'report_make')
    );
  $cron$);
  if exists (select 1 from cron.job where jobname = 'lascis-ai-report-check') then
    perform cron.unschedule('lascis-ai-report-check');
  end if;
  perform cron.schedule('lascis-ai-report-check', '*/15 * * * *', $cron$
    select net.http_post(
      url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/claude',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-claude-schedule-key', coalesce((select encode(extensions.hmac('claude-schedule-v1', decrypted_secret, 'sha256'), 'hex') from vault.decrypted_secrets where name = 'PUSH_CRON_SECRET'), '')
      ),
      body := jsonb_build_object('action', 'report_check')
    )
    where exists (select 1 from public.ai_reports r where r.status = 'queued')
       or exists (select 1 from public.ai_reports r where r.push_due and r.pushed_at is null);
  $cron$);
end $$;

select public.owner_lock_apply('public.ai_reports');

-- The deploy stops here, and keeps nothing, if the browser could write a report or read a server-only column.
do $$
begin
  if has_table_privilege('authenticated', 'public.ai_reports', 'insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('authenticated', 'public.ai_reports', 'insert, update, references') then
    raise exception 'Migration 196 assertion failed: the browser can write ai_reports';
  end if;
  if has_column_privilege('authenticated', 'public.ai_reports', 'batch_id', 'select')
     or has_column_privilege('authenticated', 'public.ai_reports', 'claimed_at', 'select')
     or has_column_privilege('authenticated', 'public.ai_reports', 'push_due', 'select')
     or has_table_privilege('authenticated', 'public.ai_reports', 'select') then
    raise exception 'Migration 196 assertion failed: the browser can read a server-only column of ai_reports';
  end if;
  if has_table_privilege('anon', 'public.ai_reports', 'select, insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('anon', 'public.ai_reports', 'select, insert, update, references') then
    raise exception 'Migration 196 assertion failed: a signed-out caller reaches ai_reports';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_reports'
              and policyname <> 'app_owner_lock' and cmd <> 'SELECT') then
    raise exception 'Migration 196 assertion failed: ai_reports has a policy that lets someone write';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.ai_reports'::regclass)
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_reports' and policyname = 'app_owner_lock') then
    raise exception 'Migration 196 assertion failed: ai_reports has no row level security or no owner lock';
  end if;
end $$;
