#!/usr/bin/env node
/* Verification — foodInsights.ts (Food → Insights). */
require('sucrase/register')
const assert = require('node:assert/strict')
const { buildFoodInsights } = require('../src/features/recipes/foodInsights')
let n = 0
const ok = (a, e, m) => { assert.deepStrictEqual(a, e, m); n++ }
const row = (date, slot, title, o) => ({ date, meal_slot: slot, title, library_ingredient_id: null, recipe_id: null, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, ...o })
const rows = [
  row('2026-10-03', 'breakfast', 'Oats', { library_ingredient_id: 'oats', calories: 300, protein_g: 10, carbs_g: 50, fat_g: 6, fiber_g: 8 }),
  row('2026-10-03', 'dinner', 'Bowl', { recipe_id: 'bowl', calories: 700, protein_g: 60, carbs_g: 60, fat_g: 20 }),
  row('2026-10-02', 'dinner', 'Bowl', { recipe_id: 'bowl', calories: 700, protein_g: 60, carbs_g: 60, fat_g: 20 }),
  row('2026-10-02', 'snack', 'Kebab', { calories: 900, protein_g: 40, carbs_g: 80, fat_g: 40 }),
  row('2026-09-30', 'snack', 'kebab', { calories: 300, protein_g: 10, carbs_g: 30, fat_g: 12 }),
]
const r = buildFoodInsights(rows, 7, '2026-10-03')
ok(r.daysLogged, 3, 'distinct logged days')
ok(r.avg.kcal, 967, 'average kcal per logged day (2900 / 3)')
ok(r.avg.protein, 60, 'average protein per logged day')
ok(r.topKcal.map(s => [s.title, s.kcal, s.share]), [['Bowl', 1400, 48], ['Kebab', 1200, 41], ['Oats', 300, 10]], 'top calorie sources (custom lines merge case-insensitively)')
ok(r.topProtein[0].title, 'Bowl', 'top protein source')
ok(r.topProtein[0].share, 67, 'its share of protein (120 / 180)')
ok(r.mostLogged.map(s => [s.title, s.count]), [['Bowl', 2], ['Kebab', 2], ['Oats', 1]], 'most logged (ties by kcal)')
ok(r.slots.map(s => s.slot), ['breakfast', 'dinner', 'snack'], 'slots in day order, only those used')
ok(r.slots.find(s => s.slot === 'dinner'), { slot: 'dinner', kcalPerDay: 467, proteinPerDay: 40, kcalShare: 48, daysWith: 2 }, 'dinner per logged day')
ok(r.streak, 2, '03.10 and 02.10 logged, 01.10 not')
ok(buildFoodInsights(rows.slice(1), 7, '2026-10-04').streak, 2, 'an empty today does not break the streak')
ok(r.variety, 3, 'distinct foods')
ok(r.split.protein + r.split.carbs + r.split.fat >= 99, true, 'split adds to ~100')
ok(buildFoodInsights([], 7, '2026-10-03').avg.kcal, 0, 'no rows → zeros, no NaN')
console.log(`verify-food-insights: ${n} assertions passed`)
