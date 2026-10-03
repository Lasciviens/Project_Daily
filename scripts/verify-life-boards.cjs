#!/usr/bin/env node
/* Verification — the PageBoard layouts of Food, Wishes, Health and Training
 * (src/features/{recipes,wishes,health,training}/*Boards.ts) and the `lead`
 * option they use (a rail placed before the main track, pageBoardRules.ts).
 * Run: node scripts/verify-life-boards.cjs */
require('sucrase/register')
const B = require('../src/shared/ui/pageBoardRules')
const F = require('../src/features/recipes/foodBoards')
const Wi = require('../src/features/wishes/wishesBoard')
const H = require('../src/features/health/healthBoards')
const T = require('../src/features/training/trainingBoards')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const rem = 16

// Page content widths: viewport − sidebar − 2 × gutter (CLAUDE.md reference sizes).
const W = { laptop1280: 1280 - 232 - 64, laptop: 1469 - 232 - 64, fhd: 1920 - 232 - 64, monitor: 2450 - 232 - 64 }

/** Width the board's tracks take at a page width (what is left over is empty). */
function boardWidth(px, layouts, step) {
  const l = B.resolveBoardLayout(layouts, step)
  if (l.tracks === 1) return px
  return B.columnWidthPx(px, l, 0, l.tracks)
}
const emptyAt = (px, layouts) => px - boardWidth(px, layouts, B.pageStepForWidth(px))

console.log('lead: side tracks before main')
check('template without lead is unchanged', B.boardTemplate(3) === 'minmax(0,56rem) repeat(2,24rem)')
check('lead 1 of 2 tracks: rail then main', B.boardTemplate(2, '56rem', 1) === 'repeat(1,24rem) minmax(0,56rem)')
check('lead 1 of 4 tracks: rail, main, two sides', B.boardTemplate(4, '56rem', 1) === 'repeat(1,24rem) minmax(0,56rem) repeat(2,24rem)')
check('lead is clamped to tracks − 1', B.boardTemplate(2, '56rem', 5) === 'repeat(1,24rem) minmax(0,56rem)')
check('resolve carries lead, clamped', B.resolveBoardLayout({ 1: ['a'], 2: { lead: 1, columns: [['a'], []] } }, 2).lead === 1
  && B.resolveBoardLayout({ 1: ['a'], 2: { lead: 3, columns: [['a'], []] } }, 2).lead === 1)
check('step 1 has no lead', B.resolveBoardLayout({ 1: ['a'] }, 1).lead === 0)
check('validate rejects a lead that leaves no main track', B.validateBoardLayouts({ 1: ['a'], 2: { lead: 2, columns: [['a'], []] } }).some(p => /lead 2 must be 0–1/.test(p)))
check('validate accepts lead 0–(step−1)', B.validateBoardLayouts({ 1: ['a', 'b'], 4: { lead: 3, columns: [['a'], ['b'], [], []] } }).length === 0)
check('column widths follow the lead: rail 384, main 773 at 1469', B.columnWidthPx(W.laptop, { tracks: 2, main: '56rem', lead: 1 }, 0, 1) === 384
  && B.columnWidthPx(W.laptop, { tracks: 2, main: '56rem', lead: 1 }, 1, 1) === 773)
check('a column starting at main spans main + sides (2450, lead 1, span 3 = 1696px)', B.columnWidthPx(W.monitor, { tracks: 4, main: '56rem', lead: 1 }, 1, 3) === 1696)

const BOARDS = [
  ['Food · Today', F.FOOD_TODAY_BOARD, F.FOOD_TODAY_SECTIONS, true],
  ['Food · Ingredients', F.INGREDIENT_BOARD, F.INGREDIENT_SECTIONS, false],
  ['Food · Insights', F.INSIGHT_BOARD, F.INSIGHT_SECTIONS, false],
  ['Wishes', Wi.WISH_BOARD, Wi.WISH_SECTIONS, true],
  ...Object.entries(H.HEALTH_BOARDS).map(([id, b]) => [`Health · ${id}`, b.board, b.sections, id === 'overview']),
  ['Training · Next', T.NEXT_BOARD, T.NEXT_SECTIONS, true],
  ['Training · Program', T.PROGRAM_BOARD, T.PROGRAM_SECTIONS, false],
  ['Training · Progress', T.PROGRESS_BOARD, T.PROGRESS_SECTIONS, false],
  ['Training · Log', T.LOG_BOARD, T.LOG_SECTIONS, false],
  ['Training · Coach', T.COACH_BOARD, T.COACH_SECTIONS, false],
]
// Sections that live inside another card on a phone and become their own card on a wide page.
const INSIDE_ON_PHONE = { 'Health · sleep': ['breathing'], 'Health · cardio': ['recovery'], 'Health · goal': ['goals', 'protein', 'energy'] }

console.log('every layout')
for (const [name, board, sections] of BOARDS) {
  const problems = B.validateBoardLayouts(board, sections)
  check(`${name}: valid`, problems.length === 0, problems.join('; '))
  const inside = INSIDE_ON_PHONE[name] ?? []
  const everyStep = [1, 2, 3, 4].every(s => sections.every(k => B.keysAt(board, s).includes(k) || (s === 1 && inside.includes(k))))
  check(`${name}: every section placed at every step (nothing hidden by width)`, everyStep)
  // A section that lives inside another card on a phone must NOT also be its own
  // card there (the host card decides with keysAt, so placing it splits the phone view).
  if (inside.length) check(`${name}: ${inside.join(', ')} stay inside their card on a phone (absent at step 1)`, inside.every(k => !B.keysAt(board, 1).includes(k)))
}

console.log('width at the reference monitors')
for (const [name, board, , isDefault] of BOARDS) {
  // A default view must leave at most one side track (24rem) empty; every
  // other view gets the same budget here unless it documents where it stops.
  const e1469 = emptyAt(W.laptop, board), e2450 = emptyAt(W.monitor, board)
  check(`${name}${isDefault ? ' (default view)' : ''}: ≤ 24rem empty at 1469 (${e1469}px) and 2450 (${e2450}px)`, e1469 <= 24 * rem && e2450 <= 24 * rem)
}
check('the board keeps main ≥ 35rem at 1280 for every layout', BOARDS.every(([, b]) => {
  const l = B.resolveBoardLayout(b, B.pageStepForWidth(W.laptop1280))
  return l.tracks === 1 || B.columnWidthPx(W.laptop1280, l, l.lead, 1) >= 35 * rem
}))

console.log('placement rules')
const lead = (board, s) => B.resolveBoardLayout(board, s).lead
check('Food Today: the totals rail leads (left) from 1280 up', [2, 3, 4].every(s => lead(F.FOOD_TODAY_BOARD, s) === 1
  && B.resolveBoardLayout(F.FOOD_TODAY_BOARD, s).columns[0].stack[0] === 'nutrition'))
check('Food Today: the meal slots lead the main track from 1280 up', [2, 3, 4].every(s => B.resolveBoardLayout(F.FOOD_TODAY_BOARD, s).columns[1].stack[0] === 'meals'))
check('Food Today at 1280/1469: the coach sits under the slots, so the totals rail is not the only tall column', eq(B.resolveBoardLayout(F.FOOD_TODAY_BOARD, 2).columns[1].stack, ['meals', 'coach']))
check('Food Today: phone order (nutrition → water → fits → week → stats → coach → slots)', eq(F.FOOD_TODAY_BOARD[1], ['nutrition', 'water', 'fits', 'week', 'stats', 'coach', 'meals']))
check('Food Today: the nutrition stats sit right after the last 7 days at every step', [1, 2, 3, 4].every(s => { const cols = s === 1 ? [F.FOOD_TODAY_BOARD[1]] : B.resolveBoardLayout(F.FOOD_TODAY_BOARD, s).columns.map(c => c.stack); return cols.some(st => st.indexOf('stats') === st.indexOf('week') + 1 && st.includes('week')) }))
check('Ingredients + Log + Wishes: their rail is sticky and first', [F.INGREDIENT_BOARD, T.LOG_BOARD, Wi.WISH_BOARD].every(b =>
  [2, 3, 4].every(s => { const l = B.resolveBoardLayout(b, s); return l.lead === 1 && l.columns[0].sticky })))
check('Ingredients + Log + Wishes: the collection spans every other track', [F.INGREDIENT_BOARD, T.LOG_BOARD, Wi.WISH_BOARD].every(b =>
  [2, 3, 4].every(s => B.resolveBoardLayout(b, s).columns[1].span === s - 1)))
check('Wishes: the intro line stays on top at every wide step', [2, 3, 4].every(s => eq(B.resolveBoardLayout(Wi.WISH_BOARD, s).top, ['intro'])))
check('Health Overview: the six tiles lead in main at every wide step', [2, 3, 4].every(s => B.resolveBoardLayout(H.OVERVIEW_BOARD, s).columns[0].stack[0] === 'hero'))
check('Health Overview at 2450: the tiles get main + one side (three across)', B.columnWidthPx(W.monitor, B.resolveBoardLayout(H.OVERVIEW_BOARD, 4), 0, 2) >= 64 * rem)
check('Health Overview at 1469: tiles two across (main < 64rem)', B.columnWidthPx(W.laptop, B.resolveBoardLayout(H.OVERVIEW_BOARD, 2), 0, 1) < 64 * rem)
check('Health: every window keeps its main chart card in the main track', [
  [H.SLEEP_BOARD, 'sleep'], [H.ACTIVITY_BOARD, 'steps'], [H.HEART_BOARD, 'heart'], [H.BODY_BOARD, 'scale'], [H.GOAL_BOARD, 'report'], [H.CARDIO_BOARD, 'vo2'],
].every(([b, k]) => [2, 3, 4].every(s => B.resolveBoardLayout(b, s).columns[0].stack[0] === k)))
check('Health: a main chart card never spans a second track (charts ≤ 56rem, W4)', [
  [H.SLEEP_BOARD], [H.ACTIVITY_BOARD], [H.HEART_BOARD], [H.BODY_BOARD], [H.GOAL_BOARD], [H.CARDIO_BOARD],
].every(([b]) => [2, 3, 4].every(s => B.resolveBoardLayout(b, s).columns[0].span === 1)))
check('Health Activity: each tier-3 grid sits under an always-present card at 1920/2450', [3, 4].every(s => {
  const cols = B.resolveBoardLayout(H.ACTIVITY_BOARD, s).columns
  const minis = ['more', 'mobility', 'habits']
  return cols.every(c => !minis.includes(c.stack[0]))
}))
check('Training Next: the session and its context lead in the rail, the exercise cards span the rest', [2, 3, 4].every(s => {
  const l = B.resolveBoardLayout(T.NEXT_BOARD, s)
  return l.lead === 1 && eq(l.columns[0].stack, ['session', 'missed', 'recovery', 'alerts']) && l.columns[1].stack[0] === 'exercises' && l.columns[1].span === s - 1
}))
check('Training Next: phone order unchanged', eq(T.NEXT_BOARD[1], ['session', 'missed', 'recovery', 'alerts', 'exercises', 'note']))
check('Training Program: routines stack in the main column, never a band under the tallest column', [2, 3, 4].every(s => {
  const l = B.resolveBoardLayout(T.PROGRAM_BOARD, s)
  return l.bottom.length === 0 && l.columns[0].stack.includes('routines') && l.columns[0].stack[0] === 'current'
}))
check('Training Program: main stops at 42rem (its cards are capped there)', [2, 3, 4].every(s => B.resolveBoardLayout(T.PROGRAM_BOARD, s).main === '42rem'))
check('Training Progress: decisions + body map in main, summaries in the rail (1280–1920)', [2, 3].every(s => {
  const l = B.resolveBoardLayout(T.PROGRESS_BOARD, s)
  return eq(l.columns[0].stack, ['decisions', 'muscles']) && l.columns[1].stack[0] === 'improvement' && eq(l.bottom, ['charts'])
}))
check('Training Progress at 2450: table in main, body map across the next two tracks, summaries last', (() => {
  const l = B.resolveBoardLayout(T.PROGRESS_BOARD, 4)
  return eq(l.columns[0].stack, ['decisions']) && l.columns[0].span === 1 && eq(l.columns[1].stack, ['muscles']) && l.columns[1].span === 2
    && eq(l.columns[2].stack, ['improvement', 'overview', 'recency']) && eq(l.bottom, ['charts'])
})())
check('Training Progress: phone order unchanged', eq(T.PROGRESS_BOARD[1], ['improvement', 'overview', 'decisions', 'muscles', 'recency', 'charts']))

// A section that can be empty (no data yet, nothing missed) must never sit
// between two always-present cards: its empty track belongs at the far right.
const lastFilled = (cols) => [...cols].reverse().find(c => c.stack.length > 0)
check('Training Coach: the history (empty until the first assessment) takes the last filled track, one track wide', [3, 4].every(s => {
  const cols = B.resolveBoardLayout(T.COACH_BOARD, s).columns
  const h = lastFilled(cols)
  return eq(h.stack, ['history']) && h.span === 1 && eq(cols[1].stack, ['profile'])
}))
check('Training Coach: main stops at 42rem (the coach card is capped there)', [2, 3, 4].every(s => B.resolveBoardLayout(T.COACH_BOARD, s).main === '42rem'))
check('Health Sleep: breathing (data-dependent) takes the last track at 2450', eq(B.resolveBoardLayout(H.SLEEP_BOARD, 4).columns[3].stack, ['breathing']))
check('Health Cardio: the recovery grid (data-dependent) comes after VO₂ max', [2, 3, 4].every(s => eq(B.resolveBoardLayout(H.CARDIO_BOARD, s).columns[1].stack, ['recovery'])))
check('Health Cardio: the recovery grid (≤ 2 metrics) never spans a second track', [2, 3, 4].every(s => B.resolveBoardLayout(H.CARDIO_BOARD, s).columns[1].span === 1))
check('Health Activity: the collapsed Other workouts card ends the main column (it hides when empty)', [2, 3, 4].every(s => {
  const main = B.resolveBoardLayout(H.ACTIVITY_BOARD, s).columns[0].stack
  return main.includes('workouts') && main.indexOf('workouts') > main.indexOf('note')
}))
check('Health: the Workouts window is gone (strength lives under Training)', !('workouts' in H.HEALTH_BOARDS))
check('Health Goal: Muscle watch is its own card under the report on a phone', eq(H.GOAL_BOARD[1], ['report', 'muscle']))
check('Health Goal: Muscle watch sits right under the goals from 1280', [2, 3, 4].every(s => {
  const col = B.resolveBoardLayout(H.GOAL_BOARD, s).columns[1].stack
  return col[0] === 'goals' && col[1] === 'muscle'
}))
check('Health Goal at 2450: protein and the collapsed calories card share a track', eq(B.resolveBoardLayout(H.GOAL_BOARD, 4).columns[2].stack, ['protein', 'energy']))
check('Health Heart at 1280/1469: the resting-HR trend goes under the heart card (columns end level)', eq(B.resolveBoardLayout(H.HEART_BOARD, 2).columns[0].stack, ['heart', 'rhrTrend']))
check('Training Program: balance (only with a current program) takes the last track', [3, 4].every(s => {
  const cols = B.resolveBoardLayout(T.PROGRAM_BOARD, s).columns
  return eq(cols[cols.length - 1].stack, ['balance'])
}))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
