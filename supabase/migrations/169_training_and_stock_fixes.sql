-- ═══════════════════════════════════════════════════════════════════════════
-- 169 — Fixes from the 28.10.2026 audit: the training week rules (166/167)
-- and the supplement stock clock (160). Each function below is the latest
-- definition (named) with only the fix changed.
--
--  S1. The database's own training writes reach Google even when the move
--      came FROM Google. apply_calendar_readback (155) sets
--      app.calendar_readback and upsert_task_from_google (148) sets
--      app.google_sync_write for their whole transaction, so the outbox
--      triggers send nothing back (no echo). But a move of 7 or more days read
--      back from Google ran 167's rule D inside that transaction — the session
--      back on its first day and skipped there, that week's session moved to
--      the new day — and none of it was queued: Google kept the dragged event
--      on the new day and the other session on its old day, the app the
--      reverse, and the sync token never brought it back. Now
--      training_task_moved (the trigger behind 166/167) turns both flags off
--      for its own writes and puts them back before it returns: what it
--      changes (D's moves and skip, 166's recheck linking or unlinking a
--      workout) is queued like any change made in the app; the move Google
--      sent is still not sent back. A plain move from Google (no rule fires)
--      queues nothing, as before.
--  T2. A repeat's session moved 7 or more days into a week where its plan has
--      no session at all (every 2 weeks, monthly, picked dates, a day taken
--      out of the repeat) gets a new session on the new day, as a one-off
--      does (167's 3c). Only a week whose session is already done or skipped
--      gets none (docs/features/training.md, "Moved 7 or more days").
--  T5. The closing steps of an account's run (156's missed days, 167's
--      training_weeks_close) use the earlier of the caller's today and Europe/
--      Oslo's: the app's call takes the device's date (±1 day of Oslo's), and
--      a phone in UTC+3 at 23:30 Oslo time closed today's repeat days as
--      missed and skipped a session planned for today "Not done within 7
--      days". Making today's days keeps the caller's date.
--  T8. A session 'waiting' is still to do, as the app reads it
--      (todo/taskRules.ts OPEN_STATUSES): its own workout completes it
--      (training_plan_candidates, 141's stand-in step) and 166's recheck
--      offers it its routine's workouts. 156/167's other lists already had it.
--  S4. The supplement stock clock: a schedule put back (Undo of a delete,
--      144's app_restore_rows) keeps its stock_set_at — the tidy trigger reset
--      it to now() on every insert, so 455 g left read 500 g. A new schedule
--      with a stock count still starts its clock now (never a clock ahead).
--
-- No new table, no data changed. Re-runnable: CREATE OR REPLACE only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── T8. 167's candidates, a session 'waiting' still to do ──────────────────
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
         and (t.status in ('open', 'in_progress', 'waiting', 'done')
              or (t.status = 'cancelled' and t.closed_reason = 'missed')
              or (t.status = 'cancelled' and t.hevy_routine_id is not null
                  and exists (select 1 from training_skips k where k.task_id = t.id)))
    ) c
   where c.plan_day between p_day - 6 and p_day
     and p_day <= coalesce(c.first_plan_date, c.plan_day) + 6
     and (c.status <> 'done' or c.plan_day = p_day)
$$;
revoke all on function public.training_plan_candidates(uuid, date) from public, anon, authenticated;

-- 167's rule; T8: step 4's stand-in also takes a session 'waiting'.
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
     where c.plan_day = w_day and c.status in ('open', 'in_progress', 'waiting', 'done')
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

-- 167's recheck; T8: step 4 offers a session 'waiting' its routine's workouts.
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
  if t.hevy_workout_id is null and t.hevy_routine_id is not null and t.status in ('open', 'in_progress', 'waiting') and v_day <= v_today then
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
  '166/167/169: a training task''s Hevy workout link checked against its day — a workout that no longer fits (not on the day or up to 6 days after, inside the session''s week) or of another routine is unlinked (a session it closed is to do again; a hand tick stays); a session to do (open, in progress or waiting) whose day has come is offered the workouts of its own routine no plan took.';

-- ── T2. 167's move past the week; a repeat with no session there gets one ──
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

  -- 2. Skipped there, closed on that day (156's rule for a day that passed),
  --    so every list files it on its own day, never on the day of the move.
  select * into t from tasks where id = p_task;
  if t.status in ('open', 'in_progress', 'waiting') or (t.status = 'cancelled' and t.closed_reason = 'missed') then
    insert into training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
    values (t.user_id, t.hevy_routine_id, date_trunc('week', t.first_plan_date)::date,
            'Moved 7 or more days, to ' || to_char(p_to, 'DD.MM.YYYY'), t.id, t.first_plan_date)
    on conflict do nothing;
    update tasks set completed_at = ((t.first_plan_date + 1)::timestamp at time zone 'Europe/Oslo') - interval '1 second'
     where id = p_task and status = 'cancelled';
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

  -- 3c. A new session on p_to, as the planner makes one: for a one-off plan,
  --     and (169) for a repeat whose plan has no session in that week at all
  --     (every 2 weeks, monthly, picked dates, a day taken out of it). A
  --     repeat whose session that week is already done or skipped gets none.
  if t.schedule_block_id is not null and exists (
       select 1 from tasks x
        where x.user_id = t.user_id and x.id <> t.id
          and (x.hevy_routine_id is not null or x.source_type = 'training_session')
          and x.first_plan_date between v_week and v_week + 6
          and (x.schedule_block_id = t.schedule_block_id
               or (t.hevy_routine_id is not null and x.hevy_routine_id = t.hevy_routine_id)
               or (t.hevy_routine_id is null and lower(btrim(x.title)) = lower(btrim(t.title))))) then
    return;
  end if;
  -- It lives on Google where the moved session did (155's google_target; on
  -- Google Tasks through 071's outbox — a Calendar slot's event is the browser's).
  insert into tasks (user_id, title, description, domain, section, status, priority, due_date, due_time,
                     source_type, source_id, hevy_routine_id, google_target, google_sync_enabled)
  values (t.user_id, t.title, t.description, t.domain, item_section_for_day(p_to, v_today), 'open', t.priority,
          p_to, coalesce(p_to_time, t.due_time), 'training_session', t.source_id, t.hevy_routine_id,
          t.google_target, coalesce(t.google_sync_enabled, false))
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
comment on function public.training_move_past_week(uuid, date, time, time) is
  '167/169: a training session moved 7 or more days after its first day stays in its week (skipped there unless done) and the same plan''s session of the new day''s week moves there instead — or a new session there, for a one-off plan or a repeat with no session that week (none when that week''s is done or skipped).';

-- ── S1. 167's move trigger; its own writes reach Google ────────────────────
create or replace function public.training_task_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today    date := (now() at time zone 'Europe/Oslo')::date;
  -- 169: a move read back from Google (155's read-back, 148's Google Tasks
  -- pull) carries the echo flags for its whole transaction.
  v_readback text := current_setting('app.calendar_readback', true);
  v_gsync    text := current_setting('app.google_sync_write', true);
begin
  if new.due_date is null or new.due_date is not distinct from old.due_date then return null; end if;
  if not (new.hevy_routine_id is not null or new.source_type = 'training_session') then return null; end if;

  -- 169: what follows is the database's own decision, not Google's data:
  -- queued for Google like a change made in the app (the flags are put back
  -- below, so the move Google sent is still not sent back).
  perform set_config('app.calendar_readback', 'off', true);
  perform set_config('app.google_sync_write', '', true);

  -- D. Out of its week: skipped there, that week's session moves instead.
  if new.first_plan_date is not null and new.due_date >= new.first_plan_date + 7 then
    perform training_move_past_week(new.id, new.due_date, new.due_time, old.due_time);
    perform set_config('app.calendar_readback', coalesce(v_readback, ''), true);
    perform set_config('app.google_sync_write', coalesce(v_gsync, ''), true);
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
  perform set_config('app.calendar_readback', coalesce(v_readback, ''), true);
  perform set_config('app.google_sync_write', coalesce(v_gsync, ''), true);
  return null;
end;
$$;
revoke all on function public.training_task_moved() from public, anon, authenticated;

-- ── T5. 167's account run; it closes days only up to Oslo's today ──────────
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
  -- 169: a day closes only once it has passed in Europe/Oslo — a device a
  -- day ahead (the app's call) makes its today's days, never closes today.
  v_close     date := least(p_today, (now() at time zone 'Europe/Oslo')::date);
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
     where t.id = due.id and due.day is not null and due.day < v_close
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
    v_skipped := public.training_weeks_close(p_user, v_close);
  exception when others then
    v_failed := v_failed + 1;
    raise warning 'repeat_days: training weeks not closed (%)', sqlstate;
  end;
  return jsonb_build_object('missed', v_missed, 'created', v_created, 'failed', v_failed, 'skipped', v_skipped);
end;
$$;
revoke all on function public.repeat_days_for_user(uuid, date) from public, anon;
grant execute on function public.repeat_days_for_user(uuid, date) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.repeat_days_for_user(uuid, date) to service_role';
  end if;
end $$;

-- ── S4. 160's tidy trigger; a schedule put back keeps its stock clock ──────
-- <stock-clock>
create or replace function public.supplement_schedules_tidy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  new.dose_unit := btrim(new.dose_unit);
  new.times := array(select distinct date_trunc('minute', t::interval)::time from unnest(new.times) t where t is not null order by 1);
  new.remind_until := date_trunc('minute', new.remind_until::interval)::time;
  new.days_of_week := array(select distinct d from unnest(coalesce(new.days_of_week, '{}'::integer[])) d where d is not null order by d);
  if new.repeat_dates is not null then
    new.repeat_dates := array(select distinct d from unnest(new.repeat_dates) d where d is not null order by d);
  end if;
  new.except_dates := array(select distinct d from unnest(coalesce(new.except_dates, '{}'::date[])) d where d is not null order by d);
  -- 169: an insert keeps a clock it is given (a row put back by Undo), never
  -- one ahead of now; a new count, or a stock changed, starts it now.
  if tg_op = 'INSERT' or new.stock_amount is distinct from old.stock_amount then
    new.stock_set_at := case when new.stock_amount is null then null
                             when tg_op = 'INSERT' then least(new.stock_set_at, now())
                             else now() end;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.supplement_schedules_tidy() from public, anon;
grant execute on function public.supplement_schedules_tidy() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.supplement_schedules_tidy() to service_role';
  end if;
end $$;
-- </stock-clock>
