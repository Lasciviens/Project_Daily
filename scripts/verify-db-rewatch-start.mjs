// Runs migration 161's scenarios (Watching = rewatching: Completed → Watching
// starts a rewatch round in the database, app_start_rewatch picks up a pass
// already under way) on a throwaway Postgres: migration 149's own test base
// and the real migrations 144, 149, 150, 151, then the real 161 twice (a
// re-run must be a no-op), then 149's own scenarios on top of 161 (its
// media_rewatch_finished now reads 161's aired-episode functions — the
// answers must not change) and scripts/db-tests/rewatch-start/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-rewatch-start.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-rewatch-start: skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const base = join(root, 'scripts/db-tests/media-watches')
const mig = n => join(root, 'supabase/migrations', n)
const m161 = mig('161_rewatch_from_watching.sql')
const db = `t161_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const run = (u, file) => {
  const r = spawnSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
  return { ok: r.status === 0, passed: (r.stderr.match(/NOTICE: {2}ok {2}/g) || []).length, err: r.stderr }
}

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  for (const f of [join(base, 'base.sql'), mig('144_delete_with_undo.sql'), mig('149_media_watches.sql'),
    mig('150_undo_save.sql'), mig('151_undo_save_fixes.sql'), m161, m161]) psql(target, ['-f', f])
  const old = run(target, join(base, 'scenarios.sql'))
  const own = old.ok ? run(target, join(root, 'scripts/db-tests/rewatch-start/scenarios.sql')) : null
  const bad = !old.ok ? old : !own.ok ? own : null
  if (bad) {
    failed = bad.err.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || bad.err
    console.error(failed)
  } else {
    console.log(`verify-db-rewatch-start: migration 161 (applied twice), 149's ${old.passed} checks on top of it and ${own.passed} of its own passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
