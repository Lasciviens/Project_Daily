-- ═══════════════════════════════════════════════════════════════════════════
-- 166 — A moved training session is moved (owner, 25.10.2026: "If its moved it
-- should be moved. If it's skipped and not done in that week than it is
-- skipped. They are 2 different thing"). The report: Saturday 24.10's day
-- showed "Lower B 13:30 · Done" beside the real Lower B workout of that day,
-- after sessions had been postponed.
--
-- 141 links a synced Hevy workout to a planned session once — the session's
-- day is the workout's day or up to 6 days before it — and marks it done.
-- Nothing looked at that link again when the session moved. So a session
-- completed by another workout (141's "the one plan that day") and then
-- postponed kept "Done" and that workout on its new day, and the workout
-- really done there found nothing to complete. Now, when a training task's
-- day changes (Move, Edit, its slot moved, Google Tasks, the assistant):
--  1. a repeat's day moved without its slot (Google Tasks, the assistant) is
--     split like the app's Move — 156's item_occurrence: a slot on its new
--     day, the day out of the repeat — so every view shows it where it went;
--  2. a day closed as missed (156) that is moved to today or later is to do
--     on its new day: moved, not missed. A skip (training_skips, with its
--     reason) stays a skip;
--  3. a workout link that no longer fits (the workout isn't on the new day or
--     up to 6 days after it) goes: a session that workout closed is to do
--     again (a hand tick stays done), and the freed workout may complete
--     another plan of its own routine;
--  4. a session to do whose new day has come: the workouts of its own routine
--     logged from that day on (141's six days, up to today) that no plan took
--     go through 141's rule again, oldest first — so a session moved onto the
--     day it was done is completed by that workout.
-- 3 and 4 never use 141's "the one plan that day" stand-in (a workout of
-- another routine completing a session): that runs only when a workout syncs.
-- 3 and 4 are training_task_recheck, which the one-off repair in
-- docs/deploy-checklist.md calls for sessions already in that state.
-- Nothing else changes: 141's rule itself, the task queries (NEVER_HIDES), a
-- session ticked by hand, or one whose workout still fits.
--
-- No new table. Re-runnable: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- 141's rule run again for one workout — only where its OWN routine has a
-- plan for it (141's steps 1–3: that routine's plan on the workout's day or up
-- to 6 days before it, or the one a stand-in took on its day). 141's step 4,
-- "the one plan that day" whatever its routine, runs only when a workout
-- syncs: a move never lets another routine's workout complete a session —
-- that stand-in is how 24.10's Lower B read Done. SECURITY DEFINER: writing
-- hevy_workouts (synced, read-only for the app) re-runs 141's trigger; it only
-- touches the workout's own user's rows.
create or replace function public.training_workout_relink(p_workout text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w     public.hevy_workouts%rowtype;
  v_day date;
begin
  select * into w from hevy_workouts where id = p_workout;
  if not found or w.routine_id is null or w.start_time is null then return; end if;
  if exists (select 1 from tasks where hevy_workout_id = w.id) then return; end if;
  v_day := (w.start_time at time zone 'Europe/Oslo')::date;
  if exists (select 1 from training_plan_candidates(w.user_id, v_day) c where c.routine = w.routine_id)
     or exists (select 1 from tasks t join hevy_workouts o on o.id = t.hevy_workout_id
                 where t.user_id = w.user_id and t.hevy_routine_id = w.routine_id
                   and o.routine_id is distinct from w.routine_id
                   and coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date) = v_day) then
    update hevy_workouts set routine_id = routine_id where id = w.id;
  end if;
end;
$$;
revoke all on function public.training_workout_relink(text) from public, anon, authenticated;

-- 3 and 4 for one training task.
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
  v_wday  date;
  v_today date := (now() at time zone 'Europe/Oslo')::date;
  w       record;
begin
  select * into t from tasks where id = p_task;
  if not found or not (t.hevy_routine_id is not null or t.source_type = 'training_session') then return; end if;
  -- 141's planned day: its slot's date, else its due day.
  v_day := coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date);
  if v_day is null then return; end if;

  -- 3. The workout no longer fits the day: the link goes. A session that
  --    workout closed is to do again; one ticked by hand (141 linked it later,
  --    keeping the tick's time) stays done. The workout may be another plan's
  --    of its own routine.
  if t.hevy_workout_id is not null then
    select * into o from hevy_workouts where id = t.hevy_workout_id;
    v_wday := (o.start_time at time zone 'Europe/Oslo')::date;
    if v_wday is null or v_wday not between v_day and v_day + 6 then
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
  --    took, from that day on (141's six days, up to today), oldest first.
  if t.hevy_workout_id is null and t.hevy_routine_id is not null and t.status in ('open', 'in_progress') and v_day <= v_today then
    for w in
      select hw.id from hevy_workouts hw
       where hw.user_id = t.user_id
         and hw.routine_id = t.hevy_routine_id
         and hw.start_time is not null
         and (hw.start_time at time zone 'Europe/Oslo')::date between v_day and least(v_day + 6, v_today)
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
  '166: a training task''s Hevy workout link checked against its day — a workout that no longer fits (not on the day or up to 6 days after) is unlinked (a session it closed is to do again; a hand tick stays); a session to do whose day has come is offered the workouts of its own routine no plan took (141''s steps 1–3, never its step 4''s stand-in).';

-- 1–4 when a training task's day changes. Named to run after 156's
-- trg_repeat_day_task_moved and 142's trg_training_task_moves_block (after
-- triggers of one event run in name order), so the day is out of its repeat
-- and the slot already on the new day.
create or replace function public.training_task_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.due_date is null or new.due_date is not distinct from old.due_date then return null; end if;
  if not (new.hevy_routine_id is not null or new.source_type = 'training_session') then return null; end if;

  -- 1. A repeat's day moved without its slot: split like Move (a slot where it is now).
  if new.schedule_block_id is not null and new.occurrence_date is not null
     and not exists (select 1 from time_blocks b where b.task_id = new.id)
     and exists (select 1 from schedule_blocks s where s.id = new.schedule_block_id) then
    perform 1 from item_occurrence(new.schedule_block_id, new.occurrence_date, (now() at time zone 'Europe/Oslo')::date, new.user_id);
  end if;

  -- 2. Missed, then moved to today or later: to do on its new day (156's
  --    marker goes with the status). Moved to another past day it stays missed.
  update tasks set status = 'open'
   where id = new.id and status = 'cancelled' and closed_reason = 'missed'
     and new.due_date >= (now() at time zone 'Europe/Oslo')::date;

  perform training_task_recheck(new.id);
  return null;
end;
$$;
revoke all on function public.training_task_moved() from public, anon, authenticated;

drop trigger if exists trg_training_task_recheck on public.tasks;
create trigger trg_training_task_recheck
  after update of due_date on public.tasks
  for each row execute function public.training_task_moved();
