#!/usr/bin/env node
/* Verification — Food · Today's "Quick guess" card (src/features/recipes/quickGuess.ts):
 * the built-in presets (and migration 152's seed of them), the portion factor,
 * the diary title, your recent guesses and the Settings → Food editor's
 * helpers (form check, row to write, order).
 * Run: node scripts/verify-quick-guess.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const Q = require('../src/features/recipes/quickGuess')
let passed = 0, failed = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}

console.log('built-in presets')
const D = Q.DEFAULT_GUESSES
const keys = D.map(p => p.key)
check('the owner\'s examples are there: ~10 g protein, sweets, drinks', ['protein', 'sweet', 'soda', 'juice', 'beer', 'wine', 'latte', 'small', 'big'].every(k => keys.includes(k)), true)
check('renamed (owner, 14.10.2026): "Protein", not "Protein snack"; "Sweet", not "Candy"', [D.find(p => p.key === 'protein').title, D.find(p => p.key === 'sweet').title], ['Protein', 'Sweet'])
check('the old names are kept as legacy titles', Q.LEGACY_GUESS_TITLES, ['Protein snack', 'Candy'])
check('keys and titles are unique', [new Set(keys).size, new Set(D.map(p => p.title.toLowerCase())).size], [keys.length, keys.length])
check('the protein one is about 10 g protein', D.find(p => p.key === 'protein').protein, 10)
check('every preset has kcal > 0 and macros ≥ 0', D.every(p => p.kcal > 0 && [p.protein, p.carbs, p.fat, p.sugar].every(v => v >= 0)), true)
// Macros never claim more energy than the kcal (alcohol carries kcal in no macro, so ≤ is the rule).
check('4P + 4C + 9F never exceeds the kcal by more than 10 %', D.filter(p => 4 * p.protein + 4 * p.carbs + 9 * p.fat > p.kcal * 1.1).map(p => p.key), [])
check('non-alcohol presets: macros explain the kcal within 15 %', D.filter(p => !['beer', 'wine'].includes(p.key))
  .filter(p => Math.abs(4 * p.protein + 4 * p.carbs + 9 * p.fat - p.kcal) > p.kcal * 0.15).map(p => p.key), [])
check('sugar is part of the carbs', D.filter(p => p.sugar > p.carbs).map(p => p.key), [])
check('every built-in preset passes the editor\'s own check', D.map(p => Q.draftProblem({ name: p.title, icon: p.icon, portion: p.portion, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, sugar: p.sugar })).filter(Boolean), [])

console.log('migration 152 seeds the same presets')
const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/152_quick_guess_items.sql'), 'utf8')
const seedRe = /\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g
const seed = [...sql.matchAll(seedRe)].map(m => ({ title: m[1], icon: m[2], portion: m[3], kcal: +m[4], protein: +m[5], carbs: +m[6], fat: +m[7], sugar: +m[8], order: +m[9] }))
check('nine seed rows', seed.length, D.length)
check('same names, icons, portions and values, in the same order', seed.map(({ order, ...s }) => s),
  D.map(p => ({ title: p.title, icon: p.icon, portion: p.portion, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, sugar: p.sugar })))
check('sort order 0…8', seed.map(s => s.order), D.map((_, i) => i))

console.log('portion factor')
const candy = D.find(p => p.key === 'sweet')
check('factors on offer: ½, 1, 1½, 2', Q.GUESS_FACTORS, [0.5, 1, 1.5, 2])
check('labels', Q.GUESS_FACTORS.map(Q.factorLabel), ['½', '1', '1½', '2'])
check('×1 keeps the values exactly', Q.scaleGuess({ kcal: 437, protein: 9, carbs: 48, fat: 21, sugar: 30 }, 1), { kcal: 437, protein: 9, carbs: 48, fat: 21, sugar: 30 })
check('×2 doubles every macro', Q.scaleGuess(candy, 2), { kcal: 440, protein: 4, carbs: 76, fat: 14, sugar: 60 })
check('×½ halves (kcal to the nearest 5, grams whole)', Q.scaleGuess(candy, 0.5), { kcal: 110, protein: 1, carbs: 19, fat: 4, sugar: 15 })
check('×1½ of a beer', Q.scaleGuess(D.find(p => p.key === 'beer'), 1.5), { kcal: 325, protein: 3, carbs: 27, fat: 0, sugar: 0 })

console.log('diary title')
check('×1 → the plain title', Q.guessTitle('Beer', 1), 'Beer')
check('×2 → "Beer ×2"', Q.guessTitle('Beer', 2), 'Beer ×2')
check('×½ → "Candy ×½"', Q.guessTitle('Candy', 0.5), 'Candy ×½')
check('read back ×2', Q.parseGuessTitle('Beer ×2'), { base: 'Beer', factor: 2 })
check('read back ×½ and ×1½', [Q.parseGuessTitle('Candy ×½'), Q.parseGuessTitle('Big snack ×1½')], [{ base: 'Candy', factor: 0.5 }, { base: 'Big snack', factor: 1.5 }])
check('a title without a factor is itself', Q.parseGuessTitle('Kvikk Lunsj and a cappuccino'), { base: 'Kvikk Lunsj and a cappuccino', factor: 1 })
check('a bare "×2" is not a factor of nothing', Q.parseGuessTitle('×2'), { base: '×2', factor: 1 })
check('"×0" is not a factor', Q.parseGuessTitle('Beer ×0'), { base: 'Beer ×0', factor: 1 })

console.log('recent guesses')
const line = (title, kcal, count, extra = {}) => ({ key: `c:${title.toLowerCase()}`, title, library_ingredient_id: null, recipe_id: null, calories: kcal, protein_g: 10, carbs_g: 20, fat_g: 8, sugar_g: 4, count, ...extra })
const lines = [
  line('Kebab', 700, 3),
  line('Kebab ×2', 1400, 1),                                          // same food, two portions
  line('Beer ×2', 430, 9),                                            // a preset: has its own chip
  line('sweet', 220, 4),                                              // preset, other case
  line('Candy ×2', 440, 6),                                           // logged under the old name (before 152)
  line('Protein snack', 110, 7),                                      // likewise
  line('Chicken breast', 160, 12, { library_ingredient_id: 'lib-1' }), // a library food, not a guess
  line('Overnight oats', 610, 20, { recipe_id: 'rec-1' }),            // a recipe, not a guess
  line('Water', 0, 30),                                               // no calories
  line('Office cake', 350, 2),
  line('Pizza slice ×½', 150, 5),
  line('Ice cream', 250, 1),
  line('Smoothie', 200, 1),
]
const titles = D.map(p => p.title)
const r = Q.recentGuesses(lines, titles)
check('only one-off lines with kcal, presets (and their old names) left out, most logged first, 4 at most', r.map(x => x.title), ['Pizza slice', 'Kebab', 'Office cake', 'Ice cream'])
check('the same title merges its counts (Kebab 3 + Kebab ×2 1)', r.find(x => x.title === 'Kebab').count, 4)
check('a "×½" line is read back to one portion', r.find(x => x.title === 'Pizza slice'), { key: 'c:pizza slice', title: 'Pizza slice', count: 5, kcal: 300, protein: 20, carbs: 40, fat: 16, sugar: 8 })
check('limit is honoured', Q.recentGuesses(lines, titles, 2).length, 2)
check('nothing logged → nothing', Q.recentGuesses([], titles), [])
check('a preset the owner deleted (Beer) shows up as a recent guess again', Q.recentGuesses(lines, titles.filter(t => t !== 'Beer'), 1).map(x => [x.title, x.kcal]), [['Beer', 215]])
check('a renamed preset: lines under its own new name are left out', Q.recentGuesses([line('Gummies', 200, 50)], ['Gummies']), [])

console.log('the owner\'s presets (Settings → Food)')
const item = { id: 'a1', name: 'Kebab', icon: null, portion: null, calories: 700, protein_g: 35, carbs_g: 60, fat_g: 35, sugar_g: 5, sort_order: 3 }
check('a row becomes a chip (no icon → picked from the name later)', Q.itemToPreset(item), { key: 'a1', title: 'Kebab', icon: '', portion: '', kcal: 700, protein: 35, carbs: 60, fat: 35, sugar: 5 })
check('a row opens in the form', Q.itemToDraft(item), { name: 'Kebab', icon: '', portion: '', kcal: 700, protein: 35, carbs: 60, fat: 35, sugar: 5 })
const ok = { ...Q.EMPTY_DRAFT, name: 'Kebab', kcal: 700 }
check('a name and kcal are enough', Q.draftProblem(ok), null)
check('no name', Q.draftProblem({ ...ok, name: '   ' }), 'Give it a name')
check('61 characters', Q.draftProblem({ ...ok, name: 'x'.repeat(61) }), 'Keep the name to 60 characters')
check('no kcal / 0 kcal', [Q.draftProblem({ ...ok, kcal: null }), Q.draftProblem({ ...ok, kcal: 0 })], ['Calories must be more than 0', 'Calories must be more than 0'])
check('over 5000 kcal', Q.draftProblem({ ...ok, kcal: 5001 }), 'At most 5000 kcal a portion')
check('a negative macro', Q.draftProblem({ ...ok, fat: -1 }), 'Fat can\'t be below 0')
check('a macro over the table\'s limit', Q.draftProblem({ ...ok, protein: 501 }), 'Protein is at most 500 g')
check('an emoji with joiners is one icon', Q.draftProblem({ ...ok, icon: '🧑‍🍳' }), null)
check('a long icon is refused', Q.draftProblem({ ...ok, icon: 'abcdefghijklmnopq' }), 'The icon is one emoji')
check('the row to write: text trimmed, empty text null, empty macros 0, the place kept',
  Q.draftToInput({ ...ok, name: ' Kebab ', icon: ' ', portion: ' a whole one ', protein: 35 }, 4),
  { name: 'Kebab', icon: null, portion: 'a whole one', calories: 700, protein_g: 35, carbs_g: 0, fat_g: 0, sugar_g: 0, sort_order: 4 })
check('a new preset goes last', [Q.nextSortOrder([{ sort_order: 0 }, { sort_order: 8 }, { sort_order: 3 }]), Q.nextSortOrder([])], [9, 0])
const order = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }, { id: 'c', sort_order: 2 }]
check('moving one up swaps it with the one above (two rows change)', Q.moveGuess(order, 'c', -1), [{ id: 'c', sort_order: 1 }, { id: 'b', sort_order: 2 }])
check('moving one down', Q.moveGuess(order, 'a', 1), [{ id: 'b', sort_order: 0 }, { id: 'a', sort_order: 1 }])
check('nothing above the first, nothing below the last, nothing for an unknown id', [Q.moveGuess(order, 'a', -1), Q.moveGuess(order, 'c', 1), Q.moveGuess(order, 'x', 1)], [[], [], []])
check('rows sharing a number are renumbered on the way (a 0, b 0, c 5: c up → a 0, c 1, b 2)',
  Q.moveGuess([{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 0 }, { id: 'c', sort_order: 5 }], 'c', -1),
  [{ id: 'c', sort_order: 1 }, { id: 'b', sort_order: 2 }])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
