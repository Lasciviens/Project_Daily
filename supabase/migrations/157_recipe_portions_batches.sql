-- ============================================================
-- 157 — recipes: a portion's name and the batch that is cooking
-- ============================================================
-- Food point 8 (owner, 16.10.2026: "all ok"). Logging a saved meal offered
-- only a % of the batch; a recipe had whole `servings` and no word for one,
-- and nothing knew how much of a pot was left.
--
-- serving_label    What one serving is called ("piece", "slice", "bowl").
--                  NULL reads as "portion". One name per recipe (owner
--                  decision 6); the app makes the plural ("3 pieces").
-- batch_started_at When the batch that is being eaten now was made: the
--                  logger's Save meal, "I made this", or "New batch" in the
--                  portion sheet set it.
-- batch_servings   How many servings that batch made (it may be more or less
--                  than the recipe's base `servings`: a double batch).
-- batch_cooked_g   The cooked weight of that batch, once the pot is weighed —
--                  then the portion sheet offers "g cooked".
--
-- Leftovers are DERIVED, never stored: what is left = batch_servings − the
-- servings of this recipe eaten (diary rows created since batch_started_at,
-- on its day or later). A batch ends when it is eaten up or after four days
-- (the app's rule, foodAmount.ts), so nothing here ever clears these columns.
--
-- The CHECKs are typo guards, not nutrition limits. batch_servings and
-- batch_cooked_g only make sense with a start (a batch has a day).
--
-- No trigger change: 106's recompute triggers fire on servings / macros only,
-- so starting a batch or weighing the pot never touches a recipe's macros or a
-- diary row. recipes already has trg_audit (037), so these edits are in
-- Developer → Activity and undoable there.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW.

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS serving_label    text,
  ADD COLUMN IF NOT EXISTS batch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS batch_servings   numeric,
  ADD COLUMN IF NOT EXISTS batch_cooked_g   numeric;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_serving_label_len') THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_serving_label_len CHECK (serving_label IS NULL OR char_length(btrim(serving_label)) BETWEEN 1 AND 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_batch_servings_range') THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_batch_servings_range CHECK (batch_servings IS NULL OR (batch_servings > 0 AND batch_servings <= 1000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_batch_cooked_g_range') THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_batch_cooked_g_range CHECK (batch_cooked_g IS NULL OR (batch_cooked_g > 0 AND batch_cooked_g <= 100000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_batch_has_start') THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_batch_has_start CHECK (batch_started_at IS NOT NULL OR (batch_servings IS NULL AND batch_cooked_g IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.recipes.serving_label IS
  'What one serving is called ("piece", "slice"); NULL = "portion". The app makes the plural.';
COMMENT ON COLUMN public.recipes.batch_started_at IS
  'When the batch being eaten now was made (Save meal, "I made this", "New batch"). Leftovers = batch_servings − servings of this recipe eaten since; a batch ends when eaten up or after 4 days.';
COMMENT ON COLUMN public.recipes.batch_servings IS
  'How many servings the current batch made (may differ from servings: a double batch).';
COMMENT ON COLUMN public.recipes.batch_cooked_g IS
  'Cooked weight of the current batch in grams, once the pot is weighed (offers "g cooked" when logging).';
