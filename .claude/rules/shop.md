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
- `shop_price_watch`/`shop_price_points` are written only by `shop-price` (Delete's Undo puts them back through `shop_restore_price_history`), never `shop_items`.
- `priceRead.ts` and `fxNorgesBank.ts` are hand-mirrored into `shop-price` (their verify scripts compare them).
- Never read a site whose terms forbid automated reading: the list is data — `shop_site_policies` (188), a host or its subdomains — never a store name in code (owner, 10.11.2026). `shop-price` checks it before every fetch and every redirect hop, in `read`, `check` and the sweep, and fails closed when it can't read it; the answer is `not_allowed`, shown in plain words with the link to open it yourself.
- Read a page only where its site's robots.txt allows it — every site, every request (`read`, `check`, the sweep, each redirect hop), through the page fetch's own guards; never a site name in code. A disallowed path is `not_allowed` in the robots wording ("…'s robots rules don't allow reading this page", never the terms' wording); a robots.txt that can't be read means "not read now" (`error`), never "allowed"; a 4xx means no rules (RFC 9309).
- Each page is read at most once a day (the sweep, 20 h) and at most once an hour for what the owner starts: paste, save and Check now reuse the last hour's read (a watch of the same link, or the in-memory read by account and exact link) and say so — never a second fetch to "refresh". The sweep never asks again a link whose last answer was `blocked` or `not_allowed` while it is unchanged (Check now still may); don't list a store in `shop_site_policies` only because it blocks bots — that list is for terms that forbid reading.
- Prisjakt's price now is its new offers only (its own offer list; its schema.org figures mix in refurbished and used ones). Every watch and point says what its price covers (`condition`: new, mixed, unknown; NULL = before 188) — a later "lowest seen" compares like with like and leaves NULL Prisjakt points out; a price of another kind starts its own trend. `used_low` / `refurbished_low` are offers seen, never a "Could sell for".
- Never invent a price, a sale price or a "Could sell for".
- Stats follows the picked period (owner, 09.11.2026): a year is seen from 31.12 (today for this year), each card names it, and the definitions live in pure `statsModel.ts` (`periodOf`, `ownedAt`, `costOfUseIn`). "Could sell for" has no history: a past year knows it only for things still yours today — say so, never fill it in.
- A profit (made money, a chain ahead) is green — the success tone — on every screen (owner, 09.11.2026; before, only for things bought to sell). A loss on a thing you use is its cost of use: neutral, never red. A chain's running result has the header's sign: + ahead, − a net cost.
- Owned's summary is one line right above the list (owner, 09.11.2026 — no card): it sums what the list shows, the filters and Mine · Sold or gone · All (`shownSummary`), and a tap opens Stats on the same things (`statsScopeOf`). Mine · Sold or gone · All is a tab, never counted as a filter. Stats' "You own" keeps the whole collection (`ownedSummary`).
- Selling and adding an accessory live in the record, not on the Owned cards; Owned's ways to add live in the page header, not in the rail (owner, 14.10.2026) — on a phone in the row right under its bar, with Things | Stats, so the bar keeps one row on every view (03.11.2026).
