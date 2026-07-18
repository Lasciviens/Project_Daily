-- ============================================================
-- 053 — Food overhaul: food_log diary + library/plan upgrades
-- ============================================================
-- Designed with a dietitian + sports-science + UX expert panel. Core user
-- flow being enabled: "add basic ingredients + their nutrition once, then
-- pick ingredients to build a meal — X g of this, Y g of that". User
-- decision: NEW food_log diary table AND make the existing plan table fit.
--
-- Key findings this implements:
--  * recipe_meal_plans had UNIQUE (user_id, date, meal_slot) — physically
--    only ONE row per meal slot per day, so "lunch = chicken + rice +
--    broccoli" (multiple items in one slot) was IMPOSSIBLE. Dropped.
--  * A diary is not a plan: food_log_entries stores what was ACTUALLY eaten,
--    with macros SNAPSHOTTED at log time — editing/deleting a library
--    ingredient later must never rewrite dietary history.
--  * fiber_g was missing everywhere (panel: worth a soft floor on a cut).
--  * Portion presets ("1 scoop = 30g") remove the weigh-everything tax.
--  * 'supplement' added as a meal slot (whey/creatine are daily items).

-- ── 1. Ingredient library upgrades ──────────────────────────
ALTER TABLE public.recipe_ingredient_library
  ADD COLUMN IF NOT EXISTS fiber_g       numeric,           -- per 100g, like the other macros
  ADD COLUMN IF NOT EXISTS serving_label text,              -- e.g. '1 scoop', '1 egg'
  ADD COLUMN IF NOT EXISTS serving_grams numeric CHECK (serving_grams IS NULL OR serving_grams > 0);

-- ── 2. Recipe categories ────────────────────────────────────
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS category text
  CHECK (category IS NULL OR category IN ('breakfast', 'lunch', 'dinner', 'snack', 'supplement'));

-- ── 3. Meal-plan table made fit (kept as the PLAN) ──────────
-- Multiple items per slot are now allowed; upserts key on id instead.
DROP INDEX IF EXISTS idx_recipe_meal_plans_slot_unique;
CREATE INDEX IF NOT EXISTS idx_recipe_meal_plans_day
  ON public.recipe_meal_plans (user_id, date, meal_slot);

-- Allow 'supplement' as a slot (constraint name from 032: check via pg_catalog
-- because the auto-generated name can differ across environments).
DO $$
DECLARE con text;
BEGIN
  SELECT conname INTO con
  FROM pg_constraint
  WHERE conrelid = 'public.recipe_meal_plans'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%meal_slot%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.recipe_meal_plans DROP CONSTRAINT %I', con);
  END IF;
  ALTER TABLE public.recipe_meal_plans
    ADD CONSTRAINT recipe_meal_plans_meal_slot_check
    CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner', 'snack', 'supplement'));
END $$;

-- ── 4. The FOOD LOG diary (what was actually eaten) ─────────
CREATE TABLE IF NOT EXISTS public.food_log_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  date                  date NOT NULL,
  meal_slot             text NOT NULL CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner', 'snack', 'supplement')),
  -- What was eaten: a library ingredient, a saved recipe/meal, or free text.
  library_ingredient_id uuid REFERENCES public.recipe_ingredient_library(id) ON DELETE SET NULL,
  recipe_id             uuid REFERENCES public.recipes(id) ON DELETE SET NULL,
  custom_title          text,
  quantity              numeric,  -- grams/ml for ingredients; servings for recipes
  unit                  text,     -- 'g' | 'ml' | 'serving' | serving_label used
  -- Macro SNAPSHOT resolved at log time — history never rewrites.
  calories              numeric,
  protein_g             numeric,
  carbs_g               numeric,
  fat_g                 numeric,
  fiber_g               numeric,
  sugar_g               numeric,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (library_ingredient_id IS NOT NULL OR recipe_id IS NOT NULL OR custom_title IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_food_log_entries_day ON public.food_log_entries (user_id, date);

ALTER TABLE public.food_log_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'food_log_entries' AND policyname = 'Users manage own food_log_entries'
  ) THEN
    CREATE POLICY "Users manage own food_log_entries" ON public.food_log_entries
      FOR ALL USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

-- Audit trail (same trigger as other user-authored tables — see 037/052).
DROP TRIGGER IF EXISTS trg_audit ON public.food_log_entries;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.food_log_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
