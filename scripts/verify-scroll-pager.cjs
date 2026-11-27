#!/usr/bin/env node
/*
 * Verification — previous / next buttons on everything that scrolls sideways
 * (owner, 24.11.2026: "its not possible to click on next to go to next page in
 * the widget … not on pc if you dont have horizontal scroll mouse").
 *
 * 1. The rules (scrollPagerRules.ts): which ways a track can still go, how far a press moves it.
 * 2. ScrollPager: the buttons show on a mouse or trackpad only (touch keeps its swipe), have
 *    names, answer ←/→, never pass a click to the tile under them, stay mounted at an end
 *    (aria-disabled, invisible: the focus is never lost), and the glance chevrons are no
 *    taller than the 16px line they sit on (a glance tile keeps its height). The Games look
 *    is the page's own `tg-chevron-btn`.
 * 3. Every glance tile goes through GlanceCarousel, which uses the paged inline pager.
 * 4. Every strip of cards or pictures is a PagedStrip; every row that hides its bar
 *    (`overflow-x-auto` with `scrollbar-none` or `[scrollbar-width:none]`, or the Games
 *    page's `tg-scroll-x`) is a PagedStrip — in a className or a const alike — and every
 *    `.scroll-x` row (a thin bar with a mouse) is a chip or tab row on the list below.
 *    A new one fails here until it is decided.
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
  check('at the start: only right', e(0, 300, 900) === '{"left":false,"right":true}', e(0, 300, 900))
  check('in the middle: both ways', e(300, 300, 900) === '{"left":true,"right":true}')
  check('at the end: only left', e(600, 300, 900) === '{"left":true,"right":false}')
  check('a fractional end (599.5) counts as the end', e(599.5, 300, 900) === '{"left":true,"right":false}')
  check('nothing to scroll: neither', e(0, 300, 300) === '{"left":false,"right":false}')
  check('a paged track moves one whole screen', R.pageStep(170, true) === 170)
  check('a strip moves 80 % of its view, so the cut card stays in sight', R.pageStep(500, false) === 400)
  check('a strip never moves 0', R.pageStep(0, false) === 1)
}

console.log('\n2 · ScrollPager')
const pager = read('src/shared/ui/ScrollPager.tsx')
{
  const hook = read('src/shared/hooks/useScrollEdges.ts')
  check('one edge hook: ScrollPager uses shared/hooks/useScrollEdges, which uses the rules', /import \{ useScrollEdges \} from '\.\.\/hooks\/useScrollEdges'/.test(pager) && /scrollEdges\(el\.scrollLeft, el\.clientWidth, el\.scrollWidth\)/.test(hook) && !/function useScrollEdges/.test(pager))
  check('the hook follows scrolling, resizing, each child and new children', /ResizeObserver/.test(hook) && /MutationObserver/.test(hook) && /el\.children/.test(hook) && /addEventListener\('scroll'/.test(hook))
  const buttons = pager.match(/<button[\s\S]*?>/g) || []
  check('four buttons (inline and overlay, previous and next)', buttons.length === 4, buttons.length)
  check('each has a name and a title ("Previous …" / "Next …")', buttons.every(b => b.includes('aria-label={') && b.includes('title={')) && /`Previous \$\{noun\}`/.test(pager) && /`Next \$\{noun\}`/.test(pager))
  check('each answers ←/→', buttons.every(b => b.includes('onKeyDown={onKeyDown}')) && /ArrowRight[\s\S]*ArrowLeft/.test(pager))
  check('each is aria-disabled at its end, never disabled (a disabled button\'s click reaches the tile)', !/\sdisabled=\{/.test(pager) && buttons.every(b => /aria-disabled=\{!edges\.(left|right)\}/.test(b)))
  check('the overlay buttons stay mounted at an end (a focused one keeps the focus), out of the Tab order', !/\{edges\.(left|right) && \(/.test(pager) && (pager.match(/tabIndex=\{edges\.(left|right) \? 0 : -1\}/g) || []).length === 2)
  check('a press stops at the button (never the tile\'s tap)', /e\.stopPropagation\(\)/.test(pager))
  const inline = (pager.match(/const INLINE_BTN = '([^']+)'/) || [])[1] || ''
  check('the glance chevrons are 16px tall and 14px wide (h-4 w-3.5): the tile keeps its height', /\bh-4\b/.test(inline) && /\bw-3\.5\b/.test(inline) && !/\bh-[5-9]\b/.test(inline), inline)
  const overlay = (pager.match(/const OVERLAY_BTN = '([^']+)'/) || [])[1] || ''
  check('an app overlay button at an end is invisible and lets clicks through', /aria-disabled:opacity-0/.test(overlay) && /aria-disabled:pointer-events-none/.test(overlay))
  check('touch keeps its swipe: the app buttons hide on a coarse pointer', /const TOUCH_HIDDEN = '\[@media\(pointer:coarse\)\]:hidden'/.test(pager) && (pager.match(/TOUCH_HIDDEN\)/g) || []).length === 2 && /cx\(OVERLAY_BTN, TOUCH_HIDDEN/.test(pager))
  const css = read('src/features/games/test-game/testGame.css')
  check('the Games look is the page\'s own chevron (tg-chevron-btn), hidden on touch, invisible at an end', /'tg-chevron-btn tg-pager-btn'/.test(pager)
    && /@media \(pointer: coarse\) \{ \.tg-pager-btn \{ display: none; \} \}/.test(css)
    && /\.tg-pager-btn\[aria-disabled="true"\] \{ opacity: 0; pointer-events: none; \}/.test(css)
    && css.indexOf('.tg-pager-btn[aria-disabled') > css.indexOf('.tg-chevron-btn {'))
  check('the Games look scrolls on the page\'s own tg-scroll-x', /look === 'games' \? 'tg-scroll-x'/.test(pager))
  check('reduced motion moves without the smooth scroll', /behavior: reduced \? 'auto' : 'smooth'/.test(pager))
  // Through the barrel it joined the `ui` chunk every page loads first (+1 kB gzip on each, over
  // Work's and Settings' budgets); imported by its path, only the pages that use it load it.
  check('imported by its own path, never through the shared/ui barrel', !/ScrollPager/.test(read('src/shared/ui/index.ts')))
}

console.log('\n3 · the glance tiles')
{
  const carousel = read('src/features/home/components/GlanceCarousel.tsx')
  check('GlanceCarousel uses the paged inline pager on its own track', /<ScrollPager track=\{track\} noun="screen" paged placement="inline"/.test(carousel))
  check('…reaching into the tile\'s padding on a mouse, so the screen name keeps its room', /placement="inline" className="-mr-1\.5 \[@media\(pointer:coarse\)\]:mr-0"/.test(carousel) && /mt-1\.5 flex min-w-0 items-center gap-1"/.test(carousel))
  check('the dots stay inside it (‹ ••• ›)', /placement="inline"[^>]*>\s*<span aria-hidden className="flex shrink-0 gap-1">/.test(carousel))
  check('the header keeps ←/→', /onKeyDown=\{onKeyDown\}/.test(carousel))
  for (const f of ['WeatherWidget', 'CurrencyWidget', 'RecentMediaWidget', 'BooksHomeWidget', 'GamesHomeWidget', 'TrainingHomeWidget']) {
    check(`${f} draws a GlanceCarousel`, read(`src/features/home/components/${f}.tsx`).includes('<GlanceCarousel'))
  }
}

console.log('\n4 · every sideways row is decided')
const files = []
const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p) } }
walk('src')
/** Every string in a file (a className, a const, a template), so a class held in a const is seen too. */
const strings = (src) => src.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || []
const hidesBar = (s) => (/\boverflow-x-auto\b/.test(s) && (/\bscrollbar-none\b/.test(s) || /\[scrollbar-width:none\]/.test(s))) || /(^|[\s'"`])tg-scroll-x\b/.test(s)
const thinBar = (s) => /(^|[\s'"`])scroll-x\b/.test(s)
{
  // Strips of cards or pictures: the same job as Steam's "Last 2 weeks", so a PagedStrip.
  const CARD_STRIPS = {
    'src/features/games/components/SteamTab.tsx': 'games',
    'src/features/games/components/PlayStationTab.tsx': 'games',
    'src/features/games/components/SteamGameModal.tsx': 'screenshots',
    'src/features/media/components/ContinueWatching.tsx': 'titles',
    'src/features/media/components/SimilarRow.tsx': 'titles',
    'src/features/media/components/CollectionListButton.tsx': 'films',
    'src/features/media/components/MediaDetailInfo.tsx': 'cast',
    'src/features/work/components/FocusStrip.tsx': 'focus tasks',
    'src/features/home/components/GamesHomeWidget.tsx': 'games',
    'src/features/recipes/components/FoodLogModal.tsx': 'saved meals',
    'src/features/home/components/WeatherDetails.tsx': 'hours',
  }
  for (const [f, noun] of Object.entries(CARD_STRIPS)) check(`${path.basename(f)}: a PagedStrip (${noun})`, read(f).includes(`<PagedStrip noun="${noun}"`))
  // Chip rows that hid their bar: a PagedStrip too (the Games page's in its own look).
  const CHIP_STRIPS = {
    'src/features/games/components/PsnTrophyPanel.tsx': '<PagedStrip noun="trophy groups"',
    'src/features/daily/components/summary/FootballCard.tsx': '<PagedStrip noun="teams"',
    'src/features/games/test-game/components/TgHeader.tsx': '<PagedStrip look="games" noun="filters"',
    'src/features/games/test-game/components/igdb/TgIgdbView.tsx': '<PagedStrip look="games" noun="filters"',
    'src/features/games/test-game/components/scrape/TgScrapeBatch.tsx': '<PagedStrip look="games" noun="filters"',
    'src/features/games/test-game/components/scrape/TgScrapeTarget.tsx': '<PagedStrip look="games" noun="filters"',
    'src/features/games/test-game/components/TgMobileHeader.tsx': '<PagedStrip look="games" noun="views"',
    'src/features/games/test-game/components/TgMobileSections.tsx': '<PagedStrip\n        look="games"\n        noun="sections"',
  }
  for (const [f, tag] of Object.entries(CHIP_STRIPS)) check(`${path.basename(f)}: a PagedStrip`, read(f).includes(tag))

  // A hidden bar without PagedStrip's buttons is allowed only here, each with its reason.
  const HIDDEN_OK = {
    'src/shared/ui/ScrollPager.tsx': 'PagedStrip itself',
    'src/features/home/components/GlanceCarousel.tsx': 'the glance track, with ScrollPager inline',
    'src/features/daily/pages/DailyPage.tsx': 'a page-header SegmentedControl sized to fit from sm up; never a strip',
    'src/shared/components/plan-modal/DayTimeline.tsx': 'the item screen\'s 24-hour timeline: dragged (cursor-grab) with its own thumb; hours are positions, not pages',
    'src/features/games/test-game/components/TgScreenshotStrip.tsx': 'its own ‹ › (tg-chevron-btn) beside the strip, drawn on touch too, as the Games design has it',
  }
  const hidden = files.filter(f => !HIDDEN_OK[f] && strings(read(f)).some(hidesBar))
  check('no other row hides its bar without the buttons (className, const or template)', hidden.length === 0, hidden)
  check('the hidden-bar allow-list is still needed', Object.keys(HIDDEN_OK).every(f => strings(read(f)).some(hidesBar)), Object.keys(HIDDEN_OK).filter(f => !strings(read(f)).some(hidesBar)))

  // `.scroll-x` shows a thin bar with a mouse: kept only for chip and tab rows (and two non-rows).
  const THIN_BAR_OK = [
    'src/features/football/pages/FootballPage.tsx', 'src/features/projects/components/TableBlock.tsx', 'src/features/projects/components/SectionChips.tsx',
    'src/features/training/components/RepRangeDistributionChart.tsx', 'src/features/training/components/StravaTab.tsx', 'src/features/training/progress/ExerciseList.tsx',
    'src/features/training/pages/TrainingPage.tsx', 'src/features/recipes/components/IngredientList.tsx', 'src/features/recipes/components/MealPlanWeek.tsx',
    'src/features/recipes/components/LibraryTabFilters.tsx', 'src/features/recipes/components/CookMode.tsx', 'src/features/developer/components/MemoryTab.tsx',
    'src/features/developer/pages/DeveloperPage.tsx', 'src/features/media/components/LibraryView.tsx', 'src/features/media/components/stats/MediaStatsView.tsx',
    'src/features/media/components/EpisodesPanel.tsx', 'src/features/media/components/DiscoveryTabs.tsx', 'src/features/devRequests/components/DevRequestsDrawer.tsx',
    'src/features/settings/components/ApisTab.tsx', 'src/features/settings/pages/SettingsPage.tsx', 'src/features/health/components/overview/SectionPanel.tsx',
    'src/features/health/components/BodyCompTrendChart.tsx', 'src/features/shop/components/stats/StatsChrome.tsx', 'src/features/books/components/kobo/KoboTab.tsx',
    'src/features/books/components/LibraryTab.tsx', 'src/features/books/pages/BooksPage.tsx',
    // Not rows of items: a wide period toggle that may scroll on a narrow phone, and a code block.
    'src/features/health/components/HealthRangeBar.tsx', 'src/features/projects/components/ProseText.tsx',
  ]
  const thin = files.filter(f => !THIN_BAR_OK.includes(f) && strings(read(f)).some(thinBar))
  check('every .scroll-x row is a chip or tab row on the list (a strip of cards is a PagedStrip)', thin.length === 0, thin)
  check('the thin-bar list is still needed', THIN_BAR_OK.every(f => strings(read(f)).some(thinBar)), THIN_BAR_OK.filter(f => !strings(read(f)).some(thinBar)))
  check('no card strip is on the chip list', Object.keys(CARD_STRIPS).every(f => !THIN_BAR_OK.includes(f)))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
