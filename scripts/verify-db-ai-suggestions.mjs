// Runs migration 199's scenarios (AI suggestions: ai_suggestions, ai_suggest_runs, ai_suggestion_add, ai_suggest_patterns and
// the check timer) on a throwaway Postgres. The questions: can the browser change anything about an idea but its state, can it
// write a run or read a batch id, can anyone but the service role call the two functions, does a dismissed idea stay gone,
// and does the counting find the repeats without leaking a value?
// Two databases, each from the AI ledger's base.sql, 194–198, the reports' base.sql (pgcrypto, a Vault, a stand-in for
// net.http_post) and the real 199 applied twice (the second run must leave the catalogue as the first did):
//   · with the grants Supabase gave every new table before 30.10.2026: 199's own revokes must keep the browser out;
//   · without them (production now): 199's own grants must be enough.
// Static checks first. With no database URL it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-ai-suggestions.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const FILE = '199_ai_suggestions.sql'
const fail = msg => { console.error(`verify-db-ai-suggestions: ${msg}`); process.exit(1) }
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
  if (tables.join() !== 'ai_suggestions,ai_suggest_runs') problems.push(`creates ${tables.join(', ') || 'no table'} (expected ai_suggestions, ai_suggest_runs)`)
  for (const t of tables) {
    if (!new RegExp(`create table if not exists public\\.${t} \\([\\s\\S]*?\\n\\);\\s*alter table public\\.${t} enable row level security;`, 'i').test(sql)) problems.push(`no row level security right after ${t}`)
    if (!new RegExp(`select public\\.owner_lock_apply\\('public\\.${t}'\\);`, 'i').test(sql)) problems.push(`no owner_lock_apply on ${t}`)
    if (!stmts.includes(`revoke all on public.${t} from anon, authenticated`)) problems.push(`no revoke on ${t}`)
    if (!stmts.includes(`grant select, insert, update, delete on public.${t} to service_role`)) problems.push(`no service-role grant on ${t}`)
    if (stmts.some(s => new RegExp(`^grant .* on (table )?public\\.${t} to .*\\banon\\b`, 'i').test(s))) problems.push(`a grant on ${t} to anon`)
    if (!new RegExp(`user_id\\s+uuid not null references auth\\.users\\(id\\) on delete cascade,`, 'i').test(sql)) problems.push('user_id is not "uuid not null references auth.users(id) on delete cascade" without a default')
  }
  const toApp = stmts.filter(s => /^grant .* on (table )?public\.ai_suggestions to .*\bauthenticated\b/i.test(s)).sort()
  if (toApp.join('|') !== 'grant select on public.ai_suggestions to authenticated|grant update (state) on public.ai_suggestions to authenticated') problems.push(`the browser's grants on ai_suggestions are "${toApp.join(' | ')}" (expected select, and update of state only)`)
  const runGrants = stmts.filter(s => /^grant .* on (table )?public\.ai_suggest_runs to .*\bauthenticated\b/i.test(s))
  if (runGrants.length !== 1 || !/^grant select \(([a-z_, ]+)\) on public\.ai_suggest_runs to authenticated$/i.test(runGrants[0])) problems.push('the browser\'s grant on ai_suggest_runs is not one column-list select')
  else {
    const cols = runGrants[0].match(/\(([^)]+)\)/)[1].split(',').map(c => c.trim())
    for (const secret of ['batch_id', 'claimed_at']) if (cols.includes(secret)) problems.push(`the browser may read ${secret}`)
  }
  const polOf = t => [...sql.matchAll(new RegExp(`create policy "[^"]+" on public\\.${t}\\s+for (\\w+) to authenticated`, 'gi'))].map(m => m[1].toLowerCase()).join()
  if (polOf('ai_suggestions') !== 'select,update') problems.push(`ai_suggestions policies: ${polOf('ai_suggestions')} (expected select, update)`)
  if (polOf('ai_suggest_runs') !== 'select') problems.push(`ai_suggest_runs policies: ${polOf('ai_suggest_runs')} (expected select)`)
  if (!/create trigger trg_ai_suggestions_guard before update on public\.ai_suggestions/i.test(sql)) problems.push('no guard trigger refusing a change to any column but state')
  if (/create trigger trg_audit/i.test(sql)) problems.push('an audit trigger (a state change would be offered to Activity\'s Undo, which does not know state_changed_at: the toggle has its own Bring back)')
  if (!/drop trigger if exists trg_audit on public\.ai_suggestions;/i.test(sql)) problems.push('no drop of a trg_audit left by an earlier run')
  if (!/constraint ai_suggestions_one_per_idea unique \(user_id, dedupe_key\)/i.test(sql)) problems.push('no unique (user_id, dedupe_key)')
  if (!/dedupe_key\s+text not null check \(dedupe_key ~ '\^\[0-9a-f\]\{64\}\$'\)/i.test(sql)) problems.push('dedupe_key is not held to a 64-character hash')
  for (const col of ['title, 3, 120', 'why, 3, 400', 'benefit, 3, 160']) {
    if (!sql.includes(`check (public.ai_suggestion_plain(${col}))`)) problems.push(`${col.split(',')[0]} is not held to plain text by ai_suggestion_plain`)
  }
  const plainFn = /create or replace function public\.ai_suggestion_plain[\s\S]*?\$\$;/i.exec(sql)?.[0] ?? ''
  if (!plainFn.includes("'[][<>`[:cntrl:]]'")) problems.push('ai_suggestion_plain does not refuse angle brackets, square brackets, backticks and control characters')
  if (!/chr\(8203\)[\s\S]*chr\(8207\)[\s\S]*chr\(8234\)[\s\S]*chr\(8238\)[\s\S]*chr\(8294\)[\s\S]*chr\(8297\)[\s\S]*chr\(65279\)/.test(plainFn)) problems.push('ai_suggestion_plain does not refuse zero-width and text-direction characters')
  if (!/\(https\?:\|www\\\.\|\/\/\)/.test(plainFn) || !/\\m\[a-z0-9-\]\+/.test(plainFn)) problems.push('ai_suggestion_plain does not refuse a link (a scheme, www, // or any name.tld)')
  if (!/complexity\s+text not null check \(complexity in \('small', 'medium', 'large'\)\)/.test(sql)) problems.push('complexity is not held to small, medium, large')
  if (!/pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/.test(sql)) problems.push('ai_suggestion_add takes no lock per account')
  if (!/created_at > now\(\) - interval '27 hours'/.test(sql)) problems.push('the timer\'s suggestion test has no age limit')
  if (/security definer/i.test(sql)) problems.push('a SECURITY DEFINER function (the two functions are SECURITY INVOKER, service role only)')
  for (const f of ['ai_suggestion_add(uuid, text, text, text, text, text, text, text, integer, integer, numeric, uuid)', 'ai_suggest_patterns(uuid, integer, integer)']) {
    if (!stmts.includes(`revoke all on function public.${f} from public, anon, authenticated`)) problems.push(`no revoke on ${f}`)
    if (!stmts.includes(`grant execute on function public.${f} to service_role`)) problems.push(`no service-role execute on ${f}`)
  }
  if (!/ai_suggest_patterns[\s\S]*?set search_path = ''/.test(sql) || !/ai_suggestion_add[\s\S]*?set search_path = ''/.test(sql)) problems.push('a function without search_path = \'\'')
  if (/\bnet\.http_|vault\./i.test(sql.replace(/\$cron\$[\s\S]*?\$cron\$/g, ''))) problems.push('a call outside the database or a secret outside the timer')
  const timers = [...sql.matchAll(/cron\.schedule\('([a-z-]+)', '([^']+)', \$cron\$([\s\S]*?)\$cron\$\)/g)]
  if (timers.map(t => t[1]).join() !== 'lascis-ai-report-check') problems.push(`timers ${timers.map(t => t[1]).join() || 'none'}`)
  for (const [, name, , body] of timers) {
    if (!/from vault\.decrypted_secrets where name = 'PUSH_CRON_SECRET'/.test(body)) problems.push(`${name} does not read PUSH_CRON_SECRET from Vault inside the job`)
    if (!/extensions\.hmac\('claude-schedule-v1', decrypted_secret, 'sha256'\)/.test(body)) problems.push(`${name} does not derive its credential with hmac`)
    if (/'x-cron-secret'/.test(body)) problems.push(`${name} sends the shared secret itself`)
    if (!/ai_suggest_runs/.test(body) || !/public\.ai_reports r where r\.status = 'queued'/.test(body)) problems.push(`${name} does not wait for both kinds of batch`)
  }
  if (!/if exists \(select 1 from cron\.job where jobname = 'lascis-ai-report-check'\) then\s+perform cron\.unschedule\('lascis-ai-report-check'\);\s+end if;\s+perform cron\.schedule\('lascis-ai-report-check'/.test(sql)) problems.push('the timer is not unscheduled before it is scheduled')
  if (!/if to_regclass\('cron\.job'\) is null then\s+raise notice [^;]+;\s+return;\s+end if;/.test(sql)) problems.push('the timer has no guard for a database without pg_cron')
  if (problems.length) fail(`migration 199 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-ai-suggestions: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
// Roles belong to the whole server and other checks alter them at the same time: a role step is tried again.
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
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/ai-suggestions/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => !/NOTICE:  ok/.test(l)).slice(0, 12).join('\n') })
  return passed
}

// Everything 199 makes, as the catalogue holds it, in one sorted text: the same after a second run, or 199 is not safe to re-run.
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'policy ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename in ('ai_suggestions', 'ai_suggest_runs')
  union all
  select 'table ' || c.relname || ' rls=' || c.relrowsecurity from pg_class c where c.oid in ('public.ai_suggestions'::regclass, 'public.ai_suggest_runs'::regclass)
  union all
  select 'grant ' || c.relname || ' ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.oid in ('public.ai_suggestions'::regclass, 'public.ai_suggest_runs'::regclass)
  union all
  select 'colgrant ' || c.relname || ' ' || at.attname || ' ' || a.grantee::regrole || ' ' || a.privilege_type
    from pg_class c join pg_attribute at on at.attrelid = c.oid, aclexplode(at.attacl) a
   where c.oid in ('public.ai_suggestions'::regclass, 'public.ai_suggest_runs'::regclass) and at.attacl is not null
  union all
  select 'column ' || c.relname || ' ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_class c join pg_attribute a on a.attrelid = c.oid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where c.oid in ('public.ai_suggestions'::regclass, 'public.ai_suggest_runs'::regclass) and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.ai_suggestions'::regclass, 'public.ai_suggest_runs'::regclass)
  union all
  select 'index ' || indexdef from pg_indexes where schemaname = 'public' and tablename in ('ai_suggestions', 'ai_suggest_runs')
  union all
  select 'trigger ' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.ai_suggestions'::regclass and not tgisinternal
  union all
  select 'function ' || p.oid::regprocedure || ' ' || p.prosecdef || ' ' || coalesce(p.proconfig::text, '') || ' ' || coalesce(p.proacl::text, '')
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ai_suggestion_add', 'ai_suggest_patterns', 'ai_suggestions_guard', 'ai_suggestion_plain')
  union all
  select 'timer ' || jobname || ' ' || schedule || ' ' || command from cron.job where jobname = 'lascis-ai-report-check'
) t(x)`

const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t199a_${process.pid}`, before: OLD_DEFAULTS },
  { key: 'now', db: `t199b_${process.pid}`, before: [] },
]
const BEFORE = ['194_ai_ledger.sql', '195_ai_controls.sql', '196_ai_reports.sql', '197_ai_chat.sql', '198_ai_chat_controls.sql']
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
    step(`${s.key}: 199 again`, () => psql(target, ['-f', mig(FILE)]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 30) throw Object.assign(new Error('fingerprint'), { stderr: `ERROR: the catalogue fingerprint has only ${first.split('\n').length} lines (it read nothing?)` })
    if (first !== second) {
      const a = new Set(first.split('\n')), b = new Set(second.split('\n'))
      const diff = [...second.split('\n').filter(l => !a.has(l)).map(l => `+ ${l}`), ...first.split('\n').filter(l => !b.has(l)).map(l => `- ${l}`)]
      throw Object.assign(new Error('not idempotent'), { stderr: `ERROR: a second run of 199 changed the database:\n${diff.slice(0, 12).map(l => `DETAIL: ${l}`).join('\n')}` })
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
console.log(`verify-db-ai-suggestions: 199 ran twice on two databases and left each as its first run did; ${done.old} scenarios passed with the old default grants and ${done.now} without them`)
