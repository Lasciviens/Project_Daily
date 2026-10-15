# Decisions not to revisit

Settled calls, one line each: what was decided, why, and where the full story lives. Before proposing something listed here, read its source; if there is a new reason to change it, ask the owner first. Add a line when the owner settles something that a later session could easily undo.

## App-wide

| Decision | Why | Details |
|---|---|---|
| Wishes are their own table (`wish_items`), never rows in `tasks` or `shop_items`, and a new surface never hides existing rows (NEVER_HIDES) | Every `tasks.section` value leaks into the brief, the push and the lock screen; a season is a reminder, never a visibility rule (owner) | `docs/features/wishes.md` |
| No density setting (Comfortable / Compact / Dense) | Tried and rejected | `docs/design/THEME.md` §6.6 |
| No minimum button size (the 44px rule was dropped 13.10.2026): check the phone layout and keep it compact — no extra lines, nothing squashed | Owner: bigger buttons pushed rows onto new lines | `AGENTS.md` → Coding rules |
| Connections live only on Settings → Subscriptions | One answer to "is X connected?"; only re-authentication may also appear at the point of failure | `docs/features/settings.md` |
| The Home daily brief is rule-based, not AI (26.09.2026) | Same data, same text, no cost; the AI digest was deleted | `docs/features/home.md` |
| The Weekly Review card was removed on request; `ai_reviews` stays as an unused table | Owner request | `docs/features/ai.md` |
| No MCP layer for the assistant | GitHub Pages can't run a persistent process; the generic `DB_CATALOG` tool layer replaced it | `docs/features/ai.md` |
| No user-facing activity feed is built on top of `audit_logs`; if one is ever built it is append-only | `audit_logs` already covers the audit trail | `docs/features/developer.md` |
| Work has no live clock and no Now/Next timeline | Removed on request | `docs/features/work.md` |
| Daily's agenda is a list (`DayAgenda`), not the old pixel-grid timeline; drag-to-reschedule went with it | Denser and readable on a phone | `docs/features/daily.md` |

## Data and integrations

| Decision | Why | Details |
|---|---|---|
| `time_blocks.effective_until` was not added | An end date is a feature with its own UI; a column with no reader or writer is speculative schema | `docs/features/planning-calendar.md` |
| ES-DE sync is its own function and secret, not a `phone-gateway` action | Revoking the handheld must never revoke the iPhone | `docs/backend/edge-functions.md` |
| Steam wishlist and PS Store wishlist are not built | No official endpoint | `docs/features/games.md` |
| PlayStation playtime and trophies stay two views | Sony keys them by different ids; bridging a whole library costs one call per 5 games | `docs/features/games.md` |
| `hidden` is a game `play_status`, not a separate flag | Owner's call: the status decides what the UI shows | `docs/features/games.md` |
| Tiers are gone from every Games screen (the column stays) | Owner's call | `docs/features/games.md` |
| ScreenScraper: no WebP re-encoding, no external object storage, no system/genre pictograms | CPU budget, hosting, storage wall | `docs/features/games.md` |
| Movement limitations are free text, not a CHECK enum | A fixed list would force a redeploy for every new phrasing | `docs/features/training.md` |
| Personal records are gone from every Training screen (27.09.2026) | Owner's call; the engine still uses them as evidence | `docs/features/training.md` |
| No acute:chronic workload ratio, no VO₂ max hero tile, no tape-measure or session-density charts | Weak or unsuitable evidence for one lifter's log | `docs/features/training.md`, `docs/features/health.md` |
| RPE is optional evidence, never a gate | Owner's correction | `docs/features/training.md` |
| The current program is picked explicitly, never inferred from recent workouts | A holiday or a one-off workout would misclassify it | `docs/features/training.md` |
| Apple Health is the only health source; the Fitbit / Google Health integration and the cross-source resolver are removed (01.09.2026) | Owner's decision | `docs/features/health.md` |
| No composite health or readiness score | House rule: no synthetic derived metrics | `docs/features/health.md` |
| Recipes are built in Supabase; RecipeSage was rejected | AGPL and a separate server | `docs/features/food.md` |
| Food totals are derived from their source, never frozen at log time (26.09.2026) | The owner eats by these numbers | `docs/features/food.md` |
| Wishes: no period tables, recurring MM-DD windows, seasonal reset, map or geofence | See the list | `docs/features/wishes.md` |
| Game pictures in Storage are low resolution only (covers, ScreenScraper copies); the ES-DE originals stay on the RP6's SD card (13.10.2026) | The 1 GB storage wall; the owner deleted the uploaded originals | `docs/termux-widgets.md` |
| Exercise GIFs stay on the public CDN | A full mirror is ~370 MB against the 1 GB storage wall | `docs/features/training.md` |

## Code that looks removable but isn't

These have a warning comment where they live; don't "tidy" them away.

- `section: 'today'` default in `planForm.ts` — server-side reads depend on it.
- `skipGoogleTasks` in `useTodos.ts` — prevents a task appearing on Google twice.
- The deferred `setPointerCapture` in `useSwipeToReveal.ts` — capturing on pointerdown broke every row button.
- The removed DML keyword regex in `ai-proxy`'s `run_read_query` — the database is the boundary; the regex rejected valid reads.
- The season chips in `windowChips.tsx` — the only quick way to enter a period on a phone.
- The open-wish link at the top of Daily's day list (`DayAgendaExtras.tsx`, above Anytime) — the one place on a phone where it is seen.
- The Hevy upsert copied into four functions — Dashboard deploys can't bundle shared files.
