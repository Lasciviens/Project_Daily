-- ============================================================
-- 115 — service_subscriptions
-- ============================================================
-- Settings → Integrations lists what each external service costs and when it
-- renews, next to that service's connection card. One row per subscription:
-- `service` is the key a connection card matches on ('hevy', 'playstation',
-- 'steam', 'google', 'strava', 'screenscraper', 'supabase', 'gemini') or any
-- free text for a service without a card (listed under "Other
-- subscriptions"). Free text, not a CHECK list: a new service must never
-- need a migration.
--
-- requirement: 'required' = the integration only works while this is paid
-- (e.g. ScreenScraper premium); 'info' = you have it, the integration does
-- not depend on it. billing_cycle 'free' / 'once' carry no monthly cost.
--
-- Owner-only RLS, user_id DEFAULT auth.uid(), trg_audit like every
-- user-authored table, updated_at via update_updated_at() (002_media.sql).
-- Updates no existing row. Not in ai-proxy's DB_CATALOG.

CREATE TABLE IF NOT EXISTS public.service_subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  service        text NOT NULL CHECK (length(trim(service)) > 0),
  name           text,
  account        text,
  plan           text,
  price          numeric(12,2) CHECK (price IS NULL OR price >= 0),
  currency       text NOT NULL DEFAULT 'NOK',
  billing_cycle  text NOT NULL DEFAULT 'monthly'
                 CHECK (billing_cycle IN ('monthly', 'yearly', 'weekly', 'once', 'free')),
  renews_on      date,
  requirement    text NOT NULL DEFAULT 'info' CHECK (requirement IN ('required', 'info')),
  notes          text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'service_subscriptions'
      AND policyname = 'Users manage own service subscriptions'
  ) THEN
    CREATE POLICY "Users manage own service subscriptions"
      ON public.service_subscriptions
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS service_subscriptions_user_service_idx
  ON public.service_subscriptions (user_id, service);

DROP TRIGGER IF EXISTS trg_service_subscriptions_updated_at ON public.service_subscriptions;
CREATE TRIGGER trg_service_subscriptions_updated_at
  BEFORE UPDATE ON public.service_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_audit ON public.service_subscriptions;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.service_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
