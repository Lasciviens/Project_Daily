# AGENTS.md — Lasci's Board

Agent-specific instructions for this repository. Supplements CLAUDE.md.

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
| Migration numbering | Sequential: `023_app_error_logs.sql` → next is `024_*.sql` |
| Deploy | **Manual** — Dashboard › SQL Editor or `supabase db push`. GitHub Actions does NOT run migrations. |

---

### Migration Rules

1. **File naming:** `NNN_short_description.sql` — zero-padded three digits, snake_case description. Next: `024_`.
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
