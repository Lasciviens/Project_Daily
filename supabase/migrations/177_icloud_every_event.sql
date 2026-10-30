-- ═══════════════════════════════════════════════════════════════════════════
-- 177 — Calendar 2b-3a: settings for every event (docs/features/calendar-plan.md).
-- Settings → Calendar gains two choices kept in calendar_prefs.prefs (no new
-- column, no new table): `notes` — what an event's notes carry (the item's
-- notes and/or a link back to the app) — and `allDayAlert` — an alert for
-- all-day events, at a time on the day or the day before (null: none). An
-- area's alert "None" now writes Apple's no-alert marker (icloudEvents.ts).
-- A change of either re-queues every event already in Apple Calendar, so it
-- is rewritten with the new choice (174's trigger re-queued only one area's
-- events, for that area's own emoji, alert, use or app).
-- Re-runnable: CREATE OR REPLACE, DROP TRIGGER IF EXISTS. No top-level BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.icloud_prefs_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a text;
begin
  if not exists (select 1 from auth.users u where u.id = new.user_id) then return null; end if;
  -- For every event: what its notes carry, and an all-day event's alert.
  if (new.prefs -> 'notes', new.prefs -> 'allDayAlert') is distinct from (old.prefs -> 'notes', old.prefs -> 'allDayAlert') then
    insert into public.icloud_outbox (user_id, entity, entity_id, area)
    select tb.user_id, 'slot', tb.id, tb.icloud_area from public.time_blocks tb where tb.user_id = new.user_id and tb.icloud_area is not null
    union all
    select sb.user_id, 'plan', sb.id, sb.icloud_area from public.schedule_blocks sb where sb.user_id = new.user_id and sb.icloud_area is not null
    on conflict (user_id, entity, entity_id) do update
      set requested_at = now(), area = coalesce(excluded.area, public.icloud_outbox.area),
          attempts = 0, next_try_at = now(), last_error = null;
    return null;
  end if;
  foreach a in array array['training', 'work', 'personal', 'media', 'football'] loop
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
  return null;
end;
$$;
drop trigger if exists trg_icloud_prefs on public.calendar_prefs;
create trigger trg_icloud_prefs
  after update on public.calendar_prefs
  for each row execute function public.icloud_prefs_changed();
