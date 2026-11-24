#!/usr/bin/env node
/*
 * Verification — previous / next buttons on everything that scrolls sideways
 * (owner, 24.11.2026: "its not possible to click on next to go to next page in
 * the widget … not on pc if you dont have horizontal scroll mouse").
 *
 * 1. The rules (scrollPagerRules.ts): which ways a track can still go, how far a press moves it.
 * 2. ScrollPager: the buttons show on a mouse or trackpad only (touch keeps its swipe), have
 *    names, answer ←/→, never pass a click to the tile under them, and the glance chevrons
 *    are no taller than the 16px line they sit on (a glance tile keeps its height).
 * 3. Every glance tile goes through GlanceCarousel, which uses the paged inline pager.
 * 4. Every sideways strip whose bar is hidden is a PagedStrip (or the glance track) —
 *    a new `overflow-x-auto` + `scrollbar-none` elsewhere fails here. The Games page's own
 *    `tg-scroll-x` rows are outside this check (its own look; its screenshot strip has
 *    `tg-chevron-btn`; the filter rows are listed in the PR's To do later).
 *
 *   Run:  node scripts/verify-scroll-pager.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const R = require('../src/shared/ui/scrollPagerRules.ts')

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}
const ROOT = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

console.log('1 · the rules')
{
  const e = (l, w, sw) => JSON.stringify(R.scrollEdges(l, w, sw))
  check('at the start: only forward', e(0, 300, 900) === '{"back":false,"forward":true}', e(0, 300, 900))
  check('in the middle: both ways', e(300, 300, 900) === '{"back":true,"forward":true}')
  check('at the end: only back', e(600, 300, 900) === '{"back":true,"forward":false}')
  check('a fractional end (599.5) counts as the end', e(599.5, 300, 900) === '{"back":true,"forward":false}')
  check('nothing to scroll: no buttons', e(0, 300, 300) === '{"back":false,"forward":false}')
  check('a paged track moves one whole screen', R.pageStep(170, true) === 170)
  check('a strip moves 80 % of its view, so the cut card stays in sight', R.pageStep(500, false) === 400)
  check('a strip never moves 0', R.pageStep(0, false) === 1)
}

console.log('\n2 · ScrollPager')
const pager = read('src/shared/ui/ScrollPager.tsx')
{
  const buttons = pager.match(/<button[\s\S]*?>/g) || []
  check('four buttons (inline and overlay, previous and next)', buttons.length === 4, buttons.length)
  check('each is hidden on touch ([@media(pointer:coarse)]:hidden): touch keeps its swipe', buttons.every(b => b.includes('[@media(pointer:coarse)]:hidden')))
  check('each has a name and a title ("Previous …" / "Next …")', buttons.every(b => b.includes('aria-label={') && b.includes('title={')) && /`Previous \$\{noun\}`/.test(pager) && /`Next \$\{noun\}`/.test(pager))
  check('each answers ←/→', buttons.every(b => b.includes('onKeyDown={onKeyDown}')) && /ArrowRight[\s\S]*ArrowLeft/.test(pager))
  check('a dimmed button is aria-disabled, never disabled (a disabled button\'s click reaches the tile)', !/\sdisabled=\{/.test(pager) && (pager.match(/aria-disabled=\{/g) || []).length === 2)
  check('a press stops at the button (never the tile\'s tap)', /e\.stopPropagation\(\)/.test(pager))
  const inline = (pager.match(/const INLINE_BTN = '([^']+)'/) || [])[1] || ''
  check('the glance chevrons are 16px (h-4): the tile keeps its height', /\bh-4\b/.test(inline) && !/\bh-[5-9]\b/.test(inline), inline)
  check('the overlay buttons show only while there is more that way', /\{edges\.back && \(/.test(pager) && /\{edges\.forward && \(/.test(pager))
  check('reduced motion moves without the smooth scroll', /behavior: reduced \? 'auto' : 'smooth'/.test(pager))
  check('it follows scrolling, resizing and new children', /ResizeObserver/.test(pager) && /MutationObserver/.test(pager) && /addEventListener\('scroll'/.test(pager))
  // Through the barrel it joined the `ui` chunk every page loads first (+1 kB gzip on each, over
  // Work's and Settings' budgets); imported by its path, only the pages that use it load it.
  check('imported by its own path, never through the shared/ui barrel', !/ScrollPager/.test(read('src/shared/ui/index.ts')))
}

console.log('\n3 · the glance tiles')
{
  const carousel = read('src/features/home/components/GlanceCarousel.tsx')
  check('GlanceCarousel uses the paged inline pager on its own track', /<ScrollPager track=\{track\} noun="screen" paged placement="inline">/.test(carousel))
  check('the dots stay inside it (‹ ••• ›)', /placement="inline">\s*<span aria-hidden className="flex shrink-0 gap-1">/.test(carousel))
  check('the header keeps ←/→', /onKeyDown=\{onKeyDown\}/.test(carousel))
  for (const f of ['WeatherWidget', 'CurrencyWidget', 'RecentMediaWidget', 'BooksHomeWidget', 'GamesHomeWidget', 'TrainingHomeWidget']) {
    check(`${f} draws a GlanceCarousel`, read(`src/features/home/components/${f}.tsx`).includes('<GlanceCarousel'))
  }
}

console.log('\n4 · every hidden-bar strip has the buttons')
{
  // Strips that go through PagedStrip (owner, 24.11.2026: same job, same features).
  const STRIPS = {
    'src/features/games/components/SteamTab.tsx': 'noun="games"',
    'src/features/games/components/PlayStationTab.tsx': 'noun="games"',
    'src/features/games/components/SteamGameModal.tsx': 'noun="screenshots"',
    'src/features/games/components/PsnTrophyPanel.tsx': 'noun="trophy groups"',
    'src/features/daily/components/summary/FootballCard.tsx': 'noun="teams"',
  }
  for (const [f, noun] of Object.entries(STRIPS)) check(`${path.basename(f)}: a PagedStrip (${noun})`, read(f).includes(`<PagedStrip ${noun}`))
  // A sideways track with its bar hidden is allowed only here, each with its reason.
  const ALLOWED = {
    'src/shared/ui/ScrollPager.tsx': 'PagedStrip itself',
    'src/features/home/components/GlanceCarousel.tsx': 'the glance track, with ScrollPager inline',
    'src/features/daily/pages/DailyPage.tsx': 'a page-header SegmentedControl sized to fit from sm up; never a strip',
  }
  const files = []
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.tsx$/.test(e.name)) files.push(p) } }
  walk('src')
  const offenders = files.filter(f => !ALLOWED[f]).filter(f => {
    const classes = read(f).match(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g) || []
    return classes.some(c => /\boverflow-x-auto\b/.test(c) && /\bscrollbar-none\b/.test(c))
  })
  check('no other sideways track hides its bar without the buttons', offenders.length === 0, offenders)
  check('the allow-list is still needed (each file still has such a track)', Object.keys(ALLOWED).every(f => /scrollbar-none/.test(read(f))))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
