// Runs migration 169's scenarios (the 28.10.2026 audit's fixes) on two
// throwaway Postgres databases:
//   A. the live item save and training rules as verify-db-training-recheck
//      builds them (one-item/base.sql + repeat-days/base.sql, 112's skips, the
//      real 141, 142, 135, 144, 147, 150, 151, 155, 156, 160's repeat rule,
//      163, 165, 166, 167, 168) plus the real Google Tasks pieces the S1 pull
//      meets — 071's local-edit stamp and status buckets, 140's queue (in
//      place of base.sql's short copies) and 148's upsert_task_from_google —
//      then the real 169 TWICE and scripts/db-tests/training-stock-fixes/
//      scenarios.sql: S1 (a move read back from Google Calendar or pulled
//      from Google Tasks: the database's own training writes are queued, a
//      plain move still is not), T2 (a repeat moved 7+ days into a week with
//      no session of its plan), T5 (the app's call a day ahead), T8 (a
//      session 'waiting');
//   B. the supplement schedules as verify-db-supplement-schedules builds them
//      (supplement-schedules/base.sql, 156's rule functions, 144, 160 twice),
//      then 169's <stock-clock> section TWICE and stock-clock.sql: S4 (a
//      schedule put back by Undo keeps its stock clock).
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-training-stock-fixes.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const migFile = mig('169_training_and_stock_fixes.sql')
const raw = readFileSync(migFile, 'utf8')

// ── Static: one transaction, nothing outside the database, no table, the
// training rules still closed to the browser, the stock-clock section, and
// the other suites run on 169's definitions.
const problems = []
const sql = raw.replace(/--.*$/gm, '')
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\.|googleapis/i.test(sql)) problems.push('a call outside the database')
if (/create\s+table/i.test(sql)) problems.push('a table (it adds none)')
for (const fn of ['training_plan_candidates(uuid, date)', 'training_task_recheck(uuid)', 'training_move_past_week(uuid, date, time, time)', 'training_task_moved()']) {
  if (!raw.includes(`revoke all on function public.${fn} from public, anon, authenticated;`)) problems.push(`${fn} not revoked from the browser`)
}
const stockClock = raw.match(/-- <stock-clock>\n([\s\S]*?)-- <\/stock-clock>/)?.[1]
if (!stockClock || !/create or replace function public\.supplement_schedules_tidy\(\)/.test(stockClock)) {
  problems.push('no <stock-clock> section holding supplement_schedules_tidy (the supplement suites apply it alone)')
}
for (const s of ['verify-db-training-recheck.mjs', 'verify-db-repeat-days.mjs', 'verify-db-football.mjs']) {
  if (!readFileSync(join(root, 'scripts', s), 'utf8').includes('169_training_and_stock_fixes.sql')) problems.push(`${s} does not apply 169 (it would test 167's definitions)`)
}
if (!/<stock-clock>/.test(readFileSync(join(root, 'scripts/verify-db-supplement-schedules.mjs'), 'utf8'))) {
  problems.push('verify-db-supplement-schedules does not apply 169\'s <stock-clock> section (it would test 160\'s tidy trigger)')
}
if (!/run: node scripts\/verify-db-training-stock-fixes\.mjs\n\s+env:\n\s+DEPLOY_TEST_DB_URL: /.test(readFileSync(join(root, '.github/workflows/pr-check.yml'), 'utf8'))) {
  problems.push('the PR check does not pass its Postgres to this script (DEPLOY_TEST_DB_URL), so 169\'s scenarios would skip on every PR')
}
if (problems.length) {
  console.error(`verify-db-training-stock-fixes: migration 169 — ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-training-stock-fixes: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/training-stock-fixes')
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-training-stock-fixes: no ${what} in ${file}`)
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
  if (!m) throw new Error(`verify-db-training-stock-fixes: no ${name} in migration 156`)
  return m[0]
}).join('\n')

// Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
const scenarios = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, file)], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  const failed = run.status !== 0 ? (run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr) : null
  return { passed, failed }
}

const dbA = `t169a_${process.pid}`
const dbB = `t169b_${process.pid}`
let failed = null
let passedA = 0
let passedB = 0
try {
  // A. Training (S1, T2, T5, T8).
  psql(url, ['-c', `create database ${dbA}`])
  const a = withDb(url, dbA)
  psql(a, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')])
  psql(a, ['-f', join(root, 'scripts/db-tests/repeat-days/base.sql')])
  psql(a, ['-c', skips])
  psql(a, ['-c', googleTasks])
  for (const f of ['141_training_task_links.sql', '142_training_session_one_model.sql', '135_calendar_outbox.sql', '144_delete_with_undo.sql',
    '147_schedule_block_calendar_series.sql', '148_google_today_and_series_start.sql', '150_undo_save.sql', '151_undo_save_fixes.sql',
    '155_one_item.sql', '156_repeat_days_as_tasks.sql']) {
    psql(a, ['-f', mig(f)])
  }
  psql(a, ['-c', ruleSection])
  for (const f of ['163_football.sql', '165_football_category.sql', '166_training_moves_recheck.sql', '167_training_week_rules.sql',
    '168_football_favourite.sql']) {
    psql(a, ['-f', mig(f)])
  }
  psql(a, ['-f', migFile])
  psql(a, ['-f', migFile])
  const runA = scenarios(a, 'scenarios.sql')
  passedA = runA.passed
  failed = runA.failed

  // B. The supplement stock clock (S4).
  if (!failed) {
    psql(url, ['-c', `create database ${dbB}`])
    const b = withDb(url, dbB)
    psql(b, ['-f', join(root, 'scripts/db-tests/supplement-schedules/base.sql')])
    psql(b, ['-c', rule156])
    psql(b, ['-f', mig('144_delete_with_undo.sql')])
    psql(b, ['-f', mig('160_supplement_schedules.sql')])
    psql(b, ['-f', mig('160_supplement_schedules.sql')])
    psql(b, ['-c', stockClock])
    psql(b, ['-c', stockClock])
    const runB = scenarios(b, 'stock-clock.sql')
    passedB = runB.passed
    failed = runB.failed
  }
  if (failed) console.error(failed)
  else console.log(`verify-db-training-stock-fixes: the live item save and training rules (141–168) with 169 (applied twice), ${passedA} scenarios; the supplement schedules (160) with 169's stock clock (applied twice), ${passedB} scenarios — passed`)
} finally {
  for (const name of [dbA, dbB]) {
    try { psql(url, ['-c', `drop database if exists ${name}`]) } catch { /* best effort */ }
  }
}
if (failed) process.exit(1)
