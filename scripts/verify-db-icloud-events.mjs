// Runs migration 173's scenarios (the app's events in Apple Calendar: the
// queue and its triggers, dormant while every area is on Google) on a
// throwaway Postgres: scripts/db-tests/one-item/base.sql plus the columns
// 141/155/162 added to tasks, time_blocks and schedule_blocks, the real 160
// list for Undo, 171 and 172, then the real 173 twice (it must survive a
// re-run) and scripts/db-tests/icloud-events/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-icloud-events.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const migFile = mig('173_icloud_events.sql')

const sql = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const problems = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database (a trigger never calls iCloud)')
if (!sql.includes("owner_lock_apply('public.icloud_outbox')")) problems.push('no owner lock on icloud_outbox')
if (!/revoke all on public\.icloud_outbox from anon, authenticated/i.test(sql)) problems.push('icloud_outbox is not closed to the browser')
for (const fn of ['icloud_time_block_changed', 'icloud_schedule_block_changed', 'icloud_task_changed']) {
  const body = sql.slice(sql.indexOf(`function public.${fn}()`))
  if (!/app\.icloud_readback/.test(body.slice(0, 600))) problems.push(`${fn} doesn't stop for the read-back`)
}
if (problems.length) {
  console.error(`verify-db-icloud-events: migration 173 has ${problems.join('; ')}`)
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
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/icloud-events/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-icloud-events: 173 (applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
