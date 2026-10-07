#!/usr/bin/env node
/* Verification — the Food · Today "Last 7 days" summary
 * (src/features/recipes/weeklyNutrition.ts). Run: node scripts/verify-weekly-nutrition.cjs */
require('sucrase/register')
const { summarizeWeek } = require('../src/features/recipes/weeklyNutrition')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const T = { calories: 2000, protein: 150 }
const rows = [
  { date: '2026-09-26', calories: 1200, protein_g: 90 },
  { date: '2026-09-26', calories: 900, protein_g: 70.4 },  // same day sums → 2100 / 160
  { date: '2026-09-24', calories: 1500, protein_g: 100 },
  { date: '2026-09-20', calories: 1950, protein_g: 150 },
  { date: '2026-09-19', calories: 5000, protein_g: 300 },  // outside the window
  { date: '2026-09-23', calories: null, protein_g: null }, // logged with unknown macros
]
const s = summarizeWeek(rows, '2026-09-26', T)
check('7 days, oldest first', s.days.length === 7 && s.days[0].date === '2026-09-20' && s.days[6].date === '2026-09-26')
check('same-day rows sum', s.days[6].kcal === 2100 && s.days[6].protein === 160, JSON.stringify(s.days[6]))
check('outside window ignored', !s.days.some(d => d.date === '2026-09-19'))
check('a day with no calories is not a logged day', s.loggedDays === 3, String(s.loggedDays))
check('average over logged days only', s.avgKcal === Math.round((2100 + 1500 + 1950) / 3), String(s.avgKcal))
check('protein hit days', s.proteinHitDays === 2, String(s.proteinHitDays))
check('kcal within ±10%', s.kcalOnTargetDays === 2, String(s.kcalOnTargetDays))
{
  const e = summarizeWeek([], '2026-03-01', T)
  check('empty → null averages', e.avgKcal === null && e.avgProtein === null && e.loggedDays === 0)
  check('crosses month + leap-free Feb', e.days[0].date === '2026-02-23', e.days[0].date)
}
{
  const z = summarizeWeek(rows, '2026-09-26', { calories: 0, protein: 0 })
  check('zero targets → 0 hit days', z.proteinHitDays === 0 && z.kcalOnTargetDays === 0)
}
{
  const rows = [{ date: '2026-09-20', calories: 2000, protein_g: 150 }, { date: '2026-09-21', calories: 600, protein_g: 40 }]
  const p = summarizeWeek(rows, '2026-09-21', { calories: 2000, protein: 150 }, '2026-09-21')
  check('today (partial) is drawn but left out of averages', p.loggedDays === 1 && p.avgKcal === 2000 && p.days[6].partial && p.days[6].logged, JSON.stringify(p.days[6]))
}
{
  const rows = [
    { date: '2026-09-24', calories: 1800, protein_g: 140, carbs_g: 200, fat_g: 60, sugar_g: 40, fiber_g: 20 },
    { date: '2026-09-25', calories: 1000, protein_g: 80, carbs_g: 100.4, fat_g: 30, sugar_g: null, fiber_g: 9 },
    { date: '2026-09-25', calories: 1000, protein_g: 60, carbs_g: 100, fat_g: 31, sugar_g: 10, fiber_g: 2 },  // same day → 200.4 / 61 / 10 / 11
    { date: '2026-09-23', calories: 0, protein_g: 0, carbs_g: 50, fat_g: 0, sugar_g: 0, fiber_g: 0 },       // 0 kcal → not a logged day
    { date: '2026-09-26', calories: 900, protein_g: 70, carbs_g: 90, fat_g: 20, sugar_g: 5, fiber_g: 4 },   // today, partial
  ]
  const m = summarizeWeek(rows, '2026-09-26', T, '2026-09-26')
  check('carbs average over complete logged days', m.avgCarbs === Math.round((200 + 200.4) / 2), String(m.avgCarbs))
  check('fat average', m.avgFat === Math.round((60 + 61) / 2), String(m.avgFat))
  check('sugar average (a null counts as 0 on a logged day)', m.avgSugar === Math.round((40 + 10) / 2), String(m.avgSugar))
  check('fibre average', m.avgFiber === Math.round((20 + 11) / 2), String(m.avgFiber))
  check('rows without the new fields still work', summarizeWeek([{ date: '2026-09-26', calories: 500, protein_g: 30 }], '2026-09-26', T).avgCarbs === 0)
  check('no logged days → null macro averages', summarizeWeek([], '2026-09-26', T).avgFat === null)
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
