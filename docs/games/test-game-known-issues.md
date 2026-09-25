# Test-Game (`/#/test-game`) — known issues

Live tracking list for the Game Library redesign test page. First live demo: the deploy snapshot of the
fix round (PR #491). Items move to "Fixed" as follow-up PRs land. Findings come from a six-reviewer pass
(desktop/phone visual fidelity, data wiring, runtime at ~1,500 games, feature coverage, rules/a11y) plus a
real-data audit, each adversarially verified.

## Owner feedback on the live demo (2026-09-25) — in progress

The owner confirmed this page will **replace the current Games page**, so the bar is production quality.

- **No horizontal scrolling.** The per-row shelf carousels go; the bookcase becomes a vertical stack of full
  shelves (as many covers per shelf as fit the width) and the whole case scrolls down.
- **Analytics looked cheap.** Rebuilt as a first-class screen in the design language (KPI tiles, platform and
  status breakdowns, most played with covers, completions over time, ratings, genres) instead of wrapping
  the old Stats panel.
- **Detail panel as an overlay, not a permanent column.** The games get the full width; picking a game slides
  the panel in over the shelf (non-modal, the shelf stays usable); it can collapse to a slim tab and expand
  again, or close. The phone keeps its full-screen sheet.

## In progress (partially applied in the first demo, finishing in the follow-up PR)

**Shelf, cards, stylesheet**
- Bookcase colour: near-black case with a thin warm-grey lit lip instead of brown behind the titles.
- Two lamps per cover instead of one flat bar; light-mode lamps visible.
- Status marker: the design's ~13px filled badge (ring / check / clock) instead of an 8px dot.
- Card title and meta aligned with the cover edges; 12px type; selection outline without the gap.
- Backdrop behind the header: heavily blurred in dark mode, none in light mode.
- Monitor (2450px): fill two full shelves instead of a half-empty third.
- Idle CPU: off-screen cover placeholders run an endless shimmer (≈1 core busy at 1,500 games).
- Resize/sort re-render every card; vertical mouse wheel over a shelf is captured horizontally.
- Touch: menu rows 44px, bigger rating stars, hover styles stuck after a tap.

**Detail panel**
- Play button always vivid "▶ Play" as drawn (Steam launches; others mark playing / explain).
- Hero grows with the viewport; no blank band on tall monitors.
- Unhide for Steam non-game apps offers explicit statuses instead of silently re-hiding.
- Edit form closes back to the page on Save/Cancel; dialogs get accessible names.

**Shell and chrome**
- Top-bar controls hidden where they do nothing (Sort on Play Queue; Search/Genre/Sort on Analytics/Advanced).
- ⌘K / "/" must not act while a dialog is open.
- Tablet: safe-area insets, active state on icon-only filters, ≥44px toggles, sidebar overflow fade.
- Phone: toasts above the tab bar; queue not a nested scroller.
- Needs-review count on the Advanced tab; Random pick names its pool.

## Follow-ups outside this page
- `esde-sync` should also write `games.play_seconds / play_count / last_played_at` (edge-function change,
  manual redeploy, one-off `UPDATE`). The page and `/games` already read the ES-DE figures correctly.
- Display-sized derivatives for ES-DE fanart/screenshots (the page downloads the originals) — needs the RP6
  uploader (Codex task C7).
- Per-row cache patching instead of invalidating the whole `['games']` namespace on every status/rating click.

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
