-- ============================================================
-- 070 — athlete_profile + athlete_limitations
-- ============================================================
-- A durable "who is this athlete" record so the AI PT Coach
-- (PTCoachTab.tsx / ptCoachApi.ts) and the Muscles volume-coloring feature
-- (WorkedMuscles.tsx / muscleMap.ts) can consult stable facts about the user
-- instead of re-deriving/re-asking every run. Distinct from `pt_assessments`
-- (migration 051), which is a per-day snapshot+reply LOG — this is the
-- standing profile that log format never captured.
--
-- WHY TWO TABLES, NOT ONE `text[]`/jsonb COLUMN ON A SINGLETON PROFILE ROW:
--   This repo's real convention for a one-to-many attribute list is a child
--   table, not an array column on the parent — see `recipe_ingredients`
--   (031_recipes.sql:23-32, `recipe_id` FK into `recipes`) and
--   `hevy_exercise_template_muscles` (024_hevy.sql:48-54, `exercise_template_id`
--   FK into `hevy_exercise_templates`). A limitation needs its own identity
--   (`id`) so it can be individually resolved/edited/toggled inactive without
--   rewriting a blob, needs `created_at`/`updated_at` of its own (when was
--   THIS one flagged, when did it last change), and a per-row CHECK
--   (`severity`) that an array element cannot carry. `athlete_profile` itself
--   stays a true singleton (`user_id` is the primary key, one row per user —
--   like `strava_tokens`/`user_calendar_tokens`), because every column on it
--   (goal, experience_level, training_days_per_week, ...) really is 1:1 with
--   the user; only the limitations list is 1:many.
--
-- WHY `movement_pattern`, NOT A MUSCLE SLUG:
--   The Muscles feature already has a muscle vocabulary (`muscleMap.ts`'s
--   `HEVY_TO_SLUG`), but a physical limitation is almost never muscle-shaped —
--   it is a MOVEMENT that hurts. A shoulder issue rules out overhead pressing;
--   flat press and flyes are frequently still safe despite training the same
--   chest muscle. Flagging at the muscle level would suppress a still-safe
--   stimulus (e.g. blanking all "chest" work over an overhead-only limitation)
--   and lets a real gap through the other way (a movement-only view misses
--   nothing the muscle level would have caught, since the coach reasons about
--   an exercise's pattern, not just its target muscle). `movement_pattern` is
--   left as free text (not a CHECK-enum) so the coach can name it the way a
--   real conversation would ("overhead press", "deep knee flexion", "loaded
--   spinal flexion") without a migration per new phrasing — the same reasoning
--   069_wish_items.sql gave for rejecting a season CHECK enum in favour of
--   concrete dates: a fixed value list forces a redeploy of `ai-proxy`'s
--   DB_CATALOG (whose columns string duplicates every CHECK's values) for
--   every new pattern a real conversation surfaces.
--
-- WHY `severity` DEFAULTS TO 'monitor', NOT 'avoid'/'limit':
--   Whether a flagged movement should be avoided outright, merely limited in
--   load/range, or just watched is a live coaching judgment call — it depends
--   on how the injury is progressing, not a fact that is true the instant it
--   is logged. Defaulting to the loosest, most reversible severity means
--   simply recording "this exists" never silently blocks a whole movement
--   pattern before a human (or the coach, deliberately) has actually decided
--   that it should. Escalating to 'avoid'/'limit' is always an explicit,
--   separate update.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW.

CREATE TABLE IF NOT EXISTS public.athlete_profile (
  user_id                 uuid PRIMARY KEY NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  goal                    text CHECK (goal IN ('strength', 'hypertrophy', 'fat_loss', 'general')),
  experience_level        text CHECK (experience_level IN ('novice', 'intermediate', 'advanced')),
  training_age_years      numeric,
  training_days_per_week  smallint,
  equipment_access        text CHECK (equipment_access IN ('home', 'gym', 'both')),
  notes                   text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.athlete_limitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  movement_pattern text NOT NULL,
  severity         text NOT NULL DEFAULT 'monitor' CHECK (severity IN ('avoid', 'limit', 'monitor')),
  note             text,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.athlete_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_limitations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'athlete_profile'
      AND policyname = 'Users manage own athlete profile'
  ) THEN
    CREATE POLICY "Users manage own athlete profile"
      ON public.athlete_profile
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'athlete_limitations'
      AND policyname = 'Users manage own athlete limitations'
  ) THEN
    CREATE POLICY "Users manage own athlete limitations"
      ON public.athlete_limitations
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- Queries filter `active = true` to know what is currently in effect.
CREATE INDEX IF NOT EXISTS athlete_limitations_user_active_idx
  ON public.athlete_limitations (user_id, active);

-- Audit trigger — both tables are user-authored settings-like data (AGENTS.md
-- rule 9); attaching it in the same migration that creates the table is what
-- 052 exists to retroactively fix for `dev_requests`, which was missed because
-- 037 only covered the tables that already existed at the time.
DROP TRIGGER IF EXISTS trg_audit ON public.athlete_profile;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.athlete_profile
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS trg_audit ON public.athlete_limitations;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.athlete_limitations
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- update_updated_at() is defined in 002_media.sql and reused corpus-wide.
-- Both tables carry updated_at: athlete_profile changes whenever the coach
-- conversation updates a goal/level/etc, and athlete_limitations' `active`
-- flag gets toggled in place (e.g. "this limitation resolved") without a
-- new row, so its own updated_at needs to move too.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_athlete_profile_updated_at') THEN
    CREATE TRIGGER trg_athlete_profile_updated_at
      BEFORE UPDATE ON public.athlete_profile
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_athlete_limitations_updated_at') THEN
    CREATE TRIGGER trg_athlete_limitations_updated_at
      BEFORE UPDATE ON public.athlete_limitations
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
