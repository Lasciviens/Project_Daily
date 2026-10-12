-- One planned training session = one thing, in the database (owner,
-- 12.10.2026: "the same modal does one thing on one page and another thing on
-- another page … Task and training session must work fully integrated").
--
-- A planned session is a task (tasks: status, due date, the routine — 141)
-- and usually its slot on the calendar (time_blocks.task_id — 077). Since
-- 077 a task's deadline and its time slot are independent facts, which is
-- right for an ordinary task and wrong for a training session: there the
-- task's day IS the session's day. And "I won't do it" existed twice with no
-- link between them: Cancel on the task (no reason, the block stayed
-- "planned") and Skip on Training → Missed sessions (a reason required, but
-- neither the task nor the block knew).
--
-- Now, for a TRAINING task (hevy_routine_id set, or source_type
-- 'training_session' — the 141 definition):
--
--   1. Day and time are one fact. Moving the block moves the task's due
--      date/time (trg_training_block_moves_task) and moving the task moves
--      its block (trg_training_task_moves_block), whoever writes it (the app,
--      the assistant, a Google Tasks pull). Each side only writes when the
--      other differs, so the pair settles after one hop. Other tasks keep
--      077's independent deadline and slot.
--
--   2. Skipping is cancelling, with a reason. training_skips gains task_id
--      and plan_date: a skip recorded for a planned session cancels its task
--      (trg_training_skip_sets_task), and removing the skip (Undo) reopens
--      it. The other way round, a training task cancelled by any writer gets
--      a skip row (reason "Cancelled — no reason given" when none was asked
--      for; the app always asks), and reopening it removes the row
--      (trg_training_task_cancel_skip). So a cancelled training task always
--      has its skip, and the Missed-sessions rule (routine + week) sees it.
--      The skip stays keyed by the week of the PLANNED day; it keeps 112's
--      one-skip-per-routine-per-week rule (a second skip of the same routine
--      that week attaches nothing new).
--
--   3. One day of a weekly plan can become a plan of its own. time_blocks
--      gains schedule_block_id + occurrence_date: acting on one occurrence of
--      a recurring training template (done, move, skip) first turns that
--      occurrence into a one-off block with its task, marked with the
--      template and the day it replaces. The template records that day in
--      its new except_dates (trg_occurrence_replaces_day), and every
--      projection of the template leaves those days out — so the original
--      day stays clear even after the new block is moved to another date.
--      Deleting the new block keeps the day out (that session was removed);
--      a template deleted later leaves the blocks as ordinary one-off plans
--      (ON DELETE SET NULL).
--
--   4. A planned session with no routine id (planned from a day of a weekly
--      plan, or "Plan training" without picking one) links to the ONE routine
--      titled exactly like it, as a typed task already did (141's rule now
--      covers source_type 'training_session' without a source_id too).
--
-- Updates no existing row.

-- ── 1. Day and time move together ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.training_block_moves_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.task_id IS NULL THEN RETURN NULL; END IF;
  UPDATE tasks t
     SET due_date = NEW.date,
         due_time = COALESCE(NEW.start_time, t.due_time)
   WHERE t.id = NEW.task_id
     AND (t.hevy_routine_id IS NOT NULL OR t.source_type = 'training_session')
     AND (t.due_date IS DISTINCT FROM NEW.date
          OR (NEW.start_time IS NOT NULL AND t.due_time IS DISTINCT FROM NEW.start_time));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_block_moves_task ON public.time_blocks;
CREATE TRIGGER trg_training_block_moves_task
  AFTER INSERT OR UPDATE OF date, start_time, task_id ON public.time_blocks
  FOR EACH ROW EXECUTE FUNCTION public.training_block_moves_task();

CREATE OR REPLACE FUNCTION public.training_task_moves_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A deadline cleared is not a move: the block keeps its day.
  IF NEW.due_date IS NULL THEN RETURN NULL; END IF;
  IF NOT (NEW.hevy_routine_id IS NOT NULL OR NEW.source_type = 'training_session') THEN RETURN NULL; END IF;
  UPDATE time_blocks b
     SET date       = NEW.due_date,
         start_time = COALESCE(NEW.due_time, b.start_time)
   WHERE b.task_id = NEW.id
     AND (b.date IS DISTINCT FROM NEW.due_date
          OR (NEW.due_time IS NOT NULL AND b.start_time IS DISTINCT FROM NEW.due_time));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_task_moves_block ON public.tasks;
CREATE TRIGGER trg_training_task_moves_block
  AFTER UPDATE OF due_date, due_time ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.training_task_moves_block();

-- ── 2. A skip is the session's cancellation, with its reason ───────────────
ALTER TABLE public.training_skips
  ADD COLUMN IF NOT EXISTS task_id   uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS plan_date date;
-- A freeform plan ("Training", no routine) can be skipped too.
ALTER TABLE public.training_skips ALTER COLUMN routine_id DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.training_skips
    ADD CONSTRAINT training_skips_routine_or_task CHECK (routine_id IS NOT NULL OR task_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS training_skips_task_key
  ON public.training_skips (task_id) WHERE task_id IS NOT NULL;

COMMENT ON COLUMN public.training_skips.task_id IS
  'The planned session (training task) this skip cancelled; NULL for a skip of a missed routine with no plan (Training → Missed sessions). Deleting the row reopens the task.';
COMMENT ON COLUMN public.training_skips.plan_date IS
  'The day the skipped session was planned for (week_start is its Monday).';

-- Recording a skip cancels the plan's task; removing it (Undo) reopens it.
CREATE OR REPLACE FUNCTION public.training_skip_sets_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.task_id IS NOT NULL THEN
    UPDATE tasks SET status = 'cancelled'
     WHERE id = NEW.task_id AND status IN ('open', 'in_progress', 'waiting');
  ELSIF TG_OP = 'DELETE' AND OLD.task_id IS NOT NULL THEN
    UPDATE tasks SET status = 'open'
     WHERE id = OLD.task_id AND status = 'cancelled';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_skip_sets_task ON public.training_skips;
CREATE TRIGGER trg_training_skip_sets_task
  AFTER INSERT OR UPDATE OF task_id OR DELETE ON public.training_skips
  FOR EACH ROW EXECUTE FUNCTION public.training_skip_sets_task();

-- A training task cancelled by any writer gets its skip row; reopened, it
-- loses it.
CREATE OR REPLACE FUNCTION public.training_task_cancel_skip()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  plan_day date;
BEGIN
  IF NOT (NEW.hevy_routine_id IS NOT NULL OR NEW.source_type = 'training_session') THEN RETURN NULL; END IF;
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF EXISTS (SELECT 1 FROM training_skips WHERE task_id = NEW.id) THEN RETURN NULL; END IF;
    plan_day := COALESCE((SELECT min(b.date) FROM time_blocks b WHERE b.task_id = NEW.id), NEW.due_date,
                         (now() AT TIME ZONE 'Europe/Oslo')::date);
    -- One skip per routine per week (112): a week already skipped for this
    -- routine keeps its row; the cancelled task then reads that reason.
    INSERT INTO training_skips (user_id, routine_id, week_start, reason, task_id, plan_date)
    VALUES (NEW.user_id, NEW.hevy_routine_id, date_trunc('week', plan_day)::date,
            'Cancelled — no reason given', NEW.id, plan_day)
    ON CONFLICT DO NOTHING;
  ELSIF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    DELETE FROM training_skips WHERE task_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_task_cancel_skip ON public.tasks;
CREATE TRIGGER trg_training_task_cancel_skip
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.training_task_cancel_skip();

-- ── 3. One occurrence of a weekly plan as a plan of its own ────────────────
ALTER TABLE public.time_blocks
  ADD COLUMN IF NOT EXISTS schedule_block_id uuid REFERENCES public.schedule_blocks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS occurrence_date   date;
CREATE UNIQUE INDEX IF NOT EXISTS time_blocks_occurrence_key
  ON public.time_blocks (schedule_block_id, occurrence_date)
  WHERE schedule_block_id IS NOT NULL AND occurrence_date IS NOT NULL;

COMMENT ON COLUMN public.time_blocks.schedule_block_id IS
  'The weekly plan (schedule_blocks) this one-off block replaces on occurrence_date; projections of that template skip the day.';
COMMENT ON COLUMN public.time_blocks.occurrence_date IS
  'The day of the weekly plan this block replaces (it may have been moved to another date since).';

ALTER TABLE public.schedule_blocks
  ADD COLUMN IF NOT EXISTS except_dates date[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.schedule_blocks.except_dates IS
  'Days this weekly plan is not projected on: each became a one-off block of its own (time_blocks.schedule_block_id + occurrence_date).';

CREATE OR REPLACE FUNCTION public.occurrence_replaces_day()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.schedule_block_id IS NULL OR NEW.occurrence_date IS NULL THEN RETURN NULL; END IF;
  UPDATE schedule_blocks
     SET except_dates = array_append(except_dates, NEW.occurrence_date)
   WHERE id = NEW.schedule_block_id
     AND NOT (NEW.occurrence_date = ANY (except_dates));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_occurrence_replaces_day ON public.time_blocks;
CREATE TRIGGER trg_occurrence_replaces_day
  AFTER INSERT OR UPDATE OF schedule_block_id, occurrence_date ON public.time_blocks
  FOR EACH ROW EXECUTE FUNCTION public.occurrence_replaces_day();

-- ── 4. A session without a routine id links by its title (141, widened) ────
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
  ELSIF (NEW.source_type IN ('manual', 'ai') AND NEW.domain = 'personal')
     OR (NEW.source_type = 'training_session' AND NEW.source_id IS NULL) THEN
    SELECT min(r.id), count(*) INTO r_id, n FROM hevy_routines r
     WHERE r.user_id = NEW.user_id
       AND lower(btrim(r.title)) = lower(btrim(NEW.title));
    IF n <> 1 THEN r_id := NULL; END IF;
  END IF;
  NEW.hevy_routine_id := r_id;
  RETURN NEW;
END;
$$;
