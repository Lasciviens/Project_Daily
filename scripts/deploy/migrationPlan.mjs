// Rules for the automatic migration step (scripts/deploy/run-migrations.mjs).
// No database and no file reads here: verified by scripts/verify-deploy-migrations.mjs.
//
// Migrations up to BASELINE were applied by hand in the SQL editor before the
// deploy was automated (11.10.2026) and are never run by the workflow. Every
// file above it runs once, in number order, and is recorded in
// deploy.applied_migrations.
import { createHash } from 'node:crypto'

export const BASELINE = 140
// The names of the files numbered at or below BASELINE, frozen: sha256 of the
// sorted names joined by "\n" (140 files: 094 is used twice, 056 never). A file
// added, renamed or deleted down there would never run, or would hide a change.
export const BASELINE_NAMES_SHA256 = 'b4fa7a7ebbe7080f985af7976362789ca746ff9d1d9fe0cfcc9f3e1e1aeb602b'

export const NAME_RE = /^(\d{3,})_([a-z0-9_]+)\.sql$/

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** Validates the file names in supabase/migrations and sorts them by number. */
export function readMigrationNames(names, baseline = BASELINE, baselineSha = BASELINE_NAMES_SHA256) {
  const errors = []
  const files = []
  for (const name of names) {
    if (!/\.sql$/i.test(name)) continue
    const m = NAME_RE.exec(name)
    if (!m) {
      errors.push(`${name}: a migration is named <number>_<lowercase_words>.sql, for example 141_shop_notes.sql`)
      continue
    }
    files.push({ file: name, number: Number(m[1]) })
  }
  files.sort((a, b) => a.number - b.number || (a.file < b.file ? -1 : 1))

  const old = files.filter(f => f.number <= baseline).map(f => f.file).sort()
  if (baselineSha && sha256(old.join('\n')) !== baselineSha) {
    errors.push(
      `The files numbered ${baseline} or lower changed (one was added, renamed or deleted). ` +
      `Those were applied by hand and never run automatically; leave them as they are. ` +
      `A new migration is numbered above ${baseline}.`,
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
 * files:  [{file, number}] from readMigrationNames
 * shaOf:  (file) => sha256 of its contents
 * ledger: Map(file -> sha256 recorded when it ran)
 * A ledger row with the same NUMBER or the same contents under another name
 * counts as run (a file renamed or renumbered after it ran must not run twice).
 */
export function planMigrations(files, shaOf, ledger, baseline = BASELINE) {
  const byNumber = new Map()
  const bySha = new Map()
  for (const [file, sha] of ledger) {
    const m = NAME_RE.exec(file)
    if (m) byNumber.set(Number(m[1]), file)
    bySha.set(sha, file)
  }
  const apply = []
  const done = []
  const changed = []
  const renamed = []
  for (const f of files) {
    if (f.number <= baseline) continue
    const sha = shaOf(f.file)
    if (ledger.has(f.file)) {
      if (ledger.get(f.file) !== sha) changed.push(f.file)
      else done.push(f.file)
    } else if (byNumber.has(f.number) || bySha.has(sha)) {
      renamed.push({ file: f.file, ranAs: byNumber.get(f.number) ?? bySha.get(sha) })
    } else {
      apply.push({ ...f, sha })
    }
  }
  return { apply, done, changed, renamed }
}

// ─── Top-level statements ─────────────────────────────────────────────────────
// Blanks comments, quoted strings, quoted identifiers and dollar-quoted bodies
// (keeping line breaks), so that what is left can be split on ";" safely.
function blankQuoted(sql) {
  let out = ''
  let i = 0
  const n = sql.length
  const keepLines = (s) => s.replace(/[^\n]/g, '')
  while (i < n) {
    const c = sql[i]
    const d = sql[i + 1]
    if (c === '-' && d === '-') {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? n : end
      out += ' '
      continue
    }
    if (c === '/' && d === '*') {
      let depth = 1
      let j = i + 2
      while (j < n && depth) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2 }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2 }
        else j++
      }
      out += ' ' + keepLines(sql.slice(i, j))
      i = j
      continue
    }
    if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '')
      let j = i + 1
      while (j < n) {
        if (escapes && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          j++
          break
        }
        j++
      }
      out += "''" + keepLines(sql.slice(i, j))
      i = j
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue }
          j++
          break
        }
        j++
      }
      out += 'x' + keepLines(sql.slice(i, j))
      i = j
      continue
    }
    if (c === '$' && !(i > 0 && /[A-Za-z0-9_]/.test(sql[i - 1]))) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80))
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length)
        const stop = end < 0 ? n : end + m[0].length
        out += ' $$ ' + keepLines(sql.slice(i, stop))
        i = stop
        continue
      }
    }
    out += c
    i++
  }
  return out
}

/** Every top-level statement (blanked text, its first words, its 1-based line). */
export function topLevelStatements(sql) {
  const text = blankQuoted(sql)
  const result = []
  let line = 1
  for (const part of text.split(';')) {
    const lead = part.match(/^\s*/)[0]
    const head = part.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase()
    if (head) result.push({ head, text: part, line: line + (lead.match(/\n/g)?.length ?? 0) })
    line += part.match(/\n/g)?.length ?? 0
  }
  return result
}

const TX_CONTROL = /^(begin|start transaction|commit|end|rollback|abort|savepoint|release|prepare transaction)\b/

/**
 * Transaction control at the top level of a migration. Refused above BASELINE:
 * the runner sends the file and its ledger row as ONE transaction, and a
 * COMMIT/ROLLBACK inside the file would split it (half-applied, or applied but
 * not recorded). Function bodies (BEGIN … END inside $$) are not top level.
 */
export function transactionControl(sql) {
  const found = []
  let atomic = 0
  for (const s of topLevelStatements(sql)) {
    // A SQL-standard body (CREATE … BEGIN ATOMIC … END) holds ";" inside it;
    // an empty one ("begin atomic end") closes in the same statement.
    if (/^create\b/.test(s.head) && /\bbegin\s+atomic\b/i.test(s.text) && !/\bbegin\s+atomic\s+end\s*$/i.test(s.text)) atomic++
    if (atomic && s.head === 'end') { atomic--; continue }
    if (atomic) continue
    if (TX_CONTROL.test(s.head)) found.push(s)
  }
  return found
}

/**
 * The text sent to Postgres for one migration, as ONE simple query: timeouts
 * for this transaction only, the file, then its ledger row. Postgres runs a
 * multi-statement simple query as one transaction (the file may not contain
 * its own BEGIN/COMMIT — transactionControl), so the file and its ledger row
 * commit together or not at all.
 */
export function migrationQuery(file, sha, commit) {
  if (!NAME_RE.test(file)) throw new Error(`bad migration name: ${file}`)
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`bad sha256 for ${file}`)
  const c = /^[0-9a-f]{7,40}$/.test(commit ?? '') ? `'${commit}'` : 'null'
  const prefix = "set local lock_timeout = '5s'; set local statement_timeout = '10min';\n"
  return {
    prefixLines: 1,
    build: (sql) =>
      `${prefix}${sql}\n;\ninsert into deploy.applied_migrations (file, sha256, commit_sha) values ('${file}', '${sha}', ${c});\n`,
  }
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
 * the Session pooler address (port 5432, user postgres.<project ref>) is
 * required — and it must be THIS project, not another one in the account.
 */
export function checkDbUrl(raw, { local = false, projectRef = '' } = {}) {
  let u
  try { u = new URL(raw) } catch { return { error: 'SUPABASE_DB_URL is not a postgresql:// address' } }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { error: 'SUPABASE_DB_URL must start with postgresql://' }
  if (!u.password) return { error: 'SUPABASE_DB_URL has no password (replace [YOUR-PASSWORD] with the database password)' }
  let password
  try { password = decodeURIComponent(u.password) } catch { return { error: 'SUPABASE_DB_URL: the password has a "%" that is not part of an encoded character; write % as %25' } }
  if (/^\[.*\]$/.test(password)) return { error: 'SUPABASE_DB_URL still contains [YOUR-PASSWORD]' }
  const user = decodeURIComponent(u.username)
  if (!local) {
    if (/^db\..*\.supabase\.co$/.test(u.hostname)) {
      return { error: 'SUPABASE_DB_URL is the direct address, which GitHub cannot reach. Use the "Session pooler" address (…pooler.supabase.com:5432)' }
    }
    if (u.port === '6543') {
      return { error: 'SUPABASE_DB_URL is the Transaction pooler (port 6543). Use the "Session pooler" address (port 5432)' }
    }
    if (projectRef && user !== `postgres.${projectRef}`) {
      return { error: `SUPABASE_DB_URL is not this app's database: its user must be postgres.${projectRef} (is it another Supabase project?)` }
    }
  }
  return {
    config: {
      host: u.hostname,
      port: Number(u.port || 5432),
      user,
      password,
      database: decodeURIComponent(u.pathname.replace(/^\//, '') || 'postgres'),
    },
  }
}

// Error classes whose message names only SQL objects (tables, columns,
// constraints, syntax), never a row's values. Other classes can quote data —
// a failed cast prints the value ("invalid input syntax for type integer:
// \"…\""), RAISE prints whatever it was given — so for them the public log
// gets the code and the object names only.
const SAFE_CLASSES = new Set(['42', '23', '25', '0A', '2D', '55', '57'])

/** What a public log may show of a Postgres error. */
export function publicError(e) {
  const code = typeof e?.code === 'string' ? e.code : ''
  if (code && SAFE_CLASSES.has(code.slice(0, 2))) return `[${code}] ${e.message}`
  const where = ['table', 'column', 'constraint'].filter(k => e?.[k]).map(k => `${k} ${e[k]}`).join(', ')
  return `[${code || 'no code'}] the message may contain row data, so it is not shown here${where ? ` (${where})` : ''}`
}
