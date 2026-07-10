-- ═══════════════════════════════════════════════════════════════════════════
-- Linked-entity sync — the general "if A was created from B, keep them in
-- sync no matter which side changes, no matter which door the change came
-- through (web UI, Ask AI's generic DB layer, an edge function, a webhook)"
-- pattern. Real bugs this fixes, all confirmed before writing this migration:
--   1. Deleting a Training-plan time_block left its auto-created task behind.
--   2. Dragging a planned time_block to a new day/time never updated the
--      linked task's due_date/due_time (or vice versa) — same plan, two
--      disagreeing dates.
--   3. Marking a TV episode watched never cleaned up its "planned to watch"
--      time_block — it just sat there forever looking un-done.
--   4. Deleting a Project item left its scheduled time_block behind too
--      (same class of bug as #1, different table).
--
-- Design notes (see the accompanying chat discussion for the full reasoning):
--   - App-code-only fixes were rejected: this app writes to Postgres from
--     THREE different doors (web UI, ai-proxy's generic db_insert/update/
--     delete tool layer, and sync webhooks/edge functions) — a JS-layer fix
--     only helps the door it's written for. Triggers run inside Postgres
--     itself, so they fire no matter which door the write came through.
--     `audit_logs` (migration 037) already uses this same principle.
--   - `link_rules` is a small config table, NOT a fully generic rule
--     interpreter — the actual matching logic per relationship shape (task↔
--     block by id, episode→block by season/episode number, project_item→
--     block by id) is still explicit SQL in typed trigger functions, because
--     Postgres has no safe generic "polymorphic join" without dynamic SQL,
--     and dynamic SQL is a correctness/security risk not worth taking for a
--     single-user app. What IS made configurable without a new migration:
--     turning a rule on/off, and which task `source_type`s count as
--     "auto-created by a plan" (see the seeded row below) — the two things
--     that plausibly need to change as new features are added.
--   - Recursion: time_blocks→tasks and tasks→time_blocks triggers can each
--     cause the other to fire. Guarded with `pg_trigger_depth() > 1` — a
--     direct user edit propagates to the other side exactly once; that
--     propagation does not bounce back.
--   - Google Calendar/Google Tasks sync is deliberately NOT done in these
--     triggers — a trigger runs inside Postgres and has no access to the
--     end user's OAuth token (that lives in the browser). That side stays
--     best-effort at the API layer (src/features/daily/api/scheduleApi.ts,
--     src/features/todo/api/tasksApi.ts), same as before this migration.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. link_rules — declarative on/off + small per-rule config
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.link_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name   text NOT NULL UNIQUE,
  description text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- No RLS/user_id here on purpose — this is app-wide configuration, not
-- per-user data (mirrors how e.g. shop taxonomy seeds are global-ish, except
-- this table isn't user-owned at all). Only readable so the Developer page
-- can show current rule state; writes happen via migration only for now.
ALTER TABLE public.link_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'link_rules' AND policyname = 'Authenticated read link_rules'
  ) THEN
    CREATE POLICY "Authenticated read link_rules" ON public.link_rules
      FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
END $$;
GRANT SELECT ON public.link_rules TO authenticated;

INSERT INTO public.link_rules (rule_name, description, config) VALUES
  ('block_delete_cascades_task',
   'Deleting a time_block whose linked task exists ONLY because a plan created it (task.source_type in auto_task_source_types) also deletes that task. A task the user created independently and merely scheduled is never touched by this rule.',
   '{"auto_task_source_types": ["training_session"]}'::jsonb),
  ('block_task_date_sync',
   'A time_block''s date/start_time and its linked task''s due_date/due_time are kept equal in both directions (whichever side changes propagates once to the other).',
   '{}'::jsonb),
  ('episode_watched_cleans_block',
   'Marking a TV episode watched (insert into user_tv_episodes) deletes any still-open time_block planned for that exact season+episode. Batch-planned blocks covering multiple episodes at once are intentionally NOT matched (season_number/episode_number are only stamped on a block when exactly one episode was planned) — deleting a "watch 3 episodes" reminder because one of the three was watched would be wrong.',
   '{}'::jsonb),
  ('project_item_delete_cleans_block',
   'Deleting a project_item deletes any time_block scheduled for it.',
   '{}'::jsonb)
ON CONFLICT (rule_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.link_rule_enabled(p_rule_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT enabled FROM public.link_rules WHERE rule_name = p_rule_name), false);
$$;

CREATE OR REPLACE FUNCTION public.link_rule_config(p_rule_name text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT config FROM public.link_rules WHERE rule_name = p_rule_name), '{}'::jsonb);
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. time_blocks: precise episode identity, so a single-episode plan can be
--    matched exactly on "watched" — without this, source_id alone only
--    identifies the SHOW, not which episode was planned.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.time_blocks
  ADD COLUMN IF NOT EXISTS season_number  int,
  ADD COLUMN IF NOT EXISTS episode_number int;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. time_blocks → tasks: delete-cascade (for auto-created tasks only) +
--    date/time sync
-- ═══════════════════════════════════════════════════════════════════════════
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
          DELETE FROM public.tasks WHERE id = v_task.id;
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

DROP TRIGGER IF EXISTS trg_sync_task_from_time_block ON public.time_blocks;
CREATE TRIGGER trg_sync_task_from_time_block
  AFTER UPDATE OR DELETE ON public.time_blocks
  FOR EACH ROW EXECUTE FUNCTION public.sync_task_from_time_block();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. tasks → time_blocks: date/time sync (the other direction). Task DELETE
--    already cleans up its linked block at the app layer (deleteTask in
--    src/features/todo/api/tasksApi.ts, which also best-effort removes the
--    Google Calendar event — something a trigger can't do) — not duplicated
--    here to avoid two code paths disagreeing about calendar cleanup.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_time_block_from_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() = 1
     AND public.link_rule_enabled('block_task_date_sync')
     AND (NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.due_time IS DISTINCT FROM OLD.due_time)
     AND NEW.due_date IS NOT NULL AND NEW.due_time IS NOT NULL THEN
    UPDATE public.time_blocks
       SET date = NEW.due_date,
           start_time = NEW.due_time,
           updated_at = now()
     WHERE source_type = 'task' AND source_id = NEW.id
       AND (date IS DISTINCT FROM NEW.due_date OR start_time IS DISTINCT FROM NEW.due_time);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_time_block_from_task ON public.tasks;
CREATE TRIGGER trg_sync_time_block_from_task
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_time_block_from_task();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. user_tv_episodes (spoke) → time_blocks (hub): watching an episode
--    cleans up its planned block.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_block_on_episode_watched()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.link_rule_enabled('episode_watched_cleans_block') THEN
    DELETE FROM public.time_blocks
     WHERE source_type = 'tv_episode'
       AND source_id = NEW.tv_entry_id
       AND season_number = NEW.season_number
       AND episode_number = NEW.episode_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_block_on_episode_watched ON public.user_tv_episodes;
CREATE TRIGGER trg_cleanup_block_on_episode_watched
  AFTER INSERT ON public.user_tv_episodes
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_block_on_episode_watched();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. project_items (spoke) → time_blocks (hub): deleting a project item
--    cleans up its scheduled block.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_block_on_project_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.link_rule_enabled('project_item_delete_cleans_block') THEN
    DELETE FROM public.time_blocks
     WHERE source_type = 'project_item' AND source_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_block_on_project_item_delete ON public.project_items;
CREATE TRIGGER trg_cleanup_block_on_project_item_delete
  AFTER DELETE ON public.project_items
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_block_on_project_item_delete();
