---
paths:
  - "src/features/games/**"
  - "supabase/functions/screenscraper-*/**"
  - "supabase/functions/esde-*/**"
  - "scripts/*esde*"
  - "supabase/functions/steam-api/**"
  - "supabase/functions/psn-api/**"
  - "supabase/functions/igdb-api/**"
---
# Games rules

Background: `docs/features/games.md`, `docs/games/screenscraper-integration.md`.

- `testGameModel.ts` and the other pure modules own every decision; components only render them.
- Anything Headless UI portals to `<body>` from the Games page needs the `tg-portal` class, or it loses every token.
- ScreenScraper credentials never leave the server: no ScreenScraper URL is stored, logged or returned; images go through the signed `screenscraper-media` proxy. Its shared code is GENERATED from `src/features/games/scraper/`.
- Storage wall: the project's Free plan stops at 1 GB. Copies stay under the budget (≤ 850 MB since 04.10.2026, checked before each write); ES-DE uploads refuse above 850 MB (413 `storage_full`). The rest of the 1 GB is the Kobo's 130 MB. Storage keeps low-resolution pictures only (owner, 13.10.2026): nothing new uploads ES-DE originals.
- The ScreenScraper match marker is `games.ss_jeu_id`; `external_source`/`external_ref` belong to the ES-DE sync. IGDB is a separate source (`igdb_id`) that never writes titles, covers or descriptions.
- A Steam/PSN re-import refreshes play figures but only fills empty title/cover/genres/year.
- `hidden` is a play status; `finished_at` comes from the last session, not the button press.
- Loading is tiered: no new eager call on mount (the one exception: the daily library auto-sync).
- PlayStation is best-effort and unverified; wrap its surfaces in `ErrorBoundary` and guard every field.
- Platforms left out of stats stay in the Library but out of every count (`countedGames`).
