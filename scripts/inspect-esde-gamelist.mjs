#!/usr/bin/env node
// Inspect ES-DE `gamelist.xml` files WITHOUT shipping their contents anywhere.
//
// Why this exists: a full ES-DE export is megabytes of XML across dozens of
// system folders. Pasting that into a chat would burn an enormous number of
// tokens to learn three things we actually need — which fields ES-DE really
// writes, how the <path> values are shaped, and how many games there are per
// system. This script answers exactly those, locally, and prints a compact
// report (tens of lines, not megabytes) that is safe to paste.
//
// It is READ-ONLY. It never writes, moves or uploads anything.
//
// Usage (on the machine that has the files — e.g. the MacBook after you copy
// the ES-DE folder off the device):
//
//   node scripts/inspect-esde-gamelist.mjs <path-to-ES-DE-gamelists-root>
//
// e.g.  node scripts/inspect-esde-gamelist.mjs ~/ESDE/gamelists
//
// The root is the folder that CONTAINS the per-system folders, each of which
// holds a gamelist.xml:  gamelists/megadrive/gamelist.xml, gamelists/snes/...
//
// Add --sample to also print ONE full <game> block per system (redacted of
// nothing — these are public ROM metadata, but review before pasting).

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
const wantSample = process.argv.includes('--sample')

if (!root || !existsSync(root)) {
  console.error('Usage: node scripts/inspect-esde-gamelist.mjs <gamelists-root> [--sample]')
  console.error('  <gamelists-root> must be the folder containing per-system subfolders.')
  process.exit(1)
}

/** Pull every <game>…</game> block out of a gamelist.xml. */
function extractGameBlocks(xml) {
  return xml.match(/<game\b[\s\S]*?<\/game>/g) ?? []
}

/** Child tag names directly under one <game> block, in document order. */
function tagsIn(block) {
  const tags = []
  const re = /<([a-zA-Z0-9_]+)(\s[^>]*)?>/g
  let m
  while ((m = re.exec(block))) {
    if (m[1] !== 'game') tags.push(m[1])
  }
  return tags
}

function textOf(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return m ? m[1].trim() : null
}

const systems = readdirSync(root, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort()

const tagCounts = new Map()      // tag -> how many <game> blocks contain it
const tagExamples = new Map()    // tag -> a short example value
let totalGames = 0
const perSystem = []

for (const sys of systems) {
  const file = join(root, sys, 'gamelist.xml')
  if (!existsSync(file)) continue

  const bytes = statSync(file).size
  const xml = readFileSync(file, 'utf8')
  const blocks = extractGameBlocks(xml)
  totalGames += blocks.length

  let withPlaycount = 0
  let withLastplayed = 0
  const pathShapes = new Set()

  for (const b of blocks) {
    for (const t of new Set(tagsIn(b))) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
      if (!tagExamples.has(t)) {
        const v = textOf(b, t)
        if (v) tagExamples.set(t, v.length > 60 ? v.slice(0, 60) + '…' : v)
      }
    }
    const pc = textOf(b, 'playcount')
    const lp = textOf(b, 'lastplayed')
    if (pc && pc !== '0') withPlaycount++
    if (lp) withLastplayed++

    const p = textOf(b, 'path')
    // Record the SHAPE of the path (leading ./ ? extension?), not the name.
    if (p) pathShapes.add(`${p.startsWith('./') ? './' : '(none)'} prefix, .${p.split('.').pop()}`)
  }

  perSystem.push({ sys, games: blocks.length, bytes, withPlaycount, withLastplayed, pathShapes: [...pathShapes] })
}

const kb = n => `${(n / 1024).toFixed(0)} KB`

console.log('='.repeat(70))
console.log('ES-DE gamelist inspection')
console.log('='.repeat(70))
console.log(`root:          ${root}`)
console.log(`systems found: ${perSystem.length}`)
console.log(`games total:   ${totalGames}`)
console.log(`XML total:     ${kb(perSystem.reduce((s, x) => s + x.bytes, 0))}`)

console.log('\n--- per system ---')
console.log('system'.padEnd(22), 'games'.padStart(6), 'size'.padStart(9), 'played'.padStart(7), 'lastplayed'.padStart(11))
for (const s of perSystem.sort((a, b) => b.games - a.games)) {
  console.log(
    s.sys.padEnd(22),
    String(s.games).padStart(6),
    kb(s.bytes).padStart(9),
    String(s.withPlaycount).padStart(7),
    String(s.withLastplayed).padStart(11),
  )
}

console.log('\n--- every <game> child tag ES-DE actually writes ---')
console.log('(count = how many games carry it, out of', totalGames + ')')
const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])
for (const [tag, n] of sorted) {
  const pct = ((n / totalGames) * 100).toFixed(0)
  console.log(`  ${tag.padEnd(18)} ${String(n).padStart(6)}  ${pct.padStart(3)}%   e.g. ${tagExamples.get(tag) ?? ''}`)
}

console.log('\n--- <path> shapes (the join key candidate) ---')
const allShapes = new Set(perSystem.flatMap(s => s.pathShapes))
for (const shape of allShapes) console.log('  ' + shape)

if (wantSample) {
  console.log('\n--- one full <game> block per system (first 3 systems) ---')
  for (const s of perSystem.slice(0, 3)) {
    const xml = readFileSync(join(root, s.sys, 'gamelist.xml'), 'utf8')
    const first = extractGameBlocks(xml)[0]
    console.log(`\n### ${s.sys}\n${first}`)
  }
}

console.log('\nDone. Paste the output above — not the XML files themselves.')
