-- ═══════════════════════════════════════════════════════════════════════════
-- 159 — Quick guess presets get options (quick_guess_items.options).
--
-- Why (owner, 16.10.2026, Food point 7, decisions 8 and 9): "Pizza" is not one
-- number. A preset may carry up to three option groups the card asks about
-- before it logs ("On it: Margherita / Chicken / Pepperoni", "Extra: Cheese",
-- "Size: Small / Large"); a preset without options still logs in one tap. The
-- log is still one ordinary one-off diary line ("Pizza (chicken, cheese)"),
-- never a link to this row (152's rule stands).
--
-- options is a jsonb array, at most 3 groups:
--   { "name": "On it", "pick": "one" | "any" | "size", "choices": [ … 1–6 … ] }
--   pick "one"  — choose one choice (or none); it ADDS its macros to the portion
--   pick "any"  — choose any number; each ADDS its macros
--   pick "size" — choose one; it MULTIPLIES the whole portion (adds included)
--   an adding choice:     { "name": "Chicken", "calories": 90, "protein_g": 9,
--                           "carbs_g": 0, "fat_g": 3, "sugar_g": 0 }
--                         (a missing macro is 0; ranges are the table's own
--                         per-portion CHECKs, 0 allowed — "Margherita" adds 0)
--   a size choice:        { "name": "Large", "factor": 1.5 }  (0 < factor ≤ 10)
--   names: 1–30 characters, not blank.
-- quick_guess_options_ok() checks all of it, so every writer (the app, the
-- assistant's db tools) meets the same rule; the app's draftProblem
-- (src/features/recipes/quickGuess.ts) says the same rules in words before a
-- save (verify-quick-guess reads the limits from this file).
--
-- Existing presets get [] (no options): ADD COLUMN with a constant default
-- writes no row, so no trigger fires and Developer → Activity stays as it was.
-- Re-runnable: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, the pg_constraint
-- guard. trg_audit (152) already logs the column with the rest of the row, and
-- Undo (144, 150/151) restores it like any other column.

ALTER TABLE public.quick_guess_items
  ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.quick_guess_options_ok(p_options jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  g     jsonb;
  c     jsonb;
  m     record;
  v_pick text;
BEGIN
  IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array' OR jsonb_array_length(p_options) > 3 THEN
    RETURN false;
  END IF;
  FOR g IN SELECT e.value FROM jsonb_array_elements(p_options) AS e LOOP
    IF jsonb_typeof(g) <> 'object'
       OR jsonb_typeof(g -> 'name') IS DISTINCT FROM 'string'
       OR btrim(g ->> 'name') = '' OR char_length(g ->> 'name') > 30
       OR jsonb_typeof(g -> 'pick') IS DISTINCT FROM 'string'
       OR (g ->> 'pick') NOT IN ('one', 'any', 'size')
       OR jsonb_typeof(g -> 'choices') IS DISTINCT FROM 'array'
       OR jsonb_array_length(g -> 'choices') NOT BETWEEN 1 AND 6 THEN
      RETURN false;
    END IF;
    v_pick := g ->> 'pick';
    FOR c IN SELECT e.value FROM jsonb_array_elements(g -> 'choices') AS e LOOP
      IF jsonb_typeof(c) <> 'object'
         OR jsonb_typeof(c -> 'name') IS DISTINCT FROM 'string'
         OR btrim(c ->> 'name') = '' OR char_length(c ->> 'name') > 30 THEN
        RETURN false;
      END IF;
      IF v_pick = 'size' THEN
        IF jsonb_typeof(c -> 'factor') IS DISTINCT FROM 'number'
           OR NOT ((c ->> 'factor')::numeric > 0 AND (c ->> 'factor')::numeric <= 10) THEN
          RETURN false;
        END IF;
      ELSE
        FOR m IN SELECT * FROM (VALUES ('calories', 5000), ('protein_g', 500), ('carbs_g', 1000), ('fat_g', 500), ('sugar_g', 1000)) AS t(k, mx) LOOP
          IF c ? m.k AND NOT (jsonb_typeof(c -> m.k) = 'number' AND (c ->> m.k)::numeric BETWEEN 0 AND m.mx) THEN
            RETURN false;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.quick_guess_options_ok(jsonb) TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quick_guess_items_options_shape') THEN
    ALTER TABLE public.quick_guess_items
      ADD CONSTRAINT quick_guess_items_options_shape CHECK (public.quick_guess_options_ok(options));
  END IF;
END $$;

COMMENT ON COLUMN public.quick_guess_items.options IS
  'Up to 3 option groups asked before logging: [{name, pick: one|any|size, choices: [{name, calories, protein_g, carbs_g, fat_g, sugar_g} | {name, factor}]}], 1–6 choices each. [] = logs in one tap.';
