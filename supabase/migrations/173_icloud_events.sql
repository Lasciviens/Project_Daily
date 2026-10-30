-- ═══════════════════════════════════════════════════════════════════════════
-- 173 — The app's events in Apple Calendar, part 1: the writer (owner,
-- 29.10.2026: "Go" for Phase 2; docs/features/calendar-plan.md, step 2b-1).
--
-- Dormant until an area is switched to Apple (Settings → Calendar, step 2b-2):
-- calendar_prefs.prefs.areas.<area>.app = 'apple'. Until then no trigger here
-- queues anything and Google Calendar stays exactly as it is.
--
--   A. Where an item's event lives in iCloud: time_blocks.icloud_href (a
--      slot's event), schedule_blocks.icloud_href (a repeating plan's ONE
--      series) with icloud_from (the day the series starts from in iCloud,
--      like 148's google_calendar_from) and icloud_horizon (the RDATE list's
--      last day, like 147's google_calendar_horizon). Written only by the
--      icloud-calendar function (service role).
--   B. icloud_outbox: one row per slot or plan that changed, drained by the
--      function (`drain`), which reads the LIVE rows and puts or removes the
--      event. Service role only, owner lock; created_at for Undo's preview.
--   C. Triggers on time_blocks, schedule_blocks and tasks queue a change when
--      an area is on Apple (icloud_writes_on) or the item already has an
--      iCloud event — a change of the icloud_* columns alone (the function's
--      own write) never queues, and nothing queues while app.icloud_readback
--      is on (the read-back of step 2c).
--   D. Undo: the links (app_undo_links), the series' iCloud start and horizon
--      (app_undo_bookkeeping) and the queue (app_undo_outbox: "Apple Calendar").
-- Re-runnable: IF NOT EXISTS, DROP … IF EXISTS before CREATE TRIGGER.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Links ─────────────────────────────────────────────────────────────────
alter table public.time_blocks add column if not exists icloud_href text;
alter table public.schedule_blocks
  add column if not exists icloud_href    text,
  add column if not exists icloud_from    date,
  add column if not exists icloud_horizon date;
comment on column public.time_blocks.icloud_href is
  'The slot''s event in its area''s Apple Calendar (173, written by icloud-calendar): the object''s address in iCloud.';
comment on column public.schedule_blocks.icloud_href is
  'The plan''s ONE series event in its area''s Apple Calendar (173, written by icloud-calendar).';

-- ── B. The queue ─────────────────────────────────────────────────────────────
create table if not exists public.icloud_outbox (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity       text not null check (entity in ('slot', 'plan')),
  entity_id    uuid not null,
  -- The event to remove when the row itself is gone (its icloud_href at the delete).
  href         text,
  requested_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  attempts     integer not null default 0,
  next_try_at  timestamptz not null default now(),
  last_error   text,
  unique (user_id, entity, entity_id)
);
alter table public.icloud_outbox enable row level security;
revoke all on public.icloud_outbox from anon, authenticated;
grant select, insert, update, delete on public.icloud_outbox to service_role;
create index if not exists icloud_outbox_due on public.icloud_outbox (user_id, next_try_at);
comment on table public.icloud_outbox is
  'Slots and plans whose Apple Calendar event must be put or removed (173). Drained by icloud-calendar, which reads the live rows; a row goes only while requested_at is what it read.';

-- ── C. Queueing ──────────────────────────────────────────────────────────────
-- Is any area of this account on Apple Calendar? (Settings → Calendar.)
create or replace function public.icloud_writes_on(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.calendar_prefs p, jsonb_each(coalesce(p.prefs -> 'areas', '{}'::jsonb)) a(area, conf)
    where p.user_id = p_user and jsonb_typeof(a.conf) = 'object' and a.conf ->> 'app' = 'apple'
  )
$$;
revoke all on function public.icloud_writes_on(uuid) from public, anon;
grant execute on function public.icloud_writes_on(uuid) to authenticated, service_role;

create or replace function public.icloud_enqueue(p_user uuid, p_entity text, p_id uuid, p_href text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or p_id is null then return; end if;
  -- A user that no longer exists (an account being deleted) queues nothing, or the delete would abort.
  if not exists (select 1 from auth.users u where u.id = p_user) then return; end if;
  insert into public.icloud_outbox (user_id, entity, entity_id, href)
  values (p_user, p_entity, p_id, p_href)
  on conflict (user_id, entity, entity_id) do update
    set requested_at = now(),
        href = coalesce(excluded.href, public.icloud_outbox.href),
        attempts = 0, next_try_at = now(), last_error = null;
end;
$$;
revoke all on function public.icloud_enqueue(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public.icloud_time_block_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.icloud_readback', true), '') = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    if old.icloud_href is not null then perform public.icloud_enqueue(old.user_id, 'slot', old.id, old.icloud_href); end if;
    return null;
  end if;
  -- The function's own write of icloud_href, or any column the event doesn't show: nothing to send.
  if tg_op = 'UPDATE' and (new.date, new.start_time, new.duration_minutes, new.title, new.busy, new.category,
                           new.source_type, new.task_id, new.notes, new.user_id)
        is not distinct from (old.date, old.start_time, old.duration_minutes, old.title, old.busy, old.category,
                              old.source_type, old.task_id, old.notes, old.user_id) then
    return null;
  end if;
  if new.icloud_href is not null or public.icloud_writes_on(new.user_id) then
    perform public.icloud_enqueue(new.user_id, 'slot', new.id, null);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_icloud_time_block on public.time_blocks;
create trigger trg_icloud_time_block
  after insert or update or delete on public.time_blocks
  for each row execute function public.icloud_time_block_changed();

create or replace function public.icloud_schedule_block_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.icloud_readback', true), '') = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    if old.icloud_href is not null then perform public.icloud_enqueue(old.user_id, 'plan', old.id, old.icloud_href); end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.title, new.start_time, new.end_time, new.busy, new.days_of_week, new.repeat_kind,
                           new.repeat_interval, new.repeat_unit, new.repeat_dates, new.effective_from, new.except_dates,
                           new.category, new.domain, new.google_target, new.notes, new.user_id)
        is not distinct from (old.title, old.start_time, old.end_time, old.busy, old.days_of_week, old.repeat_kind,
                              old.repeat_interval, old.repeat_unit, old.repeat_dates, old.effective_from, old.except_dates,
                              old.category, old.domain, old.google_target, old.notes, old.user_id) then
    return null;
  end if;
  if new.icloud_href is not null or public.icloud_writes_on(new.user_id) then
    perform public.icloud_enqueue(new.user_id, 'plan', new.id, null);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_icloud_schedule_block on public.schedule_blocks;
create trigger trg_icloud_schedule_block
  after insert or update or delete on public.schedule_blocks
  for each row execute function public.icloud_schedule_block_changed();

-- A task's done mark, title, Google choice or area change reaches its slot's event.
create or replace function public.icloud_task_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
begin
  if coalesce(current_setting('app.icloud_readback', true), '') = 'on' then return null; end if;
  if (new.status, new.title, new.google_target, new.domain, new.source_type, new.project_id, new.hevy_routine_id, new.description)
       is not distinct from (old.status, old.title, old.google_target, old.domain, old.source_type, old.project_id, old.hevy_routine_id, old.description) then
    return null;
  end if;
  for b in select tb.id, tb.user_id, tb.icloud_href from public.time_blocks tb where tb.task_id = new.id loop
    if b.icloud_href is not null or public.icloud_writes_on(b.user_id) then
      perform public.icloud_enqueue(b.user_id, 'slot', b.id, null);
    end if;
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_icloud_task on public.tasks;
create trigger trg_icloud_task
  after update on public.tasks
  for each row execute function public.icloud_task_changed();

-- ── D. Undo ──────────────────────────────────────────────────────────────────
-- 151's list, plus the iCloud links (an undo never puts back an address that names nothing in iCloud).
create or replace function public.app_undo_links(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'tasks' then array['google_task_id', 'google_tasklist_id', 'google_calendar_event_id']::text[]
    when 'time_blocks' then array['google_calendar_event_id', 'icloud_href']::text[]
    when 'schedule_blocks' then array['google_calendar_event_id', 'icloud_href']::text[]
    when 'user_movie_entries' then array['trakt_note_id']::text[]
    when 'user_tv_entries' then array['trakt_note_id']::text[]
    when 'user_tv_episodes' then array['trakt_note_id']::text[]
    else '{}'::text[]
  end
$$;

-- 160's list, plus the series' iCloud start day and horizon: the state of the
-- outside copy, never put back nor compared (change both lists together).
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
              when 'schedule_blocks' then array['google_calendar_horizon', 'google_calendar_from', 'google_calendar_time_zone',
                                                'icloud_from', 'icloud_horizon']::text[]
              when 'user_movie_entries' then array['trakt_note_text']::text[]
              when 'user_tv_entries' then array['trakt_note_text']::text[]
              when 'supplement_schedules' then array['stock_set_at']::text[]
              else '{}'::text[]
            end
$$;

-- 151's preview of what an undo sends to outside services, plus Apple Calendar:
-- the slots and plans this transaction queued (requested_at = now(), the
-- transaction's start — a row queued earlier and touched again counts too).
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
  if to_regclass('public.icloud_outbox') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('s', 'apple_calendar', 'op', 'upsert', 'n', x.n)), '[]'::jsonb)
      from (select count(*)::integer as n
            from public.icloud_outbox o
            where o.user_id = $1 and o.requested_at = now()
            having count(*) > 0) x $q$
      into v_part using v_uid;
    v_out := v_out || v_part;
  end if;
  return jsonb_build_object('rows', v_out, 'trakt_seq', v_seq);
end;
$$;

revoke all on function public.app_undo_outbox(bigint) from public, anon;
grant execute on function public.app_undo_bookkeeping(text) to authenticated;
grant execute on function public.app_undo_links(text) to authenticated;
grant execute on function public.app_undo_outbox(bigint) to authenticated;

select public.owner_lock_apply('public.icloud_outbox');
