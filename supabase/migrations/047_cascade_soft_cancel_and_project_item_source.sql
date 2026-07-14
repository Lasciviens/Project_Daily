-- ═══════════════════════════════════════════════════════════════════════════
-- Close the movie/project-item cascade gap — but with SOFT-CANCEL, not delete
-- (owner decision). When a plan's schedule block is deleted, its auto-created
-- task is no longer left orphaned (the gap) AND is no longer hard-deleted (the
-- silent-data-loss risk) — it becomes a reversible, visible 'cancelled' row.
--
-- Three coordinated changes:
--   A. Widen tasks.source_type to allow 'project_item' (mirrors migration 039).
--   B. Convert the block-delete → task cascade from DELETE to soft-cancel, for
--      ALL auto-created task types (training_session included — brought onto the
--      same safe behavior).
--   C. Add 'movie' and 'project_item' to the cascade allowlist so their planned
--      blocks trigger the (now soft) cascade too.
--
-- Sequencing note: the front-end change that tags project-item tasks with
-- source_type='project_item' (todo/types.ts + ItemRow.tsx) MUST NOT deploy
-- until THIS migration is applied live, or that task INSERT would violate the
-- CHECK below. Apply this first.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Widen tasks.source_type enum ────────────────────────────────────────
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_type_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_type_check
  CHECK (source_type IN ('manual', 'movie', 'tv_series', 'media', 'calendar', 'ai', 'training_session', 'project_item'));

-- ── B. Soft-cancel instead of hard-delete in the block→task cascade ─────────
-- Full function re-declared from migration 043 with ONLY the DELETE→UPDATE
-- change in the cascade branch; the date-sync UPDATE branch is unchanged.
CREATE OR REPLACE FUNCTION public.sync_task_from_time_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task        tasks%ROWTYPE;
  v_auto_types  jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_type = 'task' AND OLD.source_id IS NOT NULL
       AND public.link_rule_enabled('block_delete_cascades_task') THEN
      SELECT * INTO v_task FROM public.tasks WHERE id = OLD.source_id;
      IF FOUND THEN
        v_auto_types := public.link_rule_config('block_delete_cascades_task') -> 'auto_task_source_types';
        IF v_auto_types ? v_task.source_type THEN
          -- SOFT-CANCEL, not delete: a plan-created task that loses its schedule
          -- block becomes a reversible, visible 'cancelled' row instead of being
          -- silently destroyed. This is the agreed mitigation for the
          -- irreversible-data-loss failure mode. Guarded on status <> 'cancelled'
          -- so it's a no-op (and no spurious audit row) if already cancelled.
          UPDATE public.tasks
             SET status = 'cancelled', updated_at = now()
           WHERE id = v_task.id AND status <> 'cancelled';
        END IF;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: propagate a date/time change to the linked task, once.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() = 1
     AND NEW.source_type = 'task' AND NEW.source_id IS NOT NULL
     AND public.link_rule_enabled('block_task_date_sync')
     AND (NEW.date IS DISTINCT FROM OLD.date OR NEW.start_time IS DISTINCT FROM OLD.start_time) THEN
    UPDATE public.tasks
       SET due_date = NEW.date,
           due_time = NEW.start_time,
           updated_at = now()
     WHERE id = NEW.source_id
       AND (due_date IS DISTINCT FROM NEW.date OR due_time IS DISTINCT FROM NEW.start_time);
  END IF;

  RETURN NEW;
END;
$$;

-- ── C. Extend the cascade allowlist (movie + project_item) ──────────────────
UPDATE public.link_rules
   SET config = jsonb_set(
         config,
         '{auto_task_source_types}',
         '["training_session", "movie", "project_item"]'::jsonb
       ),
       description = 'Deleting a time_block whose linked task exists ONLY because a plan created it (task.source_type in auto_task_source_types) SOFT-CANCELS that task (status=cancelled), rather than deleting it — reversible, no silent data loss. A task the user created independently and merely scheduled is never touched.',
       updated_at = now()
 WHERE rule_name = 'block_delete_cascades_task';
