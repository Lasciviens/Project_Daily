# Games page (`/#/games`) — known issues

Live tracking list for the Games page (the "Game Library" design; it started as the `/#/test-game` test page
and replaced the old page, which was deleted on 2026-09-26). First live demo: the deploy snapshot of the
fix round (PR #491). Items move to "Fixed" as follow-up PRs land. Findings come from a six-reviewer pass
(desktop/phone visual fidelity, data wiring, runtime at ~1,500 games, feature coverage, rules/a11y) plus a
real-data audit, each adversarially verified.

## Follow-ups outside this page
- **Console icons (owner, 2026-09-25):** the owner will supply small coloured console images later; until then the
  sidebar keeps the current drawn platform glyphs. Don't draw or source substitutes.
- **ScreenScraper was rewritten from scratch (2026-09-25):** the Scrape section (More → Scrape, sidebar → Scrape, the
  detail's Scrape button) replaced the old studio; see CLAUDE.md → "ScreenScraper — the Scrape page". Needs migration
  104 applied FIRST (it also repairs games the old scraper had re-labelled away from ES-DE), then `screenscraper-sync`
  redeployed, `screenscraper-media` deployed with JWT verification off, and `esde-content-sync` + `esde-media-sync`
  redeployed (950 MB storage guard) before it works live.
- **Theme:** the Game Library look is the new theme for the whole website, to be rolled out later.
- **Site integration (owner decision 2026-09-25):** the Games page stays full-screen with its own chrome for now.
  The plan is to restyle the WHOLE website in this page's visual language later, rather than squeeze this page into
  the current shell. Don't wrap it in `<Layout>` in the meantime.
- The Advanced tabs (Needs review, Steam, PlayStation) reuse the old page's components. Needs review reads the
  page's own rows and shows the library's loading and failed states as such; the Steam and PlayStation tabs use
  the provider rule for hidden titles (`isHiddenEntry`) while the library uses `isHiddenRow`, so their hidden counts
  can differ by a few titles. Goes away when those tabs are rebuilt natively.
- `esde-sync` should also write `games.play_seconds / play_count / last_played_at` (edge-function change,
  manual redeploy, one-off `UPDATE`). The page and `/games` already read the ES-DE figures correctly.
- Display-sized derivatives for ES-DE fanart/screenshots (the page downloads the originals) — needs the RP6
  uploader (Codex task C7).

## Old Games page — what was not carried over, on purpose (audit 2026-09-26, page deleted the same day)
Everything else the old page did is on the new one (search, multi-select filters, every sort incl. series, grid and
list, add, random, queue with drag, Mark as playing and Plan a session, status/rating/notes/edit/delete/hide, review
flag, platform CRUD via Manage platforms, the Steam / PlayStation / Needs-review tabs, stats and drill-downs).
- **Poster view** — replaced by the bookcase.
- **Compact view** — not ported; the bookcase, grid and list cover it. An app-wide density toggle was tried and
  rejected before. A cover-size step can come if the owner asks.
- **Series grouped view and series filter** — only ~4% of games have a series today. The By series sort and the
  detail's "More in this series" strip cover it; revisit once ScreenScraper fills `series_name`.
- **Platform filter that matches any variant** — every game has one variant today, so the one-platform shelves
  are the same thing. Revisit when games carry several variants.
- **Picking several libraries at once in the stats** — replaced by the Analytics library switch.
- **"By system" counting every variant** — identical to the primary-variant count today.
- **Queue "Now playing / Up next" groups** — replaced by the summary line ("4 queued · 2 playing · 2 up next") and
  the ▶ Mark as playing button; the ranks stay one list so drag and keyboard moves keep working.
- **Gamepad navigation from the demo pages** — a follow-up (drive the bookcase's arrow-key moves from the Gamepad
  API). The demo pages' smart collections are the Analytics drill-downs and filter chips now.
- **Already dropped by the owner:** tiers, Classic library, Queue editor, Add & random, the blurred cover backdrop.
- **Open owner questions:** Co-op / Iconic filters and tiles (the flags are almost never set), and whether the bulk
  systems the old page hid by default should be hidden here too (they are shown today).

## ScreenScraper — reviewed, deliberately not changed (second review, 2026-09-26)
- **Proxy links are per game, not per file** (`screenscraper-media`): one signature opens any file of that game on that system until it expires (end of next week). A leaked link can stream that game's manual or video for up to two weeks, spending the shared daily allowance; the proxy has no quota floor of its own (it cannot see the counter without an extra request per file). Accepted: the owner is the only user and links are never stored.
- **Undo does not bring back the previous full record** (`game_scrape_records` holds one row per game; undo deletes it). A re-scrape fetches it again.
- **The storage budget is checked per save**: two saves running at the same moment (two tabs) each reserve against the same usage reading and can overshoot the budget by one save's copies. The 950 MB hard cap and the ES-DE guard still hold.
- **Deploying `screenscraper-sync` before migration 104** makes early saves unmarked (`ss_jeu_id` missing) and undo limited; apply 104 first (the deploy checklist says so).
- **Changing "What to save" during an open review** does not change that review's choices (they are seeded when it opens); the next review uses the new settings.

## Fixed in the owner-feedback round (PR #492)
- **No horizontal scrolling**: the bookcase is a vertical stack of full shelves that scrolls down.
- **Analytics rebuilt** as a first-class screen (window × library filters, KPI tiles, completions over time,
  status mix, rating distribution, most played, platform/genre breakdowns, recently played).
- **Detail panel is a non-modal overlay** over the shelf (tablet + desktop) that collapses to a slim tab or
  closes; the games get the full width. The phone keeps its full-screen sheet.
- Bookcase colour and lamps, status badges, card alignment, header backdrop, monitor shelf fill.
- Idle CPU at 1,500 games (off-screen shimmer); per-card re-renders on resize/sort; wheel capture.
- Play always "▶ Play"; hero grows with the viewport; Unhide offers explicit statuses; Edit closes on
  Save/Cancel; dialogs named.
- Top-bar controls hidden where they do nothing; ⌘K / "/" inert while a dialog is open.
- Tablet safe areas, active icon filters, 44px toggles, sidebar fade; phone toasts above the tab bar;
  one shared 20px phone gutter; landscape phones get the phone layout.
- Broken-image flashes in the hero and covers during the one retry.

## Fixed in the first demo
- Retro play time / last played read the frozen 096 snapshot (also on `/games`).
- Steam non-game apps promoted to "Playing" by the importer stayed visible.
- Free-text system names ("GameCube", "PS1") formed separate shelves; platform-less games read "UNKNOWN".
- Half-point ratings rounded up (9.5 showed 5.0/5).
- Queue badge / list / "#n" disagreed; Queue editor reorders did not refresh the page.
- Steam header banner used as box art; PSN covers downloaded at full size.
- List reads downloaded `esde_source` / `provider_data`; games and platforms fetched serially;
  unstable pagination order past 1,000 rows.
- `/test-game` bundled into the main app chunk (now a 121 kB lazy chunk).
