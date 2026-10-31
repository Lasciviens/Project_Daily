-- ═══════════════════════════════════════════════════════════════════════════
-- 179 — Apple Calendar: every Hevy workout as an event in "Lasci · Training"
-- (owner, 31.10.2026: "Workouts and calendar items"; the past trainings, (b)).
-- A. hevy_workouts gets the link columns the other items have (icloud_area —
--    only 'training' — and icloud_etag) and icloud_key: a uuid made from
--    Hevy's id (md5), which names the event in iCloud and the queue row, so
--    nothing from outside is ever in an event's address.
-- B. The queue takes a third kind, 'workout'. A workout is queued when it is
--    added, deleted, or its title, notes or times really change (the Hevy
--    syncs re-save workouts often: an unchanged one queues nothing), and when
--    a session's link to it changes (a workout shown by its planned session's
--    event gets none of its own — never twice; icloud-calendar decides).
-- C. The settings trigger: Training switched queues every workout (to Apple:
--    each is put; back: each event goes); a settings re-send includes them.
-- D. Every workout already stored is queued once where Training is on Apple
--    now (the past trainings).
-- No new table (hevy_* are bulk-synced: no audit, no Undo). Re-runnable.
-- No top-level BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. The link columns ──────────────────────────────────────────────────────
alter table public.hevy_workouts
  add column if not exists icloud_key uuid generated always as (md5(id)::uuid) stored,
  add column if not exists icloud_area text,
  add column if not exists icloud_etag text;
alter table public.hevy_workouts drop constraint if exists hevy_workouts_icloud_area_check;
alter table public.hevy_workouts add constraint hevy_workouts_icloud_area_check
  check (icloud_area is null or icloud_area = 'training');
create index if not exists hevy_workouts_icloud_key on public.hevy_workouts (user_id, icloud_key);

-- ── B. The queue's third kind and its triggers ──────────────────────────────
alter table public.icloud_outbox drop constraint if exists icloud_outbox_entity_check;
alter table public.icloud_outbox add constraint icloud_outbox_entity_check check (entity in ('slot', 'plan', 'workout'));

create or replace function public.icloud_workout_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.icloud_area is not null then perform public.icloud_enqueue(old.user_id, 'workout', old.icloud_key, old.icloud_area); end if;
    return old;
  end if;
  if new.icloud_area is not null or exists (select 1 from public.calendar_prefs p where p.user_id = new.user_id
                    and p.prefs #>> '{areas,training,app}' = 'apple' and coalesce(p.prefs #>> '{areas,training,enabled}', 'true') <> 'false') then
    perform public.icloud_enqueue(new.user_id, 'workout', new.icloud_key, new.icloud_area);
  end if;
  return null;
end;
$$;
revoke all on function public.icloud_workout_changed() from public, anon, authenticated;
drop trigger if exists trg_icloud_workout_added on public.hevy_workouts;
create trigger trg_icloud_workout_added
  after insert or delete on public.hevy_workouts
  for each row execute function public.icloud_workout_changed();
drop trigger if exists trg_icloud_workout_changed on public.hevy_workouts;
create trigger trg_icloud_workout_changed
  after update of title, description, start_time, end_time on public.hevy_workouts
  for each row
  when ((old.title, old.description, old.start_time, old.end_time) is distinct from (new.title, new.description, new.start_time, new.end_time))
  execute function public.icloud_workout_changed();

-- A session's link to a workout changed: both workouts are looked at again (shown by the session, or on their own).
create or replace function public.icloud_workout_link_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
begin
  for k in select w.icloud_key, w.icloud_area from public.hevy_workouts w
            where w.user_id = new.user_id and w.id in (old.hevy_workout_id, new.hevy_workout_id)
              and (w.icloud_area is not null or exists (select 1 from public.calendar_prefs p where p.user_id = new.user_id
                    and p.prefs #>> '{areas,training,app}' = 'apple' and coalesce(p.prefs #>> '{areas,training,enabled}', 'true') <> 'false')) loop
    perform public.icloud_enqueue(new.user_id, 'workout', k.icloud_key, k.icloud_area);
  end loop;
  return null;
end;
$$;
revoke all on function public.icloud_workout_link_changed() from public, anon, authenticated;
drop trigger if exists trg_icloud_workout_link on public.tasks;
create trigger trg_icloud_workout_link
  after update of hevy_workout_id on public.tasks
  for each row
  when (old.hevy_workout_id is distinct from new.hevy_workout_id)
  execute function public.icloud_workout_link_changed();

-- ── C. The settings trigger (178) with the workouts ─────────────────────────
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
  -- 179: Training switched (to Apple, back, on or off): every workout is sent, or its event taken away.
  if (new.prefs #> '{areas,training,app}', new.prefs #> '{areas,training,enabled}')
     is distinct from (old.prefs #> '{areas,training,app}', old.prefs #> '{areas,training,enabled}') then
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
    if (new.prefs #> array['areas', a, 'emoji'], new.prefs #> array['areas', a, 'alertMinutes'],
        new.prefs #> array['areas', a, 'enabled'], new.prefs #> array['areas', a, 'app'])
       is distinct from
       (old.prefs #> array['areas', a, 'emoji'], old.prefs #> array['areas', a, 'alertMinutes'],
        old.prefs #> array['areas', a, 'enabled'], old.prefs #> array['areas', a, 'app']) then
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

-- ── D. The past trainings: every stored workout, once, where Training is on Apple ──
insert into public.icloud_outbox (user_id, entity, entity_id, area)
select w.user_id, 'workout', w.icloud_key, null
  from public.hevy_workouts w
 where w.start_time is not null
   and exists (select 1 from auth.users u where u.id = w.user_id)
   and exists (select 1 from public.calendar_prefs p where p.user_id = w.user_id
                    and p.prefs #>> '{areas,training,app}' = 'apple' and coalesce(p.prefs #>> '{areas,training,enabled}', 'true') <> 'false')
on conflict (user_id, entity, entity_id) do nothing;
