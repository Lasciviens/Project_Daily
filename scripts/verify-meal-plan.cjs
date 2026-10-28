#!/usr/bin/env node
/* Verification — what a planned row is (src/features/recipes/mealPlanRows.ts):
 * the logger's plan mode saves the same row shapes as a log, as status
 * 'planned', with no stored totals for a food or recipe; a one-off line keeps
 * its typed values; a planned row's kcal is worked out live, through the same
 * weight-unit gate as every reader — Food · Today's planned row
 * (dayNutritionApi.unifiedToMeal) and ticking it eaten
 * (mealPlanApi.eatPlannedEntry, against a recording stand-in for Supabase).
 * Run: node scripts/verify-meal-plan.cjs */
require('sucrase/register')
// The api modules import the live Supabase client: hand them a stand-in that
// records each query's calls and answers from `answer`.
const Module = require('module')
const writes = []
let answer = () => ({ data: null, error: null })
const fakeSupabase = {
  from(table) {
    const ops = []
    const q = new Proxy({}, {
      get(_, k) {
        if (k === 'then') return (res, rej) => Promise.resolve(answer(table, ops)).then(res, rej)
        if (k === 'maybeSingle') return () => Promise.resolve(answer(table, ops))
        return (...args) => { ops.push([k, ...args]); if (k === 'update' || k === 'insert') writes.push({ table, op: k, row: args[0] }); return q }
      },
    })
    return q
  },
}
const origLoad = Module._load
Module._load = function (request) {
  if (/integrations\/supabase\/client$/.test(request)) return { supabase: fakeSupabase }
  return origLoad.apply(this, arguments)
}
const { plannedRow, plannedKcal, MACRO_KEYS } = require('../src/features/recipes/mealPlanRows')
const { itemsToEntries } = require('../src/features/recipes/foodBasket')
const { unifiedToMeal } = require('../src/features/daily/api/dayNutritionApi')
const { eatPlannedEntry } = require('../src/features/recipes/api/mealPlanApi')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const noTotals = r => MACRO_KEYS.every(k => r[k] === null)

const at = { date: '2026-10-28', slot: 'lunch' }
const rice = { id: 'lib-rice', name: 'Basmati rice, cooked', unit: 'g', serving_grams: 150, calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3, fiber_g: 0.4, sugar_g: 0.1 }
const milk = { id: 'lib-milk', name: 'Milk', unit: 'ml', serving_grams: 200, calories: 46, protein_g: 3.4, carbs_g: 4.8, fat_g: 1.5, fiber_g: 0, sugar_g: 4.8 }
const karn = { id: 'rec-karn', title: 'Karnıyarık', servings: 4, serving_label: null, calories: 380, protein_g: 18, carbs_g: 22, fat_g: 24, fiber_g: 6, sugar_g: 9 }

console.log('\n1 · The logger\'s rows as planned rows')
{
  const [food, drink, meal] = itemsToEntries([
    { ingredient: rice, grams: 180 },
    { ingredient: milk, grams: 250 },
    { kind: 'recipe', recipe: karn, servings: 1.5 },
  ], { ...at, groupId: 'g-1' }).map(plannedRow)
  check('every row is status planned on its day and meal', [food, drink, meal].every(r => r.status === 'planned' && r.date === at.date && r.meal_slot === 'lunch'))
  check('a food: library id + grams + g, no title', food.library_ingredient_id === 'lib-rice' && food.quantity === 180 && food.unit === 'g' && food.recipe_id === null && food.custom_title === null, JSON.stringify(food))
  check('a drink keeps ml', drink.unit === 'ml' && drink.quantity === 250, JSON.stringify(drink))
  check('a recipe: recipe id + servings + serving', meal.recipe_id === 'rec-karn' && meal.quantity === 1.5 && meal.unit === 'serving' && meal.library_ingredient_id === null, JSON.stringify(meal))
  check('a food or recipe stores no totals (worked out live)', noTotals(food) && noTotals(drink) && noTotals(meal))
  check('planned rows are never a dish (no meal group)', [food, drink, meal].every(r => !('meal_group_id' in r) && !('meal_group_title' in r)))
}
{
  const typed = plannedRow({ date: at.date, meal_slot: 'dinner', custom_title: '  Restaurant ', calories: 700 })
  check('a one-off line keeps its typed name (trimmed) and kcal', typed.custom_title === 'Restaurant' && typed.calories === 700 && typed.recipe_id === null && typed.library_ingredient_id === null, JSON.stringify(typed))
  check('a one-off line without kcal stores none', plannedRow({ ...at, meal_slot: 'lunch', custom_title: 'Mom’s köfte' }).calories === null)
  // A Recent tile's row (foodLogApi.recentToEntry: the line as it was last eaten, totals included).
  const asLastEaten = r => ({ date: at.date, meal_slot: 'lunch', fiber_g: null, sugar_g: null, ...r })
  const recent = plannedRow(asLastEaten({ library_ingredient_id: null, recipe_id: null, custom_title: 'Kebab', quantity: null, unit: null, calories: 700, protein_g: 35, carbs_g: 60, fat_g: 30 }))
  check('a recent one-off line keeps all its typed macros', recent.custom_title === 'Kebab' && recent.calories === 700 && recent.protein_g === 35 && recent.fat_g === 30, JSON.stringify(recent))
  const recentRecipe = plannedRow(asLastEaten({ library_ingredient_id: null, recipe_id: 'rec-karn', custom_title: null, quantity: 2, unit: 'serving', calories: 760, protein_g: 36, carbs_g: 44, fat_g: 48 }))
  check('a recent recipe drops its eaten snapshot', recentRecipe.recipe_id === 'rec-karn' && recentRecipe.quantity === 2 && noTotals(recentRecipe), JSON.stringify(recentRecipe))
  const both = plannedRow({ ...at, meal_slot: 'lunch', recipe_id: 'rec-karn', library_ingredient_id: 'lib-rice', custom_title: 'x' })
  check('exactly one source: a recipe wins over a stray food id and title', both.recipe_id === 'rec-karn' && both.library_ingredient_id === null && both.custom_title === null)
  check('a recipe without servings plans 1', plannedRow({ ...at, meal_slot: 'lunch', recipe_id: 'r' }).quantity === 1)
}

console.log('\n2 · A planned row\'s kcal, live')
{
  const base = { recipe_id: null, servings: 1, library_ingredient_id: null, ingredient_quantity: null, ingredient_unit: null }
  check('recipe: per serving × servings', plannedKcal({ ...base, recipe_id: 'r', servings: 2, recipe: { calories: 380 } }) === 760)
  check('recipe without kcal → none', plannedKcal({ ...base, recipe_id: 'r', recipe: { calories: null } }) === null)
  check('food: per 100 g × grams', plannedKcal({ ...base, library_ingredient_id: 'f', ingredient_quantity: 150, ingredient_unit: 'g', ingredient: { calories: 130 } }) === 195)
  check('food in ml counts like grams', plannedKcal({ ...base, library_ingredient_id: 'f', ingredient_quantity: 250, ingredient_unit: 'ml', ingredient: { calories: 46 } }) === 115)
  check('food in kg counts (foodUnits)', plannedKcal({ ...base, library_ingredient_id: 'f', ingredient_quantity: 0.2, ingredient_unit: 'kg', ingredient: { calories: 130 } }) === 260)
  check('"2 pcs" can\'t be counted → none (the weight-unit gate)', plannedKcal({ ...base, library_ingredient_id: 'f', ingredient_quantity: 2, ingredient_unit: 'pcs', ingredient: { calories: 155 } }) === null)
  check('food without an amount → none', plannedKcal({ ...base, library_ingredient_id: 'f', ingredient: { calories: 130 } }) === null)
  check('a one-off line: its typed kcal', plannedKcal({ ...base, calories: 700 }) === 700)
  check('a one-off line without kcal → none', plannedKcal({ ...base }) === null)
  check('a recipe ignores a stray stored kcal', plannedKcal({ ...base, recipe_id: 'r', recipe: { calories: 100 }, calories: 999 }) === 100)
}

console.log('\n3 · Food · Today\'s planned row counts what Meal plan counts (one weight-unit gate)')
{
  const chicken = { name: 'Chicken breast', unit: 'g', calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, fiber_g: 0, sugar_g: 0 }
  const planned = (quantity, unit, ingredient = chicken) => ({
    id: 'p1', meal_slot: 'dinner', status: 'planned', recipe_id: null, library_ingredient_id: 'lib1', custom_title: null,
    quantity, unit, calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, recipe: null, ingredient,
  })
  const plan = (quantity, unit, ingredient = chicken) => plannedKcal({ recipe_id: null, servings: 1, library_ingredient_id: 'lib1', ingredient_quantity: quantity, ingredient_unit: unit, ingredient })
  for (const [q, u, want] of [[150, 'g', 248], [0.5, 'kg', 825], [150, 'gr', 248], [2, 'dl', 330], [0.5, 'l', 825], [5, 'cl', 83]]) {
    const today = unifiedToMeal(planned(q, u), '2026-10-28')
    check(`${q} ${u}: Today ${today.calories} kcal = Meal plan ${Math.round(plan(q, u))} kcal`, today.calories === want && Math.round(plan(q, u)) === want, `${today.calories} / ${plan(q, u)}`)
  }
  const kg = unifiedToMeal(planned(0.5, 'kg'), '2026-10-28')
  check('0.5 kg: protein counts too (155 g), the title keeps the typed amount', kg.protein_g === 155 && kg.title === 'Chicken breast · 0.5 kg', JSON.stringify(kg))
  const egg = { ...chicken, name: 'Egg', calories: 143 }
  check('"2 piece" can\'t be counted: 0 on Today, none on Meal plan', unifiedToMeal(planned(2, 'piece', egg), '2026-10-28').calories === 0 && plan(2, 'piece', egg) === null)
  check('no unit on a planned food reads as g on both', unifiedToMeal(planned(100, null), '2026-10-28').calories === 165 && plan(100, null) === 165)
}

console.log('\n4 · Ticking a planned food eaten stores grams / ml (the units 106\'s trigger recalculates)')
;(async () => {
  const lib = (o = {}) => ({ id: 'lib1', name: 'Chicken breast', unit: 'g', serving_grams: 150, calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, fiber_g: 0, sugar_g: 0, ...o })
  const tick = async (quantity, unit, libRow) => {
    writes.length = 0
    answer = (table) => (table === 'recipe_ingredient_library' ? { data: libRow, error: null } : { data: null, error: null })
    await eatPlannedEntry({ id: 'p1', date: '2026-10-28', meal_slot: 'dinner', recipe_id: null, custom_title: null, library_ingredient_id: 'lib1', ingredient_quantity: quantity, ingredient_unit: unit, servings: 1 })
    return writes.find(w => w.table === 'food_log_entries')?.row ?? {}
  }
  const shown = (quantity, unit, libRow) => Math.round(plannedKcal({ recipe_id: null, servings: 1, library_ingredient_id: 'lib1', ingredient_quantity: quantity, ingredient_unit: unit, ingredient: libRow }))
  let w = await tick(0.5, 'kg', lib())
  check('0.5 kg → 500 g eaten with 825 kcal — what the plan showed (was 75 g: 0.5 × the 150 g preset)', w.status === 'eaten' && w.quantity === 500 && w.unit === 'g' && w.calories === 825 && shown(0.5, 'kg', lib()) === 825, JSON.stringify(w))
  w = await tick(0.5, 'kg', lib({ serving_grams: null }))
  check('0.5 kg without a preset → 500 g with macros (was "0.5 kg" with none)', w.quantity === 500 && w.unit === 'g' && w.calories === 825, JSON.stringify(w))
  w = await tick(2, 'dl', lib({ name: 'Milk', unit: 'ml', serving_grams: 200, calories: 46 }))
  check('2 dl of a drink → 200 ml', w.quantity === 200 && w.unit === 'ml' && w.calories === 92, JSON.stringify(w))
  w = await tick(150, 'g', lib())
  check('150 g stays 150 g', w.quantity === 150 && w.unit === 'g' && w.calories === 247.5, JSON.stringify(w))
  w = await tick(2, 'piece', lib({ name: 'Egg', serving_grams: 50, calories: 143 }))
  check('"2 piece" of a food with a 50 g preset → 100 g', w.quantity === 100 && w.unit === 'g' && w.calories === 143, JSON.stringify(w))
  w = await tick(2, 'piece', lib({ name: 'Egg', serving_grams: null, calories: 143 }))
  check('"2 piece" without a preset keeps its amount, no macros (nothing to count from)', w.quantity === 2 && w.unit === 'piece' && w.calories === null, JSON.stringify(w))
  w = await tick(null, 'g', lib())
  check('no amount → the food\'s portion (150 g), never 0', w.quantity === 150 && w.unit === 'g' && w.calories === 247.5, JSON.stringify(w))

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.log(`  ✗ threw — ${e?.stack ?? e}`); process.exit(1) })
