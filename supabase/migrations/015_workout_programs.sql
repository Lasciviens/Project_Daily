-- ─── Rename existing training tables to train_* prefix ───────────────────────

ALTER TABLE training_sessions  RENAME TO train_sessions;
ALTER TABLE training_programs  RENAME TO train_programs;
ALTER TABLE exercises          RENAME TO train_exercises;
ALTER TABLE session_exercises  RENAME TO train_session_exercises;

-- ─── Program Workouts ────────────────────────────────────────────────────────
-- Each row = one workout day within a program (e.g. "Chest Day" in "5-Day Split")

CREATE TABLE train_program_workouts (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  program_id  uuid    REFERENCES train_programs(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        text    NOT NULL,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE train_program_workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user owns train_program_workouts"
  ON train_program_workouts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Program Workout Exercises ────────────────────────────────────────────────
-- Exercise templates within a workout day — stores suggested sets/rep range

CREATE TABLE train_program_exercises (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  workout_id    uuid    REFERENCES train_program_workouts(id) ON DELETE CASCADE NOT NULL,
  user_id       uuid    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  exercise_name text    NOT NULL,
  sort_order    integer DEFAULT 0,
  sets          integer DEFAULT 3,
  min_reps      integer,
  max_reps      integer,
  notes         text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE train_program_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user owns train_program_exercises"
  ON train_program_exercises FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
