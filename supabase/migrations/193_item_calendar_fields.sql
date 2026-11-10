-- 193 · Apple's extra fields on an item (the one item screen, step 2; plan approved by the owner 10.11.2026 —
-- docs/features/item-screen-plan.md): End Repeat, Alert + Second Alert, Show As, URL and Travel Time, stored on the
-- item's slot (time_blocks) or repeat (schedule_blocks) and sent to Apple Calendar (and to Google where it has them).
-- docs/features/planning-calendar.md → Calendar fields; docs/integrations/icloud-caldav.md, google-calendar.md.
--
-- Every value here is input (the warning in AGENTS.md): the sheet, the assistant's db tools, a sync and the two
-- read-backs write these columns, and the writers put them into iCalendar lines and Google's bodies. So each column
-- takes only an allow-list (a CHECK, for every writer); the item save checks the same rules where the sheet's values
-- enter; the writers read a row through calendarEventRules' event* readers again and Apple's lines have a last guard.
--
-- A. The rules: item_alerts_ok (null = the area's own alert, as before; '{}' = none; one or two of Apple's list, each
--    once, in order) and item_url_ok (https, a host name, no user name, only URL characters, at most 2048).
-- B. The columns, on both tables: alerts, show_as ('busy' | 'free'; null = by its length, as before), url, and
--    travel_minutes (null = automatic — Time to Leave from the place's pin, as since 186; 0 = none; 5–120). A new slot
--    that names none of them (the time_blocks defaults: "not given") takes its plan's when it is a day split off one,
--    as its place does (186); anything else none. An explicit null stays null, so Undo puts a row back as it was.
-- C. End Repeat on a repeat: repeat_until (the last day it may occur, included) and repeat_count ("after N times",
--    1–999). With a count the database keeps repeat_until at its Nth day (repeat_count_end: the kind's own pattern
--    from effective_from, days taken out counted — recurrence.countEndDay's copy), so every reader only compares a
--    day. repeat_occurs_on (160) honours it: no day of a repeat after its end, for every server rule (repeat days,
--    training weeks, the read-backs). An end before the start is refused (a CHECK, and the save's own message).
-- D. The one item save takes alerts / showAs / url / travelMinutes / repeatEnd (a key left out: keep the item's) —
--    186's body with only the 193 lines added (verify-db-item-calendar-fields compares them); it answers
--    calendarFields = true, so a browser can tell a database without 193 (it would drop them without a word).
-- E. A changed field is a change of the event: Apple's queue triggers compare every new column, Google's upsert
--    trigger Show As and the alerts (Google has no URL or travel time) — 186's bodies with only these added.
-- F. The read-backs: an item whose Show As is set reads an event's Busy / Free into Show As and keeps its length
--    (before 193 — and still for an item without one — Free there meant "no length"); Apple's also takes the alerts,
--    the link and the travel time the iPhone changed, each by the same rules (a value that fails is left out). A
--    repeat's End Repeat changed on the iPhone is its rule: not followed, as no rule edit there is. 155's and 178's
--    bodies with only the 193 lines added.
--
-- Nothing is backfilled: every existing row keeps null (the area's alert, Busy by its length, the day link, Time to
-- Leave as before, never ending). Re-runnable (IF NOT EXISTS, DROP … IF EXISTS, CREATE OR REPLACE). No BEGIN/COMMIT:
-- the deploy runs it as one transaction.

-- ── A. What the fields may hold ─────────────────────────────────────────────
-- CASE, not AND: Postgres doesn't promise the order of AND, and a subscript of an odd array would answer null.
create or replace function public.item_alerts_ok(p integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or cardinality(p) = 0 then true
    when array_ndims(p) <> 1 or array_lower(p, 1) <> 1 or cardinality(p) > 2 then false
    when array_position(p, null) is not null then false
    when not (p <@ array[0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080]) then false
    when cardinality(p) = 2 and p[1] = p[2] then false
    else true
  end
$$;

-- https, a host name (letters, digits, hyphens and dots — no user name, no bracketed IP), an optional port, then only
-- URL characters with % followed by two hex digits: no space, quote, angle bracket, backslash or control character,
-- so nothing in it can end an iCalendar line or a quoted value (calendarEventRules.ITEM_URL is the same pattern).
create or replace function public.item_url_ok(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null then true
    when length(p) > 2048 then false
    else p ~ '^https://[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?::[0-9]{1,5})?(?:[/?#](?:%[0-9A-Fa-f]{2}|[A-Za-z0-9._~!$&''()*+,;=:@/?#-])*)?$'
  end
$$;

-- ── B. The columns ───────────────────────────────────────────────────────────
alter table public.time_blocks add column if not exists alerts integer[];
alter table public.time_blocks add column if not exists show_as text;
alter table public.time_blocks add column if not exists url text;
alter table public.time_blocks add column if not exists travel_minutes integer;
alter table public.schedule_blocks add column if not exists alerts integer[];
alter table public.schedule_blocks add column if not exists show_as text;
alter table public.schedule_blocks add column if not exists url text;
alter table public.schedule_blocks add column if not exists travel_minutes integer;
alter table public.schedule_blocks add column if not exists repeat_until date;
alter table public.schedule_blocks add column if not exists repeat_count integer;
-- "Not given" on a new slot (B); existing rows stay null. Never stored: the trigger below replaces each one, and the
-- CHECKs refuse it.
alter table public.time_blocks alter column alerts set default '{-1}'::integer[];
alter table public.time_blocks alter column show_as set default '';
alter table public.time_blocks alter column url set default '';
alter table public.time_blocks alter column travel_minutes set default -1;

alter table public.time_blocks drop constraint if exists time_blocks_alerts_ok;
alter table public.time_blocks add constraint time_blocks_alerts_ok check (public.item_alerts_ok(alerts));
alter table public.time_blocks drop constraint if exists time_blocks_show_as_ok;
alter table public.time_blocks add constraint time_blocks_show_as_ok check (show_as is null or show_as in ('busy', 'free'));
alter table public.time_blocks drop constraint if exists time_blocks_url_ok;
alter table public.time_blocks add constraint time_blocks_url_ok check (public.item_url_ok(url));
alter table public.time_blocks drop constraint if exists time_blocks_travel_ok;
alter table public.time_blocks add constraint time_blocks_travel_ok check (travel_minutes is null or travel_minutes in (0, 5, 15, 30, 60, 90, 120));
alter table public.schedule_blocks drop constraint if exists schedule_blocks_alerts_ok;
alter table public.schedule_blocks add constraint schedule_blocks_alerts_ok check (public.item_alerts_ok(alerts));
alter table public.schedule_blocks drop constraint if exists schedule_blocks_show_as_ok;
alter table public.schedule_blocks add constraint schedule_blocks_show_as_ok check (show_as is null or show_as in ('busy', 'free'));
alter table public.schedule_blocks drop constraint if exists schedule_blocks_url_ok;
alter table public.schedule_blocks add constraint schedule_blocks_url_ok check (public.item_url_ok(url));
alter table public.schedule_blocks drop constraint if exists schedule_blocks_travel_ok;
alter table public.schedule_blocks add constraint schedule_blocks_travel_ok check (travel_minutes is null or travel_minutes in (0, 5, 15, 30, 60, 90, 120));
alter table public.schedule_blocks drop constraint if exists schedule_blocks_repeat_count_ok;
alter table public.schedule_blocks add constraint schedule_blocks_repeat_count_ok check (repeat_count is null or repeat_count between 1 and 999);
alter table public.schedule_blocks drop constraint if exists schedule_blocks_repeat_until_ok;
alter table public.schedule_blocks add constraint schedule_blocks_repeat_until_ok check (repeat_until is null or (repeat_until >= effective_from and repeat_until <= date '9999-12-31'));

comment on column public.time_blocks.alerts is
  'Alert and Second Alert (193): minutes before the start from Apple''s list (0 = at the time; all day: 0 on the day, '
  '1440/2880/10080 days before, at 09:00); ''{}'' = none; null = the area''s own alert. Checked by item_alerts_ok().';
comment on column public.time_blocks.show_as is
  'Show As (193): busy | free on Apple and Google; null = by its length (Busy with one, Free without and all day).';
comment on column public.time_blocks.url is
  'The item''s own link (193): Apple''s URL field (else the link to its day in the app); Google has no such field. '
  'https only, at most 2048 characters — checked by item_url_ok().';
comment on column public.time_blocks.travel_minutes is
  'Travel Time (193): 0 = none, 5–120 minutes (Apple''s X-APPLE-TRAVEL-DURATION); null = automatic (Time to Leave from '
  'the place''s map pin). Google has no travel time.';
comment on column public.schedule_blocks.alerts is 'Alert and Second Alert of the repeat (193), as time_blocks.alerts.';
comment on column public.schedule_blocks.show_as is 'Show As of the repeat (193), as time_blocks.show_as.';
comment on column public.schedule_blocks.url is 'The repeat''s own link (193), as time_blocks.url.';
comment on column public.schedule_blocks.travel_minutes is 'Travel Time of the repeat (193), as time_blocks.travel_minutes.';
comment on column public.schedule_blocks.repeat_until is
  'End Repeat (193): the last day it may occur, included; null = never. With repeat_count the database keeps it at the '
  'Nth day (repeat_count_end) — never written by hand then.';
comment on column public.schedule_blocks.repeat_count is
  'End Repeat "after N times" (193): 1–999, counted from effective_from on the kind''s own pattern (days taken out count).';

-- A new slot that names none (the defaults above): a day split off a plan takes the plan's (a training session moved
-- to another day keeps its alert); anything else none.
create or replace function public.time_block_calendar_fill()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_alerts integer[];
  v_show   text;
  v_url    text;
  v_travel integer;
begin
  if new.alerts = '{-1}'::integer[] or new.show_as = '' or new.url = '' or new.travel_minutes = -1 then
    if tg_op = 'INSERT' and new.schedule_block_id is not null then
      select s.alerts, s.show_as, s.url, s.travel_minutes into v_alerts, v_show, v_url, v_travel
        from public.schedule_blocks s where s.id = new.schedule_block_id and s.user_id = new.user_id;
    end if;
    if new.alerts = '{-1}'::integer[] then new.alerts := v_alerts; end if;
    if new.show_as = '' then new.show_as := v_show; end if;
    if new.url = '' then new.url := v_url; end if;
    if new.travel_minutes = -1 then new.travel_minutes := v_travel; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_time_block_calendar_fill on public.time_blocks;
create trigger trg_time_block_calendar_fill
  before insert or update of alerts, show_as, url, travel_minutes on public.time_blocks
  for each row execute function public.time_block_calendar_fill();

-- ── C. End Repeat ────────────────────────────────────────────────────────────
-- The day of the Nth time: the kind's own pattern from p_start (days taken out count — RFC 5545 counts before EXDATE),
-- within 20 years; null when there is none. recurrence.countEndDay is its browser copy (verify-db-item-calendar-fields
-- compares them).
create or replace function public.repeat_count_end(
  p_kind text, p_days integer[], p_interval integer, p_unit text, p_dates date[], p_start date, p_count integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_seen integer := 0;
  v_day  date;
begin
  if p_count is null or p_count < 1 or p_count > 999 or p_start is null then return null; end if;
  if p_kind = 'dates' then
    return (select s.d from (select distinct x as d from unnest(coalesce(p_dates, '{}'::date[])) x
                              where x >= p_start and x <= p_start + 7305) s
             order by s.d offset p_count - 1 limit 1);
  end if;
  for i in 0 .. 7305 loop
    v_day := p_start + i;
    if public.repeat_rule_occurs_on(p_kind, p_days, p_interval, p_unit, p_dates, p_start, null, v_day) then
      v_seen := v_seen + 1;
      if v_seen = p_count then return v_day; end if;
    end if;
  end loop;
  return null;
end;
$$;

-- With a count the end day is the database's, for every writer (a rule edit moves it; a hand-written one is replaced).
create or replace function public.schedule_block_repeat_end()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.repeat_count is not null then
    new.repeat_until := public.repeat_count_end(new.repeat_kind, new.days_of_week, new.repeat_interval, new.repeat_unit,
                                                new.repeat_dates, new.effective_from, new.repeat_count);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_schedule_block_repeat_end on public.schedule_blocks;
create trigger trg_schedule_block_repeat_end
  before insert or update of repeat_count, repeat_until, repeat_kind, days_of_week, repeat_interval, repeat_unit,
                             repeat_dates, effective_from on public.schedule_blocks
  for each row execute function public.schedule_block_repeat_end();

-- A plan (schedule_blocks) asks the one rule — 160's body, and never after its End Repeat.
create or replace function public.repeat_occurs_on(p public.schedule_blocks, p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.repeat_rule_occurs_on(p.repeat_kind, p.days_of_week, p.repeat_interval, p.repeat_unit, p.repeat_dates,
                                      p.effective_from, p.except_dates, p_day)
     and (p.repeat_until is null or p_day <= p.repeat_until)
$$;

-- ── D. The one item save takes the fields (186's body + the 193 lines) ───────

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
  v_labels    text[] := case when jsonb_typeof(p_item -> 'labels') = 'array' then array(
                          select e #>> '{}' from jsonb_array_elements(p_item -> 'labels') e where jsonb_typeof(e) = 'string') end;
  -- 183: the sheet's zone; one the database doesn't know is left out (an edit keeps the item's, a new item takes
  -- the phone's or the home zone) — a phone reporting an old name never fails a save.
  v_zone      text := case when public.time_zone_ok(btrim(p_item ->> 'timeZone')) then btrim(p_item ->> 'timeZone') end;
  -- 186: the sheet's place — no 'place' key: keep the item's; null: none; an object: checked below.
  v_has_place boolean := p_item ? 'place';
  v_place     jsonb := case when jsonb_typeof(p_item -> 'place') = 'object' then p_item -> 'place' end;
  v_old_place jsonb;  -- a repeat turned into a one-off: the place it had
  -- 193: the item's calendar fields — a key left out: keep the item's; null: none of its own (alerts: the area's,
  -- showAs: by its length, travelMinutes: automatic, repeatEnd: never); a value: checked below.
  v_has_alerts boolean := p_item ? 'alerts';
  v_alerts     integer[];
  v_has_show   boolean := p_item ? 'showAs';
  v_show       text := nullif(p_item ->> 'showAs', '');
  v_has_url    boolean := p_item ? 'url';
  v_url        text := nullif(btrim(coalesce(p_item ->> 'url', '')), '');
  v_has_travel boolean := p_item ? 'travelMinutes';
  v_travel     integer;
  v_has_end    boolean := p_item ? 'repeatEnd';
  v_until      date;
  v_count      integer;
  v_old_alerts integer[];  -- the one-off a repeat was (or the repeat a one-off was): its fields
  v_old_show   text;
  v_old_url    text;
  v_old_travel integer;
  v_src_type  text := nullif(p_item #>> '{source,type}', '');
  v_src_raw   text := nullif(p_item #>> '{source,id}', '');
  -- The sheet's extras: the slot's (and a repeat's) look, a window's start,
  -- the slot's own origin (time_blocks' vocabulary, a TV episode's numbers).
  v_cat_in    text := nullif(p_item ->> 'category', '');
  v_color_in  text := nullif(p_item ->> 'color', '');
  v_has_start boolean := p_item ? 'startDate';
  v_start     date := nullif(p_item ->> 'startDate', '')::date;
  v_bsrc      jsonb := case when jsonb_typeof(p_item -> 'blockSource') = 'object' then p_item -> 'blockSource' end;
  v_bsrc_type text;
  v_bsrc_id   uuid;
  v_season    integer;
  v_episode   integer;
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
  v_due_date  date;
  v_due_time  time;
  v_day_task  uuid;
  v_plan_target text;
  v_day_link  record;
  v_day_plan  uuid;
  v_keep_start boolean := false;
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
  if v_bsrc is not null then
    v_bsrc_type := public.item_block_source(nullif(v_bsrc ->> 'type', ''));
    if (v_bsrc ->> 'id') ~ v_uuid_re then v_bsrc_id := (v_bsrc ->> 'id')::uuid; end if;
    v_season := nullif(v_bsrc ->> 'seasonNumber', '')::integer;
    v_episode := nullif(v_bsrc ->> 'episodeNumber', '')::integer;
  end if;
  if v_cat_in is not null and v_cat_in not in ('daily', 'training', 'media', 'games', 'work', 'projects', 'football', 'other') then v_cat_in := null; end if;
  if v_time is null then v_minutes := null; end if;
  if v_minutes is not null and (v_minutes < 1 or v_minutes > 1440) then
    raise exception 'A length is 1 minute to 24 hours' using errcode = 'IT005';
  end if;
  if v_section is not null and v_section not in ('inbox', 'today', 'backlog') then v_section := null; end if;
  if v_has_place and jsonb_typeof(p_item -> 'place') not in ('object', 'null') then
    raise exception 'That place can''t be saved' using errcode = '22023';
  end if;
  if v_place is not null and (v_place = '{}'::jsonb or not public.place_ok(v_place)) then
    raise exception 'That place can''t be saved' using errcode = '22023';
  end if;
  -- 193: each calendar field checked where it enters, by the columns' own rules (item_alerts_ok, item_url_ok, the
  -- travel and Show As lists) — a value that fails stops the save with a message, never dropped without a word.
  if v_has_alerts and (jsonb_typeof(p_item -> 'alerts') not in ('array', 'null')
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_item -> 'alerts') = 'array' then p_item -> 'alerts' else '[]'::jsonb end) e
                 where jsonb_typeof(e) <> 'number' or e::text !~ '^[0-9]{1,5}$')) then
    raise exception 'Those alerts can''t be saved' using errcode = '22023';
  end if;
  if jsonb_typeof(p_item -> 'alerts') = 'array' then
    v_alerts := array(select x.e::text::integer from jsonb_array_elements(p_item -> 'alerts') with ordinality as x(e, n) order by x.n);
    if not public.item_alerts_ok(v_alerts) then
      raise exception 'Those alerts can''t be saved' using errcode = '22023';
    end if;
  end if;
  if v_has_show and (jsonb_typeof(p_item -> 'showAs') not in ('string', 'null') or v_show not in ('busy', 'free')) then
    raise exception 'Show As is Busy or Free' using errcode = '22023';
  end if;
  if v_has_url and (jsonb_typeof(p_item -> 'url') not in ('string', 'null') or (v_url is not null and not public.item_url_ok(v_url))) then
    raise exception 'That link can''t be saved: a web address starting with https:// (at most 2048 characters)' using errcode = '22023';
  end if;
  if v_has_travel and (jsonb_typeof(p_item -> 'travelMinutes') not in ('number', 'null')
     or (jsonb_typeof(p_item -> 'travelMinutes') = 'number'
         and ((p_item ->> 'travelMinutes') !~ '^[0-9]{1,3}$' or (p_item ->> 'travelMinutes')::integer not in (0, 5, 15, 30, 60, 90, 120)))) then
    raise exception 'That travel time can''t be saved' using errcode = '22023';
  end if;
  if jsonb_typeof(p_item -> 'travelMinutes') = 'number' then v_travel := (p_item ->> 'travelMinutes')::integer; end if;
  if v_has_end and jsonb_typeof(p_item -> 'repeatEnd') not in ('object', 'null') then
    raise exception 'End Repeat is never, a day or a number of times' using errcode = '22023';
  end if;
  if jsonb_typeof(p_item -> 'repeatEnd') = 'object' then
    if exists (select 1 from jsonb_object_keys(p_item -> 'repeatEnd') k where k not in ('until', 'count'))
       or ((p_item -> 'repeatEnd') ? 'until') = ((p_item -> 'repeatEnd') ? 'count')
       or ((p_item -> 'repeatEnd') ? 'until' and coalesce(p_item #>> '{repeatEnd,until}', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
       or ((p_item -> 'repeatEnd') ? 'count' and (jsonb_typeof(p_item #> '{repeatEnd,count}') <> 'number'
           or (p_item #>> '{repeatEnd,count}') !~ '^[0-9]{1,3}$' or (p_item #>> '{repeatEnd,count}')::integer not between 1 and 999)) then
      raise exception 'End Repeat is never, a day or 1 to 999 times' using errcode = '22023';
    end if;
    v_until := (p_item #>> '{repeatEnd,until}')::date;
    v_count := (p_item #>> '{repeatEnd,count}')::integer;
  end if;

  -- 156: a repeat sent with a day's task (its sheet opened from a list) is
  -- that day's repeat — All days of it, never a second repeat; its start stays.
  if v_repeat is not null and v_scope <> 'day' and v_plan_id is null and v_task_id is not null then
    select x.schedule_block_id into v_day_plan from public.tasks x
     where x.id = v_task_id and x.user_id = v_user and x.occurrence_date is not null
       and exists (select 1 from public.schedule_blocks s where s.id = x.schedule_block_id);
    if v_day_plan is not null then
      v_plan_id := v_day_plan;
      v_scope := 'all';
      v_task_id := null;
      v_block_id := null;
      v_keep_start := true;
    end if;
  end if;

  -- ── A repeating item's rule ────────────────────────────────────────────
  if v_repeat is not null and v_scope <> 'day' then
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
      if v_keep_start then v_starts := least(p.effective_from, coalesce(v_dates[1], p.effective_from)); end if;
      if (v_has_end and v_until < v_starts) or (not v_has_end and p.repeat_count is null and p.repeat_until < v_starts) then
        raise exception 'The repeat ends before it starts: pick a later End Repeat' using errcode = 'IT007';
      end if;
      update public.schedule_blocks set
        title = v_title, notes = v_notes, domain = v_domain, priority = v_priority,
        days_of_week = v_days, repeat_kind = v_kind, repeat_interval = v_interval, repeat_unit = v_unit, repeat_dates = v_dates,
        effective_from = v_starts, start_time = v_time, end_time = v_end, busy = v_busy,
        category = coalesce(v_cat_in, p.category), color = coalesce(v_color_in, p.color),
        time_zone = coalesce(v_zone, p.time_zone),
        place = case when v_has_place then v_place else p.place end,
        alerts = case when v_has_alerts then v_alerts else p.alerts end,
        show_as = case when v_has_show then v_show else p.show_as end,
        url = case when v_has_url then v_url else p.url end,
        travel_minutes = case when v_has_travel then v_travel else p.travel_minutes end,
        repeat_until = case when v_has_end then v_until else p.repeat_until end,
        repeat_count = case when v_has_end then v_count else p.repeat_count end,
        google_target = v_google, updated_at = now()
      where id = v_plan_id;
    else
      v_task_src := public.item_task_source(v_src_type);
      v_category := coalesce(v_cat_in, public.item_default_category(v_domain, v_task_src));
      -- A one-off item turned into a repeat: its slot's category stays.
      if v_task_id is not null and v_cat_in is null then
        select * into b from public.time_blocks x where x.task_id = v_task_id and x.user_id = v_user;
        if found then v_category := b.category; end if;
      end if;
      if v_until < v_starts then
        raise exception 'The repeat ends before it starts: pick a later End Repeat' using errcode = 'IT007';
      end if;
      -- 193: a one-off turned into a repeat keeps its calendar fields, as it keeps its place.
      if v_task_id is not null then
        select x.alerts, x.show_as, x.url, x.travel_minutes into v_old_alerts, v_old_show, v_old_url, v_old_travel
          from public.time_blocks x where x.task_id = v_task_id and x.user_id = v_user;
      end if;
      insert into public.schedule_blocks (user_id, title, notes, domain, priority, days_of_week, repeat_kind, repeat_interval,
                                          repeat_unit, repeat_dates, effective_from, start_time, end_time, busy, color, category,
                                          google_target, time_zone, place, alerts, show_as, url, travel_minutes,
                                          repeat_until, repeat_count)
      values (v_user, v_title, v_notes, v_domain, v_priority, v_days, v_kind, v_interval, v_unit, v_dates, v_starts,
              v_time, v_end, v_busy, coalesce(v_color_in, 'blue'), v_category, v_google, coalesce(v_zone, ''),
              case when v_has_place then v_place
                   else coalesce((select x.place from public.time_blocks x where x.task_id = v_task_id and x.user_id = v_user), '{}'::jsonb) end,
              case when v_has_alerts then v_alerts else v_old_alerts end, case when v_has_show then v_show else v_old_show end,
              case when v_has_url then v_url else v_old_url end, case when v_has_travel then v_travel else v_old_travel end,
              v_until, v_count)
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
    -- 156: its untouched days from today on follow the rule, and today's task
    -- is made now when the repeat has today (the job would make it within the hour).
    v_day_task := public.repeat_days_follow_rule(v_plan_id, v_today, v_connected);
    -- Only a day still waiting for its Google Task is worth waiting for (a
    -- series moving to Google Tasks goes once it is there); one ticked or not
    -- on Google Tasks: nothing to wait for.
    select x.id into v_day_task from public.tasks x
     where x.id = v_day_task and x.status in ('open', 'in_progress', 'waiting') and x.google_sync_enabled;
    return jsonb_build_object('taskId', null, 'blockId', null, 'scheduleBlockId', v_plan_id, 'created', v_created,
                              'replacedTaskId', v_replaced_task, 'replacedEventId', v_replaced_event, 'occurrence', false,
                              'dayTaskId', v_day_task, 'calendarFields', true);
  end if;

  -- 156: a day's task opened as a plain item (Home's list, the Tasks tab) is
  -- still that day of its repeat: its edit is the day's ("This day" — 142's
  -- split, reusing the task), never a slot its repeat doesn't know about.
  if v_repeat is null and v_scope = 'item' and v_task_id is not null and v_block_id is null then
    select x.schedule_block_id, x.occurrence_date into v_day_link from public.tasks x
     where x.id = v_task_id and x.user_id = v_user and x.schedule_block_id is not null and x.occurrence_date is not null
       and not exists (select 1 from public.time_blocks y where y.task_id = x.id);
    if v_day_link.schedule_block_id is not null then
      v_plan_id := v_day_link.schedule_block_id;
      v_occ := v_day_link.occurrence_date;
      v_scope := 'day';
    end if;
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
    -- A day of a repeat on Google Tasks (156) keeps it; a day of any other
    -- repeat doesn't move there on its own (its series holds the day).
    select public.repeat_day_target(s) into v_plan_target from public.schedule_blocks s where s.id = v_plan_id;
    if v_google in ('tasks', 'both') and coalesce(v_plan_target, 'none') not in ('tasks', 'both') then v_google := 'calendar'; end if;
  end if;

  -- ── A one-off item (or that day) ────────────────────────────────────────
  if v_time is not null and v_date is null then
    raise exception 'A time needs a day' using errcode = 'IT003';
  end if;
  if v_google in ('calendar', 'both') and v_date is null then
    raise exception 'Google Calendar needs a day: pick one, or choose Google Tasks' using errcode = 'IT003';
  end if;

  -- A repeating item given "no repeat" becomes a one-off item: only when the
  -- save edits the rule itself (scope 'all', no task or slot of its own) —
  -- never by leaving the repeat out of a day's or an item's save. The rule
  -- goes (its series through the calendar outbox); days already split off stay.
  if v_repeat is null and v_plan_id is not null and v_scope = 'all' and not v_is_occ
     and v_task_id is null and v_block_id is null then
    select s.google_calendar_event_id, s.place, s.alerts, s.show_as, s.url, s.travel_minutes
      into v_replaced_event, v_old_place, v_old_alerts, v_old_show, v_old_url, v_old_travel
      from public.schedule_blocks s where s.id = v_plan_id and s.user_id = v_user;
    delete from public.schedule_blocks where id = v_plan_id and user_id = v_user;
    if found then v_replaced_plan := v_plan_id; else v_replaced_event := null; end if;
    v_plan_id := null;
  end if;

  if v_task_id is null and v_block_id is not null then
    -- An old standalone slot opened in the sheet: it gets its task now.
    select * into b from public.time_blocks x where x.id = v_block_id and x.user_id = v_user for update;
    if not found then raise exception 'This item is not there any more' using errcode = 'IT004'; end if;
    v_task_id := b.task_id;
    if v_src_type is null and b.source_type is not null then
      v_src_type := b.source_type; v_src_id := coalesce(v_src_id, b.source_id);
    end if;
  end if;

  -- A training session's day IS its deadline (142 moves the two together):
  -- it never has one of its own.
  if v_task_id is not null then
    select * into t from public.tasks x where x.id = v_task_id and x.user_id = v_user for update;
    if not found then raise exception 'This item is not there any more' using errcode = 'IT004'; end if;
  end if;
  v_task_src := case when v_src_type is not null then public.item_task_source(v_src_type) else coalesce(t.source_type, 'manual') end;
  if v_task_src = 'training_session' or t.hevy_routine_id is not null then
    v_dl_date := null; v_dl_time := null;
  end if;
  -- "+ Deadline" is the task's due; without one, the due is the item's own day and time.
  v_due_date := coalesce(v_dl_date, v_date);
  v_due_time := case when v_dl_date is not null then v_dl_time else v_time end;

  if v_task_id is null then
    v_sync := v_connected and v_google in ('tasks', 'both');
    insert into public.tasks (user_id, title, description, domain, section, status, priority, start_date, due_date, due_time,
                             source_type, source_id, google_target, google_sync_enabled, google_tasklist_id, labels)
    values (v_user, v_title, v_notes, v_domain, coalesce(v_section, public.item_section_for_day(v_date, v_today)), 'open',
            v_priority, v_start, v_due_date, v_due_time, v_task_src, v_src_id, v_google, v_sync, v_list, coalesce(v_labels, '{}'))
    returning * into t;
    v_task_id := t.id;
  else
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
      start_date = case when v_has_start then v_start else t.start_date end,
      due_date = v_due_date, due_time = v_due_time,
      google_target = v_google, google_sync_enabled = v_sync,
      google_tasklist_id = coalesce(v_list, t.google_tasklist_id),
      labels = coalesce(v_labels, t.labels),
      source_type = v_task_src,
      source_id = case when v_src_type is not null then v_src_id else t.source_id end
    where id = v_task_id
    returning * into t;
  end if;

  -- The slot: the item's day and time — wanted for a time, for a day on
  -- Google Calendar, and for a day whose deadline is elsewhere.
  v_want_blk := v_time is not null
    or (v_date is not null and (v_google in ('calendar', 'both') or v_dl_date is not null));
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
        busy = v_busy, title = v_title, task_id = v_task_id,
        time_zone = coalesce(v_zone, b.time_zone),
        place = case when v_has_place then v_place else b.place end,
        alerts = case when v_has_alerts then v_alerts else b.alerts end,
        show_as = case when v_has_show then v_show else b.show_as end,
        url = case when v_has_url then v_url else b.url end,
        travel_minutes = case when v_has_travel then v_travel else b.travel_minutes end,
        category = coalesce(v_cat_in, b.category), color = coalesce(v_color_in, b.color),
        source_type = case when v_bsrc is not null then v_bsrc_type else b.source_type end,
        source_id = case when v_bsrc is not null then v_bsrc_id else b.source_id end,
        season_number = case when v_bsrc is not null then v_season else b.season_number end,
        episode_number = case when v_bsrc is not null then v_episode else b.episode_number end,
        updated_at = now()
      where id = v_block_id;
    else
      insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, busy, color, category, task_id,
                                      source_type, source_id, season_number, episode_number, time_zone, place,
                                      alerts, show_as, url, travel_minutes)
      values (v_user, v_date, v_title, v_time, case when v_time is null then 60 else coalesce(v_minutes, 15) end, v_busy,
              coalesce(v_color_in, 'accent'), coalesce(v_cat_in, public.item_default_category(v_domain, t.source_type)), v_task_id,
              case when v_bsrc is not null then v_bsrc_type else public.item_block_source(coalesce(v_src_type, t.source_type)) end,
              case when v_bsrc is not null then v_bsrc_id else coalesce(v_src_id, t.source_id) end,
              v_season, v_episode, coalesce(v_zone, ''), case when v_has_place then v_place else coalesce(v_old_place, '{}'::jsonb) end,
              case when v_has_alerts then v_alerts else v_old_alerts end, case when v_has_show then v_show else v_old_show end,
              case when v_has_url then v_url else v_old_url end, case when v_has_travel then v_travel else v_old_travel end)
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
    'googleSyncWas', v_sync_was, 'googleSync', t.google_sync_enabled, 'labels', to_jsonb(t.labels), 'calendarFields', true);
end;
$$;



-- ── E. A changed field re-sends the event (186's bodies + the 193 columns) ──

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
                           new.source_type, new.task_id, new.notes, new.time_zone, new.place, new.alerts, new.show_as, new.url, new.travel_minutes, new.user_id)
        is not distinct from (old.date, old.start_time, old.duration_minutes, old.title, old.busy, old.category,
                              old.source_type, old.task_id, old.notes, old.time_zone, old.place, old.alerts, old.show_as, old.url, old.travel_minutes, old.user_id) then
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
                           new.category, new.domain, new.google_target, new.notes, new.google_calendar_time_zone, new.time_zone, new.place, new.alerts, new.show_as, new.url, new.travel_minutes,
                           new.repeat_until, new.repeat_count, new.user_id)
        is not distinct from (old.title, old.start_time, old.end_time, old.busy, old.days_of_week, old.repeat_kind,
                              old.repeat_interval, old.repeat_unit, old.repeat_dates, old.effective_from, old.except_dates,
                              old.category, old.domain, old.google_target, old.notes, old.google_calendar_time_zone, old.time_zone, old.place, old.alerts, old.show_as, old.url, old.travel_minutes,
                              old.repeat_until, old.repeat_count, old.user_id) then
    return null;
  end if;
  if new.icloud_area is not null or public.icloud_writes_on(new.user_id) then
    perform public.icloud_enqueue(new.user_id, 'plan', new.id, null);
  end if;
  return null;
end;
$$;

create or replace function public.enqueue_calendar_event_upsert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.calendar_readback', true), '') = 'on' then return null; end if;
  if new.google_calendar_event_id is null or new.google_calendar_event_id is distinct from old.google_calendar_event_id then
    return null;
  end if;
  if (new.title, new.date, new.start_time, new.duration_minutes, new.busy, new.time_zone, new.place, new.show_as, new.alerts)
     is not distinct from (old.title, old.date, old.start_time, old.duration_minutes, old.busy, old.time_zone, old.place, old.show_as, old.alerts) then
    return null;
  end if;
  perform public.calendar_outbox_request_upsert(new.user_id, new.google_calendar_event_id, new.id,
    jsonb_build_object('fields', 'all', 'title', new.title, 'date', new.date, 'start_time', new.start_time));
  return null;
end;
$$;

-- ── F. The read-backs (155's and 178's bodies + the 193 lines) ─────────────

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
  -- 193: the event's Busy / Free, taken only for an item whose Show As is set.
  v_show    text := case when p_event ->> 'showAs' in ('busy', 'free') then p_event ->> 'showAs' end;
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
        -- A slot that only put the item's day on Google Calendar goes (the
        -- item stays) — app_item_drop_block's guard: not a day split off a
        -- repeat, and the task's due IS that day (no deadline elsewhere that
        -- the slot's day stands against). Any other slot keeps the day.
        if b.start_time is null and b.schedule_block_id is null
           and t.due_date is not distinct from b.date and t.due_time is null then
          delete from public.time_blocks where id = b.id;
        end if;
      end if;
      v_out := 'unlinked';
    elsif v_updated is not null and b.updated_at is not null and v_updated <= b.updated_at then
      v_out := 'stale';
    else
      -- 193: an item whose Show As is set shows Busy / Free by it, not by its length — its length stays (a slot that
      -- had no time gets one with the time it is given).
      if b.show_as is not null then v_busy := b.start_time is null or b.busy; end if;
      if v_date is not null and ((b.date, b.start_time) is distinct from (v_date, v_time)
          or (v_time is not null and (b.duration_minutes, b.busy) is distinct from (v_minutes, v_busy))
          or (v_time is null and b.busy)) then
        update public.time_blocks set date = v_date, start_time = v_time,
               duration_minutes = case when v_time is null then duration_minutes else v_minutes end,
               busy = case when v_time is null then false else v_busy end, updated_at = now()
         where id = b.id;
        -- The task's due follows by itself (item_slot_moves_due; 142 for a
        -- training session) — only while it was the slot's own day: a
        -- deadline elsewhere stays where the owner put it.
        v_moved := true;
      end if;
      if v_title is not null and v_title is distinct from coalesce(t.title, b.title) then
        if b.task_id is not null then update public.tasks set title = v_title where id = b.task_id;
        else update public.time_blocks set title = v_title, updated_at = now() where id = b.id; end if;
        v_out := case when v_moved then 'moved' else 'renamed' end;
      else
        v_out := case when v_moved then 'moved' else 'same' end;
      end if;
      if b.show_as is not null and v_show is not null and v_show is distinct from b.show_as then
        update public.time_blocks set show_as = v_show, updated_at = now() where id = b.id;
        if v_out = 'same' then v_out := 'changed'; end if;
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
      if v_status <> 'cancelled' and p.show_as is not null and v_show is not null and v_show is distinct from p.show_as
         and (v_updated is null or p.updated_at is null or v_updated > p.updated_at) then
        update public.schedule_blocks set show_as = v_show, updated_at = now() where id = p.id;
        if v_out = 'same' then v_out := 'changed'; end if;
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
          if p.show_as is not null then v_busy := p.start_time is null or p.busy; end if;
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
  -- 193: the item's calendar fields as the iPhone has them — a key only when they differ from what the app wrote.
  v_show     text;
  v_alerts   integer[];
  v_url      text;
  v_travel   integer;
  v_fields   boolean := false;
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
    -- 193: each checked by the columns' own rules; a value that fails is left out (never applied), not the change.
    v_show := case when p_change ->> 'showAs' in ('busy', 'free') then p_change ->> 'showAs' end;
    if jsonb_typeof(p_change -> 'alerts') = 'array' and jsonb_array_length(p_change -> 'alerts') <= 2
       and not exists (select 1 from jsonb_array_elements(p_change -> 'alerts') e where jsonb_typeof(e) <> 'number' or e::text !~ '^[0-9]{1,5}$') then
      v_alerts := array(select x.e::text::integer from jsonb_array_elements(p_change -> 'alerts') with ordinality as x(e, n) order by x.n);
      if not public.item_alerts_ok(v_alerts) then v_alerts := null; end if;
    end if;
    if jsonb_typeof(p_change -> 'url') = 'string' and public.item_url_ok(p_change ->> 'url') then v_url := p_change ->> 'url'; end if;
    if jsonb_typeof(p_change -> 'travelMinutes') = 'number' and (p_change ->> 'travelMinutes') ~ '^[0-9]{1,3}$'
       and (p_change ->> 'travelMinutes')::integer in (0, 5, 15, 30, 60, 90, 120) then
      v_travel := (p_change ->> 'travelMinutes')::integer;
    end if;
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
    -- 193: an item whose Show As is set shows Busy / Free by it, not by its length — its length stays.
    if b.show_as is not null then v_busy := v_time is not null and (b.start_time is null or b.busy); end if;
    -- 193: what the iPhone changed of its calendar fields (a key is sent only for a field that differs from what the
    -- app wrote; null = none of its own: alerts the area's, travel automatic, no link).
    if b.show_as is not null and v_show is not null and v_show is distinct from b.show_as then
      update public.time_blocks set show_as = v_show where id = b.id; v_fields := true;
    end if;
    if (p_change ? 'alerts') and (v_alerts is not null or p_change -> 'alerts' = 'null'::jsonb) and v_alerts is distinct from b.alerts then
      update public.time_blocks set alerts = v_alerts where id = b.id; v_fields := true;
    end if;
    if (p_change ? 'url') and (v_url is not null or p_change -> 'url' = 'null'::jsonb) and v_url is distinct from b.url then
      update public.time_blocks set url = v_url where id = b.id; v_fields := true;
    end if;
    if (p_change ? 'travelMinutes') and (v_travel is not null or p_change -> 'travelMinutes' = 'null'::jsonb) and v_travel is distinct from b.travel_minutes then
      update public.time_blocks set travel_minutes = v_travel where id = b.id; v_fields := true;
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
    return case when v_moved then 'moved' when v_fields then 'changed' else 'same' end;
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
  -- 193: the series' calendar fields, as for a slot (its End Repeat is its rule: not followed, as no rule edit is).
  if p.show_as is not null and v_show is not null and v_show is distinct from p.show_as then
    update public.schedule_blocks set show_as = v_show where id = p.id; v_fields := true;
  end if;
  if (p_change ? 'alerts') and (v_alerts is not null or p_change -> 'alerts' = 'null'::jsonb) and v_alerts is distinct from p.alerts then
    update public.schedule_blocks set alerts = v_alerts where id = p.id; v_fields := true;
  end if;
  if (p_change ? 'url') and (v_url is not null or p_change -> 'url' = 'null'::jsonb) and v_url is distinct from p.url then
    update public.schedule_blocks set url = v_url where id = p.id; v_fields := true;
  end if;
  if (p_change ? 'travelMinutes') and (v_travel is not null or p_change -> 'travelMinutes' = 'null'::jsonb) and v_travel is distinct from p.travel_minutes then
    update public.schedule_blocks set travel_minutes = v_travel where id = p.id; v_fields := true;
  end if;
  if v_fields and v_out = 'same' then v_out := 'changed'; end if;
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
    -- 193: a plan whose Show As is set: a day's Busy / Free is its Show As, not its length.
    if p.show_as is not null then v_dbusy := v_dtime is not null and (p.start_time is null or p.busy); end if;
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

revoke all on function public.item_alerts_ok(integer[]) from public, anon;
grant execute on function public.item_alerts_ok(integer[]) to authenticated, service_role;
revoke all on function public.item_url_ok(text) from public, anon;
grant execute on function public.item_url_ok(text) to authenticated, service_role;
revoke all on function public.time_block_calendar_fill() from public, anon;
grant execute on function public.time_block_calendar_fill() to authenticated, service_role;
revoke all on function public.repeat_count_end(text, integer[], integer, text, date[], date, integer) from public, anon;
grant execute on function public.repeat_count_end(text, integer[], integer, text, date[], date, integer) to authenticated, service_role;
revoke all on function public.schedule_block_repeat_end() from public, anon;
grant execute on function public.schedule_block_repeat_end() to authenticated, service_role;
-- The read-backs stay the service role's only (a SECURITY DEFINER function a browser could otherwise call).
revoke all on function public.apply_calendar_readback(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_calendar_readback(uuid, jsonb) to service_role;
revoke all on function public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_icloud_readback(uuid, text, uuid, text, jsonb, text) to service_role;
