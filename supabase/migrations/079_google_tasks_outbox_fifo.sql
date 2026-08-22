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
-- Real bug found reviewing this migration a second time, confirmed against a
-- live EXPLAIN: the original version below computed the per-task rn=1
-- filter in a `ranked` CTE (a row_number() window function), then applied
-- `FOR UPDATE SKIP LOCKED` in a SEPARATE `claimable` CTE that selects only
-- `id FROM ranked` — not directly from the base table. Postgres's locking
-- clause does NOT propagate INTO a WITH query from a query that merely
-- selects from it (this is documented Postgres behavior, not a fluke of
-- this query): "FOR UPDATE ... does not lock rows that are referenced only
-- through a WITH query; the clause must be attached to the individual
-- SELECT inside the WITH query itself to have that effect." The EXPLAIN
-- plan for the old version confirmed this directly — no LockRows node
-- anywhere in it — meaning the claim had silently stopped providing any
-- concurrency guarantee at all: two workers could both "claim" the same
-- row, each thinking SKIP LOCKED protected them, and both call Google for
-- the same 'create' (exactly the migration-073 duplicate this whole claim
-- function exists to prevent).
--
-- Fixed by moving `FOR UPDATE OF o SKIP LOCKED` onto a CTE that selects
-- DIRECTLY from the base table (an anti-join against "any older
-- outstanding row for the same task", equivalent to rn=1 but without a
-- window function in the same query block as the lock clause) — this is
-- the same shape migration 073's original (correct, lock-bearing) query
-- used, just with the anti-join added for per-task ordering.
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
  WITH claimable AS (
    SELECT o.id
      FROM public.google_tasks_outbox o
     WHERE o.user_id = v_user_id
       AND (NOT p_respect_backoff OR o.next_retry_at <= now())
       AND (o.claimed_at IS NULL OR o.claimed_at < now() - interval '5 minutes')
       -- The FIFO half: no OLDER outstanding row for the SAME task may be
       -- skipped over — this row is claimable only if it's the oldest one
       -- for its task_id, full stop (regardless of that older row's own
       -- backoff/claimed state).
       AND NOT EXISTS (
         SELECT 1
           FROM public.google_tasks_outbox older
          WHERE older.user_id = o.user_id
            AND older.task_id = o.task_id
            AND (older.created_at, older.id) < (o.created_at, o.id)
       )
     ORDER BY o.created_at
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.google_tasks_outbox o
     SET claimed_at = now()
    FROM claimable c
   WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

-- Supports the anti-join's (task_id, created_at, id) comparison above —
-- without it, every claim scans the whole outbox per candidate row.
CREATE INDEX IF NOT EXISTS idx_google_tasks_outbox_task_order
  ON public.google_tasks_outbox (task_id, created_at, id);

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
