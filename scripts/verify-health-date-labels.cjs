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
check('day: today is the date, not "Today"', L.dayNavLabel(TODAY, TODAY), 'Sun 27 Sep')
check('day: weekday computed per date', L.dayNavLabel('2026-09-21', TODAY), 'Mon 21 Sep')
check('day: another year carries the year', L.dayNavLabel('2025-09-30', TODAY), 'Tue 30 Sep 2025')
check('day: leap day', L.dayNavLabel('2028-02-29', '2028-03-01'), 'Tue 29 Feb')

// ── Window span ──────────────────────────────────────────────────────────────
check('span: same month', L.spanLabel('2026-09-21', TODAY, TODAY), '21–27 Sep')
check('span: across months', L.spanLabel('2026-08-29', TODAY, TODAY), '29 Aug – 27 Sep')
check('span: past year, same month', L.spanLabel('2025-09-21', '2025-09-27', TODAY), '21–27 Sep 2025')
check('span: past year, across months', L.spanLabel('2025-06-30', '2025-09-27', TODAY), '30 Jun – 27 Sep 2025')
check('span: across years always names both', L.spanLabel('2025-09-28', TODAY, TODAY), '28 Sep 2025 – 27 Sep 2026')
check('span: one day falls back to the day label', L.spanLabel(TODAY, TODAY, TODAY), 'Sun 27 Sep')
check('span: never "Sept"', L.spanLabel('2026-09-01', '2026-09-07', TODAY).includes('Sept'), false)

// ── The navigator: dates only, no "Last N days" prefix ───────────────────────
check('nav: day', N.labelForAnchor('day', TODAY, TODAY), 'Sun 27 Sep')
check('nav: 7 days', N.labelForAnchor('week', TODAY, TODAY), '21–27 Sep')
check('nav: 30 days', N.labelForAnchor('month', TODAY, TODAY), '29 Aug – 27 Sep')
check('nav: 90 days', N.labelForAnchor('quarter', TODAY, TODAY), '30 Jun – 27 Sep')
check('nav: 1 year', N.labelForAnchor('year', TODAY, TODAY), '28 Sep 2025 – 27 Sep 2026')
check('nav: a past 7-day window', N.labelForAnchor('week', '2026-09-20', TODAY), '14–20 Sep')
for (const p of ['day', 'week', 'month', 'quarter', 'year']) {
  check(`nav: ${p} has no "Last" prefix`, /last/i.test(N.labelForAnchor(p, TODAY, TODAY)), false)
}
// The longest label the fixed-width box has to fit (DateNav.tsx: w-[11rem]).
const longest = Math.max(...['day', 'week', 'month', 'quarter', 'year']
  .flatMap(p => ['2026-09-27', '2026-03-29', '2026-01-31', '2025-12-31'].map(a => N.labelForAnchor(p, a, TODAY).length)))
check('nav: no label longer than the fixed box was sized for (25 chars)', longest <= 25, true)

// ── Weekly bars ──────────────────────────────────────────────────────────────
check('week: same month', L.weekRangeLabel('2026-07-07'), '7–13 Jul')
check('week: across months', L.weekRangeLabel('2026-06-29'), '29 Jun–5 Jul')
check('week: across years (tick, no year)', L.weekRangeLabel('2025-12-29'), '29 Dec–4 Jan')
check('week: this year, tooltip form stays short', L.weekRangeLabel('2026-07-07', TODAY), '7–13 Jul')
check('week: past year, tooltip form adds the year', L.weekRangeLabel('2025-07-07', TODAY), '7–13 Jul 2025')
check('week: past year across months', L.weekRangeLabel('2025-06-30', TODAY), '30 Jun–6 Jul 2025')
check('week: across years, tooltip names both years', L.weekRangeLabel('2025-12-29', TODAY), '29 Dec 2025–4 Jan 2026')
check('week: leap-year February', L.weekRangeLabel('2028-02-28', '2028-03-10'), '28 Feb–5 Mar')

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
