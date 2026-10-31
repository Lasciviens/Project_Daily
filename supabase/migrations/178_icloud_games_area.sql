-- ═══════════════════════════════════════════════════════════════════════════
-- 178 — Apple Calendar: Games gets its own calendar; the training rule locked
-- down (docs/features/calendar-plan.md, owner 31.10.2026: Games "Own").
-- A. A sixth area, `games` ("Lasci · Games"): every list of the app's area
--    calendars takes it — the area columns' checks, the read-back's state, the
--    settings trigger, the read-back and the calendar look. An item goes there
--    by its category Games or a game as its origin (icloudEvents.itemArea).
--    Until the owner switches Games to Apple in Settings → Calendar nothing
--    moves: its items stay where Personal is now, Google or Apple.
-- B. 177 D's training_task_moved with `search_path = ''` and every name
--    qualified (AGENTS.md's SECURITY DEFINER rule; it kept 169's `public`).
--    Nothing else in it changes.
-- Re-runnable: drop/add of named checks, CREATE OR REPLACE. No top-level BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. The Games area ────────────────────────────────────────────────────────
alter table public.time_blocks drop constraint if exists time_blocks_icloud_area_check;
alter table public.time_blocks add constraint time_blocks_icloud_area_check
  check (icloud_area is null or icloud_area in ('training', 'work', 'personal', 'media', 'football', 'games'));
alter table public.schedule_blocks drop constraint if exists schedule_blocks_icloud_area_check;
alter table public.schedule_blocks add constraint schedule_blocks_icloud_area_check
  check (icloud_area is null or icloud_area in ('training', 'work', 'personal', 'media', 'football', 'games'));
alter table public.icloud_outbox drop constraint if exists icloud_outbox_area_check;
alter table public.icloud_outbox add constraint icloud_outbox_area_check
  check (area is null or area in ('training', 'work', 'personal', 'media', 'football', 'games'));
alter table public.icloud_sync_state drop constraint if exists icloud_sync_state_area_check;
alter table public.icloud_sync_state add constraint icloud_sync_state_area_check
  check (area in ('training', 'work', 'personal', 'media', 'football', 'games'));

-- The settings trigger (177) with the sixth area.
create or replace function public.icloud_prefs_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a text;
  look_new text;
  look_old text;
begin
  if not exists (select 1 from auth.users u where u.id = new.user_id) then return null; end if;
  -- For every event: what its notes carry, and an all-day event's alert — compared as readCalendarPrefs reads them,
  -- so a row saved before 177 (no keys: the defaults) or a value that reads as the default re-sends nothing.
  look_new := concat_ws('|',
    case when new.prefs ->> 'notes' in ('notes', 'link', 'none') then new.prefs ->> 'notes' else 'notes+link' end,
    case when new.prefs #>> '{allDayAlert,time}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         then (new.prefs #>> '{allDayAlert,time}') || ' ' || coalesce(new.prefs #> '{allDayAlert,dayBefore}' = 'true'::jsonb, false)::text end);
  look_old := concat_ws('|',
    case when old.prefs ->> 'notes' in ('notes', 'link', 'none') then old.prefs ->> 'notes' else 'notes+link' end,
    case when old.prefs #>> '{allDayAlert,time}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         then (old.prefs #>> '{allDayAlert,time}') || ' ' || coalesce(old.prefs #> '{allDayAlert,dayBefore}' = 'true'::jsonb, false)::text end);
  -- Every row queued below is a re-send for the settings, not a change of the item (A).
  perform set_config('app.icloud_look', 'on', true);
  if look_new is distinct from look_old then
    insert into public.icloud_outbox (user_id, entity, entity_id, area)
    select tb.user_id, 'slot', tb.id, tb.icloud_area from public.time_blocks tb where tb.user_id = new.user_id and tb.icloud_area is not null
    union all
    select sb.user_id, 'plan', sb.id, sb.icloud_area from public.schedule_blocks sb where sb.user_id = new.user_id and sb.icloud_area is not null
    on conflict (user_id, entity, entity_id) do update
      set requested_at = now(), area = coalesce(excluded.area, public.icloud_outbox.area),
          attempts = 0, next_try_at = now(), last_error = null;
    perform set_config('app.icloud_look', 'off', true);
    return null;
  end if;
  foreach a in array array['training', 'work', 'personal', 'media', 'football', 'games'] loop
    if (new.prefs #> array['areas', a, 'emoji'], new.prefs #> array['areas', a, 'alertMinutes'],
        new.prefs #> array['areas', a, 'enabled'], new.prefs #> array['areas', a, 'app'])
       is distinct from
       (old.prefs #> array['areas', a, 'emoji'], old.prefs #> array['areas', a, 'alertMinutes'],
        old.prefs #> array['areas', a, 'enabled'], old.prefs #> array['areas', a, 'app']) then
      insert into public.icloud_outbox (user_id, entity, entity_id, area)
      select tb.user_id, 'slot', tb.id, tb.icloud_area from public.time_blocks tb where tb.user_id = new.user_id and tb.icloud_area = a
      union all
      select sb.user_id, 'plan', sb.id, sb.icloud_area from public.schedule_blocks sb where sb.user_id = new.user_id and sb.icloud_area = a
      on conflict (user_id, entity, entity_id) do update
        set requested_at = now(), area = coalesce(excluded.area, public.icloud_outbox.area),
            attempts = 0, next_try_at = now(), last_error = null;
    end if;
  end loop;
  perform set_config('app.icloud_look', 'off', true);
  return null;
end;
$$;

-- The read-back (177 C) with the sixth area.
create or replace function public.apply_icloud_readback(p_user uuid, p_entity text, p_id uuid, p_area text, p_change jsonb, p_etag text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted  boolean;
  v_title    text;
  v_bare     text;
  v_allday   boolean;
  v_date     date;
  v_time     time;
  v_minutes  integer;
  v_busy     boolean;
  v_modified timestamptz;
  v_foreign  boolean;
  v_pending  timestamptz;
  v_today    date := (now() at time zone 'Europe/Oslo')::date;
  v_etag     text := case when p_etag ~ '^(W/)?"[\x21\x23-\x7E]{1,200}"$' then p_etag end;
  b          public.time_blocks%rowtype;
  t          public.tasks%rowtype;
  p          public.schedule_blocks%rowtype;
  d          jsonb;
  v_orig     date;
  v_dcancel  boolean;
  v_ddate    date;
  v_dtime    time;
  v_dmin     integer;
  v_dbusy    boolean;
  v_dtitle   text;
  v_block    uuid;
  v_task     uuid;
  v_moved    boolean := false;
  v_days     integer := 0;
  v_out      text := 'same';
begin
  if p_user is null or p_id is null or p_entity is null or p_entity not in ('slot', 'plan')
     or p_area is null or p_area not in ('training', 'work', 'personal', 'media', 'football', 'games')
     or p_change is null or jsonb_typeof(p_change) <> 'object' then
    return 'ignored';
  end if;
  -- Checked where it enters: a value that isn't what it says is ignored, never applied.
  begin
    v_deleted := coalesce((p_change ->> 'deleted')::boolean, false);
    v_allday := coalesce((p_change ->> 'allDay')::boolean, false);
    v_date := nullif(p_change ->> 'date', '')::date;
    v_time := nullif(p_change ->> 'time', '')::time;
    v_minutes := nullif(p_change ->> 'minutes', '')::integer;
    v_busy := coalesce((p_change ->> 'busy')::boolean, true);
    v_modified := nullif(p_change ->> 'lastModified', '')::timestamptz;
    -- iCloud's version isn't the one the app wrote (it knew it): someone else changed the event, stamp or not.
    v_foreign := coalesce((p_change ->> 'foreign')::boolean, false);
  exception when others then
    return 'ignored';
  end;
  v_title := nullif(btrim(left(regexp_replace(coalesce(p_change ->> 'title', ''), '[[:cntrl:]]', '', 'g'), 500)), '');
  -- The title without a leading symbol word (an old area emoji): only compared — the same title is no rename.
  v_bare := nullif(btrim(left(regexp_replace(coalesce(p_change ->> 'titleBare', ''), '[[:cntrl:]]', '', 'g'), 500)), '');
  if v_allday then v_time := null; end if;
  -- A one-off moved there lands within a year of today, like a repeat's days (security check, 30.10.2026).
  if v_date is not null and abs(v_date - current_date) > 366 then return 'ignored'; end if;
  if v_time is null then v_busy := false; end if;
  v_minutes := least(1440, greatest(1, coalesce(v_minutes, 60)));
  -- What this applies came FROM Apple Calendar: the queue triggers don't send it back (the iPhone has it, with what
  -- the owner added there — an alert, a place). A day of a repeat split off below is queued on purpose.
  perform set_config('app.icloud_readback', 'on', true);
  -- The app's own change of the item not yet sent: it wins over an iPhone change made before it. A row queued only
  -- because the settings changed (changed_at null, 177) is not a change of the item and never wins.
  select o.changed_at into v_pending from public.icloud_outbox o
   where o.user_id = p_user and o.entity = p_entity and o.entity_id = p_id;

  if p_entity = 'slot' then
    -- Only a slot of this account whose event is in the calendar this was read from.
    select * into b from public.time_blocks x where x.id = p_id and x.user_id = p_user and x.icloud_area = p_area for update;
    if not found then return 'not_ours'; end if;
    if b.task_id is not null then
      select * into t from public.tasks x where x.id = b.task_id and x.user_id = p_user for update;
    end if;
    if v_deleted then
      update public.time_blocks set icloud_area = null, icloud_etag = null where id = b.id;
      -- Still in Google Calendar too (kept until its replacement exists): it stays there, on Calendar.
      if t.id is not null and b.google_calendar_event_id is null then
        update public.tasks
           set google_target = case google_target when 'calendar' then 'none' when 'both' then 'tasks' else google_target end
         where id = t.id and google_target in ('calendar', 'both');
        -- A slot that only put the item's day on the calendar goes (the item stays) — app_item_drop_block's
        -- guard: not a day split off a repeat, no Google copy, and the task's due IS that day.
        if b.start_time is null and b.schedule_block_id is null and b.google_calendar_event_id is null
           and t.due_date is not distinct from b.date and t.due_time is null then
          delete from public.time_blocks where id = b.id;
        end if;
      end if;
      return 'unlinked';
    end if;
    if v_etag is not null then update public.time_blocks set icloud_etag = v_etag where id = b.id; end if;
    -- Applied only when it is someone else's change (a LAST-MODIFIED stamp, or a version the app didn't write) and
    -- no change of the app's own made after it waits to be sent — that one wins and goes with iCloud's new version.
    if (v_modified is null and not v_foreign) or (v_pending is not null and (v_modified is null or v_pending >= v_modified)) then
      return 'stale';
    end if;
    if v_date is not null and ((b.date, b.start_time) is distinct from (v_date, v_time)
        or (v_time is not null and (b.duration_minutes, b.busy) is distinct from (v_minutes, v_busy))
        or (v_time is null and b.busy)) then
      update public.time_blocks
         set date = v_date, start_time = v_time,
             duration_minutes = case when v_time is null then duration_minutes else v_minutes end,
             busy = case when v_time is null then false else v_busy end
       where id = b.id;
      -- The task's due follows by itself (item_slot_moves_due; 142 for a training session).
      v_moved := true;
    end if;
    if v_title is not null and v_title is distinct from coalesce(t.title, b.title) and v_bare is distinct from coalesce(t.title, b.title) then
      if t.id is not null then update public.tasks set title = v_title where id = t.id;
      else update public.time_blocks set title = v_title where id = b.id; end if;
      return case when v_moved then 'moved' else 'renamed' end;
    end if;
    return case when v_moved then 'moved' else 'same' end;
  end if;

  select * into p from public.schedule_blocks x where x.id = p_id and x.user_id = p_user and x.icloud_area = p_area for update;
  if not found then return 'not_ours'; end if;
  if v_deleted then
    update public.schedule_blocks
       set icloud_area = null, icloud_etag = null, icloud_from = null, icloud_horizon = null,
           google_target = case when google_calendar_event_id is not null then google_target
                                else case google_target when 'calendar' then 'none' when 'both' then 'tasks' else google_target end end
     where id = p.id;
    return 'unlinked';
  end if;
  if v_etag is not null then update public.schedule_blocks set icloud_etag = v_etag where id = p.id; end if;
  if (v_modified is null and not v_foreign) or (v_pending is not null and (v_modified is null or v_pending >= v_modified)) then
    return 'stale';
  end if;
  if v_title is not null and v_title is distinct from p.title and v_bare is distinct from p.title then
    update public.schedule_blocks set title = v_title where id = p.id;
    v_out := 'renamed';
  end if;
  -- Its days moved or deleted there (an override, an EXDATE the app didn't write) — only days from today on (a past
  -- day is a record), within the series' own reach, at most 31 per change (a crafted series can't make thousands).
  for d in select value from jsonb_array_elements(case when jsonb_typeof(p_change -> 'days') = 'array' then p_change -> 'days' else '[]'::jsonb end) loop
    exit when v_days >= 31;
    begin
      v_orig := nullif(d ->> 'originalDate', '')::date;
      v_dcancel := coalesce((d ->> 'cancelled')::boolean, false);
      v_ddate := nullif(d ->> 'date', '')::date;
      v_dtime := case when coalesce((d ->> 'allDay')::boolean, false) then null else nullif(d ->> 'time', '')::time end;
      v_dmin := least(1440, greatest(1, coalesce(nullif(d ->> 'minutes', '')::integer, 60)));
      v_dbusy := v_dtime is not null and coalesce((d ->> 'busy')::boolean, true);
    exception when others then
      continue;
    end;
    v_dtitle := nullif(btrim(left(regexp_replace(coalesce(d ->> 'title', ''), '[[:cntrl:]]', '', 'g'), 500)), '');
    -- A day the app already took out (its own EXDATE, or split off) is the app's; only a real day of the rule counts.
    if v_orig is null or v_orig < v_today or v_orig > coalesce(p.icloud_horizon, v_today + 400)
       or (v_ddate is not null and abs(v_ddate - v_orig) > 366)
       or v_orig = any (coalesce(p.except_dates, '{}'::date[]))
       or exists (select 1 from public.time_blocks x where x.schedule_block_id = p.id and x.occurrence_date = v_orig)
       or not public.repeat_occurs_on(p, v_orig) then
      continue;
    end if;
    select o.block_id, o.task_id into v_block, v_task from public.item_occurrence(p.id, v_orig, v_today, p_user) o;
    if v_dcancel then
      update public.tasks
         set google_target = case google_target when 'both' then 'tasks' else 'none' end
       where id = v_task and user_id = p_user;
    else
      update public.time_blocks
         set date = coalesce(v_ddate, date), start_time = v_dtime,
             duration_minutes = case when v_dtime is null then duration_minutes else v_dmin end,
             busy = v_dbusy
       where id = v_block and user_id = p_user;
      update public.tasks
         set due_date = coalesce(v_ddate, due_date), due_time = v_dtime, title = coalesce(v_dtitle, title),
             google_target = 'calendar', section = public.item_section_for_day(coalesce(v_ddate, due_date), v_today)
       where id = v_task and user_id = p_user;
    end if;
    -- The day gets its own event and the series its EXDATE (queued on purpose: the trigger is off here).
    perform public.icloud_enqueue(p_user, 'slot', v_block, null);
    v_days := v_days + 1;
  end loop;
  if v_days > 0 then
    perform public.icloud_enqueue(p_user, 'plan', p.id, null);
    return 'days';
  end if;
  return v_out;
end;
$$;
revoke all on function public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text) to service_role;

-- A calendar's name and colour from the iPhone (176) with the sixth area.
create or replace function public.icloud_calendar_look(p_user uuid, p_area text, p_name text, p_color text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g')), '');
  v_color text := case when p_color ~ '^#[0-9A-Fa-f]{6}$' then upper(p_color) end;
  v_patch jsonb;
begin
  if p_user is null or p_area is null or p_area not in ('training', 'work', 'personal', 'media', 'football', 'games') then return false; end if;
  if length(v_name) > 60 then v_name := null; end if;
  v_patch := jsonb_strip_nulls(jsonb_build_object('name', v_name, 'color', v_color));
  if v_patch = '{}'::jsonb then return false; end if;
  update public.calendar_prefs c
     set prefs = jsonb_set(
           coalesce(c.prefs, '{}'::jsonb) || jsonb_build_object('areas',
             case when jsonb_typeof(c.prefs -> 'areas') = 'object' then c.prefs -> 'areas' else '{}'::jsonb end),
           array['areas', p_area],
           case when jsonb_typeof(c.prefs #> array['areas', p_area]) = 'object' then c.prefs #> array['areas', p_area] else '{}'::jsonb end || v_patch,
           true)
   where c.user_id = p_user and jsonb_typeof(coalesce(c.prefs, '{}'::jsonb)) = 'object';
  return found;
end;
$$;
revoke all on function public.icloud_calendar_look(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.icloud_calendar_look(uuid, text, text, text) to service_role;

-- ── B. The training move rule, locked down ──────────────────────────────────
create or replace function public.training_task_moved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone 'Europe/Oslo')::date;
  -- 169: a move read back from Google (155's read-back, 148's Google Tasks
  -- pull) carries the echo flags for its whole transaction.
  v_readback text := current_setting('app.calendar_readback', true);
  v_gsync    text := current_setting('app.google_sync_write', true);
  -- 177: a move read back from Apple Calendar carries its echo flag too.
  v_icloud   text := current_setting('app.icloud_readback', true);
begin
  if new.due_date is null or new.due_date is not distinct from old.due_date then return null; end if;
  if not (new.hevy_routine_id is not null or new.source_type = 'training_session') then return null; end if;

  -- 169: what follows is the database's own decision, not Google's data:
  -- queued for Google like a change made in the app (the flags are put back
  -- below, so the move Google sent is still not sent back).
  perform set_config('app.calendar_readback', 'off', true);
  perform set_config('app.google_sync_write', '', true);
  perform set_config('app.icloud_readback', 'off', true);

  -- D. Out of its week: skipped there, that week's session moves instead.
  if new.first_plan_date is not null and new.due_date >= new.first_plan_date + 7 then
    perform public.training_move_past_week(new.id, new.due_date, new.due_time, old.due_time);
    perform set_config('app.calendar_readback', coalesce(v_readback, ''), true);
    perform set_config('app.google_sync_write', coalesce(v_gsync, ''), true);
    perform set_config('app.icloud_readback', coalesce(v_icloud, ''), true);
    return null;
  end if;

  -- 1. A repeat's day moved without its slot: split like Move (a slot where it is now).
  if new.schedule_block_id is not null and new.occurrence_date is not null
     and not exists (select 1 from public.time_blocks b where b.task_id = new.id)
     and exists (select 1 from public.schedule_blocks s where s.id = new.schedule_block_id) then
    perform 1 from public.item_occurrence(new.schedule_block_id, new.occurrence_date, v_today, new.user_id);
  end if;

  -- 2. Missed, then moved to today or later: to do on its new day (156's
  --    marker goes with the status). Moved to another past day it stays missed.
  update public.tasks set status = 'open'
   where id = new.id and status = 'cancelled' and closed_reason = 'missed'
     and new.due_date >= v_today;

  -- C. Skipped, then moved to today or later inside its week: to do again
  --    (removing its skip reopens it, 142). Not when D put it back on its
  --    first day (the move came from outside its week).
  if new.due_date >= v_today and old.due_date < coalesce(new.first_plan_date, old.due_date) + 7 then
    delete from public.training_skips k
     where k.task_id = new.id
       and exists (select 1 from public.tasks x where x.id = new.id and x.status = 'cancelled' and x.closed_reason is null);
  end if;

  perform public.training_task_recheck(new.id);
  perform set_config('app.calendar_readback', coalesce(v_readback, ''), true);
  perform set_config('app.google_sync_write', coalesce(v_gsync, ''), true);
  perform set_config('app.icloud_readback', coalesce(v_icloud, ''), true);
  return null;
end;
$$;
revoke all on function public.training_task_moved() from public, anon, authenticated;
