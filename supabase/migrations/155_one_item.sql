-- ═══════════════════════════════════════════════════════════════════════════
-- 155: One item — a task, its optional slot and its optional repeat rule are
-- saved and shown as ONE thing (owner go, 15.10.2026: "No steps. Do at once.").
--
-- No new item table: `tasks` is the item, `time_blocks` its optional slot
-- (time_blocks.task_id), `schedule_blocks` its optional repeat rule. Same
-- tables, same row ids, same Google links — a new table would break six
-- foreign keys, the two Google outboxes and Undo of recent saves (audit rows
-- name the table). What is new is ONE save path, ONE Google choice per item
-- and a few columns. Feature description: docs/features/tasks.md and
-- docs/features/planning-calendar.md → "One item (155)". Google's side,
-- checked against Google's reference first: docs/integrations/google-calendar.md.
--
--  A. Columns (all additive; old rows keep today's behaviour until they are
--     next saved — every new column is NULL or defaults to what old rows do):
--     tasks.google_target         'tasks'|'calendar'|'both'|'none'; NULL = an
--                                 old row (its Google presence is whatever its
--                                 google_sync_enabled / slot event say)
--     tasks.deadline_date/_time   "+ Deadline" (due by). The item's own day
--                                 and time stay in due_date / due_time, so
--                                 every day read (fetchTasksForDay, the brief,
--                                 phone-gateway, push-send) keeps working with
--                                 no new filter (NEVER_HIDES)
--     time_blocks.busy            false = "do it at 14:00" (no length, blocks
--                                 no time; Google: Free). A slot with a day and
--                                 no start_time is the item's all-day presence
--                                 on Google Calendar
--     schedule_blocks.start_time / end_time may be NULL (both or neither): a
--                                 repeat with no time (an all-day series)
--     schedule_blocks.busy, google_target ('calendar'|'none'; Google Tasks
--                                 can't repeat through its API), domain,
--                                 priority, notes (what a repeating item's day
--                                 becomes when it is ticked off)
--  B. schedule_blocks gets trg_audit: repeating plans had no Activity trail.
--     app_undo_bookkeeping (151) learns the series' start day and zone.
--  C. calendar_outbox (135) gains an 'upsert' operation: a linked slot or plan
--     changed on the SERVER (the assistant, a Google Tasks pull renaming its
--     task, Hevy closing a session, any task ticked done or reopened — the
--     "✓ " in the event title) is queued and google-tasks-sync PATCHes the
--     event from the row as it is then. A delete always wins over a waiting
--     upsert; a new request bumps requested_at, so a drain that read an older
--     row never removes the newer request.
--  D. google_calendar_sync_state: the Calendar read-back's sync token and its
--     last run (one row per account, written by google-tasks-sync only).
--  E. RPCs, all SECURITY INVOKER (row level security and the owner lock apply)
--     except the read-back, which only the service role may call:
--       app_save_item(item)        one transaction = one Activity entry
--       app_repeat_day(plan, day, action, today)
--                                  done / skip / undo (and remove / restore
--                                  for "delete only this day") on ONE day of
--                                  ANY repeating item — 142's path, generalised
--       app_convert_preview(today) / app_convert_apply(today) /
--       app_convert_undo(conversion)
--                                  Settings' "Convert old items": a future
--                                  standalone slot gets a task; its own Undo
--                                  unlinks first, then deletes only what it
--                                  made — never an original slot or its event
--       apply_calendar_readback(user, event)
--                                  one change read back from Google Calendar
--  F. item_conversions: one row per conversion (what it made). The row's
--     delete is refused, so "Undo this save" (Developer → Activity, 150/151)
--     can't take a conversion back by deleting its tasks — time_blocks.task_id
--     is ON DELETE CASCADE and that would take the original slots with them.
--     The conversion's own Undo (app_convert_undo) is the way back.
--
-- Safety (DB scenarios: scripts/verify-db-one-item.mjs): this migration
-- updates, inserts and deletes NO existing row, queues nothing in either
-- Google outbox (asserted at the end) and calls nothing outside the database.
-- It never clears or moves a Google Task id, an event or series id,
-- google_calendar_from, the horizon or the time zone. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- What the outboxes hold before this migration (asserted unchanged at the
-- end). Session settings, not a temp table: the deploy runs the file as one
-- transaction, the DB scenarios statement by statement.
do $$
declare
  v_cal bigint := 0;
  v_tasks bigint := 0;
begin
  if to_regclass('public.calendar_outbox') is not null then execute 'select count(*) from public.calendar_outbox' into v_cal; end if;
  if to_regclass('public.google_tasks_outbox') is not null then execute 'select count(*) from public.google_tasks_outbox' into v_tasks; end if;
  perform set_config('m155.calendar_rows', v_cal::text, false);
  perform set_config('m155.tasks_rows', v_tasks::text, false);
end $$;

-- ── A. Columns ──────────────────────────────────────────────────────────────
alter table public.tasks
  add column if not exists google_target text,
  add column if not exists deadline_date date,
  add column if not exists deadline_time time;
do $$ begin
  alter table public.tasks add constraint tasks_google_target_check
    check (google_target is null or google_target in ('tasks', 'calendar', 'both', 'none'));
exception when duplicate_object then null; end $$;
comment on column public.tasks.google_target is
  'Where the item lives on Google (155): tasks | calendar | both | none. NULL = a row saved before 155 — its presence is google_sync_enabled (Google Tasks) and its slot''s google_calendar_event_id (Calendar) until it is next saved.';
comment on column public.tasks.deadline_date is
  '"+ Deadline" (155): the day it is due by. The item''s own day stays in due_date (what every day read uses).';
comment on column public.tasks.deadline_time is
  'The deadline''s time (155), or NULL for the whole day.';

alter table public.time_blocks
  add column if not exists busy boolean not null default true;
comment on column public.time_blocks.busy is
  'false (155): "do it at 14:00" — no length, blocks no time (Google Calendar: Free, a nominal 15-minute end). A slot with no start_time is an all-day presence and is never busy.';

alter table public.schedule_blocks
  add column if not exists busy          boolean not null default true,
  add column if not exists google_target text,
  add column if not exists domain        text,
  add column if not exists priority      text,
  add column if not exists notes         text;
alter table public.schedule_blocks alter column start_time drop not null;
alter table public.schedule_blocks alter column end_time drop not null;
do $$ begin
  alter table public.schedule_blocks add constraint schedule_blocks_time_pair_check
    check ((start_time is null) = (end_time is null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.schedule_blocks add constraint schedule_blocks_google_target_check
    check (google_target is null or google_target in ('calendar', 'none'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.schedule_blocks add constraint schedule_blocks_domain_check
    check (domain is null or domain in ('personal', 'work', 'media'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.schedule_blocks add constraint schedule_blocks_priority_check
    check (priority is null or priority in ('low', 'medium', 'high'));
exception when duplicate_object then null; end $$;
comment on column public.schedule_blocks.start_time is
  'The repeat''s time; NULL (with end_time) since 155 = a repeat with no time (an all-day series on Google Calendar).';
comment on column public.schedule_blocks.busy is
  'false (155): a time with no length — blocks no time (Free on Google Calendar); end_time is then start + 15 minutes, nominal.';
comment on column public.schedule_blocks.google_target is
  'calendar | none (155); NULL = saved before 155 (on Google when google_calendar_event_id is set). Google Tasks can''t repeat through its API.';

-- ── B. Repeating plans get an Activity trail ───────────────────────────────
drop trigger if exists trg_audit on public.schedule_blocks;
create trigger trg_audit after insert or update or delete on public.schedule_blocks
  for each row execute function public.log_audit();

-- 151's list, plus the series' start day and zone: the state of the outside
-- copy, never put back nor compared (body otherwise unchanged).
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
              when 'schedule_blocks' then array['google_calendar_horizon', 'google_calendar_from', 'google_calendar_time_zone']::text[]
              when 'user_movie_entries' then array['trakt_note_text']::text[]
              when 'user_tv_entries' then array['trakt_note_text']::text[]
              else '{}'::text[]
            end
$$;

-- ── C. calendar_outbox: 'upsert' ─────────────────────────────────────────────
alter table public.calendar_outbox
  add column if not exists requested_at timestamptz not null default now();
alter table public.calendar_outbox drop constraint if exists calendar_outbox_operation_check;
alter table public.calendar_outbox add constraint calendar_outbox_operation_check
  check (operation in ('delete', 'upsert'));
comment on column public.calendar_outbox.requested_at is
  'When the newest request for this event was queued (155). The drain removes a row only while it still holds the value it read, so a request made during a run is never lost.';

-- 135's trigger, with the delete winning over a waiting upsert.
create or replace function public.enqueue_calendar_event_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.google_calendar_event_id is null or btrim(old.google_calendar_event_id) = '' then
    return null;
  end if;
  -- The account itself is being deleted: nothing could drain the row, and the
  -- queue's own foreign key to that user would abort the deletion.
  if not exists (select 1 from auth.users where id = old.user_id) then
    return null;
  end if;
  insert into public.calendar_outbox (user_id, calendar_id, event_id, operation, time_block_id, payload, requested_at)
  values (old.user_id, 'primary', old.google_calendar_event_id, 'delete', old.id,
          jsonb_build_object('title', old.title, 'date', old.date, 'start_time', old.start_time), clock_timestamp())
  on conflict (user_id, calendar_id, event_id) do update
    set operation = 'delete', time_block_id = excluded.time_block_id, payload = excluded.payload,
        attempts = 0, next_retry_at = now(), last_error = null, requested_at = excluded.requested_at
    where public.calendar_outbox.operation <> 'delete';
  return null;
end;
$$;

-- 147's trigger, the same way.
create or replace function public.enqueue_calendar_series_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.google_calendar_event_id is null or btrim(old.google_calendar_event_id) = '' then
    return null;
  end if;
  if not exists (select 1 from auth.users where id = old.user_id) then
    return null;
  end if;
  insert into public.calendar_outbox (user_id, calendar_id, event_id, operation, time_block_id, payload, requested_at)
  values (old.user_id, 'primary', old.google_calendar_event_id, 'delete', null,
          jsonb_build_object('series', true, 'schedule_block_id', old.id, 'title', old.title,
                             'effective_from', old.effective_from, 'start_time', old.start_time), clock_timestamp())
  on conflict (user_id, calendar_id, event_id) do update
    set operation = 'delete', time_block_id = null, payload = excluded.payload,
        attempts = 0, next_retry_at = now(), last_error = null, requested_at = excluded.requested_at
    where public.calendar_outbox.operation <> 'delete';
  return null;
end;
$$;

-- Queues an upsert of one event: a waiting upsert is asked again (requested_at
-- moves, retries reset); a waiting delete is left as it is.
create or replace function public.calendar_outbox_request_upsert(p_user uuid, p_event text, p_block uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event is null or btrim(p_event) = '' then return; end if;
  if not exists (select 1 from auth.users where id = p_user) then return; end if;
  insert into public.calendar_outbox (user_id, calendar_id, event_id, operation, time_block_id, payload, requested_at)
  values (p_user, 'primary', p_event, 'upsert', p_block, coalesce(p_payload, '{}'::jsonb), clock_timestamp())
  on conflict (user_id, calendar_id, event_id) do update
    set requested_at = excluded.requested_at, next_retry_at = now(), attempts = 0, last_error = null, payload = excluded.payload
    where public.calendar_outbox.operation = 'upsert';
end;
$$;
revoke all on function public.calendar_outbox_request_upsert(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- A linked slot's title, day, time, length or Busy/Free changed. A link
-- change (made or cleared) is the browser's own Calendar call, and a change
-- the read-back applies came FROM Google: neither is queued.
create or replace function public.enqueue_calendar_event_upsert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.calendar_readback', true), '') = 'on' then return null; end if;
  if new.google_calendar_event_id is null or new.google_calendar_event_id is distinct from old.google_calendar_event_id then
    return null;
  end if;
  if (new.title, new.date, new.start_time, new.duration_minutes, new.busy)
     is not distinct from (old.title, old.date, old.start_time, old.duration_minutes, old.busy) then
    return null;
  end if;
  perform public.calendar_outbox_request_upsert(new.user_id, new.google_calendar_event_id, new.id,
    jsonb_build_object('title', new.title, 'date', new.date, 'start_time', new.start_time));
  return null;
end;
$$;
drop trigger if exists trg_enqueue_calendar_event_upsert on public.time_blocks;
create trigger trg_enqueue_calendar_event_upsert
  after update on public.time_blocks
  for each row execute function public.enqueue_calendar_event_upsert();

-- A task ticked done or reopened: its slot's event gains or loses "✓ ".
create or replace function public.enqueue_calendar_done_mark()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  if coalesce(current_setting('app.calendar_readback', true), '') = 'on' then return null; end if;
  if (new.status = 'done') = (old.status = 'done') then return null; end if;
  for b in select id, user_id, title, date, google_calendar_event_id from public.time_blocks
            where task_id = new.id and google_calendar_event_id is not null loop
    perform public.calendar_outbox_request_upsert(b.user_id, b.google_calendar_event_id, b.id,
      jsonb_build_object('title', b.title, 'date', b.date, 'done', new.status = 'done'));
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_enqueue_calendar_done_mark on public.tasks;
create trigger trg_enqueue_calendar_done_mark
  after update of status on public.tasks
  for each row execute function public.enqueue_calendar_done_mark();

-- A linked repeating plan renamed on the server: its series' title follows
-- (the rule itself is pushed only by the app — calendar/calendarSeries.ts).
create or replace function public.enqueue_calendar_series_upsert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.calendar_readback', true), '') = 'on' then return null; end if;
  if new.google_calendar_event_id is null or new.google_calendar_event_id is distinct from old.google_calendar_event_id then
    return null;
  end if;
  if new.title is not distinct from old.title then return null; end if;
  perform public.calendar_outbox_request_upsert(new.user_id, new.google_calendar_event_id, null,
    jsonb_build_object('series', true, 'schedule_block_id', new.id, 'title', new.title));
  return null;
end;
$$;
drop trigger if exists trg_enqueue_calendar_series_upsert on public.schedule_blocks;
create trigger trg_enqueue_calendar_series_upsert
  after update of title on public.schedule_blocks
  for each row execute function public.enqueue_calendar_series_upsert();

-- ── D. The Calendar read-back's state ───────────────────────────────────────
-- Bookkeeping of a sync (one row per account, written only by the service
-- role): no trg_audit, not in ai-proxy's DB_CATALOG. The browser may read the
-- run's outcome but not the token itself (column grants).
create table if not exists public.google_calendar_sync_state (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  sync_token    text,
  last_run_at   timestamptz,
  last_clean_at timestamptz,
  last_error    text,
  last_error_at timestamptz,
  last_applied  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.google_calendar_sync_state enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'google_calendar_sync_state'
                 and policyname = 'Users read own calendar sync state') then
    create policy "Users read own calendar sync state" on public.google_calendar_sync_state
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.google_calendar_sync_state from anon, authenticated;
grant select (user_id, last_run_at, last_clean_at, last_error, last_error_at, last_applied, updated_at)
  on public.google_calendar_sync_state to authenticated;
drop trigger if exists trg_google_calendar_sync_state_updated_at on public.google_calendar_sync_state;
create trigger trg_google_calendar_sync_state_updated_at
  before update on public.google_calendar_sync_state
  for each row execute function public.update_updated_at();
comment on table public.google_calendar_sync_state is
  'Google Calendar read-back (155): the primary calendar''s sync token and the last run. Written by google-tasks-sync (service role) only; the Google card reads the run''s outcome.';

-- ── F. item_conversions ─────────────────────────────────────────────────────
create table if not exists public.item_conversions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_ids   uuid[] not null default '{}',
  block_ids  uuid[] not null default '{}',
  undone_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.item_conversions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'item_conversions'
                 and policyname = 'Users manage own item conversions') then
    create policy "Users manage own item conversions" on public.item_conversions for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
-- delete is granted (Supabase grants it by default anyway) so a delete reaches the
-- trigger below and is refused with its own message.
grant select, insert, update, delete on public.item_conversions to authenticated;
create index if not exists item_conversions_user_created_idx on public.item_conversions (user_id, created_at);
drop trigger if exists trg_item_conversions_updated_at on public.item_conversions;
create trigger trg_item_conversions_updated_at
  before update on public.item_conversions
  for each row execute function public.update_updated_at();
drop trigger if exists trg_audit on public.item_conversions;
create trigger trg_audit after insert or update or delete on public.item_conversions
  for each row execute function public.log_audit();
comment on table public.item_conversions is
  'One row per "Convert old items" (155): the tasks it made and the slots it linked. Never deleted (the account aside): that refusal is what stops Developer → Activity''s "Undo this save" from deleting the tasks — and, through time_blocks.task_id ON DELETE CASCADE, the original slots. app_convert_undo is the way back.';

create or replace function public.item_conversions_keep()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The account is being deleted (auth.users → this table cascade).
  if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  raise exception 'This save converted old items into items — take it back with the conversion''s own Undo (Settings → Subscriptions → Google), which keeps the original slots'
    using errcode = 'IT020';
end;
$$;
drop trigger if exists trg_item_conversions_keep on public.item_conversions;
create trigger trg_item_conversions_keep
  before delete on public.item_conversions
  for each row execute function public.item_conversions_keep();

-- ── E. The item RPCs ────────────────────────────────────────────────────────

-- taskRules.sectionForDay, in SQL: today → today, another day → backlog,
-- no day → inbox (itemRules.sectionForItem says the same).
create or replace function public.item_section_for_day(p_day date, p_today date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_day is null then 'inbox' when p_day = p_today then 'today' else 'backlog' end
$$;

-- planModal.config.defaultScheduleCategory, in SQL.
create or replace function public.item_default_category(p_domain text, p_task_source text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_task_source = 'training_session' then 'training'
    when p_task_source = 'project_item' then 'projects'
    when p_task_source in ('movie', 'tv_series') then 'media'
    when p_domain = 'work' then 'work'
    when p_domain = 'media' then 'media'
    else 'other'
  end
$$;

-- The two source vocabularies (077): tasks say tv_series, slots tv_episode.
create or replace function public.item_task_source(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type is null then 'manual'
    when p_type = 'tv_episode' then 'tv_series'
    when p_type in ('manual', 'movie', 'tv_series', 'media', 'calendar', 'ai', 'training_session', 'project_item') then p_type
    else 'manual'
  end
$$;
create or replace function public.item_block_source(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_type in ('training_session', 'movie', 'tv_episode', 'project_item', 'calendar', 'manual') then p_type end
$$;

-- A repeat's length in minutes (end before start = it crosses midnight).
create or replace function public.item_plan_minutes(p_start time, p_end time)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_start is null or p_end is null then 60
    else (case when m <= 0 then m + 1440 else m end)
  end
  from (select (extract(epoch from (p_end - p_start)) / 60)::integer as m) x
$$;

/*
 * One day of a repeating item as an item of its own (142, for every repeat):
 * its slot (marked with the plan and the day — the database adds the day to
 * except_dates) and its task. The plan row is locked first and the unique
 * occurrence index (142) refuses a second slot for the day, so a double tap
 * or a second tab gets the same rows. Answers the slot, the task and whether
 * this call made them.
 */
create or replace function public.item_occurrence(p_plan uuid, p_date date, p_today date, p_user uuid default null)
returns table(block_id uuid, task_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user  uuid := coalesce(p_user, auth.uid());
  p       public.schedule_blocks%rowtype;
  v_block uuid;
  v_task  uuid;
  v_found boolean;
begin
  if v_user is null or p_plan is null or p_date is null then
    raise exception 'item_occurrence: a repeating item and a day are needed' using errcode = 'IT010';
  end if;
  select * into p from public.schedule_blocks s where s.id = p_plan and s.user_id = v_user for update;
  if not found then
    raise exception 'item_occurrence: the repeating item is not there (deleted?)' using errcode = 'IT010';
  end if;

  select b.id, b.task_id into v_block, v_task
    from public.time_blocks b where b.schedule_block_id = p_plan and b.occurrence_date = p_date;
  v_found := v_block is not null;
  if v_task is not null then
    return query select v_block, v_task, false;
    return;
  end if;

  if not v_found then
    insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, busy, color, category,
                                    source_type, schedule_block_id, occurrence_date)
    values (v_user, p_date, p.title, p.start_time,
            case when p.start_time is null then 60 else least(1440, greatest(1, public.item_plan_minutes(p.start_time, p.end_time))) end,
            p.start_time is not null and p.busy, 'accent', p.category,
            case when p.category = 'training' then 'training_session' end, p_plan, p_date)
    on conflict (schedule_block_id, occurrence_date) where schedule_block_id is not null and occurrence_date is not null do nothing
    returning id into v_block;
    if v_block is null then
      select b.id, b.task_id into v_block, v_task
        from public.time_blocks b where b.schedule_block_id = p_plan and b.occurrence_date = p_date;
      if v_task is not null then
        return query select v_block, v_task, false;
        return;
      end if;
    end if;
  end if;

  insert into public.tasks (user_id, title, description, domain, section, status, priority, due_date, due_time,
                           source_type, google_sync_enabled, google_target)
  values (v_user, p.title, p.notes,
          coalesce(p.domain, case p.category when 'work' then 'work' when 'media' then 'media' else 'personal' end),
          public.item_section_for_day(p_date, p_today), 'open', coalesce(p.priority, 'medium'), p_date, p.start_time,
          case when p.category = 'training' then 'training_session' else 'manual' end, false,
          case when p.google_calendar_event_id is not null then 'calendar' else 'none' end)
  returning id into v_task;
  update public.time_blocks set task_id = v_task where id = v_block;
  return query select v_block, v_task, true;
end;
$$;

/*
 * THE item save. One transaction, so one Activity entry and one Undo.
 * p_item is itemTypes.ItemInput (camelCase) plus `section` (itemRules.
 * sectionForItem), `today` (the device's day) and `googleConnected`.
 *
 *   repeat, scope item/all  → the rule (schedule_blocks); a one-off item
 *                             given a repeat becomes the rule (its task and
 *                             slot go, their Google copies through the
 *                             outboxes)
 *   repeat, scope day       → that day becomes an item of its own (142) and
 *                             takes the edit
 *   no repeat               → the task, and its slot when it has a time or
 *                             shows on Google Calendar on a day; a rule given
 *                             "no repeat" becomes a one-off item
 *
 * Google (the RPC writes rows only; the browser makes the Calendar calls
 * after it — calendar/api/itemCalendar.ts):
 *   - Google Tasks on: google_sync_enabled → true (the outbox creates it).
 *   - Moving to Calendar only: google_sync_enabled stays as it is — the
 *     browser turns it off once Calendar answered 'linked' (create the new
 *     copy, confirm it, then remove the old one).
 *   - "Not on Google": google_sync_enabled → false.
 *   - A slot that is no longer wanted but still has an event is kept and
 *     named in `blockToDrop`: the browser removes the event first, then the
 *     slot (app_item_drop_block).
 */
create or replace function public.app_save_item(p_item jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_title     text := btrim(coalesce(p_item ->> 'title', ''));
  v_notes     text := nullif(btrim(coalesce(p_item ->> 'notes', '')), '');
  v_domain    text := coalesce(nullif(p_item ->> 'domain', ''), 'personal');
  v_priority  text := coalesce(nullif(p_item ->> 'priority', ''), 'medium');
  v_date      date := nullif(p_item ->> 'date', '')::date;
  v_time      time := nullif(p_item ->> 'time', '')::time;
  v_minutes   integer := nullif(p_item ->> 'durationMinutes', '')::integer;
  v_dl_date   date := nullif(p_item #>> '{deadline,date}', '')::date;
  v_dl_time   time := nullif(p_item #>> '{deadline,time}', '')::time;
  v_repeat    jsonb := case when jsonb_typeof(p_item -> 'repeat') = 'object' then p_item -> 'repeat' end;
  v_google    text := coalesce(nullif(p_item ->> 'google', ''), 'none');
  v_connected boolean := coalesce((p_item ->> 'googleConnected')::boolean, true);
  v_today     date := coalesce(nullif(p_item ->> 'today', '')::date, (now() at time zone 'Europe/Oslo')::date);
  v_section   text := nullif(p_item ->> 'section', '');
  v_scope     text := coalesce(nullif(p_item ->> 'scope', ''), 'item');
  v_task_id   uuid := nullif(p_item ->> 'taskId', '')::uuid;
  v_block_id  uuid := nullif(p_item ->> 'blockId', '')::uuid;
  v_plan_id   uuid := nullif(p_item ->> 'scheduleBlockId', '')::uuid;
  v_occ       date := nullif(p_item ->> 'occurrenceDate', '')::date;
  v_list_raw  text := nullif(p_item ->> 'googleTaskList', '');
  v_src_type  text := nullif(p_item #>> '{source,type}', '');
  v_src_raw   text := nullif(p_item #>> '{source,id}', '');
  v_uuid_re   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_list      uuid;
  v_src_id    uuid;
  t           public.tasks%rowtype;
  b           public.time_blocks%rowtype;
  p           public.schedule_blocks%rowtype;
  v_created   boolean := false;
  v_sync_was  boolean := false;
  v_sync      boolean;
  v_want_blk  boolean;
  v_busy      boolean;
  v_drop      uuid;
  v_replaced_task uuid;
  v_replaced_plan uuid;
  v_replaced_event text;
  v_kind      text;
  v_days      integer[];
  v_interval  integer;
  v_unit      text;
  v_dates     date[];
  v_starts    date;
  v_end       time;
  v_category  text;
  v_task_src  text;
  v_is_occ    boolean := false;
begin
  v_created := v_task_id is null and v_block_id is null and v_plan_id is null;
  if v_user is null then
    raise exception 'app_save_item: not signed in' using errcode = '28000';
  end if;
  if v_title = '' then
    raise exception 'A title is needed' using errcode = 'IT001';
  end if;
  if v_domain not in ('personal', 'work', 'media') or v_priority not in ('low', 'medium', 'high')
     or v_google not in ('tasks', 'calendar', 'both', 'none') or v_scope not in ('item', 'day', 'all') then
    raise exception 'app_save_item: unknown domain, priority, Google target or scope' using errcode = '22023';
  end if;
  if v_list_raw ~ v_uuid_re then v_list := v_list_raw::uuid; end if;
  if v_src_raw ~ v_uuid_re then v_src_id := v_src_raw::uuid; end if;
  if v_time is null then v_minutes := null; end if;
  if v_minutes is not null and (v_minutes < 1 or v_minutes > 1440) then
    raise exception 'A length is 1 minute to 24 hours' using errcode = 'IT005';
  end if;
  if v_section is not null and v_section not in ('inbox', 'today', 'backlog') then v_section := null; end if;

  -- ── A repeating item's rule ────────────────────────────────────────────
  if v_repeat is not null and v_scope <> 'day' then
    if v_google in ('tasks', 'both') then
      raise exception 'Google Tasks can''t repeat: a repeating item goes to Google Calendar or stays off Google' using errcode = 'IT002';
    end if;
    v_kind := coalesce(nullif(v_repeat ->> 'kind', ''), 'weekly');
    v_days := coalesce(array(select distinct x::integer from jsonb_array_elements_text(coalesce(v_repeat -> 'daysOfWeek', '[]'::jsonb)) x order by 1), '{}');
    v_interval := nullif(v_repeat ->> 'interval', '')::integer;
    v_unit := nullif(v_repeat ->> 'unit', '');
    v_dates := coalesce(array(select distinct x::date from jsonb_array_elements_text(coalesce(v_repeat -> 'dates', '[]'::jsonb)) x order by 1), '{}');
    v_starts := coalesce(nullif(v_repeat ->> 'startsOn', '')::date, v_date, v_today);
    -- One shape per meaning (planModal.config.repeatRowFromForm).
    if v_kind = 'interval' and coalesce(v_interval, 1) = 1 then
      if v_unit = 'week' then v_kind := 'weekly';
      elsif v_unit = 'month' then v_kind := 'monthly';
      elsif v_unit = 'day' then v_kind := 'weekly'; v_days := array[0, 1, 2, 3, 4, 5, 6];
      end if;
    end if;
    if v_kind = 'weekly' then
      if cardinality(v_days) = 0 then raise exception 'Pick at least one day' using errcode = 'IT006'; end if;
      v_interval := null; v_unit := null; v_dates := null;
    elsif v_kind = 'monthly' then
      v_days := v_days[1:1]; v_interval := null; v_unit := null; v_dates := null;
    elsif v_kind = 'interval' then
      v_dates := null;
      if v_unit = 'day' then v_days := '{}';
      elsif v_unit = 'month' then v_days := v_days[1:1];
      end if;
    elsif v_kind = 'dates' then
      if cardinality(v_dates) = 0 then raise exception 'Pick at least one date' using errcode = 'IT006'; end if;
      v_days := '{}'; v_interval := null; v_unit := null;
      v_starts := least(v_starts, v_dates[1]);
    else
      raise exception 'app_save_item: unknown repeat kind' using errcode = '22023';
    end if;
    v_end := case when v_time is null then null else (v_time + make_interval(mins => coalesce(v_minutes, 15)))::time end;
    v_busy := v_time is not null and v_minutes is not null;

    if v_plan_id is not null then
      select * into p from public.schedule_blocks s where s.id = v_plan_id and s.user_id = v_user for update;
      if not found then raise exception 'This repeating item is not there any more' using errcode = 'IT004'; end if;
      update public.schedule_blocks set
        title = v_title, notes = v_notes, domain = v_domain, priority = v_priority,
        days_of_week = v_days, repeat_kind = v_kind, repeat_interval = v_interval, repeat_unit = v_unit, repeat_dates = v_dates,
        effective_from = v_starts, start_time = v_time, end_time = v_end, busy = v_busy,
        google_target = v_google, updated_at = now()
      where id = v_plan_id;
    else
      v_task_src := public.item_task_source(v_src_type);
      v_category := public.item_default_category(v_domain, v_task_src);
      -- A one-off item turned into a repeat: its slot's category stays.
      if v_task_id is not null then
        select * into b from public.time_blocks x where x.task_id = v_task_id and x.user_id = v_user;
        if found then v_category := b.category; end if;
      end if;
      insert into public.schedule_blocks (user_id, title, notes, domain, priority, days_of_week, repeat_kind, repeat_interval,
                                          repeat_unit, repeat_dates, effective_from, start_time, end_time, busy, color, category,
                                          google_target)
      values (v_user, v_title, v_notes, v_domain, v_priority, v_days, v_kind, v_interval, v_unit, v_dates, v_starts,
              v_time, v_end, v_busy, 'blue', v_category, v_google)
      returning id into v_plan_id;
      if v_task_id is not null then
        -- The one-off it was: its slot goes with it (ON DELETE CASCADE), and the
        -- outboxes queue its Google Task and event for removal (the browser
        -- removes the event right away too: replacedEventId).
        select x.google_calendar_event_id into v_replaced_event from public.time_blocks x where x.task_id = v_task_id;
        delete from public.tasks where id = v_task_id and user_id = v_user;
        if found then v_replaced_task := v_task_id; else v_replaced_event := null; end if;
      end if;
    end if;
    return jsonb_build_object('taskId', null, 'blockId', null, 'scheduleBlockId', v_plan_id, 'created', v_created,
                              'replacedTaskId', v_replaced_task, 'replacedEventId', v_replaced_event, 'occurrence', false);
  end if;

  -- ── One day of a repeating item ─────────────────────────────────────────
  if v_scope = 'day' then
    if v_plan_id is null or v_occ is null then
      raise exception 'app_save_item: a day of a repeat needs scheduleBlockId and occurrenceDate' using errcode = '22023';
    end if;
    select o.block_id, o.task_id into v_block_id, v_task_id
      from public.item_occurrence(v_plan_id, v_occ, v_today, v_user) o;
    v_is_occ := true;
    v_created := false;
    if v_google in ('tasks', 'both') then v_google := 'calendar'; end if;
  end if;

  -- ── A one-off item (or that day) ────────────────────────────────────────
  if v_time is not null and v_date is null then
    raise exception 'A time needs a day' using errcode = 'IT003';
  end if;
  if v_google in ('calendar', 'both') and v_date is null then
    raise exception 'Google Calendar needs a day: pick one, or choose Google Tasks' using errcode = 'IT003';
  end if;

  -- A repeating item given "no repeat" (scope 'all' only — never by
  -- leaving the repeat out of a day's or an item's save) becomes a one-off
  -- item: the rule goes (its series through the calendar outbox); days
  -- already split off stay.
  if v_repeat is null and v_plan_id is not null and v_scope = 'all' and not v_is_occ then
    select s.google_calendar_event_id into v_replaced_event from public.schedule_blocks s where s.id = v_plan_id and s.user_id = v_user;
    delete from public.schedule_blocks where id = v_plan_id and user_id = v_user;
    if found then v_replaced_plan := v_plan_id; else v_replaced_event := null; end if;
    v_plan_id := null;
  end if;

  if v_task_id is null and v_block_id is not null then
    -- An old standalone slot opened in the sheet: it gets its task now.
    select * into b from public.time_blocks x where x.id = v_block_id and x.user_id = v_user for update;
    if not found then raise exception 'This item is not there any more' using errcode = 'IT004'; end if;
    v_task_id := b.task_id;
    if v_src_type is null then v_src_type := b.source_type; v_src_id := coalesce(v_src_id, b.source_id); end if;
  end if;

  if v_task_id is null then
    v_sync := v_connected and v_google in ('tasks', 'both');
    v_task_src := public.item_task_source(v_src_type);
    insert into public.tasks (user_id, title, description, domain, section, status, priority, due_date, due_time,
                             deadline_date, deadline_time, source_type, source_id, google_target, google_sync_enabled,
                             google_tasklist_id)
    values (v_user, v_title, v_notes, v_domain, coalesce(v_section, public.item_section_for_day(v_date, v_today)), 'open',
            v_priority, coalesce(v_date, v_dl_date), case when v_date is not null then v_time else v_dl_time end,
            v_dl_date, v_dl_time, v_task_src, v_src_id, v_google, v_sync, v_list)
    returning * into t;
    v_task_id := t.id;
  else
    select * into t from public.tasks x where x.id = v_task_id and x.user_id = v_user for update;
    if not found then raise exception 'This item is not there any more' using errcode = 'IT004'; end if;
    v_sync_was := t.google_sync_enabled;
    v_sync := case
      when v_google in ('tasks', 'both') then v_connected or t.google_sync_enabled
      when v_google = 'calendar' then t.google_sync_enabled
      else false
    end;
    update public.tasks set
      title = v_title, description = v_notes, domain = v_domain, priority = v_priority,
      section = coalesce(v_section,
                         case when v_date is not null then public.item_section_for_day(v_date, v_today)
                              when t.section in ('inbox', 'today', 'backlog') then t.section
                              else 'backlog' end),
      due_date = coalesce(v_date, v_dl_date),
      due_time = case when v_date is not null then v_time else v_dl_time end,
      deadline_date = v_dl_date, deadline_time = v_dl_time,
      google_target = v_google, google_sync_enabled = v_sync,
      google_tasklist_id = coalesce(v_list, t.google_tasklist_id),
      source_type = case when v_src_type is not null then public.item_task_source(v_src_type) else t.source_type end,
      source_id = case when v_src_type is not null then v_src_id else t.source_id end
    where id = v_task_id
    returning * into t;
  end if;

  -- The slot: wanted for a time, or for a day on Google Calendar.
  v_want_blk := v_time is not null or (v_date is not null and v_google in ('calendar', 'both'));
  v_busy := v_time is not null and v_minutes is not null;
  if v_block_id is not null then
    select * into b from public.time_blocks x where x.id = v_block_id and x.user_id = v_user for update;
    if not found then v_block_id := null; end if;
  end if;
  if v_block_id is null then
    select * into b from public.time_blocks x where x.task_id = v_task_id and x.user_id = v_user for update;
    if found then v_block_id := b.id; end if;
  end if;

  if v_want_blk then
    if v_block_id is not null then
      update public.time_blocks set
        date = v_date, start_time = v_time,
        duration_minutes = case when v_time is null then b.duration_minutes else coalesce(v_minutes, 15) end,
        busy = v_busy, title = v_title, task_id = v_task_id, updated_at = now()
      where id = v_block_id;
    else
      insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, busy, color, category, task_id,
                                      source_type, source_id)
      values (v_user, v_date, v_title, v_time, case when v_time is null then 60 else coalesce(v_minutes, 15) end, v_busy,
              'accent', public.item_default_category(v_domain, t.source_type), v_task_id,
              public.item_block_source(coalesce(v_src_type, t.source_type)), coalesce(v_src_id, t.source_id))
      returning id into v_block_id;
    end if;
  elsif v_block_id is not null then
    if b.google_calendar_event_id is not null then
      -- Its event goes first (the browser), then the slot.
      v_drop := v_block_id;
    else
      -- A day split off a repeat keeps its day out of the repeat (142).
      delete from public.time_blocks where id = v_block_id;
      v_block_id := null;
    end if;
  end if;

  return jsonb_build_object(
    'taskId', v_task_id, 'blockId', v_block_id, 'scheduleBlockId', case when v_is_occ then v_plan_id end,
    'created', v_created, 'occurrence', v_is_occ, 'occurrenceDate', case when v_is_occ then v_occ end,
    'blockToDrop', v_drop, 'replacedScheduleBlockId', v_replaced_plan, 'replacedEventId', v_replaced_event,
    'googleSyncWas', v_sync_was, 'googleSync', t.google_sync_enabled);
end;
$$;

/*
 * The slot an item no longer needs, once the browser removed its event
 * (blockToDrop above): deleted only while it has no event and its task still
 * doesn't want it (no time, not on Google Calendar). Answers true when it went.
 */
create or replace function public.app_item_drop_block(p_block uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  delete from public.time_blocks b
   using public.tasks t
   where b.id = p_block and b.user_id = v_user and t.id = b.task_id
     and b.google_calendar_event_id is null and b.start_time is null
     and coalesce(t.google_target, 'none') not in ('calendar', 'both');
  return found;
end;
$$;

/*
 * One day of ANY repeating item (142, generalised): 'done' / 'skip' make that
 * day an item of its own (once — a double tap gets the same rows) and close
 * it; 'undo' opens it again (the day stays an item of its own, as 142's
 * Training undo does). 'remove' takes the day out of the repeat ("delete only
 * this day" when nothing was split off yet) and 'restore' puts it back. A
 * missed day is never carried over: nothing here moves a day.
 */
create or replace function public.app_repeat_day(p_plan uuid, p_date date, p_action text, p_today date default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_today   date := coalesce(p_today, (now() at time zone 'Europe/Oslo')::date);
  v_block   uuid;
  v_task    uuid;
  v_created boolean := false;
  v_status  text;
  v_prev    text;
  v_event   text;
  v_series  text;
  v_changed boolean := false;
begin
  if v_user is null then raise exception 'app_repeat_day: not signed in' using errcode = '28000'; end if;
  if p_action not in ('done', 'skip', 'undo', 'remove', 'restore') then
    raise exception 'app_repeat_day: unknown action %', p_action using errcode = '22023';
  end if;
  select google_calendar_event_id into v_series from public.schedule_blocks where id = p_plan and user_id = v_user for update;
  if not found then raise exception 'This repeating item is not there any more' using errcode = 'IT004'; end if;

  if p_action in ('remove', 'restore') then
    if p_action = 'remove' then
      update public.schedule_blocks set except_dates = array_append(except_dates, p_date), updated_at = now()
       where id = p_plan and not (p_date = any (except_dates));
    else
      -- Only a day nothing was split off for (a split-off day is its own item).
      update public.schedule_blocks set except_dates = array_remove(except_dates, p_date), updated_at = now()
       where id = p_plan and p_date = any (except_dates)
         and not exists (select 1 from public.time_blocks b where b.schedule_block_id = p_plan and b.occurrence_date = p_date);
    end if;
    v_changed := found;
    return jsonb_build_object('scheduleBlockId', p_plan, 'date', p_date, 'action', p_action, 'changed', v_changed,
                              'seriesEventId', v_series);
  end if;

  if p_action = 'undo' then
    select b.id, b.task_id, b.google_calendar_event_id into v_block, v_task, v_event
      from public.time_blocks b where b.schedule_block_id = p_plan and b.occurrence_date = p_date;
    if v_task is null then
      return jsonb_build_object('scheduleBlockId', p_plan, 'date', p_date, 'action', p_action, 'changed', false);
    end if;
    select status into v_prev from public.tasks where id = v_task for update;
    if v_prev in ('done', 'cancelled') then
      update public.tasks set status = 'open' where id = v_task;
      v_changed := true;
    end if;
    return jsonb_build_object('scheduleBlockId', p_plan, 'date', p_date, 'action', p_action, 'changed', v_changed,
                              'taskId', v_task, 'blockId', v_block, 'previousStatus', v_prev, 'blockEventId', v_event,
                              'seriesEventId', v_series);
  end if;

  select o.block_id, o.task_id, o.created into v_block, v_task, v_created
    from public.item_occurrence(p_plan, p_date, v_today, v_user) o;
  v_status := case p_action when 'done' then 'done' else 'cancelled' end;
  select status into v_prev from public.tasks where id = v_task for update;
  if v_prev is distinct from v_status then
    update public.tasks set status = v_status where id = v_task;
    v_changed := true;
  end if;
  select google_calendar_event_id into v_event from public.time_blocks where id = v_block;
  return jsonb_build_object('scheduleBlockId', p_plan, 'date', p_date, 'action', p_action, 'changed', v_changed,
                            'created', v_created, 'taskId', v_task, 'blockId', v_block, 'previousStatus', v_prev,
                            'blockEventId', v_event, 'seriesEventId', v_series);
end;
$$;

-- Old standalone slots that "Convert old items" would turn into items. A
-- planned episode (season + episode set) is left out: watching it removes its
-- slot (043/149), which would leave its new task behind, open.
create or replace function public.item_convert_candidates(p_today date)
returns setof public.time_blocks
language sql
stable
security invoker
set search_path = public
as $$
  select b.* from public.time_blocks b
   where b.user_id = (select auth.uid()) and b.task_id is null and b.date >= p_today
     and not (b.source_type = 'tv_episode' and b.season_number is not null and b.episode_number is not null)
   order by b.date, b.start_time nulls first, b.id
$$;

create or replace function public.app_convert_preview(p_today date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Oslo')::date);
begin
  if v_user is null then raise exception 'app_convert_preview: not signed in' using errcode = '28000'; end if;
  return jsonb_build_object(
    'futureStandaloneBlocks', (select count(*) from public.item_convert_candidates(v_today)),
    'pastStandaloneBlocks', (select count(*) from public.time_blocks b where b.user_id = v_user and b.task_id is null and b.date < v_today),
    'autoClearedEpisodes', (select count(*) from public.time_blocks b where b.user_id = v_user and b.task_id is null and b.date >= v_today
                              and b.source_type = 'tv_episode' and b.season_number is not null and b.episode_number is not null),
    'plans', (select count(*) from public.schedule_blocks s where s.user_id = v_user),
    'tasksWithSlots', (select count(*) from public.tasks t where t.user_id = v_user
                         and exists (select 1 from public.time_blocks b where b.task_id = t.id)),
    'examples', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'date', c.date) order by c.date, c.start_time nulls first, c.id)
                          from (select * from public.item_convert_candidates(v_today) limit 5) c), '[]'::jsonb)
  );
end;
$$;

/*
 * "Convert old items": every FUTURE standalone slot gets a task of its own
 * (the slot keeps its id, day, time and event — that event stays the item's
 * one Google entry: google_sync_enabled false, Google target 'calendar' when
 * it has an event, else 'none'), and the slot points at it. A past slot is
 * left alone (no made-up done or missed). Plans are repeating items already.
 * One item_conversions row records what was made (see F).
 */
create or replace function public.app_convert_apply(p_today date default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Oslo')::date);
  v_id    uuid := gen_random_uuid();
  b       record;
  v_task  uuid;
  v_tasks uuid[] := '{}';
  v_blocks uuid[] := '{}';
begin
  if v_user is null then raise exception 'app_convert_apply: not signed in' using errcode = '28000'; end if;
  -- The marker first: its row is what keeps Activity's Undo from taking the
  -- conversion back by deleting tasks.
  insert into public.item_conversions (id, user_id) values (v_id, v_user);
  for b in select x.* from public.time_blocks x
            where x.id in (select c.id from public.item_convert_candidates(v_today) c)
            order by x.date, x.start_time nulls first, x.id
            for update loop
    insert into public.tasks (user_id, title, description, domain, section, status, priority, due_date, due_time,
                             source_type, source_id, google_sync_enabled, google_target)
    values (v_user, coalesce(nullif(btrim(b.title), ''), 'Untitled'), b.notes,
            case b.category when 'work' then 'work' when 'media' then 'media' else 'personal' end,
            public.item_section_for_day(b.date, v_today), 'open', 'medium', b.date, b.start_time,
            public.item_task_source(b.source_type), b.source_id, false,
            case when b.google_calendar_event_id is not null then 'calendar' else 'none' end)
    returning id into v_task;
    update public.time_blocks set task_id = v_task where id = b.id and task_id is null;
    v_tasks := v_tasks || v_task;
    v_blocks := v_blocks || b.id;
  end loop;
  update public.item_conversions set task_ids = v_tasks, block_ids = v_blocks where id = v_id;
  return jsonb_build_object('conversionId', v_id, 'converted', cardinality(v_tasks));
end;
$$;

/*
 * The conversion's own Undo: for each task it made that is still open, the
 * slot is unlinked FIRST (so nothing cascades into it), then the task goes.
 * A task closed or moved off its slot since is kept (counted). Original slots
 * and their events are never touched.
 */
create or replace function public.app_convert_undo(p_conversion uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  c       public.item_conversions%rowtype;
  v_drop  uuid[];
  v_kept  integer;
begin
  if v_user is null then raise exception 'app_convert_undo: not signed in' using errcode = '28000'; end if;
  select * into c from public.item_conversions where id = p_conversion and user_id = v_user for update;
  if not found then raise exception 'That conversion is not there' using errcode = 'IT004'; end if;
  if c.undone_at is not null then
    return jsonb_build_object('undone', 0, 'kept', 0, 'already', true);
  end if;
  select coalesce(array_agg(t.id), '{}') into v_drop
    from public.tasks t
   where t.user_id = v_user and t.id = any (c.task_ids) and t.status in ('open', 'in_progress', 'waiting')
     and exists (select 1 from public.time_blocks b where b.task_id = t.id and b.id = any (c.block_ids));
  update public.time_blocks set task_id = null where task_id = any (v_drop) and id = any (c.block_ids);
  delete from public.tasks where id = any (v_drop) and user_id = v_user;
  v_kept := (select count(*) from public.tasks t where t.user_id = v_user and t.id = any (c.task_ids));
  update public.item_conversions set undone_at = now() where id = c.id;
  return jsonb_build_object('undone', cardinality(v_drop), 'kept', v_kept, 'already', false);
end;
$$;

/*
 * One change read back from Google Calendar (google-tasks-sync, service role
 * only). p_event is calendarEventRules.readbackEvent's shape: id, seriesId
 * (an instance's recurringEventId), status, title (without "✓ "), allDay,
 * date, time, minutes, busy, originalDate (an instance's day), updated.
 * Only events a slot or plan of this account stores are acted on:
 *   a slot's event   moved / renamed → the slot and its task follow (unless
 *                    the slot changed after it — the app's push wins);
 *                    deleted → the link goes, the item stays (its Calendar
 *                    presence turns off; an all-day presence slot goes)
 *   a plan's series  renamed → the plan follows; deleted → the link goes
 *   an instance      moved → that day becomes an item of its own (142) on
 *                    the new day/time, holding the instance's id;
 *                    deleted → that day becomes an item of its own with no
 *                    event (never deleted or cancelled)
 * Answers what it did: unlinked | moved | renamed | same | stale | day_moved
 * | day_off | ignored | not_ours.
 */
create or replace function public.apply_calendar_readback(p_user uuid, p_event jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      text := nullif(p_event ->> 'id', '');
  v_series  text := nullif(p_event ->> 'seriesId', '');
  v_status  text := coalesce(nullif(p_event ->> 'status', ''), 'confirmed');
  v_title   text := nullif(btrim(coalesce(p_event ->> 'title', '')), '');
  v_allday  boolean := coalesce((p_event ->> 'allDay')::boolean, false);
  v_date    date := nullif(p_event ->> 'date', '')::date;
  v_time    time := nullif(p_event ->> 'time', '')::time;
  v_minutes integer := nullif(p_event ->> 'minutes', '')::integer;
  v_busy    boolean := coalesce((p_event ->> 'busy')::boolean, true);
  v_orig    date := nullif(p_event ->> 'originalDate', '')::date;
  v_updated timestamptz := nullif(p_event ->> 'updated', '')::timestamptz;
  v_today   date := (now() at time zone 'Europe/Oslo')::date;
  b         public.time_blocks%rowtype;
  t         public.tasks%rowtype;
  p         public.schedule_blocks%rowtype;
  v_block   uuid;
  v_task    uuid;
  v_moved   boolean := false;
  v_out     text;
begin
  if p_user is null or v_id is null then return 'ignored'; end if;
  -- What this applies came FROM Google: the upsert triggers don't send it back.
  perform set_config('app.calendar_readback', 'on', true);
  if v_allday then v_time := null; end if;
  if v_time is null then v_busy := false; end if;
  v_minutes := least(1440, greatest(1, coalesce(v_minutes, 60)));

  select * into b from public.time_blocks x
   where x.user_id = p_user and x.google_calendar_event_id = v_id
   order by x.updated_at desc nulls last limit 1 for update;
  if found then
    -- 1 · A slot holds this event (a one-off item, or a day of a plan).
    if b.task_id is not null then select * into t from public.tasks where id = b.task_id for update; end if;
    if v_status = 'cancelled' then
      update public.time_blocks set google_calendar_event_id = null, updated_at = now() where id = b.id;
      if b.task_id is not null then
        update public.tasks
           set google_target = case google_target when 'calendar' then 'none' when 'both' then 'tasks' else google_target end
         where id = b.task_id and google_target in ('calendar', 'both');
        -- A slot that only put the item's day on Google Calendar goes; the item stays.
        if b.start_time is null then delete from public.time_blocks where id = b.id; end if;
      end if;
      v_out := 'unlinked';
    elsif v_updated is not null and b.updated_at is not null and v_updated <= b.updated_at then
      v_out := 'stale';
    else
      if v_date is not null and ((b.date, b.start_time) is distinct from (v_date, v_time)
          or (v_time is not null and (b.duration_minutes, b.busy) is distinct from (v_minutes, v_busy))
          or (v_time is null and b.busy)) then
        update public.time_blocks set date = v_date, start_time = v_time,
               duration_minutes = case when v_time is null then duration_minutes else v_minutes end,
               busy = case when v_time is null then false else v_busy end, updated_at = now()
         where id = b.id;
        if b.task_id is not null then
          update public.tasks set due_date = v_date, due_time = v_time,
                 section = case when section in ('today', 'backlog') then public.item_section_for_day(v_date, v_today) else section end
           where id = b.task_id;
        end if;
        v_moved := true;
      end if;
      if v_title is not null and v_title is distinct from coalesce(t.title, b.title) then
        if b.task_id is not null then update public.tasks set title = v_title where id = b.task_id;
        else update public.time_blocks set title = v_title, updated_at = now() where id = b.id; end if;
        v_out := case when v_moved then 'moved' else 'renamed' end;
      else
        v_out := case when v_moved then 'moved' else 'same' end;
      end if;
    end if;
  else
    select * into p from public.schedule_blocks s where s.user_id = p_user and s.google_calendar_event_id = v_id for update;
    if found then
      -- 2 · A plan's series itself.
      if v_status = 'cancelled' then
        update public.schedule_blocks
           set google_calendar_event_id = null, google_calendar_horizon = null, google_calendar_from = null,
               google_target = case when google_target is not null then 'none' end, updated_at = now()
         where id = p.id;
        v_out := 'unlinked';
      elsif v_title is not null and v_title is distinct from p.title
            and (v_updated is null or p.updated_at is null or v_updated > p.updated_at) then
        update public.schedule_blocks set title = v_title, updated_at = now() where id = p.id;
        v_out := 'renamed';
      else
        v_out := 'same';
      end if;
    elsif v_series is null or v_orig is null then
      v_out := 'not_ours';
    else
      -- 3 · One day of a plan's series (an exception: moved or deleted there).
      select * into p from public.schedule_blocks s where s.user_id = p_user and s.google_calendar_event_id = v_series for update;
      if not found then
        v_out := 'not_ours';
      elsif v_orig = any (p.except_dates)
            or exists (select 1 from public.time_blocks x where x.schedule_block_id = p.id and x.occurrence_date = v_orig) then
        -- A day the app already took out (its own EXDATE, or split off) is the app's.
        v_out := 'ignored';
      else
        select o.block_id, o.task_id into v_block, v_task from public.item_occurrence(p.id, v_orig, v_today, p_user) o;
        if v_status = 'cancelled' then
          update public.tasks set google_target = 'none' where id = v_task;
          v_out := 'day_off';
        else
          update public.time_blocks
             set date = coalesce(v_date, date), start_time = case when v_allday then null else coalesce(v_time, start_time) end,
                 duration_minutes = case when v_time is null then duration_minutes else v_minutes end,
                 busy = case when v_allday then false when v_time is null then busy else v_busy end,
                 google_calendar_event_id = v_id, updated_at = now()
           where id = v_block;
          update public.tasks
             set due_date = coalesce(v_date, due_date), due_time = case when v_allday then null else coalesce(v_time, due_time) end,
                 title = coalesce(v_title, title), google_target = 'calendar',
                 section = public.item_section_for_day(coalesce(v_date, due_date), v_today)
           where id = v_task;
          v_out := 'day_moved';
        end if;
      end if;
    end if;
  end if;
  perform set_config('app.calendar_readback', 'off', true);
  return v_out;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.app_save_item(jsonb) from public, anon;
revoke all on function public.app_item_drop_block(uuid) from public, anon;
revoke all on function public.app_repeat_day(uuid, date, text, date) from public, anon;
revoke all on function public.item_occurrence(uuid, date, date, uuid) from public, anon;
revoke all on function public.item_convert_candidates(date) from public, anon;
revoke all on function public.app_convert_preview(date) from public, anon;
revoke all on function public.app_convert_apply(date) from public, anon;
revoke all on function public.app_convert_undo(uuid) from public, anon;
revoke all on function public.apply_calendar_readback(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_save_item(jsonb) to authenticated;
grant execute on function public.app_item_drop_block(uuid) to authenticated;
grant execute on function public.app_repeat_day(uuid, date, text, date) to authenticated;
grant execute on function public.item_occurrence(uuid, date, date, uuid) to authenticated;
grant execute on function public.item_convert_candidates(date) to authenticated;
grant execute on function public.app_convert_preview(date) to authenticated;
grant execute on function public.app_convert_apply(date) to authenticated;
grant execute on function public.app_convert_undo(uuid) to authenticated;
grant execute on function public.item_section_for_day(date, date) to authenticated;
grant execute on function public.item_default_category(text, text) to authenticated;
grant execute on function public.item_task_source(text) to authenticated;
grant execute on function public.item_block_source(text) to authenticated;
grant execute on function public.item_plan_minutes(time, time) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.apply_calendar_readback(uuid, jsonb) to service_role';
    execute 'grant execute on function public.item_occurrence(uuid, date, date, uuid) to service_role';
  end if;
end $$;

comment on function public.app_save_item(jsonb) is
  'THE item save (155): one transaction for a task, its slot and its repeat rule. Input: itemTypes.ItemInput + section, today, googleConnected. Writes rows only — the browser makes the Google Calendar calls after it.';
comment on function public.app_repeat_day(uuid, date, text, date) is
  'One day of any repeating item (155, generalising 142): done | skip | undo | remove | restore.';
comment on function public.apply_calendar_readback(uuid, jsonb) is
  'One change read back from Google Calendar (155), service role only (google-tasks-sync).';

-- ── Owner lock (139) for the new tables ────────────────────────────────────
select public.owner_lock_apply('public.google_calendar_sync_state');
select public.owner_lock_apply('public.item_conversions');

-- ── Assertions ──────────────────────────────────────────────────────────────
do $$
declare
  v_cal bigint := 0;
  v_tasks bigint := 0;
begin
  if to_regclass('public.calendar_outbox') is not null then execute 'select count(*) from public.calendar_outbox' into v_cal; end if;
  if to_regclass('public.google_tasks_outbox') is not null then execute 'select count(*) from public.google_tasks_outbox' into v_tasks; end if;
  if v_cal::text <> current_setting('m155.calendar_rows') or v_tasks::text <> current_setting('m155.tasks_rows') then
    raise exception 'Migration 155 assertion failed: it queued Google work (calendar_outbox % → %, google_tasks_outbox % → %)',
      current_setting('m155.calendar_rows'), v_cal, current_setting('m155.tasks_rows'), v_tasks;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'time_blocks' and column_name = 'busy') then
    raise exception 'Migration 155 assertion failed: time_blocks.busy is missing';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'schedule_blocks'
             and column_name = 'start_time' and is_nullable = 'NO') then
    raise exception 'Migration 155 assertion failed: schedule_blocks.start_time is still NOT NULL';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit' and tgrelid = 'public.schedule_blocks'::regclass) then
    raise exception 'Migration 155 assertion failed: schedule_blocks has no trg_audit';
  end if;
  if not exists (select 1 from pg_proc where proname = 'app_save_item') then
    raise exception 'Migration 155 assertion failed: app_save_item is missing';
  end if;
end $$;
