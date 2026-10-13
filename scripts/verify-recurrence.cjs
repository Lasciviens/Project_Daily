#!/usr/bin/env node
/*
 * Verification — the one repeat rule (src/features/daily/recurrence.ts,
 * migration 146): does a recurring plan occur on a day, its dates in a
 * range, its one-line summary — and every projection asking it
 * (dayAgendaProjection's spillover included). Runs the real module through
 * sucrase.
 *
 *   Run:  node scripts/verify-recurrence.cjs
 */
require('sucrase/register')

const R = require('../src/features/daily/recurrence')
const { projectRecurringBlocksForDay } = require('../src/features/daily/components/dayAgendaProjection')

let passed = 0
let failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}

console.log('\n== 1. Day math on yyyy-MM-dd (no time zone) ==')
eq(R.dayNumber('1970-01-01'), 0, 'day 0 is 01.01.1970')
eq(R.weekdayOfIso('1970-01-01'), 4, '01.01.1970 was a Thursday')
eq(R.weekdayOfIso('2026-10-13'), 2, '13.10.2026 is a Tuesday')
eq(R.weekdayOfIso('2026-10-18'), 0, '18.10.2026 is a Sunday (0)')
eq(R.addDaysIso('2026-03-28', 2), '2026-03-30', 'across the spring clock change')
eq(R.addDaysIso('2026-10-24', 2), '2026-10-26', 'across the autumn clock change')
eq(R.addDaysIso('2024-02-28', 1), '2024-02-29', 'leap day exists in 2024')
eq(R.addDaysIso('2023-02-28', 1), '2023-03-01', 'and not in 2023')
eq(R.addDaysIso('2026-12-31', 1), '2027-01-01', 'over the new year')
eq(R.addDaysIso('2026-03-01', -1), '2026-02-28', 'backwards over a month end')
{
  // The same weekdays as a local Date at noon, day by day for 3 years.
  let bad = 0
  for (let d = new Date(2025, 0, 1, 12), i = 0; i < 3 * 366; i++, d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (R.weekdayOfIso(iso) !== d.getDay() || R.addDaysIso(iso, 1) !== (() => { const n = new Date(d); n.setDate(n.getDate() + 1); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}` })()) bad++
  }
  eq(bad, 0, 'weekday and next day match the local calendar for 3 years')
}

console.log('\n== 2. Weekly (every row before 146) ==')
{
  const walk = { days_of_week: [1, 2, 3, 4, 5], effective_from: '2026-08-24' }
  eq(R.occursOn(walk, '2026-10-13'), true, 'a weekday occurs')
  eq(R.occursOn(walk, '2026-10-18'), false, 'a Sunday does not')
  eq(R.occursOn(walk, '2026-08-21'), false, 'nothing before effective_from')
  eq(R.occursOn({ ...walk, effective_from: null }), false, 'a missing day is no day')
  eq(R.occursOn({ ...walk, effective_from: undefined }, '2026-08-21'), true, 'no effective_from (before 081) = no lower bound')
  eq(R.occursOn({ ...walk, except_dates: ['2026-10-13'] }, '2026-10-13'), false, 'an except_dates day is left out')
  eq(R.occursOn({ ...walk, repeat_kind: 'weekly' }, '2026-10-14'), true, "repeat_kind 'weekly' is the same")
  eq(R.occursOn({ ...walk, repeat_kind: 'yearly' }, '2026-10-14'), true, 'an unknown kind reads as weekly')
  eq(R.occursOn({ days_of_week: [] }, '2026-10-14'), false, 'a weekly plan with no day never occurs')
  eq(R.occursOn(walk, '13.10.2026'), false, 'a malformed day never occurs')
}

console.log('\n== 3. Monthly — the chosen weekday nearest the start date ==')
{
  // The owner's example: started Tue 13.10.2026, Saturday chosen.
  const sat13 = { days_of_week: [6], repeat_kind: 'monthly', effective_from: '2026-10-13' }
  eq(R.monthlyOccurrence(13, 2026, 9, 6), '2026-10-10', 'Oct: Sat 10.10 (3 days back) beats Sat 17.10 (4 ahead)')
  eq(R.monthlyOccurrence(13, 2026, 10, 6), '2026-11-14', 'Nov: 13.11 is a Friday → Sat 14.11')
  eq(R.monthlyOccurrence(13, 2026, 11, 6), '2026-12-12', 'Dec: 13.12 is a Sunday → Sat 12.12')
  eq(R.monthlyOccurrence(13, 2027, 0, 6), '2027-01-16', 'Jan: 13.01 is a Wednesday → Sat 16.01')
  eq(R.nextOccurrences(sat13, '2026-10-13', 3), ['2026-11-14', '2026-12-12', '2027-01-16'],
    'next three from the start: 10.10 is before it, so November first')
  eq(R.occursOn(sat13, '2026-10-10'), false, 'the nearest Saturday before the start does not occur')
  eq(R.occursOn(sat13, '2026-11-21'), false, 'another Saturday does not occur')
  // No weekday: the same date, clamped to the month's last day.
  const rent31 = { days_of_week: [], repeat_kind: 'monthly', effective_from: '2026-10-31' }
  eq(R.occurrencesBetween(rent31, '2026-10-01', '2027-04-30'),
    ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'],
    'the 31st becomes the last day of a short month')
  eq(R.occurrencesBetween(rent31, '2028-02-01', '2028-02-29'), ['2028-02-29'], 'in a leap year: 29.02')
  eq(R.occurrencesBetween({ ...rent31, effective_from: '2028-01-29' }, '2028-02-01', '2028-03-31'), ['2028-02-29', '2028-03-29'],
    'the 29th in a leap February')
  eq(R.occurrencesBetween({ ...rent31, effective_from: '2027-01-29' }, '2027-02-01', '2027-03-31'), ['2027-02-28', '2027-03-29'],
    'the 29th in a common February is the 28th')
  // The nearest weekday may sit in the neighbouring month.
  const mon31 = { days_of_week: [1], repeat_kind: 'monthly', effective_from: '2027-01-31' }
  eq(R.monthlyOccurrence(31, 2028, 1, 1), '2028-02-28', 'leap February: Tue 29.02 → Mon 28.02')
  eq(R.monthlyOccurrence(31, 2027, 3, 1), '2027-05-03', "April's 30th is a Friday → Mon 03.05 (in May)")
  eq(R.occurrencesBetween(mon31, '2027-04-25', '2027-05-31'), ['2027-05-03', '2027-05-31'],
    "May holds April's occurrence (03.05) and its own (Mon 31.05)")
  const mon1 = { days_of_week: [1], repeat_kind: 'monthly', effective_from: '2026-09-01' }
  eq(R.occurrencesBetween(mon1, '2026-08-01', '2026-11-30'), ['2026-09-28', '2026-11-02', '2026-11-30'],
    "Sep's Mon 31.08 is before the start; Oct's is Mon 28.09, Nov's Mon 02.11, Dec's Mon 30.11")
  // Never a tie: the nearest weekday is always within 3 days.
  let far = 0
  for (let a = 1; a <= 31; a++) for (let m = 0; m < 24; m++) for (let w = 0; w < 7; w++) {
    const y = 2026 + Math.floor(m / 12), mo = m % 12
    const target = `${y}-${String(mo + 1).padStart(2, '0')}-${String(Math.min(a, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate())).padStart(2, '0')}`
    const got = R.monthlyOccurrence(a, y, mo, w)
    if (R.weekdayOfIso(got) !== w || Math.abs(R.dayNumber(got) - R.dayNumber(target)) > 3) far++
  }
  eq(far, 0, 'every anchor × month × weekday lands on that weekday, at most 3 days away')
  eq(R.occursOn({ days_of_week: [6], repeat_kind: 'monthly' }, '2026-11-14'), false, 'monthly without a start never occurs')
}

console.log('\n== 4. Every N days / weeks / months ==')
{
  const every3 = { days_of_week: [], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'day', effective_from: '2026-10-13' }
  eq(R.occurrencesBetween(every3, '2026-10-10', '2026-11-04'),
    ['2026-10-13', '2026-10-16', '2026-10-19', '2026-10-22', '2026-10-25', '2026-10-28', '2026-10-31', '2026-11-03'],
    'every 3 days from the start, across the clock change and a month end')
  const twoWeeks = { days_of_week: [2, 4], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week', effective_from: '2026-10-13' }
  eq(R.occurrencesBetween(twoWeeks, '2026-10-12', '2026-11-13'),
    ['2026-10-13', '2026-10-15', '2026-10-27', '2026-10-29', '2026-11-10', '2026-11-12'],
    'every 2 weeks on Tue and Thu, weeks counted Monday-first from the start')
  const monSat = { ...twoWeeks, days_of_week: [1, 0] }
  eq(R.occurrencesBetween(monSat, '2026-10-12', '2026-10-31'), ['2026-10-18', '2026-10-26'],
    "the start week's Monday is before the start; its Sunday counts (Monday-first weeks); then two weeks on")
  const everySecondMonth = { days_of_week: [], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'month', effective_from: '2026-10-13' }
  eq(R.occurrencesBetween(everySecondMonth, '2026-10-01', '2027-03-31'), ['2026-10-13', '2026-12-13', '2027-02-13'],
    'every 2 months on the 13th')
  const sixMonthsFri = { days_of_week: [5], repeat_kind: 'interval', repeat_interval: 6, repeat_unit: 'month', effective_from: '2026-10-13' }
  eq(R.nextOccurrences(sixMonthsFri, '2026-10-13', 2), ['2026-10-16', '2027-04-16'],
    'every 6 months, the Friday nearest the 13th')
  eq(R.occursOn({ ...every3, repeat_interval: null }, '2026-10-14'), true, 'a missing N reads as 1')
  eq(R.occursOn({ ...every3, repeat_unit: null }, '2026-10-13'), false, 'no unit never occurs')
  eq(R.occursOn({ ...every3, effective_from: null }, '2026-10-13'), false, 'every N without a start never occurs')
  // Independent check: every 2 weeks on Wed against plain Date arithmetic, 2 years.
  const wed = { days_of_week: [3], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week', effective_from: '2026-01-07' }
  const want = []
  for (let d = new Date(2026, 0, 7, 12); d.getFullYear() < 2028; d.setDate(d.getDate() + 14)) {
    want.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  eq(R.occurrencesBetween(wed, '2026-01-01', '2027-12-31'), want, 'every 2 weeks on Wed = every 14 days, for 2 years')
}

console.log('\n== 5. Picked dates ==')
{
  const gigs = { days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-12-31', '2026-10-20', '2026-11-14'], effective_from: '2026-10-20' }
  eq(R.occurrencesBetween(gigs, '2026-10-01', '2027-01-31'), ['2026-10-20', '2026-11-14', '2026-12-31'], 'exactly the picked days, in order')
  eq(R.occursOn(gigs, '2026-10-21'), false, 'no other day')
  eq(R.occursOn({ ...gigs, except_dates: ['2026-11-14'] }, '2026-11-14'), false, 'a picked day can be left out (142)')
  eq(R.occursOn({ ...gigs, effective_from: '2026-11-01' }, '2026-10-20'), false, 'a picked day before the start does not occur')
  eq(R.nextOccurrences(gigs, '2027-01-01', 3), [], 'nothing after the last date')
  eq(R.nextOccurrences({ ...gigs, repeat_dates: null }, '2026-10-01', 3), [], 'no dates, no occurrence')
}

console.log('\n== 6. Projection asks occursOn, spillover included ==')
{
  const night = { id: 'n', title: 'Night shift', start_time: '23:00:00', end_time: '01:00:00', days_of_week: [6], repeat_kind: 'monthly', effective_from: '2026-10-13' }
  const onDay = R => R.filter(p => !p.spillover).length
  eq(onDay(projectRecurringBlocksForDay('2026-11-14', [night])), 1, 'a monthly night block on its Saturday')
  eq(projectRecurringBlocksForDay('2026-11-15', [night]).map(p => [p.spillover, p.startHour, p.endHour]), [[true, 0, 1]],
    'its tail lands on the Sunday after')
  eq(projectRecurringBlocksForDay('2026-11-21', [night]).length, 0, 'not on another Saturday')
  eq(projectRecurringBlocksForDay('2026-11-15', [{ ...night, except_dates: ['2026-11-14'] }]).length, 0,
    'a left-out day takes its tail with it')
  const dates = { id: 'd', title: 'Gig', start_time: '22:00:00', end_time: '02:00:00', days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-10-20'], effective_from: '2026-10-20' }
  eq(projectRecurringBlocksForDay('2026-10-21', [dates]).map(p => p.id), ['d__spillover'], 'a picked date spills into the next day')
  const every3 = { id: 'e', title: 'Plants', start_time: '08:00:00', end_time: '08:10:00', days_of_week: [], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'day', effective_from: '2026-10-13' }
  eq([12, 13, 14, 15, 16].map(d => projectRecurringBlocksForDay(`2026-10-${d}`, [every3]).length), [0, 1, 0, 0, 1], 'every 3 days on the agenda')
  const weekly = { id: 'w', title: 'Upper A', start_time: '17:00:00', end_time: '18:00:00', days_of_week: [1, 4] }
  eq(projectRecurringBlocksForDay('2026-10-12', [weekly]).length, 1, 'a weekly row from before 146 still projects')
}

console.log('\n== 7. Weekdays of a week, one-line summary ==')
{
  eq(R.weeklyDaysOf({ days_of_week: [4, 1, 1] }), [1, 4], 'weekly: its days, sorted, once each')
  eq(R.weeklyDaysOf({ days_of_week: [2, 4], repeat_kind: 'interval', repeat_unit: 'week', repeat_interval: 2 }), [2, 4], 'every 2 weeks: its days')
  eq(R.weeklyDaysOf({ days_of_week: [6], repeat_kind: 'monthly' }), [], 'monthly has no weekly day')
  eq(R.weeklyDaysOf({ days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-10-20'] }), [], 'picked dates neither')
  // Training days a week (the coach and the Program tab): every N weeks counts 1/N.
  const every2 = { days_of_week: [2, 4], repeat_kind: 'interval', repeat_unit: 'week', repeat_interval: 2 }
  eq(R.weeklyDaysPerWeek([{ days_of_week: [1, 3, 5] }]), 3, 'days a week: weekly Mon/Wed/Fri = 3')
  eq(R.weeklyDaysPerWeek([every2]), 1, 'days a week: every 2 weeks on Tue and Thu = 1, not 2')
  eq(R.weeklyDaysPerWeek([{ ...every2, repeat_interval: 3, days_of_week: [6] }]), 0.33, 'days a week: every 3 weeks on Sat = 0.33')
  eq(R.weeklyDaysPerWeek([{ days_of_week: [2] }, every2]), 1.5, 'days a week: weekly Tue wins over every 2 weeks on Tue; Thu adds ½')
  eq(R.weeklyDaysPerWeek([{ days_of_week: [1] }, { days_of_week: [1] }]), 1, 'days a week: two plans on one Monday are one day')
  eq(R.weeklyDaysPerWeek([{ days_of_week: [6], repeat_kind: 'monthly' }, { days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-10-20'] }]), 0, 'days a week: monthly and picked dates add nothing')
  eq(R.weeklyDaysPerWeek([]), 0, 'days a week: no plan = 0')
  const s = r => R.repeatSummary(r)
  eq(s({ days_of_week: [0, 1, 2, 3, 4, 5, 6] }), 'Every day', 'every day')
  eq(s({ days_of_week: [5, 4, 3, 2, 1] }), 'Every weekday', 'weekdays')
  eq(s({ days_of_week: [4, 2] }), 'Every week on Tue and Thu', 'two days, Monday first')
  eq(s({ days_of_week: [0, 1, 3, 5] }), 'Every week on Mon, Wed, Fri and Sun', 'Sunday last')
  eq(s({ days_of_week: [] }), 'No day picked', 'no day')
  eq(s({ days_of_week: [6], repeat_kind: 'monthly', effective_from: '2026-10-13' }), 'Every month, the Saturday nearest the 13th', "the owner's example")
  eq(s({ days_of_week: [], repeat_kind: 'monthly', effective_from: '2026-10-01' }), 'Every month on the 1st', 'same date')
  eq(s({ days_of_week: [], repeat_kind: 'monthly', effective_from: '2026-10-22' }), 'Every month on the 22nd', '22nd')
  eq(s({ days_of_week: [], repeat_kind: 'monthly', effective_from: '2026-10-31' }), 'Every month on the 31st (or the last day)', 'the 31st says what a short month does')
  eq(s({ days_of_week: [2, 4], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week' }), 'Every 2 weeks on Tue and Thu', 'every 2 weeks')
  eq(s({ days_of_week: [], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'day' }), 'Every 3 days', 'every 3 days')
  eq(s({ days_of_week: [5], repeat_kind: 'interval', repeat_interval: 6, repeat_unit: 'month', effective_from: '2026-10-13' }),
    'Every 6 months, the Friday nearest the 13th', 'every 6 months')
  eq(s({ days_of_week: [], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'month', effective_from: '2026-10-12' }),
    'Every 2 months on the 12th', '12th, not 12nd')
  eq(s({ days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-10-20', '2026-11-14'] }), 'On 2 picked dates', 'picked dates')
  eq(s({ days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-10-20'] }), 'On 1 picked date', 'one picked date')
  eq([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(R.ordinal).join(' '), '1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 31st', 'ordinals')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
