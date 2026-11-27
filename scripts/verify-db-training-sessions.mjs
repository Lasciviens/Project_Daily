// Runs migration 213's scenarios (a workout done a day or two early, late inside its week, or swapped with another
// session of the program completes its own session; the week is the outer limit; one workout, one session; another
// account's session untouched; a re-run sync changes nothing) on a throwaway Postgres built as verify-db-linked-plans
// builds it — the live item chain (135–193), task-links/seed.sql, 210, linked-plans/seed.sql, 211 — then
// scripts/db-tests/training-sessions/seed.sql, the real 213 twice and scripts/db-tests/training-sessions/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-training-sessions.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig210 = mig('210_task_links.sql')
const mig211 = mig('211_linked_plans.sql')
const mig213 = mig('213_training_sessions.sql')
const fail = msg => { console.error(`verify-db-training-sessions: ${msg}`); process.exit(1) }

// Static: one transaction, nothing outside the database, no table, every function's rights.
{
  const sql = readFileSync(mig213, 'utf8').replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/\bnet\.http_|vault\.|googleapis|icloud_enqueue/i.test(sql)) problems.push('a call outside the database')
  if (/create\s+table|drop (table|column)/i.test(sql)) problems.push('a table created or dropped (it adds none)')
  for (const f of sql.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)) {
    const body = sql.slice(f.index, sql.indexOf('$$;', f.index))
    const args = f[2].replace(/\bp_\w+\s+/g, '').trim()
    if (!/set search_path = ''/.test(body)) problems.push(`${f[1]} without search_path ''`)
    if (!sql.includes(`revoke all on function ${f[1]}(${args}) from public, anon, authenticated`)) problems.push(`${f[1]}(${args}) callable from the browser`)
  }
  if (/grant execute on function/.test(sql)) problems.push('a grant of a matching function (they are the database\'s own)')
  if (!/create trigger trg_tasks_workout_owner\s+before insert or update of hevy_workout_id, user_id on public\.tasks/.test(sql)) problems.push('no owner check on tasks.hevy_workout_id')
  if (problems.length) fail(`migration 213 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-training-sessions: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-training-sessions: no ${what} in ${file}`)
  return m[1] ?? m[0]
}
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
const runScenarios = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
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
const name = `ts_${process.pid}_${Date.now() % 100000}`
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
  step('213 seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/training-sessions/seed.sql')]))
  step('snapshot before 213', () => psql(a, ['-c', 'create table public.t_before213 as select id, status, title, due_date from public.tasks']))
  step('213 first run', () => psql(a, ['-f', mig213]))
  step('213 second run', () => psql(a, ['-f', mig213]))
  step('scenarios', () => { passed = runScenarios(a, join(root, 'scripts/db-tests/training-sessions/scenarios.sql')) })
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  if (!process.env.KEEP_DB) try { psql(url, ['-c', `drop database if exists ${name}`]) } catch { /* best effort */ }
}
if (code) process.exit(code)
console.log(`verify-db-training-sessions: static checks passed; on the live item chain (135–193) with 210 and 211, 213 ran twice and ${passed} scenarios passed`)
