-- 186 · A place on an item (owner, 02.11.2026: "Dont we have something for entur entegration? Can we use that as
-- location finding?"; go 03.11.2026: "Ok. Now you can start to build the rest", with travel time left to Apple's
-- Time to Leave). docs/features/planning-calendar.md → Places.
--
-- A. time_blocks.place and schedule_blocks.place: where the item happens, as one small JSON object —
--    {"name": "Jernbanetorget", "locality": "Oslo", "lat": 59.911, "lon": 10.75, "id": "NSR:StopPlace:58366"}; only the
--    name is needed (a typed place has no pin). Apple Calendar gets the name and, with coordinates, its map pin (which
--    is what lets the iPhone's Time to Leave work); Google gets the name. A place is written into iCalendar lines, so
--    it is input (the warning in AGENTS.md): place_ok() takes only these keys, a name of 1–120 characters, a town of
--    at most 80, no control characters, coordinates as numbers in range (both or neither) and an id of a known shape —
--    a CHECK on both tables, for every writer (the sheet, the assistant, a sync).
-- B. A new slot that names no place (the column's default '{}') takes its plan's when it is a day split off one (a
--    training session moved to another day keeps its gym); anything else gets none. An explicit null stays null, so
--    Undo puts a row back as it was.
-- C. The one item save takes `place` (the sheet's; none sent: the item keeps its own — also when a one-off becomes a
--    repeat or a repeat a one-off) — 183's body with only the place lines added (verify-db-item-places compares
--    them). A place that fails place_ok stops the save with a message, never dropped without a word.
-- D. A place changed is a change of the event: Apple's queue triggers and Google's upsert trigger compare place too —
--    183's bodies with only place added.
--
-- Nothing is backfilled. Re-runnable (IF NOT EXISTS, DROP … IF EXISTS, CREATE OR REPLACE). No BEGIN/COMMIT: the
-- deploy runs it as one transaction.

-- ── A. What a place may hold ────────────────────────────────────────────────
-- CASE, not AND: Postgres doesn't promise the order of AND, and jsonb_object_keys / a numeric cast on the wrong kind
-- of value would raise instead of answering false.
create or replace function public.place_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or p = '{}'::jsonb then true
    when jsonb_typeof(p) <> 'object' or length(p::text) > 600 then false
    when exists (select 1 from jsonb_object_keys(p) k where k not in ('name', 'locality', 'lat', 'lon', 'id')) then false
    when jsonb_typeof(p -> 'name') is distinct from 'string' then false
    when char_length(btrim(p ->> 'name')) not between 1 and 120 then false
    when (p ->> 'name') ~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]' then false
    when p ? 'locality' and (jsonb_typeof(p -> 'locality') <> 'string' or char_length(p ->> 'locality') > 80
                             or (p ->> 'locality') ~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]') then false
    when (p ? 'lat') <> (p ? 'lon') then false
    when p ? 'lat' and (jsonb_typeof(p -> 'lat') <> 'number' or jsonb_typeof(p -> 'lon') <> 'number') then false
    when p ? 'lat' and not ((p ->> 'lat')::numeric between -90 and 90 and (p ->> 'lon')::numeric between -180 and 180) then false
    when p ? 'id' and (jsonb_typeof(p -> 'id') <> 'string' or (p ->> 'id') !~ '^[A-Za-z]{2,10}:[A-Za-z]{2,40}:[A-Za-z0-9._-]{1,80}$') then false
    else true
  end
$$;

alter table public.time_blocks add column if not exists place jsonb;
alter table public.schedule_blocks add column if not exists place jsonb;
-- '{}' = "not given" (B); existing rows stay null (no place).
alter table public.time_blocks alter column place set default '{}'::jsonb;
alter table public.schedule_blocks alter column place set default '{}'::jsonb;
alter table public.time_blocks drop constraint if exists time_blocks_place_ok;
alter table public.time_blocks add constraint time_blocks_place_ok check (public.place_ok(place));
alter table public.schedule_blocks drop constraint if exists schedule_blocks_place_ok;
alter table public.schedule_blocks add constraint schedule_blocks_place_ok check (public.place_ok(place));
comment on column public.time_blocks.place is
  'Where the slot happens (186): {name, locality?, lat?, lon?, id?} — Apple gets the name and map pin, Google the name; '
  'null = none. A day split off a plan takes the plan''s. Checked by place_ok().';
comment on column public.schedule_blocks.place is
  'Where the repeating plan happens (186): {name, locality?, lat?, lon?, id?}; null = none. Checked by place_ok().';

-- ── B. A place for a new slot that names none ────────────────────────────────
create or replace function public.time_block_place_fill()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.place = '{}'::jsonb then
    if tg_op = 'INSERT' and new.schedule_block_id is not null then
      -- A day of a plan is where its plan is (no plan found: none).
      select s.place into new.place
        from public.schedule_blocks s where s.id = new.schedule_block_id and s.user_id = new.user_id;
    else
      new.place := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_time_block_place on public.time_blocks;
create trigger trg_time_block_place
  before insert or update of place on public.time_blocks
  for each row execute function public.time_block_place_fill();

create or replace function public.schedule_block_place_fill()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.place = '{}'::jsonb then new.place := null; end if;
  return new;
end;
$$;
drop trigger if exists trg_schedule_block_place on public.schedule_blocks;
create trigger trg_schedule_block_place
  before insert or update of place on public.schedule_blocks
  for each row execute function public.schedule_block_place_fill();

-- ── C. The one item save takes the place (183's body + the place lines) ───────
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
      update public.schedule_blocks set
        title = v_title, notes = v_notes, domain = v_domain, priority = v_priority,
        days_of_week = v_days, repeat_kind = v_kind, repeat_interval = v_interval, repeat_unit = v_unit, repeat_dates = v_dates,
        effective_from = v_starts, start_time = v_time, end_time = v_end, busy = v_busy,
        category = coalesce(v_cat_in, p.category), color = coalesce(v_color_in, p.color),
        time_zone = coalesce(v_zone, p.time_zone),
        place = case when v_has_place then v_place else p.place end,
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
      insert into public.schedule_blocks (user_id, title, notes, domain, priority, days_of_week, repeat_kind, repeat_interval,
                                          repeat_unit, repeat_dates, effective_from, start_time, end_time, busy, color, category,
                                          google_target, time_zone, place)
      values (v_user, v_title, v_notes, v_domain, v_priority, v_days, v_kind, v_interval, v_unit, v_dates, v_starts,
              v_time, v_end, v_busy, coalesce(v_color_in, 'blue'), v_category, v_google, coalesce(v_zone, ''),
              case when v_has_place then v_place
                   else coalesce((select x.place from public.time_blocks x where x.task_id = v_task_id and x.user_id = v_user), '{}'::jsonb) end)
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
                              'dayTaskId', v_day_task);
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
    select s.google_calendar_event_id, s.place into v_replaced_event, v_old_place from public.schedule_blocks s where s.id = v_plan_id and s.user_id = v_user;
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
        category = coalesce(v_cat_in, b.category), color = coalesce(v_color_in, b.color),
        source_type = case when v_bsrc is not null then v_bsrc_type else b.source_type end,
        source_id = case when v_bsrc is not null then v_bsrc_id else b.source_id end,
        season_number = case when v_bsrc is not null then v_season else b.season_number end,
        episode_number = case when v_bsrc is not null then v_episode else b.episode_number end,
        updated_at = now()
      where id = v_block_id;
    else
      insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, busy, color, category, task_id,
                                      source_type, source_id, season_number, episode_number, time_zone, place)
      values (v_user, v_date, v_title, v_time, case when v_time is null then 60 else coalesce(v_minutes, 15) end, v_busy,
              coalesce(v_color_in, 'accent'), coalesce(v_cat_in, public.item_default_category(v_domain, t.source_type)), v_task_id,
              case when v_bsrc is not null then v_bsrc_type else public.item_block_source(coalesce(v_src_type, t.source_type)) end,
              case when v_bsrc is not null then v_bsrc_id else coalesce(v_src_id, t.source_id) end,
              v_season, v_episode, coalesce(v_zone, ''), case when v_has_place then v_place else coalesce(v_old_place, '{}'::jsonb) end)
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
    'googleSyncWas', v_sync_was, 'googleSync', t.google_sync_enabled, 'labels', to_jsonb(t.labels));
end;
$$;

-- ── D. A changed place re-sends the event (183's bodies + place) ────────────
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
                           new.source_type, new.task_id, new.notes, new.time_zone, new.place, new.user_id)
        is not distinct from (old.date, old.start_time, old.duration_minutes, old.title, old.busy, old.category,
                              old.source_type, old.task_id, old.notes, old.time_zone, old.place, old.user_id) then
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
                           new.category, new.domain, new.google_target, new.notes, new.google_calendar_time_zone, new.time_zone, new.place, new.user_id)
        is not distinct from (old.title, old.start_time, old.end_time, old.busy, old.days_of_week, old.repeat_kind,
                              old.repeat_interval, old.repeat_unit, old.repeat_dates, old.effective_from, old.except_dates,
                              old.category, old.domain, old.google_target, old.notes, old.google_calendar_time_zone, old.time_zone, old.place, old.user_id) then
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
  if (new.title, new.date, new.start_time, new.duration_minutes, new.busy, new.time_zone, new.place)
     is not distinct from (old.title, old.date, old.start_time, old.duration_minutes, old.busy, old.time_zone, old.place) then
    return null;
  end if;
  perform public.calendar_outbox_request_upsert(new.user_id, new.google_calendar_event_id, new.id,
    jsonb_build_object('fields', 'all', 'title', new.title, 'date', new.date, 'start_time', new.start_time));
  return null;
end;
$$;

revoke all on function public.place_ok(jsonb) from public, anon;
grant execute on function public.place_ok(jsonb) to authenticated, service_role;
revoke all on function public.time_block_place_fill() from public, anon;
grant execute on function public.time_block_place_fill() to authenticated, service_role;
revoke all on function public.schedule_block_place_fill() from public, anon;
grant execute on function public.schedule_block_place_fill() to authenticated, service_role;
