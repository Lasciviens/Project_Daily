# Test-Game (`/#/test-game`) — known issues

Live tracking list for the Game Library redesign test page. First live demo: the deploy snapshot of the
fix round (PR #491). Items move to "Fixed" as follow-up PRs land. Findings come from a six-reviewer pass
(desktop/phone visual fidelity, data wiring, runtime at ~1,500 games, feature coverage, rules/a11y) plus a
real-data audit, each adversarially verified.

## Follow-ups outside this page
- **Console icons (owner, 2026-09-25):** the owner will supply small coloured console images later; until then the
  sidebar keeps the current drawn platform glyphs. Don't draw or source substitutes.
- **ScreenScraper will be rewritten from scratch (owner, 2026-09-25):** the current `screenscraper-sync` flow and its
  panel are considered broken; leave them untouched until that rewrite is scheduled.
- **Theme:** the Game Library look is the new theme for the whole website, to be rolled out later.
- **Site integration (owner decision 2026-09-25):** the Games page stays full-screen with its own chrome for now.
  The plan is to restyle the WHOLE website in this page's visual language later, rather than squeeze this page into
  the current shell. Don't wrap it in `<Layout>` in the meantime.
- The Advanced tabs reuse the current page's components verbatim, and three of them show a FAILED fetch as
  empty data (Tiers: "No games", Needs review: "Nothing needs attention", Classic library: "0 games"); the old
  Stats panel renders nothing at all on a failed fetch. Pre-existing on `/games`; to fix when those
  components are brought into the new design.
- `esde-sync` should also write `games.play_seconds / play_count / last_played_at` (edge-function change,
  manual redeploy, one-off `UPDATE`). The page and `/games` already read the ES-DE figures correctly.
- Display-sized derivatives for ES-DE fanart/screenshots (the page downloads the originals) — needs the RP6
  uploader (Codex task C7).
- Per-row cache patching instead of invalidating the whole `['games']` namespace on every status/rating click.

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
