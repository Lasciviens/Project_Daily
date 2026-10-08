-- 138 · Shop: a money chain can have a name.
--
-- A chain is derived (things joined by "Paid with money from" links), so its
-- name lives on one of its things: the oldest thing when it is named, after
-- that wherever the name already is. When two named chains join, the older
-- thing's name wins (the other stays on its row, unused). Restoring a
-- deleted row (shop_restore_items) brings the name back with it, since that
-- copies the whole row.
--
-- Updates no row.

ALTER TABLE public.shop_items
  ADD COLUMN IF NOT EXISTS chain_name text;

ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_chain_name_check;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_chain_name_check
  CHECK (chain_name IS NULL OR (char_length(btrim(chain_name)) BETWEEN 1 AND 80));

COMMENT ON COLUMN public.shop_items.chain_name IS
  'The name of the money chain this thing starts (or carries the name for). Shown wherever the chain is.';
