// Runs migration 204's scenarios (the AI keeps learning: ai_learn_answers, ai_corrections, ai_rules, ai_cases, ai_lessons,
// ai_job_learning, ai_eval_runs, ai_source_stats, their functions and timers) on a throwaway Postgres. The questions: can the
// browser change anything but a state, read a server-only column, or call a server function; can the function turn on a
// rule or an instruction-like lesson; does one lesson keep one active version, do the rollback, the quarantine, the case
// search, the source counts, the dismissed-suggestion note and the purge do what they say?
// Two databases, each from the AI ledger's base.sql, the reports' base.sql, 194–199 and the real 204 applied twice (the
// second run must leave the catalogue as the first did):
//   · with the grants Supabase gave every new table before 30.10.2026: 204's own revokes must keep the browser out;
//   · without them (production now): 204's own grants must be enough.
// Static checks first. With no database URL it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-ai-learning.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const FILE = '204_ai_learning.sql'
const TABLES = ['ai_learn_answers', 'ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_job_learning', 'ai_eval_runs', 'ai_source_stats']
const STATE_TABLES = ['ai_corrections', 'ai_rules', 'ai_cases', 'ai_lessons', 'ai_source_stats']
const fail = msg => { console.error(`verify-db-ai-learning: ${msg}`); process.exit(1) }
const noComments = text => text.replace(/--.*$/gm, '')
const statementsOf = text => noComments(text).split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)

// Static.
{
  const sql = noComments(readFileSync(mig(FILE), 'utf8'))
  const stmts = statementsOf(readFileSync(mig(FILE), 'utf8'))
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== TABLES.join()) problems.push(`creates ${tables.join(', ')} (expected ${TABLES.join(', ')})`)
  for (const t of TABLES) {
    if (!new RegExp(`create table if not exists public\\.${t} \\([\\s\\S]*?\\n\\);\\s*alter table public\\.${t} enable row level security;`, 'i').test(sql)) problems.push(`no row level security right after ${t}`)
    if (!new RegExp(`select public\\.owner_lock_apply\\('public\\.${t}'\\);`, 'i').test(sql)) problems.push(`no owner_lock_apply on ${t}`)
    if (!stmts.includes(`revoke all on public.${t} from anon, authenticated`)) problems.push(`no revoke on ${t}`)
    if (!stmts.includes(`grant select, insert, update, delete on public.${t} to service_role`)) problems.push(`no service-role grant on ${t}`)
    if (stmts.some(s => new RegExp(`^grant .* on (table )?public\\.${t} to .*\\banon\\b`, 'i').test(s))) problems.push(`a grant on ${t} to anon`)
  }
  for (const t of STATE_TABLES) {
    const g = stmts.filter(s => new RegExp(`^grant update .* on public\\.${t} to authenticated$`, 'i').test(s))
    if (g.join() !== `grant update (state) on public.${t} to authenticated`) problems.push(`the browser's update grant on ${t} is "${g.join()}" (expected update of state only)`)
  }
  if (stmts.some(s => /^grant (insert|delete|update(?! \(state\)))/i.test(s) && /to authenticated$/i.test(s))) problems.push('a browser grant to insert, delete or update more than the state')
  if (!stmts.some(s => /^grant select \((?!.*\binput\b)[a-z_, ]+\) on public\.ai_cases to authenticated$/i.test(s))) problems.push('the browser reads the cases\' kept input (expected a column list without it)')
  if (!stmts.some(s => /^grant select \((?!.*\b(batch_id|plan|claimed_at)\b)[a-z_, ]+\) on public\.ai_eval_runs to authenticated$/i.test(s))) problems.push('the browser reads a server-only column of ai_eval_runs')
  if (/grant .* on public\.ai_learn_answers to authenticated/i.test(sql)) problems.push('the browser is granted the AI\'s own values')
  if (!/input_trust\s+text not null check \(input_trust in \('owner_typed', 'owner_confirmed'\)\)/.test(sql)) problems.push('an answer\'s input may be outside text')
  if (!/source_kind\s+text not null check \(source_kind in \('owner_typed', 'owner_confirmed'\)\)/.test(sql)) problems.push('a case may be made from text the owner did not type or confirm')
  if (!/text\s+text not null check \(public\.ai_suggestion_plain\(text, 3, 300\)\)/.test(sql)) problems.push('a lesson is not held to plain text')
  if (!/value\s+text not null check \(public\.ai_suggestion_plain\(value, 1, 200\)\)/.test(sql)) problems.push('a rule value is not held to plain text')
  if (!/only the owner turns a rule on/.test(sql) || !/only the owner turns this lesson on/.test(sql)) problems.push('no wall that keeps the function from turning on a rule or a lesson that needs the owner')
  if (!/create trigger trg_ai_learn_guard before insert or update on public\.%I/.test(sql)) problems.push('the guard trigger is not on insert and update')
  if (/create trigger trg_audit/i.test(sql)) problems.push('an audit trigger (every change is a state toggle with its own Undo)')
  const definers = [...sql.matchAll(/create or replace function public\.(\w+)\([^)]*\)[^$]*?security definer[^$]*?as \$\$/gi)].map(m => m[1])
  if (definers.join() !== 'ai_suggestion_dismissed_note') problems.push(`SECURITY DEFINER functions: ${definers.join(', ') || 'none'} (only the dismissed-suggestion trigger may be)`)
  if (!/ai_suggestion_dismissed_note\(\) returns trigger\s+language plpgsql security definer set search_path = ''/.test(sql)) problems.push('the dismissed-suggestion trigger has no empty search_path')
  if (!/exists \(select 1 from auth\.users u where u\.id = new\.user_id\)/.test(sql)) problems.push('the dismissed-suggestion trigger does not skip an account that no longer exists')
  for (const f of ['ai_case_candidates(uuid, text, text, integer)', 'ai_source_note(uuid, text, text, boolean, text)', 'ai_learn_purge()']) {
    if (!stmts.includes(`revoke all on function public.${f} from public, anon, authenticated`)) problems.push(`no revoke on ${f}`)
    if (!stmts.includes(`grant execute on function public.${f} to service_role`)) problems.push(`no service-role execute on ${f}`)
  }
  for (const f of ['ai_learn_quarantine(text, timestamptz)', 'ai_lesson_rollback(uuid)']) {
    if (!stmts.includes(`revoke all on function public.${f} from public, anon`)) problems.push(`no revoke on ${f}`)
    if (!stmts.includes(`grant execute on function public.${f} to authenticated`)) problems.push(`no execute for the owner on ${f}`)
  }
  if ((sql.match(/set search_path = ''/g) ?? []).length < 7) problems.push('a function without search_path = \'\'')
  if (/\bnet\.http_|vault\./i.test(sql.replace(/\$cron\$[\s\S]*?\$cron\$/g, ''))) problems.push('a call outside the database or a secret outside the timer')
  const timers = [...sql.matchAll(/cron\.schedule\('([a-z-]+)'/g)].map(t => t[1])
  if (timers.join() !== 'lascis-ai-learn-purge,lascis-ai-report-check') problems.push(`timers ${timers.join()}`)
  if (!/from vault\.decrypted_secrets where name = 'PUSH_CRON_SECRET'/.test(sql) || !/extensions\.hmac\('claude-schedule-v1', decrypted_secret, 'sha256'\)/.test(sql)) problems.push('the check timer does not derive its credential from Vault')
  if (!/ai_eval_runs r where r\.status = 'queued' and r\.created_at > now\(\) - interval '27 hours'/.test(sql)) problems.push('the check timer does not wait for a self-test (with an age limit)')
  if (!/if to_regclass\('cron\.job'\) is null then\s+raise notice [^;]+;\s+return;\s+end if;/.test(sql)) problems.push('the timers have no guard for a database without pg_cron')
  if (problems.length) fail(`migration 204 has ${problems.join('; ')}`)
}

// Migration 203 (the Shop receipt branch) makes the same source memory (ai_source_stats, ai_source_note) as 204's section 8,
// with `if not exists` and the same definitions, so the order the two run in must not matter. Its section is kept as a copy
// (scripts/db-tests/ai-learning/source-memory-203.sql) until 203 is on this branch; from then the real file is read and the
// copy must equal it.
const SECTION_START = '-- ─── 2. Source memory'
const SECTION_END = "select public.owner_lock_apply('public.ai_source_stats');"
const FIXTURE = join(root, 'scripts/db-tests/ai-learning/source-memory-203.sql')
const real203 = readdirSync(join(root, 'supabase/migrations')).find(f => /^203_.*\.sql$/.test(f))
const sectionOf = text => { const a = text.indexOf(SECTION_START), b = text.indexOf(SECTION_END); return a >= 0 && b > a ? text.slice(a, b + SECTION_END.length) : null }
{
  const copy = sectionOf(readFileSync(FIXTURE, 'utf8'))
  if (!copy) fail('the copy of 203\'s source memory has lost its markers')
  if (real203) {
    const live = sectionOf(readFileSync(mig(real203), 'utf8'))
    if (live === null) fail(`${real203} no longer holds its source-memory section between the markers: check the order test`)
    else if (live !== copy) fail(`the copy of 203's source memory differs from ${real203}: update scripts/db-tests/ai-learning/source-memory-203.sql`)
  }
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-ai-learning: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const psqlRetry = (u, args) => {
  for (let i = 0; ; i++) {
    try { return psql(u, args) } catch (e) {
      if (i >= 8 || !/concurrently updated|deadlock detected/.test(String(e.stderr))) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 + 150 * i)
    }
  }
}
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /FAIL|ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 8).join('\n')}`); throw e } }
const runScenarios = target => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-o', '/dev/null', '-f', join(root, 'scripts/db-tests/ai-learning/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => !/NOTICE:  ok/.test(l)).slice(0, 12).join('\n') })
  return passed
}

const list = TABLES.map(t => `'${t}'`).join(', ')
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'policy ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename in (${list})
  union all
  select 'table ' || c.relname || ' rls=' || c.relrowsecurity from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (${list})
  union all
  select 'grant ' || c.relname || ' ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relname in (${list})
  union all
  select 'colgrant ' || c.relname || ' ' || at.attname || ' ' || a.grantee::regrole || ' ' || a.privilege_type
    from pg_class c join pg_attribute at on at.attrelid = c.oid, aclexplode(at.attacl) a where c.relnamespace = 'public'::regnamespace and c.relname in (${list}) and at.attacl is not null
  union all
  select 'column ' || c.relname || ' ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_class c join pg_attribute a on a.attrelid = c.oid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where c.relnamespace = 'public'::regnamespace and c.relname in (${list}) and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname in (${list}, 'ai_suggestions'))
  union all
  select 'index ' || indexdef from pg_indexes where schemaname = 'public' and tablename in (${list})
  union all
  select 'trigger ' || pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and c.relname in (${list}, 'ai_suggestions') and not t.tgisinternal
  union all
  select 'function ' || p.oid::regprocedure || ' ' || p.prosecdef || ' ' || coalesce(p.proconfig::text, '') || ' ' || coalesce(p.proacl::text, '')
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ai_learn_guard', 'ai_lessons_one_active', 'ai_case_candidates', 'ai_source_note', 'ai_learn_quarantine', 'ai_lesson_rollback', 'ai_suggestion_dismissed_note', 'ai_learn_purge')
  union all
  select 'timer ' || jobname || ' ' || schedule || ' ' || command from cron.job where jobname in ('lascis-ai-report-check', 'lascis-ai-learn-purge')
) t(x)`

const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t204a_${process.pid}`, before: OLD_DEFAULTS },
  { key: 'now', db: `t204b_${process.pid}`, before: [] },
]
const BEFORE = ['194_ai_ledger.sql', '195_ai_controls.sql', '196_ai_reports.sql', '197_ai_chat.sql', '198_ai_chat_controls.sql', '199_ai_suggestions.sql']
let code = 0
const done = {}
for (const s of suites) {
  psql(url, ['-c', `create database ${s.db}`])
  try {
    const target = withDb(url, s.db)
    step(`${s.key}: ledger base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-ledger/base.sql')]))
    step(`${s.key}: base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-reports/base.sql')]))
    if (s.before.length) step(`${s.key}: old default grants`, () => psql(target, s.before))
    for (const f of [...BEFORE, FILE]) step(`${s.key}: ${f}`, () => psql(target, ['-f', mig(f)]))
    const first = step(`${s.key}: fingerprint`, () => psql(target, ['-At', '-c', FINGERPRINT]))
    step(`${s.key}: 204 again`, () => psql(target, ['-f', mig(FILE)]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 80) throw Object.assign(new Error('fingerprint'), { stderr: `ERROR: the catalogue fingerprint has only ${first.split('\n').length} lines (it read nothing?)` })
    if (first !== second) {
      const a = new Set(first.split('\n')), b = new Set(second.split('\n'))
      const diff = [...second.split('\n').filter(l => !a.has(l)).map(l => `+ ${l}`), ...first.split('\n').filter(l => !b.has(l)).map(l => `- ${l}`)]
      throw Object.assign(new Error('not idempotent'), { stderr: `ERROR: a second run of 204 changed the database:\n${diff.slice(0, 12).map(l => `DETAIL: ${l}`).join('\n')}` })
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

// 203 then 204, and 204 then 203: the same source memory either way, and the scenarios pass on both.
const SOURCE_FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'column ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.ai_source_stats'::regclass and a.attnum > 0 and not a.attisdropped
  union all select 'constraint ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.ai_source_stats'::regclass
  union all select 'policy ' || policyname || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') from pg_policies where schemaname = 'public' and tablename = 'ai_source_stats'
  union all select 'grant ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.ai_source_stats'::regclass
  union all select 'colgrant ' || at.attname || ' ' || a.grantee::regrole || ' ' || a.privilege_type from pg_attribute at, aclexplode(at.attacl) a where at.attrelid = 'public.ai_source_stats'::regclass and at.attacl is not null
  union all select 'trigger ' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.ai_source_stats'::regclass and not tgisinternal
  union all select 'function ' || p.oid::regprocedure || ' ' || p.prosecdef || ' ' || coalesce(p.proconfig::text, '') || ' ' || coalesce(p.proacl::text, '') || ' ' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ai_source_note', 'ai_source_stats_state')
) t(x)`
const orders = [
  { key: '203 then 204', db: `t204c_${process.pid}`, files: [FIXTURE, mig(FILE)] },
  { key: '204 then 203', db: `t204d_${process.pid}`, files: [mig(FILE), FIXTURE] },
]
const prints = {}
for (const o of orders) {
  psql(url, ['-c', `create database ${o.db}`])
  try {
    const target = withDb(url, o.db)
    step(`${o.key}: ledger base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-ledger/base.sql')]))
    step(`${o.key}: base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-reports/base.sql')]))
    for (const f of BEFORE) step(`${o.key}: ${f}`, () => psql(target, ['-f', mig(f)]))
    for (const f of o.files) step(`${o.key}: ${f.split('/').pop()}`, () => psql(target, ['-f', f]))
    prints[o.key] = psql(target, ['-At', '-c', SOURCE_FINGERPRINT])
    done[o.key] = step(`${o.key}: scenarios`, () => runScenarios(target))
  } catch (e) {
    code = 1
    if (e.stderr) console.error(e.stderr.toString())
  } finally {
    try { psql(url, ['-c', `drop database if exists ${o.db}`]) } catch { /* best effort */ }
  }
  if (code) process.exit(code)
}
if (prints['203 then 204'] !== prints['204 then 203'] || prints['203 then 204'].split('\n').length < 20) {
  const a = new Set(prints['203 then 204'].split('\n')), b = new Set(prints['204 then 203'].split('\n'))
  const diff = [...prints['204 then 203'].split('\n').filter(l => !a.has(l)).map(l => `+ ${l}`), ...prints['203 then 204'].split('\n').filter(l => !b.has(l)).map(l => `- ${l}`)]
  console.error(`verify-db-ai-learning: 203 and 204 leave a different source memory depending on their order:\n${diff.slice(0, 12).join('\n')}`)
  process.exit(1)
}
console.log(`verify-db-ai-learning: 203 (${real203 ? 'the real file' : 'its copy'}) and 204 leave the same source memory in either order; ${done['203 then 204']} and ${done['204 then 203']} scenarios passed`)
console.log(`verify-db-ai-learning: 204 ran twice on two databases and left each as its first run did; ${done.old} scenarios passed with the old default grants and ${done.now} without them`)
