// Runs migrations 173 + 174's scenarios (the app's events in Apple Calendar:
// the queue and its triggers, dormant while every area is on Google; 174 the
// security fixes — area keys, never addresses) on a
// throwaway Postgres: scripts/db-tests/one-item/base.sql plus the columns
// 141/155/162 added to tasks, time_blocks and schedule_blocks, the real 160
// list for Undo, 171 and 172, the real 173 as it ran in production, then
// 174 twice (it must survive a re-run) and scripts/db-tests/icloud-events/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-icloud-events.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig173 = mig('173_icloud_events.sql')
const migFile = mig('174_icloud_events_safety.sql')

const sql = readFileSync(mig173, 'utf8').replace(/--.*$/gm, '')
const fix = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const problems = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database (a trigger never calls iCloud)')
if (!sql.includes("owner_lock_apply('public.icloud_outbox')")) problems.push('no owner lock on icloud_outbox')
if (!/revoke all on public\.icloud_outbox from anon, authenticated/i.test(sql)) problems.push('icloud_outbox is not closed to the browser')
for (const fn of ['icloud_time_block_changed', 'icloud_schedule_block_changed', 'icloud_task_changed']) {
  const body = sql.slice(sql.indexOf(`function public.${fn}()`))
  if (!/app\.icloud_readback/.test(body.slice(0, 600))) problems.push(`${fn} doesn't stop for the read-back`)
}
// 174 (security review 30.10.2026): area keys, never addresses; the browser can't call the queue helpers.
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(fix)) problems.push('174: a top-level BEGIN/COMMIT')
if (!/revoke all on function public\.icloud_writes_on\(uuid\) from public, anon, authenticated/i.test(fix)) problems.push('174: icloud_writes_on still open to the browser')
if (!/icloud_area in \('training', 'work', 'personal', 'media', 'football'\)/.test(fix)) problems.push('174: icloud_area takes more than the five area keys')
for (const fn of ['icloud_time_block_changed', 'icloud_schedule_block_changed', 'icloud_task_changed']) {
  const body = fix.slice(fix.indexOf(`function public.${fn}()`), fix.indexOf('$$;', fix.indexOf(`function public.${fn}()`)))
  if (/icloud_href/.test(body)) problems.push(`174: ${fn} still reads the retired icloud_href`)
}
if (problems.length) {
  console.error(`verify-db-icloud-events: migrations 173/174 have ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-icloud-events: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const db = `t173_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// The columns later migrations added to the item tables (base.sql is the 142 schema).
const LATER_COLUMNS = `
  alter table public.tasks add column if not exists google_target text, add column if not exists project_id uuid,
    add column if not exists hevy_routine_id text;
  alter table public.time_blocks add column if not exists busy boolean not null default true;
  alter table public.schedule_blocks alter column start_time drop not null, alter column end_time drop not null,
    add column if not exists busy boolean not null default true, add column if not exists google_target text,
    add column if not exists domain text, add column if not exists notes text;`
// The real 160 list for Undo (173 must keep every entry of it).
const BOOKKEEPING_160 = readFileSync(mig('160_supplement_schedules.sql'), 'utf8')
  .match(/create or replace function public\.app_undo_bookkeeping\(p_table text\)[\s\S]*?\n\$\$;/)?.[0]
if (!BOOKKEEPING_160) { console.error('verify-db-icloud-events: 160\'s app_undo_bookkeeping not found'); process.exit(1) }

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')])
  psql(target, ['-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role'])
  psql(target, ['-c', LATER_COLUMNS])
  psql(target, ['-c', BOOKKEEPING_160])
  psql(target, ['-f', mig('171_icloud_credentials.sql')])
  psql(target, ['-f', mig('172_calendar_prefs.sql')])
  psql(target, ['-f', mig173])
  // A forged address written while 173 was live: 174 must empty it and drop what it queued.
  psql(target, ['-c', "insert into public.time_blocks (id, user_id, date, title, icloud_href) values ('20000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', '2026-11-01', 'forged', 'https://p1-caldav.icloud.com/1/calendars/lasci-work/../home/')"])
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/icloud-events/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-icloud-events: 173, then 174 (applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
