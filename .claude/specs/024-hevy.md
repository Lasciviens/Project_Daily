### Problem
No database tables exist to store data synced from the Hevy fitness API. The Training feature currently uses Strava for cardio; Hevy will handle strength workouts. All Hevy API objects need a 1:1 relational home in Supabase.

### Solution
Migration `supabase/migrations/024_hevy.sql` — 10 tables, fully normalised, RLS-enforced, indexed for the query patterns the Training page will need.

### Files affected
- `supabase/migrations/024_hevy.sql` (new)

### Open questions
- None. Spec is complete. Mira implements exactly as written below.

---

## Migration spec: 024_hevy.sql

File: `supabase/migrations/024_hevy.sql`

All tables: idempotent (`CREATE TABLE IF NOT EXISTS`), RLS enabled, owner policy via `DO $$ IF NOT EXISTS` guard.
All user-owned tables: `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`.
All tables: `created_at timestamptz NOT NULL DEFAULT now()`.
Enum-like columns: `CHECK` constraints only — no `CREATE TYPE`.
Hevy-native string IDs: `text PRIMARY KEY`.
Hevy routine_folder ids (integers): `bigint PRIMARY KEY`.

---

### Table 1: hevy_exercise_templates

Purpose: Cache of Hevy's global exercise library (shared across all users; user_id still present for per-user custom exercises).

Columns:
- `id`                      text         PRIMARY KEY                          — Hevy's own UUID string
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `title`                   text         NOT NULL
- `type`                    text         NOT NULL CHECK (type IN ('weight_reps','bodyweight_reps','weighted_bodyweight','assisted_bodyweight','duration','distance_duration','weight_distance'))
- `primary_muscle_group`    text         NULL
- `is_custom`               boolean      NOT NULL DEFAULT false
- `created_at`              timestamptz  NOT NULL DEFAULT now()
- `synced_at`               timestamptz  NOT NULL DEFAULT now()             — last time this row was refreshed from Hevy

Secondary muscle groups note: stored in a separate child table `hevy_exercise_template_muscles` (see Table 1a below) rather than as an array column, to allow indexed lookups by muscle group.

Indexes:
- `(user_id)`
- `(user_id, primary_muscle_group)`

RLS policy (name: 'Users manage own hevy exercise templates'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 1a: hevy_exercise_template_muscles

Purpose: Secondary muscle groups for an exercise template (one row per muscle per template).

Columns:
- `id`                      uuid         PRIMARY KEY DEFAULT gen_random_uuid()
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `exercise_template_id`    text         NOT NULL REFERENCES hevy_exercise_templates(id) ON DELETE CASCADE
- `muscle_group`            text         NOT NULL
- `created_at`              timestamptz  NOT NULL DEFAULT now()

Indexes:
- `(exercise_template_id)`
- `(user_id, muscle_group)`

RLS policy (name: 'Users manage own hevy template muscles'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 2: hevy_workout_events_cursor

Purpose: One row per user, persists the `since` ISO 8601 cursor for incremental sync via GET /v1/workouts/events.

Columns:
- `user_id`                 uuid         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE   — one row per user; user_id IS the PK
- `last_events_since`       timestamptz  NULL                                                       — NULL = full sync not yet done; set to the `updated_at` of the latest event after each sync
- `created_at`              timestamptz  NOT NULL DEFAULT now()
- `updated_at`              timestamptz  NOT NULL DEFAULT now()

No additional indexes (PK lookup only).

RLS policy (name: 'Users manage own hevy events cursor'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 3: hevy_workouts

Purpose: Completed workout sessions synced from Hevy.

Columns:
- `id`                      text         PRIMARY KEY                          — Hevy's own UUID string
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `title`                   text         NOT NULL
- `routine_id`              text         NULL                                 — Hevy routine UUID; not a FK (routine may not be synced yet)
- `description`             text         NULL
- `start_time`              timestamptz  NULL
- `end_time`                timestamptz  NULL
- `hevy_updated_at`         timestamptz  NOT NULL                             — `updated_at` from Hevy payload
- `hevy_created_at`         timestamptz  NOT NULL                             — `created_at` from Hevy payload
- `created_at`              timestamptz  NOT NULL DEFAULT now()
- `synced_at`               timestamptz  NOT NULL DEFAULT now()

Indexes:
- `(user_id, start_time DESC)`
- `(user_id, hevy_created_at DESC)`

RLS policy (name: 'Users manage own hevy workouts'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 4: hevy_workout_exercises

Purpose: Exercises performed within a completed workout (child of hevy_workouts).

Columns:
- `id`                      uuid         PRIMARY KEY DEFAULT gen_random_uuid()
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `hevy_workout_id`         text         NOT NULL REFERENCES hevy_workouts(id) ON DELETE CASCADE
- `exercise_template_id`    text         NOT NULL                             — Hevy template UUID; not a FK (template may not be cached yet)
- `index`                   integer      NOT NULL                             — ordering within the workout
- `title`                   text         NOT NULL                             — denormalised from Hevy for display without a join
- `notes`                   text         NULL
- `supersets_id`            integer      NULL                                 — Hevy superset grouping identifier
- `created_at`              timestamptz  NOT NULL DEFAULT now()

Unique constraint: `(hevy_workout_id, index)` — index is unique within a workout.

Indexes:
- `(hevy_workout_id)`
- `(exercise_template_id)`
- `(user_id, exercise_template_id)`

RLS policy (name: 'Users manage own hevy workout exercises'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 5: hevy_sets

Purpose: Individual sets within a workout exercise (child of hevy_workout_exercises).

Columns:
- `id`                      uuid         PRIMARY KEY DEFAULT gen_random_uuid()
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `hevy_exercise_id`        uuid         NOT NULL REFERENCES hevy_workout_exercises(id) ON DELETE CASCADE
- `exercise_template_id`    text         NOT NULL                             — denormalised for PR queries without multi-level join
- `index`                   integer      NOT NULL                             — ordering within the exercise
- `type`                    text         NOT NULL CHECK (type IN ('normal','warmup','dropset','failure'))
- `weight_kg`               numeric      NULL
- `reps`                    integer      NULL
- `distance_meters`         numeric      NULL
- `duration_seconds`        integer      NULL
- `rpe`                     numeric      NULL
- `custom_metric`           numeric      NULL
- `created_at`              timestamptz  NOT NULL DEFAULT now()

Unique constraint: `(hevy_exercise_id, index)` — index is unique within an exercise.

Indexes:
- `(hevy_exercise_id)`
- `(user_id, exercise_template_id)`

RLS policy (name: 'Users manage own hevy sets'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 6: hevy_routine_folders

Purpose: Routine folder groupings from Hevy (id is an integer, not a UUID).

Columns:
- `id`                      bigint       PRIMARY KEY                          — Hevy uses integer IDs for folders
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `title`                   text         NOT NULL
- `created_at`              timestamptz  NOT NULL DEFAULT now()
- `synced_at`               timestamptz  NOT NULL DEFAULT now()

Indexes:
- `(user_id)`

RLS policy (name: 'Users manage own hevy routine folders'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 7: hevy_routines

Purpose: Workout routine programs synced from Hevy.

Columns:
- `id`                      text         PRIMARY KEY                          — Hevy's own UUID string
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `folder_id`               bigint       NULL REFERENCES hevy_routine_folders(id) ON DELETE SET NULL
- `title`                   text         NOT NULL
- `notes`                   text         NULL
- `hevy_updated_at`         timestamptz  NOT NULL                             — `updated_at` from Hevy payload
- `hevy_created_at`         timestamptz  NOT NULL                             — `created_at` from Hevy payload
- `created_at`              timestamptz  NOT NULL DEFAULT now()
- `synced_at`               timestamptz  NOT NULL DEFAULT now()

Indexes:
- `(user_id)`
- `(user_id, folder_id)`

RLS policy (name: 'Users manage own hevy routines'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 8: hevy_routine_exercises

Purpose: Exercises prescribed within a routine (child of hevy_routines).

Columns:
- `id`                      uuid         PRIMARY KEY DEFAULT gen_random_uuid()
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `hevy_routine_id`         text         NOT NULL REFERENCES hevy_routines(id) ON DELETE CASCADE
- `exercise_template_id`    text         NOT NULL                             — Hevy template UUID; not a FK
- `index`                   integer      NOT NULL                             — ordering within the routine
- `title`                   text         NOT NULL                             — denormalised for display
- `notes`                   text         NULL
- `rest_seconds`            text         NULL                                 — Hevy returns this as a string, not integer; stored as-is
- `supersets_id`            integer      NULL
- `created_at`              timestamptz  NOT NULL DEFAULT now()

Unique constraint: `(hevy_routine_id, index)`.

Indexes:
- `(hevy_routine_id)`
- `(user_id, exercise_template_id)`

RLS policy (name: 'Users manage own hevy routine exercises'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 9: hevy_routine_sets

Purpose: Sets prescribed within a routine exercise (child of hevy_routine_exercises). Includes rep_range split into two columns.

Columns:
- `id`                      uuid         PRIMARY KEY DEFAULT gen_random_uuid()
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `hevy_routine_exercise_id` uuid        NOT NULL REFERENCES hevy_routine_exercises(id) ON DELETE CASCADE
- `index`                   integer      NOT NULL                             — ordering within the routine exercise
- `type`                    text         NOT NULL CHECK (type IN ('normal','warmup','dropset','failure'))
- `weight_kg`               numeric      NULL
- `reps`                    integer      NULL
- `rep_range_start`         integer      NULL                                 — `rep_range.start` from Hevy payload, split out
- `rep_range_end`           integer      NULL                                 — `rep_range.end` from Hevy payload, split out
- `distance_meters`         numeric      NULL
- `duration_seconds`        integer      NULL
- `rpe`                     numeric      NULL
- `custom_metric`           numeric      NULL
- `created_at`              timestamptz  NOT NULL DEFAULT now()

Unique constraint: `(hevy_routine_exercise_id, index)`.

Indexes:
- `(hevy_routine_exercise_id)`

RLS policy (name: 'Users manage own hevy routine sets'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

### Table 10: hevy_body_measurements

Purpose: Body measurements, one row per user per calendar date. Mirrors Hevy's body measurement object exactly.

Columns:
- `id`                      uuid         PRIMARY KEY DEFAULT gen_random_uuid()
- `user_id`                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- `date`                    date         NOT NULL                             — YYYY-MM-DD; unique per user per day
- `weight_kg`               numeric      NULL
- `lean_mass_kg`            numeric      NULL
- `fat_percent`             numeric      NULL
- `neck_cm`                 numeric      NULL
- `shoulder_cm`             numeric      NULL
- `chest_cm`                numeric      NULL
- `left_bicep_cm`           numeric      NULL
- `right_bicep_cm`          numeric      NULL
- `left_forearm_cm`         numeric      NULL
- `right_forearm_cm`        numeric      NULL
- `abdomen_cm`              numeric      NULL
- `waist_cm`                numeric      NULL
- `hips_cm`                 numeric      NULL
- `left_thigh_cm`           numeric      NULL
- `right_thigh_cm`          numeric      NULL
- `left_calf_cm`            numeric      NULL
- `right_calf_cm`           numeric      NULL
- `created_at`              timestamptz  NOT NULL DEFAULT now()
- `updated_at`              timestamptz  NOT NULL DEFAULT now()

Unique constraint: `(user_id, date)` — enforced as `UNIQUE (user_id, date)` on the table.

Indexes:
- `(user_id, date DESC)` — the unique constraint may already cover this; add explicit index anyway for DESC ordering

RLS policy (name: 'Users manage own hevy body measurements'):
  SELECT / INSERT / UPDATE / DELETE where `auth.uid() = user_id`

---

## RLS policy implementation pattern (for all 11 tables)

For each table, Mira must use the idempotent DO block pattern already established in prior migrations (see 025_strava_activities.sql):

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = '<table>'
      AND policyname = '<policy name>'
  ) THEN
    CREATE POLICY "<policy name>"
      ON <table>
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
```

## Creation order (satisfies all FK dependencies)

1. hevy_exercise_templates
2. hevy_exercise_template_muscles  (FK → hevy_exercise_templates)
3. hevy_workout_events_cursor
4. hevy_workouts
5. hevy_workout_exercises           (FK → hevy_workouts)
6. hevy_sets                        (FK → hevy_workout_exercises)
7. hevy_routine_folders
8. hevy_routines                    (FK → hevy_routine_folders)
9. hevy_routine_exercises           (FK → hevy_routines)
10. hevy_routine_sets               (FK → hevy_routine_exercises)
11. hevy_body_measurements

## Tasks

| # | Task | Agent | Can parallel? |
|---|---|---|---|
| 1 | Write supabase/migrations/024_hevy.sql exactly per this spec | mira | No — only task |
