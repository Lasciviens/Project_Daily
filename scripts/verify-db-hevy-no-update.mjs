// Runs migration 182's scenarios (stored Hevy workouts can't be changed from the browser) on a throwaway Postgres: the base
// of verify-db-hevy-full-api (auth with three accounts, the three API roles with Supabase's default table grants,
// 139's owner lock), the real migrations 024 and 026 (the Hevy tables), the real 182 twice, then
// scripts/db-tests/hevy-no-update/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-hevy-no-update.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static check and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig182 = mig('182_hevy_workouts_no_update.sql')

// Static: 182 only takes rights back — nothing else, nothing outside the database.
{
  const sql = readFileSync(mig182, 'utf8').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
  const statements = sql.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const allowed = [
    /^revoke update, truncate, references, trigger on table public\.hevy_workouts from authenticated$/i,
    /^revoke all on table public\.hevy_workouts from anon$/i,
    /^comment on table public\.hevy_workouts is ''( '')*$/i,
  ]
  const odd = statements.filter(s => !allowed.some(re => re.test(s)))
  if (odd.length) {
    console.error(`verify-db-hevy-no-update: migration 182 has more than its two revokes: ${odd.join(' | ')}`)
    process.exit(1)
  }
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-hevy-no-update: static check passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const db = `t182_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
let passed = 0
try {
  const target = withDb(url, db)
  for (const f of [join(root, 'scripts/db-tests/hevy-full-api/base.sql'), mig('024_hevy.sql'), mig('026_hevy_drop_type_check.sql'), mig182, mig182]) {
    psql(target, ['-f', f])
  }
  // Each passing check prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/hevy-no-update/scenarios.sql')], { encoding: 'utf8' })
  passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
console.log(`verify-db-hevy-no-update: migration 182 (applied twice) and ${passed} checks passed`)
