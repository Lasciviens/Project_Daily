// Runs migration 194's scenarios (the AI ledger) on a throwaway Postgres. The monthly budget wall and the rate
// limits of the `claude` function are worked out from public.ai_calls, so the question everywhere is: can anyone
// but the service role move them?
// Three databases, each from scripts/db-tests/ai-ledger/base.sql and the real 194 applied twice (the second run
// must leave everything exactly as the first did — the catalogue is compared):
//   · with the grants Supabase gave every new table and function before 30.10.2026: 194's own revokes must be what
//     keeps the browser out — scenarios.sql;
//   · without them (production now): 194's own grants must be enough — scenarios.sql again;
//   · with the real 144, 150 and 151 (delete with Undo, Undo a save): doors.sql — the app's own delete, restore and
//     undo functions can't touch the ledger, and what Activity's Undo does with the two settings tables.
// scenarios.sql: what 194 made (policies, grants, functions, the timer), every CHECK with good and bad values, the
// owner's own browser session, a second account, an account the owner lock keeps out, a signed-out caller and the
// service role without a user, ai_usage's Oslo days at chosen times, ai_gate's month, day and minute, the purge.
// Static checks first, on 194 and on every later migration: the ledger stays read-only for the browser, the generic
// delete and undo functions stay SECURITY INVOKER, and no price table appears.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-ai-ledger.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migDir = join(root, 'supabase/migrations')
const mig = f => join(migDir, f)
const dir = join(root, 'scripts/db-tests/ai-ledger')
const FILE = '194_ai_ledger.sql'
const TABLES = ['ai_calls', 'ai_settings', 'ai_job_settings']
const fail = msg => { console.error(`verify-db-ai-ledger: ${msg}`); process.exit(1) }

const noComments = text => text.replace(/--.*$/gm, '')
const statementsOf = text => noComments(text).split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)

// Static, 194.
{
  const src = readFileSync(mig(FILE), 'utf8')
  const sql = noComments(src)
  const stmts = statementsOf(src)
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database or a secret (the purge is plain SQL)')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== TABLES.join()) problems.push(`creates ${tables.join(', ') || 'no table'} (expected ${TABLES.join(', ')})`)
  if (/create table[^;(]*pric/i.test(sql)) problems.push('a price table (prices are code: the budget wall is worked out from them)')
  for (const t of TABLES) {
    if (!new RegExp(`create table if not exists public\\.${t} \\([\\s\\S]*?\\n\\);\\s*alter table public\\.${t} enable row level security;`, 'i').test(sql)) problems.push(`no row level security right after ${t}`)
    if (!new RegExp(`select public\\.owner_lock_apply\\('public\\.${t}'\\);`, 'i').test(sql)) problems.push(`no owner_lock_apply for ${t}`)
    if (!stmts.includes(`revoke all on public.${t} from anon, authenticated`)) problems.push(`${t}: no "revoke all … from anon, authenticated" before its grants`)
    if (!stmts.includes(`grant select, insert, update, delete on public.${t} to service_role`)) problems.push(`${t}: no service-role grant`)
    if (stmts.some(s => new RegExp(`^grant .* on (table )?public\\.${t} to .*\\banon\\b`, 'i').test(s))) problems.push(`${t}: a grant to anon`)
    const toApp = stmts.filter(s => new RegExp(`^grant .* on (table )?public\\.${t} to .*\\bauthenticated\\b`, 'i').test(s))
    const want = t === 'ai_calls' ? `grant select on public.${t} to authenticated` : `grant select, insert, update on public.${t} to authenticated`
    if (toApp.join(' | ') !== want) problems.push(`${t}: the browser's grant is "${toApp.join(' | ')}" (expected "${want}")`)
    const cmds = [...sql.matchAll(new RegExp(`create policy "[^"]+" on public\\.${t}\\s+for (\\w+) to authenticated`, 'gi'))].map(m => m[1].toLowerCase()).sort().join()
    const wantCmds = t === 'ai_calls' ? 'select' : 'insert,select,update'
    if (cmds !== wantCmds) problems.push(`${t}: policies for ${cmds || 'nothing'} (expected ${wantCmds})`)
    if ((sql.match(new RegExp(`create policy "[^"]+" on public\\.${t}\\b`, 'gi')) || []).length !== wantCmds.split(',').length) problems.push(`${t}: a policy the check above does not read`)
    const audited = new RegExp(`create trigger trg_audit after insert or update or delete on public\\.${t}\\s+for each row execute function public\\.log_audit\\(\\);`, 'i').test(sql)
    if (audited !== (t !== 'ai_calls')) problems.push(t === 'ai_calls' ? 'the ledger is audited (it is a log itself, and Undo must not reach it)' : `${t}: no audit trigger`)
  }
  if (new RegExp('create trigger[^;]*on public\\.ai_calls\\b', 'i').test(sql)) problems.push('a trigger on the ledger')
  if (!/No audit trigger: /.test(src)) problems.push('the header does not say why the ledger has no audit trigger')
  if (!/\n\s*user_id\s+uuid not null references auth\.users\(id\) on delete cascade,/i.test(sql)) problems.push('ai_calls.user_id is not "uuid not null references auth.users(id) on delete cascade" without a default')
  if ((sql.match(/user_id\s+uuid (?:primary key|not null) default auth\.uid\(\) references auth\.users\(id\) on delete cascade/gi) || []).length !== 2) problems.push('a settings table\'s user_id does not default to auth.uid()')
  if (/auth\.uid\(\)/.test(sql.replace(/default auth\.uid\(\)/gi, '').replace(/\(select auth\.uid\(\)\)/gi, ''))) problems.push('a bare auth.uid() (policies and functions use (select auth.uid()))')
  if (!/cost_usd\s+numeric\(12,6\) not null default 0 check \(cost_usd >= 0 and cost_usd < 1000000\)/i.test(sql)) problems.push('cost_usd has no upper bound (NaN >= 0 is true: one NaN would switch the wall off)')

  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?\n\$\$;/gi)]
  const names = fns.map(([, name]) => name).sort().join()
  if (names !== 'ai_calls_purge_text,ai_gate,ai_reserve,ai_usage') problems.push(`functions ${names || 'none'} (expected ai_calls_purge_text, ai_gate, ai_reserve, ai_usage)`)
  for (const [body, name, args] of fns) {
    if (!/\nset search_path = ''\n/.test(body)) problems.push(`${name} has no search_path ''`)
    const definer = name === 'ai_calls_purge_text' || name === 'ai_reserve'
    if (/security definer/i.test(body) !== definer || /security invoker/i.test(body) === definer) problems.push(`${name}: ${definer ? 'not SECURITY DEFINER' : 'not SECURITY INVOKER'}`)
    if (/\bexecute\b/i.test(body)) problems.push(`${name} builds SQL at run time`)
    for (const [, rel] of body.matchAll(/\b(?:from|join|update|into)\s+([a-z_][\w."]*)/gi)) {
      if (!/^(public|pg_catalog)\./.test(rel) && !/^(p|v)_[a-z_]+$/.test(rel)) problems.push(`${name} reads or writes ${rel} without its schema`)
    }
    if (name === 'ai_reserve') {
      if (!/pg_advisory_xact_lock\(/.test(body)) problems.push('ai_reserve takes no per-account lock (two calls could both pass)')
      const reads = (body.match(/from public\.ai_calls c\b/g) || []).length
      if (!reads || (body.match(/where c\.user_id = p_user\b/g) || []).length !== reads) problems.push('ai_reserve: a read of ai_calls is not scoped to p_user')
      if (/\bupdate\b|\bdelete\b/i.test(body)) problems.push('ai_reserve changes or deletes rows (it may only add one)')
    } else if (definer) {
      if (args.trim() !== '') problems.push(`${name} takes input`)
      if (!/where s\.user_id = c\.user_id/.test(body)) problems.push(`${name} does not read each row's own account's log_days`)
      if (!/set request = null, response = null, thinking = null\n/.test(body)) problems.push(`${name} changes more, or less, than the three text columns`)
    } else {
      if (!/\nstable\n/.test(body)) problems.push(`${name} is not STABLE`)
      if (!/v_user is null or not public\.is_app_user\(\)/.test(body)) problems.push(`${name} does not refuse a caller who is not an app user`)
      const reads = (body.match(/from public\.ai_calls c\b/g) || []).length
      if (!reads || (body.match(/where c\.user_id = v_user\b/g) || []).length !== reads) problems.push(`${name}: a read of ai_calls is not scoped to the caller`)
    }
  }
  if (!stmts.includes('revoke all on function public.ai_calls_purge_text() from public, anon, authenticated')) problems.push('ai_calls_purge_text is not revoked from public, anon and authenticated')
  const reserveGrants = stmts.filter(s => /^grant .* on function public\.ai_reserve\(/i.test(s))
  if (reserveGrants.length !== 1 || !/ to service_role$/i.test(reserveGrants[0])) problems.push(`ai_reserve is granted as "${reserveGrants.join(' | ')}" (service_role only)`)
  if (!stmts.some(s => /^revoke all on function public\.ai_reserve\(.*\) from public, anon, authenticated$/i.test(s))) problems.push('ai_reserve is not revoked from public, anon and authenticated')
  const purgeGrants = stmts.filter(s => /^grant .* on function public\.ai_calls_purge_text\(/i.test(s))
  if (purgeGrants.join(' | ') !== 'grant execute on function public.ai_calls_purge_text() to service_role') problems.push(`ai_calls_purge_text is granted as "${purgeGrants.join(' | ')}" (service_role only)`)
  for (const sig of ['ai_usage(timestamptz, timestamptz)', 'ai_gate(text)']) {
    if (!stmts.includes(`revoke all on function public.${sig} from public, anon`)) problems.push(`${sig} is not revoked from public and anon`)
    if (!stmts.includes(`grant execute on function public.${sig} to authenticated, service_role`)) problems.push(`${sig} is not granted to authenticated and service_role`)
  }
  if (stmts.some(s => /^grant .* on function .* to .*\banon\b/i.test(s))) problems.push('a function granted to anon')
  if (!/if to_regclass\('cron\.job'\) is null then\s+raise notice [^;]+;\s+return;\s+end if;\s+if exists \(select 1 from cron\.job where jobname = 'lascis-ai-log-purge'\) then\s+perform cron\.unschedule\('lascis-ai-log-purge'\);\s+end if;\s+perform cron\.schedule\('lascis-ai-log-purge', '\d+ \d+ \* \* \*', 'select public\.ai_calls_purge_text\(\)'\);/.test(sql)) {
    problems.push('the daily purge is not scheduled with the guard (no pg_cron: a notice; unschedule first; plain SQL)')
  }
  if (problems.length) fail(`migration 194 has ${problems.join('; ')}`)
}

// Static, every migration from 194 on: nothing opens the ledger to the browser later, the app's generic delete and
// undo functions keep running with the caller's rights (as a definer one would write the ledger for the browser),
// and prices never become a table.
{
  const problems = []
  const DOORS = ['app_delete_rows', 'app_restore_rows', 'app_undo_steps', 'app_undo_transaction']
  let doors = 0
  for (const f of readdirSync(migDir).filter(x => /^\d+_.*\.sql$/.test(x)).sort()) {
    const text = readFileSync(mig(f), 'utf8')
    for (const m of text.matchAll(new RegExp(`create or replace function public\\.(${DOORS.join('|')})\\(([\\s\\S]*?)\\n\\s*as \\$`, 'gi'))) {
      doors++
      if (!/security invoker/i.test(m[0]) || /security definer/i.test(m[0])) problems.push(`${f}: ${m[1]} is not SECURITY INVOKER (it could then write ai_calls for the browser)`)
    }
    if (parseInt(f, 10) < 194) continue
    const sql = noComments(text)
    for (const s of statementsOf(text)) {
      const g = s.match(/^grant (.+?) on (?:table )?(.+?) to (.+)$/i)
      if (g && /\bai_calls\b/.test(g[2]) && /\b(authenticated|anon|public)\b/i.test(g[3]) && g[1].trim().toLowerCase() !== 'select') problems.push(`${f}: "${s}" (the browser only reads the ledger)`)
      if (g && /\bai_calls\b/.test(g[2]) && /\banon\b/i.test(g[3])) problems.push(`${f}: the ledger granted to anon`)
      const every = s.match(/^grant (.+?) on all tables in schema public to (.+)$/i)
      if (every && /\b(authenticated|anon|public)\b/i.test(every[2]) && every[1].trim().toLowerCase() !== 'select') problems.push(`${f}: "${s}" (it would open the ledger too)`)
      if (/^grant .* on function public\.ai_calls_purge_text\(/i.test(s) && !/ to service_role$/i.test(s)) problems.push(`${f}: "${s}" (the purge is the service role's and the timer's)`)
    }
    for (const m of sql.matchAll(/create policy\s+("[^"]+"|\w+)\s+on\s+public\.ai_calls\b([^;]*)/gi)) {
      if (!/^\s*(as (permissive|restrictive)\s+)?for select\b/i.test(m[2])) problems.push(`${f}: policy ${m[1]} on ai_calls is not "for select"`)
    }
    for (const m of sql.matchAll(/create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) {
      if (/pric/i.test(m[1]) && /(^|_)(ai|llm|model|models|claude|anthropic|token|tokens)(_|$)/i.test(m[1])) problems.push(`${f}: table ${m[1]} (AI prices are code, never a table)`)
    }
  }
  if (doors < 8) problems.push(`only ${doors} definitions of the generic delete and undo functions found (the parser saw nothing?)`)
  if (problems.length) fail(problems.join('; '))
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-ai-ledger: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /FAIL|ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 8).join('\n')}`); throw e } }
const runScenarios = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  return passed
}

// Everything 194 makes, as the catalogue holds it, in one sorted text: the same after a second run, or 194 is not
// safe to re-run. Grants are read one privilege at a time (a re-run may list the same grants in another order).
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'policy ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename in ('ai_calls', 'ai_settings', 'ai_job_settings')
  union all
  select 'table ' || c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
    from pg_class c where c.oid in ('public.ai_calls'::regclass, 'public.ai_settings'::regclass, 'public.ai_job_settings'::regclass)
  union all
  select 'grant ' || c.relname || ' ' || a.grantee::regrole || ' ' || a.privilege_type
    from pg_class c, aclexplode(c.relacl) a where c.oid in ('public.ai_calls'::regclass, 'public.ai_settings'::regclass, 'public.ai_job_settings'::regclass)
  union all
  select 'column ' || a.attrelid::regclass || ' ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull
         || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid in ('public.ai_calls'::regclass, 'public.ai_settings'::regclass, 'public.ai_job_settings'::regclass) and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid in ('public.ai_calls'::regclass, 'public.ai_settings'::regclass, 'public.ai_job_settings'::regclass)
  union all
  select 'index ' || indexdef from pg_indexes where schemaname = 'public' and tablename in ('ai_calls', 'ai_settings', 'ai_job_settings')
  union all
  select 'trigger ' || tgrelid::regclass || ' ' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and tgrelid in ('public.ai_calls'::regclass, 'public.ai_settings'::regclass, 'public.ai_job_settings'::regclass)
  union all
  select 'function ' || p.oid::regprocedure || ' definer=' || p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(p.proconfig::text, '') || ' ' || md5(p.prosrc)
         || ' ' || pg_get_function_result(p.oid)
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ai_usage', 'ai_gate', 'ai_reserve', 'ai_calls_purge_text')
  union all
  select 'execute ' || p.oid::regprocedure || ' ' || a.grantee::regrole || ' ' || a.privilege_type
    from pg_proc p, aclexplode(p.proacl) a where p.pronamespace = 'public'::regnamespace and p.proname in ('ai_usage', 'ai_gate', 'ai_reserve', 'ai_calls_purge_text')
  union all
  select 'timer ' || jobname || ' ' || schedule || ' ' || command from cron.job
) t(x)`

// What Supabase gave every new table and function in public before 30.10.2026.
const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t194a_${process.pid}`, before: OLD_DEFAULTS, chain: [], scenarios: 'scenarios.sql' },
  { key: 'now', db: `t194b_${process.pid}`, before: [], chain: [], scenarios: 'scenarios.sql' },
  { key: 'doors', db: `t194d_${process.pid}`, before: [], chain: ['144_delete_with_undo.sql', '150_undo_save.sql', '151_undo_save_fixes.sql'], scenarios: 'doors.sql' },
]

let code = 0
const done = {}
for (const s of suites) {
  psql(url, ['-c', `create database ${s.db}`])
  try {
    const target = withDb(url, s.db)
    step(`${s.key}: base`, () => psql(target, ['-f', join(dir, 'base.sql')]))
    if (s.before.length) step(`${s.key}: old default grants`, () => psql(target, s.before))
    for (const f of s.chain) step(`${s.key}: ${f}`, () => psql(target, ['-f', mig(f)]))
    step(`${s.key}: 194`, () => psql(target, ['-f', mig(FILE)]))
    const first = step(`${s.key}: fingerprint`, () => psql(target, ['-At', '-c', FINGERPRINT]))
    step(`${s.key}: 194 again`, () => psql(target, ['-f', mig(FILE)]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 80) throw Object.assign(new Error('fingerprint'), { stderr: `ERROR: the catalogue fingerprint has only ${first.split('\n').length} lines (it read nothing?)` })
    if (first !== second) {
      const a = new Set(first.split('\n')), b = new Set(second.split('\n'))
      const diff = [...second.split('\n').filter(l => !a.has(l)).map(l => `+ ${l}`), ...first.split('\n').filter(l => !b.has(l)).map(l => `- ${l}`)]
      throw Object.assign(new Error('not idempotent'), { stderr: `ERROR: a second run of 194 changed the database:\n${diff.slice(0, 12).map(l => `DETAIL: ${l}`).join('\n')}` })
    }
    done[s.key] = step(`${s.key}: ${s.scenarios}`, () => runScenarios(target, join(dir, s.scenarios)))
  } catch (e) {
    code = 1
    if (e.stderr) console.error(e.stderr.toString())
  } finally {
    try { psql(url, ['-c', `drop database if exists ${s.db}`]) } catch { /* best effort */ }
  }
  if (code) break
}
if (code) process.exit(code)
console.log(`verify-db-ai-ledger: 194 ran twice on three databases and left each as its first run did; ${done.old} scenarios passed with the old default grants, ${done.now} without them, and ${done.doors} at the app's delete and undo doors`)
