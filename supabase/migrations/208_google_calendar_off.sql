-- ═══════════════════════════════════════════════════════════════════════════
-- 208 — Google Calendar goes (owner, 25.11.2026: "Google calendar can be removed. we dont need it anymore"; scope
-- "Calendar only" — Google Tasks stays; old events: "Leave them in Google" — stop syncing, delete nothing there).
-- Apple Calendar is the only calendar an item goes to (docs/features/planning-calendar.md → Calendars).
--
--   A. Nothing queues or sends Google Calendar work any more: the five outbox triggers (135, 147, 155) and their
--      functions go, the Google read-back's apply_calendar_readback (155) and the Apple drain's hand-over of a Google
--      copy (175: it queued the Google copy's DELETE) go, and whatever waits in calendar_outbox is dropped unsent —
--      a queued delete or update never reaches Google, so every event stays in Google Calendar as it is.
--   B. An item on Google Calendar now is "only in this app": its Google choice (tasks.google_target,
--      schedule_blocks.google_target) Calendar → None and Both → Tasks (its Google Task stays), when its area is not
--      on Apple Calendar and it has no Apple copy. An item whose area IS on Apple, or that has an Apple copy, keeps
--      Calendar — that is Apple Calendar. A row from before 155 (no choice saved) gets the choice it is read as
--      (itemRules.presentGoogleTarget), so the next step can't change what it means.
--   C. The links to Google's events are forgotten (google_calendar_event_id, and a series' google_calendar_from /
--      _horizon): no code reads them any more, and an id left behind would read as "on a calendar". The events stay
--      in Google. google_calendar_time_zone stays: it is a repeat's zone for a plan saved before 183.
--   D. Settings → Calendar: every area's events go to Apple Calendar (`app` = 'apple' — the app no longer reads or
--      writes the key; this keeps the code that runs until the new deploy in step), the settings trigger (179) no
--      longer reads `app` (so this re-sends nothing, and a Training area that was on Google sends no past workout to
--      Apple), and icloud_writes_on (173) means "iCloud is connected" — the area switch it read is gone.
--   E. Undo's preview (151's app_undo_synced) names a slot's or repeat's outside copy as Apple Calendar's.
-- Kept on purpose (dropping needs the owner's go — .claude/rules/database.md; the item save, Undo and the repeat days
-- still name the columns): the columns above, calendar_outbox (empty, nothing writes it) and google_calendar_sync_state
-- (nothing reads it). user_calendar_tokens stays: it is Google Tasks' sign-in.
-- Attacker notes: no new function, grant or table; B–D run once, as the migration, on every account's own rows only
-- (each update joins on user_id); icloud_writes_on keeps 174's rights (service role only) and reads no input.
-- Re-runnable: DROP … IF EXISTS, CREATE OR REPLACE, updates that change nothing the second time. No BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Nothing queues, nothing is sent ───────────────────────────────────────
drop trigger if exists trg_enqueue_calendar_event_delete on public.time_blocks;
drop trigger if exists trg_enqueue_calendar_event_upsert on public.time_blocks;
drop trigger if exists trg_enqueue_calendar_series_delete on public.schedule_blocks;
drop trigger if exists trg_enqueue_calendar_series_upsert on public.schedule_blocks;
drop trigger if exists trg_enqueue_calendar_done_mark on public.tasks;
drop function if exists public.enqueue_calendar_event_delete();
drop function if exists public.enqueue_calendar_event_upsert();
drop function if exists public.enqueue_calendar_series_delete();
drop function if exists public.enqueue_calendar_series_upsert();
drop function if exists public.enqueue_calendar_done_mark();
drop function if exists public.calendar_outbox_request_upsert(uuid, text, uuid, jsonb);
drop function if exists public.apply_calendar_readback(uuid, jsonb);
drop function if exists public.icloud_hand_over(uuid, text, uuid, text);

do $$
begin
  if to_regclass('public.calendar_outbox') is not null then
    delete from public.calendar_outbox where operation in ('delete', 'upsert');
  end if;
end $$;

-- ── B. Items on Google Calendar: only in this app ────────────────────────────
-- itemArea (calendar/areas/icloudEvents.ts) for the migration only: football → training → games → media → work → personal.
create or replace function pg_temp.area_of(p_category text, p_sources text[], p_domain text, p_project uuid, p_routine text)
returns text
language sql
immutable
as $$
  select case
    when p_category = 'football' then 'football'
    when p_category = 'training' or 'training_session' = any (p_sources) or p_routine is not null then 'training'
    when p_category = 'games' or 'game' = any (p_sources) then 'games'
    when p_category = 'media' or p_domain = 'media' or p_sources && array['movie', 'tv_series', 'tv_episode', 'media'] then 'media'
    when p_category in ('work', 'projects') or p_domain = 'work' or p_project is not null or 'project_item' = any (p_sources) then 'work'
    else 'personal'
  end
$$;

-- An area on Apple Calendar as the settings were before this migration (calendarAreas.onApple: in use and 'apple').
create or replace function pg_temp.on_apple(p_user uuid, p_area text)
returns boolean
language sql
stable
as $$
  select coalesce((select a ->> 'app' = 'apple' and coalesce(a ->> 'enabled', 'true') <> 'false'
                     from public.calendar_prefs cp, lateral (select cp.prefs #> array['areas', p_area]) x(a)
                    where cp.user_id = p_user and jsonb_typeof(x.a) = 'object'), false)
$$;

-- The choice an item keeps: Calendar stays for an item that is (or goes) to Apple; Google Calendar's goes.
create or replace function pg_temp.kept_target(p_target text, p_on_google boolean, p_apple boolean, p_sync boolean)
returns text
language sql
immutable
as $$
  select case
    when p_apple and p_target is null and p_on_google then case when p_sync then 'both' else 'calendar' end
    when p_apple then p_target
    when p_target = 'calendar' then 'none'
    when p_target = 'both' then 'tasks'
    when p_target is null and p_on_google then case when p_sync then 'tasks' else 'none' end
    else p_target
  end
$$;

-- What B–C write comes from this migration: nothing is queued for Apple (the drain would find nothing to do).
select set_config('app.icloud_readback', 'on', true);

-- Repeats first (their day tasks follow them below).
with p as (
  select sb.id, sb.google_target as target,
         pg_temp.kept_target(sb.google_target, sb.google_calendar_event_id is not null,
                             sb.icloud_area is not null or pg_temp.on_apple(sb.user_id, pg_temp.area_of(sb.category, '{}', sb.domain, null, null)),
                             false) as kept
    from public.schedule_blocks sb
   where sb.google_target in ('calendar', 'both') or (sb.google_target is null and sb.google_calendar_event_id is not null)
)
update public.schedule_blocks sb set google_target = p.kept
  from p where sb.id = p.id and p.kept is distinct from p.target;

-- Tasks: an item's slot (its category, source and Apple copy), else a repeat day's plan, else the task alone.
with t as (
  select tk.id, tk.google_target as target,
         pg_temp.kept_target(
           tk.google_target,
           coalesce(tb.google_calendar_event_id is not null, false),
           tb.icloud_area is not null or sb.icloud_area is not null
             or pg_temp.on_apple(tk.user_id, coalesce(
                  case when sb.id is not null and tb.id is null then pg_temp.area_of(sb.category, '{}', sb.domain, null, null) end,
                  pg_temp.area_of(tb.category, array_remove(array[tb.source_type, tk.source_type], null), tk.domain, tk.project_id, tk.hevy_routine_id::text))),
           coalesce(tk.google_sync_enabled, false)) as kept
    from public.tasks tk
    left join lateral (select b.* from public.time_blocks b where b.task_id = tk.id and b.user_id = tk.user_id
                        order by (b.google_calendar_event_id is not null) desc, b.date limit 1) tb on true
    left join public.schedule_blocks sb on sb.id = tk.schedule_block_id and sb.user_id = tk.user_id
   where tk.google_target in ('calendar', 'both') or (tk.google_target is null and tb.google_calendar_event_id is not null)
)
update public.tasks tk set google_target = t.kept
  from t where tk.id = t.id and t.kept is distinct from t.target;

-- ── C. Google's event links are forgotten (the events stay in Google) ────────
update public.time_blocks set google_calendar_event_id = null where google_calendar_event_id is not null;
update public.schedule_blocks set google_calendar_event_id = null, google_calendar_from = null, google_calendar_horizon = null
 where google_calendar_event_id is not null or google_calendar_from is not null or google_calendar_horizon is not null;
update public.tasks set google_calendar_event_id = null where google_calendar_event_id is not null;

select set_config('app.icloud_readback', 'off', true);

-- ── D. Every area on Apple Calendar ──────────────────────────────────────────
-- 179's settings trigger as it was, but an area's `app` no longer counts (only Apple is left; the app stops writing
-- the key): Training's workouts follow its use (on or off), an area's events its emoji, alert and use. So the update
-- below re-sends nothing, and a Training area that was on Google doesn't send every past workout to Apple.
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
  -- 179: Training turned on or off: every workout is sent, or its event taken away.
  if coalesce(new.prefs #>> '{areas,training,enabled}', 'true') is distinct from coalesce(old.prefs #>> '{areas,training,enabled}', 'true') then
    insert into public.icloud_outbox (user_id, entity, entity_id, area)
    select w.user_id, 'workout', w.icloud_key, w.icloud_area from public.hevy_workouts w
     where w.user_id = new.user_id and (w.start_time is not null or w.icloud_area is not null)
    on conflict (user_id, entity, entity_id) do update
      set requested_at = now(), area = coalesce(excluded.area, public.icloud_outbox.area),
          attempts = 0, next_try_at = now(), last_error = null;
  end if;
  if look_new is distinct from look_old then
    insert into public.icloud_outbox (user_id, entity, entity_id, area)
    select tb.user_id, 'slot', tb.id, tb.icloud_area from public.time_blocks tb where tb.user_id = new.user_id and tb.icloud_area is not null
    union all
    select sb.user_id, 'plan', sb.id, sb.icloud_area from public.schedule_blocks sb where sb.user_id = new.user_id and sb.icloud_area is not null
    union all
    select w.user_id, 'workout', w.icloud_key, w.icloud_area from public.hevy_workouts w where w.user_id = new.user_id and w.icloud_area is not null
    on conflict (user_id, entity, entity_id) do update
      set requested_at = now(), area = coalesce(excluded.area, public.icloud_outbox.area),
          attempts = 0, next_try_at = now(), last_error = null;
    perform set_config('app.icloud_look', 'off', true);
    return null;
  end if;
  foreach a in array array['training', 'work', 'personal', 'media', 'football', 'games'] loop
    if (new.prefs #> array['areas', a, 'emoji'], new.prefs #> array['areas', a, 'alertMinutes'], new.prefs #> array['areas', a, 'enabled'])
       is distinct from
       (old.prefs #> array['areas', a, 'emoji'], old.prefs #> array['areas', a, 'alertMinutes'], old.prefs #> array['areas', a, 'enabled']) then
      insert into public.icloud_outbox (user_id, entity, entity_id, area)
      select tb.user_id, 'slot', tb.id, tb.icloud_area from public.time_blocks tb where tb.user_id = new.user_id and tb.icloud_area = a
      union all
      select sb.user_id, 'plan', sb.id, sb.icloud_area from public.schedule_blocks sb where sb.user_id = new.user_id and sb.icloud_area = a
      union all
      select w.user_id, 'workout', w.icloud_key, w.icloud_area from public.hevy_workouts w where w.user_id = new.user_id and w.icloud_area = a
      on conflict (user_id, entity, entity_id) do update
        set requested_at = now(), area = coalesce(excluded.area, public.icloud_outbox.area),
            attempts = 0, next_try_at = now(), last_error = null;
    end if;
  end loop;
  perform set_config('app.icloud_look', 'off', true);
  return null;
end;
$$;

update public.calendar_prefs cp
   set prefs = jsonb_set(cp.prefs, '{areas}', (
         select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' then v || '{"app":"apple"}'::jsonb else v end), '{}'::jsonb)
           from jsonb_each(cp.prefs -> 'areas') e(k, v)))
 where jsonb_typeof(cp.prefs -> 'areas') = 'object'
   and exists (select 1 from jsonb_each(cp.prefs -> 'areas') e(k, v) where jsonb_typeof(v) = 'object' and v ->> 'app' is distinct from 'apple');

create or replace function public.icloud_writes_on(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Apple Calendar is the only calendar (208): an item's change is queued once iCloud is connected.
  select exists (select 1 from public.icloud_credentials c where c.user_id = p_user)
$$;
revoke all on function public.icloud_writes_on(uuid) from public, anon, authenticated;
grant execute on function public.icloud_writes_on(uuid) to service_role;

-- ── E. Undo's preview (151): a slot's or repeat's outside copy is Apple's ────
-- A sync's save of a slot or repeat (Apple's read-back) is named as Apple Calendar's, never Google Calendar's.
create or replace function public.app_undo_synced(p_table text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_table in ('user_movie_entries', 'user_tv_entries', 'user_tv_episodes', 'media_watches') then 'trakt'
    when p_table = 'tasks' then 'google_tasks'
    when p_table in ('time_blocks', 'schedule_blocks') then 'apple_calendar'
  end
$$;

comment on column public.time_blocks.google_calendar_event_id is
  'Retired (208): Google Calendar is no longer written or read; always null. Kept until the owner agrees to drop it.';
comment on column public.schedule_blocks.google_calendar_event_id is
  'Retired (208): Google Calendar is no longer written or read; always null. Kept until the owner agrees to drop it.';
