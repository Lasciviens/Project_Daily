// Runs migration 197's scenarios (Ask AI chats: ai_conversations, ai_messages, ai_chat_proposals, ai_find_text) on a
// throwaway Postgres. The questions: can anyone but the service role write a conversation or a proposal (a forged
// "confirmed" proposal would be a write nobody agreed to)? Is a message really append-only? Can a message name another
// account's conversation? Does the search stay inside the caller's own rows?
// Two databases, each from the AI ledger's base.sql, 194 and 195, this folder's base.sql and the real 197 applied twice
// (the second run must leave the catalogue as the first did):
//   · with the grants Supabase gave every new table before 30.10.2026: 197's own revokes must keep the browser out;
//   · without them (production now): 197's own grants must be enough.
// Static checks first. With no database URL it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-ai-chat.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const FILE = '197_ai_chat.sql'
const fail = msg => { console.error(`verify-db-ai-chat: ${msg}`); process.exit(1) }
const noComments = text => text.replace(/--.*$/gm, '')
const statementsOf = text => noComments(text).split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)

{
  const src = readFileSync(mig(FILE), 'utf8')
  const sql = noComments(src)
  const stmts = statementsOf(src)
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== 'ai_conversations,ai_messages,ai_chat_proposals') problems.push(`creates ${tables.join(', ') || 'no table'}`)
  for (const t of tables) {
    if (!new RegExp(`create table if not exists public\\.${t} \\([\\s\\S]*?\\n\\);\\s*alter table public\\.${t} enable row level security;`, 'i').test(sql)) problems.push(`${t}: no row level security right after the table`)
    if (!new RegExp(`select public\\.owner_lock_apply\\('public\\.${t}'\\);`, 'i').test(sql)) problems.push(`${t}: no owner_lock_apply`)
    if (!stmts.includes(`revoke all on public.${t} from anon, authenticated`)) problems.push(`${t}: no revoke from anon, authenticated`)
    if (!stmts.includes(`grant select on public.${t} to authenticated`)) problems.push(`${t}: the browser's grant is not "select" alone`)
    if (stmts.some(s => new RegExp(`^grant .* on (table )?public\\.${t} to .*\\banon\\b`, 'i').test(s))) problems.push(`${t}: a grant to anon`)
    if (!new RegExp(`user_id\\s+uuid not null references auth\\.users\\(id\\) on delete cascade,`, 'i').test(sql)) problems.push('user_id is not "uuid not null references auth.users(id) on delete cascade" without a default')
  }
  const policies = [...sql.matchAll(/create policy "[^"]+" on public\.(\w+)\s+for (\w+) to authenticated/gi)].map(m => `${m[1]}:${m[2].toLowerCase()}`)
  if (policies.length !== 3 || policies.some(p => !p.endsWith(':select'))) problems.push(`policies ${policies.join(', ')} (expected a select policy per table)`)
  if (!/create trigger trg_ai_messages_append_only before update or delete on public\.ai_messages/i.test(sql)) problems.push('no append-only trigger on ai_messages')
  if ((sql.match(/create trigger/gi) || []).length !== 1) problems.push('a trigger besides the append-only guard (these are server-written logs: no audit)')
  if (!/foreign key \(conversation_id, user_id\)\s+references public\.ai_conversations \(id, user_id\)/i.test(sql)) problems.push('a message or proposal can name another account\'s conversation')
  if (!/create or replace function public\.ai_chats_purge\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i.test(sql)) problems.push('ai_chats_purge is not security definer with an empty search_path')
  if (!/revoke all on function public\.ai_chats_purge\(\) from public, anon, authenticated/i.test(sql) || !/grant execute on function public\.ai_chats_purge\(\) to service_role/i.test(sql)) problems.push('ai_chats_purge is callable by the browser roles or not by the service role')
  if (!/cron\.schedule\('lascis-ai-chat-purge', '47 3 \* \* \*', 'select public\.ai_chats_purge\(\)'\)/.test(sql)) problems.push('the chat purge timer is missing')
  if (!/security invoker/i.test(sql.slice(sql.indexOf('function public.ai_find_text')))) problems.push('ai_find_text is not security invoker')
  if (/security definer/i.test(sql.slice(sql.indexOf('function public.ai_find_text')))) problems.push('ai_find_text is security definer')
  if (!/revoke all on function public\.ai_find_text\(text, text, integer\) from public, anon/i.test(sql)) problems.push('ai_find_text is callable signed out')
  if (problems.length) fail(`migration 197 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-ai-chat: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
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
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/ai-chat/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => !/NOTICE:  ok/.test(l)).slice(0, 12).join('\n') })
  return passed
}
const TABLES = `('public.ai_conversations'::regclass, 'public.ai_messages'::regclass, 'public.ai_chat_proposals'::regclass)`
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'policy ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename in ('ai_conversations', 'ai_messages', 'ai_chat_proposals')
  union all select 'table ' || c.relname || ' rls=' || c.relrowsecurity from pg_class c where c.oid in ${TABLES}
  union all select 'grant ' || c.relname || ' ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.oid in ${TABLES}
  union all select 'column ' || c.relname || ' ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_class c join pg_attribute a on a.attrelid = c.oid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where c.oid in ${TABLES} and a.attnum > 0 and not a.attisdropped
  union all select 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid in ${TABLES}
  union all select 'index ' || indexdef from pg_indexes where schemaname = 'public' and tablename in ('ai_conversations', 'ai_messages', 'ai_chat_proposals')
  union all select 'trigger ' || tgname || ' ' || pg_get_triggerdef(oid) from pg_trigger where tgrelid in ${TABLES} and not tgisinternal
  union all select 'function ' || p.oid::regprocedure || ' ' || md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '') from pg_proc p where p.proname in ('ai_find_text', 'ai_messages_append_only', 'ai_chats_purge')
) t(x)`

const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t197a_${process.pid}`, before: OLD_DEFAULTS },
  { key: 'now', db: `t197b_${process.pid}`, before: [] },
]
let code = 0
const done = {}
for (const s of suites) {
  psql(url, ['-c', `create database ${s.db}`])
  try {
    const target = withDb(url, s.db)
    step(`${s.key}: ledger base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-ledger/base.sql')]))
    step(`${s.key}: base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-chat/base.sql')]))
    if (s.before.length) step(`${s.key}: old default grants`, () => psql(target, s.before))
    for (const f of ['194_ai_ledger.sql', '195_ai_controls.sql', FILE]) step(`${s.key}: ${f}`, () => psql(target, ['-f', mig(f)]))
    const first = step(`${s.key}: fingerprint`, () => psql(target, ['-At', '-c', FINGERPRINT]))
    step(`${s.key}: 197 again`, () => psql(target, ['-f', mig(FILE)]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 40) throw Object.assign(new Error('fingerprint'), { stderr: `ERROR: the catalogue fingerprint has only ${first.split('\n').length} lines (it read nothing?)` })
    if (first !== second) {
      const a = new Set(first.split('\n')), b = new Set(second.split('\n'))
      const diff = [...second.split('\n').filter(l => !a.has(l)).map(l => `+ ${l}`), ...first.split('\n').filter(l => !b.has(l)).map(l => `- ${l}`)]
      throw Object.assign(new Error('not idempotent'), { stderr: `ERROR: a second run of 197 changed the database:\n${diff.slice(0, 12).map(l => `DETAIL: ${l}`).join('\n')}` })
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
console.log(`verify-db-ai-chat: 197 ran twice on two databases and left each as its first run did; ${done.old} scenarios passed with the old default grants and ${done.now} without them`)
