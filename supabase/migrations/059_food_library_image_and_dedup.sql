-- Food model pivot: on-demand branded/generic foods (barcode + search add a food
-- to the library on first use) instead of a bulk seed. Two additive changes:
--
-- (1) image_url — branded products (Open Food Facts / Kassalapp) carry a product
--     photo; store it so the library + logger can show it. The recipes table
--     already has image_url; the food library did not.
ALTER TABLE public.recipe_ingredient_library
  ADD COLUMN IF NOT EXISTS image_url text;

-- (2) De-dup external foods by their provenance id (EAN barcode / Matvaretabellen
--     foodId), not just by name — the same product can arrive from OFF and
--     Kassalapp, and two brands share a generic name. A partial unique index on
--     (user_id, source_ref) lets the add-on-first-use path upsert by source_ref
--     and never create a second row for the same product. NULL source_ref
--     (hand-made rows) is excluded, so it never constrains the user's own foods.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_ingredient_library_source_ref
  ON public.recipe_ingredient_library (user_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- NOTE on the dropped bulk seed (migration 056): it was NEVER applied to
-- production (verified: the library holds only the ~50 curated staples from 054
-- + the user's own foods; zero source='matvaretabellen' rows), so nothing needs
-- reversing. If a non-prod DB ever ran 056, clean it with (single-user app —
-- key on the provenance column, NOT auth.uid(), which is NULL in the SQL editor):
--   DELETE FROM public.recipe_ingredient_library WHERE source = 'matvaretabellen';
-- (the ON DELETE CASCADE on recipe_ingredient_portions removes its children).
