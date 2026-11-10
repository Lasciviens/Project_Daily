// Runs migration 193's scenarios (Apple's extra fields on an item: End Repeat, Alert + Second Alert, Show As, URL,
// Travel Time) on a throwaway Postgres: the live item chain as verify-db-item-places builds it (one-item/base.sql +
// repeat-days/base.sql and the real 135–186: the item save, repeat days, training rules, the Google Calendar outbox,
// Undo, the Apple queue and read-back), then the real 193 twice and scripts/db-tests/item-calendar-fields/scenarios.sql:
// the CHECKs for every writer (hostile values), row level security and the owner lock, the one item save, a repeat's
// end and its days, a day split off a plan, a changed field reaching Apple and Google, both read-backs, and Undo.
// Static checks first: each function 193 re-creates is its migration's body with only the 193 lines added, and the
// allow-lists the database keeps are the browser's (calendarEventRules.ts, recurrence.ts).
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-item-calendar-fields.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const src193 = readFileSync(mig('193_item_calendar_fields.sql'), 'utf8')
const fnOf = (text, name) => text.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0] ?? ''
const fail = msg => { console.error(`verify-db-item-calendar-fields: ${msg}`); process.exit(1) }

// 193's copies = their migration's bodies with only the 193 lines added: every line of the old body is kept, in
// order and unchanged — but a value list that now goes on (`end)` → `end,`) and a line that gets the new names
// (a column list, a return), which must name a 193 thing (a new column, variable, key or rule).
{
  const NEW = /alerts|show_as|showAs|v_show|url|travel|repeat_until|repeat_count|repeatEnd|v_until|v_count|v_old_|v_fields|calendarFields|v_busy :=|IT007|item_alerts_ok|item_url_ok|jsonb_typeof\(e\)|^\s*(--|end if;|end;|\)|or |and |raise exception '(Those alerts|Show As|That link|That travel|End Repeat|The repeat ends))/
  // The old lines 193 changes (a column list or a return that gets the new names): each must name a 193 thing.
  const same = (name, file) => {
    const live = fnOf(readFileSync(mig(file), 'utf8'), name).split('\n')
    const mine = fnOf(src193, name).split('\n')
    if (live.length < 3 || mine.length < 3) fail(`no ${name} in ${file} or 193`)
    let i = 0
    const added = []
    for (const l of mine) {
      if (i < live.length && l === live[i]) i++
      // An old line that now goes on (a value list: `end)` → `end,`), or one that gets the new names.
      else if (i < live.length && !mine.includes(live[i]) && (l.replace(/,$/, ')') === live[i]
        || (NEW.test(l) && l.trim().slice(0, 12) === live[i].trim().slice(0, 12)))) { i++; if (NEW.test(l)) added.push(l) }
      else added.push(l)
    }
    if (i !== live.length) fail(`193's ${name} must keep every line of ${file}'s (stopped at: ${live[i]?.trim()})`)
    if (!added.some(l => NEW.test(l))) fail(`193's ${name} adds nothing of 193's`)
    return added.length
  }
  const counts = [
    same('app_save_item', '186_item_places.sql'),
    same('icloud_time_block_changed', '186_item_places.sql'),
    same('icloud_schedule_block_changed', '186_item_places.sql'),
    same('enqueue_calendar_event_upsert', '186_item_places.sql'),
    same('apply_calendar_readback', '155_one_item.sql'),
    same('apply_icloud_readback', '178_icloud_games_area.sql'),
  ]
  if (counts.some(n => n === 0)) fail('a re-created function adds nothing (then 193 should not re-create it)')
}

// Static: one transaction, nothing outside the database, no table, no backfill, a grant for every new function,
// and the allow-lists the database keeps = the browser's and the writers' (calendarEventRules.ts, recurrence.ts).
{
  const sql = src193.replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (/\bnet\.http_|vault\.|googleapis|icloud\.com/i.test(sql)) problems.push('a call outside the database')
  if (/create table/i.test(sql)) problems.push('a new table')
  if (/^(update|insert into|delete from) /im.test(sql)) problems.push('a top-level write (193 backfills nothing)')
  for (const name of ['item_alerts_ok(integer[])', 'item_url_ok(text)', 'time_block_calendar_fill()', 'schedule_block_repeat_end()',
    'repeat_count_end(text, integer[], integer, text, date[], date, integer)']) {
    if (!sql.includes(`grant execute on function public.${name} to authenticated, service_role`)) problems.push(`no grant for ${name}`)
    if (!sql.includes(`revoke all on function public.${name} from public, anon`)) problems.push(`no revoke for ${name}`)
  }
  for (const name of ['apply_calendar_readback(uuid, jsonb)', 'apply_icloud_readback(uuid, text, uuid, text, jsonb, text)']) {
    if (!sql.includes(`revoke all on function public.${name} from public, anon, authenticated`)) problems.push(`${name} is not kept to the service role`)
  }
  const rules = readFileSync(join(root, 'src/features/calendar/calendarEventRules.ts'), 'utf8')
  const recurrence = readFileSync(join(root, 'src/features/daily/recurrence.ts'), 'utf8')
  const list = name => rules.match(new RegExp(`export const ${name}: readonly number\\[\\] = \\[([^\\]]+)\\]`))?.[1].replace(/\s/g, '')
  const dbAlerts = sql.match(/p <@ array\[([^\]]+)\]/)?.[1].replace(/\s/g, '')
  if (!dbAlerts || dbAlerts !== list('ALERT_MINUTES')) problems.push(`the alerts the database takes (${dbAlerts}) differ from ALERT_MINUTES (${list('ALERT_MINUTES')})`)
  const travel = [...sql.matchAll(/travel_minutes in \(([^)]+)\)|::integer (?:not )?in \(([^)]+)\)/g)].map(m => (m[1] ?? m[2]).replace(/\s/g, ''))
  if (travel.length !== 4|| travel.some(t => t !== list('TRAVEL_MINUTES'))) problems.push(`a travel list in 193 (${[...new Set(travel)]}) differs from TRAVEL_MINUTES (${list('TRAVEL_MINUTES')})`)
  const dbUrl = src193.match(/else p ~ '([^\n]+)'\n/)?.[1].replace(/''/g, "'")
  const browserUrl = rules.match(/export const ITEM_URL = \/(.+)\/$/m)?.[1].replace(/\\\//g, '/')
  if (!dbUrl || dbUrl !== browserUrl) problems.push(`item_url_ok's pattern differs from ITEM_URL:\n  ${dbUrl}\n  ${browserUrl}`)
  if (!/length\(p\) > 2048/.test(sql) || !/export const ITEM_URL_MAX = 2048/.test(rules)) problems.push('the link length is not 2048 on both sides')
  if (!/repeat_count between 1 and 999/.test(sql) || !/export const MAX_REPEAT_COUNT = 999/.test(recurrence)) problems.push('the count is not 1–999 on both sides')
  if (!/for i in 0 \.\. 7305 loop/.test(sql) || !/export const REPEAT_COUNT_SEARCH_DAYS = 7305/.test(recurrence)) problems.push('the Nth day is not searched over the same 20 years on both sides')
  if (problems.length) fail(`migration 193 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-item-calendar-fields: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-item-calendar-fields: no ${what} in ${file}`)
  return m[1] ?? m[0]
}
const step = (name, fn) => { try { fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
const runScenarios = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  return passed
}

// The live chain (verify-db-icloud-cross's), 180 and 183, then 186 twice.
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
const items = `calf_${process.pid}_${Date.now() % 100000}`
const done = []
psql(url, ['-c', `create database ${items}`])
try {
  const a = withDb(url, items)
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
    '193_item_calendar_fields.sql', '193_item_calendar_fields.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('scenarios', () => done.push(runScenarios(a, join(root, 'scripts/db-tests/item-calendar-fields/scenarios.sql'))))
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  try { psql(url, ['-c', `drop database if exists ${items}`]) } catch { /* best effort */ }
}
if (code) process.exit(code)
console.log(`verify-db-item-calendar-fields: 193's copies keep 186's, 155's and 178's bodies; the allow-lists match the browser's; on the live item chain (135–186) 193 ran twice and ${done[0]} scenarios passed`)
