// Runs migration 215's scenarios (an item's category add-on fields: tasks.details, its allow-list for every writer, the
// item save with its details, whose they are, nothing sent outside, delete and Activity's Undo) on a throwaway Postgres
// built as verify-db-linked-plans builds it — the live item chain (135–193), task-links/seed.sql, 210,
// linked-plans/seed.sql, 211 — then the real 215 twice and scripts/db-tests/item-details/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-item-details.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig210 = mig('210_task_links.sql')
const mig211 = mig('211_linked_plans.sql')
const mig215 = mig('215_item_details.sql')
const fail = msg => { console.error(`verify-db-item-details: ${msg}`); process.exit(1) }
// Every Unicode format character (Cf) this Node knows, as code points and as 215's regex class.
const CF_POINTS = []
for (let c = 0; c <= 0x10ffff; c++) if ((c < 0xd800 || c > 0xdfff) && /\p{Cf}/u.test(String.fromCodePoint(c))) CF_POINTS.push(c)
const cfClass = () => {
  const esc = c => (c <= 0xffff ? `\\u${c.toString(16).toUpperCase().padStart(4, '0')}` : `\\U${c.toString(16).toUpperCase().padStart(8, '0')}`)
  const out = []
  for (let i = 0; i < CF_POINTS.length; i++) {
    let j = i
    while (j + 1 < CF_POINTS.length && CF_POINTS[j + 1] === CF_POINTS[j] + 1) j++
    out.push(CF_POINTS[i] === CF_POINTS[j] ? esc(CF_POINTS[i]) : `${esc(CF_POINTS[i])}-${esc(CF_POINTS[j])}`)
    i = j
  }
  return `[${out.join('')}]`
}
const listOf = (text, re) => [...(text.match(re)?.[1] ?? '').matchAll(/'([A-Za-z_]+)'/g)].map(m => m[1]).sort().join(',')

// Static: one transaction, nothing outside the database, no table, invoker rights, the lists the browser shares.
{
  const sql = readFileSync(mig215, 'utf8').replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/\bnet\.http_|vault\.|googleapis|icloud_enqueue|google_tasks_outbox/i.test(sql)) problems.push('a call or a queue outside the database')
  if (/create table/i.test(sql)) problems.push('a new table (215 is one column of tasks)')
  if (/security definer/i.test(sql)) problems.push('a SECURITY DEFINER function (215 acts with the caller\'s rights)')
  if (/drop (table|column|function)/i.test(sql)) problems.push('a drop')
  if (/create or replace function public\.app_save_item\(p_item jsonb(, p_link jsonb)?\)/.test(sql)) problems.push('a change of the 1- or 2-argument save (215 only adds the details around them)')
  for (const f of sql.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)) {
    const args = f[2].replace(/\bp_?\w*\s+(?=jsonb|integer|text)/g, '').trim()
    if (!sql.includes(`grant execute on function ${f[1]}(${args})`)) problems.push(`no grant for ${f[1]}(${args})`)
    if (!sql.includes(`revoke all on function ${f[1]}(${args})`)) problems.push(`no revoke for ${f[1]}(${args})`)
    const body = sql.slice(f.index, sql.indexOf('$$;', f.index))
    if (!/set search_path = ''/.test(body)) problems.push(`${f[1]} without search_path ''`)
  }
  // The browser's copy of the rule (items/categoryDetails.ts) names the same lists and limits.
  const ts = readFileSync(join(root, 'src/features/items/categoryDetails.ts'), 'utf8')
  const pairs = [
    ['categories', listOf(sql, /p ->> 'category' in \(([^)]+)\)/), listOf(readFileSync(join(root, 'src/features/daily/types.ts'), 'utf8'), /export type TimeBlockCategory = ([^\n]+)/)],
    ['media types', [...sql.matchAll(/'"([a-z]+)"'::jsonb/g)].map(m => m[1]).filter(x => ['movie', 'tv', 'cinema'].includes(x)).sort().join(','), listOf(ts, /export const MEDIA_TYPES = \[([^\]]+)\]/)],
    ['currencies', [...sql.matchAll(/'"([A-Z]{3})"'::jsonb/g)].map(m => m[1]).sort().join(','), listOf(ts, /export const DETAIL_CURRENCIES = \[([^\]]+)\]/)],
  ]
  for (const [what, db, browser] of pairs) if (!db || db !== browser) problems.push(`the ${what} differ: database ${db}, browser ${browser}`)
  const limits = ts.match(/export const DETAIL_LIMITS = \{([^}]+)\}/)?.[1] ?? ''
  const lim = k => Number(limits.match(new RegExp(`${k}: ([0-9_]+)`))?.[1]?.replace(/_/g, ''))
  const want = { name: 40, names: 10, text: 60, on: 30, amount: 1000000 }
  for (const [k, v] of Object.entries(want)) if (lim(k) !== v) problems.push(`DETAIL_LIMITS.${k} is ${lim(k)}, the database's ${v}`)
  if (!/task_details_text_ok\(n, 40\)/.test(sql) || !/between 1 and 10/.test(sql) || !/task_details_text_ok\(p -> 'seats', 60\)/.test(sql)
      || !/task_details_text_ok\(p -> 'on', 30\)/.test(sql) || !/task_details_text_ok\(p -> 'cinema', 60\)/.test(sql)
      || !/between 0 and 1000000/.test(sql)) problems.push('a limit in 215 moved (40 / 10 / 60 / 30 / 1 000 000)')
  if (!sql.includes(`!~ '${cfClass()}'`)) problems.push(`215's format characters differ from Unicode's Cf as Node knows it (${CF_POINTS.length} code points): ${cfClass()}`)
  if (!/const INVISIBLE = \/\\p\{Cf\}\/u/.test(ts)) problems.push('categoryDetails.cleanText does not refuse every format character (/\\p{Cf}/u)')
  // "Cost not toward my spending no." (owner, 27.11.2026): no money read names a task's details.
  const money = ['src/features/shop', 'src/features/daily/monthLines.ts'].flatMap(p => {
    const full = join(root, p)
    try { return readdirSync(full, { recursive: true }).filter(f => /\.tsx?$/.test(String(f))).map(f => join(full, String(f))) } catch { return [full] }
  })
  for (const f of money) if (/\bdetails\b[^\n]*\bcost\b|\btasks\b[^\n]*\bdetails\b/.test(readFileSync(f, 'utf8'))) problems.push(`${f} reads a task's details (never spending)`)
  const laterSql = readdirSync(join(root, 'supabase/migrations')).filter(f => /^\d+_.*\.sql$/.test(f) && f > '215').map(f => readFileSync(mig(f), 'utf8'))
  if (laterSql.some(t => /details\s*->\s*'cost'|details\s*#>/.test(t))) problems.push('a later migration reads the details\' cost')
  if (problems.length) fail(`migration 215 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-item-details: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-item-details: no ${what} in ${file}`)
  return m[1] ?? m[0]
}
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
const runScenarios = (target, file) => {
  // The scenarios try every format character Node knows against 215's copy (:'cf').
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-v', `cf={${CF_POINTS.join(',')}}`, '-q', '-f', file], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  return passed
}

// The live chain (verify-db-item-calendar-fields'), up to and with 193.
const skips = `${section('112_training_skips.sql', /CREATE TABLE IF NOT EXISTS public\.training_skips[\s\S]*?\n\);/, 'training_skips')}
alter table public.training_skips enable row level security;
create policy own on public.training_skips for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.training_skips to authenticated;`
const ruleSection = section('160_supplement_schedules.sql', /-- <repeat-rule>\n([\s\S]*?)-- <\/repeat-rule>/, '<repeat-rule> section')
const googleTasks = [
  section('071_google_tasks_integration.sql', /CREATE OR REPLACE FUNCTION public\.google_task_status_bucket\(p_status TEXT\)[\s\S]*?\n\$\$;/, 'google_task_status_bucket'),
  section('071_google_tasks_integration.sql', /CREATE OR REPLACE FUNCTION public\.stamp_google_local_edit\(\)[\s\S]*?\n\$\$;/, 'stamp_google_local_edit'),
  section('140_security_fixes.sql', /CREATE OR REPLACE FUNCTION public\.enqueue_google_tasks_outbox\(\)[\s\S]*?\n\$function\$;/, 'enqueue_google_tasks_outbox'),
  `create or replace function public.effective_user_id(p_user_id uuid) returns uuid language sql stable as $$
  select case when auth.role() = 'service_role' then p_user_id else auth.uid() end
$$;`,
].join('\n')
const bookkeeping160 = section('160_supplement_schedules.sql', /create or replace function public\.app_undo_bookkeeping\(p_table text\)[\s\S]*?\n\$\$;/, 'app_undo_bookkeeping')

let code = 0
const name = `id_${process.pid}_${Date.now() % 100000}`
let passed = 0
psql(url, ['-c', `create database ${name}`])
try {
  const a = withDb(url, name)
  step('base', () => { psql(a, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')]); psql(a, ['-f', join(root, 'scripts/db-tests/repeat-days/base.sql')]) })
  step('skips', () => psql(a, ['-c', skips]))
  step('google tasks', () => psql(a, ['-c', googleTasks]))
  for (const f of ['141_training_task_links.sql', '142_training_session_one_model.sql', '135_calendar_outbox.sql', '144_delete_with_undo.sql',
    '147_schedule_block_calendar_series.sql', '148_google_today_and_series_start.sql', '150_undo_save.sql', '151_undo_save_fixes.sql',
    '155_one_item.sql', '156_repeat_days_as_tasks.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('160 rule', () => psql(a, ['-c', ruleSection]))
  step('160 bookkeeping', () => psql(a, ['-c', bookkeeping160]))
  step('162 column', () => psql(a, ['-c', 'alter table public.tasks add column if not exists project_id uuid']))
  for (const f of ['163_football.sql', '165_football_category.sql', '166_training_moves_recheck.sql', '167_training_week_rules.sql',
    '168_football_favourite.sql', '169_training_and_stock_fixes.sql', '171_icloud_credentials.sql', '172_calendar_prefs.sql',
    '173_icloud_events.sql', '174_icloud_events_safety.sql', '175_icloud_switch.sql', '176_icloud_readback.sql', '177_icloud_every_event.sql',
    '178_icloud_games_area.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('before 179', () => psql(a, ['-c', 'alter table public.hevy_workouts add column if not exists description text']))
  for (const f of ['179_icloud_workouts.sql', '180_task_labels.sql', '183_item_time_zones.sql', '186_item_places.sql',
    '193_item_calendar_fields.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/task-links/seed.sql')]))
  step('210', () => psql(a, ['-f', mig210]))
  step('211 seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/linked-plans/seed.sql')]))
  step('211', () => psql(a, ['-f', mig211]))
  step('snapshot before 215', () => psql(a, ['-c', 'create table public.t_before215 as select id, status, title from public.tasks']))
  step('215 first run', () => psql(a, ['-f', mig215]))
  step('215 second run', () => psql(a, ['-f', mig215]))
  step('scenarios', () => { passed = runScenarios(a, join(root, 'scripts/db-tests/item-details/scenarios.sql')) })
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  if (!process.env.KEEP_DB) try { psql(url, ['-c', `drop database if exists ${name}`]) } catch { /* best effort */ }
}
if (code) process.exit(code)
if (passed < 40) { console.error(`verify-db-item-details: only ${passed} scenarios reported ok`); process.exit(1) }
console.log(`verify-db-item-details: static checks passed; on the live item chain (135–193) with 210 and 211, 215 ran twice and ${passed} scenarios passed`)
