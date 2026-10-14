#!/usr/bin/env node
/* Verification — foodLibraryModel.ts (Library + Ingredients: usage, density, filters, sorts). */
require('sucrase/register')
const assert = require('node:assert/strict')
const M = require('../src/features/recipes/foodLibraryModel')
let n = 0
const ok = (a, e, m) => { assert.deepStrictEqual(a, e, m); n++ }

// Usage
const usage = M.buildUsage([
  { date: '2026-09-01', meal_slot: 'lunch', recipe_id: 'r1', library_ingredient_id: null, calories: 500, protein_g: 40 },
  { date: '2026-09-20', meal_slot: 'dinner', recipe_id: 'r1', library_ingredient_id: null, calories: 500, protein_g: 40 },
  { date: '2026-09-10', meal_slot: 'snack', recipe_id: null, library_ingredient_id: 'i1', calories: 120, protein_g: 24 },
  { date: '2026-09-11', meal_slot: 'snack', recipe_id: null, library_ingredient_id: null, calories: 300, protein_g: 5 },
])
ok(usage.get('r:r1'), { count: 2, lastDate: '2026-09-20', kcal: 1000, protein: 80 }, 'recipe usage: count, latest day, totals')
ok(usage.get('i:i1').count, 1, 'food usage')
ok(usage.size, 2, 'custom lines have no usage key')

// Density
ok(M.proteinDensity(400, 40), 10, 'g protein per 100 kcal')
ok(M.proteinDensity(0, 10), null, 'no kcal → no density')
ok([M.isHighProtein(600, 30), M.isHighProtein(150, 12), M.isHighProtein(150, 8), M.isHighProtein(900, 20)], [true, true, false, false], 'high protein: 25 g+, or 8 g/100 kcal with 10 g+')

const rec = (id, o) => ({ id, title: id, description: null, servings: 1, instructions: null, macro_mode: 'manual', calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, image_url: null, source_url: null, times_cooked: 0, category: null, is_temp: false, created_at: '2026-01-01', updated_at: '2026-01-01', ingredients: [], user_id: 'u', ...o })
const recipes = [
  rec('Bowl', { calories: 600, protein_g: 45, category: 'lunch', ingredients: [{ name: 'Kylling' }], created_at: '2026-03-01' }),
  rec('Cake', { calories: 450, protein_g: 6, category: 'snack', times_cooked: 3, created_at: '2026-02-01' }),
  rec('Soup', { calories: null, protein_g: null, category: 'dinner', created_at: '2026-04-01' }),
  rec('Saved', { calories: 300, protein_g: 30, is_temp: true }),
]
const F = { query: '', category: 'all', flags: [] }
ok(M.filterRecipes(recipes, F).map(r => r.id), ['Bowl', 'Cake', 'Soup'], 'saved meals stay out of the Library')
ok(M.filterRecipes(recipes, { ...F, flags: ['saved'] }).map(r => r.id), ['Saved'], 'the Saved meals flag shows only them')
ok(M.filterRecipes(recipes, { ...F, flags: ['high-protein'] }).map(r => r.id), ['Bowl'], 'high protein filter')
ok(M.filterRecipes(recipes, { ...F, flags: ['light'] }).map(r => r.id), ['Cake'], 'under 500 kcal (a recipe without macros is not "light")')
ok(M.filterRecipes(recipes, { ...F, flags: ['no-macros'] }).map(r => r.id), ['Soup'], 'no macros filter')
ok(M.filterRecipes(recipes, { ...F, query: 'kylling' }).map(r => r.id), ['Bowl'], 'search reaches ingredient names')
ok(M.filterRecipes(recipes, { ...F, category: 'dinner' }).map(r => r.id), ['Soup'], 'category')

const lib = recipes.slice(0, 3)
const ids = rs => rs.map(r => r.id)
ok(ids(M.sortRecipes(lib, 'recent', new Map([['r:Cake', { count: 1, lastDate: '2026-09-30', kcal: 0, protein: 0 }]]))), ['Cake', 'Bowl', 'Soup'], 'recently eaten first, never-eaten by last edit')
ok(ids(M.sortRecipes(lib, 'protein', new Map())), ['Bowl', 'Cake', 'Soup'], 'most protein, no macros last')
ok(ids(M.sortRecipes(lib, 'density', new Map())), ['Bowl', 'Cake', 'Soup'], 'protein per kcal')
ok(ids(M.sortRecipes(lib, 'kcal-low', new Map())), ['Cake', 'Bowl', 'Soup'], 'fewest kcal, unknown last')
ok(ids(M.sortRecipes(lib, 'kcal-high', new Map())), ['Bowl', 'Cake', 'Soup'], 'most kcal, unknown still last')
ok(ids(M.sortRecipes(lib, 'cooked', new Map())), ['Cake', 'Bowl', 'Soup'], 'most cooked, never cooked by title')
ok(ids(M.sortRecipes(lib, 'new', new Map())), ['Soup', 'Bowl', 'Cake'], 'newest first')

// Library: today's room, "Fits today", one search over recipes and foods (13.10.2026)
ok(M.dayRemaining({ calories: 2300, protein: 180 }, { calories: 1668, protein_g: 121.6 }), { kcal: 632, protein: 58 }, 'left today = targets − eaten')
ok(M.dayRemaining({ calories: 2000, protein: 150 }, null), { kcal: 2000, protein: 150 }, 'nothing eaten yet → the whole target')
ok(M.dayRemaining({ calories: 2000, protein: 150 }, { calories: 2250, protein_g: 160 }), { kcal: -250, protein: -10 }, 'over target → negative')

// Today → "What's left": four targets from the goal, and what is left of each (14.10.2026)
ok(M.dayMacroTargets({ calories: 2200, protein: 160 }), { kcal: 2200, protein: 160, carbs: 226, fat: 73 },
  'kcal and protein are the goal; fat 30 % of the kcal (660 / 9 = 73 g), carbs the rest ((2200 − 640 − 657) / 4)')
ok(M.dayMacroTargets({ calories: 2200, protein: 160 }, 50), { kcal: 2200, protein: 160, carbs: 226, fat: 73 }, 'a fat floor under the 30 % changes nothing')
ok(M.dayMacroTargets({ calories: 1500, protein: 180 }, 60), { kcal: 1500, protein: 180, carbs: 60, fat: 60 }, 'a fat floor over the 30 % lifts fat and carbs give way')
ok(M.dayMacroTargets({ calories: 1200, protein: 250 }), { kcal: 1200, protein: 250, carbs: 0, fat: 40 }, 'carbs never go below 0')
ok(M.dayMacroTargets({ calories: 2199.6, protein: 159.5 }, null), { kcal: 2200, protein: 160, carbs: 226, fat: 73 }, 'whole numbers; no floor = none')
const T = { kcal: 2200, protein: 160, carbs: 226, fat: 73 }
const left = M.macrosLeft(T, { calories: 2320, protein_g: 120.4, carbs_g: 180, fat_g: 80 })
ok(left.map(m => m.key), ['kcal', 'protein', 'carbs', 'fat'], 'always kcal, protein, carbs, fat')
ok(left.map(m => m.left), [-120, 40, 46, -7], 'left = target − eaten (rounded); over a goal is negative: +120 kcal over, +7 g fat over')
ok(left.map(m => m.eaten), [2320, 120, 180, 80], 'eaten, rounded')
ok([left[0].share, left[1].share, left[3].share], [1, 0.75, 1], 'the bar: share of the target eaten, full when over')
ok(M.macrosLeft(T, undefined).map(m => [m.left, m.share]), [[2200, 0], [160, 0], [226, 0], [73, 0]], 'nothing eaten (or still loading) → the whole target left')
ok(M.macrosLeft({ kcal: 0, protein: 0, carbs: 0, fat: 0 }, { calories: 100 }).map(m => m.share), [1, 0, 0, 0], 'no target: a full bar once something is eaten, empty before')
ok([M.fitsCalories(450, 500), M.fitsCalories(500, 500), M.fitsCalories(501, 500), M.fitsCalories(null, 500), M.fitsCalories(0, 500), M.fitsCalories(300, null), M.fitsCalories(300, -20)],
  [true, true, false, false, false, false, false], 'fits: known kcal ≤ left; unknown kcal, unknown room or none left never fits')
ok(M.filterRecipes(recipes, { ...F, flags: ['fits'], kcalLeft: 500 }).map(r => r.id), ['Cake'], 'Fits today: 450 kcal fits 500 left, 600 and no-macros do not')
ok(M.filterRecipes(recipes, { ...F, flags: ['fits'], kcalLeft: null }).map(r => r.id), [], 'Fits today while the day is loading shows nothing, never everything')
ok(M.filterRecipes(recipes, { ...F, flags: ['fits', 'high-protein'], kcalLeft: 700 }).map(r => r.id), ['Bowl'], 'Fits today + High protein combine')
ok(M.filterRecipes([rec('Lettost toast', { title: 'Brødskive med ost', calories: 300 })], { ...F, query: 'brod' }).length, 1, 'search folds ø (brød = brod)')
ok(M.filterRecipes([rec('Soup', { title: 'Mercimek çorbası', calories: 240 })], { ...F, query: 'CORBASI' }).length, 1, 'search folds Turkish letters and case')
{
  const f = (id, o) => ({ id, name: id, unit: 'g', calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, serving_label: null, serving_grams: null, food_group_id: null, food_group: null, image_url: null, source: null, source_ref: null, created_at: '2026-01-01', user_id: 'u', ...o })
  const pool = [
    f('Kyllingfilet, rå', { calories: 106, protein_g: 23, carbs_g: 0, fat_g: 1.5 }),
    f('Kylling pålegg', { calories: 100, protein_g: 20, serving_label: '1 slice', serving_grams: 15 }),
    f('Whey', { calories: 380, protein_g: 80, carbs_g: 6, fat_g: 2, serving_label: '1 scoop', serving_grams: 30 }),
    f('Milk drink', { unit: 'ml', calories: 64, protein_g: 3.4 }),
    f('Cheesecake', { calories: 520, protein_g: 6, serving_label: '1 slice', serving_grams: 120 }),
  ]
  const S = (q, o = {}) => M.searchFoods(pool, { ...F, query: q, ...o }).map(h => h.food.id)
  ok(M.defaultPortion(pool[2]), { food: pool[2], grams: 30, portion: '1 scoop (30 g)', kcal: 114, protein: 24 }, 'a food with a preset logs that portion')
  ok(M.defaultPortion(pool[0]), { food: pool[0], grams: 100, portion: '100 g', kcal: 106, protein: 23 }, 'no preset → 100 g')
  ok(M.defaultPortion(pool[3]).portion, '100 ml', 'a drink stored per 100 ml says ml')
  ok(S(''), [], 'no search → no foods (the Library lists recipes)')
  ok(S('PALEGG'), ['Kylling pålegg'], 'å folds to a, case ignored')
  ok(S('kyl'), ['Kylling pålegg', 'Kyllingfilet, rå'], 'ranked like the logger: starts-with, shorter name first')
  ok(S('kyl', { category: 'dinner' }), [], 'a meal-type category shows recipes only')
  ok(S('kyl', { flags: ['saved'] }), [], 'the Saved meals view shows recipes only')
  ok(S('e', { flags: ['fits'], kcalLeft: 120 }), ['Whey', 'Kylling pålegg', 'Kyllingfilet, rå'], 'Fits today judges the portion + logs: a 30 g scoop (114 kcal) fits 120 left, a 120 g cheesecake slice (624) does not')
  ok(S('milk', { flags: ['fits'], kcalLeft: 64 }), ['Milk drink'], 'exactly the room left fits')
  ok(S('milk', { flags: ['high-protein'] }), [], 'high protein is per 100 g (milk is not)')
  ok(S('cheese', { flags: ['light'] }), [], 'Under 500 kcal judges the portion (a 624 kcal slice)')
  ok(S('cheese', { flags: ['no-macros'] }), [], 'No macros hides foods that have them')
}

// The basket (logger + recipe builder): live totals, portions, saved rows
{
  const B = require('../src/features/recipes/foodBasket')
  const food = (o) => ({ id: 'x', name: 'x', unit: 'g', calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, serving_label: null, serving_grams: null, ...o })
  const chicken = food({ id: 'c', name: 'Chicken', calories: 106, protein_g: 23, carbs_g: 0, fat_g: 1.5 })
  const rice = food({ id: 'r', name: 'Rice', calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3, fiber_g: 0.4 })
  const oil = food({ id: 'o', name: 'Olive oil', unit: 'ml', calories: 884, fat_g: 100, serving_label: '1 tbsp', serving_grams: 13 })
  const basket = [{ ingredient: chicken, grams: 180 }, { ingredient: rice, grams: 200 }, { ingredient: oil, grams: 13 }]
  const t = B.basketTotals(basket)
  ok([Math.round(t.kcal * 10) / 10, Math.round(t.protein * 10) / 10, Math.round(t.carbs * 10) / 10, Math.round(t.fat * 10) / 10], [565.7, 46.8, 56, 16.3], 'basket totals: per 100 g × grams, summed')
  ok(B.basketTotals([{ ingredient: chicken, grams: 0 }]).kcal, 0, 'an empty amount adds nothing')
  ok(B.perPortion(t, 2), { kcal: 282.9, protein: 23.4, carbs: 28, fat: 8.2, fiber: 0.4, sugar: 0 }, 'per portion: ÷ portions, rounded to 0.1 like the saved recipe')
  ok(B.perPortion(t, 0).kcal, 565.7, 'portions below 1 count as 1')
  ok([B.wholePortions('2.6'), B.wholePortions(''), B.wholePortions('0'), B.wholePortions(4)], [3, 1, 1, 4], 'portions are whole numbers ≥ 1 (an integer column)')
  ok(B.basketToIngredients(basket), [
    { name: 'Chicken', quantity: 180, unit: 'g', note: null, library_ingredient_id: 'c' },
    { name: 'Rice', quantity: 200, unit: 'g', note: null, library_ingredient_id: 'r' },
    { name: 'Olive oil', quantity: 13, unit: 'ml', note: null, library_ingredient_id: 'o' },
  ], 'saved rows: every one library-linked by weight (ml for drinks)')
  ok(B.portionSteps({ ingredient: oil, grams: 26 }), { size: 13, count: 2, label: 'tbsp' }, '− / + steps by the preset')
  ok(B.portionSteps({ ingredient: chicken, grams: 180 }), null, 'no preset → no stepper')
  ok([B.lastGrams({ quantity: 150, unit: 'g' }), B.lastGrams({ quantity: 330, unit: 'ml' }), B.lastGrams({ quantity: 2, unit: 'pcs' }), B.lastGrams({ quantity: 0, unit: 'g' }), B.lastGrams({ quantity: 1, unit: 'kg' })],
    [150, 330, undefined, undefined, undefined], 'a recent amount is reused only when it is grams / ml')
  ok([B.amountUnit('ML'), B.amountUnit(null), B.amountUnit('g')], ['ml', 'g', 'g'], 'amount unit')
}

// Foods
const food = (id, o) => ({ id, name: id, unit: 'g', calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, serving_label: null, serving_grams: null, food_group_id: null, food_group: null, image_url: null, source: null, source_ref: null, created_at: '2026-01-01', user_id: 'u', ...o })
const foods = [
  food('Chicken', { calories: 110, protein_g: 23, carbs_g: 0, fat_g: 1.5, food_group: 'Meat and poultry' }),
  food('Rice', { calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3, food_group: 'Cereals, bread and cakes' }),
  food('Lettost', { calories: 157.6, protein_g: 30, carbs_g: 1.5, fat_g: 16 }),
  food('Mystery', {}),
]
ok([M.macrosMismatch(foods[0]), M.macrosMismatch(foods[2])], [false, true], "Lettost's 157.6 kcal vs ~270 implied is flagged")
ok(M.isHighProteinFood(foods[0]), true, 'chicken is high protein per 100 g')
const fu = new Map([['i:Rice', { count: 5, lastDate: '2026-09-29', kcal: 0, protein: 0 }]])
const used = new Map([['Chicken', 2]])
const FF = { query: '', group: null, flags: [] }
ok(M.filterFoods(foods, { ...FF, flags: ['used'] }, fu, used).map(f => f.id), ['Chicken', 'Rice'], 'eaten lately or in a recipe counts as used')
ok(M.filterFoods(foods, { ...FF, flags: ['unused'] }, fu, used).map(f => f.id), ['Lettost', 'Mystery'], 'unused')
ok(M.filterFoods(foods, { ...FF, flags: ['no-macros'] }, fu, used).map(f => f.id), ['Mystery'], 'no macros')
ok(M.filterFoods(foods, { ...FF, flags: ['mismatch'] }, fu, used).map(f => f.id), ['Lettost'], "macros don't add up")
ok(M.filterFoods(foods, { ...FF, group: '__other' }, fu, used).map(f => f.id), ['Lettost', 'Mystery'], 'Other = no food group')
ok(M.sortFoods(foods, 'recent', fu).map(f => f.id)[0], 'Rice', 'recently eaten first')
ok(M.sortFoods(foods, 'density', fu).map(f => f.id), ['Chicken', 'Lettost', 'Rice', 'Mystery'], 'protein per kcal, unknown last')
ok(M.recipeUseCounts([rec('A', { ingredients: [{ library_ingredient_id: 'x' }, { library_ingredient_id: 'x' }] }), rec('B', { ingredients: [{ library_ingredient_id: 'x' }] })]).get('x'), 2, 'a recipe counts once per food')
ok(M.portionMacros(food('Whey', { calories: 400, protein_g: 80, carbs_g: 8, fat_g: 6, serving_grams: 30 })), { grams: 30, calories: 120, protein_g: 24, carbs_g: 2.4, fat_g: 1.8 }, 'macros for one portion')
ok(M.portionMacros(foods[0]), null, 'no portion preset → null')

{
  const check = (m, c, d) => { assert.ok(c, d ? `${m} — ${d}` : m); n++ }
  const R = (id, title, cal, p) => ({ id, title, calories: cal, protein_g: p, carbs_g: 0, fat_g: 0, ingredients: [], is_temp: false })
  const Fd = (id, name, cal, p, extra = {}) => ({ id, name, unit: 'g', calories: cal, protein_g: p, carbs_g: 0, fat_g: 0, serving_label: null, serving_grams: null, ...extra })
  const used = M.buildUsage([{ date: '2026-10-01', meal_slot: 'lunch', library_ingredient_id: 'f1', recipe_id: null, calories: 100, protein_g: 20 }])
  const recipes = [R('r1', 'Chicken bowl', 600, 50), R('r2', 'Pasta', 700, 15), R('r3', 'Big feast', 1500, 90)]
  const foods = [Fd('f1', 'Skyr', 60, 11), Fd('f2', 'Whey', 380, 80, { serving_label: '1 scoop', serving_grams: 30 }), Fd('f3', 'Random cod', 80, 18)]
  const s = M.suggestForRemaining({ recipes, foods, usage: used, kcalLeft: 800, proteinLeft: 40 })
  check('a portion over the calories left is never offered', !s.some(x => x.id === 'r3'))
  check('foods never eaten and without a portion are left out', !s.some(x => x.id === 'f3'))
  check('whey scoop (30 g → 114 kcal, 24 g P) ranks first', s[0] && s[0].id === 'f2' && s[0].quantity === 30 && s[0].kcal === 114, JSON.stringify(s[0]))
  check('protein-dense ranks above protein-poor', s.findIndex(x => x.id === 'r1') < s.findIndex(x => x.id === 'r2') || !s.some(x => x.id === 'r2'))
  check('nothing when little protein is left', M.suggestForRemaining({ recipes, foods, usage: used, kcalLeft: 800, proteinLeft: 5 }).length === 0)
  check('nothing when few calories are left', M.suggestForRemaining({ recipes, foods, usage: used, kcalLeft: 50, proteinLeft: 60 }).length === 0)
}

console.log(`verify-food-library: ${n} assertions passed`)
