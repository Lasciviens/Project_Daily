// Runs migration 208's scenarios (Google Calendar goes; Google Tasks and Apple Calendar stay) on a throwaway Postgres:
// the live item chain as verify-db-item-calendar-fields builds it (135–193: the item save, repeat days, the Google
// Calendar outbox, Undo, the Apple queue and read-back), then items as they are before 208 (scripts/db-tests/
// google-calendar-off/seed.sql), the real 208 as the deploy runs it (one transaction), a snapshot, 208 again, and
// scripts/db-tests/google-calendar-off/scenarios.sql: nothing queues or sends Google Calendar work any more, every
// Google item is "only in this app" (or Apple's, when its area is on Apple), the links are gone, every area is on
// Apple, Google Tasks keeps working, a second run changes nothing.
// Static checks first: no BEGIN/COMMIT, nothing outside the database, no table or column dropped (that needs the
// owner's go), and the migration's area rule is the browser's (icloudEvents.itemArea).
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-google-calendar-off.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL it runs the static checks
// and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const src = readFileSync(mig('208_google_calendar_off.sql'), 'utf8')
const fail = msg => { console.error(`verify-db-google-calendar-off: ${msg}`); process.exit(1) }

{
  const sql = src.replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (/\bnet\.http_|vault\.|googleapis|icloud\.com/i.test(sql)) problems.push('a call outside the database')
  if (/drop\s+table|drop\s+column|truncate/i.test(sql)) problems.push('a dropped table or column (the owner decides that)')
  if (/create table|grant execute on function public\.(?!icloud_writes_on)/i.test(sql)) problems.push('a new table or function grant')
  if (!/revoke all on function public\.icloud_writes_on\(uuid\) from public, anon, authenticated;/.test(sql)
    || !/grant execute on function public\.icloud_writes_on\(uuid\) to service_role;/.test(sql)) problems.push("icloud_writes_on does not keep 174's rights")
  if (/delete from public\.calendar_outbox;/i.test(sql)) problems.push('a DELETE without WHERE')
  for (const t of ['trg_enqueue_calendar_event_delete', 'trg_enqueue_calendar_event_upsert', 'trg_enqueue_calendar_series_delete',
    'trg_enqueue_calendar_series_upsert', 'trg_enqueue_calendar_done_mark']) if (!sql.includes(`drop trigger if exists ${t} `)) problems.push(`${t} is not dropped`)
  // The area rule: the browser's order and its media sources.
  const events = readFileSync(join(root, 'src/features/calendar/areas/icloudEvents.ts'), 'utf8')
  const media = events.match(/const MEDIA_SOURCES = new Set\(\[([^\]]+)\]\)/)?.[1].replace(/\s/g, '')
  const sqlMedia = sql.match(/p_sources && array\[([^\]]+)\]/)?.[1].replace(/\s/g, '')
  if (!media || media !== sqlMedia) problems.push(`the media sources differ (${sqlMedia} vs ${media})`)
  const areaFn = events.match(/export function itemArea\([\s\S]*?\n\}/)?.[0] ?? ''
  const order = [...areaFn.matchAll(/^\s+(?:if \(.*\) )?return '(\w+)'$/gm)].map(m => m[1])
  const sqlOrder = [...sql.matchAll(/then '(football|training|games|media|work)'|else '(personal)'/g)].map(m => m[1] ?? m[2])
  if (order.join() !== 'football,training,games,media,work,personal' || sqlOrder.join() !== order.join()) problems.push(`the area order differs (${sqlOrder} vs ${order})`)
  if (problems.length) fail(`migration 208 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-google-calendar-off: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-google-calendar-off: no ${what} in ${file}`)
  return m[1] ?? m[0]
}
const step = (name, fn) => { try { fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
const runScenarios = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  return passed
}

// The live chain (verify-db-item-calendar-fields's).
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
const name = `gcoff_${process.pid}_${Date.now() % 100000}`
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
  step('seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/google-calendar-off/seed.sql')]))
  // As the deploy runs it: one transaction (its set_config(…, true) lasts for that transaction).
  step('208', () => psql(a, ['-1', '-f', mig('208_google_calendar_off.sql')]))
  step('snapshot', () => psql(a, ['-c', `create table public.t_after_one as
    select 'task' as kind, id, google_target as target, google_calendar_event_id as event, null::date as from_day from public.tasks
    union all select 'slot', id, null, google_calendar_event_id, null from public.time_blocks
    union all select 'plan', id, google_target, google_calendar_event_id, google_calendar_from from public.schedule_blocks
    union all select 'prefs', user_id, prefs::text, null, null from public.calendar_prefs`]))
  step('208 again', () => psql(a, ['-1', '-f', mig('208_google_calendar_off.sql')]))
  step('scenarios', () => { passed = runScenarios(a, join(root, 'scripts/db-tests/google-calendar-off/scenarios.sql')) })
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  try { psql(url, ['-c', `drop database if exists ${name}`]) } catch { /* best effort */ }
}
if (code) process.exit(code)
console.log(`verify-db-google-calendar-off: on the live item chain (135–193) 208 ran twice and ${passed} scenarios passed`)
