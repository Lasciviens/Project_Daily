#!/usr/bin/env node
/* Verification — the numbers behind Food · Today's "Last 7 / 14 / 28 days"
 * card (src/features/recipes/weeklyNutrition.ts). Run: node scripts/verify-weekly-nutrition.cjs */
require('sucrase/register')
const { summarizePeriod, periodEnd, shiftDay } = require('../src/features/recipes/weeklyNutrition')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const T = { calories: 2000, protein: 150 }   // half-logged cutoff: 60 % of 2,000 = 1,200
// 2026-09-26 is a Saturday, 2026-09-27 a Sunday.
const rows = [
  { date: '2026-09-26', calories: 1200, protein_g: 90, carbs_g: 100, fat_g: 40, fiber_g: 10, sugar_g: 20 },
  { date: '2026-09-26', calories: 900, protein_g: 70.4, carbs_g: 100.4, fat_g: 31, fiber_g: 2, sugar_g: null }, // same day → 2,100 / 160
  { date: '2026-09-24', calories: 1500, protein_g: 100 },
  { date: '2026-09-21', calories: 1950, protein_g: 150 },
  { date: '2026-09-22', calories: 700, protein_g: 40 },    // half-logged (< 1,200)
  { date: '2026-09-23', calories: null, protein_g: null }, // logged with unknown macros = a gap
  { date: '2026-09-27', calories: 2600, protein_g: 120 },
  { date: '2026-09-19', calories: 5000, protein_g: 300 },  // outside 7, inside 14
]

console.log('the window')
{
  const s = summarizePeriod(rows, '2026-09-27', 7, T)
  check('7 days, oldest first', s.days.length === 7 && s.days[0].date === '2026-09-21' && s.days[6].date === '2026-09-27', `${s.days[0].date}…${s.days[6].date}`)
  check('from / to name the window', s.from === '2026-09-21' && s.to === '2026-09-27')
  check('same-day rows sum (rounded)', s.days[5].kcal === 2100 && s.days[5].protein === 160 && s.days[5].carbs === 200 && s.days[5].fat === 71, JSON.stringify(s.days[5]))
  check('a row outside the window is ignored', !s.days.some(d => d.date === '2026-09-19'))
  check('weekend flags Sat + Sun only', s.days.filter(d => d.weekend).map(d => d.date).join() === '2026-09-26,2026-09-27')
  check('no calories = a gap, not a 0 kcal day', s.gaps.join() === '2026-09-23,2026-09-25', s.gaps.join())
  check('logged days count every day with calories', s.loggedDays === 5, String(s.loggedDays))
  check('half-logged cutoff = 60 % of the target', s.halfCutoff === 1200, String(s.halfCutoff))
  check('a 700 kcal day is half-logged, drawn but not counted', s.halfDays.join() === '2026-09-22' && s.days[1].logged && s.days[1].half && s.counted.length === 4)
  check('average over counted days only', s.avg.kcal === Math.round((1950 + 1500 + 2100 + 2600) / 4) && s.avg.protein === Math.round((150 + 100 + 160 + 120) / 4), JSON.stringify(s.avg))
  check('protein hit days (≥ 150) among counted', s.proteinHitDays === 2, String(s.proteinHitDays))
  check('mean shortfall on the missed days (50 and 30 short)', s.proteinShortG === 40, String(s.proteinShortG))
  check('calories within ±10 %: 1,950 and 2,100', s.kcalOnTargetDays === 2, String(s.kcalOnTargetDays))
  check('over by more than 10 %: 2,600', s.kcalOverDays === 1)
  check('under by more than 10 %: 1,500', s.kcalUnderDays === 1)
  check('best day = closest to both targets (1,950 kcal, 150 g)', s.best?.date === '2026-09-21', s.best?.date)
  check('hardest day = furthest from both (1,500 kcal and 50 g short beats 2,600 kcal and 30 g short)', s.hardest?.date === '2026-09-24', s.hardest?.date)
  check('weekend vs weekdays over counted days', s.weekend && s.weekend.weekendKcal === 2350 && s.weekend.weekdayKcal === 1725 && s.weekend.gap === 625, JSON.stringify(s.weekend))
}
console.log('the switch recalculates')
{
  const s7 = summarizePeriod(rows, '2026-09-27', 7, T)
  const s14 = summarizePeriod(rows, '2026-09-27', 14, T)
  check('14 days start 13 days before the end', s14.from === '2026-09-14' && s14.days.length === 14)
  check('14 days pick up the older day: averages change', s14.counted.length === 5 && s14.avg.kcal !== s7.avg.kcal, `${s7.avg.kcal} → ${s14.avg.kcal}`)
  const s28 = summarizePeriod(rows, '2026-09-27', 28, T)
  check('28 days: 28 entries, the gaps grow', s28.days.length === 28 && s28.gaps.length === 28 - 6, String(s28.gaps.length))
}
console.log('edges')
{
  const e = summarizePeriod([], '2026-03-01', 7, T)
  check('empty → no averages, no best/hardest, no weekend', e.avg === null && e.best === null && e.hardest === null && e.weekend === null && e.loggedDays === 0)
  check('crosses a month (non-leap February)', e.days[0].date === '2026-02-23', e.days[0].date)
  const z = summarizePeriod(rows, '2026-09-27', 7, { calories: 0, protein: 0 })
  check('zero targets → no hit days, cutoff falls back to 800', z.proteinHitDays === 0 && z.kcalOnTargetDays === 0 && z.halfCutoff === 800)
  const allHalf = summarizePeriod([{ date: '2026-09-27', calories: 600, protein_g: 40 }, { date: '2026-09-26', calories: 500, protein_g: 30 }], '2026-09-27', 7, T)
  check('every day half-logged → averages fall back to the logged days', allHalf.counted.length === 2 && allHalf.avg.kcal === 550)
  const two = summarizePeriod([{ date: '2026-09-27', calories: 2000, protein_g: 150 }, { date: '2026-09-26', calories: 2500, protein_g: 150 }], '2026-09-27', 7, T)
  check('fewer than 3 counted days → no best/hardest', two.best === null && two.hardest === null)
  check('weekend needs 2 weekdays to compare', two.weekend === null)
}
console.log('period end')
check('today: the window ends yesterday', periodEnd('2026-10-13', '2026-10-13') === '2026-10-12')
check('a past day: the window ends on it', periodEnd('2026-10-05', '2026-10-13') === '2026-10-05')
check('a future day: still yesterday (nothing eaten yet)', periodEnd('2026-10-20', '2026-10-13') === '2026-10-12')
check('shiftDay across a year', shiftDay('2026-01-01', -1) === '2025-12-31')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
