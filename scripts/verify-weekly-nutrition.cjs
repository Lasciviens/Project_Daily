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
check('logged days counted (incl. unknown-macro day)', s.loggedDays === 4, String(s.loggedDays))
check('average over logged days only', s.avgKcal === Math.round((2100 + 1500 + 1950 + 0) / 4), String(s.avgKcal))
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
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
