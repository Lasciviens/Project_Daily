-- Provenance columns for recipe_ingredient_library so bulk-imported reference
-- foods (Matvaretabellen, migration 056) are distinguishable from the user's
-- own hand-made ingredients and the annual refresh stays idempotent.
--
--  * source     — where the row came from: NULL/'user' = hand-made (the user's
--                 own, always wins on a name conflict), 'matvaretabellen' =
--                 official Norwegian Food Composition Table, 'openfoodfacts' =
--                 a barcode import (future). Kept for attribution (NLOD requires
--                 the source travel with the data) and for a safe re-import.
--  * source_ref — the external id (Matvaretabellen foodId like '06.178', or an
--                 Open Food Facts barcode) so a refresh can target its own rows.

ALTER TABLE public.recipe_ingredient_library
  ADD COLUMN IF NOT EXISTS source     text,
  ADD COLUMN IF NOT EXISTS source_ref text;
