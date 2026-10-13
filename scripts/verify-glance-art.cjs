#!/usr/bin/env node
/* Verification — Home's glance tile corner art (THEME.md §6.5, owner
 * 13.10.2026): every tile draws its motif, in the band above the tile's
 * first line (so it never sits under text and adds no height), from token
 * colours only, still, and dimmed like the page header art.
 * Run: node scripts/verify-glance-art.cjs */
const fs = require('fs')
const path = require('path')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const repo = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(repo, f), 'utf8')
const HOME = 'src/features/home/components/'
const layer = read(HOME + 'GlanceArt.tsx')
const motifs = read(HOME + 'glanceMotifs.tsx')
const carousel = read(HOME + 'GlanceCarousel.tsx')
const svgClass = (layer.match(/<svg[\s\S]*?className="([^"]+)"/) || [])[1] || ''

console.log('Every tile has its art')
const TILES = {
  'WeatherWidget.tsx': 'WeatherGlanceArt', 'CurrencyWidget.tsx': 'MoneyGlanceArt', 'TrainingHomeWidget.tsx': 'TrainingGlanceArt',
  'RecentMediaWidget.tsx': 'WatchedGlanceArt', 'BooksHomeWidget.tsx': 'BooksGlanceArt', 'GamesHomeWidget.tsx': 'GamesGlanceArt',
}
for (const [file, motif] of Object.entries(TILES)) {
  check(`${file}: the tile passes art={<${motif} />}`, read(HOME + file).includes(`art={<${motif} />}`))
  check(`${motif} is drawn in glanceMotifs.tsx`, motifs.includes(`export function ${motif}()`))
}
check('no motif is left unused', (motifs.match(/export function \w+GlanceArt\(\)/g) || []).length === Object.keys(TILES).length)
check('GlanceCarousel renders the art layer behind its content', carousel.includes('{art != null && <GlanceArt>{art}</GlanceArt>}'))
check('the tile card hosts the layer (relative isolate)', /className="card-interactive glance-card relative isolate /.test(carousel))

console.log('Never under text, no extra height')
const rem = cls => {
  const m = carousel.match(cls)
  return m ? Number(m[1]) : NaN
}
// The tile's first line starts below its top padding, the header row and the track's top margin.
const pad = rem(/glance-card[^"]*\bp-(\d+(?:\.\d+)?)\b/) / 4            // p-3.5 → 0.875rem
const header = rem(/min-h-\[(\d+)px\] w-full min-w-0 items-center/) / 16 // the header row, 28px
const gap = rem(/scrollbar-none relative -mx-3\.5 mt-(\d+(?:\.\d+)?)/) / 4 // mt-1 → 0.25rem
const firstLine = pad + header + gap
const artHeight = Number((svgClass.match(/\bh-(\d+)\b/) || [])[1]) / 4   // h-11 → 2.75rem
check(`the tile's first line starts at ${firstLine}rem (padding, header, gap found)`, firstLine > 2.5 && firstLine < 3.5, `${pad} ${header} ${gap}`)
check(`the art band (${artHeight}rem) ends above it`, artHeight > 0 && artHeight <= firstLine)
check('the art sits in the top-right corner', /\babsolute right-0 top-0\b/.test(svgClass))
check('the layer covers the tile and clips to its corners, behind its content', /pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-\[inherit\]/.test(layer))
check('the canvas keeps its right side (the subject) when the band is narrow', layer.includes('preserveAspectRatio="xMaxYMid slice"'))
// At most a third of the tile wide: on the narrowest tile (a 360px phone, two
// tiles: (360 − 2·16 − 12) / 2 = 158px) it starts right of the longest label,
// TRAINING, whose glyphs end at 97px there (measured in Chromium, 13.10.2026).
const width = svgClass.match(/\bw-\[min\((\d+(?:\.\d+)?)rem,(\d+)%\)\]/)
check('the band is at most 6rem and a third of the tile wide', !!width && Number(width[1]) <= 6 && Number(width[2]) <= 34)
check('on the narrowest tile the band starts right of the longest label', !!width && 158 * (1 - Number(width[2]) / 100) >= 97 + 6)
check('the art fades in over its left 40 %', svgClass.includes('[mask-image:linear-gradient(to_right,transparent,black_40%)]'))

console.log('Looks like the page header art')
const hero = read('src/shared/ui/PageHeroArt.tsx').match(/: '(opacity-\[[\d.]+\] dark:opacity-\[[\d.]+\])'/)
const classes = svgClass.split(' ')
const tileOpacity = `${classes.find(c => /^opacity-\[/.test(c))} ${classes.find(c => /^dark:opacity-\[/.test(c))}`
check('dimmed like the header art in free space (0.22 light / 0.26 dark)', !!hero && hero[1] === tileOpacity, `${hero && hero[1]} vs ${tileOpacity}`)
check('aria-hidden, not focusable, no pointer events', /aria-hidden/.test(layer) && /focusable="false"/.test(layer) && /pointer-events-none/.test(layer))
check('motif colours only through HERO (no literal colours)', !/#[0-9a-f]{3,8}\b|rgb\(|(fill|stroke)="(?!none)|(fill|stroke)-(gray|slate|amber|red|blue|white|black)/i.test(motifs + layer))
check('motifs use the HERO classes', /HERO\.(accent|muted|hole)/.test(motifs) && motifs.includes("from '../../../shared/ui'"))
check('still (no animation, timers or network)', !/animate|setInterval|setTimeout|fetch\(|<image|href=/.test(motifs + layer))
check('the canvas is 192 × 88 (half size: 6rem × 2.75rem)', layer.includes("'0 0 192 88'") && artHeight === 88 / 2 / 16)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
