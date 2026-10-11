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
--  G. An account with data can be deleted again. Deleting a user cascades into
--     every table, and the audit trigger, the Google Tasks queue and the Trakt
--     queue each wrote a new row for that user mid-delete — their foreign key
--     to the vanishing user aborted the whole deletion (a test account could
--     never be removed). They now skip a user that is already gone, exactly as
--     135's calendar queue does. Function bodies are the live ones plus that
--     one guard.
--  H. pg_net's request queue (which briefly holds the cron jobs' secret
--     headers) is taken away from the browser roles, if they ever had it.
--     Best effort: pg_net belongs to Supabase, so a refusal is only a notice.
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

-- G ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_j    jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  new_j    jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  row_j    jsonb := COALESCE(new_j, old_j);
  diff_old jsonb;
  diff_new jsonb;
  v_user   uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only the keys that actually changed, ignoring bookkeeping columns.
    SELECT COALESCE(jsonb_object_agg(o.key, o.value), '{}'::jsonb)
      INTO diff_old
      FROM jsonb_each(old_j) o
     WHERE o.key NOT IN ('updated_at', 'synced_at')
       AND new_j -> o.key IS DISTINCT FROM o.value;

    SELECT COALESCE(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      INTO diff_new
      FROM jsonb_each(new_j) n
     WHERE n.key NOT IN ('updated_at', 'synced_at')
       AND old_j -> n.key IS DISTINCT FROM n.value;

    -- Touch-only update (just updated_at/synced_at) — not worth a log row.
    IF diff_new = '{}'::jsonb AND diff_old = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    diff_old := old_j;
    diff_new := new_j;
  END IF;

  v_user := COALESCE((row_j ->> 'user_id')::uuid, auth.uid());

  -- The account itself is being deleted (auth.users → this table cascade):
  -- its audit trail goes with it, and inserting a row for it would break
  -- audit_logs' foreign key and abort the deletion (same guard as 135).
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_logs (user_id, table_name, operation, row_id, old_data, new_data, actor, tx_id)
  VALUES (
    v_user,
    TG_TABLE_NAME,
    TG_OP,
    row_j ->> 'id',
    diff_old,
    diff_new,
    CASE WHEN auth.uid() IS NOT NULL THEN 'web' ELSE 'service' END,
    txid_current()
  );

  -- Retention: 30 days. Probabilistic sweep (~2% of writes) instead of a cron
  -- job — at this app's volume that's a cleanup every few dozen writes.
  IF random() < 0.02 THEN
    DELETE FROM public.audit_logs WHERE created_at < now() - interval '30 days';
  END IF;

  RETURN NULL;  -- AFTER trigger; return value is ignored
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_google_tasks_outbox()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.google_sync_write', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Account being deleted: nothing could ever drain the row (same guard as 135).
    IF OLD.google_task_id IS NOT NULL AND OLD.google_sync_enabled IS TRUE
       AND EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (OLD.user_id, OLD.id, 'delete', jsonb_build_object(
        'google_task_id', OLD.google_task_id, 'google_tasklist_id', OLD.google_tasklist_id
      ));
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A fresh local task needs creating on the Google side only when the
    -- app opted it in (google_sync_enabled — see its column comment). A row
    -- that originates FROM Google already returned above via the session
    -- flag guard, before ever reaching this branch.
    IF NEW.google_sync_enabled IS TRUE THEN
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'create', jsonb_build_object(
        'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
        'parent_task_id', NEW.parent_task_id, 'google_tasklist_id', NEW.google_tasklist_id
      ));
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE, newly opted in (the "Push" catch-up action turning sync on for a
  -- task created before Google was connected): needs a fresh create
  -- regardless of google_local_edit_at — flipping google_sync_enabled isn't
  -- itself a content edit, so the BEFORE trigger never bumped that clock.
  --
  -- Real race fixed (found reviewing this migration a second time): this
  -- branch used to require NEW.google_task_id IS NULL. But a row that was
  -- JUST opted out (the branch below this one enqueues a 'delete' for its
  -- current google_task_id — WITHOUT clearing that column locally; only
  -- the drain's own clear_google_task_id_if_matches does that, once the
  -- delete actually runs) still HAS a non-null google_task_id until that
  -- delete drains. Opting back in before it drains hit this branch's
  -- `IS NULL` guard and enqueued NOTHING — the task ended up
  -- google_sync_enabled=true with a google_task_id that's either about to
  -- be cleared (delete lands) or already stale, and no create was ever
  -- queued to replace it. Fixed: enqueue a create on EVERY opt-in
  -- transition, not just when google_task_id happens to be NULL, stamping
  -- `force_recreate: true` whenever a task_id is still present (migration
  -- 079's per-task FIFO claim guarantees any earlier pending 'delete' for
  -- this SAME task drains first — force_recreate is what then lets THIS
  -- create proceed once that delete has cleared the id, or immediately if
  -- it hadn't been set to begin with).
  IF NEW.google_sync_enabled IS TRUE AND OLD.google_sync_enabled IS NOT TRUE THEN
    INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
    VALUES (NEW.user_id, NEW.id, 'create', jsonb_build_object(
      'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
      'parent_task_id', NEW.parent_task_id, 'google_tasklist_id', NEW.google_tasklist_id,
      'force_recreate', NEW.google_task_id IS NOT NULL
    ));
    RETURN NEW;
  END IF;

  -- UPDATE, newly opted OUT (e.g. a task that gains a linked Google Calendar
  -- event and must drop its now-redundant Google Task copy — "one task = ONE
  -- Google entry"): remove it from Google. Independent of google_local_edit_at
  -- for the same reason as the opt-in branch above.
  IF NEW.google_sync_enabled IS NOT TRUE AND OLD.google_sync_enabled IS TRUE AND OLD.google_task_id IS NOT NULL THEN
    INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
    VALUES (NEW.user_id, NEW.id, 'delete', jsonb_build_object(
      'google_task_id', OLD.google_task_id, 'google_tasklist_id', OLD.google_tasklist_id
    ));
    RETURN NEW;
  END IF;

  -- UPDATE: trg_stamp_google_local_edit already decided whether a
  -- Google-visible field changed (bucket-aware for status) — reuse that
  -- instead of re-checking the same condition here.
  IF NEW.google_local_edit_at IS DISTINCT FROM OLD.google_local_edit_at
     AND NEW.google_sync_enabled IS TRUE THEN

    IF public.google_task_status_bucket(NEW.status) = 'none'
       AND public.google_task_status_bucket(OLD.status) <> 'none'
       AND NEW.google_task_id IS NOT NULL THEN
      -- Cancelled: Google has no "cancelled" state, so the honest mapping is
      -- to remove it there (mirrors 047's local soft-cancel philosophy —
      -- the LOCAL row stays, reversible; only the Google-side copy goes).
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'delete', jsonb_build_object(
        'google_task_id', NEW.google_task_id, 'google_tasklist_id', NEW.google_tasklist_id
      ));

    ELSIF public.google_task_status_bucket(OLD.status) = 'none'
          AND public.google_task_status_bucket(NEW.status) <> 'none' THEN
      -- Un-cancelled: whatever Google task existed before is gone for good
      -- (Tasks API has no undelete) — recreate fresh rather than try to
      -- resurrect a dead id. force_recreate=true is what actually makes the
      -- drain overwrite a stale google_task_id instead of skipping (see this
      -- migration's header comment — this is the real fix, migration 071's
      -- own comment claiming "drain must overwrite" was never implemented).
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'create', jsonb_build_object(
        'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
        'parent_task_id', NEW.parent_task_id, 'google_tasklist_id', NEW.google_tasklist_id,
        'force_recreate', true
      ));

    ELSIF NEW.google_task_id IS NOT NULL THEN
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'update', jsonb_build_object(
        'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
        'status', NEW.status, 'parent_task_id', NEW.parent_task_id,
        'google_tasklist_id', NEW.google_tasklist_id,
        'prev_google_tasklist_id', OLD.google_tasklist_id,
        'prev_parent_task_id', OLD.parent_task_id
      ));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trakt_enqueue(p_user uuid, p_op text, p_key text, p_payload jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Nothing is queued for an account that is being deleted (same guard as 135).
  INSERT INTO public.trakt_outbox (user_id, op, item_key, payload)
  SELECT p_user, p_op, p_key, p_payload
  WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = p_user)
$function$;

-- H ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('net.http_request_queue') is not null then
    execute 'revoke all on table net.http_request_queue from anon, authenticated';
  end if;
  if to_regclass('net._http_response') is not null then
    execute 'revoke all on table net._http_response from anon, authenticated';
  end if;
exception when others then
  raise notice '140: pg_net grants left as they are (%).', sqlerrm;
end $$;

commit;
