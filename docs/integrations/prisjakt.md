# Prisjakt and store product pages (schema.org)

Checked: 10.11.2026 — every page named here was read that day, once, with a generic client name (not the app's own): Prisjakt's robots.txt and terms of use; five live product pages, each run through the real `priceRead.ts` — Prisjakt "Kärcher Puzzi 8/1" (`p=11802129`) and "Apple iPhone 15 128GB" (`p=12105524`), Elkjøp's TCL MQLED75K 65-inch TV (`899848`), Power "Kärcher SE 3 Compact Home" (`p-4229993`) and Jernia "Møbel- og tepperenser SE 3 Compact" (`12310223`); the robots.txt of Elkjøp, Power and Jernia; the terms of finn.no and tise.com. The shapes were first checked live on 08.10.2026; trimmed copies of those pages are the fixtures in `scripts/verify-shop-price-read.cjs`.

Shop's price watch reads the price behind a product link: Prisjakt's lowest price, its highest and how many shops sell it — or a store's own price, its struck-out "before" price and its return window. **Neither is an API.** Prisjakt has no public one; we read the schema.org data in the page: a JSON-LD block (structured data in a `<script type="application/ld+json">` tag) that stores and Prisjakt publish for search engines. Best effort: a changed page or a block stops it, and the card then says why. Code: `supabase/functions/shop-price/index.ts` (fetching, the daily sweep) and the parser `src/features/shop/priceRead.ts` (hand-mirrored into the function, `verify-shop-price-read`). How the feature works: `docs/features/shop.md`; its rules: `.claude/rules/shop.md`.

## How we authenticate

- **Nothing to sign in to**: public pages, no account, key or cookie.
- **Who can make `shop-price` read a page**: a browser JWT, checked with `auth.getUser` and then `isAppUser`; or the daily cron's `x-cron-secret` = `SHOP_PRICE_CRON_SECRET` (Edge Function secret and Vault, compared in constant time; acts as `HEVY_USER_ID`; `sweep` only). JWT verification is off for `shop-price` in `supabase/config.toml` (the cron sends none).
- **An honest User-Agent** (the line a program sends to say what it is): `Mozilla/5.0 (compatible; LascisBoard/1.0; +https://lasciviens.github.io/Project_Daily)` — it says it is an automatic reader and names the app; never a browser's line. With it: `Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5` and `Accept-Language: nb-NO,nb;q=0.9,en;q=0.8,tr;q=0.7`.
- **Fetch safety** (the same guard as `news-article`, `verify-ssrf-guard`): http and https only, no user name in the link, private hosts and names that resolve to a private address refused on every redirect (at most 5, followed by hand), 8 s for the whole read, 3 MB, HTML only.

## What the sites allow, and our limits

### Prisjakt's robots.txt

robots.txt is the file in which a site says what automatic readers may fetch. https://www.prisjakt.no/robots.txt, for every reader (`User-agent: *`):
- **Product pages are allowed**: `/product.php?p=<id>` (and `/produkt.php`), with a variant such as `&a-116257=Frost` too. Only `/product.php?o=*&offset=*` and `/product.php?e=*&edit=*` are disallowed.
- **Search is disallowed** (`Disallow: /search?*`), and so are `/redirect.php`, `/go-to-shop`, the price lists (`/prisliste/` …), `/account/*`, `/login` and some category filters (`/c/*?*sort=*` …).
- It sets no crawl delay; ours is below.

### Prisjakt's terms

https://www.prisjakt.no/info/regler-og-retningslinjer-for-brukere--i4 now redirects (`301`) to https://www.prisjakt.no/information/brukervilkar — one page, updated 26.10.2026, in force since 10.06.2025:
- **Automated collection is not allowed, apart from crawling within robots.txt** (unless mandatory law or a separate written agreement with Prisjakt says otherwise): «… er det ikke tillatt å bruke automatisert teknologi (som gjennomgang, skraping og indeksering, for eksempel til tekst- og datautvinningsformål) for å samle inn data fra Tjenestene …» and «Prisjakt gir begrensede tillatelser til å gjennomsøke Tjenestene i samsvar med parameterne spesifisert i Tjenestenes robot.txt-filer.»
- **Only within normal use**: the material and information «kan ikke brukes på annen måte enn innenfor rammen av normal bruk av Tjenestene». Access «er kun beregnet for personlig bruk», and nobody may put «en urimelig eller uforholdsmessig byrde» (an unreasonable or disproportionate load, in Prisjakt's judgment) on the service or spread its material to the public.
- **What we do with that**: product pages only, which robots.txt allows; one person's private list (row-level security lets only the owner read the watch); nothing published; a few pages a day, spaced out.

### The owner's limit (10.11.2026)

**Each product page at most once a day, and only for things being watched or still returnable.** What the code does at 71275e6c:
- **The morning sweep** (pg_cron `lascis-shop-prices`, 05:23 UTC daily) reads only things to buy (`status 'wishlist'`; a model only while its general wish is open) and things owned that can still go back (`status 'bought'`, not gone, `return_by` today or later in Oslo) — each only when its last check is more than 20 hours old (or it was never checked, or its link changed), oldest first, at most 40 a run, stopping after 100 s (the rest wait for the next morning). One run a day, so the sweep reads a page at most once a day.
- **Reads the owner starts don't count against it**: `read` when a link is pasted or Read is tapped (a preview, nothing stored), the quiet `check` right after a row with a link is saved, and **Check now** (up to 10 rows). A new link is read twice within minutes (paste, then save), and Check now reads again every time it is tapped.
- **1.5 s between two requests to one host** (`HOST_GAP_MS` in `politeRead`). The time of the last request is remembered per function instance: two calls served at the same moment by two instances are not spaced. The sweep is one call, so its requests are.

## Endpoints we call

| Request | Called by | When | Limits |
|---|---|---|---|
| `GET https://www.prisjakt.no/product.php?p=<id>` (`&a-<n>=<value>` for one variant) | `shop-price`: `politeRead` → `fetchPage` | `read` (a pasted link), `check` (after a save, Check now), `sweep` (05:23 UTC) | the limits above |
| `GET <a store's product page>` | the same | the same | the same |

The function reads the link stored on the row (or pasted). It never searches Prisjakt and never follows its "go to shop" links.

## Fields we read and write

| Field | Shape seen (10.11.2026) | Where it goes |
|---|---|---|
| `<script type="application/ld+json">` blocks | JSON; lists and `@graph` are flattened; `@type` a string or a list, with or without `https://schema.org/` | the nodes typed `Product` or `ProductGroup` |
| `name`, `image` | text; an image as a URL, a list or an object (`url`) | `name`, `image` (the card's picture when the row has none) |
| `brand.name` (or `brand` as text); `gtin13` (Power, Jernia) or `gtin` (Elkjøp) | text; the EAN as digits in text | only in `read`'s answer, never stored |
| Prisjakt `offers` = `AggregateOffer` {`lowPrice`, `highPrice`, `offerCount`, `priceCurrency`} | numbers (`5499`, `8990`, `13`) and `"NOK"` | `low`, `high`, `offers`, `currency` |
| Prisjakt `ProductGroup.hasVariant[]` | each a `Product` with its own `url` (`…&a-116257=Black`) and `AggregateOffer`; the group itself has no `offers` | a link naming a variant reads that one; otherwise the cheapest variant's low, the dearest variant's high and the most shops any variant has (never a sum) |
| A store's `offers` = `Offer` or a list of them | `price` as text (Elkjøp `"14999"`) or a number (Power `2035.0`, Jernia `2490`); `priceCurrency`; `availability` (a schema.org URL); `eligibleCustomerType` (Elkjøp: Public, Business) | the cheapest public offer → `low`, `currency`; the dearest → `high` (the same with one offer); `in_stock` (the cheapest offer's) true for InStock, LimitedAvailability, OnlineOnly and InStoreOnly, false for anything else (Power: OutOfStock), null when missing |
| `priceSpecification[]` with a `priceType` of `StrikethroughPrice` (or `ListPrice`, `MSRP`) | Elkjøp, 08.10.2026: `"14999"` beside a price of `9990`; none on 10.11.2026 (no sale) | `was`, only when above the price ("~~14 999~~ before") |
| `hasMerchantReturnPolicy` on the offer: `merchantReturnDays` | a list (Elkjøp: 30, and 50 with `validForMemberTier`) or one object (Power: 90) | `return_days`: the shortest window open to everyone (members-only policies skipped; 1–399 days) → the record's "30 days (the shop's)" chip for Return by |

Written by `shop-price` only (the service role; the owner can read both tables and delete a watch row): `shop_price_watch`, one row per item — `url`, `checked_at`, `status` (`ok` · `no_price` · `blocked` · `error`), `error`, `source` (`prisjakt` · `store`), `name`, `image`, `low`, `high`, `offers`, `currency`, `in_stock`, `was`, `return_days`, `last_ok_at`, `prev_low` / `prev_at` (the last different price, for "↓ 300 since …") — and `shop_price_points`, one row per price read (`checked_at`, `low`, `high`, `offers`, `currency`, `source`; kept two years, the sweep deletes older ones). Never `shop_items`. Nothing is sent to a site but the request itself.

## Fields we deliberately don't use

- `aggregateRating`, `review`, `additionalProperty` (Prisjakt's specs), `BreadcrumbList`, `Organization`: nothing on screen uses them.
- `brand` and the EAN: read and answered by `read`, never stored — the row keeps the title the owner gives it, and a grocery's EAN comes from Kassalapp (`docs/integrations/kassalapp.md`).
- `itemCondition` on a store's offer (Elkjøp, Power and Jernia: `NewCondition`), `sku`, `mpn`, `seller`, `shippingDetails`, `availabilityStarts` (Power's is "27.11.2026 00:00:00", not ISO), `hasEnergyConsumptionDetails`, `hasCertification`.
- Prices for some customers only: an offer whose `eligibleCustomerType` isn't Public (Elkjøp's business price without VAT) is skipped while a public one exists; a return policy with `validForMemberTier` is skipped; Jernia's `priceSpecification` (1990 for club members, beside the public 2490) is never taken for the price.
- Prisjakt's own offer list (the page's data in `self.__next_f`: each shop's offer with its `condition`): not read today — see the first trap.

## Traps

- **AggregateOffer mixes new, refurbished and used offers.** Live 10.11.2026, "Apple iPhone 15 128GB" (`p=12105524`): Prisjakt's own headline says "fra 7 504 kr" (new), but the Pink variant's JSON-LD says `lowPrice: 4990`, and in the page's own offer list that is a used offer ("Apple iPhone 15 - Brukt / 128 / Pink", `"condition":"Used"`); Green 5444 is used too, Yellow 5790 refurbished, Black 7504 new. With no colour in the link the reader answered 4990 as "Prisjakt's lowest" — and a link with a colour can get a used price as well (Pink). **Fix pending** on another branch (not in the code at 71275e6c): read each offer's condition from the page's offer list, so a used or refurbished offer is no longer taken for the price.
- **A bot check is `blocked`, never a price.** Some sites answer an automatic reader with a check page instead of the product: Cloudflare's (a service in front of many sites) "Just a moment…" or "Attention Required!" (Prisjakt's search, Proshop), a "Client Challenge" (Clas Ohlson, 08.10.2026), or a page carrying `window._cf_chl_opt` / `cf-browser-verification` (`isChallengePage`). Such a page is `blocked` even when it comes with a 403 or 503. Cloudflare's `challenge-platform` script is on every Prisjakt page, real ones too, so it proves nothing. A blocked check keeps the last price and says "The site asked for a browser check — it blocks automatic reads".
- **robots.txt is not checked by the code.** `isPrisjaktUrl` (true only for a product link) is in `priceRead.ts`, but nothing calls it at 71275e6c: a pasted `prisjakt.no/search?…` link, which robots.txt disallows, would be read like any other.
- **A blocked or failing link is asked again every morning**: the sweep's due rule looks only at when a link was last checked, not at how that went.
- **Prices come as text or as numbers**, in Norwegian forms too: `parsePrice` reads "9 990,00", "kr 1.299,-" and "1,299.50", and takes "9.990" for nine thousand nine hundred and ninety.
- **Elkjøp's first price specification is the price without VAT** (`11999.2`, beside the offer's `"14999"`): the offer's own `price` is read first, so it would only count for an offer with no `price`.
- **`@id` links are not followed.** Jernia's offer names its return policy only by `@id`; the page defines that policy on its Organization with a `merchantReturnLink` and no number of days — so a Jernia link never has `return_days`.
- **Elkjøp's EAN field changed name**: `gtin` on 10.11.2026, `gtin13` in the 08.10.2026 fixture; both are read.
- **The source label is a text match** (`/prisjakt\.no/` on the final URL): a store link that mentions prisjakt.no in its query would be labelled Prisjakt.
- A page without a price still gives its name and picture (`no_price`; the last price stays). A link changed while it was being read saves nothing ("The link changed while it was checked"). A second read within the hour with the same numbers adds no history point.

## Store pages

| Store | robots.txt (10.11.2026) | Its product page (10.11.2026) | What we read |
|---|---|---|---|
| Elkjøp (`elkjop.no/product/…/<id>`) | product pages allowed; `/search`, `/api`, `/cart`, `/checkout` … disallowed | `Product` (`gtin`, `itemCondition`) with two `Offer`s: Standard Price (Public) and Business Price excl. VAT (Business); returns 30 days, 50 for club members | price, in stock, the struck-out price during a sale, 30 days |
| Power (`power.no/…/p-<id>/`) | product pages allowed; `/search/`, `/category/`, `/checkout/` … disallowed | `Product` (`gtin13`) with one `Offer`: `price` as a number, `availability`, a 90-day return policy (one object) | price, in stock, 90 days |
| Jernia (`jernia.no/produkter/<id>/…`) | `Allow: /` | `Product` (`gtin13`) with one `Offer`: `price`, `availability`, a club price in `priceSpecification`, and the return policy only as a link | price, in stock — no return days |

**Stores that block automatic reads — Komplett, Proshop, Clas Ohlson, XXL, Jula, Dustin — are never read and never worked around.** Their pages answer an automatic reader with a bot check (the list as of 10.11.2026; Proshop's "Attention Required!" and Clas Ohlson's "Client Challenge" were seen on 08.10.2026). No price is read from them, and nothing tries to get past the check: no browser's User-Agent, no headless browser, no proxy or scraping service, no cookies taken from a browser, no retries. Their prices are typed by hand. Not re-tested for this page: no request was sent to them, not even to test. What the code does today (71275e6c): nothing refuses the request beforehand, so a pasted link to one of them is still requested once by `read` (the answer: "That site blocks automatic reads — type the price yourself"), and a saved one again by every morning's sweep, `blocked` each time.

**Sites whose terms forbid automated reading are refused by data, never by code** — no list of hosts in the function: a site-policies table (coming — not in the code at 71275e6c) will hold each site's rule, and `shop-price` will refuse such a link before any request. The first two:
- **finn.no** — https://www.finn.no/vilkar/brukervilkar-finn § 6 (Immaterielle rettigheter; the page shows no date) — robots, spiders, indexing and any other systematic or regular copying need FINN's explicit written consent: «Bruk av automatiserte tjenester (roboter, spidere, indeksering m.m.) samt andre fremgangsmåter for systematisk eller regelmessig kopi av innholdet i FINNs kanaler er heller ikke tillatt uten eksplisitt skriftlig samtykke fra FINN.»
- **tise.com** — https://tise.com/terms (Norway, last updated 01.08.2026) § 4 Using Tise: "When using Tise, you must not: … scrape, use bots, reverse engineer, or use unauthorised API clients".

Until that table lands, a pasted finn.no or tise.com link is read like any other.

## Log

### 10.11.2026 — this page; the condition trap seen live

Written from the code at 71275e6c and checked against the pages above; no code changed. Found: (1) Prisjakt's AggregateOffer can be a used offer ("Apple iPhone 15 128GB": 4990 used against "fra 7 504 kr" new) — the fix is pending on another branch; (2) the first terms link now redirects to the brukervilkår page (updated 26.10.2026); (3) Elkjøp names its EAN `gtin` (the 08.10.2026 fixture: `gtin13`), and both are read; (4) Jernia gives its return policy only as a link; (5) the owner's once-a-day limit holds for the sweep, not for the reads the owner starts; (6) `isPrisjaktUrl` is unused, and the bot-blocking stores and finn.no / tise.com are still requested when a link to them is pasted or saved.

### 08.10.2026 — first use (migration 137)

The price watch and its parser. Shapes checked live on a Prisjakt product group and product, an Elkjøp product page and a Cloudflare check page (the fixtures in `scripts/verify-shop-price-read.cjs`).
