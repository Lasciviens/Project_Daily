// Runs migration 147's scenarios (a repeating plan's Google Calendar event and
// its calendar-outbox trigger) on a throwaway Postgres: a fresh database from
// scripts/db-tests/calendar-series/base.sql, the real migration 135 (the
// outbox), then the real migration 147 twice (a re-run must be a no-op), then
// scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-calendar-series.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-calendar-series: skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/calendar-series')
const outbox = join(root, 'supabase/migrations/135_calendar_outbox.sql')
const mig = join(root, 'supabase/migrations/147_schedule_block_calendar_series.sql')
const db = `t147_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  for (const f of [join(dir, 'base.sql'), outbox, mig, mig]) psql(target, ['-f', f])
  // Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-calendar-series: migrations 135 + 147 (147 applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
