# Database and Supabase — background

> Moved out of AGENTS.md on 13.10.2026. The rules themselves are short and live in `.claude/rules/database.md` and `.claude/rules/edge-functions.md`; this file keeps the reasoning, examples and history behind them.

## Project Context

| Item | Value |
|---|---|
| Supabase project | Main instance (`VITE_SUPABASE_URL`) — Games (`games`/`game_platforms`, migration 089) lives here too now; the separate RP5 Supabase project is retired |
| Auth | Supabase Auth — every user row references `auth.users(id)`; single-user app in practice |
| ORM | None — raw `supabase-js` client everywhere |
| Client env vars | See `docs/backend/environment.md`. Ground truth: `grep -rhoE 'VITE_[A-Z0-9_]+' src/ index.html vite.config.ts \| sort -u` |
| Server secrets | Edge Function secrets (read with `Deno.env.get`) and, for cron jobs, Supabase Vault — never in client code or function source. Ground truth: `grep -rhoE "Deno.env.get\(['\"][A-Z0-9_]+" supabase/functions/ \| sort -u`. `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are **injected by the platform** — do not add those to Vault. |
| Migration numbering | Sequential, zero-padded three digits (`NNN_description.sql`). A new file is numbered **above 140** and unique — run `ls supabase/migrations \| sort \| tail -1` and increment. `scripts/deploy/run-migrations.mjs --check` (PR check) refuses anything else. |
| Deploy | **Automatic on merge to main** (`.github/workflows/deploy.yml`, since 11.10.2026): new migrations (numbered above 140, each run once, recorded in `deploy.applied_migrations`), then every edge function (`supabase functions deploy`, JWT settings from `supabase/config.toml`), then the website. A failing migration stops the run. Needs the secrets `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_URL` in the GitHub environment `production` (main only — never as repository secrets; `docs/deploy-setup.md`); without them only the website deploys. Never run a migration numbered above 140 by hand — the workflow would run it again. Migrations up to 140 were applied by hand and are never run by the workflow. |

**Numbering gap:** `056` does not exist (the sequence runs `055 → 057`) and `058`
is an intentional dead no-op — both are documented in `058`'s own header and in
`scripts/generate-matvaretabellen-seed.mjs`. Never "fill" `056`; a new file with
that number would collide with a deleted one in history.

---

## Migration Rules

1. **File naming:** `NNN_short_description.sql` — zero-padded three digits, snake_case description. Check `ls supabase/migrations` for the current highest number before picking the next one.
   **It runs automatically on merge, exactly once** (`scripts/deploy/run-migrations.mjs`): the whole file is sent as ONE query together with its row in `deploy.applied_migrations`, so it is one transaction — a failure keeps nothing and the next merge tries it again. Therefore:
   - **No `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT` at the top level** (the PR check refuses them; function bodies are fine). For repeatable read put `set transaction isolation level repeatable read;` on the first line.
   - Nothing that cannot run inside a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`).
   - Never edit or rename a migration after it ran (the workflow only warns and does not run it again): put the change in a new file.
   - The order on merge is always **migrations → edge functions → website**. When a function must be live BEFORE a migration (as 130 and 136 needed), ship two PRs: the function first, the migration in the next.
   - Actions logs are public: no personal data in `raise notice`/`raise exception` texts.
2. **Always idempotent.** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`, and the `DO $$ ... pg_policies` guard for policies (rule 4). Never assume a clean slate — every migration must survive being re-run.
3. **Always enable RLS** immediately after `CREATE TABLE`:
   ```sql
   ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;
   ```
   Enabling RLS is separate from having a policy: RLS on with no policy denies
   everything, which is the safe direction. Never ship the reverse.
4. **Owner policy — the canonical form** (copy this verbatim; it is what `067`/`068` use):
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'my_table'
         AND policyname = 'Users manage own my_table'
     ) THEN
       CREATE POLICY "Users manage own my_table"
         ON public.my_table
         FOR ALL
         USING ((select auth.uid()) = user_id)
         WITH CHECK ((select auth.uid()) = user_id);
     END IF;
   END $$;
   ```
   **`(select auth.uid())`, never bare `auth.uid()`.** The scalar subquery makes
   Postgres evaluate it once per statement as an InitPlan instead of per row —
   Supabase's documented fix for the `auth_rls_initplan` linter warning.
   Migration `046` converted the whole corpus to this form; writing bare
   `auth.uid()` re-introduces the warning it existed to clear. Access semantics
   are identical, so there is never a reason to "simplify" it back.
5. **`user_id` pattern:** every user-data table gets
   `user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE`.
   The `DEFAULT` is load-bearing — the client and the AI's `db_insert` tool both
   insert rows without an explicit `user_id`.
6. **Timestamps:** `created_at timestamptz NOT NULL DEFAULT now()` on every table. Add `updated_at` when rows are mutated.
7. **CHECK constraints over enums:** prefer `text NOT NULL CHECK (col IN ('a','b','c'))` over `CREATE TYPE`. Easier to extend later.
8. **Indexes:** index `(user_id, <the column you actually filter or sort by>)` — that is `date` for day-scoped tables (`water_log_entries`, `time_blocks`), `created_at DESC` only when the query really orders by insertion time, plain `(user_id)` when the whole set is read at once (`push_subscriptions`).
9. **Audit trigger:** a new **user-authored** table gets `trg_audit` in the same migration, or a one-line reason in the file header for why not:
   ```sql
   DROP TRIGGER IF EXISTS trg_audit ON public.my_table;
   CREATE TRIGGER trg_audit
     AFTER INSERT OR UPDATE OR DELETE ON public.my_table
     FOR EACH ROW EXECUTE FUNCTION public.log_audit();
   ```
   `037` attached it to a hardcoded table list, so anything created afterwards
   is **not** covered automatically — `052` exists solely because `dev_requests`
   (created in `042`) was missed and deleted rows left no recoverable trace.
   Exempt by design, and say so in the header: bulk-synced tables (`hevy_*`,
   `health_*`, `strava_*` — sync spam) and high-frequency append-only tables
   (`water_log_entries`, `push_subscriptions`).
   The log is also what "Undo this save" (Developer → Activity, migration
   `150`) works from: one save = one `tx_id`, `seq` orders the changes inside
   it, and `app_undo_transaction` puts back exactly what that transaction
   changed — so an audited table needs a single `id` primary key to be
   undoable, and a table without `trg_audit` can't be undone at all
   (`docs/features/developer.md`).
10. **Grants:** table CRUD for the `authenticated` role is already covered by
    Supabase's public-schema default privileges — the explicit `GRANT SELECT,
    INSERT, UPDATE, DELETE ... TO authenticated` lines in migrations up to `051`
    are belt-and-braces, not a requirement for a new table (`066`/`067`/`068`
    ship none and work in production). **`GRANT EXECUTE` on a new function IS
    required** (see `065`'s `ai_semantic_search`).
    Deliberate exception, do not undo: `044` **revokes** `authenticated` access
    to `user_calendar_tokens` entirely and narrows `strava_tokens` to three
    non-secret columns. RLS limits rows; only grants limit **columns** — that is
    the whole reason that migration exists.
11. **A drop is never a one-file change.** Before dropping a table or column,
    grep the repo for hardcoded name lists that reference it: `037`'s audit
    attach array, `046`'s policy list, and `ai-proxy`'s `DB_CATALOG`. Already-applied
    migrations that name a since-dropped table stop being re-runnable (`037`
    names `recipe_meal_plans`, which `061` drops) — acceptable for applied
    history, never acceptable for the migration you are writing.
12. **Owner lock (`139`).** The app serves one owner (plus an optional test
    account listed in `public.app_allowed_users`). Every table in `public` and
    `storage.objects` carries the restrictive policy `app_owner_lock`
    (`public.is_app_user()`), so any other signed-in account sees and writes
    nothing. **A migration that creates a table must end with**
    `select public.owner_lock_apply('public.<table>');` —
    `scripts/verify-owner-lock.cjs` fails otherwise. Undo in an emergency:
    `select public.owner_lock_disable();` (drops every `app_owner_lock` policy).
13. **Token tables are service-role only.** A table holding a provider token
    or secret gets `REVOKE ALL ON … FROM anon, authenticated` in the migration
    that creates it (044, 140), RLS on, no browser policy, and never enters
    `ai-proxy`'s `DB_CATALOG`. The browser only ever sees derived status.
14. **A trigger that inserts a row tied to a user** (audit, outbox, queue) must
    skip a user that no longer exists (`IF NOT EXISTS (SELECT 1 FROM auth.users
    WHERE id = …) THEN RETURN …`): deleting an account cascades into every
    table, and an insert for the vanishing user aborts the whole deletion
    (135, 140).

---

## Destructive Operations — Hard Rules

| Operation | Rule |
|---|---|
| `DROP TABLE` | **Always ask first.** Describe what data is lost. |
| `DROP COLUMN` | Prefer leaving it nullable/unused, or rename first. If truly needed, ask. |
| `DELETE FROM` without `WHERE` | **Never write this.** If intentional truncation is needed, use `TRUNCATE … RESTART IDENTITY CASCADE` and ask first. |
| `TRUNCATE` | Always ask. Include cascade implications. |
| Removing an RLS policy | Show what access it currently grants before removing. |
| Removing a `GRANT` | State which client code loses access (verify by grepping `src/`, as `044` did). |

When in doubt: prefer additive changes. Columns can be nullable-added without risk. New tables never break existing queries.

---

## RLS Design Patterns

**Simple owner access (most tables)** — use the guarded `FOR ALL` block from
Migration Rule 4. The bare-`CREATE POLICY` shorthand below is shown only to name
the clauses; ship the guarded version.

```sql
CREATE POLICY "Users manage own my_table" ON public.my_table
  FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
```

**Read-only shared metadata** (`movies`, `tv_series` — not user-owned):
```sql
CREATE POLICY "public_read" ON public.my_table FOR SELECT USING (true);
```
These still need an explicit UPDATE policy if the app upserts refreshed metadata
— a missing one silently freezes rows at first insert (the bug `050` fixed).

**Split read/write** (only when the commands genuinely differ):
```sql
CREATE POLICY "owner_read"   ON public.my_table FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "owner_write"  ON public.my_table FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "owner_update" ON public.my_table FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "owner_delete" ON public.my_table FOR DELETE USING ((select auth.uid()) = user_id);
```

**Checklist before finishing any migration:**
- [ ] `ENABLE ROW LEVEL SECURITY` present?
- [ ] At least one policy covers every intended access pattern, wrapped in the `pg_policies` guard?
- [ ] Every policy uses `(select auth.uid())`, scoped to `user_id`, no cross-user leak?
- [ ] `GRANT EXECUTE` on any new function?
- [ ] `trg_audit` attached, or a stated reason why not?
- [ ] Re-runnable end to end (`IF NOT EXISTS` / `DROP … IF EXISTS` everywhere)?
- [ ] Does `ai-proxy`'s `DB_CATALOG` need the new table (and a redeploy)? See below.
- [ ] Does the client need a column-missing fallback for the window before this is applied? See below.
- [ ] Edge Functions needing server-side access use the service role (which bypasses RLS) — document that in the migration header if it applies.

---

## Client code must degrade, not throw, on an older schema

On merge the workflow runs migrations BEFORE the website deploys, but the
website can still meet an older schema: the deploy secrets may be missing (then
only the website deploys), a migration can fail after a previous one ran, and
a merge can be reverted. Keep every client read/write safe on the schema before
your migration.

- A read/write touching a column added by an unapplied migration must catch the
  column-missing error (`42703` from Postgres, `PGRST204` from PostgREST) and
  **retry once without that field**. Reference implementations:
  `recipesApi.ts` (`recipes.fiber_g` / `is_temp`), `foodLogApi.ts` +
  `mealPlanApi.ts` + `dayNutritionApi.ts` (the `food_log_entries.status` dual
  path around `061`).
- A new **table** gets a missing-table guard so the feature renders empty
  instead of crashing the page (see `fetchDayNutrition`'s pre-`053` guard).
- Note the fallback's removal condition in a comment ("drop once 0NN is
  applied") so it does not become permanent.
- Never build a filter on a column that may not exist yet — a `.eq()` on it
  errors before any fallback can run; branch on a probe first.

---

## `ai-proxy` DB_CATALOG obligation

The Ask AI panel's generic CRUD layer (`db_query`/`db_insert`/`db_update`/
`db_delete`) is a **default-deny allow-list** (`DB_CATALOG` in
`supabase/functions/ai-proxy/index.ts`). A new user table is invisible to the
assistant until it is added there, with a deliberate `access: 'rw' | 'ro'`
decision — externally synced tables (`hevy_*`, `health_*`, `strava_activities`,
`movies`, `tv_series`) are `'ro'`; token/secret tables are never listed at all.
Changing the catalog means **redeploying `ai-proxy`**; say so in the PR's manual
steps.

Two lists beside it guard what the assistant may DO (security audit
10.10.2026, `scripts/verify-ai-confirm.cjs`):
- `NEEDS_CONFIRM` — tools that only become a Confirm card (today `db_delete`,
  `update_hevy_routine`). A new tool that deletes, overwrites or writes to an
  outside account goes here.
- `AI_NO_WRITE` — columns the assistant may never set: anything that links a
  row to an object in an outside account (a Google Calendar event or Task, a
  Trakt note or list, an ES-DE or ScreenScraper entry, a login session),
  because a background job then changes or deletes that object. A new such
  column goes here.

---

## pg_cron jobs

Reference: `068_push_subscriptions.sql`.

- `create extension if not exists pg_cron;` / `pg_net;` at the top; note in the
  header that they may need enabling in Dashboard › Database › Extensions.
- Idempotent scheduling: `cron.unschedule(<name>)` if it exists, then
  `cron.schedule(...)`.
- **Read the secret from Vault inside the job body**, never inline it in the
  migration text:
  `coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'X'), '')`.
  A missing secret must degrade to the target function rejecting the call (no
  action, no harm), not to a leaked value in migration history.
- pg_cron runs in **UTC** — state the intended local time and accept the DST
  drift explicitly, or compute it.

---

## TypeScript Type Sync

After every schema change, update the corresponding TypeScript types in the frontend:

- Table types live near the hooks/API files that use them (e.g. `useTransitStops.ts` defines `UserTransitStop`).
- When adding a column, add it to the interface **and** to every `select('*')` or explicit select query that should return it.
- When removing a column, grep for all usages: `grep -rn "column_name" src/`.
- No auto-generated types (`supabase gen types`) — types are maintained manually alongside migrations.

---

## Query Writing Patterns

**Always use `.eq('user_id', user.id)` on mutations** — RLS is a safety net, not a substitute for explicit scoping:
```ts
const { error } = await supabase
  .from('my_table')
  .update({ field: value })
  .eq('id', id)
  .eq('user_id', user.id)   // explicit scope even with RLS
```

**The user id for a write comes from `requireUser()`** (`src/shared/utils/requireUser.ts`), which reads the local session (`getSession`) — no request to the auth server before every save (13.10.2026); RLS checks the id on the server.

**Error handling:** always destructure `{ data, error }`, always `if (error) throw error`.

**Pagination is mandatory for open-ended ranges.** PostgREST caps every response
at 1000 rows server-side regardless of an explicit `.limit()`, and with
ascending order the cap silently drops the **newest** rows. Loop
`.range(offset, offset + 999)` until a page comes back short (see
`fetchHealthMetricSeries` — this was a real, invisible data-truncation bug).

**Games — migration 089.** `games`/`game_platforms` live in this app's own
database now (moved off the separate RP5 Supabase project). Plain
`select('*')` + client-side join in `gamesApi.ts` (`attachPlatforms`) — no
views. `genres`/`series_name` are plain columns on `games`, not a normalized
lookup join.

---

## Linked-entity sync (migration 043) — `link_rules` + DB triggers

This app writes to Postgres from **three different doors**: the web UI, the
Ask AI panel's generic `db_insert`/`db_update`/`db_delete` tool layer, and
sync webhooks/edge functions (Hevy, Health Auto Export, the phone gateway). Any
cross-entity consistency rule written only in one door's application code (a
React hook, an API function) silently doesn't apply when a write comes through a
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
  "this task only exists because a plan created it"; as of migration 047 that
  array was `training_session` + `movie` + `project_item`). **This cascade
  SOFT-CANCELED, it did not delete** (migration 047): when a plan's block was
  deleted, the linked task became `status='cancelled'` (reversible, visible),
  never a hard `DELETE`.
  **⚠️ RETIRED by migration 077 (22.08.2026):** `block_delete_cascades_task`
  and its sibling `block_task_date_sync` (the trigger that kept
  `tasks.due_date`/`due_time` and `time_blocks.date`/`start_time`
  bidirectionally equal) are now `enabled=false` with a "RETIRED" description
  — a Task's deadline and its optional one-off schedule slot are independent
  facts now, by explicit user decision (the Tasks/Schedule model fix): deleting
  or moving a task-linked block never touches the task any more, and the
  reverse (task hard-delete → its block is removed) is a real FK
  (`time_blocks.task_id ON DELETE CASCADE`), not a trigger. The rows are
  disabled + redescribed, not dropped, so the history stays legible. The
  matching
  logic per relationship shape (episode→block by season/episode number,
  project_item→block by id) still stays explicit SQL in
  typed trigger functions — Postgres has no safe generic polymorphic join
  without dynamic SQL, and dynamic SQL is a correctness/security risk not
  worth taking here. Adding a new "auto-created" task source_type, or turning
  a rule off, is a data change (`UPDATE link_rules ...`), not a code change.
- **Hub tables**: `time_blocks` and `tasks` both carry `source_type`/
  `source_id` pointing at whatever they were created from — this is the
  existing polymorphic-association pattern (see `time_blocks_source` index
  from migration 010), not something migration 043 introduced. **As of
  migration 077, `time_blocks.source_type` never equals `'task'`** — "linked
  to a Task" is `time_blocks.task_id` (a real FK) exclusively, so
  `source_type`/`source_id` on a task-linked block always describe the block's
  REAL originating entity (or are null for a plain manual block), never the
  task itself.
- **Trigger functions** (`cleanup_block_on_episode_watched`,
  `cleanup_block_on_project_item_delete`): each checks `link_rule_enabled('...')`
  at the top before doing anything. **`sync_task_from_time_block` and
  `sync_time_block_from_task` were DROPPED entirely by migration 077** (not
  just disabled) — they implemented the retired bidirectional due-date/
  schedule-date sync above. The one surviving Task↔block cross-effect is
  one-directional: `sync_time_block_title_from_task` mirrors a Task title
  edit onto its linked block's title (`AFTER UPDATE ON tasks`, guarded by
  `pg_trigger_depth() = 1` like the others).
- **Migration 077's backfill — duplicate-safe, and never invents episode identity.** Before the `time_blocks_one_per_task` unique index is created, the backfill processes every legacy `source_type='task'` row OLDEST FIRST (`created_at, id`): the first row for a given task becomes its canonical linked block (`task_id` set); every LATER row for the SAME task — a duplicate the pre-077 model had no constraint against — is detached to a standalone block exactly like an orphan (task gone), never deleted. Do this ordering (backfill+dedup, THEN create the unique index) for any future migration that introduces a new uniqueness constraint over data that predates it — creating the index first and hoping the data is already clean is how a migration fails halfway on an environment you didn't audit. Separately: recovering `tv_series` → `tv_episode` for a legacy block only happens when that SPECIFIC block already carries real `season_number`/`episode_number` — a block with neither keeps `task_id` (the real link) but gets `source_type`/`source_id` left NULL, never a guessed `'tv_episode'` with no episode numbers behind it. The migration ends with a `RAISE EXCEPTION`-based assertion block (row count preserved, zero `source_type='task'` rows, zero orphan/duplicate `task_id` links, the unique index + both surviving triggers + `schedule_blocks`' new columns all present) — a migration that can silently leave a half-correct schema behind should fail loudly instead, not rely on a human re-reading the SQL to notice.
- **The Google Tasks outbox's per-task ordering (migration 079) is the same class of bug as the Hevy incremental-sync race, generalized**: `FOR UPDATE SKIP LOCKED` (migration 073) only ever guaranteed no two workers claim the SAME row — it never guaranteed rows for the SAME task drain in the order they were enqueued. `claim_google_tasks_outbox`'s per-task ordering is expressed as a `NOT EXISTS` anti-join (`older.task_id = o.task_id AND (older.created_at, older.id) < (o.created_at, o.id)`) inside the SAME CTE the `FOR UPDATE OF o SKIP LOCKED` clause is attached to — concurrency across DIFFERENT tasks is untouched; only same-task ordering became absolute. `clear_google_task_id_if_matches(task_id, expected_google_task_id, p_user_id)` is the belt-and-suspenders half: a conditional `UPDATE ... WHERE google_task_id = expected` that reports `FOUND` back to the caller, so a stale delete processed out of order (despite the FIFO fix) still can't wipe a fresher id written after it. Any future outbox/queue-style table in this app should default to this same two-layer pattern (ordering at the claim level, a conditional write as the backstop) rather than trusting FOR UPDATE SKIP LOCKED alone to imply ordering it was never designed to provide.
  - **A `row_number() OVER (...)` window function must NEVER sit in the same query as (or upstream of, via a CTE selected-from-rather-than-locked-in) a `FOR UPDATE`/`FOR SHARE` clause — the ORIGINAL version of `claim_google_tasks_outbox` got exactly this wrong and it was caught only by running a live `EXPLAIN` against it.** That version computed `row_number() OVER (PARTITION BY task_id ORDER BY created_at, id)` in a `ranked` CTE, then applied `FOR UPDATE SKIP LOCKED` in a separate `claimable` CTE that selected `id FROM ranked` — not from the base table. Postgres does not propagate a locking clause into a WITH query that a query merely selects from; the clause must be attached to the SELECT INSIDE the WITH query itself. The `EXPLAIN` plan for that version had no `LockRows` node anywhere in it — the claim function had silently stopped providing any row-locking guarantee at all, while still reading as correct from the SQL alone. **Any future per-row-ordering claim query in this app must express the ordering as a `NOT EXISTS` anti-join (or otherwise keep the row-number logic OUT of a separate CTE from the lock clause) — never a window function upstream of `FOR UPDATE`.** A live `EXPLAIN` check for a `LockRows` node is the concrete way to verify a claim query like this actually locks anything, not just that it parses and returns rows.
- **`p_user_id` is not optional for a service-role caller — real bug, fixed.** Every RPC scoped through `effective_user_id(p_user_id)` (migration 072: `service_role` → `p_user_id` verbatim, anything else → `auth.uid()`) silently scopes to `NULL` if the caller omits `p_user_id`, because a service-role call carries no JWT for `auth.uid()` to fall back on. `google-tasks-sync`'s `clearGoogleTaskIdIfMatches` helper omitted it, so the cron drain's calls to `clear_google_task_id_if_matches` matched zero rows on every call — 079's stale-delete guard was live from the browser (a real user JWT, so `auth.uid()` resolves regardless of what's passed) and a complete no-op from the cron poller. Fixed by threading `userId` through the helper and its one call site in `processDelete`. **Any new RPC added behind `effective_user_id` must have its `p_user_id` argument audited at every service-role call site — the browser call site being correct proves nothing about the cron one.**
- **Recursion guard**: `time_blocks` → `tasks` and `tasks` → `time_blocks`
  sync can each cause the other to fire. Guarded with `pg_trigger_depth() = 1`
  — a direct user edit propagates to the other side exactly once; that
  propagation does not bounce back and ping-pong.
- **Google Calendar calls never run in triggers** — a trigger runs inside
  Postgres and has no access to the user's OAuth token. Moves and browser
  deletes stay at the API layer (`src/features/daily/api/scheduleApi.ts`,
  `src/features/todo/api/tasksApi.ts`; one task = one event). A block delete
  from ANY door is only *queued* by `trg_enqueue_calendar_event_delete` into
  `calendar_outbox` (migration 135) — and a repeating plan's delete by
  `trg_enqueue_calendar_series_delete` (147); `google-tasks-sync`, which holds
  the token, removes the event.
- **A synced workout completes its planned session in the database (migration
  141).** `trg_hevy_workout_completes_plan` on `hevy_workouts` marks the
  planned training task done and sets `tasks.hevy_workout_id` (never deletes,
  never a future plan); `trg_tasks_link_training` fills `tasks.hevy_routine_id`
  for every writer. These two columns are real FKs to the Hevy mirror (ON
  DELETE SET NULL) — unlike 084/112, which chose none — because the sync
  upserts Hevy rows in place. Edge functions must not close or delete
  training tasks themselves.
- **A watch and the columns that cache it (migration 149).** Every watch of an
  episode or movie is a `media_watches` row; `user_tv_episodes` and
  `user_movie_entries` keep `watched_at`/`repeat_count` only as a cache
  (`trg_media_watch_cache`: latest watch, count − 1; no watch = not watched,
  `watched_at` NULL — the row stays so an Undo can put a watch back on it).
  A watch that names an `episode_id` that isn't there raises a foreign-key
  error (150's undo retries it after putting the episode back) instead of
  making a second row for the episode.
  A write to the cache columns from any door (the assistant's `db_update`, the
  Trakt sync's summary writes, SQL, the app's older paths) is translated into
  watches by DEFERRED constraint triggers (`trg_media_watch_reconcile`) — so
  `app_restore_rows`, which puts back an entry and then its watches in one
  transaction, is seen whole and nothing doubles. Two transaction-local
  settings guard the loops: `app.media_watch_cache` (the cache trigger's own
  writes queue no translation — the constraint trigger's `WHEN`) and
  `app.media_watch_bulk` (unmarking a whole item deletes its watches without a
  per-play Trakt remove each). Trigger order matters: `trg_media_watch_cache`
  runs before `trg_trakt_outbox_watch` (name order), so the last watch of an
  episode removed queues only the episode-wide remove. A rewatch round
  (`rewatch_round`) is finished by the cache trigger too, for every door.
- **When adding a new "plannable" entity** (something else that can get a
  `time_blocks` row via `UnifiedPlanModal`'s `source` prop): decide whether it
  needs a cleanup-on-source-change trigger the same way `user_tv_episodes`/
  `project_items` do, and add it to this migration's pattern (a new trigger
  function + `link_rules` row), not a one-off app-code fix.

---

## Edge Function Rules

- Runtime: **Deno** — use `import` not `require`, no Node built-ins.
- **Every function must be self-contained. No `_shared/` imports.** Supabase
  Dashboard deploys do not bundle sibling `_shared/` files, so any such import
  fails the deploy with "Module not found". This is why the Hevy upsert logic is
  **inlined verbatim into all four Hevy functions** (`hevy-sync`,
  `hevy-initial-sync`, `hevy-incremental-sync`, `hevy-api`), each carrying a
  header comment flagging it. Consequence to accept: change that logic and you
  change it in four files by hand. Do not "fix" this by re-introducing a shared
  module.
- Secrets: `Deno.env.get('SECRET_NAME')`, set as Edge Function secrets (a cron job reads its copy from Vault). Never in
  function source. `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform, not Vault entries.
- CORS: include `Access-Control-Allow-Origin`, list every custom header the
  function accepts in `Access-Control-Allow-Headers`, and handle the OPTIONS
  preflight.
- Deploy: **automatic on merge** — `.github/workflows/deploy.yml` deploys every function (`supabase functions deploy --use-api`), after the migrations and before the website (`docs/deploy-setup.md`). A hand deploy is replaced on the next merge.

**Three auth models — pick one deliberately, and match `supabase/config.toml`:**

1. **Browser** — validate the caller's JWT in code with
   `supabase.auth.getUser(authHeader.replace('Bearer ', ''))`, **then** check the
   caller with the function's own `isAppUser(user.id)` copy (owner lock, `139`):
   a valid JWT only proves "some account", and platform `verify_jwt` alone even
   admits the public anon key. Copy the helper verbatim from another function
   (`scripts/verify-owner-lock.cjs` checks every copy is identical).
2. **Third-party webhook** — the sender presents its own
   `Authorization: Bearer <vault secret>`, which is *not* a Supabase JWT.
3. **Device / cron** — a custom header secret (`x-phone-secret`,
   `x-cron-secret`, `x-sync-secret`) compared against a Vault value, after which
   the function acts as the single user (`HEVY_USER_ID`) with the service role.
   The service key stays server-side, never on the device.

Models 2 and 3 **require `verify_jwt = false`**: platform JWT verification
rejects the call before our code runs, so the webhook or cron silently stops
working (the long-standing Hevy/Health gotcha). **`supabase/config.toml` is the
one list** (14 functions on 11.10.2026); every deploy applies it, and a function
missing from it gets JWT verification switched ON. A browser call without a
JWT (`fetch` without `Authorization`, an `<img>`) needs the same entry, like
`news-proxy`. `scripts/verify-deploy-migrations.mjs` fails when a call from
`src/`, a cron job, a device script or a setup guide targets a function that is
not listed.

Rules for the secret-comparison paths:
- **Fail closed.** A missing Vault value must reject the request (`if (!secret || given !== secret) return 401`), never fall through to an unauthenticated path.
- Never log the secret, the header value, or a diff of the two.
- A Dashboard paste does not read `supabase/config.toml`: in an emergency hand
  deploy, set "Enforce JWT Verification" to match the file.
- Adding a new secret-authenticated function means a Vault entry plus a
  `config.toml` block; list both in the PR's manual steps.

---

## Schema Design Checklist

Before proposing any new table:
1. Does this data belong in an existing table (new column) or truly need its own table?
2. Will rows be deleted when the user is deleted? → `ON DELETE CASCADE`
3. Is there a natural sort order? → add `sort_order int` or use `created_at`.
4. How will it be queried? → compound index `(user_id, <that column>)`.
5. Are there enum-like values? → `text CHECK (col IN (...))` not `CREATE TYPE`.
6. How is a row deleted? → through the one delete flow (`app_delete_rows` + Undo, migration 144; `docs/features/delete-undo.md`). Keep a record instead only when the product needs one (as `tasks` does with `cancelled`).
7. Is it user-authored? → attach `trg_audit`. Bulk-synced or churny? → exempt, and say so in the header.
8. Should the AI be able to read or write it? → add it to `ai-proxy`'s `DB_CATALOG` with an explicit `rw`/`ro`, and redeploy.

---

## What This Agent Does NOT Do

- Does not modify `auth.users` schema.
- Does not generate Supabase client configuration — `src/integrations/supabase/client.ts` is the source of truth.
- Does not write raw SQL for the AI to execute beyond the read-only, guarded
  `run_read_query` path (single `SELECT`/`WITH`, `LIMIT 500`, RLS applies via a
  SECURITY INVOKER RPC). No DDL, no dynamic SQL built from model output.
