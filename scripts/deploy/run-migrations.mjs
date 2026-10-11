#!/usr/bin/env node
// Applies the database migrations a merge brings (deploy.yml, job "backend").
//
//   node scripts/deploy/run-migrations.mjs --check   names only, no database (PR check)
//   node scripts/deploy/run-migrations.mjs           apply what has not run yet
//   DRY_RUN=true node scripts/deploy/run-migrations.mjs   list it, change nothing
//
// Env: SUPABASE_DB_URL (the Session pooler address), GITHUB_SHA (optional),
//      DEPLOY_DB_SSL=off and MIGRATIONS_DIR only for local tests.
//
// Each file runs as ONE query on its own connection, together with its row in
// deploy.applied_migrations, so a file that fails changes nothing and is tried
// again on the next deploy. Rules: scripts/deploy/migrationPlan.mjs.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { BASELINE, checkDbUrl, lineOf, migrationQuery, planMigrations, readMigrationNames } from './migrationPlan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dir = process.env.MIGRATIONS_DIR || join(here, '..', '..', 'supabase', 'migrations')
const checkOnly = process.argv.includes('--check')
const dryRun = process.env.DRY_RUN === 'true'
const local = process.env.DEPLOY_DB_SSL === 'off'

function fail(message) {
  console.log(`::error::${message}`)
  process.exit(1)
}
function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
}

const { files, errors } = readMigrationNames(readdirSync(dir))
if (errors.length) fail(errors.join('\n'))
if (checkOnly) {
  const pending = files.filter(f => f.number > BASELINE).map(f => f.file)
  console.log(`Migration names OK. Above ${BASELINE} (run on merge if not run yet): ${pending.join(', ') || 'none'}`)
  process.exit(0)
}

const text = new Map(files.map(f => [f.file, readFileSync(join(dir, f.file), 'utf8')]))
const shaOf = (file) => createHash('sha256').update(text.get(file)).digest('hex')

const url = checkDbUrl(process.env.SUPABASE_DB_URL ?? '', local)
if (url.error) fail(url.error)
const ssl = local ? false : { ca: readFileSync(join(here, 'supabase-root-2021.crt'), 'utf8'), rejectUnauthorized: true }

async function connect() {
  const client = new pg.Client({ ...url.config, ssl, application_name: 'github-deploy', connectionTimeoutMillis: 20000 })
  client.on('notice', n => console.log(`  NOTICE: ${n.message}`))
  try {
    await client.connect()
  } catch (e) {
    fail(`Could not connect to the database: ${e.message}. Check SUPABASE_DB_URL (Session pooler address, database password).`)
  }
  // Wait at most a minute for a lock the app holds; never run longer than 15 minutes.
  await client.query("set lock_timeout = '60s'; set statement_timeout = '15min'")
  return client
}

async function readLedger(client) {
  const exists = await client.query("select to_regclass('deploy.applied_migrations') is not null as ok")
  if (!exists.rows[0].ok) return null
  const { rows } = await client.query('select file, sha256 from deploy.applied_migrations')
  return new Map(rows.map(r => [r.file, r.sha256]))
}

const client = await connect()
let ledger = await readLedger(client)
if (!ledger && !dryRun) {
  // Not in public: the Data API never exposes it and the browser roles get nothing.
  await client.query(`
    create schema if not exists deploy;
    revoke all on schema deploy from public;
    create table if not exists deploy.applied_migrations (
      file       text primary key,
      sha256     text not null,
      commit_sha text,
      applied_at timestamptz not null default now()
    );
    revoke all on table deploy.applied_migrations from public;
  `)
  ledger = new Map()
}
await client.end()

const plan = planMigrations(files, shaOf, ledger ?? new Map())
for (const f of plan.changed) {
  console.log(`::warning::${f} changed after it ran; it is not run again. Put the change in a new migration.`)
}
console.log(`Migrations above ${BASELINE}: ${plan.done.length} already run, ${plan.apply.length} to run.`)
if (!plan.apply.length) {
  summary([`**Database:** nothing new to run (${plan.done.length} automatic migrations already applied).`])
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
  const query = migrationQuery(f.file, f.sha, process.env.GITHUB_SHA)(sql)
  console.log(`Running ${f.file} …`)
  const c = await connect()
  try {
    await c.query(query)
    ran.push(f.file)
    console.log(`  done`)
  } catch (e) {
    await c.query('rollback').catch(() => {})
    const line = lineOf(query, e.position)
    const where = line && line <= sql.split('\n').length ? ` (line ${line})` : ''
    summary([`**Database:** ${ran.length ? `ran ${ran.join(', ')}; ` : ''}**${f.file} failed** — nothing from it was kept.`])
    fail([
      `${f.file} failed${where}: ${e.message}`,
      e.detail && `detail: ${e.detail}`,
      e.hint && `hint: ${e.hint}`,
      'Nothing from this file was kept, and the edge functions and the website were not deployed. Fix the file (it has not run) and merge again.',
    ].filter(Boolean).join('\n'))
  } finally {
    await c.end().catch(() => {})
  }
}
summary([`**Database:** ran ${ran.join(', ')}.`])
console.log(`Ran ${ran.length} migration(s).`)
