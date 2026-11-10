# Kassalapp

Checked: 10.11.2026 against Kassalapp's own documentation, all read that day: the API page https://kassal.app/api (endpoints with examples), its questions and answers https://kassal.app/api/faq, and the OpenAPI 3.1 description https://kassal.app/docs/api.json ("Kassalapp", version 0.0.1 — the machine-readable list of endpoints and fields). **No live sample**: a development session has no Kassalapp key, so every field below is as Kassalapp's own pages and spec show it, and the code checks each one where it enters (`groceryHit`, `num` and the `prices` mapping in `food-search`). Earlier checks: 07.10.2026 and 08.10.2026 against the same API page (`food-search`'s header).

Kassalapp (kassal.app) is a Norwegian database of groceries, their prices per chain and their nutrition. Shop's quick list uses it to find the product (its EAN, the barcode number) behind a row and to price every matched row at every chain it has; Food uses the same function for its online name search. The key is a personal one on Kassalapp's free Hobby plan. How the quick list works: `docs/features/shop.md`; Food's use: `docs/features/food.md`.

## How we authenticate

- **A personal API key**, made on kassal.app (the API page under the profile) and sent as a Bearer token — `Authorization: Bearer <key>` — on every call (the FAQ's "Hvordan får jeg tilgang til API-et?"; the spec's `http` bearer scheme). Never in a URL, never logged.
- **Stored on the server only**, as the secret `KASSALAPP_API_KEY` (`docs/backend/environment.md`); `food-search` reads it with `Deno.env.get` and the browser never sees it. Without it the Shop modes answer `error: 'not_configured'` (the app says "Grocery prices need the Kassalapp key on the server (KASSALAPP_API_KEY).") and the Food search answers an empty list.
- **Who may call `food-search`**: platform JWT verification is on (the function is not in `supabase/config.toml`), then `auth.getUser` and `isAppUser`.
- **The plan**: Hobby — free, no commercial use; the FAQ names "et privat verktøy" (a private tool) among the uses it allows.

## Endpoints we call

Base `https://kassal.app/api/v1`.

| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET /products?search=<words>&size=12&unique=true&exclude_without_ean=true` | `food-search` mode `grocery_search` (`groceryApi.searchGroceries`) | the quick list's Find a price sheet, as you type (from three letters, Kassalapp's minimum — `SEARCH_MIN_CHARS`; 350 ms after the last key; each query cached an hour); a scanned barcode (`useScanLookup` sends the code as the search words) | `search` at least 3 characters (spec); `size` up to 100 |
| `POST /products/prices-bulk` `{ "eans": [ … ], "days": 1, "aggregation": "min" }` | `food-search` mode `grocery_prices` (`groceryApi.fetchGroceryPrices`) | the quick list: every matched row's EAN in one call (cached an hour) | at most 100 EANs a call; unknown EANs are left out of the answer |
| `GET /products?search=<words>&size=20` | `food-search` with `{ search }` (`kassalappApi.searchBrandedFoods`) | Food's online search (Log food, Ingredients) | as above |
| `GET /products/ean/<ean>` | `food-search` with `{ ean }` | the function has it; nothing in the app calls it at 71275e6c (a scanned food goes to Open Food Facts) | |

**Rate limit** (FAQ): 60 calls a minute per account on Hobby — shared by every key on the account; each answer carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`; over the limit, HTTP 429 with a `Retry-After` header (seconds to wait). The app spends little: one bulk call prices the whole list, and searches and prices are cached an hour. A 429 reaches the app like any failed call (below).

## Fields we read and write

| Field | Shape (Kassalapp's docs and spec, 10.11.2026) | Where it goes |
|---|---|---|
| search `data[]` | one row per product listing — not per product (FAQ); `unique=true` keeps one per EAN | one `GroceryHit` each |
| `ean` | text or `null`; rows without one are left out (`exclude_without_ean=true`, then a second check) | `GroceryHit.ean`, digits only → the row's `shop_items.ean` when picked (`matchPatch`), kept by Buy again |
| `name`, `brand` | text; `brand` may be `null` | the Find a price list; a scan's new row takes `name` as its title |
| `image` | a URL at the chain's web shop, or `null` | the row's `image_url`, only when it has none |
| `current_price` | a number or `null` (spec; `89.9` in the docs example); an object with `price` is read too | `GroceryHit.price`, shown as "<price> at <chain>" in Find a price |
| `store` | `{ name, code, url, logo }` or `null` (docs example and FAQ; the spec says a list) | `GroceryHit.store` = `store.name` |
| prices-bulk `data[]`: `ean`, `name` | text | one `GroceryPrice` per EAN |
| `stores[]`: `store`, `name` | a chain code (`"MENY_NO"`, `"SPAR_NO"`, `"JOKER_NO"`, `"KIWI"`, `"REMA_1000"`) and a display name (`"Joker"`, `"SPAR"`) | `GroceryStorePrice.code` / `.name` → `chainName` ("SPAR" → "Spar") |
| `stores[].current_price` | a number or `null` (spec); text in the docs example (`"89.90"`) | `.price` (`num` reads both); a store without a code or a price is dropped |
| `stores[].last_checked` | ISO time (`"2026-10-23T07:00:40.000000Z"`) or `null` | `.checked` → whether the price counts at all (`isCurrent`: checked today or on one of the 14 Oslo days before; none or unreadable = left out) and the basket's "Prices from DD.MM.YYYY · Kassalapp" (the oldest Oslo day used) |

What the quick list makes of them (`groceryModel.ts`): the cheapest chain per row ("Cheapest now", every chain in its hover), and a basket per chain — full baskets first, then the total, with what each other chain is missing. Only current prices count (above); one line under "Prices from" names the old ones left out ("2 old prices left out (Kiwi, Rema 1000)": one per product and chain that had nothing newer).

Nothing is written to Kassalapp. Our only stored copy is the picked EAN (and maybe the picture's URL) on the row.

## Fields we deliberately don't use

- `price_history` (search and bulk), `current_unit_price` / `current_unit_price_unit`, `weight` / `weight_unit`, bulk `meta` (`requested_eans`, `found_products`, `days_included`, `is_premium`), the search's `links` / `meta` pages: the quick list shows today's price per chain only (`days: 1` keeps the history short).
- `vendor`, `category`, `description`, `ingredients`, `allergens`, `labels`, `is_medicine`, `created_at`, `updated_at`: nothing on screen uses them (and the FAQ warns `updated_at` also changes with a new name or picture — never a price's date).
- Allergens and nutrition for health warnings: the FAQ says they come from supplier data, may be incomplete and are "kun til informasjon". Food reads nutrition as label values only (`docs/features/food.md`).
- The other endpoints: `/physical-stores`, `/products/id/{id}`, `/products/find-by-url/…`, `/categories`, `/labels`, `/webhooks` (a `price.updated` call when a price changes), `/shopping-lists`.

## Traps

- **REMA 1000, Kiwi and Coop have no current prices — but their old prices still come back.** FAQ, 10.11.2026: «Har dere priser fra Rema 1000, Kiwi og Coop? Nei. Disse kjedene har ingen nettbutikk med åpne priser … Du vil likevel finne eldre produkter fra Rema 1000, Kiwi og Coop i API-et. Produkter slettes aldri, så disse viser den siste prisen vi registrerte, ofte fra 2024. Sjekk alltid når prisen sist ble kontrollert før du stoler på den.» Prices are read daily only from Meny, Spar and Joker; Oda; Bunnpris; Europris; Engrosnett; Havaristen and Holdbart; Fudi, Leske and FastCandy. kassal.app itself counts a price as out of date when it hasn't been checked for 14 days, and so does the quick list (10.11.2026): a chain's price counts for "Cheapest now", a row's chip and the per-chain baskets only when its `last_checked` falls on today or one of the 14 Oslo days before (`groceryModel.isCurrent` — 14 days old counts, 15 doesn't; no date, an unreadable one or one after today doesn't count), and the basket names what it left out in one line under "Prices from". `food-search` passes every price on as Kassalapp gives it. Find a price's "<price> at <chain>" under each search hit is still the hit's own price: `groceryHit` reads no check date, so an old listing's price can show there — it only helps pick the product and never counts. Not seen live (no key).
- **`search` needs at least 3 characters** (spec: `minLength: 3`; a 422 answer otherwise). Find a price and `useGrocerySearch` search from three (`SEARCH_MIN_CHARS`, 10.11.2026): "øl" or "te" says "Type at least three letters." and asks Kassalapp nothing. Food's online search still sends what is typed; a 422 there only drops Kassalapp's results (Open Food Facts' show). Not tried live.
- **A scan searches by name.** The spec says `search` "only applies to `name` of a product"; the FAQ points barcodes to `/products/ean/{ean}`. `useScanLookup` sends the EAN as search words — whether that finds the product is unconfirmed (no key). A miss is "no product": `scanMatch` takes only a hit that carries that EAN. Still open: phase 5 (autofill and barcode) — not changed with the 10.11.2026 fix.
- **Shapes differ between Kassalapp's docs and its spec**: bulk `current_price` is text in the docs example and a number in the spec (`num` reads both); the search's `store` is an object or `null` in the docs and the FAQ but a list in the spec (read as an object; a list would only lose the store name in Find a price).
- **What `days` covers.** The docs tie `days` and `aggregation` to `price_history` ("Number of days of price history to include", the lowest price of each day); whether `days: 1` also leaves out `stores[]` entries checked longer ago isn't stated — unconfirmed.
- **Prices change once a day**: fetched from about 09:00 Norwegian time, taking a couple of hours; the FAQ suggests caching answers for six hours ("hyppigere oppslag gir deg ikke nyere data, bare mer trafikk"). We cache an hour.
- **Per chain, never per shop; no flyer campaigns or member prices** (no Trumf, Æ or Coop Medlem prices — FAQ). The chain's web-shop price usually matches the shelf, not always.
- **Pictures belong to the chains**: image URLs point at the chains' web shops; Kassalapp has no rights to them, and they can change or disappear (FAQ). A row keeps such a link as its picture.
- **Kassalapp logs every call** — endpoint, parameters and time, search words and barcodes included (FAQ; servers in Helsinki, inside the EU/EEA): what is typed in Find a price reaches their logs. Nothing else about the owner is sent.
- **A failed call still answers 200**: `food-search` turns any non-2xx answer from Kassalapp into `error: 'kassalapp <status>'` in a 200 answer, and the app says "Kassalapp did not answer — try again in a moment." without retrying (`retry: false`). For Food the error is dropped and Open Food Facts' results show alone.
- A chain can list one EAN twice (two pack sizes): each chain's lowest counts (`byChain`).

## Log

### 10.11.2026 — old prices left out, search from three letters

The fix for the first two traps above, from the FAQ and the spec (no live sample, no key): a price counts only when Kassalapp checked it today or on one of the 14 Oslo days before (`groceryModel.isCurrent`, every price through `byChain`; no date = left out), so REMA 1000, Kiwi and Coop's old prices no longer make "Cheapest now", a row's chip or a basket, and the basket says what it left out ("2 old prices left out (Kiwi, Rema 1000)"); "Prices from" reads the Oslo day. Find a price searches from three characters ("Type at least three letters."). Wrong claims corrected: `groceryModel.ts`'s header, the basket card's and `groceryApi`'s comments, the API registry (purpose and caveat), `food-search`'s header comment (its behaviour is unchanged) and `docs/features/shop.md`. The scan lookup by EAN stays open (phase 5).

### 10.11.2026 — this page

Written from the code at 71275e6c and checked against Kassalapp's API page, FAQ and OpenAPI spec (no live sample, no key); no code changed. Found: REMA 1000, Kiwi and Coop prices still come back, often from 2024 (`groceryModel.ts` and the API registry say Kiwi and Coop are followed and REMA never appears); `search` needs 3 characters (we search from 2); `search` matches names only (the scan lookup searches by EAN); the docs and the spec disagree on two shapes.

### 08.10.2026 — Shop's quick list (migration 137)

`grocery_search` and `grocery_prices` added to `food-search`, the bulk shape from the API page's example; the matched EAN is kept on `shop_items.ean`.

### 19.07.2026 — first use

Food's online search through `food-search` (name search; the `/products/ean` answer and the nutrition codes were checked against the API page on 07.10.2026).
