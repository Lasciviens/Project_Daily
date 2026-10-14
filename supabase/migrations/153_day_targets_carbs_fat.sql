-- ============================================================
-- 153 — day_targets: the owner's own carb and fat goals
-- ============================================================
-- The owner (14.10.2026), on Food → Today's "What's left": "Add goals for
-- them as well". Until now the goal held calories and protein only, and
-- carbs and fat were always worked out from them (fat 30 % of the calories
-- or the cut's fat floor, carbs the rest — health/goal/cutDecision.ts).
--
-- Two nullable gram goals on the goal row (086) and on each phase's saved
-- targets (088), so cut, maintain and gain each keep their own like they do
-- for calories, protein and water. NULL means "work it out for me": the
-- derivation stays the fallback, and every existing row reads exactly as
-- before. The app keeps the phase's row in day_target_profiles in step with
-- every save itself (dayTargetsApi.upsertDayTargets) — there is no trigger or
-- function copying between the two tables, so nothing else changes here.
--
-- The CHECK is a typo guard (0–1000 g a day), not a nutrition limit.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW.

ALTER TABLE public.day_targets
  ADD COLUMN IF NOT EXISTS carbs_g integer,
  ADD COLUMN IF NOT EXISTS fat_g   integer;

ALTER TABLE public.day_target_profiles
  ADD COLUMN IF NOT EXISTS carbs_g integer,
  ADD COLUMN IF NOT EXISTS fat_g   integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'day_targets_carbs_range') THEN
    ALTER TABLE public.day_targets
      ADD CONSTRAINT day_targets_carbs_range CHECK (carbs_g BETWEEN 0 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'day_targets_fat_range') THEN
    ALTER TABLE public.day_targets
      ADD CONSTRAINT day_targets_fat_range CHECK (fat_g BETWEEN 0 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'day_target_profiles_carbs_range') THEN
    ALTER TABLE public.day_target_profiles
      ADD CONSTRAINT day_target_profiles_carbs_range CHECK (carbs_g BETWEEN 0 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'day_target_profiles_fat_range') THEN
    ALTER TABLE public.day_target_profiles
      ADD CONSTRAINT day_target_profiles_fat_range CHECK (fat_g BETWEEN 0 AND 1000);
  END IF;
END $$;

COMMENT ON COLUMN public.day_targets.carbs_g IS
  'Daily carb goal in grams, set by the owner. NULL = worked out from calories and protein (the rest after protein and fat).';
COMMENT ON COLUMN public.day_targets.fat_g IS
  'Daily fat goal in grams, set by the owner. NULL = worked out (30 % of the calories, never under the cut''s fat floor).';
COMMENT ON COLUMN public.day_target_profiles.carbs_g IS
  'This phase''s saved carb goal in grams; NULL = worked out. Copied from day_targets on every save.';
COMMENT ON COLUMN public.day_target_profiles.fat_g IS
  'This phase''s saved fat goal in grams; NULL = worked out. Copied from day_targets on every save.';
