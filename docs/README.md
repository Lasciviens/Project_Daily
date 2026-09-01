# docs/

Some of these are authoritative runbooks you must follow exactly; some are a live
coordination channel between two AIs; some are verified reference. Read the group
heading before you trust a file.

**Where current truth lives:** feature/architecture state → `CLAUDE.md` (repo root) ·
DB/schema rules → `AGENTS.md` · the actual schema → `supabase/migrations/*.sql` (plus
`ai-proxy`'s `DB_CATALOG` as the curated table-by-table reference) · the live backlog →
the in-app **Dev Requests** drawer (`dev_requests` table), not a markdown list ·
cross-AI task board → `codex-shortcuts.md`.

## Runbooks / setup — authoritative, follow exactly

| File | Purpose | Last verified |
|---|---|---|
| `iphone-examples.md` | `phone-gateway` one-time server steps, the `x-phone-secret` pattern, and the full 11-action API table — deterministic `log_supplement`/`log_food`/`log_water`/`nutrition_today`/`recent_foods`/`search_library`/`sleep_stats`/`tasks_today` plus AI `ask`/`brief`/`sleep`. This table is the contract Shortcuts and widgets must match. | 24/07/2026 |
| `web-push-setup.md` | Lock-screen morning push: VAPID key generation, the four Vault secrets, the `VITE_VAPID_PUBLIC_KEY` build variable, migration `068`, deploying `push-send` with JWT verification OFF, then subscribing from the installed PWA. | 25/07/2026 |
| `scriptable-food-logger.md` | Setup + full source of the `Yemek Logla` Scriptable mini app: log food from recents, your own ingredient library, Open Food Facts search, or a scanned barcode. | 25/07/2026 |
| `scriptable-widgets.md` | Setup + full source of the 4 home-screen widgets (`Uyku Paneli`, `Komuta Merkezi`, `Hizli Log Paneli`, `Makro Halkalari`) and the `HizliLog` runner. **Script names are load-bearing** — W3's deep links resolve by name. | 24/07/2026 |
| `health-auto-export/` | Importable Health Auto Export automation configs (`README.md` + `01`–`05`: recurring metrics, weekly reconciliation, recurring workouts, and the two one-time backfills). Required app settings are **Export Version 2, Summarize ON, Time Grouping: Hours**. | 25/07/2026 |

## Live coordination — read fresh every session, never summarise from memory

| File | Purpose | Last verified |
|---|---|---|
| `coord/README.md` | The two-channel append-only Codex ⇄ Claude protocol: message format, who writes where, and the loop. | 23/07/2026 |
| `coord/to-codex.md` | Claude → Codex append-only log. Claude writes only; newest entry on top. | 25/07/2026 |
| `coord/to-claude.md` | Codex → Claude append-only log. Codex writes only; never edit it. | 24/07/2026 |
| `codex-shortcuts.md` | The stable spec + task board for Codex, who owns `scripts/iphone-shortcuts/`: the role split, the 6 rules, and the C-numbered tasks with statuses. | 25/07/2026 |

## Reference — verified, durable

| File | Purpose | Last verified |
|---|---|---|
| `ai-cost-capability-analysis.md` | AI layer cost + capability reference as shipped: the prompt-caching contract, `db_aggregate`/`semantic_search`/`run_read_query` design, tool slicing, model routing, security invariants, pricing snapshot. Read before any `ai-proxy`/`aiApi.ts` cost or capability work. | 25/07/2026 |
| `iphone-web-integration.md` | Why the iPhone integration is shaped this way: the auth model, hard iOS platform limits, and the options evaluated and rejected. | 25/07/2026 |

## Raw artifacts

| File | Purpose | Last verified |
|---|---|---|
| `EnTur_API.postman_collection.json` | Hand-built EnTur JourneyPlanner v3 + geocoder collection, including the `sources=nsr` reproduction case and the introspection queries behind the "verify EnTur fields live before use" rule. The live-verified *usage* is documented in CLAUDE.md's Transit section. | 28/06/2026 |

---

- Every new doc must be added to this index with a "last verified" date.
- Repo artifacts are English-only (Turkish appears only inside on-phone user-facing strings).
- **Don't add phase trackers, DoD checklists or PM-approval docs** — process scaffolding gets
  deleted once the work ships; only durable facts stay.
- When a doc is superseded, re-home its durable facts (into `CLAUDE.md` or the successor doc)
  **before** deleting it.
