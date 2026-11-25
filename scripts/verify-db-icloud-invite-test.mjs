// Runs migration 208's scenarios (icloud_invite_test_actions: the invite test's daily cap) on a throwaway Postgres. The
// questions: does the function get at most 5 counted actions a day (Oslo's day), per account, whatever the action? Can the
// browser or the assistant read, add, age or delete a counted action, or call the two functions? Is the table service-role
// only, owner-locked and kept out of Activity's Undo? Does deleting an account take only its own rows?
// Two databases, each from the AI ledger's base.sql and the real 208 applied twice (the second run must leave the catalogue as
// the first did): with the grants Supabase gave every new table before 30.10.2026 (208's own revokes must keep the browser
// out), and without them (production now).
// Static checks first. With no database URL it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-icloud-invite-test.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(root, 'supabase/migrations/208_icloud_invite_test.sql')
const fail = msg => { console.error(`verify-db-icloud-invite-test: ${msg}`); process.exit(1) }
const noComments = text => text.replace(/--.*$/gm, '')

{
  const sql = noComments(readFileSync(FILE, 'utf8'))
  const stmts = sql.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
  const T = 'public.icloud_invite_test_actions'
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (!/create table if not exists public\.icloud_invite_test_actions \([\s\S]*?\);\s*alter table public\.icloud_invite_test_actions enable row level security;/i.test(sql)) problems.push('no row level security right after the table')
  if (!/select public\.owner_lock_apply\('public\.icloud_invite_test_actions'\);/i.test(sql)) problems.push('no owner_lock_apply')
  if (!/user_id\s+uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/i.test(sql)) problems.push('user_id is not "uuid not null default auth.uid() references auth.users(id) on delete cascade"')
  if (!/action\s+text not null check \(action in \('send', 'rewrite', 'remove'\)\)/i.test(sql)) problems.push('the action is not one of send, rewrite, remove')
  if (!stmts.includes(`revoke all on ${T} from anon, authenticated`)) problems.push('no revoke from anon, authenticated')
  if (stmts.some(s => new RegExp(`^grant .* on (table )?${T.replace('.', '\\.')} to .*\\b(anon|authenticated)\\b`, 'i').test(s))) problems.push('a grant to the browser')
  if (/create policy/i.test(sql)) problems.push('a browser policy (the table is service-role only)')
  if (/trg_audit/i.test(sql)) problems.push('an audit trigger (Undo must never reset the cap)')
  if (/security definer/i.test(sql)) problems.push('a SECURITY DEFINER function (none is needed)')
  for (const fn of ['icloud_invite_test_reserve(uuid, text)', 'icloud_invite_test_used(uuid)']) {
    if (!stmts.includes(`revoke all on function public.${fn} from public, anon, authenticated`)) problems.push(`${fn} is callable by the browser`)
    if (!stmts.includes(`grant execute on function public.${fn} to service_role`)) problems.push(`${fn} has no grant to service_role`)
  }
  if (!/pg_advisory_xact_lock\(hashtextextended\('icloud_invite_test:' \|\| p_user::text, 0\)\)/.test(sql)) problems.push('reserve takes no per-account lock before it counts')
  if (!/if v_used >= 5 then\s+return null;/i.test(sql)) problems.push('the cap is not 5')
  if (problems.length) fail(`migration 208 has ${problems.join('; ')}`)
  // The function's cap is the same number (what the card says).
  const fn = readFileSync(join(root, 'supabase/functions/icloud-calendar/index.ts'), 'utf8')
  if (!/export const INVITE_DAY_CAP = 5\b/.test(fn)) fail('icloud-calendar\'s INVITE_DAY_CAP is not 208\'s 5')
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-icloud-invite-test: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /FAIL|ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 8).join('\n')}`); throw e } }
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'policy ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename = 'icloud_invite_test_actions'
  union all select 'table rls=' || relrowsecurity from pg_class where oid = 'public.icloud_invite_test_actions'::regclass
  union all select 'grant ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.icloud_invite_test_actions'::regclass
  union all select 'column ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.icloud_invite_test_actions'::regclass and a.attnum > 0 and not a.attisdropped
  union all select 'constraint ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.icloud_invite_test_actions'::regclass
  union all select 'index ' || indexrelid::regclass::text from pg_index where indrelid = 'public.icloud_invite_test_actions'::regclass
  union all select 'function ' || p.proname || ' ' || coalesce(p.proacl::text, '') || ' ' || md5(p.prosrc) from pg_proc p
   where p.oid in ('public.icloud_invite_test_reserve(uuid, text)'::regprocedure, 'public.icloud_invite_test_used(uuid)'::regprocedure)
) t(x)`
const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t208a_${process.pid}`, before: OLD_DEFAULTS },
  { key: 'now', db: `t208b_${process.pid}`, before: [] },
]
let code = 0
const done = {}
for (const s of suites) {
  psql(url, ['-c', `create database ${s.db}`])
  try {
    const target = withDb(url, s.db)
    step(`${s.key}: base`, () => psql(target, ['-f', join(root, 'scripts/db-tests/ai-ledger/base.sql')]))
    if (s.before.length) step(`${s.key}: old default grants`, () => psql(target, s.before))
    step(`${s.key}: 208`, () => psql(target, ['-f', FILE]))
    const first = step(`${s.key}: fingerprint`, () => psql(target, ['-At', '-c', FINGERPRINT]))
    step(`${s.key}: 208 again`, () => psql(target, ['-f', FILE]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 10) throw Object.assign(new Error('fingerprint'), { stderr: 'ERROR: the catalogue fingerprint is nearly empty (it read nothing?)' })
    if (first !== second) throw Object.assign(new Error('not idempotent'), { stderr: 'ERROR: a second run of 208 changed the database' })
    const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/icloud-invite-test/scenarios.sql')], { encoding: 'utf8' })
    done[s.key] = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
    if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => !/NOTICE: {2}ok/.test(l)).slice(0, 12).join('\n') })
  } catch (e) {
    code = 1
    if (e.stderr) console.error(e.stderr.toString())
  } finally {
    try { psql(url, ['-c', `drop database if exists ${s.db}`]) } catch { /* best effort */ }
  }
  if (code) break
}
if (code) process.exit(code)
console.log(`verify-db-icloud-invite-test: 208 ran twice on two databases and left each as its first run did; ${done.old} scenarios passed with the old default grants and ${done.now} without them`)
