-- Health Auto Export integration (Apple HealthKit — includes Huawei Health data
-- synced into HealthKit on iOS). Workouts get their own table shaped
-- comparably to hevy_workouts (so they can eventually sit in the same
-- calendar/list views); everything else (steps, sleep, heart rate, body
-- composition, etc.) lands in a generic per-metric-per-day table since each
-- metric's payload shape differs (qty vs Min/Avg/Max vs multi-field sleep).

-- ============================================================
-- Table: health_workouts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.health_workouts (
  id                text PRIMARY KEY,   -- workout UUID from the export payload
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  start_time        timestamptz NULL,
  end_time          timestamptz NULL,
  duration_seconds  numeric NULL,
  active_energy_kj  numeric NULL,
  total_energy_kj   numeric NULL,
  avg_heart_rate    numeric NULL,
  min_heart_rate    numeric NULL,
  max_heart_rate    numeric NULL,
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,  -- full payload incl. per-minute arrays
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  synced_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.health_workouts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'health_workouts'
      AND policyname = 'Users manage own health workouts'
  ) THEN
    CREATE POLICY "Users manage own health workouts"
      ON public.health_workouts
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_workouts TO authenticated;

CREATE INDEX IF NOT EXISTS health_workouts_user_id_start_time_idx
  ON public.health_workouts (user_id, start_time DESC);

CREATE TRIGGER trg_health_workouts_updated_at
  BEFORE UPDATE ON public.health_workouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Table: health_metrics
-- ============================================================
CREATE TABLE IF NOT EXISTS public.health_metrics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_name  text NOT NULL,          -- e.g. 'step_count', 'sleep_analysis', 'heart_rate'
  date         date NOT NULL,          -- day this data point belongs to (time-of-day dropped)
  unit         text NULL,
  source       text NOT NULL DEFAULT '',  -- e.g. "HUAWEI Health" / composite device|app string
  value        jsonb NOT NULL,         -- the raw data point — shape varies by metric_name
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  synced_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'health_metrics'
      AND policyname = 'Users manage own health metrics'
  ) THEN
    CREATE POLICY "Users manage own health metrics"
      ON public.health_metrics
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_metrics TO authenticated;

-- Idempotent upsert key — repeated/overlapping delivery (esp. with Health Auto
-- Export's "Batch Requests" splitting a large export into many calls) never
-- creates duplicate rows for the same metric/day/source.
CREATE UNIQUE INDEX IF NOT EXISTS health_metrics_user_metric_date_source_idx
  ON public.health_metrics (user_id, metric_name, date, source);

CREATE INDEX IF NOT EXISTS health_metrics_user_id_metric_date_idx
  ON public.health_metrics (user_id, metric_name, date DESC);

CREATE TRIGGER trg_health_metrics_updated_at
  BEFORE UPDATE ON public.health_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
