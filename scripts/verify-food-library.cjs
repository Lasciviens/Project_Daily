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

// Today → "What's left": what is left of each target (14.10.2026). The targets
// themselves come from the goal decision (verify-cut-decision §10).
ok(typeof M.dayMacroTargets, 'undefined', 'Food derives no targets of its own (the goal decision does)')
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

// Amounts in the thing's own units, batches, the logger's basket and dishes
// (Food points 8 and 5, 16.10.2026): foodAmount.ts, foodBasket.ts, foodDish.ts.
{
  const A = require('../src/features/recipes/foodAmount')
  const B = require('../src/features/recipes/foodBasket')
  const D = require('../src/features/recipes/foodDish')

  // Words and numbers
  ok([A.plural('piece', 3), A.plural('piece', 1), A.plural('glass', 2), A.plural('berry', 2), A.plural('portion', 0.5)],
    ['pieces', 'piece', 'glasses', 'berries', 'portion'], 'plural: s, es, ies; one or less stays one (½ portion)')
  ok([A.formatCount(0.5), A.formatCount(1.5), A.formatCount(2.25), A.formatCount(3), A.formatCount(2.333)], ['½', '1½', '2¼', '3', '2.3'], 'counts read as people say them')
  ok([A.countLabel(3, 'piece'), A.countLabel(0.5, 'portion'), A.portionWord(null), A.portionWord(' slice ')], ['3 pieces', '½ portion', 'portion', 'slice'],
    'a recipe without a portion name says "portion"')

  // A food: g and its preset
  const rice = { unit: 'g', serving_label: '1 portion', serving_grams: 200 }
  const fm = A.foodAmountModel(rice)
  ok(fm.units.map(u => u.id + ':' + u.label + ':' + u.perUnit), ['g:g:1', 'preset:portion:200'], 'a food: grams and its preset as a unit')
  ok(A.amountChips(fm, 'g', { last: 150 }).map(c => [c.label, c.hint ?? '', c.base]),
    [['½ portion', '', 100], ['1 portion', '200 g', 200], ['150 g last time', '', 150]], 'grams: ½ and 1 preset, then last time (the design\'s three chips)')
  ok(A.amountChips(fm, 'g', { last: 200 }).length, 2, 'last time equal to a chip is not offered twice')
  ok(A.amountChips(fm, 'preset').map(c => c.label), ['½ portion', '1 portion', '1½ portions', '2 portions'], 'in the preset unit the chips count it')
  ok([A.amountHint(fm, 'g', 100), A.amountHint(fm, 'preset', 300), A.amountHint(A.foodAmountModel({ unit: 'ml', serving_label: null, serving_grams: null }), 'ml', 330)],
    ['= ½ portion', '= 300 g', null], '"= ½ portion" beside grams, grams beside the preset, nothing without a preset')
  ok(A.amountChips(A.foodAmountModel({ unit: 'ml', serving_label: null, serving_grams: null }), 'ml').map(c => c.label), ['100 ml'], 'a drink without a preset: 100 ml')

  // A recipe: its portion word, % of batch, g raw, g cooked
  const kofte = { id: 'k', servings: 20, serving_label: 'piece', ingredients: [{ quantity: 1000, unit: 'g' }, { quantity: 1, unit: 'dl' }, { quantity: null, unit: null }] }
  ok(A.rawWeight(kofte), 1100, 'raw weight: grams, a dl as 100 g, "to taste" skipped')
  ok(A.rawWeight({ ingredients: [{ quantity: 2, unit: 'pcs' }, { quantity: 100, unit: 'g' }] }), 0, 'a piece count means no raw weight')
  const now = new Date('2026-10-17T12:00:00')
  const rows = [
    { id: 'e1', recipe_id: 'k', date: '2026-10-16', created_at: '2026-10-16T19:00:00', quantity: 3 },
    { id: 'e2', recipe_id: 'k', date: '2026-10-17', created_at: '2026-10-17T11:00:00', quantity: 3 },
    { id: 'e0', recipe_id: 'k', date: '2026-10-16', created_at: '2026-10-16T12:00:00', quantity: 2 },
    { id: 'e3', recipe_id: 'k', date: '2026-10-15', created_at: '2026-10-16T20:00:00', quantity: 1 },
    { id: 'x', recipe_id: 'other', date: '2026-10-17', created_at: '2026-10-17T11:00:00', quantity: 5 },
    { id: 'p', recipe_id: 'k', date: '2026-10-17', created_at: '2026-10-17T11:30:00', quantity: 1, status: 'planned' },
  ]
  const withBatch = { ...kofte, batch_started_at: '2026-10-16T18:00:00', batch_servings: 20, batch_cooked_g: 1800 }
  const bs = A.batchState(withBatch, rows, now)
  ok([bs.startDay, bs.servings, bs.eaten, bs.left, bs.expired, bs.active, bs.cookedG], ['2026-10-16', 20, 6, 14, false, true, 1800],
    'leftovers: 20 − the 6 eaten since the batch started (not before it, not backfilled to an earlier day, not planned, not another recipe)')
  ok(A.batchState(withBatch, rows, now, 'e2').left, 17, 'the entry being edited is left out')
  ok(A.batchState(withBatch, rows, new Date('2026-10-20T18:00:00')).expired, true, 'a batch is over after 4 days')
  ok(A.batchState(withBatch, rows, new Date('2026-10-20T17:59:00')).expired, false, '… and not a minute before')
  ok(A.batchState({ ...withBatch, batch_servings: 6 }, rows, now).active, false, 'eaten up: no batch on the go')
  ok(A.batchState(kofte, rows, now), null, 'no batch was ever started')
  ok(A.batchState({ ...withBatch, batch_servings: null }, rows, now).servings, 20, 'a batch without its size counts the recipe\'s servings')

  const rm = A.recipeAmountModel(withBatch, bs)
  ok(rm.units.map(u => u.id + ':' + u.label), ['portion:piece', 'pct:% of batch', 'raw:g raw', 'cooked:g cooked'], 'a recipe: piece, % of batch, g raw, g cooked')
  ok([A.fromUnit(rm.units[1], 50), A.fromUnit(rm.units[2], 110), A.fromUnit(rm.units[3], 270)], [10, 2, 3], '50 % = 10 pieces; 110 g raw = 2; 270 g cooked = 3')
  ok(A.recipeAmountModel(withBatch, null).units.map(u => u.id), ['portion', 'pct', 'raw'], 'g cooked only while the batch is on and its pot weighed')
  const doubleBatch = A.batchState({ ...withBatch, batch_servings: 40 }, [], now)
  ok(A.fromUnit(A.recipeAmountModel(withBatch, doubleBatch).units[1], 25), 10, '% counts against the current batch (a double batch of 40)')
  ok(A.amountChips(rm, 'portion', { batch: bs, last: 3 }).map(c => c.label + (c.hint ? ' ' + c.hint : '')),
    ['1 piece', '2 pieces', '3 pieces', '4 pieces', 'The rest 14 pieces'], 'piece chips, "The rest" of the batch; last time already a chip')
  ok(A.amountChips(rm, 'pct').map(c => c.base), [5, 10, 15, 20], '25–100 % of the batch')
  ok(A.amountChips(rm, 'raw').map(c => c.label + ' ' + c.hint), ['1 piece 55 g', '2 pieces 110 g'], 'grams: one and two pieces in grams')
  ok(A.amountChips(A.recipeAmountModel({ servings: 1, ingredients: [] }, null), 'portion').map(c => c.label), ['½ portion', '1 portion', '1½ portions', '2 portions'],
    'a one-portion saved meal: ½ to 2')
  ok([A.amountHint(rm, 'portion', 3), A.amountHint(rm, 'pct', 5), A.amountHint(rm, 'cooked', 1.5)], ['= 15% of batch', '= 5 pieces', '= 1½ pieces'], 'the other main unit beside the field')
  const u = (kind) => ({ id: 'x', label: 'x', perUnit: 1, kind })
  ok([A.stepValue(u('count'), 3, 1), A.stepValue(u('count'), 1, -1), A.stepValue(u('count'), 0.5, 1), A.stepValue(u('count'), 2.5, -1), A.stepValue(u('count'), 2.5, 1)],
    [4, 0.5, 1, 2, 3], 'count steps: by one, ½ at the bottom, round values')
  ok([A.stepValue(u('weight'), 150, 1), A.stepValue(u('weight'), 155, -1), A.stepValue(u('weight'), 10, -1), A.stepValue(u('percent'), 27, 1)], [160, 150, 10, 30],
    'grams by 10, % by 5, never below one step')

  ok(A.batchBar({ servings: 20, eaten: 6 }, 3), { eaten: 6, this: 3, left: 11, over: 0, total: 20 }, 'the bar: eaten | this | left')
  ok(A.batchBar({ servings: 20, eaten: 18 }, 4), { eaten: 18, this: 2, left: 0, over: 2, total: 22 }, 'more than left: 2 over (hatched, "2 more than left")')

  // The logger's basket: foods, a saved meal's portion, a dish's one-off line
  const food = (o) => ({ id: 'x', name: 'x', unit: 'g', calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, serving_label: null, serving_grams: null, ...o })
  const chicken = food({ id: 'c', name: 'Chicken breast, raw', calories: 106, protein_g: 23, carbs_g: 0, fat_g: 1.5 })
  const recipe = { id: 'k', title: 'Køfte', servings: 20, serving_label: 'piece', macro_mode: 'from_ingredients', calories: 100, protein_g: 10, carbs_g: 1, fat_g: 6.5, fiber_g: 0, sugar_g: 0,
    ingredients: [{ name: 'Kjøttdeig', quantity: 1000, unit: 'g', note: null, library_ingredient_id: 'm' }] }
  const basket = [{ ingredient: chicken, grams: 150 }, { kind: 'recipe', recipe, servings: 3 }]
  ok(B.basketTotals(basket).kcal, 459, 'totals: 150 g chicken (159) + 3 pieces of køfte (300)')
  ok(basket.map(B.itemAmount), ['150 g', '3 pieces'], 'the basket says "Køfte · 3 pieces"')
  ok(B.itemsToEntries(basket, { date: '2026-10-16', slot: 'dinner', groupId: 'g1', groupTitle: 'Køfte plate' }), [
    { date: '2026-10-16', meal_slot: 'dinner', library_ingredient_id: 'c', quantity: 150, unit: 'g', calories: 159, protein_g: 34.5, carbs_g: 0, fat_g: 2.25, fiber_g: null, sugar_g: null, meal_group_id: 'g1', meal_group_title: 'Køfte plate' },
    { date: '2026-10-16', meal_slot: 'dinner', recipe_id: 'k', quantity: 3, unit: 'serving', calories: 300, protein_g: 30, carbs_g: 3, fat_g: 19.5, fiber_g: 0, sugar_g: 0, meal_group_id: 'g1', meal_group_title: 'Køfte plate' },
  ], 'Log: a food by grams and a recipe by servings, both in the dish')
  ok(B.itemsToEntries([{ kind: 'custom', title: 'Salsa', macros: { kcal: 30, protein: 1, carbs: 6, fat: 0, fiber: 1, sugar: 4 }, entryId: 'e9' }], { date: '2026-10-16', slot: 'dinner' }), [],
    'a dish\'s one-off line is already a row — never logged twice')
  ok([B.itemMissingAmount({ kind: 'recipe', recipe, servings: 0 }), B.itemMissingAmount({ ingredient: chicken, grams: 0 })], [true, true], 'a 0 amount is caught for every kind')

  const fromFoods = B.basketToRecipeInput([{ ingredient: chicken, grams: 150 }, { kind: 'recipe', recipe, servings: 10 }], ' Lunch box ', 2)
  ok([fromFoods.title, fromFoods.macro_mode, fromFoods.servings, fromFoods.ingredients.map(i => `${i.name} ${i.quantity}${i.unit}`)],
    ['Lunch box', 'from_ingredients', 2, ['Chicken breast, raw 150g', 'Kjøttdeig 500g']], 'a saved meal from foods and half a batch: the batch\'s foods for that share, macros follow them')
  const withLine = B.basketToRecipeInput([{ ingredient: chicken, grams: 100 }, { kind: 'custom', title: 'Salsa', macros: { kcal: 30, protein: 1, carbs: 6, fat: 0, fiber: 1, sugar: 4 }, entryId: 'e9' }], 'Taco', 1)
  ok([withLine.macro_mode, withLine.calories, withLine.protein_g, withLine.ingredients[1]], ['manual', 136, 24, { name: 'Salsa', quantity: null, unit: null, note: '30 kcal', library_ingredient_id: null }],
    'a one-off line inside: typed macros (the basket\'s own totals per portion), the line kept by name')

  // Dishes
  ok([D.shortFoodName('White rice, boiled (ris, kokt)'), D.shortFoodName('Chicken (grilled)'), D.shortFoodName('Køfte')], ['White rice', 'Chicken', 'Køfte'], 'a food\'s short name for a dish title')
  ok([D.dishAutoName(['Rice', 'Chicken breast, raw']), D.dishAutoName(['A', 'B', 'C', 'D', 'E']), D.dishAutoName(['Rice', 'rice']), D.dishAutoName([])],
    ['Rice + Chicken breast', 'A + B + C +2', 'Rice', 'Meal'], 'the automatic name: item names without amounts, at most three, then +N')
  ok([D.dishName('Taco plate', ['x']), D.dishName('  ', ['Rice', 'Chicken'])], ['Taco plate', 'Rice + Chicken'], 'its own name wins; blank means automatic')
  ok([D.dishAmount([{ quantity: 150, unit: 'g' }, { quantity: 100, unit: 'g' }]), D.dishAmount([{ quantity: 330, unit: 'ml' }]), D.dishAmount([{ quantity: 150, unit: 'g' }, { quantity: 3, unit: 'serving' }]),
    D.dishAmount([{ quantity: 150, unit: 'g' }, { quantity: 200, unit: 'ml' }]), D.dishAmount([{ quantity: null, unit: null }, { quantity: 2, unit: 'g' }])],
  ['250 g', '330 ml', '2 items', '2 items', '2 items'], 'Amount: summed grams, or "N items" when a piece count (or a one-off line) is inside')
  const lib = new Map([['c', chicken]]), recs = new Map([['k', recipe]])
  const row = (o) => ({ id: 'r', title: 't', library_ingredient_id: null, recipe_id: null, quantity: null, unit: null, calories: 30, protein_g: 1, carbs_g: 6, fat_g: 0, fiber_g: 1, sugar_g: 4, ...o })
  ok([D.rowToItem(row({ library_ingredient_id: 'c', quantity: 150, unit: 'g' }), lib, recs).grams, D.rowToItem(row({ recipe_id: 'k', quantity: 3, unit: 'serving' }), lib, recs).servings,
    D.rowToItem(row({ title: 'Salsa' }), lib, recs).kind, D.rowToItem(row({ library_ingredient_id: 'c', quantity: 2, unit: 'pcs' }), lib, recs).kind, D.rowToItem(row({ library_ingredient_id: 'gone', quantity: 100, unit: 'g' }), lib, recs).kind],
  [150, 3, 'custom', 'custom', 'custom'], 'Edit meal\'s basket: a weighed food, a recipe portion, else the line as it is')
}

console.log(`verify-food-library: ${n} assertions passed`)
