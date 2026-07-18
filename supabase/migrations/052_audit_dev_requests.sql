-- ============================================================
-- 052 — Attach the audit trigger to dev_requests
-- ============================================================
-- Real bug: deleting a dev_request left NO trace in the Developer → Activity
-- tab, so an accidental delete was unrecoverable. Root cause: migration 037
-- attached `trg_audit` to a hardcoded table list built BEFORE dev_requests
-- existed (it was created later in 042), and nothing added it since. The
-- audit function stores the full OLD row as jsonb on DELETE (see 037's
-- log_audit), so once this trigger is attached, a deleted dev_request is
-- recoverable from audit_logs.old_data for the 30-day retention window.
-- (This cannot recover rows deleted before this migration — no snapshot was
-- ever taken for those.)

DROP TRIGGER IF EXISTS trg_audit ON public.dev_requests;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.dev_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
