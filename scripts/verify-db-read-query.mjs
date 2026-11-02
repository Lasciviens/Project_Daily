// Runs migration 185's scenarios (the assistant's live read query can't change a setting, and only the app's own
// account may run it) on a throwaway Postgres set up the way Supabase's API reaches it: PostgREST signs in as
// `authenticator`, a role allowed to become anon, authenticated and service_role, and switches to the caller's role.
//   1. 140's ai_run_read_query, then scripts/db-tests/read-query/before.sql: the hole is real here (a signed-in
//      account that isn't the owner reads a token) — so the scenarios after it would catch it coming back;
//   2. the real 185 twice, then scripts/db-tests/read-query/scenarios.sql: every known way around the old guard is
//      refused, the owner's ordinary reads still work.
// is_app_user() is 139's own text, run as it is. Static checks first: 185 re-creates only ai_run_read_query, keeps it
// SECURITY INVOKER with the owner-lock check, grants it to authenticated only, and no later migration replaces it.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-read-query.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migDir = join(root, 'supabase/migrations')
const testDir = join(root, 'scripts/db-tests/read-query')
const mig185 = join(migDir, '185_read_query_lockdown.sql')
const fail = msg => { console.error(`verify-db-read-query: ${msg}`); process.exit(1) }

const fnText = (file, name) => {
  const m = readFileSync(join(migDir, file), 'utf8').match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))
  if (!m) fail(`could not find ${name} in ${file}`)
  return m[0]
}

{
  const raw = readFileSync(mig185, 'utf8')
  const sql = raw.replace(/--.*$/gm, '')
  const fns = [...sql.matchAll(/create or replace function (public\.\w+)/gi)].map(m => m[1])
  if (fns.join() !== 'public.ai_run_read_query') fail(`185 should re-create only public.ai_run_read_query, found ${fns.join(', ')}`)
  if (/^\s*(begin|commit)\s*;/im.test(sql)) fail('185 has a top-level BEGIN/COMMIT')
  if (!/security invoker/i.test(sql) || /security definer/i.test(sql)) fail('185 must stay SECURITY INVOKER (RLS applies as the caller)')
  const body = fnText('185_read_query_lockdown.sql', 'ai_run_read_query')
  const isApp = body.indexOf('public.is_app_user()')
  const exec = body.indexOf('execute format(')
  if (isApp < 0 || exec < 0 || isApp > exec) fail('185 must ask is_app_user() before it runs the query')
  for (const piece of ["strpos(q, '/*')", "strpos(q, '--')", "q ~ '[;\"]'", '\\yset_config\\y', '\\w*_to_xml\\w*', 'ts_stat', 'ts_rewrite',
    'dblink', "'\\ypg_'", 'information_schema', "'transaction_read_only', 'on'"]) {
    if (!body.includes(piece)) fail(`185's guard no longer has ${piece}`)
  }
  if (!/revoke all\s+on function public\.ai_run_read_query\(text\) from public, anon;/i.test(sql)
    || !/grant\s+execute on function public\.ai_run_read_query\(text\) to authenticated;/i.test(sql)
    || /grant\s+execute on function public\.ai_run_read_query\(text\) to (?!authenticated;)/i.test(sql)) {
    fail('185 must grant the read query to authenticated only (not anon, not public)')
  }
  const later = readdirSync(migDir).filter(f => /^\d+_/.test(f) && Number(f.slice(0, 3)) > 185)
  for (const f of later) if (/function public\.ai_run_read_query/i.test(readFileSync(join(migDir, f), 'utf8'))) {
    fail(`${f} re-creates ai_run_read_query: keep 185's checks and add its case to scripts/db-tests/read-query`)
  }
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-read-query: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}
const db = `t185_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const runFile = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
  const ok = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) return { ok, error: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr }
  return { ok }
}
psql(url, ['-c', `create database ${db}`])
let failed = null
let passed = 0
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(testDir, 'base.sql')])
  // 139's owner-lock check exactly as it shipped (the table it reads is in base.sql).
  psql(target, ['-c', fnText('139_owner_lock.sql', 'is_app_user')])
  // 140's read query: the version with the hole.
  psql(target, ['-c', `${fnText('140_security_fixes.sql', 'ai_run_read_query')}
    revoke all on function public.ai_run_read_query(text) from public, anon;
    grant execute on function public.ai_run_read_query(text) to authenticated;`])
  const before = runFile(target, join(testDir, 'before.sql'))
  passed += before.ok
  if (before.error) failed = `before 185 (140's read query):\n${before.error}`
  if (!failed) {
    for (let n = 0; n < 2; n++) psql(target, ['-f', mig185])
    const after = runFile(target, join(testDir, 'scenarios.sql'))
    passed += after.ok
    if (after.error) failed = after.error
  }
  if (failed) console.error(failed)
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
console.log(`verify-db-read-query: 140's hole reproduced, then 185 (applied twice) and ${passed} scenarios passed`)
