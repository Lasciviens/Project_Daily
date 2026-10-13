// Checks THE task rules (src/features/todo/taskRules.ts) and THE day schedule
// (src/features/daily/daySchedule.ts) that Daily, Home and Work all read, plus
// a guard that no surface counts or classifies tasks on its own again.
//   node scripts/verify-task-model.cjs
require('sucrase/register')
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const R = require('../src/features/todo/taskRules.ts')
const S = require('../src/features/daily/daySchedule.ts')

let n = 0
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }
const TODAY = '2026-10-12'
// completed_at at local noon on a day (the rules read the LOCAL day).
const at = day => new Date(`${day}T12:00:00`).toISOString()
let seq = 0
const task = f => ({ id: `t${++seq}`, title: 'T', status: 'open', section: 'inbox', due_date: null, completed_at: null, is_focused: false, ...f })

// ── The full list's order (fetchAllTasks sorts its id pages with it) ──
{
  const rows = [
    { id: 'c', due_date: null, sort_order: 1 },
    { id: 'b', due_date: '2026-10-14', sort_order: null },
    { id: 'a', due_date: '2026-10-14', sort_order: 2 },
    { id: 'd', due_date: '2026-10-13', sort_order: 9 },
    { id: 'e', due_date: null, sort_order: null },
    { id: 'f', due_date: '2026-10-14', sort_order: 2 },
  ]
  eq([...rows].sort(R.compareByDueThenOrder).map(r => r.id), ['d', 'a', 'f', 'b', 'c', 'e'],
    'full list: due date first (undated last), then sort_order (unset last), then id')
}

// ── Open, closed, closed on a day ──
eq(R.isOpenTask(task({ status: 'waiting' })), true, 'waiting is open (Daily used to hide it)')
eq(R.isOpenTask(task({ status: 'in_progress' })), true, 'in progress is open')
eq(R.isOpenTask(task({ status: 'done' })), false, 'done is not open')
eq(R.isClosedTask(task({ status: 'cancelled' })), true, 'cancelled is closed')
eq(R.closedDay(task({ status: 'done', completed_at: at('2026-10-11') })), '2026-10-11', 'closed on its local day')
eq(R.closedDay(task({ status: 'open', completed_at: at('2026-10-11') })), null, 'an open task has no closed day, whatever completed_at says')
eq(R.closedDay(task({ status: 'done', completed_at: null })), null, 'no clock, no day — never updated_at')
eq(R.closedOn(task({ status: 'done', completed_at: at(TODAY) }), TODAY), true, 'closed today')
{
  // Late evening local time: the local day, not the UTC one.
  const late = new Date(`${TODAY}T23:30:00`).toISOString()
  eq(R.closedDay(task({ status: 'done', completed_at: late })), TODAY, '23:30 local is still today')
}

// ── Overdue ──
eq(R.isOverdueOn(task({ due_date: '2026-10-11' }), TODAY), true, 'due yesterday, open: overdue')
eq(R.isOverdueOn(task({ due_date: '2026-10-11', status: 'waiting' }), TODAY), true, 'waiting can be overdue')
eq(R.isOverdueOn(task({ due_date: '2026-10-11', status: 'done' }), TODAY), false, 'done is never overdue')
eq(R.isOverdueOn(task({ due_date: TODAY }), TODAY), false, 'due today is not overdue')
eq([task({ due_date: '2000-01-01' })].filter(R.isOverdue).length, 1, 'isOverdue is safe as a .filter callback (one argument)')

// ── Which day a task belongs to ──
const onToday = t => R.onDay(t, TODAY, TODAY)
eq(onToday(task({ due_date: TODAY })), true, 'due today')
eq(onToday(task({ section: 'today' })), true, 'undated in the Today section')
eq(onToday(task({ section: 'inbox' })), false, 'undated in the Inbox: not a day\'s work')
eq(onToday(task({ section: 'backlog', due_date: '2026-10-01' })), true, 'an overdue task shows on today whatever its section (it used to vanish)')
eq(onToday(task({ section: 'backlog', due_date: '2026-10-01', status: 'done' })), false, 'a done overdue one does not')
eq(onToday(task({ section: 'today', due_date: '2026-10-20' })), false, 'due later: on its own day')
eq(onToday(task({ status: 'done', section: 'inbox', due_date: '2026-10-20', completed_at: at(TODAY) })), true, 'finished today: on today, whatever its due date')
eq(R.onDay(task({ section: 'today' }), '2026-10-13', TODAY), false, 'undated Today rows never leak onto other days')
eq(R.onDay(task({ section: 'this_week' }), '2026-10-14', TODAY), false, 'nor undated This-week rows')
eq(R.onDay(task({ due_date: '2026-10-11' }), '2026-10-11', TODAY), true, 'an open task due yesterday is on yesterday too')
eq(R.onDay(task({ status: 'done', due_date: TODAY, completed_at: at('2026-10-11') }), '2026-10-11', TODAY), true, 'done early: on the day it was finished')

// ── One day's list ──
{
  seq = 0
  const list = [
    task({ section: 'today' }),                                                    // t1 open, undated Today
    task({ due_date: TODAY, status: 'waiting' }),                                  // t2 waiting, due today
    task({ due_date: '2026-10-05', section: 'inbox' }),                            // t3 overdue
    task({ status: 'done', section: 'today', completed_at: at(TODAY) }),           // t4 done today
    task({ status: 'done', section: 'today', completed_at: at('2026-10-11') }),    // t5 done yesterday (old 24h rule showed it)
    task({ status: 'done', due_date: TODAY, completed_at: at('2026-10-10') }),     // t6 due today, finished two days ago
    task({ status: 'cancelled', due_date: TODAY, completed_at: at(TODAY) }),       // t7 cancelled today
    task({ status: 'cancelled', due_date: TODAY, completed_at: at('2026-10-01') }),// t8 cancelled long ago
  ]
  const d = R.dayTasks(list, TODAY, TODAY)
  eq(d.open.map(t => t.id), ['t3', 't1', 't2'], 'open: overdue first, then as given — waiting included')
  eq(d.done.map(t => t.id), ['t4'], 'done = closed today only')
  eq(d.cancelled.map(t => t.id), ['t7'], 'cancelled = cancelled today only')
  eq(d.counts, { open: 3, todo: 2, inProgress: 0, waiting: 1, overdue: 1, done: 1, cancelled: 1 }, 'counts follow the same lists')
  const y = R.dayTasks(list, '2026-10-11', TODAY)
  eq(y.done.map(t => t.id), ['t5'], 'yesterday\'s view shows what was finished yesterday')
  eq(y.open.length, 0, 'undated Today rows are not yesterday\'s')
}

// ── Order: overdue first, then their own order (sort_order, newest first) ──
{
  const list = [
    task({ id: 'late', section: 'today', sort_order: 1 }),
    task({ id: 'b', section: 'today', sort_order: 5 }),
    task({ id: 'a', due_date: TODAY, sort_order: 2 }),
    task({ id: 'x', due_date: '2026-10-01', sort_order: 9 }),
    task({ id: 'n1', section: 'today', sort_order: null, created_at: '2026-10-01T10:00:00Z' }),
    task({ id: 'n2', section: 'today', sort_order: null, created_at: '2026-10-02T10:00:00Z' }),
  ]
  eq(R.dayTasks(list, TODAY, TODAY).open.map(t => t.id), ['x', 'late', 'a', 'b', 'n2', 'n1'], 'an undated Today row is not pushed below every due-today row')
}

// ── Counts over any list (Work) ──
{
  const list = [
    task({ status: 'in_progress' }), task({ status: 'open', due_date: '2026-10-01' }), task({ status: 'waiting' }),
    task({ status: 'done', completed_at: at(TODAY) }),
    // Work read "done today" off updated_at: a Google sync moved it, so an old
    // finished task came back as done today.
    task({ status: 'done', completed_at: at('2026-09-01'), updated_at: `${TODAY}T08:00:00Z` }),
  ]
  eq(R.countTasks(list, TODAY, TODAY), { open: 3, todo: 1, inProgress: 1, waiting: 1, overdue: 1, done: 1, cancelled: 0 }, 'Work: one task finished today, not two')
}

// ── Open on a day (the week strips) ──
{
  const list = [task({ due_date: '2026-10-14' }), task({ due_date: '2026-10-14', status: 'done', completed_at: at(TODAY) }), task({ due_date: '2026-10-14', status: 'waiting' })]
  eq(R.openOnDay(list, '2026-10-14', TODAY), 2, 'open + waiting due that day')
}

// ── A week's numbers ──
{
  seq = 100
  const week = [
    task({ due_date: '2026-10-13' }),                                                  // open, due in week
    task({ due_date: '2026-10-14', status: 'done', completed_at: at('2026-10-13') }),  // done in week
    task({ due_date: '2026-10-15', status: 'done', completed_at: at('2026-10-02') }),  // due in week, finished an earlier week
    task({ section: 'this_week' }),                                                    // undated this week, open
    task({ section: 'this_week', status: 'done', completed_at: at('2026-08-01') }),    // ancient: no longer inflates
  ]
  const todayList = [task({ due_date: '2026-10-01', section: 'inbox' }), task({ section: 'today' })] // overdue + undated Today
  const w = R.weekCounts({ weekTasks: week, todayTasks: todayList, from: '2026-10-12', to: '2026-10-18', today: TODAY })
  eq(w, { open: 4, done: 1, percent: 20 }, 'open = on a day of the week (today\'s list too) + undated; done = closed in the week')
  const next = R.weekCounts({ weekTasks: week, todayTasks: todayList, from: '2026-10-19', to: '2026-10-25', today: TODAY })
  eq(next.open, 0, 'another week leaves today\'s list and the undated ones out')
}

// ── Daily's Tasks tab ──
{
  seq = 200
  const list = [
    task({ section: 'today' }),                                       // t201 undated Today → Today (was "No date")
    task({ section: 'inbox' }),                                       // t202 undated Inbox → No date
    task({ due_date: '2026-10-01' }),                                 // t203 overdue
    task({ due_date: TODAY, status: 'waiting' }),                     // t204 today
    task({ due_date: '2026-10-20', start_date: '2026-10-10' }),       // t205 window open now
    task({ due_date: '2026-10-20' }),                                 // t206 upcoming
    task({ due_date: TODAY, start_date: '2026-10-10' }),              // t207 window's last day → Today
    task({ status: 'done', completed_at: at(TODAY) }),                // t208 done today
    task({ status: 'done', completed_at: at('2026-10-11') }),         // t209 done yesterday → not shown
  ]
  const g = R.taskGroups(list, TODAY)
  const ids = k => g[k].map(t => t.id)
  eq(ids('today'), ['t201', 't204', 't207'], 'Today = the day pane\'s list: undated Today rows too')
  eq(ids('noDate'), ['t202'], 'No date: undated, not parked in Today')
  eq(ids('overdue'), ['t203'], 'overdue')
  eq(ids('openNow'), ['t205'], 'a live window')
  eq(ids('upcoming'), ['t206'], 'upcoming leaves the live window out')
  eq(ids('done'), ['t208'], 'done today only')
  const all = Object.values(g).flat().map(t => t.id)
  eq(all.length, new Set(all).size, 'nothing shows twice')
}

// ── Section of a day ──
eq(R.sectionForDay(TODAY, TODAY), 'today', 'today')
// Tomorrow / This week are retired sections: a new task never gets one.
eq(R.sectionForDay('2026-10-13', TODAY), 'backlog', 'tomorrow → backlog, not the legacy Tomorrow')
eq(R.sectionForDay('2026-10-19', TODAY), 'backlog', 'seven days ahead → backlog, not the legacy This week')
eq(R.sectionForDay('2026-10-20', TODAY), 'backlog', 'eight days ahead')
eq(R.sectionForDay('2026-10-11', TODAY), 'backlog', 'yesterday')
eq(R.sectionForDay('2026-03-30', '2026-03-29'), 'backlog', 'across the spring DST change')

// ── Focus ──
eq(R.isFocusedOpen(task({ is_focused: true, status: 'done' })), false, 'a finished task leaves the focus strip')
eq(R.isFocusedOpen(task({ is_focused: true, status: 'waiting' })), true, 'a waiting one stays')
{
  const S2 = require('../src/features/training/plan/sessionState.ts')
  const pending = S2.sessionStatus({ date: '2026-10-11', taskStatus: 'waiting', taskRoutineId: 'r', today: TODAY })
  eq(pending.state, 'pending', 'a waiting training task is still open to the session status (shared OPEN_STATUSES)')
}

// ── The day schedule ──
{
  const block = (id, start, mins, extra = {}) => ({ id, date: TODAY, title: id, start_time: start, duration_minutes: mins, task_id: null, google_calendar_event_id: null, ...extra })
  const tpl = { id: 'w1', title: 'Weekly', days_of_week: [1], start_time: '18:00:00', end_time: '19:00:00', color: 'blue', category: 'daily' }
  const items = S.buildDaySchedule({
    date: TODAY, // a Monday
    blocks: [
      block('a', '09:00', 60), block('b', '13:00', 90, { task_id: 'tb', task_status: 'done' }),
      block('c', '14:00', 60, { google_calendar_event_id: 'g1' }), block('u', null, 30),
    ],
    prevBlocks: [block('night', '23:30', 90, { date: '2026-10-11' })],
    templates: [tpl],
    events: [
      { id: 'g1', summary: 'Linked', start: { dateTime: `${TODAY}T14:00:00` }, end: { dateTime: `${TODAY}T15:00:00` } },
      { id: 'g2', summary: 'Dentist', start: { dateTime: `${TODAY}T16:00:00` }, end: { dateTime: `${TODAY}T16:30:00` } },
      { id: 'g3', summary: 'Holiday', start: { date: TODAY }, end: { date: '2026-10-13' } },
    ],
  })
  const ids = items.map(i => i.id).sort()
  eq(ids, ['a', 'b', 'c', 'g2', 'g3', 'night__spillover', 'u', 'w1'], 'blocks, yesterday\'s tail, the weekly plan and unlinked events — a block\'s own event once')
  eq(items.find(i => i.id === 'b').closed, true, 'a block whose task is done is closed')
  eq(items.find(i => i.id === 'night__spillover').planDate, '2026-10-11', 'the tail belongs to the day it started')
  eq(S.timedItems(items).map(i => i.id), ['night__spillover', 'a', 'b', 'c', 'g2', 'w1'], 'timed: no undated block, no all-day event, in start order')
  eq(S.plannedMinutes(items), 60 + 60 + 90 + 60 + 30 + 60, 'planned: every timed item, its own portion (the tail 1h), done ones too')
  const ahead = S.aheadOnDay(items, true, 13.5)
  eq(ahead.map(i => i.id), ['c', 'g2', 'w1'], 'ahead at 13:30: not over, never a closed task\'s block')
  eq(ahead[0].inProgress, false, '14:00 has not started at 13:30')
  const now = S.aheadOnDay(items, true, 9.25)
  eq([now[0].id, now[0].inProgress], ['a', true], 'an item under way is first, marked in progress ("Now")')
  eq(S.aheadOnDay(items, false, 23).map(i => i.id), ['night__spillover', 'a', 'c', 'g2', 'w1'], 'another day: every open timed item')
}

// ── Guard: no surface counts or classifies tasks on its own again ──
{
  const root = path.join(__dirname, '..', 'src')
  const files = []
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p) } }
  walk(root)
  const OWN = new Set(['features/todo/taskRules.ts'].map(f => path.join(root, f)))
  const rules = [
    [/status\s*!==\s*'done'\s*&&\s*\w+\.status\s*!==\s*'cancelled'/, 'an open check by hand — use isOpenTask'],
    [/updated_at\??\.slice\(0,\s*10\)/, 'a "done today" off updated_at — use closedOn'],
    [/completedWithinLast24h|isCompletedToday/, 'the old 24-hour / updated_at done rules'],
    [/useTasksForDay|useDayData/, 'the old day reads — use useDayTasks'],
    [/status\s*===\s*'open'\s*\|\|\s*\w+\.status\s*===\s*'in_progress'/, 'an open check that forgets waiting — use isOpenTask'],
    [/\[\s*'open',\s*'in_progress',\s*'waiting'\s*\]/, 'its own list of open statuses — use OPEN_STATUSES'],
  ]
  const hits = []
  for (const f of files) {
    // Dev requests have statuses of their own (open / in progress / done), not a task's.
    if (OWN.has(f) || f.includes(`${path.sep}devRequests${path.sep}`)) continue
    const src = fs.readFileSync(f, 'utf8')
    for (const [re, why] of rules) if (re.test(src)) hits.push(`${path.relative(root, f)}: ${why}`)
  }
  eq(hits, [], 'task counting lives in taskRules only')
}

console.log(`verify-task-model: ${n} passed`)
