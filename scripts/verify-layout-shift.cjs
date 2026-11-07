#!/usr/bin/env node
/* Verification — the layout-shift causes found and fixed on 07.11.2026 stay fixed (THEME.md §5
 * "Loading", §3 "the font's stand-in"). A layout shift is content moving after it was drawn: a
 * skeleton shorter than what replaces it, a row that appears with the data, a font that swaps.
 * These checks read the source; the browser measure is scripts/audit-cls.mjs on the harness.
 * Run: node scripts/verify-layout-shift.cjs */
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const code = (f) => fs.readFileSync(path.join(root, f), 'utf8')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('The font')
const html = code('index.html')
const LATIN = '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'
const preload = /<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin \/>/.exec(html)
check('index.html preloads Inter\'s Latin file (as="font", type, crossorigin — without crossorigin the preload is fetched twice)',
  preload != null && preload[1] === `/node_modules/${LATIN}`, preload ? preload[1] : 'no font preload')
const wght = path.join(root, 'node_modules/@fontsource-variable/inter/wght.css')
if (fs.existsSync(wght)) {
  check('the preloaded file is the one the stylesheet\'s @font-face loads (one download, one cache entry)',
    fs.readFileSync(wght, 'utf8').includes('./files/inter-latin-wght-normal.woff2'))
}
const css = code('src/index.css')
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]).filter(b => /font-family:\s*'Inter Fallback'/.test(b))
check('two "Inter Fallback" faces (regular and bold Arial)', faces.length === 2, `${faces.length}`)
check('each fallback face is sized and given Inter\'s line metrics (size-adjust, ascent, descent, line gap)',
  faces.length > 0 && faces.every(b => /size-adjust:\s*\d/.test(b) && /ascent-override:/.test(b) && /descent-override:/.test(b) && /line-gap-override:/.test(b)))
check('the fallback faces are Arial (or its metric twin Liberation Sans) — the size-adjust was measured against it',
  faces.length > 0 && faces.every(b => /local\('Arial/.test(b) && /local\('Liberation Sans/.test(b)))
check('the fallback faces sit at the top level, before any @layer (Tailwind owns what is inside one)',
  css.lastIndexOf("font-family: 'Inter Fallback'") >= 0 && css.lastIndexOf("font-family: 'Inter Fallback'") < css.indexOf('@layer'))
const tw = code('tailwind.config.js')
check('the sans stack puts the stand-in right after Inter Variable', /sans:\s*\['"Inter Variable"',\s*'"Inter Fallback"'/.test(tw))

console.log('The shell')
const shell = code('src/app/shell/AppShell.tsx')
check('a page that folds the sidebar (Games) is drawn folded from its first frame (the route default before enterRoute)',
  /selectSidebarCollapsed\(collapsesSidebar\(pathname\)\)/.test(shell) && /routeFolds \|\| s\.collapsed/.test(code('src/app/store.ts')))
check('Back restores the offset once the page is tall enough (restoreScroll), not with one clamped scrollTo',
  /function restoreScroll\(/.test(shell) && /ResizeObserver/.test(shell) && /stopRestore = restoreScroll\(el, saved\)/.test(shell))

console.log('Loading copies the loaded geometry')
const carousel = code('src/features/home/components/GlanceCarousel.tsx')
check('a glance tile\'s loading copy and its screens never share a DOM node (keyed apart)', /key="loading"/.test(carousel) && /key="track"/.test(carousel))
check('a glance tile\'s loading copy keeps the row of screen dots', /mt-1\.5 flex h-4 items-center/.test(carousel))
check('weather waiting for the location counts as loading (the tile drew "—", then a skeleton, then the forecast)',
  /isLoading: query\.isLoading \|\| \(enabled && !geo\)/.test(code('src/features/home/hooks/useWeather.ts')))
check('the brief draws its greeting at once and waits for all of its database reads',
  /<header ref=\{artContentRef\}[^]*\{isLoading \? <BriefSkeleton/.test(code('src/features/home/components/DailyBrief.tsx'))
    && /training\.isLoading \|\| profileLoading/.test(code('src/features/home/hooks/useDailyBrief.ts')))
check('the day list\'s loading copy is the list\'s own grid, about a screen tall', /function ListSkeleton\(/.test(code('src/features/daily/components/DayAgenda.tsx')))
check('Games waits for all three libraries on the first load (Steam and PlayStation rows landed between the retro games)',
  /const firstLoad = retro\.isLoading \|\| steam\.isLoading \|\| psn\.isLoading \|\| !steamReady/.test(code('src/features/games/test-game/useTestGameLibrary.ts')))

console.log('Rows and counts that come with the data keep their room')
check('Daily\'s date label has one width for every day (the arrows never move on Yesterday / Tomorrow)',
  /labelClassName="w-\[[\d.]+em\]/.test(code('src/features/daily/pages/DailyPage.tsx')))
const projects = code('src/features/projects/pages/ProjectsPage.tsx')
check('Projects: the status switch shows while loading, and the cards wait for their phases, tasks and questions',
  /\(projects\.length > 0 \|\| loading\) && \(\s*<SegmentedControl<ProjectStatus>/.test(projects) && /phasesQ\.isLoading \|\| tasksQ\.isLoading \|\| questionsQ\.isLoading/.test(projects))
const football = code('src/features/football/pages/FootballPage.tsx')
check('Football: the filter row keeps its place while what you follow loads', /\{followsQ\.isLoading && \(\s*<div aria-hidden/.test(football))
check('Football: the match lists load as MatchListSkeleton, and a failed ESPN read keeps their room (MATCH_LIST_ROOM)',
  /<MatchListSkeleton days=\{3\} \/>/.test(football) && /<MatchListSkeleton days=\{2\} \/>/.test(football)
    && /MATCH_LIST_ROOM\[3\]/.test(football) && /MATCH_LIST_ROOM\[2\]/.test(football) && /\{!loading && problem\}/.test(football))
check('Work: the three counts keep their room while the tasks load', /\{isLoading \? \(\s*\/\/[^\n]*\n[^]*?<span aria-hidden/.test(code('src/features/work/pages/WorkPage.tsx')))
check('Shop and Wishes: the filters show while loading', /filters: \(all\.length > 0 \|\| isLoading\)/.test(code('src/features/shop/components/WishlistView.tsx'))
  && /filters: \(wishes\.length > 0 \|\| isLoading\)/.test(code('src/features/wishes/pages/WishesPage.tsx')))
check('Books: Reading now keeps its place while the library loads', /reading: isLoading \? <ReadingNowSkeleton \/>/.test(code('src/features/books/components/LibraryTab.tsx')))
check('Training: Next waits for the lines above the exercises (missed, recovery, muscle watch)',
  /plan\.isLoading \|\| missed\.isLoading \|\| recovery\.isLoading \|\| muscle\.isLoading/.test(code('src/features/training/components/next/NextTab.tsx')))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
