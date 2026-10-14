-- ═══════════════════════════════════════════════════════════════════════════
-- 152 — Quick guess presets become the owner's own data (quick_guess_items).
--
-- Why (owner, 14.10.2026, Dev Request "Shop" point 8): Food · Today's Quick
-- guess chips were hard-coded in quickGuess.ts. "Not candy but sweet? Not
-- protein snack but Protein. And let me as user change them under settings
-- in a clickable openable modal screen where I can edit names, calories,
-- macros etc." Settings → Food → Quick guess edits these rows: name, icon,
-- portion, kcal and macros, add, delete (with Undo) and reorder.
--
-- One row per preset: name (the diary line's title — a log writes a one-off
-- food_log_entries line, never a link to this row, so editing or deleting a
-- preset never touches what was logged), icon (an emoji, content), portion
-- (what "one" means, e.g. "0.5 L"), calories / protein_g / carbs_g / fat_g /
-- sugar_g per portion (the food tables' column names), sort_order.
-- No uniqueness on the name: renaming two presets into each other's names
-- would fail halfway.
--
-- Seed: every account in app_allowed_users (139) that has no preset yet gets
-- the built-in nine, renamed (Candy → Sweet, Protein snack → Protein) — the
-- same values as DEFAULT_GUESSES in src/features/recipes/quickGuess.ts
-- (scripts/verify-quick-guess.cjs compares them). Seeding here, not on the
-- first edit in the app: every preset is a real row from the start, so edit,
-- delete with Undo, reorder and the assistant all work on the same rows, and
-- deleting every preset doesn't bring the defaults back. The seed runs before
-- trg_audit exists, so it doesn't fill Developer → Activity.
-- Re-runnable: IF NOT EXISTS, the pg_policies guard, DROP TRIGGER IF EXISTS,
-- and the seed only fills accounts with no rows.
--
-- Owner-only RLS, user_id DEFAULT auth.uid(), updated_at via
-- update_updated_at() (002), trg_audit (single id key, so Undo this save
-- works), owner lock. ai-proxy's DB_CATALOG lists it as rw.

CREATE TABLE IF NOT EXISTS public.quick_guess_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  icon        text CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 16),
  portion     text CHECK (portion IS NULL OR char_length(portion) <= 120),
  calories    numeric NOT NULL CHECK (calories > 0 AND calories <= 5000),
  protein_g   numeric NOT NULL DEFAULT 0 CHECK (protein_g >= 0 AND protein_g <= 500),
  carbs_g     numeric NOT NULL DEFAULT 0 CHECK (carbs_g >= 0 AND carbs_g <= 1000),
  fat_g       numeric NOT NULL DEFAULT 0 CHECK (fat_g >= 0 AND fat_g <= 500),
  sugar_g     numeric NOT NULL DEFAULT 0 CHECK (sugar_g >= 0 AND sugar_g <= 1000),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quick_guess_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'quick_guess_items' AND policyname = 'Users manage own quick guess items') THEN
    CREATE POLICY "Users manage own quick guess items" ON public.quick_guess_items FOR ALL
      USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_guess_items TO authenticated;

CREATE INDEX IF NOT EXISTS quick_guess_items_user_order_idx ON public.quick_guess_items (user_id, sort_order);

-- ── Seed (before trg_audit, see the header) ─────────────────────────────────
INSERT INTO public.quick_guess_items (user_id, name, icon, portion, calories, protein_g, carbs_g, fat_g, sugar_g, sort_order)
SELECT a.user_id, d.name, d.icon, d.portion, d.calories, d.protein_g, d.carbs_g, d.fat_g, d.sugar_g, d.sort_order
  FROM public.app_allowed_users a
 CROSS JOIN (VALUES
   ('Protein',     '💪', 'a protein pudding, a skyr or half a bar',          110, 10, 10,  3,  6, 0),
   ('Sweet',       '🍬', 'a handful (about 50 g)',                           220,  2, 38,  7, 30, 1),
   ('Soft drink',  '🥤', '0.5 L, not sugar-free',                            210,  0, 53,  0, 53, 2),
   ('Juice',       '🧃', 'a glass (250 ml)',                                 115,  2, 26,  0, 22, 3),
   ('Beer',        '🍺', '0.5 L, 4.7 %',                                     215,  2, 18,  0,  0, 4),
   ('Wine',        '🍷', 'a glass (150 ml)',                                 125,  0,  4,  0,  1, 5),
   ('Latte',       '☕', 'a coffee with milk (about 300 ml)',                130,  8, 12,  5, 12, 6),
   ('Small snack', '🥨', 'a biscuit, a bun or a few crisps',                 150,  4, 18,  7,  6, 7),
   ('Big snack',   '🍔', 'a pastry, a hot dog or a chocolate bar and a drink', 400, 15, 42, 18, 15, 8)
 ) AS d(name, icon, portion, calories, protein_g, carbs_g, fat_g, sugar_g, sort_order)
 WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id)
   AND NOT EXISTS (SELECT 1 FROM public.quick_guess_items q WHERE q.user_id = a.user_id);

-- ── Triggers ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_quick_guess_items_updated_at ON public.quick_guess_items;
CREATE TRIGGER trg_quick_guess_items_updated_at
  BEFORE UPDATE ON public.quick_guess_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_audit ON public.quick_guess_items;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.quick_guess_items
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

select public.owner_lock_apply('public.quick_guess_items');
