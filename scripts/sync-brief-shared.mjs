#!/usr/bin/env node
// Copies the pure daily-brief rules (src/features/home/briefRules.ts, import-free) into the phone-gateway edge
// function, between the `// <brief-shared>` and `// </brief-shared>` markers — the sync-kobo-shared.mjs pattern. The
// phone's `brief` action is built by the SAME rules as Home's brief (no AI: owner decision 26.09.2026, and 22.11.2026
// for the phone), written and verified once in src/. Only the local `dmy` is renamed (`briefDmy`): the gateway has
// its own `dmy`, and the function is one file.
//
//   node scripts/sync-brief-shared.mjs          # rewrite the region
//   node scripts/sync-brief-shared.mjs --check  # exit 1 if stale

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'src/features/home/briefRules.ts'
const TARGET = 'supabase/functions/phone-gateway/index.ts'
const OPEN = '// <brief-shared>'
const CLOSE = '// </brief-shared>'

const src = readFileSync(join(root, SOURCE), 'utf8')
if (/^import\s/m.test(src)) { console.error(`${SOURCE} must stay import-free to be copied`); process.exit(2) }
const body = src.split('\n')
  .map(line => line.replace(/^export (?=(async |function |const |type |interface |let ))/, ''))
  .join('\n')
  .replace(/\bdmy\b/g, 'briefDmy')
  .trim()

const block = [
  OPEN,
  `// GENERATED from ${SOURCE} by scripts/sync-brief-shared.mjs.`,
  '// Do not edit here — edit the source and re-run the script.',
  '/* eslint-disable @typescript-eslint/no-unused-vars -- the function uses only part of this module (linted in src/) */',
  '',
  body,
  '',
  '/* eslint-enable @typescript-eslint/no-unused-vars */',
  CLOSE,
].join('\n')

const path = join(root, TARGET)
const text = readFileSync(path, 'utf8')
const a = text.search(/^\/\/ <brief-shared>$/m)
const b = text.search(/^\/\/ <\/brief-shared>$/m)
if (a < 0 || b < 0 || b < a) { console.error(`${TARGET}: markers not found`); process.exit(2) }
const next = text.slice(0, a) + block + text.slice(b + CLOSE.length)
if (next === text) { console.log('already in sync'); process.exit(0) }
if (process.argv.includes('--check')) { console.error(`${TARGET}: shared region is stale — run node scripts/sync-brief-shared.mjs`); process.exit(1) }
writeFileSync(path, next)
console.log(`${TARGET}: updated`)
