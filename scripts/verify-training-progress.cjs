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
 * Follow-up review (2026-08-31) — three originally-deferred charts plus each
 * agent's own top "extra" recommendation:
 *   8. resolveBodyweightForDate / computeRelativeStrengthTrend — the
 *      interpolate/nearest-within-14-days/no-extrapolation-before-history
 *      ladder, and est1rm-only eligibility.
 *   9. computeRepRangeDistribution — bucket boundaries, warmup exclusion,
 *      dropset/failure inclusion, muscle-group filtering.
 *  10. computeWeeklyChangeFlags — new-exercise detection, load/volume median
 *      comparison, the minimum-prior-weeks gate.
 *  11. computeWeeklySetsPerMuscleTrend — primary+secondary credit via the
 *      same contribution() seam the Muscles tab uses.
 *  12. recoveryAggregate.ts — weekly sleep/resting-HR aggregation and the
 *      minimum-nights/days-per-week gate.
 *
 *   Run:  node scripts/verify-training-progress.cjs
 */
require('sucrase/register')

const {
  est1RM, metricKindForExerciseType, computeExerciseProgression, repRangeVariedSignificantly,
  computeWeeklyVolumeTrend, rollingAverage, computeConsistencyByWeek, currentStreakWeeks,
  resolveBodyweightForDate, computeRelativeStrengthTrend, indexRelativeStrengthTrend, REP_BUCKETS, computeRepRangeDistribution,
  computeWeeklyChangeFlags, computeWeeklySetsPerMuscleTrend, mondayOf,
} = require('../src/features/training/progressAggregate')
const { computeWeeklySleepTrend, computeWeeklyRestingHRTrend } = require('../src/features/training/recoveryAggregate')
const { fmtWeekRange } = require('../src/features/training/dateFormat')

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

  // Dense-series fix (sports-scientist review, 2026-09-01): a gap week
  // between two tonnage weeks must appear as an explicit zero, not be
  // skipped — otherwise rollingAverage silently averages array ENTRIES
  // instead of calendar WEEKS.
  const denseSets = [
    { workout_id: 'w1', date: '2026-08-03', exercise_template_id: 'a', set_type: 'normal', weight_kg: 100, reps: 5, duration_seconds: null, distance_meters: null },
    { workout_id: 'w2', date: '2026-08-17', exercise_template_id: 'a', set_type: 'normal', weight_kg: 100, reps: 5, duration_seconds: null, distance_meters: null },
  ]
  const denseWeeks = computeWeeklyVolumeTrend(denseSets, templates)
  check('a gap week between two tonnage weeks is a dense, explicit zero entry — not skipped',
    denseWeeks.length === 3 && denseWeeks[1].tonnageKg === 0, JSON.stringify(denseWeeks))
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

console.log('\n== 7b. fmtWeekRange (dateFormat.ts) ==')
{
  // Real user confusion (2026-09-01): a weekly chart's tooltip showed a bare
  // single date, ambiguous about whether it's the week's start, end, or the
  // day something happened. Every weekly-chart tooltip now shows this range.
  check('a Monday weekStart formats as its own Mon-Sun range', fmtWeekRange('2026-08-03') === '3 Aug – 9 Aug', fmtWeekRange('2026-08-03'))
  check('a range spanning a month boundary names both months', fmtWeekRange('2026-07-28') === '28 Jul – 3 Aug', fmtWeekRange('2026-07-28'))
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

console.log('\n== 8. resolveBodyweightForDate / computeRelativeStrengthTrend ==')
{
  const anchors = [{ date: '2026-07-01', kg: 80 }, { date: '2026-07-15', kg: 78 }]
  const exact = resolveBodyweightForDate('2026-07-01', anchors)
  check('exact same-day match is NOT estimated', exact.kg === 80 && exact.estimated === false)

  const mid = resolveBodyweightForDate('2026-07-08', anchors) // exactly halfway, 14-day bracket
  check('interpolates linearly between two anchors ≤21 days apart', mid.kg === 79 && mid.estimated === true, JSON.stringify(mid))

  const wideAnchors = [{ date: '2026-06-01', kg: 82 }, { date: '2026-08-01', kg: 75 }] // 61 days apart
  const nearSide = resolveBodyweightForDate('2026-06-05', wideAnchors) // 4 days from the near anchor
  check('bracket too wide (>21d) falls back to nearest-within-14', nearSide && nearSide.kg === 82 && nearSide.estimated === true)
  const noSide = resolveBodyweightForDate('2026-07-10', wideAnchors) // ~39d / ~22d from either anchor
  check('no anchor within 14 days and bracket too wide -> null, never a guess', noSide === null)

  const beforeHistory = resolveBodyweightForDate('2026-05-01', [{ date: '2026-07-01', kg: 80 }]) // 61 days before the only anchor
  check('far before the only anchor -> null (never extrapolate across a large gap)', beforeHistory === null)

  check('no anchors at all -> null', resolveBodyweightForDate('2026-07-01', []) === null)

  const points = [
    { date: '2026-07-01', topValue: 100, volume: 500, topWeightKg: 100, topReps: 5 },
    { date: '2026-07-08', topValue: 105, volume: 525, topWeightKg: 105, topReps: 5 },
    { date: '2026-09-01', topValue: 110, volume: 550, topWeightKg: 110, topReps: 5 }, // no nearby bodyweight
  ]
  const trend = computeRelativeStrengthTrend(points, anchors)
  check('sessions with no usable nearby bodyweight are DROPPED, not guessed', trend.length === 2)
  check('ratio = est1RM ÷ resolved bodyweight, rounded to 2dp', trend[0].ratio === 1.25 && trend[0].bodyweightKg === 80)
  check('the interpolated point is flagged estimated', trend[1].estimated === true)

  // indexRelativeStrengthTrend — both series rebased to 100 at the FIRST point.
  const indexed = indexRelativeStrengthTrend(trend)
  check('the first point is always indexed to exactly 100 on both series', indexed[0].strengthIndex === 100 && indexed[0].bodyweightIndex === 100)
  const expectedStrengthIndex = Math.round((trend[1].est1rmValue / trend[0].est1rmValue) * 1000) / 10
  check('a later point is indexed proportionally to the first point\'s raw value', indexed[1].strengthIndex === expectedStrengthIndex, JSON.stringify(indexed))
  check('estimated flag carries through unchanged', indexed[1].estimated === trend[1].estimated)
  check('an empty input produces an empty output, not a crash', indexRelativeStrengthTrend([]).length === 0)
}

console.log('\n== 9. computeRepRangeDistribution ==')
{
  check('bucket boundaries are 1-5 / 6-12 / 13-20 / 21-30 / 31+ (sports-scientist review, not the coach\'s original 6-8/9-12 split)',
    REP_BUCKETS.map(b => b.key).join(',') === '1-5,6-12,13-20,21-30,31+')

  const mk = (over) => ({ workout_id: 'w1', date: '2026-08-01', exercise_template_id: 't1', set_type: 'normal', weight_kg: 1, reps: null, duration_seconds: null, distance_meters: null, ...over })
  const sets = [
    mk({ set_type: 'warmup', reps: 3 }),          // excluded — warmup
    mk({ reps: 5 }),                              // 1-5
    mk({ reps: 8 }),                              // 6-12
    mk({ set_type: 'dropset', reps: 15 }),        // 13-20 — dropsets DO count
    mk({ set_type: 'failure', reps: 25 }),        // 21-30 — failure sets DO count
    mk({ reps: 40 }),                             // 31+
    mk({ reps: null, duration_seconds: 60 }),     // excluded — no rep count (duration-type)
    mk({ exercise_template_id: 't2', reps: 8 }),  // different exercise
  ]
  const dist = computeRepRangeDistribution(sets)
  const byKey = Object.fromEntries(dist.map(d => [d.key, d.count]))
  check('warmup excluded', byKey['1-5'] === 1)
  check('dropset counted', byKey['13-20'] === 1)
  check('failure set counted', byKey['21-30'] === 1)
  check('reps=null (duration-type) excluded', dist.reduce((a, b) => a + b.count, 0) === 6)

  const filtered = computeRepRangeDistribution(sets, new Set(['t1']))
  check('templateIds filter narrows to one exercise', filtered.reduce((a, b) => a + b.count, 0) === 5)
}

console.log('\n== 10. computeWeeklyChangeFlags ("Big changes this week") ==')
{
  const today = '2026-08-31'
  const thisWeek = mondayOf(today)
  const w1 = addDays(thisWeek, -7)
  const w2 = addDays(thisWeek, -14)
  const w3 = addDays(thisWeek, -21)
  const templates = [{ id: 'squat', type: 'weight_reps' }, { id: 'new-move', type: 'weight_reps' }]

  const mkSet = (tid, date, weight, reps) => ({ workout_id: 'w', date, exercise_template_id: tid, set_type: 'normal', weight_kg: weight, reps, duration_seconds: null, distance_meters: null })

  const sets = [
    // squat: steady ~100kg x5 for 3 prior weeks, then a real jump this week
    mkSet('squat', w3, 100, 5), mkSet('squat', w3, 100, 5),
    mkSet('squat', w2, 100, 5), mkSet('squat', w2, 100, 5),
    mkSet('squat', w1, 102, 5), mkSet('squat', w1, 102, 5),
    mkSet('squat', thisWeek, 115, 5), mkSet('squat', thisWeek, 115, 5), // +~13% load vs median ~101
    // new-move: only trained this week -> should flag 'new'
    mkSet('new-move', thisWeek, 40, 8),
  ]
  const flags = computeWeeklyChangeFlags(sets, templates, today)
  const bySquat = flags.filter(f => f.templateId === 'squat')
  const byNew = flags.filter(f => f.templateId === 'new-move')

  check('a never-trained-before exercise is flagged "new" unconditionally', byNew.length === 1 && byNew[0].kind === 'new')
  check('a real top-set load jump (>=10% vs 4-wk median) is flagged "load"', bySquat.some(f => f.kind === 'load'))
  check('an exercise with too little prior history (<3 weeks) produces no load/volume flag',
    computeWeeklyChangeFlags(
      [mkSet('brandnew', w1, 50, 5), mkSet('brandnew', thisWeek, 80, 5)], // only 1 prior week
      [{ id: 'brandnew', type: 'weight_reps' }], today,
    ).every(f => f.kind === 'new' || f.templateId !== 'brandnew'))

  const noChangeSets = [
    mkSet('flat', w3, 100, 5), mkSet('flat', w2, 100, 5), mkSet('flat', w1, 100, 5), mkSet('flat', thisWeek, 101, 5),
  ]
  const flatFlags = computeWeeklyChangeFlags(noChangeSets, [{ id: 'flat', type: 'weight_reps' }], today)
  check('a steady exercise with no real jump produces no flag', flatFlags.length === 0, JSON.stringify(flatFlags))
}

console.log('\n== 11. computeWeeklySetsPerMuscleTrend ==')
{
  const contributionFn = (_id, _slug, role) => (role === 'primary' ? 1 : 0.5)
  const templateMuscles = new Map([
    ['bench', { primarySlug: 'chest', secondarySlugs: ['triceps'] }],
    ['fly',   { primarySlug: 'chest', secondarySlugs: [] }],
  ])
  const mk = (tid, date, type = 'normal') => ({ workout_id: 'w', date, exercise_template_id: tid, set_type: type, weight_kg: 1, reps: 1, duration_seconds: null, distance_meters: null })
  const sets = [
    mk('bench', '2026-08-03'), mk('bench', '2026-08-03', 'warmup'), // warmup excluded
    mk('fly', '2026-08-03'),
    mk('bench', '2026-08-10'),
  ]
  const chest = computeWeeklySetsPerMuscleTrend(sets, templateMuscles, 'chest', contributionFn)
  check('two weeks produced', chest.length === 2)
  check('primary credit only (1.0) for bench + fly the first week, warmup excluded', chest[0].sets === 2, JSON.stringify(chest))

  const triceps = computeWeeklySetsPerMuscleTrend(sets, templateMuscles, 'triceps', contributionFn)
  check('secondary credit (0.5) for a muscle only trained indirectly, both weeks bench appears',
    triceps.length === 2 && triceps.every(w => w.sets === 0.5), JSON.stringify(triceps))
}

console.log('\n== 12. recoveryAggregate — weekly sleep / resting-HR gating ==')
{
  const week = mondayOf('2026-08-03')
  const nights = (n, hours) => Array.from({ length: n }, (_, i) => ({ date: addDays(week, i), core: 0, rem: 0, deep: 0, awake: 0, total: hours }))
  const fullWeek = computeWeeklySleepTrend(nights(5, 7))
  check('5 tracked nights -> a real average is shown', fullWeek[0].avgHours === 7 && fullWeek[0].nights === 5)

  const sparseWeek = computeWeeklySleepTrend(nights(2, 7))
  check('fewer than 4 nights -> null, not a misleading partial average', sparseWeek[0].avgHours === null && sparseWeek[0].nights === 2)

  const days = (n, bpm) => Array.from({ length: n }, (_, i) => ({ date: addDays(week, i), value: bpm }))
  const fullRhr = computeWeeklyRestingHRTrend(days(5, 60))
  check('5 tracked days -> a real median is shown', fullRhr[0].medianBpm === 60)
  const sparseRhr = computeWeeklyRestingHRTrend(days(3, 60))
  check('fewer than 4 days -> null', sparseRhr[0].medianBpm === null)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
