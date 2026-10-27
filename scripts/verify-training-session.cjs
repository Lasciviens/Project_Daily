// Checks THE status of a planned training session and its actions
// (src/features/training/plan/sessionState.ts), the one skip lookup
// (skippedRoutines.skipForPlan) and weekly-plan days left out of projections
// (dayAgendaProjection, migration 142).
//   node scripts/verify-training-session.cjs
require('sucrase/register')
const assert = require('assert')
const S = require('../src/features/training/plan/sessionState.ts')
const { skipForPlan } = require('../src/features/training/plan/skippedRoutines.ts')
const { projectRecurringBlocksForDay } = require('../src/features/daily/components/dayAgendaProjection.ts')
const { planFacts } = require('../src/features/training/plan/planFacts.ts')
const { matchDaySessions } = require('../src/features/training/components/calendar/calendarSessions.ts')

let n = 0
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }
const st = f => S.sessionStatus({ today: '2026-10-12', ...f })
// A plan planned from a routine (141 links its task to it).
const R = { taskRoutineId: 'r-lower-b' }

// ── The owner's screenshot (12.10.2026): Sunday's plan, its task still open ──
{
  const s = st({ date: '2026-10-11', startHHMM: '14:30', minutes: 60, taskStatus: 'open', ...R })
  eq(s.state, 'pending', 'an open plan from yesterday is not "Missed": a workout still completes it')
  eq(s.countsUntil, '2026-10-17', '141 window: six days after the planned day')
  eq(S.sessionNote(s, 'Lower B'), 'A Lower B workout until Sat 17.10.2026 still counts.', 'the note says until when, DD.MM.YYYY')
  eq(S.SESSION_LABEL[s.state], 'Not logged yet', 'label')
  eq(S.sessionActions(s, { hasTask: true, weekly: false }), ['done', 'move', 'skip', 'edit', 'delete'], 'every task action while it is open')
}

// ── The task decides ──
eq(st({ date: '2026-10-11', taskStatus: 'done', taskWorkoutId: 'w1' }).doneBy, 'workout', 'done by its linked workout')
eq(st({ date: '2026-10-11', taskStatus: 'done', taskWorkoutId: 'w1' }).workoutId, 'w1', 'the workout id comes along')
eq(st({ date: '2026-10-11', taskStatus: 'done' }).doneBy, 'hand', 'a tick with no workout is done by hand')
eq(S.sessionNote(st({ date: '2026-10-11', taskStatus: 'done' })), 'Marked done by hand.', 'hand note')
eq(st({ date: '2026-10-20', taskStatus: 'done' }).state, 'done', 'done ahead of its day is done')
{
  const s = st({ date: '2026-10-11', taskStatus: 'cancelled', skipReason: 'Sick — flu' })
  eq(s.state, 'skipped', 'a cancelled task is a skipped session')
  eq(S.sessionNote(s), 'Skipped: Sick — flu', 'with its reason, exactly as written')
  eq(S.SESSION_TONE[s.state], 'neutral', 'skipped is grey (owner)')
  eq(S.sessionActions(s, { hasTask: true, weekly: false }), ['undoSkip', 'move', 'edit', 'delete'], 'undo, move (to do again inside its week, 167), edit, delete')
}
// ── 167: a session lives one week (its first day and the next six) ──
eq(st({ date: '2026-10-14', taskStatus: 'open', firstDate: '2026-10-12', today: '2026-10-17', ...R }).countsUntil, '2026-10-18',
  'moved two days inside its week: a late workout counts until the end of its week, not six days after its new day')
eq(st({ date: '2026-10-14', taskStatus: 'open', firstDate: '2026-10-12', today: '2026-10-19', ...R }).state, 'missed',
  'after its week: no longer "Not logged yet" (the database skips it on its first day)')
eq(st({ date: '2026-10-12', taskStatus: 'open', firstDate: '2026-10-12', today: '2026-10-15', ...R }).countsUntil, '2026-10-18',
  'on its first day: six days after it, as 141')
eq(S.movesPastWeek('2026-10-26', '2026-11-01'), false, 'moved 6 days: just moved')
eq(S.movesPastWeek('2026-10-26', '2026-11-02'), true, 'moved 7 days: out of its week (skipped there)')
eq(S.movesPastWeek('2026-10-26', '2026-11-04'), true, "the owner's example: 26.10 → 04.11 (9 days)")
eq(S.movesPastWeek(null, '2026-11-04'), false, 'no first day known (before 167): never claims it')
eq(st({ date: '2026-10-11', taskStatus: 'cancelled' }).skipReason, null, 'cancelled with no skip row read: no reason, still skipped')
eq(st({ date: '2026-10-11', taskStatus: 'open', activityOnDay: true, ...R }).state, 'pending', 'Strava never closes an open task (only a workout or a tick)')
eq(st({ date: '2026-10-11', taskStatus: 'open', skipped: true, skipReason: 'Travel', ...R }).state, 'pending', 'a routine-week skip does not cancel an open task by itself')
eq(st({ date: '2026-10-11', taskStatus: 'in_progress', ...R }).state, 'pending', 'in progress counts as open')
eq(st({ date: '2026-10-11', taskStatus: 'waiting', ...R }).state, 'pending', 'waiting counts as open')

// ── Review fixes (12.10.2026) ──
eq(st({ date: '2026-10-11', taskStatus: 'open' }).state, 'missed', 'no routine: no later workout can close it, so not "Not logged yet"')
eq(st({ date: '2026-10-11', taskStatus: 'open', dayWorkoutId: 'w9', ...R }).state, 'pending', 'a plan with a task is done only through its task, never by a same-day workout alone')
eq(st({ date: '2026-10-12', taskStatus: 'open', dayWorkoutId: 'w9' }).state, 'today', '…also today')

// ── The six-day window, both edges ──
eq(st({ date: '2026-10-06', taskStatus: 'open', ...R }).state, 'pending', 'day 6 after the plan: still counts')
eq(st({ date: '2026-10-05', taskStatus: 'open', ...R }).state, 'missed', 'day 7: missed')
eq(S.sessionNote(st({ date: '2026-10-05', taskStatus: 'open' })), 'Nothing was logged.', 'missed note')
eq(S.sessionActions(st({ date: '2026-10-05', taskStatus: 'open' }), { hasTask: true, weekly: false }), ['done', 'move', 'skip', 'edit', 'delete'], 'a missed plan can still be done, moved or skipped')

// ── A repeat's day closed as missed (156: cancelled + closed_reason 'missed') is not a skip ──
eq(st({ date: '2026-10-11', taskStatus: 'cancelled', taskMissed: true, ...R }).state, 'pending', 'a training day the job closed as missed still reads "Not logged yet" while a late workout completes it (141)')
eq(st({ date: '2026-10-05', taskStatus: 'cancelled', taskMissed: true, ...R }).state, 'missed', '…then Missed — never Skipped')
eq(st({ date: '2026-10-05', taskStatus: 'cancelled', taskMissed: true, ...R }).open, true, '…and it can still be done, moved or skipped')
eq(planFacts({ date: '2026-10-11', taskId: 't', taskStatus: 'cancelled', taskMissed: true, routineId: 'r' },
  { today: '2026-10-12', skips: [{ id: 's', routine_id: 'r', week_start: '2026-10-05', reason: 'Travel', task_id: null }] }).skipped, false,
  'a missed day is read like an open plan: its routine\'s week skip does not make it Skipped (only its own skip row would)')

// ── A plan with no task (a weekly day, an older block) reads its day ──
eq(st({ date: '2026-10-11' }).state, 'missed', 'no task, nothing logged: missed (no late window without a task)')
eq(st({ date: '2026-10-11', dayWorkoutId: 'w9' }).state, 'done', 'a workout that day covers it')
eq(st({ date: '2026-10-11', dayWorkoutId: 'w9' }).doneBy, 'workout', 'by that workout')
eq(st({ date: '2026-10-11', activityOnDay: true }).doneBy, 'activity', 'a Strava day covers a plan with no task')
eq(S.sessionNote(st({ date: '2026-10-11', activityOnDay: true })), 'A Strava activity covered that day.', 'activity note')
eq(st({ date: '2026-10-14', activityOnDay: true }).state, 'upcoming', 'a future "activity" never marks it done')
eq(st({ date: '2026-10-11', skipped: true, skipReason: 'Busy' }).state, 'skipped', 'its routine week skipped')
eq(S.sessionActions(st({ date: '2026-10-11', skipped: true, skipReason: 'Busy' }), { hasTask: false, weekly: true }), ['undoSkip'], 'undo the week skip')
eq(S.sessionActions(st({ date: '2026-10-13' }), { hasTask: false, weekly: true }), ['done', 'move', 'skip'], 'a weekly day: done, move, skip (its weekly plan is edited apart)')
eq(S.sessionActions(st({ date: '2026-10-11', dayWorkoutId: 'w9' }), { hasTask: false, weekly: true }), [], 'a weekly day a workout did: nothing to do')
eq(S.sessionActions(st({ date: '2026-10-11', activityOnDay: true }), { hasTask: false, weekly: false }), ['delete'], 'an older block covered by Strava can be deleted')

// ── Today and now ──
eq(st({ date: '2026-10-12', startHHMM: '18:00', minutes: 60, taskStatus: 'open', nowHHMM: '17:59' }).state, 'today', 'before its time: today')
eq(st({ date: '2026-10-12', startHHMM: '18:00', minutes: 60, taskStatus: 'open', nowHHMM: '18:00' }).state, 'now', 'at its start: now')
eq(st({ date: '2026-10-12', startHHMM: '18:00', minutes: 60, taskStatus: 'open', nowHHMM: '18:59' }).state, 'now', 'inside its hour: now')
eq(st({ date: '2026-10-12', startHHMM: '18:00', minutes: 60, taskStatus: 'open', nowHHMM: '19:00' }).state, 'today', 'after it, still today (a workout today still counts)')
eq(st({ date: '2026-10-12', taskStatus: 'open', nowHHMM: '12:00' }).state, 'today', 'no time: today')
eq(st({ date: '2026-10-12', startHHMM: '18:00', taskStatus: 'open' }).state, 'today', 'no clock given: today')
eq(st({ date: '2026-10-13', taskStatus: 'open' }).state, 'upcoming', 'tomorrow: upcoming')
eq(st({ date: '2026-10-13', taskStatus: 'open' }).open, true, 'upcoming is open')
eq(st({ date: '2026-10-11', taskStatus: 'done' }).open, false, 'done is not open')

// ── Done by a workout: no Reopen (the workout would close it again) ──
eq(S.sessionActions(st({ date: '2026-10-11', taskStatus: 'done', taskWorkoutId: 'w1' }), { hasTask: true, weekly: false }), ['edit', 'delete'], 'trained: edit, delete')
eq(S.sessionActions(st({ date: '2026-10-11', taskStatus: 'done' }), { hasTask: true, weekly: false }), ['reopen', 'edit', 'delete'], 'ticked by hand: reopen too')

// ── Labels and tones cover every state ──
for (const k of ['upcoming', 'today', 'now', 'pending', 'done', 'skipped', 'missed']) {
  eq(typeof S.SESSION_LABEL[k], 'string', `label for ${k}`)
  eq(typeof S.SESSION_TONE[k], 'string', `tone for ${k}`)
}

// ── weekStartOf: the Monday a skip is keyed by ──
eq(S.weekStartOf('2026-10-11'), '2026-10-05', 'a Sunday belongs to the week before Monday')
eq(S.weekStartOf('2026-10-12'), '2026-10-12', 'a Monday is its own week')
eq(S.weekStartOf('2026-03-29'), '2026-03-23', 'across the DST change')

// ── The one skip lookup ──
{
  const skips = [
    { id: 'a', routine_id: 'r1', week_start: '2026-10-05', reason: 'Sick', task_id: 't1' },
    { id: 'b', routine_id: 'r2', week_start: '2026-10-05', reason: 'Travel', task_id: null },
  ]
  eq(skipForPlan(skips, { taskId: 't1', taskCancelled: true, routineId: 'r1', date: '2026-10-11' })?.id, 'a', 'the task\'s own skip')
  eq(skipForPlan(skips, { taskId: 't1', taskCancelled: false, routineId: 'r1', date: '2026-10-11' })?.id, 'a', 'its own skip even before the status refetch')
  eq(skipForPlan(skips, { taskId: 't2', taskCancelled: false, routineId: 'r2', date: '2026-10-11' }), null, 'an open task is not skipped by its routine\'s week')
  eq(skipForPlan(skips, { taskId: 't2', taskCancelled: true, routineId: 'r2', date: '2026-10-11' })?.id, 'b', 'a cancelled task with no row reads its routine\'s week')
  eq(skipForPlan(skips, { taskId: null, routineId: 'r2', date: '2026-10-07' })?.id, 'b', 'a plan with no task: its routine\'s week')
  eq(skipForPlan(skips, { taskId: null, routineId: 'r2', date: '2026-10-13' }), null, 'another week: not skipped')
  eq(skipForPlan(skips, { taskId: null, routineId: null, date: '2026-10-07' }), null, 'no routine, no task: nothing to match')
}

// ── A weekly plan leaves out the days that became plans of their own (142) ──
{
  const tpl = { id: 'w', title: 'Upper A', start_time: '17:00:00', end_time: '18:00:00', days_of_week: [1, 4], except_dates: ['2026-10-12'] }
  eq(projectRecurringBlocksForDay('2026-10-12', [tpl]).length, 0, 'the excepted Monday is left out')
  eq(projectRecurringBlocksForDay('2026-10-19', [tpl]).length, 1, 'the next Monday is still there')
  eq(projectRecurringBlocksForDay('2026-10-12', [{ ...tpl, except_dates: undefined }]).length, 1, 'before 142 (no column): nothing left out')
  const late = { id: 'n', title: 'Night', start_time: '23:00:00', end_time: '01:00:00', days_of_week: [1], except_dates: ['2026-10-12'] }
  eq(projectRecurringBlocksForDay('2026-10-13', [late]).length, 0, 'its tail after midnight goes with it')
  eq(projectRecurringBlocksForDay('2026-10-20', [late]).filter(p => p.spillover).length, 1, 'another week keeps its tail')
}

// ── One set of facts for every view (planFacts) ──
{
  const skips = [{ id: 's1', routine_id: 'r1', week_start: '2026-10-05', reason: 'Holiday', task_id: null }]
  const ctx = { today: '2026-10-12', skips }
  const weekly = planFacts({ date: '2026-10-08', title: 'x', routineId: 'r1' }, ctx)
  eq(S.sessionStatus(weekly).state, 'skipped', 'a weekly day whose routine week was skipped reads Skipped (every view)')
  eq(weekly.skipId, 's1', '…and carries the skip to undo')
  const open = planFacts({ date: '2026-10-08', taskId: 't1', taskStatus: 'open', taskRoutineId: 'r1' }, ctx)
  eq(S.sessionStatus(open).state, 'pending', 'an open task is not skipped by its routine\'s week')
  eq(planFacts({ date: '2026-10-11', taskId: 't1' }, ctx).taskStatus, 'open', 'a task with no status read yet counts as open')
  eq(planFacts({ date: '2026-10-11', taskId: 't1', taskStatus: 'open' }, { ...ctx, dayWorkoutId: 'w1' }).dayWorkoutId, null, 'a same-day workout is never handed to a plan with a task')
  eq(planFacts({ date: '2026-10-11', taskId: 't1', taskRoutineId: 'r9', routineId: 'r1' }, ctx).routineId, 'r9', 'the task\'s routine wins over a title match')
}

// ── The calendar pairs a plan with a task only through its task (141) ──
{
  const W = (id, routine_id, t) => ({ id, title: 'Lower B', routine_id, start_time: `2026-10-11T${t}:00` })
  const plan = (id, tb) => ({ id, title: 'Lower B', kind: 'block', timeBlock: { id, title: 'Lower B', date: '2026-10-11', start_time: '18:00:00', source_type: 'training_session', source_id: 'r1', ...tb } })
  const day = (plans, workouts) => matchDaySessions({ date: '2026-10-11', todayStr: '2026-10-12', plans, workouts, hasActivity: false })
  let d = day([plan('p1', { task_id: 't1', task_status: 'cancelled' })], [W('w1', 'r1', '18:05')])
  eq([d.sessions[0].plans.length, d.openPlans[0].status], [0, 'skipped'], 'a skipped plan is not covered by a freeform/any workout that day: it stays Skipped')
  d = day([plan('p1', { task_id: 't1', task_status: 'open', task_routine_id: 'r1' })], [W('w1', 'r1', '18:05')])
  eq([d.sessions[0].plans.length, d.openPlans[0].status], [0, 'pending'], 'an open task the database did not close stays open (the task row agrees)')
  d = day([plan('p1', { task_id: 't1', task_status: 'done', task_workout_id: 'w2' })], [W('w1', 'r1', '18:05'), W('w2', 'r1', '19:30')])
  eq(d.sessions.find(x => x.workout.id === 'w2').plans.map(p => p.id), ['p1'], 'a done plan pairs with the workout linked to its task')
  d = day([plan('p1', { task_id: 't1', task_status: 'done' })], [W('w1', null, '18:05')])
  eq(d.sessions[0].plans.map(p => p.id), ['p1'], 'a plan ticked done by hand may show the day\'s workout')
  d = day([plan('p1', {})], [W('w1', 'r1', '18:05')])
  eq(d.sessions[0].plans.map(p => p.id), ['p1'], 'a plan with no task is covered by its routine\'s workout, as before')
}

// ── Guard: one status, one writer (owner, 12.10.2026: "shared components and
//    hooks, so this can't come back") ──
{
  const fs = require('fs')
  const path = require('path')
  const files = []
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name)) files.push(f) } }
  walk(path.join(__dirname, '..', 'src'))
  const rel = f => path.relative(path.join(__dirname, '..'), f).split(path.sep).join('/')
  const offenders = (re, allowed) => files.filter(f => !allowed.includes(rel(f)) && re.test(fs.readFileSync(f, 'utf8'))).map(rel)
  eq(offenders(/['"]Not logged yet['"]|['"]Missed['"]/, ['src/features/training/plan/sessionState.ts']), [],
    'a session\'s status words come only from plan/sessionState (no view computes its own)')
  eq(offenders(/from\(['"]training_skips['"]\)/, ['src/features/training/api/trainingSkipsApi.ts', 'src/features/training/api/trainingPlanApi.ts']), [],
    'only the two training APIs read or write training_skips')
}

console.log(`verify-training-session: ${n} checks passed`)
