#!/usr/bin/env node
// Builds the `claude` edge function: joins its parts (supabase/claude-src/*.ts)
// and the item form's own field rules (src/) into the one file Supabase
// deploys, supabase/functions/claude/index.ts. A deployed function must be a
// single self-contained file (it cannot import a sibling or anything in src/),
// while the code is easier to read, and to check, as one part per job.
//
// What joining does: the `npm:` imports move to the top, the imports between
// parts and from src/ are removed (everything is one file now), `export` is
// dropped, and each part gets a line naming its source file. Anything that
// can't be joined that way stops the build with a message: a default export or
// import, a renamed import, an import of a file that isn't a part, a part that
// imports from one below it, a name declared twice.
//
//   node scripts/build-claude-function.mjs          # write the file
//   node scripts/build-claude-function.mjs --check  # exit 1 if it is stale

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, posix } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS_DIR = 'supabase/claude-src'
const TARGET = 'supabase/functions/claude/index.ts'

// The item form's rules: itemFill.ts whole, and from the modules it imports only the declarations it uses
// (a one-line constant, a type, or a function up to its closing brace), so the function doesn't carry the
// calendar writers' code. verify-item-fill runs this copy beside the original.
const RULES = 'the item form rules'
const RULES_PICKS = [
  ['src/features/calendar/calendarEventRules.ts', ['ALERT_MINUTES', 'MAX_ITEM_ALERTS', 'TRAVEL_MINUTES', 'ITEM_URL_MAX', 'ITEM_URL']],
  ['src/features/daily/recurrence.ts', ['MAX_REPEAT_COUNT', 'MAX_REPEAT_INTERVAL']],
  ['src/features/items/itemPlace.ts', ['PLACE_NAME_MAX']],
  ['src/features/items/itemCalendarFields.ts', ['UrlResult', 'URL_CHAR', 'cleanItemUrl']],
]
const RULES_WHOLE = 'src/features/items/itemFill.ts'
const RULES_OPEN = '// <item-fill-shared>'
const RULES_CLOSE = '// </item-fill-shared>'

// The order the parts are joined in. A part may import only from parts above it, so everything a part
// needs when the file loads is already there.
const PARTS = [
  'types.ts', 'search-results.ts', 'prices.ts', 'guard.ts', 'image-rules.ts', 'answer-reader.ts', 'page-fetch.ts', 'recipe-rules.ts', 'recipe-page.ts',
  'learn-text.ts', 'learn-pick.ts', 'learn-score.ts', 'learn-specs.ts', 'learn-diff.ts', 'docs-snapshot.ts', 'docs-search.ts',
  'provider-anthropic.ts', 'ledger.ts', 'learn-store.ts',
  RULES,
  'job-item-fill.ts', 'job-recipes.ts', 'job-quick-guess.ts', 'job-photo.ts', 'job-dev-drafts.ts', 'job-text-features.ts', 'job-shop-tidy.ts', 'job-product-photo.ts', 'job-quick-list.ts', 'job-coach.ts', 'job-device.ts', 'job-weekly-report.ts', 'week-facts.ts', 'week-data.ts', 'report-store.ts', 'chat-rules.ts', 'suggest-rules.ts', 'suggest-store.ts', 'transit-lookup.ts', 'food-lookup.ts', 'chat-learn-tools.ts', 'chat-tools.ts', 'job-suggest-weekly.ts', 'job-learn-eval.ts', 'job-test-bench.ts', 'job-diagnose.ts', 'jobs.ts', 'learn-run.ts', 'run.ts', 'learn-save.ts', 'learn-chat.ts', 'batch.ts', 'suggest-batch.ts', 'learn-eval.ts', 'chat-store.ts', 'chat-loop.ts', 'phone-ask.ts', 'diagnose.ts', 'describe.ts', 'main.ts',
]

function stop(message) {
  console.error(`build-claude-function: ${message}`)
  process.exit(1)
}

const read = file => readFileSync(join(root, file), 'utf8')
const unexport = text => text.replace(/^export (?=(?:async )?(?:function|const|let|class|interface|type|enum)\b)/gm, '')
/** The names a piece of joined code declares at the top level (column 0). */
const declared = text => [...text.matchAll(/^(?:async )?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1])

// ─── The item form rules ──────────────────────────────────────────────────

/** One declaration by name: a single line, or a block up to the first line that is only `}`. */
function pick(file, name) {
  const lines = read(file).split('\n')
  const at = lines.findIndex(l => new RegExp(`^(?:export )?(?:const|function|type|interface) ${name}\\b`).test(l))
  if (at < 0) stop(`${name} not found in ${file}`)
  if (!/[{([,=]\s*$/.test(lines[at])) return unexport(lines[at])
  if (!/\{\s*$/.test(lines[at])) stop(`${name} in ${file} spans lines without a block: pick only one-line declarations or blocks`)
  const end = lines.findIndex((l, i) => i > at && l === '}')
  if (end < 0) stop(`${name} in ${file} has no closing brace`)
  return unexport(lines.slice(at, end + 1).join('\n'))
}

/** A whole src/ module without its imports (what it imports is picked above). */
function whole(file) {
  const out = []
  let inImport = false
  for (const line of read(file).split('\n')) {
    if (inImport) { if (/from\s+'[^']+'\s*$/.test(line)) inImport = false; continue }
    if (/^import\s/.test(line)) { if (!/from\s+'[^']+'\s*$/.test(line)) inImport = true; continue }
    out.push(line)
  }
  return unexport(out.join('\n')).trim()
}

function rulesBlock() {
  return [
    RULES_OPEN,
    '// Copied from src/: edit them there. The browser runs the same rules (scripts/verify-item-fill.cjs runs both copies).',
    '/* eslint-disable @typescript-eslint/no-unused-vars -- the function uses only part of these modules (linted in src/) */',
    '',
    ...RULES_PICKS.map(([file, names]) => `// ── ${file}: ${names.join(', ')} ──\n${names.map(n => pick(file, n)).join('\n')}\n`),
    `// ── ${RULES_WHOLE} ──\n${whole(RULES_WHOLE)}\n`,
    '/* eslint-enable @typescript-eslint/no-unused-vars */',
    RULES_CLOSE,
  ].join('\n')
}

// ─── The parts ────────────────────────────────────────────────────────────

const onDisk = readdirSync(join(root, PARTS_DIR)).filter(f => f.endsWith('.ts')).sort()
const listed = PARTS.filter(p => p !== RULES)
for (const file of onDisk) if (!listed.includes(file)) stop(`${PARTS_DIR}/${file} is not in the PARTS list of this script`)
for (const file of listed) if (!onDisk.includes(file)) stop(`${PARTS_DIR}/${file} is in the PARTS list but not on disk`)

/** The names of an import clause (`{ a, type B }`), or a stop when it is anything but a list of plain names. */
function importedNames(clause, where) {
  const m = /^(type\s+)?\{([\s\S]*)\}$/.exec(clause.trim())
  if (!m) stop(`${where}: only named imports can be joined (import { a, b } from …), not "import ${clause.trim().replace(/\s+/g, ' ')}"`)
  const names = m[2].split(',').map(n => n.trim()).filter(Boolean)
  for (const n of names) {
    if (/\sas\s/.test(n)) stop(`${where}: a renamed import ("${n}") can't be joined: every name is the same in the one file`)
    if (!/^(type\s+)?[A-Za-z_$][\w$]*$/.test(n)) stop(`${where}: can't read the import "${n}"`)
  }
  return names.map(n => (m[1] && !/^type\s/.test(n) ? `type ${n}` : n).replace(/\s+/g, ' '))
}

const npmImports = new Map() // specifier → names, in the order first seen
const wanted = [] // { part, names, from } for every import between parts and from src/
const sections = []
const names = new Map() // a top-level name → where it is declared

function declare(text, where) {
  for (const name of declared(text)) {
    if (names.has(name)) stop(`${name} is declared in ${names.get(name)} and again in ${where}: top-level names must differ, the parts become one file`)
    names.set(name, where)
  }
}

for (const part of PARTS) {
  if (part === RULES) {
    const block = rulesBlock()
    declare(block, RULES)
    sections.push(block)
    continue
  }
  const file = `${PARTS_DIR}/${part}`
  let text = read(file)
  text = text.replace(/^import\s+([\s\S]*?)\s+from\s+'([^']+)'[ \t]*;?[ \t]*$/gm, (_, clause, source) => {
    const found = importedNames(clause, file)
    if (source.startsWith('npm:')) {
      if (!/^npm:(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+$/.test(source)) stop(`${file}: "${source}" must name an exact version (npm:name@1.2.3)`)
      npmImports.set(source, [...new Set([...(npmImports.get(source) ?? []), ...found])])
    } else if (source.startsWith('.')) {
      wanted.push({ part, names: found.map(n => n.replace(/^type /, '')), from: posix.normalize(posix.join(PARTS_DIR, source)) })
    } else {
      stop(`${file}: can't join an import from "${source}" (only npm: packages, other parts and the item form rules)`)
    }
    return ''
  })
  text = unexport(text)
  const left = text.split('\n').findIndex(l => /^\s*(?:import\b|export\b)/.test(l) || /\bimport\s*\(|\brequire\s*\(/.test(l))
  if (left >= 0) stop(`${file}: this line can't be joined (a default export, a re-export, or an import that isn't "import { … } from '…'"):\n  ${text.split('\n')[left].trim()}`)
  declare(text, file)
  sections.push(`// ═══ ${file} ═══\n${text.replace(/\n{3,}/g, '\n\n').trim()}`)
}

// Every import between parts must point up the list, at a name that is really there.
const rulesFiles = [RULES_WHOLE, ...RULES_PICKS.map(([file]) => file)]
for (const { part, names: asked, from } of wanted) {
  const fromPart = from.startsWith(`${PARTS_DIR}/`) ? from.slice(PARTS_DIR.length + 1) : null
  const where = fromPart && listed.includes(fromPart) ? `${PARTS_DIR}/${fromPart}` : rulesFiles.includes(from) ? RULES : null
  if (!where) stop(`${PARTS_DIR}/${part} imports from ${from}, which is neither a part nor one of the item form rule files`)
  if (PARTS.indexOf(fromPart ?? RULES) >= PARTS.indexOf(part)) stop(`${PARTS_DIR}/${part} imports from ${from}, which comes later in the PARTS list: a part may only use the parts above it`)
  for (const name of asked) {
    if (names.get(name) !== where) stop(`${PARTS_DIR}/${part} imports ${name} from ${from}, but ${where === RULES ? 'it is not copied into the function (see RULES_PICKS)' : 'that part does not declare it'}`)
  }
}

const output = [
  `// GENERATED by scripts/build-claude-function.mjs from ${PARTS_DIR}/ and the item form's rules in src/.`,
  '// Do not edit this file. Edit the parts, then run:  node scripts/build-claude-function.mjs',
  ...[...npmImports].map(([source, found]) => `import { ${found.join(', ')} } from '${source}'`),
  '',
  sections.join('\n\n'),
  '',
].join('\n')

const path = join(root, TARGET)
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(path, 'utf8') } catch { /* not built yet: stale */ }
  if (current !== output) stop(`${TARGET} is stale: run node scripts/build-claude-function.mjs`)
  console.log('build-claude-function: up to date')
} else {
  writeFileSync(path, output)
  console.log(`build-claude-function: wrote ${TARGET} from ${listed.length} parts and the item form rules`)
}
