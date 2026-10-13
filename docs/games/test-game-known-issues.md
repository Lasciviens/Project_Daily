# Games page (`/#/games`) — known issues

Two lists for the Games page (the "Game Library" design; code in
`src/features/games/test-game/`): what is still open, and what the old Games
page did that was deliberately not carried over when it was deleted on
26.09.2026. The feature itself is described in
[`docs/features/games.md`](../features/games.md); accepted ScreenScraper
limitations are in [`screenscraper-integration.md` §16.7](screenscraper-integration.md#167-known-limitations--reviewed-and-accepted-26092026).
Last checked against the code: 13.10.2026.

## Open issues

- **Steam and PlayStation under Advanced reuse the old page's components**
  (`components/SteamTab.tsx`, `components/PlayStationTab.tsx`). They decide
  hidden titles with `isHiddenEntry` (`providerEntries.ts`: any status counts as
  a decision), while the Library uses the stricter `isHiddenRow`
  (`testGameModel.ts`: a non-game the importer promoted to Playing stays
  hidden), so the two hidden counts can differ by a few titles. Goes away when
  those tabs are rebuilt natively.
- **`esde-sync` does not write the source-neutral play columns**
  (`games.play_seconds` / `play_count` / `last_played_at`, migration 096). For
  retro games they keep 096's one-time snapshot; the page and Home read the live
  `esde_*` columns first (`playStatsOf` in `gameStats.ts`), so nothing on screen
  is wrong today, but any new reader of the neutral columns would be. Fix: an
  `esde-sync` change plus a one-off backfill migration.
- **ES-DE fan art and screenshots load at full size.** Where a game has no
  ScreenScraper copy, the hero and the detail gallery fall back to the handheld's
  original images in `game_platforms.esde_assets` (`esdeOf` in
  `testGameModel.ts`; up to 20 MB each). Display-sized copies need a change in
  the RP6 uploader (`scripts/sync-esde-content.py`) or a server-side resize.
  Covers are fine: the handheld uploads a 640 px WebP preview for them.

### Open owner questions

- **Theme.** On 25.09.2026 the plan was to restyle the whole website in this
  page's visual language later. Since then the rest of the app has its own token
  system (`docs/design/THEME.md`) and Games keeps its own (`testGame.css`). Does
  the plan still stand?
- **Co-op / Iconic.** The flags show in the detail and can be set in the edit
  form, but there are no filters or Analytics tiles for them (they are almost
  never set). Add them, or leave it?
- **Bulk systems.** The old page hid some bulk systems by default; here they
  are shown. Since 07.10.2026 they can be left out of every count and stat
  (Library settings → Platforms left out of stats), but they still sit on the
  shelves. Hide them from the Library too?

## Deliberately not ported from the old Games page

From the audit of 26.09.2026, the day the old page was deleted. Everything else
it did is on the new page (search, multi-select filters, every sort including
series, grid and list, add, random, the queue with drag, Mark as playing and
Plan a session, status/rating/notes/edit/delete/hide, the review flag, platform
CRUD via Manage platforms, the Steam / PlayStation / Needs review tabs, stats and
drill-downs).

- **Poster view** — replaced by the bookcase.
- **Compact view** — the bookcase, grid and list cover it. An app-wide density
  toggle was tried and rejected before. A cover-size step can come if the owner
  asks.
- **Series grouped view and series filter** — only about 4 % of games had a
  series on 26.09.2026. The By series sort and the detail's "More in this
  series" strip cover it; revisit once more games carry a series (a ScreenScraper
  save can fill `series_name`).
- **Platform filter that matches any variant** and **"By system" counting every
  variant** — the page files each game under its primary variant. When the old
  page was deleted every game had one variant; merging duplicates (Advanced →
  Duplicates → Compare & merge, migration 131) now gives some games several, so
  revisit if that becomes common.
- **Picking several libraries at once in the stats** — replaced by the
  Analytics library switch (all / retro / Steam / PlayStation).
- **Queue "Now playing / Up next" groups** — replaced by the summary line
  ("4 games queued · 2 playing · 1 up next · 1 finished") and the ▶ Mark as
  playing button; the ranks stay one list so drag and keyboard moves keep
  working.
- **Gamepad navigation from the demo pages** — a possible follow-up (drive the
  bookcase's arrow-key moves from the Gamepad API). The demo pages' smart
  collections are the Analytics drill-downs and filter chips now.
- **Already dropped by the owner:** tiers, Classic library, Queue editor,
  Add & random, the blurred cover backdrop.
