# AGENTS.md — Lasci's Board

Agent-specific instructions for this repository. Supplements `CLAUDE.md` (the
master project guide — read that first) with rules specific to database/schema
work. See `docs/README.md` for deeper reference docs (data model, architecture).

---

## Supabase / Database Agent

**Invoke when:** creating or altering tables, writing RLS policies, designing schema, writing complex queries, or adding Edge Functions.

---

### Project Context

| Item | Value |
|---|---|
| Supabase project | Main instance (`VITE_SUPABASE_URL`) |
| RP5 games | Separate Supabase instance (`VITE_RP5_SUPABASE_URL`) — read-only views |
| Auth | Supabase Auth — every user row references `auth.users(id)` |
| ORM | None — raw `supabase-js` client everywhere |
| Secrets | `CLAUDE_API_KEY`, `OPENAI_API_KEY` — Supabase Vault only, never in client code |
| Migration numbering | Sequential, zero-padded three digits (`NNN_description.sql`). Don't hardcode "the next number" — run `ls supabase/migrations \| sort \| tail -1` to find the current highest and increment from that. |
| Deploy | **Manual** — Dashboard › SQL Editor or `supabase db push`. GitHub Actions does NOT run migrations. |

---

### Migration Rules

1. **File naming:** `NNN_short_description.sql` — zero-padded three digits, snake_case description. Check `ls supabase/migrations` for the current highest number before picking the next one.
2. **Always idempotent.** Use `CREATE TABLE IF NOT EXISTS`, `DO $$ IF NOT EXISTS` for policies, `CREATE INDEX IF NOT EXISTS`. Never assume a clean slate.
3. **Always enable RLS** immediately after `CREATE TABLE`:
   ```sql
   ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
   ```
4. **Always add an owner policy** for user-owned tables:
   ```sql
   CREATE POLICY "my_table_owner" ON my_table
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);
   ```
5. **user_id pattern:** Every user-data table gets `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`.
6. **Timestamps:** Include `created_at timestamptz NOT NULL DEFAULT now()` on every table. Add `updated_at` when rows are mutated.
7. **CHECK constraints over enums:** Prefer `text NOT NULL CHECK (col IN ('a','b','c'))` over `CREATE TYPE`. Easier to extend later.
8. **Indexes:** Add index on `(user_id, created_at DESC)` for any table that will be queried with `ORDER BY created_at` per user.

---

### Destructive Operations — Hard Rules

| Operation | Rule |
|---|---|
| `DROP TABLE` | **Always ask first.** Describe what data is lost. |
| `DROP COLUMN` | Prefer `ALTER TABLE … ALTER COLUMN … SET DEFAULT NULL` + backfill, or rename first. If truly needed, ask. |
| `DELETE FROM` without `WHERE` | **Never write this.** If intentional truncation is needed, use `TRUNCATE … RESTART IDENTITY CASCADE` and ask first. |
| `TRUNCATE` | Always ask. Include cascade implications. |
| Removing an RLS policy | Show what access it currently grants before removing. |

When in doubt: prefer additive changes. Columns can be nullable-added without risk. New tables never break existing queries.

---

### RLS Design Patterns

**Simple owner access (most tables):**
```sql
CREATE POLICY "owner" ON my_table
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**Read-only public data:**
```sql
CREATE POLICY "public_read" ON my_table
  FOR SELECT USING (true);
```

**Split read/write:**
```sql
CREATE POLICY "owner_read"   ON my_table FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner_write"  ON my_table FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON my_table FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON my_table FOR DELETE USING (auth.uid() = user_id);
```

**Checklist before finishing any migration:**
- [ ] `ENABLE ROW LEVEL SECURITY` present?
- [ ] At least one policy covers every intended access pattern?
- [ ] No policy accidentally grants cross-user access (`auth.uid()` always scoped)?
- [ ] Service role access needed for Edge Functions? (Edge Functions use the service role key from Vault — no RLS needed for server-side ops, but document it.)

---

### TypeScript Type Sync

After every schema change, update the corresponding TypeScript types in the frontend:

- Table types live near the hooks/API files that use them (e.g. `useTransitStops.ts` defines `UserTransitStop`).
- When adding a column, add it to the interface **and** to every `select('*')` or explicit select query that should return it.
- When removing a column, grep for all usages: `grep -rn "column_name" src/`.
- No auto-generated types (`supabase gen types`) — types are maintained manually alongside migrations.

---

### Query Writing Patterns

**Always use `.eq('user_id', user.id)` on mutations** — RLS is a safety net, not a substitute for explicit scoping:
```ts
const { error } = await supabase
  .from('my_table')
  .update({ field: value })
  .eq('id', id)
  .eq('user_id', user.id)   // explicit scope even with RLS
```

**Get authenticated user before any write:**
```ts
const { data: { user } } = await supabase.auth.getUser()
if (!user) throw new Error('Not authenticated')
```

**Error handling:** always destructure `{ data, error }`, always `if (error) throw error`.

**RP5 Games — special rules:**
- Read from `v_games_summary` / `v_games_full` views only.
- Write to raw `games` table.
- `series_name` exists only in the view — never `SELECT series_name FROM games`.
- Uses separate client from `VITE_RP5_SUPABASE_URL`.

---

### Linked-entity sync (migration 043) — `link_rules` + DB triggers

This app writes to Postgres from **three different doors**: the web UI, the
Ask AI panel's generic `db_insert`/`db_update`/`db_delete` tool layer, and
sync webhooks/edge functions (Hevy, Health Auto Export). Any cross-entity
consistency rule written only in one door's application code (a React hook,
an API function) silently doesn't apply when a write comes through a
different door. Real bugs this caused before migration 043: deleting a
Training-plan `time_block` left its auto-created `task` behind; dragging a
planned block to a new day never updated the linked task's due date (or vice
versa); marking a TV episode watched never cleaned up its "planned to watch"
block; deleting a Project item left its scheduled block behind too.

**The fix is DB triggers, not app code** — same principle as `audit_logs`
(migration 037): a trigger runs inside Postgres itself, so it fires no matter
which door the write came through.

- **`link_rules`** (table) — small config, NOT a fully generic rule
  interpreter. Each row is `rule_name` (unique), `enabled` (toggle a rule off
  without a migration), and a `config` jsonb blob for the one thing that
  plausibly varies per rule (e.g. `block_delete_cascades_task`'s
  `auto_task_source_types` array — which `tasks.source_type` values count as
  "this task only exists because a plan created it"). The actual matching
  logic per relationship shape (task↔block by id, episode→block by
  season/episode number, project_item→block by id) stays explicit SQL in
  typed trigger functions — Postgres has no safe generic polymorphic join
  without dynamic SQL, and dynamic SQL is a correctness/security risk not
  worth taking here. Adding a new "auto-created" task source_type, or turning
  a rule off, is a data change (`UPDATE link_rules ...`), not a code change.
- **Hub tables**: `time_blocks` and `tasks` both carry `source_type`/
  `source_id` pointing at whatever they were created from — this is the
  existing polymorphic-association pattern (see `time_blocks_source` index
  from migration 010), not something migration 043 introduced.
- **Trigger functions** (`sync_task_from_time_block`, `sync_time_block_from_task`,
  `cleanup_block_on_episode_watched`, `cleanup_block_on_project_item_delete`):
  each checks `link_rule_enabled('...')` at the top before doing anything.
- **Recursion guard**: `time_blocks` → `tasks` and `tasks` → `time_blocks`
  sync can each cause the other to fire. Guarded with `pg_trigger_depth() = 1`
  — a direct user edit propagates to the other side exactly once; that
  propagation does not bounce back and ping-pong.
- **Google Calendar/Google Tasks sync is deliberately NOT done in triggers**
  — a trigger runs inside Postgres and has no access to the end user's OAuth
  token (lives in the browser). That stays best-effort at the API layer
  (`src/features/daily/api/scheduleApi.ts`, `src/features/todo/api/tasksApi.ts`).
- **When adding a new "plannable" entity** (something else that can get a
  `time_blocks` row via `UnifiedPlanModal`'s `source` prop): decide whether it
  needs a cleanup-on-source-change trigger the same way `user_tv_episodes`/
  `project_items` do, and add it to this migration's pattern (a new trigger
  function + `link_rules` row), not a one-off app-code fix.

---

### Edge Function Rules

- Runtime: **Deno** — use `import` not `require`, no Node built-ins.
- Auth: verify JWT with `supabase.auth.getUser()` before processing.
- Secrets: read from `Deno.env.get('SECRET_NAME')` — set in Supabase Vault.
- CORS: include `Access-Control-Allow-Origin` and handle OPTIONS preflight.
- Deploy: **manual** via Supabase Dashboard or `supabase functions deploy <name>`. GitHub Actions does not deploy functions.
- Never put API keys or secrets in function source code.

---

### Schema Design Checklist

Before proposing any new table:
1. Does this data belong in an existing table (new column) or truly needs its own table?
2. Will rows be deleted when the user is deleted? → `ON DELETE CASCADE`
3. Is there a natural sort order? → add `sort_order int` or use `created_at`.
4. Will it be queried by user + time range? → add compound index `(user_id, created_at DESC)`.
5. Are there enum-like values? → `text CHECK (col IN (...))` not `CREATE TYPE`.
6. Does the feature need soft-delete? → add `deleted_at timestamptz` instead of hard delete.

---

### What This Agent Does NOT Do

- Does not push migrations automatically — always outputs SQL for manual review.
- Does not modify `auth.users` schema.
- Does not touch the RP5 Supabase schema (separate project, read-only for us).
- Does not generate Supabase client configuration — `src/integrations/supabase/client.ts` is the source of truth.
