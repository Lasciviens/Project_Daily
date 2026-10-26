-- ═══════════════════════════════════════════════════════════════════════════
-- 167 — A workout represents itself, and a session lives one week (owner,
-- 26.10.2026: "'Done' always means that workout was done. A workout just
-- represents itself. If it is moved it is moved. If it is moved more than 7
-- days than it is skipped automatically! (This is a rule!)" — and: "If it is
-- going to be moved for 9 days that means [that] week's workout was skipped
-- and [the] next week['s] workout was moved for 2 days. If it is moved only
-- for 4 days than it is just moved. If the workout have not been done in 7
-- [days] than it is just skipped on its own first date.").
--
-- After 166 the 24.10 report could still happen: 141's "the one plan that
-- day" let a workout of ANOTHER routine complete a session (Upper B closing
-- Lower B), 166 kept such a link when the session moved inside six days, a
-- moved session could not win its own workout back, and a session skipped
-- and then done later that week let the workout close another routine's
-- session instead. Now:
--  A. Every training session has its first day (tasks.first_plan_date: a
--     repeat's day, else the day it was first planned for). Its week is that
--     day and the next six. A move never changes it.
--  B. A workout completes only a session of its own routine. A stand-in is
--     left only where a routine is missing: a workout with no routine, or a
--     session with no routine (141's step 4, narrowed). A workout completes a
--     session only inside the session's week.
--  C. Skipped, then done inside its week: done (the skip goes, 142). Skipped
--     and moved to today or later inside its week: to do again.
--  D. Moved 7 or more days after its first day: it stays in its own week —
--     back on its first day, skipped ("Moved more than 7 days, to …"; a
--     session done stays done) — and the same plan's session of the week the
--     new day falls in moves to that day instead (the next week's, made from
--     the repeat if nobody acted on it yet); a one-off plan with none gets a
--     new session there.
--  E. Not done by the end of its week: skipped on its first day ("Not done
--     within 7 days") — the hourly job (156) and the app's call when it
--     opens. A session planned for today or later (moved there before 167)
--     is left as planned.
--  F. 166's recheck unlinks a workout of another routine (it never fits).
--     Links like that made before 167 are fixed by the one-off repair in
--     docs/deploy-checklist.md (the owner runs it once).
-- Nothing else changes: the task queries (NEVER_HIDES), a session ticked by
-- hand, 142's skip ⇄ cancel, 156's missed days inside their week.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS; the backfill only fills what is empty.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. A session's first day ───────────────────────────────────────────────
alter table public.tasks add column if not exists first_plan_date date;
comment on column public.tasks.first_plan_date is
  'A training session''s first day (167): a repeat''s day, else the day it was first planned for. Its week is that day and the next six; a move never changes it. NULL for tasks that are not training.';

-- Filled once, when a task is (or becomes) a training session — never moved.
create or replace function public.training_first_plan_date()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_day date;
begin
  if new.first_plan_date is not null then return new; end if;
  if not (new.hevy_routine_id is not null or new.source_type = 'training_session') then return new; end if;
  -- An update that moves it keeps the day it had before the move.
  if tg_op = 'UPDATE' then v_day := old.due_date; end if;
  new.first_plan_date := coalesce(new.occurrence_date, v_day, new.due_date);
  return new;
end;
$$;
revoke all on function public.training_first_plan_date() from public, anon, authenticated;

-- After 141's trg_tasks_link_training (BEFORE triggers run in name order), so
-- a routine found by title counts.
drop trigger if exists trg_training_first_plan_date on public.tasks;
create trigger trg_training_first_plan_date
  before insert or update on public.tasks
  for each row execute function public.training_first_plan_date();

-- Existing sessions: a repeat's day is its first day; any other session's
-- first day is the day it is planned for now (a move before 167 left no trace).
update public.tasks t
   set first_plan_date = coalesce(t.occurrence_date,
                                  (select min(b.date) from public.time_blocks b where b.task_id = t.id),
                                  t.due_date)
 where t.first_plan_date is null
   and (t.hevy_routine_id is not null or t.source_type = 'training_session');

-- ── B, C. The sessions a workout on day p_day can complete ─────────────────
-- 141/156's candidates (not linked yet; open — or ticked by hand that day —
-- or closed as missed; planned on the day or up to six days before it), and
-- now: only inside the session's own week, and a session SKIPPED inside its
-- week too (status 'skipped': only its own routine's workout takes it, 167 C).
-- status reads 'missed' / 'skipped' for the two kinds of cancelled session.
create or replace function public.training_plan_candidates(p_user uuid, p_day date)
returns table (id uuid, routine text, status text, plan_day date, created_at timestamptz)
language sql
stable
set search_path = public
as $$
  select c.id, c.routine, c.status, c.plan_day, c.created_at
    from (
      select t.id, t.hevy_routine_id as routine, t.created_at, t.first_plan_date,
             case when t.status <> 'cancelled' then t.status
                  when t.closed_reason = 'missed' then 'missed'
                  else 'skipped' end as status,
             coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date) as plan_day
        from tasks t
       where t.user_id = p_user
         and t.hevy_workout_id is null
         and (t.hevy_routine_id is not null or t.source_type = 'training_session')
         and (t.status in ('open', 'in_progress', 'done')
              or (t.status = 'cancelled' and t.closed_reason = 'missed')
              or (t.status = 'cancelled' and t.hevy_routine_id is not null
                  and exists (select 1 from training_skips k where k.task_id = t.id)))
    ) c
   where c.plan_day between p_day - 6 and p_day
     and p_day <= coalesce(c.first_plan_date, c.plan_day) + 6
     and (c.status <> 'done' or c.plan_day = p_day)
$$;
revoke all on function public.training_plan_candidates(uuid, date) from public, anon, authenticated;

-- 141's rule with 167's B and C. SECURITY DEFINER so the rule never depends
-- on who wrote the workout (it only reads and writes NEW.user_id's tasks).
create or replace function public.hevy_workout_completes_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w_day date;
  t_id  uuid;
  n     int;
begin
  if new.start_time is null then return new; end if;
  -- Already linked (a re-sync of the same workout): nothing to do.
  if exists (select 1 from tasks where hevy_workout_id = new.id) then return new; end if;
  w_day := (new.start_time at time zone 'Europe/Oslo')::date;

  -- 1. Its routine's session on the workout's day: one to do first, then one
  --    closed as missed, one skipped (done inside its week after all), one
  --    ticked by hand.
  if new.routine_id is not null then
    select c.id into t_id from training_plan_candidates(new.user_id, w_day) c
     where c.routine = new.routine_id and c.plan_day = w_day
     order by case c.status when 'done' then 3 when 'skipped' then 2 when 'missed' then 1 else 0 end, c.created_at
     limit 1;
  end if;

  -- 2. Its routine's session that day that a workout with no routine took
  --    first (step 4): this workout is its own — take it over.
  if t_id is null and new.routine_id is not null then
    select t.id into t_id
      from tasks t join hevy_workouts w on w.id = t.hevy_workout_id
     where t.user_id = new.user_id
       and t.hevy_routine_id = new.routine_id
       and w.routine_id is distinct from new.routine_id
       and coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date) = w_day
     order by t.created_at
     limit 1;
    if t_id is not null then
      update tasks
         set hevy_workout_id = new.id,
             completed_at    = coalesce(new.end_time, new.start_time)
       where id = t_id;
      return new;
    end if;
  end if;

  -- 3. Its routine's session from earlier in that session's week (done late):
  --    one to do before a skipped one.
  if t_id is null and new.routine_id is not null then
    select c.id into t_id from training_plan_candidates(new.user_id, w_day) c
     where c.routine = new.routine_id and c.plan_day < w_day
     order by (c.status = 'skipped'), c.plan_day desc, c.created_at
     limit 1;
  end if;

  -- 4. A stand-in only where a routine is missing: the one session to do that
  --    day, when the workout has no routine or that session has none.
  if t_id is null then
    select min(c.id::text)::uuid, count(*) into t_id, n
      from training_plan_candidates(new.user_id, w_day) c
     where c.plan_day = w_day and c.status in ('open', 'in_progress', 'done')
       and (new.routine_id is null or c.routine is null);
    if n <> 1 then t_id := null; end if;
  end if;

  if t_id is not null then
    update tasks
       set hevy_workout_id = new.id,
           completed_at    = case when status = 'done' then completed_at
                                  else coalesce(new.end_time, new.start_time) end,
           status          = 'done'
     where id = t_id and hevy_workout_id is null;
  end if;
  return new;
end;
$$;

-- ── F. 166's recheck: a workout of another routine never fits ──────────────
create or replace function public.training_task_recheck(p_task uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.tasks%rowtype;
  o       public.hevy_workouts%rowtype;
  v_day   date;
  v_last  date;
  v_wday  date;
  v_today date := (now() at time zone 'Europe/Oslo')::date;
  w       record;
begin
  select * into t from tasks where id = p_task;
  if not found or not (t.hevy_routine_id is not null or t.source_type = 'training_session') then return; end if;
  -- 141's planned day: its slot's date, else its due day.
  v_day := coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date);
  if v_day is null then return; end if;
  -- The last day a workout still completes it: six days on, inside its week.
  v_last := least(v_day + 6, coalesce(t.first_plan_date, v_day) + 6);

  -- 3. The workout no longer fits — not on the day or up to the last day, or
  --    of another routine (167): the link goes. A session that workout closed
  --    is to do again; one ticked by hand (141 linked it later, keeping the
  --    tick's time) stays done. The workout may be another plan's of its own
  --    routine.
  if t.hevy_workout_id is not null then
    select * into o from hevy_workouts where id = t.hevy_workout_id;
    v_wday := (o.start_time at time zone 'Europe/Oslo')::date;
    if v_wday is null or v_wday not between v_day and v_last
       or (t.hevy_routine_id is not null and o.routine_id is not null and o.routine_id <> t.hevy_routine_id) then
      update tasks
         set hevy_workout_id = null,
             status = case when status = 'done' and completed_at is not distinct from coalesce(o.end_time, o.start_time)
                           then 'open' else status end
       where id = t.id;
      perform training_workout_relink(o.id);
      select * into t from tasks where id = p_task;
    end if;
  end if;

  -- 4. To do on a day that has come: the workouts of its own routine no plan
  --    took, from that day to the last day (up to today), oldest first.
  if t.hevy_workout_id is null and t.hevy_routine_id is not null and t.status in ('open', 'in_progress') and v_day <= v_today then
    for w in
      select hw.id from hevy_workouts hw
       where hw.user_id = t.user_id
         and hw.routine_id = t.hevy_routine_id
         and hw.start_time is not null
         and (hw.start_time at time zone 'Europe/Oslo')::date between v_day and least(v_last, v_today)
         and not exists (select 1 from tasks x where x.hevy_workout_id = hw.id)
       order by hw.start_time, hw.id
    loop
      perform training_workout_relink(w.id);
    end loop;
  end if;
end;
$$;
revoke all on function public.training_task_recheck(uuid) from public, anon, authenticated;
comment on function public.training_task_recheck(uuid) is
  '166/167: a training task''s Hevy workout link checked against its day — a workout that no longer fits (not on the day or up to 6 days after, inside the session''s week) or of another routine is unlinked (a session it closed is to do again; a hand tick stays); a session to do whose day has come is offered the workouts of its own routine no plan took.';

-- ── D. Moved out of its week ───────────────────────────────────────────────
-- p_task was moved to p_to, 7 or more days after its first day. It stays in
-- its own week (back on its first day, at p_back_time) and is skipped there —
-- a session done stays done, one skipped keeps its reason. The same plan's
-- session of the week p_to falls in (first day + 7k) moves to p_to at
-- p_to_time instead: its task (the same repeat first, then the same routine —
-- or title, with no routine), else that week's day of a training repeat of
-- the same routine nobody acted on yet (made its own, 156's split), else — a
-- one-off plan — a new session on p_to (a task and its slot).
create or replace function public.training_move_past_week(p_task uuid, p_to date, p_to_time time, p_back_time time)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t        public.tasks%rowtype;
  v_week   date;
  v_today  date := (now() at time zone 'Europe/Oslo')::date;
  v_target uuid;
  v_new    uuid;
  v_day    date;
  p        public.schedule_blocks%rowtype;
  v_block  public.time_blocks%rowtype;
begin
  select * into t from tasks where id = p_task;
  if not found or t.first_plan_date is null or p_to is null or p_to < t.first_plan_date + 7 then return; end if;
  v_week := t.first_plan_date + 7 * ((p_to - t.first_plan_date) / 7);

  -- 1. Back on its first day (its slot follows, 142; 166 looks at its workout again).
  update tasks set due_date = t.first_plan_date, due_time = coalesce(p_back_time, due_time) where id = p_task;

  -- 2. Skipped there.
  select * into t from tasks where id = p_task;
  if t.status in ('open', 'in_progress', 'waiting') or (t.status = 'cancelled' and t.closed_reason = 'missed') then
    insert into training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
    values (t.user_id, t.hevy_routine_id, date_trunc('week', t.first_plan_date)::date,
            'Moved more than 7 days, to ' || to_char(p_to, 'DD.MM.YYYY'), t.id, t.first_plan_date)
    on conflict do nothing;
  end if;

  -- 3a. That week's session of the same plan, still to do.
  select x.id into v_target
    from tasks x
   where x.user_id = t.user_id and x.id <> t.id
     and (x.hevy_routine_id is not null or x.source_type = 'training_session')
     and x.first_plan_date between v_week and v_week + 6
     and x.hevy_workout_id is null
     and (x.status in ('open', 'in_progress', 'waiting') or (x.status = 'cancelled' and x.closed_reason = 'missed'))
     and ((t.schedule_block_id is not null and x.schedule_block_id = t.schedule_block_id)
          or (t.hevy_routine_id is not null and x.hevy_routine_id = t.hevy_routine_id)
          or (t.hevy_routine_id is null and lower(btrim(x.title)) = lower(btrim(t.title))))
   order by case when t.schedule_block_id is not null and x.schedule_block_id = t.schedule_block_id then 0 else 1 end,
            x.first_plan_date, x.created_at, x.id
   limit 1;

  -- 3b. Else that week's day of a training repeat nobody acted on yet.
  if v_target is null then
    for p in
      select s.* from schedule_blocks s
       where s.user_id = t.user_id and s.category = 'training'
         and (s.id = t.schedule_block_id
              or (t.hevy_routine_id is not null and repeat_day_routine(t.user_id, s.title) = t.hevy_routine_id))
       order by case when s.id = t.schedule_block_id then 0 else 1 end, s.created_at, s.id
    loop
      for v_day in select d::date from generate_series(v_week::timestamp, (v_week + 6)::timestamp, interval '1 day') d loop
        continue when not repeat_occurs_on(p, v_day);
        continue when exists (select 1 from tasks x where x.schedule_block_id = p.id and x.occurrence_date = v_day);
        select o.task_id into v_target from item_occurrence(p.id, v_day, v_today, t.user_id) o;
        exit when v_target is not null;
      end loop;
      exit when v_target is not null;
    end loop;
  end if;

  if v_target is not null then
    update tasks set due_date = p_to, due_time = coalesce(p_to_time, due_time) where id = v_target;
    return;
  end if;

  -- 3c. A one-off plan: a new session on p_to, as the planner makes one.
  insert into tasks (user_id, title, description, domain, section, status, priority, due_date, due_time,
                     source_type, source_id, hevy_routine_id)
  values (t.user_id, t.title, t.description, t.domain, item_section_for_day(p_to, v_today), 'open', t.priority,
          p_to, coalesce(p_to_time, t.due_time), 'training_session', t.source_id, t.hevy_routine_id)
  returning id into v_new;
  select * into v_block from time_blocks b where b.task_id = t.id order by b.created_at, b.id limit 1;
  if found then
    insert into time_blocks (user_id, date, title, start_time, duration_minutes, category, task_id, source_type, source_id)
    values (t.user_id, p_to, v_block.title, coalesce(p_to_time, v_block.start_time), v_block.duration_minutes,
            'training', v_new, 'training_session', v_block.source_id);
  end if;
end;
$$;
revoke all on function public.training_move_past_week(uuid, date, time, time) from public, anon, authenticated;

-- 166's move trigger with 167's C and D. Named to run after 156's
-- trg_repeat_day_task_moved and 142's trg_training_task_moves_block (after
-- triggers of one event run in name order).
create or replace function public.training_task_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Oslo')::date;
begin
  if new.due_date is null or new.due_date is not distinct from old.due_date then return null; end if;
  if not (new.hevy_routine_id is not null or new.source_type = 'training_session') then return null; end if;

  -- D. Out of its week: skipped there, that week's session moves instead.
  if new.first_plan_date is not null and new.due_date >= new.first_plan_date + 7 then
    perform training_move_past_week(new.id, new.due_date, new.due_time, old.due_time);
    return null;
  end if;

  -- 1. A repeat's day moved without its slot: split like Move (a slot where it is now).
  if new.schedule_block_id is not null and new.occurrence_date is not null
     and not exists (select 1 from time_blocks b where b.task_id = new.id)
     and exists (select 1 from schedule_blocks s where s.id = new.schedule_block_id) then
    perform 1 from item_occurrence(new.schedule_block_id, new.occurrence_date, v_today, new.user_id);
  end if;

  -- 2. Missed, then moved to today or later: to do on its new day (156's
  --    marker goes with the status). Moved to another past day it stays missed.
  update tasks set status = 'open'
   where id = new.id and status = 'cancelled' and closed_reason = 'missed'
     and new.due_date >= v_today;

  -- C. Skipped, then moved to today or later inside its week: to do again
  --    (removing its skip reopens it, 142). Not when D put it back on its
  --    first day (the move came from outside its week).
  if new.due_date >= v_today and old.due_date < coalesce(new.first_plan_date, old.due_date) + 7 then
    delete from training_skips k
     where k.task_id = new.id
       and exists (select 1 from tasks x where x.id = new.id and x.status = 'cancelled' and x.closed_reason is null);
  end if;

  perform training_task_recheck(new.id);
  return null;
end;
$$;
revoke all on function public.training_task_moved() from public, anon, authenticated;

drop trigger if exists trg_training_task_recheck on public.tasks;
create trigger trg_training_task_recheck
  after update of due_date on public.tasks
  for each row execute function public.training_task_moved();

-- ── E. The end of a session's week ─────────────────────────────────────────
-- One account's sessions whose week ended (first day + 7 <= p_today) that are
-- still to do or closed as missed: back on their first day (166 may still
-- find a workout of their routine from that week), else skipped there. A
-- session planned for p_today or later is left as planned. Answers how many
-- it skipped.
create or replace function public.training_weeks_close(p_user uuid, p_today date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  if p_user is null or p_today is null then return 0; end if;
  for r in
    select t.id, t.first_plan_date,
           coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id), t.due_date) as plan_day
      from public.tasks t
     where t.user_id = p_user
       and (t.hevy_routine_id is not null or t.source_type = 'training_session')
       and t.first_plan_date is not null and t.first_plan_date + 7 <= p_today
       and (t.status in ('open', 'in_progress', 'waiting') or (t.status = 'cancelled' and t.closed_reason = 'missed'))
     order by t.first_plan_date, t.id
  loop
    continue when r.plan_day is not null and r.plan_day >= p_today;
    if r.plan_day is distinct from r.first_plan_date then
      update public.tasks set due_date = r.first_plan_date where id = r.id;
    end if;
    insert into public.training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
    select t.user_id, t.hevy_routine_id, date_trunc('week', t.first_plan_date)::date, 'Not done within 7 days', t.id, t.first_plan_date
      from public.tasks t
     where t.id = r.id
       and (t.status in ('open', 'in_progress', 'waiting') or (t.status = 'cancelled' and t.closed_reason = 'missed'))
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.training_weeks_close(uuid, date) from public, anon;
grant execute on function public.training_weeks_close(uuid, date) to authenticated;

-- 156's account run, with E after its missed days (step 3).
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
  v_skipped   integer := 0;
  v_connected boolean;
  p           public.schedule_blocks%rowtype;
  v_new       boolean;
begin
  if p_user is null or p_today is null then
    return jsonb_build_object('missed', 0, 'created', 0, 'failed', 0, 'skipped', 0);
  end if;

  -- 1. Missed: closed on its own day, never carried over.
  with due as (
    select t.id, coalesce((select min(b.date) from public.time_blocks b where b.task_id = t.id), t.due_date) as day
      from public.tasks t
     where t.user_id = p_user and t.occurrence_date is not null
       and t.status in ('open', 'in_progress', 'waiting')
  ), closed as (
    update public.tasks t
       set status = 'cancelled', closed_reason = 'missed',
           completed_at = ((due.day + 1)::timestamp at time zone 'Europe/Oslo') - interval '1 second'
      from due
     where t.id = due.id and due.day is not null and due.day < p_today
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

  -- 3. Training sessions whose week ended (167).
  begin
    v_skipped := public.training_weeks_close(p_user, p_today);
  exception when others then
    v_failed := v_failed + 1;
    raise warning 'repeat_days: training weeks not closed (%)', sqlstate;
  end;
  return jsonb_build_object('missed', v_missed, 'created', v_created, 'failed', v_failed, 'skipped', v_skipped);
end;
$$;

-- 156's hourly job, also visiting an account whose only due work is a
-- training session's week to close (a one-off plan, no repeat).
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
  v_skipped integer := 0;
  v_lock    boolean := to_regclass('public.app_allowed_users') is not null;
  v_allowed boolean;
begin
  for u in select x.user_id from (
             select s.user_id from public.schedule_blocks s
             union
             select t.user_id from public.tasks t
              where t.occurrence_date is not null and t.status in ('open', 'in_progress', 'waiting')
             union
             select t.user_id from public.tasks t
              where (t.hevy_routine_id is not null or t.source_type = 'training_session')
                and t.first_plan_date + 7 <= v_today
                and (t.status in ('open', 'in_progress', 'waiting') or (t.status = 'cancelled' and t.closed_reason = 'missed'))
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
      v_skipped := v_skipped + coalesce((r ->> 'skipped')::integer, 0);
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'repeat_days: an account''s run failed (%)', sqlstate;
    end;
  end loop;
  return jsonb_build_object('today', v_today, 'users', v_users, 'missed', v_missed, 'created', v_created,
                            'failed', v_failed, 'skipped', v_skipped);
end;
$$;
revoke all on function public.repeat_days_for_user(uuid, date) from public, anon;
revoke all on function public.repeat_days_run(date) from public, anon, authenticated;
grant execute on function public.repeat_days_for_user(uuid, date) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.repeat_days_run(date) to service_role';
    execute 'grant execute on function public.repeat_days_for_user(uuid, date) to service_role';
    execute 'grant execute on function public.training_weeks_close(uuid, date) to service_role';
  end if;
end $$;

comment on function public.repeat_days_run(date) is
  'The hourly job (156, 167): every account''s repeating items on Europe/Oslo''s today — days that passed unticked closed as missed, today''s day of each repeat made a task, training sessions whose week ended skipped on their first day. Idempotent.';
comment on function public.training_weeks_close(uuid, date) is
  '167: an account''s training sessions whose week (first day + 6) ended still to do or missed: back on their first day, then skipped there ("Not done within 7 days") unless a workout of their routine from that week completes them.';
comment on function public.training_move_past_week(uuid, date, time, time) is
  '167: a training session moved 7 or more days after its first day stays in its week (skipped there unless done) and the same plan''s session of the new day''s week moves there instead (or a new one-off session).';
