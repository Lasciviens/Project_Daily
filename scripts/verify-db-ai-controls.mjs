// Runs migration 198's scenarios (Ask AI controls: ai_tool_settings, ai_settings.chat_instructions, ai_conversations.mode and
// .owner_instructions, a photo inside a stored message) on a throwaway Postgres. The questions: can the owner write only their own
// tool modes and words, and can nobody else read them? Is the shape bounded (a mode off the list, a name with odd characters, more
// than 1000 characters)? Can the browser change what a chat was started with? Is a message with a photo still capped at 1 MB and
// append-only, and does the retention purge take it away with its chat?
// Two databases, each from the AI ledger's base.sql, the chat's base.sql, 194, 195, 197 and the real 198 applied twice (the second
// run must leave the catalogue as the first did):
//   · with the grants Supabase gave every new table before 30.10.2026: 198's own revokes must keep the browser out;
//   · without them (production now): 198's own grants must be enough.
// Static checks first. With no database URL it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-ai-controls.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const FILE = '198_ai_chat_controls.sql'
const fail = msg => { console.error(`verify-db-ai-controls: ${msg}`); process.exit(1) }
const noComments = text => text.replace(/--.*$/gm, '')
const statementsOf = text => noComments(text).split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)

{
  const src = readFileSync(mig(FILE), 'utf8')
  const sql = noComments(src)
  const stmts = statementsOf(src)
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== 'ai_tool_settings') problems.push(`creates ${tables.join(', ') || 'no table'}`)
  if (!/create table if not exists public\.ai_tool_settings \([\s\S]*?\n\);\s*alter table public\.ai_tool_settings enable row level security;/i.test(sql)) problems.push('no row level security right after the table')
  if (!/select public\.owner_lock_apply\('public\.ai_tool_settings'\);/i.test(sql)) problems.push('no owner_lock_apply')
  if (!stmts.includes('revoke all on public.ai_tool_settings from anon, authenticated')) problems.push('no revoke from anon, authenticated')
  if (!stmts.includes('grant select, insert, update on public.ai_tool_settings to authenticated')) problems.push('the browser\'s grant is not "select, insert, update" (no delete)')
  if (stmts.some(s => /^grant .* on (table )?public\.ai_tool_settings to .*\banon\b/i.test(s))) problems.push('a grant to anon')
  if (!/user_id\s+uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/i.test(sql)) problems.push('user_id is not "uuid not null default auth.uid() references auth.users(id) on delete cascade"')
  const policies = [...sql.matchAll(/create policy "[^"]+" on public\.(\w+)\s+for (\w+) to authenticated/gi)].map(m => `${m[1]}:${m[2].toLowerCase()}`)
  if (policies.join() !== 'ai_tool_settings:select,ai_tool_settings:insert,ai_tool_settings:update') problems.push(`policies ${policies.join(', ')}`)
  if (!/mode\s+text not null check \(mode in \('on', 'ask', 'off'\)\)/i.test(sql)) problems.push('the mode is not bounded to on, ask, off')
  if (!/constraint ai_tool_settings_write_never_on check \(not \(tool in \('propose_add_task', 'propose_log_food'\) and mode = 'on'\)\)/i.test(sql)) problems.push('a write tool can be stored as on')
  if (!/create trigger trg_audit after insert or update or delete on public\.ai_tool_settings/i.test(sql)) problems.push('no audit trigger on ai_tool_settings (the owner\'s own choices)')
  if (!/chat_instructions text not null default ''\s*check \(char_length\(chat_instructions\) <= 1000\)/i.test(sql)) problems.push('chat_instructions is not bounded to 1000 characters')
  if (!/owner_instructions text not null default ''\s*check \(char_length\(owner_instructions\) <= 1000\)/i.test(sql)) problems.push('owner_instructions is not bounded to 1000 characters')
  if (!/mode text not null default 'chat'\s*check \(mode in \('chat', 'coach'\)\)/i.test(sql)) problems.push('the chat kind is not bounded to chat, coach')
  if (/grant .* on public\.ai_conversations/i.test(sql) || /grant .* on public\.ai_messages/i.test(sql)) problems.push('a grant on the chat tables (the browser must stay read-only there)')
  if (/security definer/i.test(sql)) problems.push('a SECURITY DEFINER function (this migration needs none)')
  if (problems.length) fail(`migration 198 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-ai-controls: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
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
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/ai-controls/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => !/NOTICE:  ok/.test(l)).slice(0, 12).join('\n') })
  return passed
}
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'policy ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename = 'ai_tool_settings'
  union all select 'table ' || c.relname || ' rls=' || c.relrowsecurity from pg_class c where c.oid = 'public.ai_tool_settings'::regclass
  union all select 'grant ' || c.relname || ' ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.ai_tool_settings'::regclass
  union all select 'column ' || c.relname || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_class c join pg_attribute a on a.attrelid = c.oid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where ((c.oid = 'public.ai_tool_settings'::regclass) or (c.oid = 'public.ai_settings'::regclass and a.attname = 'chat_instructions')
      or (c.oid = 'public.ai_conversations'::regclass and a.attname in ('mode', 'owner_instructions'))) and a.attnum > 0 and not a.attisdropped
  union all select 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.ai_tool_settings'::regclass or (conrelid in ('public.ai_settings'::regclass, 'public.ai_conversations'::regclass) and conname ~ '(chat_instructions|owner_instructions|mode)')
  union all select 'trigger ' || tgname || ' ' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.ai_tool_settings'::regclass and not tgisinternal
) t(x)`

const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t198a_${process.pid}`, before: OLD_DEFAULTS },
  { key: 'now', db: `t198b_${process.pid}`, before: [] },
]
let code = 0
const done = {}
for (const s of suites) {
  psql(url, ['-c', `create database ${s.db}`])
  try {
    const target = withDb(url, s.db)
    step(`${s.key}: ledger base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-ledger/base.sql')]))
    step(`${s.key}: chat base`, () => psqlRetry(target, ['-f', join(root, 'scripts/db-tests/ai-chat/base.sql')]))
    if (s.before.length) step(`${s.key}: old default grants`, () => psql(target, s.before))
    for (const f of ['194_ai_ledger.sql', '195_ai_controls.sql', '197_ai_chat.sql', FILE]) step(`${s.key}: ${f}`, () => psql(target, ['-f', mig(f)]))
    const first = step(`${s.key}: fingerprint`, () => psql(target, ['-At', '-c', FINGERPRINT]))
    step(`${s.key}: 198 again`, () => psql(target, ['-f', mig(FILE)]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 20) throw Object.assign(new Error('fingerprint'), { stderr: `ERROR: the catalogue fingerprint has only ${first.split('\n').length} lines (it read nothing?)` })
    if (first !== second) {
      const a = new Set(first.split('\n')), b = new Set(second.split('\n'))
      const diff = [...second.split('\n').filter(l => !a.has(l)).map(l => `+ ${l}`), ...first.split('\n').filter(l => !b.has(l)).map(l => `- ${l}`)]
      throw Object.assign(new Error('not idempotent'), { stderr: `ERROR: a second run of 198 changed the database:\n${diff.slice(0, 12).map(l => `DETAIL: ${l}`).join('\n')}` })
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
console.log(`verify-db-ai-controls: 198 ran twice on two databases and left each as its first run did; ${done.old} scenarios passed with the old default grants and ${done.now} without them`)
