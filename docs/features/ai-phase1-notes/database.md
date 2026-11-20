# AI rebuild, phase 1 — database helper's notes

Saved 20.11.2026, mid-work, so a new session can pick up. Nothing here is committed by the helper: the lead commits.
Spec: the contract's section 1 (migration 194). Branch `claude/charming-newton-yhk8i-ai-foundation`.

## 1. Done and checked

| File | What proved it |
|---|---|
| `supabase/migrations/194_ai_ledger.sql` | `verify-db-ai-ledger` with a database: applied twice on three databases, the catalogue compared after each second run (identical), 125 + 125 + 17 scenarios passed |
| `scripts/db-tests/ai-ledger/base.sql` | used by all three databases above |
| `scripts/db-tests/ai-ledger/scenarios.sql` | 125 checks, run twice: once with the grants Supabase gave new tables before 30.10.2026, once without |
| `scripts/db-tests/ai-ledger/doors.sql` | 17 checks on the real 144, 150 and 151 (the app's delete, restore and undo functions) |
| `scripts/verify-db-ai-ledger.mjs` | runs with and without a database URL (without: static checks only, exit 0) |

The checks were themselves checked by breaking the migration on purpose (scratch copies, never the real file):

- 54 broken copies of 194 against `scenarios.sql`: every one caught (UTC instead of Oslo, a browser write grant, a
  missing revoke, a purge that clears the cost, NaN cost let in, and so on).
- 7 broken copies against 194's own closing assertions: every one refused by the migration itself.
- 40 broken copies or made-up later migrations against the static checks: every one caught, and 3 harmless ones pass.
- `doors.sql` with the ledger opened on purpose: all 6 door checks fail, as they should.
- A copy of 194 that is not safe to re-run: the catalogue comparison catches it.

## 2. Written but not checked yet

- `.github/workflows/pr-check.yml`: the new step "AI ledger database scenarios" (after "Shop rules database
  scenarios"). It only runs on GitHub. The same command passes here.

## 3. Still to do, in order

1. `docs/backend/database.md`: add the three tables and three functions in that file's own style.
2. `.claude/rules/database.md`: two new one-line rules — `ai_calls` is written only by the service role; prices are
   code, never a table.
3. Run the other scripts that read migrations (commands in section 6) and `npx eslint scripts/verify-db-ai-ledger.mjs`.
4. Drop the scratch databases `ai194`, `ai194u`, `ai194m` on the test server.
5. Update this file, then report to the lead.

## 4. Decisions, and every difference from the contract

Differences (all additions; nothing in the contract was removed or renamed):

- `ai_calls.cost_usd`: `check (cost_usd >= 0 and cost_usd < 1000000)`, not only `>= 0`. In Postgres `NaN >= 0` is
  true, so NaN would get in; one NaN turns every sum into NaN, and the function's "spent >= budget" is then false —
  the wall would be off.
- `ai_calls.thinking`: at most 1 MB (`octet_length(thinking) <= 1048576`). The contract bounds `request` and
  `response` only; this is the same last line for the third text column.
- `ai_settings` and `ai_job_settings` have `created_at timestamptz not null default now()` as well as `updated_at`
  (the repo's rule for every table).
- `ai_calls` grants `select, insert, update, delete` to `service_role`, not `all` (the repo's rule; no truncate,
  references or trigger right).
- `ai_usage` and `ai_gate` raise `42501` ("Not allowed") when the caller has no user id or is not in
  `app_allowed_users`. So a service-role call without a user gets an error, never zeros. The grant to
  `service_role` is there as the contract says. **The function must treat an `ai_gate` error as a stop, never as
  "nothing spent".**
- `ai_gate`: "the last 60 seconds" is `created_at > now() - 60 seconds`; today and the month use `>=` their start.
  `ai_gate(null)` and an unknown job answer `job_month_cost = 0`.
- `ai_usage`: the range is `p_from <= created_at < p_to`. A null or infinite bound is refused too. Errors are `22023`.
- `ai_calls_purge_text` holds `log_days` to 1–90 in its own code as well as by the CHECK.
- 194 ends with assertions that stop the deploy if the browser could write `ai_calls`, delete settings, call the
  purge, or if a signed-out caller reaches anything.
- The timer runs at `41 3 * * *` (UTC).

Decisions inside the contract:

- CHECKs on `ai_calls` are exactly the contract's and no stricter (for example `model` may be an empty text): a
  ledger row the database refuses is a call that is not counted toward the limits.
- Policies are `to authenticated` and use `(select auth.uid())`.
- `ai_gate` reads the table three times (month, last minute, today), each with its own start. One read for all
  would have to start at the earliest of them, and that differs in a month's first minute.
- Test times: `ai_usage` is tested with fixed dates (31.10.2026 23:30 and 01.11.2026 00:30 in Oslo, and a summer
  pair). `ai_gate` reads `now()`, which can't be set, so its rows are placed around the start of the month and day
  the test runs in, inside one transaction, on three accounts of their own.

## 5. Problems found and open questions

- **The gate is not atomic (security, for the lead to decide).** `ai_gate` is read before the call and the ledger
  row is written after the answer. Many requests sent at the same moment all read the same numbers and all pass,
  so a burst can go over the 20-a-minute limit and over the budget by the cost of everything in flight. A fix
  needs the function too: a service-role-only database function that takes a per-account lock, re-checks the
  limits and writes the row before the call, which the function then completes. Not built: it changes the contract.
- `docs/integrations/anthropic.md` (line 81) names a column `ai_calls.provider_message_id`. The contract has no
  such column, only `request_id`. 194 follows the contract.
- Developer → Activity's Undo: a change of `ai_settings` can be undone. Its very first save can't (that Undo is a
  delete, and the browser has none): Undo answers "permission denied for table ai_settings". Changes of
  `ai_job_settings` are listed as blocked ("no_key": its key is two columns). Both follow from the contract
  (no delete; primary key `(user_id, job)`). Both are pinned in `doors.sql`.
- `ai_job_settings` has no limit on the number of rows per account (any job name of the right shape is taken).
- `ai_settings.log_text` and `log_days` are the browser's to set, so a stolen sign-in can switch the text log off
  or shorten it to 1 day. The numbers (tokens, cost) always stay.

Could not be tested here:

- pg_cron itself (the test base has a stand-in for `cron.schedule`); the stored command is run as plain SQL.
- The real Supabase roles and PostgREST. The scenarios use `set role` and a stand-in `auth.uid()`.
- `ai_gate` with the literal date 31.10 → 01.11 (the clock can't be set). The same boundary is tested for the month
  the test runs in.
- The pr-check step on GitHub.

## 6. Commands

The throwaway Postgres 16 is on port 5460. The script makes and drops its own databases (`t194a_<pid>`,
`t194b_<pid>`, `t194d_<pid>`); the URL's database is only where it connects first.

```
DEPLOY_TEST_DB_URL=postgresql://postgres:x@localhost:5460/postgres node scripts/verify-db-ai-ledger.mjs
node scripts/verify-db-ai-ledger.mjs            # static checks only
node scripts/verify-owner-lock.cjs
node scripts/verify-table-grants.mjs
node scripts/deploy/run-migrations.mjs --check
node scripts/verify-deploy-migrations.mjs
npx eslint scripts/verify-db-ai-ledger.mjs
```

If the server is down:
`su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/test-5460 -o '-p 5460' -l /var/lib/postgresql/test-5460.log start"`
