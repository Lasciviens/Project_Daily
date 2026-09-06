-- ============================================================
-- 086 — day_targets
-- ============================================================
-- Daily nutrition goals (calories/protein/water + Cut/Maintain/Gain) used to
-- live ONLY in localStorage (`useDayTargets.ts`, key 'lasci.dayTargets') —
-- fine for a single browser, but the same targets are read from
-- NutritionCard, FoodTodayTab, WaterTracker and useNutritionCoach, and a
-- second device (or a cleared browser) silently reset them to the hardcoded
-- defaults with no way to recover the real numbers. A singleton DB row fixes
-- that the same way `athlete_profile` (migration 070) does for training
-- goals — one row per user, updated in place, never a log.
--
-- WHY A SEPARATE TABLE, NOT A COLUMN ON `athlete_profile`:
--   athlete_profile.goal is a TRAINING goal (strength/hypertrophy/fat_loss/
--   general) — a different concept from a nutrition phase (cut/maintain/
--   gain); conflating them would mean "cut" has to mean something for a
--   'strength' athlete_profile.goal too, which it doesn't. Nutrition targets
--   also change on a different cadence (recalculated from bodyweight trend
--   via useNutritionCoach's adaptive-calorie nudge) than a training profile.
--
-- `last_calorie_adjust` mirrors the same field's role in the old localStorage
-- shape: a date string gating the adaptive-calorie nudge's 14-day cooldown
-- (useNutritionCoach.ts) — kept here so the cooldown survives across devices
-- too, not just the target numbers themselves.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW.

CREATE TABLE IF NOT EXISTS public.day_targets (
  user_id             uuid PRIMARY KEY NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  calories            integer NOT NULL DEFAULT 2200,
  protein_g           integer NOT NULL DEFAULT 150,
  water_ml            integer NOT NULL DEFAULT 2000,
  goal                text NOT NULL DEFAULT 'maintain' CHECK (goal IN ('cut', 'maintain', 'gain')),
  last_calorie_adjust date,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.day_targets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'day_targets'
      AND policyname = 'Users manage own day targets'
  ) THEN
    CREATE POLICY "Users manage own day targets"
      ON public.day_targets
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- User-authored settings-like data (AGENTS.md rule 9) — audit trigger
-- attached in the same migration that creates the table.
DROP TRIGGER IF EXISTS trg_audit ON public.day_targets;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.day_targets
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- update_updated_at() is defined in 002_media.sql and reused corpus-wide.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_day_targets_updated_at') THEN
    CREATE TRIGGER trg_day_targets_updated_at
      BEFORE UPDATE ON public.day_targets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
