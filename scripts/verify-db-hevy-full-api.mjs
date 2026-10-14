// Runs migration 154's scenarios (Hevy's whole public API: exercise pictures,
// hevy_account) on a throwaway Postgres: a fresh database from
// scripts/db-tests/hevy-full-api/base.sql, the real migrations 024 and 026
// (the Hevy tables), seed.sql (templates synced before 154), the real
// migration 154 twice (a re-run must add no column, constraint, policy or
// trigger), then scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-hevy-full-api.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-hevy-full-api: skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/hevy-full-api')
const mig = f => join(root, 'supabase/migrations', f)
const db = `t154_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  for (const f of [join(dir, 'base.sql'), mig('024_hevy.sql'), mig('026_hevy_drop_type_check.sql'), join(dir, 'seed.sql'),
    mig('154_hevy_full_api.sql'), mig('154_hevy_full_api.sql')]) {
    psql(target, ['-f', f])
  }
  // Each passing check prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-hevy-full-api: migration 154 (applied twice) and ${passed} checks passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
