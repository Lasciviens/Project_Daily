// Fails when two tracked files in one folder have names that differ only in
// letter case — `TgDetailFields.tsx` beside `tgDetailFields.ts`, or `Notes.md`
// beside `notes.md`. The Mac's disk ignores case, so an import without its
// ending (`./TgDetailFields`) found the lower-case `.ts` file there and broke
// `npx tsc` and `npm run build`, while CI on Linux passed (owner, 14.10.2026;
// six pairs renamed 18.10.2026). Two names that are the same apart from the
// ending, in the same case (`foo.ts` + `foo.test.ts`), are fine.
//   node scripts/verify-file-case.mjs
import { execFileSync } from 'node:child_process'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean)

// A file's name without its endings: `TgDetailFields.tsx` → `TgDetailFields`, `x.d.ts` → `x`.
const stem = name => name.replace(/^(\.?[^.]+).*$/, '$1')

const byKey = new Map()
for (const f of files) {
  const dir = posix.dirname(f)
  const name = posix.basename(f)
  const key = `${dir.toLowerCase()}/${stem(name).toLowerCase()}`
  const list = byKey.get(key) ?? []
  list.push(f)
  byKey.set(key, list)
}

const clashes = []
for (const list of byKey.values()) {
  if (list.length < 2) continue
  const spellings = new Set(list.map(f => `${posix.dirname(f)}/${stem(posix.basename(f))}`))
  if (spellings.size > 1) clashes.push(list.sort())
}

// Self-check: the rule must catch the pair that broke the Mac build and leave alone what is fine.
const probe = names => {
  const m = new Map()
  for (const n of names) { const k = stem(n).toLowerCase(); m.set(k, [...(m.get(k) ?? []), stem(n)]) }
  return [...m.values()].some(v => new Set(v).size > 1)
}
const selfOk = probe(['TgDetailFields.tsx', 'tgDetailFields.ts']) && probe(['Notes.md', 'notes.md'])
  && !probe(['foo.ts', 'foo.test.ts']) && !probe(['DateNav.tsx', 'dateNavModel.ts'])

if (!selfOk) {
  console.error('verify-file-case: the rule itself is broken (self-check failed)')
  process.exit(1)
}
if (clashes.length) {
  console.error('verify-file-case: file names that differ only in letter case (the Mac picks the wrong one):')
  for (const c of clashes) console.error('  ' + c.join('  ·  '))
  console.error('Rename one of each pair (e.g. the logic file gets a "Model" ending) and update its imports.')
  process.exit(1)
}
console.log(`verify-file-case: ${files.length} files, no two names in one folder differ only in letter case`)
