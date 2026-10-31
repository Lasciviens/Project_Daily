// Runs migration 180's scenarios (your own labels on a task: the column and
// its one cleaning rule on every writer, the item save setting / keeping /
// clearing them and answering what it stored, the owner's label list) on a
// throwaway Postgres built as verify-db-football builds it — the item save as
// it is live: one-item/base.sql + repeat-days/base.sql, 112's skips, the real
// 141, 142, 135, 144, 147, 150, 151, 155, 156, 160's repeat rule, 165 and the
// training move triggers (166, 167, 169) — then the real 180 twice,
// scripts/db-tests/task-labels/scenarios.sql, and the SQL cleaning rule
// (task_labels_clean) against the browser's (todo/taskLabels.cleanLabels).
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-task-labels.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig180 = mig('180_task_labels.sql')

// 180's app_save_item is 165's (the live one) with ONLY the label lines added: put them back out and the two
// must be the same text, so a later change is made to the newest copy and nothing else drifts.
{
  const fn = f => readFileSync(f, 'utf8').match(/create or replace function public\.app_save_item\(p_item jsonb\)[\s\S]*?\n\$\$;/)?.[0] ?? ''
  const live = fn(mig('165_football_category.sql'))
  const back = fn(mig180)
    .replace(/\n {2}v_labels {4}text\[\] := [^\n]*\n[^\n]*jsonb_array_elements\(p_item -> 'labels'\)[^\n]*/, '')
    .replace('google_tasklist_id, labels)', 'google_tasklist_id)')
    .replace(", v_list, coalesce(v_labels, '{}'))", ', v_list)')
    .replace('\n      labels = coalesce(v_labels, t.labels),', '')
    .replace(", 'labels', to_jsonb(t.labels));", ');')
  if (!live || back !== live) {
    console.error('verify-db-task-labels: 180\'s app_save_item must be 165\'s with only the label lines added')
    process.exit(1)
  }
}

// Static: one transaction, nothing outside the database, no new table.
{
  const sql = readFileSync(mig180, 'utf8').replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/\bnet\.http_|vault\.|googleapis/i.test(sql)) problems.push('a call outside the database')
  if (/create table/i.test(sql)) problems.push('a new table (it would need the owner lock, grants and audit)')
  for (const f of sql.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)) {
    const args = f[2].replace(/\bp_\w+\s+/g, '').trim()
    if (!sql.includes(`grant execute on function ${f[1]}(${args})`)) problems.push(`no grant for ${f[1]}(${args})`)
  }
  if (problems.length) {
    console.error(`verify-db-task-labels: migration 180 has ${problems.join('; ')}`)
    process.exit(1)
  }
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-task-labels: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const require = createRequire(import.meta.url)
require('sucrase/register')
const { cleanLabels } = require('../src/features/todo/taskLabels.ts')

const oneItem = join(root, 'scripts/db-tests/one-item')
const dir = join(root, 'scripts/db-tests/task-labels')
const db = `t180_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const table112 = readFileSync(mig('112_training_skips.sql'), 'utf8').match(/CREATE TABLE IF NOT EXISTS public\.training_skips[\s\S]*?\n\);/)
if (!table112) throw new Error('verify-db-task-labels: could not find training_skips in migration 112')
const skips = `${table112[0]}
alter table public.training_skips enable row level security;
create policy own on public.training_skips for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.training_skips to authenticated;`
const ruleSection = readFileSync(mig('160_supplement_schedules.sql'), 'utf8').match(/-- <repeat-rule>\n([\s\S]*?)-- <\/repeat-rule>/)?.[1]
if (!ruleSection) throw new Error('verify-db-task-labels: migration 160 has no <repeat-rule> section')

// The cleaning rule's cases, run through SQL and through the browser's copy. Case is compared as the database
// compares it (lower()), so the cases change case only in ASCII letters.
const CASES = [
  ['  Errands ', 'errands', 'Phone\tcall', 'Home  Office'],
  ['x'.repeat(40)],
  ['ab '.repeat(12)],
  ['🙂'.repeat(35), 'Øl', 'Ærend', 'Å bake'],
  ['', '   ', '\n'],
  Array.from({ length: 14 }, (_, i) => `L${i % 12}`),
  ['A', 'a', 'B', 'b ', ' B'],
  ['tab\there', 'line\r\nbreak', 'bell\u0007'],
  ['a\u202Eb', '\u00A0\u00A0', 'zero\u200Bwidth', 'line\u2028sep', 'c1\u0085x', 'bom\uFEFF', 'em\u2003\u2003space', 'family 👨\u200D👩', 'soft\u00ADhyphen'],
  [],
]

psql(url, ['-c', `create database ${db}`])
let failed = null
let passed = 0
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
  psql(target, ['-f', mig('165_football_category.sql')])
  for (const f of ['166_training_moves_recheck.sql', '167_training_week_rules.sql', '169_training_and_stock_fixes.sql']) psql(target, ['-f', mig(f)])
  psql(target, ['-f', mig180])
  psql(target, ['-f', mig180])
  // Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  }
  // The SQL rule = the browser's, case by case.
  if (!failed) {
    for (const c of CASES) {
      const json = JSON.stringify(c)
      const sql = psql(target, ['-At', '-c', `select to_jsonb(public.task_labels_clean(array(select jsonb_array_elements_text($j$${json}$j$::jsonb))))`]).trim()
      const want = JSON.stringify(cleanLabels(c))
      if (JSON.stringify(JSON.parse(sql)) !== want) {
        failed = `task_labels_clean(${json}) = ${sql}, the browser's cleanLabels = ${want}`
        console.error(`verify-db-task-labels: ${failed}`)
        break
      }
    }
  }
} finally {
  psql(url, ['-c', `drop database if exists ${db}`])
}
if (failed) process.exit(1)
console.log(`verify-db-task-labels: the live item save (141–165, the training move triggers), 180 (applied twice), ${passed} scenarios and the SQL cleaning rule = the browser's (${CASES.length} cases) passed`)
