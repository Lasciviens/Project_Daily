#!/usr/bin/env node
/*
 * Verification — missed current-program sessions (src/features/training/plan/
 * skippedRoutines.ts) against the REAL un-mocked module through sucrase (no
 * unit-test runner by this repo's convention): the 7-day threshold, the
 * due-day rhythm a skip is keyed by, one-off plans vs recurring templates,
 * join-day grace, ordering, and the skip-reason rules.
 *
 *   Run:  node scripts/verify-skipped-routines.cjs
 */
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'

const S = require('../src/features/training/plan/skippedRoutines')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const J = JSON.stringify

console.log('\ndates')
check('shiftDay forward across a month', S.shiftDay('2026-09-28', 5) === '2026-10-03')
check('shiftDay across the October DST change', S.shiftDay('2026-10-24', 2) === '2026-10-26')
check('weekStartOf a Sunday is the Monday before', S.weekStartOf('2026-09-27') === '2026-09-21')
check('weekStartOf a Monday is itself', S.weekStartOf('2026-09-28') === '2026-09-28')
check('missedSlot: 7 days since → nothing missed yet', S.missedSlot('2026-09-21', '2026-09-28') === null)
check('missedSlot: 8 days → the due day was yesterday', S.missedSlot('2026-09-18', '2026-09-26') === '2026-09-25')
check('missedSlot: 9 days → still the same due day', S.missedSlot('2026-09-18', '2026-09-27') === '2026-09-25')
check('missedSlot: 14 days → the second slot is today, so still the first', S.missedSlot('2026-09-13', '2026-09-27') === '2026-09-20')
check('missedSlot: 15 days → the second slot (yesterday)', S.missedSlot('2026-09-12', '2026-09-27') === '2026-09-26')

console.log('\nreadMissedSessions')
{
  // A four-routine weekly split; today is Sunday 27 Sep 2026.
  const today = '2026-09-27'
  const program = [
    { id: 'ua', title: 'Upper A', joinedOn: '2026-09-02' },
    { id: 'lb', title: 'Lower B', joinedOn: '2026-09-02' },
    { id: 'ub', title: 'Upper B', joinedOn: '2026-09-02' },
    { id: 'la', title: 'Lower A', joinedOn: '2026-09-02' },
  ]
  const last = new Map([['ua', '2026-09-21'], ['lb', '2026-09-18'], ['ub', '2026-09-24'], ['la', '2026-09-22']])
  const base = { program, lastTrained: last, upcoming: [], skips: [], today }

  const r = S.readMissedSessions(base)
  check('only the routine done more than 7 days ago is flagged', r.length === 1 && r[0].routineId === 'lb', J(r))
  check('flagged as overdue with 9 days and the missed Friday', r[0].kind === 'overdue' && r[0].daysSince === 9 && r[0].dueDate === '2026-09-25' && r[0].weekStart === '2026-09-21', J(r[0]))
  check('missedText says 9 days', S.missedText(r[0]) === 'not done in 9 days')

  // Recurring templates are not passed as upcoming — a one-off plan is.
  const planned = S.readMissedSessions({ ...base, upcoming: [{ title: 'Lower B', date: '2026-09-29', startTime: '17:00', sourceId: 'lb' }] })
  check('a one-off plan on a later day → replanned', planned.length === 1 && planned[0].kind === 'replanned' && planned[0].plannedDate === '2026-09-29', J(planned))
  const plannedToday = S.readMissedSessions({ ...base, upcoming: [{ title: 'Something', date: today, startTime: null, sourceId: 'lb' }] })
  check('a plan today counts (matched by source id)', plannedToday[0]?.kind === 'replanned' && plannedToday[0].plannedDate === today, J(plannedToday))
  const byTitle = S.readMissedSessions({ ...base, upcoming: [{ title: 'Lower B — heavy', date: '2026-09-30', startTime: null }] })
  check('a plan matched by title', byTitle[0]?.kind === 'replanned', J(byTitle))
  const twoPlans = S.readMissedSessions({ ...base, upcoming: [
    { title: 'Lower B', date: '2026-10-02', startTime: null, sourceId: 'lb' },
    { title: 'Lower B', date: '2026-09-28', startTime: null, sourceId: 'lb' },
  ] })
  check('the earliest plan is the one shown', twoPlans[0]?.plannedDate === '2026-09-28', J(twoPlans))
  const pastPlan = S.readMissedSessions({ ...base, upcoming: [{ title: 'Lower B', date: '2026-09-26', startTime: null, sourceId: 'lb' }] })
  check('a plan in the past does not count', pastPlan[0]?.kind === 'overdue', J(pastPlan))
  const otherRoutine = S.readMissedSessions({ ...base, routines: [...program, { id: 'lb2', title: 'Lower B Heavy' }], upcoming: [{ title: 'Lower B Heavy', date: '2026-09-29', startTime: null }] })
  check('a plan for a different (non-program) routine does not silence it', otherRoutine[0]?.kind === 'overdue', J(otherRoutine))
  const genericPlan = S.readMissedSessions({ ...base, upcoming: [{ title: 'Training', date: '2026-09-29', startTime: null }] })
  check('a plan not linked to any routine does not silence it', genericPlan[0]?.kind === 'overdue')

  const skip = { id: 's1', routine_id: 'lb', week_start: '2026-09-21', reason: 'Sick' }
  const skipped = S.readMissedSessions({ ...base, skips: [skip] })
  check('a skip for the missed session\'s week → skipped with its reason', skipped[0]?.kind === 'skipped' && skipped[0].skip.reason === 'Sick', J(skipped))
  const nextMonday = S.readMissedSessions({ ...base, skips: [skip], today: '2026-09-28' })
  check('skipped on Sunday is still skipped on Monday (a new calendar week)', nextMonday[0]?.kind === 'skipped', J(nextMonday))
  const nextFriday = S.readMissedSessions({ ...base, skips: [skip], today: '2026-10-02', lastTrained: new Map([...last, ['ua', '2026-09-28'], ['la', '2026-09-29'], ['ub', '2026-10-01']]) })
  check('still skipped on the next due day itself', nextFriday.length === 1 && nextFriday[0].kind === 'skipped', J(nextFriday))
  const nextSaturday = S.readMissedSessions({ ...base, skips: [skip], today: '2026-10-03', lastTrained: new Map([...last, ['ua', '2026-09-28'], ['la', '2026-09-29'], ['ub', '2026-10-01']]) })
  check('the next missed Friday is flagged again (its own week)', nextSaturday[0]?.kind === 'overdue' && nextSaturday[0].dueDate === '2026-10-02' && nextSaturday[0].weekStart === '2026-09-28', J(nextSaturday))
  const oldSkip = S.readMissedSessions({ ...base, skips: [{ ...skip, week_start: '2026-09-14' }] })
  check('a skip for another week does not cover this one', oldSkip[0]?.kind === 'overdue')
  const otherSkip = S.readMissedSessions({ ...base, skips: [{ ...skip, routine_id: 'ua' }] })
  check('a skip for another routine does not cover this one', otherSkip[0]?.kind === 'overdue')
  const skipAndPlan = S.readMissedSessions({ ...base, skips: [skip], upcoming: [{ title: 'Lower B', date: '2026-09-29', startTime: null, sourceId: 'lb' }] })
  check('planned after skipping → shown as replanned', skipAndPlan[0]?.kind === 'replanned')

  const trainedAgain = S.readMissedSessions({ ...base, skips: [skip], lastTrained: new Map([...last, ['lb', '2026-09-26']]) })
  check('done again → nothing to show, skip or not', trainedAgain.length === 0, J(trainedAgain))
  const future = S.readMissedSessions({ ...base, lastTrained: new Map([...last, ['lb', '2026-09-30']]) })
  check('a last-trained day after today never flags', future.length === 0)
}

{
  const today = '2026-09-27'
  const program = [
    { id: 'a', title: 'A', joinedOn: '2026-09-25' },   // joined 2 days ago, never done
    { id: 'b', title: 'B', joinedOn: '2026-09-10' },   // joined long ago, never done
    { id: 'c', title: 'C', joinedOn: '2026-09-24' },   // last done 20 days ago, joined 3 days ago
    { id: 'd', title: 'D', joinedOn: null },           // never done, join day unknown
    { id: 'e', title: 'E', joinedOn: '2026-08-01' },   // 12 days
    { id: 'f', title: 'F', joinedOn: '2026-08-01' },   // 20 days
  ]
  const last = new Map([['c', '2026-09-07'], ['e', '2026-09-15'], ['f', '2026-09-07']])
  const r = S.readMissedSessions({ program, lastTrained: last, upcoming: [], skips: [], today })
  const ids = r.map(x => x.routineId)
  check('joined less than a week ago and not done → not flagged yet', !ids.includes('a'), J(ids))
  check('joined over a week ago and never done → flagged, due a week after joining', r.find(x => x.routineId === 'b')?.dueDate === '2026-09-24', J(r.find(x => x.routineId === 'b')))
  check('a routine just (re)added is not flagged for its old gap', !ids.includes('c'))
  check('never done with no join day → flagged, due yesterday', r.find(x => x.routineId === 'd')?.dueDate === '2026-09-26')
  check('order: never-done first (program order), then the longest gap', J(ids) === J(['b', 'd', 'f', 'e']), J(ids))
  check('never done → missedText mentions the 6-month window', S.missedText(r[0]) === 'no session in the last 6 months')
  check('empty program → nothing', S.readMissedSessions({ program: [], lastTrained: last, upcoming: [], skips: [], today }).length === 0)
}

{
  const r = S.readMissedSessions({ program: [{ id: 'x', title: 'X' }, { id: 'y', title: 'Y' }], lastTrained: new Map([['x', '2026-09-10'], ['y', '2026-09-01']]), upcoming: [{ title: 'X', date: '2026-09-28', startTime: null, sourceId: 'x' }], skips: [{ id: 's', routine_id: 'y', week_start: S.weekStartOf(S.missedSlot('2026-09-01', '2026-09-27')), reason: 'Travel' }], today: '2026-09-27' })
  check('order: overdue, then skipped, then replanned', J(r.map(x => x.kind)) === J(['skipped', 'replanned']), J(r.map(x => [x.routineId, x.kind])))
  const one = S.readMissedSessions({ program: [{ id: 'z', title: 'Z' }], lastTrained: new Map([['z', '2026-09-19']]), upcoming: [], skips: [], today: '2026-09-27' })
  check('singular/plural: 8 days', S.missedText(one[0]) === 'not done in 8 days')
  check('singular: 1 day', S.missedText({ daysSince: 1 }) === 'not done in 1 day')
}

console.log('\nmissedSessionsFrom (raw rows)')
{
  const today = '2026-09-27'
  const routines = [{ id: 'lb', title: 'Lower B' }, { id: 'ua', title: 'Upper A' }, { id: 'old', title: 'Old Routine' }]
  // created_at 22:30 UTC on 16 Sep = 00:30 on 17 Sep in Oslo → joined 17 Sep.
  const program = [{ routine_id: 'lb', created_at: '2026-09-02T08:29:31Z' }, { routine_id: 'ua', created_at: '2026-09-16T22:30:00Z' }, { routine_id: 'gone', created_at: '2026-09-02T08:00:00Z' }]
  const last = new Map([['lb', '2026-09-18']])
  const r = S.missedSessionsFrom({ routines, program, lastTrained: last, blocks: [], skips: [], today })
  check('program rows → only routines that still exist (never-done first)', r.map(x => x.routineId).join() === 'ua,lb', J(r.map(x => x.routineId)))
  check('join day is the LOCAL day of created_at', r.find(x => x.routineId === 'ua')?.dueDate === '2026-09-24', J(r.find(x => x.routineId === 'ua')))
  const planned = S.missedSessionsFrom({ routines, program, lastTrained: last, blocks: [{ title: 'Leg day', date: '2026-09-28', start_time: '17:00:00', source_type: 'training_session', source_id: 'lb' }], skips: [], today })
  check('a training_session block with the routine id → replanned', planned.find(x => x.routineId === 'lb')?.kind === 'replanned')
  const manualSrc = S.missedSessionsFrom({ routines, program, lastTrained: last, blocks: [{ title: 'Leg day', date: '2026-09-28', source_type: 'manual', source_id: 'lb' }], skips: [], today })
  check('source_id is only trusted on a training_session block', manualSrc.find(x => x.routineId === 'lb')?.kind === 'overdue')
  check('no program → nothing', S.missedSessionsFrom({ routines, program: [], lastTrained: last, blocks: [], skips: [], today }).length === 0)
  check('skips read from 8 weeks before this Monday', S.skipsFromWeek(today) === '2026-07-27', S.skipsFromWeek(today))
}

console.log('\nskip reasons')
check('chip + details', S.composeSkipReason('Sick', '  flu since Thursday ') === 'Sick — flu since Thursday')
check('chip alone', S.composeSkipReason('Travel', '   ') === 'Travel')
check('details alone', S.composeSkipReason(null, ' conference in Bergen ') === 'conference in Bergen')
check('nothing → empty', S.composeSkipReason(null, '  ') === '')
check('"Sick" is a valid reason', S.isValidSkipReason('Sick'))
check('two letters is not', !S.isValidSkipReason('ok'))
check('spaces do not count', !S.isValidSkipReason('  a  '))
check('empty is not', !S.isValidSkipReason(''))
check('over 500 characters is not', !S.isValidSkipReason('x'.repeat(501)))
check('every quick chip is valid on its own', S.SKIP_REASON_CHIPS.every(c => S.isValidSkipReason(S.composeSkipReason(c, ''))))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
