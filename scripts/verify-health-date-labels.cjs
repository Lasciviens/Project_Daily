#!/usr/bin/env node
/*
 * Verification — healthDateLabels.ts (the Health page's period-navigator
 * label, the weekly-bar range label and the "last night" rule) and the
 * navigator wiring in components/dateNav.ts. Runs the real modules through
 * sucrase (no test framework, per CLAUDE.md).
 *
 * Run: node scripts/verify-health-date-labels.cjs
 */
require('sucrase/register')
const L = require('../src/features/health/healthDateLabels.ts')
const N = require('../src/features/health/components/dateNav.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}

const TODAY = '2026-09-27' // a Sunday

// ── Day label ────────────────────────────────────────────────────────────────
check('day: today is the date, not "Today"', L.dayNavLabel(TODAY, TODAY), 'Sun 27.09.2026')
check('day: weekday computed per date', L.dayNavLabel('2026-09-21', TODAY), 'Mon 21.09.2026')
check('day: another year carries the year', L.dayNavLabel('2025-09-30', TODAY), 'Tue 30.09.2025')
check('day: leap day', L.dayNavLabel('2028-02-29', '2028-03-01'), 'Tue 29.02.2028')

// ── Window span ──────────────────────────────────────────────────────────────
check('span: same month', L.spanLabel('2026-09-21', TODAY, TODAY), '21.09.2026 – 27.09.2026')
check('span: across months', L.spanLabel('2026-08-29', TODAY, TODAY), '29.08.2026 – 27.09.2026')
check('span: past year, same month', L.spanLabel('2025-09-21', '2025-09-27', TODAY), '21.09.2025 – 27.09.2025')
check('span: past year, across months', L.spanLabel('2025-06-30', '2025-09-27', TODAY), '30.06.2025 – 27.09.2025')
check('span: across years always names both', L.spanLabel('2025-09-28', TODAY, TODAY), '28.09.2025 – 27.09.2026')
check('span: one day falls back to the day label', L.spanLabel(TODAY, TODAY, TODAY), 'Sun 27.09.2026')
check('span: no month names', /[A-Za-z]/.test(L.spanLabel('2026-09-01', '2026-09-07', TODAY)), false)

// ── The date bar: numeric day.month, the owner's format ─────────────────────
check('numeric: same month', L.numericSpanLabel('2026-09-21', TODAY, TODAY), '21.09 – 27.09')
check('numeric: across months, zero-padded', L.numericSpanLabel('2026-08-29', '2026-09-04', TODAY), '29.08 – 04.09')
check('numeric: one day', L.numericSpanLabel(TODAY, TODAY, TODAY), '27.09')
check('numeric: one day in another year', L.numericSpanLabel('2025-09-27', '2025-09-27', TODAY), '27.09.2025')
check('numeric: past year names the year on both ends', L.numericSpanLabel('2025-09-21', '2025-09-27', TODAY), '21.09.2025 – 27.09.2025')
check('numeric: across years names both years', L.numericSpanLabel('2025-12-30', '2026-01-05', '2026-01-05'), '30.12.2025 – 05.01.2026')
check('numeric: a window reaching into last year shows both years', L.numericSpanLabel('2025-09-28', TODAY, TODAY), '28.09.2025 – 27.09.2026')
check('numeric: never a week number', /wk|week/i.test(L.numericSpanLabel('2026-09-21', TODAY, TODAY)), false)
check('numeric: day helper', [L.numericDay('2026-01-05', false), L.numericDay('2026-01-05', true)], ['05.01', '05.01.2026'])
check('numeric: max length constant', L.numericSpanLabel('2025-12-30', '2026-01-05', '2026-01-05').length, L.NUMERIC_SPAN_MAX_CHARS)

// ── The navigator: dates only, no "Last N days" prefix ───────────────────────
check('nav: day', N.labelForAnchor('day', TODAY, TODAY), '27.09')
check('nav: 7 days (rolling, not a calendar week)', N.labelForAnchor('week', TODAY, TODAY), '21.09 – 27.09')
check('nav: 30 days', N.labelForAnchor('month', TODAY, TODAY), '29.08 – 27.09')
check('nav: 90 days', N.labelForAnchor('quarter', TODAY, TODAY), '30.06 – 27.09')
check('nav: 1 year', N.labelForAnchor('year', TODAY, TODAY), '28.09.2025 – 27.09.2026')
check('nav: a past 7-day window', N.labelForAnchor('week', '2026-09-20', TODAY), '14.09 – 20.09')
check('nav: a Wednesday anchor still ends on that day', N.labelForAnchor('week', '2026-09-23', TODAY), '17.09 – 23.09')
for (const p of ['day', 'week', 'month', 'quarter', 'year']) {
  check(`nav: ${p} has no "Last" prefix`, /last/i.test(N.labelForAnchor(p, TODAY, TODAY)), false)
}
// The longest label the fixed-width box has to fit (HealthRangeBar).
const longest = Math.max(...['day', 'week', 'month', 'quarter', 'year']
  .flatMap(p => ['2026-09-27', '2026-03-29', '2026-01-03', '2025-12-31'].map(a => N.labelForAnchor(p, a, TODAY).length)))
check('nav: no label longer than the fixed box was sized for', longest <= L.NUMERIC_SPAN_MAX_CHARS, true)

// ── Weekly bars ──────────────────────────────────────────────────────────────
check('week: same month', L.weekRangeLabel('2026-07-07'), '07.07–13.07')
check('week: across months', L.weekRangeLabel('2026-06-29'), '29.06–05.07')
check('week: across years (tick, no year)', L.weekRangeLabel('2025-12-29'), '29.12–04.01')
check('week: tooltip form is the full range', L.weekRangeLabel('2026-07-07', TODAY), '07.07.2026 – 13.07.2026')
check('week: past year, tooltip form adds the year', L.weekRangeLabel('2025-07-07', TODAY), '07.07.2025 – 13.07.2025')
check('week: past year across months', L.weekRangeLabel('2025-06-30', TODAY), '30.06.2025 – 06.07.2025')
check('week: across years, tooltip names both years', L.weekRangeLabel('2025-12-29', TODAY), '29.12.2025 – 04.01.2026')
check('week: leap-year February', L.weekRangeLabel('2028-02-28', '2028-03-10'), '28.02.2028 – 05.03.2028')

// ── Last night ───────────────────────────────────────────────────────────────
const nights = [
  { date: '2026-09-24', total: 7.2 },
  { date: '2026-09-25', total: 5.5 },
  { date: '2026-09-26', total: 6.1 },
]
check('last night: the night filed under the day', L.nightEndingOn(nights, '2026-09-26'), { date: '2026-09-26', total: 6.1 })
check('last night: missing night is null, never the newest older one', L.nightEndingOn(nights, TODAY), null)
check('last night: a past day picks exactly that night', L.nightEndingOn(nights, '2026-09-25')?.total, 5.5)
check('last night: a day before every record is null', L.nightEndingOn(nights, '2026-09-01'), null)
check('last night: empty list', L.nightEndingOn([], TODAY), null)
check('noun: today', L.nightNoun(TODAY, TODAY), 'last night')
check('noun: past day', L.nightNoun('2026-09-20', TODAY), 'that night')
check('missing: today', L.nightMissingText(TODAY, TODAY), 'No sleep recorded last night')
check('missing: past day', L.nightMissingText('2026-09-20', TODAY), 'No sleep recorded that night')

if (failures.length) {
  console.error(`\n${failures.length} FAILED, ${passed} passed:\n\n  ${failures.join('\n\n  ')}\n`)
  process.exit(1)
}
console.log(`verify-health-date-labels: all ${passed} assertions passed`)
