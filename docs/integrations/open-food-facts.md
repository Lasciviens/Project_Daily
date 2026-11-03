# Open Food Facts

Checked: 03.11.2026 against OFF's own API docs (`docs/api/index.md` → Search and rate limits, `docs/api/ref/api.yaml` → search, in github.com/openfoodfacts/openfoodfacts-server) and live answers for the searches "skyr" (`/api/v2/search` and `/cgi/search.pl`) and "peanut butter" (`/cgi/search.pl`).

Open Food Facts (OFF) is a free, open product database. The browser reads it directly for two things: a scanned barcode → one product, and the online name search in Log food and Food → Ingredients (`OnlineFoodSearch`, shown after Kassalapp's Norwegian results).

## How we authenticate
No key and no account: every request is anonymous. OFF's answers are CORS-open (`access-control-allow-origin: *` — the header that lets a page on another site, here GitHub Pages, read the answer), so no edge function sits in between. Requests send `User-Agent: LascisBoard/1.0 (personal food tracker)`, as OFF asks (a browser may leave it out).

## Endpoints we call
| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET https://world.openfoodfacts.org/api/v2/product/<barcode>.json?fields=…` | `openFoodFactsApi.lookupBarcode` | a scanned or typed barcode | 15 product reads / min per IP |
| `GET https://world.openfoodfacts.org/cgi/search.pl?search_terms=<words>&search_simple=1&action=process&json=1&fields=…&page_size=20&sort_by=popularity_key` | `openFoodFactsApi.searchFoodsByName` | the Search button of `OnlineFoodSearch` (never search-as-you-type) | 10 searches / min per IP; 503 under load |

The Scriptable food logger (`docs/scriptable-food-logger.md`) calls the same `/cgi/search.pl` form from the iPhone.

## Fields we read and write
| Field | Shape seen (03.11.2026) | Where it goes |
|---|---|---|
| `products[]` (search), `product` + `status` (barcode) | an array of objects; one object, `status: 0` = not found | one `BarcodeProduct` each |
| `code` | `"3329770077003"` (a string) | `code` |
| `product_name_en`, `product_name` | `"Skyr nature 0%"`; either may be missing or `""` | `name`: English first, then the main name, then the brand |
| `brands` | one comma-separated string: `"Milky Food Professional, SODIPOL"` | `brand` |
| `nutriments["energy-kcal_100g"]` (else `energy_100g` in kJ ÷ 4.184), `proteins_100g`, `carbohydrates_100g`, `fat_100g`, `sugars_100g`, `fiber_100g` | numbers per 100 g, often missing | the per-100 g macros; a search result without kcal is dropped |
| `serving_size`, `serving_quantity` | `"150 g"`, `150` | the portion preset |
| `image_front_url` (else `image_url`) | an image URL | `image_url` |

A search result is kept only when its `product_name_en`, `product_name` and `brands` together contain every typed word (`foodSearch.containsEveryWord`: folded like the library search, so "brod" finds "Brød" and "kylling" finds "Kyllingfilet"). Nothing is written to OFF.

## Fields we deliberately don't use
- `generic_name`, `categories`, `labels`, `_keywords`: the word check reads only what the owner sees (the names and the brand). A product that matched through its category is exactly what looked wrong ("Fromage Blanc Nature" for "skyr").
- Nutri-Score, Eco-Score, NOVA, ingredients and allergens: nothing on screen uses them.
- `nutriments_estimated`, `nutrition_data`, `nutrition_data_per`, `nutrition_data_prepared_per`: `/cgi/search.pl` sends them without being asked; ignored.

## Traps
- **`/api/v2/search` has no word search.** It ignores `search_terms` without an error and returns the whole database sorted by `sort_by` — with `popularity_key`, the most-scanned products, the same for every query (live "skyr": `count` 4,892,295). OFF's docs: "search API v2 does not support full text request (search_term), you have to use search API v1"; full-text search is "Legacy `/cgi/search.pl` only" until Search-a-licious.
- `/cgi/search.pl` ranks by popularity, not by match: for "skyr" its top 20 started with "Fromage Blanc Nature" and other fresh cheeses, and only 6 contained "skyr". Hence the word check.
- Search-a-licious (`search.openfoodfacts.org/search?q=…`) ranks by match, but it serves only its own list of sites: no `access-control-allow-origin` for ours, and a preflight (the browser's permission check before a request) answers 400. Using it would need an edge function. Its `brands` is an array, not a string.
- Under load OFF answers 503 with an HTML page ("unusually high demand, or the page you requested is not available to anonymous users"): about half of the searches on 03.11.2026, on v1 and v2 alike. That page has no CORS header, so a browser sees a failed request, not status 503: the code's 503 retry and its "busy" message run only outside the browser (not changed on 03.11.2026).
- OFF's limit is 10 searches / min per IP, and it warns that search-as-you-type gets an IP blocked quickly.

## Log
### 03.11.2026 — the online search asked an endpoint that ignores the words
The owner saw the same three products in every online search: "Fromage Blanc Nature" (Milky Food Professional, SODIPOL), "sidi ali" (LES EAUX MINERALES D'OULMES) and "Perly" (COOPERATIVE AGRICOLE COPAG, Jaouda). `searchFoodsByName` called `/api/v2/search?search_terms=…`, which ignores the words: live, "skyr" returned the whole database (count 4,892,295) sorted by popularity, with exactly those three on top. Kassalapp's rows come first, and the places left of the 20 went to OFF's most-scanned products. Fixed: the search asks `/cgi/search.pl` (live "skyr": 4,341 hits) and keeps only products whose names or brand contain every typed word (live, through the real module: "skyr" → 6 skyr products, "peanut butter" → 15 peanut butters). `scripts/verify-food-search.cjs` section 6 feeds the real module both answers. The barcode lookup is unchanged.

- 03.11.2026 (review) — A busy 503 page carries no CORS header, so a browser's `fetch` throws instead of answering 503: `searchFoodsByName` retries such a failure like a 503 (3 tries), then says OFF is busy. It asks for `page_size=50` (20 left about 6 after the word check). A number alone in the query ("skyr 0%", "cola 0") is never required by the word check — names write it their own way.
