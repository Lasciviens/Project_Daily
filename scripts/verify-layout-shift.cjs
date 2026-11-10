#!/usr/bin/env node
/* Verification — the layout-shift causes found and fixed on 07.11.2026 stay fixed (THEME.md §5
 * "Nothing moves when data lands", §3 "the font's stand-in"). A layout shift is content moving after
 * it was drawn: a skeleton shorter — or taller — than what replaces it, a row that appears with the
 * data, a font that swaps. The layout memory (useLayoutMemory) runs here through sucrase; the other
 * checks read the source. The browser measure is scripts/audit-cls.mjs on the harness, with every
 * data shape (--data seed,light,empty).
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
// A unicode-range as merged code-point intervals, so two spellings of one range compare equal.
function rangeSet(text) {
  const iv = text.split(',').map(t => t.trim()).filter(Boolean).map(t => {
    const m = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(t)
    return m ? [parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)] : null
  })
  if (!iv.length || iv.some(x => x == null)) return null
  iv.sort((a, b) => a[0] - b[0])
  const out = []
  for (const [a, b] of iv) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}
const rangeOf = (block) => { const m = /unicode-range:\s*([^;]+);/.exec(block); return m ? rangeSet(m[1]) : null }
check('the fallback faces leave out what no Inter file draws (→ U+2192, ✓ U+2713): those keep the system font, never Arial for good',
  faces.length > 0 && faces.every(b => { const r = rangeOf(b); return r != null && ![0x2192, 0x2713].some(c => r.some(([a, z]) => c >= a && c <= z)) }))
if (fs.existsSync(wght)) {
  const interFaces = [...fs.readFileSync(wght, 'utf8').matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1])
  const fileRange = (file) => { const b = interFaces.find(f => f.includes(`./files/${file}`)); const m = b && /unicode-range:\s*([^;]+);/.exec(b); return m ? m[1] : '' }
  const want = JSON.stringify(rangeSet(`${fileRange('inter-latin-wght-normal.woff2')},${fileRange('inter-latin-ext-wght-normal.woff2')}`))
  check('the fallback faces cover exactly what Inter\'s Latin and Latin Extended files draw (their unicode-range in wght.css)',
    faces.length > 0 && want !== 'null' && faces.every(b => JSON.stringify(rangeOf(b)) === want))
}
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

check('the shell\'s panels, then the other pages, load once the first page is drawn with its data (whenSettled) — the iPhone has no idle callback, so a bare idle wait was a fixed 1.5 s while the page still read',
  /whenSettled\(qc, \(\) => \{\s*void preloadInTurn\(SHELL_PARTS\)\.then\(\(\) => \{ setPartsIn\(true\); void preloadPages\(\) \}\)/.test(shell)
  && !/\bwhenIdle\(/.test(shell) &&!/^export function whenIdle/m.test(code('src/shared/utils/whenIdle.ts')))

console.log('The layout memory: a part keeps the room it took last time')
{
  require('sucrase/register')
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: k => { store.delete(k) },
  }
  const MOD = path.join(root, 'src/shared/hooks/useLayoutMemory.ts')
  const fresh = () => { delete require.cache[require.resolve(MOD)]; return require(MOD) }
  let M = fresh()
  M.rememberLayout('a', 12.5)
  M.rememberLayout('b', true)
  check('a size and a flag come back', M.rememberedLayout('a') === 12.5 && M.rememberedLayout('b') === true)
  M = fresh()
  check('…also on the next visit (localStorage)', M.rememberedLayout('a') === 12.5 && M.rememberedLayout('b') === true)
  store.set('lasci.layoutMemory', JSON.stringify([['ok', 3], ['neg', -1], ['huge', 1e9], ['str', 'x'], [5, 1], 'junk', ['flag', false]]))
  M = fresh()
  check('device storage is input: only [string, number 0–400 | boolean] pairs are read back',
    M.rememberedLayout('ok') === 3 && M.rememberedLayout('flag') === false && ['neg', 'huge', 'str'].every(k => M.rememberedLayout(k) === undefined))
  store.set('lasci.layoutMemory', '{not json')
  M = fresh()
  check('unreadable storage starts empty', M.rememberedLayout('ok') === undefined)
  for (let i = 0; i < 200; i++) M.rememberLayout(`k${i}`, i)
  const kept = JSON.parse(store.get('lasci.layoutMemory'))
  check('a bounded number of entries, the newest kept', kept.length <= 120 && M.rememberedLayout('k199') === 199 && M.rememberedLayout('k0') === undefined, `${kept.length}`)
  // A flag that never changes but is used on every visit outlives a few weeks of day keys (the order is "last used").
  M.rememberLayout('steady', true)
  for (let i = 0; i < 300; i++) {
    M.rememberLayout(`day${i}`, i % 50)
    if (i % 20 === 0) M.rememberLayout('steady', true)
  }
  M = fresh()
  check('a fact remembered again unchanged moves to the end: a steady flag outlives 300 day keys',
    M.rememberedLayout('steady') === true && M.rememberedLayout('day299') === 299 % 50)
  let writes = 0
  const setItem = globalThis.localStorage.setItem
  globalThis.localStorage.setItem = (k, v) => { writes++; setItem(k, v) }
  for (let i = 0; i < 5; i++) M.rememberLayout('steady', true)
  check('…and storage is written only when a value changes (KeepRoom remembers on every render)', writes === 0, `${writes} writes`)
  M.rememberLayout('steady', false)
  check('…a changed value is written', writes === 1, `${writes} writes`)
  globalThis.localStorage.setItem = setItem
  M.rememberLayout(`long:${'x'.repeat(120)}`, 1)
  check('a key longer than 100 characters is never remembered', M.rememberedLayout(`long:${'x'.repeat(120)}`) === undefined)
  store.set('lasci.layoutMemory', JSON.stringify([['short', 1], [`k${'y'.repeat(150)}`, 2], ['', 3]]))
  M = fresh()
  check('…nor read back from storage (nor an empty one)', M.rememberedLayout('short') === 1 && M.rememberedLayout(`k${'y'.repeat(150)}`) === undefined && M.rememberedLayout('') === undefined)
  M.forgetLayouts()
  check('forgetLayouts empties the memory and the storage', M.rememberedLayout('short') === undefined && !store.has('lasci.layoutMemory'))
  check('sign-out forgets it (the counts belong to the account)', /forgetLayouts\(\)/.test(code('src/security/accountState.ts')))
  const keep = code('src/shared/ui/KeepRoom.tsx')
  check('KeepRoom leaves out only a loading copy, never content that is already here',
    /const body = showSkeleton \? skeleton : children/.test(keep) && /if \(showSkeleton && \(last === 0/.test(keep))
  check('KeepRoom measures only a loaded outcome worth planning by (not while loading, not a failed read)', /if \(loading \|\| !remember\) return/.test(keep))
}

console.log('A failed read is never learned as "nothing there"')
{
  const sites = [
    ['Work\'s overdue count', 'src/features/work/pages/WorkPage.tsx', /useRememberedFlag\('work:overdue', counts\.overdue > 0, !isLoading && !isError\)/],
    ['Projects\' header', 'src/features/projects/pages/ProjectsPage.tsx', /const settled = !loading && !\(projectsQ\.isError \|\| phasesQ\.isError \|\| tasksQ\.isError \|\| questionsQ\.isError\)/],
    ['Football\'s filter row', 'src/features/football/pages/FootballPage.tsx', /useRememberedFlag\('football:filter', follows\.length > 1, !followsQ\.isLoading && !followsQ\.isError\)/],
    ['the Google list sheet', 'src/features/todo/components/MoveToListSheet.tsx', /useRememberedCount\('sheet:taskLists', lists\.length, !isLoading && !isError, 3\)/],
    ['Books\' Reading now', 'src/features/books/components/LibraryTab.tsx', /useRememberedCount\('books:reading', Math\.min\(reading\.length, READING_NOW_MAX\), !isLoading && !isError, 0\)/],
    ['the day list\'s room', 'src/features/daily/components/DayAgenda.tsx', /first=\{ROOM_DEFAULT_REM\[cols\]\} remember=\{!failed\}/],
    ['today\'s Next line', 'src/features/daily/components/DayAgenda.tsx', /if \(settled && !failed && viewingToday\) rememberNext\(day, hasNext\)/],
    ['the brief\'s sections', 'src/features/home/components/DailyBrief.tsx', /pending\.has\(id\) \|\| failed\.has\(id\) \|\| unsure\.has\(id\) \? '-'/],
    ['the brief\'s headline', 'src/features/home/components/DailyBrief.tsx', /ids="brief:headline" loading=\{headlineLoading\} remember=\{failed\.size === 0 && unsure\.size === 0\}/],
    ['Health\'s hero tiles', 'src/features/health/components/overview/HeroTile.tsx', /loading=\{!!isLoading\} remember=\{!failed\}/],
    ['Training\'s recovery line', 'src/features/training/components/next/NextTab.tsx', /ids="training:recovery" loading=\{isLoading\} remember=\{!isError\}/],
    ['Training\'s missed sessions', 'src/features/training/components/program/MissedSessions.tsx', /ids="training:missed" loading=\{isLoading\} remember=\{!isError\}/],
    ['the muscle-watch line', 'src/features/health/goal/MuscleWatchCard.tsx', /ids="muscleWatch:line" loading=\{isLoading\} remember=\{!isError\}/],
  ]
  for (const [name, file, re] of sites) check(`${name}: learned only from an answered read`, re.test(code(file)))
  check('Health passes each tile whether its reads failed (hero.failed)',
    (code('src/features/health/components/overview/HealthHero.tsx').match(/ failed=\{hero\.failed\.(sleep|steps|exercise|rhr|weight|vitals)\}/g) || []).length === 6)
  check('the brief leaves out of its memory a section a failed read left unsure (weather, rates, food, training, watch)',
    /const unsure = useMemo/.test(code('src/features/home/hooks/useDailyBrief.ts')))

  // Every place that keeps or learns room says what a failed read does: a new one can't slip through (owner-critic,
  // 07.11.2026 — four places learned a failed read as "nothing there").
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : []
  })
  const srcFiles = walk(path.join(root, 'src')).filter(f => !/shared[\\/](ui[\\/]KeepRoom\.tsx|hooks[\\/]useLayoutMemory\.ts)$/.test(f))
  const noRemember = [], blindReady = []
  for (const f of srcFiles) {
    const src = fs.readFileSync(f, 'utf8')
    const rel = path.relative(root, f)
    for (const m of src.matchAll(/<KeepRoom\b([^>]*?)>/gs)) if (!/\bremember=/.test(m[1])) noRemember.push(rel)
    for (const m of src.matchAll(/useRemembered(?:Flag|Count)\(([^\n]*)\)/g)) {
      const ready = m[1].split(/,(?![^(]*\))/)[2]?.trim() ?? ''
      const ok = /isError|Error\b|!error\b|failed|settled/.test(ready) || (ready === 'ready' && /const ready = \w+ != null/.test(src))
      if (!ok) blindReady.push(`${rel}: ${ready || m[1]}`)
    }
  }
  check('every <KeepRoom> says whether this outcome is one to remember (remember=…)', noRemember.length === 0, noRemember.join(', '))
  check('every useRememberedFlag / useRememberedCount learns only when its read answered (an error term, or data present)', blindReady.length === 0, blindReady.join('; '))
  const projects = code('src/features/projects/pages/ProjectsPage.tsx')
  check('Projects passes `settled` to all three of its memories', (projects.match(/, settled[,)]/g) || []).length === 3)
}

console.log('Room only for what every outcome shows; the rest from the memory')
const agenda = code('src/features/daily/components/DayAgenda.tsx')
check('the day list keeps the room of its last load — the day, else the last today, else about an empty day\'s — not a screen of rows',
  /<KeepRoom ids=\{roomIds\} loading=\{!settled \|\| width == null\} first=\{ROOM_DEFAULT_REM\[cols\]\}/.test(agenda)
    && /const ROOM_DEFAULT_REM: Record<1 \| 2, number> = \{ 1: 9\.75, 2: 8\.5 \}/.test(agenda) && /\[roomKey\(day, cols\), todayRoomKey\(cols\)\]/.test(agenda))
check('the day list shows once its own reads are in (one time order: tasks, slots, the slots\' tasks), never waiting for the wishes or the week',
  /\{!listReady \? <ListSkeleton/.test(agenda) && /const firstAnswer = !list\.isLoading && !templatesLoading && !blocksLoading && !prevLoading/.test(agenda)
    && !/firstAnswer = [^\n]*(wishesLoading|weekLoading)/.test(agenda) && !/(wishesLoading|weekLoading)[^\n]*\n?\s*&& !\(linkedIds/.test(agenda))
check('the open wishes and this week\'s undated tasks are bands of their own: room while they load only where they showed last time',
  /useRememberedFlag\('dayList:wishes', wishes\.length > 0, !wishesLoading && !wishesError\)/.test(agenda)
    && /useRememberedFlag\('dayList:undated', floating\.length > 0, !weekLoading && !weekError\)/.test(agenda)
    && /wishesLoading \? wishesRoom && <OpenWishesRowSkeleton \/>/.test(agenda) && /weekLoading \? undatedRoom && <UndatedThisWeekSkeleton \/>/.test(agenda)
    && !/useOpenWishes\(|useTasksByWeek\(/.test(code('src/features/daily/components/DayAgendaExtras.tsx')))
check('the loading copy is the day\'s first answer only: a delete or a move (a new id for the slots\' tasks) never brings it back',
  /if \(firstAnswer && drawnDay !== day\) setDrawnDay\(day\)/.test(agenda) && /const listReady = firstAnswer \|\| drawnDay === day/.test(agenda)
    && /linkedIds\.length > 0 && \(linked\.isLoading \|\| linked\.isPlaceholderData\)/.test(agenda)
    && /placeholderData: ids\.length > 0 \? keepPreviousData : undefined/.test(code('src/features/todo/hooks/useTodos.ts')))
check('today\'s Next line keeps its room only when it showed last time', /const nextRoom = viewingToday && !settled && !hasNext && rememberedNext\(day\)/.test(agenda))
const work = code('src/features/work/pages/WorkPage.tsx')
check('Work: done and active keep their room; overdue only when the last visit had it',
  /useRememberedFlag\('work:overdue', counts\.overdue > 0, !isLoading && !isError\)/.test(work) && /overdueRoom \? COUNT_ROOM : COUNT_ROOM\.slice\(0, 2\)/.test(work))
const projects = code('src/features/projects/pages/ProjectsPage.tsx')
check('Projects: the status switch keeps its room (every account with a project has it); the area switch only when it showed last time',
  /const hasProjects = useRememberedFlag\('projects:any', projects\.length > 0, settled, true\)/.test(projects)
    && /const showAreas = useRememberedFlag\('projects:areas', twoAreas, settled\) \|\| twoAreas/.test(projects)
    && /\{showAreas && \(/.test(projects) && !/twoAreas \|\| loading\)/.test(projects)
    && /<div key="loading" className=\{GRID\}>/.test(projects) && /<div key="cards" className=\{GRID\}>/.test(projects))
const football = code('src/features/football/pages/FootballPage.tsx')
check('Football: the filter row keeps its room only when it showed last time',
  /useRememberedFlag\('football:filter', follows\.length > 1, !followsQ\.isLoading && !followsQ\.isError\)/.test(football) && /followsQ\.isLoading && filterRoom &&/.test(football))
check('Football: the lists keep their room only while ESPN answers or a failed read is tried again; a final error is one line',
  /const listsLoading = loading \|\| retrying/.test(football) && (football.match(/loading=\{listsLoading\}/g) || []).length === 2
    && (football.match(/remember=\{failed\.length === 0\}/g) || []).length === 2 && !/MATCH_LIST_ROOM/.test(football))
check('Football: neither list says it has nothing when ESPN failed',
  /: failed\.length === 0 && <p className="text-body text-fg-muted">No matches in the next 30 days\.<\/p>/.test(football)
    && /: failed\.length === 0 && <p className="text-body text-fg-muted">No results in the last 10 days\.<\/p>/.test(football))
check('Football: the lists\' memory is keyed by a follow the owner has, never by the raw ?f= of a link',
  /const listKey = current \? filterKey\(current\) : 'all'/.test(football) && /`football:coming:\$\{listKey\}`/.test(football)
    && /`football:results:\$\{listKey\}`/.test(football) && !/football:(coming|results):\$\{picked/.test(football))
const food = code('src/features/recipes/components/FoodTodayTab.tsx')
check('Food: the macro bar and each slot\'s rows keep their room only where a day had them last time (an empty day has neither)',
  /useRememberedFlag\('food:macros', macrosShown, ready\)/.test(food) && /rememberedLayout\(`food:slot:\$\{slot\}`\) === true/.test(food))
check('Food: a failed day read is one line with Try again — never rings at zero, empty slots or loading rows that stay',
  /const failed = !ready && nutError/.test(food) && /Couldn't load the day's food\./.test(food) && /\{failed \? null : loading \? \(/.test(food)
    && /\{loading && macrosRoom && \(/.test(food))
{
  const filters = code('src/features/developer/components/ActivityLogFilters.tsx')
  const tab = code('src/features/developer/components/ActivityLogTab.tsx')
  check('Developer: the Type select has one width that keeps the bar on one line with Clear all (9.5rem, ~12px to spare), and Clear all keeps its room only when the log had entries last time',
    /typeSelect\('w-\[9\.5rem\]'\)/.test(filters) && /\(hasLogs \|\| clearRoom\) &&/.test(filters)
      && /useRememberedFlag\('developer:log', logs\.length > 0, !isLoading && !error\) && isLoading/.test(tab) && /clearRoom=\{clearRoom\}/.test(tab))
}
const wishlist = code('src/features/shop/components/WishlistView.tsx')
check('Shop and Wishes: the filters show while loading — Shop\'s only where they showed last time (an empty wishlist has none; the first visit keeps them)',
  /const showFilters = useRememberedFlag\('shop:wishFilters', all\.length > 0, !isLoading && !itemsQ\.isError, true\)/.test(wishlist)
    && /filters: showFilters && \(/.test(wishlist)
    && /filters: \(wishes\.length > 0 \|\| isLoading\)/.test(code('src/features/wishes/pages/WishesPage.tsx')))
check('Shop: the tiles wait for their own reads and the default pictures, so nothing appears under a drawn tile',
  /const tilesLoading = isLoading \|\| watchQ\.isLoading \|\| stats\.isLoading \|\| !pictures\.ready/.test(wishlist))
const library = code('src/features/books/components/LibraryTab.tsx')
check('Books: Reading now keeps room while the library loads only for as many books as it showed last time (none the first time)',
  /reading: isLoading \? readingRoom > 0 && <ReadingNowSkeleton books=\{readingRoom\} \/>/.test(library) && !/isLoading \? <ReadingNowSkeleton \/>/.test(library))
const tile = code('src/features/health/components/overview/HeroTile.tsx')
check('Health: each hero tile\'s middle keeps the room it took last time (a tile with readings is twice one without); a first visit one line and the Aim',
  /<KeepRoom as="span" ids=\{`health:tile:\$\{id\}`\} loading=\{!!isLoading\} remember=\{!failed\} first=\{FIRST_ROOM_REM\}/.test(tile) && /const FIRST_ROOM_REM = 3\.5/.test(tile)
    && /absolute inset-0 flex flex-col gap-2 overflow-hidden/.test(tile)
    && (code('src/features/health/components/overview/HealthHero.tsx').match(/<HeroTile id="/g) || []).length === 6)

console.log('Each part shows as its own reads land, never held back for another part\'s')
const brief = code('src/features/home/components/DailyBrief.tsx')
const briefHook = code('src/features/home/hooks/useDailyBrief.ts')
check('the brief: each section in its own KeepRoom, shown as its reads land (no wait for all eight)',
  /pending: ReadonlySet<BriefSectionId>/.test(briefHook) && /ids=\{`brief:\$\{id\}`\} loading=\{pending\.has\(id\)\}/.test(brief)
    && !/training\.isLoading \|\| profileLoading\s*\|\|\s*nutritionLoading/.test(briefHook))
check('the brief draws its greeting at once', /<header ref=\{artContentRef\}/.test(brief) && !/BriefSkeleton/.test(brief))
check('the brief\'s first visit keeps room only for what every outcome shows at this hour (the schedule only until 22:00: briefRules.alwaysShown)',
  /const always = alwaysShown\(hour\)/.test(brief) && /return typeof last === 'boolean' \? last : always\.has\(id\)/.test(brief) && !/const ALWAYS\b/.test(brief)
    && /if \(i\.hour < SCHEDULE_QUIET_FROM\)/.test(code('src/features/home/briefRules.ts'))
    && /hour < SCHEDULE_QUIET_FROM \? \['tasks', 'schedule', 'nutrition'\] : \['tasks', 'nutrition'\]/.test(code('src/features/home/briefRules.ts')))
check('the brief: a failed read of the day\'s tasks or schedule is one line with Try again — never a skeleton that stays',
  /const tasksLoading = !day\.ready && !day\.isError/.test(briefHook) && /if \(tasksLoading\) out\.add\('tasks'\)/.test(briefHook)
    && /headlineLoading: tasksLoading \|\| overview\.isLoading/.test(briefHook) && /Couldn\\'t load today\\'s tasks\./.test(briefHook)
    && /Couldn\\'t load today\\'s schedule\./.test(briefHook) && /schedule: overview\.isLoading \|\| overview\.scheduleError \? null/.test(briefHook)
    && /<FailedLine failure=\{failure\} \/>/.test(brief))
const next = code('src/features/training/components/next/NextTab.tsx')
check('Training Next shows once the plan is in; missed, recovery and the muscle watch each keep their own room',
  /if \(plan\.isLoading\) \{/.test(next) && !/missed\.isLoading|recovery\.isLoading|muscle\.isLoading/.test(next)
    && /ids="training:recovery"/.test(next) && /ids="training:missed"/.test(code('src/features/training/components/program/MissedSessions.tsx'))
    && /ids="muscleWatch:line"/.test(code('src/features/health/goal/MuscleWatchCard.tsx')))
check('Training Next reads the muscle watch once (in MuscleWatchLine), never a second useMuscleWatch of its own', !/useMuscleWatch/.test(next))
check('Games waits for all three libraries on the first load (one order: Steam and PlayStation rows landed between the retro games)',
  /const firstLoad = retro\.isLoading \|\| steam\.isLoading \|\| psn\.isLoading \|\| !steamReady/.test(code('src/features/games/test-game/useTestGameLibrary.ts')))

console.log('Loading copies the loaded geometry')
const carousel = code('src/features/home/components/GlanceCarousel.tsx')
check('a glance tile\'s loading copy and its screens never share a DOM node (keyed apart)', /key="loading"/.test(carousel) && /key="track"/.test(carousel))
check('a glance tile\'s loading copy keeps the row of screen dots', /mt-1\.5 flex h-4 items-center/.test(carousel))
check('weather waiting for the location counts as loading (the tile drew "—", then a skeleton, then the forecast)',
  /isLoading: query\.isLoading \|\| \(enabled && !geo\)/.test(code('src/features/home/hooks/useWeather.ts')))
check('Daily\'s date label has one width for every day (the arrows never move on Yesterday / Tomorrow)',
  /labelClassName="w-\[[\d.]+em\]/.test(code('src/features/daily/pages/DailyPage.tsx')))
for (const f of ['src/features/recipes/pages/RecipesPage.tsx', 'src/features/training/pages/TrainingPage.tsx', 'src/features/health/pages/HealthPage.tsx', 'src/features/books/pages/BooksPage.tsx']) {
  const c = code(f)
  check(`${path.basename(f, '.tsx')}: a lazy tab loads in a SkeletonTab (a screen of room), never a 0px div`,
    /<Suspense fallback=\{<SkeletonTab \/>\}>/.test(c) && !/<Suspense fallback=\{<div aria-busy="true" \/>\}>/.test(c))
}
check('the task-row sheets open at their size: the parent picker\'s fallback is its body; the list sheet shows rows while loading',
  /<Suspense fallback=\{<PickerSkeleton/.test(code('src/features/todo/components/SetParentTaskSheet.tsx'))
    && /isLoading && Array\.from\(\{ length: Math\.max\(1, loadingRows\) \}/.test(code('src/features/todo/components/MoveToListSheet.tsx')))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
