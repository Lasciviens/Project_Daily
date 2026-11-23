-- 199 · AI suggestions: ideas for making AI necessary for fewer things (AI rebuild, phase 4c, 23.11.2026 —
-- docs/features/ai-plan.md §8, the system the owner approved on 20.11.2026: "The discovery system must only recommend
-- new reusable queries or workflows. It must not automatically create, activate, or modify them.").
--
-- Three ways of finding an idea, cheapest first: a counting function over the ledger (no AI), one optional tool in an
-- Ask AI answer (`note_shortcut`, no extra call) and one Haiku batch a week. All of them only WRITE A ROW HERE. Nothing
-- is created, switched on or changed by an idea: the owner reads it and may send it to Dev Requests.
--
-- 1. ai_suggestions — one row per idea (not per sighting).
--    · A suggestion is written by a model, so it is INPUT (text in a note or a web page could steer it): plain text
--      only, enforced here as the last line behind the function's own checks (a length, no `<`, `>`, control character
--      or link), shown as text, never a link, never acted on by code.
--    · Written ONLY by the service role (the claude function), through ai_suggestion_add below. The browser reads its own
--      rows and may change ONE column, `state` (new · kept · dismissed · built): the table's only update grant for the
--      browser is `update (state)`, a trigger refuses a change to any other column from a signed-in caller (also if a
--      wider grant ever slips in), and the update policy keeps it to the owner's own rows. So the browser can neither
--      forge a count, a saving or a text nor add or delete a row (no insert or delete grant, no such policy). A
--      dismissed idea is never deleted: its row is what stops it coming back.
--    · One row per (user_id, dedupe_key). The key is made by the function (a hash of the idea's kind and normalised
--      title, or of the counted pattern): the same key is a count, never a second row, and a dismissed key is never
--      written again.
--    · Audited (trg_audit) only when `state` is changed — the owner's own choice, shown in Developer → Activity. The
--      service role's counter bumps never touch `state`, so they are not logged.
-- 2. ai_suggestion_add(…) — the one way a suggestion is written: insert, or count the sighting of an existing one, or
--    refuse (dismissed, 300 rows in all, 20 new ideas from answers in a day). SECURITY INVOKER (it needs no more rights
--    than the service role has), service role only. The caps are here as well as in the function's code: a steered
--    model, or a bug, cannot flood the table.
-- 3. ai_suggest_patterns(…) — the counting, no AI: over the account's ledger of the last 30 days (`ai_calls`, only the
--    shapes it holds: tool names, field names, SQL fingerprints with the values taken out, tokens and costs) it finds
--    answers that call the same tools in the same order, the same shape of question, the same fallback-SQL
--    fingerprint, the jobs that cost most, and jobs that send much and use little. SECURITY INVOKER and service role
--    only: it reads one account's ledger (named by the function from the session it verified), it needs no definer
--    rights, and it refuses a signed-in caller. Names read from the ledger are checked again (a tool name or field name
--    is written by the model's own call, so it is input): only plain lower-case words are kept.
-- 4. ai_suggest_runs — the weekly Haiku batch's bookkeeping, one row per (account, week, maker), like ai_reports (196):
--    written only by the service role; `batch_id`, `claimed_at` and `facts` are server-only (the function asks Anthropic about
--    whatever batch id it reads here, so the browser can neither write nor read it; `facts` is what the answer is read against).
-- 5. The check timer (196's `lascis-ai-report-check`) is made again so that it also runs while a suggestion batch waits.
--
-- Safe to re-run. Changes no existing row. No BEGIN/COMMIT: the deploy runs it as one transaction.

-- ─── 1. The ideas ────────────────────────────────────────────────────────────
create table if not exists public.ai_suggestions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  kind             text not null check (kind in ('widget', 'chart', 'automation', 'notification', 'report', 'existing_feature', 'new_tool', 'cheaper_setting')),
  -- Plain text: no angle brackets, no control character (a new line either), no link.
  title            text not null check (char_length(title) between 3 and 120 and title !~ '[<>[:cntrl:]]' and title !~* '(https?:|www\.)'),
  why              text not null check (char_length(why) between 3 and 400 and why !~ '[<>[:cntrl:]]' and why !~* '(https?:|www\.)'),
  source           text not null check (source in ('answer', 'weekly')),
  -- The saving, worked out from the ledger: how many times it was seen, and what one time took.
  times_seen       integer not null default 1 check (times_seen between 1 and 1000000),
  tokens_each      integer not null default 0 check (tokens_each between 0 and 10000000),
  cost_each_usd    numeric(12,6) not null default 0 check (cost_each_usd >= 0 and cost_each_usd < 1000000),
  first_call_id    uuid references public.ai_calls(id) on delete set null,
  dedupe_key       text not null check (dedupe_key ~ '^[0-9a-f]{64}$'),
  state            text not null default 'new' check (state in ('new', 'kept', 'dismissed', 'built')),
  state_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  constraint ai_suggestions_one_per_idea unique (user_id, dedupe_key)
);
alter table public.ai_suggestions enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_suggestions' and policyname = 'Users read own ai_suggestions'
  ) then
    create policy "Users read own ai_suggestions" on public.ai_suggestions
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_suggestions' and policyname = 'Users change own ai_suggestions'
  ) then
    -- Which columns may change is the grant's and the trigger's business; this keeps it to the owner's own rows.
    create policy "Users change own ai_suggestions" on public.ai_suggestions
      for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_suggestions from anon, authenticated;
grant select on public.ai_suggestions to authenticated;
grant update (state) on public.ai_suggestions to authenticated;
grant select, insert, update, delete on public.ai_suggestions to service_role;

create index if not exists idx_ai_suggestions_user_state on public.ai_suggestions (user_id, state, last_seen_at desc);

-- A signed-in caller may change `state` and nothing else; the timestamps follow. The service role (no signed-in user)
-- changes counts and nothing else (its own function), and never resurrects a dismissed idea (ai_suggestion_add).
create or replace function public.ai_suggestions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    if (to_jsonb(new) - 'state' - 'state_changed_at' - 'updated_at') is distinct from (to_jsonb(old) - 'state' - 'state_changed_at' - 'updated_at') then
      raise exception 'ai_suggestions: only the state of an idea can be changed here' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  if new.state is distinct from old.state then new.state_changed_at := now(); end if;
  return new;
end $$;
revoke all on function public.ai_suggestions_guard() from public, anon, authenticated;
drop trigger if exists trg_ai_suggestions_guard on public.ai_suggestions;
create trigger trg_ai_suggestions_guard before update on public.ai_suggestions
  for each row execute function public.ai_suggestions_guard();
drop trigger if exists trg_audit on public.ai_suggestions;
create trigger trg_audit after update of state on public.ai_suggestions
  for each row execute function public.log_audit();

comment on table public.ai_suggestions is
  'Ideas for needing AI less (widget, chart, automation, notification, report, existing feature, new tool, cheaper setting), written by the claude function only. Text written by a model: plain text, never acted on. The owner reads them and changes only `state`.';
comment on column public.ai_suggestions.dedupe_key is 'Made by the function (sha-256 of the idea''s kind and normalised title, or of the counted pattern): one row per idea, and a dismissed one never comes back.';
comment on column public.ai_suggestions.times_seen is 'How many times the idea was seen: the counting function''s count, or one per answer that noted it.';
comment on column public.ai_suggestions.tokens_each is 'The tokens one time took (input + output), from the ledger.';
comment on column public.ai_suggestions.cost_each_usd is 'What one time cost, from the ledger (frozen when the idea was written).';
comment on column public.ai_suggestions.first_call_id is 'The ledger row the idea was first seen on.';

-- ─── 2. Writing an idea ──────────────────────────────────────────────────────
create or replace function public.ai_suggestion_add(
  p_user_id uuid, p_kind text, p_title text, p_why text, p_source text, p_key text,
  p_times integer, p_tokens integer, p_cost numeric, p_call uuid
) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_state text;
  v_rows  integer;
begin
  -- The service role only (no signed-in user); the grants below say the same.
  if p_user_id is null or (select auth.uid()) is not null then
    raise exception 'ai_suggestion_add: the service role only' using errcode = '42501';
  end if;
  select s.state into v_state from public.ai_suggestions s where s.user_id = p_user_id and s.dedupe_key = p_key for update;
  if found then
    -- A dismissed idea is never written again, not even as a count.
    if v_state = 'dismissed' then return 'dismissed'; end if;
    update public.ai_suggestions s
       set times_seen = least(s.times_seen + greatest(coalesce(p_times, 1), 1), 1000000), last_seen_at = now()
     where s.user_id = p_user_id and s.dedupe_key = p_key;
    return 'seen';
  end if;
  if (select count(*) from public.ai_suggestions s where s.user_id = p_user_id) >= 300 then return 'full'; end if;
  if p_source = 'answer'
     and (select count(*) from public.ai_suggestions s where s.user_id = p_user_id and s.source = 'answer' and s.created_at > now() - interval '1 day') >= 20 then
    return 'limit';
  end if;
  insert into public.ai_suggestions (user_id, kind, title, why, source, times_seen, tokens_each, cost_each_usd, first_call_id, dedupe_key)
  values (p_user_id, p_kind, p_title, p_why, p_source, greatest(coalesce(p_times, 1), 1), greatest(coalesce(p_tokens, 0), 0), greatest(coalesce(p_cost, 0), 0), p_call, p_key)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'added' else 'seen' end;
exception when check_violation or foreign_key_violation or numeric_value_out_of_range then
  return 'invalid';
end $$;
revoke all on function public.ai_suggestion_add(uuid, text, text, text, text, text, integer, integer, numeric, uuid) from public, anon, authenticated;
grant execute on function public.ai_suggestion_add(uuid, text, text, text, text, text, integer, integer, numeric, uuid) to service_role;

-- ─── 3. The counting, no AI ──────────────────────────────────────────────────
-- What it finds (thresholds: p_min_times, and the three constants below; the function's code asks again with its own):
--   tool_sequence          the same tools called in the same order by ≥ p_min_times answers (2 to 8 tools);
--   question_shape         the same tools with the same fields given (the fallback SQL tool left out) by ≥ p_min_times answers;
--   database_fingerprint   the same fallback-SQL fingerprint (values taken out) in ≥ p_min_times answers;
--   costly_job             a job's total cost over $0.05 in ≥ p_min_times calls (the three dearest);
--   big_input_small_output a job whose calls average ≥ 15 000 uncached input tokens and ≤ 300 output tokens, ≥ p_min_times calls.
create or replace function public.ai_suggest_patterns(p_user_id uuid, p_days integer default 30, p_min_times integer default 3)
returns table (
  pattern_kind text, pattern_key text, times integer, avg_tokens integer, avg_input_tokens integer, avg_output_tokens integer,
  avg_cost_usd numeric, total_cost_usd numeric, first_call_id uuid, last_seen timestamptz
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_min  integer := least(greatest(coalesce(p_min_times, 3), 2), 1000);
begin
  if p_user_id is null or (select auth.uid()) is not null then
    raise exception 'ai_suggest_patterns: the service role only' using errcode = '42501';
  end if;
  return query
  with calls as (
    select c.id, c.run_id, c.step, c.created_at, c.job, c.outcome, c.tools, c.cost_usd, c.output_tokens,
           c.input_tokens + c.cache_write_5m_tokens + c.cache_write_1h_tokens as fresh_in,
           c.input_tokens + c.cache_read_tokens + c.cache_write_5m_tokens + c.cache_write_1h_tokens as all_in
      from public.ai_calls c
     where c.user_id = p_user_id and c.created_at >= now() - make_interval(days => v_days)
       and c.job not in ('diagnose', 'test_bench', 'suggest_weekly')
  ),
  tool_rows as (
    select c.run_id, c.step, t.ord::integer as ord, t.e ->> 'name' as tname,
           (select string_agg(f, '+' order by f)
              from jsonb_array_elements_text(case when jsonb_typeof(t.e -> 'fields') = 'array' then t.e -> 'fields' else '[]'::jsonb end) f
             where f ~ '^[a-z][a-z0-9_]{1,39}$') as fields,
           case when char_length(t.e ->> 'fingerprint') between 1 and 300 and (t.e ->> 'fingerprint') !~ '[[:cntrl:]]' then t.e ->> 'fingerprint' end as fp
      from calls c
     cross join lateral jsonb_array_elements(c.tools) with ordinality as t(e, ord)
     where c.job = 'chat' and jsonb_typeof(t.e) = 'object'
       and (t.e ->> 'name') ~ '^[a-z][a-z0-9_]{1,39}$' and (t.e ->> 'ok') = 'true'
  ),
  runs as (
    select c.run_id, (array_agg(c.id order by c.created_at, c.step))[1] as first_call, max(c.created_at) as seen,
           sum(c.all_in)::bigint as in_tok, sum(c.output_tokens)::bigint as out_tok, sum(c.cost_usd) as cost
      from calls c where c.job = 'chat' group by c.run_id
  ),
  seqs as (
    select r.run_id, count(*) as n,
           left(string_agg(r.tname, ' > ' order by r.step, r.ord), 200) as names,
           left(string_agg(case when r.tname <> 'ask_database' then r.tname || '(' || coalesce(r.fields, '') || ')' end, ' > ' order by r.step, r.ord), 300) as shape
      from tool_rows r group by r.run_id
  ),
  found as (
    select 'tool_sequence'::text as k, s.names as pkey, s.run_id from seqs s where s.n between 2 and 8
    union all
    select 'question_shape', s.shape, s.run_id from seqs s where s.shape is not null
    union all
    select 'database_fingerprint', d.fp, d.run_id from (select distinct r.fp, r.run_id from tool_rows r where r.tname = 'ask_database' and r.fp is not null) d
  ),
  grouped as (
    select f.k, f.pkey, count(*)::integer as n, avg(r.in_tok + r.out_tok)::integer as avg_tok, avg(r.in_tok)::integer as avg_in, avg(r.out_tok)::integer as avg_out,
           avg(r.cost) as avg_cost, sum(r.cost) as sum_cost,
           (array_agg(r.first_call order by r.seen))[1] as first_id, max(r.seen) as last_at,
           row_number() over (partition by f.k order by count(*) desc, sum(r.cost) desc) as rank
      from found f join runs r on r.run_id = f.run_id
     where f.pkey is not null and f.pkey <> ''
     group by f.k, f.pkey
    having count(*) >= v_min
  ),
  jobs as (
    select c.job, count(*)::integer as n, avg(c.all_in + c.output_tokens)::integer as avg_tok, avg(c.all_in)::integer as avg_in, avg(c.output_tokens)::integer as avg_out,
           avg(c.fresh_in) as avg_fresh, avg(c.cost_usd) as avg_cost, sum(c.cost_usd) as sum_cost,
           (array_agg(c.id order by c.created_at))[1] as first_id, max(c.created_at) as last_at
      from calls c where c.outcome = 'ok' group by c.job
  )
  select g.k, g.pkey, g.n, g.avg_tok, g.avg_in, g.avg_out, g.avg_cost, g.sum_cost, g.first_id, g.last_at from grouped g where g.rank <= 10
  union all
  select 'costly_job', j.job, j.n, j.avg_tok, j.avg_in, j.avg_out, j.avg_cost, j.sum_cost, j.first_id, j.last_at
    from (select x.*, row_number() over (order by x.sum_cost desc) as rank from jobs x where x.n >= v_min and x.sum_cost >= 0.05) j where j.rank <= 3
  union all
  select 'big_input_small_output', j.job, j.n, j.avg_tok, j.avg_in, j.avg_out, j.avg_cost, j.sum_cost, j.first_id, j.last_at
    from jobs j where j.n >= v_min and j.avg_fresh >= 15000 and j.avg_out <= 300;
end $$;
revoke all on function public.ai_suggest_patterns(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_suggest_patterns(uuid, integer, integer) to service_role;

-- ─── 4. The weekly batch's bookkeeping ───────────────────────────────────────
create table if not exists public.ai_suggest_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),
  made_by     text not null check (made_by in ('schedule', 'app')),
  status      text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  failure     text check (failure is null or char_length(failure) <= 300),
  -- How many new ideas the answer added, and how many counted patterns the model was shown.
  added       integer not null default 0 check (added between 0 and 5),
  patterns    integer not null default 0 check (patterns between 0 and 100),
  -- Exactly what the model read: counts, costs and shapes, never a row of the owner's data.
  sent_text   text check (sent_text is null or char_length(sent_text) <= 20000),
  -- The counted patterns the model was shown, as the function checked them (server-only: the answer is read against them).
  facts       jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object' and octet_length(facts::text) <= 65536),
  -- Anthropic's batch: server-only (see the header).
  batch_id    text check (batch_id is null or batch_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  call_id     uuid references public.ai_calls(id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  finished_at timestamptz,
  constraint ai_suggest_runs_week_maker unique (user_id, week_start, made_by)
);
alter table public.ai_suggest_runs enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_suggest_runs' and policyname = 'Users read own ai_suggest_runs'
  ) then
    create policy "Users read own ai_suggest_runs" on public.ai_suggest_runs
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.ai_suggest_runs from anon, authenticated;
grant select (id, user_id, week_start, made_by, status, failure, added, patterns, sent_text, call_id, created_at, finished_at)
  on public.ai_suggest_runs to authenticated;
grant select, insert, update, delete on public.ai_suggest_runs to service_role;
create index if not exists idx_ai_suggest_runs_queued on public.ai_suggest_runs (user_id, created_at) where status = 'queued';
create index if not exists idx_ai_suggest_runs_user_week on public.ai_suggest_runs (user_id, week_start desc);
comment on table public.ai_suggest_runs is
  'The weekly suggestion batch: one row per week and maker. Written only by the service role. batch_id and claimed_at are server-only.';
comment on column public.ai_suggest_runs.batch_id is 'Anthropic''s batch id: a link to an outside service. Server-only: the browser can neither write nor read it.';

-- ─── 5. The check timer, made again ──────────────────────────────────────────
-- 196's `lascis-ai-report-check`, with one more reason to run: a suggestion batch is waiting. Same credential, same quiet
-- when nothing waits.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed here: lascis-ai-report-check not scheduled again';
    return;
  end if;
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
       or exists (select 1 from public.ai_reports r where r.push_due and r.pushed_at is null)
       or exists (select 1 from public.ai_suggest_runs r where r.status = 'queued');
  $cron$);
end $$;

select public.owner_lock_apply('public.ai_suggestions');
select public.owner_lock_apply('public.ai_suggest_runs');

-- The deploy stops here, and keeps nothing, if the browser could write more than an idea's state, write a run, or read a
-- server-only column, or if a signed-out caller reached any of it.
do $$
begin
  if has_table_privilege('authenticated', 'public.ai_suggestions', 'insert, delete, truncate, references, trigger')
     or has_table_privilege('authenticated', 'public.ai_suggestions', 'update')
     or has_any_column_privilege('authenticated', 'public.ai_suggestions', 'insert, references') then
    raise exception 'Migration 199 assertion failed: the browser can write ai_suggestions beyond one column';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ai_suggestions'::regclass and a.attnum > 0 and not a.attisdropped
                and a.attname <> 'state' and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')) then
    raise exception 'Migration 199 assertion failed: the browser can change a column of ai_suggestions other than state';
  end if;
  if has_table_privilege('authenticated', 'public.ai_suggest_runs', 'insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('authenticated', 'public.ai_suggest_runs', 'insert, update, references') then
    raise exception 'Migration 199 assertion failed: the browser can write ai_suggest_runs';
  end if;
  if has_column_privilege('authenticated', 'public.ai_suggest_runs', 'batch_id', 'select')
     or has_column_privilege('authenticated', 'public.ai_suggest_runs', 'claimed_at', 'select')
     or has_column_privilege('authenticated', 'public.ai_suggest_runs', 'facts', 'select')
     or has_table_privilege('authenticated', 'public.ai_suggest_runs', 'select') then
    raise exception 'Migration 199 assertion failed: the browser can read a server-only column of ai_suggest_runs';
  end if;
  if has_table_privilege('anon', 'public.ai_suggestions', 'select, insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('anon', 'public.ai_suggestions', 'select, insert, update, references')
     or has_table_privilege('anon', 'public.ai_suggest_runs', 'select, insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('anon', 'public.ai_suggest_runs', 'select, insert, update, references') then
    raise exception 'Migration 199 assertion failed: a signed-out caller reaches the suggestions';
  end if;
  if has_function_privilege('authenticated', 'public.ai_suggestion_add(uuid, text, text, text, text, text, integer, integer, numeric, uuid)', 'execute')
     or has_function_privilege('anon', 'public.ai_suggestion_add(uuid, text, text, text, text, text, integer, integer, numeric, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ai_suggest_patterns(uuid, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.ai_suggest_patterns(uuid, integer, integer)', 'execute') then
    raise exception 'Migration 199 assertion failed: the browser can call the suggestion functions';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_suggest_runs'
              and policyname <> 'app_owner_lock' and cmd <> 'SELECT')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_suggestions'
              and policyname <> 'app_owner_lock' and cmd not in ('SELECT', 'UPDATE')) then
    raise exception 'Migration 199 assertion failed: a policy lets someone write that should not';
  end if;
end $$;
