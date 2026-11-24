# Database and Supabase — background

> Moved out of AGENTS.md on 13.10.2026. The rules themselves are short and live in `.claude/rules/database.md` and `.claude/rules/edge-functions.md`; this file keeps the reasoning, examples and history behind them.

## Project Context

| Item | Value |
|---|---|
| Supabase project | Main instance (`VITE_SUPABASE_URL`) — Games (`games`/`game_platforms`, migration 089) lives here too now; the separate RP5 Supabase project is retired |
| Auth | Supabase Auth — every user row references `auth.users(id)`; single-user app in practice |
| ORM | None — raw `supabase-js` client everywhere |
| Client env vars | See `docs/backend/environment.md`. Ground truth: `grep -rhoE 'VITE_[A-Z0-9_]+' src/ index.html vite.config.ts \| sort -u` |
| Server secrets | Edge Function secrets (read with `Deno.env.get`) and, for cron jobs, Supabase Vault — never in client code or function source. Ground truth: `grep -rhoE "Deno.env.get\(['\"][A-Z0-9_]+" supabase/functions/ \| sort -u`. `SUPABASE_URL` and the Supabase keys (`SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS`, legacy `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`) are **injected by the platform** — do not add those to Vault; functions read them through `serviceKey()` / `publishableKey()`. |
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
   The log is also what "Undo this save" (Developer → Activity, migrations
   `150`/`151`) works from: one save = one `tx_id`, `seq` orders the changes
   inside it, and `app_undo_transaction` puts back exactly what that
   transaction changed — so an audited table needs a single `id` primary key
   (or `user_id` for a one-row-per-account settings table) to be undoable,
   and a table without `trg_audit` can't be undone at all. Its preview reads
   the undo's own audit rows and outbox rows back, so a new outbox table
   belongs in `app_undo_outbox`, a sync clock or outside-copy state column in
   `app_undo_bookkeeping`, and a link to an outside copy in `app_undo_links`
   (`docs/features/developer.md`).
10. **Grants: a new table grants its roles itself (from 30.10.2026).** Until
    then Supabase's default privileges gave every new table in `public`
    select, insert, update and delete for `anon`, `authenticated` and
    `service_role`, so a migration's own grants were belt-and-braces
    (`066`/`067`/`068` ship none and work). On 30.10.2026 Supabase drops those
    defaults for existing projects
    ([changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)).
    Tables that exist keep their grants; a new one without a grant answers
    "permission denied" through the Data API (supabase-js, PostgREST) even
    with the right RLS — RLS decides which rows, a grant whether a role
    reaches the table at all. Direct database connections are not affected
    (the deploy runner, pg_cron, a `security definer` function owned by
    `postgres`). So every migration after `165` that creates a table grants:
    - `service_role`: `select, insert, update, delete` — edge functions and
      the device gateways use the server key;
    - `authenticated`: what the app does with it — including a trigger that
      writes the table on the app's behalf, unless that trigger is
      `security definer`;
    - `anon`: nothing — only the owner's account uses the app (point 12);
    - a token table: `service_role` only, with the revoke of point 13;
    - a `serial` column's sequence: `grant usage` to the roles that insert (a
      `uuid` id or an identity column needs none).

    `scripts/verify-table-grants.mjs` fails a migration that misses one. Two
    scenario bases (`hevy-full-api`, `day-targets-macros`) still set the old
    default privileges for the migrations they replay; a new base doesn't, so
    its scenarios meet what production does.
    **`GRANT EXECUTE` on a new function IS required** (a function with no
    grant is not callable by `authenticated`).
    Deliberate exception, do not undo: `044` **revokes** `authenticated` access
    to `user_calendar_tokens` entirely and narrows `strava_tokens` to three
    non-secret columns. RLS limits rows; only grants limit **columns** — that is
    the whole reason that migration exists.
11. **A drop is never a one-file change.** Before dropping a table or column,
    grep the repo for hardcoded name lists that reference it: `037`'s audit
    attach array, and `046`'s policy list. Already-applied
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
    that creates it (044, 140), RLS on, no browser policy, and is never
    readable by an assistant tool. The browser only ever sees derived status.
14. **A trigger that inserts a row tied to a user** (audit, outbox, queue) must
    skip a user that no longer exists (`IF NOT EXISTS (SELECT 1 FROM auth.users
    WHERE id = …) THEN RETURN …`): deleting an account cascades into every
    table, and an insert for the vanishing user aborts the whole deletion
    (135, 140).
15. **A SECURITY DEFINER helper meant for one RPC only** still needs `GRANT EXECUTE` to `authenticated` when that RPC runs as the caller, so the browser can call it directly: make it act only on what the RPC hands it in a transaction-local setting the browser can't set (`set_config(…, true)` just around the call; PostgREST exposes no `set_config`, and 185 refuses it in the read query) — 187's `shop_restore_items` lists the ids it just put back in `app.shop_restored`, and `shop_restore_price_history` writes only for those, so a direct call writes nothing. Put the transaction's own stamp in front of the value (`txid_current()` and `now()`) and have the helper check it: a value set for the whole session in an earlier request stays on a pooled connection, and must never count in a later one. A new setting like this also joins the read query's `watched` list (185; 189 added `app.shop_restored`), so a read query that changes it returns nothing and the change is undone.
16. **A new table that points at `shop_items`** (a foreign key that deletes or empties) is in Shop's Delete with Undo by itself (187's `more`): Delete keeps its rows in the snapshot and Undo puts them back **as the caller** — so only when the browser may write them back: `INSERT` on the table for `ON DELETE CASCADE`, `UPDATE` of the column for `SET NULL`, and the table's own RLS letting the row in. Otherwise Delete names the table in the snapshot's `hidden` and its rows don't come back; a row refused on the way back stays out and the rest of the Undo goes on. If such rows must come back — a table only the service role writes, like the price watch — give the table its own restore in `shop_restore_items` (a definer helper bound to the rows that Undo put back, point 15) and add it to the core tables both functions leave out of `more`. Such a helper names its columns, so a column added later to its table joins it in the same migration — 188 re-created `shop_restore_price_history` for `condition`, `used_low` and `refurbished_low`, 190 for `in_stock` — or Delete's Undo puts the rows back without it. The same restore leaves out what a snapshot row points at that is gone since — its category, its task (every single-column foreign key of `shop_items`, from the catalogue), a money link's other end — as that row's own delete would have, rather than refusing the whole Undo.
17. **Seeded data the owner edits (191's stores and their rules): per account, its source on the row, `owner_edited` derived.** The owner's edit must win over every later seed ("you edited it — never overwrite", owner 10.11.2026), so a seeded row is copied into each account (`shop_store_seed(p_user)`, run by the migration for every allowed account and by a trigger on `app_allowed_users` for one added later), keeps what its source said in `source_facts`, and its rules trigger works out `owner_edited` on **every** write — the owner made the row, or its facts differ from its source — so no writer can forget or forge it, a reset (facts := source) clears it, and an Undo that writes the old facts back gets the old flag back without drift. A seed run writes the source to every row and the facts only where `owner_edited` is false; where it is true the row now differs from its source, a conflict the app shows. A seeded row is turned off or hidden, never deleted by the app (a later seed would bring it back). The trigger tells its writers apart by `current_user`: `authenticated` is the owner (never writes `origin`, the seed key or the source), `service_role` is the assistant (ai-proxy writes as it: its rows are labelled `ask_ai` and only those it may change), anything else — a migration, the SQL editor, a foreign key's cascade, which runs as the table's owner — is trusted. A later writer with the service role (a page reader) gets its own door in its own migration. The first seed runs before `trg_audit` is attached, so Activity doesn't list it as the owner's change.
18. **A trigger that keeps a second audited table in step** (192's `shop_items_resale`: a sale closes the thing's listing and its Undo opens it again; "Could sell for" writes its history) fires after `trg_audit` (the default name order) and checks what must hold *between* the tables when the transaction ends — a deferred constraint trigger (192's `trg_shop_listings_thing`), never a BEFORE trigger: Activity's Undo takes a save back newest change first — the second table's rows by their own audit rows, then the first table's, whose trigger then finds them already as they were — so it passes through a moment where one is back before the other. (Named to fire before `trg_audit`, the trigger's rows would be undone after the first table's, whose trigger had already changed them, and Undo stops: "rows could not be deleted".) A row derived from a new parent row (a thing added with an estimate) is written deferred with `ON CONFLICT DO NOTHING`, so a restore that puts back the parent and then its own copy of the row isn't stopped by a unique key. An ownership check in a BEFORE trigger ("about one of your own things": a foreign key ignores row level security) refuses with a foreign key's code, 23503: `app_restore_rows` and Activity's Undo take such a row again in a later round once its parent is back, while a check violation (23514) ends the restore. 187's `shop_item_costs_rules` and 190's `shop_signal_states_rules` refused with 23514, so Activity's Undo of a Shop delete of a thing with an extra cost or a snoozed Needs-a-look row stopped ("A cost belongs to one of your own items", seen 10.11.2026; Shop's own Delete with Undo was not affected — it puts the thing back first): fixed in 192, which re-creates both word for word but for that code (`undo-retry.sql` in `verify-db-shop-rules` fails on a copy taken before 192 and passes after it).

19. **A table a limit is worked out from is written by the service role only, and what the limit is worked out with is code** (194's `ai_calls`: the `claude` function's monthly budget wall and its rate limits). The browser gets `select` and nothing else — `revoke all … from anon, authenticated` first, then `grant select`; one `for select` policy, so row level security refuses a write even if a grant slipped in; no audit trigger, so Activity's Undo has nothing of it to undo; `user_id` without a default, set by the function from the session it verified. The app's own delete, restore and undo functions (`app_delete_rows`, `app_restore_rows`, `app_undo_steps`, `app_undo_transaction`) run with the caller's rights (SECURITY INVOKER), so they are refused there like a plain write — re-created as SECURITY DEFINER, any of them would write the ledger for the browser. An amount in such a table gets an upper bound as well as `>= 0`: `NaN >= 0` is true in Postgres, and one NaN turns every sum into NaN and the comparison with the budget into "false". The prices the cost is worked out from are code in the function, never a table: a price row the browser could write would switch the wall off. Settings the browser does write (`ai_settings`, `ai_job_settings`) are input: the function runs every value through its own allow-lists and limits, and a CHECK is only the last line. `scripts/verify-db-ai-ledger.mjs` checks all of this on 194 and on every later migration. Details: "The AI ledger" below.

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
- [ ] Grants on every new table: `service_role` select/insert/update/delete, `authenticated` what the app needs, never `anon` (`verify-table-grants`)?
- [ ] `trg_audit` attached, or a stated reason why not?
- [ ] Re-runnable end to end (`IF NOT EXISTS` / `DROP … IF EXISTS` everywhere)?
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

## The assistant has no table catalogue (since AI phase 5, 23.11.2026)

`ai-proxy`'s `DB_CATALOG` (a default-deny allow-list of tables) went with the Gemini assistant. The Claude assistant reads through fixed tools and `ask_database` (a read-only RPC that runs with the owner's own rights, `ai_run_read_query`) and writes only two confirmed proposals (a task, a food line). A new table needs nothing for the assistant; a new tool that reads or writes it is a reviewed code change (`docs/features/ai.md`).

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
  drift explicitly, or compute it. Where the local time matters (the weekly report,
  Monday 05:00 Oslo), schedule **both** UTC hours the local time can be and let the
  function decide (`scheduledReportWeek`: it acts only from 05:00 to 07:00
  Monday Oslo time) — never a schedule that is right for half the year.
- A timer that calls an edge function with a credential and needs it **derived**
  (so the secret itself never travels) can compute an HMAC in SQL:
  `encode(extensions.hmac('<label>', decrypted_secret, 'sha256'), 'hex')`
  (pgcrypto lives in the `extensions` schema on Supabase), read from Vault inside
  the job; the function derives the same hex with Web Crypto and compares with
  `sameSecret` (migration 196's `lascis-ai-report-*`).

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
  making a second row for the episode. A sync write (x-trakt-sync on a service-role request — 184; a browser's header counts for nothing) through
  the cache columns only ever ADDS placeholder watches — it never removes or
  re-dates one (trakt-api removes by Trakt play id); and the sync's writes to
  `media_watches` are not audited (`trg_audit … WHEN (NOT
  trakt_sync_writing())`, bulk-synced). A rewatch round
  (`media_rewatch_finished`) and 043's planned-block rule
  (`trg_media_watch_cleans_planned_block`) run on every watch insert.
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

## AI suggestions (migration 199) — `ai_suggestions`, `ai_suggest_runs`

- `ai_suggestions`: one row per idea for needing AI less. **Written only by the service role** through `ai_suggestion_add` (SECURITY INVOKER, service role only: insert, or count one more sighting, or refuse: a dismissed key, 300 rows, 20 answer ideas a day). The browser reads its own rows and has exactly one write: `grant update (state)`, plus a before-update trigger (`ai_suggestions_guard`) that refuses a change to any other column from a signed-in caller and sets the timestamps, plus an owner-only update policy. No insert or delete grant. Texts are CHECKed as plain text (no `<`, `>`, control character or link). `unique (user_id, dedupe_key)`: the key is a sha-256 made by the function. Not audited on purpose: a toggle with its own Bring back, and an audited change would be offered to Activity's Undo (which would need `state_changed_at` in `app_undo_bookkeeping`). The texts go through `ai_suggestion_plain` (no bracket of either kind, no hidden character, no link, a length), also on every update, so the browser may execute it. `ai_suggestion_add` takes an advisory lock per account and dedupes by key, title and call.
- `ai_suggest_patterns(user, days, min)`: the counting over `ai_calls` (shapes only), SECURITY INVOKER, service role only, `search_path = ''`.
- `ai_suggest_runs`: the weekly batch's bookkeeping, like `ai_reports` (196): `batch_id`, `claimed_at` and `facts` are server-only (column-list select).
- 199 re-creates the `lascis-ai-report-check` timer so it also runs while a suggestion batch is queued. `scripts/verify-db-ai-suggestions.mjs` checks all of this twice (with and without Supabase's old default grants).

## The AI ledger (migration 194) — `ai_calls`, `ai_settings`, `ai_job_settings`

The `claude` edge function asks Anthropic's model on the owner's behalf
(`docs/features/ai-plan.md`). Every request costs money, so the function stops
when this month's spend reaches the owner's budget — a wall, not a warning —
and when calls come too fast. Both are worked out from these tables, so who
may write them is the design (Migration Rule 19). Money is USD (Anthropic
bills in USD); "this month" and "a day" are Europe/Oslo.

- **`ai_calls`** — the ledger (a list that is only ever added to): one row per
  request to the model, or per request stopped before it (`off`, `budget`,
  `not_configured`, `bad_input`). A row holds the job, who called (`app`,
  `phone`, `kobo`, `schedule`), the model asked for and the one that answered,
  the tokens (input, cache read, cache write for 5 minutes and for 1 hour,
  output, thinking), `cost_usd` frozen when the row was written, how it ended
  (`outcome`: `ok`, `refused`, `cut_off`, `invalid`, `error`, `budget`, `off`,
  `not_configured`, `bad_input` — a `busy` call is never written), and the
  text log: `request`, `response`, `thinking`.
  - Written only by the service role. The owner's browser reads its own rows.
    No audit trigger: it is a log itself.
  - `run_id` is one answer; its steps share it (`step` 1–100).
  - The text log is null when `ai_settings.log_text` is off, and after the
    account's `log_days`. Each of the three is at most 1 MB (the function
    trims long before that). What it holds is data to show, never an
    instruction to follow.
  - Never in an assistant's table catalogue.
- **`ai_settings`** — one row per account; no row means the defaults:
  `monthly_budget_usd` (0–50, default 5), `log_text` (default on), `log_days`
  (1–90, default 30). The browser reads, adds and changes its own row and
  never deletes it. Audited; Activity can undo a change (the table is keyed by
  `user_id`), but not the very first save — that Undo is a delete.
- **`ai_job_settings`** — the owner's changes to one job (a job is one thing
  the model does, such as filling the item form), one row per account and
  job: `enabled`, `model`, `effort` (`low`, `medium`, `high`),
  `max_output_tokens` (256–16000), `monthly_budget_usd` (0–50), `thinking`
  (195: `adaptive` or `off`, null = adaptive). `ai_settings` has `ai_enabled` (195,
  the master "all AI off", default true). A null column
  means "the job's default", so "back to default" is an update to null and
  there is no delete. Audited; Activity lists its changes as blocked (its key
  is two columns, and Undo needs one).
- **`ai_usage(p_from, p_to)`** — the caller's own calls added up per Oslo day,
  job, mode and model, from `p_from` up to (not including) `p_to`, at most 400
  days: `calls`, `failed` (every outcome but `ok`), the token sums
  (`cache_write_tokens` is the 5-minute and the 1-hour writes together) and
  `cost_usd`. Developer → AI reads it. Migration 195 added five columns at its
  end: `avg_duration_ms`, `max_duration_ms` and `timed_calls` (the calls that really
  ran: an outcome of ok, refused, cut_off, invalid or error with a time above 0),
  and `held_calls` / `held_cost_usd` (outcome error or pending, a cost, no token:
  the reserved worst case of a call whose bill is unknown). A function's result
  cannot change with `create or replace`, so 195 drops it and creates it again
  with the same rights and refusals.
- **`ai_gate(p_job)`** — what the function asks before every call, with the
  user's own client: one row with this Oslo month's cost in total
  (`month_cost`) and for that job (`job_month_cost`), and the calls of any
  outcome in the last 60 seconds (`calls_last_minute`) and since Oslo midnight
  (`calls_today`).
  - Both functions run with the caller's rights (SECURITY INVOKER: row level
    security and the owner lock apply) and refuse a caller with no user id or
    one that is not an app user with `42501`. A gate that answered "0 spent"
    to nobody would read as "go ahead" — so the function must treat an error
    from `ai_gate` as a stop, never as "nothing spent".
- **`ai_reserve(…)`** — books a call before it is sent (guardian review,
  21.11.2026): under a lock per account it reads the same numbers as
  `ai_gate`, then refuses (`busy`: no row; `budget`: a row costing 0) or adds a
  `pending` row costing the call's worst case. The function corrects that row
  to the real numbers after the answer; when it can't (a timeout, a failed
  write), the worst case stays counted. So a burst of requests can't all pass
  the wall, and a call Anthropic may bill is never costed 0. SECURITY DEFINER,
  `search_path = ''`, service role only (the user id is the one the function
  verified). Since 195 it takes a 14th argument, `p_caller_per_day`, and also
  refuses (`busy`) a caller that has that many rows (any outcome) in its last 24
  hours, counted under the same lock: a device's daily cap is now a wall, not only
  an early read. The signature changed, so 195 dropped the 13-argument function.
- **`ai_calls_purge_text()`** — clears `request`, `response` and `thinking` on
  rows older than their account's `log_days` (30 with no settings row), leaves
  the numbers and answers how many rows it cleared. SECURITY DEFINER (it runs
  with its owner's rights, because nobody else may change the ledger), so:
  `search_path = ''`, every table named with its schema, no input, callable by
  the service role and the timer only, and `log_days` held to 1–90 in its own
  code. pg_cron runs it once a day as `lascis-ai-log-purge` (03:41 UTC: 04:41
  in Oslo in winter, 05:41 in summer) with plain SQL — no HTTP, no secret.
- 194 ends with assertions that stop the deploy, keeping nothing, if the
  browser could write `ai_calls`, delete settings or call the purge, or if a
  signed-out caller reached any of it.

Checked by `scripts/verify-db-ai-ledger.mjs` (`scripts/db-tests/ai-ledger/`):
194 applied twice with the catalogue compared, once with the grants Supabase
gave new tables before 30.10.2026 and once without; every CHECK with good and
bad values; the owner's own browser session, a second account, an account the
owner lock keeps out and a signed-out caller; `ai_usage`'s days and
`ai_gate`'s month, day and minute with rows at chosen times; the purge; and
the app's delete, restore and undo functions (the real 144, 150, 151) tried on
the ledger.

---

## The weekly reports (migration 196) — `ai_reports`

AI phase 3 (`docs/features/ai.md`, "The weekly report"). One row per report:
`week_start` (the Oslo Monday, CHECK `isodow = 1`), `made_by` (`schedule` or
`app`), `status` (`queued` → `ready` | `failed`), `failure` (≤ 300), `content`
(the English report, ≤ 6000, required when `ready`), `facts` (the figures the model
read, a jsonb object ≤ 64 KB), `batch_id`, `call_id` (→ `ai_calls`, `on delete set
null`: the ledger row holding its cost), `claimed_at`, `created_at`, `ready_at`,
`pushed_at`, `push_due`. `unique (user_id, week_start, made_by)`: one report a week and maker,
which is what makes a second timer run, a repeated tap and two overlapping runs
harmless.

- **Written only by the service role** (the `claude` function). `user_id` has no
  default. **`batch_id` is a link to an outside service**, so the browser can neither
  write nor read it: `revoke all … from anon, authenticated`, then
  `grant select (<the finished columns>) to authenticated` — a column list without
  `batch_id`, `claimed_at` and `push_due` (so `select *` from the browser is a 42501; the app
  names its columns, `REPORT_COLUMNS`). One `for select` policy plus the owner
  lock; no audit trigger (a server-written log; Undo must never reach it). A new
  column the browser may read joins that grant list in its own migration.
- **Two timers** (pg_cron, UTC, the guard pattern; secrets from Vault inside the job):
  `lascis-ai-report-make` (`0 3,4 * * 1`: 05:00 Oslo in winter and summer, the
  function picks the one in its window) and `lascis-ai-report-check`
  (`*/15 * * * *`, with `where exists (queued report) or exists (push_due and
  pushed_at is null)`: it calls nothing while no report waits and no push is owed;
  the function sends the owed push only from 07:00 to 22:00 Oslo time). Both send
  `x-claude-schedule-key` = HMAC-SHA256(`'claude-schedule-v1'`, the Vault secret
  `PUSH_CRON_SECRET`) as hex to `functions/v1/claude`; no secret in Vault sends an
  empty header, which the function refuses.
- **Checks:** `scripts/verify-db-ai-reports.mjs` (static checks on 196 and 38
  scenarios on two throwaway databases, with Supabase's old default grants and
  without them; 196 runs twice and must leave the catalogue unchanged): the
  browser's exact column list, no write, a second account / a locked-out account /
  a signed-out caller see nothing, every CHECK with good and bad values, the unique
  key, the ledger link, and the timers (their SQL is run: the header equals the HMAC
  Node computes, with no secret the header is empty, the check timer stays quiet
  with no queued report). CI step "AI weekly reports database scenarios".

---

## Ask AI's chats (migration 197) — `ai_conversations`, `ai_messages`, `ai_chat_proposals`, `ai_find_text`

Written only by the `claude` function (service role) with the user id it verified; the browser reads its own rows and writes nothing. No audit trigger and no Undo (server-written logs); owner lock on all three; never in an assistant's catalogue.

- **`ai_conversations`**: title (the first words typed), model, effort, thinking, `tools_hash` and `system_hash` (sha256 of the tool list and the fixed instructions the chat began with), `tool_names` (frozen, at most 40 names since 206; an off tool is left out of a new chat), status (`open`, `full`, `closed`), counters, `last_prompt_tokens` (the wall), `cost_usd`. `unique (id, user_id)` is what messages and proposals point at, so neither can name another account's chat.
- **`ai_messages`** is **append-only**: the blocks exactly as sent or received (thinking blocks with signatures, tool calls and results), a hash chain (`digest`), the ledger row (`call_id`), `meta` (cache-miss reason, context editing, the provider's message id, prompt tokens, cost, citations). `unique (conversation_id, seq)` stops two answers at once. A trigger refuses every update and every delete that is not the account's own cascade (a foreign-key cascade runs at trigger depth 2); the service role has the usual grants (the repo's grant check demands them), the trigger is what holds.
- **Deleting a chat:** `deleted_at` (soft; the function sets it, the app list hides it) and `ai_chats_purge()` (SECURITY DEFINER, service role and the daily timer `lascis-ai-chat-purge` at 03:47 UTC only) removes chats deleted more than 7 days ago and chats whose last update is older than the account's `log_days` (30 by default, 1 to 90), whole.
- **The ledger link:** `ai_messages.call_id` is `on delete set null`; the append-only guard lets exactly that change through (only `call_id` becoming null at trigger depth 2), so deleting an account whose ledger rows go first does not abort.
- **`ai_chat_proposals`**: tool (`add_task` | `log_food`), the checked arguments, the Confirm card's summary, status (`pending` → `confirmed` | `cancelled` | `failed`), expiry (24 h), `result_id` (the row it made), `unique (conversation_id, tool_use_id)`. Why not `ai_pending_actions` (140): see `docs/features/ai.md`.
- **`ai_find_text(query, kind, limit)`**: SECURITY **INVOKER** (the caller's rights, owner lock and row level security apply, `search_path = ''`), Postgres full-text (`simple`) over the caller's tasks and diary plus a title substring, at most 10 rows with 300-character snippets.
- **Checks:** `scripts/verify-db-ai-chat.mjs` (static checks on 197, then 46 scenarios on two throwaway databases, one with the old default grants and one without; 197 runs twice and must leave the catalogue unchanged; step "AI chat database scenarios" in `pr-check.yml`).
- **Client:** the app reads the tables through `chatApi.ts`; before 197 the list is empty (a missing-table guard). `qk.aiChat` is in `NEVER_KEPT` (never stored on the device).
- **Migration 205 (Ask AI fixes, 24.11.2026)** widens three CHECKs and nothing else: `ai_chat_proposals.tool` also takes `update_food` (one of today's one-off food lines: its title and/or four figures) and `update_task` (one task's title); `status` also takes `replaced` (a newer proposal for the same thing took a pending one's place; it needs `decided_at` like every decided state and can never be confirmed); `ai_tool_settings_write_never_on` names the two new write tools. No grant, policy or table changes: the browser still writes no proposal. Checks: `scripts/verify-db-ai-chat-fixes.mjs` (205 runs twice and must change only its three CHECKs; 16 scenarios on two databases).
- **Migration 206 (24.11.2026)** replaces one CHECK: `ai_conversations.tool_names` may hold at most 40 names (197 said 12; 205's 15 tools made every new chat's row fail with 23514). The name pattern is unchanged; a guard fails the deploy if another CHECK on `tool_names` is left. `verify-claude-chat` §1 fails when the code's tool list is longer than the newest cap.

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
  function source. `SUPABASE_URL` and the Supabase keys
  (`SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS`, legacy `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`)
  are injected by the platform, not Vault entries; functions read them only through `serviceKey()` / `publishableKey()`.
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
8. Should the AI be able to read or write it? → a reviewed tool in the `claude` function (`.claude/rules/ai.md`); there is no catalogue to add it to.

---

## What This Agent Does NOT Do

- Does not modify `auth.users` schema.
- Does not generate Supabase client configuration — `src/integrations/supabase/client.ts` is the source of truth.
- Does not write raw SQL for the AI to execute beyond the read-only, guarded
  `run_read_query` path (single `SELECT`/`WITH`, `LIMIT 500`, RLS applies via a
  RPC with the caller's own rights — SECURITY DEFINER owned by `authenticated`, so
  Postgres refuses a role change inside — that only an app user may call and that
  refuses settings and SQL-running built-ins — 185). No DDL, no dynamic SQL built from model output.
