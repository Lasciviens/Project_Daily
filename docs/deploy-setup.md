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
the workflow. The runner checks that 139 and 140 really ran (the owner lock
and `ai_pending_actions` exist) and stops, changing nothing, if not.

The deploy runs only from `main`, and always deploys `main`'s **newest**
commit, whichever commit started the run — or, when the deploy workflow itself
changed since that commit, nothing (and says so): a re-run or a queued older
run can never put older code back. A dry run, or a run started from another branch,
has its own queue and never replaces a real deploy waiting in line.

## 0. Before you start

- Migrations 139 and 140 have been run in the SQL editor (CLAUDE.md → Pending
  manual steps, first rows). The deploy refuses to touch the database
  otherwise.
- **Before merging,** delete leftovers of earlier deploy attempts (06.06.2026–
  14.07.2026): GitHub → **Settings** → **Secrets and variables** → **Actions** →
  under **Repository secrets**, delete `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL` and `SUPABASE_PROJECT_REF` if any
  is listed. Any workflow on any branch can read repository secrets, so every
  deploy stops (the website too) while one of the first three exists there.
- Merge the pull request that adds this. The **Dry run** button (step 4)
  exists only once the workflow is on `main`. Until the environment secrets
  exist, a merge deploys the website exactly as before.

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

Put them in the environment, not under "Repository secrets": as repository
secrets any branch's workflow could read them, so the first job of every
deploy ("Deploy secrets are environment-only") fails while they exist there.

Recommended too: **Settings → Rules → Rulesets → New branch ruleset** for
`main` with **Require a pull request before merging**, so nothing reaches
`main` (and with it the database password) without your merge.

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
  step says what failed:
  - **Database migrations:** which file, on which line, the error code. Nothing
    from that file was kept, and the functions and the website stayed on the
    previous version. The full error message is in the database (SQL editor:
    `select * from deploy.migration_errors order by at desc limit 1;`). The
    last line says what to do: **fix the file and merge again**, or — when the
    connection broke or a table stayed busy — **run the deploy again**
    (Actions → Deploy → Run workflow on `main`).
  - **Edge functions:** the database is already migrated, the functions before
    the failing one are new, the website is still the previous one. Fix the
    function and merge again, or — if the cause was on Supabase's side —
    **Run workflow** on `main`.
  - **Check the access token / Decide what to deploy / Deploy secrets are
    environment-only:** a setup problem; the message says which. Nothing was
    deployed.
- To deploy again without a new merge, always use **Actions → Deploy → Run
  workflow** on `main` (not "Re-run" on an old run).
- The repository is public, so its Actions logs are too: the migration step
  prints file names, line numbers and error codes, and the error message only
  when it cannot contain row data (a failed conversion quotes the value, so
  its message stays in `deploy.migration_errors`). Database NOTICE texts are
  never printed.
- To turn the automation off: delete the two secrets (back to manual deploys).

## Notes

- The database certificate and name are checked (Supabase's root CA, kept in
  `scripts/deploy/supabase-root-2021.crt` and valid until 26.04.2031, plus the
  usual public roots). The dry run is the first real check of it.
- `deploy.applied_migrations` is in its own schema `deploy`, which the website
  and the Data API cannot see.
- Rules for writing migrations: `AGENTS.md` → Migration Rules (number above
  140, unique, no `BEGIN`/`COMMIT`, never edit a migration after it ran).
- Checks: `node scripts/verify-deploy-migrations.mjs` (with
  `DEPLOY_TEST_DB_URL` pointing at a throwaway Postgres it also runs the
  runner end to end).
