#!/usr/bin/env node
/* Verification — foodIngredients.ts (Today's macro peek, Insights' most used ingredients). */
require('sucrase/register')
const assert = require('node:assert/strict')
const F = require('../src/features/recipes/foodIngredients')
let n = 0
const ok = (a, e, m) => { assert.deepStrictEqual(a, e, m); n++ }
const near = (a, e, m) => { assert.ok(Math.abs(a - e) < 1e-6, `${m}: ${a} ≠ ${e}`); n++ }
const M = (calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g) => ({ calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g })
const food = (id, name, unit, m) => ({ id, name, unit, ...m })

const library = new Map([
  food('chk', 'Chicken breast', 'g', M(106, 23, 0, 1.5, 0, 0)),
  food('rice', 'Basmati rice', 'g', M(130, 2.7, 28, 0.3, 0.4, 0.1)),
  food('oil', 'Olive oil', 'ml', M(884, 0, 0, 100, 0, 0)),
  food('ban', 'Banana', 'g', M(89, 1.1, 23, 0.3, 2.6, 12)),
].map(f => [f.id, f]))
const ing = (name, quantity, unit, library_ingredient_id = null) => ({ name, quantity, unit, library_ingredient_id })
const bowl = { id: 'bowl', title: 'Chicken bowl', servings: 4, macro_mode: 'from_ingredients', ingredients: [
  ing('Chicken breast', 800, 'g', 'chk'), ing('Basmati rice', 700, 'g', 'rice'), ing('Olive oil', 30, 'ml', 'oil'),
  ing('Banana', 1, 'pcs', 'ban'), ing('Salt', 5, 'g'),
] }
const oats = { id: 'oats', title: 'Overnight oats', servings: 1, macro_mode: 'manual', ingredients: [ing('Banana', 118, 'g', 'ban'), ing('Oats', 60, 'g')] }
const mix = { id: 'mix', title: 'Oil mix', servings: 1, macro_mode: 'from_ingredients', ingredients: [ing('Olive oil', 10, 'ml', 'oil')] }
const recipes = new Map([bowl, oats, mix].map(r => [r.id, r]))
const line = (title, o, macros) => ({ title, library_ingredient_id: null, recipe_id: null, quantity: null, unit: null, ...o, macros })

// ── splitTitleQty / macroAmounts / diaryLineFromMeal ─────────────────────────
ok(F.splitTitleQty('Chicken · 150g'), { name: 'Chicken', qty: '150g' }, 'the amount after " · " splits off')
ok(F.splitTitleQty('Fish · chips'), { name: 'Fish · chips', qty: null }, 'a name with " · " stays whole')
ok(F.splitTitleQty('A · B · 2×'), { name: 'A · B', qty: '2×' }, 'only the last " · " can be an amount')
ok(F.macroAmounts({ calories: '12.5', protein_g: null }), M(12.5, 0, 0, 0, 0, 0), 'strings count, nulls are 0')
const meal = { title: 'Chicken breast · 180g', source: 'log', ...M(191, 41, 0, 3, 0, 0), logEntry: { library_ingredient_id: 'chk', recipe_id: null, custom_title: null, quantity: 180, unit: 'g' } }
ok(F.diaryLineFromMeal({ ...meal, source: 'plan' }), null, 'a planned row is no diary line')
ok(F.diaryLineFromMeal({ ...meal, exact: M(190.8, 41.4, 0, 2.7, 0, 0) }).macros.fat_g, 2.7, 'the exact values win over the rounded figures')
ok(F.diaryLineFromMeal(meal), { title: 'Chicken breast', library_ingredient_id: 'chk', recipe_id: null, quantity: 180, unit: 'g', macros: M(191, 41, 0, 3, 0, 0) }, 'without exact values the figures are used')

// ── recipeParts ──────────────────────────────────────────────────────────────
const parts = F.recipeParts(bowl, 1.5, library)
ok(parts.map(p => [p.key, p.title, p.grams, p.unit]), [
  ['i:chk', 'Chicken breast', 300, 'g'], ['i:rice', 'Basmati rice', 262.5, 'g'], ['i:oil', 'Olive oil', 11.25, 'ml'],
  ['i:ban', 'Banana', null, 'g'], ['n:salt', 'Salt', 1.875, 'g'],
], 'grams × eaten / servings; "1 pcs" has no grams; an unlinked food is keyed by its name; olive oil is ml')
near(parts[0].macros.calories, 318, 'chicken: 300 g × 106 / 100')
ok([parts[3].macros, parts[4].macros], [null, null], 'no macros without a weight or a linked food')
const twice = F.recipeParts({ ...bowl, ingredients: [ing('Chicken breast', 100, 'g', 'chk'), ing('chicken', 50, 'g', 'chk')] }, 4, library)
ok([twice.length, twice[0].grams], [1, 150], 'the same food listed twice is one part')

// ── lineContributors ─────────────────────────────────────────────────────────
const bowlLine = line('Chicken bowl', { recipe_id: 'bowl', quantity: 1.5, unit: 'serving' }, M(760, 76, 73.5, 16.5, 1, 0.3))
const split = F.lineContributors(bowlLine, recipes, library)
ok(split.map(c => c.key), ['i:chk', 'i:rice', 'i:oil'], 'a from-ingredients recipe splits into its weighed, linked foods')
near(split.reduce((a, c) => a + c.macros.fat_g, 0), 16.5, 'the parts add up to the line exactly (scaled)')
near(split[2].macros.fat_g, 16.5 * 11.25 / 16.5375, 'olive oil: its share of the computed fat')
ok(F.lineContributors(line('Overnight oats', { recipe_id: 'oats', quantity: 1 }, M(610, 42, 80, 12.3, 9, 18)), recipes, library).map(c => c.key), ['r:oats'], 'a recipe with typed macros stays one line')
ok(F.lineContributors(line('Gone', { recipe_id: 'gone', quantity: 1 }, M(300, 10, 0, 0, 0, 0)), recipes, library).map(c => c.key), ['r:gone'], 'an unknown recipe stays one line')
const mixed = F.lineContributors(line('Oil mix', { recipe_id: 'mix', quantity: 1 }, M(90, 5, 0, 10, 0, 0)), recipes, library)
ok(mixed.map(c => [c.key, c.macros.protein_g, c.macros.fat_g]), [['i:oil', 0, 10], ['r:mix', 5, 0]], 'a macro no food carries stays with the recipe')
ok(F.lineContributors(line('Kvikk  Lunsj ', {}, M(1, 0, 0, 0, 0, 0)), recipes, library)[0].key, 'c:kvikk  lunsj', 'a one-off line is itself, keyed by its folded title')

// ── dayMacroSources ──────────────────────────────────────────────────────────
const day = [
  line('Chicken breast', { library_ingredient_id: 'chk', quantity: 180, unit: 'g' }, M(190.8, 41.4, 0, 2.7, 0, 0)),
  bowlLine,
  line('Kvikk Lunsj', {}, M(420, 9, 48, 21, 1, 30)),
  line('Overnight oats', { recipe_id: 'oats', quantity: 1, unit: 'serving' }, M(610, 42, 80, 12.3, 9, 18)),
]
const fat = F.dayMacroSources(day, 'fat_g', recipes, library)
near(fat.total, 52.5, 'the exact total')
ok(fat.items.map(i => i.title), ['Kvikk Lunsj', 'Overnight oats', 'Olive oil', 'Chicken breast', 'Basmati rice'], 'largest first')
near(fat.items[3].amount, 2.7 + 16.5 * 4.5 / 16.5375, 'chicken logged alone and inside the bowl is one row')
near(fat.kcal, 472.5, 'fat × 9 kcal')
ok(fat.kcalShare, 24, "share of the day's 1,980.8 kcal")
const top3 = F.dayMacroSources(day, 'fat_g', recipes, library, 3)
ok([top3.items.length, top3.more], [3, 2], 'top N, then "+N more"')
near(top3.moreAmount, 52.5 - 21 - 12.3 - 16.5 * 11.25 / 16.5375, 'what the rest adds up to')
const fiber = F.dayMacroSources(day, 'fiber_g', recipes, library)
ok([fiber.kcal, fiber.kcalShare], [null, null], 'no kcal line for fibre')
near(F.dayMacroSources(day, 'sugar_g', recipes, library).kcal, 48.3 * 4, 'sugar counts 4 kcal a gram')
ok(F.dayMacroSources(day, 'protein_g', recipes, library).items.every(i => i.amount > 0), true, 'zero contributors are left out')
ok(F.dayMacroSources([], 'fat_g', recipes, library), { total: 0, kcal: 0, kcalShare: null, items: [], more: 0, moreAmount: 0 }, 'an empty day, no NaN')

// ── mostUsedIngredients ──────────────────────────────────────────────────────
const row = (date, o, calories) => ({ date, title: '—', library_ingredient_id: null, recipe_id: null, quantity: null, unit: null, ...o, calories })
const win = [
  row('2026-10-01', { title: 'Chicken breast', library_ingredient_id: 'chk', quantity: 180, unit: 'g' }, 190.8),
  row('2026-10-01', { recipe_id: 'bowl', quantity: 1.5, unit: 'serving' }, 760),
  row('2026-10-01', { title: 'Kvikk Lunsj' }, 420),
  row('2026-10-02', { title: 'Chicken breast', library_ingredient_id: 'chk', quantity: 200, unit: 'g' }, 212),
  row('2026-10-02', { recipe_id: 'oats', quantity: 1, unit: 'serving' }, 610),
  row('2026-10-03', { recipe_id: 'bowl', quantity: 1, unit: 'serving' }, 506),
  row('2026-10-03', { recipe_id: 'gone', quantity: 1, unit: 'serving' }, 300),
]
const used = F.mostUsedIngredients(win, recipes, library)
ok(used.items.map(u => [u.title, u.days, u.logs]), [
  ['Chicken breast', 3, 4], ['Banana', 3, 3], ['Basmati rice', 2, 2], ['Olive oil', 2, 2], ['Salt', 2, 2], ['Oats', 1, 1],
], 'by days eaten, then lines, then grams; recipe foods count (typed-macro recipes too); one-off lines and unknown recipes have none')
ok(used.total, 6, 'distinct ingredients')
ok(used.items[0].grams, 880, 'chicken: 180 + 300 (bowl × 1.5) + 200 + 200 (bowl × 1)')
near(used.items[0].kcal, 932.8, 'its kcal: the logged lines + per-100 g × grams inside the bowl')
ok([used.items[0].kcalShare, used.items[0].dayShare, used.items[2].dayShare], [31, 100, 67], "share of the window's 2,998.8 kcal; share of the 3 logged days")
ok([used.items[1].grams, used.items[3].unit, used.items[4].kcal], [118, 'ml', 0], 'a "1 pcs" banana adds no grams; oil is ml; an unlinked food has no kcal')
ok(F.mostUsedIngredients(win, recipes, library, 2).items.length, 2, 'top N')
ok(F.mostUsedIngredients([], recipes, library), { items: [], total: 0 }, 'an empty window')

// ── formatting ───────────────────────────────────────────────────────────────
ok([F.formatAmount(880, 'g'), F.formatAmount(5400, 'g'), F.formatAmount(18.75, 'ml'), F.formatAmount(1250, 'ml')], ['880 g', '5.4 kg', '19 ml', '1.3 l'], 'amounts')
ok([F.oneDecimal(70.56), F.oneDecimal(3), F.oneDecimal(1234.56)], ['70.6', '3.0', '1,234.6'], 'one decimal')

console.log(`verify-food-ingredients: ${n} assertions passed`)
