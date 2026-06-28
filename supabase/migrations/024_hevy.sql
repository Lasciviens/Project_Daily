-- Migration 024: Hevy integration tables
-- All tables are idempotent, RLS-enabled, with owner policies

-- ============================================================
-- Table 1: hevy_exercise_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_exercise_templates (
  id                   text PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                text NOT NULL,
  type                 text NOT NULL CHECK (type IN (
                         'weight_reps','bodyweight_reps','weighted_bodyweight',
                         'assisted_bodyweight','duration','distance_duration','weight_distance'
                       )),
  primary_muscle_group text NULL,
  is_custom            boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  synced_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hevy_exercise_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_exercise_templates'
      AND policyname = 'Users manage own hevy exercise templates'
  ) THEN
    CREATE POLICY "Users manage own hevy exercise templates"
      ON public.hevy_exercise_templates
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_exercise_templates TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_exercise_templates_user_id_idx
  ON public.hevy_exercise_templates (user_id);

CREATE INDEX IF NOT EXISTS hevy_exercise_templates_user_id_muscle_idx
  ON public.hevy_exercise_templates (user_id, primary_muscle_group);

-- ============================================================
-- Table 2: hevy_exercise_template_muscles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_exercise_template_muscles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_template_id text NOT NULL REFERENCES public.hevy_exercise_templates(id) ON DELETE CASCADE,
  muscle_group         text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hevy_exercise_template_muscles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_exercise_template_muscles'
      AND policyname = 'Users manage own hevy template muscles'
  ) THEN
    CREATE POLICY "Users manage own hevy template muscles"
      ON public.hevy_exercise_template_muscles
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_exercise_template_muscles TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_exercise_template_muscles_template_id_idx
  ON public.hevy_exercise_template_muscles (exercise_template_id);

CREATE INDEX IF NOT EXISTS hevy_exercise_template_muscles_user_id_muscle_idx
  ON public.hevy_exercise_template_muscles (user_id, muscle_group);

-- ============================================================
-- Table 3: hevy_workout_events_cursor
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_workout_events_cursor (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_events_since timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hevy_workout_events_cursor ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_workout_events_cursor'
      AND policyname = 'Users manage own hevy events cursor'
  ) THEN
    CREATE POLICY "Users manage own hevy events cursor"
      ON public.hevy_workout_events_cursor
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_workout_events_cursor TO authenticated;

-- ============================================================
-- Table 4: hevy_workouts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_workouts (
  id               text PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            text NOT NULL,
  routine_id       text NULL,
  description      text NULL,
  start_time       timestamptz NULL,
  end_time         timestamptz NULL,
  hevy_updated_at  timestamptz NOT NULL,
  hevy_created_at  timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  synced_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hevy_workouts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_workouts'
      AND policyname = 'Users manage own hevy workouts'
  ) THEN
    CREATE POLICY "Users manage own hevy workouts"
      ON public.hevy_workouts
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_workouts TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_workouts_user_id_start_time_idx
  ON public.hevy_workouts (user_id, start_time DESC);

CREATE INDEX IF NOT EXISTS hevy_workouts_user_id_hevy_created_at_idx
  ON public.hevy_workouts (user_id, hevy_created_at DESC);

-- ============================================================
-- Table 5: hevy_workout_exercises
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_workout_exercises (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hevy_workout_id      text NOT NULL REFERENCES public.hevy_workouts(id) ON DELETE CASCADE,
  exercise_template_id text NOT NULL,
  index                integer NOT NULL,
  title                text NOT NULL,
  notes                text NULL,
  supersets_id         integer NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hevy_workout_id, index)
);

ALTER TABLE public.hevy_workout_exercises ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_workout_exercises'
      AND policyname = 'Users manage own hevy workout exercises'
  ) THEN
    CREATE POLICY "Users manage own hevy workout exercises"
      ON public.hevy_workout_exercises
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_workout_exercises TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_workout_exercises_workout_id_idx
  ON public.hevy_workout_exercises (hevy_workout_id);

CREATE INDEX IF NOT EXISTS hevy_workout_exercises_template_id_idx
  ON public.hevy_workout_exercises (exercise_template_id);

CREATE INDEX IF NOT EXISTS hevy_workout_exercises_user_id_template_id_idx
  ON public.hevy_workout_exercises (user_id, exercise_template_id);

-- ============================================================
-- Table 6: hevy_sets
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_sets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hevy_exercise_id     uuid NOT NULL REFERENCES public.hevy_workout_exercises(id) ON DELETE CASCADE,
  exercise_template_id text NOT NULL,
  index                integer NOT NULL,
  type                 text NOT NULL CHECK (type IN ('normal','warmup','dropset','failure')),
  weight_kg            numeric NULL,
  reps                 integer NULL,
  distance_meters      numeric NULL,
  duration_seconds     integer NULL,
  rpe                  numeric NULL,
  custom_metric        numeric NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hevy_exercise_id, index)
);

ALTER TABLE public.hevy_sets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_sets'
      AND policyname = 'Users manage own hevy sets'
  ) THEN
    CREATE POLICY "Users manage own hevy sets"
      ON public.hevy_sets
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_sets TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_sets_exercise_id_idx
  ON public.hevy_sets (hevy_exercise_id);

CREATE INDEX IF NOT EXISTS hevy_sets_user_id_template_id_idx
  ON public.hevy_sets (user_id, exercise_template_id);

-- ============================================================
-- Table 7: hevy_routine_folders
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_routine_folders (
  id         bigint PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hevy_routine_folders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_routine_folders'
      AND policyname = 'Users manage own hevy routine folders'
  ) THEN
    CREATE POLICY "Users manage own hevy routine folders"
      ON public.hevy_routine_folders
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_routine_folders TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_routine_folders_user_id_idx
  ON public.hevy_routine_folders (user_id);

-- ============================================================
-- Table 8: hevy_routines
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_routines (
  id              text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id       bigint NULL REFERENCES public.hevy_routine_folders(id) ON DELETE SET NULL,
  title           text NOT NULL,
  notes           text NULL,
  hevy_updated_at timestamptz NOT NULL,
  hevy_created_at timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  synced_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hevy_routines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_routines'
      AND policyname = 'Users manage own hevy routines'
  ) THEN
    CREATE POLICY "Users manage own hevy routines"
      ON public.hevy_routines
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_routines TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_routines_user_id_idx
  ON public.hevy_routines (user_id);

CREATE INDEX IF NOT EXISTS hevy_routines_user_id_folder_id_idx
  ON public.hevy_routines (user_id, folder_id);

-- ============================================================
-- Table 9: hevy_routine_exercises
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_routine_exercises (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hevy_routine_id      text NOT NULL REFERENCES public.hevy_routines(id) ON DELETE CASCADE,
  exercise_template_id text NOT NULL,
  index                integer NOT NULL,
  title                text NOT NULL,
  notes                text NULL,
  rest_seconds         text NULL,
  supersets_id         integer NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hevy_routine_id, index)
);

ALTER TABLE public.hevy_routine_exercises ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_routine_exercises'
      AND policyname = 'Users manage own hevy routine exercises'
  ) THEN
    CREATE POLICY "Users manage own hevy routine exercises"
      ON public.hevy_routine_exercises
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_routine_exercises TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_routine_exercises_routine_id_idx
  ON public.hevy_routine_exercises (hevy_routine_id);

CREATE INDEX IF NOT EXISTS hevy_routine_exercises_user_id_template_id_idx
  ON public.hevy_routine_exercises (user_id, exercise_template_id);

-- ============================================================
-- Table 10: hevy_routine_sets
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_routine_sets (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hevy_routine_exercise_id  uuid NOT NULL REFERENCES public.hevy_routine_exercises(id) ON DELETE CASCADE,
  index                     integer NOT NULL,
  type                      text NOT NULL CHECK (type IN ('normal','warmup','dropset','failure')),
  weight_kg                 numeric NULL,
  reps                      integer NULL,
  rep_range_start           integer NULL,
  rep_range_end             integer NULL,
  distance_meters           numeric NULL,
  duration_seconds          integer NULL,
  rpe                       numeric NULL,
  custom_metric             numeric NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hevy_routine_exercise_id, index)
);

ALTER TABLE public.hevy_routine_sets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_routine_sets'
      AND policyname = 'Users manage own hevy routine sets'
  ) THEN
    CREATE POLICY "Users manage own hevy routine sets"
      ON public.hevy_routine_sets
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_routine_sets TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_routine_sets_routine_exercise_id_idx
  ON public.hevy_routine_sets (hevy_routine_exercise_id);

-- ============================================================
-- Table 11: hevy_body_measurements
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hevy_body_measurements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date             date NOT NULL,
  weight_kg        numeric NULL,
  lean_mass_kg     numeric NULL,
  fat_percent      numeric NULL,
  neck_cm          numeric NULL,
  shoulder_cm      numeric NULL,
  chest_cm         numeric NULL,
  left_bicep_cm    numeric NULL,
  right_bicep_cm   numeric NULL,
  left_forearm_cm  numeric NULL,
  right_forearm_cm numeric NULL,
  abdomen_cm       numeric NULL,
  waist_cm         numeric NULL,
  hips_cm          numeric NULL,
  left_thigh_cm    numeric NULL,
  right_thigh_cm   numeric NULL,
  left_calf_cm     numeric NULL,
  right_calf_cm    numeric NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

ALTER TABLE public.hevy_body_measurements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hevy_body_measurements'
      AND policyname = 'Users manage own hevy body measurements'
  ) THEN
    CREATE POLICY "Users manage own hevy body measurements"
      ON public.hevy_body_measurements
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hevy_body_measurements TO authenticated;

CREATE INDEX IF NOT EXISTS hevy_body_measurements_user_id_date_idx
  ON public.hevy_body_measurements (user_id, date DESC);
