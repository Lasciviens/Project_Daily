-- ═══════════════════════════════════════════════════════════════════════════
-- 174 — The Apple Calendar writer, made safe (security review 30.10.2026; the
-- owner: "Security > Feature!"). Migration 173 ran with a design the review
-- found unsafe: each item stored its event's iCloud ADDRESS (icloud_href) in
-- tables the browser and the assistant can write, and the writer sent its
-- deletes — with the owner's Apple password — to whatever address it found.
-- 173 was dormant (no area on Apple, no button runs the writer), but a forged
-- address plus a stolen session could have deleted calendars outside the app.
-- See the warning in AGENTS.md.
--
--   A. Items store only WHICH area calendar their event is in (icloud_area,
--      one of the five keys) and iCloud's version of it (icloud_etag, for
--      If-Match). The function builds every address from its own server-only
--      record of the area calendars and the item's id.
--   B. icloud_href is retired: emptied here (any value in it was written by
--      something other than the writer, which never ran), never read again,
--      and closed to the assistant (ai-proxy AI_NO_WRITE). The column stays
--      until the owner agrees to drop it (database rule: ask before DROP).
--      The queue's own href likewise; rows queued by an address are dropped.
--   C. The triggers and the queue function work on icloud_area; the task
--      trigger queues only the task owner's own slots; a plan's time zone
--      change queues it; icloud_writes_on is no longer granted to the
--      browser; a change in Settings → Calendar re-queues that area's events.
--   D. One drain at a time per account (icloud_credentials.drain_until).
--   E. Undo knows the new link (icloud_area) and the version (icloud_etag).
-- Re-runnable: IF NOT EXISTS, the duplicate_object guard, DROP … IF EXISTS.
-- No top-level BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. The area key and the version ─────────────────────────────────────────
alter table public.time_blocks
  add column if not exists icloud_area text,
  add column if not exists icloud_etag text;
alter table public.schedule_blocks
  add column if not exists icloud_area text,
  add column if not exists icloud_etag text;
do $$ begin
  alter table public.time_blocks add constraint time_blocks_icloud_area_check
    check (icloud_area is null or icloud_area in ('training', 'work', 'personal', 'media', 'football'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.schedule_blocks add constraint schedule_blocks_icloud_area_check
    check (icloud_area is null or icloud_area in ('training', 'work', 'personal', 'media', 'football'));
exception when duplicate_object then null; end $$;
alter table public.icloud_outbox add column if not exists area text;
do $$ begin
  alter table public.icloud_outbox add constraint icloud_outbox_area_check
    check (area is null or area in ('training', 'work', 'personal', 'media', 'football'));
exception when duplicate_object then null; end $$;
alter table public.icloud_credentials add column if not exists drain_until timestamptz;

comment on column public.time_blocks.icloud_area is
  'The area calendar the slot''s event is in, in Apple Calendar (174, written by icloud-calendar); the address is derived, never stored.';
comment on column public.schedule_blocks.icloud_area is
  'The area calendar the plan''s ONE series event is in, in Apple Calendar (174, written by icloud-calendar).';
comment on column public.time_blocks.icloud_etag is
  'iCloud''s version of the slot''s event when the app last wrote it: the next write sends If-Match, so a change made on the iPhone is never written over (174).';
comment on column public.schedule_blocks.icloud_etag is
  'iCloud''s version of the series when the app last wrote it (If-Match, 174).';
comment on column public.schedule_blocks.icloud_from is
  'The day the series starts from in Apple Calendar (173; like 148''s google_calendar_from, never moved by a later push).';
comment on column public.schedule_blocks.icloud_horizon is
  'The last day the series'' RDATE list covers in Apple Calendar (173); the drain renews it 90 days ahead.';
comment on column public.time_blocks.icloud_href is
  'RETIRED (174, security review 30.10.2026): never read. Kept only until the owner agrees to drop it.';
comment on column public.schedule_blocks.icloud_href is
  'RETIRED (174, security review 30.10.2026): never read. Kept only until the owner agrees to drop it.';
comment on column public.icloud_outbox.href is
  'RETIRED (174): never read; the area key (area) replaced it.';

-- ── C. Queueing on the area key ──────────────────────────────────────────────
revoke all on function public.icloud_writes_on(uuid) from public, anon, authenticated;
grant execute on function public.icloud_writes_on(uuid) to service_role;

-- The parameter's meaning changed (an area key, not an address): a new definition, not a replace.
drop function if exists public.icloud_enqueue(uuid, text, uuid, text);
create or replace function public.icloud_enqueue(p_user uuid, p_entity text, p_id uuid, p_area text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or p_id is null then return; end if;
  -- A user that no longer exists (an account being deleted) queues nothing, or the delete would abort.
  if not exists (select 1 from auth.users u where u.id = p_user) then return; end if;
  insert into public.icloud_outbox (user_id, entity, entity_id, area)
  values (p_user, p_entity, p_id, p_area)
  on conflict (user_id, entity, entity_id) do update
    set requested_at = now(),
        area = coalesce(excluded.area, public.icloud_outbox.area),
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
    if old.icloud_area is not null then perform public.icloud_enqueue(old.user_id, 'slot', old.id, old.icloud_area); end if;
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
    if old.icloud_area is not null then perform public.icloud_enqueue(old.user_id, 'plan', old.id, old.icloud_area); end if;
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
  -- Only the task owner's own slots (a definer function skips row security).
  for b in select tb.id, tb.user_id, tb.icloud_area from public.time_blocks tb where tb.task_id = new.id and tb.user_id = new.user_id loop
    if b.icloud_area is not null or public.icloud_writes_on(b.user_id) then
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

-- A change in Settings → Calendar (an area's emoji, alert, on/off or app) reaches the events already in that
-- area's calendar. (Putting an area's items into Apple Calendar for the first time is the switch's own step, 2b-2.)
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


-- ── B. The retired addresses ─────────────────────────────────────────────────
-- (After the triggers above: a write of icloud_href alone queues nothing.)
update public.time_blocks set icloud_href = null where icloud_href is not null;
update public.schedule_blocks set icloud_href = null where icloud_href is not null;
delete from public.icloud_outbox where href is not null;

-- ── E. Undo ──────────────────────────────────────────────────────────────────
-- 173's list, plus the area key (an undo never puts back a link that names nothing in iCloud).
create or replace function public.app_undo_links(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'tasks' then array['google_task_id', 'google_tasklist_id', 'google_calendar_event_id']::text[]
    when 'time_blocks' then array['google_calendar_event_id', 'icloud_area', 'icloud_href']::text[]
    when 'schedule_blocks' then array['google_calendar_event_id', 'icloud_area', 'icloud_href']::text[]
    when 'user_movie_entries' then array['trakt_note_id']::text[]
    when 'user_tv_entries' then array['trakt_note_id']::text[]
    when 'user_tv_episodes' then array['trakt_note_id']::text[]
    else '{}'::text[]
  end
$$;

-- 173's list, plus iCloud's version of an event (icloud_etag): bookkeeping, never put back nor compared.
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
                                                'icloud_from', 'icloud_horizon', 'icloud_etag']::text[]
              when 'time_blocks' then array['icloud_etag']::text[]
              when 'user_movie_entries' then array['trakt_note_text']::text[]
              when 'user_tv_entries' then array['trakt_note_text']::text[]
              when 'supplement_schedules' then array['stock_set_at']::text[]
              else '{}'::text[]
            end
$$;


grant execute on function public.app_undo_bookkeeping(text) to authenticated;
grant execute on function public.app_undo_links(text) to authenticated;
