# docs/

Reference and architecture documents for Lasci's Board. These are secondary
references — `CLAUDE.md` (repo root) is the up-to-date source of truth for
current feature/schema state; files here are not guaranteed to be kept in
sync with every migration.

| File | Purpose |
|---|---|
| `data-model.md` | Early/partial Postgres schema notes. **Stale** — only covers a handful of early tables (see the warning at the top of that file). For the current schema, prefer `supabase/migrations/` (source of truth) or `supabase/functions/ai-proxy/index.ts`'s `DB_CATALOG` (a curated, actively-maintained table-by-table reference used by the AI assistant). |
| `architecture/mcp-future.md` | Future MCP integration architecture (not yet implemented) |
| `health-auto-export/` | Importable Health Auto Export automation configs (daily sync, weekly reconciliation, workouts, one-time backfill) — see CLAUDE.md's Training/Health section for how these are used |
| `EnTur_API.postman_collection.json` | Postman collection for the Ruter/EnTur JourneyPlanner v3 API |

**Agent-specific DB/schema rules:** `AGENTS.md` (repo root).
**Backlog and active tasks:** Tracked in `CLAUDE.md` → "Not done yet" section.
**Site description and setup:** See root `README.md`.
