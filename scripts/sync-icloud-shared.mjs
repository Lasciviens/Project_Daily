#!/usr/bin/env node
// Copies the pure calendar modules the app's Apple Calendar events are built
// from into the icloud-calendar edge function, between the `// <icloud-shared>`
// and `// </icloud-shared>` markers — the sync-trakt-shared.mjs pattern. A
// deployed function cannot import from src/, so the event rules are written and
// verified ONCE in src/ (the same rules as Google's events) and reach the
// function only through this script.
//
//   node scripts/sync-icloud-shared.mjs          # rewrite the region
//   node scripts/sync-icloud-shared.mjs --check  # exit 1 if stale

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = [
  'src/features/daily/recurrence.ts',
  'src/features/calendar/calendarEventRules.ts',
  'src/features/calendar/calendarSeries.ts',
  'src/features/calendar/areas/icloudEvents.ts',
]
const TARGET = 'supabase/functions/icloud-calendar/index.ts'
const OPEN = '// <icloud-shared>'
const CLOSE = '// </icloud-shared>'

// One scope in the function: a private one-line helper two files both declare
// (the same `pad`, `ISO_DAY`) is kept once; a name declared twice differently stops the copy.
const seen = new Map()
function transform(file) {
  const src = readFileSync(join(root, file), 'utf8')
  const out = []
  let inImport = false
  for (const line of src.split('\n')) {
    if (inImport) { if (/from\s+'[^']+'\s*$/.test(line)) inImport = false; continue }
    if (/^import\s/.test(line)) { if (!/from\s+'[^']+'\s*$/.test(line)) inImport = true; continue }
    const decl = line.match(/^(?:export )?const ([A-Za-z_$][\w$]*) = /)
    if (decl && !/^export /.test(line)) {
      const prev = seen.get(decl[1])
      if (prev === line) continue
      if (prev !== undefined) throw new Error(`${decl[1]} is declared differently in two copied files`)
      seen.set(decl[1], line)
    }
    out.push(line.replace(/^export (?=(async |function |const |type |interface |let ))/, ''))
  }
  return `// ── ${file} ──\n${out.join('\n').trim()}\n`
}

const block = [
  OPEN,
  '// GENERATED from src/ by scripts/sync-icloud-shared.mjs. Do not edit here — edit the source and re-run the script.',
  '',
  ...SOURCES.map(transform),
  CLOSE,
].join('\n')

const path = join(root, TARGET)
const text = readFileSync(path, 'utf8')
// Whole-line markers only, so a mention of the region in a comment never matches.
const open = text.search(/^\/\/ <icloud-shared>$/m)
const close = text.search(/^\/\/ <\/icloud-shared>$/m)
if (open < 0 || close < open) {
  console.error(`sync-icloud-shared: markers not found in ${TARGET}`)
  process.exit(1)
}
const next = text.slice(0, open) + block + text.slice(close + CLOSE.length)
if (process.argv.includes('--check')) {
  if (next !== text) {
    console.error('sync-icloud-shared: the copy in icloud-calendar is stale — run node scripts/sync-icloud-shared.mjs')
    process.exit(1)
  }
  console.log('sync-icloud-shared: up to date')
} else {
  writeFileSync(path, next)
  console.log(`sync-icloud-shared: wrote ${SOURCES.length} files into ${TARGET}`)
}
