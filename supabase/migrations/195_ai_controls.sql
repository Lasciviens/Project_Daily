-- 195 · AI controls and numbers (owner-critic and security review of AI phase 2b–2d, 22.11.2026).
--
-- 1. ai_settings.ai_enabled — the master switch, "all AI off". The `claude` function reads it (as input: anything
--    that is not exactly true stops every job, a device's too) and answers reason 'off' with a ledger row and no
--    call. Default true, so an account with no change behaves as before.
-- 2. ai_job_settings.thinking — per job: null (the job's default, adaptive), 'adaptive' or 'off'. Input again: the
--    function takes only the word 'off' as off. Default stays adaptive until a job's answers are measured to be as
--    good without thinking (docs/features/ai.md).
-- 3. ai_usage(from, to) gets five more columns at its END (every old column keeps its place): the average and the
--    slowest time of the calls that really ran (avg_duration_ms, max_duration_ms, over timed_calls), and the calls
--    whose bill is unknown (held_calls, held_cost_usd: a cost above zero with no token counted, outcome error or
--    pending = the reserved worst case stays charged). A function's result columns cannot change with
--    CREATE OR REPLACE, so the function is dropped and created again, with the same rights and refusals:
--    SECURITY INVOKER (row level security and the owner lock apply), search_path = '', a caller who is not signed
--    in or not an app user is refused, the same range checks.
-- 4. ai_reserve gets p_caller_per_day (security review G2): the 100-calls-a-day cap of a device was only read early,
--    without a lock, so a burst could overshoot it. It is now counted under the same per-account advisory lock as
--    the budget and the other caps: this caller's rows in the last 24 hours (any outcome) against p_caller_per_day,
--    answered 'busy' like the other caps. The signature changes, so the old function is dropped and the new one
--    created with the same rights: SECURITY DEFINER, search_path = '', service role only. Until the new `claude` code
--    is deployed (right after this migration, in the same deploy) a call to the old signature finds no function and
--    sends nothing (the function fails closed).
--
-- Safe to re-run. Changes no existing row. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1 and 2. The two settings ───────────────────────────────────────────────
alter table public.ai_settings add column if not exists ai_enabled boolean not null default true;
alter table public.ai_job_settings add column if not exists thinking text
  check (thinking is null or thinking in ('adaptive', 'off'));

comment on column public.ai_settings.ai_enabled is 'The master switch: false stops every AI job, the Kobo''s and the phone''s too (the function answers off, with a ledger row, and calls nothing).';
comment on column public.ai_job_settings.thinking is 'null = the job''s default (adaptive), adaptive, or off (no reasoning: cheaper and faster). Input to the function, which takes only off as off.';

-- ─── 3. ai_usage with the times and the held calls ───────────────────────────
drop function if exists public.ai_usage(timestamptz, timestamptz);
create function public.ai_usage(p_from timestamptz, p_to timestamptz)
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
  cost_usd           numeric,
  avg_duration_ms    bigint,
  max_duration_ms    bigint,
  timed_calls        bigint,
  held_calls         bigint,
  held_cost_usd      numeric
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
         coalesce(pg_catalog.sum(c.cost_usd), 0)::numeric,
         -- A call that really ran: stopped-before-sending rows (budget, off, no key, bad input) and pending rows have no time.
         coalesce(pg_catalog.round(pg_catalog.avg(c.duration_ms) filter (
           where c.outcome in ('ok', 'refused', 'cut_off', 'invalid', 'error') and c.duration_ms > 0)), 0)::bigint,
         coalesce(pg_catalog.max(c.duration_ms) filter (
           where c.outcome in ('ok', 'refused', 'cut_off', 'invalid', 'error') and c.duration_ms > 0), 0)::bigint,
         pg_catalog.count(*) filter (
           where c.outcome in ('ok', 'refused', 'cut_off', 'invalid', 'error') and c.duration_ms > 0),
         -- Held at the worst case: the bill is unknown (a timeout, a crash), so the reservation stays charged.
         pg_catalog.count(*) filter (
           where c.cost_usd > 0 and c.outcome in ('error', 'pending')
             and c.input_tokens = 0 and c.cache_read_tokens = 0 and c.cache_write_5m_tokens = 0
             and c.cache_write_1h_tokens = 0 and c.output_tokens = 0),
         coalesce(pg_catalog.sum(c.cost_usd) filter (
           where c.cost_usd > 0 and c.outcome in ('error', 'pending')
             and c.input_tokens = 0 and c.cache_read_tokens = 0 and c.cache_write_5m_tokens = 0
             and c.cache_write_1h_tokens = 0 and c.output_tokens = 0), 0)::numeric
    from public.ai_calls c
   where c.user_id = v_user and c.created_at >= p_from and c.created_at < p_to
   group by 1, 2, 3, 4
   order by 1, 2, 3, 4;
end;
$$;
revoke all on function public.ai_usage(timestamptz, timestamptz) from public, anon;
grant execute on function public.ai_usage(timestamptz, timestamptz) to authenticated, service_role;
comment on function public.ai_usage(timestamptz, timestamptz) is
  'The caller''s own AI calls per Oslo day, job, mode and model, from p_from up to (not including) p_to, at most 400 days. failed = outcome is not ok. cache_write_tokens = the 5-minute and the 1-hour writes together. avg/max_duration_ms over timed_calls (calls that really ran); held_* = calls whose bill is unknown, charged at the reserved worst case.';

-- ─── 4. ai_reserve with a per-caller daily cap under the lock ────────────────
drop function if exists public.ai_reserve(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, integer, integer);
create or replace function public.ai_reserve(
  p_user uuid, p_job text, p_caller text, p_mode text, p_provider text, p_model text, p_effort text,
  p_instructions_version text, p_worst_cost numeric, p_budget numeric, p_job_budget numeric,
  p_per_minute integer, p_per_day integer, p_caller_per_day integer)
returns table (call_id uuid, reason text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := pg_catalog.now();
  v_month    timestamptz := pg_catalog.date_trunc('month', v_now, 'Europe/Oslo');
  v_day      timestamptz := pg_catalog.date_trunc('day', v_now, 'Europe/Oslo');
  v_total    numeric;
  v_job      numeric;
  v_minute   integer;
  v_today    integer;
  v_by_caller integer;
  v_id       uuid;
begin
  if p_user is null or p_worst_cost is null or p_worst_cost < 0 or p_worst_cost > 1000
     or p_budget is null or p_job_budget is null or p_per_minute is null or p_per_day is null
     or p_caller is null or p_caller_per_day is null or p_caller_per_day < 0 then
    raise exception 'ai_reserve: bad arguments' using errcode = '22023';
  end if;
  -- One account's reservations queue here, so two calls can't both read "room for one more".
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai_reserve:' || p_user::text, 0));
  select coalesce(pg_catalog.sum(c.cost_usd), 0), coalesce(pg_catalog.sum(c.cost_usd) filter (where c.job = p_job), 0)
    into v_total, v_job
    from public.ai_calls c where c.user_id = p_user and c.created_at >= v_month;
  select pg_catalog.count(*) filter (where c.created_at > v_now - interval '60 seconds'), pg_catalog.count(*)
    into v_minute, v_today
    from public.ai_calls c where c.user_id = p_user and c.created_at >= v_day;
  -- This caller's own rows in the last 24 hours (any outcome): a device's daily cap, counted under the same lock.
  select pg_catalog.count(*) into v_by_caller
    from public.ai_calls c
   where c.user_id = p_user and c.caller = p_caller and c.created_at > v_now - interval '24 hours';
  if v_minute >= p_per_minute or v_today >= p_per_day or v_by_caller >= p_caller_per_day then
    return query select null::uuid, 'busy'::text;
    return;
  end if;
  if v_total + p_worst_cost > p_budget or v_job + p_worst_cost > p_job_budget then
    insert into public.ai_calls (user_id, job, caller, mode, provider, model, effort, outcome, instructions_version)
    values (p_user, p_job, p_caller, p_mode, p_provider, p_model, p_effort, 'budget', p_instructions_version)
    returning id into v_id;
    return query select v_id, 'budget'::text;
    return;
  end if;
  insert into public.ai_calls (user_id, job, caller, mode, provider, model, effort, outcome, cost_usd, instructions_version)
  values (p_user, p_job, p_caller, p_mode, p_provider, p_model, p_effort, 'pending', p_worst_cost, p_instructions_version)
  returning id into v_id;
  return query select v_id, null::text;
end;
$$;
revoke all on function public.ai_reserve(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, integer)
  to service_role;

-- The deploy stops here, and keeps nothing, if the browser could move the wall after all (194's checks, again, for
-- what this file made new).
do $$
begin
  if has_function_privilege('authenticated', 'public.ai_reserve(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.ai_reserve(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, integer)', 'execute')
     or has_function_privilege('public', 'public.ai_reserve(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, integer)', 'execute') then
    raise exception 'Migration 195 assertion failed: the browser can call ai_reserve';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'ai_reserve' and pg_catalog.pg_get_function_identity_arguments(p.oid) not like '%p_caller_per_day integer') then
    raise exception 'Migration 195 assertion failed: an older ai_reserve without the per-caller cap is still there';
  end if;
  if has_function_privilege('anon', 'public.ai_usage(timestamptz, timestamptz)', 'execute')
     or has_function_privilege('public', 'public.ai_usage(timestamptz, timestamptz)', 'execute') then
    raise exception 'Migration 195 assertion failed: a signed-out caller can call ai_usage';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.ai_usage(timestamptz, timestamptz)'::regprocedure) then
    raise exception 'Migration 195 assertion failed: ai_usage must stay SECURITY INVOKER';
  end if;
  if has_table_privilege('authenticated', 'public.ai_calls', 'insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('authenticated', 'public.ai_calls', 'insert, update, references') then
    raise exception 'Migration 195 assertion failed: the browser can write ai_calls';
  end if;
end $$;
