---
paths:
  - "src/features/home/**"
  - "supabase/functions/news-*/**"
---
# Home rules

Background: `docs/features/home.md`.

- The daily brief is rule-based (`briefRules.ts`): the same data always gives the same text; no AI call.
- One layout per breakpoint (`useBreakpoint()`), so no hidden copy keeps fetching. Collapsed widgets disable their queries.
- Nothing on Home navigates by itself; only an explicit "Open …" link does.
- A glance tile's corner art (`GlanceArt`) stays in the band above the tile's first line, so it never sits under text and adds no height (`verify-glance-art`).
- A control inside a glance screen (a field, a picker, a button — or a menu portalled out of it) never opens the tile's detail or starts a drag; its fields are `select-text`; screens not showing are `inert`, so Tab never lands in a hidden field. A new screen keeps the tile's height (a phone row's track is 45–56px, the laptop glance row's 50px).
- Line cards up through the board, never through content heights: the split laptop board is PageBoard `rows` — brief | transit, then week | tasks | weather, each card stretched to its row's tallest, content top-aligned — and the glance row lies on the board's own tracks (`GLANCE_ROW_TEMPLATE`). Independent column stacks only line up by luck (`verify-page-board`).
- One currency converter: the Money tile's Convert screen and the Currency popup/widget's Convert tab render `CurrencyConverter` (logic in `api/currencyConvert.ts`, `verify-currency-convert`); it stores nothing.
- Geolocation never prompts on opening the app: the phone is asked only when it already allows it, or after Near me / Use my location (`useAskLocation`); otherwise the saved Home place, else Oslo — a fallback counts as a success, never as the user's real position (`source === 'gps'` is).
- Home shows a day once: one card (`HomeDayCard`) — the week strip, the picked day as Daily's `DayAgenda`, then the quick add (the card's one Add). Never a second list of the day, never a second Add.
- Place search is EnTur's geocoder v3 through the one `<entur-geocoder>` block (`enturGeocoder.ts`, a verbatim copy in `ai-proxy` — `verify-entur-geocoder`); `countries=no` is lowercase. EnTur facts: `docs/integrations/entur.md`.
- Transit (EnTur): only GraphQL fields verified live; quays are grouped by their raw NSR id (a roadside stop's `publicCode` is an empty string); filter departures, not groups.
- `articleExtract.ts` is hand-mirrored into `news-article` (`verify-article-extract`).
