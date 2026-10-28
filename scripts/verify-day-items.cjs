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
  // Yesterday's day of the plan, moved forward to today and not ticked yet: open, not Missed.
  const movedDay = block('b-walk-y', { title: 'walk', task_id: 't-walk-y', task_status: 'open', start_time: '20:00:00', schedule_block_id: 'walk', occurrence_date: YESTERDAY })
  const moved = day({ templates: [plan('walk', { except_dates: [YESTERDAY] })], blocks: [movedDay], tasks: { open: [task('t-walk-y')] } })
  eq(moved.timed.filter(x => x.key === 'b-walk-y').map(x => [x.state, x.repeat.date]), [['open', YESTERDAY]],
    'a day of a repeat moved forward (to today) is open, not Missed — judged from the slot\'s own day; it still names the plan\'s day')
  const movedBack = day({ day: YESTERDAY, templates: [plan('walk', { except_dates: [TODAY] })], blocks: [{ ...doneDay, task_status: 'open', date: YESTERDAY }], tasks: { open: [task('t-walk', { due_date: YESTERDAY })] } })
  eq(movedBack.timed.filter(x => x.key === 'b-walk').map(x => x.state), ['missed'], '…and one moved back to a past day, not ticked, is Missed')
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
  // As the save stores it (155): a repeat at 20:00 with no length keeps a nominal end (20:15) and busy false.
  const nominal = plan('pills', { start_time: '20:00:00', end_time: '20:15:00', busy: false })
  const withNominal = S.buildDaySchedule({ date: TODAY, blocks: [block('film', { start_time: '20:00:00', duration_minutes: 60 })], prevBlocks: [], templates: [nominal], events: [] })
  eq([withNominal.find(i => i.kind === 'recurring')?.busy, S.plannedMinutes(withNominal)], [false, 60], 'a repeat stored with a nominal end and busy false holds no time (not planned)')
  eq(day({ blocks: [block('film', { start_time: '20:00:00', duration_minutes: 60 })], templates: [nominal] }).timed.map(x => [x.key, x.overlaps]).sort(), [['film', false], ['pills', false]],
    '…and never overlaps what it sits on')
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

console.log('\n== 10. A repeat\'s day is a task on its day (156): ONE row, never two ==')
{
  const gym = plan('gym', { start_time: '17:30:00', end_time: '18:30:00' })
  const water = plan('water', { start_time: null, end_time: null })
  const dayTask = (id, planId, extra = {}) => task(id, { schedule_block_id: planId, occurrence_date: TODAY, ...extra })
  const tGym = dayTask('t-gym', 'gym', { due_time: '17:30:00' })
  const tWater = dayTask('t-water', 'water')
  const r = day({ templates: [gym, water], tasks: { open: [tGym, tWater] } })
  eq([keys(r.timed), keys(r.anytime)], [['gym'], ['water']], 'the projection and its day\'s task are one row each — no task row beside them')
  eq([r.timed[0].kind, r.timed[0].task?.id, r.timed[0].state, r.timed[0].repeat],
    ['repeat', 't-gym', 'open', { scheduleBlockId: 'gym', date: TODAY, acted: false }],
    'the row carries the day\'s task, keeps the repeat\'s time and opens the repeat on that day')
  const done = day({ templates: [water], tasks: { done: [dayTask('t-water', 'water', { status: 'done' })] } })
  eq([keys(done.done), done.done[0].state], [['water'], 'done'], 'ticked (its task done): one Done row')
  const skipped = day({ templates: [water], tasks: { cancelled: [dayTask('t-water', 'water', { status: 'cancelled' })] } })
  eq([keys(skipped.cancelled), skipped.cancelled[0].state], [['water'], 'skipped'], 'cancelled: Skipped')
  const missedDay = '2026-10-14'
  const missed = day({ day: missedDay, templates: [water], tasks: { cancelled: [task('t-w14', { schedule_block_id: 'water', occurrence_date: missedDay, due_date: missedDay, status: 'cancelled', closed_reason: 'missed' })] } })
  eq([keys(missed.anytime), missed.anytime[0].state, missed.cancelled.length], [['water'], 'missed', 0],
    'closed as missed (156): Missed on its day — never Skipped, never a second row')
  const moved = day({ day: '2026-10-16', tasks: { open: [task('t-moved', { schedule_block_id: 'water', occurrence_date: TODAY, due_date: '2026-10-16' })] } })
  eq([moved.anytime[0].kind, moved.anytime[0].repeat], ['repeat', { scheduleBlockId: 'water', date: TODAY, acted: true }],
    'a day\'s task moved off its day is still that repeat\'s day (its tick acts on its own day)')
  const training = day({ templates: [plan('legs', { category: 'training' })], tasks: { open: [dayTask('t-legs', 'legs', { source_type: 'training_session' })] } })
  eq([keys(training.timed), training.timed[0].kind, training.timed[0].task?.id], [['legs'], 'training', 't-legs'],
    'a training day: one training row holding its day\'s task')

  // The day schedule: a ticked day is never "next"
  const items = S.buildDaySchedule({ date: TODAY, blocks: [], prevBlocks: [], templates: [gym], events: [], dayTasks: [dayTask('t-gym', 'gym', { status: 'done' })] })
  eq([items[0].taskId, items[0].closed], ['t-gym', true], 'the day schedule takes the day\'s task and its state')
  eq(S.aheadOnDay(items, true, 9).length, 0, '…so Home\'s "Next up" never shows a ticked repeat day')
  const open = S.buildDaySchedule({ date: TODAY, blocks: [], prevBlocks: [], templates: [gym], events: [], dayTasks: [tGym] })
  eq(S.aheadOnDay(open, true, 9).length, 1, '…an open one still is')

  // Counts: a day that is a task counts once (as a task)
  const asTasks = D.repeatDayKeys([tGym, task('plain')])
  eq([...asTasks], ['gym:' + TODAY], 'repeatDayKeys names the repeat days that are tasks')
  eq(D.repeatsToDoOn([gym, water], TODAY, TODAY, asTasks), 1, 'today: gym is a task already (counted with the tasks), water still to do')
  eq(D.repeatsToDoBetween([gym], TODAY, '2026-10-17', TODAY, asTasks), 2, 'the rest of the week: only the days that are not tasks yet')
}

console.log('\n== A repeat day ticked late or ahead keeps its own day (28.10.2026) ==')
{
  // Ticked on 28.10 for 26.10 (a missed day ticked late): 129 stamps completed_at on the day of the tick,
  // so the day split (taskRules.dayTasks) lists it on 28.10 — its own day still reads it through repeatDays.
  const MON = '2026-10-12'
  const late = { ...task('late'), due_date: MON, status: 'done', schedule_block_id: 'water', occurrence_date: MON, completed_at: '2026-10-15T09:15:00+02:00' }
  const water = plan('water', { start_time: null, end_time: null })
  const items = S.buildDaySchedule({ date: MON, blocks: [], prevBlocks: [], templates: [water], events: [], dayTasks: [late] })
  const rows = D.buildDayRows({ day: MON, today: TODAY, tasks: { open: [], done: [], cancelled: [] }, items, repeatDays: [late] })
  eq([...rows.anytime, ...rows.done].map(r => r.state), ['done'], 'its own day reads done, not missed')
  eq([...rows.anytime, ...rows.done].length, 1, '…as ONE row (the repeat\'s), never a second task row')
  const without = D.buildDayRows({ day: MON, today: TODAY, tasks: { open: [], done: [], cancelled: [] }, items: S.buildDaySchedule({ date: MON, blocks: [], prevBlocks: [], templates: [water], events: [] }) })
  eq([...without.anytime].map(r => r.state), ['missed'], '(without the read\'s repeat days it read missed — the bug)')
  // Ticked ahead: Friday's day done on Thursday — Friday's header no longer counts it as to do.
  const FRI = '2026-10-16'
  const ahead = { ...late, id: 'ahead', due_date: FRI, occurrence_date: FRI }
  eq(D.repeatsToDoOn([water], FRI, TODAY, D.repeatDayKeys([ahead])), 0, 'a day ticked ahead is not "to do" on its day')
  const sheet = require('fs').readFileSync(require('path').join(__dirname, '../src/features/daily/components/DayAgenda.tsx'), 'utf8')
  eq(/repeatDays: list\.repeatDays/.test(sheet) && /repeatDayKeys\(withRepeatDays\)/.test(sheet), true, 'the Day plan passes the read\'s repeat days to rows and counts')
  eq(/state === 'missed' && !r\.spillover/.test(sheet), true, 'yesterday\'s tail past midnight is not one of today\'s missed')
}

console.log('\n== Wall-clock hours on the days the clocks change (28.10.2026) ==')
{
  const out = require('child_process').execFileSync(process.execPath, ['-e', `
    require('sucrase/register')
    const P = require(${JSON.stringify(require('path').join(__dirname, '../src/features/daily/components/dayAgendaProjection'))})
    const D = require(${JSON.stringify(require('path').join(__dirname, '../src/features/daily/dayItems'))})
    const ev = (s, e) => ({ start: { dateTime: s }, end: { dateTime: e } })
    console.log(JSON.stringify([
      P.projectCalendarEventForDay('2027-03-28', ev('2027-03-28T10:00:00+02:00', '2027-03-28T11:00:00+02:00')),
      P.projectCalendarEventForDay('2026-10-25', ev('2026-10-25T10:00:00+01:00', '2026-10-25T11:00:00+01:00')),
      P.projectCalendarEventForDay('2026-10-25', ev('2026-10-25T23:30:00+01:00', '2026-10-26T00:30:00+01:00')),
      P.projectCalendarEventForDay('2026-10-26', ev('2026-10-25T23:30:00+01:00', '2026-10-26T00:30:00+01:00')),
      D.hourLabel(9 + 59.75 / 60),
    ]))`], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, TZ: 'Europe/Oslo' } }).toString()
  const [spring, autumn, late, tail, label] = JSON.parse(out)
  eq([spring.startHour, spring.endHour], [10, 11], 'spring forward (28.03.2027): a 10:00 event is at 10, not 9')
  eq([autumn.startHour, autumn.endHour], [10, 11], 'fall back (25.10.2026): a 10:00 event is at 10, not 11')
  eq([late.startHour, late.endHour], [23.5, 24], 'fall back: 23:30 → past midnight ends at 24, never 25')
  eq([tail.startHour, tail.endHour, tail.spillover], [0, 0.5, true], '…and its tail is 00:00–00:30 the next day')
  eq(label, '10:00', 'hourLabel rounds as a whole: 09:59:45 reads 10:00, never 09:60')
}

console.log(`\nverify-day-items: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
