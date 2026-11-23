#!/usr/bin/env node
// Builds the app's own documentation into the `claude` function as knowledge for Ask AI's `search_docs`
// (supabase/claude-src/docs-snapshot.ts, then joined into supabase/functions/claude/index.ts by build-claude-function).
//
// What goes in: ONLY the allow-list below (docs/features and docs/integrations pages that describe what the app does).
// Never AGENTS.md, CLAUDE.md, anything under .claude/ or docs/coord/ (instructions for coding agents), never a GitHub
// issue, a pull request or a live page. Each page has its HTML comments and every hidden Unicode character removed
// (zero-width, text direction, tag characters, other invisibles; again and again until nothing changes), then is cut into
// sections at its headings. The commit and a hash of the content are recorded.
//
// The repo keeps an EMPTY copy (so a docs change never makes every pull request rebuild the function); the deploy builds
// the real one from the merged commit, just before the edge functions are deployed (deploy.yml).
//
//   node scripts/build-docs-snapshot.mjs --write --commit <sha>   # the deploy: write the real snapshot
//   node scripts/build-docs-snapshot.mjs --summary                # what would go in: files, sections, size, hash
//   node scripts/build-docs-snapshot.mjs --placeholder            # write the empty copy the repo keeps

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SNAPSHOT_FILE = 'supabase/claude-src/docs-snapshot.ts'

// The allow-list. A page that is a plan, a contract or a decision record is left out: it says what was planned, not what
// the app does.
export const DOCS_ALLOW = [
  'docs/features/README.md', 'docs/features/ai.md', 'docs/features/books.md', 'docs/features/daily.md', 'docs/features/delete-undo.md',
  'docs/features/dev-requests.md', 'docs/features/developer.md', 'docs/features/food.md', 'docs/features/football.md', 'docs/features/games.md',
  'docs/features/health.md', 'docs/features/home.md', 'docs/features/iphone.md', 'docs/features/media.md', 'docs/features/planning-calendar.md',
  'docs/features/projects.md', 'docs/features/settings.md', 'docs/features/shop.md', 'docs/features/supplements.md', 'docs/features/tasks.md',
  'docs/features/training.md', 'docs/features/wishes.md', 'docs/features/work.md',
  'docs/integrations/README.md', 'docs/integrations/anthropic.md', 'docs/integrations/entur.md', 'docs/integrations/espn.md',
  'docs/integrations/google-calendar.md', 'docs/integrations/google-tasks.md', 'docs/integrations/hevy.md', 'docs/integrations/icloud-caldav.md',
  'docs/integrations/kassalapp.md', 'docs/integrations/norges-bank.md', 'docs/integrations/open-food-facts.md', 'docs/integrations/prisjakt.md',
  'docs/integrations/tmdb.md', 'docs/integrations/trakt.md',
]
// Never, whatever the list says (a guard behind the list).
const NEVER = /(^|\/)(AGENTS\.md|CLAUDE\.md)$|(^|\/)\.claude\/|^docs\/coord\//

// The same characters as learn-text.ts's LEARN_HIDDEN and LEARN_CONTROL (verify-ai-learning-docs compares them).
export const DOCS_HIDDEN = /\p{Cf}|\p{Cs}|\p{Co}|[\u{115F}\u{1160}\u{17B4}\u{17B5}\u{180B}-\u{180F}\u{3164}\u{FE00}-\u{FE0F}\u{FFA0}\u{E0100}-\u{E01EF}]/gu
// eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
export const DOCS_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g

// What a reader of the rendered page never sees, so a model must not either: HTML comments, Markdown's reference lines
// (`[//]: # (…)`, `[label]: target`, the comment idiom among them) and raw HTML tags (their words stay, the tags go).
const DOCS_COMMENT = /<!--[\s\S]*?(-->|$)/g
const DOCS_REFERENCE = /^[ \t]{0,3}\[[^\]\n]*\]:[^\n]*$/gm
const DOCS_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*)?\/?>/g

export function cleanDocText(text) {
  let now = text
  for (let i = 0; i < 10; i++) {
    const next = now.normalize('NFKC').replace(DOCS_HIDDEN, '').replace(DOCS_CONTROL, '').replace(DOCS_COMMENT, '').replace(DOCS_REFERENCE, '').replace(DOCS_TAG, '')
    if (next === now) return next
    now = next
  }
  return ''
}

const SECTION_CHARS = 2400

/** A page cut into sections at its headings; a long section is cut again at blank lines. */
export function sectionsOf(file, text) {
  const out = []
  let heading = file.replace(/^docs\//, '')
  let lines = []
  const flush = () => {
    const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    lines = []
    if (!body) return
    const parts = []
    let piece = ''
    // A paragraph longer than a section (a long table) is cut at its lines.
    const paras = body.split(/\n\n/).flatMap(p => (p.length <= SECTION_CHARS ? [p] : p.split('\n')))
    for (const para of paras) {
      if (piece && piece.length + para.length + 2 > SECTION_CHARS) { parts.push(piece); piece = '' }
      piece = piece ? `${piece}\n\n${para}` : para
    }
    if (piece) parts.push(piece)
    parts.forEach((p, i) => out.push({ file, heading: parts.length > 1 ? `${heading} (${i + 1})` : heading, text: p.slice(0, SECTION_CHARS * 2) }))
  }
  for (const line of text.split('\n')) {
    const h = /^(#{1,4})\s+(.+?)\s*$/.exec(line)
    if (h) { flush(); heading = h[2].replace(/[`*_]/g, '').slice(0, 160); continue }
    lines.push(line)
  }
  flush()
  return out
}

export function buildSnapshot(commit = 'working tree') {
  const sections = []
  for (const file of DOCS_ALLOW) {
    if (NEVER.test(file)) throw new Error(`${file} may never be in the docs snapshot`)
    const path = join(root, file)
    if (!existsSync(path)) throw new Error(`${file} is in the allow-list but does not exist: change the list in scripts/build-docs-snapshot.mjs`)
    sections.push(...sectionsOf(file, cleanDocText(readFileSync(path, 'utf8'))))
  }
  const hash = createHash('sha256').update(JSON.stringify(sections)).digest('hex')
  return { commit, hash, sections }
}

const HEADER = `// GENERATED by scripts/build-docs-snapshot.mjs: never edit by hand.
// The app's own documentation as knowledge for Ask AI's \`search_docs\`: an allow-list of docs/features and
// docs/integrations, hidden Unicode and HTML comments stripped, cut into sections. The repo keeps this empty copy; the
// deploy builds the real one from the merged commit (deploy.yml, "App docs for the claude function") and stamps the
// commit and the content hash. verify-ai-learning-docs fails when a committed copy is stale.

export interface DocSection { file: string; heading: string; text: string }
`

export function snapshotSource(snapshot) {
  if (!snapshot.sections.length) {
    return `${HEADER}\nexport const DOCS_SNAPSHOT: { commit: string; hash: string; sections: readonly DocSection[] } = {\n  commit: 'not built',\n  hash: '',\n  sections: [],\n}\n`
  }
  // A docs text may quote code ("import(…)", "require(…)"): its bracket is written as ( so the function's build,
  // which refuses such a call in a part, reads it as text. The string's value is the same.
  const rows = snapshot.sections.map(s => `    ${JSON.stringify(s).replace(/\b(import|require)(\s*)\(/g, '$1$2\\u0028')},`).join('\n')
  return `${HEADER}\nexport const DOCS_SNAPSHOT: { commit: string; hash: string; sections: readonly DocSection[] } = {\n  commit: ${JSON.stringify(snapshot.commit)},\n  hash: ${JSON.stringify(snapshot.hash)},\n  sections: [\n${rows}\n  ],\n}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.includes('--placeholder')) {
    writeFileSync(join(root, SNAPSHOT_FILE), snapshotSource({ commit: 'not built', hash: '', sections: [] }))
    console.log(`build-docs-snapshot: wrote the empty copy to ${SNAPSHOT_FILE}`)
  } else if (args.includes('--write')) {
    const at = args.indexOf('--commit')
    const commit = at >= 0 ? args[at + 1] : ''
    if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) { console.error('build-docs-snapshot: --write needs --commit <the merged commit sha>'); process.exit(1) }
    const snapshot = buildSnapshot(commit)
    writeFileSync(join(root, SNAPSHOT_FILE), snapshotSource(snapshot))
    console.log(`build-docs-snapshot: ${snapshot.sections.length} sections from ${DOCS_ALLOW.length} pages at ${commit.slice(0, 12)}, hash ${snapshot.hash.slice(0, 12)}`)
  } else {
    const snapshot = buildSnapshot()
    const chars = snapshot.sections.reduce((n, s) => n + s.text.length, 0)
    console.log(`build-docs-snapshot: ${DOCS_ALLOW.length} pages, ${snapshot.sections.length} sections, ${Math.round(chars / 1024)} KB, hash ${snapshot.hash.slice(0, 12)}`)
  }
}
