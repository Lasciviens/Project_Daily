#!/usr/bin/env node
// Explore an ES-DE export and report what is ACTUALLY in it — every folder,
// every file type, and the real shape of the data inside the ones that matter.
//
// This is deliberately a general explorer, not a gamelist reader. We do not yet
// know which parts of an ES-DE install are useful to us, so the job here is to
// find out: what exists, how big it is, what format it is in, and what the
// records inside look like. Parsing decisions come after, once this has been
// run against the real thing.
//
// It is READ-ONLY. It never writes, moves, deletes or uploads anything.
//
// USAGE — no arguments needed, it will ask you to pick a folder:
//
//   node scripts/inspect-esde-export.mjs
//
// On macOS that opens a normal "choose folder" dialog. Elsewhere (or if the
// dialog is unavailable) it lists the folders it can see and you type a number.
// You can also skip the picker entirely:
//
//   node scripts/inspect-esde-export.mjs /path/to/ES-DE
//
// Flags:
//   --deep       don't skip the huge media folders (slow; off by default)
//   --full       print longer content samples
//
// OUTPUT IS DESIGNED TO BE PASTED. It samples and summarises rather than
// dumping files, so it stays a few hundred lines even on a large export.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, extname, basename, relative } from 'node:path'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const DEEP = args.includes('--deep')
const FULL = args.includes('--full')
const pathArg = args.find(a => !a.startsWith('--'))

// Folders that are huge and (so far as we know) not interesting. Skipped by
// default so a 15 GB install doesn't take minutes to walk; --deep includes them.
// They are still REPORTED as present, just not descended into.
const HEAVY = new Set(['downloaded_media', 'themes', 'screensavers', 'roms', 'cache'])

// ES-DE writes dated backup copies of gamelists under a CLEANUP folder. They
// are real gamelist.xml files but they are SNAPSHOTS, not the live data —
// sampling one by accident gives a stale and possibly much smaller picture.
const isBackupPath = p => /(^|\/)(CLEANUP|backup|backups)(\/|$)/i.test(p)

const MAX_SAMPLE_BYTES = FULL ? 4000 : 1200
const MAX_FILES_SAMPLED_PER_TYPE = FULL ? 3 : 2

// ─── folder picking ──────────────────────────────────────────────────────────

/** macOS native folder chooser. Returns null if unavailable or cancelled. */
function macChooseFolder() {
  if (process.platform !== 'darwin') return null
  try {
    const out = execSync(
      `osascript -e 'POSIX path of (choose folder with prompt "Pick the ES-DE folder you copied off the device")'`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return out || null
  } catch {
    return null   // user cancelled, or osascript not usable
  }
}

/** Terminal fallback: list candidate folders and let the user type a number. */
async function promptForFolder() {
  const candidates = []
  const home = process.env.HOME || '.'
  for (const base of [process.cwd(), home, join(home, 'Downloads'), join(home, 'Desktop'), join(home, 'Documents')]) {
    if (!existsSync(base)) continue
    try {
      for (const e of readdirSync(base, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.')) candidates.push(join(base, e.name))
      }
    } catch { /* unreadable, skip */ }
  }
  const shortlist = [...new Set(candidates)]
    .filter(p => /es[-_ ]?de|gamelist|retro|emu/i.test(basename(p)))
    .slice(0, 20)

  const list = shortlist.length ? shortlist : [...new Set(candidates)].slice(0, 25)

  console.log('\nPick the folder to inspect:\n')
  list.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${p}`))
  console.log('\n  (or just paste a full path)\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(res => rl.question('> ', res))
  rl.close()

  const n = Number(answer.trim())
  if (Number.isInteger(n) && n >= 1 && n <= list.length) return list[n - 1]
  return answer.trim().replace(/^~/, process.env.HOME || '~')
}

// ─── walking ─────────────────────────────────────────────────────────────────

const tree = []               // { rel, depth, files, bytes, skipped }
const filesByExt = new Map()  // ext -> { count, bytes }
// Sampling is keyed on FILENAME, not extension. An export has dozens of
// identical gamelist.xml files; keying on ".xml" would let them crowd out
// es_settings.xml and every other genuinely different file.
const filesByName = new Map() // basename -> { count, bytes, samples: [paths] }
let totalFiles = 0
let totalBytes = 0
let walkedDirs = 0

function walk(dir, root, depth = 0) {
  if (depth > 8) return
  walkedDirs++
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }

  let files = 0
  let bytes = 0
  const subdirs = []

  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) { subdirs.push(full); continue }
    let sz = 0
    try { sz = statSync(full).size } catch { /* vanished / unreadable */ }
    files++; bytes += sz
    totalFiles++; totalBytes += sz

    const ext = (extname(e.name) || '(no ext)').toLowerCase()
    const er = filesByExt.get(ext) ?? { count: 0, bytes: 0 }
    er.count++; er.bytes += sz
    filesByExt.set(ext, er)

    const nm = e.name.toLowerCase()
    const nr = filesByName.get(nm) ?? { count: 0, bytes: 0, samples: [], allPaths: [] }
    nr.count++; nr.bytes += sz
    nr.allPaths.push(full)
    if (nr.samples.length < MAX_FILES_SAMPLED_PER_TYPE) nr.samples.push(full)
    filesByName.set(nm, nr)
  }

  const rel = relative(root, dir) || '.'
  const isHeavy = HEAVY.has(basename(dir).toLowerCase())
  tree.push({ rel, depth, files, bytes, skipped: isHeavy && !DEEP })

  if (isHeavy && !DEEP) return   // counted its own files, don't descend
  for (const sd of subdirs) walk(sd, root, depth + 1)
}

// ─── content shape inspection ────────────────────────────────────────────────

const TEXTUAL = new Set(['.xml', '.json', '.cfg', '.txt', '.ini', '.log', '.csv', '.md', '.yml', '.yaml', '.sh'])

function readHead(file, bytes = MAX_SAMPLE_BYTES) {
  try {
    const buf = readFileSync(file)
    // crude binary sniff: a NUL byte in the first chunk means not text
    const head = buf.subarray(0, Math.min(buf.length, bytes))
    if (head.includes(0)) return null
    return head.toString('utf8')
  } catch { return null }
}

/** For XML: report the root element and the child-tag inventory of the repeated record. */
function describeXml(file) {
  let xml
  try { xml = readFileSync(file, 'utf8') } catch { return null }

  // Skip the <?xml …?> declaration and any comments before the real root.
  const cleaned = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const rootM = cleaned.match(/<([a-zA-Z][\w:-]*)[\s>/]/)
  const root = rootM ? rootM[1] : '(unknown)'

  // Find the repeated record element: the tag that appears most as <tag>…</tag>
  const counts = new Map()
  for (const m of xml.matchAll(/<([a-zA-Z][\w:-]*)>/g)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const record = ranked.find(([t]) => t !== root)?.[0] ?? null

  const out = { root, record, recordCount: 0, fields: new Map(), sample: null, attrElements: new Map(), paths: [] }

  // Plenty of ES-DE config XML is attribute-based and self-closing, e.g.
  //   <string name="ROMDirectory" value="/storage/…" />
  // That has no repeated <tag>…</tag> record at all, so collect those
  // separately rather than reporting the file as empty.
  for (const m of xml.matchAll(/<([a-zA-Z][\w:-]*)\s+([^>]*?)\/?>/g)) {
    const [, tag, attrs] = m
    if (!attrs.includes('=')) continue
    const rec = out.attrElements.get(tag) ?? { n: 0, example: null }
    rec.n++
    if (!rec.example) {
      const e = `<${tag} ${attrs.trim()}>`
      rec.example = e.length > 100 ? e.slice(0, 100) + '…' : e
    }
    out.attrElements.set(tag, rec)
  }

  if (!record) return out

  const blocks = xml.match(new RegExp(`<${record}\\b[\\s\\S]*?</${record}>`, 'g')) ?? []
  out.recordCount = blocks.length
  out.sample = blocks[0] ?? null

  for (const b of blocks) {
    // Strip the record wrapper first. Scanning the block as-is would match
    // <game>…</game> itself on the very first try and consume everything,
    // leaving no child tags to find.
    const inner = b.replace(new RegExp(`^<${record}\\b[^>]*>`), '').replace(new RegExp(`</${record}>$`), '')
    const seen = new Set()
    for (const m of inner.matchAll(/<([a-zA-Z][\w:-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
      const [, tag, val] = m
      if (tag === record || seen.has(tag)) continue
      seen.add(tag)
      if (tag === 'path') out.paths.push(val.trim())
      const f = out.fields.get(tag) ?? { n: 0, example: null }
      f.n++
      if (!f.example && val.trim()) {
        const v = val.trim().replace(/\s+/g, ' ')
        f.example = v.length > 70 ? v.slice(0, 70) + '…' : v
      }
      out.fields.set(tag, f)
    }
  }
  return out
}

function describeJson(file) {
  const txt = readHead(file, 200_000)
  if (!txt) return null
  try {
    const data = JSON.parse(txt)
    const shape = v =>
      Array.isArray(v) ? `array[${v.length}]`
      : v === null ? 'null'
      : typeof v === 'object' ? `{${Object.keys(v).slice(0, 12).join(', ')}}`
      : typeof v
    return { top: shape(data), keys: typeof data === 'object' && data && !Array.isArray(data) ? Object.keys(data).slice(0, 25) : [] }
  } catch { return null }
}

// ─── main ────────────────────────────────────────────────────────────────────

const root = pathArg ?? macChooseFolder() ?? await promptForFolder()

if (!root || !existsSync(root)) {
  console.error(`\nNot a folder I can read: ${root ?? '(nothing chosen)'}`)
  process.exit(1)
}

console.log(`\nWalking ${root} …${DEEP ? ' (--deep: including media folders)' : ''}`)
const t0 = Date.now()
walk(root, root)
const secs = ((Date.now() - t0) / 1000).toFixed(1)

const mb = n => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`

console.log('\n' + '='.repeat(72))
console.log('ES-DE EXPORT INSPECTION')
console.log('='.repeat(72))
console.log(`root:          ${root}`)
console.log(`walked:        ${walkedDirs} folders in ${secs}s`)
console.log(`files:         ${totalFiles}`)
console.log(`size:          ${mb(totalBytes)}`)
if (!DEEP) console.log(`note:          media/theme folders counted but not descended into (use --deep to include)`)

// ── folder tree ──
console.log('\n' + '─'.repeat(72))
console.log('FOLDERS')
console.log('─'.repeat(72))
for (const t of tree.filter(t => t.depth <= 2).sort((a, b) => a.rel.localeCompare(b.rel))) {
  const indent = '  '.repeat(t.depth)
  const mark = t.skipped ? '  [not descended]' : ''
  console.log(`${indent}${t.rel.padEnd(40 - indent.length)} ${String(t.files).padStart(6)} files  ${mb(t.bytes).padStart(9)}${mark}`)
}
const deeper = tree.filter(t => t.depth > 2).length
if (deeper) console.log(`  … and ${deeper} deeper folders`)

// ── file types ──
console.log('\n' + '─'.repeat(72))
console.log('FILE TYPES')
console.log('─'.repeat(72))
console.log('ext'.padEnd(12), 'count'.padStart(8), 'size'.padStart(11))
for (const [ext, r] of [...filesByExt.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(ext.padEnd(12), String(r.count).padStart(8), mb(r.bytes).padStart(11))
}

console.log('\n' + '─'.repeat(72))
console.log('DISTINCT FILENAMES')
console.log('─'.repeat(72))
console.log('filename'.padEnd(34), 'count'.padStart(8), 'size'.padStart(11))
for (const [nm, r] of [...filesByName.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 40)) {
  console.log(nm.padEnd(34), String(r.count).padStart(8), mb(r.bytes).padStart(11))
}
if (filesByName.size > 40) console.log(`… and ${filesByName.size - 40} more distinct filenames`)

// ── content shapes ──
console.log('\n' + '─'.repeat(72))
console.log('WHAT IS ACTUALLY INSIDE (sampled)')
console.log('─'.repeat(72))

// ── gamelists get special treatment: aggregate ALL of them ──────────────────
// There are typically dozens, one per system. Sampling two tells us very
// little; what we actually need is the union of every field across the whole
// library, with real fill rates. Backups are reported separately so a stale
// snapshot never dilutes the live numbers.
{
  const allGamelists = []
  for (const [nm, r] of filesByName.entries()) {
    if (nm !== 'gamelist.xml') continue
    for (const f of r.allPaths ?? []) allGamelists.push(f)
  }
  const live = allGamelists.filter(f => !isBackupPath(relative(root, f)))
  const backups = allGamelists.filter(f => isBackupPath(relative(root, f)))

  if (live.length) {
    console.log('\n' + '─'.repeat(72))
    console.log(`GAMELISTS — aggregated across all ${live.length} live files`)
    if (backups.length) console.log(`(${backups.length} more found under CLEANUP/backup folders — excluded here)`)
    console.log('─'.repeat(72))

    const fieldTotals = new Map()
    let grandTotal = 0
    const perSystem = []
    const pathOddities = new Map()

    for (const f of live) {
      const d = describeXml(f)
      if (!d) continue
      const sys = relative(root, f).split('/').slice(-2)[0]
      perSystem.push({ sys, games: d.recordCount })
      grandTotal += d.recordCount
      for (const [tag, info] of d.fields.entries()) {
        const t = fieldTotals.get(tag) ?? { n: 0, example: null }
        t.n += info.n
        if (!t.example) t.example = info.example
        fieldTotals.set(tag, t)
      }
      // Flag path shapes that will matter when matching ROMs later.
      for (const pth of d.paths ?? []) {
        const base = pth.split('/').pop() ?? ''
        let kind = null
        if (base.startsWith('._')) kind = 'macOS AppleDouble sidecar (._x) — NOT a real ROM'
        else if (!base.includes('.')) kind = 'no file extension (folder-based game?)'
        if (kind) pathOddities.set(kind, (pathOddities.get(kind) ?? 0) + 1)
      }
    }

    console.log(`\ngames across all systems: ${grandTotal}\n`)
    console.log('system'.padEnd(20), 'games'.padStart(7))
    for (const s2 of perSystem.sort((a, b) => b.games - a.games)) {
      console.log(s2.sys.padEnd(20), String(s2.games).padStart(7))
    }

    console.log(`\nfields across all ${grandTotal} games:`)
    for (const [tag, t] of [...fieldTotals.entries()].sort((a, b) => b[1].n - a[1].n)) {
      const pct = grandTotal ? ((t.n / grandTotal) * 100).toFixed(0) : '0'
      console.log(`  ${tag.padEnd(16)} ${String(t.n).padStart(6)}  ${pct.padStart(3)}%   e.g. ${t.example ?? ''}`)
    }

    if (pathOddities.size) {
      console.log('\n  ⚠ path oddities worth knowing before matching ROMs:')
      for (const [k, n] of pathOddities) console.log(`     ${String(n).padStart(5)} × ${k}`)
    }
  }
}

// One sample per DISTINCT FILENAME, so every different kind of file gets seen.
for (const [nm, r] of [...filesByName.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const ext = (extname(nm) || '(no ext)').toLowerCase()
  if (!TEXTUAL.has(ext)) continue

  const preferred = (r.allPaths ?? r.samples).filter(f => !isBackupPath(relative(root, f)))
  const toSample = (preferred.length ? preferred : r.samples).slice(0, MAX_FILES_SAMPLED_PER_TYPE)
  for (const file of toSample) {
    const dup = r.count > 1 ? `   [1 of ${r.count} files named ${nm}]` : ''
    console.log(`\n### ${relative(root, file)}   (${mb(statSync(file).size)})${dup}`)

    if (ext === '.xml') {
      const d = describeXml(file)
      if (!d) { console.log('   (unreadable)'); continue }
      console.log(`   root element : <${d.root}>`)
      console.log(`   record       : <${d.record}>  ×${d.recordCount}`)
      if (d.fields.size) {
        console.log(`   fields present across those ${d.recordCount} records:`)
        for (const [tag, f] of [...d.fields.entries()].sort((a, b) => b[1].n - a[1].n)) {
          const pct = d.recordCount ? ((f.n / d.recordCount) * 100).toFixed(0) : '0'
          console.log(`     ${tag.padEnd(18)} ${String(f.n).padStart(6)}  ${pct.padStart(3)}%   e.g. ${f.example ?? ''}`)
        }
      }
      if (d.sample) {
        const s = d.sample.length > MAX_SAMPLE_BYTES ? d.sample.slice(0, MAX_SAMPLE_BYTES) + '\n   …(truncated)' : d.sample
        console.log('   first record verbatim:')
        console.log(s.split('\n').map(l => '     ' + l).join('\n'))
      }

      if (d.attrElements.size) {
        console.log('   attribute-style elements:')
        for (const [tag, a] of [...d.attrElements.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 20)) {
          console.log(`     <${tag}>`.padEnd(20) + `${String(a.n).padStart(5)}×   e.g. ${a.example}`)
        }
      }

      // No repeated record AND no attribute elements → show the raw head so
      // the file is never reported as simply empty.
      if (!d.recordCount && !d.attrElements.size) {
        const head = readHead(file)
        if (head) console.log(head.split('\n').slice(0, 12).map(l => '     ' + l).join('\n'))
      }
      continue
    }

    if (ext === '.json') {
      const d = describeJson(file)
      if (d) {
        console.log(`   top level : ${d.top}`)
        if (d.keys.length) console.log(`   keys      : ${d.keys.join(', ')}`)
        continue
      }
    }

    const txt = readHead(file)
    if (txt === null) { console.log('   (binary or unreadable)'); continue }
    const lines = txt.split('\n').slice(0, FULL ? 40 : 15)
    console.log(lines.map(l => '     ' + (l.length > 110 ? l.slice(0, 110) + '…' : l)).join('\n'))
    if (txt.split('\n').length > lines.length) console.log('     …(truncated)')
  }
}

console.log('\n' + '='.repeat(72))
console.log('Done. Paste this output — not the files themselves.')
console.log('If something looks worth seeing in full, re-run with --full.')
console.log('='.repeat(72))
