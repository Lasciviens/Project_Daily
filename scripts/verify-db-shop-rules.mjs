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
//     cross-account-old.sql plants old links across accounts before 190, which 190 must cut), with 191 and 192
//     twice each before them; then stores.sql (191: stores, marketplaces and their rules, Norway's law, deal days the
//     owner edits) and stores-reseed.sql (a later seed never writes over the owner's edit), and
//     resale.sql (192: ad notes, trade-in quotes, the value history, listings and how a sale closes them, the ad
//     templates and hand-over checklists with their Norwegian and English defaults, each account its own rows, links
//     never fetched and https only, Activity's Undo of an estimate and of a sale with its listing, Delete's Undo
//     bringing every row back, deleting an account), and undo-retry.sql — Activity's Undo of a Shop delete of a thing
//     with an extra cost and a snoozed Needs-a-look row, which must fail on a copy taken before 192 (187's and 190's
//     rules refused those rows with 23514 before their thing was back) and pass after it, and Delete's Undo of the
//     same, which passes on both; and the shared ad-link cases (scripts/fixtures/shop-ad-links.json — U+202E,
//     U+200B, U+00A0, U+0085 …) through 192's real CHECK, as typed and as the URL parser writes them (what the app
//     sends): verify-shop-resale checks the app's pattern on the same cases, so the two allow-lists match.
// Static checks of 187, 188, 190, 191 and 192 first.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-shop-rules.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// Static, 191: four tables, each with row level security right after it and the owner lock at the end; stores, rules
// and deal-day edits are the owner's own rows (the owner policy with (select auth.uid()), audited, the app writes
// them), the law is reference data like 188's (the app reads, only the service role writes, no audit or user_id —
// each with the header's reason); every function pinned to search_path '', running as the caller but for the one
// trigger that seeds a new account; the seed and the triggers granted to nobody, the resets to signed-in callers only;
// owner_edited derived in both rules triggers, never taken from the write; the seeds only what has a source.
{
  const src = readFileSync(mig('191_shop_stores_rules.sql'), 'utf8')
  const sql = src.replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (/^(update|delete from) /im.test(sql)) problems.push('a top-level update or delete (191 only adds rows: the seeds)')
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
  if (tables.join() !== 'shop_stores,shop_store_rules,shop_law_rules,shop_deal_day_edits') problems.push(`creates ${tables.join(', ') || 'no table'}`)
  for (const t of tables) {
    if (!new RegExp(`create table if not exists public\\.${t} \\([\\s\\S]*?\\n\\);\\s*alter table public\\.${t} enable row level security;`, 'i').test(sql)) problems.push(`no row level security right after ${t}`)
    if (!new RegExp(`select public\\.owner_lock_apply\\('public\\.${t}'\\);`, 'i').test(sql)) problems.push(`no owner_lock_apply for ${t}`)
    if (new RegExp(`on public\\.${t} to [^;]*anon`, 'i').test(sql)) problems.push(`a grant to anon on ${t}`)
    if (!new RegExp(`grant select, insert, update, delete on public\\.${t} to service_role;`, 'i').test(sql)) problems.push(`no service-role grant on ${t}`)
  }
  for (const t of ['shop_stores', 'shop_store_rules', 'shop_deal_day_edits']) {
    const body = sql.match(new RegExp(`create table if not exists public\\.${t} \\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1] ?? ''
    if (!/user_id\s+uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/i.test(body)) problems.push(`${t}: user_id without auth.uid() by default`)
    if (!new RegExp(`create policy "Users manage own ${t}" on public\\.${t}\\s+for all using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\) with check \\(\\(select auth\\.uid\\(\\)\\) = user_id\\);`, 'i').test(sql)) problems.push(`${t}: no owner policy with (select auth.uid())`)
    if (!new RegExp(`revoke all on public\\.${t} from anon;\\s*grant select, insert, update, delete on public\\.${t} to authenticated;`, 'i').test(sql)) problems.push(`${t}: the app does not read and write it, or anon is not revoked`)
    if (!new RegExp(`create trigger trg_audit after insert or update or delete on public\\.${t}\\s+for each row execute function public\\.log_audit\\(\\);`, 'i').test(sql)) problems.push(`${t}: no audit trigger`)
  }
  if (!/revoke all on public\.shop_law_rules from anon, authenticated;\s*grant select on public\.shop_law_rules to authenticated;/i.test(sql)) problems.push('the law: not read-only for the app')
  if (/grant [^;]*(insert|update|delete)[^;]* on public\.shop_law_rules to [^;]*authenticated/i.test(sql) || /on public\.shop_law_rules for (insert|update|delete|all)\b/i.test(sql)) problems.push('the law: a browser write')
  if (/trg_audit[^;]*shop_law_rules/i.test(sql) || !/No audit trigger: not user-authored/.test(src) || !/No user_id: the law is the same for every account/.test(src)) problems.push('the law: an audit trigger, or the header does not say why there is no audit or user_id')
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?\n\$\$;/gi)]
  const names = fns.map(([, name]) => name).sort().join()
  if (names !== 'shop_host_ok,shop_host_on,shop_hosts_ok,shop_https_ok,shop_item_facts_ok,shop_items_rules,shop_link_host,shop_month_day_ok,shop_new_offers_ok,shop_one_line,shop_plain_text_ok,shop_restore_price_history,shop_search_url_ok,shop_store_facts,shop_store_reset,shop_store_rule_facts,shop_store_rule_reset,shop_store_rules_rules,shop_store_seed,shop_store_seed_new_user,shop_stores_rules') problems.push(`functions ${names}`)
  const definer = new Set(['shop_store_seed_new_user', 'shop_restore_price_history'])
  for (const [body, name] of fns) {
    if (!/set search_path = ''/.test(body)) problems.push(`${name} has no search_path ''`)
    if (/security definer/i.test(body) !== definer.has(name)) problems.push(`${name}: SECURITY DEFINER ${definer.has(name) ? 'missing' : 'not expected'}`)
    if (!new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`).test(sql)) problems.push(`no revoke for ${name}`)
  }
  // 190's shop_items_rules, re-created word for word but for step h (a purchase's own facts), and 190's Undo helper
  // with new_offers on the watch — still bound to the rows Undo put back, granted to signed-in callers only.
  const fnOf = (text, name) => (text.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`)) || [''])[0]
  const src190 = readFileSync(mig('190_shop_needs_a_look.sql'), 'utf8')
  const stepH = /\n\n  -- h\. The purchase's own facts \(191\)[\s\S]*?\n  new\.receipt_note := nullif\(pg_catalog\.btrim\(new\.receipt_note\), ''\);\n(?=  return new;\nend;\n\$\$;$)/
  const rules191 = fnOf(src, 'shop_items_rules')
  if (!stepH.test(rules191) || rules191.replace(stepH, '\n') !== fnOf(src190, 'shop_items_rules')) problems.push('shop_items_rules is not 190\'s with step h')
  const helper191 = fnOf(src, 'shop_restore_price_history')
  const helper190 = fnOf(src190, 'shop_restore_price_history')
  if (helper191.replace('condition, used_low, refurbished_low, new_offers)', 'condition, used_low, refurbished_low)')
        .replace(",\n         case when public.shop_new_offers_ok(w.new_offers) then w.new_offers end\n", '\n') !== helper190) problems.push('shop_restore_price_history is not 190\'s with new_offers')
  if (!/revoke all on function public\.shop_restore_price_history\(jsonb, jsonb\) from public, anon, authenticated, service_role;\s*grant execute on function public\.shop_restore_price_history\(jsonb, jsonb\) to authenticated;/.test(sql)) problems.push('the Undo helper is not granted to signed-in callers only')
  const signals190 = (src190.match(/signal\s+text not null check \(signal in \(([\s\S]*?)\)\),/) || [])[1]?.replace(/\s+/g, ' ')
  const signals191 = (sql.match(/add constraint shop_signal_states_signal_check check \(signal in \(([\s\S]*?)\)\);/) || [])[1]?.replace(/\s+/g, ' ')
  if (!signals190 || signals191?.trim() !== `${signals190.trim()}, 'price_match'`) problems.push(`the signal list is not 190's with price_match (${signals191})`)
  for (const [col, check] of [['bought_channel', "bought_channel in ('online', 'in_store')"], ['arrived_on', "arrived_on >= date '2000-01-01'"],
    ['extra_warranty_until', "extra_warranty_until >= date '2000-01-01'"], ['receipt_note', 'char_length(receipt_note) between 1 and 2000'],
    ['search_opened_on', "search_opened_on >= date '2000-01-01'"], ['facts', 'check (public.shop_item_facts_ok(facts))']]) {
    if (!new RegExp(`alter table public\\.shop_items add column if not exists ${col} `).test(sql) || !sql.includes(check)) problems.push(`shop_items.${col} has no column or no check`)
  }
  if (!/add constraint shop_price_watch_new_offers_check check \(public\.shop_new_offers_ok\(new_offers\)\);/.test(sql)) problems.push('new_offers is not checked')
  // Free text shown beside a source can't pass for one (guardian review, 10.11.2026): one line, no control, zero-width or
  // direction characters — on every column the screens show, whoever writes it.
  for (const [table, cols] of [['shop_stores', ['name', 'member_tier', 'ad_template']], ['shop_store_rules', ['label', 'member_tier', 'words']], ['shop_deal_day_edits', ['name']]]) {
    const body = sql.match(new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1] ?? ''
    for (const col of cols) if (!new RegExp(`\\n  ${col}\\s+text[^\\n]*public\\.shop_plain_text_ok\\(${col}(, true)?\\)`).test(body)) problems.push(`${table}.${col} is not plain text`)
  }
  // Every role but authenticated, anon and service_role is the trusted door of 191's triggers, and a SECURITY DEFINER
  // function runs as its owner: none may write the stores or their rules but the new account's seed (any migration).
  for (const f of readdirSync(join(root, 'supabase/migrations')).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
    const text = readFileSync(mig(f), 'utf8').replace(/--.*$/gm, '')
    for (const [body, name] of text.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\n\$\$;/gi)) {
      if (/security definer/i.test(body) && /\bshop_store(s|_rules)\b/.test(body) && name !== 'shop_store_seed_new_user') problems.push(`${f}: ${name} is SECURITY DEFINER and names the stores' tables (it would write as the trusted door)`)
    }
  }
  for (const name of ['shop_stores_rules', 'shop_store_rules_rules', 'shop_store_seed_new_user', 'shop_store_seed', 'shop_items_rules']) {
    if (!new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated, service_role;`).test(sql)
        || new RegExp(`grant execute on function public\\.${name}\\(`).test(sql)) problems.push(`${name} is callable by a role`)
  }
  for (const name of ['shop_store_rule_reset', 'shop_store_reset']) {
    const body = fns.find(([, n]) => n === name)?.[0] ?? ''
    if (!new RegExp(`grant execute on function public\\.${name}\\(uuid\\) to authenticated;`).test(sql)) problems.push(`${name} not granted to authenticated`)
    if (new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to [^;]*(anon|service_role)`).test(sql)) problems.push(`${name} granted wider than the app`)
    if (!/v_user is null or not public\.is_app_user\(\)/.test(body) || !/user_id = v_user/.test(body)) problems.push(`${name} is not scoped to an app user's own row`)
  }
  for (const name of ['shop_stores_rules', 'shop_store_rules_rules']) {
    const body = fns.find(([, n]) => n === name)?.[0] ?? ''
    if (!/new\.owner_edited := new\.origin = 'owner'\s+or \(new\.source_facts is not null and public\.shop_store(_rule)?_facts\(new\) is distinct from new\.source_facts\);/.test(body)) problems.push(`${name} does not derive owner_edited from the source`)
    if (!/v_door\s+text\s*:= case when current_user in \('authenticated', 'anon'\) then 'owner'\s+when current_user = 'service_role' then 'service' else 'trusted' end;/.test(body)) problems.push(`${name} does not tell its doors apart by role`)
  }
  const seed = fns.find(([, n]) => n === 'shop_store_seed')?.[0] ?? ''
  if ((seed.match(/if v_(r)?old\.owner_edited then/g) || []).length !== 2) problems.push('the seed writes facts over an owner\'s edit')
  const storeSeeds = [...seed.matchAll(/\n {4}\('([a-z_]+)', '\{"kind"/g)].map(m => m[1])
  if (storeSeeds.join() !== 'prisjakt,finn,tise,elkjop,power,jernia,komplett,proshop,clas_ohlson,xxl,jula,dustin') problems.push(`store seeds ${storeSeeds.join()}`)
  // Each rule seed's source: the store's own site (origin seed), or Prisjakt's page about it (origin price_site —
  // "from Prisjakt — check it", owner 11.11.2026), with the day it was read.
  const storeHost = new Map([...seed.matchAll(/\n {4}\('([a-z_]+)', '\{"kind"[\s\S]*?"hosts": \["([a-z0-9.-]+)"/g)].map(m => [m[1], m[2]]))
  const ruleSeeds = [...seed.matchAll(/\n {4}\('([a-z_]+)', '([a-z_]+)', '(seed|price_site)', '\{([\s\S]*?)\}'::jsonb\)/g)]
  if (ruleSeeds.map(m => `${m[1]}:${m[3]}`).join() !== 'elkjop_open_purchase:seed,elkjop_open_purchase_club:seed,elkjop_christmas_club:seed,elkjop_price_match:seed,'
    + 'power_return:seed,power_open_purchase_prisjakt:price_site,jernia_open_purchase:seed,xxl_open_purchase:seed,xxl_christmas:seed,'
    + 'komplett_price_match_prisjakt:price_site,clas_ohlson_open_purchase_prisjakt:price_site') problems.push(`rule seeds ${ruleSeeds.map(m => `${m[1]}:${m[3]}`).join()}`)
  for (const [, key, store, origin, body] of ruleSeeds) {
    const host = origin === 'seed' ? storeHost.get(store) : storeHost.get('prisjakt')
    const src = body.match(/"source_url": "https:\/\/(?:www\.)?([a-z0-9.-]+)\//)?.[1]
    if (!host || src !== host || !/"read_on": "2026-11-1[01]"/.test(body)) problems.push(`the rule seed ${key} has no source on ${origin === 'seed' ? 'its store\'s own site' : 'Prisjakt'} or no read day`)
  }
  if (problems.length) fail(`migration 191 has ${problems.join('; ')}`)
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
  if (names !== 'shop_add_resale_defaults,shop_item_costs_rules,shop_items_resale,shop_items_value_first,shop_link_on_host,shop_listings_rules,shop_listings_thing_check,shop_resale_default_checklists,shop_resale_default_templates,shop_resale_rows_rules,shop_signal_states_rules') problems.push(`functions ${names}`)
  // 187's and 190's rules, word for word but for the code of the "not one of your own" refusal (23514 → 23503).
  for (const [file, name, refusal] of [['187_shop_integrity.sql', 'shop_item_costs_rules', 'A cost belongs to one of your own items'],
                                       ['190_shop_needs_a_look.sql', 'shop_signal_states_rules', 'Needs a look remembers only your own things']]) {
    const fnOf = text => (text.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\n\\$\\$;`)) || [''])[0]
    const was = fnOf(readFileSync(mig(file), 'utf8'))
    const refuse = code => `raise exception '${refusal}' using errcode = '${code}';`
    if (!was.includes(refuse('23514')) || fnOf(src) !== was.replace(refuse('23514'), refuse('23503'))) problems.push(`${name} is not ${file.slice(0, 3)}'s with 23503 for a thing not (yet) yours`)
  }
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

/** A later migration's seed: 191 with Elkjøp's open purchase at 45 days, its search link /sok, and a new store with a rule. */
function reseedSql() {
  const swaps = [
    ['"kind": "open_purchase", "days": 30,', '"kind": "open_purchase", "days": 45,'],
    ['"search_url": "https://www.elkjop.no/search?q={q}"', '"search_url": "https://www.elkjop.no/sok?q={q}"'],
    ["    ('dustin', '{", `    ('nordisk', '{"kind": "shop", "name": "Nordisk", "country": "NO", "currency": "NOK", "hosts": ["nordisk.example"], "source_url": "https://nordisk.example/"}'::jsonb),\n    ('dustin', '{`],
    ["    ('power_return', 'power',", `    ('nordisk_return', 'nordisk', 'seed', '{"kind": "return", "days": 30, "source_url": "https://nordisk.example/retur", "read_on": "2026-11-10"}'::jsonb),\n    ('power_return', 'power',`],
  ]
  let text = readFileSync(mig('191_shop_stores_rules.sql'), 'utf8')
  for (const [from, to] of swaps) {
    if (!text.includes(from)) fail(`the later seed can't be written: 191 no longer has ${from}`)
    text = text.replace(from, to)
  }
  return text
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
/** undo-retry.sql's answers: id → 'ok' | 'WRONG'. */
const retryAnswers = (target) => {
  const r = run(target, join(dir, 'undo-retry.sql'))
  if (r.status !== 0) throw Object.assign(new Error('undo-retry.sql stopped'), { stderr: r.stderr })
  const out = new Map()
  for (const m of r.stderr.matchAll(/NOTICE: {2}retry (\S+) {2}(ok|WRONG) {2}(.*)/g)) out.set(m[1], { answer: m[2], what: m[3] })
  return out
}
const RETRY = ['activity_both', 'activity_cost', 'activity_signal', 'delete_undo']
/** The cases only 192 fixes (Delete's Undo passes before it too: it puts the thing back before its rows). */
const RETRY_FIXED_BY_192 = ['activity_both', 'activity_cost', 'activity_signal']

/** A string as a Unicode-escaped SQL literal: anything outside printable ASCII as \XXXX, so nothing is lost on the way. */
const sqlText = s => `U&'${[...s].map(ch => {
  const c = ch.codePointAt(0)
  if (ch === "'") return "''"
  if (ch === '\\') return '\\\\'
  if (c >= 0x20 && c < 0x7f) return ch
  return c > 0xffff ? `\\+${c.toString(16).padStart(6, '0')}` : `\\${c.toString(16).padStart(4, '0')}`
}).join('')}'`
/** The shared ad-link cases, with one over 2 048 characters. */
const LINK_CASES = [...JSON.parse(readFileSync(join(root, 'scripts/fixtures/shop-ad-links.json'), 'utf8')).cases,
  { raw: 'https://finn.no' + '/x'.repeat(1030), stored: false, accepted: false, why: 'over 2 048 characters' }]
const hrefOf = raw => { try { return new URL(raw.trim()).href } catch { return null } }
/** 192's CHECK on each case (as typed, and as the URL parser writes it): [i, raw taken, href taken | null]. */
const linkAnswers = (target) => {
  const file = join(tmpdir(), `shop-ad-links-${process.pid}.sql`)
  writeFileSync(file, [
    "insert into public.shop_items (id, user_id, title, status) values ('d2f00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Link cases', 'bought') on conflict do nothing;",
    `create or replace function public.t_link(p_i integer, p_raw text, p_href text) returns void language plpgsql as $$
     declare q constant text := 'insert into public.shop_ad_notes (item_id, ad_url, price) values (%L, %L, 1)';
     begin
       raise notice 'link %  raw:%  href:%', p_i,
         case when public.t_err(format(q, 'd2f00000-0000-0000-0000-000000000001', p_raw)) = 'done' then 'yes' else 'no' end,
         case when p_href is null then 'none' when public.t_err(format(q, 'd2f00000-0000-0000-0000-000000000001', p_href)) = 'done' then 'yes' else 'no' end;
     end $$;`,
    'grant execute on function public.t_link(integer, text, text) to authenticated;',
    'begin;', 'set local role authenticated;',
    ...LINK_CASES.map((c, i) => { const h = hrefOf(c.raw); return `select public.t_link(${i}, ${sqlText(c.raw)}, ${h === null ? 'null' : sqlText(h)});` }),
    'rollback;',
  ].join('\n'))
  try {
    const r = run(target, file)
    if (r.status !== 0) throw Object.assign(new Error('the ad-link cases stopped'), { stderr: r.stderr })
    return [...r.stderr.matchAll(/NOTICE: {2}link (\d+) {2}raw:(yes|no) {2}href:(yes|no|none)/g)].map(m => [Number(m[1]), m[2] === 'yes', m[3] === 'none' ? null : m[3] === 'yes'])
  } finally {
    unlinkSync(file)
  }
}

/** bugs.sql's answers: id → 'ok' | 'WRONG'. */
const bugAnswers = (target) => {
  const r = run(target, join(dir, 'bugs.sql'))
  if (r.status !== 0) throw Object.assign(new Error('bugs.sql stopped'), { stderr: r.stderr })
  const out = new Map()
  for (const m of r.stderr.matchAll(/NOTICE: {2}bug (\S+) {2}(ok|WRONG) {2}(.*)/g)) out.set(m[1], { answer: m[2], what: m[3] })
  return out
}

const pid = process.pid
const tpl = `t187tpl_${pid}`, old = `t187old_${pid}`, neu = `t187new_${pid}`, pre = `t187pre_${pid}`
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
  step('191', () => psql(n, ['-f', mig('191_shop_stores_rules.sql')]))
  step('191 again', () => psql(n, ['-f', mig('191_shop_stores_rules.sql')]))
  // Before 192 (a copy, 191 in place as the deploy has it): Activity's Undo of those deletes must fail — else the
  // scenario proves nothing.
  psql(url, ['-c', `create database ${pre} template ${neu}`])
  const pre192 = retryAnswers(withDb(url, pre))
  psql(url, ['-c', `drop database if exists ${pre}`])
  if (RETRY.some(id => !pre192.has(id))) throw new Error(`undo-retry.sql answered ${[...pre192.keys()].join(', ')} before 192 — expected ${RETRY.join(', ')}`)
  const passingAlready = RETRY_FIXED_BY_192.filter(id => pre192.get(id).answer === 'ok')
  if (passingAlready.length) throw new Error(`without 192 these Undo cases already pass, so they prove nothing: ${passingAlready.join(', ')}`)
  if (pre192.get('delete_undo').answer !== 'ok') throw new Error(`before 192 Delete's Undo failed too: ${pre192.get('delete_undo').what}`)
  step('192', () => psql(n, ['-f', mig('192_shop_resale.sql')]))
  step('192 again', () => psql(n, ['-f', mig('192_shop_resale.sql')]))
  let passed = 0
  const scenarios = file => {
    const sc = run(n, join(dir, file))
    passed += (sc.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
    if (sc.status !== 0) throw Object.assign(new Error(`${file} failed`), { stderr: sc.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  }
  for (const file of ['scenarios.sql', 'site-policies.sql', 'signals.sql']) scenarios(file)
  // signals.sql runs 190 again over old prices, which puts back 190's versions of what 191 and 192 re-create: 191 and
  // then 192 run again in the deploy's order over the data the scenarios left (a re-run must be safe there too, and a
  // third run of 192 a no-op), then their own scenarios.
  step('191 after 190 ran again', () => psql(n, ['-f', mig('191_shop_stores_rules.sql')]))
  step('192 after 190 ran again', () => psql(n, ['-f', mig('192_shop_resale.sql')]))
  scenarios('stores.sql')
  // A later migration's seed: 191 again with changed facts (RESEED), then what it changed.
  step('a later seed', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'reseed-'))
    try {
      writeFileSync(join(tmp, 'reseed.sql'), reseedSql())
      psql(n, ['-f', join(tmp, 'reseed.sql')])
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  })
  scenarios('stores-reseed.sql')
  scenarios('resale.sql')
  const with192 = retryAnswers(n)
  const stillFailing = RETRY.filter(id => with192.get(id)?.answer !== 'ok')
  if (stillFailing.length) throw new Error(`with 192 these Undo cases still fail:\n${stillFailing.map(id => `  ${id}: ${with192.get(id)?.what ?? 'no answer'}`).join('\n')}`)
  const links = linkAnswers(n)
  const wrongLinks = LINK_CASES.map((c, i) => [c, links.find(l => l[0] === i)]).filter(([c, a]) => !a || a[1] !== c.stored || (a[2] ?? false) !== c.accepted)
  if (links.length !== LINK_CASES.length || wrongLinks.length) {
    throw new Error(`192's ad-link CHECK disagrees with the shared cases on ${wrongLinks.map(([c, a]) => `${JSON.stringify(c.raw).slice(0, 40)} (${c.why}: as typed ${a?.[1]}, sent ${a?.[2]})`).join('; ') || `${links.length} answers`}`)
  }
  summary = `${BUGS.length} bugs shown without 187 and fixed with it (applied twice), then 188, 190, 191 and 192 (twice each; 191 and 192 once more after signals.sql re-runs 190, and 191 with a later seed), ${passed} scenarios passed, `
    + `${RETRY_FIXED_BY_192.length} Undo cases failing before 192 pass with it (${RETRY.length - RETRY_FIXED_BY_192.length} passing on both), `
    + `and 192's ad-link check agrees with the ${LINK_CASES.length} shared cases`
} catch (e) {
  code = 1
  console.error(`verify-db-shop-rules: ${e.message}`)
  if (e.stderr) console.error(e.stderr.toString().split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE|DETAIL/.test(l)).slice(0, 20).join('\n'))
} finally {
  for (const db of [pre, neu, old, tpl]) {
    try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
  }
}
if (code) process.exit(code)
console.log(`verify-db-shop-rules: ${summary}`)
