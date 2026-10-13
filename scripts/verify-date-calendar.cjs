// Checks the month calendar's date maths (src/shared/components/dateCalendarMath.ts):
// the day grid, the arrows' limits and the month/year jump.
//   node scripts/verify-date-calendar.cjs
// Runs itself in three time zones (the day grid must not move a day).
require('sucrase/register')
const assert = require('assert')
const { execFileSync } = require('child_process')

if (!process.env.CAL_TZ_CHILD) {
  const outs = ['Europe/Oslo', 'Pacific/Kiritimati', 'America/Los_Angeles'].map(tz =>
    execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, CAL_TZ_CHILD: '1' } }).toString())
  const grids = outs.map(o => o.split('\n').find(l => l.startsWith('GRID ')))
  assert.ok(grids.every(g => g === grids[0]), 'the same day grid in every time zone')
  console.log(outs[0].split('\n').filter(l => !l.startsWith('GRID ')).join('\n').trim().replace(/(\d+) passed/, (_, k) => `${Number(k) + 1} passed`) + ' · same grid in 3 time zones')
  process.exit(0)
}

const C = require('../src/shared/components/dateCalendarMath.ts')
let n = 0
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }
const ok = (c, msg) => { assert.ok(c, msg); n++ }

// ── the day grid ────────────────────────────────────────────────────────
const oct = C.monthCells(2026, 9)
eq(oct.length % 7, 0, 'whole weeks')
eq(oct[0].date, '2026-09-28', 'October 2026 starts on Monday 28.09')
eq(oct.filter(c => c.inMonth).length, 31, 'October has 31 days in the grid')
eq(oct[oct.length - 1].date, '2026-11-01', 'and ends on Sunday 01.11')
eq(C.monthCells(2024, 1).filter(c => c.inMonth).length, 29, 'February 2024 has 29 days')
eq(C.monthCells(2021, 1).length, 28, 'February 2021 (Monday 1st, 28 days) is exactly four weeks')
eq(C.monthCells(2026, 2).length, 42, 'March 2026 (Sunday 1st) needs six weeks')
// Every month of 1999–2031: consecutive days, each in-month day once, Monday first.
for (let y = 1999; y <= 2031; y++) {
  for (let m = 0; m < 12; m++) {
    const cells = C.monthCells(y, m)
    const days = cells.filter(c => c.inMonth).map(c => c.day)
    assert.deepStrictEqual(days, Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => i + 1), `${y}-${m + 1}: every day once`)
    for (let i = 1; i < cells.length; i++) {
      const a = Date.parse(`${cells[i - 1].date}T00:00:00Z`)
      const b = Date.parse(`${cells[i].date}T00:00:00Z`)
      assert.strictEqual(b - a, 86_400_000, `${y}-${m + 1}: consecutive days (${cells[i].date})`)
    }
    assert.strictEqual(new Date(`${cells[0].date}T12:00:00Z`).getUTCDay(), 1, `${y}-${m + 1}: weeks start on Monday`)
  }
}
n += 3

// ── the first month shown ───────────────────────────────────────────────
const TODAY = '2026-10-13'
eq(C.startView('2016-03-05', undefined, undefined, TODAY), { year: 2016, month: 2 }, 'the value\'s month')
eq(C.startView('', undefined, undefined, TODAY), { year: 2026, month: 9 }, 'no value: today\'s month')
eq(C.startView('', undefined, '2020-01-10', TODAY), { year: 2020, month: 0 }, 'max before today: max\'s month')
eq(C.startView('', '2030-05-01', undefined, TODAY), { year: 2030, month: 4 }, 'min after today: min\'s month')

// ── stepping a month ────────────────────────────────────────────────────
eq(C.shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 }, 'January back is last December')
eq(C.shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 }, 'December on is next January')
eq(C.shiftMonth({ year: 2026, month: 9 }, -120), { year: 2016, month: 9 }, 'ten years back')
eq(C.shiftMonth({ year: 2026, month: 9 }, 12), { year: 2027, month: 9 }, 'a year on')
eq(C.monthKey({ year: 2026, month: 0 }), '2026-01', 'month key pads')
eq(C.canShift({ year: 2026, month: 9 }, 1, undefined, '2026-10-13'), false, 'no next month after max')
eq(C.canShift({ year: 2026, month: 9 }, -1, undefined, '2026-10-13'), true, 'back is fine under a max')
eq(C.canShift({ year: 2026, month: 9 }, -1, '2026-10-01'), false, 'no previous month before min')
eq(C.canShift({ year: 2026, month: 9 }, -1, '2026-09-30'), true, 'min inside last month allows it')
eq(C.canShift({ year: 2026, month: 9 }, -12, '2026-01-01'), false, 'a year back is past min')
eq(C.canShift({ year: 2026, month: 9 }, 12, undefined, '2027-10-01'), true, 'a year on reaches max\'s month')
eq(C.canShift({ year: 2026, month: 9 }, 12, undefined, '2027-09-30'), false, 'a year on passes max')

// ── which months and years can be picked ────────────────────────────────
eq(C.monthAllowed(2026, 9, undefined, '2026-10-13'), true, 'max\'s own month')
eq(C.monthAllowed(2026, 10, undefined, '2026-10-13'), false, 'after max')
eq(C.monthAllowed(2026, 8, '2026-09-30'), true, 'min\'s own month (only its last day)')
eq(C.monthAllowed(2026, 7, '2026-09-30'), false, 'before min')
eq(C.monthAllowed(1950, 0), true, 'no bounds: any month')
eq(C.yearAllowed(2027, undefined, '2026-10-13'), false, 'year after max')
eq(C.yearAllowed(2026, '2026-12-31', '2026-12-31'), true, 'a one-day range keeps its year')
eq(C.yearAllowed(2025, '2026-01-01'), false, 'year before min')

// ── jumping to another year ─────────────────────────────────────────────
eq(C.moveToYear({ year: 2026, month: 9 }, 2016), { year: 2016, month: 9 }, 'same month ten years back')
eq(C.moveToYear({ year: 2025, month: 11 }, 2026, undefined, '2026-10-13'), { year: 2026, month: 9 }, 'December past max becomes max\'s month')
eq(C.moveToYear({ year: 2027, month: 0 }, 2026, '2026-06-15'), { year: 2026, month: 5 }, 'January before min becomes min\'s month')
eq(C.moveToYear({ year: 2026, month: 5 }, 2026, '2026-03-01', '2026-08-31'), { year: 2026, month: 5 }, 'an allowed month stays')
eq(C.moveToYear({ year: 2020, month: 6 }, 2026, '2026-12-01', '2026-12-31'), { year: 2026, month: 11 }, 'nearest allowed month')

// ── the year list ───────────────────────────────────────────────────────
const free = C.yearRange(2026, 2026)
eq(free[0], 1900, 'unbounded list starts in 1900')
eq(free[free.length - 1], 2056, 'and runs 30 years past today')
eq(free.length, 157, 'one entry per year')
ok(free.includes(2016), 'ten years back is in the list')
eq(C.yearRange(1850, 2026)[0], 1850, 'an older value\'s year is in the list')
eq(C.yearRange(2080, 2026).slice(-1)[0], 2080, 'a later value\'s year is in the list')
eq(C.yearRange(2026, 2026, '2020-05-01', '2026-10-13'), [2020, 2021, 2022, 2023, 2024, 2025, 2026], 'min–max bound the list')
eq(C.yearRange(2026, 2026, undefined, '2026-10-13').slice(-1)[0], 2026, 'max = today: nothing after this year')
// Keys in the year list.
const ys = C.yearRange(2026, 2026, '2000-01-01', '2026-10-13')
eq(C.yearForKey(ys, 2016, 'ArrowUp'), 2015, 'up: a year back')
eq(C.yearForKey(ys, 2016, 'ArrowDown'), 2017, 'down: a year on')
eq(C.yearForKey(ys, 2016, 'PageUp'), 2006, 'Page Up: ten back')
eq(C.yearForKey(ys, 2020, 'PageDown'), 2026, 'Page Down stops at the last year')
eq(C.yearForKey(ys, 2003, 'PageUp'), 2000, 'Page Up stops at the first year')
eq(C.yearForKey(ys, 2016, 'Home'), 2000, 'Home: the first year')
eq(C.yearForKey(ys, 2016, 'End'), 2026, 'End: the last year')
eq(C.yearForKey(ys, 2016, 'Enter'), null, 'other keys: not handled')
eq(C.yearForKey([], 2016, 'ArrowUp'), null, 'empty list')
eq(C.MONTH_SHORT.length, 12, 'twelve short names')
eq(C.MONTH_SHORT[9], 'Oct', 'October is Oct')

console.log('GRID ' + [2016, 2024, 2026].flatMap(y => [0, 1, 9].map(m => C.monthCells(y, m).map(c => c.date).join(','))).join('|'))
console.log(`verify-date-calendar: ${n} passed`)
