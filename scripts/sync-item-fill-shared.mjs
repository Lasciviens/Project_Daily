#!/usr/bin/env node
// Copies ✨'s field check (src/features/items/itemFill.ts) into the ai-proxy
// edge function, between the `// <item-fill-shared>` and `// </item-fill-shared>`
// markers — the sync-icloud-shared.mjs pattern. The server and the browser run
// the same check on the model's answer; a deployed function cannot import from
// src/, so the check reaches it only through this script.
//
// itemFill.ts is copied whole; of the modules it imports, only the declarations
// it uses are picked by name (one-line constants, a type, a function up to its
// closing brace), so ai-proxy doesn't carry the calendar writers' code.
//
//   node scripts/sync-item-fill-shared.mjs          # rewrite the region
//   node scripts/sync-item-fill-shared.mjs --check  # exit 1 if stale

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PICKS = [
  ['src/features/calendar/calendarEventRules.ts', ['ALERT_MINUTES', 'MAX_ITEM_ALERTS', 'TRAVEL_MINUTES', 'ITEM_URL_MAX', 'ITEM_URL']],
  ['src/features/daily/recurrence.ts', ['MAX_REPEAT_COUNT', 'MAX_REPEAT_INTERVAL']],
  ['src/features/items/itemPlace.ts', ['PLACE_NAME_MAX']],
  ['src/features/items/itemCalendarFields.ts', ['UrlResult', 'URL_CHAR', 'cleanItemUrl']],
]
const WHOLE = 'src/features/items/itemFill.ts'
const TARGET = 'supabase/functions/ai-proxy/index.ts'
const OPEN = '// <item-fill-shared>'
const CLOSE = '// </item-fill-shared>'

const unexport = line => line.replace(/^export (?=(async |function |const |type |interface |let ))/, '')

/** One declaration by name: a single line, or a block up to the first line that is only `}`. */
function pick(file, name) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  const at = lines.findIndex(l => new RegExp(`^(?:export )?(?:const|function|type|interface) ${name}\\b`).test(l))
  if (at < 0) throw new Error(`${name} not found in ${file}`)
  if (!/[{([,=]\s*$/.test(lines[at])) return unexport(lines[at])
  if (!/\{\s*$/.test(lines[at])) throw new Error(`${name} in ${file} spans lines without a block — pick only one-line declarations or blocks`)
  const end = lines.findIndex((l, i) => i > at && l === '}')
  if (end < 0) throw new Error(`${name} in ${file} has no closing brace`)
  return lines.slice(at, end + 1).map((l, i) => (i ? l : unexport(l))).join('\n')
}

function whole(file) {
  const out = []
  let inImport = false
  for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
    if (inImport) { if (/from\s+'[^']+'\s*$/.test(line)) inImport = false; continue }
    if (/^import\s/.test(line)) { if (!/from\s+'[^']+'\s*$/.test(line)) inImport = true; continue }
    out.push(unexport(line))
  }
  return `// ── ${file} ──\n${out.join('\n').trim()}\n`
}

// ESLint checks the modules in src/; the function uses only part of them.
const block = [
  OPEN,
  '// GENERATED from src/ by scripts/sync-item-fill-shared.mjs. Do not edit here — edit the source and re-run the script.',
  '/* eslint-disable @typescript-eslint/no-unused-vars -- the function uses only part of these modules (linted in src/) */',
  '',
  ...PICKS.map(([file, names]) => `// ── ${file}: ${names.join(', ')} ──\n${names.map(n => pick(file, n)).join('\n')}\n`),
  whole(WHOLE),
  '/* eslint-enable @typescript-eslint/no-unused-vars */',
  CLOSE,
].join('\n')

const path = join(root, TARGET)
const text = readFileSync(path, 'utf8')
// Whole-line markers only, so a mention of the region in a comment never matches.
const open = text.search(/^\/\/ <item-fill-shared>$/m)
const close = text.search(/^\/\/ <\/item-fill-shared>$/m)
if (open < 0 || close < open) {
  console.error(`sync-item-fill-shared: markers not found in ${TARGET}`)
  process.exit(1)
}
const next = text.slice(0, open) + block + text.slice(close + CLOSE.length)
if (process.argv.includes('--check')) {
  if (next !== text) {
    console.error('sync-item-fill-shared: the copy in ai-proxy is stale — run node scripts/sync-item-fill-shared.mjs')
    process.exit(1)
  }
  console.log('sync-item-fill-shared: up to date')
} else {
  writeFileSync(path, next)
  console.log(`sync-item-fill-shared: wrote ${WHOLE} and ${PICKS.reduce((n, [, names]) => n + names.length, 0)} picked declarations into ${TARGET}`)
}
