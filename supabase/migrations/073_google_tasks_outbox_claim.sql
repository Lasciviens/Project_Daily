-- ═══════════════════════════════════════════════════════════════════════════
-- Google Tasks outbox — atomic claim (real concurrency bug, found in review
-- of Phase 3). The browser drain (fires right after any local mutation,
-- ignoring backoff — "a human just asked for it") and the cron drain (every
-- 20 minutes, respecting backoff) both read pending outbox rows with a
-- plain SELECT and only DELETE on success. If both happen to read the SAME
-- 'create' row before either finishes — a real, not-hypothetical window,
-- since Google's own HTTP round-trip is where the race lives — both see
-- tasks.google_task_id still NULL and both call createGoogleTask, producing
-- TWO Google tasks for one local row (a duplicate that nothing ever cleans
-- up, since only ONE id can win the final apply_google_task_snapshot write).
--
-- Fixed with the standard Postgres multi-consumer-queue pattern: claim a
-- batch atomically via FOR UPDATE SKIP LOCKED inside one transaction, so two
-- concurrent claimers can never end up processing the same row. A stale
-- claim (a crashed browser tab or a timed-out function run) expires after 5
-- minutes and becomes claimable again — never stuck forever.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.google_tasks_outbox ADD COLUMN claimed_at TIMESTAMPTZ;

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
    SELECT id FROM public.google_tasks_outbox
     WHERE user_id = v_user_id
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
