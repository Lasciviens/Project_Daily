#!/usr/bin/env node
// Copies the pure Trakt modules (src/features/media/trakt/) into the trakt-api
// edge function, between the `// <trakt-shared>` and `// </trakt-shared>`
// markers — the sync-screenscraper-shared.mjs pattern. A Dashboard-deployed
// function cannot import from src/, so the plans are written and verified ONCE
// in src/ and reach the function only through this script.
//
//   node scripts/sync-trakt-shared.mjs          # rewrite the region
//   node scripts/sync-trakt-shared.mjs --check  # exit 1 if stale

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = ['traktTypes.ts', 'traktDates.ts', 'traktImportPlan.ts', 'traktSyncPlan.ts', 'followRules.ts']
const TARGET = 'supabase/functions/trakt-api/index.ts'
const OPEN = '// <trakt-shared>'
const CLOSE = '// </trakt-shared>'

function transform(file) {
  const src = readFileSync(join(root, 'src/features/media/trakt', file), 'utf8')
  const out = src.split('\n')
    .filter(line => !/^import\s/.test(line))
    .map(line => line.replace(/^export (?=(async |function |const |type |interface |let ))/, ''))
  return `// ── ${file} ──\n${out.join('\n').trim()}\n`
}

const block = [
  OPEN,
  '// GENERATED from src/features/media/trakt/ by scripts/sync-trakt-shared.mjs.',
  '// Do not edit here — edit the source and re-run the script.',
  '',
  ...SOURCES.map(transform),
  CLOSE,
].join('\n')

const path = join(root, TARGET)
const text = readFileSync(path, 'utf8')
// Whole-line markers only, so a mention of the region in a comment never matches.
const a = text.search(/^\/\/ <trakt-shared>$/m)
const b = text.search(/^\/\/ <\/trakt-shared>$/m)
if (a < 0 || b < 0 || b < a) { console.error(`${TARGET}: markers not found`); process.exit(2) }
const next = text.slice(0, a) + block + text.slice(b + CLOSE.length)
if (next === text) { console.log('already in sync'); process.exit(0) }
if (process.argv.includes('--check')) { console.error(`${TARGET}: shared region is stale — run node scripts/sync-trakt-shared.mjs`); process.exit(1) }
writeFileSync(path, next)
console.log(`${TARGET}: updated`)
