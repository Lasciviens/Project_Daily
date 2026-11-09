// Runs migration 187's scenarios (Shop's rules and its Undo) on a throwaway Postgres. One chain is built
// from scripts/db-tests/shop-rules/base.sql and the real migrations 029, 030, 134, 137, 138, 144, 150 and
// 151 (with 037's audit trigger and 139's owner lock on the Shop tables, and Supabase's old default grants
// taken back at the end, as production has them), then copied twice:
//   · without 187: scripts/db-tests/shop-rules/bugs.sql — every bug the 09.11.2026 review found must
//     still show (a check that passes here no longer proves anything);
//   · with 187, applied twice (a re-run must be a no-op): bugs.sql — every check must pass — then
//     scenarios.sql (rates, wishes and models, link loops, selling and its Undo, Delete's Undo with the
//     price watch and later tables, the chain builder's save, web links, Activity Undo, deleting an account).
// Static checks of 187 first.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-shop-rules.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const dir = join(root, 'scripts/db-tests/shop-rules')
const fail = msg => { console.error(`verify-db-shop-rules: ${msg}`); process.exit(1) }

// The bugs bugs.sql must show without 187 and see fixed with it.
const BUGS = ['1', '2', '3a', '3b', '3c', '4', '5a', '5b', '6', '7a', '7b', '7c', '7d', '7e', '8', '9a', '9b']

// Static: one transaction, no new table, every function it writes pinned to search_path '' and granted,
// SECURITY DEFINER only where the header says why.
{
  const src = readFileSync(mig('187_shop_integrity.sql'), 'utf8')
  const sql = src.replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (/create table/i.test(sql)) problems.push('a new table (it would need RLS, grants and the owner lock)')
  if (/^(update|insert into|delete from) /im.test(sql)) problems.push('a top-level write (187 changes no row)')
  if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database')
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?\n\$\$;/gi)]
  if (fns.length < 14) problems.push(`only ${fns.length} functions found (the parser saw nothing?)`)
  const definer = new Set(['shop_restore_price_history', 'shop_items_links_recheck', 'shop_items_sale_group_whole'])
  for (const [body, name] of fns) {
    if (!/set search_path = ''/.test(body)) problems.push(`${name} has no search_path ''`)
    if (/security definer/i.test(body) !== definer.has(name)) problems.push(`${name}: SECURITY DEFINER ${definer.has(name) ? 'missing' : 'not expected'}`)
    if (!/^shop_(items_rules|item_costs_rules|item_links_check)$/.test(name)
        && !new RegExp(`revoke all on function public\\.${name}\\(`).test(sql)) problems.push(`no revoke for ${name}`)
  }
  for (const name of definer) {
    if (new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to [^;]*(anon|service_role)`).test(sql)) problems.push(`${name} granted wider than needed`)
  }
  if (problems.length) fail(`migration 187 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-shop-rules: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const step = (name, fn) => { try { fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL|FAIL/.test(l)).slice(0, 8).join('\n')}`); throw e } }
const run = (target, file) => spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
/** bugs.sql's answers: id → 'ok' | 'WRONG'. */
const bugAnswers = (target) => {
  const r = run(target, join(dir, 'bugs.sql'))
  if (r.status !== 0) throw Object.assign(new Error('bugs.sql stopped'), { stderr: r.stderr })
  const out = new Map()
  for (const m of r.stderr.matchAll(/NOTICE: {2}bug (\S+) {2}(ok|WRONG) {2}(.*)/g)) out.set(m[1], { answer: m[2], what: m[3] })
  return out
}

const pid = process.pid
const tpl = `t187tpl_${pid}`, old = `t187old_${pid}`, neu = `t187new_${pid}`
let code = 0
let summary = ''
psql(url, ['-c', `create database ${tpl}`])
try {
  const t = withDb(url, tpl)
  step('base', () => psql(t, ['-f', join(dir, 'base.sql')]))
  for (const f of ['029_shop.sql', '030_shop_seed_categories.sql']) step(f, () => psql(t, ['-f', mig(f)]))
  step('037 on the Shop tables', () => psql(t, ['-c', `
    create trigger trg_audit after insert or update or delete on public.shop_categories for each row execute function public.log_audit();
    create trigger trg_audit after insert or update or delete on public.shop_items for each row execute function public.log_audit();`]))
  for (const f of ['134_shop_lists.sql', '137_shop_owned.sql', '138_shop_chain_names.sql']) step(f, () => psql(t, ['-f', mig(f)]))
  step('139 on the Shop tables', () => psql(t, ['-c', `select public.owner_lock_apply(x::regclass) from unnest(array['public.tasks', 'public.shop_categories',
    'public.shop_items', 'public.shop_item_links', 'public.shop_item_costs', 'public.shop_price_watch', 'public.shop_price_points', 'public.fx_rates_nok']) x`]))
  for (const f of ['144_delete_with_undo.sql', '150_undo_save.sql', '151_undo_save_fixes.sql']) step(f, () => psql(t, ['-f', mig(f)]))
  step('grants since 30.10.2026', () => psql(t, ['-c', 'alter default privileges in schema public revoke all on tables from anon, authenticated, service_role']))
  psql(url, ['-c', `create database ${old} template ${tpl}`])
  psql(url, ['-c', `create database ${neu} template ${tpl}`])

  // Without 187 every bug must show.
  const before = bugAnswers(withDb(url, old))
  const missing = BUGS.filter(id => !before.has(id))
  const fixedAlready = BUGS.filter(id => before.get(id)?.answer === 'ok')
  if (missing.length || before.size !== BUGS.length) throw new Error(`bugs.sql answered ${[...before.keys()].join(', ')} — expected ${BUGS.join(', ')}`)
  if (fixedAlready.length) throw new Error(`without 187 these checks already pass, so they prove nothing: ${fixedAlready.join(', ')}`)

  // With 187 (twice) every bug is fixed and every scenario passes.
  const n = withDb(url, neu)
  step('187', () => psql(n, ['-f', mig('187_shop_integrity.sql')]))
  step('187 again', () => psql(n, ['-f', mig('187_shop_integrity.sql')]))
  const after = bugAnswers(n)
  const still = BUGS.filter(id => after.get(id)?.answer !== 'ok')
  if (still.length) throw new Error(`with 187 these bugs still show:\n${still.map(id => `  ${id}: ${after.get(id)?.what ?? 'no answer'}`).join('\n')}`)
  const sc = run(n, join(dir, 'scenarios.sql'))
  const passed = (sc.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (sc.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: sc.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  summary = `${BUGS.length} bugs shown without 187 and fixed with it (applied twice), and ${passed} scenarios passed`
} catch (e) {
  code = 1
  console.error(`verify-db-shop-rules: ${e.message}`)
  if (e.stderr) console.error(e.stderr.toString().split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE|DETAIL/.test(l)).slice(0, 20).join('\n'))
} finally {
  for (const db of [neu, old, tpl]) {
    try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
  }
}
if (code) process.exit(code)
console.log(`verify-db-shop-rules: ${summary}`)
