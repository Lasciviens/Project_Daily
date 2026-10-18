// Runs migration 162's scenarios (projects for every kind of project: the
// old items moved into tasks, the new project fields, blocks and entries,
// app_create_project, delete with Undo across the new keys) on a throwaway
// Postgres: scripts/db-tests/one-item/base.sql with the real rules 155
// builds on (as verify-db-one-item cuts them), the real migrations 135, 144,
// 147, 150, 151 and 155, then scripts/db-tests/project-blocks/base.sql (the
// project tables as they are live, and the owner's projects before 162),
// then the real 162 twice (a re-run must move nothing again) and
// scripts/db-tests/project-blocks/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-project-blocks.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const migFile = mig('162_project_blocks.sql')

// Static: one transaction, nothing outside the database, every new table locked.
const sql = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const problems = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\.|googleapis/i.test(sql)) problems.push('a call outside the database')
for (const t of sql.matchAll(/create table if not exists public\.(\w+)/gi)) {
  if (!sql.includes(`owner_lock_apply('public.${t[1]}')`)) problems.push(`no owner lock on ${t[1]}`)
  if (!new RegExp(`trg_audit[\\s\\S]*?on public\\.${t[1]}\\b`, 'i').test(sql)) problems.push(`no trg_audit on ${t[1]}`)
}
if (problems.length) {
  console.error(`verify-db-project-blocks: migration 162 has ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-project-blocks: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const oneItem = join(root, 'scripts/db-tests/one-item')
const dir = join(root, 'scripts/db-tests/project-blocks')
const db = `t162_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// The real rules 155 builds on, cut out of their migrations (as verify-db-one-item does).
function piece(file, from, to) {
  const s = readFileSync(mig(file), 'utf8')
  const a = s.indexOf(from)
  const b = s.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`verify-db-project-blocks: ${file} no longer has "${from}" … "${to}"`)
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
  psql(target, ['-f', join(oneItem, 'base.sql')])
  psql(target, ['-c', pieces])
  const files = [
    mig('135_calendar_outbox.sql'), mig('144_delete_with_undo.sql'),
    mig('147_schedule_block_calendar_series.sql'), mig('150_undo_save.sql'), mig('151_undo_save_fixes.sql'),
    mig('155_one_item.sql'), join(dir, 'base.sql'), migFile, migFile,
  ]
  for (const f of files) psql(target, ['-f', f])
  // Each passing scenario prints a NOTICE ("ok  …") on stderr; a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-project-blocks: migrations 135 + 144 + 147 + 150 + 151 + 155, the owner's projects, 162 (applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
