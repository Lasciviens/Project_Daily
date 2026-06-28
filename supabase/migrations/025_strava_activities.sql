-- ─── Strava Activities ────────────────────────────────────────────────────────
-- Dedicated table for Strava-sourced activities, decoupled from train_sessions.
-- train_sessions is cleared here because the app is moving to Hevy for strength
-- logging; Strava data moves to this purpose-built table instead.

CREATE TABLE IF NOT EXISTS strava_activities (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strava_activity_id  bigint      UNIQUE,
  type                text        NOT NULL CHECK (type IN ('run', 'cycling', 'walk', 'swim', 'yoga', 'other')),
  title               text        NOT NULL,
  start_date          timestamptz,
  distance_meters     integer,
  duration_seconds    integer,
  elevation_gain_m    integer,
  avg_heart_rate      integer,
  avg_pace_sec_per_km integer,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE strava_activities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'strava_activities'
      AND policyname = 'Users manage own strava activities'
  ) THEN
    CREATE POLICY "Users manage own strava activities"
      ON strava_activities FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON strava_activities TO authenticated;

CREATE INDEX IF NOT EXISTS strava_activities_user_start_date
  ON strava_activities (user_id, start_date DESC);

CREATE INDEX IF NOT EXISTS strava_activities_strava_activity_id
  ON strava_activities (strava_activity_id);

-- ─── Data migration from train_sessions ───────────────────────────────────────
-- Migrates all Strava-sourced rows. ON CONFLICT is a no-op so this is safe to
-- run more than once (idempotent). type values from train_sessions already match
-- the CHECK constraint above; 'strength' rows have source != 'strava' so they
-- are excluded by the WHERE clause.

INSERT INTO strava_activities (
  user_id,
  strava_activity_id,
  type,
  title,
  start_date,
  distance_meters,
  duration_seconds,
  elevation_gain_m,
  avg_heart_rate,
  avg_pace_sec_per_km,
  notes,
  created_at,
  updated_at
)
SELECT
  user_id,
  strava_activity_id,
  type,
  title,
  COALESCE(completed_at, created_at),
  distance_meters,
  duration_seconds,
  elevation_gain_m,
  avg_heart_rate,
  avg_pace_sec_per_km,
  notes,
  created_at,
  updated_at
FROM train_sessions
WHERE source = 'strava'
ON CONFLICT (strava_activity_id) DO NOTHING;

-- ─── Clear train_sessions ─────────────────────────────────────────────────────
-- App is moving to Hevy for strength tracking; train_sessions is wiped so
-- Hevy-imported data can start clean without legacy manual/strava rows.

DELETE FROM train_sessions;
