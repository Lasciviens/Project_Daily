#!/usr/bin/env node
/*
 * Verification — Progress decision engine (progressDecisions.ts +
 * progressCopy.ts), built from the Training -> Progress redesign
 * (docs/progress-redesign/PLAN.md — delete once the feature ships).
 *
 * Proves, against the REAL un-mocked modules (loaded via sucrase — this
 * repo has no unit-test runner by convention):
 *   1. rpeToRir — Hevy's own RPE->RIR mapping, used verbatim.
 *   2. filterToCurrentProgram — explicit membership, freeform pass-through,
 *      and the "no selection saved yet" no-op case.
 *   3. computeTrendConfidence — sample-size/week-span gates, and that a
 *      varied rep range forces Low regardless of session count.
 *   4. resolveExpectation — the routine > user override > default >
 *      not-configured priority order, and that historical reps never
 *      enter this resolution at all.
 *   5. computeRpeEvidence — averaging, warmup exclusion, the null case.
 *   6. computeActionConfidence — the no-RPE cap + exact caveat sentence,
 *      the RIR>=2 upgrade, and the RIR<2 (near-maximal) cap.
 *   7. computeExerciseDecision — insufficient_data, increase (with and
 *      without RPE), keep, watch (flat, 2 sessions), possible plateau
 *      (>=4 sessions/>=3 weeks flat), and a declining exercise landing on
 *      its own honest 'watch', never a program-level label.
 *   8. computeProgramDecision — the 3-state progressing/mixed/insufficient_data verdict, and that
 *      review_workload needs BOTH >=2 declining exercises AND a
 *      corroborating signal — never from one exercise or no signal.
 *   9. progressCopy.ts — label mappings and the two-facet confidence
 *      sentence the user explicitly asked for.
 *  7b. Round 3: previous/latest exposure display, the load-increase vs
 *      regression classifications (successful increase / premature increase
 *      / deload / rep progression), and that a genuine weight-change-
 *      explained rep-range swing no longer crushes trend confidence to Low.
 *  10. computeCurrentWeekMuscleDose — the reported mid-week muscle-dose bug
 *      (a Wednesday judged as a deficit against the FULL week's plan): never
 *      a deficit for an in-progress week, only an on_track/behind_pace read
 *      against the routines actually done so far.
 *
 *   Run:  node scripts/verify-progress-decisions.cjs
 */
require('sucrase/register')

const { computeExerciseProgression } = require('../src/features/training/progressAggregate')
const {
  rpeToRir, filterToCurrentProgram, computeTrendConfidence, resolveExpectation,
  computeRpeEvidence, computeActionConfidence, computeExerciseDecision, computeProgramDecision,
} = require('../src/features/training/progressDecisions')
const {
  statusLabel, decisionHeadline, confidenceLabel, progressVerdictHeadline, workloadLabel, composeConfidenceSentence,
} = require('../src/features/training/progressCopy')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function set(overrides) {
  return {
    workout_id: 'w1', date: '2026-08-01', exercise_template_id: 'ex1', set_type: 'normal',
    weight_kg: 40, reps: 10, duration_seconds: null, distance_meters: null,
    routine_id: null, rpe: null,
    ...overrides,
  }
}

console.log('\n== 1. rpeToRir (Hevy\'s own mapping, verbatim) ==')
{
  check('RPE 10 -> 0 RIR', rpeToRir(10) === 0)
  check('RPE 9 -> 1 RIR', rpeToRir(9) === 1)
  check('RPE 8 -> 2 RIR', rpeToRir(8) === 2)
  check('RPE 7 -> floors at 3 (comfortable, not a precise count)', rpeToRir(7) === 3)
}

console.log('\n== 2. filterToCurrentProgram ==')
{
  const sets = [
    set({ workout_id: 'a', routine_id: 'r1' }),
    set({ workout_id: 'b', routine_id: 'r2' }),
    set({ workout_id: 'c', routine_id: null }), // freeform
  ]
  const noSelection = filterToCurrentProgram(sets, new Set())
  check('no current-program selection saved yet -> nothing excluded', noSelection.length === 3)

  const withSelection = filterToCurrentProgram(sets, new Set(['r1']))
  check('a known OTHER routine (r2) is excluded', !withSelection.some(s => s.workout_id === 'b'))
  check('the current-program routine (r1) is kept', withSelection.some(s => s.workout_id === 'a'))
  check('a freeform session (no routine_id) is always kept', withSelection.some(s => s.workout_id === 'c'))
}

console.log('\n== 3. computeTrendConfidence ==')
{
  const pts = (dates) => dates.map(d => ({ date: d, topValue: 40, volume: null, topWeightKg: 40, topReps: 10 }))
  check('< 3 sessions -> low', computeTrendConfidence(pts(['2026-01-01', '2026-01-08']), false) === 'low')
  check('3 sessions -> low (below the medium bar)', computeTrendConfidence(pts(['2026-01-01', '2026-01-08', '2026-01-15']), false) === 'low')
  check('4 sessions over >=2 weeks -> medium',
    computeTrendConfidence(pts(['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22']), false) === 'medium')
  check('6 sessions over >=3 weeks -> high',
    computeTrendConfidence(pts(['2026-01-01', '2026-01-06', '2026-01-11', '2026-01-16', '2026-01-21', '2026-01-27']), false) === 'high')
  check('a varied rep range forces Low even with 6+ sessions',
    computeTrendConfidence(pts(['2026-01-01', '2026-01-06', '2026-01-11', '2026-01-16', '2026-01-21', '2026-01-27']), true) === 'low')
}

console.log('\n== 4. resolveExpectation (routine > user override > default > not-configured) ==')
{
  const routineHas = () => ({ repMin: 8, repMax: 10 })
  const routineNone = () => null
  const overrideHas = () => ({ repMin: 6, repMax: 9 })
  const overrideNone = () => null

  const r1 = resolveExpectation('ex1', 'est1rm', routineHas, overrideHas)
  check('routine target wins outright when present', r1.source === 'routine' && r1.repMax === 10)

  const r2 = resolveExpectation('ex1', 'est1rm', routineNone, overrideHas)
  check('user override wins when no routine target exists', r2.source === 'user_override' && r2.repMax === 9)

  const r3 = resolveExpectation('ex1', 'est1rm', routineNone, overrideNone)
  check('falls to a labeled generic default when neither exists', r3.source === 'default' && /Default/.test(r3.label))

  const r4 = resolveExpectation('ex1', 'duration', routineNone, overrideNone)
  check('a metric kind with no sensible generic (duration) -> "Target not configured"', r4.source === 'not_configured' && r4.repMin === null)
}

console.log('\n== 5. computeRpeEvidence ==')
{
  const none = computeRpeEvidence([set({ rpe: null }), set({ rpe: null })])
  check('no RPE logged at all -> null', none === null)

  const warmupExcluded = computeRpeEvidence([set({ set_type: 'warmup', rpe: 5 }), set({ rpe: 8 })])
  check('a warmup RPE is excluded from the average', warmupExcluded.averageRpe === 8)

  const mixed = computeRpeEvidence([set({ rpe: 8 }), set({ rpe: 9 })])
  check('averages across the sets that DO have RPE', mixed.averageRpe === 8.5)
  check('derives RIR from the averaged RPE', mixed.averageRir === rpeToRir(8.5))
}

console.log('\n== 6. computeActionConfidence ==')
{
  const noRpe = computeActionConfidence('high', null)
  check('no RPE at all -> capped at Medium (never blocks the action)', noRpe.confidence === 'medium')
  check('no RPE -> the EXACT user-specified caveat sentence, verbatim', noRpe.caveat === 'Effort was not tracked, so confirm that your technique remained controlled before increasing the weight.')

  const goodRir = computeActionConfidence('high', { averageRpe: 8, averageRir: 2, sessionsWithRpe: 2 })
  check('RIR >= 2 -> action confidence matches trend confidence, no caveat', goodRir.confidence === 'high' && goodRir.caveat === null)

  const maximal = computeActionConfidence('high', { averageRpe: 10, averageRir: 0, sessionsWithRpe: 2 })
  check('a truly maximal set (RIR 0) caps action confidence at Medium even with High trend', maximal.confidence === 'medium')

  const lowTrendNoRpe = computeActionConfidence('low', null)
  check('Low trend + no RPE stays Low, is never upgraded by the cap logic', lowTrendNoRpe.confidence === 'low')
}

console.log('\n== 7. computeExerciseDecision (integration, via the real computeExerciseProgression) ==')
{
  const defaultExpectation = { source: 'default', repMin: 8, repMax: 10, label: 'Default (no target saved): 8-10 reps' }

  // insufficient_data: only 2 sessions logged.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', reps: 8 }),
      set({ workout_id: 'w2', date: '2026-08-08', reps: 9 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('2 sessions -> insufficient_data', d.status === 'insufficient_data')
    check('insufficient_data names how many more are needed', /1 more session/.test(d.nextCheck))
  }

  // increase: last 2 sessions both reach the top of the range (10 reps), WITH RPE.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', reps: 8 }),
      set({ workout_id: 'w2', date: '2026-08-08', reps: 9 }),
      set({ workout_id: 'w3', date: '2026-08-15', reps: 10, rpe: 8 }),
      set({ workout_id: 'w4', date: '2026-08-22', reps: 10, rpe: 8 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const qualifying = sets.filter(s => s.workout_id === 'w3' || s.workout_id === 'w4')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: qualifying, expectation: defaultExpectation })
    check('2 consecutive sessions at the top of range -> increase', d.status === 'increase')
    check('RPE present with RIR 2 -> action confidence reaches trend level (not capped)', d.actionConfidence === d.trendConfidence)
    check('no caveat needed once RPE confirms room', d.caveat === null)
    check('RPE-derived evidence sentence is included', d.evidence.some(e => /Average RPE/.test(e)))
  }

  // increase, but with NO RPE logged -> capped confidence + exact caveat.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', reps: 8 }),
      set({ workout_id: 'w2', date: '2026-08-08', reps: 9 }),
      set({ workout_id: 'w3', date: '2026-08-15', reps: 10 }),
      set({ workout_id: 'w4', date: '2026-08-22', reps: 10 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const qualifying = sets.filter(s => s.workout_id === 'w3' || s.workout_id === 'w4')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: qualifying, expectation: defaultExpectation })
    check('still recommends increase from reps alone — RPE is never a gate', d.status === 'increase')
    check('action confidence capped at Medium with no RPE', d.actionConfidence === 'medium')
    check('the exact caveat sentence is attached', d.caveat === 'Effort was not tracked, so confirm that your technique remained controlled before increasing the weight.')
  }

  // keep: climbing, not yet at the top of the range.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', reps: 6 }),
      set({ workout_id: 'w2', date: '2026-08-08', reps: 7 }),
      set({ workout_id: 'w3', date: '2026-08-15', reps: 8 }),
      set({ workout_id: 'w4', date: '2026-08-22', reps: 9 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('climbing but under the top of range -> keep', d.status === 'keep')
    check('keep has no action confidence (no action being taken)', d.actionConfidence === null)
  }

  // watch: exactly 2 flat sessions.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', reps: 8 }),
      set({ workout_id: 'w2', date: '2026-08-08', reps: 8 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const withThird = computeExerciseProgression([...sets, set({ workout_id: 'w3', date: '2026-08-15', reps: 8 })], 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points: withThird, qualifyingSets: [], expectation: defaultExpectation })
    check('3 flat sessions (not yet the plateau bar) -> watch, not plateau', d.status === 'watch')
  }

  // possible plateau: >=4 sessions AND >=3 week span, flat.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', reps: 8 }),
      set({ workout_id: 'w2', date: '2026-08-08', reps: 8 }),
      set({ workout_id: 'w3', date: '2026-08-15', reps: 8 }),
      set({ workout_id: 'w4', date: '2026-08-29', reps: 8 }), // 4 weeks total span
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('>=4 sessions spanning >=3 weeks, flat -> possible plateau', d.status === 'plateau')
  }

  // declining exercise gets its own honest 'watch' — never a program-level label.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', reps: 12 }),
      set({ workout_id: 'w2', date: '2026-08-08', reps: 11 }),
      set({ workout_id: 'w3', date: '2026-08-15', reps: 9 }),
      set({ workout_id: 'w4', date: '2026-08-22', reps: 7 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('a declining exercise is scoped to "watch", never "review_workload"', d.status === 'watch')
    check('reasonCodes name the decline explicitly', d.reasonCodes.includes('TREND_DOWN'))
    check('evidence names the decline explicitly', d.evidence.some(e => /drifted/.test(e)))
  }
}

console.log('\n== 7b. Round 3: previous/latest exposure, load-increase classifications, weight-change-explained confidence ==')
{
  const defaultExpectation = { source: 'default', repMin: 6, repMax: 10, label: 'Default (no target saved): 6-10 reps' }

  // Successful load increase: weight went up, reps dropped but stayed inside
  // the target range — this must NEVER read as a regression (the user's own
  // exact complaint: total reps dropping alone is not a decline).
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w2', date: '2026-08-08', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w3', date: '2026-08-15', weight_kg: 10, reps: 8 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('weight up + reps still inside range -> keep (never a regression)', d.status === 'keep')
    check('reasonCodes record LOAD_INCREASED + ALL_SETS_INSIDE_TARGET_RANGE', d.reasonCodes.includes('LOAD_INCREASED') && d.reasonCodes.includes('ALL_SETS_INSIDE_TARGET_RANGE'))
    check('decisionHeadline reads "Successful load increase"', decisionHeadline(d) === 'Successful load increase')
    check('currentState.previous is the exact last comparable workout (8kg x 10)', d.currentState.previous.weightKg === 8 && d.currentState.previous.reps === 10)
    check('currentState.latest is the exact newest workout (10kg x 8)', d.currentState.latest.weightKg === 10 && d.currentState.latest.reps === 8)
    check('loadChangePercent is +25%', d.currentState.loadChangePercent === 25)
    check('first evidence line always states the raw previous/latest numbers', /Last comparable workout:.*Latest:/.test(d.evidence[0]))
  }

  // Load increase may be premature: reps fell BELOW the target minimum.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w2', date: '2026-08-08', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w3', date: '2026-08-15', weight_kg: 10, reps: 4 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('weight up but reps fall below the target minimum -> watch', d.status === 'watch')
    check('reasonCodes record BELOW_TARGET_MINIMUM', d.reasonCodes.includes('BELOW_TARGET_MINIMUM'))
    check('decisionHeadline reads "Load increase may be premature"', decisionHeadline(d) === 'Load increase may be premature')
  }

  // Recent deload: weight went DOWN — must never be read as a decline.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', weight_kg: 10, reps: 8 }),
      set({ workout_id: 'w2', date: '2026-08-08', weight_kg: 10, reps: 8 }),
      set({ workout_id: 'w3', date: '2026-08-15', weight_kg: 8, reps: 10 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('a weight drop -> watch, not a plain decline', d.status === 'watch')
    check('reasonCodes record LOAD_DECREASED', d.reasonCodes.includes('LOAD_DECREASED'))
    check('decisionHeadline reads "Recent deload"', decisionHeadline(d) === 'Recent deload')
  }

  // Same weight, reps climbed -> rep progression.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-08-01', weight_kg: 8, reps: 8 }),
      set({ workout_id: 'w2', date: '2026-08-08', weight_kg: 8, reps: 8 }),
      set({ workout_id: 'w3', date: '2026-08-15', weight_kg: 8, reps: 9 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('same weight, more reps -> keep / rep progression', d.status === 'keep' && d.reasonCodes.includes('REP_PROGRESSION'))
    check('decisionHeadline reads "Rep progression"', decisionHeadline(d) === 'Rep progression')
  }

  // The reported Hammer Curl bug: 6 sessions, a genuine weight increase at the
  // end swings the rep range by >=4 (the repRangeVariedSignificantly bar) —
  // this must NOT force trend confidence to Low, because the swing is fully
  // explained by the weight change, not noisy/unexplained data.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-07-01', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w2', date: '2026-07-08', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w3', date: '2026-07-15', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w4', date: '2026-07-22', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w5', date: '2026-07-29', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w6', date: '2026-08-05', weight_kg: 12, reps: 6 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('6 sessions, weight-explained rep swing -> trend confidence is NOT crushed to Low', d.trendConfidence !== 'low')
    check('still correctly classified as a successful load increase, not a regression', d.status === 'keep' && d.reasonCodes.includes('LOAD_INCREASED'))
  }

  // Contrast case: the SAME rep swing with NO weight change at all is real,
  // unexplained noise and must still force Low — proves the fix only
  // suppresses the penalty when a weight change is the actual explanation.
  {
    const sets = [
      set({ workout_id: 'w1', date: '2026-07-01', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w2', date: '2026-07-08', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w3', date: '2026-07-15', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w4', date: '2026-07-22', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w5', date: '2026-07-29', weight_kg: 8, reps: 10 }),
      set({ workout_id: 'w6', date: '2026-08-05', weight_kg: 8, reps: 6 }),
    ]
    const points = computeExerciseProgression(sets, 'ex1', 'est1rm')
    const d = computeExerciseDecision({ templateId: 'ex1', metricKind: 'est1rm', points, qualifyingSets: [], expectation: defaultExpectation })
    check('same rep swing with NO weight change -> still forced Low (unexplained noise)', d.trendConfidence === 'low')
  }
}

console.log('\n== 8. computeProgramDecision ==')
{
  const highIncrease = { templateId: 'a', status: 'increase', trendConfidence: 'high', evidence: [], reasonCodes: ['TOP_OF_RANGE_REACHED'] }
  const highKeep = { templateId: 'b', status: 'keep', trendConfidence: 'high', evidence: [], reasonCodes: ['LOAD_UNCHANGED', 'REP_PROGRESSION'] }
  const decliningOne = { templateId: 'c', status: 'watch', trendConfidence: 'medium', evidence: ['Trending down across 4 sessions (10 -> 8).'], reasonCodes: ['TREND_DOWN'] }
  const decliningTwo = { templateId: 'd', status: 'watch', trendConfidence: 'medium', evidence: ['Trending down across 4 sessions (12 -> 9).'], reasonCodes: ['TREND_DOWN'] }
  const insufficient = { templateId: 'e', status: 'insufficient_data', trendConfidence: 'low', evidence: [], reasonCodes: ['INSUFFICIENT_SESSIONS'] }

  const progressing = computeProgramDecision({ decisions: [highIncrease, highKeep, insufficient], corroboratingSignal: null })
  check('all analyzable exercises improving, none declining -> progressing', progressing.progressVerdict === 'progressing')
  check('insufficient_data exercises are excluded from the analyzable count', progressing.analyzableCount === 2)

  const mediumKeep = { templateId: 'f', status: 'keep', trendConfidence: 'medium', evidence: [], reasonCodes: ['LOAD_UNCHANGED', 'REP_PROGRESSION'] }
  const alsoProgressing = computeProgramDecision({ decisions: [highIncrease, mediumKeep, decliningOne], corroboratingSignal: null })
  check('a real majority improving (2 of 3) -> still progressing even with one declining', alsoProgressing.progressVerdict === 'progressing')

  const mixed = computeProgramDecision({ decisions: [decliningOne, decliningTwo], corroboratingSignal: null })
  check('no majority improving -> mixed (the user\'s explicit simplified 3-state label, not the old confirmed/likely/stable split)', mixed.progressVerdict === 'mixed')

  const oneDecliningNoReview = computeProgramDecision({ decisions: [highIncrease, decliningOne], corroboratingSignal: { label: 'sleep down' } })
  check('review_workload needs >= 2 declining exercises — one is not enough even with a signal', oneDecliningNoReview.workload === 'continue')

  const twoDecliningNoSignal = computeProgramDecision({ decisions: [decliningOne, decliningTwo], corroboratingSignal: null })
  check('review_workload needs a corroborating signal — 2 declining alone is not enough', twoDecliningNoSignal.workload === 'continue')

  const twoDecliningWithSignal = computeProgramDecision({ decisions: [decliningOne, decliningTwo], corroboratingSignal: { label: 'sleep trend down 2 weeks' } })
  check('>=2 declining AND a corroborating signal together -> review_workload', twoDecliningWithSignal.workload === 'review_workload')
  check('the corroborating signal label is carried through', twoDecliningWithSignal.corroboratingSignal === 'sleep trend down 2 weeks')
  check('affected exercise ids are the declining ones, for use as program-level evidence', twoDecliningWithSignal.affectedExerciseIds.sort().join(',') === 'c,d')
}

console.log('\n== 9. progressCopy.ts ==')
{
  check('statusLabel uses the user\'s exact requested wording', statusLabel('increase') === 'Increase weight' && statusLabel('keep') === 'Keep this weight')
  check('progressVerdictHeadline: progressing', progressVerdictHeadline('progressing') === 'Progressing')
  check('progressVerdictHeadline: mixed', progressVerdictHeadline('mixed') === 'Mixed')
  check('workloadLabel: review_workload', workloadLabel('review_workload') === 'Review workload')

  const withoutRpe = composeConfidenceSentence('high', 'medium', false)
  check('two-facet sentence, no RPE, matches the user\'s own example shape',
    withoutRpe === 'High confidence that performance is improving. Medium confidence in increasing weight because effort data is unavailable.')

  const withRpe = composeConfidenceSentence('high', 'high', true)
  check('two-facet sentence changes its reason clause once RPE is present', /based on reps and effort together/.test(withRpe))

  const trendOnly = composeConfidenceSentence('medium', null, false)
  check('no action taken (e.g. "keep") -> only the trend sentence, no second clause', trendOnly === 'Medium confidence that performance is improving.')
}

// == 10. computeCurrentWeekMuscleDose ==
// REMOVED along with Weekly Muscle Dose (MuscleDoseSummary.tsx) — the
// per-exercise progress engine (scripts/verify-progress-engine.cjs)
// superseded this feature. computeCurrentWeekMuscleDose no longer exists
// in progressAggregate.ts; see that file's git history for the retired
// implementation and CLAUDE.md for why it was removed.

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
