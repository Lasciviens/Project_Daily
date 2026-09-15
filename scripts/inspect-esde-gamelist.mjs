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
// YOU DO NOT NEED THE WHOLE ES-DE FOLDER. A real ES-DE install is ~15 GB, but
// almost all of that is `downloaded_media` (box art, screenshots, videos) and
// `themes`. The only thing this needs — and the only thing the eventual sync
// needs — is the `gamelists/` subfolder, which is plain XML and tiny.
//
// So the cheap path is: copy just `ES-DE/gamelists/` off the device, and point
// this at that.
//
// Usage:
//
//   node scripts/inspect-esde-gamelist.mjs <folder> [--sample]
//
// <folder> can be the `gamelists` folder itself, or the ES-DE root (it will
// jump straight into `gamelists/` when it sees it). If it has to fall back to
// searching, it deliberately SKIPS the known-huge folders — walking
// `downloaded_media` on a 15 GB install would take minutes for nothing.
//
// Add --sample to also print ONE full <game> block per system (these are
// public ROM metadata, but glance at the output before pasting anywhere).

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
const wantSample = process.argv.includes('--sample')

if (!root || !existsSync(root)) {
  console.error('Usage: node scripts/inspect-esde-gamelist.mjs <folder> [--sample]')
  console.error('  <folder> = the ES-DE export you copied off the device (or its parent).')
  console.error('  It searches downwards for gamelist.xml, so the exact level need not be right.')
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

// Real ES-DE folders contain these siblings, and two of them hold essentially
// all of the ~15 GB. Never walk into them: no gamelist.xml lives there, and
// `downloaded_media` alone can be hundreds of thousands of image files.
const SKIP_DIRS = new Set([
  'downloaded_media', 'themes', 'screensavers', 'roms', 'logs', 'cache',
])

/**
 * Find every gamelist.xml under `dir`. ES-DE's own layout is
 * <root>/gamelists/<system>/gamelist.xml, so if a `gamelists` folder is right
 * there we go straight into it and skip searching entirely. Otherwise we walk,
 * but shallowly and past the heavy folders.
 */
function findGamelists(dir, depth = 0, found = [], stats = { dirs: 0 }) {
  if (depth > 5) return found
  stats.dirs++
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return found }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory() && SKIP_DIRS.has(e.name.toLowerCase())) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) findGamelists(full, depth + 1, found, stats)
    else if (e.name === 'gamelist.xml') found.push(full)
  }
  return found
}

const scanStats = { dirs: 0 }
// Fast path: the caller pointed at an ES-DE root that has `gamelists/`.
const directGamelists = join(root, 'gamelists')
const searchRoot = existsSync(directGamelists) ? directGamelists : root
const gamelistFiles = findGamelists(searchRoot, 0, [], scanStats)

if (gamelistFiles.length === 0) {
  console.error(`No gamelist.xml found anywhere under: ${root}`)
  console.error('')
  console.error('This wants the ES-DE `gamelists` folder (plain XML, small).')
  console.error('You do NOT need the whole ~15 GB ES-DE folder — downloaded_media')
  console.error('and themes are the bulk of it and are irrelevant here.')
  console.error('')
  console.error('On the device it usually lives at something like:')
  console.error('  /storage/emulated/0/ES-DE/gamelists/')
  console.error('')
  console.error('To hunt for it on this machine:')
  console.error('  find ~ -name gamelist.xml 2>/dev/null | head')
  console.error('')
  console.error(`(searched ${scanStats.dirs} folders under ${searchRoot}, skipping downloaded_media/themes/roms)`)
  process.exit(1)
}

const tagCounts = new Map()      // tag -> how many <game> blocks contain it
const tagExamples = new Map()    // tag -> a short example value
let totalGames = 0
const perSystem = []

for (const file of gamelistFiles) {
  // The system name is the folder the gamelist.xml sits in.
  const sys = file.split('/').slice(-2)[0]

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

  perSystem.push({ sys, file, games: blocks.length, bytes, withPlaycount, withLastplayed, pathShapes: [...pathShapes] })
}

const kb = n => `${(n / 1024).toFixed(0)} KB`

console.log('='.repeat(70))
console.log('ES-DE gamelist inspection')
console.log('='.repeat(70))
console.log(`searched:      ${searchRoot}${searchRoot !== root ? '  (jumped into gamelists/)' : ''}`)
console.log(`folders walked:${String(scanStats.dirs).padStart(7)}`)
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
    const xml = readFileSync(s.file, 'utf8')
    const first = extractGameBlocks(xml)[0]
    console.log(`\n### ${s.sys}\n${first}`)
  }
}

console.log('\nDone. Paste the output above — not the XML files themselves.')
