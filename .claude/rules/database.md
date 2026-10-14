---
paths:
  - "supabase/migrations/**"
  - "scripts/db-tests/**"
  - "src/**/api/**"
---
# Database rules

Full background and history: `docs/backend/database.md`.

## Migrations
- Name `NNN_short_description.sql`, numbered above the highest file (`ls supabase/migrations | sort | tail -1`). `056` does not exist and `058` is a deliberate no-op — never reuse those numbers.
- A merge runs each new file once, as ONE transaction together with its row in `deploy.applied_migrations`: no top-level `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`, nothing that can't run in a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`). Never edit or rename a migration that ran — write a new one. The Actions log is public: no personal data in `raise` texts.
- Idempotent: `IF NOT EXISTS`, `DROP … IF EXISTS` before `CREATE TRIGGER`, the `pg_policies` guard for policies. It must survive a re-run.
- Every table: RLS on right after `CREATE TABLE`; owner policy `USING ((select auth.uid()) = user_id) WITH CHECK (…)` — `(select auth.uid())`, never bare `auth.uid()` (046); `user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE` (the default is load-bearing — the client and the assistant insert without it); `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at` when rows change; `text CHECK (col IN (…))` instead of enum types; an index on `(user_id, <the column you filter or sort by>)`.
- End every table-creating migration with `select public.owner_lock_apply('public.<table>');` (139).
- A user-authored table gets `trg_audit` (`log_audit()`) in the same migration, or a one-line reason in the header why not (bulk-synced `hevy_*`/`health_*`/`strava_*`, high-frequency append-only tables).
- An audited table is undoable from Developer → Activity (150/151, `app_undo_transaction`, through the table's own triggers): give it a single `id` primary key (a one-row-per-account settings table may use `user_id`), or Undo lists its changes as blocked. `audit_logs.seq` is the order of changes inside a save — never drop it.
- A new outbox table (a queue for an outside service) goes into `app_undo_outbox` (151) with `user_id` and `created_at default now()`, or Undo's preview won't say what it sends there. A new sync clock or outside-copy state column goes into `app_undo_bookkeeping` (or every undo of it reads "not exactly as before"); a new link to an outside copy (an event, task or note id) into `app_undo_links` (or Undo puts an old id back that names nothing there).
- `GRANT EXECUTE` on every new function. Token tables: `REVOKE ALL … FROM anon, authenticated`, no browser policy, never in `ai-proxy`'s `DB_CATALOG`.
- A trigger that inserts a row tied to a user (audit, outbox, queue) skips a user that no longer exists, or deleting the account aborts.
- Dropping a table or column: grep the hard-coded name lists first (037's audit array, 046's policy list, `DB_CATALOG`).
- A new foreign key decides what a delete takes with it and what Undo brings back (`app_delete_rows`, 144, follows single-column FKs: CASCADE rows are deleted and restored, SET NULL links are restored). A rule that deletes or changes rows without a foreign key must be added to `app_delete_rows` too, or Undo misses it.
- Ask the owner before `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, removing a policy or a grant. Never `DELETE FROM` without `WHERE`. Prefer additive changes.

## Client code against the schema
- The website can meet an older schema (a failed migration, a revert): a read/write of a new column catches `42703`/`PGRST204` and retries once without it; a new table gets a missing-table guard that renders empty; a write that needs it throws a named "migration NNN not applied" error. Note the fallback's removal condition.
- Types are written by hand next to the api/hooks that use them; update every select that should return a new column.
- Mutations scope explicitly with `.eq('user_id', userId)` even with RLS; `requireUser()` gives the id from the local session. Destructure `{ data, error }` and throw on `error`.
- PostgREST returns at most 1,000 rows: page open-ended reads with `.range()` until a page comes back short.

## Cross-entity rules live in the database
- The app writes through three doors (web, the assistant's db tools, edge functions/webhooks), so a rule that must always hold is a trigger, not app code (043 `link_rules`, 077, 141, 142, 143, 149's watch cache).
- Google calls never run in a trigger (no OAuth token there): a server-side block delete only queues its Calendar event in `calendar_outbox` (135).
- A claim query with per-row ordering uses a `NOT EXISTS` anti-join inside the CTE that carries `FOR UPDATE … SKIP LOCKED` — never a window function upstream of the lock (079; check `EXPLAIN` shows `LockRows`).
- An RPC scoped through `effective_user_id(p_user_id)` needs `p_user_id` at every service-role call site (a service role has no `auth.uid()`).
- A new uniqueness constraint over old data: backfill and de-duplicate first, then create the index.

## The assistant and cron
- A new user table is invisible to the assistant until added to `DB_CATALOG` in `supabase/functions/ai-proxy/index.ts` with a deliberate `rw`/`ro` (synced tables are `ro`).
- pg_cron: idempotent `cron.unschedule` + `cron.schedule`; read secrets from Vault inside the job, never inline; pg_cron runs in UTC.
