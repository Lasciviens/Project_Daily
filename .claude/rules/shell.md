---
paths:
  - "src/app/**"
  - "src/index.css"
  - "index.html"
  - "vite.config.ts"
  - "public/**"
---
# Shell and platform rules

Background: `docs/platform-shell.md`.

- `AppShell` is one tree for every breakpoint (rotation never remounts the page). A route change resets scroll, resets the chrome and closes the whole popup stack.
- The document never scrolls (html/body/#root fixed height); `<main data-app-scroller>` scrolls. This is what keeps pull-to-refresh reliable on an iPhone.
- Never `overflow-x: hidden` on html/body; `#root` uses `overflow-x: clip`.
- View-transition names are unique per element; all view-transition CSS and every rule for runtime-only class names live outside `@layer`.
- `.glass-chrome`: write only the standard `backdrop-filter` (autoprefixer adds the Safari one).
- AppShell's page (Outlet) wrapper is `h-full` only on routes flagged `fullHeight` (today `/games`); everywhere else it stays auto-height, or tall pages hide their last card under the tab bar.
- iOS zoom is prevented by `maximum-scale=1` + 16px text controls on touch; never per field.
- The service worker uses `registerType: 'prompt'`: a new version waits and reloads only in the background or after 10 idle minutes, never with a dialog open or text in a field (`swUpdateRules.ts`). It caches no Supabase responses.
- The app opens with its last answers (owner, 16.11.2026): `shared/query/persist.ts` keeps the query cache's successful reads in this browser (IndexedDB) and puts them back before the first page draws; every kept answer is marked out of date, so a start still reads everything again. One copy, for the account whose session the browser holds, by the build that wrote it, at most a week old (`persistRules.ts`, `verify-query-persist`); sign-out, here or elsewhere, deletes it and empties the memory behind it (`accountState.ts`). A new query whose answer must not rest on the device (a position, a secret, a read that acts) goes on `NEVER_KEPT` in the same change; never put a token in a query's answer.
- The start waits for nothing it can know at once: `SessionGuard` draws the shell on the stored sign-in (`security/storedSession.ts`, a hint — the session still decides), and `main.tsx` starts the opened page's code beside the shell's (`preloadOpenedPage`).
- A new page goes in `src/app/pages.ts` (and `PRELOAD_ORDER`) and `src/app/navigation.ts`.
- A page's default tab is in its own code; another tab, window or heavy sheet is a `lazyPart` in its own `Suspense`, preloaded with `useIdlePreload` — never a static import that puts its charts in the first download. A panel the shell opens on demand goes in `shell/shellParts.ts`.
- A sheet rendered closed (per row) keeps its queries inside the open sheet.
- The app uses no Supabase Realtime: `vite.config.ts` aliases `@supabase/realtime-js` to `src/integrations/supabase/realtimeStub.ts` (16 kB gzip off every page; `verify-realtime-stub`). To use Realtime, remove the alias first; a channel throws.
- `scripts/verify-bundle-budget.mjs` guards the first download (gzip, the shell and each page); raise a budget only on purpose, in that file, with the reason in the commit.
- The service worker precaches every chunk on purpose (a late chunk after a deploy never 404s); never trim it to "what the shell needs".
- Back closes only the top overlay; entries left behind are passed over (`historyEntries.ts`).
- `iosViewportFix.ts` measures the standalone short-viewport gap with a fixed probe, never `innerHeight`.
