// Runs the scenarios of "Undo this save" on Developer → Activity (migrations
// 150 and 151) on a throwaway Postgres: a fresh database from
// scripts/db-tests/undo-save/base.sql, the real migration 144 (the delete Undo
// builds on), the real migration 150, then 151 twice (a re-run must be a
// no-op), then scenarios.sql. The race scenario opens two more sessions on
// the same database with dblink (the URL goes in as the psql variable
// `dburl`); without the dblink extension it says so and skips that one.
// Then a second database for the undo of watch changes (149): the media
// scenarios' base (scripts/db-tests/media-watches/base.sql), the real
// migrations 144, 149, 150 and 151, then undo-save/watches.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-undo-save.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-undo-save: skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/undo-save')
const mig = f => join(root, 'supabase/migrations', f)
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const suites = [
  {
    db: `t151_${process.pid}`,
    files: [join(dir, 'base.sql'), mig('144_delete_with_undo.sql'), mig('150_undo_save.sql'), mig('151_undo_save_fixes.sql'), mig('151_undo_save_fixes.sql')],
    scenarios: join(dir, 'scenarios.sql'),
  },
  {
    db: `t151w_${process.pid}`,
    files: [join(root, 'scripts/db-tests/media-watches/base.sql'), mig('144_delete_with_undo.sql'), mig('149_media_watches.sql'),
      mig('150_undo_save.sql'), mig('151_undo_save_fixes.sql')],
    scenarios: join(dir, 'watches.sql'),
  },
]

let failed = null
let passed = 0
for (const s of suites) {
  psql(url, ['-c', `create database ${s.db}`])
  try {
    const target = withDb(url, s.db)
    for (const f of s.files) psql(target, ['-f', f])
    // Each passing check prints a NOTICE ("ok  …") on stderr; a failing one raises.
    const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-v', `dburl=${target}`, '-q', '-f', s.scenarios], { encoding: 'utf8' })
    passed += (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
    if (/NOTICE: {2}skip {2}/.test(run.stderr)) console.log(run.stderr.split('\n').filter(l => /NOTICE: {2}skip/.test(l)).join('\n'))
    if (run.status !== 0) {
      failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT/.test(l)).join('\n') || run.stderr
      console.error(failed)
    }
  } finally {
    try { psql(url, ['-c', `drop database if exists ${s.db}`]) } catch { /* best effort */ }
  }
  if (failed) break
}
if (failed) process.exit(1)
console.log(`verify-db-undo-save: migrations 150 and 151 (151 applied twice), with and without 149, and ${passed} checks passed`)
