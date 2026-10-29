#!/usr/bin/env node
/* Verification — the pure decisions behind <PageBoard> (src/shared/ui/pageBoardRules.ts)
 * and the layouts declared with it (Home, Daily's four modes).
 * Run: node scripts/verify-page-board.cjs */
require('sucrase/register')
const B = require('../src/shared/ui/pageBoardRules')
const H = require('../src/features/home/pages/homeBoard')
const { HOME_BOARD, HOME_BOARD_SPLIT, HOME_SECTIONS, HOME_GLANCE, TILE_SECTIONS } = H
const D = require('../src/features/daily/dailyBoards')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Page content widths at the reference viewports: viewport − sidebar − 2 × gutter.
const W = {
  phone: 402 - 32,                 // 370
  tablet: 768 - 68 - 48,           // 652
  tablet1024: 1024 - 68 - 64,      // 892 (lg gutters start at 1024)
  laptop1280: 1280 - 232 - 64,     // 984
  laptop: 1469 - 232 - 64,         // 1173
  laptopRail: 1469 - 68 - 64,      // 1337 (sidebar collapsed)
  fhd: 1920 - 232 - 64,            // 1624
  monitor: 2450 - 232 - 64,        // 2154
  monitorRail: 2450 - 68 - 64,     // 2318
}

console.log('pageStepForWidth')
check('phone → 1', B.pageStepForWidth(W.phone) === 1)
check('tablet 768 → 1', B.pageStepForWidth(W.tablet) === 1)
check('tablet 1024 → 1', B.pageStepForWidth(W.tablet1024) === 1)
check('1280 laptop → 2 (two columns, as before the board)', B.pageStepForWidth(W.laptop1280) === 2)
check('1469 laptop → 2', B.pageStepForWidth(W.laptop) === 2)
check('1469 with the sidebar folded → 2', B.pageStepForWidth(W.laptopRail) === 2)
check('1920 → 3', B.pageStepForWidth(W.fhd) === 3)
check('2450 → 4', B.pageStepForWidth(W.monitor) === 4)
check('2450 with the sidebar folded → 4', B.pageStepForWidth(W.monitorRail) === 4)
check('boundary 60rem is step 2', B.pageStepForWidth(960) === 2 && B.pageStepForWidth(959) === 1)
check('boundary 100rem is step 3', B.pageStepForWidth(1600) === 3 && B.pageStepForWidth(1599) === 2)
check('boundary 128rem is step 4', B.pageStepForWidth(2048) === 4 && B.pageStepForWidth(2047) === 3)
check('a bigger root font scales the thresholds', B.pageStepForWidth(1173, 20) === 1)
check('0 / NaN / negative → 1', B.pageStepForWidth(0) === 1 && B.pageStepForWidth(NaN) === 1 && B.pageStepForWidth(-5) === 1)

console.log('board geometry')
check('widest board is 131rem', B.BOARD_MAX_REM === 131)
check('main keeps ≥ 35rem at every step threshold', [[960, 2], [1600, 3], [2048, 4]].every(([px, tracks]) =>
  B.columnWidthPx(px, { tracks, main: '56rem' }, 0, 1) >= 35 * 16))
check('1469: main 773px + one 384px side', B.columnWidthPx(W.laptop, { tracks: 2, main: '56rem' }, 0, 1) === 773
  && B.columnWidthPx(W.laptop, { tracks: 2, main: '56rem' }, 1, 1) === 384)
check('2450: main reaches its 56rem cap', B.columnWidthPx(W.monitor, { tracks: 4, main: '56rem' }, 0, 1) === 896)
check('2450: three spanned side tracks are 1184px', B.columnWidthPx(W.monitor, { tracks: 4, main: '56rem' }, 1, 3) === 1184)
const fill = (px, tracks, main) => B.columnWidthPx(px, { tracks, main }, 0, tracks)
check('2450, 4 tracks: at most one side track (24rem) left empty', W.monitor - fill(W.monitor, 4, '56rem') <= 384,
  `left ${W.monitor - fill(W.monitor, 4, '56rem')}px`)
check('1469, 2 tracks: nothing left empty', W.laptop - fill(W.laptop, 2, '56rem') === 0)
check('template: fixed side tracks after a capped main', B.boardTemplate(3) === 'minmax(0,56rem) repeat(2,24rem)')
check('template: page-set main cap', B.boardTemplate(2, '40rem') === 'minmax(0,40rem) repeat(1,24rem)')
check('template: one track is a plain column', B.boardTemplate(1) === 'minmax(0,1fr)')

console.log('resolveBoardLayout')
const L = { 1: ['a', 'b', 'c'], 3: { columns: [['a'], { stack: ['b'], sticky: true }, ['c']] } }
check('step 1 → the stack', eq(B.resolveBoardLayout(L, 1).columns[0].stack, ['a', 'b', 'c']) && B.resolveBoardLayout(L, 1).tracks === 1)
check('step 2 undeclared → falls back to step 1', B.resolveBoardLayout(L, 2).tracks === 1)
check('step 4 undeclared → falls back to step 3 (the page stops at 3)', B.resolveBoardLayout(L, 4).tracks === 3)
check('sticky and span are normalised', eq(B.resolveBoardLayout(L, 3).columns.map(c => [c.span, c.sticky]), [[1, false], [1, true], [1, false]]))
const R = { 1: ['a', 'b', 'c'], 2: { rows: [[['a'], ['b']], [{ stack: ['c'], span: 2 }]] } }
check('rows are normalised (spans default to 1, kept per row)', eq(B.resolveBoardLayout(R, 2).rows.map(r => r.map(c => [c.stack, c.span])), [[[['a'], 1], [['b'], 1]], [[['c'], 2]]]))
check('a layout without rows has none (columns, step 1)', B.resolveBoardLayout(L, 3).rows.length === 0 && B.resolveBoardLayout(L, 1).rows.length === 0)
check('PageBoard stretches every row cell to its row and grows its last section; columns keep their own height', (() => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/shared/ui/PageBoard.tsx'), 'utf8')
  return src.includes("const ROW_CELL = 'gap-4 self-stretch [&>:last-child]:grow'") && src.includes('className={ROW_CELL}')
    && src.includes('className="grid items-start gap-4"') && src.includes('sections={sections} className="gap-4"')
})())
check('the `fill` column option is gone (rows replaced it)', !('fill' in B.resolveBoardLayout(L, 3).columns[0])
  && !/\bfill\?:/.test(require('fs').readFileSync(require('path').join(__dirname, '../src/shared/ui/pageBoardRules.ts'), 'utf8')))
check('span below 1 is clamped', B.resolveBoardLayout({ 1: ['a'], 2: { columns: [{ stack: ['a'], span: 0 }, []] } }, 2).columns[0].span === 1)
check('main defaults to 56rem, a layout can lower it', B.resolveBoardLayout(L, 3).main === '56rem'
  && B.resolveBoardLayout({ 1: ['a'], 2: { main: '40rem', columns: [['a'], []] } }, 2).main === '40rem')
check('keysAt reads top → columns → bottom', eq(B.keysAt({ 1: ['x'], 2: { top: ['t'], columns: [['a'], ['b']], bottom: ['z'] } }, 2), ['t', 'a', 'b', 'z']))
check('keysAt reads rows top to bottom, each left to right', eq(B.keysAt({ 1: ['x'], 2: { top: ['t'], rows: [[['a'], ['b']], [['c', 'd'], ['e']]], bottom: ['z'] } }, 2), ['t', 'a', 'b', 'c', 'd', 'e', 'z']))

console.log('validateBoardLayouts')
check('a good layout has no problems', B.validateBoardLayouts(L, ['a', 'b', 'c']).length === 0)
check('columns must cover exactly the step', B.validateBoardLayouts({ 1: ['a'], 3: { columns: [['a'], ['b']] } }).some(p => /cover 2 tracks, expected 3/.test(p)))
check('a section placed twice is caught', B.validateBoardLayouts({ 1: ['a', 'a'] }).some(p => /placed twice/.test(p)))
check('an unknown section is caught', B.validateBoardLayouts({ 1: ['q'] }, ['a']).some(p => /unknown section "q"/.test(p)))
check('an empty wide step is caught', B.validateBoardLayouts({ 1: ['a'], 2: {} }).some(p => /nothing placed/.test(p)))
check('bands alone are a valid wide step', B.validateBoardLayouts({ 1: ['a', 'b'], 2: { top: ['a'], bottom: ['b'] } }).length === 0)
check('rows alone are a valid wide step', B.validateBoardLayouts(R, ['a', 'b', 'c']).length === 0)
check('each row must cover exactly the step', B.validateBoardLayouts({ 1: ['a', 'b', 'c'], 2: { rows: [[['a'], ['b']], [['c']]] } }).some(p => /row 2 covers 1 tracks, expected 2/.test(p)))
check('an empty row is caught', B.validateBoardLayouts({ 1: ['a'], 2: { rows: [[]] } }).some(p => /row 1 covers 0 tracks/.test(p)))
check('columns and rows together are caught', B.validateBoardLayouts({ 1: ['a', 'b', 'c'], 2: { columns: [['a'], ['b']], rows: [[{ stack: ['c'], span: 2 }]] } }).some(p => /columns and rows together/.test(p)))
check('a section placed twice across rows is caught', B.validateBoardLayouts({ 1: ['a', 'b'], 2: { rows: [[['a'], ['b']], [{ stack: ['a'], span: 2 }]] } }).some(p => /"a" placed twice/.test(p)))

console.log('Home layout')
check('Home layout is valid', B.validateBoardLayouts(HOME_BOARD, HOME_SECTIONS).length === 0, B.validateBoardLayouts(HOME_BOARD, HOME_SECTIONS).join('; '))
check('Home split layout is valid', B.validateBoardLayouts(HOME_BOARD_SPLIT, HOME_SECTIONS).length === 0, B.validateBoardLayouts(HOME_BOARD_SPLIT, HOME_SECTIONS).join('; '))
for (const [name, board] of [['', HOME_BOARD], ['split ', HOME_BOARD_SPLIT]]) {
  for (const s of [1, 2, 3, 4]) {
    const keys = B.keysAt(board, s)
    const glanceOk = Object.values(HOME_GLANCE).every(alts => alts.some(k => keys.includes(k)))
    check(`${name}step ${s}: brief, now/next, tasks, transit, news and all six glance widgets are reachable`,
      // `pair` renders the week (hero) and the tasks side by side.
      ['brief', 'transit', 'news'].every(k => keys.includes(k))
        && (keys.includes('pair') || ['hero', 'tasks'].every(k => keys.includes(k))) && glanceOk)
    check(`${name}step ${s}: a widget never shows beside its own tile, and no tile shows twice`,
      !(keys.some(k => TILE_SECTIONS.includes(k)) && keys.some(k => HOME_GLANCE[k]))
        && !(keys.includes('tiles') && (keys.includes('weatherTile') || keys.includes('glanceRow'))))
  }
}
console.log('Home split laptop layout (owner, 08.10.2026: no hole between the columns; 14.10.2026 and 16.10.2026: cards that line up)')
check('split step 2: row 1 = brief | transit; row 2 = week | tasks (pair) | weather (large) (owner, 16.10.2026)', (() => {
  const l = B.resolveBoardLayout(HOME_BOARD_SPLIT, 2)
  return eq(l.rows.map(r => r.map(c => [c.stack, c.span])), [[[['brief'], 1], [['transit'], 1]], [[['pair'], 1], [['weatherTile'], 1]]])
})())
check('split step 2: no independent column stacks — every card above the glance row is in a row, so tops and bottoms come from the grid, never from content heights',
  B.resolveBoardLayout(HOME_BOARD_SPLIT, 2).columns.length === 0)
check('split step 2: transit and the week/tasks are in different rows, so a tall transit stretches only the brief',
  (rows => rows.findIndex(r => r.some(c => c.stack.includes('transit'))) !== rows.findIndex(r => r.some(c => c.stack.includes('pair'))))(B.resolveBoardLayout(HOME_BOARD_SPLIT, 2).rows))
check('split step 2: the glance row starts under both rows, then news', eq(B.resolveBoardLayout(HOME_BOARD_SPLIT, 2).bottom, ['glanceRow', 'news']))
check('HomePage.tsx: the pair stretches with its row cell, and the week and the tasks with it (h-full)', (() => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/features/home/pages/HomePage.tsx'), 'utf8')
  const pair = src.slice(src.indexOf('function HeroAndTasks'), src.indexOf('function HomeNews'))
  return pair.includes('grid h-full') && pair.includes('[&>*]:h-full')
})())
check('the glance row lies on the split board\'s own tracks (money · watched · books · games under main, training under the side)', (() => {
  const l = B.resolveBoardLayout(HOME_BOARD_SPLIT, 2)
  return H.GLANCE_ROW_TEMPLATE === B.boardTemplate(l.tracks, l.main, l.lead)
})())
check('HomePage.tsx: the row puts money, watched, books, games in the main track and the large training tile in the side track', (() => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/features/home/pages/HomePage.tsx'), 'utf8')
  const row = src.slice(src.indexOf('function GlanceRow'), src.indexOf('function HeroAndTasks'))
  const order = ['<CurrencyTile />', '<RecentMediaTile />', '<BooksTile />', '<GamesTile />', '<TrainingTile large />'].map(t => row.indexOf(t))
  return row.includes('gridTemplateColumns: GLANCE_ROW_TEMPLATE') && row.includes('className="grid gap-4"') && order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]))
    && src.includes('weatherTile: <WeatherTile large />')
})())
check('the split changes step 2 only', [1, 3, 4].every(s => JSON.stringify(B.resolveBoardLayout(HOME_BOARD_SPLIT, s)) === JSON.stringify(B.resolveBoardLayout(HOME_BOARD, s))))
check('a 1280px laptop (61.5rem: main 36.5rem, week and tasks stacked) keeps all six tiles beside them', H.homeBoardFor(61.5) === HOME_BOARD)
check('just below 69rem (main 43.9rem) still stacked → all six beside', H.homeBoardFor(68.9) === HOME_BOARD)
check('from 69rem (main 44rem, week and tasks side by side) the tiles split', H.homeBoardFor(69) === HOME_BOARD_SPLIT)
check('1469 / 1795 laptops and 1920 with the sidebar open (≈ 73.6 / 91.7 / 99.9rem) split', [73.6, 91.7, 99.9].every(w => H.homeBoardFor(w) === HOME_BOARD_SPLIT))
check('phones, tablets and the 3- and 4-column steps use the board as before', [30, 59.9, 100, 128, 150].every(w => H.homeBoardFor(w) === HOME_BOARD) && H.homeBoardFor(null) === HOME_BOARD)
console.log('Home tile groups (GLANCE_GROUP_GRID)')
const G = H.GLANCE_GROUP_GRID
const colsOf = cls => cls.split(' ').filter(c => /grid-cols-/.test(c))
check('row (money, watched, books, games): 2 across, one row of 4 from 40rem', eq(colsOf(G.row), ['grid-cols-2', '@[40rem]:grid-cols-4']))
check('row: the board\'s 1rem gap, so the four tiles\' edges line up with the week\'s and the tasks\' (gap-4)', G.row.split(' ').includes('gap-4'))
check('the split starts at a main track wide enough for the row of 4 (44rem ≥ 40rem)',
  H.PAIR_SIDE_BY_SIDE_REM >= Number(G.row.match(/@\[(\d+)rem\]:grid-cols-4/)[1]))
check('all six (phone, 1280 side column): 2 across, 3 from 36rem', eq(colsOf(G.all), ['grid-cols-2', '@[36rem]:grid-cols-3']))
check('a 24rem side column (1280) keeps the six 2 across', 24 < Number(G.all.match(/@\[(\d+)rem\]:grid-cols-3/)[1]))
check('HomePage.tsx lays the groups out with GLANCE_GROUP_GRID', (() => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/features/home/pages/HomePage.tsx'), 'utf8')
  return src.includes('GLANCE_GROUP_GRID.all') && src.includes('GLANCE_GROUP_GRID.row')
    && !/grid-cols-\d/.test(src.slice(src.indexOf('function GlanceTiles'), src.indexOf('function HeroAndTasks')))
})())
check('the pair\'s container query in HomePage.tsx is the split\'s breakpoint', (() => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/features/home/pages/HomePage.tsx'), 'utf8')
  return src.includes(`@[${H.PAIR_SIDE_BY_SIDE_REM}rem]:grid-cols-2`)
})())
check('step 1 keeps the phone order (brief → hero → tasks → transit → tiles → news)', eq(HOME_BOARD[1], ['brief', 'hero', 'tasks', 'transit', 'tiles', 'news']))
check('step 2 (laptop) uses compact tiles, the owner\'s call', B.keysAt(HOME_BOARD, 2).includes('tiles'))
check('main column is brief → (week | tasks side by side) from step 2 up', [2, 3, 4].every(s => eq(B.resolveBoardLayout(HOME_BOARD, s).columns[0].stack, ['brief', 'pair'])))
check('step 3: weather column ends with games, the page-card column with books', (() => {
  const c = B.resolveBoardLayout(HOME_BOARD, 3).columns
  return eq(c[1].stack, ['weather', 'transit', 'currency', 'games']) && eq(c[2].stack, ['training', 'media', 'books'])
})())
check('news is a full-width band under the columns from step 2 up (owner, 07.10.2026), never in a column',
  [2, 3, 4].every(s => {
    const l = B.resolveBoardLayout(HOME_BOARD, s)
    return eq(l.bottom, ['news']) && l.columns.every(c => !c.stack.includes('news')) && H.newsIsBand(s)
  }) && !H.newsIsBand(1))
check('news is last on the phone (a list) and lists more headlines as the band widens',
  HOME_BOARD[1][HOME_BOARD[1].length - 1] === 'news' && H.newsRows(1) === 8 && H.newsRows(2) < H.newsRows(3) && H.newsRows(3) < H.newsRows(4))

console.log('Daily layouts')
for (const [name, board, known] of [['Day', D.DAY_BOARD, D.DAY_SECTIONS], ['Week', D.WEEK_BOARD, D.PICKER_SECTIONS], ['Month', D.MONTH_BOARD, D.PICKER_SECTIONS], ['Tasks', D.TASKS_BOARD, D.TASK_SECTIONS], ['Diary', D.DIARY_BOARD, D.DIARY_SECTIONS]]) {
  const problems = B.validateBoardLayouts(board, known)
  check(`${name} layout is valid`, problems.length === 0, problems.join('; '))
}
for (const s of [1, 2, 3, 4]) {
  const keys = B.keysAt(D.DAY_BOARD, s)
  check(`Day step ${s}: schedule and glance board both shown`, keys.includes('hero') && keys.includes('glance'))
}
check('Day: the quick rail only where there is room (steps 3–4)', !B.keysAt(D.DAY_BOARD, 1).includes('rail') && !B.keysAt(D.DAY_BOARD, 2).includes('rail')
  && B.keysAt(D.DAY_BOARD, 3).includes('rail') && B.keysAt(D.DAY_BOARD, 4).includes('rail'))
check('Day step 4: the glance board sits beside the schedule (owner\'s call)', (() => {
  const l = B.resolveBoardLayout(D.DAY_BOARD, 4)
  return l.columns.length === 2 && l.columns[0].stack.includes('hero') && eq(l.columns[1].stack, ['glance']) && l.columns[1].span === 3
})())
// TodaySummary's own columns (36 / 55rem) at the width the board gives it — six cards, so never a fourth.
const glanceCols = (px) => px >= 55 * 16 ? 3 : px >= 36 * 16 ? 2 : 1
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/features/daily/components/TodaySummary.tsx'), 'utf8')
  check('glance board: no old Nutrition card on Personal (owner, 16.10.2026 — food is the summary band since 26.10.2026) and no fourth column', !/NutritionCard/.test(src) && !/grid-cols-4/.test(src))
}
check('glance board: 1 column on a phone', glanceCols(W.phone) === 1)
check('glance board: 2 on a 768 tablet and a landscape phone', glanceCols(W.tablet) === 2 && glanceCols(852 - 48) === 2)
check('glance board: 3 on a 1024 tablet', glanceCols(W.tablet1024) === 3)
check('glance board: 3 on a 1280 laptop', glanceCols(W.laptop1280) === 3)
check('glance board: 3 at 1469 (full width)', glanceCols(W.laptop) === 3)
check('glance board: 3 at 1920 (full width under hero + rail: six cards in two full rows)', glanceCols(W.fhd) === 3)
check('glance board: 3 beside the schedule at 2450', glanceCols(B.columnWidthPx(W.monitor, { tracks: 4, main: '56rem' }, 1, 3)) === 3)
check('glance heading hidden only where the board sits beside the hero (step 4)', [1, 2, 3].every(s => !D.glanceInColumn(s)) && D.glanceInColumn(4))
// DayHero's split: the day list's timed column | Anytime from a 54rem card; stacked below.
const heroSplits = (px) => px >= 54 * 16
check('hero: a landscape phone (804px card) stacks; a 1024 tablet (892px) splits', !heroSplits(852 - 48) && heroSplits(W.tablet1024))
check('hero: splits wherever the board places it from step 2 (full band at 1280, two tracks at 1920, main at 2450)',
  heroSplits(W.laptop1280) && heroSplits(B.columnWidthPx(W.fhd, { tracks: 3, main: '56rem' }, 0, 2)) && heroSplits(B.columnWidthPx(W.monitor, { tracks: 4, main: '56rem' }, 0, 1)))
for (const [name, board] of [['Week', D.WEEK_BOARD], ['Month', D.MONTH_BOARD]]) {
  check(`${name}: the picker is always shown`, [1, 2, 3, 4].every(s => B.keysAt(board, s).includes('picker') || B.keysAt(board, s).includes('pair')))
  check(`${name}: steps 3–4 show the picked day AND upcoming together`, [3, 4].every(s => ['picked', 'upcoming'].every(k => B.keysAt(board, s).includes(k))))
  check(`${name}: picker track capped at 40rem`, [2, 3, 4].every(s => B.resolveBoardLayout(board, s).main === '40rem'))
  check(`${name} at 2450: at most one side track left empty`, W.monitor - fill(W.monitor, 4, '40rem') <= 384, `left ${W.monitor - fill(W.monitor, 4, '40rem')}px`)
}
const groupsAt = (s) => B.keysAt(D.TASKS_BOARD, s).flatMap(k => D.TASK_SECTION_GROUPS[k])
for (const s of [1, 2, 3, 4]) {
  const g = groupsAt(s)
  check(`Tasks step ${s}: all six groups, each exactly once`, g.length === 6 && new Set(g).size === 6)
}
check('Tasks: groups read left to right by time from step 2', [2, 3, 4].every(s => eq(groupsAt(s), ['overdue', 'openNow', 'today', 'upcoming', 'noDate', 'done'])))

console.log('boardWidthRem (page headers stop where the board stops)')
check('one track → no cap', B.boardWidthRem(D.WEEK_BOARD, 1) === null && B.boardWidthRem(HOME_BOARD, 1) === null)
check('Week/Month: 40rem picker + one side = 65rem; + three sides = 115rem', [D.WEEK_BOARD, D.MONTH_BOARD].every(b => B.boardWidthRem(b, 2) === 65 && B.boardWidthRem(b, 4) === 115))
check('Tasks: 42rem main → 67 / 92 / 117rem', B.boardWidthRem(D.TASKS_BOARD, 2) === 67 && B.boardWidthRem(D.TASKS_BOARD, 3) === 92 && B.boardWidthRem(D.TASKS_BOARD, 4) === 117)
check('Day at step 4 is the full 131rem board', B.boardWidthRem(D.DAY_BOARD, 4) === B.BOARD_MAX_REM)
check('a non-rem main cap gives no cap', B.boardWidthRem({ 1: ['a'], 2: { main: '50%', columns: [['a'], []] } }, 2) === null)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
