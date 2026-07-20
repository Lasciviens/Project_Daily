-- FITBIT AIR INTEGRATION — Phase 0: source-aware foundation.
--
-- CARDINAL RULE (docs/fitbit-air-integration.md): BOTH sources' data always
-- flows into the DB in FULL — Apple (Health Auto Export) AND Google (Fitbit
-- Air via the Google Health API) — and the UI must be able to show ANY metric
-- from ANY source on demand. This migration makes the storage layer able to
-- hold both streams side-by-side without blending or double-counting. It is
-- device-independent and additive only — nothing here reads or requires Fitbit
-- data yet (that arrives in Phase 3), and existing Apple data is untouched.
--
-- Idempotent (IF NOT EXISTS everywhere) — safe to re-run.

-- 1. source_family on the two health tables.
--
-- Flat DEFAULT 'apple' is CORRECT, not a shortcut that loses data: Huawei
-- Health already syncs into Apple HealthKit before Health Auto Export sends it
-- to us, so every row that exists today genuinely IS the 'apple' family
-- regardless of its raw `source` string ("", "HUAWEI Health",
-- "Furkan's Apple Watch|Lasci", …). No per-row string-matching backfill is
-- needed. NOT NULL guarantees the resolver in healthAggregate.ts never has to
-- reason about a null family. Adding a NOT NULL column with a constant default
-- is a metadata-only operation in modern Postgres (no table rewrite), so this
-- is fast even at ~60k rows.
--
-- 'manual' is allowed because manually-entered corrections (upsertManualSleepEntry)
-- are a distinct provenance; today they still land as 'apple' (column default,
-- they don't set the family) which is fine — the sleep aggregator already
-- prefers manual rows via the raw `source='manual'` string, independent of
-- source_family.
ALTER TABLE public.health_metrics
  ADD COLUMN IF NOT EXISTS source_family text NOT NULL DEFAULT 'apple'
    CHECK (source_family IN ('apple', 'fitbit', 'manual'));

ALTER TABLE public.health_workouts
  ADD COLUMN IF NOT EXISTS source_family text NOT NULL DEFAULT 'apple'
    CHECK (source_family IN ('apple', 'fitbit', 'manual'));

-- 2. health_sleep_segments — the durable home for Fitbit's timestamped sleep
-- stage segments (light/deep/rem/wake), which Apple/Health-Auto-Export does
-- NOT deliver per-segment (only session-level aggregates). Created empty and
-- UNUSED until Phase 3 wires the poller — zero behavioural risk now. No audit
-- trigger (matches the existing bulk-synced-table exemption convention:
-- hevy_*/health_* tables are excluded from audit_logs to avoid sync-spam).
CREATE TABLE IF NOT EXISTS public.health_sleep_segments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_at      timestamptz NOT NULL,
  end_at        timestamptz NOT NULL,
  stage         text NOT NULL CHECK (stage IN ('light', 'deep', 'rem', 'wake', 'asleep')),
  source        text,
  source_family text NOT NULL DEFAULT 'fitbit' CHECK (source_family IN ('apple', 'fitbit', 'manual')),
  created_at    timestamptz NOT NULL DEFAULT now()
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

CREATE INDEX IF NOT EXISTS health_sleep_segments_user_start_idx
  ON public.health_sleep_segments (user_id, start_at DESC);

-- 3. health_source_prefs — the per-metric "which source shows first" override.
-- MUST be a DB table, not localStorage: ai-proxy is a server-side Deno function
-- and can't read the browser's localStorage, and the AI is required to read the
-- stored default when answering health questions. Created empty; its read/write
-- UI lands in Phase 4. Absence of a row = fall back to the curated code default
-- in src/features/training/healthSourceDefaults.ts.
CREATE TABLE IF NOT EXISTS public.health_source_prefs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_name   text NOT NULL,
  source_family text NOT NULL CHECK (source_family IN ('apple', 'fitbit')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, metric_name)
);

ALTER TABLE public.health_source_prefs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'health_source_prefs'
      AND policyname = 'health_source_prefs_owner'
  ) THEN
    CREATE POLICY "health_source_prefs_owner" ON public.health_source_prefs
      FOR ALL TO authenticated
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
