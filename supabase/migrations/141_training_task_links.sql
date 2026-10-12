-- A planned training session's task is linked to its routine and, once
-- trained, to the Hevy workout that did it — in the database, for every
-- writer (owner, 12.10.2026: "not connected to the training itself … fix it
-- on db-level, enough with temp solutions").
--
-- Before this the link was a convention: tasks.source_type =
-- 'training_session' + tasks.source_id = the routine id, written only by the
-- web planner. A task made any other way (the task popup, the assistant, a
-- Google Tasks pull, "plan a session" without a routine) had no link at all,
-- and the four Hevy functions closed a plan by DELETING every open task of
-- that routine — future plans too, with no date check — so a finished
-- session left no "planned · done" record and Home never counted it.
--
-- Now:
--   tasks.hevy_routine_id  → hevy_routines(id)  the routine this task trains
--   tasks.hevy_workout_id  → hevy_workouts(id)  the workout that did it
-- (text, like Hevy's ids; ON DELETE SET NULL — a routine pruned or a workout
-- deleted in Hevy only drops the link, never the task. Hevy rows are upserted
-- in place by the sync, so the keys are stable.)
--
--   trg_tasks_link_training (BEFORE INSERT/UPDATE on tasks) fills
--   hevy_routine_id for every writer: from source_id on a training_session
--   task, or — for a personal task the assistant or a person typed — from the
--   ONE routine whose title is exactly the task's title (case and outer
--   spaces ignored; two routines with that title link nothing). It is
--   recomputed when the title or source changes, and reopening a done task
--   drops its workout.
--
--   trg_hevy_workout_completes_plan (AFTER INSERT/UPDATE OF routine_id,
--   start_time on hevy_workouts) marks the planned task done and links the
--   workout: the open plan of the same routine on the workout's day (Oslo)
--   or up to 6 days before it (a session done a day late), else the ONE open
--   training plan on that day (a freeform workout, or another routine done
--   in its place — the calendar already shows it as "in place of"); a
--   workout of the plan's own routine that day later takes the plan over
--   from such a stand-in. A plan the person ticked done that day is linked
--   too, its status left alone. A workout deleted in Hevy leaves its plan
--   done (the link goes; the session happened).
--   Never a future plan, never a delete; a workout links at most one task.
--   The Hevy functions no longer delete anything (same PR).
--
-- Backfill: existing training tasks get their routine; then every workout,
-- oldest first, runs the same rule, so past plans that were trained but left
-- open are closed at the workout's own end time (not now — Home's "done
-- today" reads completed_at). Nothing is deleted or hidden.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS hevy_routine_id text REFERENCES public.hevy_routines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hevy_workout_id text REFERENCES public.hevy_workouts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tasks.hevy_routine_id IS
  'The Hevy routine this task plans (a training session). Filled by trg_tasks_link_training for every writer; NULL for other tasks.';
COMMENT ON COLUMN public.tasks.hevy_workout_id IS
  'The Hevy workout that completed this planned session. Set by trg_hevy_workout_completes_plan when the workout syncs; never by the assistant.';

CREATE UNIQUE INDEX IF NOT EXISTS tasks_hevy_workout_id_key
  ON public.tasks (hevy_workout_id) WHERE hevy_workout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_training_plans
  ON public.tasks (user_id, hevy_routine_id) WHERE hevy_routine_id IS NOT NULL;

-- ── 1. Every training task knows its routine ────────────────────────────────
-- Filled on insert, and recomputed when the title, domain or source changes
-- (a task renamed away from a routine's name loses the link) — unless that
-- same write set hevy_routine_id itself. Reopening a done task (or
-- cancelling it) drops its workout, so a later workout can complete it.
CREATE OR REPLACE FUNCTION public.tasks_link_training()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r_id text;
  n    int;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'done' AND NEW.status <> 'done'
     AND NEW.hevy_workout_id IS NOT DISTINCT FROM OLD.hevy_workout_id THEN
    NEW.hevy_workout_id := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.hevy_routine_id IS NOT NULL THEN RETURN NEW; END IF;
  ELSIF NEW.hevy_routine_id IS DISTINCT FROM OLD.hevy_routine_id
     OR (NEW.title, NEW.domain, NEW.source_type, NEW.source_id)
        IS NOT DISTINCT FROM (OLD.title, OLD.domain, OLD.source_type, OLD.source_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type = 'training_session' AND NEW.source_id IS NOT NULL THEN
    SELECT r.id INTO r_id FROM hevy_routines r
     WHERE lower(r.id) = NEW.source_id::text AND r.user_id = NEW.user_id;
  ELSIF NEW.source_type IN ('manual', 'ai') AND NEW.domain = 'personal' THEN
    SELECT min(r.id), count(*) INTO r_id, n FROM hevy_routines r
     WHERE r.user_id = NEW.user_id
       AND lower(btrim(r.title)) = lower(btrim(NEW.title));
    IF n <> 1 THEN r_id := NULL; END IF;
  END IF;
  NEW.hevy_routine_id := r_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_link_training ON public.tasks;
CREATE TRIGGER trg_tasks_link_training
  BEFORE INSERT OR UPDATE OF title, domain, source_type, source_id, hevy_routine_id, status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_link_training();

-- ── 2. A synced workout completes its planned session ───────────────────────
-- The plans a workout on day d could be: a training task not linked to a
-- workout yet, still open — or ticked done by hand on day d itself — whose
-- planned day (its linked block's date, else its deadline) is d or up to 6
-- days before it.
CREATE OR REPLACE FUNCTION public.training_plan_candidates(p_user uuid, p_day date)
RETURNS TABLE (id uuid, routine text, status text, plan_day date, created_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.routine, c.status, c.plan_day, c.created_at
    FROM (
      SELECT t.id, t.hevy_routine_id AS routine, t.status, t.created_at,
             COALESCE((SELECT min(b.date) FROM time_blocks b WHERE b.task_id = t.id), t.due_date) AS plan_day
        FROM tasks t
       WHERE t.user_id = p_user
         AND t.hevy_workout_id IS NULL
         AND (t.hevy_routine_id IS NOT NULL OR t.source_type = 'training_session')
         AND t.status IN ('open', 'in_progress', 'done')
    ) c
   WHERE c.plan_day BETWEEN p_day - 6 AND p_day
     AND (c.status <> 'done' OR c.plan_day = p_day)
$$;

REVOKE ALL ON FUNCTION public.training_plan_candidates(uuid, date) FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER so the rule never depends on who wrote the workout (it
-- only ever reads and writes NEW.user_id's own tasks).
CREATE OR REPLACE FUNCTION public.hevy_workout_completes_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w_day date;
  t_id  uuid;
  n     int;
BEGIN
  IF NEW.start_time IS NULL THEN RETURN NEW; END IF;
  -- Already linked (a re-sync of the same workout): nothing to do.
  IF EXISTS (SELECT 1 FROM tasks WHERE hevy_workout_id = NEW.id) THEN RETURN NEW; END IF;
  w_day := (NEW.start_time AT TIME ZONE 'Europe/Oslo')::date;

  -- 1. This routine's plan on the workout's day (an open one before one
  --    already ticked by hand).
  IF NEW.routine_id IS NOT NULL THEN
    SELECT c.id INTO t_id FROM training_plan_candidates(NEW.user_id, w_day) c
     WHERE c.routine = NEW.routine_id AND c.plan_day = w_day
     ORDER BY (c.status <> 'done') DESC, c.created_at
     LIMIT 1;
  END IF;

  -- 2. This routine's plan on that day that step 4 gave to another workout
  --    (a freeform run synced first): this workout is its own — take it over.
  IF t_id IS NULL AND NEW.routine_id IS NOT NULL THEN
    SELECT t.id INTO t_id
      FROM tasks t JOIN hevy_workouts w ON w.id = t.hevy_workout_id
     WHERE t.user_id = NEW.user_id
       AND t.hevy_routine_id = NEW.routine_id
       AND w.routine_id IS DISTINCT FROM NEW.routine_id
       AND COALESCE((SELECT min(b.date) FROM time_blocks b WHERE b.task_id = t.id), t.due_date) = w_day
     ORDER BY t.created_at
     LIMIT 1;
    IF t_id IS NOT NULL THEN
      UPDATE tasks
         SET hevy_workout_id = NEW.id,
             completed_at    = COALESCE(NEW.end_time, NEW.start_time)
       WHERE id = t_id;
      RETURN NEW;
    END IF;
  END IF;

  -- 3. This routine's latest overdue plan (done a few days late).
  IF t_id IS NULL AND NEW.routine_id IS NOT NULL THEN
    SELECT c.id INTO t_id FROM training_plan_candidates(NEW.user_id, w_day) c
     WHERE c.routine = NEW.routine_id AND c.plan_day < w_day
     ORDER BY c.plan_day DESC, c.created_at
     LIMIT 1;
  END IF;

  -- 4. Otherwise the one training plan on that day, if there is exactly one.
  IF t_id IS NULL THEN
    SELECT min(c.id::text)::uuid, count(*) INTO t_id, n
      FROM training_plan_candidates(NEW.user_id, w_day) c WHERE c.plan_day = w_day;
    IF n <> 1 THEN t_id := NULL; END IF;
  END IF;

  IF t_id IS NOT NULL THEN
    UPDATE tasks
       SET hevy_workout_id = NEW.id,
           completed_at    = CASE WHEN status = 'done' THEN completed_at
                                  ELSE COALESCE(NEW.end_time, NEW.start_time) END,
           status          = 'done'
     WHERE id = t_id AND hevy_workout_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hevy_workout_completes_plan ON public.hevy_workouts;
CREATE TRIGGER trg_hevy_workout_completes_plan
  AFTER INSERT OR UPDATE OF routine_id, start_time ON public.hevy_workouts
  FOR EACH ROW EXECUTE FUNCTION public.hevy_workout_completes_plan();

-- ── 3. Backfill ─────────────────────────────────────────────────────────────
-- Routines first (the trigger above runs for these rows too).
UPDATE public.tasks t
   SET hevy_routine_id = r.id
  FROM public.hevy_routines r
 WHERE t.hevy_routine_id IS NULL
   AND t.source_type = 'training_session'
   AND t.source_id IS NOT NULL
   AND lower(r.id) = t.source_id::text
   AND r.user_id = t.user_id;

-- Personal tasks titled exactly like one routine (trigger rule 1).
UPDATE public.tasks t
   SET hevy_routine_id = (SELECT min(r.id) FROM public.hevy_routines r
                           WHERE r.user_id = t.user_id
                             AND lower(btrim(r.title)) = lower(btrim(t.title)))
 WHERE t.hevy_routine_id IS NULL
   AND t.source_type IN ('manual', 'ai')
   AND t.domain = 'personal'
   AND (SELECT count(*) FROM public.hevy_routines r
         WHERE r.user_id = t.user_id
           AND lower(btrim(r.title)) = lower(btrim(t.title))) = 1;

-- Then every workout, oldest first, through the same rule.
DO $$
DECLARE w record;
BEGIN
  FOR w IN SELECT id FROM public.hevy_workouts WHERE start_time IS NOT NULL ORDER BY start_time, id LOOP
    UPDATE public.hevy_workouts SET routine_id = routine_id WHERE id = w.id;
  END LOOP;
END $$;
