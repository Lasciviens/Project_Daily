// The first-download budget (docs/platform-shell.md, "Code loading"). Reads the
// production build: what index.html loads before the first paint (the shell:
// its script, modulepreloads and stylesheet), and for each page what it adds
// before it can render (its static imports in dist/.vite/manifest.json). Each
// stays within its budget below, in kB of gzip (JS + CSS), so a page's default
// tab importing a chart library, or the shell a panel, fails here instead of
// quietly reaching every phone. A budget is raised on purpose, in this file,
// with the reason in the commit.
//
//   npm run build && node scripts/verify-bundle-budget.mjs
//   node scripts/verify-bundle-budget.mjs --dist <dir>   another build (built with build.manifest)
//
// Without a build it skips: the "All verify scripts" job doesn't build. The PR
// check's build job runs it with BUNDLE_BUDGET_REQUIRED=1, where a missing or
// incomplete build fails. A build older than src/ is reported, not judged.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distArg = process.argv.indexOf('--dist')
const dist = distArg > 0 ? process.argv[distArg + 1] : join(root, 'dist')
const required = process.env.BUNDLE_BUDGET_REQUIRED === '1'

// kB of gzip. Measured 07.11.2026 (in brackets) with ~5 % room, page by page:
// one shared ceiling let a page take back what was moved out of it (Books' Kobo
// tab +67 kB, Shop's Stats +123 kB) and still pass. A new page gets its own line.
const SHELL_KB = 350                                       // [333] every page pays this first
const PAGE_KB = {                                          // the shell plus the page's own code
  'src/features/home/pages/HomePage.tsx': 565,             // [541]
  'src/features/daily/pages/DailyPage.tsx': 550,           // [527]
  'src/features/recipes/pages/RecipesPage.tsx': 515,       // [494] Food
  'src/features/settings/pages/SettingsPage.tsx': 540,     // [511]
  'src/features/games/test-game/TestGamePage.tsx': 540,    // [514] Games
  'src/features/training/pages/TrainingPage.tsx': 460,     // [439]
  'src/features/health/pages/HealthPage.tsx': 450,         // [429]
  'src/features/developer/pages/DeveloperPage.tsx': 415,   // [392]
  'src/features/media/pages/MediaPage.tsx': 415,           // [392]
  'src/features/shop/pages/ShopPage.tsx': 405,             // [385]
  'src/features/books/pages/BooksPage.tsx': 385,           // [365]
  'src/features/projects/pages/ProjectPage.tsx': 390,      // [370]
  'src/features/work/pages/WorkPage.tsx': 390,             // [370]
  'src/features/wishes/pages/WishesPage.tsx': 370,         // [353]
  'src/features/football/pages/FootballPage.tsx': 365,     // [346]
  'src/features/projects/pages/ProjectsPage.tsx': 365,     // [346]
}

function skip(why) {
  if (required) { console.error(`verify-bundle-budget: ${why}`); process.exit(1) }
  console.log(`verify-bundle-budget: skipped (${why}; run npm run build first)`)
  process.exit(0)
}

const htmlPath = join(dist, 'index.html')
const manifestPath = join(dist, '.vite', 'manifest.json')
if (!existsSync(htmlPath)) skip('no dist/index.html')
if (!existsSync(manifestPath)) skip('no dist/.vite/manifest.json (vite.config.ts build.manifest)')

const newest = dir => readdirSync(dir, { withFileTypes: true }).reduce((t, e) => {
  const p = join(dir, e.name)
  return Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs)
}, 0)
if (!required && distArg < 0 && newest(join(root, 'src')) > statSync(htmlPath).mtimeMs) skip('dist/ is older than src/')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const html = readFileSync(htmlPath, 'utf8')

const gz = new Map()
function gzipKb(file) {
  if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(dist, file))).length / 1000)
  return gz.get(file)
}
const sumKb = files => [...files].reduce((s, f) => s + gzipKb(f), 0)

// What index.html loads before the first paint, as dist-relative paths.
const shell = new Set([...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/Project_Daily\/(assets\/[^"]+\.(?:js|css))"/g)].map(m => m[1]))

// A manifest entry's static closure: its JS and every CSS file on the way.
function closure(key, files = new Set(), seen = new Set()) {
  if (seen.has(key)) return files
  seen.add(key)
  const entry = manifest[key]
  files.add(entry.file)
  for (const css of entry.css ?? []) files.add(css)
  for (const dep of entry.imports ?? []) closure(dep, files, seen)
  return files
}

let passed = 0
const problems = []
function check(name, ok, detail) {
  if (ok) passed++
  else problems.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

// The HTML and the manifest must agree on the shell, or the sums below read the wrong files.
const entryKey = Object.keys(manifest).find(k => manifest[k].isEntry)
check('the manifest has the entry', !!entryKey)
const fromManifest = entryKey ? closure(entryKey) : new Set()
check('index.html loads exactly the entry\'s static imports',
  fromManifest.size === shell.size && [...fromManifest].every(f => shell.has(f)),
  `html ${shell.size} files, manifest ${fromManifest.size}`)

const rows = []
const shellKb = sumKb(shell)
rows.push(['shell (every page)', shellKb, SHELL_KB])
check(`shell ${shellKb.toFixed(0)} kB ≤ ${SHELL_KB} kB`, shellKb <= SHELL_KB)

const pageKeys = Object.keys(manifest).filter(k => /^src\/features\/.+\/(pages\/\w+Page|test-game\/TestGamePage)\.tsx$/.test(k))
for (const key of Object.keys(PAGE_KB)) check(`${key} is still a page of the build`, pageKeys.includes(key))
for (const key of pageKeys) {
  const own = [...closure(key)].filter(f => !shell.has(f))
  const kb = shellKb + sumKb(own)
  const budget = PAGE_KB[key]
  const name = key.replace(/^.*\//, '').replace(/\.tsx$/, '')
  if (budget == null) { check(`${name} has its own budget in PAGE_KB (measured: ${kb.toFixed(0)} kB)`, false); continue }
  rows.push([name, kb, budget])
  check(`${name} ${kb.toFixed(0)} kB ≤ ${budget} kB`, kb <= budget)
}

console.log('verify-bundle-budget: first download, kB of gzip (JS + CSS) / budget')
for (const [name, kb, budget] of rows) {
  console.log(`  ${kb <= budget ? '✓' : '✗'} ${name.padEnd(20)} ${kb.toFixed(0).padStart(4)} / ${budget}`)
}
for (const p of problems) console.log(`  ✗ ${p}`)
console.log(`\n${passed} passed, ${problems.length} failed`)
process.exit(problems.length ? 1 : 0)
