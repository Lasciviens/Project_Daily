-- FITBIT AIR — Phase 3: poller operational state (one row per user).
-- google-health-sync records its last success/error here; the UI's reconnect
-- banner and a future stale-data cue read it. Owner-read RLS; writes come from
-- the service-role poller only. Idempotent.
CREATE TABLE IF NOT EXISTS public.google_health_sync_state (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_success_at timestamptz,
  last_error      text,
  last_error_at   timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_health_sync_state ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='google_health_sync_state' AND policyname='google_health_sync_state_owner_read'
  ) THEN
    CREATE POLICY "google_health_sync_state_owner_read" ON public.google_health_sync_state
      FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
  END IF;
END $$;
