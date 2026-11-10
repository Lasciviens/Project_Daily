// Runs migration 185's scenarios (the assistant's live read query can't change a setting, and only the app's own
// account may run it) on a throwaway Postgres set up the way Supabase's API reaches it: PostgREST signs in as
// `authenticator`, a role allowed to become anon, authenticated and service_role, and switches to the caller's role.
//   1. 140's ai_run_read_query, then scripts/db-tests/read-query/before.sql: the hole is real here (a signed-in
//      account that isn't the owner reads a token) — so the scenarios after it would catch it coming back;
//   2. the real 185 twice, then scripts/db-tests/read-query/scenarios.sql: its wall is built (SECURITY DEFINER owned
//      by authenticated), every known way around the old guard is refused — an extension that runs SQL text included —
//      and the owner's ordinary reads still work;
//   3. in a second database, 185 run as a role that may not build the wall: it says so, the function stays SECURITY
//      INVOKER, and scripts/db-tests/read-query/fallback.sql shows the name checks and the last line still hold;
//   4. in a third, 185 behind its wall, then each later re-creation run by a role that is not a member of
//      authenticated (it may neither replace nor re-wall the function): 185's function stays exactly as it was, and
//      the log says so and names the mode it really keeps — SECURITY DEFINER (the guardian review, 10.11.2026).
// is_app_user() is 139's own text, run as it is. Static checks first: 185 re-creates only ai_run_read_query, creates
// it SECURITY INVOKER and makes it a definer only after handing it to authenticated (inside its own exception block),
// checks the owner lock first, and grants it to authenticated only. A later migration may re-create it only to watch
// more settings (189: 187's app.shop_restored): 185's text word for word but for added names in `watched`, replaced
// inside a block that keeps 185's function where the migration may not replace it, the same grants, and 185's wall
// again. Each such migration runs (twice) after 185 in both databases, so the scenarios meet the newest function.
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
// Later migrations that re-create the read query, in the order the deploy runs them.
const laterRecreations = readdirSync(migDir).filter(f => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 185)
  .sort().filter(f => /function public\.ai_run_read_query/i.test(readFileSync(join(migDir, f), 'utf8')))

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
  const body = fnText('185_read_query_lockdown.sql', 'ai_run_read_query')
  if (!/\nsecurity invoker\n/i.test(body) || /security definer/i.test(body)) {
    fail('185 must create the function SECURITY INVOKER — only the wall makes it a definer, after the owner change')
  }
  const wall = sql.slice(sql.search(/do \$wall\$/i))
  const own = wall.search(/alter function public\.ai_run_read_query\(text\) owner to authenticated;/i)
  const def = wall.search(/alter function public\.ai_run_read_query\(text\) security definer;/i)
  if (own < 0 || def < 0 || def < own || !/exception when others then/i.test(wall)) {
    fail('185\'s wall must hand the function to authenticated before making it SECURITY DEFINER, inside its own exception block')
  }
  const isApp = body.indexOf('public.is_app_user()')
  const exec = body.indexOf('execute format(')
  if (isApp < 0 || exec < 0 || isApp > exec) fail('185 must ask is_app_user() before it runs the query')
  for (const piece of ["strpos(q, '/*')", "strpos(q, '--')", "q ~ '[;\"]'", 'set_config|current_setting|set_limit|setseed', '\\w*_to_xml\\w*',
    'ts_stat', 'ts_rewrite', 'dblink', "'\\ypg_'", 'information_schema', "'transaction_read_only', 'on'", 'after_run is distinct from before_run']) {
    if (!body.includes(piece)) fail(`185's guard no longer has ${piece}`)
  }
  if (!/revoke all\s+on function public\.ai_run_read_query\(text\) from public, anon;/i.test(sql)
    || !/grant\s+execute on function public\.ai_run_read_query\(text\) to authenticated;/i.test(sql)
    || /grant\s+execute on function public\.ai_run_read_query\(text\) to (?!authenticated;)/i.test(sql)) {
    fail('185 must grant the read query to authenticated only (not anon, not public)')
  }
  // A later re-creation: 185's function but for more watched names, its grants, and the wall rebuilt.
  const watchedOf = text => {
    const m = text.match(/watched constant text\[\] := array\[([\s\S]*?)\];/)
    if (!m) return null
    return { names: [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]), text: text.replace(m[0], 'watched constant text[] := array[…];') }
  }
  const base = watchedOf(body)
  if (!base) fail('185\'s function has no `watched` list')
  for (const f of laterRecreations) {
    const raw = readFileSync(join(migDir, f), 'utf8')
    const lsql = raw.replace(/--.*$/gm, '')
    const fn = fnText(f, 'ai_run_read_query')
    const w = watchedOf(fn)
    if (!w || w.text !== base.text) fail(`${f} re-creates ai_run_read_query with more than a longer \`watched\` list: keep 185's text word for word`)
    const lost = base.names.filter(n => !w.names.includes(n))
    if (lost.length) fail(`${f} stops watching ${lost.join(', ')}`)
    if (w.names.length === base.names.length) fail(`${f} re-creates ai_run_read_query without adding a watched name`)
    const blockRaw = raw.match(/do \$replace\$[\s\S]*?\n\$replace\$;/i)?.[0] ?? ''
    const block = blockRaw.replace(/--.*$/gm, '')
    if (!blockRaw.includes(fn) || !/exception when insufficient_privilege then/i.test(block) || /exception when others/i.test(block)) {
      fail(`${f} must replace the function inside its own block that keeps 185's where it may not (insufficient_privilege only)`)
    }
    if (!/revoke all\s+on function public\.ai_run_read_query\(text\) from public, anon;/i.test(block)
      || !/grant\s+execute on function public\.ai_run_read_query\(text\) to authenticated;/i.test(block)
      || /grant\s+execute on function public\.ai_run_read_query\(text\) to (?!authenticated;)/i.test(lsql)) {
      fail(`${f} must grant the read query to authenticated only, in the same block`)
    }
    const lwall = lsql.slice(lsql.search(/do \$wall\$/i))
    const lown = lwall.search(/alter function public\.ai_run_read_query\(text\) owner to authenticated;/i)
    const ldef = lwall.search(/alter function public\.ai_run_read_query\(text\) security definer;/i)
    if (lsql.search(/do \$wall\$/i) < lsql.search(/do \$replace\$/i) || lown < 0 || ldef < lown || !/exception when others then/i.test(lwall)) {
      fail(`${f} must rebuild 185's wall after the replace: hand the function to authenticated, then SECURITY DEFINER, in its own exception block`)
    }
  }
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-read-query: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}
const db = `t185_${process.pid}`
const dbFallback = `t185f_${process.pid}`
const dbWalled = `t185w_${process.pid}`
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
    for (const f of laterRecreations) for (let n = 0; n < 2; n++) psql(target, ['-f', join(migDir, f)])
    const after = runFile(target, join(testDir, 'scenarios.sql'))
    passed += after.ok
    if (after.error) failed = after.error
  }
  if (!failed) {
    // Where the wall can't be built: 140's function and 185 belong to a role that may not act as authenticated.
    psql(url, ['-c', `create database ${dbFallback}`])
    const fb = withDb(url, dbFallback)
    psql(fb, ['-f', join(testDir, 'base.sql')])
    psql(fb, ['-c', fnText('139_owner_lock.sql', 'is_app_user')])
    psql(fb, ['-c', `do $$ begin create role t185_mig nologin; exception when duplicate_object then null; end $$;
      grant usage, create on schema public to t185_mig;`])
    psql(fb, ['-c', `set role t185_mig;
      ${fnText('140_security_fixes.sql', 'ai_run_read_query')}
      revoke all on function public.ai_run_read_query(text) from public, anon;
      grant execute on function public.ai_run_read_query(text) to authenticated;`])
    for (const f of ['185_read_query_lockdown.sql', ...laterRecreations]) {
      if (failed) break
      const n = f.slice(0, 3)
      const run = spawnSync('psql', [fb, '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'set role t185_mig', '-f', join(migDir, f)], { encoding: 'utf8' })
      if (run.status !== 0) failed = `${n} failed where the wall can't be built (it must not):\n${run.stderr}`
      else if (!new RegExp(`${n}: the read query could not be put behind`).test(run.stderr)) failed = `${n} did not say in the log that its wall could not be built`
    }
    if (!failed) {
      const fallback = runFile(fb, join(testDir, 'fallback.sql'))
      passed += fallback.ok
      if (fallback.error) failed = `where the wall can't be built:\n${fallback.error}`
    }
  }
  if (!failed) {
    // 185 behind its wall, then each later re-creation run by a role outside authenticated: it can't replace 185's
    // function (owned by authenticated) nor hand it over again, so the function must stay exactly 185's — and the
    // deploy log must name the mode it really keeps.
    psql(url, ['-c', `create database ${dbWalled}`])
    const wd = withDb(url, dbWalled)
    psql(wd, ['-f', join(testDir, 'base.sql')])
    psql(wd, ['-c', fnText('139_owner_lock.sql', 'is_app_user')])
    psql(wd, ['-c', `${fnText('140_security_fixes.sql', 'ai_run_read_query')}
      revoke all on function public.ai_run_read_query(text) from public, anon;
      grant execute on function public.ai_run_read_query(text) to authenticated;`])
    psql(wd, ['-f', mig185])
    const state = () => psql(wd, ['-At', '-c', `select prosecdef, proowner::regrole, proacl, md5(pg_get_functiondef(oid))
      from pg_proc where oid = 'public.ai_run_read_query(text)'::regprocedure`]).trim()
    const walled = state()
    if (!walled.startsWith('t|authenticated|')) failed = `185 did not build its wall in the third database: ${walled}`
    psql(wd, ['-c', `do $$ begin create role t185_out nologin; exception when duplicate_object then null; end $$;
      grant usage, create on schema public to t185_out;`])
    for (const f of laterRecreations) {
      if (failed) break
      const n = f.slice(0, 3)
      const run = spawnSync('psql', [wd, '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'set role t185_out', '-f', join(migDir, f)], { encoding: 'utf8' })
      if (run.status !== 0) failed = `${n} failed run by a role outside authenticated (it must not):\n${run.stderr}`
      else if (!new RegExp(`${n}: the read query could not be replaced`).test(run.stderr)) failed = `${n} did not say it could not replace the function:\n${run.stderr}`
      else if (!new RegExp(`${n}: the read query could not be put behind[^\\n]*keeps the mode it has: SECURITY DEFINER`).test(run.stderr)) {
        failed = `${n}'s warning does not name the mode 185's function keeps (SECURITY DEFINER):\n${run.stderr}`
      } else if (state() !== walled) failed = `${n} changed 185's function though it could not replace it: ${state()} (was ${walled})`
      else passed++
    }
  }
  if (failed) console.error(failed)
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
  try { psql(url, ['-c', `drop database if exists ${dbFallback}`]) } catch { /* best effort */ }
  try { psql(url, ['-c', `drop database if exists ${dbWalled}`]) } catch { /* best effort */ }
  try { psql(url, ['-c', 'drop role if exists t185_mig']) } catch { /* another run may still use it */ }
  try { psql(url, ['-c', 'drop role if exists t185_out']) } catch { /* another run may still use it */ }
}
if (failed) process.exit(1)
console.log(`verify-db-read-query: 140's hole reproduced, then ${['185', ...laterRecreations.map(f => f.slice(0, 3))].join(' + ')} (each applied twice, behind the wall and without it; ${laterRecreations.map(f => f.slice(0, 3)).join(' + ') || 'none'} also run by a role outside authenticated over 185's wall, which stays as it was) and ${passed} scenarios passed`)
