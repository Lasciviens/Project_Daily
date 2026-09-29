-- 114 — Dev Requests: when a request was finished, and when a prompt was built for it.
--
-- completed_at: stamped by the database the moment status becomes 'done'
--   (from any writer — the drawer, the composer, ai-proxy's db_update), and
--   cleared again when a request leaves 'done' (reopened). The card shows it
--   as "Done 30/09 09:12".
-- prompted_at: set by the web app when a prompt for Claude is built or copied
--   for the request, so the drawer can flag "Prompted" requests that still
--   need checking and closing afterwards.
--
-- Idempotent: safe to run twice. Only existing 'done' rows are touched (their
-- completed_at is backfilled from updated_at — the best record of when they
-- were closed, since the status change was their last edit in most cases).

ALTER TABLE public.dev_requests ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.dev_requests ADD COLUMN IF NOT EXISTS prompted_at  timestamptz;

UPDATE public.dev_requests
   SET completed_at = COALESCE(updated_at, created_at)
 WHERE status = 'done' AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.dev_requests_stamp_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'done' THEN
    -- Still done (an edit of a done request): keep the original moment.
    NEW.completed_at := COALESCE(OLD.completed_at, NEW.completed_at, now());
  ELSE
    -- Newly done, or inserted as done.
    NEW.completed_at := COALESCE(CASE WHEN TG_OP = 'INSERT' THEN NEW.completed_at END, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dev_requests_completed_at ON public.dev_requests;
CREATE TRIGGER trg_dev_requests_completed_at
  BEFORE INSERT OR UPDATE OF status, completed_at ON public.dev_requests
  FOR EACH ROW EXECUTE FUNCTION public.dev_requests_stamp_completed_at();
