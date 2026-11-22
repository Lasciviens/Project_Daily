// Runs migration 196's scenarios (the weekly reports: ai_reports and the two pg_cron timers) on a throwaway Postgres.
// ai_reports holds a link to an outside service (Anthropic's batch id) that the claude function reads back and acts on,
// so the question everywhere is: can anyone but the service role write it, or even read it? And do the timers send
// the credential the function checks, and stay quiet when nothing is queued?
// Two databases, each from the AI ledger's base.sql, 194 and 195, this folder's base.sql (pgcrypto, a Vault, a stand-in
// for net.http_post) and the real 196 applied twice (the second run must leave the catalogue as the first did):
//   · with the grants Supabase gave every new table before 30.10.2026: 196's own revokes must keep the browser out;
//   · without them (production now): 196's own grants must be enough.
// Static checks first. With no database URL (a laptop without Postgres) it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-ai-reports.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { createHmac } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const FILE = '196_ai_reports.sql'
const fail = msg => { console.error(`verify-db-ai-reports: ${msg}`); process.exit(1) }
const noComments = text => text.replace(/--.*$/gm, '')
const statementsOf = text => noComments(text).split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)

// Static.
{
  const src = readFileSync(mig(FILE), 'utf8')
  const sql = noComments(src)
  const stmts = statementsOf(src)
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== 'ai_reports') problems.push(`creates ${tables.join(', ') || 'no table'} (expected ai_reports)`)
  if (!/create table if not exists public\.ai_reports \([\s\S]*?\n\);\s*alter table public\.ai_reports enable row level security;/i.test(sql)) problems.push('no row level security right after the table')
  if (!/select public\.owner_lock_apply\('public\.ai_reports'\);/i.test(sql)) problems.push('no owner_lock_apply')
  if (!stmts.includes('revoke all on public.ai_reports from anon, authenticated')) problems.push('no "revoke all … from anon, authenticated" before the grants')
  if (!stmts.includes('grant select, insert, update, delete on public.ai_reports to service_role')) problems.push('no service-role grant')
  const toApp = stmts.filter(s => /^grant .* on (table )?public\.ai_reports to .*\bauthenticated\b/i.test(s))
  if (toApp.length !== 1 || !/^grant select \(([a-z_, ]+)\) on public\.ai_reports to authenticated$/i.test(toApp[0])) problems.push(`the browser's grant is "${toApp.join(' | ')}" (expected one column-list select)`)
  else {
    const cols = toApp[0].match(/\(([^)]+)\)/)[1].split(',').map(c => c.trim())
    for (const secret of ['batch_id', 'claimed_at', 'push_due']) if (cols.includes(secret)) problems.push(`the browser may read ${secret} (a link to an outside service, and the check's own bookkeeping)`)
    for (const need of ['id', 'user_id', 'week_start', 'status', 'content', 'facts', 'call_id']) if (!cols.includes(need)) problems.push(`the browser cannot read ${need}`)
  }
  if (stmts.some(s => /^grant .* on (table )?public\.ai_reports to .*\banon\b/i.test(s))) problems.push('a grant to anon')
  const cmds = [...sql.matchAll(/create policy "[^"]+" on public\.ai_reports\s+for (\w+) to authenticated/gi)].map(m => m[1].toLowerCase()).join()
  if (cmds !== 'select') problems.push(`policies for ${cmds || 'nothing'} (expected select only)`)
  if ((sql.match(/create policy "[^"]+" on public\.ai_reports\b/gi) || []).length !== 1) problems.push('a policy the check above does not read')
  if (/create trigger/i.test(sql)) problems.push('a trigger (a server-written log: no audit)')
  if (!/user_id\s+uuid not null references auth\.users\(id\) on delete cascade,/i.test(sql)) problems.push('user_id is not "uuid not null references auth.users(id) on delete cascade" without a default')
  if (!/constraint ai_reports_week_maker unique \(user_id, week_start, made_by\)/i.test(sql)) problems.push('no unique (user_id, week_start, made_by)')
  if (!/check \(extract\(isodow from week_start\) = 1\)/i.test(sql)) problems.push('week_start is not held to a Monday')
  if (!/batch_id\s+text check \(batch_id is null or batch_id ~ '\^\[A-Za-z0-9_-\]\{1,100\}\$'\)/i.test(sql)) problems.push('batch_id has no CHECK on its characters')
  if (/\bnet\.http_|vault\./i.test(sql.replace(/\$cron\$[\s\S]*?\$cron\$/g, ''))) problems.push('a call outside the database or a secret outside the timers')
  const timers = [...sql.matchAll(/cron\.schedule\('([a-z-]+)', '([^']+)', \$cron\$([\s\S]*?)\$cron\$\)/g)]
  if (timers.map(t => t[1]).join() !== 'lascis-ai-report-make,lascis-ai-report-check') problems.push(`timers ${timers.map(t => t[1]).join() || 'none'}`)
  for (const [, name, , body] of timers) {
    if (!/from vault\.decrypted_secrets where name = 'PUSH_CRON_SECRET'/.test(body)) problems.push(`${name} does not read PUSH_CRON_SECRET from Vault inside the job`)
    if (!/extensions\.hmac\('claude-schedule-v1', decrypted_secret, 'sha256'\)/.test(body)) problems.push(`${name} does not derive its credential with hmac and the label claude-schedule-v1`)
    if (/'x-cron-secret'/.test(body)) problems.push(`${name} sends the shared secret itself`)
  }
  for (const name of ['lascis-ai-report-make', 'lascis-ai-report-check']) {
    if (!new RegExp(`if exists \\(select 1 from cron\\.job where jobname = '${name}'\\) then\\s+perform cron\\.unschedule\\('${name}'\\);\\s+end if;\\s+perform cron\\.schedule\\('${name}'`).test(sql)) problems.push(`${name} is not unscheduled before it is scheduled`)
  }
  if (!/if to_regclass\('cron\.job'\) is null then\s+raise notice [^;]+;\s+return;\s+end if;/.test(sql)) problems.push('the timers have no guard for a database without pg_cron')
  if (problems.length) fail(`migration 196 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-ai-reports: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
// Roles belong to the whole server, and other database checks create and alter the same ones at the same time (the
// run-all job starts several at once): Postgres then answers "tuple concurrently updated". A role step is simply tried again.
const psqlRetry = (u, args) => {
  for (let i = 0; ; i++) {
    try { return psql(u, args) } catch (e) {
      if (i >= 8 || !/concurrently updated|deadlock detected/.test(String(e.stderr))) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 + 150 * i)
    }
  }
}
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /FAIL|ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 8).join('\n')}`); throw e } }
// What the timers must send: computed here, outside the database, from the same secret the scenarios put in Vault.
const expectedKey = createHmac('sha256', 'test-push-secret').update('claude-schedule-v1').digest('hex')
const runScenarios = target => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-v', `expected_key=${expectedKey}`, '-q', '-f', join(root, 'scripts/db-tests/ai-reports/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => !/NOTICE:  ok/.test(l)).slice(0, 12).join('\n') })
  return passed
}

// Everything 196 makes, as the catalogue holds it, in one sorted text: the same after a second run, or 196 is not safe to re-run.
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'policy ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename = 'ai_reports'
  union all
  select 'table rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity from pg_class c where c.oid = 'public.ai_reports'::regclass
  union all
  select 'grant ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.ai_reports'::regclass
  union all
  select 'colgrant ' || at.attname || ' ' || a.grantee::regrole || ' ' || a.privilege_type
    from pg_attribute at, aclexplode(at.attacl) a where at.attrelid = 'public.ai_reports'::regclass and at.attacl is not null
  union all
  select 'column ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.ai_reports'::regclass and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.ai_reports'::regclass
  union all
  select 'index ' || indexdef from pg_indexes where schemaname = 'public' and tablename = 'ai_reports'
  union all
  select 'timer ' || jobname || ' ' || schedule || ' ' || command from cron.job where jobname like 'lascis-ai-report-%'
) t(x)`

const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t196a_${process.pid}`, before: OLD_DEFAULTS },
  { key: 'now', db: `t196b_${process.pid}`, before: [] },
]
let code = 0
const done = {}
for (const s of suites) {
  psql(url, ['-c', `create database ${s.db}`])
  try {
    const target = withDb(url, s.db)
    step(`${s.key}: ledger base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-ledger/base.sql')]))
    step(`${s.key}: base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-reports/base.sql')]))
    if (s.before.length) step(`${s.key}: old default grants`, () => psql(target, s.before))
    for (const f of ['194_ai_ledger.sql', '195_ai_controls.sql', FILE]) step(`${s.key}: ${f}`, () => psql(target, ['-f', mig(f)]))
    const first = step(`${s.key}: fingerprint`, () => psql(target, ['-At', '-c', FINGERPRINT]))
    step(`${s.key}: 196 again`, () => psql(target, ['-f', mig(FILE)]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 30) throw Object.assign(new Error('fingerprint'), { stderr: `ERROR: the catalogue fingerprint has only ${first.split('\n').length} lines (it read nothing?)` })
    if (first !== second) {
      const a = new Set(first.split('\n')), b = new Set(second.split('\n'))
      const diff = [...second.split('\n').filter(l => !a.has(l)).map(l => `+ ${l}`), ...first.split('\n').filter(l => !b.has(l)).map(l => `- ${l}`)]
      throw Object.assign(new Error('not idempotent'), { stderr: `ERROR: a second run of 196 changed the database:\n${diff.slice(0, 12).map(l => `DETAIL: ${l}`).join('\n')}` })
    }
    done[s.key] = step(`${s.key}: scenarios`, () => runScenarios(target))
  } catch (e) {
    code = 1
    if (e.stderr) console.error(e.stderr.toString())
  } finally {
    try { psql(url, ['-c', `drop database if exists ${s.db}`]) } catch { /* best effort */ }
  }
  if (code) break
}
if (code) process.exit(code)
console.log(`verify-db-ai-reports: 196 ran twice on two databases and left each as its first run did; ${done.old} scenarios passed with the old default grants and ${done.now} without them`)
