// Runs migration 187's scenarios (Shop's rules and its Undo) on a throwaway Postgres. One chain is built
// from scripts/db-tests/shop-rules/base.sql and the real migrations 029, 030, 134, 137, 138, 144, 150 and
// 151 (with 037's audit trigger and 139's owner lock on the Shop tables, and Supabase's old default grants
// taken back at the end, as production has them), then copied twice:
//   · without 187: scripts/db-tests/shop-rules/bugs.sql — every bug the 09.11.2026 review found must
//     still show (a check that passes here no longer proves anything);
//   · with 187, applied twice (a re-run must be a no-op): bugs.sql — every check must pass — then 188
//     twice and 190 twice, then scenarios.sql (rates, wishes and models, link loops, selling and its Undo,
//     Delete's Undo with the price watch and later tables, the chain builder's save, web links, Activity
//     Undo, deleting an account), site-policies.sql (188: the sites shop-price never reads, who reads and
//     writes that list, the condition of a price, and Delete's Undo carrying it — never a watch without its
//     time) and signals.sql (190: what Needs a look remembers — Snooze, Got it and their exact Undo, the
//     signal list and the bounds, each account its own rows — deal days, stock in the price history, the
//     price figures of many things in one call, and NaN and infinity kept out, and categories inside one account —
//     cross-account-old.sql plants old links across accounts before 190, which 190 must cut), then 192 twice and
//     resale.sql (192: ad notes, trade-in quotes, the value history, listings and how a sale closes them, the ad
//     templates and hand-over checklists with their Norwegian and English defaults, each account its own rows, links
//     never fetched and https only, Activity's Undo of an estimate and of a sale with its listing, Delete's Undo
//     bringing every row back, deleting an account).
// Static checks of 187, 188, 190 and 192 first.
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
  const helper187 = sql.match(/create or replace function public\.shop_restore_price_history\([\s\S]*?\n\$\$;/i)?.[0] ?? ''
  if (!/where w\.item_id = any \(v_back\) and w\.checked_at is not null/.test(helper187)) problems.push('shop_restore_price_history puts back a watch without checked_at (least(NULL, now()) is now())')
  if (problems.length) fail(`migration 187 has ${problems.join('; ')}`)
}

// Static, 188: its one table follows every rule for a table without user_id (row level security, the owner lock,
// grants: the app reads, only the service role writes, signed out nothing; no audit, with the header's reason),
// and the helper it re-creates is still pinned, a definer for signed-in callers only, and carries the condition.
{
  const src = readFileSync(mig('188_shop_site_policies.sql'), 'utf8')
  const sql = src.replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== 'shop_site_policies') problems.push(`creates ${tables.join(', ') || 'no table'} (expected shop_site_policies only)`)
  if (!/create table if not exists public\.shop_site_policies \([\s\S]*?\);\s*alter table public\.shop_site_policies enable row level security;/i.test(sql)) problems.push('no row level security right after the table')
  if (!/select public\.owner_lock_apply\('public\.shop_site_policies'\);\s*$/i.test(sql)) problems.push('no owner_lock_apply at the end')
  if (!/revoke all on public\.shop_site_policies from anon, authenticated;/i.test(sql)) problems.push('no revoke from anon and authenticated')
  if (!/grant select on public\.shop_site_policies to authenticated;/i.test(sql)) problems.push('no read grant for the app')
  if (/grant [^;]*(insert|update|delete)[^;]* on public\.shop_site_policies to [^;]*authenticated/i.test(sql)) problems.push('a write grant for the app')
  if (/on public\.shop_site_policies to [^;]*anon/i.test(sql)) problems.push('a grant to anon')
  if (!/grant select, insert, update, delete on public\.shop_site_policies to service_role;/i.test(sql)) problems.push('no service-role grant')
  if (/for (insert|update|delete|all)\b[^;]*on public\.shop_site_policies|on public\.shop_site_policies for (insert|update|delete|all)\b/i.test(sql)) problems.push('a browser write policy')
  if (/trg_audit/i.test(sql) || !/No audit trigger: /.test(src)) problems.push('an audit trigger, or no reason in the header why there is none')
  if (!/No user_id: /.test(src)) problems.push('no reason in the header for having no user_id')
  const helper = sql.match(/create or replace function public\.shop_restore_price_history\([\s\S]*?\n\$\$;/i)?.[0] ?? ''
  if (!/security definer/i.test(helper) || !/set search_path = ''/.test(helper)) problems.push('the helper is not a definer pinned to search_path \'\'')
  for (const col of ['condition', 'used_low', 'refurbished_low']) if ((helper.match(new RegExp(`\\b${col}\\b`, 'g')) || []).length < 4) problems.push(`the helper does not carry ${col} through both inserts`)
  if (!/where w\.item_id = any \(v_back\) and w\.checked_at is not null/.test(helper)) problems.push('the helper puts back a watch without checked_at (least(NULL, now()) is now())')
  if (!/revoke all on function public\.shop_restore_price_history\(jsonb, jsonb\) from public, anon, authenticated, service_role;\s*grant execute on function public\.shop_restore_price_history\(jsonb, jsonb\) to authenticated;/i.test(sql)) problems.push('the helper is not granted to authenticated only')
  if (problems.length) fail(`migration 188 has ${problems.join('; ')}`)
}

// Static, 190: two tables, each with row level security right after it and the owner lock at the end; signal states
// are the owner's own rows (the owner policy, audited, the app writes them), deal days are reference data like 188's
// (the app reads, only the service role writes, no audit or user_id — each with the header's reason); every function
// is pinned, runs as the caller but for 188's helper, is granted to signed-in callers only; the helper still binds
// itself to the rows Undo put back and now carries in_stock; the price figures are bounded and read clean prices only.
{
  const src = readFileSync(mig('190_shop_needs_a_look.sql'), 'utf8')
  const sql = src.replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (/^(update|insert into public\.shop_(items|signal_states|price_points|price_watch)|delete from) /im.test(sql)) problems.push('a top-level write to user rows (190 changes no row but a link across accounts, inside its block)')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== 'shop_signal_states,shop_deal_days') problems.push(`creates ${tables.join(', ') || 'no table'} (expected shop_signal_states and shop_deal_days)`)
  for (const t of ['shop_signal_states', 'shop_deal_days']) {
    if (!new RegExp(`create table if not exists public\\.${t} \\([\\s\\S]*?\\n\\);\\s*alter table public\\.${t} enable row level security;`, 'i').test(sql)) problems.push(`no row level security right after ${t}`)
    if (!new RegExp(`select public\\.owner_lock_apply\\('public\\.${t}'\\);`, 'i').test(sql)) problems.push(`no owner_lock_apply for ${t}`)
    if (new RegExp(`on public\\.${t} to [^;]*anon`, 'i').test(sql)) problems.push(`a grant to anon on ${t}`)
    if (!new RegExp(`grant select, insert, update, delete on public\\.${t} to service_role;`, 'i').test(sql)) problems.push(`no service-role grant on ${t}`)
  }
  if (!/user_id\s+uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/i.test(sql)) problems.push('signal states: user_id without auth.uid() by default')
  if (!/create policy "Users manage own shop_signal_states" on public\.shop_signal_states\s+for all using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\);/i.test(sql)) problems.push('signal states: no owner policy with (select auth.uid())')
  if (!/revoke all on public\.shop_signal_states from anon;\s*grant select, insert, update, delete on public\.shop_signal_states to authenticated;/i.test(sql)) problems.push('signal states: the app does not read and write them, or anon is not revoked')
  if (!/create trigger trg_audit after insert or update or delete on public\.shop_signal_states\s+for each row execute function public\.log_audit\(\);/i.test(sql)) problems.push('signal states: no audit trigger')
  if (!/item_id\s+uuid references public\.shop_items\(id\) on delete cascade/i.test(sql)) problems.push('signal states: item_id is not a cascading link to shop_items')
  if (!/revoke all on public\.shop_deal_days from anon, authenticated;\s*grant select on public\.shop_deal_days to authenticated;/i.test(sql)) problems.push('deal days: not read-only for the app')
  if (/grant [^;]*(insert|update|delete)[^;]* on public\.shop_deal_days to [^;]*authenticated/i.test(sql)) problems.push('deal days: a write grant for the app')
  if (/on public\.shop_deal_days for (insert|update|delete|all)\b/i.test(sql)) problems.push('deal days: a browser write policy')
  if (/trg_audit[^;]*shop_deal_days/i.test(sql) || !/No audit trigger: not user-authored/.test(src) || !/No user_id: the same days for every account/.test(src)) problems.push('deal days: an audit trigger, or the header does not say why there is no audit or user_id')
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?\n\$\$;/gi)]
  const names = fns.map(([, name]) => name).sort().join()
  if (names !== 'shop_categories_rules,shop_items_rules,shop_price_stats,shop_restore_price_history,shop_signal_dismiss,shop_signal_put,shop_signal_snooze,shop_signal_states_rules') problems.push(`functions ${names}`)
  // 187's shop_items_rules, re-created word for word but for step g (the thing's category is the owner's own).
  const rulesOf = text => (text.match(/create or replace function public\.shop_items_rules\(\)[\s\S]*?\n\$\$;/) || [''])[0]
  const stepG = /\n\n  -- g\. Its category is one of the owner's own[\s\S]*?\n  end if;\n(?=  return new;\nend;\n\$\$;$)/
  const rules190 = rulesOf(src)
  if (!stepG.test(rules190) || rules190.replace(stepG, '\n') !== rulesOf(readFileSync(mig('187_shop_integrity.sql'), 'utf8'))) problems.push('shop_items_rules is not 187\'s with step g')
  if (!/create trigger trg_shop_categories_rules before insert or update on public\.shop_categories/i.test(sql)) problems.push('no parent check on shop_categories')
  if (!/unique nulls not distinct \(user_id, item_id, signal, subject\)/i.test(sql) || /0{8}-0{4}-0{4}-0{4}-0{12}/.test(sql)) problems.push('signal states are not one per key with NULLS NOT DISTINCT (or a nil-uuid stand-in is back)')
  for (const [body, name] of fns) {
    if (!/set search_path = ''/.test(body)) problems.push(`${name} has no search_path ''`)
    if (/security definer/i.test(body) !== (name === 'shop_restore_price_history')) problems.push(`${name}: SECURITY DEFINER ${name === 'shop_restore_price_history' ? 'missing' : 'not expected'}`)
    if (!new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`).test(sql)) problems.push(`no revoke for ${name}`)
    if (/^shop_(signal_(snooze|dismiss|put)|price_stats)$/.test(name)) {
      if (!new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`).test(sql)) problems.push(`${name} not granted to authenticated`)
      if (!/v_user is null or not public\.is_app_user\(\)/.test(body)) problems.push(`${name} does not refuse a caller who is not an app user`)
    }
  }
  if (new RegExp('grant execute on function public\\.shop_restore_price_history\\([^)]*\\) to [^;]*(anon|service_role)').test(sql)) problems.push('the helper is granted wider than authenticated')
  const helper = fns.find(([, name]) => name === 'shop_restore_price_history')?.[0] ?? ''
  if (!/pg_catalog\.split_part\(v_set, '\|', 1\) = v_stamp/.test(helper) || (helper.match(/item_id = any \(v_back\)/g) || []).length !== 2) problems.push('the helper no longer binds itself to the rows Undo put back (app.shop_restored and its stamp)')
  if (!/condition, used_low, refurbished_low, in_stock\)/.test(helper) || !/\n\s*p\.in_stock\n/.test(helper)) problems.push('the helper does not carry in_stock into the points')
  const stats = fns.find(([, name]) => name === 'shop_price_stats')?.[0] ?? ''
  if (!/cardinality\(p_item_ids\), 0\) > 500/.test(stats)) problems.push('the price figures take any number of ids')
  if (!/p\.condition in \('new', 'unknown'\)/.test(stats) || !/p\.low >= 0 and p\.low < 'Infinity'/.test(stats)) problems.push('the price figures read more than clean, finite prices')
  if (!/i\.user_id = v_user/.test(stats) || !/p\.user_id = v_user/.test(stats)) problems.push('the price figures are not scoped to the caller\'s own rows')
  if (problems.length) fail(`migration 190 has ${problems.join('; ')}`)
}

// Static, 192: six tables, each the account's own (user_id with auth.uid() by default, the owner policy with
// (select auth.uid()), row level security right after it, the owner lock at the end, audited, the app and the service
// role granted, signed out nothing); the four about a thing cascade from shop_items; every function pinned, run as the
// caller, revoked from signed out; the resale trigger fires after trg_audit and a listing's thing is checked when the
// transaction ends (Activity's Undo puts a sale's rows back newest first); an ad's link is https only and never a
// column named url (the assistant may write shop_items.url, never an ad's); nothing of 191's (stores) is named; the
// only top-level writes are the seeds.
{
  const src = readFileSync(mig('192_shop_resale.sql'), 'utf8')
  const sql = src.replace(/--.*$/gm, '')
  const problems = []
  const TABLES = ['shop_ad_notes', 'shop_trade_in_quotes', 'shop_value_history', 'shop_listings', 'shop_ad_templates', 'shop_handover_checklists']
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database')
  if (/shop_stores?\b|shop_store_rules|store_id/i.test(sql)) problems.push('a name from migration 191 (stores) — 192 must not depend on it')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== TABLES.join()) problems.push(`creates ${tables.join(', ') || 'no table'} (expected ${TABLES.join(', ')})`)
  for (const t of TABLES) {
    const body = sql.match(new RegExp(`create table if not exists public\\.${t} \\(([\\s\\S]*?)\\n\\);\\s*alter table public\\.${t} enable row level security;`, 'i'))?.[1]
    if (!body) { problems.push(`no row level security right after ${t}`); continue }
    if (!/user_id\s+uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/i.test(body)) problems.push(`${t}: user_id without auth.uid() by default`)
    if (!/^\s*id\s+uuid primary key default gen_random_uuid\(\)/m.test(body)) problems.push(`${t}: not one id primary key (Activity's Undo needs it)`)
    if (!/created_at\s+timestamptz not null default now\(\)/.test(body) || !/updated_at\s+timestamptz not null default now\(\)/.test(body)) problems.push(`${t}: no created_at / updated_at`)
    if (/^\s*url\s/m.test(body)) problems.push(`${t}: a column named url (the assistant may write url — an ad's link is ad_url)`)
    if (t !== 'shop_ad_templates' && t !== 'shop_handover_checklists' && !/item_id\s+uuid not null references public\.shop_items\(id\) on delete cascade/i.test(body)) problems.push(`${t}: item_id is not a cascading link to shop_items`)
    if (/\bad_url\b/.test(body) && !/ad_url ~ '\^https:\/\//.test(body)) problems.push(`${t}: ad_url is not https only`)
    if (!new RegExp(`create policy "Users manage own ${t}" on public\\.${t}\\s+for all using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\) with check \\(\\(select auth\\.uid\\(\\)\\) = user_id\\);`, 'i').test(sql)) problems.push(`${t}: no owner policy with (select auth.uid())`)
    if (!new RegExp(`revoke all on public\\.${t} from anon;\\s*grant select, insert, update, delete on public\\.${t} to authenticated;\\s*grant select, insert, update, delete on public\\.${t} to service_role;`, 'i').test(sql)) problems.push(`${t}: grants are not the app's and the service role's, anon revoked`)
    if (new RegExp(`on public\\.${t} to [^;]*anon`, 'i').test(sql)) problems.push(`${t}: a grant to anon`)
    if (!new RegExp(`create trigger trg_audit after insert or update or delete on public\\.${t}\\s+for each row execute function public\\.log_audit\\(\\);`, 'i').test(sql)) problems.push(`${t}: no audit trigger`)
    if (!new RegExp(`select public\\.owner_lock_apply\\('public\\.${t}'\\);`, 'i').test(sql)) problems.push(`no owner_lock_apply for ${t}`)
  }
  if (!/(select public\.owner_lock_apply\('public\.\w+'\);\s*){6}$/i.test(sql)) problems.push('the owner lock is not the last thing it does')
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?\n\$\$;/gi)]
  const names = fns.map(([, name]) => name).sort().join()
  if (names !== 'shop_add_resale_defaults,shop_items_resale,shop_items_value_first,shop_link_on_host,shop_listings_rules,shop_listings_thing_check,shop_resale_default_checklists,shop_resale_default_templates,shop_resale_rows_rules') problems.push(`functions ${names}`)
  for (const [body, name] of fns) {
    if (!/set search_path = ''/.test(body)) problems.push(`${name} has no search_path ''`)
    if (/security definer/i.test(body)) problems.push(`${name}: SECURITY DEFINER (every 192 function runs as the caller)`)
    if (!new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`).test(sql)) problems.push(`no revoke for ${name}`)
  }
  if (!/grant execute on function public\.shop_add_resale_defaults\(\) to authenticated;/.test(sql)) problems.push('shop_add_resale_defaults not granted to authenticated')
  if (!/v_user is null or not public\.is_app_user\(\)/.test(fns.find(([, n]) => n === 'shop_add_resale_defaults')?.[0] ?? '')) problems.push('shop_add_resale_defaults does not refuse a caller who is not an app user')
  const trig = sql.match(/create trigger (\w+) after update on public\.shop_items\s+for each row execute function public\.shop_items_resale\(\);/i)?.[1]
  if (!trig || !(trig > 'trg_audit')) problems.push(`the resale trigger on shop_items (${trig ?? 'none'}) does not sort after trg_audit`)
  if (!/create constraint trigger trg_shop_items_value_first after insert on public\.shop_items\s+deferrable initially deferred\s+for each row execute function public\.shop_items_value_first\(\);/i.test(sql)
      || !/on conflict \(item_id, valued_on\) do nothing;/.test(fns.find(([, n]) => n === 'shop_items_value_first')?.[0] ?? '')) problems.push('a new thing\'s first estimate is not recorded when the transaction ends, after a restore\'s own rows')
  if (!/create constraint trigger trg_shop_listings_thing after insert or update on public\.shop_listings\s+deferrable initially deferred\s+for each row execute function public\.shop_listings_thing_check\(\);/i.test(sql)) problems.push('a listing\'s thing is not checked when the transaction ends (a deferred constraint trigger)')
  const rules = fns.find(([, n]) => n === 'shop_listings_rules')?.[0] ?? ''
  if (/disposal/.test(rules)) problems.push('the listing\'s before-trigger reads how the thing left (Activity\'s Undo passes a moment where the listing is back before the thing — that check is the deferred one)')
  const top = sql.replace(/\$\$[\s\S]*?\$\$/g, '')
  const writes = [...top.matchAll(/^(insert into|update|delete from) (public\.\w+)/gim)].map(m => m[2])
  if (writes.join() !== 'public.shop_ad_templates,public.shop_handover_checklists') problems.push(`top-level writes to ${writes.join(', ') || 'nothing'} (expected only the two seeds)`)
  if (problems.length) fail(`migration 192 has ${problems.join('; ')}`)
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
  step('188', () => psql(n, ['-f', mig('188_shop_site_policies.sql')]))
  step('188 again', () => psql(n, ['-f', mig('188_shop_site_policies.sql')]))
  step('links across accounts from before 190', () => psql(n, ['-f', join(dir, 'cross-account-old.sql')]))
  step('190', () => psql(n, ['-f', mig('190_shop_needs_a_look.sql')]))
  step('190 again', () => psql(n, ['-f', mig('190_shop_needs_a_look.sql')]))
  step('192', () => psql(n, ['-f', mig('192_shop_resale.sql')]))
  step('192 again', () => psql(n, ['-f', mig('192_shop_resale.sql')]))
  let passed = 0
  for (const file of ['scenarios.sql', 'site-policies.sql', 'signals.sql', 'resale.sql']) {
    const sc = run(n, join(dir, file))
    passed += (sc.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
    if (sc.status !== 0) throw Object.assign(new Error(`${file} failed`), { stderr: sc.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  }
  summary = `${BUGS.length} bugs shown without 187 and fixed with it (applied twice), then 188, 190 and 192 (twice each), and ${passed} scenarios passed`
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
