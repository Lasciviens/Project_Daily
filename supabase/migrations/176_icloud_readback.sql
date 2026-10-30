-- ═══════════════════════════════════════════════════════════════════════════
-- 176 — Calendar 2c: changes made in Apple Calendar come back to the app
-- (docs/features/calendar-plan.md). icloud-calendar reads each area
-- calendar's changes (an RFC 6578 sync token per calendar; the first time,
-- every event, so a change made before 2c comes back too) before it sends
-- anything, and applies the app's OWN events only — the rules are Google's
-- read-back's (155, apply_calendar_readback):
--   a slot's event   moved / renamed → the slot and its task follow — only a
--                    change the iPhone stamped (LAST-MODIFIED) after the
--                    slot's own last change (the app's own write read back, or
--                    an older change: the app's version stays and is sent);
--                    deleted → the item lets go of Apple Calendar
--                    (its calendar presence turns off; an all-day presence
--                    slot goes), the item itself stays
--   a plan's series  renamed → the plan follows; deleted → the plan lets go of
--                    Apple Calendar; its rule or time edited there is not
--                    followed (the app's own rule goes back with its next push)
--   one day of it    moved there → that day becomes an item of its own (142,
--                    item_occurrence) at the new day and time, and gets its own
--                    event; deleted there → that day becomes its own item, off
--                    the calendar (never deleted or cancelled)
-- What it applies is queued back like any change (no read-back flag): the
-- app's version goes to iCloud once (the same data), and a database rule the
-- move sets off (a training session moved 7+ days, 167) reaches Apple too.
--
--   A. icloud_sync_state: per account and area calendar, its sync token and
--      the name and colour the app last gave it (so a rename made on the
--      iPhone comes back into Settings → Calendar, and one made in the app
--      isn't mistaken for it). Service role only; owner lock. Not audited:
--      sync bookkeeping, never typed by the owner.
--   B. apply_icloud_readback: one change, checked where it enters (a bad value
--      is ignored, never applied), scoped to the row's own account and to the
--      area calendar it was read from.
--   C. The timer every 5 minutes while an account has an area on Apple (the
--      read-back needs it even when nothing is queued), still only for
--      accounts connected to iCloud.
-- Re-runnable: IF NOT EXISTS, CREATE OR REPLACE, the cron guard. No top-level BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Where each area calendar's read-back stands ──────────────────────────
create table if not exists public.icloud_sync_state (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area          text not null check (area in ('training', 'work', 'personal', 'media', 'football')),
  sync_token    text,
  written_name  text,
  written_color text,
  synced_at     timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, area)
);
alter table public.icloud_sync_state enable row level security;
revoke all on public.icloud_sync_state from anon, authenticated;
grant select, insert, update, delete on public.icloud_sync_state to service_role;
comment on table public.icloud_sync_state is
  'Per account and area calendar: the iCloud sync token of the read-back (176) and the name/colour the app last wrote. Service role only.';
drop trigger if exists trg_icloud_sync_state_updated_at on public.icloud_sync_state;
create trigger trg_icloud_sync_state_updated_at before update on public.icloud_sync_state
  for each row execute function public.update_updated_at();

-- ── B. One change from Apple Calendar ───────────────────────────────────────
-- p_change: { deleted } or { title, allDay, date, time, minutes, busy, lastModified } for a slot, and for a plan
-- { title, lastModified, days: [{ originalDate, cancelled } | { originalDate, allDay, date, time, minutes, busy, title }] }.
-- p_etag: iCloud's version of the event as read (kept for If-Match). Answers: unlinked | moved | renamed | same |
-- stale | days | ignored | not_ours.
create or replace function public.apply_icloud_readback(p_user uuid, p_entity text, p_id uuid, p_area text, p_change jsonb, p_etag text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted  boolean;
  v_title    text;
  v_allday   boolean;
  v_date     date;
  v_time     time;
  v_minutes  integer;
  v_busy     boolean;
  v_modified timestamptz;
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
     or p_area is null or p_area not in ('training', 'work', 'personal', 'media', 'football')
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
  exception when others then
    return 'ignored';
  end;
  v_title := nullif(btrim(left(regexp_replace(coalesce(p_change ->> 'title', ''), '[[:cntrl:]]', '', 'g'), 500)), '');
  if v_allday then v_time := null; end if;
  if v_time is null then v_busy := false; end if;
  v_minutes := least(1440, greatest(1, coalesce(v_minutes, 60)));

  if p_entity = 'slot' then
    -- Only a slot of this account whose event is in the calendar this was read from.
    select * into b from public.time_blocks x where x.id = p_id and x.user_id = p_user and x.icloud_area = p_area for update;
    if not found then return 'not_ours'; end if;
    if b.task_id is not null then
      select * into t from public.tasks x where x.id = b.task_id and x.user_id = p_user for update;
    end if;
    if v_deleted then
      update public.time_blocks set icloud_area = null, icloud_etag = null where id = b.id;
      if t.id is not null then
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
    -- Only a change the iPhone stamped (LAST-MODIFIED) after the app's own last change: the app's own write read back
    -- (no stamp) and an older change are never applied — the app's version stays and is sent.
    if v_modified is null or (b.updated_at is not null and v_modified <= b.updated_at) then return 'stale'; end if;
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
    if v_title is not null and v_title is distinct from coalesce(t.title, b.title) then
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
           google_target = case google_target when 'calendar' then 'none' when 'both' then 'tasks' else google_target end
     where id = p.id;
    return 'unlinked';
  end if;
  if v_etag is not null then update public.schedule_blocks set icloud_etag = v_etag where id = p.id; end if;
  if v_modified is null or (p.updated_at is not null and v_modified <= p.updated_at) then return 'stale'; end if;
  if v_title is not null and v_title is distinct from p.title then
    update public.schedule_blocks set title = v_title where id = p.id;
    v_out := 'renamed';
  end if;
  -- Its days moved or deleted there (an override, an EXDATE the app didn't write).
  for d in select value from jsonb_array_elements(case when jsonb_typeof(p_change -> 'days') = 'array' then p_change -> 'days' else '[]'::jsonb end) loop
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
    if v_orig is null or v_orig = any (coalesce(p.except_dates, '{}'::date[]))
       or exists (select 1 from public.time_blocks x where x.schedule_block_id = p.id and x.occurrence_date = v_orig)
       or not public.repeat_occurs_on(p, v_orig) then
      continue;
    end if;
    select o.block_id, o.task_id into v_block, v_task from public.item_occurrence(p.id, v_orig, v_today, p_user) o;
    if v_dcancel then
      update public.tasks set google_target = 'none' where id = v_task and user_id = p_user;
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
    v_days := v_days + 1;
  end loop;
  if v_days > 0 then return 'days'; end if;
  return v_out;
end;
$$;
revoke all on function public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text) to service_role;

-- ── C. The timer: every 5 minutes while an area is on Apple ─────────────────
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed here: lascis-icloud-calendar not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'lascis-icloud-calendar') then
    perform cron.unschedule('lascis-icloud-calendar');
  end if;
  perform cron.schedule('lascis-icloud-calendar', '*/5 * * * *', $cron$
    select net.http_post(
      url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/icloud-calendar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'ICLOUD_SYNC_SECRET'), '')
      ),
      body := jsonb_build_object('action', 'cron')
    )
    where exists (select 1 from public.icloud_outbox o join public.icloud_credentials c on c.user_id = o.user_id where o.next_try_at <= now())
       or exists (select 1 from public.icloud_credentials c where public.icloud_writes_on(c.user_id))
       or exists (select 1 from public.schedule_blocks sb join public.icloud_credentials c on c.user_id = sb.user_id
                   where sb.icloud_area is not null and sb.icloud_horizon < current_date + 90);
  $cron$);
end $$;

select public.owner_lock_apply('public.icloud_sync_state');

do $$
begin
  if has_function_privilege('authenticated', 'public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text)', 'execute')
     or has_function_privilege('anon', 'public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text)', 'execute')
     or has_function_privilege('public', 'public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text)', 'execute') then
    raise exception 'Migration 176 assertion failed: the browser can call apply_icloud_readback';
  end if;
  if has_table_privilege('authenticated', 'public.icloud_sync_state', 'select') then
    raise exception 'Migration 176 assertion failed: the browser can read icloud_sync_state';
  end if;
end $$;
