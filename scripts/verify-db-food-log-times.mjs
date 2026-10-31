// Runs migration 181's scenarios (a time on every food log: the database
// fills it for every writer that sends none, a sent time is kept, planned
// rows and older logs have none) on a throwaway Postgres built from
// scripts/db-tests/food-dishes/base.sql and the real 106 (the computed totals'
// triggers stay beside the new one), then the real 181 twice,
// scripts/db-tests/food-log-times/scenarios.sql, and the SQL meal hours
// (food_meal_usual_time) against the browser's (foodLogUtils.MEAL_USUAL_TIME).
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-food-log-times.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig181 = mig('181_food_log_times.sql')

{
  const sql = readFileSync(mig181, 'utf8').replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database')
  if (/create table/i.test(sql)) problems.push('a new table (it would need the owner lock, grants and audit)')
  if (/update public\.food_log_entries/i.test(sql)) problems.push('a backfill (older logs keep no time — the owner\'s answer)')
  if (problems.length) {
    console.error(`verify-db-food-log-times: migration 181 has ${problems.join('; ')}`)
    process.exit(1)
  }
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-food-log-times: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const require = createRequire(import.meta.url)
require('sucrase/register')
const { MEAL_USUAL_TIME } = require('../src/features/recipes/components/foodLogUtils.ts')

const db = `t181_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

psql(url, ['-c', `create database ${db}`])
let failed = null
let passed = 0
try {
  const target = withDb(url, db)
  for (const f of [join(root, 'scripts/db-tests/food-dishes/base.sql'), mig('106_food_macros_computed.sql'), mig181, mig181]) psql(target, ['-f', f])
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/food-log-times/scenarios.sql')], { encoding: 'utf8' })
  passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  }
  if (!failed) {
    for (const [slot, time] of Object.entries(MEAL_USUAL_TIME)) {
      const sql = psql(target, ['-At', '-c', `select to_char(public.food_meal_usual_time('${slot}'), 'HH24:MI')`]).trim()
      if (sql !== time) { failed = `food_meal_usual_time('${slot}') = ${sql}, the browser's MEAL_USUAL_TIME = ${time}`; console.error(`verify-db-food-log-times: ${failed}`); break }
    }
  }
} finally {
  psql(url, ['-c', `drop database if exists ${db}`])
}
if (failed) process.exit(1)
console.log(`verify-db-food-log-times: 106, 181 (applied twice), ${passed} scenarios and the SQL meal hours = the browser's passed`)
