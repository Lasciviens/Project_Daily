// Runs migration 184's scenarios (the Trakt sync's own writes are known by who writes them, not by a header any
// caller can send) on a throwaway Postgres: the three API roles, the real 184 twice, then
// scripts/db-tests/trakt-sync-writer/scenarios.sql. Static checks first: 184 changes only trakt_sync_writing(), and
// every Trakt outbox trigger still asks it (so the one fix covers them all).
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-trakt-sync-writer.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL (a laptop without
// Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migDir = join(root, 'supabase/migrations')
const mig184 = join(migDir, '184_trakt_sync_writer_check.sql')
const fail = msg => { console.error(`verify-db-trakt-sync-writer: ${msg}`); process.exit(1) }

{
  const sql = readFileSync(mig184, 'utf8').replace(/--.*$/gm, '')
  const fns = [...sql.matchAll(/create or replace function (public\.\w+)/gi)].map(m => m[1])
  if (fns.join() !== 'public.trakt_sync_writing') fail(`184 should re-create only public.trakt_sync_writing, found ${fns.join(', ')}`)
  if (/^\s*(begin|commit)\s*;/im.test(sql)) fail('184 has a top-level BEGIN/COMMIT')
  if (!/->> 'role', ''\) = 'service_role'/.test(sql) || !/current_setting\('role', true\), ''\) = 'service_role'/.test(sql) || !/x-trakt-sync/.test(sql)) fail('184 must ask for the service role with the header')
  // No later migration may put the old header-only rule back.
  const later = readdirSync(migDir).filter(f => /^\d+_/.test(f) && Number(f.slice(0, 3)) > 184)
  for (const f of later) if (/function public\.trakt_sync_writing/i.test(readFileSync(join(migDir, f), 'utf8'))) fail(`${f} re-creates trakt_sync_writing: keep 184's service-role check`)
  // Every Trakt outbox trigger function asks the one rule.
  const callers = readdirSync(migDir).filter(f => /\.sql$/.test(f)).map(f => readFileSync(join(migDir, f), 'utf8'))
    .flatMap(t => [...t.matchAll(/CREATE OR REPLACE FUNCTION public\.(trakt_outbox_\w+)\(\)[\s\S]*?\n\$\$;/gi)])
  if (!callers.length) fail('found no trakt_outbox_* trigger functions to check')
  const skipping = callers.filter(m => !/trakt_sync_writing\(\)/.test(m[0]))
  if (skipping.length) fail(`trigger functions that skip the sync without asking trakt_sync_writing(): ${[...new Set(skipping.map(m => m[1]))].join(', ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-trakt-sync-writer: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}
const db = `t184_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
psql(url, ['-c', `create database ${db}`])
let failed = null
let passed = 0
try {
  const target = withDb(url, db)
  psql(target, ['-c', `do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
    grant usage on schema public to anon, authenticated, service_role;`])
  for (let n = 0; n < 2; n++) psql(target, ['-f', mig184])
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/trakt-sync-writer/scenarios.sql')], { encoding: 'utf8' })
  passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
console.log(`verify-db-trakt-sync-writer: 184 (applied twice) and ${passed} scenarios passed; every Trakt outbox trigger asks the one rule`)
