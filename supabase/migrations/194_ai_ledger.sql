-- 194 · The AI ledger: every call to the model, the owner's AI settings, and the numbers the budget wall reads
-- (AI rebuild, phase 1, 20.11.2026 — docs/features/ai-plan.md, the plan the owner approved).
--
-- The new `claude` edge function asks Anthropic's model on the owner's behalf. Every request costs money, so the
-- function stops when this month's spend reaches the owner's budget (a wall, not a warning) and when calls come
-- too fast. Both are worked out from what this file stores, so WHO MAY WRITE IT is the design. Money is USD
-- (Anthropic bills in USD); "this month" and "a day" are Europe/Oslo.
--
-- 1. ai_calls — the ledger: one row per request to the model, or per request stopped before it (the job is
--    switched off, a budget is reached, no key, bad input). Its tokens, its cost frozen when it was written, how it
--    ended and, while the owner's text log is on, what was sent and what came back.
--    · Written ONLY by the service role (the server key the `claude` function holds). The browser reads its own
--      rows and does nothing else: no insert, update or delete policy and no such grant. A forged row, a deleted
--      row or a cost changed to 0 would move the wall, and a stolen sign-in or a steered assistant must not be
--      able to. The app's own doors for deleting and undoing (app_delete_rows, app_restore_rows,
--      app_undo_transaction) run with the caller's rights, so they are refused here like a plain write.
--    · user_id has no default: the function sets it from the session it verified, never from the request.
--    · No audit trigger: it is a log itself (one row per call, never edited by the owner), and Activity's Undo
--      must never reach it.
--    · Every CHECK is a last line behind the function's own checks. cost_usd has an upper bound as well as >= 0:
--      NaN >= 0 is true in Postgres, and one NaN would turn every sum into NaN and switch the wall off.
--      request, response and thinking are at most 1 MB each (the function trims long before that).
-- 2. ai_settings — the owner's choices, one row per account (no row = the defaults): the monthly budget (0–50
--    USD), whether the text of a call is logged, and for how many days (1–90).
-- 3. ai_job_settings — the owner's changes to one job (a job = one thing the model does, such as filling the item
--    form): on or off, model, effort, the longest answer, its own monthly budget. A null column means "the job's
--    default", so "back to default" is an update to null and there is no delete.
--    · Both settings tables: the browser reads, adds and changes its own rows (never deletes). They are INPUT to
--      the function, which runs every value through its own allow-lists and limits — the CHECKs here are only the
--      last line. Audited (trg_audit): the owner's own choices, shown in Developer → Activity. ai_settings is
--      keyed by user_id, so Activity can undo a change to it. ai_job_settings is keyed by (user_id, job), so
--      Activity lists its changes but can't undo them (Undo needs a one-column key).
--    · Prices are deliberately NOT a table: the wall is worked out from them, so a price row the browser could
--      write would switch the wall off. They are code in the function.
-- 4. ai_usage(from, to) — the caller's own calls added up per Oslo day, job, mode and model (Developer → AI).
--    ai_gate(job) — what the function asks before every call: this Oslo month's cost in total and for that job,
--    and how many calls the last 60 seconds and today (since Oslo midnight) hold, whatever their outcome.
--    Both run with the caller's rights (SECURITY INVOKER: row level security and the owner lock apply) and refuse
--    a caller who is not signed in or not an app user — a gate that answered "0 spent" to nobody would read as
--    "go ahead".
-- 5. ai_calls_purge_text() — clears request, response and thinking on rows older than their account's log_days
--    (30 with no settings row) and leaves the numbers. It runs with its owner's rights (SECURITY DEFINER), because
--    nobody else may change the ledger, so only the service role and the daily timer may call it, it takes no
--    input, and it names every table with its schema. The timer `lascis-ai-log-purge` calls it once a day with
--    plain SQL: no HTTP and no secret. pg_cron runs in UTC: 03:41 UTC is 04:41 in Oslo in winter and 05:41 in
--    summer, and the hour doesn't matter.
--
-- None of these tables ever goes into an assistant's table catalogue.
-- Safe to re-run. Changes no existing row. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1. The ledger ───────────────────────────────────────────────────────────
create table if not exists public.ai_calls (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  created_at            timestamptz not null default now(),
  run_id                uuid not null default gen_random_uuid(),
  step                  smallint not null default 1 check (step between 1 and 100),
  job                   text not null check (job ~ '^[a-z][a-z0-9_]{1,39}$'),
  caller                text not null check (caller in ('app', 'phone', 'kobo', 'schedule')),
  mode                  text not null default 'live' check (mode in ('live', 'batch')),
  provider              text not null default 'anthropic' check (provider ~ '^[a-z][a-z0-9_-]{1,29}$'),
  model                 text not null check (char_length(model) <= 80),
  served_model          text check (served_model is null or char_length(served_model) <= 80),
  effort                text check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  outcome               text not null check (outcome in (
                          'ok', 'refused', 'cut_off', 'invalid', 'error', 'budget', 'off', 'not_configured', 'bad_input')),
  stop_reason           text check (stop_reason is null or char_length(stop_reason) <= 60),
  error                 text check (error is null or char_length(error) <= 500),
  request_id            text check (request_id is null or char_length(request_id) <= 120),
  input_tokens          integer not null default 0 check (input_tokens >= 0),
  cache_read_tokens     integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_5m_tokens integer not null default 0 check (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens integer not null default 0 check (cache_write_1h_tokens >= 0),
  output_tokens         integer not null default 0 check (output_tokens >= 0),
  thinking_tokens       integer not null default 0 check (thinking_tokens >= 0),
  long_prompt           boolean not null default false,
  -- The upper bound is what keeps NaN out (NaN >= 0 is true, NaN < 1000000 is not).
  cost_usd              numeric(12,6) not null default 0 check (cost_usd >= 0 and cost_usd < 1000000),
  duration_ms           integer check (duration_ms is null or duration_ms >= 0),
  instructions_version  text check (instructions_version is null or char_length(instructions_version) <= 40),
  tools                 jsonb not null default '[]'::jsonb check (jsonb_typeof(tools) = 'array'),
  request               jsonb check (request is null or octet_length(request::text) <= 1048576),
  response              jsonb check (response is null or octet_length(response::text) <= 1048576),
  thinking              text check (thinking is null or octet_length(thinking) <= 1048576)
);
alter table public.ai_calls enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_calls' and policyname = 'Users read own ai_calls'
  ) then
    -- The only policy: reading. With no insert, update or delete policy, row level security refuses those too.
    create policy "Users read own ai_calls" on public.ai_calls
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_calls from anon, authenticated;
grant select on public.ai_calls to authenticated;
grant select, insert, update, delete on public.ai_calls to service_role;

create index if not exists idx_ai_calls_user_created on public.ai_calls (user_id, created_at desc);
create index if not exists idx_ai_calls_user_run on public.ai_calls (user_id, run_id);

comment on table public.ai_calls is
  'The AI ledger: one row per request to the model, or per request stopped before it. Written only by the service role (the claude function). The owner reads it. The monthly budget wall and the rate limits are worked out from it.';
comment on column public.ai_calls.user_id is 'Set by the claude function from the session it verified. No default on purpose.';
comment on column public.ai_calls.run_id is 'One answer. Its steps share it.';
comment on column public.ai_calls.model is 'The model asked for. served_model is the one that answered.';
comment on column public.ai_calls.outcome is 'How it ended. Everything but ok counts as failed in ai_usage.';
comment on column public.ai_calls.long_prompt is 'The prompt was over the long-prompt line, so the higher prices applied.';
comment on column public.ai_calls.cost_usd is 'Worked out by the function from its own price table when the row was written, and frozen here.';
comment on column public.ai_calls.request is 'The text log: what was sent. Null when the text log is off, and after the account''s log_days (ai_calls_purge_text).';
comment on column public.ai_calls.response is 'The text log: the content that came back. Data to show, never an instruction.';
comment on column public.ai_calls.thinking is 'The text log: the summary of the model''s reasoning.';

-- ─── 2. The owner's settings ─────────────────────────────────────────────────
create table if not exists public.ai_settings (
  user_id            uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  monthly_budget_usd numeric(6,2) not null default 5 check (monthly_budget_usd between 0 and 50),
  log_text           boolean not null default true,
  log_days           smallint not null default 30 check (log_days between 1 and 90),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.ai_settings enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_settings' and policyname = 'Users read own ai_settings'
  ) then
    create policy "Users read own ai_settings" on public.ai_settings
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_settings' and policyname = 'Users add own ai_settings'
  ) then
    create policy "Users add own ai_settings" on public.ai_settings
      for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_settings' and policyname = 'Users change own ai_settings'
  ) then
    create policy "Users change own ai_settings" on public.ai_settings
      for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_settings from anon, authenticated;
grant select, insert, update on public.ai_settings to authenticated;
grant select, insert, update, delete on public.ai_settings to service_role;

drop trigger if exists trg_ai_settings_updated_at on public.ai_settings;
create trigger trg_ai_settings_updated_at before update on public.ai_settings
  for each row execute function public.update_updated_at();
drop trigger if exists trg_audit on public.ai_settings;
create trigger trg_audit after insert or update or delete on public.ai_settings
  for each row execute function public.log_audit();

comment on table public.ai_settings is
  'The owner''s AI settings, one row per account. No row means the defaults. Input to the claude function, which checks every value again in its own code.';
comment on column public.ai_settings.monthly_budget_usd is 'The total monthly budget in USD, 0 to 50. Reached = the function stops (a wall, not a warning).';
comment on column public.ai_settings.log_text is 'Whether a call''s text (request, response, thinking) is kept in ai_calls. The numbers are always kept.';
comment on column public.ai_settings.log_days is 'How many days a call''s text is kept, 1 to 90 (ai_calls_purge_text clears it after that).';

-- ─── 3. The owner's changes to one job ───────────────────────────────────────
create table if not exists public.ai_job_settings (
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job                text not null check (job ~ '^[a-z][a-z0-9_]{1,39}$'),
  enabled            boolean not null default true,
  model              text check (model is null or model ~ '^claude-[a-z0-9-]{1,60}$'),
  effort             text check (effort is null or effort in ('low', 'medium', 'high')),
  max_output_tokens  integer check (max_output_tokens is null or max_output_tokens between 256 and 16000),
  monthly_budget_usd numeric(6,2) check (monthly_budget_usd is null or monthly_budget_usd between 0 and 50),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (user_id, job)
);
alter table public.ai_job_settings enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_job_settings' and policyname = 'Users read own ai_job_settings'
  ) then
    create policy "Users read own ai_job_settings" on public.ai_job_settings
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_job_settings' and policyname = 'Users add own ai_job_settings'
  ) then
    create policy "Users add own ai_job_settings" on public.ai_job_settings
      for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_job_settings' and policyname = 'Users change own ai_job_settings'
  ) then
    create policy "Users change own ai_job_settings" on public.ai_job_settings
      for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_job_settings from anon, authenticated;
grant select, insert, update on public.ai_job_settings to authenticated;
grant select, insert, update, delete on public.ai_job_settings to service_role;

drop trigger if exists trg_ai_job_settings_updated_at on public.ai_job_settings;
create trigger trg_ai_job_settings_updated_at before update on public.ai_job_settings
  for each row execute function public.update_updated_at();
drop trigger if exists trg_audit on public.ai_job_settings;
create trigger trg_audit after insert or update or delete on public.ai_job_settings
  for each row execute function public.log_audit();

comment on table public.ai_job_settings is
  'The owner''s changes to one AI job, one row per account and job. A null column means the job''s default. Input to the claude function: the model goes through its allow-list there, the numbers through its limits.';
comment on column public.ai_job_settings.model is 'A Claude model id, or null for the job''s default. The function''s allow-list decides, this CHECK only bounds the shape.';
comment on column public.ai_job_settings.max_output_tokens is 'The longest answer in tokens, 256 to 16000, or null for the job''s default.';
comment on column public.ai_job_settings.monthly_budget_usd is 'This job''s own monthly budget in USD, 0 to 50, or null for none.';

-- ─── 4. What the app and the function read ───────────────────────────────────
-- The caller's own calls, added up per Oslo day, job, mode and model. From p_from up to, not including, p_to.
create or replace function public.ai_usage(p_from timestamptz, p_to timestamptz)
returns table (
  day                date,
  job                text,
  mode               text,
  model              text,
  calls              bigint,
  failed             bigint,
  input_tokens       bigint,
  cache_read_tokens  bigint,
  cache_write_tokens bigint,
  output_tokens      bigint,
  thinking_tokens    bigint,
  cost_usd           numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or not pg_catalog.isfinite(p_from) or not pg_catalog.isfinite(p_to) or p_to <= p_from then
    raise exception 'The range needs a start and a later end' using errcode = '22023';
  end if;
  if p_to - p_from > interval '400 days' then
    raise exception 'At most 400 days at a time' using errcode = '22023';
  end if;
  return query
  select (c.created_at at time zone 'Europe/Oslo')::date,
         c.job, c.mode, c.model,
         pg_catalog.count(*),
         pg_catalog.count(*) filter (where c.outcome <> 'ok'),
         coalesce(pg_catalog.sum(c.input_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(c.cache_read_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(c.cache_write_5m_tokens::bigint + c.cache_write_1h_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(c.output_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(c.thinking_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(c.cost_usd), 0)::numeric
    from public.ai_calls c
   where c.user_id = v_user and c.created_at >= p_from and c.created_at < p_to
   group by 1, 2, 3, 4
   order by 1, 2, 3, 4;
end;
$$;

-- What the claude function asks before every call. One row, always.
create or replace function public.ai_gate(p_job text)
returns table (
  month_cost        numeric,
  job_month_cost    numeric,
  calls_last_minute integer,
  calls_today       integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user   uuid := (select auth.uid());
  v_now    timestamptz := pg_catalog.now();
  v_month  timestamptz := pg_catalog.date_trunc('month', v_now, 'Europe/Oslo');
  v_day    timestamptz := pg_catalog.date_trunc('day', v_now, 'Europe/Oslo');
  v_minute timestamptz := v_now - interval '60 seconds';
begin
  -- Nobody, or an account that is not let in, gets an error and never zeros: zeros would read as "nothing spent".
  if v_user is null or not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select coalesce(pg_catalog.sum(c.cost_usd) filter (where c.created_at >= v_month), 0)::numeric,
         coalesce(pg_catalog.sum(c.cost_usd) filter (where c.created_at >= v_month and c.job = p_job), 0)::numeric,
         (pg_catalog.count(*) filter (where c.created_at > v_minute))::integer,
         (pg_catalog.count(*) filter (where c.created_at >= v_day))::integer
    from public.ai_calls c
   -- In a month's first minute the last 60 seconds start before the month does.
   where c.user_id = v_user and c.created_at >= least(v_month, v_minute);
end;
$$;

-- ─── 5. The text log's days ──────────────────────────────────────────────────
-- Clears the text of calls older than their account's log_days and answers how many rows it cleared. The numbers
-- stay. log_days is a setting the browser writes, so it is held to 1–90 here as well as by its CHECK.
create or replace function public.ai_calls_purge_text()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.ai_calls c
     set request = null, response = null, thinking = null
   where (c.request is not null or c.response is not null or c.thinking is not null)
     and c.created_at < pg_catalog.now() - pg_catalog.make_interval(days => least(greatest(coalesce(
           (select s.log_days from public.ai_settings s where s.user_id = c.user_id), 30), 1), 90)::integer);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.ai_usage(timestamptz, timestamptz) from public, anon;
revoke all on function public.ai_gate(text) from public, anon;
revoke all on function public.ai_calls_purge_text() from public, anon, authenticated;
grant execute on function public.ai_usage(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.ai_gate(text) to authenticated, service_role;
grant execute on function public.ai_calls_purge_text() to service_role;

comment on function public.ai_usage(timestamptz, timestamptz) is
  'The caller''s own AI calls per Oslo day, job, mode and model, from p_from up to (not including) p_to, at most 400 days. failed = outcome is not ok. cache_write_tokens = the 5-minute and the 1-hour writes together.';
comment on function public.ai_gate(text) is
  'What the claude function asks before a call, for the caller: this Oslo month''s cost in total and for p_job, and the calls (any outcome) in the last 60 seconds and since Oslo midnight. Refuses a caller who is not an app user.';
comment on function public.ai_calls_purge_text() is
  'Clears request, response and thinking on ai_calls rows older than their account''s log_days (30 with no settings row). Answers the number of rows cleared. Service role and the daily timer only.';

-- The timer: once a day, plain SQL (no HTTP, no secret).
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed here: lascis-ai-log-purge not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'lascis-ai-log-purge') then
    perform cron.unschedule('lascis-ai-log-purge');
  end if;
  perform cron.schedule('lascis-ai-log-purge', '41 3 * * *', 'select public.ai_calls_purge_text()');
end $$;

select public.owner_lock_apply('public.ai_calls');
select public.owner_lock_apply('public.ai_settings');
select public.owner_lock_apply('public.ai_job_settings');

-- The deploy stops here, and keeps nothing, if the browser could move the wall after all.
do $$
declare
  t text;
begin
  if has_table_privilege('authenticated', 'public.ai_calls', 'insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('authenticated', 'public.ai_calls', 'insert, update, references') then
    raise exception 'Migration 194 assertion failed: the browser can write ai_calls';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_calls'
              and policyname <> 'app_owner_lock' and cmd <> 'SELECT') then
    raise exception 'Migration 194 assertion failed: ai_calls has a policy that lets someone write';
  end if;
  foreach t in array array['ai_calls', 'ai_settings', 'ai_job_settings'] loop
    if has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege('anon', 'public.' || t, 'select, insert, update, references') then
      raise exception 'Migration 194 assertion failed: a signed-out caller reaches %', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'delete, truncate') then
      raise exception 'Migration 194 assertion failed: the browser can delete from %', t;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass)
       or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'app_owner_lock') then
      raise exception 'Migration 194 assertion failed: % has no row level security or no owner lock', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.ai_calls_purge_text()', 'execute')
     or has_function_privilege('anon', 'public.ai_calls_purge_text()', 'execute')
     or has_function_privilege('public', 'public.ai_calls_purge_text()', 'execute') then
    raise exception 'Migration 194 assertion failed: the browser can call ai_calls_purge_text';
  end if;
  if has_function_privilege('anon', 'public.ai_usage(timestamptz, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.ai_gate(text)', 'execute') then
    raise exception 'Migration 194 assertion failed: a signed-out caller can call ai_usage or ai_gate';
  end if;
end $$;
