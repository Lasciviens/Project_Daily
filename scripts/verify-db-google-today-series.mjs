// Runs migration 148's scenarios (an undated Google task filed under Today;
// a repeating plan's Google Calendar start day) on a throwaway Postgres: a
// fresh database from scripts/db-tests/google-tasks-pull/base.sql plus
// scripts/db-tests/google-today-series/base.sql, the real migration 145, the
// real migration 148 twice (a re-run must be a no-op), then 145's own
// scenarios (they must still pass against 148's upsert) and 148's.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-google-today-series.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-google-today-series: skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const pull = join(root, 'scripts/db-tests/google-tasks-pull')
const dir = join(root, 'scripts/db-tests/google-today-series')
const mig = f => join(root, 'supabase/migrations', f)
const m148 = mig('148_google_today_and_series_start.sql')
const db = `t148_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  for (const f of [join(pull, 'base.sql'), join(dir, 'base.sql'), mig('145_google_tasks_pull_fixes.sql'), m148, m148]) {
    psql(target, ['-f', f])
  }
  // Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
  let passed = 0
  for (const f of [join(pull, 'scenarios.sql'), join(dir, 'scenarios.sql')]) {
    const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', f], { encoding: 'utf8' })
    passed += (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
    if (run.status !== 0) {
      failed = run.stderr.split('\n').filter(l => /FAIL|ERROR/.test(l)).join('\n') || run.stderr
      console.error(failed)
      break
    }
  }
  if (!failed) console.log(`verify-db-google-today-series: migrations 145 + 148 (148 applied twice), 145's and 148's ${passed} scenarios passed`)
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
