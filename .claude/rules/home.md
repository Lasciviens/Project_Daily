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
- Line cards up through the board, never through content heights: on the split laptop board only the side column `fill`s (the weather tile ends where the tasks end; a filled main stretched the week and the tasks under a tall transit) and the glance row lies on the board's own tracks (`GLANCE_ROW_TEMPLATE`) — independent column stacks only line up by luck (`verify-page-board`).
- Geolocation falls back to Oslo, and the fallback counts as a success — never treat it as the user's real position.
- Transit (EnTur): only GraphQL fields verified live; quays are grouped by their raw NSR id (a roadside stop's `publicCode` is an empty string); filter departures, not groups.
- `articleExtract.ts` is hand-mirrored into `news-article` (`verify-article-extract`).
