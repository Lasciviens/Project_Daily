-- tasks.completed_at becomes the ONE clock for "when was this task closed".
--
-- Root cause (Home said "All done for today · 1 task finished" on a day with
-- no task): every "done today" count read `updated_at`, which moves on ANY
-- write to a finished task — a Google Tasks pull or snapshot (every 20 min),
-- a drag reorder (swapTaskOrder stamps both rows), the title-mirror trigger.
-- An old finished task therefore came back as "finished in the last 24 h".
-- completed_at existed since 071 but only Google's pull ever wrote it.
--
-- From now on a trigger stamps it whenever a task moves INTO done or
-- cancelled (unless the same write sets it — Google's own completion time
-- wins), and clears it when a task is reopened. Every writer is covered:
-- web, ai-proxy, phone-gateway, kobo-sync captures, Google pulls.
--
-- Backfill: closed rows without a stamp take the time the audit log saw the
-- status change (the trigger has logged every tasks write since 037). With
-- no record in the log (cleared, or older than its 30-day retention) the
-- task was closed before that, so updated_at is used — but never a value in
-- the last 24 hours, which is exactly the stamp the bug produced.

CREATE OR REPLACE FUNCTION public.stamp_task_closed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('done', 'cancelled') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      -- Closed (or moved done ↔ cancelled) by this write: stamp it, unless
      -- the writer sent its own time (a Google pull carries Google's).
      IF NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at OR NEW.completed_at IS NULL THEN
        NEW.completed_at := now();
      END IF;
    ELSIF NEW.completed_at IS NULL THEN
      -- Still closed; a write that blanked the stamp keeps the old one.
      NEW.completed_at := COALESCE(OLD.completed_at, now());
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_closed_at ON public.tasks;
CREATE TRIGGER trg_tasks_closed_at
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.stamp_task_closed_at();

COMMENT ON COLUMN public.tasks.completed_at IS
  'When the task was closed (status done or cancelled); NULL while open. Stamped by trg_tasks_closed_at for every writer; a Google pull may set Google''s own completion time. Use this — never updated_at — for "finished today".';

-- One-time backfill (closed rows that never got a stamp).
UPDATE public.tasks t
SET completed_at = COALESCE(
  (SELECT max(a.created_at)
     FROM public.audit_logs a
    WHERE a.table_name = 'tasks'
      AND a.row_id = t.id::text
      AND a.operation IN ('INSERT', 'UPDATE')
      AND a.new_data ->> 'status' IN ('done', 'cancelled')),
  LEAST(t.updated_at, now() - interval '1 day')
)
WHERE t.status IN ('done', 'cancelled')
  AND t.completed_at IS NULL;
