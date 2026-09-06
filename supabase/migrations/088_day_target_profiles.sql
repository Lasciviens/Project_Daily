-- ============================================================
-- 088 — day_target_profiles
-- ============================================================
-- day_targets (migration 086) is a single ACTIVE row — calories/protein/
-- water for whichever goal is currently selected. Switching the goal pill
-- (Cut/Maintain/Gain) only relabelled that one shared set of numbers; it
-- never recalled what you'd actually set for that phase before, so going
-- Cut → Maintain → Cut lost your Cut numbers. This table adds one row PER
-- GOAL so each phase keeps its own saved calories/protein/water — switching
-- goals recalls the last-saved numbers for that goal instead of carrying
-- over whatever the previous goal happened to have.
--
-- `day_targets` itself is UNCHANGED and stays the single source of truth
-- every other surface (rings, useNutritionCoach, WaterTracker) reads —
-- this table is purely the per-goal memory the Goals editor consults when
-- you switch pills, and every write to day_targets keeps the matching row
-- here in sync (see dayTargetsApi.ts's upsertDayTargets).
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW.

CREATE TABLE IF NOT EXISTS public.day_target_profiles (
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  goal       text NOT NULL CHECK (goal IN ('cut', 'maintain', 'gain')),
  calories   integer NOT NULL,
  protein_g  integer NOT NULL,
  water_ml   integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, goal)
);

ALTER TABLE public.day_target_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'day_target_profiles'
      AND policyname = 'Users manage own day target profiles'
  ) THEN
    CREATE POLICY "Users manage own day target profiles"
      ON public.day_target_profiles
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- User-authored settings-like data (AGENTS.md rule 9).
DROP TRIGGER IF EXISTS trg_audit ON public.day_target_profiles;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.day_target_profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- update_updated_at() is defined in 002_media.sql and reused corpus-wide.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_day_target_profiles_updated_at') THEN
    CREATE TRIGGER trg_day_target_profiles_updated_at
      BEFORE UPDATE ON public.day_target_profiles
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
