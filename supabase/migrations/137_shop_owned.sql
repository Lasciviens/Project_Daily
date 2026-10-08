-- 137 — Shop: what you own, money chains, general wishes and their models,
-- accessories, extra costs, deals and the price watch (owner, 08.10.2026).
-- Needs 134 (shop_items.list). Safe to re-run. Changes one foreign key's
-- ON DELETE and two constraints, and sets one flag on old rows (see 9) — no
-- other data is touched.
--
-- A wishlist row now has a life: To buy (status 'wishlist') → Mine
-- ('bought') → Sold or gone ('bought' + disposal facts). Quick-list errands
-- stay errands (a tick is "picked up", never a possession). A POSSESSION is
-- list = 'wishlist' AND kind = 'item' AND status = 'bought' AND kept.
--
--  1. category_id: ON DELETE SET NULL (it was CASCADE — a deleted category
--     deleted its items; once they are a record of what you own they move to
--     "No category" instead).
--  2. status + 'fulfilled': a general wish whose model was bought.
--  3. New shop_items columns:
--       general wish  kind ('item' | 'general'), price_min, price_max,
--                     requirements (one per line), option_for (a model of
--                     that wish), meets (a model's ✓/✗ per requirement)
--       accessories   accessory_of (one level deep)
--       to buy        reason (need | fun), wait_for_deal, target_price,
--                     deal_note, errand (also shown on the quick list — a
--                     wishlist row never moves there), image_url, ean
--       bought        fx_nok + fx_source (NOK per unit of `currency` on the day
--                     it was bought — Norges Bank's rate, filled by the
--                     database for every writer, or one typed by hand),
--                     market_price / market_currency ("Saved"), used,
--                     got_as_gift, for_resale, kept (false: bought for
--                     someone else / used up — spending only), approx_dates,
--                     serial, warranty_until (the complaint right), return_by,
--                     value_now / value_currency / value_on ("Could sell for")
--       gone          disposal, disposed_on, sale_price / sale_currency /
--                     sale_fx_nok / sale_fx_source (money back: a sale, a
--                     trade-in, a refund), sold_to, sale_group (rows sold
--                     together share it; each holds its share)
--  4. fx_rates_nok — Norges Bank's daily NOK rates for TRY, EUR, USD (one row
--     per calendar day, the last business day's rate carried over weekends),
--     read by everyone, written only by the shop-price function.
--  5. shop_items_rules() — ONE before-trigger, steps in a fixed order: the
--     currency from the region, bought_at, never leaving 'bought' while
--     sold or gone (undo the sale first), the gone facts and their day, the
--     rates, the parent rules (a model's wish, an accessory's item, one level
--     deep both ways, same owner) and a child's category from its parent.
--     Replaces 134's trg_shop_items_bought_at.
--  6. A general wish is fulfilled while one of its models is bought (and not
--     returned); it reopens when that is undone, returned or deleted. Its
--     other models are "Not chosen" by reading, never by writing.
--  7. shop_item_links ("to was paid with money from selling from"; `amount`
--     = how much of that sale, else the rest is shared by price), shop_item_costs
--     (repairs, fees, a rebate is negative — each with its own day and rate),
--     shop_price_watch (the last price read per row) and shop_price_points
--     (the history). The watch tables are written only by the function, so a
--     daily check never touches shop_items (no audit row, no updated_at).
--  8. RPCs (SECURITY INVOKER — RLS applies): shop_record_sale (one sale with
--     its accessories, the kept ones moved or detached, where the money went),
--     shop_undo_sale, shop_delete_items (returns everything an Undo needs) and
--     shop_restore_items.
--  9. Rows whose bought_at 134 copied from their last edit are marked
--     approx_dates (their day — and so their rate day — is a guess).
-- 10. pg_cron `lascis-shop-prices` (05:23 UTC daily) → shop-price {sweep}
--     with SHOP_PRICE_CRON_SECRET from Vault: the waiting rates, then the price checks.

-- ─── 1. A deleted category keeps its items ──────────────────────────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.shop_items'::regclass AND con.contype = 'f' AND a.attname = 'category_id'
  LOOP
    EXECUTE format('ALTER TABLE public.shop_items DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES public.shop_categories(id) ON DELETE SET NULL;

-- ─── 2. 'fulfilled' ─────────────────────────────────────────────────────────
ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_status_check;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_status_check
  CHECK (status IN ('wishlist', 'bought', 'dropped', 'fulfilled'));

-- ─── 3. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.shop_items
  ADD COLUMN IF NOT EXISTS kind            text    NOT NULL DEFAULT 'item',
  ADD COLUMN IF NOT EXISTS price_min       numeric,
  ADD COLUMN IF NOT EXISTS price_max       numeric,
  ADD COLUMN IF NOT EXISTS requirements    text,
  ADD COLUMN IF NOT EXISTS option_for      uuid REFERENCES public.shop_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meets           jsonb,
  ADD COLUMN IF NOT EXISTS accessory_of    uuid REFERENCES public.shop_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason          text,
  ADD COLUMN IF NOT EXISTS wait_for_deal   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_price    numeric,
  ADD COLUMN IF NOT EXISTS deal_note       text,
  ADD COLUMN IF NOT EXISTS errand          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_url       text,
  ADD COLUMN IF NOT EXISTS ean             text,
  ADD COLUMN IF NOT EXISTS fx_nok          numeric,
  ADD COLUMN IF NOT EXISTS fx_source       text,
  ADD COLUMN IF NOT EXISTS market_price    numeric,
  ADD COLUMN IF NOT EXISTS market_currency text,
  ADD COLUMN IF NOT EXISTS used            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS got_as_gift     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS for_resale      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kept            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approx_dates    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS serial          text,
  ADD COLUMN IF NOT EXISTS warranty_until  date,
  ADD COLUMN IF NOT EXISTS return_by       date,
  ADD COLUMN IF NOT EXISTS value_now       numeric,
  ADD COLUMN IF NOT EXISTS value_currency  text,
  ADD COLUMN IF NOT EXISTS value_on        date,
  ADD COLUMN IF NOT EXISTS disposal        text,
  ADD COLUMN IF NOT EXISTS disposed_on     date,
  ADD COLUMN IF NOT EXISTS sale_price      numeric,
  ADD COLUMN IF NOT EXISTS sale_currency   text,
  ADD COLUMN IF NOT EXISTS sale_fx_nok     numeric,
  ADD COLUMN IF NOT EXISTS sale_fx_source  text,
  ADD COLUMN IF NOT EXISTS sold_to         text,
  ADD COLUMN IF NOT EXISTS sale_group      uuid;

DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_kind_check CHECK (kind IN ('item', 'general'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_reason_check CHECK (reason IS NULL OR reason IN ('need', 'fun'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_disposal_check
    CHECK (disposal IS NULL OR disposal IN ('sold', 'traded_in', 'returned', 'given', 'broken', 'lost', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_fx_source_check CHECK (
        (fx_source IS NULL OR fx_source IN ('fixed', 'norges_bank', 'manual'))
    AND (sale_fx_source IS NULL OR sale_fx_source IN ('fixed', 'norges_bank', 'manual')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_more_currencies_check CHECK (
        (market_currency IS NULL OR market_currency IN ('NOK', 'TRY', 'EUR', 'USD'))
    AND (value_currency  IS NULL OR value_currency  IN ('NOK', 'TRY', 'EUR', 'USD'))
    AND (sale_currency   IS NULL OR sale_currency   IN ('NOK', 'TRY', 'EUR', 'USD')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_money_check CHECK (
        (price IS NULL OR price >= 0) AND (price_min IS NULL OR price_min >= 0) AND (price_max IS NULL OR price_max >= 0)
    AND (price_min IS NULL OR price_max IS NULL OR price_min <= price_max)
    AND (target_price IS NULL OR target_price >= 0) AND (market_price IS NULL OR market_price >= 0)
    AND (value_now IS NULL OR value_now >= 0) AND (sale_price IS NULL OR sale_price >= 0)
    AND (fx_nok IS NULL OR fx_nok > 0) AND (sale_fx_nok IS NULL OR sale_fx_nok > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_meets_check CHECK (meets IS NULL OR jsonb_typeof(meets) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A general wish lives on the wishlist, has a range instead of a price and is never bought itself.
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_general_check CHECK (
    kind = 'item' OR (list = 'wishlist' AND price IS NULL AND status IN ('wishlist', 'dropped', 'fulfilled')
                      AND option_for IS NULL AND accessory_of IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_fulfilled_check CHECK (status <> 'fulfilled' OR kind = 'general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Errands are never possessions, accessories or models.
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_quick_check CHECK (
    list = 'wishlist' OR (disposal IS NULL AND accessory_of IS NULL AND option_for IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Gone facts belong to a thing you had, always with a day; money back always with its currency.
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_gone_check CHECK (
        ((disposal IS NULL) = (disposed_on IS NULL)) AND (disposal IS NULL OR status = 'bought')
    AND (sale_price IS NULL OR (disposal IS NOT NULL AND sale_currency IS NOT NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_tree_check CHECK (
    (option_for IS NULL OR accessory_of IS NULL) AND option_for IS DISTINCT FROM id AND accessory_of IS DISTINCT FROM id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_shop_items_option_for   ON public.shop_items (option_for)   WHERE option_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shop_items_accessory_of ON public.shop_items (accessory_of) WHERE accessory_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shop_items_sale_group   ON public.shop_items (user_id, sale_group) WHERE sale_group IS NOT NULL;

-- ─── 4. Norges Bank rates ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fx_rates_nok (
  day          date    NOT NULL,
  currency     text    NOT NULL CHECK (currency IN ('TRY', 'EUR', 'USD')),
  nok_per_unit numeric NOT NULL CHECK (nok_per_unit > 0),
  -- The business day the rate is from (a weekend day carries Friday's).
  rate_day     date    NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, currency)
);
ALTER TABLE public.fx_rates_nok ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fx_rates_nok' AND policyname = 'Everyone signed in reads rates'
  ) THEN
    -- Public reference data (Norges Bank's published rates), like movies: read for all, written only by the service role.
    CREATE POLICY "Everyone signed in reads rates" ON public.fx_rates_nok FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.shop_rate(p_currency text, p_day date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_currency = 'NOK' THEN 1::numeric
              ELSE (SELECT nok_per_unit FROM public.fx_rates_nok WHERE currency = p_currency AND day = p_day) END
$$;
GRANT EXECUTE ON FUNCTION public.shop_rate(text, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.oslo_day(p timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE AS $$ SELECT (p AT TIME ZONE 'Europe/Oslo')::date $$;

-- ─── 5. The one before-trigger ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_shop_items_bought_at ON public.shop_items;
DROP FUNCTION IF EXISTS public.shop_items_stamp_bought_at();

CREATE OR REPLACE FUNCTION public.shop_items_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  p record;
BEGIN
  -- a. A price without a currency: the region's (134's rule), else NOK.
  IF NEW.price IS NOT NULL AND NEW.currency IS NULL THEN
    NEW.currency := CASE WHEN NEW.region = 'TR' THEN 'TRY' ELSE 'NOK' END;
  END IF;

  -- b. Bought: stamped once; leaving 'bought' while sold or gone is refused
  --    (the sale must be undone first — otherwise it would vanish silently).
  IF NEW.status = 'bought' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'bought' THEN
      NEW.bought_at := COALESCE(NEW.bought_at, now());
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.status = 'bought' AND OLD.disposal IS NOT NULL AND NEW.disposal IS NOT NULL THEN
      RAISE EXCEPTION 'Undo the sale first — "%" is sold or gone', NEW.title USING ERRCODE = '23514';
    END IF;
    NEW.bought_at := NULL;
    NEW.market_price := NULL;
    NEW.market_currency := NULL;
    NEW.disposal := NULL;
  END IF;

  -- c. Gone: always with a day (today in Oslo when none is sent), never before it was bought.
  IF NEW.disposal IS NULL THEN
    NEW.disposed_on := NULL;
    NEW.sale_price := NULL;
    NEW.sale_currency := NULL;
    NEW.sold_to := NULL;
    NEW.sale_group := NULL;
  ELSE
    NEW.disposed_on := COALESCE(NEW.disposed_on, (now() AT TIME ZONE 'Europe/Oslo')::date);
    IF NEW.bought_at IS NOT NULL AND NEW.disposed_on < public.oslo_day(NEW.bought_at) THEN
      RAISE EXCEPTION 'It cannot leave (%) before it was bought (%)', NEW.disposed_on, public.oslo_day(NEW.bought_at) USING ERRCODE = '23514';
    END IF;
    IF NEW.sale_price IS NOT NULL AND NEW.sale_currency IS NULL THEN
      NEW.sale_currency := COALESCE(NEW.currency, 'NOK');
    END IF;
  END IF;

  -- d. The purchase rate: NOK needs none; a rate the writer sends is kept as
  --    "manual"; otherwise Norges Bank's rate of the day it was bought, looked
  --    up again whenever the currency or the day changes (NULL until cached —
  --    the app then shows "rate pending", never today's rate).
  IF NEW.status <> 'bought' OR NEW.price IS NULL THEN
    NEW.fx_nok := NULL; NEW.fx_source := NULL;
  ELSIF NEW.currency = 'NOK' THEN
    NEW.fx_nok := 1; NEW.fx_source := 'fixed';
  ELSIF NEW.fx_nok IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.fx_nok IS DISTINCT FROM OLD.fx_nok)
        AND COALESCE(NEW.fx_source, '') <> 'norges_bank' THEN
    NEW.fx_source := 'manual';
  ELSIF TG_OP = 'INSERT' OR OLD.fx_nok IS NULL OR OLD.status IS DISTINCT FROM 'bought'
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR public.oslo_day(NEW.bought_at) IS DISTINCT FROM public.oslo_day(OLD.bought_at) THEN
    NEW.fx_nok := public.shop_rate(NEW.currency, public.oslo_day(NEW.bought_at));
    NEW.fx_source := CASE WHEN NEW.fx_nok IS NULL THEN NULL ELSE 'norges_bank' END;
  END IF;

  -- e. The same for money back, on the day it left.
  IF NEW.sale_price IS NULL THEN
    NEW.sale_fx_nok := NULL; NEW.sale_fx_source := NULL;
  ELSIF NEW.sale_currency = 'NOK' THEN
    NEW.sale_fx_nok := 1; NEW.sale_fx_source := 'fixed';
  ELSIF NEW.sale_fx_nok IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.sale_fx_nok IS DISTINCT FROM OLD.sale_fx_nok)
        AND COALESCE(NEW.sale_fx_source, '') <> 'norges_bank' THEN
    NEW.sale_fx_source := 'manual';
  ELSIF TG_OP = 'INSERT' OR OLD.sale_fx_nok IS NULL OR OLD.sale_price IS NULL
        OR NEW.sale_currency IS DISTINCT FROM OLD.sale_currency OR NEW.disposed_on IS DISTINCT FROM OLD.disposed_on THEN
    NEW.sale_fx_nok := public.shop_rate(NEW.sale_currency, NEW.disposed_on);
    NEW.sale_fx_source := CASE WHEN NEW.sale_fx_nok IS NULL THEN NULL ELSE 'norges_bank' END;
  END IF;

  -- f. Parents: a model's general wish, an accessory's item — the owner's own,
  --    one level deep both ways; a child without a category takes its parent's.
  IF NEW.option_for IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.option_for IS DISTINCT FROM OLD.option_for) THEN
    SELECT user_id, kind, category_id INTO p FROM public.shop_items WHERE id = NEW.option_for;
    IF NOT FOUND OR p.user_id <> NEW.user_id OR p.kind <> 'general' THEN
      RAISE EXCEPTION 'A model belongs to a general wish of the same owner' USING ERRCODE = '23514';
    END IF;
    NEW.category_id := COALESCE(NEW.category_id, p.category_id);
  END IF;
  IF NEW.accessory_of IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.accessory_of IS DISTINCT FROM OLD.accessory_of) THEN
    SELECT user_id, kind, accessory_of AS parent, category_id INTO p FROM public.shop_items WHERE id = NEW.accessory_of;
    IF NOT FOUND OR p.user_id <> NEW.user_id OR p.kind <> 'item' OR p.parent IS NOT NULL THEN
      RAISE EXCEPTION 'An accessory belongs to an item of the same owner that is not an accessory itself' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.shop_items WHERE accessory_of = NEW.id) THEN
      RAISE EXCEPTION 'An item with accessories of its own cannot become an accessory' USING ERRCODE = '23514';
    END IF;
    NEW.category_id := COALESCE(NEW.category_id, p.category_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_items_rules ON public.shop_items;
CREATE TRIGGER trg_shop_items_rules
  BEFORE INSERT OR UPDATE ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_items_rules();

-- ─── 6. Fulfilled general wishes ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shop_recompute_wish(p_wish uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_wish IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.shop_items WHERE option_for = p_wish AND status = 'bought' AND COALESCE(disposal, '') <> 'returned') THEN
    UPDATE public.shop_items SET status = 'fulfilled' WHERE id = p_wish AND status = 'wishlist';
  ELSE
    UPDATE public.shop_items SET status = 'wishlist' WHERE id = p_wish AND status = 'fulfilled';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_items_wishes() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM public.shop_recompute_wish(NEW.option_for); END IF;
  IF TG_OP <> 'INSERT' AND OLD.option_for IS DISTINCT FROM (CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.option_for END) THEN
    PERFORM public.shop_recompute_wish(OLD.option_for);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_items_wishes ON public.shop_items;
CREATE TRIGGER trg_shop_items_wishes
  AFTER INSERT OR DELETE OR UPDATE OF status, disposal, option_for ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_items_wishes();

-- ─── 7a. Money links ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shop_item_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  from_id    uuid NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  to_id      uuid NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  -- How much of from's money back went to `to`, in from's sale currency; NULL = the rest, shared by price.
  amount     numeric CHECK (amount IS NULL OR amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_item_links_not_self CHECK (from_id <> to_id),
  CONSTRAINT shop_item_links_once UNIQUE (from_id, to_id)
);
ALTER TABLE public.shop_item_links ADD COLUMN IF NOT EXISTS amount numeric CHECK (amount IS NULL OR amount > 0);
CREATE INDEX IF NOT EXISTS idx_shop_item_links_user ON public.shop_item_links (user_id);
CREATE INDEX IF NOT EXISTS idx_shop_item_links_to   ON public.shop_item_links (to_id);
ALTER TABLE public.shop_item_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shop_item_links' AND policyname = 'Users manage own shop_item_links'
  ) THEN
    CREATE POLICY "Users manage own shop_item_links" ON public.shop_item_links
      FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_audit ON public.shop_item_links;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.shop_item_links
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- From: a thing you have or had (not an accessory). To: a thing, a wish to buy
-- or a general wish (a plan). Same owner. No loop — checked between whole
-- things (an accessory counts as its item) under a per-owner lock, so two
-- links saved at once cannot close a loop together.
CREATE OR REPLACE FUNCTION public.shop_item_links_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE f record; t record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('shop_item_links:' || NEW.user_id::text));
  SELECT user_id, list, kind, status, kept, accessory_of INTO f FROM public.shop_items WHERE id = NEW.from_id;
  SELECT user_id, list, kind, accessory_of INTO t FROM public.shop_items WHERE id = NEW.to_id;
  IF f.user_id IS DISTINCT FROM NEW.user_id OR t.user_id IS DISTINCT FROM NEW.user_id
     OR f.list <> 'wishlist' OR f.kind <> 'item' OR f.status <> 'bought' OR NOT f.kept OR f.accessory_of IS NOT NULL
     OR t.list <> 'wishlist' OR t.accessory_of IS NOT NULL THEN
    RAISE EXCEPTION 'A money link goes from one of your things to another thing or a wish (never an accessory or an errand)' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ahead(id) AS (
      SELECT NEW.to_id
      UNION
      SELECT l.to_id FROM public.shop_item_links l JOIN ahead a ON l.from_id = a.id
       WHERE l.id IS DISTINCT FROM NEW.id
    )
    SELECT 1 FROM ahead WHERE id = NEW.from_id
  ) THEN
    RAISE EXCEPTION 'That link would make a loop' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_item_links_check ON public.shop_item_links;
CREATE TRIGGER trg_shop_item_links_check
  BEFORE INSERT OR UPDATE ON public.shop_item_links
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_links_check();

-- ─── 7b. Extra costs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shop_item_costs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  label      text NOT NULL,
  -- A rebate, cashback or price-match refund is negative.
  amount     numeric NOT NULL CHECK (amount <> 0),
  currency   text NOT NULL DEFAULT 'NOK' CHECK (currency IN ('NOK', 'TRY', 'EUR', 'USD')),
  spent_on   date NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Oslo')::date),
  fx_nok     numeric CHECK (fx_nok IS NULL OR fx_nok > 0),
  fx_source  text CHECK (fx_source IS NULL OR fx_source IN ('fixed', 'norges_bank', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_item_costs_item ON public.shop_item_costs (item_id);
CREATE INDEX IF NOT EXISTS idx_shop_item_costs_user ON public.shop_item_costs (user_id, spent_on);
ALTER TABLE public.shop_item_costs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shop_item_costs' AND policyname = 'Users manage own shop_item_costs'
  ) THEN
    CREATE POLICY "Users manage own shop_item_costs" ON public.shop_item_costs
      FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_audit ON public.shop_item_costs;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.shop_item_costs
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
DROP TRIGGER IF EXISTS trg_shop_item_costs_updated_at ON public.shop_item_costs;
CREATE TRIGGER trg_shop_item_costs_updated_at BEFORE UPDATE ON public.shop_item_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.shop_item_costs_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shop_items WHERE id = NEW.item_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'A cost belongs to one of your own items' USING ERRCODE = '23514';
  END IF;
  IF NEW.currency = 'NOK' THEN
    NEW.fx_nok := 1; NEW.fx_source := 'fixed';
  ELSIF NEW.fx_nok IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.fx_nok IS DISTINCT FROM OLD.fx_nok)
        AND COALESCE(NEW.fx_source, '') <> 'norges_bank' THEN
    NEW.fx_source := 'manual';
  ELSIF TG_OP = 'INSERT' OR OLD.fx_nok IS NULL OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.spent_on IS DISTINCT FROM OLD.spent_on THEN
    NEW.fx_nok := public.shop_rate(NEW.currency, NEW.spent_on);
    NEW.fx_source := CASE WHEN NEW.fx_nok IS NULL THEN NULL ELSE 'norges_bank' END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_shop_item_costs_rules ON public.shop_item_costs;
CREATE TRIGGER trg_shop_item_costs_rules BEFORE INSERT OR UPDATE ON public.shop_item_costs
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_costs_rules();

-- ─── 7c. The price watch ────────────────────────────────────────────────────
-- Written only by the shop-price function (service role). No audit trigger:
-- machine-written every day (the bulk-sync exemption).
CREATE TABLE IF NOT EXISTS public.shop_price_watch (
  item_id     uuid PRIMARY KEY REFERENCES public.shop_items(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url         text,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL CHECK (status IN ('ok', 'no_price', 'blocked', 'error')),
  error       text,
  source      text,
  name        text,
  image       text,
  low         numeric,
  high        numeric,
  offers      integer,
  currency    text,
  in_stock    boolean,
  was         numeric,
  return_days integer,
  -- The last check that read a price, and the one before it (the trend).
  last_ok_at  timestamptz,
  prev_low    numeric,
  prev_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_shop_price_watch_user ON public.shop_price_watch (user_id);
ALTER TABLE public.shop_price_watch ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shop_price_watch' AND policyname = 'Users read own shop_price_watch'
  ) THEN
    CREATE POLICY "Users read own shop_price_watch" ON public.shop_price_watch FOR SELECT USING ((select auth.uid()) = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shop_price_watch' AND policyname = 'Users delete own shop_price_watch'
  ) THEN
    CREATE POLICY "Users delete own shop_price_watch" ON public.shop_price_watch FOR DELETE USING ((select auth.uid()) = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.shop_price_points (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  low        numeric NOT NULL CHECK (low >= 0),
  high       numeric CHECK (high IS NULL OR high >= 0),
  offers     integer,
  currency   text,
  source     text
);
CREATE INDEX IF NOT EXISTS idx_shop_price_points_item ON public.shop_price_points (item_id, checked_at DESC);
ALTER TABLE public.shop_price_points ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shop_price_points' AND policyname = 'Users read own shop_price_points'
  ) THEN
    CREATE POLICY "Users read own shop_price_points" ON public.shop_price_points FOR SELECT USING ((select auth.uid()) = user_id);
  END IF;
END $$;

-- A changed link: the old one's last price no longer applies (its history stays).
CREATE OR REPLACE FUNCTION public.shop_items_url_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  DELETE FROM public.shop_price_watch WHERE item_id = NEW.id;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_shop_items_url_changed ON public.shop_items;
CREATE TRIGGER trg_shop_items_url_changed
  AFTER UPDATE OF url ON public.shop_items
  FOR EACH ROW WHEN (OLD.url IS DISTINCT FROM NEW.url)
  EXECUTE FUNCTION public.shop_items_url_changed();

-- ─── 8. RPCs ────────────────────────────────────────────────────────────────
-- One sale. p_rows: [{"id", "sale_price"}] — the thing first, then the
-- accessories sold with it (each with its share). p_keep: [{"id",
-- "move_to"}] — accessories kept: moved to another thing, or (null) on their
-- own. p_to / p_to_amount: where the money went (all of it, or an amount in
-- p_currency). Any id that is not one of your things fails the whole sale.
CREATE OR REPLACE FUNCTION public.shop_record_sale(
  p_rows jsonb, p_disposal text, p_on date, p_currency text, p_sold_to text,
  p_keep jsonb DEFAULT '[]'::jsonb, p_to uuid DEFAULT NULL, p_to_amount numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  g uuid := CASE WHEN jsonb_array_length(p_rows) > 1 THEN gen_random_uuid() ELSE NULL END;
  r jsonb;
  main uuid := (p_rows -> 0 ->> 'id')::uuid;
  n int;
BEGIN
  IF main IS NULL THEN RAISE EXCEPTION 'Nothing to sell'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    UPDATE public.shop_items
       SET disposal = p_disposal, disposed_on = p_on,
           sale_price = NULLIF(r ->> 'sale_price', '')::numeric,
           sale_currency = CASE WHEN NULLIF(r ->> 'sale_price', '') IS NULL THEN NULL ELSE p_currency END,
           sold_to = NULLIF(btrim(COALESCE(p_sold_to, '')), ''),
           sale_group = g
     WHERE id = (r ->> 'id')::uuid AND status = 'bought' AND disposal IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Not one of your things still yours: %', r ->> 'id'; END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_keep, '[]'::jsonb)) LOOP
    UPDATE public.shop_items SET accessory_of = NULLIF(r ->> 'move_to', '')::uuid WHERE id = (r ->> 'id')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Not one of your things: %', r ->> 'id'; END IF;
  END LOOP;
  IF p_to IS NOT NULL THEN
    INSERT INTO public.shop_item_links (from_id, to_id, amount) VALUES (main, p_to, p_to_amount)
    ON CONFLICT (from_id, to_id) DO UPDATE SET amount = EXCLUDED.amount;
  END IF;
  RETURN g;
END;
$$;

-- Undo a sale: the thing (and everything sold with it) is yours again. Links stay — they read as plans.
CREATE OR REPLACE FUNCTION public.shop_undo_sale(p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE g uuid; n int;
BEGIN
  SELECT sale_group INTO g FROM public.shop_items WHERE id = p_id AND disposal IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not sold or gone'; END IF;
  UPDATE public.shop_items SET disposal = NULL WHERE id = p_id OR (g IS NOT NULL AND sale_group = g);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Delete with Undo: returns everything needed to put the rows back exactly —
-- their links and costs (which the delete cascades away) and the children
-- (accessories, models) whose parent pointer the delete sets to NULL.
CREATE OR REPLACE FUNCTION public.shop_delete_items(p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE snap jsonb;
BEGIN
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.shop_items i WHERE i.id = ANY (p_ids)), '[]'::jsonb),
    'links', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.shop_item_links l WHERE l.from_id = ANY (p_ids) OR l.to_id = ANY (p_ids)), '[]'::jsonb),
    'costs', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.shop_item_costs c WHERE c.item_id = ANY (p_ids)), '[]'::jsonb),
    'children', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'accessory_of', i.accessory_of, 'option_for', i.option_for))
                          FROM public.shop_items i
                          WHERE NOT (i.id = ANY (p_ids)) AND (i.accessory_of = ANY (p_ids) OR i.option_for = ANY (p_ids))), '[]'::jsonb)
  ) INTO snap;
  DELETE FROM public.shop_items WHERE id = ANY (p_ids);
  RETURN snap;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_restore_items(p_snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE c jsonb;
BEGIN
  -- Parents before children (a restored accessory's item, a model's wish).
  INSERT INTO public.shop_items
  SELECT * FROM jsonb_populate_recordset(NULL::public.shop_items, p_snapshot -> 'items') r
   ORDER BY (r.accessory_of IS NOT NULL OR r.option_for IS NOT NULL), r.created_at;
  INSERT INTO public.shop_item_costs SELECT * FROM jsonb_populate_recordset(NULL::public.shop_item_costs, COALESCE(p_snapshot -> 'costs', '[]'::jsonb));
  INSERT INTO public.shop_item_links SELECT * FROM jsonb_populate_recordset(NULL::public.shop_item_links, COALESCE(p_snapshot -> 'links', '[]'::jsonb))
  ON CONFLICT DO NOTHING;
  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_snapshot -> 'children', '[]'::jsonb)) LOOP
    UPDATE public.shop_items
       SET accessory_of = COALESCE(accessory_of, NULLIF(c ->> 'accessory_of', '')::uuid),
           option_for   = COALESCE(option_for,   NULLIF(c ->> 'option_for', '')::uuid)
     WHERE id = (c ->> 'id')::uuid AND accessory_of IS NULL AND option_for IS NULL;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.shop_record_sale(jsonb, text, date, text, text, jsonb, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_undo_sale(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_delete_items(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_restore_items(jsonb) TO authenticated;

-- ─── 9. Purchase days 134 guessed ───────────────────────────────────────────
-- 134 filled bought_at from the last edit of rows already bought (the only
-- date on record); those rows still carry the copy (bought_at = updated_at,
-- before 134 existed). Their day — and the rate day — is a guess: mark it.
UPDATE public.shop_items
   SET approx_dates = true
 WHERE status = 'bought' AND list = 'wishlist' AND NOT approx_dates
   AND bought_at = updated_at AND bought_at < '2026-10-07 00:00+02';

-- ─── 10. The daily check ────────────────────────────────────────────────────
SELECT cron.unschedule('lascis-shop-prices') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lascis-shop-prices');
SELECT cron.schedule('lascis-shop-prices', '23 5 * * *', $cron$
  select net.http_post(
    url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/shop-price',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'SHOP_PRICE_CRON_SECRET'), '')
    ),
    body := '{"action":"sweep"}'::jsonb
  );
$cron$);

COMMENT ON TABLE public.shop_item_links IS
  'Shop money chains: to_id was paid (partly) with the money from selling from_id (amount = how much, in from''s sale currency; NULL = the rest, shared by price). A link to a wish or from a thing still owned is a plan.';
COMMENT ON TABLE public.shop_item_costs IS
  'Extra costs on a Shop item (repairs, shipping, fees, AppleCare; a rebate is negative), each with its own day and NOK rate.';
COMMENT ON TABLE public.fx_rates_nok IS
  'Norges Bank daily exchange rates to NOK (TRY, EUR, USD), one row per calendar day (weekends carry the last business day). Written by the shop-price function.';
COMMENT ON TABLE public.shop_price_watch IS
  'The last price read of each Shop row''s link (Prisjakt''s lowest / a shop''s own price), written by the shop-price function.';
COMMENT ON TABLE public.shop_price_points IS
  'One row per price read of a Shop row''s link — the history behind shop_price_watch.';
