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
- Geolocation falls back to Oslo, and the fallback counts as a success — never treat it as the user's real position.
- Transit (EnTur): only GraphQL fields verified live; quays are grouped by their raw NSR id (a roadside stop's `publicCode` is an empty string); filter departures, not groups.
- `articleExtract.ts` is hand-mirrored into `news-article` (`verify-article-extract`).
