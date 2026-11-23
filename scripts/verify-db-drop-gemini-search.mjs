// Runs migration 201's scenarios (AI phase 5: drops ai_embeddings, ai_semantic_search, 140's follow triggers and
// ai_reviews) on a throwaway Postgres: the state 065 and 140 left, then the real 201 twice (the second run must change
// nothing and fail on nothing), then the scenarios. Static checks first. With no database URL it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-drop-gemini-search.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(root, 'supabase/migrations/201_drop_gemini_search.sql')
const fail = msg => { console.error(`verify-db-drop-gemini-search: ${msg}`); process.exit(1) }

{
  const sql = readFileSync(FILE, 'utf8').replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  for (const t of ['ai_embeddings', 'ai_reviews']) if (!new RegExp(`drop table if exists public\\.${t};`).test(sql)) problems.push(`no "drop table if exists" for ${t}`)
  if (!/drop function if exists public\.ai_semantic_search\(text, int\);/.test(sql)) problems.push('ai_semantic_search is not dropped')
  if (!/drop function if exists public\.ai_embeddings_follow_source\(\);/.test(sql)) problems.push('the follow function is not dropped')
  if (/\bcascade\b/i.test(sql)) problems.push('a CASCADE (name every dependent instead)')
  if (/drop (table|extension)[^;]*(ai_memory|ai_calls|vector)/i.test(sql)) problems.push('drops something that must stay')
  if (problems.length) fail(`migration 201 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-drop-gemini-search: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const db = `t201_${process.pid}`
let code = 0
psql(url, ['-c', `create database ${db}`])
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(root, 'scripts/db-tests/drop-gemini-search/base.sql')])
  psql(target, ['-f', FILE])
  psql(target, ['-f', FILE])
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/drop-gemini-search/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0 || passed < 7) { console.error(run.stderr.split('\n').filter(l => !/NOTICE:  ok/.test(l)).slice(0, 12).join('\n')); code = 1 }
  else console.log(`verify-db-drop-gemini-search: 201 ran twice; ${passed} scenarios passed`)
} catch (e) {
  console.error((e.stderr || e.message).toString().split('\n').slice(0, 8).join('\n'))
  code = 1
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
process.exit(code)
