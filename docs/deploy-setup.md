# Automatic deploy — one-time setup

Since 11.10.2026 a merge to `main` deploys everything, in this order
(`.github/workflows/deploy.yml`):

1. **Database migrations** — every file in `supabase/migrations/` numbered
   **above 140** that has not run yet, in number order, each once
   (`scripts/deploy/run-migrations.mjs`). Each file and its record in
   `deploy.applied_migrations` are one transaction: a failing file keeps
   nothing and stops the run.
2. **Edge functions** — all of `supabase/functions/`, with the JWT setting of
   each from `supabase/config.toml`.
3. **The website** — GitHub Pages, only after 1 and 2 succeeded.

Migrations `001`–`140` were applied by hand before this and are never run by
the workflow.

The workflow needs two repository secrets. Until both exist, it only prints a
notice and deploys the website, as before.

## 1. Supabase access token → `SUPABASE_ACCESS_TOKEN`

1. Open https://supabase.com/dashboard/account/tokens (signed in with the
   account that owns the project).
2. **Generate new token**, name it `GitHub deploy`. If it asks for an expiry,
   pick the longest one; when it expires the deploy fails with "401" and you
   make a new token the same way.
3. Copy it. It starts with `sbp_`. An API key (`eyJ…`, `sb_secret_…`,
   `sb_publishable_…`) is the wrong thing; the workflow says so.

## 2. Database address → `SUPABASE_DB_URL`

1. Supabase Dashboard → the project → **Connect** (top of the page) →
   **Connection string** → **Session pooler**.
2. Copy the address. It looks like
   `postgresql://postgres.hsaedwwqpcjizeozjbch:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`.
   Not the "Direct connection" (`db.….supabase.co`, GitHub cannot reach it) and
   not the "Transaction pooler" (port `6543`).
3. Replace `[YOUR-PASSWORD]` (brackets included) with the database password.
   - Don't know it? Project Settings → Database → **Reset database password**
     → **Generate a password**. The app does not use this password (its
     functions use API keys), so resetting it changes nothing else here.
   - A password with characters other than letters and digits must be
     URL-encoded (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`,
     `%` → `%25`); a generated one avoids that.

## 3. Add both to GitHub

GitHub → the repository → **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**:

| Name | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | the `sbp_…` token |
| `SUPABASE_DB_URL` | the Session pooler address with the password |

## 4. Test with a dry run (changes nothing)

GitHub → **Actions** → **Deploy** → **Run workflow** → tick **Dry run** →
**Run workflow**. The job "Database and edge functions" must turn green:

- "Database migrations" says `0 to run` (or lists the files that would run);
- "Check the access token (dry run)" lists the edge functions.

A red step names what is wrong (wrong token type, password, address).

## From now on

- **Merge = deploy.** Don't run new migrations in the SQL editor and don't
  deploy functions by hand: a migration run by hand would run again on the
  next merge, and a hand-deployed function is replaced by the repository's
  version on every merge.
- A failed run sends GitHub's failure e-mail. Actions → the red run → the red
  step says which file failed and why. Nothing from that file was kept, and the
  functions and the website stayed on the previous version. Fixing the file and
  merging again (or **Re-run jobs** after fixing something in Supabase) retries it.
- To turn the automation off: delete the two secrets (back to manual deploys).

## Notes

- The database certificate is checked against Supabase's root CA, kept in
  `scripts/deploy/supabase-root-2021.crt` (valid until 26.04.2031).
- `deploy.applied_migrations` is in its own schema `deploy`, which the website
  and the Data API cannot see.
- Rules for writing migrations: `AGENTS.md` → Migration Rules (number above
  140, unique; never edit a migration after it ran).
- Checks: `node scripts/verify-deploy-migrations.mjs` (with
  `DEPLOY_TEST_DB_URL` pointing at a throwaway Postgres it also runs the
  runner end to end).
