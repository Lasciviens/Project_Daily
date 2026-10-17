-- ============================================================
-- 158 — food_log_entries.meal_group_title: a dish's own name
-- ============================================================
-- Food point 5 (owner, 16.10.2026: "all ok"). Rows sharing a meal_group_id
-- (087, "As meal") are one dish in the diary. Its name used to be the first
-- item's title ("Rice · 100g +1 more"); now it is worked out from the items'
-- names ("Rice + Chicken") unless the owner renames it (decision 1).
--
-- The name sits on EVERY row of the dish (there is no dish row: a dish is
-- only a shared id), NULL = the automatic name. A row that joins a dish takes
-- the dish's name, and a row that leaves one (meal_group_id → NULL) drops it,
-- whichever writer does it (the web app, phone-gateway, ai-proxy) — so the
-- rows of a dish never disagree:
--   trg_food_log_entries_group_title  BEFORE INSERT OR UPDATE OF meal_group_id
-- A rename updates meal_group_title alone and does not fire it.
--
-- The CHECK keeps a name off a row that is in no dish and caps its length.
-- food_log_entries already has trg_audit (053): a rename, a move, an ungroup
-- are in Developer → Activity and undoable there.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW.

ALTER TABLE public.food_log_entries ADD COLUMN IF NOT EXISTS meal_group_title text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'food_log_entries_group_title_check') THEN
    ALTER TABLE public.food_log_entries
      ADD CONSTRAINT food_log_entries_group_title_check
      CHECK (meal_group_title IS NULL OR (meal_group_id IS NOT NULL AND char_length(btrim(meal_group_title)) BETWEEN 1 AND 80));
  END IF;
END $$;

COMMENT ON COLUMN public.food_log_entries.meal_group_title IS
  'The dish''s own name, the same on every row sharing meal_group_id; NULL = the automatic name ("Rice + Chicken").';

-- A row that joins a dish takes its name; a row that leaves one drops it.
CREATE OR REPLACE FUNCTION public.trg_food_log_entries_group_title()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_title text;
  v_found boolean := false;
BEGIN
  IF NEW.meal_group_id IS NULL THEN
    NEW.meal_group_title := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.meal_group_id IS NOT DISTINCT FROM OLD.meal_group_id THEN
    RETURN NEW;
  END IF;
  SELECT e.meal_group_title, true INTO v_title, v_found
  FROM public.food_log_entries e
  WHERE e.meal_group_id = NEW.meal_group_id AND e.user_id = NEW.user_id AND e.id <> NEW.id
  LIMIT 1;
  -- The dish already has rows: its name wins. A new dish keeps the name sent.
  IF v_found THEN NEW.meal_group_title := v_title; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_food_log_entries_group_title ON public.food_log_entries;
CREATE TRIGGER trg_food_log_entries_group_title
  BEFORE INSERT OR UPDATE OF meal_group_id ON public.food_log_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_food_log_entries_group_title();
