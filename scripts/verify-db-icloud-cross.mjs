// The app's events in Apple Calendar across features (cross-check, 30.10.2026). verify-db-icloud-events tests the
// iCloud queue (171–177) on stand-ins for the item rules; this builds the live chain instead — the item save, repeat
// days, the training rules, the Google Calendar outbox, delete with Undo (as verify-db-training-stock-fixes builds
// them: one-item/base.sql + repeat-days/base.sql and the real 135–169) — then the real 171–177 (177 twice) and
// scripts/db-tests/icloud-cross/scenarios.sql: a save, a tick, a delete and its Undo, a repeat and a day split off
// it, a training move read back from the iPhone (its rule's own writes reach Apple), the hand-over to Google's real
// outbox, the settings re-send.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-icloud-cross.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without Postgres)
// it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-icloud-cross: database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-icloud-cross: no ${what} in ${file}`)
  return m[1] ?? m[0]
}

// 112's table only (its policies and audit trigger need Supabase roles), with the app's own-rows policy.
const skips = `${section('112_training_skips.sql', /CREATE TABLE IF NOT EXISTS public\.training_skips[\s\S]*?\n\);/, 'training_skips')}
alter table public.training_skips enable row level security;
create policy own on public.training_skips for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.training_skips to authenticated;`
// 160 moved the repeat rule into repeat_rule_occurs_on; its section runs after 156.
const ruleSection = section('160_supplement_schedules.sql', /-- <repeat-rule>\n([\s\S]*?)-- <\/repeat-rule>/, '<repeat-rule> section')
// The real Google Tasks triggers' functions (base.sql has short copies): 071's
// buckets and local-edit stamp, 140's queue (the latest of 071/078/140).
const googleTasks = [
  section('071_google_tasks_integration.sql', /CREATE OR REPLACE FUNCTION public\.google_task_status_bucket\(p_status TEXT\)[\s\S]*?\n\$\$;/, 'google_task_status_bucket'),
  section('071_google_tasks_integration.sql', /CREATE OR REPLACE FUNCTION public\.stamp_google_local_edit\(\)[\s\S]*?\n\$\$;/, 'stamp_google_local_edit'),
  section('140_security_fixes.sql', /CREATE OR REPLACE FUNCTION public\.enqueue_google_tasks_outbox\(\)[\s\S]*?\n\$function\$;/, 'enqueue_google_tasks_outbox'),
  // 072's scope for an RPC the service role calls for an account (148's pull uses it).
  `create or replace function public.effective_user_id(p_user_id uuid) returns uuid language sql stable as $$
  select case when auth.role() = 'service_role' then p_user_id else auth.uid() end
$$;`,
].join('\n')
// 156's rule functions, as 156 wrote them (verify-db-supplement-schedules' way).
const m156 = readFileSync(mig('156_repeat_days_as_tasks.sql'), 'utf8')
const rule156 = ['repeat_monthly_day', 'repeat_monthly_hits', 'repeat_occurs_on'].map(name => {
  const m = m156.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;\\n`))
  if (!m) throw new Error(`verify-db-icloud-cross: no ${name} in migration 156`)
  return m[0]
}).join('\n')


const BOOKKEEPING_160 = readFileSync(mig('160_supplement_schedules.sql'), 'utf8')
  .match(/create or replace function public\.app_undo_bookkeeping\(p_table text\)[\s\S]*?\n\$\$;/)?.[0]
const db = `ticx_${process.pid}`
const step = (name, fn) => { try { fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
psql(url, ['-c', `create database ${db}`])
let code = 0
try {
  const a = withDb(url, db)
  step('base', () => { psql(a, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')]); psql(a, ['-f', join(root, 'scripts/db-tests/repeat-days/base.sql')]) })
  step('skips', () => psql(a, ['-c', skips]))
  step('google tasks', () => psql(a, ['-c', googleTasks]))
  for (const f of ['141_training_task_links.sql', '142_training_session_one_model.sql', '135_calendar_outbox.sql', '144_delete_with_undo.sql',
    '147_schedule_block_calendar_series.sql', '148_google_today_and_series_start.sql', '150_undo_save.sql', '151_undo_save_fixes.sql',
    '155_one_item.sql', '156_repeat_days_as_tasks.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('160 rule', () => psql(a, ['-c', ruleSection]))
  step('160 bookkeeping', () => psql(a, ['-c', BOOKKEEPING_160]))
  // 162 (projects) gave tasks a project link; its own tables aren't needed here.
  step('162 column', () => psql(a, ['-c', 'alter table public.tasks add column if not exists project_id uuid']))
  for (const f of ['163_football.sql', '165_football_category.sql', '166_training_moves_recheck.sql', '167_training_week_rules.sql',
    '168_football_favourite.sql', '169_training_and_stock_fixes.sql', '171_icloud_credentials.sql', '172_calendar_prefs.sql',
    '173_icloud_events.sql', '174_icloud_events_safety.sql', '175_icloud_switch.sql', '176_icloud_readback.sql', '177_icloud_every_event.sql',
    '177_icloud_every_event.sql', '178_icloud_games_area.sql', '178_icloud_games_area.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  // 179's past trainings: a stored workout of an account whose Training is on Apple before 179 runs (024's notes column too).
  step('before 179', () => psql(a, ['-c', `alter table public.hevy_workouts add column if not exists description text;
    insert into public.calendar_prefs (user_id, prefs) values ('00000000-0000-0000-0000-000000000002', '{"areas": {"training": {"app": "apple", "enabled": true}}}');
    insert into public.hevy_workouts (id, user_id, title, start_time, end_time) values
      ('b459cba5-cd6d-463c-abd6-54f8eafcadcb', '00000000-0000-0000-0000-000000000002', 'Lower B', '2026-10-21 16:30+00', '2026-10-21 17:35+00'),
      ('hevy-not-a-uuid', '00000000-0000-0000-0000-000000000002', 'Upper A', '2026-10-23 16:30+00', null);`]))
  for (const f of ['179_icloud_workouts.sql', '179_icloud_workouts.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  const run = spawnSync('psql', [a, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/icloud-cross/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) { code = 1; console.error(run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n')) }
  if (!code) console.log(`verify-db-icloud-cross: the live item, repeat, training, Google and Undo rules (135–169), then 171–179 (177–179 twice), and ${passed} scenarios passed`)
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
process.exit(code)
