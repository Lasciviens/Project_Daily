// Runs migration 183's scenarios (time zones from the phone) on a throwaway Postgres.
//  A. The live item chain as verify-db-icloud-cross builds it (one-item/base.sql + repeat-days/base.sql and the real
//     135–179: the item save, repeat days, training rules, the Google Calendar outbox, Undo, the Apple queue), the
//     real 180, then the real 183 twice and scripts/db-tests/time-zones/scenarios.sql: zone names, the request's zone,
//     every way a slot or plan gets its zone, the one item save, and a changed zone reaching Apple and Google.
//  B. verify-db-food-log-times' database (food-dishes/base.sql, the real 106 and 181), then 183's zone functions and
//     its food rule twice, and scripts/db-tests/time-zones/food.sql: a log's time on the phone's clock.
// Static checks first: each function 183 re-creates is its source's body with only the zone lines added.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-time-zones.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig183 = mig('183_item_time_zones.sql')
const src183 = readFileSync(mig183, 'utf8')
const fnOf = (text, name) => text.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0] ?? ''
const fail = msg => { console.error(`verify-db-time-zones: ${msg}`); process.exit(1) }

// 183's copies = their sources with only the zone lines added: put them back out and the texts must match.
{
  const same = (name, file, strip) => {
    const live = fnOf(readFileSync(mig(file), 'utf8'), name)
    const back = strip(fnOf(src183, name))
    if (!live || back !== live) fail(`183's ${name} must be ${file}'s with only the zone lines added`)
  }
  same('app_save_item', '180_task_labels.sql', s => s
    .replace("\n  -- 183: the sheet's zone; one the database doesn't know is left out (an edit keeps the item's, a new item takes\n  -- the phone's or the home zone) — a phone reporting an old name never fails a save.\n  v_zone      text := case when public.time_zone_ok(btrim(p_item ->> 'timeZone')) then btrim(p_item ->> 'timeZone') end;", '')
    .replace('\n        time_zone = coalesce(v_zone, p.time_zone),', '')
    .replace('google_target, time_zone)', 'google_target)')
    .replace("v_category, v_google, v_zone)", 'v_category, v_google)')
    .replace('\n        time_zone = coalesce(v_zone, b.time_zone),', '')
    .replace('season_number, episode_number, time_zone)', 'season_number, episode_number)')
    .replace('v_season, v_episode, v_zone)', 'v_season, v_episode)'))
  same('icloud_time_block_changed', '175_icloud_switch.sql', s => s.replace('new.notes, new.time_zone, new.user_id', 'new.notes, new.user_id').replace('old.notes, old.time_zone, old.user_id', 'old.notes, old.user_id'))
  same('icloud_schedule_block_changed', '175_icloud_switch.sql', s => s.replace('new.google_calendar_time_zone, new.time_zone,', 'new.google_calendar_time_zone,').replace('old.google_calendar_time_zone, old.time_zone,', 'old.google_calendar_time_zone,'))
  same('enqueue_calendar_event_upsert', '155_one_item.sql', s => s.replace('new.busy, new.time_zone)', 'new.busy)').replace('old.busy, old.time_zone)', 'old.busy)'))
  same('food_log_eaten_time', '181_food_log_times.sql', s => s
    .replace(" now() end)\n          at time zone coalesce(public.app_request_time_zone(), 'Europe/Oslo');", " now() end) at time zone 'Europe/Oslo';")
    .replace(' a planned row ticked eaten now — on the\n  -- clock of the phone that sent it (183), else Oslo\'s (a server writer: the phone gateway, Scriptable).', ' a planned row ticked eaten now.'))
}

// Static: one transaction, nothing outside the database, no table, no backfill, a grant for every new function.
{
  const sql = src183.replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (/\bnet\.http_|vault\.|googleapis|icloud\.com/i.test(sql)) problems.push('a call outside the database')
  if (/create table/i.test(sql)) problems.push('a new table')
  if (/^(update|insert into|delete from) /im.test(sql)) problems.push('a top-level write (183 backfills nothing)')
  for (const name of ['time_zone_ok(text)', 'app_request_time_zone()', 'time_block_time_zone_fill()', 'schedule_block_time_zone_fill()']) {
    if (!sql.includes(`grant execute on function public.${name} to authenticated, service_role`)) problems.push(`no grant for ${name}`)
    if (!sql.includes(`revoke all on function public.${name} from public, anon`)) problems.push(`no revoke for ${name}`)
  }
  // The zone check: one IANA shape in SQL (twice: the CHECKs and time_zone_ok) = the browser's (calendarEventRules).
  const shapes = [...sql.matchAll(/~ '(\^\[A-Za-z\]\+\(\[\/_\+-\]\[A-Za-z0-9\]\+\)\*\$)'/g)].map(m => m[1])
  if (shapes.length !== 3) problems.push(`the zone shape should appear 3 times (time_zone_ok and the two CHECKs), found ${shapes.length}`)
  if (problems.length) fail(`migration 183 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-time-zones: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-time-zones: no ${what} in ${file}`)
  return m[1] ?? m[0]
}
const step = (name, fn) => { try { fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
const runScenarios = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  return passed
}

// A. The live chain (verify-db-icloud-cross's), 180, then 183 twice.
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
const items = `ttz_${process.pid}`
const food = `ttzf_${process.pid}`
const done = []
psql(url, ['-c', `create database ${items}`])
psql(url, ['-c', `create database ${food}`])
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
  for (const f of ['179_icloud_workouts.sql', '180_task_labels.sql', '183_item_time_zones.sql', '183_item_time_zones.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('items scenarios', () => done.push(['items', runScenarios(a, join(root, 'scripts/db-tests/time-zones/scenarios.sql'))]))

  // B. Food log times.
  const b = withDb(url, food)
  for (const f of [join(root, 'scripts/db-tests/food-dishes/base.sql'), mig('106_food_macros_computed.sql'), mig('181_food_log_times.sql')]) step(f, () => psql(b, ['-f', f]))
  const zoneFns = ['time_zone_ok', 'app_request_time_zone', 'food_log_eaten_time'].map(n => {
    const body = fnOf(src183, n)
    if (!body) throw new Error(`verify-db-time-zones: no ${n} in migration 183`)
    return body
  }).join('\n') + '\n' + src183.split('\n').filter(l => /^(revoke|grant) .*(time_zone_ok|app_request_time_zone)/.test(l)).join('\n')
  for (const n of [1, 2]) step(`183 food part (${n})`, () => psql(b, ['-c', zoneFns]))
  step('food scenarios', () => done.push(['food', runScenarios(b, join(root, 'scripts/db-tests/time-zones/food.sql'))]))
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  for (const d of [items, food]) { try { psql(url, ['-c', `drop database if exists ${d}`]) } catch { /* best effort */ } }
}
if (code) process.exit(code)
console.log(`verify-db-time-zones: 183's copies match their sources; on the live item chain (135–180) 183 ran twice and ${done[0][1]} item scenarios passed; on the food database ${done[1][1]} food scenarios passed`)
