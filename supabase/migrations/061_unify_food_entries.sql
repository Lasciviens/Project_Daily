-- FOOD ROUND 5 — collapse the plan/diary split into ONE table.
--
-- Before: two near-identical tables modelled "food on a day":
--   recipe_meal_plans  = the PLAN (intent, no macro snapshot)
--   food_log_entries   = the DIARY (eaten, macros snapshotted at log time)
-- That split was the root of "Today'e girdim ama meal plan dolmuyor" and a
-- write/read split-brain. They collapse into `food_log_entries` with a
-- `status` discriminator: 'planned' (intent, macros computed live on read) vs
-- 'eaten' (a real snapshot). Planning → eating is now a status flip.
--
-- Lossless: every recipe_meal_plans row is migrated in as a 'planned' row
-- (its plan columns mapped onto the diary's quantity/unit) BEFORE the table is
-- dropped. The dead `recipe_ingredient_portions` (never written by the app,
-- empty in prod) is dropped too. Idempotent — safe to re-run.

-- 1. Discriminator. Default 'eaten' so every existing diary row stays eaten.
ALTER TABLE public.food_log_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'eaten';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'food_log_entries_status_chk') THEN
    ALTER TABLE public.food_log_entries
      ADD CONSTRAINT food_log_entries_status_chk CHECK (status IN ('planned', 'eaten'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_food_log_entries_user_status_date
  ON public.food_log_entries (user_id, status, date);

-- 2. Backfill the plan into the diary as 'planned' rows, then drop it. Wrapped
--    in an existence guard so a re-run is a clean no-op (never double-inserts).
--    Planned rows keep macros NULL (computed live on read, as the plan always
--    was); the plan's amount maps onto quantity/unit (recipe → servings·
--    'serving'; library → ingredient_quantity·ingredient_unit; custom → none).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'recipe_meal_plans') THEN
    INSERT INTO public.food_log_entries
      (user_id, date, meal_slot, status, recipe_id, library_ingredient_id, custom_title, quantity, unit, created_at)
    SELECT
      p.user_id, p.date, p.meal_slot, 'planned',
      p.recipe_id, p.library_ingredient_id, p.custom_title,
      CASE WHEN p.recipe_id IS NOT NULL             THEN COALESCE(p.servings, 1)
           WHEN p.library_ingredient_id IS NOT NULL THEN p.ingredient_quantity
           ELSE NULL END,
      CASE WHEN p.recipe_id IS NOT NULL             THEN 'serving'
           WHEN p.library_ingredient_id IS NOT NULL THEN COALESCE(p.ingredient_unit, 'g')
           ELSE NULL END,
      p.created_at
    FROM public.recipe_meal_plans p;

    DROP TABLE public.recipe_meal_plans;
  END IF;
END $$;

-- 3. Drop the dead portions table (never written by the app).
DROP TABLE IF EXISTS public.recipe_ingredient_portions;
