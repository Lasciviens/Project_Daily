-- FITBIT AIR INTEGRATION — Phase 0: source-aware foundation (redesigned
-- 2026-07-21 after live-data review; the earlier health_source_prefs table was
-- dropped from this migration on explicit user decision — display policy lives
-- in code as a per-metric priority ladder, not a DB preference table).
--
-- CARDINAL RULE (docs/fitbit-air-integration.md): BOTH sources' data always
-- flows into the DB in FULL — Apple (Health Auto Export) AND Google (Fitbit
-- Air via the Google Health API) — and the UI must be able to show ANY metric
-- from ANY source on demand. This migration makes the storage layer able to
-- hold both streams side-by-side; display resolution (one winning stream per
-- hour/day/night window) happens at query time in the app.
--
-- Idempotent (IF NOT EXISTS everywhere) — safe to re-run.

-- 1. source_family on the two health tables.
--
-- Flat DEFAULT 'apple' is CORRECT, not a shortcut that loses data: Huawei
-- Health already syncs into Apple HealthKit before Health Auto Export sends it
-- to us, so every row that exists today genuinely IS the 'apple' family
-- regardless of its raw `source` string ("", "HUAWEI Health",
-- "Furkan's Apple Watch|Lasci", …). NOT NULL guarantees the resolver never
-- reasons about a null family. Adding a NOT NULL column with a constant
-- default is a metadata-only operation in modern Postgres (no table rewrite).
--
-- 'manual' is allowed for provenance completeness; manually-entered
-- corrections currently land as 'apple' (column default) and are recognised by
-- the resolver via their raw source string 'manual', which ALWAYS outranks
-- device streams (highest ladder rung).
ALTER TABLE public.health_metrics
  ADD COLUMN IF NOT EXISTS source_family text NOT NULL DEFAULT 'apple'
    CHECK (source_family IN ('apple', 'fitbit', 'manual'));

ALTER TABLE public.health_workouts
  ADD COLUMN IF NOT EXISTS source_family text NOT NULL DEFAULT 'apple'
    CHECK (source_family IN ('apple', 'fitbit', 'manual'));

-- Composite indexes for source-filtered series reads (the Phase 4 source
-- switch and the compare view query by (metric, source_family, date range)).
CREATE INDEX IF NOT EXISTS health_metrics_source_series_idx
  ON public.health_metrics (user_id, metric_name, source_family, date DESC, recorded_at);

CREATE INDEX IF NOT EXISTS health_workouts_source_start_idx
  ON public.health_workouts (user_id, source_family, start_time DESC);

-- 2. health_sleep_segments — the durable home for Fitbit's timestamped sleep
-- stage segments (light/deep/rem/wake), which Apple/Health-Auto-Export does
-- NOT deliver per-segment (only session-level aggregates). Created empty and
-- UNUSED until Phase 3 wires the poller — zero behavioural risk now. No audit
-- trigger (matches the existing bulk-synced-table exemption convention:
-- hevy_*/health_* tables are excluded from audit_logs to avoid sync-spam).
--
-- IDEMPOTENCY: the ~3h poller will re-fetch the same night repeatedly, so
-- segments carry a natural unique key — re-delivery upserts onto the same
-- rows instead of duplicating them. `source_record_id` holds the API's own
-- segment/session id when one exists; the natural key below works even when
-- it doesn't.
CREATE TABLE IF NOT EXISTS public.health_sleep_segments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_at         timestamptz NOT NULL,
  end_at           timestamptz NOT NULL,
  stage            text NOT NULL CHECK (stage IN ('light', 'deep', 'rem', 'wake', 'asleep')),
  source           text,
  source_family    text NOT NULL DEFAULT 'fitbit' CHECK (source_family IN ('apple', 'fitbit', 'manual')),
  source_record_id text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.health_sleep_segments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'health_sleep_segments'
      AND policyname = 'health_sleep_segments_owner'
  ) THEN
    CREATE POLICY "health_sleep_segments_owner" ON public.health_sleep_segments
      FOR ALL TO authenticated
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- Natural idempotency key: one row per (user, family, window, stage). The
-- poller upserts ON CONFLICT on this index.
CREATE UNIQUE INDEX IF NOT EXISTS health_sleep_segments_natural_uidx
  ON public.health_sleep_segments (user_id, source_family, start_at, end_at, stage);

CREATE INDEX IF NOT EXISTS health_sleep_segments_user_start_idx
  ON public.health_sleep_segments (user_id, start_at DESC);
