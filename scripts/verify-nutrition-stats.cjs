#!/usr/bin/env node
/* Verification — Food · Today's "Nutrition stats" (src/features/recipes/nutritionStats.ts).
 * Run: node scripts/verify-nutrition-stats.cjs */
require('sucrase/register')
const { buildNutritionStats } = require('../src/features/recipes/nutritionStats')
let passed = 0, failed = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}
// 2026-09-28 is a Monday; the 7 days run Tue 22 → Mon 28 (Sat 26, Sun 27 = weekend).
const row = (date, slot, kcal, p, fat = 20, fiber = 8) => ({ date, meal_slot: slot, calories: kcal, protein_g: p, fat_g: fat, fiber_g: fiber })
const day = (date, kcal, meals = [45, 45, 45]) => meals.map((p, i) => row(date, ['breakfast', 'lunch', 'dinner', 'snack'][i], kcal / meals.length, p))
const rows = [
  ...day('2026-09-22', 1900), ...day('2026-09-23', 2000), ...day('2026-09-24', 1950, [60, 60]),
  ...day('2026-09-25', 2050), ...day('2026-09-26', 2700, [30, 30, 30]), ...day('2026-09-27', 2600, [30, 30, 30]),
  row('2026-09-10', 'lunch', 3000, 20), // outside 7, inside 28
]
const BAL = { days: 18, meanIntake: 1700, meanBurn: 2600, scaleBurn: 2019 }
const s = buildNutritionStats({ rows, endDate: '2026-09-28', period: 7, targetKcal: 2000, weightKg: 83, balance: BAL })
const r = k => s.rows.find(x => x.key === k)
check('logged days (the empty Monday is a gap)', s.loggedDays, 6)
check('reliable at ≥ 5 of 7', s.reliable, true)
check('protein average + g/kg', r('protein').value, '118 g · 1.4 g/kg')
check('protein below 1.6 g/kg on average → warn', r('protein').tone, 'warn')
check('protein days ≥ 1.6 g/kg', /^3 of 6 logged days/.test(r('protein').sentence), true)
check('protein tier = evidence', r('protein').tier, 'evidence')
check('calories vs target', r('calories').value, '2,200 / 2,000 kcal')
check('calories exactly 10 % above → within 10 % (success)', [r('calories').tone, /within 10 %/.test(r('calories').sentence)], ['success', true])
check('under-logging flagged (logged < 85 % of Apple − scale deficit)', [r('balance').tone, /Possible under-logging/.test(r('balance').sentence)], ['warn', true])
check('balance says 28 days', /last 28/.test(r('balance').sentence), true)
check('protein per meal ≥ 0.4 g/kg (33 g): 2 → 3,3,2,3,0,0', r('perMeal').value, '1.8 meals/day')
check('per meal is a soft heuristic, never warn', [r('perMeal').tier, r('perMeal').tone], ['heuristic', 'info'])
check('fibre below 25 g → warn', [r('fiber').value, r('fiber').tone], ['23 g/day', 'neutral'])
check('fat vs 0.6 g/kg floor (50 g)', [r('fat').value, r('fat').tone], ['57 g · 0.7 g/kg', 'success'])
check('weekend gap > 500 flagged', [r('weekend').value, r('weekend').tone], ['+675 kcal', 'warn'])
check('every row has a tier pill', s.rows.every(x => ['measured', 'evidence', 'heuristic'].includes(x.tier)), true)
{
  const u = buildNutritionStats({ rows: day('2026-09-28', 2000), endDate: '2026-09-28', period: 7, targetKcal: 2000, weightKg: 83, balance: null })
  check('1 of 7 days → not reliable, calories row says so', [u.reliable, u.rows.find(x => x.key === 'calories').tone, /reliable from 5/.test(u.rows.find(x => x.key === 'calories').sentence)], [false, 'warn', true])
  check('no balance → no balance row', u.rows.some(x => x.key === 'balance'), false)
  check('no weekend day → no weekend row', u.rows.some(x => x.key === 'weekend'), false)
}
{
  const m = buildNutritionStats({ rows, endDate: '2026-09-28', period: 28, targetKcal: 2000, weightKg: 83, balance: BAL })
  check('28 days include the older day', m.loggedDays, 7)
  check('28 days: 7 of 28 is not reliable (needs 20)', m.reliable, false)
}
{
  const nw = buildNutritionStats({ rows, endDate: '2026-09-28', period: 7, targetKcal: 2000, weightKg: null, balance: null })
  check('no weight: protein measured only, no per-meal/fat rows', [nw.rows[0].tier, nw.rows.some(x => x.key === 'perMeal'), nw.rows.some(x => x.key === 'fat')], ['measured', false, false])
  check('nothing logged → no rows', buildNutritionStats({ rows: [], endDate: '2026-09-28', period: 7, targetKcal: 2000, weightKg: 83, balance: null }).rows.length, 0)
  const fine = buildNutritionStats({ rows, endDate: '2026-09-28', period: 7, targetKcal: 2000, weightKg: 83, balance: { days: 18, meanIntake: 2100, meanBurn: 2400, scaleBurn: 2300 } })
  check('logged close to what the scale implies → neutral', fine.rows.find(x => x.key === 'balance').tone, 'neutral')
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
