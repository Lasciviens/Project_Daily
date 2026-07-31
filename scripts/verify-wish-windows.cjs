#!/usr/bin/env node
/*
 * Verification — wish reminder-window math (Wishes & windows, Phase 1).
 *
 * Proves, against the REAL un-mocked modules (loaded via sucrase — the repo has
 * no unit-test runner by convention):
 *   1. SEASON CHIPS — "This <season>" is the window we are currently INSIDE,
 *      otherwise the UPCOMING one. Tapping "This winter" in July must store
 *      1 Dec of THIS year → end of Feb NEXT year, not a range already gone.
 *   2. LEAP SAFETY — end-of-February comes from real date math, so 2028 gives
 *      29 Feb and 2027 gives 28 Feb. A hardcoded '02-28' would pass every
 *      other assertion here and silently truncate one day every four years.
 *   3. WINDOW STATE — open / upcoming / passed / anytime, including both
 *      boundary days (a period is inclusive at BOTH ends) and one-sided
 *      windows. A period is a reminder window, never a deadline: 'passed' must
 *      never be reachable one day early.
 *   4. LABELS — en-GB day-first ranges, never en-US.
 *
 *   Run:  node scripts/verify-wish-windows.cjs
 */
require('sucrase/register')

const { seasonWindows, windowRangeLabel } = require('../src/shared/components/windowChips')
const { resolveWishWindow, wishPeriodLabel } = require('../src/features/wishes/wishRules')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const WINTER = '❄️ This winter'
const SPRING = '🌸 This spring'
const SUMMER = '☀️ This summer'
const AUTUMN = '🍂 This autumn'

// The chip row is sorted soonest-first, so a season is found by label, never by index.
function season(today, label) {
  const w = seasonWindows(today).find(x => x.label === label)
  return w ? `${w.start}..${w.end}` : `MISSING(${label})`
}

console.log('\n== 1. Chip row shape ==')
{
  const ws = seasonWindows('2026-07-15')
  check('four seasons, one chip each', ws.length === 4, JSON.stringify(ws.map(w => w.label)))
  check('labels are the exact contract strings',
    JSON.stringify(ws.map(w => w.label).sort()) === JSON.stringify([WINTER, SPRING, SUMMER, AUTUMN].sort()),
    JSON.stringify(ws.map(w => w.label)))
  check('sorted soonest-first (reads as a timeline)',
    ws.every((w, i) => i === 0 || ws[i - 1].start <= w.start),
    JSON.stringify(ws.map(w => w.start)))
  check('every window is a real forward range', ws.every(w => w.start < w.end))
}

console.log('\n== 2. "This winter" from July crosses the year boundary ==')
{
  // The headline case from the plan: written in July, winter is 1 Dec of the
  // SAME year through end of Feb the NEXT year.
  check('from 2026-07-15 → 2026-12-01..2027-02-28',
    season('2026-07-15', WINTER) === '2026-12-01..2027-02-28', season('2026-07-15', WINTER))
  check('from 2026-01-15 (inside winter) → 2025-12-01..2026-02-28',
    season('2026-01-15', WINTER) === '2025-12-01..2026-02-28', season('2026-01-15', WINTER))
  check('on the opening day 2026-12-01 → the window just opened, not next year’s',
    season('2026-12-01', WINTER) === '2026-12-01..2027-02-28', season('2026-12-01', WINTER))
  check('on the closing day 2026-02-28 → still the window we are in',
    season('2026-02-28', WINTER) === '2025-12-01..2026-02-28', season('2026-02-28', WINTER))
}

console.log('\n== 3. Leap-safe end of February (two concrete years) ==')
{
  check('winter from 2027-07-01 ends 2028-02-29 (2028 is a leap year)',
    season('2027-07-01', WINTER) === '2027-12-01..2028-02-29', season('2027-07-01', WINTER))
  check('winter from 2026-07-15 ends 2027-02-28 (2027 is not)',
    season('2026-07-15', WINTER) === '2026-12-01..2027-02-28', season('2026-07-15', WINTER))
  check('inside a leap winter: 2028-01-15 → 2027-12-01..2028-02-29',
    season('2028-01-15', WINTER) === '2027-12-01..2028-02-29', season('2028-01-15', WINTER))
}

console.log('\n== 4. Each season, from inside and from outside its window ==')
{
  check('spring inside (2026-04-10) → 2026-03-01..2026-05-31',
    season('2026-04-10', SPRING) === '2026-03-01..2026-05-31', season('2026-04-10', SPRING))
  check('spring outside (2026-07-15, already gone) → next year 2027-03-01..2027-05-31',
    season('2026-07-15', SPRING) === '2027-03-01..2027-05-31', season('2026-07-15', SPRING))

  check('summer inside (2026-07-15) → 2026-06-01..2026-08-31',
    season('2026-07-15', SUMMER) === '2026-06-01..2026-08-31', season('2026-07-15', SUMMER))
  check('summer outside (2026-01-15, still ahead) → 2026-06-01..2026-08-31',
    season('2026-01-15', SUMMER) === '2026-06-01..2026-08-31', season('2026-01-15', SUMMER))

  check('autumn inside (2026-10-05) → 2026-09-01..2026-11-30',
    season('2026-10-05', AUTUMN) === '2026-09-01..2026-11-30', season('2026-10-05', AUTUMN))
  check('autumn outside (2026-12-20, just gone) → next year 2027-09-01..2027-11-30',
    season('2026-12-20', AUTUMN) === '2027-09-01..2027-11-30', season('2026-12-20', AUTUMN))

  check('winter inside (2026-12-31) → 2026-12-01..2027-02-28',
    season('2026-12-31', WINTER) === '2026-12-01..2027-02-28', season('2026-12-31', WINTER))
  check('30-day months end on the 30th, never the 31st',
    season('2026-07-15', AUTUMN).endsWith('-11-30') && season('2026-04-10', SPRING).endsWith('-05-31'))
}

console.log('\n== 5. resolveWishWindow: state, both boundaries, one-sided ==')
{
  const TODAY = '2026-07-31'
  const st = (start, end) => resolveWishWindow({ period_start: start, period_end: end }, TODAY)

  check('no dates → anytime', st(null, null) === 'anytime', st(null, null))
  check('window ahead → upcoming', st('2026-12-01', '2027-02-28') === 'upcoming', st('2026-12-01', '2027-02-28'))
  check('window around today → open', st('2026-06-01', '2026-08-31') === 'open', st('2026-06-01', '2026-08-31'))
  check('window behind → passed', st('2026-03-01', '2026-05-31') === 'passed', st('2026-03-01', '2026-05-31'))

  // Both edges are INCLUSIVE. Off-by-one here is what would make a reminder
  // period behave like a deadline (gone the morning it should first speak up).
  check('today === period_start → open, not upcoming', st(TODAY, '2026-08-31') === 'open', st(TODAY, '2026-08-31'))
  check('today === period_end → open, not passed', st('2026-06-01', TODAY) === 'open', st('2026-06-01', TODAY))
  check('period_end one day before today → passed', st('2026-06-01', '2026-07-30') === 'passed', st('2026-06-01', '2026-07-30'))
  check('period_start one day after today → upcoming', st('2026-08-01', '2026-08-31') === 'upcoming', st('2026-08-01', '2026-08-31'))

  check('start only, already arrived → open', st('2026-01-01', null) === 'open', st('2026-01-01', null))
  check('start only, still ahead → upcoming', st('2026-09-01', null) === 'upcoming', st('2026-09-01', null))
  check('end only, not reached → open', st(null, '2026-12-31') === 'open', st(null, '2026-12-31'))
  check('end only, already gone → passed', st(null, '2026-07-30') === 'passed', st(null, '2026-07-30'))

  // A wish only ever changes state by the calendar moving, never by resetting:
  // the same row read on three days walks upcoming → open → passed, once.
  const w = { period_start: '2026-12-01', period_end: '2027-02-28' }
  check('one row across a year: upcoming → open → passed',
    resolveWishWindow(w, '2026-11-30') === 'upcoming' &&
    resolveWishWindow(w, '2027-01-15') === 'open' &&
    resolveWishWindow(w, '2027-03-01') === 'passed')
}

console.log('\n== 6. Labels: en-GB day-first, the user’s own word wins ==')
{
  // windowRangeLabel hides the year for windows in this year or the next, so
  // the fixtures are built from the real current year — the assertion then
  // holds whenever this script is run.
  const Y = new Date().getFullYear()

  check('null window → no label', windowRangeLabel(null, null) === null)
  check('cross-year chip window → "1 Dec – 28 Feb"',
    windowRangeLabel(`${Y}-12-01`, `${Y + 1}-02-28`) === '1 Dec – 28 Feb',
    String(windowRangeLabel(`${Y}-12-01`, `${Y + 1}-02-28`)))
  check('same month collapses the month → "12 – 19 Aug"',
    windowRangeLabel(`${Y}-08-12`, `${Y}-08-19`) === '12 – 19 Aug',
    String(windowRangeLabel(`${Y}-08-12`, `${Y}-08-19`)))
  check('start only → "From 12 Aug"', windowRangeLabel(`${Y}-08-12`, null) === 'From 12 Aug',
    String(windowRangeLabel(`${Y}-08-12`, null)))
  check('end only → "Until 19 Aug"', windowRangeLabel(null, `${Y}-08-19`) === 'Until 19 Aug',
    String(windowRangeLabel(null, `${Y}-08-19`)))
  check('far-out window carries the year on BOTH ends',
    windowRangeLabel(`${Y + 5}-12-01`, `${Y + 6}-02-28`) === `1 Dec ${Y + 5} – 28 Feb ${Y + 6}`,
    String(windowRangeLabel(`${Y + 5}-12-01`, `${Y + 6}-02-28`)))
  check('never en-US month-first',
    !/^(Dec|Aug|Feb)\s/.test(String(windowRangeLabel(`${Y}-12-01`, `${Y + 1}-02-28`))))

  check('wishPeriodLabel prefers the user’s own word',
    wishPeriodLabel({ period_start: `${Y}-12-01`, period_end: `${Y + 1}-02-28`, period_label: 'Hytte season' }) === 'Hytte season')
  check('wishPeriodLabel falls back to the date range',
    wishPeriodLabel({ period_start: `${Y}-12-01`, period_end: `${Y + 1}-02-28`, period_label: null }) === '1 Dec – 28 Feb')
  check('wishPeriodLabel: nothing at all → null',
    wishPeriodLabel({ period_start: null, period_end: null, period_label: null }) === null)
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
