-- ─────────────────────────────────────────────────────────────────────────────
-- 106 — Food macros are DERIVED, never stale (user decision 2026-09-26).
--
-- Before: a recipe's per-serving macros and every eaten diary row's macros were
-- written once (at save / at log time) and never touched again. Editing a
-- saved meal's ingredients, or correcting an ingredient's per-100g values in the
-- library, left recipe totals AND past diary days showing the old numbers —
-- measured on live data: 4 saved meals and 13 eaten entries 15–50 % too low.
--
-- The user's rule: totals are calculated from their ingredients, and any add,
-- edit or delete recalculates them — everywhere, including past days, no matter
-- which writer made the change (the web app, phone-gateway, ai-proxy).
--
-- So the database keeps them correct itself:
--   * recipes (macro_mode = 'from_ingredients'): per-serving macros are
--     recomputed from recipe_ingredients × recipe_ingredient_library whenever an
--     ingredient row, a linked library item, or the recipe's servings change.
--   * food_log_entries (status = 'eaten'): macros are recomputed from the source
--     row — library item (per-100g × grams) or recipe (per serving × servings) —
--     on insert/update, and again whenever that source changes.
--   * custom entries (no library item, no recipe) and manual recipes keep their
--     typed values; planned rows keep NULL macros (computed live on read).
--   * a deleted source (FK SET NULL) leaves the last computed values in place.
-- The columns stay (every reader keeps working unchanged); they are now a
-- maintained cache of the calculation, not a frozen snapshot.
--
-- Rounding matches the client exactly (foodLogApi.ts / recipesApi.ts):
--   ingredient entry  round(per100 × grams) / 100
--   recipe entry      round(perServing × servings, 1)
--   recipe            round(sum / servings, 1)
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.food_is_weight_unit(u text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(coalesce(u, ''))) IN
    ('g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres')
$$;

-- ── Recipes ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_recipe_macros(p_recipe_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_servings numeric;
  t record;
BEGIN
  SELECT greatest(1, coalesce(servings, 1)) INTO v_servings
  FROM public.recipes WHERE id = p_recipe_id AND macro_mode = 'from_ingredients';
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*)                                    AS n,
         sum(coalesce(l.calories,  0) * ri.quantity / 100) AS cal,
         sum(coalesce(l.protein_g, 0) * ri.quantity / 100) AS pro,
         sum(coalesce(l.carbs_g,   0) * ri.quantity / 100) AS carb,
         sum(coalesce(l.fat_g,     0) * ri.quantity / 100) AS fat,
         sum(coalesce(l.fiber_g,   0) * ri.quantity / 100) AS fib,
         sum(coalesce(l.sugar_g,   0) * ri.quantity / 100) AS sug
  INTO t
  FROM public.recipe_ingredients ri
  JOIN public.recipe_ingredient_library l ON l.id = ri.library_ingredient_id
  WHERE ri.recipe_id = p_recipe_id
    AND ri.quantity IS NOT NULL
    AND public.food_is_weight_unit(ri.unit);

  UPDATE public.recipes r SET
    calories  = CASE WHEN t.n > 0 THEN round(t.cal  / v_servings, 1) END,
    protein_g = CASE WHEN t.n > 0 THEN round(t.pro  / v_servings, 1) END,
    carbs_g   = CASE WHEN t.n > 0 THEN round(t.carb / v_servings, 1) END,
    fat_g     = CASE WHEN t.n > 0 THEN round(t.fat  / v_servings, 1) END,
    fiber_g   = CASE WHEN t.n > 0 THEN round(t.fib  / v_servings, 1) END,
    sugar_g   = CASE WHEN t.n > 0 THEN round(t.sug  / v_servings, 1) END
  WHERE r.id = p_recipe_id
    AND (r.calories, r.protein_g, r.carbs_g, r.fat_g, r.fiber_g, r.sugar_g) IS DISTINCT FROM (
      CASE WHEN t.n > 0 THEN round(t.cal  / v_servings, 1) END,
      CASE WHEN t.n > 0 THEN round(t.pro  / v_servings, 1) END,
      CASE WHEN t.n > 0 THEN round(t.carb / v_servings, 1) END,
      CASE WHEN t.n > 0 THEN round(t.fat  / v_servings, 1) END,
      CASE WHEN t.n > 0 THEN round(t.fib  / v_servings, 1) END,
      CASE WHEN t.n > 0 THEN round(t.sug  / v_servings, 1) END);
END $$;

-- An ingredient row was added, changed or removed → its recipe recalculates.
CREATE OR REPLACE FUNCTION public.trg_recipe_ingredients_recompute()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.recompute_recipe_macros(OLD.recipe_id);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.recipe_id IS DISTINCT FROM OLD.recipe_id) THEN
    PERFORM public.recompute_recipe_macros(NEW.recipe_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recipe_ingredients_recompute ON public.recipe_ingredients;
CREATE TRIGGER trg_recipe_ingredients_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.trg_recipe_ingredients_recompute();

-- Servings or mode changed → recalculate (a client-sent total never wins).
CREATE OR REPLACE FUNCTION public.trg_recipes_recompute()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.recompute_recipe_macros(NEW.id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recipes_recompute ON public.recipes;
CREATE TRIGGER trg_recipes_recompute
  AFTER INSERT OR UPDATE OF servings, macro_mode, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g
  ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.trg_recipes_recompute();

-- ── Diary entries ────────────────────────────────────────────────────────────
-- Computes an eaten row's macros from its source, in place (BEFORE trigger).
CREATE OR REPLACE FUNCTION public.trg_food_log_entries_compute()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  l record;
  r record;
BEGIN
  IF coalesce(NEW.status, 'eaten') <> 'eaten' OR NEW.quantity IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.recipe_id IS NOT NULL THEN
    SELECT calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g INTO r
    FROM public.recipes WHERE id = NEW.recipe_id;
    IF FOUND AND r.calories IS NOT NULL THEN
      NEW.calories  := round(r.calories  * NEW.quantity, 1);
      NEW.protein_g := round(r.protein_g * NEW.quantity, 1);
      NEW.carbs_g   := round(r.carbs_g   * NEW.quantity, 1);
      NEW.fat_g     := round(r.fat_g     * NEW.quantity, 1);
      NEW.fiber_g   := round(r.fiber_g   * NEW.quantity, 1);
      NEW.sugar_g   := round(r.sugar_g   * NEW.quantity, 1);
    END IF;
  ELSIF NEW.library_ingredient_id IS NOT NULL AND public.food_is_weight_unit(coalesce(NEW.unit, 'g')) THEN
    SELECT calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g INTO l
    FROM public.recipe_ingredient_library WHERE id = NEW.library_ingredient_id;
    IF FOUND THEN
      NEW.calories  := round(round(l.calories  * NEW.quantity) / 100, 2);
      NEW.protein_g := round(round(l.protein_g * NEW.quantity) / 100, 2);
      NEW.carbs_g   := round(round(l.carbs_g   * NEW.quantity) / 100, 2);
      NEW.fat_g     := round(round(l.fat_g     * NEW.quantity) / 100, 2);
      NEW.fiber_g   := round(round(l.fiber_g   * NEW.quantity) / 100, 2);
      NEW.sugar_g   := round(round(l.sugar_g   * NEW.quantity) / 100, 2);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_food_log_entries_compute ON public.food_log_entries;
CREATE TRIGGER trg_food_log_entries_compute
  BEFORE INSERT OR UPDATE ON public.food_log_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_food_log_entries_compute();

-- A recipe's totals changed → every eaten row of it recalculates.
CREATE OR REPLACE FUNCTION public.trg_recipes_refresh_entries()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.food_log_entries SET quantity = quantity
  WHERE recipe_id = NEW.id AND status = 'eaten';
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recipes_refresh_entries ON public.recipes;
CREATE TRIGGER trg_recipes_refresh_entries
  AFTER UPDATE OF calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g ON public.recipes
  FOR EACH ROW
  WHEN ((OLD.calories, OLD.protein_g, OLD.carbs_g, OLD.fat_g, OLD.fiber_g, OLD.sugar_g)
        IS DISTINCT FROM (NEW.calories, NEW.protein_g, NEW.carbs_g, NEW.fat_g, NEW.fiber_g, NEW.sugar_g))
  EXECUTE FUNCTION public.trg_recipes_refresh_entries();

-- A library item's per-100g values changed → recipes using it and every eaten
-- row of it recalculate.
CREATE OR REPLACE FUNCTION public.trg_library_refresh_dependants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rid uuid;
BEGIN
  FOR rid IN SELECT DISTINCT recipe_id FROM public.recipe_ingredients WHERE library_ingredient_id = NEW.id LOOP
    PERFORM public.recompute_recipe_macros(rid);
  END LOOP;
  UPDATE public.food_log_entries SET quantity = quantity
  WHERE library_ingredient_id = NEW.id AND status = 'eaten';
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_library_refresh_dependants ON public.recipe_ingredient_library;
CREATE TRIGGER trg_library_refresh_dependants
  AFTER UPDATE OF calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g ON public.recipe_ingredient_library
  FOR EACH ROW
  WHEN ((OLD.calories, OLD.protein_g, OLD.carbs_g, OLD.fat_g, OLD.fiber_g, OLD.sugar_g)
        IS DISTINCT FROM (NEW.calories, NEW.protein_g, NEW.carbs_g, NEW.fat_g, NEW.fiber_g, NEW.sugar_g))
  EXECUTE FUNCTION public.trg_library_refresh_dependants();

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- A manual recipe whose every ingredient is library-linked by weight can only
-- have come from the logger's old "Save meal" (links are only editable in
-- from-ingredients mode); it becomes 'from_ingredients'.
UPDATE public.recipes r SET macro_mode = 'from_ingredients'
WHERE r.macro_mode = 'manual'
  AND EXISTS (SELECT 1 FROM public.recipe_ingredients ri WHERE ri.recipe_id = r.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = r.id
      AND (ri.library_ingredient_id IS NULL OR ri.quantity IS NULL OR NOT public.food_is_weight_unit(ri.unit)));

SELECT public.recompute_recipe_macros(id) FROM public.recipes WHERE macro_mode = 'from_ingredients';

UPDATE public.food_log_entries SET quantity = quantity
WHERE status = 'eaten' AND (recipe_id IS NOT NULL OR library_ingredient_id IS NOT NULL);
