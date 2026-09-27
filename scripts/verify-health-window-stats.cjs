#!/usr/bin/env node
/*
 * Verification — healthWindowStats.ts, the ONE rule behind every Health
 * headline number (section headlines, the side panel, Daily's health card).
 * Runs the real module through sucrase (no test framework, per CLAUDE.md).
 *
 * The bugs it pins down (audit H-01 / H-02 / T06):
 *   - the side panel dropped TODAY everywhere, so Day mode on today was all
 *     dashes and last night never counted in sleep figures;
 *   - the section headline counted today's unfinished day in the weekly mean
 *     while the panel didn't, so the same label showed two numbers.
 *
 * Run: node scripts/verify-health-window-stats.cjs
 */
require('sucrase/register')
const S = require('../src/features/health/healthWindowStats.ts')
const { miniCardSummary } = require('../src/features/health/components/miniCardSummary.ts')
const { computeHeartRateDailySeries, computeHeartRateHourlySeries } = require('../src/features/health/healthAggregate.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
const r1 = n => (n == null ? n : Math.round(n * 10) / 10)

const TODAY = '2026-09-27'

// ─── §1 Dates ────────────────────────────────────────────────────────────────
check('§1.1 addDaysIso crosses a month', S.addDaysIso('2026-09-30', 1), '2026-10-01')
check('§1.2 …a year', S.addDaysIso('2026-01-01', -1), '2025-12-31')
check('§1.3 …a DST change without drifting', S.addDaysIso('2026-10-24', 2), '2026-10-26')
check('§1.4 leap day', S.addDaysIso('2028-02-28', 1), '2028-02-29')
check('§1.5 daysBetweenIso', S.daysBetweenIso('2026-09-21', '2026-09-27'), 6)
check('§1.6 datesInRange is inclusive', S.datesInRange('2026-09-29', '2026-10-01'), ['2026-09-29', '2026-09-30', '2026-10-01'])

// ─── §2 fillDays: a day without data is a gap, never 0 (H-10) ────────────────
check('§2.1 missing days are null',
  S.fillDays([{ date: '2026-09-25', value: 10 }], '2026-09-24', '2026-09-26').map(d => d.value), [null, 10, null])
check('§2.2 a genuine zero stays zero',
  S.fillDays([{ date: '2026-09-25', value: 0 }], '2026-09-25', '2026-09-25')[0].value, 0)

// ─── §3 Windows ──────────────────────────────────────────────────────────────
{
  const w = S.makeWindow('2026-09-21', TODAY, TODAY)
  check('§3.1 a 7-day window and the 7 days before it',
    [w.prevFrom, w.prevTo, w.fetchFrom, w.totalDays, w.isDay], ['2026-09-14', '2026-09-20', '2026-09-14', 7, false])
  const d = S.makeWindow(TODAY, TODAY, TODAY)
  check('§3.2 a Day window compares with the day before', [d.prevFrom, d.prevTo, d.isDay], ['2026-09-26', '2026-09-26', true])
}

// ─── §4 Day mode on TODAY (the all-dashes bug) ───────────────────────────────
const steps = [
  { date: '2026-09-19', value: 8000 }, { date: '2026-09-20', value: 6000 },
  { date: '2026-09-21', value: 9000 }, { date: '2026-09-22', value: 7000 },
  { date: '2026-09-23', value: 11000 }, { date: '2026-09-24', value: 5000 },
  { date: '2026-09-25', value: 8000 }, { date: '2026-09-26', value: 10000 },
  { date: TODAY, value: 1200 }, // 09:00, in progress
]
{
  const s = S.summarizeWindow('sum', steps, { from: TODAY, to: TODAY, today: TODAY })
  check('§4.1 Day on today shows today\'s steps so far (was "—")', s.value, 1200)
  check('§4.2 …flagged as in progress', s.partialToday, true)
  check('§4.3 …with no trend against a finished yesterday', [s.previous, s.delta], [10000, null])
  check('§4.4 days with data counts today', s.daysWithData, 1)
}
{
  const s = S.summarizeWindow('sum', steps, { from: '2026-09-26', to: '2026-09-26', today: TODAY })
  check('§4.5 Day on a finished day trends against the day before', [s.value, s.previous, s.delta, r1(s.deltaPct)], [10000, 8000, 2000, 25])
  check('§4.6 …and is not in progress', s.partialToday, false)
}

// ─── §5 A week that includes today ───────────────────────────────────────────
{
  const s = S.summarizeWindow('sum', steps, { from: '2026-09-21', to: TODAY, today: TODAY })
  check('§5.1 the mean leaves today out (6 finished days)', [s.value, s.daysCounted], [50000 / 6, 6])
  check('§5.2 …the total keeps it (a total so far is honest)', s.total, 51200)
  check('§5.3 days with data still counts 7', s.daysWithData, 7)
  check('§5.4 previous window = the 7 days before', s.previous, 7000)
  check('§5.5 best day is a finished day', s.best, { date: '2026-09-23', value: 11000 })
  check('§5.6 partialToday says why today is missing from the mean', s.partialToday, true)
}

// ─── §6 Sleep: last night is a finished night (H-01) ─────────────────────────
const nights = [
  { date: '2026-09-25', value: 7 }, { date: '2026-09-26', value: 6 }, { date: TODAY, value: 8 },
]
{
  const rule = S.windowRuleFor('sleep')
  const s = S.summarizeWindow(rule.kind, nights, { from: '2026-09-21', to: TODAY, today: TODAY, todayComplete: rule.todayComplete })
  check('§6.1 last night counts in the weekly average', [s.value, s.daysCounted], [7, 3])
  check('§6.2 …and is never flagged in progress', s.partialToday, false)
  const d = S.summarizeWindow(rule.kind, nights, { from: TODAY, to: TODAY, today: TODAY, todayComplete: rule.todayComplete })
  check('§6.3 Day on today = last night, with a real trend', [d.value, d.previous, d.delta], [8, 6, 2])
}

// ─── §7 The Overview mix: one window, each metric's own rule ─────────────────
{
  const stepRule = S.windowRuleFor('sum'), sleepRule = S.windowRuleFor('sleep')
  const a = S.summarizeWindow(stepRule.kind, steps, { from: '2026-09-21', to: TODAY, today: TODAY, todayComplete: stepRule.todayComplete })
  const b = S.summarizeWindow(sleepRule.kind, nights, { from: '2026-09-21', to: TODAY, today: TODAY, todayComplete: sleepRule.todayComplete })
  check('§7.1 steps drop today, sleep keeps last night', [a.daysCounted, b.daysCounted], [6, 3])
}

// ─── §8 Latest-type metrics ──────────────────────────────────────────────────
{
  const vo2 = [{ date: '2026-08-02', value: 38.1 }, { date: '2026-09-22', value: 39.4 }]
  const s = S.summarizeWindow('latest', vo2, { from: '2026-09-21', to: TODAY, today: TODAY })
  check('§8.1 latest = newest reading in the window', [s.value, s.latestDate], [39.4, '2026-09-22'])
  check('§8.2 previous = newest reading in the window before', s.previous, null)
  const d = S.summarizeWindow('latest', vo2, { from: TODAY, to: TODAY, today: TODAY })
  check('§8.3 a Day with no reading is null (the "latest ever" read is a separate query)', d.value, null)
  check('§8.4 latest is never "in progress"', d.partialToday, false)
}

// ─── §9 Completeness floor ───────────────────────────────────────────────────
{
  const energy = [{ date: '2026-09-24', value: 2600 }, { date: '2026-09-25', value: 700 }, { date: '2026-09-26', value: 2400 }]
  const s = S.summarizeWindow('sum', energy, {
    from: '2026-09-24', to: '2026-09-26', today: TODAY, isDayComplete: d => d.value > 1550,
  })
  check('§9.1 a day under the floor stays out of the mean', [s.value, s.daysCounted, s.daysWithData], [2500, 2, 3])
}

// ─── §10 windowRuleFor ───────────────────────────────────────────────────────
check('§10.1 rules per aggregation type',
  ['sum', 'average', 'minmaxavg', 'latest', 'sleep'].map(t => S.windowRuleFor(t)),
  [{ kind: 'sum', todayComplete: false }, { kind: 'average', todayComplete: false }, { kind: 'average', todayComplete: false },
   { kind: 'latest', todayComplete: true }, { kind: 'average', todayComplete: true }])

// ─── §11 Trend helpers ───────────────────────────────────────────────────────
{
  const dense = S.fillDays([{ date: '2026-09-01', value: 80 }, { date: '2026-09-02', value: 82 }, { date: '2026-09-04', value: 81 }], '2026-09-01', '2026-09-04')
  check('§11.1 rollingMean over a dense series, gaps skipped',
    S.rollingMean(dense, 3, 1).map(p => r1(p.value)), [80, 81, 81, 81.5])
  check('§11.2 rollingMean needs minCount readings', S.rollingMean(dense, 3, 3).map(p => p.value), [null, null, null, null])
  const flat = S.datesInRange('2026-08-01', '2026-08-20').map((date, i) => ({ date, value: 60 + (i % 2) }))
  const b = S.personalBaseline(flat, { from: '2026-08-01', to: '2026-08-20' })
  check('§11.3 personalBaseline mean / n', [r1(b.mean), b.n], [60.5, 20])
  check('§11.4 personalBaseline refuses too few points', S.personalBaseline(flat.slice(0, 5), { from: '2026-08-01', to: '2026-08-20' }), null)
  const t = S.linearTrendPerDay([{ date: '2026-09-01', value: 80 }, { date: '2026-09-08', value: 79.3 }])
  check('§11.5 linear trend per day', r1(t.slopePerDay * 7), -0.7)
  check('§11.6 no trend from one day', S.linearTrendPerDay([{ date: '2026-09-01', value: 80 }]), null)
  check('§11.7 stdDev / median', [r1(S.stdDev([2, 4, 4, 4, 5, 5, 7, 9])), S.median([3, 1, 2])], [2.1, 2])
}

// ─── §12 Wrist-temperature deviation (H-15) ──────────────────────────────────
{
  const temps = S.datesInRange('2026-09-01', '2026-09-26').map(date => ({ date, value: 35.2 }))
  temps.push({ date: TODAY, value: 35.6 })
  const d = S.baselineDeviation(temps, TODAY)
  check('§12.1 deviation from your own median night', [r1(d.deviation), d.baseline, d.date], [0.4, 35.2, TODAY])
  check('§12.2 too little history → null, not a fake deviation',
    S.baselineDeviation([{ date: '2026-09-26', value: 35 }, { date: TODAY, value: 35.4 }], TODAY), null)
  check('§12.3 looks back from the newest reading on or before the date',
    S.baselineDeviation(temps, '2026-09-26').date, '2026-09-26')
}

// ─── §13 Mini cards (H-04 / H-22) ────────────────────────────────────────────
{
  // VO2 max is written only after a qualifying outdoor walk/run: the newest
  // reading EVER is the answer, not the newest inside a one-day window.
  const m = miniCardSummary('latest', [], { value: 39.4, date: '2026-08-02' }, { from: TODAY, to: TODAY }, TODAY)
  check('§13.1 a latest metric shows the newest reading ever, with its date', [m.value, m.latestDate, m.label, m.hasData], [39.4, '2026-08-02', 'Latest', true])
  check('§13.2 …and has no data only when there has never been a reading',
    miniCardSummary('latest', [], null, { from: TODAY, to: TODAY }, TODAY).hasData, false)
  const today = miniCardSummary('sum', [{ date: TODAY, value: 12 }], null, { from: TODAY, to: TODAY }, TODAY)
  check('§13.3 a sum metric on today reads "Today so far"', [today.value, today.label], [12, 'Today so far'])
  const week = miniCardSummary('sum', [{ date: '2026-09-25', value: 10 }, { date: '2026-09-26', value: 20 }, { date: TODAY, value: 1 }],
    null, { from: '2026-09-21', to: TODAY }, TODAY)
  check('§13.4 a week of a sum metric: daily average of finished days', [week.value, week.days, week.label], [15, 2, 'Daily avg'])
  const onlyToday = miniCardSummary('sum', [{ date: TODAY, value: 3 }], null, { from: '2026-09-21', to: TODAY }, TODAY)
  check('§13.5 a window whose only reading is today still counts as having data', [onlyToday.value, onlyToday.hasData], [null, true])
  check('§13.6 nothing in the window → folded into "Not recorded"',
    miniCardSummary('average', [], null, { from: '2026-09-21', to: TODAY }, TODAY).hasData, false)
}

// ─── §14 Heart rate gaps (H-03) ──────────────────────────────────────────────
{
  const hr = (iso, value) => ({ id: iso, metric_name: 'heart_rate', date: iso.slice(0, 10), recorded_at: iso, unit: 'bpm', source: 'w', value })
  const localIso = h => new Date(2026, 8, 26, h, 0, 0).toISOString()
  const pts = [hr(localIso(9), { Min: 60, Avg: 72, Max: 110 }), hr(localIso(10), { Avg: 70 })]
  const hourly = computeHeartRateHourlySeries(pts)
  check('§14.1 an hour with no reading is null, not 0 bpm', [hourly[3].avg, hourly[3].min, hourly[3].max], [null, null, null])
  check('§14.2 an Avg-only hour has no invented min/max', [hourly[10].avg, hourly[10].min, hourly[10].max], [70, null, null])
  const avgOnlyDay = computeHeartRateDailySeries([hr('2026-09-26T10:00:00Z', { Avg: 70 })])[0]
  check('§14.3 an Avg-only day reads "no range", never "0–0"', [avgOnlyDay.min, avgOnlyDay.max, avgOnlyDay.avg], [null, null, 70])
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('Every Health window rule holds.\n')
