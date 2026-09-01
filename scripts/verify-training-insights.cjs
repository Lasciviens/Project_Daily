#!/usr/bin/env node
/*
 * Verification — Training "Analysis" panel pure helpers (trainingInsights.ts),
 * added from a sports-scientist agent review (2026-09-01) after the user
 * explicitly asked for a written "what am I doing well/poorly" analysis, not
 * more charts.
 *
 * Proves, against the REAL un-mocked module (loaded via sucrase — no unit
 * test runner by this repo's convention):
 *   1. lastCompleteWeek — the current partial week is excluded.
 *   2. computeConsistencyFindings — strong/gap/dropped-frequency triggers.
 *   3. computeVolumeFindings — up/down/flat trend vs 8 weeks earlier.
 *   4. computeMuscleFindings — zero-sets, persistently-under-MEV,
 *      persistently-over-MRV.
 *   5. computeRepRangeFindings — concentration + no-heavy-work gap.
 *   6. computeRelativeStrengthFindings — the bodyweight-attribution rule
 *      (ratio moved because bodyweight moved, not strength) and the
 *      insufficient-bodyweight-data null case.
 *   7. computeExerciseTrendFindings — progressing/stalled/regressing, and
 *      the rep-range-varied skip.
 *   8. sortFindings — measured before evidence-based before heuristic.
 *
 *   Run:  node scripts/verify-training-insights.cjs
 */
require('sucrase/register')

const {
  lastCompleteWeek, computeConsistencyFindings, computeVolumeFindings, computeMuscleFindings,
  computeRepRangeFindings, computeRelativeStrengthFindings, computeExerciseTrendFindings, sortFindings,
} = require('../src/features/training/trainingInsights')
const { mondayOf } = require('../src/features/training/progressAggregate')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function shiftWeek(weekStart, n) { return addDays(weekStart, n * 7) }

console.log('\n== 1. lastCompleteWeek ==')
{
  const today = '2026-09-01' // a Tuesday
  const current = mondayOf(today)
  check('the current (partial) week is excluded — returns the week before it', lastCompleteWeek(today) === shiftWeek(current, -1))
}

console.log('\n== 2. computeConsistencyFindings ==')
{
  const today = '2026-09-01'
  const last = lastCompleteWeek(today)
  const mk = (offset, sessionCount) => ({ weekStart: shiftWeek(last, -offset), sessionCount })

  // 8 strong weeks: trained in all 8, median 3/week.
  const strongWeeks = Array.from({ length: 8 }, (_, i) => mk(7 - i, 3)).reverse().sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const strong = computeConsistencyFindings(strongWeeks, today)
  check('a consistently-trained window produces the positive "strong" finding', strong.some(f => f.id === 'consistency-strong' && f.positive === true), JSON.stringify(strong.map(f => f.id)))

  // 12 weeks with 3 fully-untrained gaps.
  const gapWeeks = Array.from({ length: 12 }, (_, i) => mk(11 - i, i % 4 === 0 ? 0 : 2))
  const gaps = computeConsistencyFindings(gapWeeks, today)
  check('>=3 untrained weeks in the last 12 triggers the gap finding', gaps.some(f => f.id === 'consistency-gaps' && f.positive === false))

  // Frequency dropped: 8 prior weeks at 3/wk, last 4 at 1/wk (well under 60%).
  const droppedWeeks = [
    ...Array.from({ length: 8 }, (_, i) => mk(11 - i, 3)),
    ...Array.from({ length: 4 }, (_, i) => mk(3 - i, 1)),
  ]
  const dropped = computeConsistencyFindings(droppedWeeks, today)
  check('a real frequency collapse (<60% of the prior 8-week mean) is flagged', dropped.some(f => f.id === 'consistency-dropped'))

  check('no weeks at all -> no findings, not a crash', computeConsistencyFindings([], today).length === 0)
}

console.log('\n== 3. computeVolumeFindings ==')
{
  const today = '2026-09-01'
  const last = lastCompleteWeek(today)
  // 12 weeks of history: first 4 weeks at 10,000kg, last 4 weeks at 15,000kg (+50%, clearly >=15%).
  const weeks = []
  for (let i = 11; i >= 4; i--) weeks.push({ weekStart: shiftWeek(last, -i), tonnageKg: 10000 })
  for (let i = 3; i >= 0; i--) weeks.push({ weekStart: shiftWeek(last, -i), tonnageKg: 15000 })
  const up = computeVolumeFindings(weeks, today)
  check('a sustained tonnage rise (>=15% vs 8 weeks back) is flagged positive', up.some(f => f.id === 'volume-up' && f.positive === true), JSON.stringify(up))

  const flatWeeks = Array.from({ length: 12 }, (_, i) => ({ weekStart: shiftWeek(last, -(11 - i)), tonnageKg: 10000 + (i % 2) * 200 }))
  const flat = computeVolumeFindings(flatWeeks, today)
  check('near-identical tonnage across the window is flagged flat, not up/down', flat.some(f => f.id === 'volume-flat'))

  check('not enough history (<12 weeks back) -> no finding', computeVolumeFindings([{ weekStart: last, tonnageKg: 5000 }], today).length === 0)
}

console.log('\n== 4. computeMuscleFindings ==')
{
  const today = '2026-09-01'
  const last = lastCompleteWeek(today)
  const landmarks = { mv: 6, mev: 8, mav: 20, mrv: 22 }

  const zero = computeMuscleFindings([{ slug: 'calves', label: 'Calves', weekly: [], landmarks }], today)
  check('zero sets across all 8 weeks -> the zero-sets finding, tier measured', zero.some(f => f.id === 'muscle-zero-Calves' && f.tier === 'measured'))

  const underWeekly = Array.from({ length: 8 }, (_, i) => ({ weekStart: shiftWeek(last, -i), sets: 3 })) // well under mev=8
  const under = computeMuscleFindings([{ slug: 'hamstring', label: 'Hamstrings', weekly: underWeekly, landmarks }], today)
  check('persistently under MEV -> the under-MEV finding, tier heuristic', under.some(f => f.id === 'muscle-under-Hamstrings' && f.tier === 'heuristic'))

  const overWeekly = Array.from({ length: 8 }, (_, i) => ({ weekStart: shiftWeek(last, -i), sets: 30 })) // well over mrv=22
  const over = computeMuscleFindings([{ slug: 'deltoids', label: 'Shoulders', weekly: overWeekly, landmarks }], today)
  check('persistently over MRV -> the over-MRV finding, positive=null (not asserted harmful)', over.some(f => f.id === 'muscle-over-Shoulders' && f.positive === null))

  const inRangeWeekly = Array.from({ length: 8 }, (_, i) => ({ weekStart: shiftWeek(last, -i), sets: 14 })) // inside mev-mav
  const inRange = computeMuscleFindings([{ slug: 'chest', label: 'Chest', weekly: inRangeWeekly, landmarks }], today)
  check('a muscle inside its MEV-MAV band produces no finding at all (no news is not bad news)', inRange.length === 0)
}

console.log('\n== 5. computeRepRangeFindings ==')
{
  const buckets = (counts) => ['1-5', '6-12', '13-20', '21-30', '31+'].map((key, i) => ({ key, label: key, count: counts[i] }))

  const concentrated = computeRepRangeFindings(buckets([5, 90, 5, 0, 0])) // 90% in one bucket, total 100
  check('a single bucket >=70% of sets triggers the concentration finding', concentrated.some(f => f.id === 'rep-range-concentration'))

  const noHeavy = computeRepRangeFindings(buckets([0, 60, 40, 0, 0])) // total 100, zero 1-5
  check('zero sets in 1-5 with >=100 total sets triggers the no-heavy-work gap', noHeavy.some(f => f.id === 'rep-range-no-heavy' && f.positive === false))

  check('fewer than 50 total sets -> no findings (too little data to describe a shape)', computeRepRangeFindings(buckets([5, 10, 5, 0, 0])).length === 0)
}

console.log('\n== 6. computeRelativeStrengthFindings ==')
{
  const nullCase = computeRelativeStrengthFindings([{ title: 'Squat', points: [] }], 1)
  check('fewer than 3 bodyweight anchors -> the global insufficient-data finding, no per-exercise attempt', nullCase.length === 1 && nullCase[0].id === 'relative-strength-null')

  // Ratio rose because bodyweight fell, est1RM barely moved -> the attribution finding.
  const points = [
    { date: '2026-06-01', ratio: 1.20, est1rmValue: 100, bodyweightKg: 83, estimated: false },
    { date: '2026-06-08', ratio: 1.20, est1rmValue: 100, bodyweightKg: 83, estimated: false },
    { date: '2026-06-15', ratio: 1.21, est1rmValue: 101, bodyweightKg: 83.5, estimated: false },
    { date: '2026-07-20', ratio: 1.28, est1rmValue: 101, bodyweightKg: 79, estimated: true },
    { date: '2026-08-01', ratio: 1.28, est1rmValue: 101, bodyweightKg: 79, estimated: true },
    { date: '2026-08-15', ratio: 1.29, est1rmValue: 101, bodyweightKg: 78.5, estimated: false },
  ]
  const attribution = computeRelativeStrengthFindings([{ title: 'Bench Press', points }], 5)
  check('ratio up but est1RM flat + bodyweight down -> attributed to bodyweight, not strength',
    attribution.some(f => f.id === 'rel-strength-bw-Bench Press'), JSON.stringify(attribution))

  // Real gain: both ratio and absolute est1RM rise meaningfully, bodyweight flat.
  const gainPoints = points.map((p, i) => ({ ...p, est1rmValue: 100 + i * 3, ratio: (100 + i * 3) / 82, bodyweightKg: 82 }))
  const gain = computeRelativeStrengthFindings([{ title: 'Squat', points: gainPoints }], 5)
  check('both ratio and absolute est1RM rise -> the real-strength-gain finding', gain.some(f => f.id === 'rel-strength-gain-Squat' && f.positive === true))
}

console.log('\n== 7. computeExerciseTrendFindings ==')
{
  const mk = (v, date) => ({ date, topValue: v, volume: null, topWeightKg: v, topReps: 5 })
  const dates = ['2026-06-01', '2026-06-15', '2026-07-01', '2026-07-15', '2026-08-01', '2026-08-15']

  const progressing = computeExerciseTrendFindings([{ title: 'Deadlift', points: dates.map((d, i) => mk(100 + i * 5, d)), repRangeVaried: false, unit: 'kg' }])
  check('a clear rise across sessions -> progressing', progressing.some(f => f.id === 'exercise-progressing-Deadlift' && f.positive === true))

  const stalled = computeExerciseTrendFindings([{ title: 'Overhead Press', points: dates.map(d => mk(61, d)), repRangeVaried: false, unit: 'kg' }])
  check('an unchanged top-set value -> stalled, positive=null', stalled.some(f => f.id === 'exercise-stalled-Overhead Press' && f.positive === null))

  const regressing = computeExerciseTrendFindings([{ title: 'Lat Pulldown', points: dates.map((d, i) => mk(70 - i * 2, d)), repRangeVaried: false, unit: 'kg' }])
  check('a clear fall across sessions -> regressing', regressing.some(f => f.id === 'exercise-regressing-Lat Pulldown' && f.positive === false))

  const varied = computeExerciseTrendFindings([{ title: 'Bench Press', points: dates.map((d, i) => mk(100 + i * 5, d)), repRangeVaried: true, unit: 'kg' }])
  check('repRangeVaried=true skips the verdict but still renders an explicit "can\'t assess" line (NEVER_HIDES)',
    varied.length === 1 && varied[0].id === 'exercise-varied-Bench Press' && varied[0].positive === null)

  check('too few sessions -> no finding at all', computeExerciseTrendFindings([{ title: 'New Move', points: [mk(50, '2026-08-01'), mk(52, '2026-08-08')], repRangeVaried: false, unit: 'kg' }]).length === 0)
}

console.log('\n== 8. sortFindings ==')
{
  const mixed = [
    { id: 'h', tier: 'heuristic', positive: null, text: '' },
    { id: 'm', tier: 'measured', positive: null, text: '' },
    { id: 'e', tier: 'evidence', positive: null, text: '' },
  ]
  const sorted = sortFindings(mixed)
  check('measured -> evidence-based -> heuristic, in that order', sorted.map(f => f.id).join(',') === 'm,e,h')
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
