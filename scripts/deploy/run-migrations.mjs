#!/usr/bin/env node
// Applies the database migrations a merge brings (deploy.yml, job "backend").
//
//   node scripts/deploy/run-migrations.mjs --check   names and contents only, no database (PR check)
//   node scripts/deploy/run-migrations.mjs           apply what has not run yet
//   DRY_RUN=true node scripts/deploy/run-migrations.mjs   list it, change nothing
//
// Env: SUPABASE_DB_URL (the Session pooler address), SUPABASE_PROJECT_REF,
//      GITHUB_SHA (optional); DEPLOY_DB_SSL=off and MIGRATIONS_DIR only for
//      local tests.
//
// Each file runs as ONE query on its own connection, together with its row in
// deploy.applied_migrations, so a file that fails changes nothing and is tried
// again on the next deploy. Rules: scripts/deploy/migrationPlan.mjs.
//
// The repository is public, so its Actions logs are too: this prints file
// names, SQLSTATE codes and line numbers, and an error's message only when its
// class cannot quote row data (publicError). The full error goes to
// deploy.migration_errors, which only the SQL editor can read; NOTICE texts are
// never printed.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { rootCertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  BASELINE, checkDbUrl, lineOf, migrationQuery, planMigrations, publicError, readMigrationNames, transactionControl,
} from './migrationPlan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dir = process.env.MIGRATIONS_DIR || join(here, '..', '..', 'supabase', 'migrations')
const checkOnly = process.argv.includes('--check')
const dryRun = process.env.DRY_RUN === 'true'
const LOCK_RETRIES = 3
// Test-only knobs, honoured only with MIGRATIONS_DIR (a throwaway folder).
const testing = !!process.env.MIGRATIONS_DIR
const local = testing && process.env.DEPLOY_DB_SSL === 'off'
const lockWaitMs = testing && process.env.DEPLOY_LOCK_WAIT_MS ? Number(process.env.DEPLOY_LOCK_WAIT_MS) : 20000

function fail(message) {
  console.log(`::error::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`)
  process.exit(1)
}
function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
}

const { files, errors } = readMigrationNames(readdirSync(dir), BASELINE, testing ? null : undefined)
if (errors.length) fail(errors.join('\n'))
const text = new Map(files.map(f => [f.file, readFileSync(join(dir, f.file), 'utf8')]))
const automatic = files.filter(f => f.number > BASELINE)

const txErrors = []
for (const f of automatic) {
  for (const s of transactionControl(text.get(f.file))) {
    txErrors.push(`${f.file} line ${s.line}: "${s.head.toUpperCase()}" — a migration runs as one transaction on merge; ` +
      'write it without BEGIN/COMMIT/ROLLBACK (for repeatable read, put "set transaction isolation level repeatable read;" on its first line)')
  }
}
if (txErrors.length) fail(txErrors.join('\n'))

if (checkOnly) {
  console.log(`Migration files OK. Above ${BASELINE} (each runs once, on the merge that brings it): ${automatic.map(f => f.file).join(', ') || 'none'}`)
  process.exit(0)
}

const shaOf = (file) => createHash('sha256').update(text.get(file)).digest('hex')
const url = checkDbUrl(process.env.SUPABASE_DB_URL ?? '', { local, projectRef: process.env.SUPABASE_PROJECT_REF ?? '' })
if (url.error) fail(url.error)
// Supabase's own root (the pooler's documented chain) plus the usual public roots.
const ssl = local ? false : { ca: [readFileSync(join(here, 'supabase-root-2021.crt'), 'utf8'), ...rootCertificates], rejectUnauthorized: true }

let notices = 0
async function connect() {
  const client = new pg.Client({ ...url.config, ssl, application_name: 'github-deploy', connectionTimeoutMillis: 20000 })
  client.on('notice', () => { notices++ })
  // A dropped connection is reported by the running query; without this
  // listener pg would crash the process before the ledger check below.
  client.on('error', () => {})
  try {
    await client.connect()
  } catch (e) {
    fail(`Could not connect to the database: ${e.message}. Check SUPABASE_DB_URL (the Session pooler address and the database password); ` +
      'a certificate error (self-signed, altnames) means Claude has to look at scripts/deploy/supabase-root-2021.crt.')
  }
  return client
}

async function readLedger(client) {
  const exists = await client.query("select to_regclass('deploy.applied_migrations') is not null as ok")
  if (!exists.rows[0].ok) return null
  const { rows } = await client.query('select file, sha256 from deploy.applied_migrations')
  return new Map(rows.map(r => [r.file, r.sha256]))
}

async function isRecorded(file) {
  const c = await connect()
  try {
    const { rows } = await c.query('select 1 from deploy.applied_migrations where file = $1', [file])
    return rows.length === 1
  } finally {
    await c.end().catch(() => {})
  }
}

const first = await connect()
// 139 and 140 were run by hand; everything automatic is written against them.
if (!testing) {
  const { rows } = await first.query(
    "select to_regprocedure('public.owner_lock_apply(regclass)') is not null and to_regclass('public.ai_pending_actions') is not null as ok")
  if (!rows[0].ok) {
    fail('Migrations 139 and 140 have not run on this database (they are run by hand in the SQL editor, CLAUDE.md → Pending manual steps). Nothing was changed.')
  }
}
let ledger = await readLedger(first)
if (!dryRun) {
  // Not in public: the Data API never exposes it and the browser roles get nothing.
  await first.query(`
    create schema if not exists deploy;
    revoke all on schema deploy from public;
    create table if not exists deploy.applied_migrations (
      file       text primary key,
      sha256     text not null,
      commit_sha text,
      applied_at timestamptz not null default now()
    );
    revoke all on table deploy.applied_migrations from public;
    create table if not exists deploy.migration_errors (
      id         bigint generated always as identity primary key,
      file       text not null,
      code       text,
      message    text,
      detail     text,
      hint       text,
      line       int,
      at         timestamptz not null default now()
    );
    revoke all on table deploy.migration_errors from public;
  `)
  ledger ??= new Map()
}
await first.end()

async function keepError(file, e, line) {
  const c = await connect()
  try {
    await c.query('insert into deploy.migration_errors (file, code, message, detail, hint, line) values ($1, $2, $3, $4, $5, $6)',
      [file, e.code ?? null, e.message ?? null, e.detail ?? null, e.hint ?? null, line])
    return true
  } catch { return false } finally { await c.end().catch(() => {}) }
}

const plan = planMigrations(files, shaOf, ledger ?? new Map())
const notes = [
  ...plan.changed.map(f => `${f} changed after it ran; it is not run again. Put the change in a new migration.`),
  ...plan.renamed.map(r => `${r.file} ran before as ${r.ranAs}; it is not run again.`),
]
for (const n of notes) console.log(`::warning::${n}`)
if (notes.length) summary(['**Database — not run again:**', ...notes.map(n => `- ${n}`)])
console.log(`Migrations above ${BASELINE}: ${plan.done.length + plan.renamed.length} already run, ${plan.apply.length} to run.`)
if (!plan.apply.length) {
  summary([`**Database:** nothing new to run (${plan.done.length + plan.renamed.length} automatic migrations already applied).`])
  process.exit(0)
}
if (dryRun) {
  console.log(`Dry run — these would run, in this order:\n${plan.apply.map(f => `  ${f.file}`).join('\n')}`)
  summary(['**Database (dry run):** would run', ...plan.apply.map(f => `- ${f.file}`)])
  process.exit(0)
}

const ran = []
for (const f of plan.apply) {
  const sql = text.get(f.file)
  const q = migrationQuery(f.file, f.sha, process.env.DEPLOY_SHA || process.env.GITHUB_SHA)
  const query = q.build(sql)
  for (let attempt = 1; ; attempt++) {
    console.log(`Running ${f.file}${attempt > 1 ? ` (attempt ${attempt})` : ''} …`)
    const c = await connect()
    let error = null
    try {
      await c.query(query)
    } catch (e) {
      error = e
      await c.query('rollback').catch(() => {})
    } finally {
      await c.end().catch(() => {})
    }

    // A dropped connection can hide a commit, and a commit must show its row.
    const recorded = await isRecorded(f.file)
    if (!error && recorded) { ran.push(f.file); console.log('  done'); break }
    if (error && recorded) { ran.push(f.file); console.log(`::warning::${f.file}: the connection broke after it finished; it ran and is recorded.`); break }
    if (!error) fail(`${f.file} reported success but is not recorded in deploy.applied_migrations. Stopped; nothing after it ran.`)

    if (error.code === '55P03' && attempt < LOCK_RETRIES) {
      console.log(`  a table it changes was busy (lock timeout); trying again in ${Math.round(lockWaitMs / 1000)} s`)
      await sleep(lockWaitMs)
      continue
    }
    const line = lineOf(query, error.position)
    const fileLine = line ? line - q.prefixLines : null
    const inFile = fileLine && fileLine >= 1 && fileLine <= sql.split('\n').length ? fileLine : null
    const kept = await keepError(f.file, error, inFile)
    summary([`**Database:** ${ran.length ? `ran ${ran.join(', ')}; ` : ''}**${f.file} failed** — nothing from it was kept.`])
    fail([
      `${f.file} failed${inFile ? ` (line ${inFile})` : ''}: ${publicError(error)}`,
      kept ? 'The full error is in the database: SQL editor → select * from deploy.migration_errors order by at desc limit 1;' : null,
      error.code === '55P03' ? 'The app kept a table it changes busy three times; run the deploy again later.' : null,
      'Nothing from this file was kept, and the edge functions and the website were not deployed. Fix the file (it has not run) and merge again.',
    ].filter(Boolean).join('\n'))
  }
}
summary([`**Database:** ran ${ran.join(', ')}.`])
console.log(`Ran ${ran.length} migration(s).${notices ? ` (${notices} database notices, not shown in this public log.)` : ''}`)
