-- Food redesign P2 — categorization + multiple portions (additive only).
--
-- (1) Category on the food library. Matvaretabellen rows get their OFFICIAL
--     food group (16 top-level Norwegian groups). NOTE: the category MUST come
--     from a foodId→foodGroupId lookup (migration 058), NOT from parsing the
--     numeric prefix of source_ref — 35% of foodIds have a prefix that
--     disagrees with their real group (e.g. foodId 06.178 "Adzuki beans" is
--     group 12 Legumes, not 6). food_group_id keeps the raw id (e.g. "4.1.2")
--     for future sub-group drill-down; food_group is the denormalized top-level
--     English name that the UI filter pills key off.
ALTER TABLE public.recipe_ingredient_library
  ADD COLUMN IF NOT EXISTS food_group_id text,
  ADD COLUMN IF NOT EXISTS food_group    text;

-- (2) Multiple portion presets per food. Matvaretabellen ships up to 5 portions
--     per food ("1 dl", "1 slice", "1 tbsp", …) — ~40% of foods have 2+ that we
--     currently discard (only the single serving_label/serving_grams pair is
--     kept). This child table holds all of them so logging a countable food is
--     one tap. serving_label/serving_grams on the parent stay as the PRIMARY
--     preset (backward compatible).
CREATE TABLE IF NOT EXISTS public.recipe_ingredient_portions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  library_ingredient_id uuid NOT NULL REFERENCES public.recipe_ingredient_library(id) ON DELETE CASCADE,
  label                 text NOT NULL,            -- e.g. "1 dl", "slice", "tablespoon"
  grams                 numeric NOT NULL CHECK (grams > 0),
  sort_order            int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- One label per food (idempotent backfill anchor + no duplicate presets).
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_ingredient_portions_uniq
  ON public.recipe_ingredient_portions (library_ingredient_id, label);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredient_portions_parent
  ON public.recipe_ingredient_portions (library_ingredient_id);

ALTER TABLE public.recipe_ingredient_portions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own recipe_ingredient_portions" ON public.recipe_ingredient_portions;
CREATE POLICY "own recipe_ingredient_portions" ON public.recipe_ingredient_portions
  FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
