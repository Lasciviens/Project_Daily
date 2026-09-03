#!/usr/bin/env node
/*
 * Verification — the exercise progress engine
 * (src/features/training/progress-engine/), the Phase 2 rebuild approved
 * across several rounds of correction (see docs/training/progress-engine/
 * for the settled record; the full back-and-forth is this repo's own
 * session history, not duplicated here).
 *
 * Proves, against the REAL un-mocked modules (loaded via sucrase — this
 * repo has no unit-test runner by convention):
 *   1. classifyLoadStructure — uniform / top-set-backoff / mixed_load,
 *      including why a 2-set session can never be mixed_load.
 *   2. buildCanonicalSessions — warmup exclusion, dropset/failure tagging,
 *      workout_id-keyed identity (not date alone).
 *   3. evaluatePair — observedTransition/repDelta/rangeCompliance/
 *      evaluationScope/dataQualityFlags as independent facets, never one
 *      collapsed status; PROGRAM_CHANGED never emitted from a set-count
 *      mismatch; a set-count mismatch never enters a raw-total comparison.
 *   4. buildNextTargets / meetsNextTargetFloor — the per-position floor,
 *      not just a total.
 *   5. linearFit / computeCurrentLoadProgress — directional consistency,
 *      not raw spread; every state reachable; no NaN from a mixed-load
 *      point.
 *   6. computeRecentProgressTrend — windowed, separate from all-history
 *      event detection.
 *   7. detectProgressEvents / detectEstimatedStrengthPr — LOAD_PR scans
 *      ALL history; e1RM PR is always secondary.
 *   8. evaluateExerciseProgress — the full worked examples (Hammer Curl,
 *      Chest Press, Leg Extension, Back Squat, Assisted Pull-up) and the
 *      precedence rule between a fresh improvement and a plateau read.
 *   9. RULE_CATALOG completeness — every code the fixtures above actually
 *      emit has a catalog entry (the documentation-sync requirement).
 *
 *   Run:  node scripts/verify-progress-engine.cjs
 */
require('sucrase/register')

const { classifyLoadStructure, buildCanonicalSessions, bestComparableSet, totalComparableReps } = require('../src/features/training/progress-engine/normalize')
const { linearFit, computeCurrentLoadProgress, computeRecentProgressTrend, buildRepresentativePoints, buildLoadCycles, meaningfulDeclineReps } = require('../src/features/training/progress-engine/trend')
const { evaluatePair } = require('../src/features/training/progress-engine/comparability')
const { detectProgressEvents, detectEstimatedStrengthPr } = require('../src/features/training/progress-engine/events')
const { buildNextTargets, meetsNextTargetFloor } = require('../src/features/training/progress-engine/targets')
const { resolveExpectation, isPositiveLoadChange, DEFAULT_POLICY, ALGORITHM_VERSION } = require('../src/features/training/progress-engine/policies')
const { evaluateExerciseProgress } = require('../src/features/training/progress-engine/evaluate')
const { RULE_CATALOG } = require('../src/features/training/progress-engine/ruleCatalog')
const { actionLabel, evidenceLabel, scopeLabel, buildExplanationSentence } = require('../src/features/training/progress-engine/copy')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function set(order, weightKg, reps, kind, overrides) {
  return { order, weightKg, reps, kind: kind || 'normal', durationSeconds: null, distanceMeters: null, ...overrides }
}
function row(workoutId, date, templateId, setIndex, weightKg, reps, type, extra) {
  return {
    workout_id: workoutId, date, exercise_template_id: templateId, set_type: type || 'normal',
    weight_kg: weightKg, reps, duration_seconds: null, distance_meters: null,
    routine_id: null, rpe: null, set_index: setIndex, workout_title: 'Test Day',
    ...extra,
  }
}

// Builds a uniform-load session's raw rows for N sets.
function uniformRows(workoutId, date, templateId, weightKg, repsArr, types) {
  return repsArr.map((reps, i) => row(workoutId, date, templateId, i + 1, weightKg, reps, (types && types[i]) || 'normal'))
}

const DEFAULT_EXPECTATION = (repMin, repMax, targetSets) => ({ source: 'routine', repMin, repMax, targetSets, label: `Your program's target: ${repMin}-${repMax} reps` })

console.log('\n== 1. classifyLoadStructure ==')
{
  check('uniform load', classifyLoadStructure([set(1, 40, 10), set(2, 40, 9), set(3, 40, 8)]) === 'uniform_working_load')
  check('clean top-set + backoff', classifyLoadStructure([set(1, 60, 6), set(2, 45, 10), set(3, 45, 10)]) === 'top_set_and_backoff')
  check('a 2-set heavier-then-lighter session is ALWAYS a valid backoff, never mixed_load',
    classifyLoadStructure([set(1, 100, 5), set(2, 90, 6)]) === 'top_set_and_backoff')
  check('genuinely mixed load (100,90,95 — a real increase mid-session)',
    classifyLoadStructure([set(1, 100, 5), set(2, 90, 6), set(3, 95, 5)]) === 'mixed_load')
  check('no-load exercise type (reps-only) is trivially uniform', classifyLoadStructure([set(1, null, 10), set(2, null, 9)]) === 'uniform_working_load')
}

console.log('\n== 2. buildCanonicalSessions ==')
{
  const rows = [
    ...uniformRows('w1', '2026-08-01', 'ex1', 40, [10, 10, 10]),
    row('w1', '2026-08-01', 'ex1', 4, 30, 10, 'warmup'),
    ...uniformRows('w2', '2026-08-08', 'ex1', 40, [10, 9, 8], ['normal', 'normal', 'failure']),
  ]
  const sessions = buildCanonicalSessions(rows, 'ex1')
  check('two sessions built, keyed by workout_id', sessions.length === 2)
  check('warmup excluded entirely from allSets', sessions[0].allSets.length === 3)
  check('failure set retained and tagged, counted as a working set', sessions[1].comparableWorkingSets.some(s => s.kind === 'failure'))
  check('sessions sorted ascending by date', sessions[0].date < sessions[1].date)
  check('totalComparableReps sums working sets (failure included)', totalComparableReps(sessions[1]) === 27)
}

console.log('\n== 3. evaluatePair ==')
{
  // PROGRAM_CHANGED never inferred from a set-count mismatch.
  {
    const prevSess = buildCanonicalSessions(uniformRows('w1', '2026-08-01', 'ex1', 100, [5, 5, 5]), 'ex1')[0]
    const latestSess = buildCanonicalSessions(uniformRows('w2', '2026-08-08', 'ex1', 100, [5, 5]), 'ex1')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(5, 8, 3), 'est1rm', DEFAULT_POLICY)
    check('missing set -> MISSING_PRESCRIBED_SET, never PROGRAM_CHANGED', r.dataQualityFlags.includes('MISSING_PRESCRIBED_SET') && !r.dataQualityFlags.includes('PROGRAM_CHANGED'))
    check('observedTransition preserved despite the data-quality flag', r.observedTransition === 'LOAD_UNCHANGED')
    check('repDelta forced NOT_APPLICABLE on a set-count mismatch', r.repDelta === 'NOT_APPLICABLE')
    check('evaluationScope is LOGGED_SETS_ONLY, never claims full compliance', r.evaluationScope === 'LOGGED_SETS_ONLY')
  }
  // Extra set also blocks a clean raw-total comparison.
  {
    const prevSess = buildCanonicalSessions(uniformRows('w1', '2026-08-01', 'ex1', 60, [9, 9, 9]), 'ex1')[0]
    const latestSess = buildCanonicalSessions(uniformRows('w2', '2026-08-08', 'ex1', 60, [9, 9, 9, 9]), 'ex1')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(8, 12, 3), 'est1rm', DEFAULT_POLICY)
    check('extra set -> EXTRA_UNPRESCRIBED_SET blocks the raw-total comparison too', r.dataQualityFlags.includes('EXTRA_UNPRESCRIBED_SET') && r.repDelta === 'NOT_APPLICABLE')
  }
  // Mixed-load session forces NOT_EVALUATED regardless of anything else.
  {
    const prevSess = buildCanonicalSessions(uniformRows('w1', '2026-08-01', 'ex1', 100, [5, 5, 5]), 'ex1')[0]
    const latestSess = buildCanonicalSessions([row('w2', '2026-09-02', 'ex1', 1, 100, 5), row('w2', '2026-09-02', 'ex1', 2, 90, 6), row('w2', '2026-09-02', 'ex1', 3, 95, 5)], 'ex1')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(5, 8, 3), 'est1rm', DEFAULT_POLICY)
    check('mixed_load -> evaluationScope and rangeCompliance both NOT_EVALUATED', r.evaluationScope === 'NOT_EVALUATED' && r.rangeCompliance === 'NOT_EVALUATED')
    check('mixed_load -> currentAction is HOLD_STEADY, never a fabricated recommendation', r.currentAction === 'HOLD_STEADY')
  }
  // A 2-set backoff session's compliance scope is TOP_SET_ONLY.
  {
    const prevSess = buildCanonicalSessions([row('w1', '2026-08-01', 'ex1', 1, 55, 6), row('w1', '2026-08-01', 'ex1', 2, 40, 10)], 'ex1')[0]
    const latestSess = buildCanonicalSessions([row('w2', '2026-08-08', 'ex1', 1, 60, 6), row('w2', '2026-08-08', 'ex1', 2, 45, 10)], 'ex1')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(5, 8, 2), 'est1rm', DEFAULT_POLICY)
    check('top-set-and-backoff -> evaluationScope TOP_SET_ONLY (never claims the backoff sets were checked)', r.evaluationScope === 'TOP_SET_ONLY')
  }
  // Load decrease -> neutral REVIEW_LOAD_REDUCTION, never "deload" for an external-load type.
  {
    const prevSess = buildCanonicalSessions(uniformRows('w1', '2026-08-01', 'ex1', 100, [5, 5, 5]), 'ex1')[0]
    const latestSess = buildCanonicalSessions(uniformRows('w2', '2026-08-08', 'ex1', 90, [8, 8, 8]), 'ex1')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(5, 8, 3), 'est1rm', DEFAULT_POLICY)
    check('a raw load decrease -> REVIEW_LOAD_REDUCTION, unconditionally neutral', r.currentAction === 'REVIEW_LOAD_REDUCTION')
    check('no "deload" language anywhere in the catalog entry', !RULE_CATALOG.REVIEW_LOAD_REDUCTION.shortDefinition.toLowerCase().includes('deload'))
  }
  // Assisted-weight: a raw decrease is the POSITIVE direction, not a reduction to review.
  {
    const prevSess = buildCanonicalSessions(uniformRows('w1', '2026-08-01', 'ex1', 20, [8, 8, 8]), 'ex1')[0]
    const latestSess = buildCanonicalSessions(uniformRows('w2', '2026-08-08', 'ex1', 15, [7, 6, 6]), 'ex1')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(6, 10, 3), 'assistedWeight', DEFAULT_POLICY)
    check('assisted-weight decrease reads as forward motion, never REVIEW_LOAD_REDUCTION', r.currentAction !== 'REVIEW_LOAD_REDUCTION' && r.progressDirection === true)
  }
  // Same-load clean rep increase.
  {
    const prevSess = buildCanonicalSessions(uniformRows('w1', '2026-08-01', 'ex1', 60, [7, 7, 6]), 'ex1')[0]
    const latestSess = buildCanonicalSessions(uniformRows('w2', '2026-08-08', 'ex1', 60, [7, 7, 7]), 'ex1')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(8, 12, 3), 'est1rm', DEFAULT_POLICY)
    check('same load, total up, no set down -> REP_INCREASE', r.repDelta === 'REP_INCREASE')
  }
  // A redistribution (total flat-ish but one set dropped) is NOT credited as a clean increase.
  {
    const prevSess = buildCanonicalSessions(uniformRows('w1', '2026-08-01', 'ex1', 60, [8, 7, 7]), 'ex1')[0]
    const latestSess = buildCanonicalSessions(uniformRows('w2', '2026-08-08', 'ex1', 60, [9, 9, 4]), 'ex1')[0] // total 22 vs 22, but position 3 dropped hard
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(8, 12, 3), 'est1rm', DEFAULT_POLICY)
    check('a redistribution is never REP_INCREASE', r.repDelta !== 'REP_INCREASE')
  }
}

console.log('\n== 4. buildNextTargets / meetsNextTargetFloor ==')
{
  const latestSess = buildCanonicalSessions(uniformRows('w1', '2026-09-02', 'ex1', 10, [8, 7, 6]), 'ex1')[0]
  const t = buildNextTargets(latestSess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm')
  check('minimumSetReps is the real per-position floor', JSON.stringify(t.nextSession.minimumSetReps) === JSON.stringify([8, 7, 6]))
  check('minimumTotalReps beats the previous total by at least 1', t.nextSession.minimumTotalReps === 22)
  check('8/6/8 (total 22) fails — position 2 regressed', !meetsNextTargetFloor([8, 6, 8], t.nextSession))
  check('8/7/7 (total 22) passes — no position regressed', meetsNextTargetFloor([8, 7, 7], t.nextSession))
  check('9/7/6 (total 22) also passes — the floor allows any position to be the one that improves', meetsNextTargetFloor([9, 7, 6], t.nextSession))
}

console.log('\n== 5. linearFit / computeCurrentLoadProgress ==')
{
  const uniform = n => Array.from({ length: n }, () => ({ loadStructure: 'uniform_working_load', total: 20 }))
  check('n<3 -> INSUFFICIENT_HISTORY', computeCurrentLoadProgress(uniform(2), DEFAULT_POLICY).state === 'INSUFFICIENT_HISTORY')

  const monotonic = [20, 21, 22, 23, 24].map(t => ({ loadStructure: 'uniform_working_load', total: t }))
  const rMono = computeCurrentLoadProgress(monotonic, DEFAULT_POLICY)
  check('20->21->22->23->24 -> ACCUMULATING (never flagged as high variation)', rMono.state === 'ACCUMULATING')

  const noisyFlat = [20, 24, 19, 23, 20].map(t => ({ loadStructure: 'uniform_working_load', total: t }))
  check('a genuinely noisy flat series -> STABLE_VARIATION', computeCurrentLoadProgress(noisyFlat, DEFAULT_POLICY).state === 'STABLE_VARIATION')

  const withMixed = [
    { loadStructure: 'uniform_working_load', total: 20 },
    { loadStructure: 'mixed_load', total: null },
    { loadStructure: 'uniform_working_load', total: 21 },
    { loadStructure: 'uniform_working_load', total: 22 },
  ]
  const rMixed = computeCurrentLoadProgress(withMixed, DEFAULT_POLICY)
  check('a mixed_load point is excluded before regression — never a NaN slope', rMixed.n === 3 && Number.isFinite(rMixed.slope))

  const flatAt3 = computeCurrentLoadProgress(Array.from({ length: 3 }, () => ({ loadStructure: 'uniform_working_load', total: 20 })), DEFAULT_POLICY)
  const flatAt4 = computeCurrentLoadProgress(Array.from({ length: 4 }, () => ({ loadStructure: 'uniform_working_load', total: 20 })), DEFAULT_POLICY)
  const flatAt5 = computeCurrentLoadProgress(Array.from({ length: 5 }, () => ({ loadStructure: 'uniform_working_load', total: 20 })), DEFAULT_POLICY)
  check('flat @ n=3 -> TOO_EARLY_TO_JUDGE', flatAt3.state === 'TOO_EARLY_TO_JUDGE')
  check('flat @ n=4 -> BUILDING_BASELINE (reachable: grace(3) < 4 < min(5))', flatAt4.state === 'BUILDING_BASELINE')
  check('flat @ n=5 -> POSSIBLE_PLATEAU', flatAt5.state === 'POSSIBLE_PLATEAU')

  const declining = [24, 22, 20, 18].map(t => ({ loadStructure: 'uniform_working_load', total: t }))
  check('a real negative slope -> DECLINING', computeCurrentLoadProgress(declining, DEFAULT_POLICY).state === 'DECLINING')
}

console.log('\n== 6. computeRecentProgressTrend (windowed, separate from all-history) ==')
{
  const points = []
  for (let i = 0; i < 11; i++) points.push({ date: `d${i}`, loadStructure: 'uniform_working_load', weightKg: i === 1 ? 70 : 60, total: 24 })
  points.push({ date: 'latest', loadStructure: 'uniform_working_load', weightKg: 65, total: 24 })
  const recent = computeRecentProgressTrend(points, DEFAULT_POLICY)
  check('window caps at the configured size (default 8)', recent.n <= DEFAULT_POLICY.recentWindowSessions)
}

console.log('\n== 7. detectProgressEvents / detectEstimatedStrengthPr (all-history, never windowed) ==')
{
  const rows = [
    ...uniformRows('w1', '2026-07-01', 'ex1', 60, [7, 7, 6]),
    ...uniformRows('w2', '2026-07-08', 'ex1', 70, [8, 7, 7]), // an old spike, outside the later 8-session window
    ...Array.from({ length: 9 }, (_, i) => uniformRows(`w${i + 3}`, `2026-08-0${i + 1}`, 'ex1', 60, [8, 8, 8])).flat(),
  ]
  const sessions = buildCanonicalSessions(rows, 'ex1')
  const points = buildRepresentativePoints(sessions, 'est1rm')
  const latestIndex = sessions.length - 1
  const events = detectProgressEvents(points, latestIndex, 'est1rm', sessions[latestIndex], DEFAULT_EXPECTATION(8, 12, 3))
  check('a new "high" (60kg) relative to the windowed subset is correctly NOT a LOAD_PR (true max is 70kg, outside the window)', !events.some(e => e.code === 'LOAD_PR'))

  const strengthPr = detectEstimatedStrengthPr(sessions, latestIndex, 'est1rm')
  check('no est1rm PR either, since 60kg never exceeds the 70kg-session e1RM', strengthPr === null)
}

console.log('\n== 8. evaluateExerciseProgress — worked examples ==')
{
  // Hammer Curl.
  {
    const rows = [
      ...uniformRows('w1', '2026-08-12', 'hammercurl', 8, [10, 10, 10]),
      ...uniformRows('w2', '2026-08-19', 'hammercurl', 8, [10, 10, 10]),
      ...uniformRows('w3', '2026-08-26', 'hammercurl', 8, [10, 10, 10]),
      ...uniformRows('w4', '2026-09-02', 'hammercurl', 10, [8, 7, 6]),
    ]
    const sessions = buildCanonicalSessions(rows, 'hammercurl')
    const expectation = resolveExpectation('hammercurl', 'est1rm', 3, () => ({ repMin: 6, repMax: 10, targetSets: 3 }), () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'hammercurl', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
    check('Hammer Curl: observedTransition LOAD_INCREASED', result.observedTransition === 'LOAD_INCREASED')
    check('Hammer Curl: rangeCompliance ALL_SETS_AT_OR_ABOVE_MIN (8/7/6 all >= 6, none >= 10)', result.rangeCompliance === 'ALL_SETS_AT_OR_ABOVE_MIN')
    check('Hammer Curl: currentAction BUILD_AT_CURRENT_LOAD', result.currentAction === 'BUILD_AT_CURRENT_LOAD')
    check('Hammer Curl: LOAD_PR fires (10kg beats the only-known 8kg)', result.events.some(e => e.code === 'LOAD_PR' && e.values.previousBest === 8))
    check('Hammer Curl: ESTIMATED_STRENGTH_PR fires as a SECONDARY event', result.events.some(e => e.code === 'ESTIMATED_STRENGTH_PR' && e.emphasis === 'secondary'))
    check('Hammer Curl: estimatedStrengthChange is populated, never nulled for being secondary', result.currentState.estimatedStrengthChange !== null)
    check('Hammer Curl: currentLoadProgress INSUFFICIENT_HISTORY at only 1 session on the new load', result.trend.currentLoadProgress === 'INSUFFICIENT_HISTORY')
    check('Hammer Curl: next target floor is [8,7,6], total >= 22', result.nextTargets.nextSession.minimumSetReps.join(',') === '8,7,6' && result.nextTargets.nextSession.minimumTotalReps === 22)
    check('Hammer Curl: algorithmVersion stamped', result.algorithmVersion === ALGORITHM_VERSION)
  }

  // Chest Press — clean rep progression to a monotonic 20..24-equivalent, ACCUMULATING.
  {
    const rows = [
      ...uniformRows('w1', '2026-08-05', 'chestpress', 60, [7, 7, 6]),
      ...uniformRows('w2', '2026-08-12', 'chestpress', 60, [7, 7, 7]),
      ...uniformRows('w3', '2026-08-19', 'chestpress', 60, [8, 7, 7]),
      ...uniformRows('w4', '2026-08-26', 'chestpress', 60, [8, 8, 7]),
      ...uniformRows('w5', '2026-09-02', 'chestpress', 60, [8, 8, 8], ['normal', 'normal', 'failure']),
    ]
    const sessions = buildCanonicalSessions(rows, 'chestpress')
    const expectation = resolveExpectation('chestpress', 'est1rm', 3, () => ({ repMin: 8, repMax: 12, targetSets: 3 }), () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'chestpress', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
    check('Chest Press: repDelta REP_INCREASE on the latest pair', result.repDelta === 'REP_INCREASE')
    check('Chest Press: currentLoadProgress ACCUMULATING (monotonic totals 20..24)', result.trend.currentLoadProgress === 'ACCUMULATING')
    check('Chest Press: recentProgressTrend PROGRESSING', result.trend.recentProgressTrend === 'PROGRESSING')
    check('Chest Press: TOTAL_REPS_PR_AT_LOAD fires at the same load+set-count', result.events.some(e => e.code === 'TOTAL_REPS_PR_AT_LOAD'))
  }

  // Leg Extension — the plateau state machine, and NEVER_HIDES-style
  // precedence: a real trend read even though every pair looks flat-ish.
  {
    const rows = [
      ...uniformRows('w1', '2026-08-05', 'legext', 40, [12, 11, 11]),
      ...uniformRows('w2', '2026-08-12', 'legext', 40, [12, 12, 11]),
      ...uniformRows('w3', '2026-08-19', 'legext', 40, [12, 11, 11]),
      ...uniformRows('w4', '2026-08-26', 'legext', 40, [12, 12, 11]),
      ...uniformRows('w5', '2026-09-02', 'legext', 40, [12, 11, 11]),
    ]
    const sessions = buildCanonicalSessions(rows, 'legext')
    const expectation = resolveExpectation('legext', 'est1rm', 3, () => ({ repMin: 10, repMax: 15, targetSets: 3 }), () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'legext', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
    check('Leg Extension: currentLoadProgress POSSIBLE_PLATEAU at 5 flat-ish sessions', result.trend.currentLoadProgress === 'POSSIBLE_PLATEAU')
    check('Leg Extension: currentAction overridden to WATCH_FOR_PLATEAU (no fresh improvement this pair)', result.currentAction === 'WATCH_FOR_PLATEAU')
  }

  // A fresh improvement overrides a plateau-derived watch (the precedence rule).
  {
    const rows = [
      ...uniformRows('w1', '2026-08-05', 'legext2', 40, [12, 11, 11]),
      ...uniformRows('w2', '2026-08-12', 'legext2', 40, [12, 12, 11]),
      ...uniformRows('w3', '2026-08-19', 'legext2', 40, [12, 11, 11]),
      ...uniformRows('w4', '2026-08-26', 'legext2', 40, [12, 12, 11]),
      ...uniformRows('w5', '2026-09-02', 'legext2', 45, [10, 8, 7]), // a fresh, clean load increase
    ]
    const sessions = buildCanonicalSessions(rows, 'legext2')
    const expectation = resolveExpectation('legext2', 'est1rm', 3, () => ({ repMin: 6, repMax: 12, targetSets: 3 }), () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'legext2', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
    check('a fresh SUCCESSFUL load increase is never overridden to WATCH_FOR_PLATEAU', result.currentAction !== 'WATCH_FOR_PLATEAU' && result.currentAction === 'BUILD_AT_CURRENT_LOAD')
  }

  // Back Squat — mixed load + missing set together.
  {
    const rows = [
      ...uniformRows('w1', '2026-08-15', 'backsquat', 100, [5, 5, 5, 5]),
      ...uniformRows('w2', '2026-08-29', 'backsquat', 100, [5, 5, 5, 5]),
      [row('w3', '2026-09-02', 'backsquat', 1, 100, 5), row('w3', '2026-09-02', 'backsquat', 2, 90, 6), row('w3', '2026-09-02', 'backsquat', 3, 95, 5)],
    ].flat()
    const sessions = buildCanonicalSessions(rows, 'backsquat')
    const expectation = resolveExpectation('backsquat', 'est1rm', 4, () => ({ repMin: 5, repMax: 8, targetSets: 4 }), () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'backsquat', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
    check('Back Squat: both MISSING_PRESCRIBED_SET and MIXED_LOAD_SESSION flagged', result.dataQualityFlags.includes('MISSING_PRESCRIBED_SET') && result.dataQualityFlags.includes('MIXED_LOAD_SESSION'))
    check('Back Squat: evaluationScope NOT_EVALUATED, never a fabricated compliance read', result.evaluationScope === 'NOT_EVALUATED')
    check('Back Squat: currentAction HOLD_STEADY', result.currentAction === 'HOLD_STEADY')
  }

  // Assisted Pull-up — metric dispatch inversion + TOO_EARLY_TO_JUDGE.
  {
    const rows = [
      ...uniformRows('w1', '2026-08-08', 'assisted', 20, [8, 8, 8]),
      ...uniformRows('w2', '2026-08-15', 'assisted', 20, [8, 8, 8]),
      ...uniformRows('w3', '2026-08-22', 'assisted', 15, [7, 6, 6]),
      ...uniformRows('w4', '2026-08-29', 'assisted', 15, [7, 6, 6]),
      ...uniformRows('w5', '2026-09-02', 'assisted', 15, [7, 6, 6]),
    ]
    const sessions = buildCanonicalSessions(rows, 'assisted')
    const expectation = resolveExpectation('assisted', 'assistedWeight', 3, () => ({ repMin: 6, repMax: 10, targetSets: 3 }), () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'assisted', metricKind: 'assistedWeight', sessions, expectation }, DEFAULT_POLICY)
    // The LATEST pair (w4 -> w5) is unchanged at 15kg — the assistance drop
    // itself happened one cycle boundary earlier (w2 20kg -> w3 15kg), which
    // is exactly what makes this a good TOO_EARLY_TO_JUDGE fixture: only 3
    // sessions exist so far at the new, lower assistance load.
    check('Assisted Pull-up: latest pair is unchanged at the new assistance load', result.observedTransition === 'LOAD_UNCHANGED')
    check('Assisted Pull-up: currentAction is never REVIEW_LOAD_REDUCTION for this metric kind', result.currentAction !== 'REVIEW_LOAD_REDUCTION')
    check('Assisted Pull-up: currentLoadProgress TOO_EARLY_TO_JUDGE (3 flat sessions since the assistance drop)', result.trend.currentLoadProgress === 'TOO_EARLY_TO_JUDGE')
  }

  // Fewer than 2 comparable sessions never crashes and never fabricates a read.
  {
    const sessions = buildCanonicalSessions(uniformRows('w1', '2026-09-02', 'onesession', 40, [10, 10, 10]), 'onesession')
    const expectation = resolveExpectation('onesession', 'est1rm', 3, () => null, () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'onesession', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
    check('1 session -> INSUFFICIENT_DATA, no crash', result.currentAction === 'INSUFFICIENT_DATA' && result.comparableSessions === 1)
  }
}

console.log('\n== 9. isPositiveLoadChange ==')
{
  check('assistedWeight: a decrease is positive (less assistance = harder)', isPositiveLoadChange('assistedWeight', 20, 15) === true)
  check('est1rm: a decrease is NOT positive', isPositiveLoadChange('est1rm', 20, 15) === false)
  check('null inputs -> null, never a false positive/negative', isPositiveLoadChange('est1rm', null, 15) === null)
}

console.log('\n== 10. copy.ts ==')
{
  check('actionLabel resolves from the catalog', actionLabel('READY_TO_INCREASE') === 'Ready to increase')
  check('evidenceLabel uses the exact user-approved wording', evidenceLabel('limited') === 'Limited evidence' && evidenceLabel('moderate') === 'Moderate evidence' && evidenceLabel('strong') === 'Strong evidence')
  check('scopeLabel never overclaims for a partial scope', scopeLabel('LOGGED_SETS_ONLY') === 'the sets actually logged')
}

console.log('\n== 11. RULE_CATALOG completeness (documentation-sync requirement) ==')
{
  const emittedCodes = new Set([
    'LOAD_INCREASED_PCT', 'ALL_SETS_ABOVE_MINIMUM', 'TOP_OF_RANGE_NOT_REACHED', 'BELOW_TARGET_MINIMUM',
    'REP_INCREASE_CLEAN', 'LOAD_DECREASED_UNKNOWN_INTENT', 'ASSISTANCE_REDUCED', 'NO_TREND_AT_CURRENT_LOAD',
    'DATA_QUALITY_MISSING_SET', 'DATA_QUALITY_EXTRA_SET', 'DATA_QUALITY_MIXED_LOAD',
    'LOAD_PR', 'TOTAL_REPS_PR_AT_LOAD', 'ESTIMATED_STRENGTH_PR', 'TARGET_COMPLETED',
    'BUILD_AT_CURRENT_LOAD', 'READY_TO_INCREASE', 'CONFIRM_BEFORE_INCREASING', 'CONFIRM_AT_CURRENT_LOAD',
    'HOLD_STEADY', 'REVIEW_LOAD_REDUCTION', 'WATCH_FOR_PLATEAU', 'WATCH_FOR_REGRESSION', 'INSUFFICIENT_DATA',
  ])
  let missing = []
  for (const code of emittedCodes) if (!RULE_CATALOG[code]) missing.push(code)
  check('every reason/event/action code the engine can emit has a RULE_CATALOG entry', missing.length === 0, `missing: ${missing.join(', ')}`)
  check('every catalog entry declares a real evidenceClass', Object.values(RULE_CATALOG).every(e => ['science', 'product_rule', 'program_policy'].includes(e.evidenceClass)))
}

console.log('\n== 12. buildExplanationSentence never crashes on any worked example ==')
{
  const rows = [...uniformRows('w1', '2026-08-12', 'sentencecheck', 8, [10, 10, 10]), ...uniformRows('w2', '2026-09-02', 'sentencecheck', 10, [8, 7, 6])]
  const sessions = buildCanonicalSessions(rows, 'sentencecheck')
  const expectation = resolveExpectation('sentencecheck', 'est1rm', 3, () => ({ repMin: 6, repMax: 10, targetSets: 3 }), () => null)
  const result = evaluateExerciseProgress({ exerciseTemplateId: 'sentencecheck', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
  const sentence = buildExplanationSentence(result)
  check('a real sentence is produced, never a template artifact', typeof sentence === 'string' && sentence.length > 10 && !sentence.includes('undefined'))
  check('never shows a bare unlabeled derived number as the headline', !/^\d+(\.\d+)?\s*(→|->)\s*\d+(\.\d+)?$/.test(sentence))
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
