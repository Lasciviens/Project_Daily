#!/usr/bin/env node
/*
 * Verification — Health → Body's "Weekly changes" card
 * (src/features/health/weeklyBodyChanges.ts) against the REAL module loaded
 * through sucrase (no unit-test runner by this repo's convention): which weeks
 * a period shows, the weekly averages and changes, the noise floors and the
 * phase colours.
 *
 *   Run:  node scripts/verify-weekly-body-changes.cjs
 */
require('sucrase/register')
const W = require('../src/features/health/weeklyBodyChanges.ts')

let passed = 0, failed = 0
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`) }
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const meta = key => W.WEEKLY_METRICS.find(m => m.key === key)

// ─── §1 which weeks a period shows ───────────────────────────────────────────
const TUE = '2026-10-13' // a Tuesday; its week starts Monday 12.10.2026
check('§1.1 7 days → this week and the one before', W.weekStartsFor(TUE, 7), ['2026-10-12', '2026-10-05'])
check('§1.2 one day still shows two weeks', W.weekStartsFor(TUE, 1), ['2026-10-12', '2026-10-05'])
check('§1.3 a Sunday 7-day window is one week, padded to two', W.weekStartsFor('2026-10-11', 7), ['2026-10-05', '2026-09-28'])
check('§1.4 30 days → the 5 weeks it touches', W.weekStartsFor(TUE, 30), ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14'])
check('§1.5 90 days → 14 weeks', W.weekStartsFor(TUE, 90).length, 14)
check('§1.6 1 year → 53 weeks, oldest the Monday of 14.10.2025', [W.weekStartsFor(TUE, 365).length, W.weekStartsFor(TUE, 365).at(-1)], [53, '2025-10-13'])
check('§1.7 newest first, every one a Monday', W.weekStartsFor(TUE, 90).every((d, i, a) => i === 0 || addDays(d, 7) === a[i - 1]), true)

// ─── §2 averages and changes ─────────────────────────────────────────────────
// Week of 05.10: 83.0, 83.4 (avg 83.2). Week of 12.10: 82.7 on Mon, 82.9 on
// Tue (the anchor) and 70 on Wed — after the anchor, so left out.
const series = {
  weight: [
    { date: '2026-09-28', value: 83.6 },
    { date: '2026-10-05', value: 83.0 }, { date: '2026-10-08', value: 83.4 },
    { date: '2026-10-12', value: 82.7 }, { date: '2026-10-13', value: 82.9 }, { date: '2026-10-14', value: 70 },
  ],
  fat: [{ date: '2026-10-06', value: 24.04 }, { date: '2026-10-13', value: 23.46 }],
  muscle: [],
  score: [{ date: '2026-09-22', value: 77 }, { date: '2026-10-07', value: 78 }, { date: '2026-10-09', value: 79 }],
}
const weeks = W.weekStartsFor(TUE, 30)
const rows = W.buildWeeklyChanges(series, weeks, TUE, 'cut')
const byWeek = Object.fromEntries(rows.map(r => [r.weekStart, r.cells]))
check('§2.1 one row per week, newest first, with its Sunday', rows.map(r => [r.weekStart, r.weekEnd]).slice(0, 2), [['2026-10-12', '2026-10-18'], ['2026-10-05', '2026-10-11']])
check('§2.2 the anchor week averages only the days up to the anchor', [byWeek['2026-10-12'].weight.avg, byWeek['2026-10-12'].weight.days], [82.8, 2])
check('§2.3 change from the week before (82.8 − 83.2)', byWeek['2026-10-12'].weight.change, -0.4)
check('§2.4 a week without readings is null, never zero', [byWeek['2026-09-21'].weight.avg, byWeek['2026-09-21'].weight.days, byWeek['2026-09-21'].weight.change], [null, 0, null])
check('§2.5 no change after an empty week (no older week is borrowed)', [byWeek['2026-09-28'].weight.avg, byWeek['2026-09-28'].weight.change, byWeek['2026-09-28'].weight.verdict], [83.6, null, null])
check('§2.6 averages are rounded as shown and the change adds up (24.0 → 23.5)', [byWeek['2026-10-05'].fat.avg, byWeek['2026-10-12'].fat.avg, byWeek['2026-10-12'].fat.change], [24, 23.5, -0.5])
check('§2.7 body score: whole numbers, 78.5 shows as 79', byWeek['2026-10-05'].score.avg, 79)
check('§2.8 no muscle readings → every week null', rows.every(r => r.cells.muscle.avg === null), true)

// ─── §3 noise floors ─────────────────────────────────────────────────────────
check('§3.1 weight −0.4 kg on a cut is real and good', byWeek['2026-10-12'].weight.verdict, 'good')
check('§3.2 body fat −0.5 points is inside the ±0.6 noise → steady', byWeek['2026-10-12'].fat.verdict, 'steady')
check('§3.3 weight ±0.2 kg → steady', W.changeVerdict(meta('weight'), -0.2, 83, 'cut'), 'steady')
check('§3.4 exactly the noise counts as real (−0.6 fat points)', W.changeVerdict(meta('fat'), -0.6, 24, 'cut'), 'good')
check('§3.5 exactly 0.3 kg counts as real', W.changeVerdict(meta('weight'), 0.3, 83, 'gain'), 'good')
check('§3.6 muscle −0.5 points → steady', W.changeVerdict(meta('muscle'), -0.5, 40, 'cut'), 'steady')
check('§3.7 body score change under 1 point → steady', W.changeVerdict(meta('score'), 0, 78, 'cut'), 'steady')

// ─── §4 colours by phase ─────────────────────────────────────────────────────
check('§4.1 cut: weight up is bad', W.changeVerdict(meta('weight'), 0.4, 83, 'cut'), 'bad')
check('§4.2 cut: a slow real loss (−0.35 kg, 0.4 %/wk) is still good', W.changeVerdict(meta('weight'), -0.35, 83, 'cut'), 'good')
check('§4.3 cut: −0.9 kg (1.1 %/wk, faster than 1 %) is bad', W.changeVerdict(meta('weight'), -0.9, 83, 'cut'), 'bad')
check('§4.4 cut: −1.3 kg (1.6 %/wk) is bad', W.changeVerdict(meta('weight'), -1.3, 83, 'cut'), 'bad')
check('§4.5 gain: +0.35 kg (0.4 %/wk) is good', W.changeVerdict(meta('weight'), 0.35, 83, 'gain'), 'good')
check('§4.6 gain: +0.7 kg (0.8 %/wk, past 0.5 %) is bad', W.changeVerdict(meta('weight'), 0.7, 83, 'gain'), 'bad')
check('§4.7 gain: weight down is bad', W.changeVerdict(meta('weight'), -0.4, 83, 'gain'), 'bad')
check('§4.8 maintain: a real drift either way is bad', [W.changeVerdict(meta('weight'), -0.4, 83, 'maintain'), W.changeVerdict(meta('weight'), 0.4, 83, 'maintain')], ['bad', 'bad'])
check('§4.9 phase still loading → weight unjudged', W.changeVerdict(meta('weight'), -0.5, 83, null), 'plain')
check('§4.10 body fat down is good, up is bad, in every phase',
  ['cut', 'maintain', 'gain'].map(p => [W.changeVerdict(meta('fat'), -0.8, 24, p), W.changeVerdict(meta('fat'), 0.8, 24, p)]),
  [['good', 'bad'], ['good', 'bad'], ['good', 'bad']])
check('§4.11 muscle up is good, down is bad', [W.changeVerdict(meta('muscle'), 0.7, 40, 'cut'), W.changeVerdict(meta('muscle'), -0.7, 40, 'gain')], ['good', 'bad'])
check('§4.12 the body score is shown, never judged', [W.changeVerdict(meta('score'), 3, 78, 'cut'), W.changeVerdict(meta('score'), -3, 78, 'gain')], ['plain', 'plain'])
check('§4.13 tones: good → success, bad → warn, steady/plain → neutral', ['good', 'bad', 'steady', 'plain'].map(v => W.VERDICT_TONE[v]), ['success', 'warn', 'neutral', 'neutral'])

// ─── §5 columns ──────────────────────────────────────────────────────────────
check('§5.1 muscle is left out when no week has it; weight, fat and score stay', W.shownMetrics(rows).map(m => m.key), ['weight', 'fat', 'score'])
const bare = W.buildWeeklyChanges({ weight: [], fat: [], muscle: [], score: [] }, weeks, TUE, 'cut')
check('§5.2 weight always has a column, even with nothing to show', W.shownMetrics(bare).map(m => m.key), ['weight'])
check('§5.3 a column whose only reading is in the week before the first row stays hidden',
  W.shownMetrics(W.buildWeeklyChanges({ weight: [], fat: [], muscle: [{ date: '2026-10-01', value: 40 }], score: [] }, ['2026-10-12'], TUE, 'cut')).map(m => m.key), ['weight'])

// ─── §6 weeks before the first reading ───────────────────────────────────────
const yearRows = W.buildWeeklyChanges(series, W.weekStartsFor(TUE, 365), TUE, 'cut')
const trimmed = W.sinceFirstReading(yearRows, series)
check('§6.1 a year view starts at the week of the first reading (22.09 → week of 21.09)',
  [trimmed.rows.length, trimmed.rows.at(-1).weekStart, trimmed.first, trimmed.dropped], [4, '2026-09-21', '2026-09-22', 49])
check('§6.2 an empty week AFTER the first reading stays as a gap', W.sinceFirstReading(rows, series).rows.some(r => r.weekStart === '2026-09-21'), true)
const gap = W.buildWeeklyChanges({ ...series, weight: series.weight.filter(d => d.date < '2026-10-05' || d.date > '2026-10-11') }, ['2026-10-12', '2026-10-05'], TUE, 'cut')
check('§6.3 a 7-day view keeps last week\'s "–" when older readings exist', W.sinceFirstReading(gap, series).rows.map(r => [r.weekStart, r.cells.weight.avg]), [['2026-10-12', 82.8], ['2026-10-05', null]])
check('§6.4 nothing measured → no rows and no first date', (() => { const t = W.sinceFirstReading(bare, { weight: [], fat: [], muscle: [], score: [] }); return [t.rows.length, t.first] })(), [0, null])
check('§6.5 the 30-day view drops its oldest week (14.09–20.09), which ends before the first reading', W.sinceFirstReading(rows, series).dropped, 1)
check('§6.6 nothing is cut when the first reading is older than every row',
  W.sinceFirstReading(rows, { ...series, weight: [{ date: '2026-09-01', value: 84 }, ...series.weight] }).dropped, 0)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
