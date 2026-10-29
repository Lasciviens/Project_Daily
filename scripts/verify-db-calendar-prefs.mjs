// Runs migration 172's scenarios (calendar settings: the owner's own row,
// audited, owner lock; icloud_credentials' area calendars and the derived
// password_sealed) on a throwaway Postgres: scripts/db-tests/one-item/base.sql,
// the real 171, then the real 172 twice (it must survive a re-run) and
// scripts/db-tests/calendar-prefs/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-calendar-prefs.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig171 = join(root, 'supabase/migrations/171_icloud_credentials.sql')
const migFile = join(root, 'supabase/migrations/172_calendar_prefs.sql')

const sql = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const problems = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database')
for (const t of sql.matchAll(/create table if not exists public\.(\w+)/gi)) {
  if (!sql.includes(`owner_lock_apply('public.${t[1]}')`)) problems.push(`no owner lock on ${t[1]}`)
  if (!new RegExp(`create trigger trg_audit[\\s\\S]*?on public\\.${t[1]}`, 'i').test(sql)) problems.push(`${t[1]} is not audited`)
}
if (/grant[^;]*icloud_credentials[^;]*to (anon|authenticated)/i.test(sql)) problems.push('icloud_credentials opened to the browser')
if (problems.length) {
  console.error(`verify-db-calendar-prefs: migration 172 has ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-calendar-prefs: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const db = `t172_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')])
  // Supabase grants every new table to the API roles by default (until 30.10.2026): the test database does too.
  psql(target, ['-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role'])
  psql(target, ['-f', mig171])
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/calendar-prefs/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-calendar-prefs: 172 (applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
