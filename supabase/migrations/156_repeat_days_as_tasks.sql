-- ═══════════════════════════════════════════════════════════════════════════
-- 156: Every repeating item's day is a REAL task on its day (owner,
-- 15.10.2026: "A repeated task should be created on its day. That would be
-- smart. So a training should be a task as well.").
--
-- Before this a day of a repeat (schedule_blocks) was only a projection until
-- it was ticked, skipped or moved, so today's training showed in Home's "Next
-- up" but not under "Today's tasks", and counted nowhere. Now:
--
--  A. tasks.schedule_block_id + tasks.occurrence_date name the repeat and the
--     day a task is (unique together: one task per day of a repeat), and
--     tasks.closed_reason = 'missed' marks a day that passed unticked.
--  B. The day's task is made ON its day — never for a past day (no
--     backfill), never ahead (future days stay projections):
--       repeat_days_run()       the hourly pg_cron job (Europe/Oslo's today,
--                               every account the owner lock lets in) — a
--                               SQL function, no secret
--       app_repeat_days_today() the app's call when it opens (the fallback)
--       app_save_item           a repeat saved today gets today's task at once
--     Title, notes, domain and priority come from the repeat; the section is
--     Today and due_date the day (due_time the repeat's time, as 142's day of
--     a plan has it). NO slot is made: the repeat's time stays on the repeat,
--     so the Google Calendar series keeps the day (no EXDATE, no extra event
--     — "Avoid a daily EXDATE plus extra event"). The day becomes a slot of
--     its own (142's split) only when it is edited on its own ("This day",
--     a move, a skip, a training action) — and that split REUSES this task
--     (item_occurrence), so a day never has two tasks. Ticking a repeat's
--     row (app_repeat_day 'done') ticks the day's task — no split either.
--  C. Never a second time: a day already acted on (142's slot), a day taken
--     out ("Only this day", except_dates), a day whose task was deleted (the
--     day leaves the repeat, below) or moved (likewise) is never made again;
--     the unique index refuses a race.
--  D. Missed days stay missed (owner: never carried over): once its day has
--     passed, an unticked day's task is closed — status 'cancelled',
--     closed_reason 'missed', completed_at the last second of ITS day (so it
--     shows as Missed on its day and never on Today's lists, as overdue or
--     cancelled). The same job does it at the start of the next day (and the
--     app's call). A training day closed as missed gets no skip row (142):
--     it wasn't skipped; and a Hevy workout logged late (141's six days)
--     still completes it.
--  E. Google, per repeat (schedule_blocks.google_target, widened):
--       calendar — the series, as 155 had it; the day's task is NOT on
--                  Google Tasks
--       tasks    — "Google Tasks · one per day": no series; each day's task
--                  is on Google Tasks (due = its day) through 071's outbox
--                  the moment it is made; ticking it in Google ticks the day
--       both     — the series and the day's Google Task
--       none     — neither
--     A day's task closed as missed leaves Google Tasks (cancelled = deleted
--     there, 071), so the widget never carries a day over either. Moving a
--     repeat between them is 155's rule — the new copy first: the database
--     turns its days' Google Tasks on; off only once the browser saw the
--     series 'linked' (app_repeat_days_google_tasks). No "✓ " on a series
--     day ticked without a split (an instance PATCH isn't confirmed in
--     docs/integrations/google-calendar.md).
--  F. The rules, for every writer:
--       a day's task deleted     → the day leaves the repeat (except_dates);
--                                  put back (Undo) → it is in again
--       a day's task moved       → the day leaves the repeat; moved back → in
--       a repeat deleted         → its days nobody acted on (open, no slot)
--                                  go with it; app_delete_rows holds them for
--                                  Undo
--       a repeat edited          → its untouched days from today on follow
--                                  (title, notes, domain, priority, time,
--                                  Google); a day it no longer has goes
--
-- Audit: the job's writes ARE audited (trg_audit on tasks, actor 'service'):
-- like every other automatic writer (the Google Tasks pull, Hevy closing a
-- session), what it made or closed is in Developer → Activity. Undoing such
-- an entry deletes those days' tasks, which — like any delete of a day's
-- task — takes the days out of their repeats.
--
-- Safety (DB scenarios: scripts/verify-db-repeat-days.mjs): this migration
-- creates, updates and deletes NO row and queues nothing for Google (asserted
-- at the end); the first run of the job makes only today's tasks.
-- Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_tasks bigint := 0;
  v_cal bigint := 0;
  v_gt bigint := 0;
begin
  execute 'select count(*) from public.tasks' into v_tasks;
  if to_regclass('public.calendar_outbox') is not null then execute 'select count(*) from public.calendar_outbox' into v_cal; end if;
  if to_regclass('public.google_tasks_outbox') is not null then execute 'select count(*) from public.google_tasks_outbox' into v_gt; end if;
  perform set_config('m156.tasks_rows', v_tasks::text, false);
  perform set_config('m156.calendar_rows', v_cal::text, false);
  perform set_config('m156.gtasks_rows', v_gt::text, false);
end $$;

-- ── A. Columns ──────────────────────────────────────────────────────────────
alter table public.tasks
  add column if not exists schedule_block_id uuid references public.schedule_blocks(id) on delete set null,
  add column if not exists occurrence_date   date,
  add column if not exists closed_reason     text;
do $$ begin
  alter table public.tasks add constraint tasks_closed_reason_check
    check (closed_reason is null or (closed_reason = 'missed' and status = 'cancelled'));
exception when duplicate_object then null; end $$;
create unique index if not exists tasks_occurrence_key
  on public.tasks (schedule_block_id, occurrence_date)
  where schedule_block_id is not null and occurrence_date is not null;
create index if not exists tasks_day_open_idx
  on public.tasks (user_id, occurrence_date)
  where occurrence_date is not null and status in ('open', 'in_progress', 'waiting');
comment on column public.tasks.schedule_block_id is
  'The repeating item (schedule_blocks) this task is one day of (156); with occurrence_date unique — one task per day of a repeat. SET NULL when the repeat is deleted (its days acted on stay as tasks).';
comment on column public.tasks.occurrence_date is
  'The day of the repeat this task is (156) — it stays when the task is moved to another day.';
comment on column public.tasks.closed_reason is
  '''missed'' (156): a day of a repeat that passed unticked, closed as cancelled on its own day — never carried over. NULL otherwise (cleared whenever the task is no longer cancelled).';

-- Google Tasks can hold a repeat now — one task per day (156).
alter table public.schedule_blocks drop constraint if exists schedule_blocks_google_target_check;
alter table public.schedule_blocks add constraint schedule_blocks_google_target_check
  check (google_target is null or google_target in ('tasks', 'calendar', 'both', 'none'));
comment on column public.schedule_blocks.google_target is
  'calendar | tasks | both | none (155, 156); NULL = saved before 155 (on Google when google_calendar_event_id is set). tasks = "Google Tasks · one per day": no series, each day''s task (156) is a Google Task.';

-- The marker belongs to a cancelled task only: anything else clears it.
create or replace function public.tasks_closed_reason()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from 'cancelled' then new.closed_reason := null; end if;
  return new;
end;
$$;
drop trigger if exists trg_tasks_closed_reason on public.tasks;
create trigger trg_tasks_closed_reason
  before insert or update of status, closed_reason on public.tasks
  for each row execute function public.tasks_closed_reason();

-- ── B. The repeat rule, in SQL ──────────────────────────────────────────────
-- daily/recurrence.ts's occursOn, line for line (146's kinds, 081's start,
-- 142's except_dates). scripts/verify-db-repeat-days.mjs compares the two
-- over two years for every kind.

-- recurrence.monthlyOccurrence: the anchor day (clamped to the month's last
-- day), or the weekday nearest it (never a tie: at most 3 days away).
create or replace function public.repeat_monthly_day(p_anchor_day integer, p_year integer, p_month0 integer, p_weekday integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first  date := make_date(p_year, p_month0 + 1, 1);
  v_last   integer := extract(day from (v_first + interval '1 month' - interval '1 day'))::integer;
  v_target date := v_first + (least(p_anchor_day, v_last) - 1);
  v_ahead  integer;
begin
  if p_weekday is null then return v_target; end if;
  v_ahead := ((p_weekday - extract(dow from v_target)::integer) + 7) % 7;
  return case when v_ahead <= 3 then v_target + v_ahead else v_target + v_ahead - 7 end;
end;
$$;

-- recurrence.monthlyHits: every `p_every` months from the anchor's month; the
-- nearest weekday may sit in the month before or after.
create or replace function public.repeat_monthly_hits(p_anchor date, p_weekday integer, p_day date, p_every integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_anchor_day integer;
  v_start      integer;
  v_month      integer;
  m            integer;
  k            integer;
begin
  if p_anchor is null or p_day is null then return false; end if;
  v_anchor_day := extract(day from p_anchor)::integer;
  v_start := extract(year from p_anchor)::integer * 12 + extract(month from p_anchor)::integer - 1;
  v_month := extract(year from p_day)::integer * 12 + extract(month from p_day)::integer - 1;
  for m in v_month - 1 .. v_month + 1 loop
    k := m - v_start;
    continue when k < 0 or k % greatest(p_every, 1) <> 0;
    if public.repeat_monthly_day(v_anchor_day, m / 12, m % 12, p_weekday) = p_day then return true; end if;
  end loop;
  return false;
end;
$$;

-- recurrence.occursOn: does the repeat have a day that STARTS on p_day?
create or replace function public.repeat_occurs_on(p public.schedule_blocks, p_day date)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind  text := case when p.repeat_kind in ('weekly', 'monthly', 'interval', 'dates') then p.repeat_kind else 'weekly' end;
  v_days  integer[] := array(select distinct d from unnest(coalesce(p.days_of_week, '{}'::integer[])) d where d between 0 and 6 order by d);
  v_every integer := case when p.repeat_interval is not null and p.repeat_interval >= 1 then p.repeat_interval else 1 end;
  v_start date := p.effective_from;
  v_dow   integer;
begin
  if p_day is null then return false; end if;
  if v_start is not null and p_day < v_start then return false; end if;
  if p_day = any (coalesce(p.except_dates, '{}'::date[])) then return false; end if;
  v_dow := extract(dow from p_day)::integer;
  if v_kind = 'weekly' then return v_dow = any (v_days); end if;
  if v_kind = 'dates' then return p_day = any (coalesce(p.repeat_dates, '{}'::date[])); end if;
  if v_kind = 'monthly' then return public.repeat_monthly_hits(v_start, v_days[1], p_day, 1); end if;
  -- interval
  if p.repeat_unit = 'month' then return public.repeat_monthly_hits(v_start, v_days[1], p_day, v_every); end if;
  if v_start is null then return false; end if;
  if p.repeat_unit = 'day' then return (p_day - v_start) % v_every = 0; end if;
  if p.repeat_unit = 'week' then
    return v_dow = any (v_days)
       and (((p_day - ((v_dow + 6) % 7)) - (v_start - ((extract(dow from v_start)::integer + 6) % 7))) / 7) % v_every = 0;
  end if;
  return false;
end;
$$;

-- ── C. A day's task ─────────────────────────────────────────────────────────

-- Where a repeat lives on Google: its choice, or — saved before 155 — where it
-- is (its series, else nowhere): itemRules.presentGoogleTarget's reading.
create or replace function public.repeat_day_target(p public.schedule_blocks)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(p.google_target, case when p.google_calendar_event_id is not null then 'calendar' else 'none' end)
$$;

-- Where a day of it IS on Google (its task's google_target): its series
-- counts only once it exists (155: a day of a repeat with no series yet is
-- not on Calendar); Google Tasks is the day's own task.
create or replace function public.repeat_day_presence(p public.schedule_blocks)
returns text
language sql
stable
set search_path = ''
as $$
  select case public.repeat_day_target(p)
           when 'calendar' then case when p.google_calendar_event_id is not null then 'calendar' else 'none' end
           when 'both' then case when p.google_calendar_event_id is not null then 'both' else 'tasks' end
           else public.repeat_day_target(p)
         end
$$;

-- Whether the account has a Google connection (a refresh token is stored —
-- the server's own reading of "connected"; only its own, never another's).
create or replace function public.repeat_google_connected(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user is null or (auth.uid() is not null and auth.uid() <> p_user) then return false; end if;
  if to_regclass('public.user_calendar_tokens') is null then return false; end if;
  return exists (select 1 from public.user_calendar_tokens where user_id = p_user);
end;
$$;

/*
 * THE day's task of a repeat: the task the day already has — its 142 slot's
 * (a task-less slot gets one through item_occurrence), else the task made on
 * its day — or a new one when the repeat has that day. No slot is made: the
 * repeat's time stays on the repeat (and its Google series keeps the day).
 * Answers no row for a day the repeat doesn't have (before its start, not in
 * its rule, taken out). The repeat's row is locked first and the unique
 * index refuses a second task, so the job, the app's call and a tap never
 * make two.
 */
create or replace function public.repeat_day_task(p_plan uuid, p_date date, p_today date, p_user uuid default null,
                                                  p_connected boolean default null)
returns table(task_id uuid, block_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user   uuid := coalesce(p_user, auth.uid());
  p        public.schedule_blocks%rowtype;
  v_task   uuid;
  v_block  uuid;
  v_target text;
begin
  if v_user is null or p_plan is null or p_date is null then
    raise exception 'repeat_day_task: a repeating item and a day are needed' using errcode = 'IT010';
  end if;
  select * into p from public.schedule_blocks s where s.id = p_plan and s.user_id = v_user for update;
  if not found then
    raise exception 'repeat_day_task: the repeating item is not there (deleted?)' using errcode = 'IT010';
  end if;

  -- 1. The day is an item of its own already (142): its slot's task.
  select b.id, b.task_id into v_block, v_task
    from public.time_blocks b where b.schedule_block_id = p_plan and b.occurrence_date = p_date;
  if v_block is not null then
    if v_task is null then
      select o.block_id, o.task_id into v_block, v_task from public.item_occurrence(p_plan, p_date, p_today, v_user) o;
      return query select v_task, v_block, true;
      return;
    end if;
    return query select v_task, v_block, false;
    return;
  end if;

  -- 2. The task made on its day.
  select t.id into v_task from public.tasks t where t.schedule_block_id = p_plan and t.occurrence_date = p_date;
  if v_task is not null then
    return query select v_task, null::uuid, false;
    return;
  end if;

  -- 3. A day the repeat doesn't have: nothing to make.
  if not public.repeat_occurs_on(p, p_date) then return; end if;

  v_target := public.repeat_day_target(p);
  insert into public.tasks (user_id, title, description, domain, section, status, priority, due_date, due_time,
                           source_type, google_target, google_sync_enabled, schedule_block_id, occurrence_date)
  values (v_user, p.title, p.notes,
          coalesce(p.domain, case p.category when 'work' then 'work' when 'media' then 'media' else 'personal' end),
          public.item_section_for_day(p_date, coalesce(p_today, p_date)), 'open', coalesce(p.priority, 'medium'),
          p_date, p.start_time,
          case when p.category = 'training' then 'training_session' else 'manual' end,
          public.repeat_day_presence(p),
          v_target in ('tasks', 'both') and coalesce(p_connected, public.repeat_google_connected(v_user)),
          p_plan, p_date)
  on conflict (schedule_block_id, occurrence_date) where schedule_block_id is not null and occurrence_date is not null do nothing
  returning id into v_task;
  if v_task is null then
    select t.id into v_task from public.tasks t where t.schedule_block_id = p_plan and t.occurrence_date = p_date;
    return query select v_task, null::uuid, false;
    return;
  end if;
  return query select v_task, null::uuid, true;
end;
$$;

/*
 * 155's item_occurrence (one day of a repeat as an item of its own, 142's
 * split): the same, but the day's task made on its day (repeat_day_task) IS
 * the day's task — the slot is linked to it, never a second task — and a new
 * task carries the repeat and the day (unique with them) and the repeat's
 * Google choice (Google Tasks too, since 156). A task moved off its day
 * before the split gets its slot where it is now.
 */
create or replace function public.item_occurrence(p_plan uuid, p_date date, p_today date, p_user uuid default null)
returns table(block_id uuid, task_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user   uuid := coalesce(p_user, auth.uid());
  p        public.schedule_blocks%rowtype;
  v_block  uuid;
  v_task   uuid;
  v_found  boolean;
  v_day    date := p_date;
  v_time   time;
  v_target text;
  d        record;
begin
  if v_user is null or p_plan is null or p_date is null then
    raise exception 'item_occurrence: a repeating item and a day are needed' using errcode = 'IT010';
  end if;
  select * into p from public.schedule_blocks s where s.id = p_plan and s.user_id = v_user for update;
  if not found then
    raise exception 'item_occurrence: the repeating item is not there (deleted?)' using errcode = 'IT010';
  end if;
  v_time := p.start_time;

  select b.id, b.task_id into v_block, v_task
    from public.time_blocks b where b.schedule_block_id = p_plan and b.occurrence_date = p_date;
  v_found := v_block is not null;
  if v_task is not null then
    return query select v_block, v_task, false;
    return;
  end if;

  -- 156: the task made on its day, if it has one (where it is now).
  select t.id, t.due_date, t.due_time into d
    from public.tasks t where t.schedule_block_id = p_plan and t.occurrence_date = p_date;
  if d.id is not null and d.due_date is distinct from p_date then
    v_day := coalesce(d.due_date, p_date);
    v_time := d.due_time;
  end if;

  if not v_found then
    insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, busy, color, category,
                                    source_type, schedule_block_id, occurrence_date)
    values (v_user, v_day, p.title, v_time,
            case when p.start_time is null or v_time is null then 60 else least(1440, greatest(1, public.item_plan_minutes(p.start_time, p.end_time))) end,
            v_time is not null and p.start_time is not null and p.busy, 'accent', p.category,
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

  v_task := d.id;
  if v_task is null then
    v_target := public.repeat_day_target(p);
    insert into public.tasks (user_id, title, description, domain, section, status, priority, due_date, due_time,
                             source_type, google_sync_enabled, google_target, schedule_block_id, occurrence_date)
    values (v_user, p.title, p.notes,
            coalesce(p.domain, case p.category when 'work' then 'work' when 'media' then 'media' else 'personal' end),
            public.item_section_for_day(p_date, p_today), 'open', coalesce(p.priority, 'medium'), p_date, p.start_time,
            case when p.category = 'training' then 'training_session' else 'manual' end,
            v_target in ('tasks', 'both') and public.repeat_google_connected(v_user), public.repeat_day_presence(p), p_plan, p_date)
    on conflict (schedule_block_id, occurrence_date) where schedule_block_id is not null and occurrence_date is not null do nothing
    returning id into v_task;
    if v_task is null then
      select t.id into v_task from public.tasks t where t.schedule_block_id = p_plan and t.occurrence_date = p_date;
    end if;
  end if;
  update public.time_blocks set task_id = v_task where id = v_block;
  return query select v_block, v_task, true;
end;
$$;

/*
 * A repeat was saved (app_save_item, scope all): its days nobody acted on
 * yet — open, no slot, still on their own day — from today on follow it:
 * title, notes, domain, priority, time and Google (Google Tasks on for
 * tasks / both, off for none; for calendar it stays as it is — the browser
 * turns it off once the series answered 'linked': the new copy first). A day
 * the repeat no longer has goes. Today's task is made when the repeat has
 * today. Answers today's task (null when the repeat hasn't today).
 */
create or replace function public.repeat_days_follow_rule(p_plan uuid, p_today date, p_connected boolean default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  p         public.schedule_blocks%rowtype;
  v_target  text;
  v_on      boolean;
  t         record;
  v_today   uuid;
begin
  select * into p from public.schedule_blocks s where s.id = p_plan for update;
  if not found or p_today is null then return null; end if;
  v_target := public.repeat_day_target(p);
  v_on := coalesce(p_connected, public.repeat_google_connected(p.user_id));
  for t in select x.id, x.occurrence_date, x.priority, x.google_sync_enabled from public.tasks x
            where x.schedule_block_id = p_plan and x.occurrence_date >= p_today
              and x.status in ('open', 'in_progress', 'waiting')
              and x.due_date is not distinct from x.occurrence_date
              and not exists (select 1 from public.time_blocks b where b.task_id = x.id)
            order by x.occurrence_date
            for update of x loop
    if not public.repeat_occurs_on(p, t.occurrence_date) then
      delete from public.tasks where id = t.id;
    else
      update public.tasks set
        title = p.title, description = p.notes,
        domain = coalesce(p.domain, case p.category when 'work' then 'work' when 'media' then 'media' else 'personal' end),
        priority = coalesce(p.priority, t.priority),
        due_time = p.start_time,
        google_target = public.repeat_day_presence(p),
        google_sync_enabled = case when v_target in ('tasks', 'both') then v_on or t.google_sync_enabled
                                   when v_target = 'calendar' then t.google_sync_enabled
                                   else false end
      where id = t.id;
    end if;
  end loop;
  if public.repeat_occurs_on(p, p_today) then
    select d.task_id into v_today from public.repeat_day_task(p_plan, p_today, p_today, p.user_id, p_connected) d;
  end if;
  return v_today;
end;
$$;

/*
 * THE item save (155), with 156's changes:
 *   - a repeat may live on Google Tasks ("one per day") or on both;
 *   - a repeat saved (scope all) brings its untouched days from today on
 *     along and makes today's task now (repeat_days_follow_rule) — answered
 *     as `dayTaskId`, which the browser confirms on Google Tasks before it
 *     removes a series (the new copy first);
 *   - a day's task saved as a plain item (opened from Home's list) is that
 *     day of its repeat: its edit runs as scope 'day' (142's split, the task
 *     reused);
 *   - a day of a repeat on Google Tasks keeps Google Tasks.
 * Otherwise 155's, unchanged (see 155 for the whole description).
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
  if v_cat_in is not null and v_cat_in not in ('daily', 'training', 'media', 'games', 'work', 'projects', 'other') then v_cat_in := null; end if;
  if v_time is null then v_minutes := null; end if;
  if v_minutes is not null and (v_minutes < 1 or v_minutes > 1440) then
    raise exception 'A length is 1 minute to 24 hours' using errcode = 'IT005';
  end if;
  if v_section is not null and v_section not in ('inbox', 'today', 'backlog') then v_section := null; end if;

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
      update public.schedule_blocks set
        title = v_title, notes = v_notes, domain = v_domain, priority = v_priority,
        days_of_week = v_days, repeat_kind = v_kind, repeat_interval = v_interval, repeat_unit = v_unit, repeat_dates = v_dates,
        effective_from = v_starts, start_time = v_time, end_time = v_end, busy = v_busy,
        category = coalesce(v_cat_in, p.category), color = coalesce(v_color_in, p.color),
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
                                          google_target)
      values (v_user, v_title, v_notes, v_domain, v_priority, v_days, v_kind, v_interval, v_unit, v_dates, v_starts,
              v_time, v_end, v_busy, coalesce(v_color_in, 'blue'), v_category, v_google)
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
                             source_type, source_id, google_target, google_sync_enabled, google_tasklist_id)
    values (v_user, v_title, v_notes, v_domain, coalesce(v_section, public.item_section_for_day(v_date, v_today)), 'open',
            v_priority, v_start, v_due_date, v_due_time, v_task_src, v_src_id, v_google, v_sync, v_list)
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
        category = coalesce(v_cat_in, b.category), color = coalesce(v_color_in, b.color),
        source_type = case when v_bsrc is not null then v_bsrc_type else b.source_type end,
        source_id = case when v_bsrc is not null then v_bsrc_id else b.source_id end,
        season_number = case when v_bsrc is not null then v_season else b.season_number end,
        episode_number = case when v_bsrc is not null then v_episode else b.episode_number end,
        updated_at = now()
      where id = v_block_id;
    else
      insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, busy, color, category, task_id,
                                      source_type, source_id, season_number, episode_number)
      values (v_user, v_date, v_title, v_time, case when v_time is null then 60 else coalesce(v_minutes, 15) end, v_busy,
              coalesce(v_color_in, 'accent'), coalesce(v_cat_in, public.item_default_category(v_domain, t.source_type)), v_task_id,
              case when v_bsrc is not null then v_bsrc_type else public.item_block_source(coalesce(v_src_type, t.source_type)) end,
              case when v_bsrc is not null then v_bsrc_id else coalesce(v_src_id, t.source_id) end,
              v_season, v_episode)
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
 * One day of ANY repeating item (155's app_repeat_day), with 156's day task:
 *   done    the day's task (made now if the day has none — repeat_day_task;
 *           NO slot, so its Google series keeps the day) is done. A day the
 *           repeat no longer has becomes an item of its own first (155).
 *   skip    142's split, as 155 had it: the day becomes its own item (the
 *           day's task reused) and is cancelled — off Google with its EXDATE.
 *   undo    the day's task (a split day's, or the one made on its day) opens
 *           again.
 *   remove  "Only this day" for a day with no item of its own: the day leaves
 *           the repeat — and an untouched task made on it goes too.
 *   restore puts a removed day back (and today's task with it, when it is
 *           today — the job's day).
 * A missed day is never carried over: nothing here moves a day.
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

  if p_action = 'remove' then
    -- The day's untouched task goes with the day (its delete takes the day out too).
    delete from public.tasks t
     where t.schedule_block_id = p_plan and t.occurrence_date = p_date and t.user_id = v_user
       and t.status in ('open', 'in_progress', 'waiting')
       and not exists (select 1 from public.time_blocks b where b.task_id = t.id);
    v_changed := found;
    update public.schedule_blocks set except_dates = array_append(except_dates, p_date), updated_at = now()
     where id = p_plan and not (p_date = any (except_dates));
    v_changed := v_changed or found;
    return jsonb_build_object('scheduleBlockId', p_plan, 'date', p_date, 'action', p_action, 'changed', v_changed,
                              'seriesEventId', v_series);
  end if;

  if p_action = 'restore' then
    -- Only a day nothing was split off for (a split-off day is its own item).
    update public.schedule_blocks set except_dates = array_remove(except_dates, p_date), updated_at = now()
     where id = p_plan and p_date = any (except_dates)
       and not exists (select 1 from public.time_blocks b where b.schedule_block_id = p_plan and b.occurrence_date = p_date);
    v_changed := found;
    if v_changed and p_date = v_today then
      select d.task_id into v_task from public.repeat_day_task(p_plan, p_date, v_today, v_user) d;
    end if;
    return jsonb_build_object('scheduleBlockId', p_plan, 'date', p_date, 'action', p_action, 'changed', v_changed,
                              'taskId', v_task, 'seriesEventId', v_series);
  end if;

  if p_action = 'undo' then
    select b.id, b.task_id, b.google_calendar_event_id into v_block, v_task, v_event
      from public.time_blocks b where b.schedule_block_id = p_plan and b.occurrence_date = p_date;
    if v_task is null then
      -- 156: the task made on its day (no slot).
      v_block := null;
      v_event := null;
      select t.id into v_task from public.tasks t where t.schedule_block_id = p_plan and t.occurrence_date = p_date;
    end if;
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

  if p_action = 'done' then
    select d.task_id, d.block_id, d.created into v_task, v_block, v_created
      from public.repeat_day_task(p_plan, p_date, v_today, v_user) d;
  end if;
  if v_task is null then
    -- skip (142's split), or done on a day the repeat no longer has.
    select o.block_id, o.task_id, o.created into v_block, v_task, v_created
      from public.item_occurrence(p_plan, p_date, v_today, v_user) o;
  end if;
  v_status := case p_action when 'done' then 'done' else 'cancelled' end;
  select status into v_prev from public.tasks where id = v_task for update;
  if v_prev is distinct from v_status then
    update public.tasks set status = v_status where id = v_task;
    v_changed := true;
  end if;
  if v_block is not null then
    select google_calendar_event_id into v_event from public.time_blocks where id = v_block;
  end if;
  return jsonb_build_object('scheduleBlockId', p_plan, 'date', p_date, 'action', p_action, 'changed', v_changed,
                            'created', v_created, 'taskId', v_task, 'blockId', v_block, 'previousStatus', v_prev,
                            'blockEventId', v_event, 'seriesEventId', v_series);
end;
$$;

-- ── F. A day's task and its repeat, for every writer ────────────────────────
-- (the app, the assistant, a Google Tasks pull, Undo, plain SQL)

-- A day's task deleted: the day leaves the repeat (except_dates), so nothing
-- makes it again — "Only this day" from the task itself. A day split off
-- (142's slot) is out already. Not while its repeat is being deleted (the
-- repeat's own delete takes its open days, below).
create or replace function public.repeat_day_task_deleted()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p public.schedule_blocks%rowtype;
begin
  if old.schedule_block_id is null or old.occurrence_date is null then return null; end if;
  if coalesce(current_setting('app.repeat_deleting', true), '') = old.schedule_block_id::text then return null; end if;
  select * into p from public.schedule_blocks s where s.id = old.schedule_block_id;
  if not found or not public.repeat_occurs_on(p, old.occurrence_date) then return null; end if;
  update public.schedule_blocks set except_dates = array_append(except_dates, old.occurrence_date), updated_at = now()
   where id = p.id and not (old.occurrence_date = any (except_dates));
  return null;
end;
$$;
drop trigger if exists trg_repeat_day_task_deleted on public.tasks;
create trigger trg_repeat_day_task_deleted
  after delete on public.tasks
  for each row execute function public.repeat_day_task_deleted();

-- A day's task put back (Undo of its delete): the day is in the repeat again
-- — unless a slot holds the day (142: then it is out on purpose).
create or replace function public.repeat_day_task_restored()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.schedule_block_id is null or new.occurrence_date is null then return null; end if;
  if new.due_date is distinct from new.occurrence_date then return null; end if;
  if exists (select 1 from public.time_blocks b
              where (b.schedule_block_id = new.schedule_block_id and b.occurrence_date = new.occurrence_date) or b.task_id = new.id) then
    return null;
  end if;
  update public.schedule_blocks set except_dates = array_remove(except_dates, new.occurrence_date), updated_at = now()
   where id = new.schedule_block_id and new.occurrence_date = any (except_dates);
  return null;
end;
$$;
drop trigger if exists trg_repeat_day_task_restored on public.tasks;
create trigger trg_repeat_day_task_restored
  after insert on public.tasks
  for each row execute function public.repeat_day_task_restored();

-- A day's task with no slot moved to another day (Move, a Google Tasks due
-- change, the assistant): its own day leaves the repeat, so the repeat no
-- longer shows it there and nothing makes it again; moved back, it is in
-- again. A day with a slot moves by its slot (142, 155).
create or replace function public.repeat_day_task_moved()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p public.schedule_blocks%rowtype;
begin
  if new.schedule_block_id is null or new.occurrence_date is null then return null; end if;
  if new.due_date is not distinct from old.due_date then return null; end if;
  if exists (select 1 from public.time_blocks b where b.task_id = new.id) then return null; end if;
  if new.due_date is distinct from new.occurrence_date then
    select * into p from public.schedule_blocks s where s.id = new.schedule_block_id;
    if found and public.repeat_occurs_on(p, new.occurrence_date) then
      update public.schedule_blocks set except_dates = array_append(except_dates, new.occurrence_date), updated_at = now()
       where id = p.id and not (new.occurrence_date = any (except_dates));
    end if;
  elsif not exists (select 1 from public.time_blocks b
                     where b.schedule_block_id = new.schedule_block_id and b.occurrence_date = new.occurrence_date) then
    update public.schedule_blocks set except_dates = array_remove(except_dates, new.occurrence_date), updated_at = now()
     where id = new.schedule_block_id and new.occurrence_date = any (except_dates);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_repeat_day_task_moved on public.tasks;
create trigger trg_repeat_day_task_moved
  after update of due_date on public.tasks
  for each row execute function public.repeat_day_task_moved();

-- A repeat deleted ("every day it repeats"): the days it made that nobody
-- acted on (open, no slot) go with it; days done, skipped, missed or split
-- off stay as tasks (their link goes: ON DELETE SET NULL). app_delete_rows
-- (below) holds them for Undo.
create or replace function public.repeat_drops_open_days()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform set_config('app.repeat_deleting', old.id::text, true);
  delete from public.tasks t
   where t.schedule_block_id = old.id and t.occurrence_date is not null
     and t.status in ('open', 'in_progress', 'waiting')
     and not exists (select 1 from public.time_blocks b where b.task_id = t.id);
  perform set_config('app.repeat_deleting', '', true);
  return old;
end;
$$;
drop trigger if exists trg_repeat_drops_open_days on public.schedule_blocks;
create trigger trg_repeat_drops_open_days
  before delete on public.schedule_blocks
  for each row execute function public.repeat_drops_open_days();

-- 155's app_delete_rows (144's delete with Undo), verbatim but for the block
-- that holds a deleted repeat's open days (trg_repeat_drops_open_days above):
-- "a rule that deletes rows without a foreign key must be added to
-- app_delete_rows too, or Undo misses it".
create or replace function public.app_delete_rows(p_table text, p_ids text[])
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_root    regclass := to_regclass(format('public.%I', p_table));
  v_pk      text;
  v_groups  jsonb := '[]'::jsonb;
  v_links   jsonb := '[]'::jsonb;
  v_touched jsonb := '[]'::jsonb;
  v_hidden  jsonb := '[]'::jsonb;
  v_seen    text[] := '{}';
  v_todo    jsonb;
  v_item    jsonb;
  v_tbl     regclass;
  v_name    text;
  v_tpk     text;
  v_ids     text[];
  v_rows    jsonb;
  v_vals    text[];
  v_cpk     text;
  v_cids    jsonb;
  v_crows   jsonb;
  v_count   integer := 0;
  v_cap     constant integer := 10000;
  v_too_big boolean := false;
  v_deleted integer;
  v_n       integer;
  v_on      boolean;
  r         record;
begin
  if v_root is null then
    raise exception 'app_delete_rows: unknown table %', p_table using errcode = '42P01';
  end if;
  v_pk := public.app_pk_column(v_root);
  if v_pk is null then
    raise exception 'app_delete_rows: % has no single-column key', p_table;
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return null;
  end if;

  v_todo := jsonb_build_array(jsonb_build_object('t', v_root::oid, 'ids', to_jsonb(p_ids)));
  while jsonb_array_length(v_todo) > 0 loop
    v_item := v_todo -> 0;
    v_todo := v_todo - 0;
    v_tbl  := (v_item ->> 't')::oid::regclass;
    v_name := (select c.relname::text from pg_class c where c.oid = v_tbl);
    v_tpk  := public.app_pk_column(v_tbl);
    select array_agg(x) into v_ids
    from jsonb_array_elements_text(v_item -> 'ids') x
    where not ((v_name || ':' || x) = any (v_seen));
    continue when v_ids is null;
    v_seen := v_seen || array(select v_name || ':' || x from unnest(v_ids) x);
    -- The cap is checked before any row is read: a long book's page events
    -- must take the too_big path, not the statement timeout.
    if v_count + array_length(v_ids, 1) > v_cap then
      v_too_big := true;
      exit;
    end if;

    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x where x.%I = any ($1::%s[])',
                     v_tbl, v_tpk, public.app_column_type(v_tbl, v_tpk))
        into v_rows using v_ids;
    exception when insufficient_privilege then
      -- deleted with its parent all the same; it can't be put back
      v_hidden := v_hidden || to_jsonb(v_name);
      continue;
    end;
    continue when jsonb_array_length(v_rows) = 0;
    v_count := v_count + jsonb_array_length(v_rows);
    if v_count > v_cap then
      v_too_big := true;
      exit;
    end if;
    v_groups := v_groups || jsonb_build_object('table', v_name, 'pk', v_tpk, 'rows', v_rows);

    -- Rows that point here by a single-column foreign key in this schema.
    for r in
      select c.conrelid::regclass as child, cc.relname::text as child_name,
             ca.attname::text as col, pa.attname::text as refcol, c.confdeltype as action
      from pg_constraint c
      join pg_class cc on cc.oid = c.conrelid
      join pg_namespace n on n.oid = cc.relnamespace and n.nspname = 'public'
      join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
      where c.contype = 'f' and c.confrelid = v_tbl and array_length(c.conkey, 1) = 1
        and c.confdeltype in ('c', 'n', 'd')
    loop
      select array_agg(e ->> r.refcol) into v_vals
      from jsonb_array_elements(v_rows) e
      where e ->> r.refcol is not null;
      continue when v_vals is null;
      v_cpk := public.app_pk_column(r.child);
      begin
        if r.action = 'c' and v_cpk is not null then
          execute format('select coalesce(jsonb_agg(s.k), ''[]'') from (select x.%I::text as k from %s x where x.%I = any ($1::%s[]) limit $2) s',
                         v_cpk, r.child, r.col, public.app_column_type(r.child, r.col))
            into v_cids using v_vals, v_cap - v_count + 1;
          if v_count + jsonb_array_length(v_cids) > v_cap then
            v_too_big := true;
            exit;
          end if;
          if jsonb_array_length(v_cids) > 0 then
            v_todo := v_todo || jsonb_build_object('t', r.child::oid, 'ids', v_cids);
          end if;
        else
          execute format('select count(*) from (select 1 from %s x where x.%I = any ($1::%s[]) limit $2) s',
                         r.child, r.col, public.app_column_type(r.child, r.col))
            into v_n using v_vals, v_cap - v_count + 1;
          continue when v_n = 0;
          if v_count + v_n > v_cap then
            v_too_big := true;
            exit;
          end if;
          execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x where x.%I = any ($1::%s[])',
                         r.child, r.col, public.app_column_type(r.child, r.col))
            into v_crows using v_vals;
          v_count := v_count + jsonb_array_length(v_crows);
          if r.action = 'c' then
            -- a child with no single key: its rows go back, its own children are not followed
            v_groups := v_groups || jsonb_build_object('table', r.child_name, 'pk', null, 'rows', v_crows);
          elsif v_cpk is not null then
            v_links := v_links || jsonb_build_object('table', r.child_name, 'pk', v_cpk, 'col', r.col, 'rows', v_crows);
          end if;
        end if;
      exception when insufficient_privilege then
        v_hidden := v_hidden || to_jsonb(r.child_name);
      end;
    end loop;

    exit when v_too_big;

    -- 043: a project item's schedule blocks go with it (by source, not a
    -- foreign key) — while that rule is switched on, as the trigger checks.
    v_on := false;
    if v_name = 'project_items' and to_regclass('public.time_blocks') is not null then
      v_on := true;
      if to_regprocedure('public.link_rule_enabled(text)') is not null then
        begin
          execute 'select public.link_rule_enabled($1)' into v_on using 'project_item_delete_cleans_block';
        exception when insufficient_privilege then
          v_on := true;  -- the trigger (SECURITY DEFINER) reads it either way
        end;
      end if;
    end if;
    if v_on then
      execute 'select coalesce(jsonb_agg(b.id::text), ''[]'') from public.time_blocks b
               where b.source_type = ''project_item'' and b.source_id::text = any ($1)'
        into v_cids using v_ids;
      if jsonb_array_length(v_cids) > 0 then
        v_todo := v_todo || jsonb_build_object('t', 'public.time_blocks'::regclass::oid, 'ids', v_cids);
      end if;
    end if;

    -- 155: the same rule closes the open tasks of those blocks (a deleted
    -- project item's planned work is done or won't be — 155's
    -- cleanup_block_on_project_item_delete); Undo puts their status back.
    if v_on and to_regclass('public.tasks') is not null then
      execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from public.tasks t
               where t.status in (''open'', ''in_progress'', ''waiting'')
                 and t.id in (select b.task_id from public.time_blocks b
                              where b.source_type = ''project_item'' and b.source_id::text = any ($1) and b.task_id is not null)'
        into v_crows using v_ids;
      if jsonb_array_length(v_crows) > 0 then
        v_touched := v_touched || jsonb_build_object('table', 'tasks', 'pk', 'id', 'rows', v_crows);
      end if;
    end if;

    -- 156: a repeat's days nobody acted on (an open task made on its day,
    -- no slot) go with the repeat (trg_repeat_drops_open_days); held here so
    -- Undo puts them back with the repeat.
    if v_name = 'schedule_blocks' and to_regclass('public.tasks') is not null then
      execute 'select coalesce(jsonb_agg(t.id::text), ''[]'') from public.tasks t
               where t.schedule_block_id::text = any ($1) and t.occurrence_date is not null
                 and t.status in (''open'', ''in_progress'', ''waiting'')
                 and not exists (select 1 from public.time_blocks b where b.task_id = t.id)'
        into v_cids using v_ids;
      if jsonb_array_length(v_cids) > 0 then
        v_todo := v_todo || jsonb_build_object('t', 'public.tasks'::regclass::oid, 'ids', v_cids);
      end if;
    end if;

    -- 123: recipes built from a deleted food switch to typed macros.
    if v_name = 'recipe_ingredient_library' and to_regclass('public.recipes') is not null then
      execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.recipes x
               where x.macro_mode = ''from_ingredients''
                 and x.id in (select ri.recipe_id from public.recipe_ingredients ri
                              where ri.library_ingredient_id::text = any ($1))'
        into v_crows using v_ids;
      if jsonb_array_length(v_crows) > 0 then
        v_touched := v_touched || jsonb_build_object('table', 'recipes', 'pk', 'id', 'rows', v_crows);
      end if;
    end if;
  end loop;

  -- A row deleted itself is put back from its group, never as a link.
  select coalesce(jsonb_agg(l || jsonb_build_object('rows', kept)) filter (where jsonb_array_length(kept) > 0), '[]')
    into v_links
  from (
    select l, (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(l -> 'rows') x
               where not (((l ->> 'table') || ':' || (x ->> (l ->> 'pk'))) = any (v_seen))) as kept
    from jsonb_array_elements(v_links) l
  ) s;
  select coalesce(jsonb_agg(l || jsonb_build_object('rows', kept)) filter (where jsonb_array_length(kept) > 0), '[]')
    into v_touched
  from (
    select l, (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(l -> 'rows') x
               where not (((l ->> 'table') || ':' || (x ->> (l ->> 'pk'))) = any (v_seen))) as kept
    from jsonb_array_elements(v_touched) l
  ) s;

  execute format('delete from %s x where x.%I = any ($1::%s[])', v_root, v_pk, public.app_column_type(v_root, v_pk))
    using p_ids;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return null;
  end if;
  if v_too_big then
    -- Deleted all the same; there is just too much to hold for Undo.
    return jsonb_build_object('v', 1, 'root', p_table, 'deleted', v_deleted, 'too_big', true,
                              'groups', '[]'::jsonb, 'links', '[]'::jsonb, 'touched', '[]'::jsonb, 'hidden', '[]'::jsonb);
  end if;

  -- What the delete left in the rows it changed: Undo reverts a column only
  -- where it still holds this, so an edit made since (a renamed subtask, a
  -- Google sync's new etag) is kept.
  v_links   := public.app_rows_after(v_links);
  v_touched := public.app_rows_after(v_touched);

  return jsonb_build_object(
    'v', 1, 'root', p_table, 'deleted', v_deleted,
    'groups', v_groups, 'links', v_links, 'touched', v_touched, 'hidden', v_hidden);
end;
$$;

-- ── G. Training (141, 142) and a missed day ─────────────────────────────────

-- 141's candidates, with a training day closed as missed (156): a workout
-- logged within 141's six days still completes it (hevy_workout_completes_plan
-- sets it done, which clears the marker). Otherwise 141's, verbatim.
create or replace function public.training_plan_candidates(p_user uuid, p_day date)
returns table (id uuid, routine text, status text, plan_day date, created_at timestamptz)
language sql
stable
set search_path = public
as $$
  select c.id, c.routine, c.status, c.plan_day, c.created_at
    from (
      select t.id, t.hevy_routine_id as routine, t.status, t.created_at,
             coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date) as plan_day
        from tasks t
       where t.user_id = p_user
         and t.hevy_workout_id is null
         and (t.hevy_routine_id is not null or t.source_type = 'training_session')
         and (t.status in ('open', 'in_progress', 'done')
              or (t.status = 'cancelled' and t.closed_reason = 'missed'))
    ) c
   where c.plan_day between p_day - 6 and p_day
     and (c.status <> 'done' or c.plan_day = p_day)
$$;
revoke all on function public.training_plan_candidates(uuid, date) from public, anon, authenticated;

-- 142's rule (a training task cancelled by any writer gets its skip row), but
-- a day closed as missed was not skipped: no skip row, no reason asked.
create or replace function public.training_task_cancel_skip()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  plan_day date;
begin
  if not (new.hevy_routine_id is not null or new.source_type = 'training_session') then return null; end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if new.closed_reason = 'missed' then return null; end if;
    if exists (select 1 from training_skips where task_id = new.id) then return null; end if;
    plan_day := coalesce((select min(b.date) from time_blocks b where b.task_id = new.id), new.due_date,
                         (now() at time zone 'Europe/Oslo')::date);
    insert into training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
    values (new.user_id, new.hevy_routine_id, date_trunc('week', plan_day)::date,
            'Cancelled — no reason given', new.id, plan_day)
    on conflict do nothing;
  elsif old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    delete from training_skips where task_id = new.id;
  end if;
  return null;
end;
$$;

-- 142's rule (recording a skip cancels the session; removing it reopens it):
-- a skip recorded for a day closed as missed turns it into a skip (the marker
-- goes — it was skipped, with its reason).
create or replace function public.training_skip_sets_task()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.task_id is not null then
    update tasks set status = 'cancelled', closed_reason = null
     where id = new.task_id and (status in ('open', 'in_progress', 'waiting') or closed_reason = 'missed');
  elsif tg_op = 'DELETE' and old.task_id is not null then
    update tasks set status = 'open'
     where id = old.task_id and status = 'cancelled';
  end if;
  return null;
end;
$$;

/*
 * Google Tasks on or off for a repeat's days still to do from p_today on that
 * nobody acted on (open, no slot, on their own day) — the browser's step of a
 * move between Google Tasks and Calendar, once the new copy is confirmed (a
 * series that answered 'linked'). Answers how many changed; 071's outbox
 * creates or removes their Google Tasks.
 */
create or replace function public.app_repeat_days_google_tasks(p_plan uuid, p_today date, p_on boolean)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  n      integer;
begin
  if v_user is null then raise exception 'app_repeat_days_google_tasks: not signed in' using errcode = '28000'; end if;
  update public.tasks t set google_sync_enabled = p_on
   where t.user_id = v_user and t.schedule_block_id = p_plan and t.occurrence_date >= p_today
     and t.status in ('open', 'in_progress', 'waiting') and t.due_date is not distinct from t.occurrence_date
     and t.google_sync_enabled is distinct from p_on
     and not exists (select 1 from public.time_blocks b where b.task_id = t.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── H. The job: missed days closed, today's days made ───────────────────────

/*
 * One account's repeats on p_today: first every day's task whose day has
 * passed unticked is closed as missed — on its own day (its slot's day when
 * it has one, else its due day: a day moved forward isn't missed) — then
 * today's task of every repeat that has today is made (repeat_day_task: a
 * day acted on, taken out or already made is left alone). Never a past day,
 * never a future one. A repeat that fails is counted and named by id (the
 * Actions/cron log is no place for personal data), the others go on.
 */
create or replace function public.repeat_days_for_user(p_user uuid, p_today date)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_missed    integer := 0;
  v_created   integer := 0;
  v_failed    integer := 0;
  v_connected boolean;
  p           public.schedule_blocks%rowtype;
  v_new       boolean;
begin
  if p_user is null or p_today is null then
    return jsonb_build_object('missed', 0, 'created', 0, 'failed', 0);
  end if;

  -- 1. Missed: closed on its own day, never carried over.
  with due as (
    select t.id, coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id), t.due_date, t.occurrence_date) as day
      from public.tasks t
     where t.user_id = p_user and t.occurrence_date is not null
       and t.status in ('open', 'in_progress', 'waiting')
  ), closed as (
    update public.tasks t
       set status = 'cancelled', closed_reason = 'missed',
           completed_at = ((due.day + 1)::timestamp at time zone 'Europe/Oslo') - interval '1 second'
      from due
     where t.id = due.id and due.day < p_today
    returning t.id
  )
  select count(*) into v_missed from closed;

  -- 2. Today's day of every repeat that has today.
  v_connected := public.repeat_google_connected(p_user);
  for p in select s.* from public.schedule_blocks s where s.user_id = p_user order by s.created_at, s.id loop
    continue when not public.repeat_occurs_on(p, p_today);
    begin
      v_new := false;
      select d.created into v_new from public.repeat_day_task(p.id, p_today, p_today, p_user, v_connected) d;
      if coalesce(v_new, false) then v_created := v_created + 1; end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'repeat_days: repeat % on % not made (%)', p.id, p_today, sqlstate;
    end;
  end loop;
  return jsonb_build_object('missed', v_missed, 'created', v_created, 'failed', v_failed);
end;
$$;

/*
 * THE hourly job (pg_cron, below): every account's repeats on Europe/Oslo's
 * today. Runs as the job's owner (no user, no secret: a SQL function, called
 * directly). Idempotent — a second run in the hour makes and closes nothing.
 */
create or replace function public.repeat_days_run(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today   date := coalesce(p_today, (now() at time zone 'Europe/Oslo')::date);
  u         uuid;
  r         jsonb;
  v_users   integer := 0;
  v_missed  integer := 0;
  v_created integer := 0;
  v_failed  integer := 0;
  v_lock    boolean := to_regclass('public.app_allowed_users') is not null;
  v_allowed boolean;
begin
  for u in select x.user_id from (
             select s.user_id from public.schedule_blocks s
             union
             select t.user_id from public.tasks t
              where t.occurrence_date is not null and t.status in ('open', 'in_progress', 'waiting')
           ) x
           where exists (select 1 from auth.users a where a.id = x.user_id)
           order by 1 loop
    -- The owner lock (139): only an account that may use the app.
    if v_lock then
      execute 'select exists (select 1 from public.app_allowed_users where user_id = $1)' into v_allowed using u;
      continue when not v_allowed;
    end if;
    begin
      r := public.repeat_days_for_user(u, v_today);
      v_users := v_users + 1;
      v_missed := v_missed + coalesce((r ->> 'missed')::integer, 0);
      v_created := v_created + coalesce((r ->> 'created')::integer, 0);
      v_failed := v_failed + coalesce((r ->> 'failed')::integer, 0);
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'repeat_days: an account''s run failed (%)', sqlstate;
    end;
  end loop;
  return jsonb_build_object('today', v_today, 'users', v_users, 'missed', v_missed, 'created', v_created, 'failed', v_failed);
end;
$$;

/*
 * The app's call when it opens (the fallback for the hourly job): the
 * signed-in account's repeats on its day. The device's today is taken when it
 * is within a day of Europe/Oslo's (a device abroad), else Oslo's — a wrong
 * clock never makes a day ahead.
 */
create or replace function public.app_repeat_days_today(p_today date default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_oslo  date := (now() at time zone 'Europe/Oslo')::date;
  v_today date;
begin
  if v_user is null then raise exception 'app_repeat_days_today: not signed in' using errcode = '28000'; end if;
  v_today := case when p_today between v_oslo - 1 and v_oslo + 1 then p_today else v_oslo end;
  return public.repeat_days_for_user(v_user, v_today) || jsonb_build_object('today', v_today);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.repeat_monthly_day(integer, integer, integer, integer) from public, anon;
revoke all on function public.repeat_monthly_hits(date, integer, date, integer) from public, anon;
revoke all on function public.repeat_occurs_on(public.schedule_blocks, date) from public, anon;
revoke all on function public.repeat_day_target(public.schedule_blocks) from public, anon;
revoke all on function public.repeat_day_presence(public.schedule_blocks) from public, anon;
revoke all on function public.repeat_google_connected(uuid) from public, anon;
revoke all on function public.repeat_day_task(uuid, date, date, uuid, boolean) from public, anon;
revoke all on function public.repeat_days_follow_rule(uuid, date, boolean) from public, anon;
revoke all on function public.repeat_days_for_user(uuid, date) from public, anon;
revoke all on function public.repeat_days_run(date) from public, anon, authenticated;
revoke all on function public.app_repeat_days_today(date) from public, anon;
revoke all on function public.app_repeat_days_google_tasks(uuid, date, boolean) from public, anon;
revoke all on function public.item_occurrence(uuid, date, date, uuid) from public, anon;
revoke all on function public.app_save_item(jsonb) from public, anon;
revoke all on function public.app_repeat_day(uuid, date, text, date) from public, anon;
grant execute on function public.repeat_monthly_day(integer, integer, integer, integer) to authenticated;
grant execute on function public.repeat_monthly_hits(date, integer, date, integer) to authenticated;
grant execute on function public.repeat_occurs_on(public.schedule_blocks, date) to authenticated;
grant execute on function public.repeat_day_target(public.schedule_blocks) to authenticated;
grant execute on function public.repeat_day_presence(public.schedule_blocks) to authenticated;
grant execute on function public.repeat_google_connected(uuid) to authenticated;
grant execute on function public.repeat_day_task(uuid, date, date, uuid, boolean) to authenticated;
grant execute on function public.repeat_days_follow_rule(uuid, date, boolean) to authenticated;
grant execute on function public.repeat_days_for_user(uuid, date) to authenticated;
grant execute on function public.app_repeat_days_today(date) to authenticated;
grant execute on function public.app_repeat_days_google_tasks(uuid, date, boolean) to authenticated;
grant execute on function public.item_occurrence(uuid, date, date, uuid) to authenticated;
grant execute on function public.app_save_item(jsonb) to authenticated;
grant execute on function public.app_repeat_day(uuid, date, text, date) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.repeat_days_run(date) to service_role';
    execute 'grant execute on function public.repeat_day_task(uuid, date, date, uuid, boolean) to service_role';
    execute 'grant execute on function public.repeat_days_for_user(uuid, date) to service_role';
  end if;
end $$;

comment on function public.repeat_days_run(date) is
  'The hourly job (156): every account''s repeating items on Europe/Oslo''s today — days that passed unticked closed as missed, today''s day of each repeat made a task. Idempotent.';
comment on function public.app_repeat_days_today(date) is
  'The app''s call when it opens (156): the signed-in account''s repeats on its day (the hourly job''s fallback).';
comment on function public.repeat_day_task(uuid, date, date, uuid, boolean) is
  'The task of one day of a repeat (156): the one it has, or a new one when the repeat has that day. Never a slot.';

-- ── The schedule: hourly, a few minutes past (Europe/Oslo's midnight is on
-- the hour in UTC), calling the SQL function directly — no secret, no HTTP.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed here: lascis-repeat-days not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'lascis-repeat-days') then
    perform cron.unschedule('lascis-repeat-days');
  end if;
  perform cron.schedule('lascis-repeat-days', '2 * * * *', 'select public.repeat_days_run()');
end $$;

-- ── Assertions ──────────────────────────────────────────────────────────────
do $$
declare
  v_tasks bigint;
  v_cal bigint := 0;
  v_gt bigint := 0;
begin
  execute 'select count(*) from public.tasks' into v_tasks;
  if to_regclass('public.calendar_outbox') is not null then execute 'select count(*) from public.calendar_outbox' into v_cal; end if;
  if to_regclass('public.google_tasks_outbox') is not null then execute 'select count(*) from public.google_tasks_outbox' into v_gt; end if;
  if v_tasks::text <> current_setting('m156.tasks_rows') or v_cal::text <> current_setting('m156.calendar_rows')
     or v_gt::text <> current_setting('m156.gtasks_rows') then
    raise exception 'Migration 156 assertion failed: it made tasks or queued Google work (tasks % → %, calendar_outbox % → %, google_tasks_outbox % → %)',
      current_setting('m156.tasks_rows'), v_tasks, current_setting('m156.calendar_rows'), v_cal, current_setting('m156.gtasks_rows'), v_gt;
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tasks_occurrence_key') then
    raise exception 'Migration 156 assertion failed: tasks_occurrence_key is missing';
  end if;
end $$;
