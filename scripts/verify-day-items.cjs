#!/usr/bin/env node
/*
 * Verification — Daily's day as ONE list (src/features/daily/dayItems.ts,
 * owner 15.10.2026): a task with its slot is one row, a repeat's day is a row
 * (open, missed, done, skipped), Google events keep their own rows, rows split
 * by TIME (timed / anytime / done / cancelled), nothing on the day list is
 * lost, and the week / month counts include repeat days still to do. Also the
 * projection of a repeat with no time and a slot with no length (155). Runs
 * the real modules through sucrase.
 *
 *   Run:  node scripts/verify-day-items.cjs
 */
require('sucrase/register')

const D = require('../src/features/daily/dayItems')
const S = require('../src/features/daily/daySchedule')
const { projectRecurringBlocksForDay } = require('../src/features/daily/components/dayAgendaProjection')

let passed = 0
let failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}

const TODAY = '2026-10-15' // a Thursday
const YESTERDAY = '2026-10-14'
const task = (id, extra = {}) => ({ id, title: id, status: 'open', due_date: TODAY, due_time: null, ...extra })
const block = (id, extra = {}) => ({ id, title: id, date: TODAY, start_time: '09:00:00', duration_minutes: 60, category: 'daily', color: 'accent', task_id: null, ...extra })
const plan = (id, extra = {}) => ({ id, title: id, days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '18:00:00', end_time: '19:00:00', category: 'daily', color: 'blue', effective_from: '2026-10-01', ...extra })

function day(input) {
  const items = S.buildDaySchedule({ date: input.day ?? TODAY, blocks: input.blocks ?? [], prevBlocks: input.prevBlocks ?? [], templates: input.templates ?? [], events: input.events ?? [] })
  return D.buildDayRows({ day: input.day ?? TODAY, today: TODAY, tasks: { open: [], done: [], cancelled: [], ...input.tasks }, items, linkedTasks: input.linked ?? [] })
}
const keys = rows => rows.map(r => r.key)

console.log('\n== 1. A task with its slot is ONE row, at the slot\'s time ==')
{
  const t = task('pay-rent')
  const r = day({ tasks: { open: [t] }, blocks: [block('b1', { title: 'pay-rent', task_id: 'pay-rent', start_time: '17:30:00', duration_minutes: 30 })] })
  eq(r.timed.length + r.anytime.length, 1, 'one row, not a slot row and a task row')
  eq([r.timed[0].kind, r.timed[0].task?.id, r.timed[0].startHour, r.timed[0].endHour], ['task', 'pay-rent', 17.5, 18], 'the task row sits at its slot, 17:30–18:00')
  eq(r.timed[0].state, 'open', 'its state is the task\'s')
}

console.log('\n== 2. No slot: a time is a moment, no time is Anytime ==')
{
  const r = day({ tasks: { open: [task('call', { due_time: '14:00:00' }), task('read')] } })
  eq(keys(r.timed), ['task:call'], 'a task with a time sits at that time')
  eq([r.timed[0].startHour, r.timed[0].endHour, r.timed[0].busy], [14, null, false], 'as a moment: no end, holds no time')
  eq(keys(r.anytime), ['task:read'], 'a task with no time is Anytime')
  const late = day({ tasks: { open: [task('late', { due_date: '2026-10-10', due_time: '08:00:00' })] } })
  eq(keys(late.anytime), ['task:late'], 'an overdue task\'s old time is not today\'s time: Anytime')
}

console.log('\n== 3. Done: timed stays in its slot (dimmed), untimed goes to Done ==')
{
  const r = day({
    tasks: { done: [task('gym', { status: 'done' }), task('mail', { status: 'done' })], cancelled: [task('trip', { status: 'cancelled' })] },
    blocks: [block('b-gym', { title: 'gym', task_id: 'gym', task_status: 'done', start_time: '07:00:00' })],
  })
  eq([keys(r.timed), r.timed[0].state], [['b-gym'], 'done'], 'the done slot stays at 07:00 as done')
  eq(keys(r.done), ['task:mail'], 'a done task with no time is under Done')
  eq(keys(r.cancelled), ['task:trip'], 'a cancelled one is under Cancelled')
  eq(r.anytime.length, 0, 'nothing done is in Anytime')
}

console.log('\n== 4. Days of a repeat: open, missed, done, skipped — all on their own day ==')
{
  const water = plan('water', { start_time: null, end_time: null, days_of_week: [4] })
  const r = day({ templates: [water] })
  eq([keys(r.anytime), r.anytime[0].kind, r.anytime[0].state], [['water'], 'repeat', 'open'], 'a repeat with no time is an Anytime repeat row')
  eq(r.anytime[0].repeat, { scheduleBlockId: 'water', date: TODAY, acted: false }, 'it names the plan and the day')
  const past = day({ day: '2026-10-08', templates: [water] })
  eq([keys(past.anytime), past.anytime[0].state], [['water'], 'missed'], 'a past day nobody ticked stays on its day as missed')
  const timedPlan = day({ templates: [plan('walk')] })
  eq([keys(timedPlan.timed), timedPlan.timed[0].startHour, timedPlan.timed[0].endHour], [['walk'], 18, 19], 'a timed repeat is a timed row')

  const doneDay = block('b-walk', { title: 'walk', task_id: 't-walk', task_status: 'done', start_time: '18:00:00', schedule_block_id: 'walk', occurrence_date: TODAY })
  const acted = day({ templates: [plan('walk', { except_dates: [TODAY] })], blocks: [doneDay], tasks: { done: [task('t-walk', { status: 'done' })] } })
  eq(acted.timed.map(x => [x.key, x.kind, x.state]), [['b-walk', 'repeat', 'done']], 'a ticked day: one repeat row, done, in its slot (the plan leaves that day)')
  eq(acted.timed[0].repeat, { scheduleBlockId: 'walk', date: TODAY, acted: true }, 'acted on: it still names the plan and its day')
  const skipped = day({ templates: [plan('walk', { except_dates: [TODAY] })], blocks: [{ ...doneDay, task_status: 'cancelled' }], tasks: { cancelled: [task('t-walk', { status: 'cancelled' })] } })
  eq(skipped.timed.map(x => x.state), ['skipped'], 'a skipped day reads Skipped, in its slot')
  eq(D.repeatDayRequest('walk', TODAY), { kind: 'schedule-block', id: 'walk', occurrenceDate: TODAY, defaults: { date: TODAY } }, 'a repeat\'s day opens the sheet on that day (This day | All days)')
}

console.log('\n== 5. Google events, slots with no task, training ==')
{
  const r = day({
    blocks: [block('slot'), block('lift', { category: 'training', start_time: '16:00:00' })],
    events: [
      { id: 'g1', summary: 'Dentist', start: { dateTime: `${TODAY}T11:00:00` }, end: { dateTime: `${TODAY}T11:30:00` } },
      { id: 'g2', summary: 'Holiday', start: { date: TODAY }, end: { date: '2026-10-16' } },
    ],
    tasks: { open: [task('read')] },
  })
  eq(r.timed.map(x => [x.key, x.kind, x.state]), [['slot', 'slot', null], ['g1', 'event', null], ['lift', 'training', null]], 'a slot with no task and a Google event have nothing to tick; training is its own kind')
  eq(keys(r.anytime), ['g2', 'task:read'], 'an all-day Google event leads Anytime')
  const own = day({ blocks: [block('linked', { google_calendar_event_id: 'g1' })], events: [{ id: 'g1', summary: 'x', start: { dateTime: `${TODAY}T09:00:00` }, end: { dateTime: `${TODAY}T10:00:00` } }] })
  eq(keys(own.timed), ['linked'], 'an event the app made is its row, never a second one')
}

console.log('\n== 6. A slot on another day than its task\'s date ==')
{
  const r = day({ blocks: [block('b', { task_id: 'elsewhere', title: 'prep' })], linked: [task('elsewhere', { due_date: '2026-10-20', title: 'prep' })] })
  eq([r.timed[0].kind, r.timed[0].task?.id, r.timed[0].state], ['task', 'elsewhere', 'open'], 'its task is read by id, so the row can still be ticked')
  const tail = day({
    prevBlocks: [block('late', { date: YESTERDAY, task_id: 'party', start_time: '23:00:00', duration_minutes: 120 })],
    tasks: { open: [task('party')] },
  })
  eq(tail.timed.map(x => [x.key, x.spillover]), [['late__spillover', true]], 'yesterday\'s slot runs into today as a continuation')
  eq(keys(tail.anytime), ['task:party'], 'the continuation never takes the task\'s own row')
}

console.log('\n== 7. Time with no length (155): a moment, never planned, never overlapping ==')
{
  const r = day({ blocks: [block('meet', { start_time: '10:00:00', duration_minutes: 90 }), block('pill', { start_time: '10:30:00', busy: false }), block('call', { start_time: '11:00:00', duration_minutes: 60 })] })
  eq(r.timed.map(x => [x.key, x.endHour, x.busy, x.overlaps]), [['meet', 11.5, true, true], ['pill', null, false, false], ['call', 12, true, true]], 'two spans overlap; the moment between them does not')
  const skip = day({ blocks: [block('meet', { start_time: '10:00:00', duration_minutes: 90 }), block('gone', { start_time: '10:30:00', task_id: 'gone', task_status: 'cancelled' })], tasks: { cancelled: [task('gone', { status: 'cancelled' })] } })
  eq(skip.timed.map(x => x.overlaps), [false, false], 'a cancelled or skipped span no longer takes its time: no overlap')
  const items = S.buildDaySchedule({ date: TODAY, blocks: [block('meet', { duration_minutes: 90 }), block('pill', { start_time: '10:30:00', busy: false })], prevBlocks: [], templates: [plan('remind', { start_time: '20:00:00', end_time: null })], events: [] })
  eq(S.plannedMinutes(items), 90, 'planned time counts only what holds time')
  eq(projectRecurringBlocksForDay(TODAY, [plan('remind', { start_time: '20:00:00', end_time: null })]).map(p => [p.startHour, p.endHour]), [[20, 20]], 'a repeat at a time with no length is a moment')
  eq(projectRecurringBlocksForDay('2026-10-16', [plan('night', { start_time: null, end_time: null })]).map(p => [p.startHour, p.spillover]), [[-1, false]], 'a repeat with no time occurs as anytime and never spills')
}

console.log('\n== 8. Nothing on the day list is lost (NEVER_HIDES) ==')
{
  const open = [task('a'), task('b', { due_time: '12:00:00' }), task('c', { due_date: '2026-10-01' }), task('d')]
  const done = [task('e', { status: 'done' })]
  const cancelled = [task('f', { status: 'cancelled' })]
  const r = day({ tasks: { open, done, cancelled }, blocks: [block('bd', { task_id: 'd' })], templates: [plan('walk')] })
  const shown = [...r.anytime, ...r.timed, ...r.done, ...r.cancelled].map(x => x.task?.id).filter(Boolean).sort()
  eq(shown, ['a', 'b', 'c', 'd', 'e', 'f'], 'every task of the day list is in exactly one row')
}

console.log('\n== 9. Week strip, week card and month: repeat days count ==')
{
  const plans = [plan('walk', { days_of_week: [1, 3, 5] }), plan('water', { start_time: null, end_time: null, days_of_week: [0] }), plan('gone', { except_dates: ['2026-10-16'] , days_of_week: [5] })]
  eq(D.repeatDaysOn(plans, '2026-10-16'), 1, 'Friday: the walk (a day already acted on is its own task)')
  eq(D.repeatsToDoOn(plans, '2026-10-12', TODAY), 0, 'a past day is missed, not open')
  eq(D.repeatsToDoOn(plans, TODAY, TODAY), 0, 'Thursday has none')
  eq(D.repeatsToDoOn(plans, '2026-10-18', TODAY), 1, 'Sunday: water the plants')
  eq(D.repeatsToDoBetween(plans, '2026-10-12', '2026-10-18', TODAY), 2, 'this week from today: Friday\'s walk + Sunday\'s plants')
  eq(D.withRepeats({ open: 2, done: 2 }, 2), { open: 4, done: 2, percent: 33 }, 'the week\'s % counts them as still to do')
  eq(D.withRepeats({ open: 0, done: 0 }, 0), { open: 0, done: 0, percent: 0 }, 'an empty week is 0 %, not NaN')
  eq(D.dayRowCounts({ open: 3, done: 1 }, 2), { open: 5, done: 1 }, 'the day header: open tasks + repeat days to do')
}

console.log(`\nverify-day-items: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
