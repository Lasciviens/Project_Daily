#!/usr/bin/env node
/* Verification — Food · Today's "Quick guess" card (src/features/recipes/quickGuess.ts):
 * the presets, the portion factor, the diary title and your recent guesses.
 * Run: node scripts/verify-quick-guess.cjs */
require('sucrase/register')
const Q = require('../src/features/recipes/quickGuess')
let passed = 0, failed = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}

console.log('presets')
const keys = Q.GUESS_PRESETS.map(p => p.key)
check('the owner\'s examples are there: ~10 g protein, candy, drinks', ['protein', 'candy', 'soda', 'juice', 'beer', 'wine', 'latte', 'small', 'big'].every(k => keys.includes(k)), true)
check('keys and titles are unique', [new Set(keys).size, new Set(Q.GUESS_PRESETS.map(p => p.title.toLowerCase())).size], [keys.length, keys.length])
check('the protein snack is about 10 g protein', Q.GUESS_PRESETS.find(p => p.key === 'protein').protein, 10)
check('every preset has kcal > 0 and macros ≥ 0', Q.GUESS_PRESETS.every(p => p.kcal > 0 && [p.protein, p.carbs, p.fat, p.sugar].every(v => v >= 0)), true)
// Macros never claim more energy than the kcal (alcohol carries kcal in no macro, so ≤ is the rule).
check('4P + 4C + 9F never exceeds the kcal by more than 10 %', Q.GUESS_PRESETS.filter(p => 4 * p.protein + 4 * p.carbs + 9 * p.fat > p.kcal * 1.1).map(p => p.key), [])
check('non-alcohol presets: macros explain the kcal within 15 %', Q.GUESS_PRESETS.filter(p => !['beer', 'wine'].includes(p.key))
  .filter(p => Math.abs(4 * p.protein + 4 * p.carbs + 9 * p.fat - p.kcal) > p.kcal * 0.15).map(p => p.key), [])
check('sugar is part of the carbs', Q.GUESS_PRESETS.filter(p => p.sugar > p.carbs).map(p => p.key), [])

console.log('portion factor')
const candy = Q.GUESS_PRESETS.find(p => p.key === 'candy')
check('factors on offer: ½, 1, 1½, 2', Q.GUESS_FACTORS, [0.5, 1, 1.5, 2])
check('labels', Q.GUESS_FACTORS.map(Q.factorLabel), ['½', '1', '1½', '2'])
check('×1 keeps the values exactly', Q.scaleGuess({ kcal: 437, protein: 9, carbs: 48, fat: 21, sugar: 30 }, 1), { kcal: 437, protein: 9, carbs: 48, fat: 21, sugar: 30 })
check('×2 doubles every macro', Q.scaleGuess(candy, 2), { kcal: 440, protein: 4, carbs: 76, fat: 14, sugar: 60 })
check('×½ halves (kcal to the nearest 5, grams whole)', Q.scaleGuess(candy, 0.5), { kcal: 110, protein: 1, carbs: 19, fat: 4, sugar: 15 })
check('×1½ of a beer', Q.scaleGuess(Q.GUESS_PRESETS.find(p => p.key === 'beer'), 1.5), { kcal: 325, protein: 3, carbs: 27, fat: 0, sugar: 0 })

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
  line('candy', 220, 4),                                              // preset, other case
  line('Chicken breast', 160, 12, { library_ingredient_id: 'lib-1' }), // a library food, not a guess
  line('Overnight oats', 610, 20, { recipe_id: 'rec-1' }),            // a recipe, not a guess
  line('Water', 0, 30),                                               // no calories
  line('Office cake', 350, 2),
  line('Pizza slice ×½', 150, 5),
  line('Ice cream', 250, 1),
  line('Smoothie', 200, 1),
]
const r = Q.recentGuesses(lines)
check('only one-off lines with kcal, presets left out, most logged first, 4 at most', r.map(x => x.title), ['Pizza slice', 'Kebab', 'Office cake', 'Ice cream'])
check('the same title merges its counts (Kebab 3 + Kebab ×2 1)', r.find(x => x.title === 'Kebab').count, 4)
check('a "×½" line is read back to one portion', r.find(x => x.title === 'Pizza slice'), { key: 'c:pizza slice', title: 'Pizza slice', count: 5, kcal: 300, protein: 20, carbs: 40, fat: 16, sugar: 8 })
check('limit is honoured', Q.recentGuesses(lines, 2).length, 2)
check('nothing logged → nothing', Q.recentGuesses([]), [])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
