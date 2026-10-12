// Runs migration 142's scenarios (one planned training session, one model)
// on a throwaway Postgres: a fresh database from scripts/db-tests/training-
// session/base.sql + pre.sql, then the real migrations 112 (training_skips),
// 141 and 142 (142 twice — a re-run must be a no-op), then scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-training-session.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-training-session: skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/training-session')
const mig = f => join(root, 'supabase/migrations', f)
const db = `t142_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const tmp = mkdtempSync(join(tmpdir(), 'v142-'))
// 112's table only (its policies and audit trigger need Supabase roles).
const table112 = readFileSync(mig('112_training_skips.sql'), 'utf8').match(/CREATE TABLE IF NOT EXISTS public\.training_skips[\s\S]*?\n\);/)
if (!table112) throw new Error('could not find training_skips in migration 112')
writeFileSync(join(tmp, '112.sql'), table112[0] + '\n')

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  for (const f of [join(dir, 'base.sql'), join(tmp, '112.sql'), join(dir, 'pre.sql'),
    mig('141_training_task_links.sql'), mig('142_training_session_one_model.sql'), mig('142_training_session_one_model.sql')]) {
    psql(target, ['-f', f])
  }
  // Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-training-session: migrations 141 + 142 (applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
  rmSync(tmp, { recursive: true, force: true })
}
if (failed) process.exit(1)
