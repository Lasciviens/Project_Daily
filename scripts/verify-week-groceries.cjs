#!/usr/bin/env node
/* Verification — the week's groceries (recipes/weekGroceries.ts) and adding
 * a batch to the quick list (shop/quickBatch.ts): ingredients of every planned
 * meal added up by ingredient and unit, scaled by servings, a one-off line
 * adding nothing; what is already on the list left out; no title twice.
 * Run: node scripts/verify-week-groceries.cjs */
require('sucrase/register')
const { weekGroceries, unitKey, quantityText, noteOf } = require('../src/features/recipes/weekGroceries')
const { splitNew, foldedTitles, batchWords } = require('../src/features/shop/quickBatch')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const ing = (name, quantity, unit) => ({ id: name, name, quantity, unit })
const recipes = [
  { id: 'r1', title: 'Pasta', servings: 2, ingredients: [ing('Pasta', 200, 'g'), ing('Tomato', 4, null), ing('Salt', null, null)] },
  { id: 'r2', title: 'Soup', servings: 4, ingredients: [ing('Tomato', 2, null), ing('pasta', 100, 'grams'), ing('Milk', 1, 'l')] },
]
const meal = (recipe_id, servings, extra = {}) => ({ recipe_id, servings, ingredient_quantity: null, ingredient_unit: null, ingredient: null, recipe: null, ...extra })

console.log('units')
check('grams → g', unitKey('Grams') === 'g')
check('empty → null', unitKey('  ') === null && unitKey(null) === null)
check('unknown kept lower-case', unitKey('Tbsp') === 'tbsp')

console.log('merging')
let l = weekGroceries([meal('r1', 2), meal('r2', 4)], recipes)
const pasta = l.find(x => x.name === 'Pasta')
check('same name and unit merge (200 g + 100 grams)', pasta && pasta.quantity === 300 && pasta.unit === 'g', JSON.stringify(pasta))
check('merge is case-insensitive, first spelling kept', l.filter(x => x.key.startsWith('pasta')).length === 1 && pasta.name === 'Pasta')
check('names the meals once, in plan order', JSON.stringify(pasta.for) === JSON.stringify(['Pasta', 'Soup']))
check('different units stay separate lines', weekGroceries([meal('r1', 2)], [{ ...recipes[0], ingredients: [ing('Milk', 1, 'l'), ing('Milk', 2, 'dl')] }]).length === 2)
check('Tomato 4 + 2', l.find(x => x.name === 'Tomato').quantity === 6)

console.log('scaling')
l = weekGroceries([meal('r1', 4)], recipes)
check('double servings doubles amounts', l.find(x => x.name === 'Pasta').quantity === 400)
l = weekGroceries([meal('r1', 1)], recipes)
check('half servings halves amounts', l.find(x => x.name === 'Pasta').quantity === 100)
l = weekGroceries([meal('r1', 3)], recipes)
check('rounds to 2 decimals', l.find(x => x.name === 'Tomato').quantity === 6)
l = weekGroceries([meal('r2', 1)], [{ ...recipes[1], servings: 3 }])
check('thirds round to 2 decimals', l.find(x => x.name === 'Milk').quantity === 0.33)

console.log('amounts missing, foods, one-offs')
l = weekGroceries([meal('r1', 2)], recipes)
const salt = l.find(x => x.name === 'Salt')
check('no amount → null quantity, still listed', salt && salt.quantity === null && quantityText(salt) === '')
l = weekGroceries([meal('r1', 2), meal('r1', 2)], [{ ...recipes[0], ingredients: [ing('Rice', 100, 'g')] }, ])
check('same recipe planned twice adds up', l[0].quantity === 200)
l = weekGroceries([meal('r1', 2)], [{ ...recipes[0], ingredients: [ing('Rice', 100, 'g'), ing('Rice', null, 'g')] }])
check('an amount plus an unnamed amount is a floor ("+ some")', l[0].quantity === 100 && l[0].partial && quantityText(l[0]) === '100g + some')
l = weekGroceries([{ recipe_id: null, servings: 1, ingredient_quantity: 150, ingredient_unit: null, ingredient: { id: 'x', name: 'Broccoli' }, recipe: null }], recipes)
check('a planned food is its own line (default g)', l.length === 1 && l[0].name === 'Broccoli' && l[0].quantity === 150 && l[0].unit === 'g' && l[0].for[0] === 'the plan')
l = weekGroceries([meal(null, 1, { })], recipes)
check('a one-off line adds nothing', l.length === 0)
l = weekGroceries([meal('gone', 1)], recipes)
check('a recipe that is not loaded adds nothing', l.length === 0)
check('empty plan → empty', weekGroceries([], recipes).length === 0)
check('note reads "300g · for Pasta, Soup"', noteOf(weekGroceries([meal('r1', 2), meal('r2', 4)], recipes).find(x => x.name === 'Pasta')) === '300g · for Pasta, Soup')

console.log('quick list batch')
const wanted = [{ title: 'Milk' }, { title: 'Kjøttdeig' }, { title: 'milk' }, { title: 'Eggs' }, { title: '  ' }]
const { fresh, skipped } = splitNew(wanted, foldedTitles(['kjottdeig', 'Bread']))
check('already on the list is skipped (ø folds to o)', !fresh.some(f => f.title === 'Kjøttdeig'))
check('a second copy inside the batch is skipped', fresh.filter(f => f.title.toLowerCase() === 'milk').length === 1)
check('blank title skipped', !fresh.some(f => !f.title.trim()))
check('fresh = Milk, Eggs', JSON.stringify(fresh.map(f => f.title)) === JSON.stringify(['Milk', 'Eggs']))
check('skipped count', skipped.length === 3)
check('toast words', batchWords(6, 2, 'Week 48') === 'Added 6 items to the quick list · Week 48 · 2 already there')
check('toast words, one item, nothing skipped', batchWords(1, 0, '') === 'Added 1 item to the quick list')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
