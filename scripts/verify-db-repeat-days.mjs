// Runs migration 156's scenarios (every repeating item's day is a real task
// on its day) on a throwaway Postgres: a fresh database from
// scripts/db-tests/one-item/base.sql + repeat-days/base.sql, 112's skips
// table, the real migrations 141 and 142 (training), 135, 144, 147, 150, 151
// and 155, repeat-days/seed.sql (the owner's data before 156), then the real
// 156 TWICE (a re-run must be a no-op), then:
//   1. repeat-days/scenarios.sql — 156 itself changed nothing, one task per
//      day even when run twice, only today's on the first run, skipped /
//      deleted / moved days never made again, a training day is the row 142
//      makes, missed days closed on their day, a late Hevy workout still
//      completes one, the Google choices reach the right outbox;
//   2. the SQL repeat rule (repeat_occurs_on) against daily/recurrence.ts's
//      occursOn, day by day over two years, for every kind.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-repeat-days.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migFile = join(root, 'supabase/migrations/156_repeat_days_as_tasks.sql')

// Static: the migration talks to nothing outside the database (no pg_net /
// http call, no Vault secret) and its job calls a SQL function directly.
const sql = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const outside = [/\bnet\.http_/i, /\bhttp_(get|post|put|patch|delete)\s*\(/i, /\bextensions\.http/i, /vault\./i, /googleapis/i]
  .filter(re => re.test(sql))
if (outside.length) {
  console.error(`verify-db-repeat-days: migration 156 must not call outside the database (${outside.join(', ')})`)
  process.exit(1)
}
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) {
  console.error('verify-db-repeat-days: migration 156 must not contain a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  process.exit(1)
}
if (!/cron\.unschedule\('lascis-repeat-days'\)/.test(sql) || !/cron\.schedule\('lascis-repeat-days',\s*'[^']+',\s*'select public\.repeat_days_run\(\)'\)/.test(sql)) {
  console.error('verify-db-repeat-days: the job must be (re)scheduled with cron.unschedule + cron.schedule calling public.repeat_days_run() directly')
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-repeat-days: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/repeat-days')
const mig = f => join(root, 'supabase/migrations', f)
const db = `t156_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// 112's table only (its policies and audit trigger need Supabase roles), with
// the app's own-rows policy.
const table112 = readFileSync(mig('112_training_skips.sql'), 'utf8').match(/CREATE TABLE IF NOT EXISTS public\.training_skips[\s\S]*?\n\);/)
if (!table112) throw new Error('verify-db-repeat-days: could not find training_skips in migration 112')
const skips = `${table112[0]}
alter table public.training_skips enable row level security;
create policy own on public.training_skips for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.training_skips to authenticated;`

// ── 1. The rule in SQL vs daily/recurrence.ts ────────────────────────────────
const require = createRequire(import.meta.url)
require('sucrase/register')
const R = require('../src/features/daily/recurrence.ts')
const { matchRoutineToPlan } = require('../src/features/training/plan/nextSession.ts')
const RULES = [
  { days_of_week: [1, 3, 5], repeat_kind: 'weekly', effective_from: '2026-02-11' },
  { days_of_week: [0, 1, 2, 3, 4, 5, 6], repeat_kind: 'weekly', effective_from: '2026-01-01', except_dates: ['2026-03-29', '2026-10-25'] },
  { days_of_week: [6], repeat_kind: 'monthly', effective_from: '2026-10-13' },
  { days_of_week: [], repeat_kind: 'monthly', effective_from: '2026-01-31' },
  { days_of_week: [0], repeat_kind: 'monthly', effective_from: '2026-03-01' },
  { days_of_week: [], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'day', effective_from: '2026-02-27' },
  { days_of_week: [2, 4], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week', effective_from: '2026-01-07' },
  { days_of_week: [0, 6], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'week', effective_from: '2026-05-03' },
  { days_of_week: [3], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'month', effective_from: '2026-01-29' },
  { days_of_week: [], repeat_kind: 'interval', repeat_interval: 5, repeat_unit: 'month', effective_from: '2026-08-31' },
  { days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-02-28', '2026-07-04', '2027-02-28', '2027-12-31'], effective_from: '2026-02-28' },
  { days_of_week: [5], repeat_kind: 'weekly', effective_from: '2027-06-15' },
]
const FROM = '2026-01-01', TO = '2027-12-31'
const lit = v => (v == null ? 'null' : `'${v}'`)
const arr = (a, type) => (a == null ? 'null' : `'{${a.join(',')}}'::${type}[]`)
const ruleRows = RULES.map((r, i) => `('00000000-0000-4000-8000-${String(900 + i).padStart(12, '0')}', '00000000-0000-0000-0000-000000000003', 'rule ${i}',
  ${arr(r.days_of_week, 'integer')}, '10:00', '11:00', ${lit(r.effective_from)}, ${arr(r.except_dates ?? [], 'date')}, ${lit(r.repeat_kind)},
  ${r.repeat_interval ?? 'null'}, ${lit(r.repeat_unit)}, ${arr(r.repeat_dates, 'date')})`).join(',\n')
const compareSql = `
insert into public.schedule_blocks (id, user_id, title, days_of_week, start_time, end_time, effective_from, except_dates, repeat_kind,
  repeat_interval, repeat_unit, repeat_dates) values ${ruleRows};
\\copy (select s.title, to_char(d, 'YYYY-MM-DD') from public.schedule_blocks s, generate_series('${FROM}'::date, '${TO}'::date, interval '1 day') d where s.user_id = '00000000-0000-0000-0000-000000000003' and s.title like 'rule %' and public.repeat_occurs_on(s, d::date) order by s.title, d) to stdout
delete from public.schedule_blocks where user_id = '00000000-0000-0000-0000-000000000003' and title like 'rule %';
`

// The training day's routine: SQL's repeat_day_routine = nextSession.matchRoutineToPlan (no source id).
const ROUTINES = [
  { id: '8b000000-0000-4000-8000-000000000001', title: 'Push day' },
  { id: '8b000000-0000-4000-8000-000000000002', title: 'push  DAY' },
  { id: '8b000000-0000-4000-8000-000000000003', title: 'Legs' },
  { id: '8b000000-0000-4000-8000-000000000004', title: 'Upper B' },
  { id: '8b000000-0000-4000-8000-000000000005', title: 'Upper' },
  { id: '8b000000-0000-4000-8000-000000000006', title: 'Øvelse på bänk' },
  { id: '8b000000-0000-4000-8000-000000000007', title: 'Ab' },
]
const PROGRAM = ['8b000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000005']
const TITLES = ['Push day', 'Push day — heavy', 'Legs', 'legs!', 'Upper B', 'Upper body', 'Upper A', 'Full body', 'Ovelse pa bank',
  'Øvelse på bänk (light)', 'Ab wheel', 'Abs', '', 'Leg day', 'Heavy legs and push day']
const routineSql = `
insert into public.hevy_routines (id, user_id, title) values ${ROUTINES.map(r => `('${r.id}', '00000000-0000-0000-0000-000000000003', '${r.title}')`).join(', ')};
insert into public.current_program_routines (user_id, routine_id) values ${PROGRAM.map(id => `('00000000-0000-0000-0000-000000000003', '${id}')`).join(', ')};
${TITLES.map((t, i) => `select 'title ${i}', coalesce(public.repeat_day_routine('00000000-0000-0000-0000-000000000003', '${t.replace(/'/g, "''")}'), '-');`).join('\n')}
delete from public.current_program_routines where user_id = '00000000-0000-0000-0000-000000000003';
delete from public.hevy_routines where user_id = '00000000-0000-0000-0000-000000000003';
`

psql(url, ['-c', `create database ${db}`])
let failed = null
let ruleChecks = 0
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')])
  psql(target, ['-f', join(dir, 'base.sql')])
  psql(target, ['-c', skips])
  for (const f of ['141_training_task_links.sql', '142_training_session_one_model.sql', '135_calendar_outbox.sql', '144_delete_with_undo.sql',
    '147_schedule_block_calendar_series.sql', '150_undo_save.sql', '151_undo_save_fixes.sql', '155_one_item.sql']) {
    psql(target, ['-f', mig(f)])
  }
  psql(target, ['-f', join(dir, 'seed.sql')])
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])

  // 1. The scenarios. Each passing one prints a NOTICE ("ok  …"); a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    // 2. SQL's rule = recurrence.ts's, day by day (after the scenarios: its
    //    rows are a third account's and leave again).
    const got = new Map(RULES.map((_, i) => [`rule ${i}`, []]))
    const out = execFileSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-At'], { input: compareSql, encoding: 'utf8' })
    // \copy writes COPY's text format: tab-separated
    for (const line of out.split('\n').filter(l => /^rule \d+\t/.test(l))) {
      const [title, day] = line.split('\t')
      got.get(title).push(day)
    }
    const bad = []
    RULES.forEach((r, i) => {
      const want = R.occurrencesBetween(r, FROM, TO)
      const have = got.get(`rule ${i}`)
      if (JSON.stringify(want) !== JSON.stringify(have)) bad.push(`rule ${i} (${r.repeat_kind}): TS ${want.length} days, SQL ${have.length} — first difference ${want.find((d, n) => d !== have[n]) ?? have[want.length]}`)
      else ruleChecks += want.length
    })
    // 3. SQL's routine for a training day = the app's (matchRoutineToPlan).
    const routineOut = execFileSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-F', '|'], { input: routineSql, encoding: 'utf8' })
    const sqlRoutine = new Map(routineOut.split('\n').filter(l => /^title \d+\|/.test(l)).map(l => l.split('|')))
    const program = new Set(PROGRAM)
    TITLES.forEach((t, i) => {
      const want = matchRoutineToPlan({ title: t, date: '2026-10-15', startTime: null, sourceId: null }, ROUTINES, program)?.id ?? '-'
      const have = sqlRoutine.get(`title ${i}`)
      if (want !== have) bad.push(`routine for "${t}": TS ${want}, SQL ${have}`)
      else ruleChecks++
    })
    if (bad.length) {
      failed = `FAIL  the SQL rules differ from the app's:\n${bad.join('\n')}`
      console.error(failed)
    } else {
      console.log(`verify-db-repeat-days: migrations 141 + 142 + 155, the owner's data, 156 (applied twice), ${passed} scenarios, the SQL repeat rule = recurrence.ts (${RULES.length} rules, two years) and the SQL routine match = matchRoutineToPlan (${TITLES.length} titles): ${ruleChecks} checks passed`)
    }
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
