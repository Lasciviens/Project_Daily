#!/usr/bin/env node
/*
 * Verification — healthTrendStats.ts (the Health page's change over the
 * picked period, weekly rate, best/worst week, variability, weekly totals,
 * wake-time spread, the bed-and-wake rows, usual ranges and the
 * overnight-vitals status) and benchmarks/referenceLadder.ts.
 * Runs the real modules through sucrase (no test framework, per AGENTS.md).
 *
 * Run: node scripts/verify-health-trend-stats.cjs
 */
require('sucrase/register')
const T = require('../src/features/health/healthTrendStats.ts')
const { referenceLadder } = require('../src/features/health/benchmarks/referenceLadder.ts')
const { classify } = require('../src/features/health/benchmarks/healthBenchmarks.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
const r1 = n => (n == null ? n : Math.round(n * 10) / 10)
const r2 = n => (n == null ? n : Math.round(n * 100) / 100)

/** A dense daily series ending on `to`, value = fn(i) for i days back (0 = to). */
function series(to, days, fn) {
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const v = fn(i)
    if (v != null) out.push({ date: addDays(to, -i), value: v })
  }
  return out
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const TO = '2026-09-27' // a Sunday

// ─── §1 movingAverageAt ──────────────────────────────────────────────────────
const flat = series(TO, 200, () => 10)
check('§1.1 flat series averages to itself', T.movingAverageAt(flat, TO, 7), 10)
check('§1.2 no readings → null', T.movingAverageAt([], TO, 7), null)
check('§1.3 minPoints not met → null', T.movingAverageAt([{ date: TO, value: 5 }], TO, 7, { minPoints: 2 }), null)
check('§1.4 exclude drops a day', T.movingAverageAt([{ date: TO, value: 100 }, { date: addDays(TO, -1), value: 4 }], TO, 7, { exclude: TO }), 4)

// ─── §2 periodChange ─────────────────────────────────────────────────────────
// Last 7 days = 12, the 7 before = 10.
const step = series(TO, 60, i => (i < 7 ? 12 : 10))
const c7 = T.periodChange(step, { to: TO, days: 7 })
check('§2.1 7-day current', c7.current, 12)
check('§2.2 7-day previous', c7.previous, 10)
check('§2.3 7-day delta', c7.delta, 2)
check('§2.4 7-day delta %', c7.deltaPct, 20)
check('§2.5 counts', [c7.nCurrent, c7.nPrevious], [7, 7])
const c30 = T.periodChange(step, { to: TO, days: 30 })
check('§2.6 30-day current mixes both levels', r2(c30.current), r2((7 * 12 + 23 * 10) / 30))
check('§2.7 30-day previous', c30.previous, 10)
check('§2.8 too few readings on one side → null delta',
  T.periodChange([{ date: TO, value: 1 }], { to: TO, days: 30 }).delta, null)
check('§2.9 an excluded in-progress day never counts',
  T.periodChange([...series(addDays(TO, -1), 14, () => 10), { date: TO, value: 1 }], { to: TO, days: 7, exclude: TO }).current, 10)

// ─── §3 weeklyRate ───────────────────────────────────────────────────────────
// −0.1 kg a day = −0.7 kg/week.
const loss = series(TO, 28, i => 80 + 0.1 * i)
check('§3.1 steady loss → −0.7/week', r2(T.weeklyRate(loss, { to: TO, days: 28 }).perWeek), -0.7)
check('§3.2 too few points → null', T.weeklyRate(loss.slice(-2), { to: TO, days: 28 }), null)
check('§3.3 span under a week → null',
  T.weeklyRate(series(TO, 5, i => 80 + i), { to: TO, days: 28 }), null)
check('§3.4 sparse weigh-ins still give a rate',
  r2(T.weeklyRate([{ date: addDays(TO, -21), value: 82 }, { date: addDays(TO, -14), value: 81.5 }, { date: addDays(TO, -7), value: 81 }, { date: TO, value: 80.5 }], { to: TO, days: 28 }).perWeek), -0.5)

// ─── §4 weeks ────────────────────────────────────────────────────────────────
check('§4.1 mondayOfIso on a Sunday', T.mondayOfIso('2026-09-27'), '2026-09-21')
check('§4.2 mondayOfIso on a Monday', T.mondayOfIso('2026-09-21'), '2026-09-21')
check('§4.3 mondayOfIso across a year', T.mondayOfIso('2027-01-01'), '2026-12-28')
// Weeks: value = 10 + week index back (week containing TO = 0).
const weekly = series(TO, 35, i => 10 + Math.floor(i / 7))
const wb = T.weeklyBuckets(weekly, { from: addDays(TO, -34), to: TO, agg: 'mean' })
check('§4.4 five complete weeks', wb.length, 5)
check('§4.5 week values oldest first', wb.map(w => w.value), [14, 13, 12, 11, 10])
check('§4.6 total agg', T.weeklyBuckets(weekly, { from: addDays(TO, -6), to: TO, agg: 'total' })[0].value, 70)
check('§4.7 a week in progress is left out',
  T.weeklyBuckets(weekly, { from: addDays(TO, -34), to: addDays(TO, -1), agg: 'mean' }).length, 4)
check('§4.8 a week with too few readings is left out',
  T.weeklyBuckets([{ date: TO, value: 1 }, { date: addDays(TO, -1), value: 1 }], { from: addDays(TO, -6), to: TO, agg: 'mean' }).length, 0)
const bw = T.bestWorstWeek(wb, 'up')
check('§4.9 best week (higher is better)', bw.best.value, 14)
check('§4.10 worst week (higher is better)', bw.worst.value, 10)
check('§4.11 lower is better swaps them', T.bestWorstWeek(wb, 'down').best.value, 10)
check('§4.12 one week → no best/worst', T.bestWorstWeek(wb.slice(0, 1), 'up').best, null)

// ─── §5 variability ──────────────────────────────────────────────────────────
// Last 30: alternating 9/11 (sd ~1.02), before: alternating 5/15 (sd ~5.08).
const vary = series(TO, 60, i => (i < 30 ? (i % 2 ? 9 : 11) : (i % 2 ? 5 : 15)))
const v = T.variabilityChange(vary, { to: TO, days: 30 })
check('§5.1 steadier verdict', v.verdict, 'steadier')
check('§5.2 current sd', r2(v.sd), 1.02)
check('§5.3 previous sd', r2(v.previousSd), 5.09)
check('§5.4 reversed → more variable',
  T.variabilityChange(series(TO, 60, i => (i >= 30 ? (i % 2 ? 9 : 11) : (i % 2 ? 5 : 15))), { to: TO, days: 30 }).verdict, 'more variable')
check('§5.5 same spread → similar', T.variabilityChange(series(TO, 60, i => (i % 2 ? 9 : 11)), { to: TO, days: 30 }).verdict, 'similar')
check('§5.6 too few readings → null verdict', T.variabilityChange(flat.slice(-3), { to: TO, days: 30 }).verdict, null)

// ─── §6 buildTrendStats ──────────────────────────────────────────────────────
// The period picked in the range bar is the window: [from, to].
const lift = series(TO, 200, i => 8000 + (i < 7 ? 1000 : 0))
const p90 = { from: addDays(TO, -89), to: TO, direction: 'up' }
const bundle = T.buildTrendStats(lift, p90)
check('§6.1 the change is the picked period against the one before', bundle.change.days, 90)
check('§6.2 90 days: the last week lifts the mean by 7/90 of 1000', r1(bundle.change.delta), r1((7 * 1000) / 90))
check('§6.3 best week is the latest', bundle.best.weekStart, '2026-09-21')
check('§6.4 weeks compared = complete weeks inside the 90 days', bundle.weeksCompared, 12)
const b7 = T.buildTrendStats(lift, { from: addDays(TO, -6), to: TO, direction: 'up' })
check('§6.5 7 days: the change is the last 7 against the 7 before', [b7.change.days, b7.change.delta], [7, 1000])
check('§6.6 7 days: no weekly rate (under 28 days)', b7.rate, null)
check('§6.7 7 days: one complete week → no best/worst', [b7.best, b7.weeksCompared], [null, 1])
const b30 = T.buildTrendStats(lift, { from: addDays(TO, -29), to: TO, direction: 'up' })
check('§6.8 30 days: weeks inside the period only', b30.weeksCompared, 4)
check('§6.9 30 days: the rate covers the period', b30.rate.days, 30)
check('§6.10 30 days: spread compares the period with the 30 days before', b30.variability.days, 30)
const b1 = T.buildTrendStats(lift, { from: TO, to: TO, direction: 'up' })
check('§6.11 one day: that day against the day before', [b1.change.days, b1.change.current, b1.change.previous], [1, 9000, 9000])
check('§6.12 one day in progress (excluded) → no change',
  T.buildTrendStats(lift, { from: TO, to: TO, direction: 'up', exclude: TO }).change.current, null)
const sparse = T.buildTrendStats([{ date: addDays(TO, -20), value: 82 }, { date: addDays(TO, -10), value: 81 }, { date: TO, value: 80 }],
  { from: addDays(TO, -29), to: TO, direction: null, sparse: true })
check('§6.13 sparse weight gives a rate', r2(sparse.rate.perWeek), -0.7)
check('§6.14 excluded today not part of best week',
  T.buildTrendStats(series(TO, 200, i => (i === 0 ? 1 : 10)), { ...p90, exclude: TO }).worst.value, 10)

// ─── §6b weeks of a period, weekly totals ───────────────────────────────────
const TUE = '2026-10-13'
check('§6b.1 7 days → this week and the one before', T.weekStartsFor(TUE, 7), ['2026-10-12', '2026-10-05'])
check('§6b.2 30 days → the 5 weeks it touches', T.weekStartsFor(TUE, 30).length, 5)
const mins = series(TUE, 21, () => 30) // 30 min every day for three weeks
check('§6b.3 week totals, oldest first; the running week counts to `to`',
  T.weekTotals(mins, { weekStarts: ['2026-10-12', '2026-10-05'], to: TUE }).map(w => [w.weekStart, w.value]),
  [['2026-10-05', 210], ['2026-10-12', 60]])
check('§6b.4 a week without readings is dropped (minDays 1)',
  T.weekTotals([], { weekStarts: ['2026-10-12'], to: TUE }), [])
check('§6b.5 …or kept as zero (minDays 0)',
  T.weekTotals([], { weekStarts: ['2026-10-12'], to: TUE, minDays: 0 }).map(w => w.value), [0])
check('§6b.6 weekly figure of a day = that day', T.weeklyTotal(mins, TUE, TUE), 30)
check('§6b.7 weekly figure of 7 days = their total', T.weeklyTotal(mins, addDays(TUE, -6), TUE), 210)
check('§6b.8 weekly figure of 14 days = the average week', T.weeklyTotal(mins, addDays(TUE, -13), TUE), 210)
check('§6b.9 no readings → null', T.weeklyTotal([], addDays(TUE, -6), TUE), null)

// ─── §7 timeOfDaySpread ──────────────────────────────────────────────────────
check('§7.1 identical times → sd 0', T.timeOfDaySpread([420, 420, 420, 420, 420]).sd, 0)
check('§7.2 centre of identical times', T.timeOfDaySpread([420, 420, 420, 420, 420]).center, 420)
const cross = T.timeOfDaySpread([1430, 10, 1430, 10, 1430, 10])
check('§7.3 across midnight: centre near 00:00', cross.center === 0 || cross.center === 1440 - 0, true)
check('§7.4 across midnight: sd ≈ 11 min, not ~12 h', r1(cross.sd), 11)
check('§7.5 ±30 min around 07:00', r1(T.timeOfDaySpread([390, 450, 390, 450, 390, 450]).sd), 32.9)
check('§7.6 fewer than 5 nights → null', T.timeOfDaySpread([420, 430, 440]), null)
check('§7.7 nightBounds', T.nightBounds([{ startMs: 5, endMs: 10 }, { startMs: 1, endMs: 3 }]), { onsetMs: 1, wakeMs: 10 })
check('§7.8 nightBounds empty', T.nightBounds([]), null)
check('§7.9 fmtClock', [T.fmtClock(425), T.fmtClock(0), T.fmtClock(1439.6), T.fmtClock(-10)], ['07:05', '00:00', '00:00', '23:50'])
check('§7.10 clockMean across midnight', T.clockMean([1430, 10]), 0)
check('§7.11 clockMean of nothing', T.clockMean([]), null)

// ─── §7b the bed-and-wake rows follow the period ────────────────────────────
const nightsOf = (to, n) => Array.from({ length: n }, (_, i) => ({ date: addDays(to, -i), onset: i % 2 ? 1430 : 10, wake: 420, asleep: 7 }))
const nights = nightsOf(TO, 400)
check('§7b.1 one day → that night only', T.clockRows(nights, TO, TO).map(r => [r.date, r.unit]), [[TO, 'night']])
check('§7b.2 7 days → 7 nightly rows, oldest first', T.clockRows(nights, addDays(TO, -6), TO).map(r => r.date)[0], addDays(TO, -6))
const wk = T.clockRows(nights, addDays(TO, -29), TO)
// 30 days to Sun 27.09 start on Sat 29.08: that week (24.08–30.08) is clipped to 29.08–30.08.
check('§7b.3 30 days → weekly rows (5, the first clipped to the period)', [wk.length, wk[0].unit, wk[0].date, wk[0].until], [5, 'week', addDays(TO, -29), '2026-08-30'])
// Four nights at 23:50 and three at 00:10 average to 23:59, not ~12:00.
check('§7b.4 a weekly row averages its nights across midnight', [wk[1].onset, wk[1].wake, wk[1].nights, wk[1].asleep], [1439, 420, 7, 7])
const mo = T.clockRows(nights, addDays(TO, -364), TO)
check('§7b.5 1 year → monthly rows', [mo.length, mo[0].unit, mo.at(-1).date, mo.at(-1).until], [13, 'month', '2026-09-01', TO])
check('§7b.6 90 days → weekly', T.clockRowUnit(90), 'week')
check('§7b.7 nights outside the period are left out', T.clockRows(nights, addDays(TO, 10), addDays(TO, 12)), [])

// ─── §8 usual range + vitals ─────────────────────────────────────────────────
const hrv = [40, 50, 40, 50, 40, 50, 40, 50, 40, 50]
const rSd = T.usualRange(hrv, { mode: 'sd', k: 1 })
check('§8.1 sd range centre', rSd.center, 45)
check('§8.2 sd range width', r2(rSd.high - rSd.low), r2(2 * 5.27))
check('§8.3 minHalfWidth widens a steady metric', T.usualRange(Array(10).fill(96), { mode: 'sd', k: 2, minHalfWidth: 1 }).low, 95)
check('§8.4 median range', T.usualRange([14, 15, 15, 16, 15, 14, 16, 15, 15, 15], { mode: 'median', halfWidth: 1.5 }), { low: 13.5, high: 16.5, center: 15, n: 10 })
check('§8.5 too few readings → null', T.usualRange([1, 2, 3], { mode: 'sd', k: 1 }), null)
check('§8.6 states', [T.vitalState(60, rSd), T.vitalState(30, rSd), T.vitalState(45, rSd), T.vitalState(null, rSd), T.vitalState(45, null)],
  ['above', 'below', 'inside', 'unknown', 'unknown'])
check('§8.7 all inside', T.summarizeVitals([{ label: 'HRV', state: 'inside' }, { label: 'SpO₂', state: 'inside' }, { label: 'Temp', state: 'unknown' }]),
  { checked: 2, outside: [], better: [], tone: 'success', text: 'All 2 in your usual range' })
check('§8.8 one outside → neutral', T.summarizeVitals([{ label: 'HRV', state: 'below' }, { label: 'SpO₂', state: 'inside' }]).tone, 'neutral')
check('§8.9 two outside → warn and named', T.summarizeVitals([{ label: 'HRV', state: 'below' }, { label: 'Resp', state: 'above' }, { label: 'SpO₂', state: 'inside' }]),
  { checked: 3, outside: ['HRV', 'Resp'], better: [], tone: 'warn', text: '2 of 3 outside your usual range' })
check('§8.10 nothing known', T.summarizeVitals([{ label: 'HRV', state: 'unknown' }]).tone, null)
check('§8.11 HRV above its range (good direction) is not a warning sign',
  T.summarizeVitals([{ label: 'HRV', state: 'above', good: 'above' }, { label: 'SpO₂', state: 'inside' }]),
  { checked: 2, outside: [], better: ['HRV'], tone: 'success', text: 'All 2 in your usual range or better' })
check('§8.12 HRV above + one other off → one outside, neutral (never "two off together")',
  T.summarizeVitals([{ label: 'HRV', state: 'above', good: 'above' }, { label: 'Wrist temperature', state: 'above' }, { label: 'SpO₂', state: 'inside' }]),
  { checked: 3, outside: ['Wrist temperature'], better: ['HRV'], tone: 'neutral', text: '1 of 3 outside your usual range' })
check('§8.13 HRV BELOW its range still counts', T.summarizeVitals([{ label: 'HRV', state: 'below', good: 'above' }]).outside, ['HRV'])

// ─── §9 referenceLadder agrees with classify ─────────────────────────────────
const ctx = { age: 35, sex: 'male', heightCm: 182 }
for (const [metric, probes] of [
  ['step_count', [2000, 6500, 7500, 9000, 12000]],
  ['sleep_duration', [5, 6.5, 7.5, 9.5]],
  ['resting_heart_rate', [48, 62, 75, 90]],
  ['bmi', [17, 22, 27, 33]],
  ['vo2_max', [30, 40, 50, 60]],
  ['weekly_exercise_minutes', [0, 60, 200, 700]],
]) {
  const ladder = referenceLadder(metric, ctx)
  check(`§9 ${metric}: ladder has ≥2 steps`, ladder.length >= 2, true)
  check(`§9 ${metric}: first step open at the bottom`, ladder[0].from, null)
  check(`§9 ${metric}: last step open at the top`, ladder[ladder.length - 1].to, null)
  for (const p of probes) {
    const band = classify(metric, p, ctx).band
    const hit = referenceLadder(metric, ctx, p).filter(s => s.current).map(s => s.band)
    check(`§9 ${metric} ${p}: current step is classify's band`, hit, [band])
  }
}
const hrvLadder = referenceLadder('heart_rate_variability', { ...ctx, baseline: { mean: 45, sd: 5 } }, 38)
check('§9 HRV with a baseline: three personal bands', hrvLadder.map(s => s.band), ['below_baseline', 'within_baseline', 'above_baseline'])
check('§9 HRV with a baseline: 38 is below', hrvLadder.find(s => s.current).band, 'below_baseline')
check('§9 body fat without sex → no ladder', referenceLadder('body_fat_percentage', { age: 35, sex: null }), [])
check('§9 range text of a middle step has both ends', /–/.test(referenceLadder('step_count', ctx)[1].range), true)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
