-- ═══════════════════════════════════════════════════════════════════════════
-- Tasks/Schedule model fix — root cause of three real problems audited
-- before this migration:
--
--   1. time_blocks.source_type/source_id did TWO jobs at once: "is this
--      linked to a Task" (source_type='task') AND "what real-world entity
--      was this originally planned from" (movie/training_session/
--      project_item/tv_episode). Whenever a plan created BOTH a task AND a
--      block together (UnifiedPlanModal's old saveSchedule()), the block's
--      link was overwritten to {source_type:'task', source_id:<task id>} —
--      the real origin was silently discarded. Confirmed live: every
--      task+schedule combo created this way lost its real source.
--   2. No FK existed for the "linked to a Task" relationship, so a task
--      hard-delete could leave its block orphaned — confirmed live: 4
--      time_blocks rows with source_type='task' whose task no longer
--      exists, at the time of this audit.
--   3. tasks.due_date/due_time and time_blocks.date/start_time were kept
--      bidirectionally equal by DB triggers (migration 043/047) — treating
--      "the deadline" and "when I'll actually do it" as the same fact, which
--      they are not ("due Friday 5pm" vs "working on it Thursday 1-2:30pm").
--
-- Fix: time_blocks.task_id is now the ONLY representation of "linked to a
-- Task" (a real FK, ON DELETE CASCADE). source_type/source_id now ONLY ever
-- describe the originating entity (movie/training_session/project_item/
-- tv_episode/calendar/manual) — 'task' is removed from the allowed values
-- entirely. Deadline and schedule become fully independent (the sync
-- triggers are retired, not just disabled).
--
-- This migration is NOT destructive: every row that was source_type='task'
-- is DETACHED (task_id/source_type/source_id all set NULL) rather than
-- deleted whenever it can't become the one canonical linked block for its
-- task (an orphan whose task is gone, or a duplicate legacy row once a
-- canonical block for that task has already been picked — see section B).
-- No row count changes; a post-backfill assertion proves it rather than
-- merely claiming it in a comment.
-- ═══════════════════════════════════════════════════════════════════════════

-- Row-count snapshot, compared against the same count at the end of this
-- migration (section G) — this migration never deletes a time_blocks row;
-- the final assertion is what actually PROVES that, not just asserts it.
CREATE TEMP TABLE _migration_077_row_count AS
  SELECT count(*) AS n FROM public.time_blocks;

-- ── A. time_blocks.task_id — the real FK (index created in section B.3,
-- AFTER the backfill/dedup below has resolved every duplicate — creating a
-- unique index BEFORE that could fail outright on an environment with more
-- than one legacy source_type='task' row per task). ────────────────────────
ALTER TABLE public.time_blocks
  ADD COLUMN task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.time_blocks.task_id IS
  'The ONLY representation of "this schedule slot belongs to a Task" — never source_type=''task'' (removed from the CHECK below). A Task may have at most one linked one-off time_block (see the partial unique index). ON DELETE CASCADE: hard-deleting a Task removes its linked block; the reverse is NOT true — deleting/unscheduling a block never touches the Task (see the retired triggers below).';

-- ── B. Backfill — recover the real source, detach orphans AND duplicates,
-- never delete a row ─────────────────────────────────────────────────────
-- For every block currently marked source_type='task', processed OLDEST
-- FIRST (deterministic — created_at then id) so which row "wins" a
-- duplicate task is stable and reproducible:
--   B.1 orphan (linked task no longer exists) -> detach, keep the row.
--   B.2 duplicate (this task ALREADY got its one canonical block from an
--       earlier iteration — the pre-077 model had no unique constraint
--       stopping more than one time_blocks row from pointing at the same
--       task) -> detach exactly like an orphan, keep the row. Verified
--       against the live audit: 0 such duplicates existed at the time this
--       migration was authored, but the logic must hold generically for any
--       environment/timing this runs against.
--   B.3 otherwise (the canonical block for this task) -> set task_id and
--       recover the real origin FROM THE TASK'S OWN source_type (never
--       touched by the original bug — only the BLOCK's source_type/id
--       were overwritten), mapped onto time_blocks' distinct source_type
--       vocabulary. tv_series is the ONE value that does NOT map directly:
--       it becomes 'tv_episode' ONLY when this specific block already
--       carries real season_number AND episode_number — inventing
--       episode-specificity for a block that has neither would be the
--       exact overclaim the client (blockSourceTypeForTask) and ai-proxy
--       (planMedia) both deliberately avoid making generically. Without
--       both numbers, task_id is still set (the real FK link), but
--       source_type/source_id are left NULL — "linked to this Task" is
--       preserved, "which episode" is not invented.
DO $$
DECLARE
  row_rec RECORD;
  v_task  RECORD;
  v_seen  UUID[] := ARRAY[]::UUID[];
BEGIN
  FOR row_rec IN
    SELECT id, source_id, season_number, episode_number
      FROM public.time_blocks
     WHERE source_type = 'task'
     ORDER BY created_at ASC, id ASC
  LOOP
    SELECT id, source_type, source_id INTO v_task
      FROM public.tasks WHERE id = row_rec.source_id;

    IF v_task.id IS NULL THEN
      -- B.1: orphan.
      UPDATE public.time_blocks
         SET task_id = NULL, source_type = NULL, source_id = NULL
       WHERE id = row_rec.id;
      CONTINUE;
    END IF;

    IF v_task.id = ANY(v_seen) THEN
      -- B.2: duplicate — this task already has its canonical block.
      UPDATE public.time_blocks
         SET task_id = NULL, source_type = NULL, source_id = NULL
       WHERE id = row_rec.id;
      CONTINUE;
    END IF;

    v_seen := array_append(v_seen, v_task.id);

    -- B.3: canonical block for this task.
    UPDATE public.time_blocks SET
      task_id = v_task.id,
      source_type = CASE v_task.source_type
        WHEN 'training_session' THEN 'training_session'
        WHEN 'movie'            THEN 'movie'
        WHEN 'project_item'     THEN 'project_item'
        WHEN 'tv_series' THEN
          CASE WHEN row_rec.season_number IS NOT NULL AND row_rec.episode_number IS NOT NULL
               THEN 'tv_episode' ELSE NULL END
        ELSE NULL
      END,
      source_id = CASE
        WHEN v_task.source_type IN ('training_session', 'movie', 'project_item')
          THEN v_task.source_id
        WHEN v_task.source_type = 'tv_series'
             AND row_rec.season_number IS NOT NULL AND row_rec.episode_number IS NOT NULL
          THEN v_task.source_id
        ELSE NULL
      END
    WHERE id = row_rec.id;
  END LOOP;
END $$;

-- Assert the backfill actually produced a state the unique index below can
-- be created against, and that nothing was left half-migrated.
DO $$
DECLARE
  v_task_leftover  INT;
  v_orphan_task_id INT;
  v_duplicate_link INT;
BEGIN
  SELECT count(*) INTO v_task_leftover FROM public.time_blocks WHERE source_type = 'task';
  IF v_task_leftover <> 0 THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: % time_blocks rows still have source_type=''task'' after backfill', v_task_leftover;
  END IF;

  SELECT count(*) INTO v_orphan_task_id
    FROM public.time_blocks tb LEFT JOIN public.tasks t ON t.id = tb.task_id
   WHERE tb.task_id IS NOT NULL AND t.id IS NULL;
  IF v_orphan_task_id <> 0 THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: % time_blocks.task_id values point at a non-existent task', v_orphan_task_id;
  END IF;

  SELECT count(*) INTO v_duplicate_link FROM (
    SELECT task_id FROM public.time_blocks WHERE task_id IS NOT NULL GROUP BY task_id HAVING count(*) > 1
  ) d;
  IF v_duplicate_link <> 0 THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: % tasks have more than one linked time_blocks row', v_duplicate_link;
  END IF;
END $$;

-- At most one linked block per task — safe now that B has resolved every
-- duplicate down to zero (asserted above).
CREATE UNIQUE INDEX time_blocks_one_per_task
  ON public.time_blocks (task_id) WHERE task_id IS NOT NULL;

CREATE INDEX time_blocks_task_id_idx ON public.time_blocks (task_id) WHERE task_id IS NOT NULL;

-- ── C. Remove 'task' from the CHECK — it's structurally impossible now ─────
ALTER TABLE public.time_blocks DROP CONSTRAINT IF EXISTS time_blocks_source_type_check;
ALTER TABLE public.time_blocks ADD CONSTRAINT time_blocks_source_type_check
  CHECK (source_type IN ('training_session', 'movie', 'tv_episode', 'project_item', 'calendar', 'manual'));

-- ── D. Retire the deadline<->schedule sync triggers entirely ────────────────
-- Both behaviors this pair implemented are being retired on purpose, not
-- just disabled: (1) a block's date/time no longer overwrites its task's
-- due_date/due_time and vice versa — "when I'll do it" and "when it's due"
-- are independent facts; (2) deleting/unscheduling a block no longer
-- soft-cancels its task — "Unschedule" now only removes the time slot, the
-- Task survives untouched. The FK added in section A already gives the ONE
-- cascade direction that should exist (Task hard-delete -> block gone).
DROP TRIGGER IF EXISTS trg_sync_task_from_time_block ON public.time_blocks;
DROP TRIGGER IF EXISTS trg_sync_time_block_from_task ON public.tasks;
DROP FUNCTION IF EXISTS public.sync_task_from_time_block();
DROP FUNCTION IF EXISTS public.sync_time_block_from_task();

-- Kept (not deleted) for audit/history visibility in the Developer page,
-- but disabled and re-described so no one re-enables a rule whose
-- implementing trigger no longer exists.
UPDATE public.link_rules
   SET enabled = false,
       description = 'RETIRED (migration 077) — the implementing trigger was dropped. Deadline (tasks.due_date/due_time) and schedule (time_blocks.date/start_time) are now independent by design; a block delete never cancels its task (see time_blocks.task_id ON DELETE CASCADE for the one direction that still applies: Task delete -> block gone).',
       updated_at = now()
 WHERE rule_name IN ('block_delete_cascades_task', 'block_task_date_sync');

-- ── E. NEW one-way sync: Task title is canonical, mirrored onto its linked
-- block. Runs as a DB trigger (not app code) so it fires no matter which
-- door wrote the task's title — the browser UI, the AI's generic db_update
-- tool, or Google Tasks pull (upsert_task_from_google / apply_google_task_snapshot,
-- migrations 071/075) — all of them are, at bottom, a plain SQL UPDATE on
-- this table. The reverse never happens: editing a linked block's title
-- does not touch its task's title (the Task editor is where a task's title
-- is owned; the Schedule section only shows it read-only).
CREATE OR REPLACE FUNCTION public.sync_time_block_title_from_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND NEW.title IS DISTINCT FROM OLD.title THEN
    UPDATE public.time_blocks
       SET title = NEW.title, updated_at = now()
     WHERE task_id = NEW.id AND title IS DISTINCT FROM NEW.title;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_time_block_title_from_task
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_time_block_title_from_task();

-- ── F. Complete the recurring schedule_blocks model ─────────────────────────
-- Was missing category (every recurring block rendered/filtered as if
-- untyped) and updated_at (no way to know when a recurring template was
-- last touched, and no updateScheduleBlock could exist without it — see the
-- paired code change). source_type/source_id deliberately NOT added: audited
-- every current recurring-creation call site (DayAgenda's "+Add" with
-- recurrence, the only path that reaches schedule_blocks) and none passes a
-- PlanSource — recurring blocks have never carried origin-entity context in
-- this app, so adding the columns now would be speculative schema with no
-- writer.
ALTER TABLE public.schedule_blocks
  ADD COLUMN category   TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.schedule_blocks ADD CONSTRAINT schedule_blocks_category_check
  CHECK (category IN ('daily', 'training', 'media', 'games', 'work', 'projects', 'other'));

CREATE TRIGGER trg_schedule_blocks_updated_at
  BEFORE UPDATE ON public.schedule_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── G. Final assertions — the full contract this migration must leave true.
-- Fails loudly (RAISE EXCEPTION rolls back the whole migration) rather than
-- silently leaving a half-correct schema behind.
DO $$
DECLARE
  v_before INT;
  v_after  INT;
BEGIN
  SELECT n INTO v_before FROM _migration_077_row_count;
  SELECT count(*) INTO v_after FROM public.time_blocks;
  IF v_before <> v_after THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: time_blocks row count changed (% -> %) — this migration must never delete a row', v_before, v_after;
  END IF;

  IF EXISTS (SELECT 1 FROM public.time_blocks WHERE source_type = 'task') THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: a source_type=''task'' row still exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.time_blocks tb LEFT JOIN public.tasks t ON t.id = tb.task_id
     WHERE tb.task_id IS NOT NULL AND t.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: an orphaned task_id still exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (SELECT task_id FROM public.time_blocks WHERE task_id IS NOT NULL GROUP BY task_id HAVING count(*) > 1) d
  ) THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: a task still has more than one linked time_blocks row';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'time_blocks_one_per_task') THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: time_blocks_one_per_task unique index is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_task_from_time_block') THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: trg_sync_task_from_time_block still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_time_block_from_task') THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: trg_sync_time_block_from_task still exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_time_block_title_from_task') THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: trg_sync_time_block_title_from_task is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schedule_blocks' AND column_name = 'category'
  ) THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: schedule_blocks.category is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schedule_blocks' AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'Migration 077 assertion failed: schedule_blocks.updated_at is missing';
  END IF;

  RAISE NOTICE 'Migration 077: all assertions passed (row count preserved at %, 0 source_type=task rows, 0 orphan task_id, 0 duplicate links, unique index + triggers + schedule_blocks columns all in place).', v_after;
END $$;

DROP TABLE _migration_077_row_count;
