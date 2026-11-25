#!/usr/bin/env node
/*
 * Verification — Personal → Month's lines under the dates
 * (src/features/daily/monthLines.ts, owner 25.11.2026: "Text under dates about
 * the insight. I want to see overview on my month." + "some checkbox to hide or
 * show categories"): the counts per kind per day, each from its feature's own
 * rule (Training's day marks, Shop's spent, the year review's watches), the
 * kinds hidden and shown, the stored choice, and that the month reads each
 * kind once — never one read per day. Runs the real module through sucrase.
 *
 *   Run:  node scripts/verify-month-lines.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const M = require('../src/features/daily/monthLines')

let passed = 0, failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}
const ok = (cond, name) => eq(!!cond, true, name)
const known = nok => ({ nok, missing: 0, pending: 0 })

console.log('The kinds')
eq(M.MONTH_KINDS, ['tasks', 'training', 'plans', 'media', 'money'], 'five kinds, in the order their lines stand')
eq(M.MONTH_KINDS.map(k => M.MONTH_KIND[k].label), ['Tasks', 'Training', 'Plans', 'Media', 'Money'], 'each checkbox is one word')
ok(M.MONTH_KINDS.every(k => M.MONTH_KIND[k].tip.startsWith(M.MONTH_KIND[k].label)), 'each tooltip starts with its own word (short buttons)')
eq(new Set(M.MONTH_KINDS.map(k => M.MONTH_KIND[k].tint)).size, 5, 'each kind its own tint')

console.log('Lines per kind')
eq(M.tasksText(3, 0), '3 open', 'tasks: "3 open"')
eq(M.tasksText(3, 2), '3 open · 2 done', 'tasks: open and done')
eq(M.tasksText(0, 1), '1 done', 'tasks: only done')
eq(M.tasksText(0, 0), null, 'tasks: nothing → no line')
eq(M.trainingText(1, 'done'), 'Trained', 'training: a workout → Trained')
eq(M.trainingText(2, 'done'), 'Trained ×2', 'training: two workouts')
eq(M.trainingText(0, 'upcoming'), 'Planned', "training: a future plan in Training's own words")
eq(M.trainingText(0, 'missed'), 'Missed plan', 'training: a missed plan')
eq(M.trainingText(0, null), null, 'training: nothing → no line')
eq(M.plansText(1, 0), '1 plan', 'plans: one')
eq(M.plansText(2, 1), '2 plans · 1 event', 'plans: slots and events')
eq(M.plansText(0, 0), null, 'plans: nothing → no line')
eq(M.mediaText(1, 3), '1 film · 3 episodes', 'media: films and episodes')
eq(M.mediaText(0, 1), '1 episode', 'media: one episode')
eq(M.moneyText(known(3290)), '3 290 NOK', "money: Shop's wording")
eq(M.moneyText({ nok: 0, missing: 1, pending: 0 }), 'Amount unknown', 'money: a price missing is never 0')
eq(M.moneyText(undefined), null, 'money: nothing spent → no line')

console.log('Counts per day')
{
  const p = M.plansByDay([
    { date: '2026-11-03', category: 'personal', google_calendar_event_id: 'ev-slot' },
    { date: '2026-11-03', category: 'work' },
    { date: '2026-11-03', category: 'training', google_calendar_event_id: 'ev-train' },
    { date: '2026-11-04', category: 'personal' },
  ], new Map([
    ['2026-11-03', ['ev-slot', 'ev-train', 'ev-google', null]],
    ['2026-11-05', ['ev-other']],
  ]))
  eq(p.get('2026-11-03'), { slots: 2, events: 2 }, "a slot's own Google event counts once (as the slot); a training slot is the training line's")
  eq(p.get('2026-11-04'), { slots: 1, events: 0 }, 'a day with a slot only')
  eq(p.get('2026-11-05'), { slots: 0, events: 1 }, 'a day with a Google event only')
  eq(p.has('2026-11-06'), false, 'a day with nothing has no entry')
}
{
  const w = M.mediaByDay([
    { day: '2026-11-03', kind: 'movie' }, { day: '2026-11-03', kind: 'episode' }, { day: '2026-11-03', kind: 'episode' },
    { day: '2026-11-04', kind: 'episode' },
  ])
  eq(w.get('2026-11-03'), { films: 1, episodes: 2 }, 'every watch on its own day')
  eq(w.get('2026-11-04'), { films: 0, episodes: 1 }, 'another day')
}
{
  const m = M.moneyByDay([
    { day: '2026-11-03', kind: 'bought', amount: known(1000) },
    { day: '2026-11-03', kind: 'cost', amount: known(200) },
    { day: '2026-11-03', kind: 'sold', amount: known(5000) },
    { day: '2026-11-04', kind: 'refund', amount: known(300) },
    { day: '2026-11-05', kind: 'sold', amount: known(700) },
  ])
  eq(m.get('2026-11-03'), known(1200), 'spent = purchases + costs; a sale is money in, not spent')
  eq(m.get('2026-11-04'), known(-300), 'a refund takes off')
  eq(m.has('2026-11-05'), false, 'a day with only a sale has no money line')
  eq(M.moneyText(m.get('2026-11-04')), '−300 NOK', 'a refund day reads as minus')
}

console.log('Hiding and showing')
{
  const texts = M.dayTexts({ tasks: { open: 3, done: 0 }, training: { sessions: 1, mark: 'done' }, media: { films: 0, episodes: 2 } })
  eq(texts, { tasks: '3 open', training: 'Trained', plans: null, media: '2 episodes', money: null }, 'one text per kind; a kind not read is null')
  eq(M.shownSlots(texts, []).map(s => s.kind), ['tasks', 'training', 'plans', 'media', 'money'], 'every kind has its slot, empty ones kept (the room never changes with the data)')
  eq(M.shownSlots(texts, ['training', 'money']).map(s => [s.kind, s.text]), [['tasks', '3 open'], ['plans', null], ['media', '2 episodes']], 'a hidden kind has no slot and no line')
  eq(M.shownSlots(texts, [...M.MONTH_KINDS]), [], 'all hidden: no lines')
  eq(M.dayAccessibleName('Wednesday 25.11.2026', M.shownSlots(texts, ['training'])), 'Wednesday 25.11.2026 — Tasks: 3 open; Media: 2 episodes', 'the button reads the date, then each shown line')
  eq(M.dayAccessibleName('Wednesday 25.11.2026', M.shownSlots(M.dayTexts({}), [])), 'Wednesday 25.11.2026', 'an empty day reads just the date')
}
eq(M.toggleHidden([], 'money'), ['money'], 'hide one')
eq(M.toggleHidden(['money', 'tasks'], 'training'), ['tasks', 'training', 'money'], 'hidden kinds stay in the kinds order')
eq(M.toggleHidden(['money'], 'money'), [], 'show it again')
eq(M.hiddenOf(JSON.stringify(['money', 'media'])), ['media', 'money'], 'the stored choice reads back')
eq(M.hiddenOf('not json'), [], 'a broken value shows every kind')
eq(M.hiddenOf(JSON.stringify(['money', 'weather', 3])), ['money'], 'an unknown kind is dropped')
eq(M.hiddenOf(null), [], 'nothing stored: every kind shows')

console.log('Reads: once per month, never per day; the choice is per device and cleared at sign-out')
{
  const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const hook = src('src/features/daily/hooks/useMonthLines.ts')
  const widget = src('src/features/daily/components/MonthWidget.tsx')
  const reads = ['useHevyWorkoutsRange(from, to', 'useStravaActivities({ from: bounds.fromISO', 'useTrainingPlansByDate(from, to)', 'useTimeBlocksRange(from, to', 'useCalendarEventIdsByDay(', 'useWatchesBetween(from, to)', 'useShopItems(', 'useShopCosts(']
  ok(reads.every(r => hook.includes(r)), 'each kind is one ranged (or shared) read in useMonthLines')
  ok(!/days\.(map|forEach)\([^)]*use[A-Z]/.test(widget) && !/factsOf[\s\S]{0,200}useQuery/.test(hook), 'no hook is called per day')
  ok(/useTasksByMonth\(monthStart, monthEnd\)/.test(widget) && /countTasks\(/.test(widget) && /useOpenOnDay\(tasks\)/.test(widget), "the task line counts through taskRules over the month's one task read")
  ok(!/\.status\s*===\s*'done'/.test(widget), 'no hand-written done check (taskRules.countTasks)')
  const keyHook = src('src/features/daily/hooks/useMonthKinds.ts')
  const key = /MONTH_KINDS_KEY = '([^']+)'/.exec(keyHook)?.[1]
  ok(key && src('src/security/accountState.ts').includes(`'${key}'`), `the stored choice (${key}) is cleared at sign-out`)
  ok(/<Checkbox\b/.test(widget) && /from '\.\.\/\.\.\/\.\.\/shared\/ui'/.test(widget), 'the checkboxes are the shared primitive')
  ok(/<CalendarFilter\s*\/>/.test(widget), "the Google calendar filter stays in the Month card's header")
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
