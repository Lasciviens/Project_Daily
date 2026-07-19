-- Recipes had no fiber_g column, so logging a recipe (or a recipe-backed plan
-- row) contributed ZERO fiber while the Daily/Today cards show a fiber goal —
-- a systematically misleading signal (Faz 9). Add fiber_g (per serving, like
-- the other recipe macros); from_ingredients recipes now sum it from their
-- linked library ingredients, manual recipes can enter it.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS fiber_g numeric;
