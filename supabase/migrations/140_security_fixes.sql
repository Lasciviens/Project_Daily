-- 140 · Security fixes from the audit of 10.10.2026 (after 139, the owner lock).
-- Safe to re-run. Changes no data except deleting search copies of rows that
-- no longer exist (B).
--
--  A. Token tables are service-role only. psn_tokens (PSN npsso + refresh
--     token) was never revoked from the browser roles, so the owner's own
--     browser session — or anything running in it — could read and change it;
--     trakt_tokens gets the same, and anon loses strava_tokens and
--     user_calendar_tokens (044 revoked them from authenticated only).
--     psn-api / trakt-api / strava-* / calendar-* use the service role.
--  B. ai_embeddings follow their source rows. Deleting (or editing) a memory,
--     recipe, request, note, wish, book or PT assessment left its search copy,
--     so semantic_search kept feeding deleted text to the assistant. A trigger
--     now deletes the copy when the row is deleted or its searched text
--     changes (the next "Reindex AI search" adds the new text); copies already
--     orphaned are deleted once here.
--  C. Push subscriptions are tied to the login. Each row is stamped with the
--     login session that saved it (from the JWT) and when the app last opened
--     on that device; push-send now only sends to rows whose session still
--     exists (or, for older unstamped rows, that were seen in the last 60
--     days). Signing out also deletes this device's row (app side).
--  D. ai_pending_actions: a delete or Hevy routine change the assistant
--     proposes waits here until the person taps Confirm in the app (ai-proxy).
--     Service role only, no audit trigger (short-lived, written by ai-proxy).
--  E. Play counts are bounded (0–999 extra plays): each extra play becomes a
--     Trakt history write, so one write with a huge count flooded the outbox.
--     NOT VALID — existing rows are not checked, only new writes.
--  F. ai_run_read_query (064) refuses set_config / SET / RESET / DISCARD and
--     unicode-escaped names, and clears the two outbox-pause flags it could
--     otherwise leave on the pooled connection (app.google_sync_write,
--     app.trakt_sync), so a read can never silently stop Google Tasks or Trakt
--     syncing for a later request. Same signature and grants as 064.
--
-- Needs 139 (owner_lock_apply).

begin;

-- A ───────────────────────────────────────────────────────────────────────────
revoke all on table public.psn_tokens   from anon, authenticated;
revoke all on table public.trakt_tokens from anon, authenticated;
revoke all on table public.strava_tokens        from anon;
revoke all on table public.user_calendar_tokens from anon;

-- B ───────────────────────────────────────────────────────────────────────────
-- One function for all seven sources; TG_ARGV[0] lists the searched columns
-- (matching EMBED_SOURCES in supabase/functions/ai-proxy/index.ts).
create or replace function public.ai_embeddings_follow_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  col text;
  changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    foreach col in array string_to_array(tg_argv[0], ',') loop
      if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
        changed := true;
      end if;
    end loop;
    if not changed then return new; end if;
  end if;
  delete from public.ai_embeddings e
  where e.source_table = tg_table_name and e.source_id = old.id::text;
  return coalesce(new, old);
end;
$$;
revoke all on function public.ai_embeddings_follow_source() from public, anon, authenticated;

do $$
declare
  src text[];
  sources text[][] := array[
    array['recipes',        'title,description,instructions'],
    array['dev_requests',   'title,description'],
    array['pt_assessments', 'feeling,note,assessment'],
    array['work_notes',     'content'],
    array['ai_memory',      'title,content'],
    array['wish_items',     'title,notes'],
    array['books',          'title,author,review,notes']
  ];
begin
  foreach src slice 1 in array sources loop
    if to_regclass('public.' || src[1]) is null then continue; end if;
    execute format('drop trigger if exists trg_ai_embeddings_follow on public.%I', src[1]);
    execute format(
      'create trigger trg_ai_embeddings_follow after delete or update on public.%I '
      'for each row execute function public.ai_embeddings_follow_source(%L)', src[1], src[2]);
    -- Copies whose source row is already gone.
    execute format(
      'delete from public.ai_embeddings e where e.source_table = %L '
      'and not exists (select 1 from public.%I s where s.id::text = e.source_id)', src[1], src[1]);
  end loop;
end $$;

-- C ───────────────────────────────────────────────────────────────────────────
alter table public.push_subscriptions add column if not exists session_id   uuid;
alter table public.push_subscriptions add column if not exists last_seen_at timestamptz not null default now();

create or replace function public.push_subscriptions_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a browser save carries a login session; anything else keeps the row's.
  if coalesce((select auth.jwt()) ->> 'role', '') = 'authenticated' then
    new.session_id := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
    new.last_seen_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_push_subscriptions_stamp on public.push_subscriptions;
create trigger trg_push_subscriptions_stamp
  before insert or update on public.push_subscriptions
  for each row execute function public.push_subscriptions_stamp();

-- The rows push-send may use: the login still exists (and has not passed its
-- not_after), or — for rows saved before this migration — the app opened on
-- that device within 60 days. Service role only.
create or replace function public.push_live_subscriptions(p_user uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.user_id = p_user
    and (
      (s.session_id is not null and exists (
        select 1 from auth.sessions a
        where a.id = s.session_id and a.user_id = p_user
          and (a.not_after is null or a.not_after > now())))
      or (s.session_id is null and s.last_seen_at > now() - interval '60 days')
    );
$$;
revoke all on function public.push_live_subscriptions(uuid) from public, anon, authenticated;
grant execute on function public.push_live_subscriptions(uuid) to service_role;

-- D ───────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_pending_actions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  tool       text not null check (tool in ('db_delete', 'update_hevy_routine')),
  args       jsonb not null,
  summary    text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  done_at    timestamptz,
  decision   text check (decision in ('confirm', 'cancel'))
);
alter table public.ai_pending_actions enable row level security;
revoke all on table public.ai_pending_actions from anon, authenticated;
create index if not exists ai_pending_actions_user_idx on public.ai_pending_actions (user_id, created_at desc);
select public.owner_lock_apply('public.ai_pending_actions');

-- E ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_movie_entries_repeat_count_range') then
    alter table public.user_movie_entries add constraint user_movie_entries_repeat_count_range
      check (repeat_count is null or repeat_count between 0 and 999) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_tv_episodes_repeat_count_range') then
    alter table public.user_tv_episodes add constraint user_tv_episodes_repeat_count_range
      check (repeat_count is null or repeat_count between 0 and 999) not valid;
  end if;
end $$;

-- F ───────────────────────────────────────────────────────────────────────────
create or replace function public.ai_run_read_query(query_text text)
returns jsonb
language plpgsql
security invoker
set statement_timeout = '5000'
as $$
declare
  result jsonb;
begin
  if query_text ~* '(set_config|u&|\yset\s|\yreset\y|\ydiscard\y)' then
    raise exception 'ai_run_read_query: settings cannot be changed from a read query';
  end if;
  perform set_config('transaction_read_only', 'on', true);
  execute format(
    'select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select * from (%s) _q limit 500) x',
    query_text
  ) into result;
  -- The outbox triggers pause while these are on; a read never leaves them set.
  perform set_config('app.google_sync_write', '', false);
  perform set_config('app.trakt_sync', '', false);
  return result;
end;
$$;
revoke all     on function public.ai_run_read_query(text) from public, anon;
grant  execute on function public.ai_run_read_query(text) to authenticated;

commit;
