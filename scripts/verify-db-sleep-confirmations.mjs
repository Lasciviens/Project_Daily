// Runs migration 164's scenarios (a sleep night confirmed complete: one row per
// night, the caller's own, undone by a delete, audited, row level security and
// the owner lock) on a throwaway Postgres: scripts/db-tests/one-item/base.sql
// (auth with a switchable caller, the owner lock, the audit log), then the real
// 164 twice (it must survive a re-run) and
// scripts/db-tests/sleep-confirmations/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-sleep-confirmations.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migFile = join(root, 'supabase/migrations/164_sleep_night_confirmations.sql')

const sql = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const problems = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database')
for (const t of sql.matchAll(/create table if not exists public\.(\w+)/gi)) {
  if (!sql.includes(`owner_lock_apply('public.${t[1]}')`)) problems.push(`no owner lock on ${t[1]}`)
  if (!new RegExp(`trg_audit[\\s\\S]*?on public\\.${t[1]}\\b`, 'i').test(sql)) problems.push(`no trg_audit on ${t[1]}`)
}
if (problems.length) {
  console.error(`verify-db-sleep-confirmations: migration 164 has ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-sleep-confirmations: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const db = `t164_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')])
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/sleep-confirmations/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-sleep-confirmations: 164 (applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
