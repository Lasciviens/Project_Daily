#!/usr/bin/env node
/*
 * Verification — program-level progress decisions
 * (src/features/training/progress-engine/program.ts). The retired
 * per-exercise half of progressDecisions.ts (and progressCopy.ts) was deleted
 * on 2026-09-27; per-exercise behaviour is covered by
 * scripts/verify-progress-engine.cjs. This script covers what's left at the
 * program level, reading the engine's ExerciseProgressResult directly:
 *   1. computeProgramDecision — the 3-state verdict, "improving" = a
 *      progressing recent trend or a measured best/target event (NOT merely
 *      building at the same load), and review_workload needing BOTH >= 2
 *      declining exercises AND a corroborating signal.
 *   2. sleepCorroboratingSignal — the last two COMPLETE weeks vs the two
 *      before; stale or missing weeks never count; the in-progress week is
 *      never read.
 *   3. filterToCurrentProgram — explicit membership + freeform pass-through.
 *   4. lastTrainedByRoutine / suggestCurrentProgramRoutineIds — suggestions
 *      come from when a routine was TRAINED, never when it was edited.
 *   5. Labels.
 *
 *   Run:  node scripts/verify-progress-decisions.cjs
 */
require('sucrase/register')

const {
  computeProgramDecision, sleepCorroboratingSignal, filterToCurrentProgram, lastTrainedByRoutine,
  suggestCurrentProgramRoutineIds, progressVerdictHeadline, workloadLabel, isImproving, isAnalyzable,
} = require('../src/features/training/progress-engine/program')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function result(id, over) {
  return {
    exerciseTemplateId: id, currentAction: 'BUILD_AT_CURRENT_LOAD', events: [],
    trend: { recentProgressTrend: 'FLAT_NORMAL_VARIATION' }, evidence: { progress: 'moderate', recommendation: 'strong' },
    ...over,
  }
}

console.log('\n== 1. computeProgramDecision ==')
{
  const progressing = result('a', { trend: { recentProgressTrend: 'PROGRESSING' } })
  const withPr = result('b', { events: [{ code: 'LOAD_PR', emphasis: 'primary', values: {} }] })
  const flatBuild = result('c')
  const estimatedOnly = result('d', { events: [{ code: 'ESTIMATED_STRENGTH_PR', emphasis: 'secondary', values: {} }] })
  const insufficient = result('e', { currentAction: 'INSUFFICIENT_DATA', evidence: { progress: 'limited', recommendation: null } })
  const decliningOne = result('f', { currentAction: 'WATCH_FOR_REGRESSION' })
  const decliningTwo = result('g', { currentAction: 'WATCH_FOR_REGRESSION' })

  check('a progressing recent trend counts as improving', isImproving(progressing))
  check('a 6-month best in the latest session counts as improving', isImproving(withPr))
  check('merely building at the same load does NOT count as improving (it used to inflate "X of Y improved")', !isImproving(flatBuild))
  check('an estimated-strength event alone does not count', !isImproving(estimatedOnly))
  check('INSUFFICIENT_DATA is not analyzable', !isAnalyzable(insufficient))

  const p = computeProgramDecision([progressing, withPr, flatBuild, insufficient], null)
  check('2 of 3 analyzable improving -> progressing', p.progressVerdict === 'progressing' && p.analyzableCount === 3 && p.improvingCount === 2)
  check('reliableCount counts moderate/strong progress evidence only', p.reliableCount === 3)

  const mixed = computeProgramDecision([progressing, flatBuild, estimatedOnly], null)
  check('1 of 3 improving -> mixed', mixed.progressVerdict === 'mixed')
  check('nothing analyzable -> insufficient_data', computeProgramDecision([insufficient], null).progressVerdict === 'insufficient_data')

  check('review_workload needs >= 2 declining — one is not enough even with a signal',
    computeProgramDecision([progressing, decliningOne], { label: 'sleep down' }).workload === 'continue')
  check('review_workload needs a corroborating signal — 2 declining alone is not enough',
    computeProgramDecision([decliningOne, decliningTwo], null).workload === 'continue')
  const review = computeProgramDecision([decliningOne, decliningTwo], { label: 'sleep down ~1h/night over the last 2 complete weeks' })
  check('>= 2 declining AND a signal -> review_workload', review.workload === 'review_workload')
  check('the signal label is carried through', review.corroboratingSignal === 'sleep down ~1h/night over the last 2 complete weeks')
  check('affected exercise ids are the declining ones', review.affectedExerciseIds.sort().join(',') === 'f,g')
  check('"ease_off" no longer exists — only continue / review_workload', ['continue', 'review_workload'].includes(review.workload))
}

console.log('\n== 2. sleepCorroboratingSignal ==')
{
  const lastComplete = '2026-09-14'
  const weeks = (vals, start = '2026-08-24') => {
    const out = []
    const d = new Date(start + 'T00:00:00')
    for (const v of vals) {
      out.push({ weekStart: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, avgHours: v })
      d.setDate(d.getDate() + 7)
    }
    return out
  }
  const drop = sleepCorroboratingSignal(weeks([7.5, 7.5, 6.4, 6.4]), lastComplete)
  check('a >0.75h drop over the last 2 complete weeks fires', drop !== null && drop.label.includes('last 2 complete weeks'))
  check('a small drop does not fire', sleepCorroboratingSignal(weeks([7.5, 7.5, 7.1, 7.0]), lastComplete) === null)
  check('a week missing its average (fewer than 4 nights) blocks the read', sleepCorroboratingSignal(weeks([7.5, 7.5, null, 6.0]), lastComplete) === null)
  check('stale weeks months ago never count as "the last 2 weeks"', sleepCorroboratingSignal(weeks([7.5, 7.5, 6.0, 6.0], '2026-05-04'), lastComplete) === null)
  const withPartial = [...weeks([7.5, 7.5, 7.4, 7.4]), { weekStart: '2026-09-21', avgHours: 4 }]
  check('the in-progress week is never read', sleepCorroboratingSignal(withPartial, lastComplete) === null)
}

console.log('\n== 3. filterToCurrentProgram ==')
{
  const sets = [{ routine_id: 'r1' }, { routine_id: 'r2' }, { routine_id: null }]
  const filtered = filterToCurrentProgram(sets, new Set(['r1']))
  check('keeps current-program and freeform sets, drops another routine', filtered.length === 2 && filtered.every(s => s.routine_id !== 'r2'))
  check('no selection -> nothing filtered (callers gate on the selection)', filterToCurrentProgram(sets, new Set()).length === 3)
}

console.log('\n== 4. Current-program suggestion from TRAINING, not editing ==')
{
  const sets = [
    { routine_id: 'upper', date: '2026-09-20' },
    { routine_id: 'lower', date: '2026-09-18' },
    { routine_id: 'upper', date: '2026-09-10' },
    { routine_id: 'old', date: '2026-06-01' },
    { routine_id: null, date: '2026-09-21' },
  ]
  const last = lastTrainedByRoutine(sets)
  check('lastTrainedByRoutine keeps the latest trained day per routine', last.get('upper') === '2026-09-20' && last.get('lower') === '2026-09-18')
  check('freeform sessions carry no routine', !last.has(null))
  const suggested = suggestCurrentProgramRoutineIds(['old', 'lower', 'upper', 'never-trained'], sets, '2026-09-27')
  check('suggests routines trained in the last 28 days, most recent first', suggested.join(',') === 'upper,lower')
  check('an old routine (edited or not) is never suggested', !suggested.includes('old') && !suggested.includes('never-trained'))
}

console.log('\n== 5. Labels ==')
{
  check('progressVerdictHeadline', progressVerdictHeadline('progressing') === 'Progressing' && progressVerdictHeadline('mixed') === 'Mixed' && progressVerdictHeadline('insufficient_data') === 'Not enough data yet')
  check('workloadLabel', workloadLabel('review_workload') === 'Review workload' && workloadLabel('continue') === 'Continue')
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
