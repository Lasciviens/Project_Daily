-- ─── Exercise reference library + per-session sets ────────────────────────────
-- Replaces the `exercises jsonb` column in training_sessions, which cannot
-- support progressive overload tracking, personal records, or exercise search.
--
-- Two tables:
--   exercises         — searchable reference (system + user-created)
--   session_exercises — individual sets within a training session

-- ─── Requires pg_trgm for name search (enabled in 009) ───────────────────────

-- ─── exercises ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exercises (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL user_id = system exercise visible to all; non-NULL = user-created
  user_id        uuid    DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text    NOT NULL,
  category       text    NOT NULL DEFAULT 'strength'
                         CHECK (category IN ('strength', 'cardio', 'mobility', 'plyometric', 'other')),
  muscle_groups  text[]  NOT NULL DEFAULT '{}',
  equipment      text    CHECK (equipment IN (
                           'barbell', 'dumbbell', 'machine', 'bodyweight',
                           'cable', 'kettlebell', 'resistance_band', 'other'
                         )),
  instructions   text,
  is_system      boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- System exercises: all authenticated users can read
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exercises' AND policyname = 'exercises_read'
  ) THEN
    CREATE POLICY exercises_read ON exercises
      FOR SELECT TO authenticated USING (is_system = true OR auth.uid() = user_id);
  END IF;

  -- Users can only write their own custom exercises (not system ones)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exercises' AND policyname = 'exercises_insert'
  ) THEN
    CREATE POLICY exercises_insert ON exercises
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND is_system = false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exercises' AND policyname = 'exercises_update'
  ) THEN
    CREATE POLICY exercises_update ON exercises
      FOR UPDATE TO authenticated USING (auth.uid() = user_id AND is_system = false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exercises' AND policyname = 'exercises_delete'
  ) THEN
    CREATE POLICY exercises_delete ON exercises
      FOR DELETE TO authenticated USING (auth.uid() = user_id AND is_system = false);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON exercises TO authenticated;

CREATE INDEX IF NOT EXISTS exercises_category ON exercises (category);
-- Trigram index for fast ILIKE / similarity search on exercise names
CREATE INDEX IF NOT EXISTS exercises_name_trgm ON exercises USING gin (name gin_trgm_ops);

-- ─── session_exercises ────────────────────────────────────────────────────────
-- Each row = one set within a session for one exercise.
CREATE TABLE IF NOT EXISTS session_exercises (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid        NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL DEFAULT auth.uid()
                               REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id      uuid        NOT NULL REFERENCES exercises(id),
  sort_order       integer     NOT NULL DEFAULT 0,
  set_number       integer     NOT NULL DEFAULT 1,
  reps             integer,
  weight_kg        numeric(6,2),
  -- For timed sets (planks, holds)
  duration_seconds integer,
  -- For cardio exercises
  distance_meters  integer,
  -- Rate of Perceived Exertion 1–10
  rpe              integer     CHECK (rpe BETWEEN 1 AND 10),
  notes            text,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (session_id, exercise_id, set_number)
);

ALTER TABLE session_exercises ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'session_exercises' AND policyname = 'session_exercises_owner'
  ) THEN
    CREATE POLICY session_exercises_owner ON session_exercises
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON session_exercises TO authenticated;

-- Fast lookup: all sets for a session, ordered for display
CREATE INDEX IF NOT EXISTS session_exercises_session
  ON session_exercises (session_id, sort_order, set_number);

-- Fast lookup: all sets for an exercise across sessions (progressive overload)
CREATE INDEX IF NOT EXISTS session_exercises_exercise
  ON session_exercises (exercise_id, user_id);

-- Progressive overload history: last N times user did exercise X
CREATE INDEX IF NOT EXISTS session_exercises_history
  ON session_exercises (user_id, exercise_id, created_at DESC);

-- ─── Drop the JSONB placeholder column from training_sessions ─────────────────
-- Data in this column is unstructured and cannot be migrated automatically.
-- If you have sessions with exercises recorded in the old JSONB format,
-- re-enter them via the new UI after this migration runs.
ALTER TABLE training_sessions DROP COLUMN IF EXISTS exercises;
