-- ═══════════════════════════════════════════════════════════════════════════
-- 175 — Calendar 2b-2: the switch per area (docs/features/calendar-plan.md).
-- Settings → Calendar can now put an area's events in Apple Calendar instead
-- of Google Calendar. The rule both ways is the owner's: the new copy first,
-- confirmed, then the old one goes — never the same event in both.
--
--   A. The queue learns the moments a move can finish: a Google Calendar
--      copy made for an item that still has its Apple copy (moving back to
--      Google), and a Google Task made or turned off for an item whose Apple
--      copy waits for it (moving to Google Tasks); a repeat waits for its
--      day's Google Task.
--   B. icloud_hand_over: once an item's Apple copy is in, its Google Calendar
--      copy is queued for deletion (calendar_outbox, drained by
--      google-tasks-sync) and the link cleared — in one step, and only for an
--      event id the app builds from the item's own id (calendarApi
--      .blockEventId), never another event in the calendar (the warning in
--      AGENTS.md: a delete's target is built from server-only data).
--   C. Where an item IS on a calendar counts Apple too: a repeat saved before
--      155 (no Google choice stored) whose series is in Apple Calendar is on
--      Calendar (repeat_day_target / repeat_day_presence; the browser's
--      itemRules.presentGoogleTarget reads the same).
--   D. The timer: every 10 minutes, only when something waits (a queued
--      item, or a series whose dates run out within 90 days), icloud-calendar
--      drains the queue — the secret read from Vault at call time
--      (ICLOUD_SYNC_SECRET, an owner step; missing, the function refuses and
--      nothing happens).
--   E. The retired address columns go (owner, 30.10.2026: "yes you can
--      remove"): time_blocks / schedule_blocks.icloud_href and
--      icloud_outbox.href — 174 emptied them and nothing reads them.
-- Re-runnable: CREATE OR REPLACE, DROP … IF EXISTS. No top-level BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Queueing the moments a move can finish ────────────────────────────────
create or replace function public.icloud_time_block_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.icloud_readback', true), '') = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    if old.icloud_area is not null then perform public.icloud_enqueue(old.user_id, 'slot', old.id, old.icloud_area); end if;
    return null;
  end if;
  -- A Google Calendar copy made for a slot that still has its Apple copy: the Apple copy may go now.
  if tg_op = 'UPDATE' and new.icloud_area is not null
     and old.google_calendar_event_id is null and new.google_calendar_event_id is not null then
    perform public.icloud_enqueue(new.user_id, 'slot', new.id, null);
    return null;
  end if;
  -- The function's own write of icloud_area, or any column the event doesn't show: nothing to send.
  if tg_op = 'UPDATE' and (new.date, new.start_time, new.duration_minutes, new.title, new.busy, new.category,
                           new.source_type, new.task_id, new.notes, new.user_id)
        is not distinct from (old.date, old.start_time, old.duration_minutes, old.title, old.busy, old.category,
                              old.source_type, old.task_id, old.notes, old.user_id) then
    return null;
  end if;
  if new.icloud_area is not null or public.icloud_writes_on(new.user_id) then
    perform public.icloud_enqueue(new.user_id, 'slot', new.id, null);
  end if;
  return null;
end;
$$;

create or replace function public.icloud_schedule_block_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.icloud_readback', true), '') = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    if old.icloud_area is not null then perform public.icloud_enqueue(old.user_id, 'plan', old.id, old.icloud_area); end if;
    return null;
  end if;
  -- A Google Calendar series made for a plan that still has its Apple series: the Apple one may go now.
  if tg_op = 'UPDATE' and new.icloud_area is not null
     and old.google_calendar_event_id is null and new.google_calendar_event_id is not null then
    perform public.icloud_enqueue(new.user_id, 'plan', new.id, null);
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.title, new.start_time, new.end_time, new.busy, new.days_of_week, new.repeat_kind,
                           new.repeat_interval, new.repeat_unit, new.repeat_dates, new.effective_from, new.except_dates,
                           new.category, new.domain, new.google_target, new.notes, new.google_calendar_time_zone, new.user_id)
        is not distinct from (old.title, old.start_time, old.end_time, old.busy, old.days_of_week, old.repeat_kind,
                              old.repeat_interval, old.repeat_unit, old.repeat_dates, old.effective_from, old.except_dates,
                              old.category, old.domain, old.google_target, old.notes, old.google_calendar_time_zone, old.user_id) then
    return null;
  end if;
  if new.icloud_area is not null or public.icloud_writes_on(new.user_id) then
    perform public.icloud_enqueue(new.user_id, 'plan', new.id, null);
  end if;
  return null;
end;
$$;

-- A task's done mark, title, Google choice, area — or its Google Task appearing or turned off — reaches its
-- slot's event; a repeat's day task's Google Task reaches the repeat (its series waits for today's).
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
  if new.schedule_block_id is not null
     and (new.google_task_id, new.google_sync_enabled) is distinct from (old.google_task_id, old.google_sync_enabled) then
    perform public.icloud_enqueue(sb.user_id, 'plan', sb.id, null)
      from public.schedule_blocks sb
     where sb.id = new.schedule_block_id and sb.user_id = new.user_id and sb.icloud_area is not null;
  end if;
  if (new.status, new.title, new.google_target, new.domain, new.source_type, new.project_id, new.hevy_routine_id, new.description,
      new.google_task_id, new.google_sync_enabled)
       is not distinct from (old.status, old.title, old.google_target, old.domain, old.source_type, old.project_id, old.hevy_routine_id, old.description,
                             old.google_task_id, old.google_sync_enabled) then
    return null;
  end if;
  -- Only the task owner's own slots (a definer function skips row security).
  for b in select tb.id, tb.user_id, tb.icloud_area from public.time_blocks tb where tb.task_id = new.id and tb.user_id = new.user_id loop
    if b.icloud_area is not null or public.icloud_writes_on(b.user_id) then
      perform public.icloud_enqueue(b.user_id, 'slot', b.id, null);
    end if;
  end loop;
  return null;
end;
$$;

-- ── B. The hand-over: the Apple copy is in, the Google Calendar copy goes ────
-- Called by icloud-calendar (service role) right after it linked the Apple copy. Answers:
--   'handed'  — the Google copy is queued for deletion and the link cleared;
--   'foreign' — the stored id isn't one the app makes for this item: left as it is, never deleted;
--   'changed' — the row no longer holds that id with an Apple copy (another run, an edit): nothing done.
create or replace function public.icloud_hand_over(p_user uuid, p_entity text, p_id uuid, p_event text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hex text;
  v_payload jsonb;
begin
  if p_user is null or p_id is null or p_event is null or p_entity not in ('slot', 'plan') then return 'changed'; end if;
  -- Only the item's own event: the id the app made from the item's own id (its uuid without dashes, or a
  -- later one of its sequence v1–v4). A Google-picked id after five unlinks stays — the owner removes it.
  v_hex := replace(p_id::text, '-', '');
  if p_event !~ ('^' || v_hex || '(v[1-4])?$') then return 'foreign'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then return 'changed'; end if;

  if p_entity = 'slot' then
    update public.time_blocks
       set google_calendar_event_id = null
     where id = p_id and user_id = p_user and google_calendar_event_id = p_event and icloud_area is not null
    returning jsonb_build_object('title', title, 'date', date, 'start_time', start_time, 'moved_to', 'apple_calendar') into v_payload;
  else
    update public.schedule_blocks
       set google_calendar_event_id = null, google_calendar_horizon = null, google_calendar_from = null
     where id = p_id and user_id = p_user and google_calendar_event_id = p_event and icloud_area is not null
    returning jsonb_build_object('series', true, 'schedule_block_id', id, 'title', title, 'effective_from', effective_from,
                                 'start_time', start_time, 'moved_to', 'apple_calendar') into v_payload;
  end if;
  if v_payload is null then return 'changed'; end if;

  -- A delete wins over a waiting upsert (155).
  insert into public.calendar_outbox (user_id, calendar_id, event_id, operation, time_block_id, payload, requested_at)
  values (p_user, 'primary', p_event, 'delete', case when p_entity = 'slot' then p_id end, v_payload, clock_timestamp())
  on conflict (user_id, calendar_id, event_id) do update
    set operation = 'delete', time_block_id = excluded.time_block_id, payload = excluded.payload,
        attempts = 0, next_retry_at = now(), last_error = null, requested_at = excluded.requested_at;
  return 'handed';
end;
$$;
revoke all on function public.icloud_hand_over(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.icloud_hand_over(uuid, text, uuid, text) to service_role;

-- ── C. On a calendar: Google's series, or Apple's ───────────────────────────
create or replace function public.repeat_day_target(p public.schedule_blocks)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(p.google_target,
                  case when p.google_calendar_event_id is not null or p.icloud_area is not null then 'calendar' else 'none' end)
$$;

create or replace function public.repeat_day_presence(p public.schedule_blocks)
returns text
language sql
stable
set search_path = ''
as $$
  select case public.repeat_day_target(p)
           when 'calendar' then case when p.google_calendar_event_id is not null or p.icloud_area is not null then 'calendar' else 'none' end
           when 'both' then case when p.google_calendar_event_id is not null or p.icloud_area is not null then 'both' else 'tasks' end
           else public.repeat_day_target(p)
         end
$$;

-- ── D. The timer ─────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed here: lascis-icloud-calendar not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'lascis-icloud-calendar') then
    perform cron.unschedule('lascis-icloud-calendar');
  end if;
  perform cron.schedule('lascis-icloud-calendar', '*/10 * * * *', $cron$
    select net.http_post(
      url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/icloud-calendar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'ICLOUD_SYNC_SECRET'), '')
      ),
      body := jsonb_build_object('action', 'cron')
    )
    where exists (select 1 from public.icloud_outbox where next_try_at <= now())
       or exists (select 1 from public.schedule_blocks where icloud_area is not null and icloud_horizon < current_date + 90);
  $cron$);
end $$;

-- ── E. The retired addresses go ──────────────────────────────────────────────
-- Undo's list first, without the column (an undo must never name a column that isn't there).
create or replace function public.app_undo_links(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'tasks' then array['google_task_id', 'google_tasklist_id', 'google_calendar_event_id']::text[]
    when 'time_blocks' then array['google_calendar_event_id', 'icloud_area']::text[]
    when 'schedule_blocks' then array['google_calendar_event_id', 'icloud_area']::text[]
    when 'user_movie_entries' then array['trakt_note_id']::text[]
    when 'user_tv_entries' then array['trakt_note_id']::text[]
    when 'user_tv_episodes' then array['trakt_note_id']::text[]
    else '{}'::text[]
  end
$$;
grant execute on function public.app_undo_links(text) to authenticated;

alter table public.time_blocks drop column if exists icloud_href;
alter table public.schedule_blocks drop column if exists icloud_href;
alter table public.icloud_outbox drop column if exists href;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name in ('time_blocks', 'schedule_blocks') and column_name = 'icloud_href')
                   or (table_name = 'icloud_outbox' and column_name = 'href'))) then
    raise exception 'Migration 175 assertion failed: a retired address column is still there';
  end if;
  if has_function_privilege('authenticated', 'public.icloud_hand_over(uuid, text, uuid, text)', 'execute') then
    raise exception 'Migration 175 assertion failed: the browser can call icloud_hand_over';
  end if;
end $$;
