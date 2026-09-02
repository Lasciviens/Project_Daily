-- ============================================================
-- 084 — current_program_routines + athlete_muscle_preferences + exercise_target_overrides
-- ============================================================
-- Three small tables backing the Training -> Progress decision-engine
-- redesign (docs/progress-redesign/PLAN.md — delete that file once this
-- feature ships and CLAUDE.md is updated with the final architecture).
--
-- WHY current_program_routines EXISTS (explicit, never inferred):
--   The Progress feature has never had a concept of "the current program" —
--   fetchTrainingHistory pulls every workout in a rolling 6-month window with
--   zero reference to routine_id, so a long-abandoned exercise sits on equal
--   footing with what the athlete actually trains today. A recency-window
--   heuristic ("routine_id seen in the last 21-28 days") was drafted and
--   REJECTED on the user's explicit instruction: a vacation, a skipped week,
--   or an old routine trained once by coincidence all break a pure recency
--   guess, and a multi-routine split (Upper + Lower as two separate
--   hevy_routines rows) needs to hold more than one id at once — a single
--   `active_routine_id` column on a profile table isn't enough. This table
--   is the explicit alternative: literally the set of routine_ids the user
--   has confirmed are part of their current program. A recency heuristic
--   still gets ONE legitimate job — pre-checking a sensible default the
--   first time a user opens the picker (this table empty) — but the
--   decision engine itself never runs on inference alone; it reads this
--   table, and only this table, for "is this exercise in-program".
--   `routine_id` has no FK (matches hevy_routine_exercises.exercise_template_id's
--   own no-FK convention for the same reason: hevy_routines is a synced
--   mirror of external Hevy data, not a table we own referential integrity
--   over end-to-end the way our own tables are).
--
-- WHY athlete_muscle_preferences IS NOT athlete_muscle_priorities
-- (priority | deprioritized):
--   An earlier draft used a binary priority/deprioritized state. The user's
--   explicit correction: "no direct ab training" is NOT the same claim as
--   "abs is deprioritized" — a deprioritized-sounding label implies the
--   muscle matters less, when the real intent is narrower: don't nag about
--   missing DIRECT ab work, while every indirect/secondary set abs still
--   earns from other exercises keeps counting normally. So the two real
--   states are `priority` (elevated urgency below MEV) and `exclude_direct`
--   (suppresses only the "no direct work for this muscle" warning — never
--   zeroes or discounts credited sets). A muscle with no row here is normal,
--   the unmarked default; there is no third stored state.
--   This table needs a real settings UI (visible/editable/deletable),
--   mirroring athlete_limitations' own precedent exactly — see
--   MusclePreferencesSheet.tsx (added in the same body of work).
--
-- WHY exercise_target_overrides EXISTS (separate from Hevy's own routine
-- data, which this app never writes to directly):
--   The expectation/target-source order for a load-increase recommendation
--   is, in priority order: (1) the current program's own recorded
--   hevy_routine_sets.rep_range_start/end, (2) the athlete's own EXPLICIT
--   override for that exercise, (3) a generic exercise-type default,
--   ALWAYS labeled as such, (4) "Target not configured" as a real, visible
--   state rather than a silent guess. Rung 2 needs somewhere to live that
--   isn't Hevy's synced routine tables (this app's own established rule:
--   Hevy stays the source of truth for routine data, never written to
--   directly except via the hevy-api proxy) — hence this small, purely
--   app-owned table. Historical observed reps are DELIBERATELY not a rung
--   in this order at all: an earlier draft used "the athlete's own last
--   4-6 sessions' observed range" as rung 2, which the user's own review
--   caught as a self-reinforcing-loop risk (a chronic 5-7-rep performer
--   would have that treated as "the range" and get told to add weight at
--   rep 7). Historical reps still drive the TREND (is this exercise
--   actually progressing) — they just never define what counts as success.

CREATE TABLE IF NOT EXISTS public.current_program_routines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_id   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, routine_id)
);

CREATE TABLE IF NOT EXISTS public.athlete_muscle_preferences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  muscle_slug  text NOT NULL,
  preference   text NOT NULL CHECK (preference IN ('priority', 'exclude_direct')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, muscle_slug)
);

CREATE TABLE IF NOT EXISTS public.exercise_target_overrides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_template_id  text NOT NULL REFERENCES public.hevy_exercise_templates(id) ON DELETE CASCADE,
  rep_range_start       integer NOT NULL,
  rep_range_end         integer NOT NULL CHECK (rep_range_end >= rep_range_start),
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_template_id)
);

ALTER TABLE public.current_program_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_muscle_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_target_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'current_program_routines'
      AND policyname = 'Users manage own current program routines'
  ) THEN
    CREATE POLICY "Users manage own current program routines"
      ON public.current_program_routines
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'athlete_muscle_preferences'
      AND policyname = 'Users manage own athlete muscle preferences'
  ) THEN
    CREATE POLICY "Users manage own athlete muscle preferences"
      ON public.athlete_muscle_preferences
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'exercise_target_overrides'
      AND policyname = 'Users manage own exercise target overrides'
  ) THEN
    CREATE POLICY "Users manage own exercise target overrides"
      ON public.exercise_target_overrides
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS current_program_routines_user_idx
  ON public.current_program_routines (user_id);
CREATE INDEX IF NOT EXISTS athlete_muscle_preferences_user_idx
  ON public.athlete_muscle_preferences (user_id);
CREATE INDEX IF NOT EXISTS exercise_target_overrides_user_idx
  ON public.exercise_target_overrides (user_id);

DROP TRIGGER IF EXISTS trg_audit ON public.current_program_routines;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.current_program_routines
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS trg_audit ON public.athlete_muscle_preferences;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.athlete_muscle_preferences
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS trg_audit ON public.exercise_target_overrides;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exercise_target_overrides
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- update_updated_at() is defined in 002_media.sql and reused corpus-wide.
-- current_program_routines has no updated_at — a row is added or removed,
-- never patched in place (matching the semantics of "is this routine part
-- of the current program", a boolean-by-presence fact, not a mutable one).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_athlete_muscle_preferences_updated_at') THEN
    CREATE TRIGGER trg_athlete_muscle_preferences_updated_at
      BEFORE UPDATE ON public.athlete_muscle_preferences
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exercise_target_overrides_updated_at') THEN
    CREATE TRIGGER trg_exercise_target_overrides_updated_at
      BEFORE UPDATE ON public.exercise_target_overrides
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
