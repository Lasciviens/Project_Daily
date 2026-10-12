#!/usr/bin/env node
/* Verification — page header art (THEME.md §6.5): where the art sits in its
 * band (src/shared/ui/heroArtRules.ts → heroArtPlace), and that every page
 * but Games draws one, from token colours only.
 * Run: node scripts/verify-hero-art.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const { heroArtPlace, HERO, HERO_ART_VIEWBOX } = require('../src/shared/ui/heroArtRules')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const MIN = 192, GAP = 12

console.log('Placement (heroArtPlace)')
const at = (r, left, right) => r != null && r.left === left && r.right === right
const show = r => JSON.stringify(r)
let r
r = heroArtPlace([0, 1000], [], MIN, GAP)
check('an empty band: the whole band, the art at the right edge', at(r, 0, 0), show(r))
r = heroArtPlace([0, 1000], [[12, 500]], MIN, GAP)
check('tabs on the left, room on the right: right edge, cut after the tabs', at(r, 512, 0), show(r))
r = heroArtPlace([0, 1000], [[12, 400], [860, 988]], MIN, GAP)
check('a button at the right edge: the art ends just left of it', at(r, 412, 1000 - 848), show(r))
r = heroArtPlace([0, 1170], [[12, 262], [700, 1158]], MIN, GAP)
check('Daily: date left, period switcher right → between them', at(r, 274, 1170 - 688), show(r))
r = heroArtPlace([0, 1000], [[12, 100], [500, 780]], MIN, GAP)
check('a free stretch at the right edge wins over a wider one further left', at(r, 792, 0), show(r))
r = heroArtPlace([0, 1000], [[300, 1000]], MIN, GAP)
check('controls on the right half only: the stretch before them, from the band edge', at(r, 0, 1000 - 288), show(r))
check('controls filling the band (a phone): null, the art sits behind them', heroArtPlace([0, 361], [[12, 349]], MIN, GAP) === null)
check('several controls with only narrow gaps: null', heroArtPlace([0, 800], [[0, 150], [300, 450], [600, 800]], MIN, GAP) === null)
r = heroArtPlace([0, 1000], [[0, 600], [600 + MIN + 2 * GAP, 1000]], MIN, GAP)
check('a stretch exactly as wide as needed (air on both sides) counts', at(r, 612, 1000 - (612 + MIN)), show(r))
check('one pixel narrower does not', heroArtPlace([0, 1000], [[0, 600], [600 + MIN + 2 * GAP - 1, 1000]], MIN, GAP) === null)
r = heroArtPlace([0, 1000], [[860, 988], [300, 420], [12, 320], [400, 460]], MIN, GAP)
check('overlapping, unsorted boxes merge', at(r, 472, 1000 - 848), show(r))
r = heroArtPlace([100, 1100], [[-50, 400], [1000, 1300]], MIN, GAP)
check('boxes running past the band are clipped to it', at(r, 312, 1100 - 988), show(r))
r = heroArtPlace([0, 1000], [[1200, 1300], [0, 700]], MIN, GAP)
check('a box wholly outside the band is ignored', at(r, 712, 0), show(r))
r = heroArtPlace([248, 1405], [[260, 760], [1270, 1393]], MIN, GAP)
check('a band offset on the page (sidebar) gives distances from its own edges', at(r, 772 - 248, 1405 - 1258), show(r))
check('distances are never negative', [[[0, 1000], [[0, 300]]], [[0, 500], [[400, 500]]], [[0, 900], [[100, 200], [700, 900]]]].every(([b, x]) => {
  const p = heroArtPlace(b, x, MIN, GAP); return p == null || (p.left >= 0 && p.right >= 0 && p.left + p.right <= b[1] - b[0] - MIN)
}))

console.log('Canvas and colours')
check('the canvas is 640 × 140', HERO_ART_VIEWBOX === '0 0 640 140')
check('motif colours are theme tokens only', Object.values(HERO).every(c => /^(fill|stroke)-(accent-500|fg-muted|surface)$/.test(c)))

console.log('Behind controls the art keeps the faintest text readable (every accent, both themes)')
{
  const repo = path.join(__dirname, '..')
  const css = fs.readFileSync(path.join(repo, 'src/index.css'), 'utf8')
  const block = sel => { const i = css.indexOf(sel + ' {'); return css.slice(i, css.indexOf('}', i)) }
  const tok = (b, name) => b.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`)).slice(1).map(Number)
  const acc = fs.readFileSync(path.join(repo, 'src/shared/theme/accent.ts'), 'utf8')
  const five = key => [...acc.matchAll(new RegExp(`${key}: \\{[^}]*'500':'([\\d ]+)'`, 'g'))].map(m => m[1].split(' ').map(Number))
  const layer = fs.readFileSync(path.join(repo, 'src/shared/ui/PageHeroArt.tsx'), 'utf8')
  const op = layer.match(/behind \? 'opacity-\[([\d.]+)\] dark:opacity-\[([\d.]+)\]'/)
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lum = p => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2])
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const blend = (bg, fg, a) => bg.map((c, i) => c + (fg[i] - c) * a)
  check('the behind opacities are found in PageHeroArt.tsx', !!op)
  for (const [theme, sel, key, a] of [['light', ':root', 'vars', op && Number(op[1])], ['dark', ':root.dark', 'darkVars', op && Number(op[2])]]) {
    const b = block(sel), surface = tok(b, 'cream-50'), muted = tok(b, 'ink-500')
    const accents = five(key)
    const worst = Math.min(...[...accents, muted].map(c => ratio(muted, blend(surface, c, a))))
    check(`${theme}: fg-muted over the art at ${a} keeps ≥ 4.5:1 with all ${accents.length} accents (worst ${worst.toFixed(2)})`, accents.length >= 6 && worst >= 4.5)
  }
}

console.log('Every page but Games has its art')
const root = path.join(__dirname, '..', 'src', 'features')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const PAGES = {
  'daily/pages/DailyPage.tsx': 'DailyHeroArt', 'recipes/pages/RecipesPage.tsx': 'FoodHeroArt', 'shop/pages/ShopPage.tsx': 'ShopHeroArt',
  'media/pages/MediaPage.tsx': 'MediaHeroArt', 'training/pages/TrainingPage.tsx': 'TrainingHeroArt', 'health/pages/HealthPage.tsx': 'HealthHeroArt',
  'wishes/pages/WishesPage.tsx': 'WishesHeroArt', 'books/pages/BooksPage.tsx': 'BooksHeroArt', 'work/pages/WorkPage.tsx': 'WorkHeroArt',
  'projects/pages/ProjectsPage.tsx': 'ProjectsHeroArt', 'developer/pages/DeveloperPage.tsx': 'DeveloperHeroArt', 'settings/pages/SettingsPage.tsx': 'SettingsHeroArt',
}
for (const [file, motif] of Object.entries(PAGES)) {
  check(`${file.split('/')[0]}: the header passes art={<${motif} />}`, read(file).includes(`art={<${motif} />}`))
}
check('home: the art sits in the brief, the first card, placed by useHeroArt', /<PageHeroArt layerRef=\{artLayerRef\} place=\{artPlace\} behind=\{artBehind\}><HomeHeroArt \/><\/PageHeroArt>/.test(read('home/components/DailyBrief.tsx')))
const gamesDir = path.join(root, 'games', 'test-game')
const gamesFiles = []
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) gamesFiles.push(p) } }
walk(gamesDir)
check('games: no header art', gamesFiles.every(f => !/PageHeroArt|PageHeroBand|heroArtRules|art=\{</.test(fs.readFileSync(f, 'utf8'))))

const motifs = fs.readdirSync(root).flatMap(d => {
  const dir = path.join(root, d, 'components')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /HeroArt\.tsx$/.test(f)).map(f => path.join(dir, f)) : []
})
check('13 motifs', motifs.length === 13, `found ${motifs.length}`)
for (const f of motifs) {
  const src = fs.readFileSync(f, 'utf8')
  const name = path.basename(f, '.tsx')
  check(`${name}: colours only through HERO (no literal colours)`, !/#[0-9a-f]{3,8}\b|rgb\(|(fill|stroke)="(?!none)|(fill|stroke)-(gray|slate|amber|red|blue|white|black)/i.test(src))
  check(`${name}: still (no animation, timers or network)`, !/animate|setInterval|setTimeout|fetch\(|<image|href=/.test(src))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
