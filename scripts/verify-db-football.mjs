// Runs migration 163's scenarios (football: the teams and tournaments
// followed, the matches in the day, app_football_plan's add and move through
// app_save_item, a deleted item never added again, delete with Undo across
// football_plans.task_id, row level security and the owner lock) on a
// throwaway Postgres built as verify-db-repeat-days builds it — the item save
// as it is live: one-item/base.sql + repeat-days/base.sql, 112's skips, the
// real 141, 142, 135, 144, 147, 150, 151, 155, 156 and 160's repeat rule —
// then the real 163 twice (it must survive a re-run),
// scripts/db-tests/football/scenarios.sql, and two sessions adding the same
// match at once (163's lock: one item, the second answers planned: false).
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-football.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const migFile = mig('163_football.sql')
const mig165 = mig('165_football_category.sql')

// 165 is 156's app_save_item with ONE line changed (the category whitelist takes 'football'):
// a later change to the item save must be made to the newest copy, so the two never drift.
{
  const fn = f => readFileSync(f, 'utf8').match(/create or replace function public\.app_save_item\(p_item jsonb\)[\s\S]*?\n\$\$;/)?.[0] ?? ''
  const a = fn(mig('156_repeat_days_as_tasks.sql')).split('\n')
  const b = fn(mig165).split('\n')
  const diff = a.map((l, i) => (l === b[i] ? null : i)).filter(i => i !== null)
  if (!a.length || a.length !== b.length || diff.length !== 1 || !/'projects', 'football', 'other'/.test(b[diff[0]])) {
    console.error(`verify-db-football: 165's app_save_item must be 156's with only the category whitelist line changed (${diff.length} lines differ)`)
    process.exit(1)
  }
}

// Static: one transaction, nothing outside the database, every new table locked and audited.
const sql = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const problems = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\.|googleapis/i.test(sql)) problems.push('a call outside the database')
for (const t of sql.matchAll(/create table if not exists public\.(\w+)/gi)) {
  if (!sql.includes(`owner_lock_apply('public.${t[1]}')`)) problems.push(`no owner lock on ${t[1]}`)
  if (!new RegExp(`trg_audit[\\s\\S]*?on public\\.${t[1]}\\b`, 'i').test(sql)) problems.push(`no trg_audit on ${t[1]}`)
}
if (problems.length) {
  console.error(`verify-db-football: migration 163 has ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-football: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const oneItem = join(root, 'scripts/db-tests/one-item')
const dir = join(root, 'scripts/db-tests/football')
const db = `t163_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// 112's table only (its policies and audit trigger need Supabase roles), with the app's own-rows policy.
const table112 = readFileSync(mig('112_training_skips.sql'), 'utf8').match(/CREATE TABLE IF NOT EXISTS public\.training_skips[\s\S]*?\n\);/)
if (!table112) throw new Error('verify-db-football: could not find training_skips in migration 112')
const skips = `${table112[0]}
alter table public.training_skips enable row level security;
create policy own on public.training_skips for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.training_skips to authenticated;`
// 160 moved the repeat rule into repeat_rule_occurs_on; its section runs after 156.
const ruleSection = readFileSync(mig('160_supplement_schedules.sql'), 'utf8').match(/-- <repeat-rule>\n([\s\S]*?)-- <\/repeat-rule>/)?.[1]
if (!ruleSection) throw new Error('verify-db-football: migration 160 has no <repeat-rule> section')

// Two sessions add the same match at once: the first holds its transaction open for a moment.
const ADD = `select public.app_football_plan('{"eventId": "777000", "league": "tur.1", "kickoffAt": "2026-11-20T18:00Z", "timeValid": true, "origin": "subscription"}',
  '{"title": "⚽ Race – Test", "domain": "personal", "priority": "medium", "date": "2026-11-20", "time": "19:00", "durationMinutes": 120, "google": "none", "today": "2026-10-19"}') ->> 'planned';`
const session = (target, sql) => new Promise(resolve => {
  const p = spawn('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-At'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', d => { out += d })
  p.stderr.on('data', d => { out += d })
  p.on('close', code => resolve({ code, out }))
  p.stdin.end(sql)
})

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
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])
  psql(target, ['-f', mig165])
  psql(target, ['-f', mig165])
  // Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    const first = session(target, `set role authenticated;\nbegin;\n${ADD}\nselect pg_sleep(1.5);\ncommit;`)
    await new Promise(r => setTimeout(r, 400))
    const second = await session(target, `set role authenticated;\n${ADD}`)
    const one = await first
    const counts = psql(target, ['-At', '-c', "select (select count(*) from public.tasks where title = '⚽ Race – Test') || ',' || (select count(*) from public.football_plans where event_id = '777000')"]).trim()
    if (one.code !== 0 || second.code !== 0 || !/^true$/m.test(one.out) || !/^false$/m.test(second.out) || counts !== '1,1') {
      failed = `two sessions adding one match: first ${JSON.stringify(one.out.trim())}, second ${JSON.stringify(second.out.trim())}, tasks,plans = ${counts} (want true, false, 1,1)`
      console.error(`verify-db-football: ${failed}`)
    } else {
      console.log(`verify-db-football: the live item save (141–156, 160's rule), 163 and 165 (each applied twice), ${passed} scenarios and two sessions adding one match (one item) passed`)
    }
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
