#!/usr/bin/env node
/* Verification — what a planned row is (src/features/recipes/mealPlanRows.ts):
 * the logger's plan mode saves the same row shapes as a log, as status
 * 'planned', with no stored totals for a food or recipe; a one-off line keeps
 * its typed values; a planned row's kcal is worked out live, through the same
 * weight-unit gate as every reader. Run: node scripts/verify-meal-plan.cjs */
require('sucrase/register')
const { plannedRow, plannedKcal, MACRO_KEYS } = require('../src/features/recipes/mealPlanRows')
const { itemsToEntries } = require('../src/features/recipes/foodBasket')
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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
