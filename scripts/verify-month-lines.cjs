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
ok(M.MONTH_KIND.plans.tint === 6 && M.MONTH_KIND.training.tint === 2, "Plans is the slate, clearly apart from Training's violet (the plum read as the same purple)")

console.log('Lines per kind')
eq(M.tasksText(3, 0), '3 open', 'tasks: "3 open"')
eq(M.tasksText(3, 2), '3 open · 2 done', 'tasks: open and done')
eq(M.tasksText(0, 1), '1 done', 'tasks: only done')
eq(M.tasksText(0, 0), null, 'tasks: nothing → no line')
eq(M.tasksText(0, 1, 2, 1), '1 done · 2 missed · 1 cancelled', 'tasks: a past day keeps its record — missed and cancelled are said (owner-critic, 25.11.2026)')
eq(M.tasksText(0, 0, 1, 0), '1 missed', 'tasks: only missed')
eq(M.tasksText(0, 0, 0, 1), '1 cancelled', 'tasks: only cancelled')
eq(M.trainingText(1, 'done'), 'Trained', 'training: a workout → Trained')
eq(M.trainingText(2, 'done'), 'Trained ×2', 'training: two workouts')
eq(M.trainingText(0, 'upcoming'), 'Planned', "training: a future plan in Training's own words")
eq(M.trainingText(0, 'missed'), 'Missed plan', 'training: a missed plan')
eq(M.trainingText(0, null), null, 'training: nothing → no line')
eq(M.plansText(1), '1 plan', 'plans: one')
eq(M.plansText(2), '2 plans', 'plans: the app\'s own slots only (Google Calendar went, 25.11.2026)')
eq(M.plansText(0), null, 'plans: nothing → no line')
eq(M.mediaText(1, 3), '1 film · 3 ep', 'media: films and episodes, short enough for a day\'s line')
eq(M.mediaText(0, 1), '1 ep', 'media: one episode')
eq(M.moneyText(known(3290)), '3 290 NOK', "money: Shop's wording")
eq(M.moneyText({ nok: 0, missing: 1, pending: 0 }), 'Amount unknown', 'money: a price missing is never 0')
eq(M.moneyText(undefined), null, 'money: nothing spent → no line')

console.log('Counts per day')
{
  const p = M.plansByDay([
    { date: '2026-11-03', category: 'personal' },
    { date: '2026-11-03', category: 'work' },
    { date: '2026-11-03', category: 'training' },
    { date: '2026-11-04', category: 'personal' },
    { date: '2026-11-04', category: 'personal', task_id: 'task-1' },
  ])
  eq(p.get('2026-11-03'), { slots: 2 }, "the day's slots; a training slot is the training line's")
  eq(p.get('2026-11-04'), { slots: 1 }, "a day with one slot; a timed task's slot is the Tasks line's, never counted twice (owner-critic, 25.11.2026)")
  eq(p.has('2026-11-06'), false, 'a day with nothing has no entry')
  const hook = require('fs').readFileSync(require('path').join(__dirname, '../src/features/daily/hooks/useMonthLines.ts'), 'utf8')
  eq(/useCalendar|calendar\/hooks/.test(hook), false, 'the month reads no Google Calendar events')
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

console.log('The phone\'s counts and the room a day keeps')
{
  const facts = { tasks: { open: 2, done: 1, missed: 1, cancelled: 0 }, training: { sessions: 0, mark: 'upcoming' }, plans: { slots: 3 },
    media: { films: 1, episodes: 2 }, money: known(500), moneyItems: 2 }
  eq(M.dayCounts(facts), { tasks: 4, training: 1, plans: 3, media: 3, money: 2 }, 'a count per kind: task rows, workouts (1 for a plan mark), slots, watches, money events')
  eq(M.dayCounts({}), { tasks: 0, training: 0, plans: 0, media: 0, money: 0 }, 'nothing that day: no counts')
  eq(M.shownSlots(M.dayTexts(facts), ['plans'], M.dayCounts(facts)).map(s => [s.kind, s.count]), [['tasks', 4], ['training', 1], ['media', 3], ['money', 2]], 'a slot carries its count; a hidden kind has none')
  const mc = M.moneyCountByDay([{ day: '2026-11-03', kind: 'bought' }, { day: '2026-11-03', kind: 'cost' }, { day: '2026-11-03', kind: 'sold' }, { day: '2026-11-04', kind: 'refund' }])
  eq([mc.get('2026-11-03'), mc.get('2026-11-04')], [2, 1], 'money events per day: purchases, costs and refunds, never a sale')
  const day = (n) => M.shownSlots(M.dayTexts({ tasks: { open: n >= 1 ? 1 : 0, done: 0 }, plans: n >= 2 ? { slots: 1 } : undefined, media: n >= 3 ? { films: 1, episodes: 0 } : undefined }), [])
  eq(M.monthLineRoom([day(0), day(2), day(1)], true), 2, 'a day keeps room for the most lines any day of the month has')
  eq(M.monthLineRoom([day(3)], false), 3, '…3 lines until every read answered')
  eq(M.monthLineRoom([day(0)], true), 0, 'an empty month keeps no line room')
  const long = [{ kind: 'tasks', text: '1 done · 2 missed · 1 cancelled', count: 4 }, { kind: 'plans', text: '1 plan', count: 1 }]
  eq([M.lineRows('1 done · 2 missed · 1 cancelled', 16), M.lineRows('1 plan', 16)], [2, 1], 'a line longer than the day wraps once (1469), a short one keeps one row')
  eq(M.monthLineRoom([long], true, 16), 3, "the room counts a wrapped line's two rows")
  eq(M.monthLineRoom([long], true, 40), 2, '…and one row where the day is wide enough (1795)')
}

console.log('Training counts once')
{
  const session = { source_type: 'training_session', hevy_routine_id: null }
  const routine = { source_type: 'manual', hevy_routine_id: 'r1' }
  const chore = { source_type: 'manual', hevy_routine_id: null }
  eq([M.onTasksLine(session, true), M.onTasksLine(routine, true), M.onTasksLine(chore, true)], [false, false, true], 'Training shown: a training session is its line\'s, not Tasks\'')
  eq([M.onTasksLine(session, false), M.onTasksLine(routine, false)], [true, true], 'Training hidden: it counts under Tasks again')
}

console.log('Hiding and showing')
{
  const texts = M.dayTexts({ tasks: { open: 3, done: 0 }, training: { sessions: 1, mark: 'done' }, media: { films: 0, episodes: 2 } })
  eq(texts, { tasks: '3 open', training: 'Trained', plans: null, media: '2 ep', money: null }, 'one text per kind; a kind not read is null')
  eq(M.shownSlots(texts, []).map(s => s.kind), ['tasks', 'training', 'plans', 'media', 'money'], 'every kind has its slot, empty ones kept (the room never changes with the data)')
  eq(M.shownSlots(texts, ['training', 'money']).map(s => [s.kind, s.text]), [['tasks', '3 open'], ['plans', null], ['media', '2 ep']], 'a hidden kind has no slot and no line')
  eq(M.shownSlots(texts, [...M.MONTH_KINDS]), [], 'all hidden: no lines')
  eq(M.dayAccessibleName('Wednesday 25.11.2026', M.shownSlots(texts, ['training'])), 'Wednesday 25.11.2026 — Tasks: 3 open; Media: 2 ep', 'the button reads the date, then each shown line')
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
  const reads = ['useHevyWorkoutsRange(from, to', 'useStravaActivities({ from: bounds.fromISO', 'useTrainingPlansByDate(from, to)', 'useTimeBlocksRange(from, to', 'useWatchesBetween(from, to)', 'useShopItems(', 'useShopCosts(']
  ok(reads.every(r => hook.includes(r)), 'each kind is one ranged (or shared) read in useMonthLines')
  ok(!/days\.(map|forEach)\([^)]*use[A-Z]/.test(widget) && !/factsOf[\s\S]{0,200}useQuery/.test(hook), 'no hook is called per day')
  ok(/useTasksByMonth\(monthStart, monthEnd\)/.test(widget) && /countTasks\(/.test(widget) && /open: counts\.open \+ repeats\.toDoOn\(dateStr\)/.test(widget), "the task line counts through taskRules over the month's one task read")
  ok(/useRepeatDays\(tasks, \{ withoutTraining: trainingShown \}\)/.test(widget) && /onTasksLine\(t, trainingShown\)/.test(widget)
    && /withoutTraining \? allTemplates\.filter\(t => t\.category !== 'training'\)/.test(src('src/features/daily/hooks/useSchedule.ts')),
    'while Training is shown, its sessions and training repeats stay off the Tasks line (open, done, missed, cancelled and the header count)')
  ok(!/\.status\s*===\s*'done'/.test(widget), 'no hand-written done check (taskRules.countTasks)')
  const keyHook = src('src/features/daily/hooks/useMonthKinds.ts')
  const key = /MONTH_KINDS_KEY = '([^']+)'/.exec(keyHook)?.[1]
  ok(key && src('src/security/accountState.ts').includes(`'${key}'`), `the stored choice (${key}) is cleared at sign-out`)
  ok(/<Checkbox\b/.test(widget) && /from '\.\.\/\.\.\/\.\.\/shared\/ui'/.test(widget), 'the checkboxes are the shared primitive')
  ok(!/CalendarFilter/.test(widget), "the Month card's header has no Google calendar filter (Google Calendar went, 25.11.2026)")
  ok(/missed: missedTasks \+ repeats\.missedOn\(dateStr\), cancelled: counts\.cancelled - missedTasks/.test(widget)
    && /t\.closed_reason === 'missed' && closedOn\(t, dateStr\)/.test(widget)
    && /missedOn: \(day: string\) => \(day < today \? repeatDaysOn\(templates, day, asTasks\) : 0\)/.test(src('src/features/daily/hooks/useSchedule.ts')),
    'missed = tasks closed as missed that day + past repeat days with no task; cancelled = the rest of countTasks\' cancelled')
  {
    const api = src('src/features/todo/api/tasksApi.ts')
    const byMonth = api.slice(api.indexOf('export async function fetchTasksByMonth'), api.indexOf('export async function fetchTasksByMonth') + 400)
    ok(!/neq\('status', 'cancelled'\)/.test(byMonth), "the month's task read keeps cancelled tasks (missed and cancelled are counted; a closed repeat day is not counted twice)")
  }
  ok(/workouts\.isError \|\| activities\.isError \|\| plans\.isError/.test(hook), 'a failed Strava read names Training as not loaded')
  ok(/const lineRoom = Math\.min\(monthLineRoom\(\[\.\.\.monthSlots\.values\(\)\], linesReady, charsPerLine\)/.test(widget) && /<Truncate lines=\{2\}/.test(widget) && /!inMonth && 'self-start'/.test(widget), 'each day keeps the month\'s most lines; a day of another month is its number only')
  ok(/text-meta text-fg-2" style=\{\{ minHeight: `\$\{room\}rem` \}\}/.test(widget) && !/text-micro'\)/.test(widget), 'the lines are 12px at every grid width (no 11px step)')
  ok(/<DayCounts slots=\{slots\}/.test(widget) && !/DayDots/.test(widget) && /className="tint-ink">\{s\.count\}/.test(widget), 'a phone shows tiny counts in each kind\'s tint, never dots')
  ok(!/min-h-\[44px\]/.test(widget) && !/pointer:coarse/.test(src('src/shared/ui/Checkbox.tsx')), 'no 44px touch step on the day buttons or the checkboxes')
  ok(/title=\{name\}/.test(widget) && /aria-label=\{name\}/.test(widget), 'a day\'s button shows its lines in words on hover (title) and reads them aloud')
  ok(widget.indexOf('role="alert"') > 0 && widget.indexOf('role="alert"') < widget.indexOf('<KindPicker'), 'a failed read sits in the header row (the grid never moves)')
  ok(/<KeepRoom ids=\{monthRoomKey\(phone\)\}/.test(widget) && /rememberedLayout\(monthRoomKey\(phone\)\)/.test(src('src/features/daily/pages/DailyPage.tsx')), 'the lazy month\'s fallback keeps the height the card took last time')
  ok(/const NO_CAP = '200rem'/.test(src('src/features/daily/dailyBoards.ts')) && /export const PICKER_MAIN = NO_CAP/.test(src('src/features/daily/dailyBoards.ts')), 'the calendar\'s "no cap" width is named')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
