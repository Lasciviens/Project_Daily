-- 066_recipe_is_temp.sql — MANUAL-APPLY (user).
-- A "temp meal" is a meal saved from the food logger as ONE named unit
-- (e.g. "öğle yemeği") that should NOT clutter the recipe Library. It stays
-- fully usable: it shows in the logger's "Saved meals" strip, its contents are
-- viewable (hover / tap), and it's editable. Only the Library GRID hides it.
-- Saving a meal defaults to temp (is_temp = true); ticking "Save to library"
-- when saving makes it a permanent Library recipe (is_temp = false).
--
-- Client is backward-safe: createRecipe/updateRecipe drop is_temp and retry if
-- the column is missing (pre-066), so the frontend works before this is applied.
alter table public.recipes add column if not exists is_temp boolean not null default false;

-- Cheap partial index for the common "Library grid = non-temp only" read.
create index if not exists idx_recipes_library on public.recipes(user_id) where is_temp = false;
