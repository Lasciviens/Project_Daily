// Runs migration 171's scenarios (iCloud credentials: a token table only the
// service role reads and writes — no browser access at all — with the owner
// lock) on a throwaway Postgres: scripts/db-tests/one-item/base.sql, then the
// real 171 twice (it must survive a re-run) and
// scripts/db-tests/icloud/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-icloud.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migFile = join(root, 'supabase/migrations/171_icloud_credentials.sql')

const sql = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const problems = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database')
for (const t of sql.matchAll(/create table if not exists public\.(\w+)/gi)) {
  if (!sql.includes(`owner_lock_apply('public.${t[1]}')`)) problems.push(`no owner lock on ${t[1]}`)
  if (!/revoke all on public\.\w+ from anon, authenticated/i.test(sql)) problems.push(`${t[1]} is not closed to the browser`)
}
if (problems.length) {
  console.error(`verify-db-icloud: migration 171 has ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-icloud: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const db = `t171_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')])
  // Supabase grants every new table to the API roles by default (until 30.10.2026): give the test
  // database the same default, so 171's REVOKE is what keeps the browser out.
  psql(target, ['-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role'])
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/icloud/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-icloud: 171 (applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
