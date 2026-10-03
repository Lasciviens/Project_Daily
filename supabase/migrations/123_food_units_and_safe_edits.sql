-- ─────────────────────────────────────────────────────────────────────────────
-- 123 — Food: kg/l units count, recipe edits are atomic, deleting a library
-- food no longer rewrites past days.
--
-- 1. Recipe ingredients in kg, l, dl, cl or "gr" were skipped by the macro
--    calculation (only g/ml counted), so "1 kg chicken" added nothing.
--    public.food_unit_grams() gives grams per unit; recompute_recipe_macros()
--    now multiplies by it. Mirrored by src/features/recipes/foodUnits.ts —
--    change both together. Diary rows keep food_is_weight_unit() (g/ml).
-- 2. Saving a recipe deleted its ingredient rows and then inserted the new
--    ones in a second request; a failed insert left the recipe empty (and,
--    with 106, its totals NULL on every past day it was eaten).
--    public.replace_recipe_ingredients() does both in one transaction.
-- 3. Deleting a library food set recipe_ingredients.library_ingredient_id to
--    NULL, 106 recalculated every recipe without it, and every past day those
--    recipes were eaten dropped (olive oil ≈ −120 kcal a portion). Now the
--    recipes that use it switch to manual first, keeping the totals they have
--    — the same rule 106 applies to a deleted diary source.
-- Updates only from_ingredients recipes whose totals change because of (1).
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.food_unit_grams(u text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(coalesce(u, '')))
    WHEN 'g' THEN 1 WHEN 'gr' THEN 1 WHEN 'gram' THEN 1 WHEN 'grams' THEN 1 WHEN 'gramm' THEN 1
    WHEN 'kg' THEN 1000 WHEN 'kilo' THEN 1000 WHEN 'kilogram' THEN 1000 WHEN 'kilograms' THEN 1000
    WHEN 'ml' THEN 1 WHEN 'milliliter' THEN 1 WHEN 'milliliters' THEN 1 WHEN 'millilitre' THEN 1 WHEN 'millilitres' THEN 1
    WHEN 'cl' THEN 10 WHEN 'dl' THEN 100
    WHEN 'l' THEN 1000 WHEN 'liter' THEN 1000 WHEN 'liters' THEN 1000 WHEN 'litre' THEN 1000 WHEN 'litres' THEN 1000
  END
$$;

-- ── 1. Recipe totals count every weight unit ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_recipe_macros(p_recipe_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_servings numeric;
  t record;
BEGIN
  SELECT greatest(1, coalesce(servings, 1)) INTO v_servings
  FROM public.recipes WHERE id = p_recipe_id AND macro_mode = 'from_ingredients';
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*)                                                                   AS n,
         sum(coalesce(l.calories,  0) * ri.quantity * public.food_unit_grams(ri.unit) / 100) AS cal,
         sum(coalesce(l.protein_g, 0) * ri.quantity * public.food_unit_grams(ri.unit) / 100) AS pro,
         sum(coalesce(l.carbs_g,   0) * ri.quantity * public.food_unit_grams(ri.unit) / 100) AS carb,
         sum(coalesce(l.fat_g,     0) * ri.quantity * public.food_unit_grams(ri.unit) / 100) AS fat,
         sum(coalesce(l.fiber_g,   0) * ri.quantity * public.food_unit_grams(ri.unit) / 100) AS fib,
         sum(coalesce(l.sugar_g,   0) * ri.quantity * public.food_unit_grams(ri.unit) / 100) AS sug
  INTO t
  FROM public.recipe_ingredients ri
  JOIN public.recipe_ingredient_library l ON l.id = ri.library_ingredient_id
  WHERE ri.recipe_id = p_recipe_id
    AND ri.quantity IS NOT NULL
    AND public.food_unit_grams(ri.unit) IS NOT NULL;

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

-- ── 2. Replace a recipe's ingredients in one transaction ──────────────────────
-- SECURITY INVOKER: RLS on recipe_ingredients applies; the caller can only
-- touch their own recipe. p_rows: [{name, quantity, unit, note, library_ingredient_id}].
CREATE OR REPLACE FUNCTION public.replace_recipe_ingredients(p_recipe_id uuid, p_rows jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.recipes WHERE id = p_recipe_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found'; END IF;

  DELETE FROM public.recipe_ingredients WHERE recipe_id = p_recipe_id;

  INSERT INTO public.recipe_ingredients (user_id, recipe_id, name, quantity, unit, note, sort_order, library_ingredient_id)
  SELECT v_user, p_recipe_id, btrim(e.v->>'name'), (e.v->>'quantity')::numeric,
         nullif(btrim(coalesce(e.v->>'unit', '')), ''), nullif(btrim(coalesce(e.v->>'note', '')), ''),
         (row_number() OVER (ORDER BY e.ord) - 1)::int, (e.v->>'library_ingredient_id')::uuid
  FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) WITH ORDINALITY AS e(v, ord)
  WHERE btrim(coalesce(e.v->>'name', '')) <> '';
END $$;

GRANT EXECUTE ON FUNCTION public.replace_recipe_ingredients(uuid, jsonb) TO authenticated;

-- ── 3. Deleting a library food keeps the recipes' totals ──────────────────────
CREATE OR REPLACE FUNCTION public.trg_library_freeze_recipes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.recipes SET macro_mode = 'manual'
   WHERE macro_mode = 'from_ingredients'
     AND id IN (SELECT recipe_id FROM public.recipe_ingredients WHERE library_ingredient_id = OLD.id);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_library_freeze_recipes ON public.recipe_ingredient_library;
CREATE TRIGGER trg_library_freeze_recipes
  BEFORE DELETE ON public.recipe_ingredient_library
  FOR EACH ROW EXECUTE FUNCTION public.trg_library_freeze_recipes();

-- ── Backfill: recipes with kg/l/dl ingredients now count them ─────────────────
SELECT public.recompute_recipe_macros(id) FROM public.recipes WHERE macro_mode = 'from_ingredients';
