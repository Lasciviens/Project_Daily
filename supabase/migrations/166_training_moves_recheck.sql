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
--  2. a day closed as missed (156) that is moved is to do again on its new
--     day: moved, not missed. A skip (training_skips, with its reason) stays
--     a skip;
--  3. a workout link that no longer fits (the workout isn't on the new day or
--     up to 6 days after it) goes: the session is to do again, and the freed
--     workout goes through 141's rule once more (it may be another plan's);
--  4. a session to do whose new day has come: every workout logged from that
--     day on (141's six days, up to today) that no plan took goes through
--     141's rule again, oldest first — so a session moved onto the day it was
--     done is completed by that workout.
-- 3 and 4 are training_task_recheck, which the one-off repair in
-- docs/deploy-checklist.md calls for sessions already in that state.
-- Nothing else changes: 141's rule itself, the task queries (NEVER_HIDES), a
-- session ticked by hand (no workout), or one whose workout still fits.
--
-- No new table. Re-runnable: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- 3 and 4 for one training task. SECURITY DEFINER: running 141's rule again
-- writes hevy_workouts (synced, read-only for the app); it only ever touches
-- the task's own user's rows.
create or replace function public.training_task_recheck(p_task uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.tasks%rowtype;
  v_day   date;
  v_wday  date;
  v_today date := (now() at time zone 'Europe/Oslo')::date;
  v_freed text;
  w       record;
begin
  select * into t from tasks where id = p_task;
  if not found or not (t.hevy_routine_id is not null or t.source_type = 'training_session') then return; end if;
  -- 141's planned day: its slot's date, else its due day.
  v_day := coalesce((select min(b.date) from time_blocks b where b.task_id = t.id), t.due_date);
  if v_day is null then return; end if;

  -- 3. The workout no longer fits the day: the link goes (a done session is
  --    to do again — 142's tasks_link_training would drop the link on reopen
  --    too), then the workout gets 141's rule once more.
  if t.hevy_workout_id is not null then
    select (start_time at time zone 'Europe/Oslo')::date into v_wday from hevy_workouts where id = t.hevy_workout_id;
    if v_wday is null or v_wday not between v_day and v_day + 6 then
      v_freed := t.hevy_workout_id;
      update tasks
         set hevy_workout_id = null,
             status = case when status = 'done' then 'open' else status end
       where id = t.id;
      update hevy_workouts set routine_id = routine_id where id = v_freed;
      select * into t from tasks where id = p_task;
    end if;
  end if;

  -- 4. To do on a day that has come: the workouts no plan took, from that day on.
  if t.hevy_workout_id is null and t.status in ('open', 'in_progress') and v_day <= v_today then
    for w in
      select hw.id from hevy_workouts hw
       where hw.user_id = t.user_id
         and hw.start_time is not null
         and (hw.start_time at time zone 'Europe/Oslo')::date between v_day and least(v_day + 6, v_today)
         and not exists (select 1 from tasks x where x.hevy_workout_id = hw.id)
       order by hw.start_time, hw.id
    loop
      update hevy_workouts set routine_id = routine_id where id = w.id;
    end loop;
  end if;
end;
$$;
revoke all on function public.training_task_recheck(uuid) from public, anon, authenticated;
comment on function public.training_task_recheck(uuid) is
  '166: a training task''s Hevy workout link checked against its day — a workout that no longer fits (not on the day or up to 6 days after) is unlinked and the session is to do again; a session to do whose day has come is offered the workouts no plan took (141''s rule, oldest first).';

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

  -- 2. Missed, then moved: to do on its new day (156's marker goes with the status).
  update tasks set status = 'open'
   where id = new.id and status = 'cancelled' and closed_reason = 'missed';

  perform training_task_recheck(new.id);
  return null;
end;
$$;
revoke all on function public.training_task_moved() from public, anon, authenticated;

drop trigger if exists trg_training_task_recheck on public.tasks;
create trigger trg_training_task_recheck
  after update of due_date on public.tasks
  for each row execute function public.training_task_moved();
