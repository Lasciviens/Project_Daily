#!/usr/bin/env node
// Verification — the automatic deploy (scripts/deploy/, supabase/config.toml).
//
//   node scripts/verify-deploy-migrations.mjs
//       rules, the real supabase/migrations files, the JWT list
//   DEPLOY_TEST_DB_URL=postgresql://postgres:x@127.0.0.1:54329/postgres node scripts/verify-deploy-migrations.mjs
//       also runs run-migrations.mjs against that (throwaway!) database
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASELINE, BASELINE_NAMES_SHA256, checkDbUrl, lineOf, migrationQuery, planMigrations, readMigrationNames,
  topLevelStatements, transactionControl,
} from './deploy/migrationPlan.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const sha = (s) => createHash('sha256').update(s).digest('hex')

console.log('1. names')
const realNames = readdirSync(join(root, 'supabase/migrations'))
const real = readMigrationNames(realNames)
check('the repo\'s migration names pass (incl. the frozen 001–140 list)', real.errors.length === 0, real.errors.join('; '))
check('the frozen list holds 140 files', realNames.filter(n => /^\d+_/.test(n) && Number(n.split('_')[0]) <= BASELINE).length === 140)
const old = Array.from({ length: 5 }, (_, i) => `${String(i + 1).padStart(3, '0')}_x.sql`)
const oldSha = sha([...old].sort().join('\n'))
const names = (extra) => readMigrationNames([...old, ...extra], BASELINE, oldSha).errors
check('a new file above the baseline is fine', names(['141_a.sql']).length === 0)
check('a new file at or below the baseline is refused', names(['140_late.sql']).length === 1)
check('a renamed or deleted old file is refused',
  readMigrationNames([...old.slice(1), '001_y.sql'], BASELINE, oldSha).errors.length === 1 &&
  readMigrationNames(old.slice(1), BASELINE, oldSha).errors.length === 1)
check('two new files with one number are refused', names(['141_a.sql', '141_b.sql']).length === 1)
check('a bad name is refused', names(['141-Shop.sql']).length === 1)
check('other files are ignored', names(['README.md']).length === 0)
const sorted = readMigrationNames([...old, '1000_z.sql', '141_a.sql', '999_y.sql'], BASELINE, oldSha).files.slice(-3).map(f => f.file)
check('sorted by number, not by text', sorted.join() === '141_a.sql,999_y.sql,1000_z.sql', sorted.join())
check('the baseline is 140', BASELINE === 140 && /^[0-9a-f]{64}$/.test(BASELINE_NAMES_SHA256))

console.log('2. plan')
const files = [139, 141, 142, 143, 144].map(n => ({ file: `${n}_${'abcde'[n - 140] ?? 'z'}.sql`, number: n }))
const shaOf = f => ({ '141_b.sql': 'b1', '142_c.sql': 'c2', '143_d.sql': 'd1', '144_e.sql': 'e1' })[f] ?? 'x'
const p = planMigrations(files, shaOf, new Map([['141_b.sql', 'b1'], ['142_c.sql', 'c1'], ['144_old_name.sql', 'e0']]))
check('baseline files never run', !p.apply.some(f => f.number <= BASELINE))
check('a recorded file is skipped', p.done.join() === '141_b.sql')
check('a file changed after it ran is reported, not run', p.changed.join() === '142_c.sql')
check('a file renamed after it ran is reported, not run', p.renamed.length === 1 && p.renamed[0].ranAs === '144_old_name.sql')
check('a new file runs', p.apply.map(f => f.file).join() === '143_d.sql')

console.log('3. transaction control')
const tx = (s) => transactionControl(s).map(x => `${x.head.split(' ')[0]}@${x.line}`).join(',')
check('top-level BEGIN/COMMIT found with lines', tx('begin;\ncreate table t(x int);\ncommit;') === 'begin@1,commit@3', tx('begin;\ncreate table t(x int);\ncommit;'))
check('ROLLBACK, END, SAVEPOINT, START TRANSACTION found',
  tx('select 1;\nrollback;\nend;\nsavepoint a;\nstart transaction;') === 'rollback@2,end@3,savepoint@4,start@5')
check('BEGIN … END inside a function body is not top level',
  tx('create function f() returns void language plpgsql as $$\nbegin\n  perform 1;\nend;\n$$;\ndo $x$ begin null; end $x$;') === '')
check('words in comments and strings are ignored',
  tx("-- begin;\n/* commit; /* nested */ rollback; */\nselect 'commit;';\nselect E'it\\'s; commit';\nselect \"begin\" from t;") === '')
check('a SQL-standard function body (BEGIN ATOMIC … END) is not top level',
  tx('create function g() returns int language sql\nbegin atomic\n  select 1;\nend;\nselect 2;') === '')
check('SET TRANSACTION ISOLATION is allowed', tx('set transaction isolation level repeatable read;\nselect 1;') === '')
check('statement lines survive multi-line strings and comments',
  topLevelStatements("select 'a\nb';\n/* x\ny */\ncommit;").map(s => s.line).join() === '1,5')
check('the 140 hand-run files: only 139 and 140 use BEGIN/COMMIT', realNames.filter(n => n.endsWith('.sql'))
  .filter(n => transactionControl(readFileSync(join(root, 'supabase/migrations', n), 'utf8')).length).sort().join() ===
  '139_owner_lock.sql,140_security_fixes.sql')

console.log('4. query text')
const shaHex = 'a'.repeat(64)
const mq = migrationQuery('141_b.sql', shaHex, 'abc1234')
const q = mq.build('create table t (x int) -- no semicolon')
check('timeouts are set for this transaction only', q.startsWith("set local lock_timeout = '5s'; set local statement_timeout = '10min';\n") && mq.prefixLines === 1)
check('the ledger row follows the file in the same query', /no semicolon\n;\ninsert into deploy\.applied_migrations/.test(q))
check('a bad file name is refused', (() => { try { migrationQuery("141_x'.sql", shaHex); return false } catch { return true } })())
check('a bad commit becomes null', /, null\);/.test(migrationQuery('141_b.sql', shaHex, 'x;drop').build('')))
check('lineOf counts lines', lineOf('a\nb\nc', 5) === 3 && lineOf('a', undefined) === null)

console.log('5. database address')
const ref = 'hsaedwwqpcjizeozjbch'
const pooler = (user, pw = 'pw', port = 5432) => `postgresql://${user}:${pw}@aws-0-eu-north-1.pooler.supabase.com:${port}/postgres`
check('direct address refused', !!checkDbUrl(`postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`, { projectRef: ref }).error)
check('transaction pooler refused', !!checkDbUrl(pooler(`postgres.${ref}`, 'pw', 6543), { projectRef: ref }).error)
check('placeholder password refused', !!checkDbUrl(pooler(`postgres.${ref}`, '[YOUR-PASSWORD]'), { projectRef: ref }).error)
check('another project refused', /not this app's database/.test(checkDbUrl(pooler('postgres.bniqmxbtvgwkaoswugds'), { projectRef: ref }).error ?? ''))
check('a bare % in the password explained', /%25/.test(checkDbUrl(pooler(`postgres.${ref}`, 'a%zz'), { projectRef: ref }).error ?? ''))
const ok = checkDbUrl(pooler(`postgres.${ref}`, 'p%40ss%3Aw') + '?sslmode=require', { projectRef: ref })
check('session pooler accepted, password decoded, sslmode ignored',
  ok.config?.password === 'p@ss:w' && ok.config.user === `postgres.${ref}` && ok.config.port === 5432 && !('ssl' in ok.config))
check('not a URL refused', !!checkDbUrl('hello').error)

console.log('6. edge function JWT settings (supabase/config.toml)')
const toml = readFileSync(join(root, 'supabase/config.toml'), 'utf8')
const jwtOff = new Set([...toml.matchAll(/\[functions\.([a-z0-9-]+)\]\s*\nverify_jwt\s*=\s*false/g)].map(m => m[1]))
const fnDirs = new Set(readdirSync(join(root, 'supabase/functions')).filter(d => existsSync(join(root, 'supabase/functions', d, 'index.ts'))))
const unknown = [...jwtOff].filter(f => !fnDirs.has(f))
check('every function in config.toml exists', unknown.length === 0, unknown.join(', '))
const refs = (dirs, keep) => {
  const out = []
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
      else if (keep(e.name)) {
        const src = readFileSync(p, 'utf8')
        for (const m of src.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) out.push({ fn: m[1], file: p.slice(root.length + 1), src })
      }
    }
  }
  for (const d of dirs) walk(join(root, d))
  return out.filter(r => fnDirs.has(r.fn))
}
// The browser: a call that is not supabase.functions.invoke and sends no
// Authorization header is refused by Supabase while JWT verification is on.
const browser = refs(['src'], n => /\.tsx?$/.test(n)).filter(r => !/Authorization/.test(r.src))
const missBrowser = browser.filter(r => !jwtOff.has(r.fn))
check('functions the browser calls without a JWT have verify_jwt = false', missBrowser.length === 0,
  missBrowser.map(r => `${r.fn} (${r.file})`).join(', '))
// Cron jobs (migrations), devices (scripts) and setup guides (docs) never hold a Supabase JWT.
const outside = refs(['supabase/migrations', 'scripts', 'docs'], n => /\.(sql|mjs|cjs|js|py|lua|md|json|sh)$/.test(n))
  .filter(r => !/^scripts\/verify-deploy-migrations\.mjs$/.test(r.file))
const missOutside = outside.filter(r => !jwtOff.has(r.fn))
check('functions cron jobs, devices and guides call have verify_jwt = false', missOutside.length === 0,
  [...new Set(missOutside.map(r => `${r.fn} (${r.file})`))].join(', '))
check('news-proxy is listed (its fetch and <img> send no JWT)', browser.some(r => r.fn === 'news-proxy') && jwtOff.has('news-proxy'))

const testUrl = process.env.DEPLOY_TEST_DB_URL
if (testUrl) {
  console.log('7. against a throwaway database')
  const work = mkdtempSync(join(tmpdir(), 'mig-'))
  const runner = join(root, 'scripts/deploy/run-migrations.mjs')
  for (let i = 1; i <= 5; i++) writeFileSync(join(work, `${String(i).padStart(3, '0')}_old.sql`), 'select 1/0; -- must never run')
  const env = (extra) => ({ ...process.env, MIGRATIONS_DIR: work, SUPABASE_DB_URL: testUrl, DEPLOY_DB_SSL: 'off', GITHUB_SHA: 'abcdef1', ...extra })
  const run = (extra = {}) => {
    try {
      return { ok: true, out: execFileSync('node', [runner], { env: env(extra), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    } catch (e) { return { ok: false, out: `${e.stdout}${e.stderr}` } }
  }
  const psql = (sql) => execFileSync('psql', [testUrl, '-X', '-At', '-q', '-c', sql], { encoding: 'utf8' }).trim()
  const reset = () => psql('drop schema if exists deploy cascade; drop table if exists public.t141, public.t142, public.t143, public.t144, public.t145, public.t146, public.t147 cascade')
  reset()

  let r = run({ DRY_RUN: 'true' })
  check('dry run with nothing new: ok, no ledger made', r.ok && psql("select to_regclass('deploy.applied_migrations') is null") === 't', r.out)
  r = run()
  check('first run: baseline files skipped, ledger made', r.ok && psql('select count(*) from deploy.applied_migrations') === '0', r.out)

  writeFileSync(join(work, '141_a.sql'), "create table public.t141 (x int primary key);\ninsert into public.t141 values (1);\ndo $$ begin raise notice 'secret row %', 42; end $$;")
  writeFileSync(join(work, '142_b.sql'), 'set transaction isolation level repeatable read;\ncreate table public.t142 (x int);')
  r = run({ DRY_RUN: 'true' })
  check('dry run lists both, changes nothing', r.ok && /141_a\.sql[\s\S]*142_b\.sql/.test(r.out) && psql("select to_regclass('public.t141') is null") === 't', r.out)
  r = run()
  check('both run, in order, recorded with the commit',
    r.ok && psql("select string_agg(file || ':' || commit_sha, ',' order by file) from deploy.applied_migrations") === '141_a.sql:abcdef1,142_b.sql:abcdef1', r.out)
  check('repeatable read via SET TRANSACTION works', psql("select to_regclass('public.t142') is not null") === 't')
  check('database notices are counted, never printed', !/secret row/.test(r.out) && /database notices, not shown/.test(r.out), r.out)
  r = run()
  check('second run: nothing runs again', r.ok && /0 to run/.test(r.out) && psql('select count(*) from public.t141') === '1', r.out)

  writeFileSync(join(work, '143_c.sql'), 'create table public.t143 (x int);\ninsert into public.t143 values (1);\nselect nonsense_column from public.t143;')
  writeFileSync(join(work, '144_d.sql'), 'create table public.t144 (x int);')
  r = run()
  check('a failing file: the run fails and names the file line', !r.ok && /143_c\.sql failed \(line 3\): \[42703\]/.test(r.out), r.out)
  check('nothing from the failing file is kept, nothing after it runs, nothing recorded',
    psql("select (to_regclass('public.t143') is null) and (to_regclass('public.t144') is null) and not exists (select 1 from deploy.applied_migrations where file = '143_c.sql')") === 't')

  writeFileSync(join(work, '143_c.sql'), 'insert into public.t141 values (1);')
  r = run()
  check('a duplicate key: no row values in the log (no "detail")', !r.ok && /\[23505\]/.test(r.out) && !/Key \(x\)=\(1\)/.test(r.out), r.out)

  writeFileSync(join(work, '143_c.sql'), 'create table public.t143 (x int);')
  r = run()
  check('fixed and run again: 143 and 144 run', r.ok && psql('select count(*) from deploy.applied_migrations') === '4', r.out)

  writeFileSync(join(work, '141_a.sql'), 'create table public.t141 (x int); -- edited later')
  r = run()
  check('a file edited after it ran: warning, not run again', r.ok && /141_a\.sql changed after it ran/.test(r.out), r.out)

  rmSync(join(work, '144_d.sql'))
  writeFileSync(join(work, '144_d_renamed.sql'), 'create table public.t144 (x int);')
  r = run()
  check('a file renamed after it ran: warning, not run again', r.ok && /144_d_renamed\.sql ran before as 144_d\.sql/.test(r.out), r.out)

  writeFileSync(join(work, '145_e.sql'), 'begin;\ncreate table public.t145 (x int);\ncommit;\nselect 1/0;')
  r = run()
  check('a file with its own BEGIN/COMMIT is refused before anything runs',
    !r.ok && /145_e\.sql line 1: "BEGIN"/.test(r.out) && psql("select to_regclass('public.t145') is null") === 't', r.out)
  rmSync(join(work, '145_e.sql'))

  // Lock retry: another session holds the table for 7 s; the first attempt
  // times out after 5 s, the second one gets the lock.
  writeFileSync(join(work, '145_e.sql'), 'alter table public.t141 add column y int;')
  const holder = spawn('psql', [testUrl, '-X', '-q', '-c', 'begin; lock table public.t141 in access exclusive mode; select pg_sleep(7); commit;'], { stdio: 'ignore' })
  const holderDone = new Promise(res => holder.on('close', res))
  await new Promise(res => setTimeout(res, 800))
  const started = Date.now()
  r = await new Promise(res => {
    const c = spawn('node', [runner], { env: env({ DEPLOY_LOCK_WAIT_MS: '500' }) })
    let out = ''
    c.stdout.on('data', d => { out += d }); c.stderr.on('data', d => { out += d })
    c.on('close', code => res({ ok: code === 0, out }))
  })
  await holderDone
  check('a busy table: waits, retries, then runs', r.ok && /lock timeout/.test(r.out) && /attempt 2/.test(r.out) &&
    psql("select count(*) from information_schema.columns where table_name = 't141' and column_name = 'y'") === '1' && Date.now() - started < 30000, r.out)

  check('the browser roles cannot use the ledger schema', psql("select count(*) from pg_namespace n where nspname = 'deploy' and has_schema_privilege('public', n.oid, 'usage')") === '0')
  reset()
  rmSync(work, { recursive: true, force: true })
} else {
  console.log('7. (skipped — set DEPLOY_TEST_DB_URL to a throwaway database to run the runner itself)')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
