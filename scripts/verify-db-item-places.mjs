// Runs migration 186's scenarios (a place on an item) on a throwaway Postgres: the live item chain as
// verify-db-time-zones builds it (one-item/base.sql + repeat-days/base.sql and the real 135–183: the item save, repeat
// days, training rules, the Google Calendar outbox, Undo, the Apple queue), then the real 186 twice and
// scripts/db-tests/item-places/scenarios.sql: what a place may hold, every writer checked, the one item save, a
// repeat's days, a changed place reaching Apple and Google, and Undo.
// Static checks first: each function 186 re-creates is 183's body with only the place lines added.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-item-places.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const src186 = readFileSync(mig('186_item_places.sql'), 'utf8')
const src183 = readFileSync(mig('183_item_time_zones.sql'), 'utf8')
const fnOf = (text, name) => text.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0] ?? ''
const fail = msg => { console.error(`verify-db-item-places: ${msg}`); process.exit(1) }

// 186's copies = 183's bodies with only the place lines added: take them back out and the texts must match.
{
  const same = (name, strip) => {
    const live = fnOf(src183, name)
    const back = strip(fnOf(src186, name))
    if (!live || back !== live) fail(`186's ${name} must be 183's with only the place lines added`)
  }
  same('app_save_item', s => s
    .replace("\n  -- 186: the sheet's place — no 'place' key: keep the item's; null: none; an object: checked below.\n  v_has_place boolean := p_item ? 'place';\n  v_place     jsonb := case when jsonb_typeof(p_item -> 'place') = 'object' then p_item -> 'place' end;", '')
    .replace("\n  if v_has_place and jsonb_typeof(p_item -> 'place') not in ('object', 'null') then\n    raise exception 'That place can''t be saved' using errcode = '22023';\n  end if;\n  if v_place is not null and (v_place = '{}'::jsonb or not public.place_ok(v_place)) then\n    raise exception 'That place can''t be saved' using errcode = '22023';\n  end if;", '')
    .replace('\n        place = case when v_has_place then v_place else p.place end,', '')
    .replace('google_target, time_zone, place)', 'google_target, time_zone)')
    .replace("coalesce(v_zone, ''),\n              case when v_has_place then v_place else '{}'::jsonb end)", "coalesce(v_zone, ''))")
    .replace('\n        place = case when v_has_place then v_place else b.place end,', '')
    .replace('season_number, episode_number, time_zone, place)', 'season_number, episode_number, time_zone)')
    .replace("v_season, v_episode, coalesce(v_zone, ''), case when v_has_place then v_place else '{}'::jsonb end)", "v_season, v_episode, coalesce(v_zone, ''))"))
  same('icloud_time_block_changed', s => s.replace('new.time_zone, new.place, new.user_id', 'new.time_zone, new.user_id').replace('old.time_zone, old.place, old.user_id', 'old.time_zone, old.user_id'))
  same('icloud_schedule_block_changed', s => s.replace('new.time_zone, new.place, new.user_id', 'new.time_zone, new.user_id').replace('old.time_zone, old.place, old.user_id', 'old.time_zone, old.user_id'))
  same('enqueue_calendar_event_upsert', s => s.replace('new.time_zone, new.place)', 'new.time_zone)').replace('old.time_zone, old.place)', 'old.time_zone)'))
}

// Static: one transaction, nothing outside the database, no table, no backfill, a grant for every new function,
// and the id shape the database takes = the browser's (itemPlace.ts).
{
  const sql = src186.replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (/\bnet\.http_|vault\.|googleapis|icloud\.com|entur/i.test(sql)) problems.push('a call outside the database')
  if (/create table/i.test(sql)) problems.push('a new table')
  if (/^(update|insert into|delete from) /im.test(sql)) problems.push('a top-level write (186 backfills nothing)')
  for (const name of ['place_ok(jsonb)', 'time_block_place_fill()', 'schedule_block_place_fill()']) {
    if (!sql.includes(`grant execute on function public.${name} to authenticated, service_role`)) problems.push(`no grant for ${name}`)
    if (!sql.includes(`revoke all on function public.${name} from public, anon`)) problems.push(`no revoke for ${name}`)
  }
  const dbId = sql.match(/\(p ->> 'id'\) !~ '([^']+)'/)?.[1]
  const browserId = readFileSync(join(root, 'src/features/items/itemPlace.ts'), 'utf8').match(/export const PLACE_ID = \/(.+)\/$/m)?.[1]
  if (!dbId || dbId !== browserId) problems.push(`the place id shape ${dbId} differs from the browser's ${browserId}`)
  if (problems.length) fail(`migration 186 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-item-places: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-item-places: no ${what} in ${file}`)
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
const items = `tpl_${process.pid}`
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
  for (const f of ['179_icloud_workouts.sql', '180_task_labels.sql', '183_item_time_zones.sql', '186_item_places.sql', '186_item_places.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('scenarios', () => done.push(runScenarios(a, join(root, 'scripts/db-tests/item-places/scenarios.sql'))))
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  try { psql(url, ['-c', `drop database if exists ${items}`]) } catch { /* best effort */ }
}
if (code) process.exit(code)
console.log(`verify-db-item-places: 186's copies match 183's; on the live item chain (135–183) 186 ran twice and ${done[0]} scenarios passed`)
