#!/usr/bin/env node
/* Verification — the PageBoard layouts of Media, Work, Projects (detail) and
 * Developer (Connections + the list/detail tabs), and the list/detail pane's
 * selection rule. Runs the real modules through sucrase (no test framework).
 * Run: node scripts/verify-feature-boards.cjs */
require('sucrase/register')
const B = require('../src/shared/ui/pageBoardRules')
const M = require('../src/features/media/mediaBoard')
const Wk = require('../src/features/work/workBoard')
const P = require('../src/features/projects/projectBoard')
const D = require('../src/features/developer/developerBoards')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const STEPS = [1, 2, 3, 4]
const keys = (layout, s) => B.keysAt(layout, s)
/** The index of the column (0 = main) a section sits in at a step, 'band' for top/bottom, -1 if absent. */
function columnOf(layout, s, key) {
  const l = B.resolveBoardLayout(layout, s)
  if (l.top.includes(key) || l.bottom.includes(key)) return 'band'
  return l.columns.findIndex(c => c.stack.includes(key))
}
// Page content widths: viewport − sidebar − gutters, never past the 131rem board (PageContainer's cap).
const CAP = B.BOARD_MAX_REM * 16
const W = { laptop1280: 984, laptop: 1173, fhd: 1624, monitor: Math.min(2154, CAP) }
/** px a declared layout leaves empty at a page width (its tracks never grow past their caps). */
function emptyAt(layout, px) {
  const s = B.pageStepForWidth(px)
  const l = B.resolveBoardLayout(layout, s)
  return px - B.columnWidthPx(px, l, 0, l.tracks)
}
const ONE_TRACK = (B.BOARD.side + B.BOARD.gap) * 16   // a side track and its gap

console.log('every layout is valid')
for (const [name, layout, known] of [
  ['Media', M.MEDIA_BOARD, M.MEDIA_SECTIONS],
  ['Work board', Wk.WORK_BOARD, Wk.WORK_SECTIONS],
  ['Work board, rail hidden', Wk.WORK_BOARD_RAIL_HIDDEN, Wk.WORK_SECTIONS],
  ['Work list', Wk.WORK_LIST, Wk.WORK_SECTIONS],
  ['Project detail', P.PROJECT_BOARD, P.PROJECT_SECTIONS],
  ['Developer list + detail', D.LIST_DETAIL_BOARD, D.LIST_DETAIL_SECTIONS],
  ['Connections', D.CONNECTIONS_BOARD, D.CONNECTION_SECTIONS],
]) {
  const problems = B.validateBoardLayouts(layout, known)
  check(`${name}: no problems`, problems.length === 0, problems.join('; '))
}

console.log('Media')
check('step 1 keeps the phone order (library → Discover → tools)', eq(M.MEDIA_BOARD[1], ['library', 'discovery', 'tools']))
for (const s of STEPS) {
  const k = keys(M.MEDIA_BOARD, s)
  const tools = k.includes('tools') || ['tonight', 'calendar', 'stats'].every(t => k.includes(t))
  check(`step ${s}: library, Discover and all three tools are on the page`, k.includes('library') && k.includes('discovery') && tools)
  check(`step ${s}: the combined tools grid and the single tools never both mount`, !(k.includes('tools') && k.includes('tonight')))
}
check('library sits above Discover in one column at every step', STEPS.every(s => {
  const c = columnOf(M.MEDIA_BOARD, s, 'library')
  const st = B.resolveBoardLayout(M.MEDIA_BOARD, s).columns[c]?.stack ?? []
  return c === columnOf(M.MEDIA_BOARD, s, 'discovery') && st.indexOf('library') < st.indexOf('discovery')
}))
check('from 1920 the main cards span two tracks (more poster columns, never wider posters)', [3, 4].every(s => B.resolveBoardLayout(M.MEDIA_BOARD, s).columns[0].span === 2))
check('the tools open by default only where they get columns of their own', M.MEDIA_TOOLS_OPEN_FROM === 4
  && B.resolveBoardLayout(M.MEDIA_BOARD, 4).columns.length === 3)
check('laptop and 1920: the tools column is sticky', [2, 3].every(s => B.resolveBoardLayout(M.MEDIA_BOARD, s).columns.at(-1).sticky))

console.log('Work')
/** The work is on the page exactly once: as `work`, or as `head` + `list` — never both shapes. */
const workShape = (layout, s) => {
  const k = keys(layout, s)
  if (k.includes('work')) return !k.includes('head') && !k.includes('list') ? 'work' : 'both'
  return k.includes('head') && k.includes('list') ? 'split' : 'none'
}
for (const [name, layout] of [['board', Wk.WORK_BOARD], ['board, rail hidden', Wk.WORK_BOARD_RAIL_HIDDEN], ['list', Wk.WORK_LIST]]) {
  check(`${name}: the work is on the page once at every step`, STEPS.every(s => ['work', 'split'].includes(workShape(layout, s))), STEPS.map(s => workShape(layout, s)).join(','))
}
check('board: the work is one stack (strips, toolbar, board) at every step', STEPS.every(s => workShape(Wk.WORK_BOARD, s) === 'work' && workShape(Wk.WORK_BOARD_RAIL_HIDDEN, s) === 'work'))
check('list: rail at every step', STEPS.every(s => keys(Wk.WORK_LIST, s).includes('rail')))
check('phones and tablets keep one stack (work, then rail) in both views', eq(Wk.WORK_BOARD[1], ['work', 'rail']) && eq(Wk.WORK_LIST[1], ['work', 'rail']))
{
  const rows = (layout, s) => columnOf(layout, s, keys(layout, s).includes('list') ? 'list' : 'work')
  check('board: the rail sits beside the work exactly from step 3', STEPS.every(s => (columnOf(Wk.WORK_BOARD, s, 'rail') !== columnOf(Wk.WORK_BOARD, s, 'work')) === (s >= 3)))
  check('list: the rail sits beside the rows exactly from step 2', STEPS.every(s => (columnOf(Wk.WORK_LIST, s, 'rail') !== rows(Wk.WORK_LIST, s)) === (s >= 2)))
  check('list: from the laptop up the strips and the toolbar span the whole board above rows and rail (one toolbar line at 1280)',
    [2, 3, 4].every(s => columnOf(Wk.WORK_LIST, s, 'head') === 'band' && eq(B.resolveBoardLayout(Wk.WORK_LIST, s).top, ['head'])))
  const toolbar = 170 + 224 + 224 + 140 + 3 * 8   // view switch, quick add (min), search, priority, gaps
  check('1280: the head band is wide enough for the toolbar on one line', B.columnWidthPx(W.laptop1280, B.resolveBoardLayout(Wk.WORK_LIST, 2), 0, 2) >= toolbar)
}
check('"Hide side panel": Board view from step 3, never in List view', Wk.railToggleFrom('board') === 3 && Wk.railToggleFrom('list') === null)
check('board: hiding the rail only hides it where it sits beside the work', STEPS.every(s => keys(Wk.WORK_BOARD_RAIL_HIDDEN, s).includes('rail') === (s < 3)))
check('workLayout: board follows the toggle, list ignores it', Wk.workLayout('board', true) === Wk.WORK_BOARD && Wk.workLayout('board', false) === Wk.WORK_BOARD_RAIL_HIDDEN
  && Wk.workLayout('list', true) === Wk.WORK_LIST && Wk.workLayout('list', false) === Wk.WORK_LIST)
{
  // The kanban has four columns of at most 28rem (+ 0.75rem gaps): it must fill its span, never leave a gap before the rail.
  const boardMax = 4 * 28 * 16 + 3 * 12
  const l4 = B.resolveBoardLayout(Wk.WORK_BOARD, 4)
  const span4 = B.columnWidthPx(W.monitor, l4, 0, l4.columns[0].span)
  check('2450: the board span (1696px) is narrower than four 28rem columns, so the board fills it', span4 === 1696 && span4 <= boardMax, `span ${span4}`)
  const l3 = B.resolveBoardLayout(Wk.WORK_BOARD, 3)
  const span3 = B.columnWidthPx(W.fhd, l3, 0, l3.columns[0].span)
  check('1920: four board columns stay ≥ 18rem', (span3 - 36) / 4 >= 18 * 16, `column ${(span3 - 36) / 4}px`)
  const l2 = B.resolveBoardLayout(Wk.WORK_BOARD, 2)
  check('1280: the board keeps the full width (≥ 14rem columns) with the rail below', l2.columns[0].span === 2
    && (B.columnWidthPx(W.laptop1280, l2, 0, 2) - 36) / 4 >= 14 * 16)
  check('list view: rows never wider than the 56rem main track', STEPS.every(s => {
    const l = B.resolveBoardLayout(Wk.WORK_LIST, s)
    const c = l.columns.find(col => col.stack.includes('list') || col.stack.includes('work'))
    return l.tracks === 1 || (c && c.span === 1)
  }))
  check('list view stops at three tracks', B.resolveBoardLayout(Wk.WORK_LIST, 4).tracks === 3)
}
check('header cap: none on one track, 106rem for the list at 2450 (it stops at three tracks), 131rem for the board',
  Wk.workHeaderCapRem('list', true, 1) === null && Wk.workHeaderCapRem('list', true, 4) === 106 && Wk.workHeaderCapRem('list', false, 4) === 106
  && Wk.workHeaderCapRem('board', true, 4) === 131 && Wk.workHeaderCapRem('board', false, 4) === 131)

console.log('Project detail')
check('step 1 keeps the phone order', eq(P.PROJECT_BOARD[1], ['back', 'header', 'controls', 'items', 'notes', 'activity']))
check('every step shows all six sections', STEPS.every(s => P.PROJECT_SECTIONS.every(k => keys(P.PROJECT_BOARD, s).includes(k))))
check('header → controls → items stay one stack in that order', STEPS.slice(1).every(s => eq(B.resolveBoardLayout(P.PROJECT_BOARD, s).columns[0].stack, ['header', 'controls', 'items'])))
check('notes and activity keep the last track from the laptop up', [2, 3, 4].every(s => {
  const l = B.resolveBoardLayout(P.PROJECT_BOARD, s)
  return eq(l.columns.at(-1).stack, ['notes', 'activity']) && l.columns.at(-1).span === 1
}))
{
  const spanRem = (px, s) => { const l = B.resolveBoardLayout(P.PROJECT_BOARD, s); return B.columnWidthPx(px, l, 0, l.columns[0].span) / 16 }
  const cardRem = (w) => (w - (P.phaseColumnCount(w) - 1) * 0.75) / P.phaseColumnCount(w)
  const at = { laptop1280: spanRem(W.laptop1280, 2), laptop: spanRem(W.laptop, 2), fhd: spanRem(W.fhd, 3), monitor: spanRem(W.monitor, 4) }
  check('phase columns: 1280 and 1469 one, 1920 two, 2450 three', P.phaseColumnCount(at.laptop1280) === 1 && P.phaseColumnCount(at.laptop) === 1
    && P.phaseColumnCount(at.fhd) === 2 && P.phaseColumnCount(at.monitor) === 3, JSON.stringify(at))
  check('a phase card stays ≥ 30rem wherever it shares the width (item titles stay readable)',
    [61, 70, 91.99, 92, 106, 131].every(w => cardRem(w) >= 30), [61, 92].map(cardRem).join(' / '))
  check('a column count never drops as the area widens', [20, 40, 60.9, 61, 80, 92, 140].every((w, i, a) => i === 0 || P.phaseColumnCount(w) >= P.phaseColumnCount(a[i - 1])))
  check('a non-finite width → one column', P.phaseColumnCount(NaN) === 1 && P.phaseColumnCount(Infinity) === 1)
  check('dealByIndex: phase i → column i mod n, reading across then down',
    eq(P.dealByIndex(['a', 'b', 'c', 'd', 'e'], 3), [['a', 'd'], ['b', 'e'], ['c']]) && eq(P.dealByIndex(['a', 'b'], 1), [['a', 'b']]))
  check('dealByIndex: "Add phase" (the next item) lands where the next phase will appear',
    P.dealByIndex(['p1', 'p2', 'p3', 'p4', 'add'], 3)[4 % 3].at(-1) === 'add')
  check('dealByIndex: more columns than items leaves the extra columns empty; 0/NaN columns → one',
    eq(P.dealByIndex(['a'], 3), [['a'], [], []]) && eq(P.dealByIndex(['a', 'b'], 0), [['a', 'b']]) && eq(P.dealByIndex(['a'], NaN), [['a']]))
}

console.log('Project list header')
check('four cards at 2450: the header stops over the fourth card (91rem)', P.projectsHeaderCapRem(4, 2154 / 16) === 91)
check('ten cards at 2450: over the fifth (the row holds five)', P.projectsHeaderCapRem(10, 2154 / 16) === 114)
check('a tablet row that holds one card: over that card (22rem)', P.projectsHeaderCapRem(4, 652 / 16) === 22)
check('cards filling the row exactly, or no cards: no cap', P.projectsHeaderCapRem(2, 45) === null && P.projectsHeaderCapRem(0, 100) === null && P.projectsHeaderCapRem(3, NaN) === null)

console.log('Developer · list + detail')
check('phones and tablets: no pane (rows open in place)', !keys(D.LIST_DETAIL_BOARD, 1).includes('detail') && eq(D.LIST_DETAIL_BOARD[1], ['toolbar', 'list']))
check(`from step ${D.DETAIL_PANE_FROM}: the pane is beside the list and sticky`, [2, 3, 4].every(s => {
  const l = B.resolveBoardLayout(D.LIST_DETAIL_BOARD, s)
  const pane = l.columns.find(c => c.stack.includes('detail'))
  return s >= D.DETAIL_PANE_FROM && pane && pane.sticky && columnOf(D.LIST_DETAIL_BOARD, s, 'list') === 0
}))
check('the toolbar heads the list column wherever there is a pane (it only acts on the list)', [2, 3, 4].every(s =>
  eq(B.resolveBoardLayout(D.LIST_DETAIL_BOARD, s).columns[0].stack, ['toolbar', 'list'])))
check('the pane widens to two tracks from 1920 and stops there', B.resolveBoardLayout(D.LIST_DETAIL_BOARD, 3).columns[1].span === 2
  && B.resolveBoardLayout(D.LIST_DETAIL_BOARD, 4).tracks === 3)
check('2450: it leaves at most one side track (and its gap) empty', emptyAt(D.LIST_DETAIL_BOARD, W.monitor) <= ONE_TRACK, `${emptyAt(D.LIST_DETAIL_BOARD, W.monitor)}px`)

console.log('paneSelection')
check('keeps the picked row while it is listed', D.paneSelection(['a', 'b', 'c'], 'b') === 'b')
check('no pick → the first row', D.paneSelection(['a', 'b'], null) === 'a')
check('a picked row a filter hid → the first listed row', D.paneSelection(['c', 'd'], 'b') === 'c')
check('an empty list → nothing', D.paneSelection([], 'b') === null && D.paneSelection([], null) === null)

console.log('Developer · Connections')
const CARDS = ['google', 'strava', 'psn', 'steam', 'hevy', 'health']
const GROUPS = { serverCards: ['steam', 'hevy', 'health'] }
check('step 1 keeps the phone order', eq(D.CONNECTIONS_BOARD[1], ['intro', ...CARDS]))
for (const s of STEPS) {
  const k = keys(D.CONNECTIONS_BOARD, s)
  const shown = k.flatMap(key => GROUPS[key] ?? [key]).filter(x => CARDS.includes(x))
  check(`step ${s}: each of the six cards exactly once`, eq([...shown].sort(), [...CARDS].sort()), shown.join(','))
}
check('laptop: your accounts in main, the server-side ones beside them, each under a label',
  eq(B.resolveBoardLayout(D.CONNECTIONS_BOARD, 2).columns.map(c => c.stack), [['accountsLabel', 'google', 'strava', 'psn'], ['serverLabel', 'steam', 'hevy', 'health']]))
check('from the laptop up the PlayStation card (tall with its npsso form) is in a column stack, never a row beside shorter cards',
  [2, 3, 4].every(s => eq(B.resolveBoardLayout(D.CONNECTIONS_BOARD, s).columns[0].stack, ['accountsLabel', 'google', 'strava', 'psn'])))
check('1920 and 2450: accounts in a 42rem main, the server-side cards over every other track', [3, 4].every(s => {
  const l = B.resolveBoardLayout(D.CONNECTIONS_BOARD, s)
  return l.tracks === s && l.main === '42rem' && eq(l.columns[1].stack, ['serverLabel', 'serverCards']) && l.columns[1].span === s - 1
}))
{
  // serverCards: auto-fill 19–22rem cards, 1rem gap → as many as fit at 22rem.
  const perRow = (px) => Math.max(1, Math.floor((px / 16 + 1) / 23))
  const serverSpan = (px, s) => { const l = B.resolveBoardLayout(D.CONNECTIONS_BOARD, s); return B.columnWidthPx(px, l, 1, l.columns[1].span) }
  check('server-side cards: two across at 1920, all three in one row at 2450', perRow(serverSpan(W.fhd, 3)) === 2 && perRow(serverSpan(W.monitor, 4)) === 3,
    `${serverSpan(W.fhd, 3)} / ${serverSpan(W.monitor, 4)}px`)
}
check('header caps: 106rem over the list + detail tabs at 2450, 117rem over Connections (42rem main + three tracks), none on phones',
  B.boardWidthRem(D.LIST_DETAIL_BOARD, 4) === 106 && B.boardWidthRem(D.CONNECTIONS_BOARD, 4) === 117 && B.boardWidthRem(D.LIST_DETAIL_BOARD, 1) === null)

console.log('the default views fill the width (W6)')
for (const [name, layout] of [['Media', M.MEDIA_BOARD], ['Work', Wk.WORK_BOARD], ['Project detail', P.PROJECT_BOARD], ['Connections', D.CONNECTIONS_BOARD]]) {
  check(`${name}: nothing empty at 1469, at most one track at 2450`, emptyAt(layout, W.laptop) === 0 && emptyAt(layout, W.monitor) <= ONE_TRACK,
    `${emptyAt(layout, W.laptop)} / ${emptyAt(layout, W.monitor)}px`)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
