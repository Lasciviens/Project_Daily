// Runs migration 166's scenarios (a moved training session is moved: its
// Hevy workout link checked again, a missed day moved is to do, a repeat's day
// moved without its slot gets one, the one-off repair) and then migration
// 167's (a workout represents itself, a session lives one week: no stand-in
// between two routines, skipped then done inside its week, a move of 7 or
// more days, the end of a session's week, the repair) on a throwaway
// Postgres built as verify-db-football builds it — the item save as it is
// live: one-item/base.sql + repeat-days/base.sql, 112's skips, the real 141,
// 142, 135, 144, 147, 150, 151, 155, 156, 160's repeat rule, 163 and 165 —
// then the real 166 twice (it must survive a re-run),
// scripts/db-tests/training-recheck/scenarios.sql, the real 167 twice (its
// backfill runs over 166's rows), the real 169 (167's rules with the 28.10
// audit's fixes; its own scenarios: verify-db-training-stock-fixes) and
// scenarios-167.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-training-recheck.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const migFile = mig('166_training_moves_recheck.sql')
const mig167 = mig('167_training_week_rules.sql')

// Static: one transaction, nothing outside the database, no table of its own.
const problems = []
for (const [n, file] of [['166', migFile], ['167', mig167]]) {
  const sql = readFileSync(file, 'utf8').replace(/--.*$/gm, '')
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push(`${n}: a top-level BEGIN/COMMIT (the deploy runs it as one transaction)`)
  if (/\bnet\.http_|vault\.|googleapis/i.test(sql)) problems.push(`${n}: a call outside the database`)
  if (/create\s+table/i.test(sql)) problems.push(`${n}: a table (it adds none)`)
  if (!/revoke all on function public\.training_task_recheck\(uuid\) from public, anon, authenticated/i.test(sql)) problems.push(`${n}: the recheck callable from the browser`)
}
if (!/revoke all on function public\.training_move_past_week\(uuid, date, time, time\) from public, anon, authenticated/i.test(readFileSync(mig167, 'utf8'))) problems.push('167: the move rule callable from the browser')
if (problems.length) {
  console.error(`verify-db-training-recheck: ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-training-recheck: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const oneItem = join(root, 'scripts/db-tests/one-item')
const dir = join(root, 'scripts/db-tests/training-recheck')
const db = `t166_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// 112's table only (its policies and audit trigger need Supabase roles), with the app's own-rows policy.
const table112 = readFileSync(mig('112_training_skips.sql'), 'utf8').match(/CREATE TABLE IF NOT EXISTS public\.training_skips[\s\S]*?\n\);/)
if (!table112) throw new Error('verify-db-training-recheck: could not find training_skips in migration 112')
const skips = `${table112[0]}
alter table public.training_skips enable row level security;
create policy own on public.training_skips for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.training_skips to authenticated;`
// 160 moved the repeat rule into repeat_rule_occurs_on; its section runs after 156.
const ruleSection = readFileSync(mig('160_supplement_schedules.sql'), 'utf8').match(/-- <repeat-rule>\n([\s\S]*?)-- <\/repeat-rule>/)?.[1]
if (!ruleSection) throw new Error('verify-db-training-recheck: migration 160 has no <repeat-rule> section')

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(oneItem, 'base.sql')])
  psql(target, ['-f', join(root, 'scripts/db-tests/repeat-days/base.sql')])
  psql(target, ['-c', skips])
  for (const f of ['141_training_task_links.sql', '142_training_session_one_model.sql', '135_calendar_outbox.sql', '144_delete_with_undo.sql',
    '147_schedule_block_calendar_series.sql', '150_undo_save.sql', '151_undo_save_fixes.sql', '155_one_item.sql', '156_repeat_days_as_tasks.sql']) {
    psql(target, ['-f', mig(f)])
  }
  psql(target, ['-c', ruleSection])
  for (const f of ['163_football.sql', '165_football_category.sql']) psql(target, ['-f', mig(f)])
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])
  // Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const scenarios = file => {
    const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, file)], { encoding: 'utf8' })
    if (run.status !== 0) failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    return (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  }
  const passed166 = scenarios('scenarios.sql')
  let passed167 = 0
  if (!failed) {
    psql(target, ['-f', mig167])
    psql(target, ['-f', mig167])
    // 169 redefines 167's rules (their fixes): 167's scenarios run on the live definitions.
    psql(target, ['-f', mig('169_training_and_stock_fixes.sql')])
    passed167 = scenarios('scenarios-167.sql')
  }
  if (failed) console.error(failed)
  else console.log(`verify-db-training-recheck: the live item save (141–165), 166 (applied twice) with ${passed166} scenarios, then 167 (applied twice) and 169 with ${passed167} scenarios passed`)
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
