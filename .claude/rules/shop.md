---
paths:
  - "src/features/shop/**"
  - "supabase/functions/shop-price/**"
---
# Shop rules

Background: `docs/features/shop.md`.

- Every purchase, sale and cost is NOK at the rate of its own day, frozen on the row by the database; a missing rate is "rate pending", never today's rate. Today's rates only for values of now.
- A possession is `list='wishlist' AND kind='item' AND status='bought'` and kept (`ownModel.isPossession`); quick-list ticks never are.
- Selling never deletes: it writes the disposal facts (one `shop_record_sale` call, Undo `shop_undo_sale`); accessories sold together share a `sale_group`.
- Deleting a shop item takes the accessories bought for it (`shopModel.deleteScope`), the same from every screen.
- `shop_price_watch`/`shop_price_points` are written only by `shop-price`, never `shop_items`.
- `priceRead.ts` and `fxNorgesBank.ts` are hand-mirrored into `shop-price` (their verify scripts compare them).
- Never invent a price, a sale price or a "Could sell for".
- Owned's "What I own" sums what the list shows — the filters and Mine · Sold or gone · All (`shownSummary`); Stats keeps the whole collection (`ownedSummary`).
- Selling and adding an accessory live in the record, not on the Owned cards; Owned's ways to add live in the page header, not in the rail (owner, 14.10.2026).
