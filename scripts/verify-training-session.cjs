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

let n = 0
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }
const st = f => S.sessionStatus({ today: '2026-10-12', ...f })

// ── The owner's screenshot (12.10.2026): Sunday's plan, its task still open ──
{
  const s = st({ date: '2026-10-11', startHHMM: '14:30', minutes: 60, taskStatus: 'open' })
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
  eq(S.sessionActions(s, { hasTask: true, weekly: false }), ['undoSkip', 'edit', 'delete'], 'undo, edit, delete')
}
eq(st({ date: '2026-10-11', taskStatus: 'cancelled' }).skipReason, null, 'cancelled with no skip row read: no reason, still skipped')
eq(st({ date: '2026-10-11', taskStatus: 'open', activityOnDay: true }).state, 'pending', 'Strava never closes an open task (only a workout or a tick)')
eq(st({ date: '2026-10-11', taskStatus: 'open', skipped: true, skipReason: 'Travel' }).state, 'pending', 'a routine-week skip does not cancel an open task by itself')
eq(st({ date: '2026-10-11', taskStatus: 'in_progress' }).state, 'pending', 'in progress counts as open')
eq(st({ date: '2026-10-11', taskStatus: 'waiting' }).state, 'pending', 'waiting counts as open')

// ── The six-day window, both edges ──
eq(st({ date: '2026-10-06', taskStatus: 'open' }).state, 'pending', 'day 6 after the plan: still counts')
eq(st({ date: '2026-10-05', taskStatus: 'open' }).state, 'missed', 'day 7: missed')
eq(S.sessionNote(st({ date: '2026-10-05', taskStatus: 'open' })), 'Nothing was logged.', 'missed note')
eq(S.sessionActions(st({ date: '2026-10-05', taskStatus: 'open' }), { hasTask: true, weekly: false }), ['done', 'move', 'skip', 'edit', 'delete'], 'a missed plan can still be done, moved or skipped')

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
  eq(projectRecurringBlocksForDay('2026-10-12', 1, [tpl]).length, 0, 'the excepted Monday is left out')
  eq(projectRecurringBlocksForDay('2026-10-19', 1, [tpl]).length, 1, 'the next Monday is still there')
  eq(projectRecurringBlocksForDay('2026-10-12', 1, [{ ...tpl, except_dates: undefined }]).length, 1, 'before 142 (no column): nothing left out')
  const late = { id: 'n', title: 'Night', start_time: '23:00:00', end_time: '01:00:00', days_of_week: [1], except_dates: ['2026-10-12'] }
  eq(projectRecurringBlocksForDay('2026-10-13', 2, [late]).length, 0, 'its tail after midnight goes with it')
  eq(projectRecurringBlocksForDay('2026-10-20', 2, [late]).filter(p => p.spillover).length, 1, 'another week keeps its tail')
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
