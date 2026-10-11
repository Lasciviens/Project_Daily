# Automatic deploy — one-time setup

Once set up, a merge to `main` deploys everything, in this order
(`.github/workflows/deploy.yml`):

1. **Token check** — the Supabase access token is tried first (read only), so
   a wrong or expired token stops the run before anything changes.
2. **Database migrations** — every file in `supabase/migrations/` numbered
   **above 140** that has not run yet, in number order, each once
   (`scripts/deploy/run-migrations.mjs`). A file and its record in
   `deploy.applied_migrations` are one transaction: a failing file keeps
   nothing and stops the run. The PR check refuses a migration that contains
   its own `BEGIN`/`COMMIT`, because that would split the transaction.
3. **Edge functions** — all of `supabase/functions/`, with the JWT setting of
   each from `supabase/config.toml`.
4. **The website** — GitHub Pages, only after 1–3 succeeded.

Migrations `001`–`140` were applied by hand before this and are never run by
the workflow.

The deploy only runs from `main`, and only for the newest commit on `main`: a
run for an older commit (a re-run, or a merge queued behind a newer one)
deploys nothing, because the newest commit's run deploys everything.

## 0. Merge the pull request that adds this

The **Dry run** button (step 4) exists only once the workflow is on `main`.
Until the secrets exist, a merge deploys the website exactly as before.

## 1. Supabase access token

1. Open https://supabase.com/dashboard/account/tokens (signed in with the
   account that owns the project `hsaedwwqpcjizeozjbch`).
2. **Generate new token**, name it `GitHub deploy`. If it asks for an expiry,
   pick the longest one; when it expires the deploy stops at "Check the access
   token" and you make a new one the same way.
3. Copy it. It starts with `sbp_`. An API key (`eyJ…`, `sb_secret_…`,
   `sb_publishable_…`) is the wrong thing; the workflow says so.

## 2. Database address

1. Supabase Dashboard → the project **`hsaedwwqpcjizeozjbch`** (not the old
   RP5 project) → **Connect** (top of the page) → **Connection string** →
   **Session pooler**.
2. Copy the address. It must contain `postgres.hsaedwwqpcjizeozjbch` and
   `pooler.supabase.com:5432`, like
   `postgresql://postgres.hsaedwwqpcjizeozjbch:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`.
   Not the "Direct connection" (`db.….supabase.co`, GitHub cannot reach it) and
   not the "Transaction pooler" (port `6543`). The workflow refuses those and
   any other project's address.
3. Replace `[YOUR-PASSWORD]` (brackets included) with the database password.
   - Don't know it? Project Settings → Database → **Reset database password**
     → **Generate a password**. The app does not use this password (its
     functions use API keys), so resetting it changes nothing else here.
   - A password with characters other than letters and digits must be
     URL-encoded (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`,
     `%` → `%25`); a generated one avoids that.

## 3. A GitHub environment that only `main` can use, holding both secrets

The database address carries the database password, which can change every
table. In an environment limited to `main`, no workflow on another branch can
read it.

1. GitHub → the repository → **Settings** → **Environments**. If
   **production** is not listed, **New environment** → name `production` →
   **Configure environment**.
2. **Deployment branches and tags** → **Selected branches and tags** →
   **Add deployment branch or tag rule** → `main` → **Add rule**.
3. **Environment secrets** → **Add environment secret**, twice (in one
   sitting — with only one of the two set, every deploy stops, the website
   too):

| Name | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | the `sbp_…` token |
| `SUPABASE_DB_URL` | the Session pooler address with the password |

Put them in the environment, not under "Repository secrets".

## 4. Test with a dry run (changes nothing)

GitHub → **Actions** → **Deploy** → **Run workflow** → Branch **main** → tick
**Dry run** → **Run workflow**. The job "Database and edge functions" must
turn green:

- "Check the access token" passes;
- "Database migrations" says `0 to run` (or lists the files that would run).

A red step names what is wrong (token type, password, address, another
project). A **certificate** error (self-signed, altnames) is not yours to fix:
tell Claude.

## From now on

- **Merge = deploy.** Don't run new migrations in the SQL editor and don't
  deploy functions by hand: a migration run by hand would run again on the
  next merge, and a hand-deployed function is replaced by the repository's
  version on every merge.
- A failed run sends GitHub's failure e-mail. Actions → the red run → the red
  step says which file failed, on which line, and why. Nothing from that file
  was kept, and the functions and the website stayed on the previous version.
  Fixing the file and merging again retries it. After fixing something in
  Supabase instead, use **Re-run jobs** on the newest run only (an older run
  deploys nothing), or **Run workflow** on `main`.
- The repository is public, so its Actions logs are too: the migration step
  prints file names, error codes and messages, never row values or the
  database's NOTICE texts.
- To turn the automation off: delete the two secrets (back to manual deploys).

## Notes

- The database certificate is checked against Supabase's root CA, kept in
  `scripts/deploy/supabase-root-2021.crt` (valid until 26.04.2031). The dry
  run is the first real check of it.
- `deploy.applied_migrations` is in its own schema `deploy`, which the website
  and the Data API cannot see.
- Rules for writing migrations: `AGENTS.md` → Migration Rules (number above
  140, unique, no `BEGIN`/`COMMIT`, never edit a migration after it ran).
- Checks: `node scripts/verify-deploy-migrations.mjs` (with
  `DEPLOY_TEST_DB_URL` pointing at a throwaway Postgres it also runs the
  runner end to end).
