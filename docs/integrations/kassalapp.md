# Kassalapp

Checked: 10.11.2026 against Kassalapp's own documentation, all read that day: the API page https://kassal.app/api (endpoints with examples), its questions and answers https://kassal.app/api/faq, and the OpenAPI 3.1 description https://kassal.app/docs/api.json ("Kassalapp", version 0.0.1 — the machine-readable list of endpoints and fields). **No live sample**: a development session has no Kassalapp key, so every field below is as Kassalapp's own pages and spec show it, and the code checks each one where it enters (`groceryHit`, `num`, the `prices` mapping and the `<grocery-ean>` block in `food-search`; `groceryHitOf` in the app). The `/products/ean/{ean}` answer the scan reads (step C, 10.11.2026) is the API page's own example, saved as `scripts/fixtures/kassalapp/products-ean-example.json` (Grandiosa, EAN 7039010019828), and the spec's `ProductComparisonResource` / `ProductComparisonItemResource`; `verify-shop-quick` runs the function's mapping on both. Earlier checks: 07.10.2026 and 08.10.2026 against the same API page (`food-search`'s header).

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
| `GET /products?search=<words>&size=12&unique=true&exclude_without_ean=true` | `food-search` mode `grocery_search` (`groceryApi.searchGroceries`) | the quick list's Find a price sheet, as you type (from three letters, Kassalapp's minimum — `SEARCH_MIN_CHARS`; 350 ms after the last key; each query cached an hour) | `search` at least 3 characters (spec); `size` up to 100 |
| `GET /products/ean/<ean>` | `food-search` mode `grocery_ean` (`groceryApi.lookUpGroceryEan`, `useScanLookup`; step C, 10.11.2026) | a barcode scanned or typed in the quick list's add box (each code cached an hour) | the EAN must be 8–14 digits as sent — the function refuses anything else (400 `bad_ean`) before it builds the address, and the app never sends it (`scanEan`) |
| `POST /products/prices-bulk` `{ "eans": [ … ], "days": 1, "aggregation": "min" }` | `food-search` mode `grocery_prices` (`groceryApi.fetchGroceryPrices`) | the quick list: every matched row's EAN in one call (cached an hour) | at most 100 EANs a call; unknown EANs are left out of the answer |
| `GET /products?search=<words>&size=20` | `food-search` with `{ search }` (`kassalappApi.searchBrandedFoods`) | Food's online search (Log food, Ingredients) | as above |
| `GET /products/ean/<ean>` | `food-search` with `{ ean }` (Food's shape, digits cleaned) | the function has it; nothing in the app calls it at 71275e6c (a scanned food goes to Open Food Facts) | |

**Rate limit** (FAQ): 60 calls a minute per account on Hobby — shared by every key on the account; each answer carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`; over the limit, HTTP 429 with a `Retry-After` header (seconds to wait). The app spends little: one bulk call prices the whole list, and searches and prices are cached an hour. A 429 reaches the app like any failed call (below).

## Fields we read and write

| Field | Shape (Kassalapp's docs and spec, 10.11.2026) | Where it goes |
|---|---|---|
| search `data[]` | one row per product listing — not per product (FAQ); `unique=true` keeps one per EAN | one `GroceryHit` each |
| `ean` | text or `null`; rows without one are left out (`exclude_without_ean=true`, then a second check) | `GroceryHit.ean`, digits only → the row's `shop_items.ean` when picked (`matchPatch`), kept by Buy again |
| `name`, `brand` | text; `brand` may be `null` | the Find a price list; a scan's new row takes `name` as its title |
| `image` | a URL at the chain's web shop, or `null` | the row's `image_url` — only a public web link, made https (`webPicture`), only when the row has none (or has exactly the old product's, on Change product) — shown small at the row's end |
| `current_price` | a number or `null` (spec; `89.9` in the docs example); an object with `price` is read too | `GroceryHit.price`, shown as "<price> at <chain>" in Find a price |
| `store` | `{ name, code, url, logo }` or `null` (docs example and FAQ; the spec says a list) | `GroceryHit.store` = `store.name` |
| prices-bulk `data[]`: `ean`, `name` | text | one `GroceryPrice` per EAN |
| `stores[]`: `store`, `name` | a chain code (`"MENY_NO"`, `"SPAR_NO"`, `"JOKER_NO"`, `"KIWI"`, `"REMA_1000"`) and a display name (`"Joker"`, `"SPAR"`) | `GroceryStorePrice.code` / `.name` → `chainName` ("SPAR" → "Spar") |
| `stores[].current_price` | a number or `null` (spec); text in the docs example (`"89.90"`) | `.price` (`num` reads both); a store without a code or a price is dropped |
| `stores[].last_checked` | ISO time (`"2026-10-23T07:00:40.000000Z"`) or `null` | `.checked` → whether the price counts at all (`isCurrent`: checked today or on one of the 14 Oslo days before; none or unreadable = left out) and the basket's "Prices from DD.MM.YYYY · Kassalapp" (the oldest Oslo day used) |
| ean `data.ean` | text or `null` (spec); `"7039010019828"` in the example | must be 8–14 digits and the EAN asked for (leading zeros aside), else no hit; `null` = the EAN asked for → `GroceryHit.ean` (Kassalapp's own spelling, so `prices-bulk` meets it) |
| ean `data.products[]` | one row per chain listing the product (the example: Meny and Spar) | only objects with a name count; the row with the newest `current_price.date` gives the name, brand, price and chain (the first named row when none has a date) |
| `products[].name`, `.brand` | text; `brand` may be `null` | text only, trimmed, at most 300 characters → the scanned row's title, `GroceryHit.brand` |
| `products[].image` | a URL at the chain's web shop (`https://res.cloudinary.com/norgesgruppen/…/7039010019828.jpg`) or `null` | only a web link on a public host, made https, of up to 2 048 characters (`webPicture`: no user/password, IP address, localhost, .local or single-label host), the chosen row's, else another chain's → the new row's `image_url` |
| `products[].store` | `{ name, code, url, logo }` in the example; a list of those or `null` in the spec | an object or a list's first; `name` as text ≤ 100 → `GroceryHit.store` (`logo` is `http://localhost/…` in the example — never used) |
| `products[].current_price` | `{ price, unit_price, date }` in the example; a list of those or `null` in the spec | an object or a list's first; `price` an amount from 0 up to below 10 000 000 (a number, or digits as text), `date` only as an ISO time — it only picks the row; the hit's price never counts (the chain prices come from `prices-bulk`) |

What the quick list makes of them (`groceryModel.ts`): the cheapest chain per row ("Cheapest now", every chain in its hover), a row's picture (`matchPatch`: the product's when the row has none), where the whole list is cheapest in one line at the top of the basket ("Cheapest for the whole list: Oda · 137.70 NOK", `wholeList`), and a basket per chain — full baskets first, then the total, with what each other chain is missing. Only current prices count (above); one line under "Prices from" says how many old ones were left out and why ("2 old prices left out — not checked in 14 days": one per product and chain that had nothing newer), and a tap on it names the chains (Kiwi, Rema 1000) — a list of Coop chains was cut on a phone.

Nothing is written to Kassalapp. Our only stored copy is the picked EAN (and maybe the picture's URL) on the row.

## Fields we deliberately don't use

- `price_history` (search and bulk), `current_unit_price` / `current_unit_price_unit`, `weight` / `weight_unit`, bulk `meta` (`requested_eans`, `found_products`, `days_included`, `is_premium`), the search's `links` / `meta` pages: the quick list shows today's price per chain only (`days: 1` keeps the history short).
- `vendor`, `category`, `description`, `ingredients`, `allergens`, `labels`, `is_medicine`, `created_at`, `updated_at`: nothing on screen uses them (and the FAQ warns `updated_at` also changes with a new name or picture — never a price's date).
- The ean answer's `nutrition`, `allergens`, `labels`, `products[].id`, `.url`, `.kassalapp`, `.weight` / `.weight_unit`, `.price_history`, `current_price.unit_price` and `store.code` / `.url` / `.logo`: a scan only needs the product's name, EAN and picture (Food's own `{ ean }` lookup reads the nutrition).
- Allergens and nutrition for health warnings: the FAQ says they come from supplier data, may be incomplete and are "kun til informasjon". Food reads nutrition as label values only (`docs/features/food.md`).
- The other endpoints: `/physical-stores`, `/products/id/{id}`, `/products/find-by-url/…`, `/categories`, `/labels`, `/webhooks` (a `price.updated` call when a price changes), `/shopping-lists`.

## Traps

- **REMA 1000, Kiwi and Coop have no current prices — but their old prices still come back.** FAQ, 10.11.2026: «Har dere priser fra Rema 1000, Kiwi og Coop? Nei. Disse kjedene har ingen nettbutikk med åpne priser … Du vil likevel finne eldre produkter fra Rema 1000, Kiwi og Coop i API-et. Produkter slettes aldri, så disse viser den siste prisen vi registrerte, ofte fra 2024. Sjekk alltid når prisen sist ble kontrollert før du stoler på den.» Prices are read daily only from Meny, Spar and Joker; Oda; Bunnpris; Europris; Engrosnett; Havaristen and Holdbart; Fudi, Leske and FastCandy. kassal.app itself counts a price as out of date when it hasn't been checked for 14 days, and so does the quick list (10.11.2026): a chain's price counts for "Cheapest now", a row's chip and the per-chain baskets only when its `last_checked` falls on today or one of the 14 Oslo days before (`groceryModel.isCurrent` — 14 days old counts, 15 doesn't; no date, an unreadable one or one after today doesn't count), and the basket names what it left out in one line under "Prices from". `food-search` passes every price on as Kassalapp gives it. Find a price's "<price> at <chain>" under each search hit is still the hit's own price: `groceryHit` reads no check date, so an old listing's price can show there — it only helps pick the product and never counts. Not seen live (no key).
- **`search` needs at least 3 characters** (spec: `minLength: 3`; a 422 answer otherwise). Find a price and `useGrocerySearch` search from three (`SEARCH_MIN_CHARS`, 10.11.2026): "øl" or "te" says "Type at least three letters." and asks Kassalapp nothing. Food's online search still sends what is typed; a 422 there only drops Kassalapp's results (Open Food Facts' show). Not tried live.
- **The search matches names only — a scan asks by EAN.** The spec says `search` "only applies to `name` of a product"; the FAQ points barcodes to `/products/ean/{ean}`. Until step C (10.11.2026) `useScanLookup` sent the EAN as search words, which can't have found anything; it now asks `food-search`'s `grocery_ean`. The answer must carry the scanned EAN (`scanMatch`, leading zeros aside). **Not tried live** (no key): the shape is the API page's example and the spec only.
- **An unknown EAN**: the spec lists only 200 and 401 for `/products/ean/{ean}`; a Laravel-style 404 is read as "no product" (an empty list, "No product found for barcode …"), and so is a 200 with no named product row. Any other failure is `error: 'kassalapp <status>'`, as for the other modes. Unconfirmed which one Kassalapp sends.
- **UPC-A and EAN-13**: a 12-digit UPC-A is sent as scanned; whether Kassalapp also finds it under its 13-digit form (a leading 0) is unconfirmed. `scanMatch` and the function accept either spelling of the same number in the answer.
- **Shapes differ between Kassalapp's docs and its spec**: bulk `current_price` is text in the docs example and a number in the spec (`num` reads both); the search's `store` is an object or `null` in the docs and the FAQ but a list in the spec (read as an object; a list would only lose the store name in Find a price); the ean answer's `store` and `current_price` are objects in the example and lists (or `null`) in the spec — `grocery_ean` reads both (`oneObject`), and `verify-shop-quick` runs it on each.
- **What `days` covers.** The docs tie `days` and `aggregation` to `price_history` ("Number of days of price history to include", the lowest price of each day); whether `days: 1` also leaves out `stores[]` entries checked longer ago isn't stated — unconfirmed.
- **Prices change once a day**: fetched from about 09:00 Norwegian time, taking a couple of hours; the FAQ suggests caching answers for six hours ("hyppigere oppslag gir deg ikke nyere data, bare mer trafikk"). We cache an hour.
- **Per chain, never per shop; no flyer campaigns or member prices** (no Trumf, Æ or Coop Medlem prices — FAQ). The chain's web-shop price usually matches the shelf, not always.
- **Pictures belong to the chains**: image URLs point at the chains' web shops; Kassalapp has no rights to them, and they can change or disappear (FAQ). A row keeps such a link as its picture — only a web link on a public host, made https (`webPicture`, and the database's `shop_web_link`), only when the row had none; one that stops loading shows nothing on the row (`RowPicture`), never a stand-in photo. Loading one asks the chain's server, with no referrer.
- **Kassalapp logs every call** — endpoint, parameters and time, search words and barcodes included (FAQ; servers in Helsinki, inside the EU/EEA): what is typed in Find a price reaches their logs. Nothing else about the owner is sent.
- **A failed call still answers 200**: `food-search` turns any non-2xx answer from Kassalapp into `error: 'kassalapp <status>'` in a 200 answer, and the app says "Kassalapp did not answer — try again in a moment." without retrying (`retry: false`). For Food the error is dropped and Open Food Facts' results show alone.
- A chain can list one EAN twice (two pack sizes): each chain's lowest counts (`byChain`).

## Log

### 10.11.2026 — step C: the scan by EAN, pictures, the whole list

`food-search` mode `grocery_ean` (`GET /products/ean/{ean}`, the Bearer key server-side; the caller still checked with `auth.getUser` + `isAppUser` first; the EAN 8–14 digits as sent before it goes into the address; every field checked in the `<grocery-ean>` block), and `useScanLookup` points at it instead of the name search. Its shape: the API page's example (saved as a fixture) and the spec — **no live sample**. Everything else the function does is unchanged (`kassal`'s errors now carry their status, with the same message). The app checks every hit where it enters (`groceryHitOf`, Find a price's hits too), takes a product's picture only as a web link, and the basket answers where the whole list is cheapest on current prices only. Fixed here: the trap "A scan searches by name".

### 10.11.2026 — old prices left out, search from three letters

The fix for the first two traps above, from the FAQ and the spec (no live sample, no key): a price counts only when Kassalapp checked it today or on one of the 14 Oslo days before (`groceryModel.isCurrent`, every price through `byChain`; no date = left out), so REMA 1000, Kiwi and Coop's old prices no longer make "Cheapest now", a row's chip or a basket, and the basket says what it left out ("2 old prices left out (Kiwi, Rema 1000)"; since the review the same day: "2 old prices left out — not checked in 14 days", the chains on a tap); "Prices from" reads the Oslo day. Find a price searches from three characters ("Type at least three letters."). Wrong claims corrected: `groceryModel.ts`'s header, the basket card's and `groceryApi`'s comments, the API registry (purpose and caveat), `food-search`'s header comment (its behaviour is unchanged) and `docs/features/shop.md`. The scan lookup by EAN stays open (phase 5).

### 10.11.2026 — this page

Written from the code at 71275e6c and checked against Kassalapp's API page, FAQ and OpenAPI spec (no live sample, no key); no code changed. Found: REMA 1000, Kiwi and Coop prices still come back, often from 2024 (`groceryModel.ts` and the API registry say Kiwi and Coop are followed and REMA never appears); `search` needs 3 characters (we search from 2); `search` matches names only (the scan lookup searches by EAN); the docs and the spec disagree on two shapes.

### 08.10.2026 — Shop's quick list (migration 137)

`grocery_search` and `grocery_prices` added to `food-search`, the bulk shape from the API page's example; the matched EAN is kept on `shop_items.ean`.

### 19.07.2026 — first use

Food's online search through `food-search` (name search; the `/products/ean` answer and the nutrition codes were checked against the API page on 07.10.2026).
