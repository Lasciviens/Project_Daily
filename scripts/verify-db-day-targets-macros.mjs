// Runs migration 153's scenarios (the owner's carb and fat goals on
// day_targets and day_target_profiles) on a throwaway Postgres: a fresh
// database from scripts/db-tests/day-targets-macros/base.sql, the real
// migrations 086, 088 and 113, seed.sql (rows as they are before 153), the
// real migration 153 twice (a re-run must change nothing), then scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-day-targets-macros.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-day-targets-macros: skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/day-targets-macros')
const mig = f => join(root, 'supabase/migrations', f)
const db = `t153_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  for (const f of [join(dir, 'base.sql'), mig('086_day_targets.sql'), mig('088_day_target_profiles.sql'), mig('113_goal_in_day_targets.sql'),
    join(dir, 'seed.sql'), mig('153_day_targets_carbs_fat.sql'), mig('153_day_targets_carbs_fat.sql')]) {
    psql(target, ['-f', f])
  }
  // Each passing check prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-day-targets-macros: migration 153 (applied twice) and ${passed} checks passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
