#!/usr/bin/env node
/*
 * Verification — Training "Progress" tab pure helpers (progressAggregate.ts),
 * added from a strength-coach + sports-scientist agent review (2026-08-28).
 *
 * Proves, against the REAL un-mocked module (loaded via sucrase — the repo
 * has no unit-test runner by convention):
 *   1. est1RM — Epley formula, the ≤12-rep eligibility cutoff, the reps=1
 *      identity case.
 *   2. metricKindForExerciseType — the per-exercise-type dispatch table.
 *   3. computeExerciseProgression — best-set (never average) selection per
 *      session, warmup exclusion, dropset/failure eligibility, the inverted
 *      assisted-exercise selection, and volume summation.
 *   4. repRangeVariedSignificantly — the ±4-rep caveat trigger.
 *   5. computeWeeklyVolumeTrend — TONNAGE_TYPES-only inclusion, warmup
 *      exclusion.
 *   6. rollingAverage — null-before-window, correct windowed mean.
 *   7. computeConsistencyByWeek / currentStreakWeeks — session-per-week
 *      counting and streak termination at a real gap.
 *
 *   Run:  node scripts/verify-training-progress.cjs
 */
require('sucrase/register')

const {
  est1RM, metricKindForExerciseType, computeExerciseProgression, repRangeVariedSignificantly,
  computeWeeklyVolumeTrend, rollingAverage, computeConsistencyByWeek, currentStreakWeeks,
} = require('../src/features/training/progressAggregate')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n== 1. est1RM (Epley) ==')
{
  check('100kg x 5 reps -> Epley value', est1RM(100, 5) === 116.7, String(est1RM(100, 5)))
  check('reps=1 is an identity (the weight itself is the 1RM)', est1RM(140, 1) === 140)
  check('reps=12 (the cutoff) still returns a value', est1RM(60, 12) !== null)
  check('reps=13 (over the cutoff) returns null — too unreliable to estimate', est1RM(60, 13) === null)
  check('reps=0 returns null', est1RM(60, 0) === null)
}

console.log('\n== 2. metricKindForExerciseType ==')
{
  check('weight_reps -> est1rm', metricKindForExerciseType('weight_reps') === 'est1rm')
  check('short_distance_weight -> est1rm', metricKindForExerciseType('short_distance_weight') === 'est1rm')
  check('bodyweight_reps -> reps', metricKindForExerciseType('bodyweight_reps') === 'reps')
  check('reps_only -> reps', metricKindForExerciseType('reps_only') === 'reps')
  check('bodyweight_weighted -> addedWeight', metricKindForExerciseType('bodyweight_weighted') === 'addedWeight')
  check('bodyweight_assisted -> assistedWeight', metricKindForExerciseType('bodyweight_assisted') === 'assistedWeight')
  check('duration -> duration', metricKindForExerciseType('duration') === 'duration')
  check('weight_duration -> duration', metricKindForExerciseType('weight_duration') === 'duration')
  check('distance_duration -> distance', metricKindForExerciseType('distance_duration') === 'distance')
  check('an unknown/future type falls back to est1rm, not a crash', metricKindForExerciseType('some_new_type') === 'est1rm')
}

console.log('\n== 3. computeExerciseProgression ==')
{
  const T = 'tpl-1'
  const mk = (over) => ({
    workout_id: 'w1', date: '2026-08-01', exercise_template_id: T,
    set_type: 'normal', weight_kg: null, reps: null, duration_seconds: null, distance_meters: null,
    ...over,
  })

  // Warmup excluded, best set (not average) wins.
  const sets1 = [
    mk({ set_type: 'warmup', weight_kg: 200, reps: 1 }), // would dominate if not excluded
    mk({ weight_kg: 100, reps: 5 }),
    mk({ weight_kg: 90, reps: 8 }),
  ]
  const p1 = computeExerciseProgression(sets1, T, 'est1rm')
  check('one session point produced', p1.length === 1)
  check('warmup set never becomes the top value', p1[0].topValue !== est1RM(200, 1))
  check('best set (100kg x5) wins over a lighter backoff set, not an average', p1[0].topWeightKg === 100 && p1[0].topReps === 5)
  check('volume sums ALL included sets (warmup excluded), not just the top one',
    p1[0].volume === 100 * 5 + 90 * 8)

  // A dropset can't outrank the heavier set that precedes it (real case: same session).
  const sets2 = [
    mk({ weight_kg: 100, reps: 5 }),
    mk({ set_type: 'dropset', weight_kg: 70, reps: 8 }),
  ]
  const p2 = computeExerciseProgression(sets2, T, 'est1rm')
  check('a dropset (lighter, by construction) never wins the top-set selection', p2[0].topWeightKg === 100)

  // A failure set IS eligible to be the top set (est1RM(100,5)=116.7 <
  // est1RM(110,5)=128.3 — a genuinely higher estimate, not just heavier).
  const sets3 = [
    mk({ weight_kg: 100, reps: 5 }),
    mk({ set_type: 'failure', weight_kg: 110, reps: 5 }),
  ]
  const p3 = computeExerciseProgression(sets3, T, 'est1rm')
  check('a failure set can win the top-set selection (a real top effort)', p3[0].topWeightKg === 110)

  // Assisted exercise: LESS assistance is the improvement -> selection picks the lightest assist weight.
  const sets4 = [
    mk({ weight_kg: 20, reps: 8 }), // 20kg of assistance
    mk({ weight_kg: 10, reps: 6 }), // less assistance = harder = "best"
  ]
  const p4 = computeExerciseProgression(sets4, T, 'assistedWeight')
  check('assisted-exercise selection picks the LEAST assistance as the top set', p4[0].topWeightKg === 10)

  // Multiple sessions sort by date.
  const sets5 = [
    mk({ workout_id: 'w2', date: '2026-08-08', weight_kg: 105, reps: 5 }),
    mk({ workout_id: 'w1', date: '2026-08-01', weight_kg: 100, reps: 5 }),
  ]
  const p5 = computeExerciseProgression(sets5, T, 'est1rm')
  check('sessions are sorted oldest-first', p5[0].date === '2026-08-01' && p5[1].date === '2026-08-08')

  // A different exercise's sets are never mixed in.
  const sets6 = [mk({ weight_kg: 100, reps: 5 }), mk({ exercise_template_id: 'other', weight_kg: 999, reps: 1 })]
  const p6 = computeExerciseProgression(sets6, T, 'est1rm')
  check('a different exercise_template_id is never included', p6.length === 1 && p6[0].topWeightKg === 100)
}

console.log('\n== 4. repRangeVariedSignificantly ==')
{
  const pts = (reps) => reps.map(r => ({ date: '2026-01-01', topValue: 1, volume: 1, topWeightKg: 1, topReps: r }))
  check('a consistent rep range (3 reps apart) does NOT trigger the caveat', repRangeVariedSignificantly(pts([5, 6, 8])) === false)
  check('a rep range that swings ≥4 DOES trigger the caveat', repRangeVariedSignificantly(pts([5, 12])) === true)
  check('fewer than 2 data points never triggers it', repRangeVariedSignificantly(pts([5])) === false)
}

console.log('\n== 5. computeWeeklyVolumeTrend ==')
{
  const templates = [
    { id: 'a', type: 'weight_reps' },
    { id: 'b', type: 'bodyweight_reps' }, // no weight-based tonnage — must be excluded
  ]
  const sets = [
    { workout_id: 'w1', date: '2026-08-03', exercise_template_id: 'a', set_type: 'normal', weight_kg: 100, reps: 5, duration_seconds: null, distance_meters: null },
    { workout_id: 'w1', date: '2026-08-03', exercise_template_id: 'a', set_type: 'warmup', weight_kg: 999, reps: 99, duration_seconds: null, distance_meters: null },
    { workout_id: 'w1', date: '2026-08-03', exercise_template_id: 'b', set_type: 'normal', weight_kg: 80, reps: 10, duration_seconds: null, distance_meters: null },
  ]
  const weeks = computeWeeklyVolumeTrend(sets, templates)
  check('exactly one week produced', weeks.length === 1)
  check('warmup excluded and non-tonnage exercise type excluded — only the 100x5 set counts',
    weeks[0].tonnageKg === 500, String(weeks[0]?.tonnageKg))
}

console.log('\n== 6. rollingAverage ==')
{
  const pts = [10, 20, 30, 40, 50].map((tonnageKg, i) => ({ weekStart: `w${i}`, tonnageKg }))
  const avg = rollingAverage(pts, 3)
  check('nulls before the window fills', avg[0] === null && avg[1] === null)
  check('first full window is the mean of the first 3', avg[2] === 20)
  check('window slides correctly', avg[3] === 30 && avg[4] === 40)
}

console.log('\n== 7. computeConsistencyByWeek / currentStreakWeeks ==')
{
  const sets = [
    { workout_id: 'w1', date: '2026-08-03', exercise_template_id: 'a', set_type: 'normal', weight_kg: 1, reps: 1, duration_seconds: null, distance_meters: null },
    { workout_id: 'w2', date: '2026-08-05', exercise_template_id: 'a', set_type: 'normal', weight_kg: 1, reps: 1, duration_seconds: null, distance_meters: null },
    { workout_id: 'w2', date: '2026-08-05', exercise_template_id: 'b', set_type: 'normal', weight_kg: 1, reps: 1, duration_seconds: null, distance_meters: null }, // same workout, must not double-count
    { workout_id: 'w3', date: '2026-08-17', exercise_template_id: 'a', set_type: 'normal', weight_kg: 1, reps: 1, duration_seconds: null, distance_meters: null }, // a week with a gap before it
  ]
  const weeks = computeConsistencyByWeek(sets)
  check('DENSE series: 3 weeks (03 Aug, the untrained 10 Aug gap week, 17 Aug) — not just the 2 weeks with data',
    weeks.length === 3, JSON.stringify(weeks))
  check('the gap week (10 Aug) is explicitly zero, not simply absent', weeks[1].sessionCount === 0)
  check('the first week counts 2 DISTINCT workouts, not 3 set rows', weeks[0].sessionCount === 2)
  check('current streak is 1 (the most recent week has a session, but the week before it has none)',
    currentStreakWeeks(weeks, 1) === 1)
  check('a stricter minSessions=2 threshold breaks the streak (last week only had 1 session)',
    currentStreakWeeks(weeks, 2) === 0)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
