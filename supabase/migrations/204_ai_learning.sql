-- 204 · The AI keeps learning (owner, 23.11.2026: "The ai should keep learning." · "find the best ways to train to make it
-- learn from what it does." · "All 5. But do not put specific limitations.. it should learn in every way." · replay: "Yes,
-- delete right after." · "Do as one phase."). docs/features/ai-plan.md §10, docs/features/ai.md "Learning".
--
-- Fine-tuning is not offered for Claude: the app learns by keeping what it learns HERE and giving the right parts back to a
-- call, always as data. Every table below is written by the claude function (service role) or by the owner's own tap;
-- the browser may change ONE column, `state`, of the rows it is shown (column grant + guard trigger + policy, as 199).
--
--  1. ai_learn_answers  — the AI's OWN values of a reviewed job, kept by the function when it answers (server-only). When
--                         the owner saves, the browser sends only the call id and the saved values: the "before" never
--                         comes from the browser. Claimed once (`reported_at`). Purged after 30 days.
--  2. ai_corrections    — one row per AI-filled field the owner reviewed: edited · unticked · kept · dismissed.
--  3. ai_rules          — repeated identical corrections become a code rule (job, field, match key → value). The function
--                         may PROPOSE one; only the owner's tap turns it on (the trigger refuses the service role).
--  4. ai_cases          — owner-typed or owner-confirmed examples (a compact input, the final output, the field diffs),
--                         found again by full-text search and trigram similarity. Expire with their own retention.
--  5. ai_lessons        — short notes: facts, preferences and instructions, each with its source and trust. Append-only
--                         versions (a new text is a new row). A row that is not a fact from a trusted source
--                         (`needs_owner`) can be turned on ONLY by the owner: the trigger refuses the service role.
--  6. ai_job_learning   — per job, the example strategy that is the champion, the previous one (rollback = swap) and the
--                         tripwire that watches the calls after a change. Server-only writes.
--  7. ai_eval_runs      — the weekly self-test (Message Batches): `batch_id`, `plan` and `claimed_at` are server-only.
--  8. ai_source_stats   — per job and host, how often a page read worked. Only ever ORDERS candidates; never a target.
--  8b. ai_suggestions (199) takes one more kind, `instruction_change`: a lesson that won becomes a suggested code change.
--  9. Functions: ai_case_candidates (service role), ai_source_note (service role), ai_learn_quarantine and
--     ai_lesson_rollback (the owner, SECURITY INVOKER), ai_learn_purge (daily timer), and a trigger that records a
--     dismissed suggestion (ai_suggestions, 199) as a correction.
-- 10. The check timer (196/199's `lascis-ai-report-check`) also runs while a self-test batch waits; a daily purge timer.
--
-- Not audited (a one-line reason, as the rules ask): every browser change is a `state` toggle with its own Undo in
-- Developer → AI → Learn; an audited change would be offered to Activity's Undo, which does not know the bookkeeping columns.
-- Safe to re-run. Changes no existing row. No BEGIN/COMMIT: the deploy runs it as one transaction.

create extension if not exists pg_trgm;

-- ─── 1. The AI's own values (server-only) ────────────────────────────────────
create table if not exists public.ai_learn_answers (
  call_id       uuid primary key references public.ai_calls(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  job           text not null check (job ~ '^[a-z_]{1,40}$'),
  -- field → value, as the job's own check let it through (strings; a list row is "items.3.category_id").
  ai_values     jsonb not null check (jsonb_typeof(ai_values) = 'object' and pg_column_size(ai_values) <= 65536),
  -- The job's input without photos or files (so a case can be replayed), and its compact text.
  input         jsonb check (input is null or (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 32768)),
  input_text    text check (input_text is null or (char_length(input_text) <= 2000 and input_text ~ '\S')),
  input_trust   text not null check (input_trust in ('owner_typed', 'owner_confirmed')),
  -- What the call was given: the rules applied, the cases and lessons sent, and the example strategy.
  rules_applied jsonb not null default '[]'::jsonb check (jsonb_typeof(rules_applied) = 'array'),
  knowledge     jsonb not null default '[]'::jsonb check (jsonb_typeof(knowledge) = 'array'),
  setup         text check (setup is null or setup ~ '^[a-z0-9_.-]{1,40}$'),
  reported_at   timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.ai_learn_answers enable row level security;
revoke all on public.ai_learn_answers from anon, authenticated;
grant select, insert, update, delete on public.ai_learn_answers to service_role;
create index if not exists idx_ai_learn_answers_user_job on public.ai_learn_answers (user_id, job, created_at desc);
comment on table public.ai_learn_answers is 'The AI''s own values of a reviewed job, kept by the claude function when it answers. Server-only: the browser can neither read nor write it, so the "before" of a correction never comes from the browser.';

-- ─── 2. Corrections ──────────────────────────────────────────────────────────
create table if not exists public.ai_corrections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  job              text not null check (job ~ '^[a-z_]{1,40}$'),
  call_id          uuid references public.ai_calls(id) on delete set null,
  field            text not null check (field ~ '^[a-z_]{1,40}(\.[0-9]{1,3}\.[a-z_]{1,40})?$'),
  match_key        text check (match_key is null or (char_length(match_key) between 1 and 200 and match_key ~ '\S')),
  ai_value         text check (ai_value is null or char_length(ai_value) <= 2000),
  saved_value      text check (saved_value is null or char_length(saved_value) <= 2000),
  kind             text not null check (kind in ('edited', 'unticked', 'kept', 'dismissed')),
  source           text not null check (source in ('save', 'chat_proposal', 'suggestion')),
  -- Every correction is the owner's own decision (a save, a tap); nothing else writes one.
  trust            text not null default 'owner' check (trust = 'owner'),
  state            text not null default 'counted' check (state in ('counted', 'ignored')),
  state_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.ai_corrections enable row level security;
revoke all on public.ai_corrections from anon, authenticated;
grant select on public.ai_corrections to authenticated;
grant update (state) on public.ai_corrections to authenticated;
grant select, insert, update, delete on public.ai_corrections to service_role;
create index if not exists idx_ai_corrections_user_job on public.ai_corrections (user_id, job, created_at desc);
create index if not exists idx_ai_corrections_rule on public.ai_corrections (user_id, job, field, match_key) where match_key is not null;

-- ─── 3. Code rules ───────────────────────────────────────────────────────────
create table if not exists public.ai_rules (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  job                  text not null check (job ~ '^[a-z_]{1,40}$'),
  field                text not null check (field ~ '^[a-z_]{1,40}$'),
  match_key            text not null check (char_length(match_key) between 1 and 200 and match_key ~ '\S'),
  value                text not null check (public.ai_suggestion_plain(value, 1, 200)),
  evidence             integer not null default 1 check (evidence between 1 and 100000),
  source_correction_id uuid references public.ai_corrections(id) on delete set null,
  state                text not null default 'proposed' check (state in ('proposed', 'active', 'removed')),
  uses                 integer not null default 0 check (uses between 0 and 100000000),
  last_used_at         timestamptz,
  approved_at          timestamptz,
  state_changed_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ai_rules_one_per_key unique (user_id, job, field, match_key)
);
alter table public.ai_rules enable row level security;
revoke all on public.ai_rules from anon, authenticated;
grant select on public.ai_rules to authenticated;
grant update (state) on public.ai_rules to authenticated;
grant select, insert, update, delete on public.ai_rules to service_role;
create index if not exists idx_ai_rules_user_job on public.ai_rules (user_id, job, state);

-- ─── 4. Cases ────────────────────────────────────────────────────────────────
create table if not exists public.ai_cases (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  job              text not null check (job ~ '^[a-z_]{1,40}$'),
  call_id          uuid references public.ai_calls(id) on delete set null,
  input_text       text not null check (char_length(input_text) between 1 and 2000 and input_text ~ '\S'),
  -- The job's own input (server-only: the browser's column grant leaves it out), for the weekly replay.
  input            jsonb check (input is null or (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 32768)),
  output           jsonb not null check (jsonb_typeof(output) = 'object' and pg_column_size(output) <= 16384),
  diffs            jsonb not null default '[]'::jsonb check (jsonb_typeof(diffs) = 'array' and pg_column_size(diffs) <= 16384),
  -- Only what the owner typed or confirmed by saving is ever a case (never outside text nobody confirmed).
  source_kind      text not null check (source_kind in ('owner_typed', 'owner_confirmed')),
  trust            text not null default 'owner' check (trust = 'owner'),
  split            text not null check (split in ('train', 'test', 'sealed')),
  state            text not null default 'active' check (state in ('active', 'quarantined', 'removed')),
  search           tsvector generated always as (to_tsvector('simple'::regconfig, input_text)) stored,
  expires_at       timestamptz not null,
  state_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.ai_cases enable row level security;
revoke all on public.ai_cases from anon, authenticated;
grant select (id, user_id, job, call_id, input_text, output, diffs, source_kind, trust, split, state, expires_at, state_changed_at, created_at, updated_at) on public.ai_cases to authenticated;
grant update (state) on public.ai_cases to authenticated;
grant select, insert, update, delete on public.ai_cases to service_role;
create index if not exists idx_ai_cases_user_job on public.ai_cases (user_id, job, created_at desc);
create index if not exists idx_ai_cases_search on public.ai_cases using gin (search);
-- The trigram index names pg_trgm's operator class in the schema the extension lives in (public or extensions).
do $$
declare v_schema text;
begin
  select n.nspname into v_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists idx_ai_cases_trgm on public.ai_cases using gin (input_text %I.gin_trgm_ops)', v_schema);
end $$;

-- ─── 5. Lessons ──────────────────────────────────────────────────────────────
create table if not exists public.ai_lessons (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- A job's name, or 'chat' (the assistant and its "about you" profile).
  scope            text not null check (scope ~ '^[a-z_]{1,40}$'),
  kind             text not null check (kind in ('fact', 'preference', 'instruction')),
  text             text not null check (public.ai_suggestion_plain(text, 3, 300)),
  example_case_id  uuid references public.ai_cases(id) on delete set null,
  source_kind      text not null check (source_kind in ('owner_typed', 'owner_data', 'weekly_batch', 'chat_tool', 'repo_doc', 'web')),
  source_ref       text check (source_ref is null or (char_length(source_ref) between 1 and 200 and source_ref !~ '[[:cntrl:]<>]')),
  source_call_id   uuid references public.ai_calls(id) on delete set null,
  -- The lowest trust of its sources: high = the owner's own typed words or data; medium = derived by a model from them; low = outside text.
  trust            text not null check (trust in ('high', 'medium', 'low')),
  -- Anything but a fact from a trusted source waits for the owner's tap (the trigger refuses the service role).
  needs_owner      boolean generated always as (kind <> 'fact' or trust <> 'high') stored,
  state            text not null default 'pending' check (state in ('pending', 'active', 'retired')),
  lesson_key       uuid not null default gen_random_uuid(),
  version          integer not null default 1 check (version between 1 and 10000),
  supersedes       uuid references public.ai_lessons(id) on delete set null,
  approved_at      timestamptz,
  -- Set by the guard when this version is turned on; a rollback only ever goes back to such a version.
  ever_active      boolean not null default false,
  expires_at       timestamptz not null,
  state_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ai_lessons_one_version unique (lesson_key, version)
);
alter table public.ai_lessons enable row level security;
revoke all on public.ai_lessons from anon, authenticated;
grant select on public.ai_lessons to authenticated;
grant update (state) on public.ai_lessons to authenticated;
grant select, insert, update, delete on public.ai_lessons to service_role;
create index if not exists idx_ai_lessons_user_scope on public.ai_lessons (user_id, scope, state);
create unique index if not exists idx_ai_lessons_one_active on public.ai_lessons (lesson_key) where state = 'active';

-- ─── 6. Per job: the champion, the previous one, the tripwire (server-only writes) ─────────
create table if not exists public.ai_job_learning (
  user_id            uuid not null references auth.users(id) on delete cascade,
  job                text not null check (job ~ '^[a-z_]{1,40}$'),
  example_strategy   text not null default 'mmr' check (example_strategy in ('none', 'knn', 'mmr')),
  examples_k         integer not null default 3 check (examples_k between 0 and 5),
  previous_strategy  text check (previous_strategy is null or previous_strategy in ('none', 'knn', 'mmr')),
  previous_k         integer check (previous_k is null or previous_k between 0 and 5),
  changed_by_run     uuid,
  changed_at         timestamptz,
  -- The notes the last approved win turned on (a rollback retires exactly these).
  approved_lessons   uuid[] not null default '{}' check (cardinality(approved_lessons) <= 20),
  tripwire_left      integer not null default 0 check (tripwire_left between 0 and 100),
  tripwire_baseline  numeric(6,4) check (tripwire_baseline is null or tripwire_baseline between 0 and 1),
  tripwire_saves     integer not null default 0 check (tripwire_saves between 0 and 1000),
  tripwire_corrected integer not null default 0 check (tripwire_corrected between 0 and 1000),
  last_event         text check (last_event is null or public.ai_suggestion_plain(last_event, 3, 300)),
  last_event_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (user_id, job)
);
alter table public.ai_job_learning enable row level security;
revoke all on public.ai_job_learning from anon, authenticated;
grant select on public.ai_job_learning to authenticated;
grant select, insert, update, delete on public.ai_job_learning to service_role;

-- ─── 7. The weekly self-test ─────────────────────────────────────────────────
create table if not exists public.ai_eval_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  week_start       date not null,
  made_by          text not null check (made_by in ('schedule', 'app')),
  status           text not null default 'queued' check (status in ('queued', 'done', 'failed', 'skipped')),
  call_id          uuid references public.ai_calls(id) on delete set null,
  -- Server-only (the browser's column grant leaves them out): the function asks Anthropic about whatever batch id it reads here.
  batch_id         text check (batch_id is null or batch_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  plan             jsonb check (plan is null or (jsonb_typeof(plan) = 'array' and pg_column_size(plan) <= 1048576)),
  claimed_at       timestamptz,
  requests         integer not null default 0 check (requests between 0 and 100000),
  jobs             jsonb not null default '[]'::jsonb check (jsonb_typeof(jobs) = 'array' and pg_column_size(jobs) <= 65536),
  result           jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 262144)),
  decision_state   text not null default 'none' check (decision_state in ('none', 'proposed', 'approved', 'rejected', 'rolled_back')),
  batch_deleted_at timestamptz,
  batch_delete_note text check (batch_delete_note is null or char_length(batch_delete_note) <= 300),
  failure          text check (failure is null or char_length(failure) <= 300),
  created_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint ai_eval_runs_one_per_week unique (user_id, week_start, made_by)
);
alter table public.ai_eval_runs enable row level security;
revoke all on public.ai_eval_runs from anon, authenticated;
grant select (id, user_id, week_start, made_by, status, call_id, requests, jobs, result, decision_state, batch_deleted_at, batch_delete_note, failure, created_at, finished_at) on public.ai_eval_runs to authenticated;
grant select, insert, update, delete on public.ai_eval_runs to service_role;
create index if not exists idx_ai_eval_runs_user on public.ai_eval_runs (user_id, created_at desc);

-- ─── 8. Source memory ────────────────────────────────────────────────────────
-- Migration 203 (Shop: picture memory, `shop-price` writes job 'shop_picture') makes the SAME table, policies, grants and
-- ai_source_note with `if not exists` / `create or replace`, word for word: whichever of the two runs first makes them and
-- the other changes nothing (203 adds its own state-stamp trigger; 204 adds its guard; both end up on the table in either
-- order). verify-db-ai-learning applies them in both orders and compares. Change both together.
create table if not exists public.ai_source_stats (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  job              text not null check (job ~ '^[a-z_]{1,40}$'),
  -- A host name only, made by code from a URL it parsed: never a path, a query or a whole address.
  host             text not null check (char_length(host) <= 253 and host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  ok_count         integer not null default 0 check (ok_count between 0 and 100000000),
  fail_count       integer not null default 0 check (fail_count between 0 and 100000000),
  last_ok_at       timestamptz,
  last_fail_at     timestamptz,
  last_reason      text check (last_reason is null or last_reason ~ '^[a-z_]{1,40}$'),
  state            text not null default 'on' check (state in ('on', 'ignored')),
  state_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ai_source_stats_one_per_host unique (user_id, job, host)
);
alter table public.ai_source_stats enable row level security;
revoke all on public.ai_source_stats from anon, authenticated;
grant select on public.ai_source_stats to authenticated;
grant update (state) on public.ai_source_stats to authenticated;
grant select, insert, update, delete on public.ai_source_stats to service_role;

-- ─── The browser's read and its one write (state) ────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_job_learning', 'ai_eval_runs', 'ai_source_stats'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Users read own ' || t) then
      execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', 'Users read own ' || t, t);
    end if;
  end loop;
  foreach t in array array['ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_source_stats'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Users change own ' || t) then
      execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', 'Users change own ' || t, t);
    end if;
  end loop;
end $$;

-- A signed-in caller may change `state` and nothing else; the bookkeeping follows. The service role may never turn on what
-- only the owner may: a rule (always), or a lesson that `needs_owner`. Turning a lesson version on retires the other active
-- version of the same lesson (one active version each).
create or replace function public.ai_learn_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  -- Who writes, by the role the statement runs as (never by what a row or a setting claims): `authenticated` is the
  -- owner's browser (and the owner's own SECURITY INVOKER functions); anything else (the function's service role, the
  -- dismissed-suggestion trigger) is not the owner.
  v_owner boolean := current_user = 'authenticated';
  -- The rows as JSON: one function serves five tables, so a column only some of them have is read by name here.
  v_new   jsonb := to_jsonb(new);
  v_old   jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  -- Generated columns are left out too: a BEFORE trigger does not see their new values yet.
  v_keep  text[] := array['state', 'state_changed_at', 'updated_at', 'approved_at', 'ever_active', 'search', 'needs_owner'];
  v_on    boolean := v_new->>'state' = 'active' and (v_old is null or v_old->>'state' is distinct from 'active');
  v_fixed text[];
  v_col   text;
begin
  if v_old is not null and v_owner then
    if (v_new - v_keep) is distinct from (v_old - v_keep) then
      raise exception '%: only the state can be changed here', tg_table_name using errcode = '42501';
    end if;
  end if;
  -- What a row IS never changes, whoever writes (guardian S1): a new text, kind or source is a new version (a new row).
  if v_old is not null then
    v_fixed := case tg_table_name
      when 'ai_lessons' then array['user_id', 'text', 'kind', 'trust', 'scope', 'source_kind', 'lesson_key', 'version']
      when 'ai_rules' then array['user_id', 'job', 'field']
      else array['user_id'] end;
    foreach v_col in array v_fixed loop
      if v_new->v_col is distinct from v_old->v_col then
        raise exception '%: % never changes (a new one is a new row)', tg_table_name, v_col using errcode = '42501';
      end if;
    end loop;
  end if;
  if tg_table_name = 'ai_rules' and not v_owner and v_new->>'state' = 'active'
     and (v_on or v_new->>'value' is distinct from v_old->>'value' or v_new->>'match_key' is distinct from v_old->>'match_key') then
    raise exception 'ai_rules: only the owner turns a rule on' using errcode = '42501';
  end if;
  if tg_table_name = 'ai_lessons' and not v_owner and v_on and (v_new->>'kind' <> 'fact' or v_new->>'trust' <> 'high') then
    raise exception 'ai_lessons: only the owner turns this lesson on' using errcode = '42501';
  end if;
  if tg_table_name in ('ai_rules', 'ai_lessons') then
    -- When the owner last turned it on (only the owner's tap sets it; it stays when the row goes off again).
    new := jsonb_populate_record(new, jsonb_build_object('approved_at',
      case when v_on and v_owner then to_jsonb(now()) when v_old is null then null else v_old->'approved_at' end));
  end if;
  if tg_table_name = 'ai_lessons' then
    -- A version that was ever on (by the owner's tap, or a plain fact in the owner's own words): only such a version is
    -- one a rollback may go back to.
    new := jsonb_populate_record(new, jsonb_build_object('ever_active', v_on or coalesce((v_old->>'ever_active')::boolean, false)));
  end if;
  if v_old is not null then
    new.updated_at := now();
    if v_new->>'state' is distinct from v_old->>'state' then new.state_changed_at := now(); end if;
  end if;
  return new;
end $$;
revoke all on function public.ai_learn_guard() from public, anon, authenticated;

create or replace function public.ai_lessons_one_active() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.state = 'active' and (tg_op = 'INSERT' or (to_jsonb(old)->>'state') is distinct from 'active') then
    update public.ai_lessons l set state = 'retired'
     where l.user_id = new.user_id and l.lesson_key = new.lesson_key and l.id <> new.id and l.state = 'active';
  end if;
  return new;
end $$;
revoke all on function public.ai_lessons_one_active() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_source_stats'] loop
    execute format('drop trigger if exists trg_ai_learn_guard on public.%I', t);
    execute format('create trigger trg_ai_learn_guard before insert or update on public.%I for each row execute function public.ai_learn_guard()', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
  end loop;
end $$;
drop trigger if exists trg_ai_lessons_one_active on public.ai_lessons;
create trigger trg_ai_lessons_one_active before insert or update of state on public.ai_lessons
  for each row execute function public.ai_lessons_one_active();

-- ─── 8b. A proposed change to a job's instructions is a suggestion (instructions are code: a reviewed PR) ──────
-- 199's kinds, plus one: `instruction_change` (written only by the function when the owner approves a lesson that won the
-- weekly self-test; its text names the job and the lesson). Still plain text, still only a row the owner reads.
alter table public.ai_suggestions drop constraint if exists ai_suggestions_kind_check;
alter table public.ai_suggestions add constraint ai_suggestions_kind_check
  check (kind in ('widget', 'chart', 'automation', 'notification', 'report', 'existing_feature', 'new_tool', 'cheaper_setting', 'instruction_change'));

-- ─── 8c. "Delete right after" for the other two batches too (the weekly report, the weekly suggestions) ──────────
-- The day the function deleted the batch at Anthropic. Server-only: the browser's column grants (196, 199) leave it out.
alter table public.ai_reports add column if not exists batch_deleted_at timestamptz;
alter table public.ai_suggest_runs add column if not exists batch_deleted_at timestamptz;

-- ─── 9. Functions ────────────────────────────────────────────────────────────
-- The owner-confirmed cases most like a text: full-text search plus trigram similarity, for the function's example pick
-- (which then adds an MMR-style diversity step in code). Service role only; SECURITY INVOKER; every row is the named
-- account's. pg_trgm's functions are named with the schema the extension lives in (made at migration time).
do $$
declare v_schema text;
begin
  select n.nspname into v_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format($fn$
    create or replace function public.ai_case_candidates(p_user uuid, p_job text, p_query text, p_limit integer)
    returns table (id uuid, input_text text, output jsonb, split text, source_kind text, relevance real)
    language sql stable security invoker set search_path = '' as $body$
      select c.id, c.input_text, c.output, c.split, c.source_kind,
             (coalesce(pg_catalog.ts_rank(c.search, q.q), 0) + %1$I.similarity(c.input_text, left(coalesce(p_query, ''), 2000)))::real as relevance
        from public.ai_cases c,
             (select pg_catalog.websearch_to_tsquery('pg_catalog.simple', left(coalesce(p_query, ''), 2000)) as q) q
       where c.user_id = p_user and c.job = p_job and c.state = 'active' and c.expires_at > pg_catalog.now()
         and (c.search operator(pg_catalog.@@) q.q or %1$I.similarity(c.input_text, left(coalesce(p_query, ''), 2000)) > 0.1)
       order by relevance desc, c.created_at desc
       limit least(greatest(coalesce(p_limit, 0), 1), 50)
    $body$
  $fn$, v_schema);
end $$;
revoke all on function public.ai_case_candidates(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.ai_case_candidates(uuid, text, text, integer) to service_role;

-- One page read's outcome for a host: a count, the last time and a reason word. Service role only.
create or replace function public.ai_source_note(p_user uuid, p_job text, p_host text, p_ok boolean, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_user is null or (select auth.uid()) is not null then
    raise exception 'ai_source_note: the service role only' using errcode = '42501';
  end if;
  insert into public.ai_source_stats (user_id, job, host, ok_count, fail_count, last_ok_at, last_fail_at, last_reason)
  values (p_user, p_job, lower(p_host), case when p_ok then 1 else 0 end, case when p_ok then 0 else 1 end,
          case when p_ok then now() end, case when p_ok then null else now() end, p_reason)
  on conflict (user_id, job, host) do update set
    -- A cleared host (ignored) comes back on with this read as its first: counts restart, nothing old decides again.
    ok_count = case when public.ai_source_stats.state = 'ignored' then case when p_ok then 1 else 0 end
                    else least(public.ai_source_stats.ok_count + case when p_ok then 1 else 0 end, 100000000) end,
    fail_count = case when public.ai_source_stats.state = 'ignored' then case when p_ok then 0 else 1 end
                      else least(public.ai_source_stats.fail_count + case when p_ok then 0 else 1 end, 100000000) end,
    last_ok_at = case when p_ok then now() when public.ai_source_stats.state = 'ignored' then null else public.ai_source_stats.last_ok_at end,
    last_fail_at = case when not p_ok then now() when public.ai_source_stats.state = 'ignored' then null else public.ai_source_stats.last_fail_at end,
    state_changed_at = case when public.ai_source_stats.state = 'ignored' then now() else public.ai_source_stats.state_changed_at end,
    state = 'on',
    last_reason = p_reason, updated_at = now();
end $$;
revoke all on function public.ai_source_note(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.ai_source_note(uuid, text, text, boolean, text) to service_role;

-- "Re-quarantine everything from source X / after day Y": active lessons go back to pending, active cases are set aside,
-- active rules back to proposed. The owner's own tap (SECURITY INVOKER: row level security and the state grant decide);
-- nothing is deleted. Answers what moved, `[{"t": "lessons" | "cases" | "rules", "id", "was"}]`, so the Undo can put each back.
drop function if exists public.ai_learn_quarantine(text, timestamptz);
create or replace function public.ai_learn_quarantine(p_source text, p_after timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_from timestamptz := coalesce(p_after, '-infinity'::timestamptz);
  v_out  jsonb := '[]'::jsonb;
  v_part jsonb;
begin
  if v_user is null then raise exception 'ai_learn_quarantine: the owner only' using errcode = '42501'; end if;
  if p_source is not null and p_source not in ('owner_typed', 'owner_data', 'weekly_batch', 'chat_tool', 'repo_doc', 'web', 'owner_confirmed', 'save') then
    raise exception 'ai_learn_quarantine: unknown source' using errcode = '22023';
  end if;
  with moved as (
    update public.ai_lessons l set state = 'pending'
     where l.user_id = v_user and l.state = 'active' and l.created_at >= v_from and (p_source is null or l.source_kind = p_source)
    returning l.id)
  select coalesce(jsonb_agg(jsonb_build_object('t', 'lessons', 'id', id, 'was', 'active')), '[]'::jsonb) into v_part from moved;
  v_out := v_out || v_part;
  with moved as (
    update public.ai_cases c set state = 'quarantined'
     where c.user_id = v_user and c.state = 'active' and c.created_at >= v_from and (p_source is null or c.source_kind = p_source)
    returning c.id)
  select coalesce(jsonb_agg(jsonb_build_object('t', 'cases', 'id', id, 'was', 'active')), '[]'::jsonb) into v_part from moved;
  v_out := v_out || v_part;
  if p_source is null or p_source = 'save' then
    with moved as (
      update public.ai_rules r set state = 'proposed'
       where r.user_id = v_user and r.state = 'active' and r.created_at >= v_from
      returning r.id)
    select coalesce(jsonb_agg(jsonb_build_object('t', 'rules', 'id', id, 'was', 'active')), '[]'::jsonb) into v_part from moved;
    v_out := v_out || v_part;
  end if;
  return v_out;
end $$;
revoke all on function public.ai_learn_quarantine(text, timestamptz) from public, anon;
grant execute on function public.ai_learn_quarantine(text, timestamptz) to authenticated;

-- One-click rollback of a lesson to its previous version: the active version is retired and the newest older version that
-- was once ON (approved, or a plain fact in the owner's own words: `ever_active`) is turned on again — never a version that
-- only ever waited. The owner's own tap (SECURITY INVOKER). Answers `{"result": "rolled_back", "retired": id, "activated": id}`
-- (the Undo turns `retired` on again, which retires `activated`), or `{"result": "nothing"}`.
drop function if exists public.ai_lesson_rollback(uuid);
create or replace function public.ai_lesson_rollback(p_lesson_key uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_now  public.ai_lessons%rowtype;
  v_prev uuid;
begin
  if v_user is null then raise exception 'ai_lesson_rollback: the owner only' using errcode = '42501'; end if;
  select * into v_now from public.ai_lessons l
   where l.user_id = v_user and l.lesson_key = p_lesson_key and l.state = 'active' order by l.version desc limit 1;
  if not found then return jsonb_build_object('result', 'nothing'); end if;
  select l.id into v_prev from public.ai_lessons l
   where l.user_id = v_user and l.lesson_key = p_lesson_key and l.version < v_now.version and l.ever_active
   order by l.version desc limit 1;
  if v_prev is null then return jsonb_build_object('result', 'nothing'); end if;
  update public.ai_lessons l set state = 'retired' where l.id = v_now.id and l.user_id = v_user;
  update public.ai_lessons l set state = 'active' where l.id = v_prev and l.user_id = v_user;
  return jsonb_build_object('result', 'rolled_back', 'retired', v_now.id, 'activated', v_prev);
end $$;
revoke all on function public.ai_lesson_rollback(uuid) from public, anon;
grant execute on function public.ai_lesson_rollback(uuid) to authenticated;

-- A dismissed suggestion (ai_suggestions, 199) is the owner's correction of the model that wrote it: one row, written for
-- the row's own account. SECURITY DEFINER because the browser that dismisses cannot write ai_corrections; it acts only on
-- the row the trigger fires for, names that row's user, and is not callable on its own (a trigger function).
create or replace function public.ai_suggestion_dismissed_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'dismissed' and old.state is distinct from 'dismissed'
     and exists (select 1 from auth.users u where u.id = new.user_id) then
    insert into public.ai_corrections (user_id, job, call_id, field, ai_value, saved_value, kind, source)
    values (new.user_id, case when new.source = 'weekly' then 'suggest_weekly' else 'chat' end,
            (select c.id from public.ai_calls c where c.id = new.first_call_id and c.user_id = new.user_id),
            'suggestion', left(new.title, 2000), null, 'dismissed', 'suggestion');
  end if;
  return new;
end $$;
revoke all on function public.ai_suggestion_dismissed_note() from public, anon, authenticated;
drop trigger if exists trg_ai_suggestion_dismissed_note on public.ai_suggestions;
create trigger trg_ai_suggestion_dismissed_note after update of state on public.ai_suggestions
  for each row execute function public.ai_suggestion_dismissed_note();

-- The retention of everything learned (daily, plain SQL, no secret): the AI's own values after 30 days, a correction after
-- a year, a case at its own expiry (a removed one after 7 days), a lesson past its expiry is retired and a retired one goes
-- after a year, a removed rule after 90 days, a self-test after a year, a host not seen for a year.
create or replace function public.ai_learn_purge() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.ai_learn_answers a where a.created_at < now() - interval '30 days';
  delete from public.ai_corrections c where c.created_at < now() - interval '365 days';
  delete from public.ai_cases c where c.expires_at < now() or (c.state = 'removed' and c.state_changed_at < now() - interval '7 days');
  update public.ai_lessons l set state = 'retired' where l.state <> 'retired' and l.expires_at < now();
  delete from public.ai_lessons l where l.state = 'retired' and coalesce(l.state_changed_at, l.created_at) < now() - interval '365 days';
  delete from public.ai_rules r where r.state = 'removed' and coalesce(r.state_changed_at, r.created_at) < now() - interval '90 days';
  delete from public.ai_eval_runs e where e.created_at < now() - interval '365 days';
  delete from public.ai_source_stats s where s.updated_at < now() - interval '365 days';
end $$;
revoke all on function public.ai_learn_purge() from public, anon, authenticated;
grant execute on function public.ai_learn_purge() to service_role;

comment on table public.ai_corrections is 'One row per AI-filled field the owner reviewed (edited, unticked, kept, dismissed). Written by the claude function from its own stored values and the saved ones; the browser changes only `state` (counted / ignored).';
comment on table public.ai_rules is 'Code rules from repeated identical corrections: job, field, match key, value. Proposed by the function, turned on only by the owner (trigger). Applied by code, with no AI call.';
comment on table public.ai_cases is 'Owner-typed or owner-confirmed examples, found by full-text search and trigram similarity and sent to a call as data. `input` is server-only.';
comment on table public.ai_lessons is 'Learned notes with their source and trust; append-only versions. A row that needs_owner is turned on only by the owner (trigger). Sent to a call only as a search_result block, never in the system prompt.';
comment on table public.ai_eval_runs is 'The weekly self-test: one Message Batch, scored by code, deleted at Anthropic right after its results are read. batch_id, plan and claimed_at are server-only.';
comment on table public.ai_source_stats is 'Per job and host, how often a page read worked. Code uses it only to order candidates; never a fetch target.';

-- ─── 10. Timers ──────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed here: lascis-ai-report-check and lascis-ai-learn-purge not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'lascis-ai-learn-purge') then
    perform cron.unschedule('lascis-ai-learn-purge');
  end if;
  perform cron.schedule('lascis-ai-learn-purge', '47 3 * * *', 'select public.ai_learn_purge()');
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
       or exists (select 1 from public.ai_suggest_runs r where r.status = 'queued' and r.created_at > now() - interval '27 hours')
       or exists (select 1 from public.ai_eval_runs r where r.status = 'queued' and r.created_at > now() - interval '27 hours');
  $cron$);
end $$;

select public.owner_lock_apply('public.ai_learn_answers');
select public.owner_lock_apply('public.ai_corrections');
select public.owner_lock_apply('public.ai_rules');
select public.owner_lock_apply('public.ai_cases');
select public.owner_lock_apply('public.ai_lessons');
select public.owner_lock_apply('public.ai_job_learning');
select public.owner_lock_apply('public.ai_eval_runs');
select public.owner_lock_apply('public.ai_source_stats');

-- The deploy stops here, and keeps nothing, if the browser could write more than a state, read a server-only column or
-- table, or call a server function, or if a signed-out caller reached any of it.
do $$
declare t text;
begin
  if has_table_privilege('authenticated', 'public.ai_learn_answers', 'select, insert, update, delete, truncate, references, trigger')
     or has_any_column_privilege('authenticated', 'public.ai_learn_answers', 'select, insert, update, references') then
    raise exception 'Migration 204 assertion failed: the browser reaches ai_learn_answers';
  end if;
  foreach t in array array['ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_source_stats'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege('authenticated', 'public.' || t, 'insert, references')
       or exists (select 1 from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped
                    and a.attname <> 'state' and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')) then
      raise exception 'Migration 204 assertion failed: the browser can write % beyond its state', t;
    end if;
  end loop;
  foreach t in array array['ai_job_learning', 'ai_eval_runs'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege('authenticated', 'public.' || t, 'insert, update, references') then
      raise exception 'Migration 204 assertion failed: the browser can write %', t;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.ai_cases', 'input', 'select')
     or has_column_privilege('authenticated', 'public.ai_eval_runs', 'batch_id', 'select')
     or has_column_privilege('authenticated', 'public.ai_eval_runs', 'plan', 'select')
     or has_column_privilege('authenticated', 'public.ai_eval_runs', 'claimed_at', 'select') then
    raise exception 'Migration 204 assertion failed: the browser can read a server-only column';
  end if;
  foreach t in array array['ai_learn_answers', 'ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_job_learning', 'ai_eval_runs', 'ai_source_stats'] loop
    if has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege('anon', 'public.' || t, 'select, insert, update, references') then
      raise exception 'Migration 204 assertion failed: a signed-out caller reaches %', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.ai_case_candidates(uuid, text, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ai_source_note(uuid, text, text, boolean, text)', 'execute')
     or has_function_privilege('authenticated', 'public.ai_learn_purge()', 'execute')
     or has_function_privilege('anon', 'public.ai_learn_quarantine(text, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.ai_lesson_rollback(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ai_suggestion_dismissed_note()', 'execute') then
    raise exception 'Migration 204 assertion failed: the browser can call a server function';
  end if;
end $$;
