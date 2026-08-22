-- ═══════════════════════════════════════════════════════════════════════════
-- Google Tasks outbox — per-task FIFO ordering + a stale-delete-safe id
-- clear. Migration 073 stopped two workers from claiming the SAME outbox
-- ROW (FOR UPDATE SKIP LOCKED), but never stopped two DIFFERENT rows for
-- the SAME task from being claimed out of order.
--
-- Real race this closes: a task is opted out (enqueues 'delete' for its
-- current google_task_id) and, before that drains, gets Reopened (enqueues
-- a force_recreate 'create' for a fresh one). If a worker claims the
-- 'create' row before the 'delete' row finishes — both rows are
-- independently claimable today, nothing orders them — the 'delete' can
-- run AFTER the 'create' and wipe the BRAND NEW google_task_id via its
-- unconditional apply_google_task_snapshot(p_clear_google_task_id=true)
-- call, leaving the task's fresh Google Task orphaned locally (Google still
-- has it; we've lost the id that points at it).
--
-- Fix, two layers:
--   A) claim_google_tasks_outbox now only ever claims the OLDEST
--      outstanding row per (user_id, task_id) — a newer row for the same
--      task can NEVER be claimed while an older one is still outstanding,
--      even if that older row is currently claimed by another worker or
--      sitting in backoff. Concurrency across DIFFERENT tasks is
--      unaffected; only same-task ordering is now enforced.
--   B) clear_google_task_id_if_matches — a conditional clear that only
--      wipes tasks.google_task_id when it STILL equals the id THIS delete
--      was targeting. A stale delete that (despite the FIFO fix) somehow
--      still runs after a newer create can no longer wipe the new id out
--      from under it — belt-and-suspenders on top of (A), not a
--      replacement for it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. FIFO-ordered claim ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_google_tasks_outbox(
  p_respect_backoff BOOLEAN DEFAULT true,
  p_user_id         UUID    DEFAULT NULL
)
RETURNS SETOF public.google_tasks_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := public.effective_user_id(p_user_id);
BEGIN
  RETURN QUERY
  WITH ranked AS (
    -- row_number() per task, oldest first — rn=1 is the ONLY row of this
    -- task that may ever be claimed, regardless of every other row's own
    -- backoff/claimed state. This is what makes cross-row ordering for the
    -- same task absolute rather than "usually fine".
    SELECT o.*,
           row_number() OVER (PARTITION BY o.task_id ORDER BY o.created_at, o.id) AS rn
      FROM public.google_tasks_outbox o
     WHERE o.user_id = v_user_id
  ),
  claimable AS (
    SELECT id FROM ranked
     WHERE rn = 1
       AND (NOT p_respect_backoff OR next_retry_at <= now())
       AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.google_tasks_outbox o
     SET claimed_at = now()
    FROM claimable c
   WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

-- ── B. Conditional id clear — the stale-delete-safety net ─────────────────
-- Returns TRUE only if a row was actually updated (the expected id still
-- matched) — callers use this to know whether their delete's cleanup
-- landed, the same way a SQL affected-row-count would.
CREATE OR REPLACE FUNCTION public.clear_google_task_id_if_matches(
  p_task_id                 UUID,
  p_expected_google_task_id TEXT,
  p_user_id                 UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := public.effective_user_id(p_user_id);
BEGIN
  PERFORM set_config('app.google_sync_write', 'true', true);

  UPDATE public.tasks
     SET google_task_id    = NULL,
         google_updated_at = now()
   WHERE id = p_task_id
     AND user_id = v_user_id
     AND google_task_id = p_expected_google_task_id;

  RETURN FOUND;
END;
$$;
