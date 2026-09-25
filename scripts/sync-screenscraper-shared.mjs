#!/usr/bin/env node
// Copies the pure ScreenScraper modules (src/features/games/scraper/ss*.ts)
// into both edge functions, between the `// <ss-shared>` and `// </ss-shared>`
// markers.
//
// Why: a Supabase function deployed from the Dashboard cannot import from
// src/ (or from a sibling `_shared/` folder), so each function is one
// self-contained file. The logic is written and verified ONCE in src/, and
// this script is the only way it reaches the functions — "change one, change
// the other" by hand is exactly how the old scraper's two copies drifted.
//
//   node scripts/sync-screenscraper-shared.mjs          # rewrite the regions
//   node scripts/sync-screenscraper-shared.mjs --check  # exit 1 if stale

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = ['ssTypes.ts', 'ssMediaCatalog.ts', 'ssRules.ts', 'ssProxy.ts', 'ssPlan.ts']
const TARGETS = [
  'supabase/functions/screenscraper-sync/index.ts',
  'supabase/functions/screenscraper-media/index.ts',
]
const OPEN = '// <ss-shared>'
const CLOSE = '// </ss-shared>'

function transform(file) {
  const src = readFileSync(join(root, 'src/features/games/scraper', file), 'utf8')
  const out = []
  for (const line of src.split('\n')) {
    if (/^import\s/.test(line)) continue
    if (/^type Rec = /.test(line) || /^\/\/ (deno-lint-ignore |eslint-disable-next-line @typescript-eslint\/)no-explicit-any$/.test(line)) continue
    out.push(line.replace(/^export (?=(async |function |const |type |interface |let ))/, ''))
  }
  return `// ── ${file} ──\n${out.join('\n').trim()}\n`
}

const block = [
  OPEN,
  '// GENERATED from src/features/games/scraper/ by scripts/sync-screenscraper-shared.mjs.',
  '// Do not edit here — edit the source and re-run the script.',
  '// deno-lint-ignore no-explicit-any',
  'type Rec = Record<string, any>',
  '',
  ...SOURCES.map(transform),
  CLOSE,
].join('\n')

const check = process.argv.includes('--check')
let stale = 0
for (const t of TARGETS) {
  const path = join(root, t)
  const text = readFileSync(path, 'utf8')
  const a = text.indexOf(OPEN)
  const b = text.indexOf(CLOSE)
  if (a < 0 || b < 0 || b < a) { console.error(`${t}: markers not found`); process.exit(2) }
  const next = text.slice(0, a) + block + text.slice(b + CLOSE.length)
  if (next === text) continue
  stale++
  if (check) console.error(`${t}: shared region is stale — run node scripts/sync-screenscraper-shared.mjs`)
  else { writeFileSync(path, next); console.log(`${t}: updated`) }
}
if (check && stale) process.exit(1)
if (!check && !stale) console.log('already in sync')
