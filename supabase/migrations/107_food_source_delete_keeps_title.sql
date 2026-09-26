-- 107 · Deleting a logged recipe or library ingredient no longer fails
--
-- food_log_entries.recipe_id / library_ingredient_id are ON DELETE SET NULL,
-- but the table also has CHECK (library_ingredient_id IS NOT NULL OR
-- recipe_id IS NOT NULL OR custom_title IS NOT NULL). Recipe and library rows
-- never carry a custom_title, so SET NULL left all three NULL and the CHECK
-- rejected the delete (23514): any recipe, temp saved meal or ingredient that
-- had ever been logged or planned could not be deleted.
--
-- Fix: before the source row goes, copy its name into custom_title on every
-- dependent row that has none. The row then keeps its title and its last
-- computed totals (migration 106 leaves a source-less row alone) and reads as
-- a normal one-off line. Updates no row until a delete happens. Idempotent.

CREATE OR REPLACE FUNCTION public.trg_recipes_keep_log_title()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.food_log_entries
     SET custom_title = OLD.title
   WHERE recipe_id = OLD.id AND custom_title IS NULL;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_recipes_keep_log_title ON public.recipes;
CREATE TRIGGER trg_recipes_keep_log_title
  BEFORE DELETE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.trg_recipes_keep_log_title();

CREATE OR REPLACE FUNCTION public.trg_library_keep_log_title()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.food_log_entries
     SET custom_title = OLD.name
   WHERE library_ingredient_id = OLD.id AND custom_title IS NULL;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_library_keep_log_title ON public.recipe_ingredient_library;
CREATE TRIGGER trg_library_keep_log_title
  BEFORE DELETE ON public.recipe_ingredient_library
  FOR EACH ROW EXECUTE FUNCTION public.trg_library_keep_log_title();
