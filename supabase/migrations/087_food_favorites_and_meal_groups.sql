-- ============================================================
-- 087 — food_favorites, food_recent_hidden, food_log_entries.meal_group_id
-- ============================================================
-- Three small, unrelated additions to the food-logging surface, shipped
-- together since they all touch the same "Recent"/logging UI:
--
-- 1. `food_favorites` — a pinned shortcut list, separate from "Recent"
--    (which is derived from eaten history and can't hold something you
--    haven't logged in a while, or want to guarantee stays reachable). Not
--    a foreign key onto `recipe_ingredient_library`/`recipes` alone, because
--    a favourite can also be a custom-titled food with no library row at
--    all — so it carries its own full snapshot (title/macros/quantity/unit),
--    the same shape `RecentFood` already uses, rather than a bare pointer.
--    `food_key` reuses `fetchRecentFoods()`'s own key format
--    (`library_ingredient_id ?? recipe_id ?? 'c:'+title`) so the two lists
--    can be deduped/merged without a second identity scheme.
--
-- 2. `food_recent_hidden` — "remove from Recent" needs to persist (it's a
--    standing preference, not a one-off action), but has a different shape
--    entirely from a favourite (just a key to filter out, no snapshot to
--    keep) — a single overloaded table for both would force one of the two
--    concepts to carry columns it doesn't need.
--
-- 3. `food_log_entries.meal_group_id` — lets several individually-logged
--    ingredient rows (bread, chicken, onion, rice) collapse into ONE compact
--    diary line ("As meal" checkbox in FoodLogModal) while each ingredient
--    keeps its own real row/macros/snapshot underneath — tapping the
--    compact line expands to the individual items. Nullable: a normal
--    single-item log or a recipe log never sets it and renders exactly as
--    before. No FK — this is a plain grouping tag generated client-side
--    (crypto.randomUUID()), not a row with its own identity/lifecycle.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW.

CREATE TABLE IF NOT EXISTS public.food_favorites (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  food_key               text NOT NULL,
  title                  text NOT NULL,
  library_ingredient_id  uuid REFERENCES public.recipe_ingredient_library(id) ON DELETE CASCADE,
  recipe_id              uuid REFERENCES public.recipes(id) ON DELETE CASCADE,
  custom_title           text,
  quantity               numeric,
  unit                   text,
  calories               numeric,
  protein_g              numeric,
  carbs_g                numeric,
  fat_g                  numeric,
  fiber_g                numeric,
  sugar_g                numeric,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, food_key)
);

CREATE TABLE IF NOT EXISTS public.food_recent_hidden (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  food_key    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, food_key)
);

ALTER TABLE public.food_log_entries ADD COLUMN IF NOT EXISTS meal_group_id uuid;
CREATE INDEX IF NOT EXISTS food_log_entries_meal_group_idx
  ON public.food_log_entries (meal_group_id) WHERE meal_group_id IS NOT NULL;

ALTER TABLE public.food_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_recent_hidden ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'food_favorites'
      AND policyname = 'Users manage own food favorites'
  ) THEN
    CREATE POLICY "Users manage own food favorites"
      ON public.food_favorites
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'food_recent_hidden'
      AND policyname = 'Users manage own food recent hidden'
  ) THEN
    CREATE POLICY "Users manage own food recent hidden"
      ON public.food_recent_hidden
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- User-authored settings-like data (AGENTS.md rule 9).
DROP TRIGGER IF EXISTS trg_audit ON public.food_favorites;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.food_favorites
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS trg_audit ON public.food_recent_hidden;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.food_recent_hidden
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
