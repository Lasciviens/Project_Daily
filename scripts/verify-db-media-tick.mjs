// Runs migration 216's scenarios (a done movie or episode plan is a watch — owner, 28.11.2026: "Yes build it, and send
// to Trakt too", "Tv episodes too!!"): ticking a task that plans a movie or one episode writes one watch dated at the
// tick and queues it for Trakt, once; unticking (reopen or cancel) removes only that watch, while it is still the one
// the tick wrote, and puts the status back while it is still what the tick left; the ticked episode plan keeps its slot. Built on the live item chain as verify-db-linked-plans builds it (135–193,
// task-links/seed.sql, 210, linked-plans/seed.sql, 211), then scripts/db-tests/media-tick/seed.sql (the media
// stand-ins grown into 149's "before"), the REAL 184, 149 and 161, 211 again (its plan-closing trigger on 149's
// table), 216 twice, 211's own scenarios (minus Y1, "a hand tick writes no watch", which 216 reverses — so the shop,
// wish and phase effects and 211's movie rules are proven unchanged on 149's real table), then
// scripts/db-tests/media-tick/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-media-tick.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig216 = mig('216_media_plan_watched.sql')
const fail = msg => { console.error(`verify-db-media-tick: ${msg}`); process.exit(1) }

// Static: one transaction, nothing outside the database, the function's rights, 211's effects kept.
{
  const raw = readFileSync(mig216, 'utf8')
  const sql = raw.replace(/--.*$/gm, '')
  const m211 = readFileSync(mig('211_linked_plans.sql'), 'utf8')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/\bnet\.http_|vault\.|googleapis|icloud_enqueue|trakt_enqueue/i.test(sql)) problems.push('a call outside the database (the Trakt add is 149\'s trigger\'s, never queued here)')
  if (/drop (table|column)|create table/i.test(sql)) problems.push('a table created or dropped, or a column dropped')
  if (/alter table public\.tasks/i.test(sql)) problems.push('a new task column (a link column would need Ask AI\'s confirmed lists)')
  for (const f of sql.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)) {
    const body = sql.slice(f.index, sql.indexOf('$$;', f.index))
    const args = f[2].replace(/\bp_\w+\s+/g, '').trim()
    if (!/set search_path = ''/.test(body)) problems.push(`${f[1]} without search_path ''`)
    if (!sql.includes(`revoke all on function ${f[1]}(${args}) from public, anon, authenticated`)) problems.push(`no revoke for ${f[1]}(${args})`)
    if (/grant execute on function/.test(sql)) problems.push('a function granted to a caller (the effects are a trigger\'s)')
  }
  // Every query on a user table in the movie parts names the task's own user.
  const fn = sql.slice(sql.indexOf('create or replace function public.tasks_link_effects()'))
  for (const q of fn.matchAll(/(?:update|delete from|from)\s+public\.(user_movie_entries|user_tv_entries|media_watches)\b[\s\S]*?(?:;|\bthen\b|\bloop\b)/g)) {
    if (!/user_id = (new|e)\.user_id/.test(q[0])) problems.push(`a query on ${q[1]} not scoped to the task's user: ${q[0].slice(0, 80)}`)
  }
  // 211's effects are carried over word for word (a later copy that dropped one would be a silent regression).
  const part = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)))
  for (const [a, b] of [['-- A wishlist thing', '-- A wish: fulfilled.'], ['-- A wish: fulfilled.', '-- A project phase'],
    ['if e.effect = \'shop_bought\' then', 'elsif e.effect = \'phase_done\' then']]) {
    if (part(raw, a, b).replace(/\s+/g, ' ') !== part(m211, a, b).replace(/\s+/g, ' ')) problems.push(`211's "${a}" part changed`)
  }
  if ((sql.match(/pg_trigger_depth\(\) = 1 and not public\.trakt_sync_writing\(\)/g) || []).length !== 2) problems.push('the movie and episode effects must each skip a plan closed by another trigger or by the sync')
  // 155's slot rule, carried over with only the ticked task's own slot spared (and the user scope added).
  for (const f of ['media_watch_cleans_planned_block', 'cleanup_block_on_episode_watched']) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${f}()`), sql.indexOf('$$;', sql.indexOf(`create or replace function public.${f}()`)))
    if (!/update public\.tasks t set status = 'done'/.test(body) || !/delete from public\.time_blocks b/.test(body)
        || !/and b\.task_id is distinct from v_keep;/.test(body) || !/v_keep +uuid := public\.plan_tick_task\(\);/.test(body)) problems.push(`${f} lost 155's rule or its one exception`)
  }
  if (!/split_part\(v, ':', 2\) <> txid_current\(\)::text then return null/.test(sql)) problems.push('plan_tick_task must take only this transaction\'s stamp')
  if (problems.length) fail(`migration 216 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-media-tick: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-media-tick: no ${what} in ${file}`)
  return m[1] ?? m[0]
}
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
const runScenarios = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  return passed
}

// The live chain (verify-db-linked-plans'), up to and with 193.
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

// 211's scenarios after 216, all but the one 216 reverses (Y1: a hand tick of a movie plan writes no watch) — run on
// 149's real table here, so 211's movie rules (Y2, Y3: a watch on or after the plan's day closes it) are proven on it.
const lp = readFileSync(join(root, 'scripts/db-tests/linked-plans/scenarios.sql'), 'utf8')
const y1From = lp.indexOf("select t_set(t_id('movie'), 'done');")
const y1To = lp.indexOf("select t_set(t_id('movie'), 'open');")
if (y1From < 0 || y1To < y1From) fail('linked-plans/scenarios.sql no longer has its Y1 (a hand tick of a movie plan) where this runner leaves it out')
const lpAfter216 = lp.slice(0, y1From) + lp.slice(lp.indexOf('\n', y1To) + 1)

let code = 0
const name = `mt_${process.pid}_${Date.now() % 100000}`
const scratch = mkdtempSync(join(tmpdir(), 'media-tick-'))
let passed = 0
let passed211 = 0
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
  step('task-links seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/task-links/seed.sql')]))
  step('210', () => psql(a, ['-f', mig('210_task_links.sql')]))
  step('211 seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/linked-plans/seed.sql')]))
  step('snapshot before 211', () => psql(a, ['-c', 'create table public.t_before211 as select id, status, title from public.tasks']))
  step('211', () => psql(a, ['-f', mig('211_linked_plans.sql')]))
  step('216 seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/media-tick/seed.sql')]))
  for (const f of ['184_trakt_sync_writer_check.sql', '149_media_watches.sql', '161_rewatch_from_watching.sql', '211_linked_plans.sql'])
    step(f, () => psql(a, ['-f', mig(f)]))
  step('216 first run', () => psql(a, ['-f', mig216]))
  step('216 second run', () => psql(a, ['-f', mig216]))
  // 211's scenarios first (their R1 compares every task with the snapshot taken before 211: 149 and 216 hid none).
  const lpFile = join(scratch, 'linked-plans-after-216.sql')
  writeFileSync(lpFile, lpAfter216)
  step('211 scenarios after 216', () => { passed211 = runScenarios(a, lpFile) })
  step('scenarios', () => { passed = runScenarios(a, join(root, 'scripts/db-tests/media-tick/scenarios.sql')) })
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  rmSync(scratch, { recursive: true, force: true })
  if (!process.env.KEEP_DB) try { psql(url, ['-c', `drop database if exists ${name}`]) } catch { /* best effort */ }
}
if (code) process.exit(code)
console.log(`verify-db-media-tick: static checks passed; on the live item chain with 210, 211, the real 149 / 161 / 184, 216 ran twice: ${passed} scenarios passed, and 211's own ${passed211} still pass after 216`)
