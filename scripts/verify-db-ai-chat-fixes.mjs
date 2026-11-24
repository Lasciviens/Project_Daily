// Runs migration 205's scenarios (Ask AI fixes: two new kinds of proposal, the `replaced` state, the two new write tools
// that may never be "on") on a throwaway Postgres. The questions: does 205 let in exactly the new kinds and state and
// nothing else, does a decided (replaced) proposal still need its time, can the browser still write no proposal and bring
// none back, and can no setting switch a new write tool on?
// Two databases, each from the AI ledger's base.sql, the chat's base.sql, 194, 195, 197, 198 and the real 205 applied twice
// (the second run must leave the catalogue as the first did): with the grants Supabase gave every new table before
// 30.10.2026, and without them. Static checks first. With no database URL it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-ai-chat-fixes.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const FILE = '205_ai_chat_fixes.sql'
const FILE_206 = '206_ai_chat_tool_count.sql'
const fail = msg => { console.error(`verify-db-ai-chat-fixes: ${msg}`); process.exit(1) }
const noComments = text => text.replace(/--.*$/gm, '')

{
  const sql = noComments(readFileSync(mig(FILE), 'utf8'))
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/create table|grant |revoke |create policy|security definer|create or replace function/i.test(sql)) problems.push('a table, grant, policy or function (205 only widens three CHECKs)')
  if (!/check \(tool in \('add_task', 'log_food', 'update_food', 'update_task'\)\)/.test(sql)) problems.push('the proposal kinds are not exactly the four')
  if (!/check \(status in \('pending', 'confirmed', 'cancelled', 'failed', 'replaced'\)\)/.test(sql)) problems.push('the proposal states are not exactly the five')
  if (!/check \(not \(tool in \('propose_add_task', 'propose_log_food', 'propose_update_food', 'propose_update_task'\) and mode = 'on'\)\)/.test(sql)) problems.push('a write tool can be stored as on')
  const strayFix = sql.indexOf("update public.ai_tool_settings set mode = 'ask' where tool in ('propose_update_food', 'propose_update_task') and mode = 'on';")
  if (strayFix < 0 || strayFix > sql.indexOf('add constraint ai_tool_settings_write_never_on')) problems.push('a stray "on" row of a new write tool is not made "ask" before the CHECK is added')
  // The function's lists say the same (chat-rules.ts, chat-tools.ts).
  const rules = readFileSync(join(root, 'supabase/claude-src/chat-rules.ts'), 'utf8')
  const tools = readFileSync(join(root, 'supabase/claude-src/chat-tools.ts'), 'utf8')
  if (!/WRITE_TOOL_NAMES = \['propose_add_task', 'propose_log_food'\] as const/.test(rules) || !/FIX_TOOL_NAMES = \['propose_update_food', 'propose_update_task'\] as const/.test(rules)) problems.push('the function\'s write tools are not the four 205 names')
  if (!/PROPOSAL_TOOLS: readonly ProposalTool\[\] = \['add_task', 'log_food', 'update_food', 'update_task'\]/.test(tools)) problems.push('the function\'s proposal kinds are not the four 205 allows')
  if (problems.length) fail(`migration 205 has ${problems.join('; ')}`)
  const s206 = noComments(readFileSync(mig(FILE_206), 'utf8'))
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(s206) || /create table|grant |revoke |create policy|security definer|create or replace function|update |delete |insert /i.test(s206)) fail('migration 206 does more than replace one CHECK')
  if (!/check \(cardinality\(tool_names\) <= 40 and pg_catalog\.array_to_string\(tool_names, ','\) ~ '\^\[a-z_,\]\*\$'\)/.test(s206)) fail('migration 206 does not keep 197\'s name check with the 40 cap')
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-ai-chat-fixes: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
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
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/ai-chat-fixes/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => !/NOTICE:  ok/.test(l)).slice(0, 12).join('\n') })
  return passed
}
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.ai_chat_proposals'::regclass, 'public.ai_tool_settings'::regclass)
  union all select 'grant ' || c.relname || ' ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.oid in ('public.ai_chat_proposals'::regclass, 'public.ai_tool_settings'::regclass)
  union all select 'policy ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') from pg_policies where schemaname = 'public' and tablename in ('ai_chat_proposals', 'ai_tool_settings')
) t(x)`

const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t205a_${process.pid}`, before: OLD_DEFAULTS },
  { key: 'now', db: `t205b_${process.pid}`, before: [] },
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
    for (const f of ['194_ai_ledger.sql', '195_ai_controls.sql', '197_ai_chat.sql', '198_ai_chat_controls.sql']) step(`${s.key}: ${f}`, () => psql(target, ['-f', mig(f)]))
    const before = psql(target, ['-At', '-c', FINGERPRINT])
    // A row saved before 205 that says "on" for a new write tool (198's CHECK did not know the name): 205 must make it "ask".
    step(`${s.key}: a stray "on" row`, () => psql(target, ['-c', "insert into public.ai_tool_settings (user_id, tool, mode) values ('00000000-0000-0000-0000-000000000002', 'propose_update_task', 'on')"]))
    step(`${s.key}: ${FILE}`, () => psql(target, ['-f', mig(FILE)]))
    const first = step(`${s.key}: fingerprint`, () => psql(target, ['-At', '-c', FINGERPRINT]))
    step(`${s.key}: 205 again`, () => psql(target, ['-f', mig(FILE)]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 10) throw Object.assign(new Error('fingerprint'), { stderr: `ERROR: the catalogue fingerprint has only ${first.split('\n').length} lines (it read nothing?)` })
    // 205 changes exactly three constraints: every grant and policy stays as 197 and 198 made them.
    const changed = first.split('\n').filter(l => !before.split('\n').includes(l))
    if (changed.length !== 3 || !changed.every(l => /^constraint .* (ai_chat_proposals_tool_check|ai_chat_proposals_status_check|ai_tool_settings_write_never_on) /.test(l))) {
      throw Object.assign(new Error('changed more'), { stderr: `ERROR: 205 changed more than its three CHECKs:\n${changed.slice(0, 8).map(l => `DETAIL: ${l}`).join('\n')}` })
    }
    if (first !== second) throw Object.assign(new Error('not idempotent'), { stderr: 'ERROR: a second run of 205 changed the database' })
    done[s.key] = step(`${s.key}: scenarios`, () => runScenarios(target))
    // 206: a new chat with every tool the code knows (18 since 205) is stored; 197's cap of 12 refused it (24.11.2026).
    step(`${s.key}: ${FILE_206} twice`, () => { psql(target, ['-f', mig(FILE_206)]); psql(target, ['-f', mig(FILE_206)]) })
    const insertChat = (id, n) => `set role service_role; insert into public.ai_conversations (id, user_id, title, model, effort, tools_hash, system_hash, tool_names) values ('${id}', '00000000-0000-0000-0000-000000000001', 'Tools', 'claude-haiku-5-5', 'medium', repeat('a', 64), repeat('b', 64), array(select 'tool_' || chr(96 + (i % 26) + 1) from generate_series(1, ${n}) i))`
    step(`${s.key}: 206 stores a chat with 18 tools`, () => psql(target, ['-c', insertChat('c6000000-0000-4000-8000-000000000018', 18)]))
    step(`${s.key}: 206 stores a chat with 40 tools`, () => psql(target, ['-c', insertChat('c6000000-0000-4000-8000-000000000040', 40)]))
    let refused = false
    try { psql(target, ['-c', insertChat('c6000000-0000-4000-8000-000000000041', 41)]) } catch (e) { refused = /23514|violates check constraint/.test(String(e.stderr)) }
    if (!refused) throw Object.assign(new Error('206 cap'), { stderr: 'ERROR: 206 let a chat store 41 tool names' })
    let badName = false
    try { psql(target, ['-c', `set role service_role; insert into public.ai_conversations (id, user_id, title, model, effort, tools_hash, system_hash, tool_names) values ('c6000000-0000-4000-8000-000000000099', '00000000-0000-0000-0000-000000000001', 'Tools', 'claude-haiku-5-5', 'medium', repeat('a', 64), repeat('b', 64), array['Get-Plan'])`]) } catch (e) { badName = /23514|violates check constraint/.test(String(e.stderr)) }
    if (!badName) throw Object.assign(new Error('206 names'), { stderr: 'ERROR: 206 let a tool name outside [a-z_] in' })
    done[s.key] += 4
  } catch (e) {
    code = 1
    if (e.stderr) console.error(e.stderr.toString())
  } finally {
    try { psql(url, ['-c', `drop database if exists ${s.db}`]) } catch { /* best effort */ }
  }
  if (code) break
}
if (code) process.exit(code)
console.log(`verify-db-ai-chat-fixes: 205 ran twice on two databases (then 206 twice: 18 and 40 tools stored, 41 and a bad name refused), changed only its three CHECKs and left each as its first run did; ${done.old} scenarios passed with the old default grants and ${done.now} without them`)
