-- 151: "Undo this save" (150) — what its review found it could miss.
--
-- Owner, 14.10.2026: "it should be safe to do. It should not miss anything
-- while undoing it." 150 is live; this redefines its functions (same names
-- and arguments), adds helpers and one small table (audit_undos). No data
-- changes.
--
--  1. Outside services. An undo writes through the tables' own triggers, so
--     it queues changes for Trakt, Google Tasks and Google Calendar. The trial
--     run counts the outbox rows it wrote, per service and kind
--     (app_undo_outbox; a whole-item Trakt history_remove names its items),
--     plus the Google Calendar events the browser makes or moves right after
--     (slots put back, slots moved back), and the plan needs confirming when
--     anything goes out. A NEW OUTBOX TABLE must be added to app_undo_outbox,
--     or Undo won't say what it sends.
--     Bookkeeping columns (app_undo_bookkeeping: clocks and the state of the
--     outside copy — updated_at, synced_at, google_local_edit_at, Google
--     Tasks' etag/position/…, media_watches' trakt_history_id and source) are
--     never put back nor compared: a watch the undo re-dates loses its Trakt
--     play id by design (149), which is not "not exactly as before".
--     Outside links (app_undo_links: a task's Google task and list, a slot's
--     or plan's Google Calendar event, a title's Trakt note) are never put
--     back either: the link must name what exists on that service now, and
--     an old id names something deleted or replaced there. When the save
--     changed one and it isn't back as before, the plan says the link stays
--     (`links_kept`) and needs confirming.
--  2. Rows the undo's own triggers change outside its steps (043: a watched
--     episode deletes its plan) are read back from the undo's own audit rows
--     (`side_effects`; `side_hidden` counts the ones the caller's log doesn't
--     show), and so is a column outside a step that a rule changes on a row
--     the undo writes (143: putting `done` back clears `is_focused`) — that
--     is `drift`, and such a row is never listed as "kept". All need
--     confirming.
--  3. A save made by AI / a sync (actor `service`) whose undo touches a synced
--     table (app_undo_synced) is named (`sync_save`) and needs confirming:
--     the service may still have the save's change.
--  4. Apply locks the save's rows (FOR UPDATE) before it compares them: a
--     save committing at the same moment is either seen (and the fingerprint
--     refuses) or waits for this undo — at most lock_timeout (4 s), then 55P03.
--  5. Deferred triggers (149's watch reconcile) fire at the end of the steps
--     (SET CONSTRAINTS ALL IMMEDIATE), inside the trial run too, so what they
--     change is in the preview.
--  6. A row put back is compared column by column with its old row (override
--     keys, generated and always-identity columns, the key, bookkeeping and
--     outside links aside): a column a trigger rewrote is `drift`.
--  7. One-row-per-account tables keyed by user_id (games_prefs,
--     screenscraper_prefs, reading_settings, kobo_device_config,
--     athlete_profile, day_targets) can be undone: their audit rows carry no
--     row id, so the account (audit_logs.user_id) is the key.
--  8. Changes logged before 150 got `seq` in storage order. A row changed
--     more than once in a save must chain up COLUMN BY COLUMN (each change's
--     old value of a column = the previous change's new value of it) — else
--     the row is blocked ('order_unknown'), never folded in a guessed order.
--  9. `not_logged` lists a table outside the log only for rows put back that
--     it could point at (a non-null referenced value), with how many, and
--     whether such rows were deleted with it or only unlinked — a SET NULL
--     table only while it holds a row with an empty link (the caller can
--     see); it now needs confirming too.
-- 10. Collateral and side effects sort by their text, so a preview and its
--     apply always give the same fingerprint.
-- 11. `nearby` (a hint, outside the fingerprint): for a save of media rows,
--     other saves by the same actor within 10 seconds on the same media
--     tables — Spread writes up to three — leaving out saves that were undos
--     themselves (audit_undos, which apply fills).
--
-- audit_undos: one row per undo applied (its transaction, the save it took
-- back). Bookkeeping for the hint, not user-authored: no trg_audit, not in
-- ai-proxy's DB_CATALOG; rows older than 30 days go when the next undo runs.
--
-- SECURITY INVOKER as in 150 (row level security and the owner lock apply),
-- except the count-only helpers (app_undo_hidden_changes, app_undo_outbox),
-- which only ever answer for the caller's own account. Only identifiers read
-- from the catalogue reach dynamic SQL (%I / regclass); values travel as
-- parameters. Re-runnable: IF NOT EXISTS, CREATE OR REPLACE, the policy
-- guard, grants re-stated.

-- The undos applied (for the nearby-saves hint: an undo is not a Spread).
create table if not exists public.audit_undos (
  undo_tx    bigint primary key,
  undone_tx  bigint not null,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.audit_undos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_undos' and policyname = 'Users manage own undos') then
    create policy "Users manage own undos" on public.audit_undos for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
create index if not exists audit_undos_user_created_idx on public.audit_undos (user_id, created_at);
grant select, insert, delete on public.audit_undos to authenticated;

-- Columns that are bookkeeping, not content: never put back, never compared
-- (a clock, the state of the outside service's own copy).
create or replace function public.app_undo_bookkeeping(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['updated_at', 'synced_at', 'google_local_edit_at']::text[]
         || case p_table
              when 'media_watches' then array['trakt_history_id', 'source']::text[]
              when 'tasks' then array['google_etag', 'google_position', 'google_updated_at', 'google_web_view_link',
                                      'google_links', 'google_hidden', 'google_deleted']::text[]
              when 'schedule_blocks' then array['google_calendar_horizon']::text[]
              when 'user_movie_entries' then array['trakt_note_text']::text[]
              when 'user_tv_entries' then array['trakt_note_text']::text[]
              else '{}'::text[]
            end
$$;

-- Links to the outside service's copy of a row: never put back (an old id
-- names something deleted or replaced there); the plan says when the save
-- changed one (`links_kept`).
create or replace function public.app_undo_links(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'tasks' then array['google_task_id', 'google_tasklist_id', 'google_calendar_event_id']::text[]
    when 'time_blocks' then array['google_calendar_event_id']::text[]
    when 'schedule_blocks' then array['google_calendar_event_id']::text[]
    when 'user_movie_entries' then array['trakt_note_id']::text[]
    when 'user_tv_entries' then array['trakt_note_id']::text[]
    when 'user_tv_episodes' then array['trakt_note_id']::text[]
    else '{}'::text[]
  end
$$;

-- The outside service a table's triggers write to (kept in step with SYNCED
-- in src/features/developer/components/undoPlanText.ts — verify-undo-plan-text
-- compares them).
create or replace function public.app_undo_synced(p_table text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_table in ('user_movie_entries', 'user_tv_entries', 'user_tv_episodes', 'media_watches') then 'trakt'
    when p_table = 'tasks' then 'google_tasks'
    when p_table in ('time_blocks', 'schedule_blocks') then 'google_calendar'
  end
$$;

-- What the caller's current transaction queued for outside services: outbox
-- rows of the caller's account written in this transaction (created_at is the
-- transaction's start), per service and kind — Trakt's only after
-- p_trakt_after (its seq), so a caller can leave out what was queued before
-- it started. A whole-item Trakt remove names its items. Answers
-- {rows, trakt_seq}: trakt_seq is the newest Trakt row of the caller now (the
-- mark for a later call). Counts and names only, for the caller's own
-- account; the queues themselves stay unreadable (trakt_outbox is
-- service-role only).
create or replace function public.app_undo_outbox(p_trakt_after bigint default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_out  jsonb := '[]'::jsonb;
  v_part jsonb;
  v_seq  bigint := 0;
begin
  if v_uid is null or not public.is_app_user() then
    return jsonb_build_object('rows', v_out, 'trakt_seq', 0);
  end if;
  if to_regclass('public.trakt_outbox') is not null then
    execute 'select coalesce(max(o.seq), 0) from public.trakt_outbox o where o.user_id = $1' into v_seq using v_uid;
    if to_regclass('public.tv_series') is not null and to_regclass('public.movies') is not null then
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object('s', 'trakt', 'op', x.op, 'n', x.n, 'items', x.items) order by x.op), '[]'::jsonb)
        from (
          select o.op, count(*)::integer as n,
                 case when o.op = 'history_remove' then jsonb_agg(distinct coalesce(
                   case when o.payload ->> 'type' = 'episode' then
                     (select s.title from public.tv_series s where s.tmdb_id = (o.payload ->> 'tmdb')::integer limit 1)
                     || ' S' || lpad(o.payload ->> 'season', 2, '0') || 'E' || lpad(o.payload ->> 'episode', 2, '0') end,
                   case when o.payload ->> 'type' = 'movie' then
                     (select m.title from public.movies m where m.tmdb_id = (o.payload ->> 'tmdb')::integer limit 1) end,
                   o.item_key)) end as items
          from public.trakt_outbox o
          where o.user_id = $1 and o.created_at = now() and o.seq > $2
          group by o.op
        ) x $q$
        into v_part using v_uid, p_trakt_after;
    else
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object('s', 'trakt', 'op', x.op, 'n', x.n, 'items', x.items) order by x.op), '[]'::jsonb)
        from (select o.op, count(*)::integer as n,
                     case when o.op = 'history_remove' then jsonb_agg(distinct o.item_key) end as items
              from public.trakt_outbox o
              where o.user_id = $1 and o.created_at = now() and o.seq > $2
              group by o.op) x $q$
        into v_part using v_uid, p_trakt_after;
    end if;
    v_out := v_out || v_part;
  end if;
  if to_regclass('public.google_tasks_outbox') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('s', 'google_tasks', 'op', x.op, 'n', x.n) order by x.op), '[]'::jsonb)
      from (select o.operation as op, count(*)::integer as n
            from public.google_tasks_outbox o
            where o.user_id = $1 and o.created_at = now()
            group by o.operation) x $q$
      into v_part using v_uid;
    v_out := v_out || v_part;
  end if;
  if to_regclass('public.calendar_outbox') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('s', 'google_calendar', 'op', x.op, 'n', x.n) order by x.op), '[]'::jsonb)
      from (select o.operation as op, count(*)::integer as n
            from public.calendar_outbox o
            where o.user_id = $1 and o.created_at = now()
            group by o.operation) x $q$
      into v_part using v_uid;
    v_out := v_out || v_part;
  end if;
  return jsonb_build_object('rows', v_out, 'trakt_seq', v_seq);
end;
$$;

-- Runs an undo's steps (built by app_undo_transaction), newest change first.
-- Each step is a run of rows of one table: put columns back (revert, or
-- overwrite a row that is back again), delete, or insert again — one
-- statement each, by the table's key (`k`: id, or user_id for a
-- one-row-per-account table). A step a foreign key or a unique index stops
-- waits for the next round; a round that gets nothing further raises the last
-- error. Then the deferred triggers fire, and it reads back:
--   drift        — a step row that isn't as its step left it (a column put
--                  back changed again, a column outside the step a rule
--                  changed on it, a row put back with a column rewritten,
--                  a deleted row still there, a put-back row gone again);
--   side_effects — rows outside the steps that this transaction's own audit
--                  rows show changed (a rule between tables); side_hidden
--                  counts those the caller's log doesn't show;
--   outbox       — what the steps queued for outside services.
-- Runs as the caller.
create or replace function public.app_undo_steps(p_steps jsonb, p_overrides jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
-- jsonb set functions look like a million rows to the planner, which would
-- JIT-compile every query (tens of ms each) for a few rows
set jit = off
as $$
declare
  s          jsonb;
  v_todo     jsonb := coalesce(p_steps, '[]'::jsonb);
  v_next     jsonb;
  v_progress boolean;
  v_err      text;
  v_state    text;
  v_tbl      regclass;
  v_key      text;
  v_t        text;
  v_set      text;
  v_cols     text;
  v_colsj    jsonb;
  v_payload  jsonb;
  v_rows     jsonb;
  v_snap     jsonb;
  v_n        integer;
  v_want     integer;
  v_ids      text[];
  v_gone     text[] := '{}';
  v_reverted integer := 0;
  v_over     integer := 0;
  v_deleted  integer := 0;
  v_back     integer := 0;
  v_snaps    jsonb := '[]'::jsonb;
  v_reins    jsonb := '[]'::jsonb;
  v_revs     jsonb := '[]'::jsonb;
  v_now      jsonb;
  v_orig     jsonb;
  v_norm     jsonb;
  v_skip     text[];
  v_drift    jsonb := '[]'::jsonb;
  v_tx       bigint := txid_current();
  v_seq0     bigint;
  v_hidden0  integer;
  v_ob0      jsonb;
  v_ob1      jsonb;
  v_outbox   jsonb;
  v_mine     text[] := '{}';
  v_ukeyed   text[];
  v_outside  jsonb;
  v_side     jsonb;
  v_labels   jsonb := '{}'::jsonb;
  v_lab      jsonb;
begin
  -- What this transaction holds already: only what the steps do counts below.
  select coalesce(max(a.seq), 0) into v_seq0 from public.audit_logs a where a.tx_id = v_tx;
  v_hidden0 := public.app_undo_hidden_changes(v_tx);
  v_ob0 := public.app_undo_outbox(0);

  loop
    v_next := '[]'::jsonb;
    v_progress := false;
    for s in select value from jsonb_array_elements(v_todo) loop
      v_tbl := to_regclass(format('public.%I', s ->> 't'));
      if v_tbl is null then
        raise exception 'app_undo: table % is gone', s ->> 't' using errcode = '42P01';
      end if;
      v_key := coalesce(s ->> 'k', 'id');
      begin
        if s ->> 'action' in ('revert', 'overwrite') then
          -- every row of the step names the same columns
          select string_agg(format('%1$I = b.%1$I', a.attname), ', ' order by a.attname),
                 jsonb_agg(a.attname order by a.attname)
            into v_set, v_colsj
          from pg_attribute a
          where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped
            and a.attgenerated = '' and a.attidentity <> 'a' and a.attname <> v_key
            and (s -> 'rows' -> 0 -> 'set') ? a.attname;
          if v_set is null then
            raise exception 'app_undo: nothing to write back in %', s ->> 't' using errcode = 'UD004';
          end if;
          select jsonb_agg((r -> 'set') || jsonb_build_object(v_key, r -> 'id')), count(*)::integer
            into v_payload, v_want
          from jsonb_array_elements(s -> 'rows') r;
          execute format('with u as (update %1$s t set %2$s from jsonb_populate_recordset(null::%1$s, $1) b where t.%3$I = b.%3$I returning to_jsonb(t) as r) '
                         'select count(*)::integer, coalesce(jsonb_agg(u.r), ''[]'') from u', v_tbl, v_set, v_key)
            into v_n, v_rows using v_payload;
          if v_n <> v_want then
            -- gone, or row level security said no
            raise exception 'app_undo: % of % % rows could not be written back', v_want - v_n, v_want, s ->> 't' using errcode = 'UD004';
          end if;
          if s ->> 'action' = 'revert' then v_reverted := v_reverted + v_n; else v_over := v_over + v_n; end if;
          v_revs := v_revs || (select jsonb_agg(jsonb_build_object('t', s ->> 't', 'columns', v_colsj, 'row', r))
                               from jsonb_array_elements(v_rows) r);
        elsif s ->> 'action' = 'delete' then
          -- A row an earlier step's cascade already took (a child this save made too) is done.
          v_ids := array(select i from jsonb_array_elements_text(s -> 'ids') i
                         where not (((s ->> 't') || ':' || i) = any (v_gone)));
          if cardinality(v_ids) > 0 then
            v_snap := public.app_delete_rows(s ->> 't', v_ids);
            if v_snap is null or (v_snap ->> 'deleted')::integer <> cardinality(v_ids) then
              -- gone, or row level security said no
              raise exception 'app_undo: % of % % rows could not be deleted', cardinality(v_ids) - coalesce((v_snap ->> 'deleted')::integer, 0),
                cardinality(v_ids), s ->> 't' using errcode = 'UD004';
            end if;
            v_snaps := v_snaps || jsonb_build_array(v_snap);
            v_gone := v_gone || array(
              select (g ->> 'table') || ':' || (x ->> (g ->> 'pk'))
              from jsonb_array_elements(v_snap -> 'groups') g, jsonb_array_elements(g -> 'rows') x
              where g ->> 'pk' is not null);
          end if;
          v_deleted := v_deleted + jsonb_array_length(s -> 'ids');
        elsif s ->> 'action' = 'reinsert' then
          select jsonb_agg(r || coalesce(p_overrides -> (s ->> 't'), '{}'::jsonb)), count(*)::integer
            into v_payload, v_want
          from jsonb_array_elements(s -> 'rows') r;
          -- The columns the old rows name (a column added since takes its default).
          select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
            into v_cols
          from pg_attribute a
          where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped
            and a.attgenerated = '' and a.attidentity <> 'a' and (v_payload -> 0) ? a.attname;
          execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)', v_tbl, v_cols, v_cols, v_tbl)
            using v_payload;
          get diagnostics v_n = row_count;
          v_back := v_back + v_n;
          v_reins := v_reins || (select jsonb_agg(jsonb_build_object('t', s ->> 't', 'row', r)) from jsonb_array_elements(s -> 'rows') r);
        else
          raise exception 'app_undo: unknown step %', s ->> 'action' using errcode = '22023';
        end if;
        v_progress := true;
      exception when foreign_key_violation or unique_violation then
        v_next := v_next || jsonb_build_array(s);
        v_err := sqlerrm;
        v_state := sqlstate;
      end;
    end loop;
    exit when jsonb_array_length(v_next) = 0;
    if not v_progress then
      raise exception '%', v_err using errcode = v_state;
    end if;
    v_todo := v_next;
  end loop;

  -- Deferred triggers (149's watch reconcile) fire now — in a trial run too —
  -- so what they change is read below.
  set constraints all immediate;

  -- Tables keyed by user_id among what this transaction changed.
  select coalesce(array_agg(d.t), '{}') into v_ukeyed
  from (select distinct a.table_name as t from public.audit_logs a where a.tx_id = v_tx and a.seq > v_seq0) d
  where public.app_pk_column(to_regclass(format('public.%I', d.t))) = 'user_id';

  -- A row a step writes back can have a column OUTSIDE the step changed by a
  -- rule (a BEFORE trigger on that very write — 143 clearing is_focused when
  -- `done` goes back — or a later one): from this transaction's own audit
  -- rows, the value before the undo against the value after it, bookkeeping
  -- aside. Keyed "table:id" → the columns.
  with st as (
    select s0.value ->> 't' as t, r0.value ->> 'id' as id, r0.value -> 'set' as setj
    from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) s0, jsonb_array_elements(s0.value -> 'rows') r0
    where s0.value ->> 'action' in ('revert', 'overwrite')
  ), ch as (
    select a.table_name as t, case when a.table_name = any (v_ukeyed) then a.user_id::text else a.row_id end as id,
           e.key as col, a.seq, a.old_data -> e.key as ov, e.value as nv
    from public.audit_logs a, jsonb_each(coalesce(a.new_data, '{}'::jsonb)) e
    where a.tx_id = v_tx and a.seq > v_seq0 and a.operation = 'UPDATE'
      and a.table_name in (select st.t from st)
  ), net as (
    select ch.t, ch.id, ch.col, (array_agg(ch.ov order by ch.seq))[1] as first_ov, (array_agg(ch.nv order by ch.seq desc))[1] as last_nv
    from ch group by ch.t, ch.id, ch.col
  )
  select coalesce(jsonb_object_agg(q.k, q.cols), '{}'::jsonb) into v_outside
  from (
    select st.t || ':' || st.id as k, jsonb_agg(net.col order by net.col) as cols
    from st join net on net.t = st.t and net.id = st.id
    where not (st.setj ? net.col) and not (net.col = any (public.app_undo_bookkeeping(st.t)))
      and net.first_ov is distinct from net.last_nv
      -- a generated column follows the columns put back
      and not exists (select 1 from pg_attribute pa
                      where pa.attrelid = to_regclass(format('public.%I', st.t)) and pa.attname = net.col and pa.attgenerated <> '')
    group by st.t, st.id
  ) q;

  -- Is every row as the steps left it? A trigger a later step set off (a
  -- rule between tables) may have changed one again: `drift` names it.
  for s in select value from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    v_tbl := to_regclass(format('public.%I', s ->> 't'));
    v_key := coalesce(s ->> 'k', 'id');
    v_ids := case when s ->> 'action' = 'delete' then array(select jsonb_array_elements_text(s -> 'ids'))
                  when s ->> 'action' = 'reinsert' then array(select r ->> v_key from jsonb_array_elements(s -> 'rows') r)
                  else array(select r ->> 'id' from jsonb_array_elements(s -> 'rows') r) end;
    v_mine := v_mine || array(select (s ->> 't') || ':' || i from unnest(v_ids) i);
    execute format('select coalesce(jsonb_object_agg(x.%1$I::text, to_jsonb(x)), ''{}'') from %2$s x where x.%1$I = any ($1::%3$s[])',
                   v_key, v_tbl, public.app_column_type(v_tbl, v_key))
      into v_now using v_ids;
    if s ->> 'action' = 'delete' then
      v_drift := v_drift || coalesce((select jsonb_agg(jsonb_build_object('t', s ->> 't', 'id', i, 'how', 'still_there', 'columns', null,
                                                                'label', public.app_undo_label(v_now -> i)))
                                      from unnest(v_ids) i where v_now ? i), '[]'::jsonb);
    elsif s ->> 'action' = 'reinsert' then
      -- Gone again, or put back with a column a trigger rewrote. Compared as
      -- the table's own types (the old row is the log's JSON); what the
      -- overrides reset, what the database fills in, bookkeeping and outside
      -- links aside.
      v_skip := public.app_undo_bookkeeping(s ->> 't') || public.app_undo_links(s ->> 't') || array[v_key]
                || array(select jsonb_object_keys(coalesce(p_overrides -> (s ->> 't'), '{}'::jsonb)));
      select coalesce(jsonb_object_agg(r ->> v_key, r), '{}'::jsonb) into v_orig from jsonb_array_elements(s -> 'rows') r;
      execute format('select coalesce(jsonb_object_agg(r ->> %L, to_jsonb(jsonb_populate_record(null::%s, r))), ''{}'') from jsonb_array_elements($1) r',
                     v_key, v_tbl)
        into v_norm using s -> 'rows';
      v_drift := v_drift || coalesce((
        select jsonb_agg(case when not v_now ? i
                              then jsonb_build_object('t', s ->> 't', 'id', i, 'how', 'missing', 'columns', null, 'label', public.app_undo_label(v_orig -> i))
                              else jsonb_build_object('t', s ->> 't', 'id', i, 'how', 'changed', 'columns', d.cols, 'label', public.app_undo_label(v_now -> i)) end)
        from unnest(v_ids) i
        left join lateral (
          select jsonb_agg(a.attname order by a.attname) as cols
          from pg_attribute a
          where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a'
            and not (a.attname::text = any (v_skip))
            and (v_orig -> i) ? a.attname::text
            and (v_now -> i -> a.attname::text) is distinct from (v_norm -> i -> a.attname::text)
        ) d on true
        where not v_now ? i or d.cols is not null), '[]'::jsonb);
    else
      -- A column put back that isn't as set, or a column outside the step a
      -- rule changed on this row.
      v_drift := v_drift || coalesce((
        select jsonb_agg(jsonb_build_object('t', s ->> 't', 'id', r ->> 'id', 'how', 'changed', 'columns', d.cols,
                                            'label', public.app_undo_label(v_now -> (r ->> 'id'))))
        from jsonb_array_elements(s -> 'rows') r,
             lateral (select jsonb_agg(u.k order by u.k) as cols from (
                        select k from jsonb_object_keys(r -> 'set') k
                         where (v_now -> (r ->> 'id') -> k) is distinct from (r -> 'set' -> k)
                        union
                        select jsonb_array_elements_text(v_outside -> ((s ->> 't') || ':' || (r ->> 'id')))) u(k)) d
        where d.cols is not null), '[]'::jsonb);
    end if;
  end loop;

  -- What the steps' deletes took with them is reported by the caller
  -- (collateral, or the save's own rows): not a side effect.
  v_mine := v_mine || array(
    select (g ->> 'table') || ':' || coalesce(x ->> (g ->> 'pk'), x ->> 'id')
    from jsonb_array_elements(v_snaps) sn,
         lateral (select value as g from jsonb_array_elements(sn -> 'groups')
                  union all select value from jsonb_array_elements(sn -> 'links')
                  union all select value from jsonb_array_elements(sn -> 'touched')) gg,
         jsonb_array_elements(gg.g -> 'rows') x
    where coalesce(x ->> (g ->> 'pk'), x ->> 'id') is not null);

  -- Side effects: what this transaction's own audit rows show changed beyond
  -- the steps (a rule between tables: 043 deleting a watched episode's plan).
  with a as (
    select a.table_name as t,
           case when a.table_name = any (v_ukeyed) then a.user_id::text else a.row_id end as k,
           a.operation as op, a.old_data as o, a.new_data as n, a.seq
    from public.audit_logs a
    where a.tx_id = v_tx and a.seq > v_seq0
  ), r as (
    select a.t, a.k,
           (array_agg(a.op order by a.seq))[1] as first_op,
           (array_agg(a.op order by a.seq desc))[1] as last_op,
           (array_agg(a.n order by a.seq))[1] as first_new,
           (array_agg(a.o order by a.seq desc))[1] as last_old,
           (select jsonb_agg(distinct c.key order by c.key)
              from public.audit_logs a2, jsonb_object_keys(coalesce(a2.new_data, '{}'::jsonb)) c(key)
             where a2.tx_id = v_tx and a2.seq > v_seq0 and a2.table_name = a.t and a2.operation = 'UPDATE'
               and (case when a.t = any (v_ukeyed) then a2.user_id::text else a2.row_id end) is not distinct from a.k
               and not (c.key = any (public.app_undo_bookkeeping(a.t)))) as cols
    from a
    where not ((a.t || ':' || coalesce(a.k, '')) = any (v_mine))
    group by a.t, a.k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           't', r.t, 'id', r.k,
           'op', case when r.first_op = 'INSERT' then 'INSERT' when r.last_op = 'DELETE' then 'DELETE' else 'UPDATE' end,
           'columns', case when r.first_op <> 'INSERT' and r.last_op <> 'DELETE' then r.cols end,
           'label', case when r.first_op = 'INSERT' then public.app_undo_label(r.first_new)
                         when r.last_op = 'DELETE' then public.app_undo_label(r.last_old) end)), '[]'::jsonb)
    into v_side
  from r
  -- made and removed again within the undo, or only bookkeeping: nothing to say
  where not (r.first_op = 'INSERT' and r.last_op = 'DELETE')
    and (r.first_op = 'INSERT' or r.last_op = 'DELETE' or r.cols is not null);

  -- A changed row's name is in the row (its log entry holds only what changed).
  for v_t in select distinct e ->> 't' from jsonb_array_elements(v_side) e where e ->> 'op' = 'UPDATE' and e ->> 'id' is not null loop
    v_tbl := to_regclass(format('public.%I', v_t));
    v_key := case when v_t = any (v_ukeyed) then 'user_id' else 'id' end;
    continue when v_tbl is null or public.app_column_type(v_tbl, v_key) is null;
    begin
      execute format('select coalesce(jsonb_object_agg(x.%1$I::text, public.app_undo_label(to_jsonb(x))), ''{}'') from %2$s x where x.%1$I::text = any ($1)',
                     v_key, v_tbl)
        into v_lab using array(select e ->> 'id' from jsonb_array_elements(v_side) e where e ->> 't' = v_t and e ->> 'op' = 'UPDATE');
      v_labels := v_labels || jsonb_build_object(v_t, v_lab);
    exception when insufficient_privilege then
      null;  -- no name, the id stands in
    end;
  end loop;
  select coalesce(jsonb_agg(c order by c::text), '[]'::jsonb) into v_side
  from (select case when e ->> 'op' = 'UPDATE' and v_labels -> (e ->> 't') ? (e ->> 'id')
                    then e || jsonb_build_object('label', v_labels -> (e ->> 't') -> (e ->> 'id'))
                    else e end as c
        from jsonb_array_elements(v_side) e) x;

  -- What the steps queued for outside services (Trakt, Google). Trakt's rows
  -- are read after the mark taken before the steps (so a whole-item remove
  -- names only what the undo queued); the others are counted, less what the
  -- transaction held before.
  v_ob1 := public.app_undo_outbox(coalesce((v_ob0 ->> 'trakt_seq')::bigint, 0));
  select coalesce(jsonb_agg(e.v || jsonb_build_object('n', (e.v ->> 'n')::integer - coalesce(b.n, 0)) order by e.v ->> 's', e.v ->> 'op'), '[]'::jsonb)
    into v_outbox
  from jsonb_array_elements(v_ob1 -> 'rows') e(v)
  left join (select x ->> 's' as s, x ->> 'op' as op, (x ->> 'n')::integer as n
             from jsonb_array_elements(v_ob0 -> 'rows') x where x ->> 's' <> 'trakt') b
    on b.s = e.v ->> 's' and b.op = e.v ->> 'op'
  where (e.v ->> 'n')::integer - coalesce(b.n, 0) > 0;

  return jsonb_build_object(
    'reverted', v_reverted, 'overwritten', v_over, 'deleted', v_deleted, 'reinserted', v_back,
    'snapshots', v_snaps, 'reinserted_rows', v_reins, 'reverted_rows', v_revs, 'drift', v_drift,
    'side_effects', v_side, 'side_hidden', greatest(public.app_undo_hidden_changes(v_tx) - v_hidden0, 0),
    'outbox', v_outbox);
end;
$$;

create or replace function public.app_undo_transaction(
  p_tx_id     bigint,
  p_apply     boolean default false,
  p_confirm   text default null,
  p_overrides jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
set jit = off
as $$
declare
  v_audit    regproc := to_regproc('public.log_audit');
  v_at       timestamptz;
  v_changes  integer;
  v_actors   jsonb;
  v_ukeyed   text[];
  v_items    jsonb;
  v_later    jsonb;
  v_mine     text[];
  v_hidden   integer;
  v_t        text;
  v_tbl      regclass;
  v_kcol     text;
  v_pktype   text;
  v_cols     jsonb;
  v_audited  boolean;
  v_book     text[];
  v_links    text[];
  v_lk       text[];
  v_lkept    jsonb := '{}'::jsonb;
  v_links_kept jsonb;
  n_cal_new  integer := 0;
  n_cal_move integer := 0;
  v_outbox   jsonb;
  v_ids      text[];
  v_cur      jsonb;
  v_nb       jsonb;
  v_na       jsonb;
  v_ovk      text[];
  v_nulls    integer;
  x          jsonb;
  v_id       text;
  v_key      text;
  v_before   boolean;
  v_after    boolean;
  r_cur      jsonb;
  r_b        jsonb;
  r_a        jsonb;
  v_keys     text[];
  v_k        text[];
  v_diff     text[];
  v_class    text;
  v_action   text;
  v_reason   text;
  v_skipcols jsonb;
  v_revcols  text[];
  n_revert   integer;
  n_delete   integer;
  n_back     integer;
  n_over     integer;
  n_already  integer;
  n_same     integer;
  n_skip     integer;
  n_order    integer;
  c_order    integer;
  v_ordlab   jsonb;
  v_tables   jsonb := '[]'::jsonb;
  -- arrays, not jsonb: appending to a jsonb copies it every time
  v_steps    jsonb[] := '{}';
  v_nsteps   integer;
  v_run_steps jsonb;
  v_conf     jsonb[] := '{}';
  v_kept     jsonb[] := '{}';
  v_blocked  jsonb := '[]'::jsonb;
  v_nolog    jsonb;
  r_nl       record;
  v_any      boolean;
  v_run      jsonb;
  v_error    jsonb;
  v_coll     jsonb;
  v_sync     jsonb;
  v_nearby   jsonb;
  v_plan     jsonb;
  v_token    text;
  v_needs    boolean;
  v_result   jsonb;
begin
  -- 1 · The save, as the log has it (row level security: the caller's rows).
  select min(a.created_at), count(*)::integer, coalesce(jsonb_agg(distinct a.actor), '[]'::jsonb)
    into v_at, v_changes, v_actors
  from public.audit_logs a
  where a.tx_id = p_tx_id;
  if v_changes = 0 then
    raise exception 'app_undo_transaction: this save is not in the activity log (cleared, older than 30 days, or not yours)'
      using errcode = 'UD003';
  end if;

  -- A row another save is writing is waited for, but only briefly: then
  -- 55P03 ("try again in a moment"), never the request's own time limit
  -- (57014). A shorter limit the caller set stays.
  if coalesce(nullif(current_setting('lock_timeout'), '0'), '1h')::interval > interval '4 seconds' then
    perform set_config('lock_timeout', '4s', true);
  end if;

  -- One-row-per-account tables (settings) are keyed by user_id: their audit
  -- rows carry no row id, so the account is the row's key.
  select coalesce(array_agg(d.t), '{}') into v_ukeyed
  from (select distinct a.table_name as t from public.audit_logs a where a.tx_id = p_tx_id) d
  where public.app_pk_column(to_regclass(format('public.%I', d.t))) = 'user_id';

  -- 2 · One item per row: its changes folded in order — the first value each
  --     column had before the save, the last value it had after it. Changes
  --     logged before 150 were numbered in storage order, so a row changed
  --     more than once must chain up, column by column: each change's old
  --     value of a column = the previous change (of that column)'s new value,
  --     bookkeeping aside; an INSERT only after a DELETE, nothing after a
  --     DELETE but an INSERT. Else its order is unknown (`ordered` false).
  with c as (
    select a.table_name as t,
           case when a.table_name = any (v_ukeyed) then a.user_id::text else a.row_id end as id,
           a.operation as op, a.old_data as o, a.new_data as n, a.seq
    from public.audit_logs a
    where a.tx_id = p_tx_id
  ), c2 as (
    select c.*, coalesce(c.id, '') as rk,
           lag(c.op) over (partition by c.t, coalesce(c.id, '') order by c.seq) as prev_op,
           count(*) over (partition by c.t, coalesce(c.id, '')) as n_changes
    from c
  ), cc as (
    -- every column a change of a row changed more than once names: its value
    -- before (o) and after (n) that change
    select c2.t, c2.rk, c2.seq, e.key, c2.o ? e.key as has_o, c2.o -> e.key as ov, c2.n ? e.key as has_n, c2.n -> e.key as nv
    from c2, lateral (select jsonb_object_keys(coalesce(c2.o, '{}'::jsonb) || coalesce(c2.n, '{}'::jsonb)) as key) e
    where c2.n_changes > 1 and not (e.key = any (public.app_undo_bookkeeping(c2.t)))
  ), broken as (
    select distinct l.t, l.rk
    from (select cc.*, lag(cc.has_n) over w as prev_has_n, lag(cc.nv) over w as prev_nv
          from cc window w as (partition by cc.t, cc.rk, cc.key order by cc.seq)) l
    where l.has_o and coalesce(l.prev_has_n, false) and l.prev_nv is distinct from l.ov
  ), r as (
    select c2.t, c2.rk, min(c2.id) as id, array_agg(c2.op order by c2.seq) as ops, max(c2.seq) as last_seq, count(*)::integer as n,
           bool_and(case
             when c2.prev_op is null then true
             when c2.op = 'INSERT' then c2.prev_op = 'DELETE'
             when c2.prev_op = 'DELETE' then false
             else true
           end) as ops_ok
    from c2
    group by c2.t, c2.rk
  ), b as (
    select x.t, x.rk, jsonb_object_agg(x.key, x.value) as obj
    from (select distinct on (c2.t, c2.rk, e.key) c2.t, c2.rk, e.key, e.value
          from c2, jsonb_each(coalesce(c2.o, '{}'::jsonb)) e
          order by c2.t, c2.rk, e.key, c2.seq) x
    group by x.t, x.rk
  ), f as (
    select x.t, x.rk, jsonb_object_agg(x.key, x.value) as obj
    from (select distinct on (c2.t, c2.rk, e.key) c2.t, c2.rk, e.key, e.value
          from c2, jsonb_each(coalesce(c2.n, '{}'::jsonb)) e
          order by c2.t, c2.rk, e.key, c2.seq desc) x
    group by x.t, x.rk
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           't', r.t, 'id', r.id, 'ops', to_jsonb(r.ops), 'n', r.n, 'seq', r.last_seq, 'ordered', r.ops_ok and bk.t is null,
           'before', coalesce(b.obj, '{}'::jsonb), 'after', coalesce(f.obj, '{}'::jsonb)
         ) order by r.last_seq desc), '[]'::jsonb)
    into v_items
  from r
  left join broken bk on bk.t = r.t and bk.rk = r.rk
  left join b on b.t = r.t and b.rk = r.rk
  left join f on f.t = r.t and f.rk = r.rk;
  v_mine := array(select (i ->> 't') || ':' || (i ->> 'id') from jsonb_array_elements(v_items) i where i ->> 'id' is not null);

  -- 3 · Changes of this save the caller's log doesn't show.
  v_hidden := public.app_undo_hidden_changes(p_tx_id);
  if v_hidden > 0 then
    v_blocked := v_blocked || jsonb_build_array(jsonb_build_object('reason', 'hidden', 'count', v_hidden));
  end if;

  -- 4 · What later saves did to the same rows (the log's own account).
  select coalesce(jsonb_object_agg(s.k, s.later), '{}'::jsonb)
    into v_later
  from (
    select a.table_name || ':' || l.k as k,
           jsonb_agg(jsonb_build_object(
             'tx', a.tx_id, 'at', a.created_at, 'op', a.operation, 'actor', a.actor,
             'columns', case when a.operation = 'UPDATE'
                             then (select coalesce(jsonb_agg(j order by j), '[]'::jsonb) from jsonb_object_keys(a.new_data) j
                                   where not (j = any (public.app_undo_bookkeeping(a.table_name))))
                        end)
             order by a.created_at, a.seq) as later
    from public.audit_logs a,
         lateral (select case when a.table_name = any (v_ukeyed) then a.user_id::text else a.row_id end as k) l
    where (a.table_name, l.k) in (select i ->> 't', i ->> 'id' from jsonb_array_elements(v_items) i where i ->> 'id' is not null)
      and a.created_at >= v_at and a.tx_id <> p_tx_id
    group by a.table_name, l.k
  ) s;

  -- 5 · Table by table: each row now, compared with what the save left.
  for v_t in select distinct i ->> 't' from jsonb_array_elements(v_items) i order by 1 loop
    select coalesce(sum((i ->> 'n')::integer), 0)::integer into v_nulls
    from jsonb_array_elements(v_items) i where i ->> 't' = v_t and i ->> 'id' is null;
    v_tbl := to_regclass(format('public.%I', v_t));
    if v_tbl is null then
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object('t', v_t, 'reason', 'table_gone',
        'count', (select sum((i ->> 'n')::integer) from jsonb_array_elements(v_items) i where i ->> 't' = v_t)));
      continue;
    end if;
    v_kcol := public.app_pk_column(v_tbl);
    if v_kcol is distinct from 'id' and not (v_kcol = 'user_id' and v_t = any (v_ukeyed)) then
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object('t', v_t, 'reason', 'no_key',
        'count', (select sum((i ->> 'n')::integer) from jsonb_array_elements(v_items) i where i ->> 't' = v_t)));
      continue;
    end if;
    if v_nulls > 0 then
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object('t', v_t, 'reason', 'no_id', 'count', v_nulls));
    end if;
    select array_agg(i ->> 'id') into v_ids
    from jsonb_array_elements(v_items) i where i ->> 't' = v_t and i ->> 'id' is not null;
    continue when v_ids is null;

    v_pktype := public.app_column_type(v_tbl, v_kcol);
    select coalesce(jsonb_object_agg(a.attname, case when a.attgenerated <> '' then 'generated'
                                                     when a.attidentity = 'a' then 'identity' else 'ok' end), '{}'::jsonb)
      into v_cols
    from pg_attribute a
    where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped;
    v_audited := v_audit is not null and exists (
      select 1 from pg_trigger tg where tg.tgrelid = v_tbl and not tg.tgisinternal and tg.tgfoid = v_audit);
    v_ovk := array(select jsonb_object_keys(coalesce(p_overrides -> v_t, '{}'::jsonb)));
    v_book := public.app_undo_bookkeeping(v_t);
    v_links := public.app_undo_links(v_t);

    -- The rows as they are, and the save's before/after typed like them
    -- (so a timestamp or a number compares as a value, not as text). An
    -- apply locks them first, then reads them: a save committing at this
    -- moment is seen, or waits for this undo. (A locking read is filtered by
    -- UPDATE policies, so the read itself stays a plain one: a row the caller
    -- may read but not change fails at its step, it never looks deleted.)
    begin
      if p_apply then
        execute format('select count(*) from (select 1 from %1$s y where y.%2$I = any ($1::%3$s[]) for update) l',
                       v_tbl, v_kcol, v_pktype)
          using v_ids;
      end if;
      execute format('select coalesce(jsonb_object_agg(x.%1$I::text, to_jsonb(x)), ''{}'') from %2$s x where x.%1$I = any ($1::%3$s[])',
                     v_kcol, v_tbl, v_pktype)
        into v_cur using v_ids;
      execute format('select coalesce(jsonb_object_agg(i ->> ''id'', to_jsonb(jsonb_populate_record(null::%s, i -> ''before''))), ''{}'') '
                     'from jsonb_array_elements($1) i where i ->> ''t'' = $2 and i ->> ''id'' is not null', v_tbl)
        into v_nb using v_items, v_t;
      execute format('select coalesce(jsonb_object_agg(i ->> ''id'', to_jsonb(jsonb_populate_record(null::%s, i -> ''after''))), ''{}'') '
                     'from jsonb_array_elements($1) i where i ->> ''t'' = $2 and i ->> ''id'' is not null', v_tbl)
        into v_na using v_items, v_t;
    exception when others then
      -- waiting for a lock went wrong: the undo stops, it never guesses
      if sqlstate in ('40P01', '55P03', '40001') then
        raise;
      end if;
      -- the caller may not read the table, or a column's type changed since
      -- (its old values can't be read back)
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object('t', v_t,
        'reason', case when sqlstate = '42501' then 'no_access' else 'unreadable' end, 'detail', sqlerrm,
        'count', (select sum((i ->> 'n')::integer) from jsonb_array_elements(v_items) i where i ->> 't' = v_t and i ->> 'id' is not null)));
      continue;
    end;

    n_revert := 0; n_delete := 0; n_back := 0; n_over := 0; n_already := 0; n_same := 0; n_skip := 0;
    n_order := 0; c_order := 0; v_ordlab := '[]'::jsonb;
    v_skipcols := '{}'::jsonb;
    v_revcols := '{}';
    for x in
      select value from jsonb_array_elements(v_items)
      where value ->> 't' = v_t and value ->> 'id' is not null
      order by (value ->> 'seq')::bigint desc
    loop
      v_id     := x ->> 'id';
      v_key    := v_t || ':' || v_id;
      v_before := (x -> 'ops' ->> 0) in ('UPDATE', 'DELETE');
      v_after  := (x -> 'ops' ->> -1) in ('INSERT', 'UPDATE');
      r_cur := v_cur -> v_id;
      r_b   := v_nb -> v_id;
      r_a   := v_na -> v_id;

      -- Its changes don't chain up (logged before 150): blocked, never guessed.
      if not coalesce((x ->> 'ordered')::boolean, true) then
        n_order := n_order + 1;
        c_order := c_order + (x ->> 'n')::integer;
        if jsonb_array_length(v_ordlab) < 5 then
          v_ordlab := v_ordlab || to_jsonb(coalesce(public.app_undo_label(coalesce(r_cur, r_a, r_b)), '#' || left(v_id, 8)));
        end if;
        continue;
      end if;

      -- The columns the save's record names, key, bookkeeping and outside
      -- links aside; those that can't take a value any more are reported,
      -- never passed over.
      v_keys := array(
        select k from (select jsonb_object_keys(x -> 'before') as k union select jsonb_object_keys(x -> 'after')) s
        where not (k = any (v_book || v_links || array['id', v_kcol])));
      select v_skipcols || coalesce(jsonb_object_agg(k, coalesce(v_cols ->> k, 'dropped')), '{}'::jsonb)
        into v_skipcols
      from unnest(v_keys) k where coalesce(v_cols ->> k, 'dropped') <> 'ok';
      v_keys := array(select k from unnest(v_keys) k where v_cols ->> k = 'ok');

      v_k := '{}'; v_diff := '{}'; v_class := null; v_action := null; v_reason := null;
      if v_before and v_after then
        -- changed by the save: put back the columns it changed
        v_k := array(select k from unnest(v_keys) k where (r_b -> k) is distinct from (r_a -> k) order by k);
        if cardinality(v_k) = 0 then
          v_class := 'same';
        elsif r_cur is null then
          v_class := 'conflict'; v_action := 'skip'; v_reason := 'deleted_later'; v_diff := v_k;
        elsif not exists (select 1 from unnest(v_k) k where (r_cur -> k) is distinct from (r_b -> k)) then
          v_class := 'already';
        else
          -- A column holding neither what the save left nor its old value
          -- was changed since: putting the old value back overwrites that.
          v_action := 'revert';
          v_diff := array(select k from unnest(v_k) k
                          where (r_cur -> k) is distinct from (r_a -> k) and (r_cur -> k) is distinct from (r_b -> k) order by k);
          v_class := case when cardinality(v_diff) = 0 then 'clean' else 'conflict' end;
          v_reason := case when cardinality(v_diff) > 0 then 'changed_later' end;
        end if;
      elsif v_before then
        -- deleted by the save: insert it again
        if r_cur is null then
          v_class := 'clean'; v_action := 'reinsert';
        else
          v_diff := array(select k from unnest(v_keys) k
                          where not (k = any (v_ovk)) and (r_cur -> k) is distinct from (r_b -> k) order by k);
          if cardinality(v_diff) = 0 then
            v_class := 'already';
          else
            v_class := 'conflict'; v_action := 'overwrite'; v_reason := 'exists_again'; v_k := v_diff;
          end if;
        end if;
      elsif v_after then
        -- made by the save: delete it
        if r_cur is null then
          v_class := 'already';
        else
          v_action := 'delete';
          v_diff := array(select k from unnest(v_keys) k where (r_cur -> k) is distinct from (r_a -> k) order by k);
          v_class := case when cardinality(v_diff) = 0 then 'clean' else 'conflict' end;
          v_reason := case when cardinality(v_diff) > 0 then 'changed_later' end;
        end if;
      else
        v_class := 'same';  -- made and deleted within the save
      end if;

      if v_action in ('revert', 'overwrite') then
        v_steps := array_append(v_steps, jsonb_build_object('t', v_t, 'k', v_kcol, 'id', v_id, 'action', v_action, 'seq', x -> 'seq',
          'set', (select jsonb_object_agg(k, r_b -> k) from unnest(v_k) k)));
        v_revcols := array(select distinct c from unnest(v_revcols || v_k) c order by c);
      elsif v_action = 'delete' then
        v_steps := array_append(v_steps, jsonb_build_object('t', v_t, 'k', v_kcol, 'id', v_id, 'action', 'delete', 'seq', x -> 'seq'));
      elsif v_action = 'reinsert' then
        v_steps := array_append(v_steps, jsonb_build_object('t', v_t, 'k', v_kcol, 'id', v_id, 'action', 'reinsert', 'seq', x -> 'seq',
          'row', x -> 'before'));
      end if;

      -- An outside link this save changed that isn't back as it was: Undo
      -- leaves it (it must name what exists on that service), and says so.
      if v_before and v_after and r_cur is not null and cardinality(v_links) > 0 then
        v_lk := array(select k from unnest(v_links) k
                      where v_cols ->> k = 'ok' and (r_b -> k) is distinct from (r_a -> k) and (r_cur -> k) is distinct from (r_b -> k));
        if cardinality(v_lk) > 0 then
          select v_lkept || jsonb_build_object(v_t, coalesce(v_lkept -> v_t, '{}'::jsonb)
                   || coalesce(jsonb_object_agg(k, coalesce((v_lkept -> v_t ->> k)::integer, 0) + 1), '{}'::jsonb))
            into v_lkept
          from unnest(v_lk) k;
        end if;
      end if;

      -- What the browser does on Google Calendar right after (followUndo): a
      -- slot or plan put back that had an event gets a new one; a slot whose
      -- day, time, length or title goes back moves its event (a plan: any).
      if v_action = 'reinsert' and v_t in ('time_blocks', 'schedule_blocks')
         and (x -> 'before' ->> 'google_calendar_event_id') is not null then
        n_cal_new := n_cal_new + 1;
      elsif v_action in ('revert', 'overwrite') and (r_cur ->> 'google_calendar_event_id') is not null
            and (v_t = 'schedule_blocks'
                 or (v_t = 'time_blocks' and v_k && array['date', 'start_time', 'title', 'duration_minutes'])) then
        n_cal_move := n_cal_move + 1;
      end if;

      if v_action = 'revert' then n_revert := n_revert + 1;
      elsif v_action = 'delete' then n_delete := n_delete + 1;
      elsif v_action = 'reinsert' then n_back := n_back + 1;
      elsif v_action = 'overwrite' then n_over := n_over + 1;
      elsif v_action = 'skip' then n_skip := n_skip + 1;
      elsif v_class = 'already' then n_already := n_already + 1;
      else n_same := n_same + 1;
      end if;

      if v_class = 'conflict' then
        v_conf := array_append(v_conf, jsonb_build_object(
          't', v_t, 'id', v_id, 'label', public.app_undo_label(coalesce(r_cur, r_a, r_b)),
          'action', v_action, 'reason', v_reason, 'columns', to_jsonb(v_diff),
          'now', case when r_cur is not null then (select jsonb_object_agg(k, r_cur -> k) from unnest(v_diff) k) end,
          'undo', case when v_action <> 'delete' then (select jsonb_object_agg(k, r_b -> k) from unnest(v_diff) k) end,
          'later', coalesce(v_later -> v_key, '[]'::jsonb)));
      elsif v_action = 'revert' and v_later ? v_key then
        -- changed later in other columns (or back again): Undo keeps that
        v_kept := array_append(v_kept, jsonb_build_object(
          't', v_t, 'id', v_id, 'label', public.app_undo_label(coalesce(r_cur, r_a, r_b)), 'later', v_later -> v_key));
      end if;
    end loop;

    if n_order > 0 then
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object('t', v_t, 'reason', 'order_unknown',
        'count', c_order, 'rows', n_order, 'labels', v_ordlab));
    end if;
    v_tables := v_tables || jsonb_build_array(jsonb_build_object(
      't', v_t, 'audited', v_audited,
      'revert', n_revert, 'delete', n_delete, 'reinsert', n_back, 'overwrite', n_over, 'skip', n_skip,
      'already', n_already, 'same', n_same,
      'columns', to_jsonb(v_revcols), 'skipped_columns', v_skipcols));
  end loop;

  -- 6 · Tables outside the log that a put-back row's foreign keys reach, for
  --     rows put back they could point at (a non-null referenced value): what
  --     the save's delete took with it there (or unlinked) can't come back. A
  --     link the delete emptied (SET NULL) is empty still: a table with no
  --     empty link the caller can see had nothing pointing at the row.
  v_nolog := '[]'::jsonb;
  for r_nl in
    select q.child, q.parent, q.how, max(q.n) as n, min(q.col) as col, count(*) = 1 and bool_and(q.col is not null) as one_col
    from (
      select cc.relname::text as child, pc.relname::text as parent,
             case when c.confdeltype = 'c' then 'deleted' else 'unlinked' end as how,
             case when c.confdeltype = 'n' and cardinality(c.conkey) = 1
                  then (select ca.attname::text from pg_attribute ca where ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]) end as col,
             (select count(*)::integer from unnest(v_steps) st
               where st ->> 't' = pc.relname::text and st ->> 'action' = 'reinsert'
                 and not exists (select 1 from unnest(c.confkey) ck
                                 join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = ck
                                 where (st -> 'row' ->> pa.attname::text) is null)) as n
      from pg_constraint c
      join pg_class cc on cc.oid = c.conrelid
      join pg_namespace ns on ns.oid = cc.relnamespace and ns.nspname = 'public'
      join pg_class pc on pc.oid = c.confrelid
      where c.contype = 'f' and c.confdeltype in ('c', 'n', 'd')
        and pc.relname::text in (select st ->> 't' from unnest(v_steps) st where st ->> 'action' = 'reinsert')
        and not exists (select 1 from pg_trigger tg
                        where tg.tgrelid = c.conrelid and not tg.tgisinternal and tg.tgfoid = v_audit)
    ) q
    group by q.child, q.parent, q.how
    having max(q.n) > 0
    order by q.child, q.parent, q.how
  loop
    if r_nl.how = 'unlinked' and r_nl.one_col then
      begin
        execute format('select exists (select 1 from public.%I x where x.%I is null)', r_nl.child, r_nl.col) into v_any;
        continue when not v_any;
      exception when others then
        null;  -- it can't look: the table stays listed
      end;
    end if;
    v_nolog := v_nolog || jsonb_build_array(jsonb_build_object('t', r_nl.child, 'parent', r_nl.parent, 'how', r_nl.how, 'rows', r_nl.n));
  end loop;

  v_nsteps := cardinality(v_steps);

  -- 7 · Run the steps, newest change first: a run of rows of one table with
  --     the same action (and the same columns) in one statement. A preview
  --     rolls them back.
  select coalesce(jsonb_agg(m.step order by m.first_seq desc), '[]'::jsonb) into v_run_steps
  from (
    select min(o.seq) as first_seq,
           case min(o.action)
             when 'delete' then jsonb_build_object('t', min(o.t), 'k', min(o.k), 'action', 'delete',
                                                   'ids', jsonb_agg(o.st -> 'id' order by o.seq desc))
             when 'reinsert' then jsonb_build_object('t', min(o.t), 'k', min(o.k), 'action', 'reinsert',
                                                     'rows', jsonb_agg(o.st -> 'row' order by o.seq desc))
             else jsonb_build_object('t', min(o.t), 'k', min(o.k), 'action', min(o.action),
                                     'rows', jsonb_agg(jsonb_build_object('id', o.st -> 'id', 'set', o.st -> 'set') order by o.seq desc))
           end as step
    from (
      select w.*, sum(w.brk) over (order by w.seq desc) as grp
      from (
        select z.st, z.st ->> 't' as t, z.st ->> 'k' as k, z.st ->> 'action' as action, (z.st ->> 'seq')::bigint as seq,
               case when lag(z.st ->> 't') over q = z.st ->> 't' and lag(z.st ->> 'action') over q = z.st ->> 'action'
                         and lag(z.sig) over q = z.sig
                    then 0 else 1 end as brk
        from (
          select st, case st ->> 'action'
                       when 'delete' then ''
                       when 'reinsert' then (select string_agg(k, ',' order by k) from jsonb_object_keys(st -> 'row') k)
                       else (select string_agg(k, ',' order by k) from jsonb_object_keys(st -> 'set') k)
                     end as sig
          from unnest(v_steps) st
        ) z
        window q as (order by (z.st ->> 'seq')::bigint desc)
      ) w
    ) o
    group by o.grp
  ) m;
  if p_apply then
    v_run := public.app_undo_steps(v_run_steps, p_overrides);
  else
    begin
      v_run := public.app_undo_steps(v_run_steps, p_overrides);
      -- Not 'UD000': a code ending in 000 names its whole class, and would
      -- swallow the UD004 a failing step raises.
      raise exception 'app_undo_transaction: preview' using errcode = 'UD999';
    exception
      when sqlstate 'UD999' then null;
      when others then
        v_error := jsonb_build_object('message', sqlerrm, 'code', sqlstate);
        v_run := null;
    end;
  end if;

  -- 8 · What the undo's deletes took with them that this save didn't make.
  select coalesce(jsonb_agg(c order by c::text), '[]'::jsonb)
    into v_coll
  from (
    select distinct jsonb_build_object('t', g ->> 'table', 'id', rw ->> (g ->> 'pk'), 'how', 'deleted',
                                       'label', public.app_undo_label(rw)) as c
    from jsonb_array_elements(coalesce(v_run -> 'snapshots', '[]'::jsonb)) sn,
         jsonb_array_elements(sn -> 'groups') g, jsonb_array_elements(g -> 'rows') rw
    where g ->> 'pk' is null or not (((g ->> 'table') || ':' || (rw ->> (g ->> 'pk'))) = any (v_mine))
    union
    select distinct jsonb_build_object('t', g ->> 'table', 'id', rw ->> (g ->> 'pk'), 'how', case when k = 'links' then 'unlinked' else 'changed' end,
                                       'label', public.app_undo_label(rw))
    from jsonb_array_elements(coalesce(v_run -> 'snapshots', '[]'::jsonb)) sn,
         unnest(array['links', 'touched']) k,
         jsonb_array_elements(sn -> k) g, jsonb_array_elements(g -> 'rows') rw
    where not (((g ->> 'table') || ':' || (rw ->> (g ->> 'pk'))) = any (v_mine))
    union
    select distinct jsonb_build_object('t', h, 'id', null, 'how', 'hidden', 'label', null)
    from jsonb_array_elements(coalesce(v_run -> 'snapshots', '[]'::jsonb)) sn, jsonb_array_elements_text(sn -> 'hidden') h
    union
    select jsonb_build_object('t', sn ->> 'root', 'id', null, 'how', 'too_big', 'label', null)
    from jsonb_array_elements(coalesce(v_run -> 'snapshots', '[]'::jsonb)) sn where (sn ->> 'too_big')::boolean
  ) s;

  -- A save made by AI / a sync whose undo touches a synced table: the
  -- service may still have the save's change (the browser says what the
  -- outbox lines don't).
  select coalesce(jsonb_agg(distinct st ->> 't' order by st ->> 't'), '[]'::jsonb)
    into v_sync
  from unnest(v_steps) st
  where v_actors ? 'service' and public.app_undo_synced(st ->> 't') is not null;

  -- A later edit is "kept" only if the undo itself doesn't change that
  -- column too (a rule on the row it writes back: drift says so instead).
  v_kept := array(
    select kp from unnest(v_kept) kp
    where not exists (
      select 1 from jsonb_array_elements(coalesce(v_run -> 'drift', '[]'::jsonb)) d,
                    jsonb_array_elements_text(coalesce(d -> 'columns', '[]'::jsonb)) dc
      where d ->> 't' = kp ->> 't' and d ->> 'id' = kp ->> 'id'
        and exists (select 1 from jsonb_array_elements(kp -> 'later') l
                    where jsonb_typeof(l -> 'columns') is distinct from 'array' or l -> 'columns' ? dc)));

  -- What goes outside: the outbox rows the steps queued, and the Google
  -- Calendar events the browser makes or moves right after (followUndo).
  select coalesce(jsonb_agg(jsonb_build_object('s', g.s, 'op', g.op, 'n', g.n) || coalesce(g.extra, '{}'::jsonb) order by g.s, g.op), '[]'::jsonb)
    into v_outbox
  from (
    select o.s, o.op, sum(o.n)::integer as n,
           (array_agg(o.extra) filter (where o.extra is not null))[1] as extra
    from (
      select e ->> 's' as s, e ->> 'op' as op, (e ->> 'n')::integer as n, e - 's' - 'op' - 'n' as extra
      from jsonb_array_elements(coalesce(v_run -> 'outbox', '[]'::jsonb)) e
      union all select 'google_calendar', 'create', n_cal_new, null where n_cal_new > 0
      union all select 'google_calendar', 'update', n_cal_move, null where n_cal_move > 0
    ) o
    group by o.s, o.op
  ) g;

  -- Outside links the save changed that Undo leaves as they are.
  select coalesce(jsonb_agg(jsonb_build_object('t', t.key, 'c', c.key, 'n', (c.value #>> '{}')::integer) order by t.key, c.key), '[]'::jsonb)
    into v_links_kept
  from jsonb_each(v_lkept) t, jsonb_each(t.value) c;

  -- 9 · The plan, and its fingerprint: an apply must match what was shown.
  v_plan := jsonb_build_object(
    'tables', v_tables, 'conflicts', to_jsonb(v_conf), 'kept', to_jsonb(v_kept), 'blocked', v_blocked,
    'collateral', v_coll, 'not_logged', v_nolog, 'error', v_error,
    'drift', coalesce(v_run -> 'drift', '[]'::jsonb), 'steps', v_nsteps,
    'side_effects', coalesce(v_run -> 'side_effects', '[]'::jsonb),
    'side_hidden', coalesce((v_run ->> 'side_hidden')::integer, 0),
    'outbox', v_outbox, 'links_kept', v_links_kept,
    'sync_save', v_sync);
  v_token := md5(v_plan::text);
  v_needs := cardinality(v_conf) > 0 or jsonb_array_length(v_blocked) > 0 or jsonb_array_length(v_coll) > 0
             or jsonb_array_length(v_plan -> 'drift') > 0 or jsonb_array_length(v_nolog) > 0
             or jsonb_array_length(v_plan -> 'side_effects') > 0 or (v_plan ->> 'side_hidden')::integer > 0
             or jsonb_array_length(v_outbox) > 0 or jsonb_array_length(v_links_kept) > 0 or jsonb_array_length(v_sync) > 0;

  if p_apply then
    if p_confirm is not null and p_confirm <> v_token then
      raise exception 'app_undo_transaction: this save''s rows changed since the preview — look again'
        using errcode = 'UD002';
    end if;
    if v_needs and p_confirm is null then
      raise exception 'app_undo_transaction: % conflicts, % blocked, % other rows, % rows a rule changes and % changes outside the app need confirming first',
        cardinality(v_conf), jsonb_array_length(v_blocked) + jsonb_array_length(v_nolog), jsonb_array_length(v_coll),
        jsonb_array_length(v_plan -> 'drift') + jsonb_array_length(v_plan -> 'side_effects'),
        jsonb_array_length(v_outbox) + jsonb_array_length(v_links_kept) + jsonb_array_length(v_sync)
        using errcode = 'UD001';
    end if;
    -- This undo is not a save of its own for the nearby-saves hint.
    if (select auth.uid()) is not null and v_nsteps > 0 then
      insert into public.audit_undos (undo_tx, undone_tx) values (txid_current(), p_tx_id) on conflict (undo_tx) do nothing;
      delete from public.audit_undos where user_id = (select auth.uid()) and created_at < now() - interval '30 days';
    end if;
    v_result := jsonb_build_object(
      -- this undo's own transaction: undoing it is the way back
      'undo_tx', txid_current(),
      'reverted', v_run -> 'reverted', 'overwritten', v_run -> 'overwritten',
      'deleted', v_run -> 'deleted', 'reinserted', v_run -> 'reinserted',
      'reverted_rows', v_run -> 'reverted_rows', 'reinserted_rows', v_run -> 'reinserted_rows',
      -- every row the undo deleted, with what went with it (for the browser's
      -- follow-ups: a Calendar event to take off Google)
      'deleted_rows', (select coalesce(jsonb_agg(g), '[]'::jsonb)
                       from jsonb_array_elements(v_run -> 'snapshots') sn, jsonb_array_elements(sn -> 'groups') g));
  end if;

  -- For a save of media rows (where Spread writes up to three saves): other
  -- saves by the same actor within seconds of it on the same media tables,
  -- undos aside. A hint, not in the fingerprint.
  select coalesce(jsonb_agg(jsonb_build_object('tx', n.tx, 'at', n.at, 'changes', n.changes, 'when', n.wh)
                            order by n.at, n.tx), '[]'::jsonb)
    into v_nearby
  from (
    select a.tx_id as tx, min(a.created_at) as at, count(*)::integer as changes,
           case when min(a.created_at) > v_at or (min(a.created_at) = v_at and a.tx_id > p_tx_id) then 'after' else 'before' end as wh
    from public.audit_logs a
    where a.created_at between v_at - interval '10 seconds' and v_at + interval '10 seconds'
      and a.tx_id <> p_tx_id
      and v_actors ? a.actor
      and not exists (select 1 from public.audit_undos u where u.undo_tx = a.tx_id)
    group by a.tx_id
    having bool_or(a.table_name in (select distinct i ->> 't' from jsonb_array_elements(v_items) i
                                    where i ->> 't' in ('user_tv_episodes', 'user_tv_entries', 'user_movie_entries', 'media_watches')))
  ) n;

  return v_plan || jsonb_build_object(
    'tx_id', p_tx_id, 'at', v_at, 'actors', v_actors, 'changes', v_changes, 'hidden', v_hidden,
    'needs_confirm', v_needs, 'confirm', v_token, 'can_apply', v_error is null,
    'applied', p_apply, 'result', v_result, 'nearby', v_nearby);
end;
$$;

revoke all on function public.app_undo_bookkeeping(text) from public, anon;
revoke all on function public.app_undo_links(text) from public, anon;
revoke all on function public.app_undo_synced(text) from public, anon;
revoke all on function public.app_undo_outbox(bigint) from public, anon;
revoke all on function public.app_undo_steps(jsonb, jsonb) from public, anon;
revoke all on function public.app_undo_transaction(bigint, boolean, text, jsonb) from public, anon;
grant execute on function public.app_undo_bookkeeping(text) to authenticated;
grant execute on function public.app_undo_links(text) to authenticated;
grant execute on function public.app_undo_synced(text) to authenticated;
grant execute on function public.app_undo_outbox(bigint) to authenticated;
grant execute on function public.app_undo_steps(jsonb, jsonb) to authenticated;
grant execute on function public.app_undo_transaction(bigint, boolean, text, jsonb) to authenticated;

comment on function public.app_undo_transaction(bigint, boolean, text, jsonb) is
  'Undo one save (an audit_logs transaction): apply=false returns the plan (steps, conflicts with later saves, blocked changes, what deletes take with them, rows rules change again or besides, what goes to Trakt/Google, outside links left as they are) and changes nothing; apply=true runs it in one transaction and needs the plan''s confirm token when it lists anything to confirm. Runs as the caller (151).';
comment on function public.app_undo_steps(jsonb, jsonb) is
  'Runs the steps app_undo_transaction built (revert/overwrite/delete/reinsert, by id or user_id), newest first, retrying a step a foreign key or unique index stops; then fires deferred triggers and reports drift (a rule''s change to a step row too), side effects and outbox rows. Runs as the caller (151).';
comment on function public.app_undo_outbox(bigint) is
  'Outbox rows (Trakt after the given seq, Google Tasks, Google Calendar) the caller''s current transaction wrote for the caller''s account, counted per service and kind, with the newest Trakt seq as the next mark (151).';
comment on table public.audit_undos is
  'One row per "Undo this save" applied (its transaction, the save it took back), so the nearby-saves hint leaves undos out (151). Rows older than 30 days go when the next undo runs.';

select public.owner_lock_apply('public.audit_undos');
