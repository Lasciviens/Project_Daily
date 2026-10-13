# docs/

Some of these are authoritative runbooks you must follow exactly; some are a live
coordination channel between two AIs; some are verified reference. Read the group
heading before you trust a file.

**Where current truth lives:** the rules every AI follows → `AGENTS.md` (repo root;
`CLAUDE.md` = `@AGENTS.md` + Claude-only notes, `.claude/rules/<area>.md` = the short rules
Claude Code loads by itself when matching files are touched) · how each feature works →
`features/` · the actual schema → `supabase/migrations/*.sql` (plus `ai-proxy`'s
`DB_CATALOG` as the curated table-by-table reference) · the live backlog → the in-app
**Dev Requests** drawer (`dev_requests` table), not a markdown list · cross-AI task
board → `codex-shortcuts.md`.

## Project guides — current state, updated in the same change as the code

| File | Purpose | Last verified |
|---|---|---|
| [features/README.md](features/README.md) | Index of the feature descriptions, one file each: daily, tasks, planning-calendar, delete-undo, wishes, dev-requests, games, home, media, shop, food, training, health, ai, iphone, books, work, projects, developer, settings. | 13.10.2026 |
| [platform-shell.md](platform-shell.md) | The app shell, routes, PWA updates (installed in the background, applied at a quiet moment) and the device-verified iOS gotchas. | 13.10.2026 |
| [design/THEME.md](design/THEME.md) | The binding UI guide: tokens, typography, primitives, layout (PageBoard), popups, the entity-modal system, the hook/query/mutation conventions. Read before any UI change. | 13.10.2026 |
| [backend/edge-functions.md](backend/edge-functions.md) | Every edge function: purpose, auth, JWT setting, and how the automatic deploy treats them. | 13.10.2026 |
| [backend/database.md](backend/database.md) | Database conventions in depth: migrations, RLS and the owner lock, audit triggers, linked-entity sync, missing-table fallbacks. The short rules are `.claude/rules/database.md`. | 13.10.2026 |
| [backend/environment.md](backend/environment.md) | Every variable and secret: client build variables, Edge Function secrets, Vault, the GitHub `production` environment. | 13.10.2026 |
| [decisions.md](decisions.md) | Decisions not to revisit, with the reason for each. | 13.10.2026 |
| [integrations/](integrations) | **Rule:** every NEW external API gets `integrations/<service>.md` — auth, endpoints, fields read and written, fields deliberately unused, traps, the date it was checked. Older APIs are added when next worked on (first: `google-tasks.md`). | 13.10.2026 |

## Runbooks / setup — authoritative, follow exactly

| File | Purpose | Last verified |
|---|---|---|
| [deploy-setup.md](deploy-setup.md) | One-time setup of the automatic deploy (merge → migrations above 140 → edge functions → website): the two secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_URL` (Session pooler) in the GitHub environment `production`, the dry run, what to do when a run fails. Setup completed 12.10.2026. | 13.10.2026 |
| [deploy-checklist.md](deploy-checklist.md) | The manual steps still open: secrets, dashboard switches and device steps a merge cannot do. | 13.10.2026 |
| [termux-widgets.md](termux-widgets.md) | RP6 Termux widget setup/update, extension examples, installed-file map, ES-DE sync coverage (now also the ES-DE push notes from `scripts/esde-push-README.md`, which stays as a short pointer), troubleshooting and dated device evidence. | 16.09.2026 |
| [kobo/SETUP.md](kobo/SETUP.md) | Kobo runbook: what is already in place, a fresh plugin install from the Mac, updating the plugin, the device secret, Project: Title, troubleshooting and how to undo. | 13.10.2026 |
| [iphone-examples.md](iphone-examples.md) | `phone-gateway` one-time server steps, the `x-phone-secret` pattern, and the full 12-action API table — deterministic `log_supplement`/`log_food`/`log_water`/`nutrition_today`/`recent_foods`/`search_library`/`sleep_stats`/`tasks_today`/`import_body_composition` plus AI `ask`/`brief`/`sleep`. This table is the contract Shortcuts and widgets must match. | 13.10.2026 |
| [web-push-setup.md](web-push-setup.md) | Lock-screen morning push: VAPID key generation, the Edge Function secrets and the one Vault secret the cron reads, the `VITE_VAPID_PUBLIC_KEY` build variable, migration `068`, then subscribing from the installed PWA. | 13.10.2026 |
| [scriptable-food-logger.md](scriptable-food-logger.md) | Setup + full source of the Scriptable food logger: log food from recents, your own ingredient library, Open Food Facts search, or a scanned barcode. **Its script name is load-bearing** — the barcode Shortcut opens it by name. | 25.07.2026 |
| [scriptable-widgets.md](scriptable-widgets.md) | Setup + full source of the 4 home-screen widgets and the quick-log runner. **Script names are load-bearing** — the deep links resolve by name. | 11.10.2026 |
| [health-auto-export/](health-auto-export/README.md) | Importable Health Auto Export automation configs (`README.md` + `01`–`06`: recurring metrics, weekly reconciliation, recurring workouts, the two one-time backfills, and the 2-hourly sleep catch-up). Required app settings are **Export Version 2, Summarize ON, Time Grouping: Hours**. | 11.10.2026 |

## Live coordination — read fresh every session, never summarise from memory

| File | Purpose | Last verified |
|---|---|---|
| [coord/README.md](coord/README.md) | The two-channel append-only Codex ⇄ Claude protocol: message format, who writes where, and the loop. | 13.10.2026 |
| [coord/to-codex.md](coord/to-codex.md) | Claude → Codex append-only log. Claude writes only; newest entry on top. | 11.10.2026 |
| [coord/to-claude.md](coord/to-claude.md) | Codex → Claude append-only log. Codex writes only; never edit it. | 24.07.2026 |
| [codex-shortcuts.md](codex-shortcuts.md) | The Claude ⇄ Codex task board: roles (both AIs work anywhere, one AI per file), the rules, what each AI is working on, and the C-numbered tasks with statuses. | 13.10.2026 |

## Reference — verified, durable

| File | Purpose | Last verified |
|---|---|---|
| [ai-cost-capability-analysis.md](ai-cost-capability-analysis.md) | AI layer cost + capability reference as shipped: the prompt-caching contract, `db_aggregate`/`semantic_search`/`run_read_query` design, model routing, the Confirm card for deletes, security invariants, pricing snapshot. Read before any `ai-proxy`/`aiApi.ts` cost or capability work. | 13.10.2026 |
| [iphone-web-integration.md](iphone-web-integration.md) | Why the iPhone integration is shaped this way: the auth model, the options evaluated and rejected, and **the one home of the iOS platform limits** (no background execution, Web Push rules, no Web Share Target, the widget refresh budget). | 13.10.2026 |
| [training/progress-engine/](training/progress-engine/README.md) | The Exercise Progress Engine (`src/features/training/progress-engine/`): algorithm, decision table + evidence-tier classification, data lineage/limitations, citations, changelog. Read before touching per-exercise progress-decision logic. | 07.10.2026 |
| [training-health/research/](training-health/research) | The fact-checked research behind Training and Health (benchmarks, metric ranking, science). A `verify-*.json` correction wins over its `research-*.json`. | 27.09.2026 |
| [trakt/REFERENCE.md](trakt/REFERENCE.md) | Trakt integration: the owner's rules (Trakt is the source of truth for what it can hold, one row per title), what Trakt holds vs what stays in the app, the two-way rules incl. notes, lists and follows, the `trakt-api` contract and the checked API facts (§12). How the import and sync work is in `features/media.md`. | 13.10.2026 |
| [kobo/REFERENCE.md](kobo/REFERENCE.md) | Durable Kobo Clara BW facts: the device, where KOReader keeps the reading data, how the plugin and `kobo-sync` fit together, firmware rules, ideas not built yet. | 13.10.2026 |
| [kobo/koreader-settings.json](kobo/koreader-settings.json) + [kobo/settings-help/](kobo/settings-help) | Every KOReader v2026.07.1 setting read from the source (with file:line), and the help text per setting — the inputs `scripts/kobo/gen-settings-catalogue.mjs` turns into the app's settings catalogue and the plugin's allow-list. | 06.10.2026 |
| [games/screenscraper-integration.md](games/screenscraper-integration.md) | ScreenScraper + ES-DE: what was verified live, the two credential pairs and premium limits, the credential-leak finding, field mapping, the measured ES-DE export, the `import_esde_games` contract, and the full API map behind the Scrape page rewrite (§16). The first scraper's sections are in `archive/screenscraper-v1.md`. | 13.10.2026 |
| [games/test-game-known-issues.md](games/test-game-known-issues.md) | The Games page's open issues, and what the old page had that was deliberately not ported. | 26.09.2026 |

## Raw artifacts

| File | Purpose | Last verified |
|---|---|---|
| [EnTur_API.postman_collection.json](EnTur_API.postman_collection.json) | Hand-built EnTur JourneyPlanner v3 + geocoder collection, including the `sources=nsr` reproduction case and the introspection queries behind the "verify EnTur fields live before use" rule. The live-verified *usage* is in `features/home.md` (Transit). | 28.06.2026 |

## Archive — history only, not current

| File | Purpose |
|---|---|
| [archive/](archive) | Retired docs kept for their history, e.g. the ten-game ES-DE completeness audit (16.09.2026), the original Kobo working plan and the first ScreenScraper scraper (`screenscraper-v1.md`). Never follow them; the current state is in the guides above. |

---

- Every new doc must be added to this index with a "last verified" date (DD.MM.YYYY).
- Every new external API gets `integrations/<service>.md` in the same change that first calls it.
- Repo artifacts are English-only (`AGENTS.md`); the on-phone Turkish text still in the Shortcuts is task C9.
- **Don't add phase trackers, DoD checklists or PM-approval docs** — process scaffolding gets
  deleted once the work ships; only durable facts stay.
- When a doc is superseded, re-home its durable facts (into `AGENTS.md`, `features/` or the
  successor doc) **before** deleting or archiving it.
