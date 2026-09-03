#!/usr/bin/env node
/*
 * Verification — the exercise progress engine
 * (src/features/training/progress-engine/), rebuilt across several rounds of
 * correction (see docs/training/progress-engine/ for the settled record —
 * the full back-and-forth is this repo's own session history, not
 * duplicated here). This version covers the corrective round's 15-point
 * blocking-review list in full: real per-metric-kind dispatch (never a
 * naive "most reps wins"), null-safe quantity handling (never a coerced
 * zero), exact-set-count semantics for ALL_PRESCRIBED_WORKING_SETS /
 * TARGET_COMPLETED / TOTAL_REPS_PR_AT_LOAD, the shared clean-progression
 * contract reused by both the per-pair read and the recent-trend window,
 * action-aware Next Targets (including the resolved next-load via the
 * increment ladder), REP_PR_AT_LOAD / PROGRESSION_STREAK events, the
 * restored user-override > routine > default expectation priority, and the
 * new 'measured_fact' evidence tier.
 *
 * Proves everything against the REAL un-mocked modules (loaded via
 * sucrase — this repo has no unit-test runner by convention).
 *
 *   Run:  node scripts/verify-progress-engine.cjs
 */
require('sucrase/register')

const {
  classifyLoadStructure, buildCanonicalSessions, bestComparableSet, totalComparableReps, totalForMetric,
} = require('../src/features/training/progress-engine/normalize')
const {
  isMetricEligible, metricValueOf, selectRepresentativeSet, quantityFor, totalQuantity, isCleanProgression,
  higherIsBetterFor, isWeightBasedMetric,
} = require('../src/features/training/progress-engine/metricStrategy')
const {
  linearFit, computeCurrentLoadProgress, computeRecentProgressTrend, buildRepresentativePoints, buildLoadCycles,
  meaningfulDeclineReps,
} = require('../src/features/training/progress-engine/trend')
const { evaluatePair, sessionRangeCompliance } = require('../src/features/training/progress-engine/comparability')
const { detectProgressEvents, detectEstimatedStrengthPr } = require('../src/features/training/progress-engine/events')
const { buildNextTargets, meetsNextTargetFloor } = require('../src/features/training/progress-engine/targets')
const {
  resolveExpectation, isPositiveLoadChange, resolveLoadIncrementKg, DEFAULT_POLICY, ALGORITHM_VERSION,
} = require('../src/features/training/progress-engine/policies')
const { evaluateExerciseProgress } = require('../src/features/training/progress-engine/evaluate')
const { RULE_CATALOG } = require('../src/features/training/progress-engine/ruleCatalog')
const {
  actionLabel, evidenceLabel, scopeLabel, buildExplanationSentence, progressEvidenceExplanation,
  recommendationEvidenceExplanation,
} = require('../src/features/training/progress-engine/copy')

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
// Duration-metric rows (no weight/reps).
function durationRows(workoutId, date, templateId, durations) {
  return durations.map((d, i) => row(workoutId, date, templateId, i + 1, null, null, 'normal', { duration_seconds: d }))
}
// Distance-metric rows (distance paired with duration).
function distanceRows(workoutId, date, templateId, pairs) {
  return pairs.map(([dist, dur], i) => row(workoutId, date, templateId, i + 1, null, null, 'normal', { distance_meters: dist, duration_seconds: dur }))
}
// Reps-only rows (no weight at all).
function repsOnlyRows(workoutId, date, templateId, repsArr) {
  return repsArr.map((reps, i) => row(workoutId, date, templateId, i + 1, null, reps))
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

console.log('\n== 3. metricStrategy — real per-metric dispatch (§1) ==')
{
  // §14 named scenario: 60x8+45x12 must select the metric-specific best set,
  // never whichever set has the most raw reps (45x12 has more reps, but a
  // top_set_and_backoff session must always use the TOP SET role).
  {
    const sets = [set(1, 60, 8), set(2, 45, 12)]
    const rep = selectRepresentativeSet(sets, 'top_set_and_backoff', 'est1rm')
    check('top_set_and_backoff always selects the actual top-set role (60x8), never the higher-reps backoff set', rep.weightKg === 60 && rep.reps === 8)
  }
  // est1rm eligibility: >12 reps excluded, never coerced.
  {
    const highRep = set(1, 40, 20)
    check('est1rm ineligible above the 12-rep ceiling', !isMetricEligible(highRep, 'est1rm'))
    check('metricValueOf returns null for an ineligible set, never a fabricated value', metricValueOf(highRep, 'est1rm') === null)
  }
  // reps-only progression without weight (§14).
  {
    const sets = [set(1, null, 12), set(2, null, 10)]
    const rep = selectRepresentativeSet(sets, 'uniform_working_load', 'reps')
    check('reps metric selects the set with the most reps, no weight required', rep.reps === 12)
    check('reps metric eligibility never requires a weight', isMetricEligible(set(1, null, 15), 'reps'))
  }
  // duration progression (§14).
  {
    const sets = [set(1, null, null, 'normal', { durationSeconds: 45 }), set(2, null, null, 'normal', { durationSeconds: 60 })]
    const rep = selectRepresentativeSet(sets, 'uniform_working_load', 'duration')
    check('duration metric selects the longest duration as the representative set', rep.durationSeconds === 60)
    check('duration metric ineligible with no durationSeconds', !isMetricEligible(set(1, null, 10), 'duration'))
  }
  // distance missing duration ⇒ NOT_EVALUATED (§14) — distance requires BOTH fields.
  {
    const distanceOnly = set(1, null, null, 'normal', { distanceMeters: 400 })
    check('distance metric ineligible when duration is missing, even with a real distance value', !isMetricEligible(distanceOnly, 'distance'))
    const both = set(1, null, null, 'normal', { distanceMeters: 400, durationSeconds: 90 })
    check('distance metric eligible once both distance AND duration are present', isMetricEligible(both, 'distance'))
    check('metricValueOf reads distanceMeters once eligible', metricValueOf(both, 'distance') === 400)
  }
  // assistedWeight direction inversion — the core §1/§2 requirement.
  {
    check('assistedWeight: lower weight scores as the improvement (higherIsBetter is false)', higherIsBetterFor('assistedWeight') === false)
    const sets = [set(1, 20, 8), set(2, 15, 8)]
    const rep = selectRepresentativeSet(sets, 'uniform_working_load', 'assistedWeight')
    check('assistedWeight selects the LOWEST assistance as representative, never the highest', rep.weightKg === 15)
  }
  // Null quantities are never coerced to zero (§3).
  {
    const withNullReps = [set(1, 60, 8), set(2, 60, null)]
    check('totalQuantity returns null (never a partial sum) when any set is missing its quantity', totalQuantity(withNullReps, 'reps') === null)
    check('quantityFor never substitutes 0 for a missing value', quantityFor(set(1, 60, null), 'reps') === null)
  }
}

console.log('\n== 3b. weight_duration composite honesty (BLOCKER #5) ==')
{
  // A genuine bodyweight-duration set (no weight logged) stays eligible —
  // this must NOT regress.
  const plainDuration = set(1, null, null, 'normal', { durationSeconds: 45 })
  check('#5: a plain bodyweight-duration set (no weight) stays eligible for the duration metric', isMetricEligible(plainDuration, 'duration'))
  check('#5: quantityFor still returns the real duration for a plain bodyweight-duration set', quantityFor(plainDuration, 'duration') === 45)

  // A weight_duration composite set (e.g. a weighted plank/loaded carry)
  // carries BOTH a weight and a duration — the engine has no honest way to
  // evaluate this as pure duration (it would silently drop the weight
  // axis), so it must be excluded entirely rather than mislabeled.
  const weightedDuration = set(1, 20, null, 'normal', { durationSeconds: 45 })
  check('#5: a weight_duration composite set (weight + duration together) is INELIGIBLE for the duration metric', !isMetricEligible(weightedDuration, 'duration'))
  check('#5: quantityFor returns null (never a dishonest duration total) for a weighted-duration set', quantityFor(weightedDuration, 'duration') === null)
  check('#5: metricValueOf returns null for a weighted-duration set under the duration metric', metricValueOf(weightedDuration, 'duration') === null)

  // The same composite exclusion applies to distance (a weighted carry
  // logged with distance+duration+weight together).
  const weightedDistance = set(1, 20, null, 'normal', { distanceMeters: 100, durationSeconds: 60 })
  check('#5: a weighted distance set is INELIGIBLE for the distance metric', !isMetricEligible(weightedDistance, 'distance'))

  // A whole SESSION built entirely from weight_duration composite sets
  // becomes not-evaluable end to end: no representative set, no total.
  {
    const rows = [row('w1', '2026-08-01', 'weightedplank', 1, 20, null, 'normal', { duration_seconds: 45 }),
      row('w1', '2026-08-01', 'weightedplank', 2, 20, null, 'normal', { duration_seconds: 50 })]
    const s = buildCanonicalSessions(rows, 'weightedplank')[0]
    check('#5: a weight_duration session has no representative set for the duration metric', bestComparableSet(s, 'duration') === null)
    check('#5: a weight_duration session has no evaluable total for the duration metric', totalForMetric(s, 'duration') === null)
  }
}

console.log('\n== 3c. load terminology separation — never "Load"/kg/% for a metric without a real load axis (BLOCKER #5) ==')
{
  const { buildExplanationSentence: sentenceFn } = require('../src/features/training/progress-engine/copy')
  // A 'reps' metric kind session with a fresh top-set-reps increase must
  // read with metric-appropriate language, never borrow "Load increased" /
  // a percentage / "kg" — none of which describe a real axis for this kind.
  const rows = [
    ...repsOnlyRows('w1', '2026-08-01', 'reptermcheck', [6, 6, 6]),
    ...repsOnlyRows('w2', '2026-08-08', 'reptermcheck', [7, 6, 6]),
  ]
  const sessions = buildCanonicalSessions(rows, 'reptermcheck')
  const expectation = resolveExpectation('reptermcheck', 'reps', 3, () => null, () => null)
  const result = evaluateExerciseProgress({ exerciseTemplateId: 'reptermcheck', metricKind: 'reps', sessions, expectation }, DEFAULT_POLICY)
  check('#5: ExerciseProgressResult carries its own metricKind for the copy layer to branch on', result.metricKind === 'reps')
  if (result.observedTransition === 'LOAD_INCREASED') {
    const sentence = sentenceFn(result)
    check('#5: a reps-kind exercise\'s explanation never says "Load increased"', !sentence.includes('Load increased'))
    check('#5: a reps-kind exercise\'s explanation never renders a "kg" unit', !sentence.includes('kg'))
    check('#5: a reps-kind exercise\'s explanation never renders a load percentage', !/[+-]?\d+(\.\d+)?%/.test(sentence))
  } else {
    check('#5: fixture reached LOAD_INCREASED as designed (sanity check on the test itself)', false, `got observedTransition=${result.observedTransition}`)
  }
}

console.log('\n== 4. isCleanProgression — the shared contract (§2, §5) ==')
{
  check('equal set count, total up, no position down -> clean', isCleanProgression([set(1, 60, 7), set(2, 60, 7)], [set(1, 60, 8), set(2, 60, 7)], 'est1rm'))
  check('set-count mismatch is never clean', !isCleanProgression([set(1, 60, 7)], [set(1, 60, 7), set(2, 60, 7)], 'est1rm'))
  check('a redistribution (total flat, one position down) is never clean', !isCleanProgression([set(1, 60, 8), set(2, 60, 7)], [set(1, 60, 9), set(2, 60, 6)], 'est1rm'))
  check('null reps in either side is never clean', !isCleanProgression([set(1, 60, null)], [set(1, 60, 8)], 'reps'))
  // isCleanProgression operates on the QUANTITY axis (reps/duration/
  // distance) only — always "more is better", regardless of metric kind.
  // It deliberately does NOT look at weight at all, so equal reps at a
  // DIFFERENT assistance level is correctly "not improved" here — the
  // assisted-weight LOAD direction is judged elsewhere (isPositiveLoadChange,
  // observedTransition), never by this function.
  check('assistedWeight: equal reps at a different assistance level is NOT a clean progression (this function ignores weight)',
    !isCleanProgression([set(1, 20, 8), set(2, 20, 8)], [set(1, 15, 8), set(2, 15, 8)], 'assistedWeight'))
  check('assistedWeight: a genuine rep INCREASE at fixed assistance IS a clean progression',
    isCleanProgression([set(1, 15, 8), set(2, 15, 8)], [set(1, 15, 9), set(2, 15, 8)], 'assistedWeight'))
  check('assistedWeight: a rep DECREASE is never clean, regardless of weight', !isCleanProgression([set(1, 15, 8)], [set(1, 15, 7)], 'assistedWeight'))
}

console.log('\n== 5. evaluatePair ==')
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
    // §14 named scenario: both sessions logging FEWER sets than the target
    // (2 vs a target of 3) must never read as ALL_PRESCRIBED_WORKING_SETS.
    check('§14: 2-set session vs a 3-set target never reads ALL_PRESCRIBED_WORKING_SETS', r.evaluationScope !== 'ALL_PRESCRIBED_WORKING_SETS')
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
  // Assisted-weight: a raw decrease is the POSITIVE direction, not a reduction to review (§2/§14).
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
  // §14: reps-only progression with no weight at all. The representative
  // VALUE for a 'reps' metric is the top single-set rep count, so the
  // "same load" (top set unchanged) case is the one that opens the door to
  // a REP_INCREASE read on the total — this fixture keeps the top set flat
  // (8 -> 8) while the total climbs (21 -> 23) with no position regressing.
  {
    const prevSess = buildCanonicalSessions(repsOnlyRows('w1', '2026-08-01', 'pullup', [8, 7, 6]), 'pullup')[0]
    const latestSess = buildCanonicalSessions(repsOnlyRows('w2', '2026-08-08', 'pullup', [8, 8, 7]), 'pullup')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(6, 10, 3), 'reps', DEFAULT_POLICY)
    check('reps-only metric: a clean rep increase with the top set unchanged and no weight involved reads REP_INCREASE', r.repDelta === 'REP_INCREASE')
  }
  // §14: duration progression — same "representative value unchanged, total
  // climbs" shape, since duration's representative value is the top-set
  // duration.
  {
    const prevSess = buildCanonicalSessions(durationRows('w1', '2026-08-01', 'plank', [40, 35, 30]), 'plank')[0]
    const latestSess = buildCanonicalSessions(durationRows('w2', '2026-08-08', 'plank', [40, 38, 32]), 'plank')[0]
    const r = evaluatePair(prevSess, latestSess, DEFAULT_EXPECTATION(30, 60, 3), 'duration', DEFAULT_POLICY)
    check('duration metric: a clean duration increase (top set unchanged) reads REP_INCREASE (the metric-generic quantity contract)', r.repDelta === 'REP_INCREASE')
  }
}

console.log('\n== 6. sessionRangeCompliance / requiredTopRangeConfirmations wiring (§6) ==')
{
  const topSession = buildCanonicalSessions(uniformRows('w1', '2026-09-02', 'ex1', 60, [10, 10, 10]), 'ex1')[0]
  check('a session with every set at the top of range reads ALL_SETS_AT_TOP', sessionRangeCompliance(topSession, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm') === 'ALL_SETS_AT_TOP')
  const belowSession = buildCanonicalSessions(uniformRows('w2', '2026-09-02', 'ex1', 60, [5, 5, 5]), 'ex1')[0]
  check('a session below minimum reads BELOW_MINIMUM', sessionRangeCompliance(belowSession, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm') === 'BELOW_MINIMUM')

  // With requiredTopRangeConfirmations=1 (default), a single top-range
  // session is enough to stand as READY_TO_INCREASE.
  {
    const rows = [...uniformRows('w1', '2026-08-01', 'confirm1', 60, [8, 8, 8]), ...uniformRows('w2', '2026-08-08', 'confirm1', 60, [10, 10, 10])]
    const sessions = buildCanonicalSessions(rows, 'confirm1')
    const expectation = resolveExpectation('confirm1', 'est1rm', 3, () => ({ repMin: 6, repMax: 10, targetSets: 3 }), () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'confirm1', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
    check('default policy (1 confirmation): a single top-range session stands as READY_TO_INCREASE', result.currentAction === 'READY_TO_INCREASE')
  }
  // With requiredTopRangeConfirmations=2, one top-range session is NOT enough.
  {
    const policy2 = { ...DEFAULT_POLICY, requiredTopRangeConfirmations: 2 }
    const rows = [...uniformRows('w1', '2026-08-01', 'confirm2', 60, [8, 8, 8]), ...uniformRows('w2', '2026-08-08', 'confirm2', 60, [10, 10, 10])]
    const sessions = buildCanonicalSessions(rows, 'confirm2')
    const expectation = resolveExpectation('confirm2', 'est1rm', 3, () => ({ repMin: 6, repMax: 10, targetSets: 3 }), () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'confirm2', metricKind: 'est1rm', sessions, expectation }, policy2)
    check('requiredTopRangeConfirmations=2: a single top-range session is downgraded to BUILD_AT_CURRENT_LOAD', result.currentAction === 'BUILD_AT_CURRENT_LOAD')
    check('the downgrade carries an explicit AWAITING_TOP_RANGE_CONFIRMATION reason', result.reasons.some(r => r.code === 'AWAITING_TOP_RANGE_CONFIRMATION'))

    // Two consecutive top-range sessions DO satisfy confirmations=2.
    const rows2 = [...uniformRows('w1', '2026-08-01', 'confirm2b', 60, [10, 10, 10]), ...uniformRows('w2', '2026-08-08', 'confirm2b', 60, [10, 10, 10])]
    const sessions2 = buildCanonicalSessions(rows2, 'confirm2b')
    const expectation2 = resolveExpectation('confirm2b', 'est1rm', 3, () => ({ repMin: 6, repMax: 10, targetSets: 3 }), () => null)
    const result2 = evaluateExerciseProgress({ exerciseTemplateId: 'confirm2b', metricKind: 'est1rm', sessions: sessions2, expectation: expectation2 }, policy2)
    check('requiredTopRangeConfirmations=2: two consecutive top-range sessions DO stand as READY_TO_INCREASE', result2.currentAction === 'READY_TO_INCREASE')
  }
}

console.log('\n== 7. buildNextTargets — action-aware (§6), null on set-count mismatch (BLOCKER #2) ==')
{
  const latestSess = buildCanonicalSessions(uniformRows('w1', '2026-09-02', 'ex1', 10, [8, 7, 6]), 'ex1')[0]
  const t = buildNextTargets(latestSess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'BUILD_AT_CURRENT_LOAD', DEFAULT_POLICY, null, null, [])
  check('BUILD_AT_CURRENT_LOAD: minimumSetReps is the real per-position floor', JSON.stringify(t.nextSession.minimumSetReps) === JSON.stringify([8, 7, 6]))
  check('BUILD_AT_CURRENT_LOAD: minimumTotalReps beats the previous total by at least 1', t.nextSession.minimumTotalReps === 22)
  check('BUILD_AT_CURRENT_LOAD: load stays the same', t.nextSession.loadKg === 10)
  check('8/6/8 (total 22) fails — position 2 regressed', !meetsNextTargetFloor([8, 6, 8], t.nextSession))
  check('8/7/7 (total 22) passes — no position regressed', meetsNextTargetFloor([8, 7, 7], t.nextSession))
  check('9/7/6 (total 22) also passes — the floor allows any position to be the one that improves', meetsNextTargetFloor([9, 7, 6], t.nextSession))

  // BLOCKER #2 — named regression: a MISSING set (2 logged vs a 3-set
  // target) must return null, never a floor built from only 2 positions.
  {
    const missingSetSess = buildCanonicalSessions(uniformRows('w1', '2026-09-02', 'missingset', 60, [8, 7]), 'missingset')[0]
    check('#2: logged set count (2) LESS than expectation.targetSets (3) -> buildNextTargets returns null',
      buildNextTargets(missingSetSess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'BUILD_AT_CURRENT_LOAD', DEFAULT_POLICY, null, null, []) === null)
  }
  // BLOCKER #2 — named regression: an EXTRA set (4 logged vs a 3-set
  // target) must ALSO return null, never a floor built from 4 positions.
  {
    const extraSetSess = buildCanonicalSessions(uniformRows('w1', '2026-09-02', 'extraset', 60, [8, 8, 8, 8]), 'extraset')[0]
    check('#2: logged set count (4) MORE than expectation.targetSets (3) -> buildNextTargets returns null',
      buildNextTargets(extraSetSess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'BUILD_AT_CURRENT_LOAD', DEFAULT_POLICY, null, null, []) === null)
  }
  // The exact-match case (3 logged == 3 target) must still produce a floor —
  // confirms the new check isn't accidentally over-broad.
  {
    const exactSess = buildCanonicalSessions(uniformRows('w1', '2026-09-02', 'exactset', 60, [8, 8, 8]), 'exactset')[0]
    check('#2: an EXACT set-count match still produces a real target (the check is not over-broad)',
      buildNextTargets(exactSess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'BUILD_AT_CURRENT_LOAD', DEFAULT_POLICY, null, null, []) !== null)
  }

  // §14 named scenario: READY_TO_INCREASE produces a resolved next-load target.
  {
    const readySess = buildCanonicalSessions(uniformRows('w2', '2026-09-09', 'ex1', 60, [10, 10, 10]), 'ex1')[0]
    const tReady = buildNextTargets(readySess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'READY_TO_INCREASE', DEFAULT_POLICY, null, 'barbell', [])
    check('READY_TO_INCREASE resolves a real numeric next load via the equipment-class rung', tReady.nextSession.loadKg === 62.5)
    check('READY_TO_INCREASE next target explanation code identifies the ready-to-increase path', tReady.nextSession.explanationCode === 'READY_TO_INCREASE_NEXT_LOAD')

    // BLOCKER #4 — restored ladder order: the EQUIPMENT DEFAULT now wins
    // over a smaller observed increment (the inverted, buggy order used to
    // let ANY prior observed increment silently override the equipment
    // default, however atypical). 2.5 (barbell default) beats 1.25 (observed).
    const tEquipmentWins = buildNextTargets(readySess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'READY_TO_INCREASE', DEFAULT_POLICY, null, 'barbell', [5, 1.25])
    check('#4: restored order — the equipment default (2.5) wins over a smaller OBSERVED increment (1.25)', tEquipmentWins.nextSession.loadKg === 62.5)

    // Rung 3 (observed history) is used only when NO equipment class is known.
    const tObservedOnly = buildNextTargets(readySess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'READY_TO_INCREASE', DEFAULT_POLICY, null, null, [5, 1.25])
    check('#4: with no equipment class, rung 3 (smallest observed increment) is used', tObservedOnly.nextSession.loadKg === 61.3) // round1'd from 61.25

    // BLOCKER #4 — rung 1 (explicit override) beats BOTH the equipment
    // default and any observed history.
    const tExplicit = buildNextTargets(readySess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'READY_TO_INCREASE', DEFAULT_POLICY, 1, 'barbell', [5, 1.25])
    check('#4: rung 1 (explicit override, 1kg) wins over BOTH the equipment default and observed history', tExplicit.nextSession.loadKg === 61)

    // No equipment class, no observed history -> an honest non-numeric fallback, never a fabricated number.
    const tUnknown = buildNextTargets(readySess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'READY_TO_INCREASE', DEFAULT_POLICY, null, null, [])
    check('READY_TO_INCREASE with no increment source at all -> no fabricated load number', tUnknown.nextSession.loadKg === null)

    // Assisted-weight: "increase" means REDUCE assistance further.
    const assistedReady = buildCanonicalSessions(uniformRows('w3', '2026-09-09', 'assist', 15, [10, 10, 10]), 'assist')[0]
    const tAssist = buildNextTargets(assistedReady, DEFAULT_EXPECTATION(6, 10, 3), 'assistedWeight', 'READY_TO_INCREASE', DEFAULT_POLICY, null, null, [5])
    check('assistedWeight READY_TO_INCREASE moves the load DOWN (less assistance), never up', tAssist.nextSession.loadKg === 10)
  }

  // §14: NOT_EVALUATED / mixed-load / incomplete-reps sessions issue NO numeric target.
  {
    const mixedSess = buildCanonicalSessions([row('w1', '2026-09-02', 'mix', 1, 100, 5), row('w1', '2026-09-02', 'mix', 2, 90, 6), row('w1', '2026-09-02', 'mix', 3, 95, 5)], 'mix')[0]
    check('a mixed_load session -> buildNextTargets returns null (no numeric target)', buildNextTargets(mixedSess, DEFAULT_EXPECTATION(5, 8, 3), 'est1rm', 'HOLD_STEADY', DEFAULT_POLICY, null, null, []) === null)

    const incompleteSess = buildCanonicalSessions([row('w1', '2026-09-02', 'incomplete', 1, 60, null)], 'incomplete')[0]
    check('a session with a null rep count -> buildNextTargets returns null', buildNextTargets(incompleteSess, DEFAULT_EXPECTATION(6, 10, 1), 'est1rm', 'BUILD_AT_CURRENT_LOAD', DEFAULT_POLICY, null, null, []) === null)

    const holdSess = buildCanonicalSessions(uniformRows('w1', '2026-09-02', 'hold', 60, [8, 8, 8]), 'hold')[0]
    check('HOLD_STEADY (no forward motion, no top-range) issues no numeric target either', buildNextTargets(holdSess, DEFAULT_EXPECTATION(6, 10, 3), 'est1rm', 'HOLD_STEADY', DEFAULT_POLICY, null, null, []) === null)
  }
}

console.log('\n== 8. resolveLoadIncrementKg — restored ladder order, not dead code (BLOCKER #4) ==')
{
  check('#4: rung 1 (explicit override) wins over EVERYTHING else', resolveLoadIncrementKg(1.5, 'barbell', [5, 2.5, 1.25], DEFAULT_POLICY) === 1.5)
  check('#4: rung 2 (equipment default) wins over rung 3 (observed history) — the restored order', resolveLoadIncrementKg(null, 'barbell', [5, 2.5, 1.25], DEFAULT_POLICY) === DEFAULT_POLICY.loadIncrementKg.barbell)
  check('rung 3 used only once no override and no equipment class are known', resolveLoadIncrementKg(null, null, [5, 2.5, 1.25], DEFAULT_POLICY) === 1.25)
  check('rung 2: equipment default used when nothing was ever observed', resolveLoadIncrementKg(null, 'dumbbell', [], DEFAULT_POLICY) === DEFAULT_POLICY.loadIncrementKg.dumbbell)
  check('rung 4: neither override, equipment, nor history -> null, never a fabricated number', resolveLoadIncrementKg(null, null, [], DEFAULT_POLICY) === null)
  check('a zero/negative observed increment is never treated as "smallest positive"', resolveLoadIncrementKg(null, null, [0, -2, 5], DEFAULT_POLICY) === 5)
  check('a zero/negative explicit override is not honored (falls through to the next rung)', resolveLoadIncrementKg(0, 'machine', [], DEFAULT_POLICY) === DEFAULT_POLICY.loadIncrementKg.machine)
}

console.log('\n== 9. linearFit / computeCurrentLoadProgress ==')
{
  const uniform = n => Array.from({ length: n }, () => ({ loadStructure: 'uniform_working_load', total: 20 }))
  check('n<3 -> INSUFFICIENT_HISTORY', computeCurrentLoadProgress(uniform(2), 'est1rm', DEFAULT_POLICY).state === 'INSUFFICIENT_HISTORY')

  const monotonic = [20, 21, 22, 23, 24].map(t => ({ loadStructure: 'uniform_working_load', total: t }))
  const rMono = computeCurrentLoadProgress(monotonic, 'est1rm', DEFAULT_POLICY)
  check('20->21->22->23->24 -> ACCUMULATING (never flagged as high variation)', rMono.state === 'ACCUMULATING')

  const noisyFlat = [20, 24, 19, 23, 20].map(t => ({ loadStructure: 'uniform_working_load', total: t }))
  check('a genuinely noisy flat series -> STABLE_VARIATION', computeCurrentLoadProgress(noisyFlat, 'est1rm', DEFAULT_POLICY).state === 'STABLE_VARIATION')

  const withMixed = [
    { loadStructure: 'uniform_working_load', total: 20 },
    { loadStructure: 'mixed_load', total: null },
    { loadStructure: 'uniform_working_load', total: 21 },
    { loadStructure: 'uniform_working_load', total: 22 },
  ]
  const rMixed = computeCurrentLoadProgress(withMixed, 'est1rm', DEFAULT_POLICY)
  check('a mixed_load point is excluded before regression — never a NaN slope', rMixed.n === 3 && Number.isFinite(rMixed.slope))

  const flatAt3 = computeCurrentLoadProgress(Array.from({ length: 3 }, () => ({ loadStructure: 'uniform_working_load', total: 20 })), 'est1rm', DEFAULT_POLICY)
  const flatAt4 = computeCurrentLoadProgress(Array.from({ length: 4 }, () => ({ loadStructure: 'uniform_working_load', total: 20 })), 'est1rm', DEFAULT_POLICY)
  const flatAt5 = computeCurrentLoadProgress(Array.from({ length: 5 }, () => ({ loadStructure: 'uniform_working_load', total: 20 })), 'est1rm', DEFAULT_POLICY)
  check('flat @ n=3 -> TOO_EARLY_TO_JUDGE', flatAt3.state === 'TOO_EARLY_TO_JUDGE')
  check('flat @ n=4 -> BUILDING_BASELINE (reachable: grace(3) < 4 < min(5))', flatAt4.state === 'BUILDING_BASELINE')
  check('flat @ n=5 -> POSSIBLE_PLATEAU', flatAt5.state === 'POSSIBLE_PLATEAU')

  const declining = [24, 22, 20, 18].map(t => ({ loadStructure: 'uniform_working_load', total: t }))
  check('a real negative slope -> DECLINING', computeCurrentLoadProgress(declining, 'est1rm', DEFAULT_POLICY).state === 'DECLINING')

  // `total` is the quantity axis (reps at a FIXED assistance level) — always
  // "more is better", even for assistedWeight (whose inversion applies only
  // to the load/assistance axis itself, judged elsewhere, never here).
  const assistedRisingReps = [16, 18, 20, 22, 24].map(t => ({ loadStructure: 'uniform_working_load', total: t }))
  check('assistedWeight: MORE reps at a fixed assistance level reads ACCUMULATING, same as any other metric', computeCurrentLoadProgress(assistedRisingReps, 'assistedWeight', DEFAULT_POLICY).state === 'ACCUMULATING')
  const assistedFallingReps = [24, 22, 20, 18].map(t => ({ loadStructure: 'uniform_working_load', total: t }))
  check('assistedWeight: FEWER reps at a fixed assistance level reads DECLINING, never treated as improvement', computeCurrentLoadProgress(assistedFallingReps, 'assistedWeight', DEFAULT_POLICY).state === 'DECLINING')

  // BLOCKER #3 — named regression: a 2-set session must NEVER be regressed
  // against a 3-set session. Mixing raw totals across set counts reads a
  // pure set-count change as if it were a real trend (24,24,24 @ 3 sets is
  // flat; injecting one 16 @ 2 sets among them would misread as a decline
  // purely from having done one fewer set, not from doing worse).
  {
    const mixedSetCounts = [
      { loadStructure: 'uniform_working_load', total: 24, comparableSetCount: 3 },
      { loadStructure: 'uniform_working_load', total: 24, comparableSetCount: 3 },
      { loadStructure: 'uniform_working_load', total: 16, comparableSetCount: 2 }, // set-count-incompatible outlier
      { loadStructure: 'uniform_working_load', total: 24, comparableSetCount: 3 },
      { loadStructure: 'uniform_working_load', total: 24, comparableSetCount: 3 },
    ]
    const r = computeCurrentLoadProgress(mixedSetCounts, 'est1rm', DEFAULT_POLICY)
    check('#3: the 2-set outlier is excluded — only the 4 dominant 3-set points are regressed', r.n === 4)
    check('#3: with the 2-set outlier excluded, 4 flat 3-set sessions never read as DECLINING', r.state !== 'DECLINING')
  }
  // A genuinely mixed-set-count history (no dominant count) falls back to
  // INSUFFICIENT_HISTORY once segmented — never silently regresses whatever
  // is left over regardless of how few points that leaves.
  {
    const noMajority = [
      { loadStructure: 'uniform_working_load', total: 24, comparableSetCount: 3 },
      { loadStructure: 'uniform_working_load', total: 16, comparableSetCount: 2 },
      { loadStructure: 'uniform_working_load', total: 24, comparableSetCount: 3 },
      { loadStructure: 'uniform_working_load', total: 16, comparableSetCount: 2 },
    ]
    const r = computeCurrentLoadProgress(noMajority, 'est1rm', DEFAULT_POLICY)
    check('#3: a tied/no-majority set-count history segments to the LATEST point\'s own count (2), leaving only 2 usable points -> INSUFFICIENT_HISTORY', r.state === 'INSUFFICIENT_HISTORY' && r.n === 2)
  }
}

console.log('\n== 10. computeRecentProgressTrend — reuses isCleanProgression, never an independent raw-total read (§5) ==')
{
  const points = []
  for (let i = 0; i < 11; i++) points.push({ date: `d${i}`, loadStructure: 'uniform_working_load', weightKg: i === 1 ? 70 : 60, total: 24, sets: [set(1, 60, 8), set(2, 60, 8), set(3, 60, 8)], comparableSetCount: 3 })
  points.push({ date: 'latest', loadStructure: 'uniform_working_load', weightKg: 65, total: 24, sets: [set(1, 65, 8), set(2, 65, 8), set(3, 65, 8)], comparableSetCount: 3 })
  const recent = computeRecentProgressTrend(points, 'est1rm', DEFAULT_POLICY)
  check('window caps at the configured size (default 8)', recent.n <= DEFAULT_POLICY.recentWindowSessions)

  // §14 named scenario: 10/8/7 -> 9/9/8 must NOT read as a positive signal —
  // the total went from 25 to 26 (up), but position 1 regressed (10->9), so
  // this is a redistribution, not a clean progression, and the total's
  // small rise alone must not clear the meaningful-decline floor either.
  {
    const prevSets = [set(1, 60, 10), set(2, 60, 8), set(3, 60, 7)]
    const currSets = [set(1, 60, 9), set(2, 60, 9), set(3, 60, 8)]
    check('§14: 10/8/7 -> 9/9/8 is NOT a clean progression (position 1 regressed)', !isCleanProgression(prevSets, currSets, 'est1rm'))
    const trendPoints = [
      { date: 'd0', loadStructure: 'uniform_working_load', weightKg: 60, total: 25, sets: prevSets, comparableSetCount: 3 },
      { date: 'd1', loadStructure: 'uniform_working_load', weightKg: 60, total: 25, sets: prevSets, comparableSetCount: 3 },
      { date: 'd2', loadStructure: 'uniform_working_load', weightKg: 60, total: 26, sets: currSets, comparableSetCount: 3 },
    ]
    const r = computeRecentProgressTrend(trendPoints, 'est1rm', DEFAULT_POLICY)
    check('§14: the trend read never counts this pair as a positive signal', r.positive === 0)
  }

  // A set-count mismatch inside the window is skipped entirely (never enters positive OR negative).
  {
    const mismatchPoints = [
      { date: 'd0', loadStructure: 'uniform_working_load', weightKg: 60, total: 24, sets: [set(1, 60, 8), set(2, 60, 8), set(3, 60, 8)], comparableSetCount: 3 },
      { date: 'd1', loadStructure: 'uniform_working_load', weightKg: 60, total: 16, sets: [set(1, 60, 8), set(2, 60, 8)], comparableSetCount: 2 },
      { date: 'd2', loadStructure: 'uniform_working_load', weightKg: 60, total: 24, sets: [set(1, 60, 8), set(2, 60, 8), set(3, 60, 8)], comparableSetCount: 3 },
    ]
    const r = computeRecentProgressTrend(mismatchPoints, 'est1rm', DEFAULT_POLICY)
    check('a set-count mismatch pair contributes to neither positive nor negative', r.positive === 0 && r.negative === 0)
  }
}

console.log('\n== 11. detectProgressEvents / detectEstimatedStrengthPr (all-history, never windowed) ==')
{
  const rows = [
    ...uniformRows('w1', '2026-07-01', 'ex1', 60, [7, 7, 6]),
    ...uniformRows('w2', '2026-07-08', 'ex1', 70, [8, 7, 7]), // an old spike, outside the later 8-session window
    ...Array.from({ length: 9 }, (_, i) => uniformRows(`w${i + 3}`, `2026-08-0${i + 1}`, 'ex1', 60, [8, 8, 8])).flat(),
  ]
  const sessions = buildCanonicalSessions(rows, 'ex1')
  const points = buildRepresentativePoints(sessions, 'est1rm')
  const latestIndex = sessions.length - 1
  const events = detectProgressEvents(points, latestIndex, 'est1rm', sessions[latestIndex], DEFAULT_EXPECTATION(8, 12, 3), DEFAULT_POLICY)
  check('a new "high" (60kg) relative to the windowed subset is correctly NOT a LOAD_PR (true max is 70kg, ever-logged)', !events.some(e => e.code === 'LOAD_PR'))

  const strengthPr = detectEstimatedStrengthPr(sessions, latestIndex, 'est1rm')
  check('no est1rm PR either, since 60kg never exceeds the 70kg-session e1RM', strengthPr === null)

  // BLOCKER #1 — named regression: 60kg x8 (e1RM ~76.0kg) must be selected
  // over 45kg x12 (e1RM ~63.0kg) as the session's best e1RM, even though
  // 45x12 has MORE reps. The old buggy selector picked "most reps",
  // silently reporting 45x12 (the WORSE lift) as the session's strength.
  {
    const rows6045 = [
      ...uniformRows('w1', '2026-08-01', 'sixtyeight', 50, [8, 8, 8]), // an earlier, unambiguous baseline
      [row('w2', '2026-08-08', 'sixtyeight', 1, 60, 8), row('w2', '2026-08-08', 'sixtyeight', 2, 45, 12)],
    ].flat()
    const s = buildCanonicalSessions(rows6045, 'sixtyeight')
    const li = s.length - 1
    const strength = detectEstimatedStrengthPr(s, li, 'est1rm')
    // 60kg x8 Epley e1RM = 60 * (1 + 8/30) = 76.0; 45kg x12 = 45 * (1 + 12/30) = 63.0.
    check('#1 detectEstimatedStrengthPr: 60x8 (e1RM 76.0) is selected over 45x12 (e1RM 63.0), never "most reps"', strength !== null && Math.abs(strength.values.e1rmKg - 76.0) < 0.05)
  }
  // BLOCKER #1 — the same fix in buildCurrentState's estimatedStrengthChange
  // (evaluate.ts), exercised through the full pipeline.
  {
    const rows = [
      ...uniformRows('w1', '2026-08-01', 'sixtyeight2', 50, [8, 8, 8]),
      [row('w2', '2026-08-08', 'sixtyeight2', 1, 60, 8), row('w2', '2026-08-08', 'sixtyeight2', 2, 45, 12)],
    ].flat()
    const sessions2 = buildCanonicalSessions(rows, 'sixtyeight2')
    const expectation2 = resolveExpectation('sixtyeight2', 'est1rm', 2, () => null, () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'sixtyeight2', metricKind: 'est1rm', sessions: sessions2, expectation: expectation2 }, DEFAULT_POLICY)
    check('#1 buildCurrentState: estimatedStrengthChange.toKg reads 60x8\'s e1RM (76.0), never 45x12\'s (63.0)',
      result.currentState.estimatedStrengthChange !== null && Math.abs(result.currentState.estimatedStrengthChange.toKg - 76.0) < 0.05)
  }

  // REP_PR_AT_LOAD (§7/§14) — a new best single-set rep count at an
  // EXACT, previously-seen load.
  {
    const repPrRows = [
      ...uniformRows('w1', '2026-08-01', 'reppr', 60, [8, 8, 8]),
      ...uniformRows('w2', '2026-08-08', 'reppr', 60, [8, 8, 8]),
      ...uniformRows('w3', '2026-08-15', 'reppr', 60, [10, 9, 8]),
    ]
    const s = buildCanonicalSessions(repPrRows, 'reppr')
    const p = buildRepresentativePoints(s, 'est1rm')
    const li = s.length - 1
    const ev = detectProgressEvents(p, li, 'est1rm', s[li], DEFAULT_EXPECTATION(6, 12, 3), DEFAULT_POLICY)
    check('REP_PR_AT_LOAD fires when the top set beats every prior top set at the same 60kg load', ev.some(e => e.code === 'REP_PR_AT_LOAD' && e.values.reps === 10 && e.values.previousBest === 8))
  }

  // BLOCKER #6 — named regression: REP_PR_AT_LOAD must pick the actual BEST
  // eligible set at the exact load, not merely the FIRST matching set in
  // array order. This session logs 60kg sets in the order [6, 9, 7] reps —
  // a `.find()`-based selector would lock onto the FIRST one (6 reps) and
  // wrongly conclude no PR (6 does not beat the prior best of 8).
  {
    const rows = [
      ...uniformRows('w1', '2026-08-01', 'bestset', 60, [8, 8, 8]),
      [row('w2', '2026-08-08', 'bestset', 1, 60, 6), row('w2', '2026-08-08', 'bestset', 2, 60, 9), row('w2', '2026-08-08', 'bestset', 3, 60, 7)],
    ].flat()
    const s = buildCanonicalSessions(rows, 'bestset')
    const p = buildRepresentativePoints(s, 'est1rm')
    const li = s.length - 1
    const ev = detectProgressEvents(p, li, 'est1rm', s[li], DEFAULT_EXPECTATION(6, 12, 3), DEFAULT_POLICY)
    check('#6: REP_PR_AT_LOAD selects the BEST set at the load (9 reps), not the FIRST matching set (6 reps)',
      ev.some(e => e.code === 'REP_PR_AT_LOAD' && e.values.reps === 9 && e.values.previousBest === 8))
  }

  // TOTAL_REPS_PR_AT_LOAD requires the SAME set count too (§4/§14).
  {
    const rowsA = [
      ...uniformRows('w1', '2026-08-01', 'totalpr', 60, [8, 8, 8]),
      ...uniformRows('w2', '2026-08-08', 'totalpr', 60, [10, 10]), // fewer sets at the same load — must not seed a lower "PR" bar
      ...uniformRows('w3', '2026-08-15', 'totalpr', 60, [8, 8, 9]), // higher total (25) at the ORIGINAL 3-set count (24)
    ]
    const s = buildCanonicalSessions(rowsA, 'totalpr')
    const p = buildRepresentativePoints(s, 'est1rm')
    const li = s.length - 1
    const ev = detectProgressEvents(p, li, 'est1rm', s[li], DEFAULT_EXPECTATION(6, 12, 3), DEFAULT_POLICY)
    check('TOTAL_REPS_PR_AT_LOAD only compares against prior sessions with the SAME comparable set count', ev.some(e => e.code === 'TOTAL_REPS_PR_AT_LOAD' && e.values.previousBest === 24))
  }

  // PROGRESSION_STREAK (§7/§14).
  {
    const streakRows = [
      ...uniformRows('w1', '2026-08-01', 'streak', 40, [8, 8, 8]),
      ...uniformRows('w2', '2026-08-08', 'streak', 45, [8, 8, 8]),
      ...uniformRows('w3', '2026-08-15', 'streak', 50, [8, 8, 8]),
      ...uniformRows('w4', '2026-08-22', 'streak', 55, [8, 8, 8]),
    ]
    const s = buildCanonicalSessions(streakRows, 'streak')
    const p = buildRepresentativePoints(s, 'est1rm')
    const li = s.length - 1
    const ev = detectProgressEvents(p, li, 'est1rm', s[li], DEFAULT_EXPECTATION(6, 12, 3), DEFAULT_POLICY)
    check('PROGRESSION_STREAK fires after 3 consecutive forward-motion transitions (default minLength=3)', ev.some(e => e.code === 'PROGRESSION_STREAK' && e.values.streakLength === 3))

    const noStreakRows = [
      ...uniformRows('w1', '2026-08-01', 'nostreak', 40, [8, 8, 8]),
      ...uniformRows('w2', '2026-08-08', 'nostreak', 40, [8, 8, 8]), // flat — breaks the streak
      ...uniformRows('w3', '2026-08-15', 'nostreak', 45, [8, 8, 8]),
    ]
    const s2 = buildCanonicalSessions(noStreakRows, 'nostreak')
    const p2 = buildRepresentativePoints(s2, 'est1rm')
    const li2 = s2.length - 1
    const ev2 = detectProgressEvents(p2, li2, 'est1rm', s2[li2], DEFAULT_EXPECTATION(6, 12, 3), DEFAULT_POLICY)
    check('PROGRESSION_STREAK does not fire when a flat session breaks the run (streak length 1 < minLength 3)', !ev2.some(e => e.code === 'PROGRESSION_STREAK'))
  }

  // BLOCKER #7 — named regression: a mixed-load session sitting inside an
  // otherwise-connectable run must break the streak outright, even though
  // its raw `sets` (still present on the RepresentativePoint — only
  // weightKg/total get nulled for a mixed session) could otherwise slip
  // past isCleanProgression as a "clean" link. Constructed so that WITHOUT
  // the loadStructure guard the chain w1->w2(mixed)->w3->w4 would read as 3
  // consecutive forward-motion links (streak=3, firing PROGRESSION_STREAK
  // at the default minLength=3) purely because isCleanProgression only
  // looks at rep totals, never at load structure. With the guard, hitting
  // the mixed session at i=2 breaks the walk immediately, capping the
  // streak at 1 (just the w3->w4 loadUp).
  {
    const rows = [
      ...uniformRows('w1', '2026-08-01', 'mixedstreak', 40, [6, 6, 6]),
      // A genuinely mixed-load session (a real increase mid-session) — its
      // own reps still climb cleanly relative to w1, which is exactly what
      // would extend the streak through it without the explicit guard.
      [row('w2', '2026-08-08', 'mixedstreak', 1, 50, 7), row('w2', '2026-08-08', 'mixedstreak', 2, 45, 7), row('w2', '2026-08-08', 'mixedstreak', 3, 48, 7)],
      ...uniformRows('w3', '2026-08-15', 'mixedstreak', 55, [8, 8, 8]),
      ...uniformRows('w4', '2026-08-22', 'mixedstreak', 60, [9, 9, 9]),
    ].flat()
    const s = buildCanonicalSessions(rows, 'mixedstreak')
    const p = buildRepresentativePoints(s, 'est1rm')
    const li = s.length - 1
    const ev = detectProgressEvents(p, li, 'est1rm', s[li], DEFAULT_EXPECTATION(6, 12, 3), DEFAULT_POLICY)
    check('#7: a mixed-load session inside the run breaks PROGRESSION_STREAK outright (would otherwise fire at streak=3)', !ev.some(e => e.code === 'PROGRESSION_STREAK'))
  }
  // BLOCKER #7 — a set-count-compromised pair (missing/extra set) must also
  // never count as a clean-progression streak link, even when the raw
  // total technically rose.
  {
    const rows = [
      ...uniformRows('w1', '2026-08-01', 'countstreak', 40, [8, 8, 8]),
      ...uniformRows('w2', '2026-08-08', 'countstreak', 40, [8, 8, 8]),
      ...uniformRows('w3', '2026-08-15', 'countstreak', 40, [9, 9]), // one fewer set — a set-count-compromised pair, higher-looking per-set reps
    ]
    const s = buildCanonicalSessions(rows, 'countstreak')
    const p = buildRepresentativePoints(s, 'est1rm')
    const li = s.length - 1
    const ev = detectProgressEvents(p, li, 'est1rm', s[li], DEFAULT_EXPECTATION(6, 12, 3), DEFAULT_POLICY)
    check('#7: a set-count-mismatched pair never extends the streak (no PROGRESSION_STREAK at minLength 3)', !ev.some(e => e.code === 'PROGRESSION_STREAK'))
  }

  // TARGET_COMPLETED never fires on an incomplete session (§4/§14).
  {
    const incompleteRows = uniformRows('w1', '2026-09-02', 'incompletetarget', 60, [10, 10]) // only 2 of a 3-set target
    const s = buildCanonicalSessions(incompleteRows, 'incompletetarget')
    const p = buildRepresentativePoints(s, 'est1rm')
    const ev = detectProgressEvents(p, 0, 'est1rm', s[0], DEFAULT_EXPECTATION(6, 10, 3), DEFAULT_POLICY)
    check('§14: an incomplete session (2 of 3 target sets) never fires TARGET_COMPLETED', !ev.some(e => e.code === 'TARGET_COMPLETED'))
  }
}

console.log('\n== 12. evaluateExerciseProgress — worked examples ==')
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
    check('Back Squat: no numeric progression recommendation for a mixed-load session', result.nextTargets === null)
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

console.log('\n== 13. isPositiveLoadChange ==')
{
  check('assistedWeight: a decrease is positive (less assistance = harder)', isPositiveLoadChange('assistedWeight', 20, 15) === true)
  check('est1rm: a decrease is NOT positive', isPositiveLoadChange('est1rm', 20, 15) === false)
  check('null inputs -> null, never a false positive/negative', isPositiveLoadChange('est1rm', null, 15) === null)
}

console.log('\n== 14. resolveExpectation — restored priority: user_override > routine > default (§11) ==')
{
  const routineLookup = () => ({ repMin: 8, repMax: 12, targetSets: 4 })
  const overrideLookup = () => ({ repMin: 5, repMax: 8 })
  const e = resolveExpectation('ex1', 'est1rm', 3, routineLookup, overrideLookup)
  check('§11: an explicit user override wins over the routine target', e.source === 'user_override' && e.repMin === 5 && e.repMax === 8)
  check('§11: when an override supplies only a rep range, the routine\'s own prescribed SET COUNT is preserved', e.targetSets === 4)

  const eRoutineOnly = resolveExpectation('ex1', 'est1rm', 3, routineLookup, () => null)
  check('no override -> falls through to the routine target', eRoutineOnly.source === 'routine' && eRoutineOnly.repMin === 8)

  const eDefault = resolveExpectation('ex1', 'est1rm', 3, () => null, () => null)
  check('neither override nor routine -> the generic labeled default', eDefault.source === 'default')

  const eNone = resolveExpectation('ex1', 'duration', 3, () => null, () => null)
  check('a metric kind with no generic default (duration) -> not_configured, never a fabricated range', eNone.source === 'not_configured' && eNone.repMin === null)

  // An override with NO matching routine falls back to the caller's fallbackTargetSets.
  const eOverrideNoRoutine = resolveExpectation('ex1', 'est1rm', 3, () => null, overrideLookup)
  check('an override with no routine target falls back to fallbackTargetSets', eOverrideNoRoutine.targetSets === 3)
}

console.log('\n== 15. copy.ts ==')
{
  check('actionLabel resolves from the catalog', actionLabel('READY_TO_INCREASE') === 'Ready to increase')
  check('evidenceLabel uses the exact user-approved wording', evidenceLabel('limited') === 'Limited evidence' && evidenceLabel('moderate') === 'Moderate evidence' && evidenceLabel('strong') === 'Strong evidence')
  check('scopeLabel never overclaims for a partial scope', scopeLabel('LOGGED_SETS_ONLY') === 'the sets actually logged')

  // Dynamic evidence explanations (§12) — must reflect the RESULT's own numbers, never a static string.
  {
    const rows = [...uniformRows('w1', '2026-08-01', 'evsentence', 60, [8, 8, 8]), ...uniformRows('w2', '2026-08-08', 'evsentence', 60, [8, 8, 8])]
    const sessions = buildCanonicalSessions(rows, 'evsentence')
    const expectation = resolveExpectation('evsentence', 'est1rm', 3, () => null, () => null)
    const result = evaluateExerciseProgress({ exerciseTemplateId: 'evsentence', metricKind: 'est1rm', sessions, expectation }, DEFAULT_POLICY)
    const progressText = progressEvidenceExplanation(result)
    check('progressEvidenceExplanation cites this exercise\'s own actual session count', progressText.includes(String(result.comparableSessions)))
    const recText = recommendationEvidenceExplanation(result)
    check('recommendationEvidenceExplanation is a real, non-empty sentence', typeof recText === 'string' && recText.length > 10)
  }
}

console.log('\n== 16. RULE_CATALOG completeness (documentation-sync requirement) — includes measured_fact (§13) ==')
{
  const emittedCodes = new Set([
    'LOAD_INCREASED_PCT', 'ALL_SETS_ABOVE_MINIMUM', 'TOP_OF_RANGE_NOT_REACHED', 'BELOW_TARGET_MINIMUM',
    'REP_INCREASE_CLEAN', 'LOAD_DECREASED_UNKNOWN_INTENT', 'ASSISTANCE_REDUCED', 'NO_TREND_AT_CURRENT_LOAD',
    'DATA_QUALITY_MISSING_SET', 'DATA_QUALITY_EXTRA_SET', 'DATA_QUALITY_MIXED_LOAD', 'AWAITING_TOP_RANGE_CONFIRMATION',
    'LOAD_PR', 'REP_PR_AT_LOAD', 'TOTAL_REPS_PR_AT_LOAD', 'ESTIMATED_STRENGTH_PR', 'TARGET_COMPLETED', 'PROGRESSION_STREAK',
    'BUILD_AT_CURRENT_LOAD', 'READY_TO_INCREASE', 'CONFIRM_BEFORE_INCREASING', 'CONFIRM_AT_CURRENT_LOAD',
    'HOLD_STEADY', 'REVIEW_LOAD_REDUCTION', 'WATCH_FOR_PLATEAU', 'WATCH_FOR_REGRESSION', 'INSUFFICIENT_DATA',
  ])
  let missing = []
  for (const code of emittedCodes) if (!RULE_CATALOG[code]) missing.push(code)
  check('every reason/event/action code the engine can emit has a RULE_CATALOG entry', missing.length === 0, `missing: ${missing.join(', ')}`)
  check('every catalog entry declares a real evidenceClass, including the new measured_fact tier', Object.values(RULE_CATALOG).every(e => ['measured_fact', 'science', 'product_rule', 'program_policy'].includes(e.evidenceClass)))
  check('§13: a plain logged fact (LOAD_PR) is classified measured_fact, never science', RULE_CATALOG.LOAD_PR.evidenceClass === 'measured_fact')
  check('§13: TOTAL_REPS_PR_AT_LOAD is measured_fact, never science', RULE_CATALOG.TOTAL_REPS_PR_AT_LOAD.evidenceClass === 'measured_fact')
  check('§13: LOAD_INCREASED_PCT is measured_fact, never science', RULE_CATALOG.LOAD_INCREASED_PCT.evidenceClass === 'measured_fact')
}

console.log('\n== 17. buildExplanationSentence never crashes on any worked example ==')
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
