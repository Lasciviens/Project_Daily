#!/usr/bin/env node
/*
 * THE Plan helper (Phase 3 A2, owner 26.11.2026: "one usePlanThis used by every Plan button").
 *   1. Every Plan button goes through items/usePlanThis (or the PlanThingButton / PlannedChip built on it):
 *      no screen builds an item-screen request with defaults and a source or link of its own — only
 *      items/planThis.ts does. A screen that opens a plain new item (Add, quick add, Daily's day) still may.
 *   2. planRequest gives each kind its link (the task's link, saved with the item in one transaction), and a
 *      football match goes as its ESPN facts (its record is written with the item, 211).
 *   3. taskLinkOf reads a task's link from its columns only, never source_type / source_id.
 *   Run:  node scripts/verify-plan-this.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

console.log('\n== 1. No Plan button builds its payload by hand ==')
const HOME = 'src/features/items/planThis.ts'
const files = walk('src')
const handMade = []
for (const f of files) {
  if (f === HOME) continue
  const text = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  // An item-screen request opened with a source or a link (the thing it plans).
  for (const m of text.matchAll(/\.open\(\s*\{\s*kind:\s*'(task|time-block|schedule-block)'([\s\S]{0,600}?)\}\s*\)/g)) {
    if (/\bsource\s*:|\blink\s*:/.test(m[2])) handMade.push(`${f}: opens '${m[1]}' with its own source/link`)
    // A thing's plan defaults (a repeating plan's "+ weekly" is not a thing's Plan button).
    if (m[1] !== 'schedule-block' && /category:\s*'(media|games|training)'/.test(m[2])) handMade.push(`${f}: opens '${m[1]}' with a ${m[2].match(/category:\s*'(\w+)'/)[1]} plan's defaults`)
  }
  // An ItemLink literal: { kind: 'movie', id: … } given as a link.
  if (/\blink:\s*\{\s*kind:\s*'(movie|tv|shop_item|wish|football|game|book|training)'/.test(text)) handMade.push(`${f}: builds a link literal`)
}
check('only items/planThis.ts builds a plan request with a source, a link or a kind\'s defaults', handMade.length === 0, handMade.join('; '))

const buttons = {
  'src/features/media/components/PlanThisButton.tsx': 'movie + Cinema',
  'src/features/media/components/EpisodesPanel.tsx': 'TV episodes',
  'src/features/media/components/QueuePanel.tsx': 'the media Queue',
  'src/features/games/components/GameDetailModal.tsx': 'a game\'s details',
  'src/features/games/test-game/TestGamePage.tsx': 'the Games page (one payload for every game menu)',
  'src/features/daily/components/summary/GamesCard.tsx': 'Daily\'s Play next',
  'src/features/shop/components/WishlistView.tsx': 'the wishlist',
  'src/features/shop/components/record/useShopRecord.tsx': 'a shop record (+ Return by, Complain by)',
  'src/features/shop/components/owned/SellSheet.tsx': 'the sell flow\'s Handover',
  'src/features/wishes/components/WishCard.tsx': 'a wish',
  'src/features/football/hooks/useFootball.ts': 'a match\'s Plan it',
  'src/features/training/components/RoutinesTab.tsx': 'a routine',
  'src/features/training/components/next/NextTab.tsx': 'Training → Next',
  'src/features/training/components/program/RoutineProgramCard.tsx': 'the program card',
  'src/features/training/components/session/TrainingSessionView.tsx': 'Plan this routine again',
  'src/features/training/components/calendar/DayDetailPanel.tsx': 'a training day',
  'src/features/training/modals/TrainingPlanSheets.tsx': 'Skip → Plan',
  'src/features/daily/components/summary/TrainingBand.tsx': 'Daily\'s training band',
}
const without = Object.entries(buttons).filter(([f]) => !/\busePlanThis\b|\bPlanThingButton\b/.test(read(f))).map(([f, w]) => `${w} (${f})`)
check(`every Plan button (${Object.keys(buttons).length}) uses usePlanThis or PlanThingButton`, without.length === 0, without.join('; '))
const routineCallers = files.filter(f => /\bplanRoutine\b/.test(read(f)) && !/training\/planTraining\.ts$|items\/usePlanThis\.ts$/.test(f))
check('the routine step (planRoutine) is called only by usePlanThis', routineCallers.length === 0, routineCallers.join(', '))
const requestCallers = files.filter(f => /\bplanRequest\b/.test(read(f)) && !/items\/planThis\.ts$|items\/usePlanThis\.ts$|training\/planTraining\.ts$/.test(f))
check('planRequest is used only by usePlanThis (and its training step)', requestCallers.length === 0, requestCallers.join(', '))
check('the item screen shows the Linked chip', /<LinkedChip link=\{linked\} \/>/.test(read('src/shared/components/plan-modal/UnifiedPlanModal.tsx')))

console.log('\n== 2. Each kind\'s request carries its link ==')
const { planRequest, planLookup } = require('../src/features/items/planThis')
const T = '2026-11-26'
const linkOf = r => r.source && r.source.link
const movie = planRequest({ kind: 'movie', id: 'm1', title: 'Dune', runtimeMinutes: 166 }, T)
check('a movie: "Watch: Dune", 166 min → 180, its link', movie.defaults.title === 'Watch: Dune' && movie.defaults.duration === 180 && linkOf(movie).kind === 'movie' && linkOf(movie).id === 'm1')
const cinema = planRequest({ kind: 'movie', id: 'm1', title: 'Dune', cinema: true }, T)
check('a cinema trip: a movie plan titled "Cinema: Dune"', cinema.defaults.title === 'Cinema: Dune' && linkOf(cinema).kind === 'movie')
const noLib = planRequest({ kind: 'movie', id: null, title: 'Not in the library' }, T)
check('a Queue title not in the library plans without a link', !noLib.source && planLookup({ kind: 'movie', id: null, title: 'x' }) === null)
const ep = planRequest({ kind: 'tv', id: 's1', show: 'Severance', season: 2, episodes: [{ number: 3, name: 'Who Is Alive?', runtime: 44 }] }, T)
check('one episode: its title, 45 min, the show + season + episode link', ep.defaults.title === '📺 Severance · S02E03 "Who Is Alive?"' && ep.defaults.duration === 45
  && JSON.stringify(linkOf(ep)) === JSON.stringify({ kind: 'tv', id: 's1', season: 2, episode: 3 }) && ep.source.episodeInfo.episodeNumber === 3)
const batch = planRequest({ kind: 'tv', id: 's1', show: 'Severance', season: 2, episodes: [{ number: 3, name: 'a', runtime: 44 }, { number: 4, name: 'b', runtime: 47 }] }, T)
check('a batch: "(2 ep)", 91 → 105 min, the show\'s link, no episode', batch.defaults.title === '📺 Severance · S02 (2 ep)' && batch.defaults.duration === 105
  && JSON.stringify(linkOf(batch)) === JSON.stringify({ kind: 'tv', id: 's1' }) && planLookup({ kind: 'tv', id: 's1', show: 'x', season: 2, episodes: [{ number: 3, name: 'a' }, { number: 4, name: 'b' }] }) === null)
const game = planRequest({ kind: 'game', id: 'g1', title: 'Hades' }, T)
check('a game: one payload — "🎮 Hades", 60 min, games, its link', game.defaults.title === '🎮 Hades' && game.defaults.duration === 60 && game.defaults.category === 'games' && linkOf(game).kind === 'game')
const buy = planRequest({ kind: 'shop_item', id: 'i1', title: ' Lamp ', plannedDate: '2026-12-01', notes: null }, T)
check('a wishlist thing: "Buy Lamp" due on its buy-on day, its link', buy.kind === 'task' && buy.defaults.title === 'Buy Lamp' && buy.defaults.dueDate === '2026-12-01' && linkOf(buy).kind === 'shop_item')
const ret = planRequest({ kind: 'shop_item', id: 'i1', title: 'Lamp', purpose: 'return', due: '2026-12-10' }, T)
const comp = planRequest({ kind: 'shop_item', id: 'i1', title: 'Lamp', purpose: 'complain', due: '2027-11-01' }, T)
const hand = planRequest({ kind: 'shop_item', id: 'i1', title: 'Lamp', purpose: 'handover' }, T)
check('Return by / Complain by / Handover: shop plans on that day, linked to the thing', ret.defaults.title === 'Return Lamp' && ret.defaults.dueDate === '2026-12-10' && ret.defaults.date === '2026-12-10'
  && comp.defaults.title === 'Complain about Lamp' && comp.defaults.dueDate === '2027-11-01' && hand.defaults.title === 'Hand over Lamp' && !hand.defaults.dueDate
  && [ret, comp, hand].every(r => linkOf(r).kind === 'shop_item' && linkOf(r).id === 'i1'))
const wish = planRequest({ kind: 'wish', id: 'w1', title: 'Bergen' }, T)
check('a wish: its title and link', wish.kind === 'task' && wish.defaults.title === 'Bergen' && linkOf(wish).kind === 'wish')
const match = { id: '700123', kickoff: '2026-11-29T17:00:00Z', timeValid: true, league: { slug: 'nor-1', name: 'Eliteserien' }, home: { team: { short: 'Brann' } }, away: { team: { short: 'Rosenborg' } }, state: 'pre', venue: null, city: null, round: null }
let fb = null
try { fb = planRequest({ kind: 'football', match }, T) } catch (e) { fb = { error: e.message } }
check('a match: "⚽ Brann – Rosenborg", its ESPN facts as the link (the record is written with the item, 211), Oslo time',
  fb && fb.source && JSON.stringify(fb.source.link) === JSON.stringify({ kind: 'football', match: { eventId: '700123', league: 'nor-1', kickoffAt: '2026-11-29T17:00:00Z', timeValid: true } })
  && fb.defaults.timeZone === 'Europe/Oslo' && fb.defaults.title === '⚽ Brann – Rosenborg' && fb.defaults.startTime === '18:00', JSON.stringify(fb))
const tr = planRequest({ kind: 'training', routine: { id: 'r1', title: 'Push Day' }, date: '2026-11-27' }, T)
const free = planRequest({ kind: 'training', date: '2026-11-27' }, T)
check('a routine: its link; a session without one is still a training session (no link)', linkOf(tr).kind === 'training' && tr.defaults.date === '2026-11-27'
  && free.source.sourceType === 'training_session' && !free.source.link && free.defaults.title === 'Training')

console.log('\n== 3. A task\'s link is its columns ==')
const { taskLinkOf, LINK_KINDS } = require('../src/features/items/linkKinds')
check('a movie column', JSON.stringify(taskLinkOf({ movie_entry_id: 'm1' })) === JSON.stringify({ kind: 'movie', id: 'm1' }))
check('an episode: the show with its numbers', JSON.stringify(taskLinkOf({ tv_entry_id: 's1', link_season: 1, link_episode: 2 })) === JSON.stringify({ kind: 'tv', id: 's1', season: 1, episode: 2 }))
check('a label is never a link (source_type / source_id alone)', taskLinkOf({ source_type: 'movie', source_id: 'm1' }) === null)
check('every kind has a one-word label and a column', Object.values(LINK_KINDS).every(d => /^\w+$/.test(d.label) && /_id$/.test(d.column)))
const types = read('src/features/items/itemTypes.ts')
const kinds = [...(types.match(/export type ItemLinkKind = ([^\n]+)/)[1]).matchAll(/'(\w+)'/g)].map(m => m[1]).sort().join(',')
check('the registry names every link kind', kinds === Object.keys(LINK_KINDS).sort().join(','))
check('who closes each plan follows the owner\'s rule (synced kinds by the sync, app-owned by the tick, football by hand)',
  ['movie', 'tv', 'game', 'book', 'training'].every(k => LINK_KINDS[k].closedBy === 'sync') && ['shop_item', 'wish'].every(k => LINK_KINDS[k].closedBy === 'tick') && LINK_KINDS.football.closedBy === 'hand')

console.log('\n== 4. The tick says what it did ==')
const { doneMessage, reopenMessage } = require('../src/features/items/tickMessage')
const shop = { effect: { effect: 'shop_bought', target_id: 'k', before: { status: 'wishlist' } } }
check('a done shop plan: "Task done · Kettle bought — check it in Shop"', doneMessage([{ ...shop, now: { title: 'Kettle', status: 'bought' } }]) === 'Task done · Kettle bought — check it in Shop')
check('a wish, a phase', doneMessage([{ effect: { effect: 'wish_done', target_id: 'w', before: { status: 'planned' } }, now: { title: 'Bergen', status: 'done' } }]) === 'Task done · wish fulfilled'
  && doneMessage([{ effect: { effect: 'phase_done', target_id: 'p', before: { status: 'in_progress' } }, now: { title: 'One', status: 'done' } }]) === 'Task done · phase done')
check('no effect: plain "Task done" / "Task reopened"', doneMessage([]) === 'Task done' && reopenMessage([]) === 'Task reopened')
check('reopened: "back on the wishlist" when undone, "your purchase kept" when the owner changed it',
  reopenMessage([{ ...shop, now: { title: 'Kettle', status: 'wishlist' } }]) === 'Task reopened · back on the wishlist'
  && reopenMessage([{ ...shop, now: { title: 'Kettle', status: 'bought' } }]) === 'Task reopened · your purchase kept')
check('the toggle reports through them', /successMessage: \(r, \{ isDone \}\) => \(isDone \? doneMessage\(r\.outcomes\) : reopenMessage\(r\.outcomes\)\)/.test(read('src/features/todo/hooks/useTodos.ts')))

console.log(`\nverify-plan-this: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
