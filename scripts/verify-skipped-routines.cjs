#!/usr/bin/env node
/*
 * Verification — training skips (src/features/training/plan/skippedRoutines.ts)
 * against the REAL un-mocked module through sucrase (no unit-test runner by
 * this repo's convention): the week a skip is keyed by, the skip-reason rules
 * and which skip covers a planned session. The rhythm-based missed sessions
 * are retired (213): the plan's week is checked in verify-training-session.
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
check('the rhythm-based missed sessions are gone (213): the plan\'s week reads missed', !('readMissedSessions' in S) && !('missedSessionsFrom' in S) && !('missedSlot' in S))

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

console.log('\nskip shown in the session popup')
{
  const skips = [
    { id: 'k1', routine_id: 'upperB', week_start: '2026-09-21', reason: 'Busy — Got busy and tired.' },
    { id: 'k2', routine_id: 'lowerA', week_start: '2026-09-21', reason: 'Travel' },
  ]
  check('a skip covers its routine on any day of its week (Thu)', S.skipCovering(skips, 'upperB', '2026-09-24')?.id === 'k1')
  check('... and on the Sunday that ends it', S.skipCovering(skips, 'upperB', '2026-09-27')?.id === 'k1')
  check('the next week is not covered', S.skipCovering(skips, 'upperB', '2026-09-28') === null)
  check('another routine\'s skip never leaks', S.skipCovering(skips, 'upperA', '2026-09-24') === null)
  check('no matched routine → no skip', S.skipCovering(skips, null, '2026-09-24') === null)
  check('a session\'s own skip (with a task) covers no other plan of its routine\'s week (28.10.2026)',
    S.skipCovering([{ id: 'k3', routine_id: 'upperB', week_start: '2026-09-21', reason: 'Sick', task_id: 't-mon' }], 'upperB', '2026-09-24') === null)
  check('the reason exactly as written', S.skippedText(skips[0]) === 'Skipped: Busy — Got busy and tired.')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
