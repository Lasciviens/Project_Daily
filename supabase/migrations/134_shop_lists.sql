-- 134 — Shop: a quick list beside the wishlist, the price's own currency, the
-- day something was bought and the task a purchase was planned as.
-- Safe to re-run. Updates rows only to fill the two new facts below once.
--
-- Owner, 07.10.2026: Shop is two views over the same items — the Wishlist
-- (things to buy someday, by category, with prices and totals) and the Quick
-- list (a short errand / grocery list, by store). `list` says which a row is on.
--   · category_id becomes optional: "milk" on the quick list needs no
--     category, and a wishlist row without one shows under "No category".
--   · currency: the price's currency (NOK / TRY / EUR / USD). Before, the
--     region decided it (TR → TRY, otherwise a bare number); filled once from
--     the region for rows that have a price (no region → NOK, the owner's home
--     currency).
--   · bought_at: when the row became 'bought'. A trigger stamps it on the way
--     into 'bought' (a date the writer sends is kept) and clears it on the way
--     out, for every writer (web, AI). Filled once from updated_at for rows
--     already bought — the only date on record for them.
--   · task_id: the task a purchase was planned as ("Plan it", like a wish's
--     promoted_task_id); SET NULL when the task is deleted.

ALTER TABLE public.shop_items
  ADD COLUMN IF NOT EXISTS list      text NOT NULL DEFAULT 'wishlist',
  ADD COLUMN IF NOT EXISTS currency  text,
  ADD COLUMN IF NOT EXISTS bought_at timestamptz,
  ADD COLUMN IF NOT EXISTS task_id   uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_list_check CHECK (list IN ('wishlist', 'quick'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_currency_check
    CHECK (currency IS NULL OR currency IN ('NOK', 'TRY', 'EUR', 'USD'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.shop_items ALTER COLUMN category_id DROP NOT NULL;

UPDATE public.shop_items
   SET currency = CASE WHEN region = 'TR' THEN 'TRY' ELSE 'NOK' END
 WHERE currency IS NULL AND price IS NOT NULL;

UPDATE public.shop_items
   SET bought_at = updated_at
 WHERE status = 'bought' AND bought_at IS NULL;

CREATE OR REPLACE FUNCTION public.shop_items_stamp_bought_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'bought' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'bought' THEN
      NEW.bought_at := COALESCE(NEW.bought_at, now());
    END IF;
  ELSE
    NEW.bought_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_items_bought_at ON public.shop_items;
CREATE TRIGGER trg_shop_items_bought_at
  BEFORE INSERT OR UPDATE OF status, bought_at ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_items_stamp_bought_at();

CREATE INDEX IF NOT EXISTS idx_shop_items_user_list ON public.shop_items (user_id, list, status);
CREATE INDEX IF NOT EXISTS idx_shop_items_task ON public.shop_items (task_id) WHERE task_id IS NOT NULL;
