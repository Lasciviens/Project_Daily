// Runs migration 155's scenarios (one item: the save, a repeat's day, the
// conversion and its Undo, the calendar outbox's upsert, the Calendar
// read-back) on a throwaway Postgres: a fresh database from
// scripts/db-tests/one-item/base.sql, the real rules 155 extends (142's
// training pair, 149's and 043's cleanups — cut out of their migrations
// below), the real migrations 135 (calendar outbox), 144 (delete with
// undo), 147 (plan series), 150 and 151 (Undo this save), seed.sql (the owner's data as it is before 155, with a snapshot of
// every Google-facing column), then the real 155 TWICE (a re-run must be a
// no-op), then scenarios.sql — which first proves 155 itself lost, duplicated,
// moved or queued nothing.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-one-item.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it says so and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migFile = join(root, 'supabase/migrations/155_one_item.sql')

// Static: the migration talks to nothing outside the database (no pg_net /
// http extension call, no Vault secret) — Google is only ever called by the
// browser and google-tasks-sync.
const sql = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const outside = [/\bnet\.http_/i, /\bhttp_(get|post|put|patch|delete)\s*\(/i, /\bextensions\.http/i, /vault\./i, /googleapis/i]
  .filter(re => re.test(sql))
if (outside.length) {
  console.error(`verify-db-one-item: migration 155 must not call outside the database (${outside.join(', ')})`)
  process.exit(1)
}
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) {
  console.error('verify-db-one-item: migration 155 must not contain a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-one-item: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/one-item')
const mig = f => join(root, 'supabase/migrations', f)
const db = `t155_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// The REAL rules 155 extends, cut out of their migrations: 142's training
// day/time pair, 149's planned-episode cleanup (and its plan-day helper), and
// 043's episode trigger and project-item cleanup (base.sql has their tables).
function piece(file, from, to) {
  const s = readFileSync(mig(file), 'utf8')
  const a = s.indexOf(from)
  const b = s.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`verify-db-one-item: ${file} no longer has "${from}" … "${to}"`)
  return s.slice(a, b + (to.startsWith('--') ? 0 : to.length))
}
const pieces = [
  piece('142_training_session_one_model.sql', 'CREATE OR REPLACE FUNCTION public.training_block_moves_task()', '-- ── 2. A skip is the session'),
  piece('149_media_watches.sql', 'CREATE OR REPLACE FUNCTION public.media_watch_plan_day(p_at timestamptz)', '-- ── 4. Trakt outbox: one play at a time'),
  piece('043_linked_entity_sync.sql', 'DROP TRIGGER IF EXISTS trg_cleanup_block_on_episode_watched',
    'FOR EACH ROW EXECUTE FUNCTION public.cleanup_block_on_project_item_delete();'),
].join('\n\n')

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(dir, 'base.sql')])
  psql(target, ['-c', pieces])
  const files = [
    mig('135_calendar_outbox.sql'), mig('144_delete_with_undo.sql'),
    mig('147_schedule_block_calendar_series.sql'), mig('150_undo_save.sql'), mig('151_undo_save_fixes.sql'),
    join(dir, 'seed.sql'), migFile, migFile,
  ]
  for (const f of files) psql(target, ['-f', f])
  // Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-one-item: the real 142 / 149 / 043 rules, migrations 135 + 144 + 147 + 150 + 151, the owner's data, 155 (applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
