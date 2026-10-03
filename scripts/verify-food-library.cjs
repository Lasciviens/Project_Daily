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
