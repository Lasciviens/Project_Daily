#!/usr/bin/env node
// Verification — the automatic migration step (scripts/deploy/).
//
//   node scripts/verify-deploy-migrations.mjs
//       pure rules + the real supabase/migrations names
//   DEPLOY_TEST_DB_URL=postgresql://postgres:x@127.0.0.1:54329/postgres node scripts/verify-deploy-migrations.mjs
//       also runs run-migrations.mjs against that (throwaway!) database
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASELINE, BASELINE_FILE_COUNT, checkDbUrl, lineOf, migrationQuery, planMigrations, readMigrationNames,
} from './deploy/migrationPlan.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('1. names')
const real = readMigrationNames(readdirSync(join(root, 'supabase/migrations')))
check('the repo\'s migration names pass', real.errors.length === 0, real.errors.join('; '))
const old = Array.from({ length: BASELINE_FILE_COUNT }, (_, i) => `${String(i + 1).padStart(3, '0')}_x.sql`)
check('a new file above the baseline is fine', readMigrationNames([...old, '141_a.sql']).errors.length === 0)
check('a new file at or below the baseline is refused', readMigrationNames([...old, '140_late.sql']).errors.length === 1)
check('two new files with one number are refused', readMigrationNames([...old, '141_a.sql', '141_b.sql']).errors.length === 1)
check('a duplicate at or below the baseline (094) is allowed',
  readMigrationNames([...old.slice(0, -1), '094_x2.sql']).errors.length === 0)
check('a bad name is refused', readMigrationNames([...old, '141-Shop.sql']).errors.length === 1)
check('other files are ignored', readMigrationNames([...old, 'README.md']).errors.length === 0)
const sorted = readMigrationNames([...old, '1000_z.sql', '141_a.sql', '999_y.sql']).files.slice(-3).map(f => f.file)
check('sorted by number, not by text', sorted.join() === '141_a.sql,999_y.sql,1000_z.sql', sorted.join())

console.log('2. plan')
const files = [{ file: '139_a.sql', number: 139 }, { file: '141_b.sql', number: 141 }, { file: '142_c.sql', number: 142 }, { file: '143_d.sql', number: 143 }]
const sha = f => ({ '141_b.sql': 'b1', '142_c.sql': 'c2', '143_d.sql': 'd1', '139_a.sql': 'a' })[f]
const p = planMigrations(files, sha, new Map([['141_b.sql', 'b1'], ['142_c.sql', 'c1']]))
check('baseline files never run', !p.apply.some(f => f.number <= BASELINE))
check('a recorded file is skipped', p.done.join() === '141_b.sql')
check('a file changed after it ran is reported, not run', p.changed.join() === '142_c.sql')
check('a new file runs', p.apply.map(f => f.file).join() === '143_d.sql')
check('the baseline is 140', BASELINE === 140)

console.log('3. query text')
const shaHex = 'a'.repeat(64)
const q = migrationQuery('141_b.sql', shaHex, 'abc1234')('create table t (x int) -- no semicolon')
check('the ledger row follows the file in the same query', /no semicolon\n;\ninsert into deploy\.applied_migrations/.test(q))
check('a trailing comment cannot swallow the ledger row', q.split('\n')[1] === ';')
check('a bad file name is refused', (() => { try { migrationQuery("141_x'.sql", shaHex)(''); return false } catch { return true } })())
check('a bad commit becomes null', /, null\);/.test(migrationQuery('141_b.sql', shaHex, 'x;drop')('')))
check('lineOf counts lines', lineOf('a\nb\nc', 5) === 3 && lineOf('a', undefined) === null)

console.log('4. database address')
check('direct address refused', !!checkDbUrl('postgresql://postgres:pw@db.abc.supabase.co:5432/postgres').error)
check('transaction pooler refused', !!checkDbUrl('postgresql://postgres.abc:pw@aws-0-eu-north-1.pooler.supabase.com:6543/postgres').error)
check('placeholder password refused', !!checkDbUrl('postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-eu-north-1.pooler.supabase.com:5432/postgres').error)
const ok = checkDbUrl('postgresql://postgres.abc:p%40ss%3Aw@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require')
check('session pooler accepted, password decoded, sslmode ignored',
  ok.config?.password === 'p@ss:w' && ok.config.user === 'postgres.abc' && ok.config.port === 5432 && !('ssl' in ok.config))
check('not a URL refused', !!checkDbUrl('hello').error)

console.log('5. edge function JWT settings (supabase/config.toml)')
const toml = readFileSync(join(root, 'supabase/config.toml'), 'utf8')
const jwtOff = new Set([...toml.matchAll(/\[functions\.([a-z0-9-]+)\]\s*\nverify_jwt\s*=\s*false/g)].map(m => m[1]))
const fnDirs = new Set(readdirSync(join(root, 'supabase/functions')).filter(d => existsSync(join(root, 'supabase/functions', d, 'index.ts'))))
const unknown = [...jwtOff].filter(f => !fnDirs.has(f))
check('every function in config.toml exists', unknown.length === 0, unknown.join(', '))
// A browser call that is not supabase.functions.invoke and sends no
// Authorization header is refused by Supabase while JWT verification is on.
const raw = []
const walk = d => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e.name)) {
      const src = readFileSync(p, 'utf8')
      if (/Authorization/.test(src)) continue
      for (const m of src.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) raw.push([m[1], p.slice(root.length + 1)])
    }
  }
}
walk(join(root, 'src'))
const missing = raw.filter(([fn]) => fnDirs.has(fn) && !jwtOff.has(fn))
check('functions the browser calls without a JWT have verify_jwt = false', missing.length === 0,
  missing.map(([fn, p]) => `${fn} (${p})`).join(', '))
check('news-proxy is one of them', raw.some(([fn]) => fn === 'news-proxy') && jwtOff.has('news-proxy'))

const testUrl = process.env.DEPLOY_TEST_DB_URL
if (testUrl) {
  console.log('6. against a throwaway database')
  const work = mkdtempSync(join(tmpdir(), 'mig-'))
  const runner = join(root, 'scripts/deploy/run-migrations.mjs')
  for (let i = 1; i <= BASELINE_FILE_COUNT; i++) {
    writeFileSync(join(work, `${String(i).padStart(3, '0')}_old.sql`), 'select 1/0; -- must never run')
  }
  const run = (extra = {}) => {
    try {
      const out = execFileSync('node', [runner], {
        env: { ...process.env, MIGRATIONS_DIR: work, SUPABASE_DB_URL: testUrl, DEPLOY_DB_SSL: 'off', GITHUB_SHA: 'abcdef1', ...extra },
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { ok: true, out }
    } catch (e) { return { ok: false, out: `${e.stdout}${e.stderr}` } }
  }
  const psql = (sql) => execFileSync('psql', [testUrl, '-X', '-At', '-c', sql], { encoding: 'utf8' }).trim()
  psql('drop schema if exists deploy cascade; drop table if exists public.t141, public.t142, public.t143, public.t144')

  let r = run({ DRY_RUN: 'true' })
  check('dry run with nothing new: ok, no ledger made', r.ok && psql("select to_regclass('deploy.applied_migrations') is null") === 't', r.out)
  r = run()
  check('first run: baseline files skipped, ledger made', r.ok && psql('select count(*) from deploy.applied_migrations') === '0', r.out)

  writeFileSync(join(work, '141_a.sql'), 'create table public.t141 (x int);\ninsert into public.t141 values (1)')
  writeFileSync(join(work, '142_b.sql'), "begin;\ncreate table public.t142 (x int);\ncommit;")
  r = run({ DRY_RUN: 'true' })
  check('dry run lists both, changes nothing', r.ok && /141_a\.sql[\s\S]*142_b\.sql/.test(r.out) && psql("select to_regclass('public.t141') is null") === 't', r.out)
  r = run()
  check('both run, in order, and are recorded with the commit',
    r.ok && psql('select string_agg(file || ' + "':'" + ' || commit_sha, \',\' order by file) from deploy.applied_migrations') === '141_a.sql:abcdef1,142_b.sql:abcdef1', r.out)
  check('a file with its own BEGIN/COMMIT works', psql("select to_regclass('public.t142') is not null") === 't')
  r = run()
  check('second run: nothing runs again', r.ok && /0 to run/.test(r.out) && psql('select count(*) from public.t141') === '1', r.out)

  writeFileSync(join(work, '143_c.sql'), 'create table public.t143 (x int);\ninsert into public.t143 values (1);\nselect nonsense_column from public.t143;')
  writeFileSync(join(work, '144_d.sql'), 'create table public.t144 (x int);')
  r = run()
  check('a failing file: the run fails and names the line', !r.ok && /143_c\.sql failed \(line 3\)/.test(r.out), r.out)
  check('nothing from the failing file is kept', psql("select to_regclass('public.t143') is null") === 't')
  check('nothing after it runs', psql("select to_regclass('public.t144') is null") === 't')
  check('it is not recorded', psql("select count(*) from deploy.applied_migrations where file = '143_c.sql'") === '0')

  writeFileSync(join(work, '143_c.sql'), 'create table public.t143 (x int);')
  r = run()
  check('fixed and run again: 143 and 144 run', r.ok && psql('select count(*) from deploy.applied_migrations') === '4', r.out)

  writeFileSync(join(work, '141_a.sql'), 'create table public.t141 (x int); -- edited later')
  r = run()
  check('a file edited after it ran: warning, not run again', r.ok && /141_a\.sql changed after it ran/.test(r.out), r.out)

  writeFileSync(join(work, '145_e.sql'), "begin;\ncreate table public.t145 (x int);\nselect 1/0;\ncommit;")
  r = run()
  check('a failing file with its own BEGIN: nothing kept', !r.ok && psql("select to_regclass('public.t145') is null") === 't', r.out)
  rmSync(join(work, '145_e.sql'))

  check('the browser roles cannot see the ledger schema', psql("select count(*) from pg_namespace n where nspname = 'deploy' and has_schema_privilege('public', n.oid, 'usage')") === '0')
  psql('drop schema if exists deploy cascade; drop table if exists public.t141, public.t142, public.t143, public.t144')
  rmSync(work, { recursive: true, force: true })
} else {
  console.log('6. (skipped — set DEPLOY_TEST_DB_URL to a throwaway database to run the runner itself)')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
