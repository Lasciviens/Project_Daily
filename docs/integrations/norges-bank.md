# Norges Bank (exchange rates)

Checked: 10.11.2026 against one live answer (`EXR/B.TRY+EUR+USD.NOK.SP`, 29.10–10.11.2026, read at 08:38 UTC), one live answer for a weekend alone (07.11–08.11.2026), and Norges Bank's own pages, all read that day: the exchange rates page https://www.norges-bank.no/en/topics/Statistics/exchange_rates/, its questions and answers https://www.norges-bank.no/en/topics/statistics/exchange_rates/valutakursar-faq/, the open data page https://www.norges-bank.no/en/topics/Statistics/open-data/ and the guide https://www.norges-bank.no/en/topics/Statistics/open-data/guide-data-warehouse/ (edited 09.11.2026). Norges Bank's pages give the address and the publication times, not the answer's fields: those come from the live answer, which names its own dimensions and attributes (the SDMX-JSON standard it points to was not read). The shape was first verified live on 08.10.2026 (`fxNorgesBank.ts`'s header).

Shop freezes every purchase, sale and extra cost made in a foreign currency at Norges Bank's rate **of its own day**, so a lira price from 2023 keeps its 2023 worth. `shop-price` fetches the days that rows wait for, caches them in `fx_rates_nok`, and the database fills each row from there. The parsing is pure `src/features/shop/fxNorgesBank.ts`, hand-mirrored into `supabase/functions/shop-price/index.ts` (`verify-shop-owned` compares the copies). How the money works: `docs/features/shop.md` → Money maths; the rule: `.claude/rules/shop.md`.

## How we authenticate

- **None needed**: the API is open — no key, no account. Only `shop-price` calls it (server side), sending `Accept: application/vnd.sdmx.data+json, application/json`.
- **Who can make `shop-price` fetch rates**: a browser JWT (`auth.getUser`, then `isAppUser`) for `rates` and `day_rates`, or the daily cron's `x-cron-secret` = `SHOP_PRICE_CRON_SECRET` for `sweep` (it acts as `HEVY_USER_ID`). The same function as the price watch: `docs/integrations/prisjakt.md` → How we authenticate.

## Endpoints we call

| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET https://data.norges-bank.no/api/data/EXR/B.<TRY+EUR+USD>.NOK.SP?format=sdmx-json&startPeriod=<yyyy-mm-dd>&endPeriod=<yyyy-mm-dd>&locale=en` | `shop-price` `cacheRates`, from the actions `rates`, `day_rates` and `sweep` | `rates`: when a row waits for a rate — the Shop page asks at most once per 30 minutes per page load (`useAutoFillRates`), and right after a save that needs one (`useFillRatesNow`); `day_rates`: the chain builder, for days no row has yet (`fetchDayRates` reads `fx_rates_nok` first); `sweep`: every morning at 05:23 UTC, before the price checks | one request per call, for only the currencies missing, from 7 days before the first missing day to the last one (never past today in Oslo); 10 s; `day_rates` takes at most 60 pairs, TRY / EUR / USD only, days from 01.01.1990 to today. Norges Bank documents no rate limit |

The key `B.<base>.NOK.SP` names the series: `EXR` is the dataflow "Exchange rates" (`NB:EXR(1.0)`); frequency `B` ("Business": business days); the base currencies joined with `+` (only `NB_CURRENCIES` — TRY, EUR, USD — the currencies Shop has besides NOK); quote currency `NOK`; tenor `SP` ("Spot"). Norges Bank's guide shows the same form (`…/EXR/B.USD.NOK.SP?format=excel-both&startPeriod=…&endPeriod=…&locale=no`); its query builder is https://query.norges-bank.no/en/.

## Fields we read and write

| Field | Shape seen (10.11.2026) | Where it goes |
|---|---|---|
| `data.structure.dimensions.series[]` | four, in this order: `FREQ` (`B`), `BASE_CUR` (values `TRY`, `USD`, `EUR` — not the order asked), `QUOTE_CUR` (`NOK`), `TENOR` (`SP`); each value `{ id, name }` | which currency a series is: its key's index into `BASE_CUR`'s values; a series whose quote isn't `NOK` is skipped |
| `data.structure.dimensions.observation[0]` | `TIME_PERIOD`; `values[]` `{ id: "2026-10-29", name, start, end }` — business days only (no 31.10, 01.11, 07.11 or 08.11) | the day of each observation |
| `data.structure.attributes.series[]` | `DECIMALS` (`2`, `4`), `CALCULATED` (`false`), `UNIT_MULT` (`"2"` "Hundreds", `"0"` "Units"), `COLLECTION` (`C`, "ECB concertation time 14:15 CET") | `UNIT_MULT`: the power of ten a value is quoted for |
| `data.dataSets[0].series["0:<i>:0:0"]` | the key = an index into each series dimension; `attributes` = an index into each series attribute's values (TRY `[0,0,0,0]` → `UNIT_MULT` "2"; USD and EUR `[1,0,1,0]` → "0") | one series per currency |
| `….observations` | `{ "<time index>": ["18.77"] }` — the value is text (on 09.11.2026: TRY 100 = 18.77 NOK, USD 9.4099, EUR 10.5325) | `nokPerUnit` = the value ÷ 10^`UNIT_MULT` (TRY: 0.1877); a missing, non-numeric or non-positive value is skipped |

**Written** (by `shop-price` with the service role): `fx_rates_nok` (migration 137) — `day` (every calendar day), `currency` (TRY · EUR · USD), `nok_per_unit` (NOK for one unit), `rate_day` (the business day the rate is from), `fetched_at`; upserted on (`day`, `currency`) in batches of 500. The app's users may read it (published reference data, so no `user_id`; the owner lock of migration 139 still applies); only the service role writes it. Then each waiting row is touched (its rate column set to NULL, which it already is), so the database's own BEFORE trigger looks the rate up with `shop_rate(currency, day)`:

| Amount | Its day | Rate column | Trigger |
|---|---|---|---|
| a purchase | the Oslo day of `bought_at` (`oslo_day`) | `shop_items.fx_nok` + `fx_source` | `shop_items_rules()` |
| money back (a sale, a refund) | `disposed_on` | `shop_items.sale_fx_nok` + `sale_fx_source` | `shop_items_rules()` |
| an extra cost | `spent_on` | `shop_item_costs.fx_nok` + `fx_source` | `shop_item_costs_rules()` |

`fx_source` is `fixed` (NOK, rate 1), `norges_bank`, or `manual` (a rate typed by hand — kept, and never asked for). Read back by the browser for the chain builder (`fetchDayRates`: `day`, `currency`, `nok_per_unit`) and by the assistant (`DB_CATALOG`, read-only). Nothing is sent to Norges Bank but the query.

## A day without a rate

- **The calendar** (`calendarRates`): one rate per calendar day. A business day has its own; a weekend or a holiday between two published days takes the last business day's before it (`rate_day` says which). After the last published day only a weekend is filled: a weekday waits — it may not be published yet, or be a holiday that the next answer shows.
- **"Rate pending", never today's rate.** Until its day's rate is cached, an amount's rate column stays NULL and the app shows it as rate pending (`ownModel.nokAt`: the amount in its own currency, the NOK sum of what is known beside it) — never at today's rate, never a guess (a 2023 lira at today's rate reads about half its worth).
- **When it arrives**: the next `rates` call — the page, a save, or the morning sweep — caches it and touches the rows. A chain being built keeps its `day_rates` answer for a day (`useDayRates`, `STALE.day`) and asks again when its days change; once saved, its rows wait like any other (the save asks `rates` straight after).

## Fields we deliberately don't use

- `DECIMALS`, `CALCULATED`, `COLLECTION`, the values' `name`s, `meta` (`id`, `prepared`, `sender`, `links`), `reportingBegin` / `reportingEnd`: the rate and its day are all we keep.
- Norges Bank's other currencies (it quotes about 40), its interest-rate dataflows, and the CSV and Excel formats.
- **Today's values are not from here**: "Could sell for", prices to buy and the price watch use today's rates from Open Exchange Rates (`src/features/home/api/currencyApi.ts`, Home's currency query, through `useShopRates`). Norges Bank's rates are only for the day something happened.

## Traps

- **TRY is quoted per 100** (`UNIT_MULT` "2", "Hundreds"): read without it, a lira is worth a hundred times too much.
- **A dimension's values aren't in the order asked**: `TRY+EUR+USD` came back as TRY, USD, EUR. Always map a series through its key's indexes.
- **Values are text** (`"18.77"`): parsed to numbers; a comma is read as a decimal point.
- **Business days only**, and published at about 16:00 CET (Norges Bank's FAQ: "approximately 16:00 CET on business days"): today has no rate until then — the read at 08:38 UTC on 10.11.2026 ended on 09.11.2026. Christmas Eve has none ("Exchange rates are not published on Christmas Eve"), nor do Norwegian public holidays.
- **A range with no business day answers 404**: `{"errors":[{"code":404,"message":"No data for data query against the dataflow: urn:sdmx:org.sdmx.infomodel.datastructure.Dataflow=NB:EXR(1.0)"}]}` (07.11–08.11.2026, a weekend). `cacheRates` always starts a week before the first missing day, so this doesn't happen; if it did, the call reports "Norges Bank answered 404" and the rows stay pending.
- **Middle rates, for reference** (the FAQ: "only intended to serve as an indication, and are not binding"): a bank or a card charges its own rate and margin, so the NOK frozen on a row is not what the bank took.
- **Slow answers**: after 10 s the call says "Norges Bank took too long to answer"; the rows stay pending until the next call.
- One `rates` call looks at up to 1,000 waiting purchases, 1,000 sales and 1,000 costs.

## Log

### 10.11.2026 — this page

Written from the code at 71275e6c and checked against a live answer and Norges Bank's pages; no code changed. Seen: the shape is unchanged since 08.10.2026; the order of `BASE_CUR`'s values follows the answer, not the query; a weekend-only range answers 404 with an `errors` body.

### 08.10.2026 — first use (migration 137)

`fx_rates_nok`, `shop_rate()` and the rate columns; the shape verified live (`EXR/B.TRY+EUR+USD.NOK.SP`, the header of `fxNorgesBank.ts`).
