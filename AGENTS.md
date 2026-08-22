# AGENTS.md — Lasci's Board

Agent-specific instructions for this repository. Supplements `CLAUDE.md` (the
master project guide — read that first) with rules specific to database/schema
and Edge Function work. See `docs/README.md` for deeper reference docs (data
model, architecture).

This is a **rules** document: what to do, and the constraint that makes it
necessary. Feature history belongs in `CLAUDE.md`.

---

## Supabase / Database Agent

**Invoke when:** creating or altering tables, writing RLS policies, designing schema, writing complex queries, or adding Edge Functions.

---

### Project Context

| Item | Value |
|---|---|
| Supabase project | Main instance (`VITE_SUPABASE_URL`) |
| RP5 games | Separate Supabase instance (`VITE_RP5_SUPABASE_URL`) — read-only views |
| Auth | Supabase Auth — every user row references `auth.users(id)`; single-user app in practice |
| ORM | None — raw `supabase-js` client everywhere |
| Client env vars | See `CLAUDE.md`'s Environment Variables table. Ground truth: `grep -rhoE 'VITE_[A-Z0-9_]+' src/ index.html vite.config.ts \| sort -u` |
| Server secrets | Supabase Vault only, never in client code or function source. Ground truth: `grep -rhoE "Deno.env.get\(['\"][A-Z0-9_]+" supabase/functions/ \| sort -u`. `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are **injected by the platform** — do not add those to Vault. |
| Migration numbering | Sequential, zero-padded three digits (`NNN_description.sql`). Highest applied is **068**. Don't hardcode "the next number" — run `ls supabase/migrations \| sort \| tail -1` and increment. |
| Deploy | **Manual, always.** Migrations: Dashboard › SQL Editor or `supabase db push`. Edge Functions: Dashboard or `supabase functions deploy <name>`. GitHub Actions builds and publishes the frontend only — it runs no migrations and deploys no functions. |

**Numbering gap:** `056` does not exist (the sequence runs `055 → 057`) and `058`
is an intentional dead no-op — both are documented in `058`'s own header and in
`scripts/generate-matvaretabellen-seed.mjs`. Never "fill" `056`; a new file with
that number would collide with a deleted one in history.

---

### Migration Rules

1. **File naming:** `NNN_short_description.sql` — zero-padded three digits, snake_case description. Check `ls supabase/migrations` for the current highest number before picking the next one.
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

---

### Destructive Operations — Hard Rules

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

### RLS Design Patterns

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

### Migrations land AFTER the frontend — client code must degrade, not throw

The frontend auto-deploys on merge; migrations are applied by hand later. There
is **always** a window where the shipped client runs against the old schema.

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

### `ai-proxy` DB_CATALOG obligation

The Ask AI panel's generic CRUD layer (`db_query`/`db_insert`/`db_update`/
`db_delete`) is a **default-deny allow-list** (`DB_CATALOG` in
`supabase/functions/ai-proxy/index.ts`). A new user table is invisible to the
assistant until it is added there, with a deliberate `access: 'rw' | 'ro'`
decision — externally synced tables (`hevy_*`, `health_*`, `strava_activities`,
`movies`, `tv_series`) are `'ro'`; token/secret tables are never listed at all.
Changing the catalog means **redeploying `ai-proxy`**; say so in the PR's manual
steps.

---

### pg_cron jobs

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

**Pagination is mandatory for open-ended ranges.** PostgREST caps every response
at 1000 rows server-side regardless of an explicit `.limit()`, and with
ascending order the cap silently drops the **newest** rows. Loop
`.range(offset, offset + 999)` until a page comes back short (see
`fetchHealthMetricSeries` — this was a real, invisible data-truncation bug).

**RP5 Games — special rules:**
- Read from `v_games_summary` / `v_games_full` views only.
- Write to raw `games` table.
- `series_name` exists only in the view — never `SELECT series_name FROM games`.
- Uses separate client from `VITE_RP5_SUPABASE_URL`.

---

### Linked-entity sync (migration 043) — `link_rules` + DB triggers

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
  **⚠️ RETIRED by migration 077 (2026-08-22):** `block_delete_cascades_task`
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
- **The Google Tasks outbox's per-task ordering (migration 079) is the same class of bug as the Hevy incremental-sync race, generalized**: `FOR UPDATE SKIP LOCKED` (migration 073) only ever guaranteed no two workers claim the SAME row — it never guaranteed rows for the SAME task drain in the order they were enqueued. `claim_google_tasks_outbox` now ranks outstanding rows `PARTITION BY task_id ORDER BY created_at, id` and only ever claims `rn = 1` — concurrency across DIFFERENT tasks is untouched; only same-task ordering became absolute. `clear_google_task_id_if_matches(task_id, expected_google_task_id)` is the belt-and-suspenders half: a conditional `UPDATE ... WHERE google_task_id = expected` that reports `FOUND` back to the caller, so a stale delete processed out of order (despite the FIFO fix) still can't wipe a fresher id written after it. Any future outbox/queue-style table in this app should default to this same two-layer pattern (ordering at the claim level, a conditional write as the backstop) rather than trusting FOR UPDATE SKIP LOCKED alone to imply ordering it was never designed to provide.
- **Recursion guard**: `time_blocks` → `tasks` and `tasks` → `time_blocks`
  sync can each cause the other to fire. Guarded with `pg_trigger_depth() = 1`
  — a direct user edit propagates to the other side exactly once; that
  propagation does not bounce back and ping-pong.
- **Google Calendar sync is deliberately NOT done in triggers** — a trigger
  runs inside Postgres and has no access to the end user's OAuth token (it
  lives in the browser). That stays best-effort at the API layer
  (`src/features/daily/api/scheduleApi.ts`, `src/features/todo/api/tasksApi.ts`),
  where one task maps to exactly one calendar event.
- **When adding a new "plannable" entity** (something else that can get a
  `time_blocks` row via `UnifiedPlanModal`'s `source` prop): decide whether it
  needs a cleanup-on-source-change trigger the same way `user_tv_episodes`/
  `project_items` do, and add it to this migration's pattern (a new trigger
  function + `link_rules` row), not a one-off app-code fix.

---

### Edge Function Rules

- Runtime: **Deno** — use `import` not `require`, no Node built-ins.
- **Every function must be self-contained. No `_shared/` imports.** Supabase
  Dashboard deploys do not bundle sibling `_shared/` files, so any such import
  fails the deploy with "Module not found". This is why the Hevy upsert logic is
  **inlined verbatim into all four Hevy functions** (`hevy-sync`,
  `hevy-initial-sync`, `hevy-incremental-sync`, `hevy-api`), each carrying a
  header comment flagging it. Consequence to accept: change that logic and you
  change it in four files by hand. Do not "fix" this by re-introducing a shared
  module.
- Secrets: `Deno.env.get('SECRET_NAME')`, set in Supabase Vault. Never in
  function source. `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform, not Vault entries.
- CORS: include `Access-Control-Allow-Origin`, list every custom header the
  function accepts in `Access-Control-Allow-Headers`, and handle the OPTIONS
  preflight.
- Deploy: **manual** via Supabase Dashboard or `supabase functions deploy <name>`. GitHub Actions does not deploy functions. There is no CI job for them.

**Three auth models — pick one deliberately, and match `supabase/config.toml`:**

1. **Browser** — validate the caller's JWT in code with
   `supabase.auth.getUser(authHeader.replace('Bearer ', ''))`. Default; platform
   `verify_jwt` may stay on.
2. **Third-party webhook** — the sender presents its own
   `Authorization: Bearer <vault secret>`, which is *not* a Supabase JWT.
3. **Device / cron** — a custom header secret (`x-phone-secret`,
   `x-cron-secret`, `x-sync-secret`) compared against a Vault value, after which
   the function acts as the single user (`HEVY_USER_ID`) with the service role.
   The service key stays server-side, never on the device.

Models 2 and 3 **require `verify_jwt = false`**: platform JWT verification
rejects the call before our code runs, so the webhook or cron silently stops
working (the long-standing Hevy/Health gotcha). Current set:

| Function | `verify_jwt` | Authenticates by |
|---|---|---|
| `hevy-sync` | false | `Authorization: Bearer <HEVY_WEBHOOK_SECRET>` (Hevy's webhook) |
| `health-export-webhook` | false | `Authorization: Bearer <HEALTH_EXPORT_WEBHOOK_SECRET>` |
| `google-health-sync` | false | user JWT **or** `x-sync-secret` == `GOOGLE_HEALTH_SYNC_SECRET` (cron) |
| `ai-proxy` | false | user JWT via `getUser` **or** `x-phone-secret` == `PHONE_GATEWAY_SECRET` |
| `phone-gateway` | false | `x-phone-secret` only, then acts as `HEVY_USER_ID` via the service role |
| `push-send` | false | user JWT **or** `x-cron-secret` == `PUSH_CRON_SECRET` (pg_cron) |

Every other function keeps `verify_jwt` on (the default) and validates the
browser JWT in code.

Rules for the secret-comparison paths:
- **Fail closed.** A missing Vault value must reject the request (`if (!secret || given !== secret) return 401`), never fall through to an unauthenticated path.
- Never log the secret, the header value, or a diff of the two.
- A function listed above must have the same setting in `supabase/config.toml`
  **and** "Enforce JWT Verification" toggled off in the Dashboard when deployed
  by paste — the config file only applies on a CLI deploy.
- Adding a new secret-authenticated function means a Vault entry plus a
  `config.toml` block; list both in the PR's manual steps.

---

### Schema Design Checklist

Before proposing any new table:
1. Does this data belong in an existing table (new column) or truly need its own table?
2. Will rows be deleted when the user is deleted? → `ON DELETE CASCADE`
3. Is there a natural sort order? → add `sort_order int` or use `created_at`.
4. How will it be queried? → compound index `(user_id, <that column>)`.
5. Are there enum-like values? → `text CHECK (col IN (...))` not `CREATE TYPE`.
6. Does the feature need soft-delete? → add `deleted_at timestamptz` (or a `status` value, as `tasks` does with `cancelled`) instead of a hard delete.
7. Is it user-authored? → attach `trg_audit`. Bulk-synced or churny? → exempt, and say so in the header.
8. Should the AI be able to read or write it? → add it to `ai-proxy`'s `DB_CATALOG` with an explicit `rw`/`ro`, and redeploy.

---

### What This Agent Does NOT Do

- Does not push migrations automatically — always outputs SQL for manual review.
- Does not modify `auth.users` schema.
- Does not touch the RP5 Supabase schema (separate project, read-only for us).
- Does not generate Supabase client configuration — `src/integrations/supabase/client.ts` is the source of truth.
- Does not write raw SQL for the AI to execute beyond the read-only, guarded
  `run_read_query` path (single `SELECT`/`WITH`, `LIMIT 500`, RLS applies via a
  SECURITY INVOKER RPC). No DDL, no dynamic SQL built from model output.
