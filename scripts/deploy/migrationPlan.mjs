// Pure rules for the automatic migration step (scripts/deploy/run-migrations.mjs).
// No database, no file system: verified by scripts/verify-deploy-migrations.mjs.
//
// Migrations up to BASELINE were applied by hand in the SQL editor before the
// deploy was automated (11.10.2026) and are never run by the workflow. Every
// file above it runs once, in number order, and is recorded in
// deploy.applied_migrations.

export const BASELINE = 140
// How many files are numbered at or below BASELINE (094 is used twice, 056 never).
// A NEW file numbered at or below BASELINE would never run, so the check refuses it.
export const BASELINE_FILE_COUNT = 140

export const NAME_RE = /^(\d{3,})_([a-z0-9_]+)\.sql$/

/** Validates the file names in supabase/migrations and sorts them by number. */
export function readMigrationNames(names, baseline = BASELINE, baselineCount = BASELINE_FILE_COUNT) {
  const errors = []
  const files = []
  for (const name of names) {
    if (!name.endsWith('.sql')) continue
    const m = NAME_RE.exec(name)
    if (!m) {
      errors.push(`${name}: a migration is named <number>_<lowercase_words>.sql, for example 141_shop_notes.sql`)
      continue
    }
    files.push({ file: name, number: Number(m[1]) })
  }
  files.sort((a, b) => a.number - b.number || (a.file < b.file ? -1 : 1))

  const old = files.filter(f => f.number <= baseline)
  if (old.length !== baselineCount) {
    errors.push(
      `${old.length} files are numbered ${baseline} or lower; there should be ${baselineCount}. ` +
      `A new migration must be numbered above ${baseline} (those run automatically on merge); ` +
      `files at or below it never run.`,
    )
  }
  const seen = new Map()
  for (const f of files) {
    if (f.number <= baseline) continue
    if (seen.has(f.number)) errors.push(`${f.file} and ${seen.get(f.number)} share the number ${f.number}; give one the next free number`)
    else seen.set(f.number, f.file)
  }
  return { files, errors }
}

/**
 * What to run.
 * files:   [{file, number}] from readMigrationNames
 * shaOf:   (file) => sha256 of its contents
 * ledger:  Map(file -> sha256 recorded when it ran)
 */
export function planMigrations(files, shaOf, ledger, baseline = BASELINE) {
  const apply = []
  const done = []
  const changed = []
  for (const f of files) {
    if (f.number <= baseline) continue
    const sha = shaOf(f.file)
    if (!ledger.has(f.file)) apply.push({ ...f, sha })
    else if (ledger.get(f.file) !== sha) changed.push(f.file)
    else done.push(f.file)
  }
  return { apply, done, changed }
}

/**
 * The text sent to Postgres for one migration: the file, then the ledger row,
 * as ONE simple query. Postgres runs a multi-statement simple query as one
 * transaction unless the text has its own BEGIN/COMMIT, so a file without them
 * and its ledger row commit together or not at all (what the SQL editor does).
 */
export function migrationQuery(file, sha, commit) {
  if (!NAME_RE.test(file)) throw new Error(`bad migration name: ${file}`)
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`bad sha256 for ${file}`)
  const c = /^[0-9a-f]{7,40}$/.test(commit ?? '') ? `'${commit}'` : 'null'
  return (sql) =>
    `${sql}\n;\ninsert into deploy.applied_migrations (file, sha256, commit_sha) values ('${file}', '${sha}', ${c});\n`
}

/** 1-based line of a character position (Postgres reports `position`, 1-based). */
export function lineOf(text, position) {
  const p = Number(position)
  if (!Number.isFinite(p) || p < 1) return null
  return text.slice(0, p - 1).split('\n').length
}

/**
 * Checks the database address before connecting. GitHub's machines have no
 * IPv6, and Supabase's direct address (db.<ref>.supabase.co) is IPv6 only, so
 * the Session pooler address (port 5432 on *.pooler.supabase.com) is required.
 */
export function checkDbUrl(raw, local = false) {
  let u
  try { u = new URL(raw) } catch { return { error: 'SUPABASE_DB_URL is not a postgresql:// address' } }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { error: 'SUPABASE_DB_URL must start with postgresql://' }
  if (!u.password) return { error: 'SUPABASE_DB_URL has no password (replace [YOUR-PASSWORD] with the database password)' }
  if (/\[|\]/.test(decodeURIComponent(u.password))) return { error: 'SUPABASE_DB_URL still contains [YOUR-PASSWORD]' }
  if (!local) {
    if (/^db\..*\.supabase\.co$/.test(u.hostname)) {
      return { error: 'SUPABASE_DB_URL is the direct address, which GitHub cannot reach. Use the "Session pooler" address (…pooler.supabase.com:5432)' }
    }
    if (u.port === '6543') {
      return { error: 'SUPABASE_DB_URL is the Transaction pooler (port 6543). Use the "Session pooler" address (port 5432)' }
    }
  }
  return {
    config: {
      host: u.hostname,
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '') || 'postgres'),
    },
  }
}
