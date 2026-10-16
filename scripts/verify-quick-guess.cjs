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
check('every built-in preset passes the editor\'s own check', D.map(p => Q.draftProblem({ name: p.title, icon: p.icon, portion: p.portion, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, sugar: p.sugar, options: [] })).filter(Boolean), [])

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
const item = { id: 'a1', name: 'Kebab', icon: null, portion: null, calories: 700, protein_g: 35, carbs_g: 60, fat_g: 35, sugar_g: 5, sort_order: 3, options: [] }
check('a row becomes a chip (no icon → picked from the name later)', Q.itemToPreset(item), { key: 'a1', title: 'Kebab', icon: '', portion: '', kcal: 700, protein: 35, carbs: 60, fat: 35, sugar: 5, options: [] })
check('a row opens in the form', Q.itemToDraft(item), { name: 'Kebab', icon: '', portion: '', kcal: 700, protein: 35, carbs: 60, fat: 35, sugar: 5, options: [] })
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
  { name: 'Kebab', icon: null, portion: 'a whole one', calories: 700, protein_g: 35, carbs_g: 0, fat_g: 0, sugar_g: 0, sort_order: 4, options: [] })
check('a new preset goes last', [Q.nextSortOrder([{ sort_order: 0 }, { sort_order: 8 }, { sort_order: 3 }]), Q.nextSortOrder([])], [9, 0])
const order = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }, { id: 'c', sort_order: 2 }]
check('moving one up swaps it with the one above (two rows change)', Q.moveGuess(order, 'c', -1), [{ id: 'c', sort_order: 1 }, { id: 'b', sort_order: 2 }])
check('moving one down', Q.moveGuess(order, 'a', 1), [{ id: 'b', sort_order: 0 }, { id: 'a', sort_order: 1 }])
check('nothing above the first, nothing below the last, nothing for an unknown id', [Q.moveGuess(order, 'a', -1), Q.moveGuess(order, 'c', 1), Q.moveGuess(order, 'x', 1)], [[], [], []])
check('rows sharing a number are renumbered on the way (a 0, b 0, c 5: c up → a 0, c 1, b 2)',
  Q.moveGuess([{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 0 }, { id: 'c', sort_order: 5 }], 'c', -1),
  [{ id: 'c', sort_order: 1 }, { id: 'b', sort_order: 2 }])

console.log('options: read where they enter (migration 159)')
const PIZZA_JSON = [
  { name: 'On it', pick: 'one', choices: [
    { name: 'Margherita', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0 },
    { name: 'Chicken', calories: 90, protein_g: 9, carbs_g: 0, fat_g: 3, sugar_g: 0 },
    { name: 'Pepperoni', calories: 120, protein_g: 5, carbs_g: 1, fat_g: 10, sugar_g: 0 }] },
  { name: 'Extra', pick: 'any', choices: [
    { name: 'Cheese', calories: 80, protein_g: 5, carbs_g: 0, fat_g: 6, sugar_g: 0 },
    { name: 'Garlic dressing', calories: 110, protein_g: 0, carbs_g: 2, fat_g: 11, sugar_g: 1 }] },
  { name: 'Size', pick: 'size', choices: [{ name: 'Small', factor: 0.75 }, { name: 'Large', factor: 1.5 }] },
]
const groups = Q.parseGuessOptions(PIZZA_JSON)
check('three groups, the column\'s names read as the app\'s', [groups.length, groups[0].choices[1]], [3, { name: 'Chicken', factor: 1, kcal: 90, protein: 9, carbs: 0, fat: 3, sugar: 0 }])
check('a size choice keeps its factor, no macros', groups[2].choices[1], { name: 'Large', factor: 1.5, kcal: 0, protein: 0, carbs: 0, fat: 0, sugar: 0 })
check('written back, the same jsonb', Q.optionsToJson(groups), PIZZA_JSON)
check('not an array → no options', [Q.parseGuessOptions(null), Q.parseGuessOptions({}), Q.parseGuessOptions('x')], [[], [], []])
const messy = Q.parseGuessOptions([
  { name: '  Base  ', pick: 'one', choices: [{ name: ' Thin ', calories: -20, protein_g: 900, carbs_g: '12', fat_g: 'x' }, 'Cheese', { name: '' }] },
  { name: 'Odd', pick: 'many', choices: [{ name: 'x' }] },
  { name: 'Size', pick: 'size', choices: [{ name: 'Large' }, { name: 'Giant', factor: 11 }] },
  { name: 'x'.repeat(40), pick: 'any', choices: Array.from({ length: 8 }, (_, i) => ({ name: `C${i}` })) },
  { name: 'Fourth', pick: 'any', choices: [{ name: 'a' }] },
  { name: 'Fifth', pick: 'any', choices: [{ name: 'b' }] },
])
check('bad entries are left out: an unknown pick, sizes without a valid factor (so the whole group), non-objects, blank names',
  messy.map(g => g.name), ['Base', 'x'.repeat(30), 'Fourth'])
check('names trimmed and cut to 30, macros whole and inside the table\'s ranges (a numeric text is read)', messy[0].choices, [{ name: 'Thin', factor: 1, kcal: 0, protein: 500, carbs: 12, fat: 0, sugar: 0 }])
check('at most 6 choices and 3 groups', [messy[1].choices.length, Q.parseGuessOptions([...PIZZA_JSON, ...PIZZA_JSON]).length], [6, 3])

console.log('options: the ask-first sheet')
const pizza = { title: 'Pizza', kcal: 540, protein: 22, carbs: 64, fat: 20, sugar: 6, options: groups }
let picks = Q.noPicks(groups)
check('nothing picked → the preset itself', Q.pickedGuess(pizza, picks, 1), { kcal: 540, protein: 22, carbs: 64, fat: 20, sugar: 6, title: 'Pizza' })
picks = Q.togglePick(groups, picks, 0, 1)
picks = Q.togglePick(groups, picks, 1, 0)
check('chicken + cheese add their macros; the title says what was picked', Q.pickedGuess(pizza, picks, 1), { kcal: 710, protein: 36, carbs: 64, fat: 29, sugar: 6, title: 'Pizza (chicken, cheese)' })
check('"one" holds one: picking pepperoni replaces chicken', Q.togglePick(groups, picks, 0, 2)[0], [2])
check('a second tap on the picked one clears it', Q.togglePick(groups, picks, 0, 1)[0], [])
check('"any" holds several, in order', Q.togglePick(groups, picks, 1, 1)[1], [0, 1])
check('"any": a second tap takes one off', Q.togglePick(groups, Q.togglePick(groups, picks, 1, 1), 1, 0)[1], [1])
const large = Q.togglePick(groups, picks, 2, 1)
check('a size multiplies everything, adds included, and the ½–2 switch on top (×1.5 × 1½)', [Q.pickedFactor(groups, large, 1.5), Q.pickedGuess(pizza, large, 1.5)],
  [2.25, { kcal: 1600, protein: 81, carbs: 144, fat: 65, sugar: 14, title: 'Pizza (chicken, cheese, large) ×1½' }])
check('a size holds one', Q.togglePick(groups, large, 2, 0)[2], [0])
check('an index that isn\'t there changes nothing', Q.togglePick(groups, picks, 0, 9), picks)
check('a preset without options: the plain guess', Q.pickedGuess({ title: 'Beer', kcal: 215, protein: 2, carbs: 18, fat: 0, sugar: 0 }, [], 2), { ...Q.scaleGuess({ kcal: 215, protein: 2, carbs: 18, fat: 0, sugar: 0 }, 2), title: 'Beer ×2' })
const names = Q.parseGuessOptions([{ name: 'On it', pick: 'any', choices: [{ name: 'BBQ sauce' }, { name: 'Pepsi Max' }, { name: 'Rømme' }, { name: 'iPhone' }] }])
check('names in the title: "Pepsi Max" → "pepsi max", "Rømme" → "rømme", "BBQ sauce" and "iPhone" stay',
  Q.pickedGuess({ title: 'Kebab', kcal: 700, protein: 35, carbs: 60, fat: 35, sugar: 5, options: names }, [[0, 1, 2, 3]], 1).title, 'Kebab (BBQ sauce, pepsi max, rømme, iPhone)')
check('the logged title reads back as its own recent guess, one portion', Q.parseGuessTitle('Pizza (chicken, cheese, large) ×1½'), { base: 'Pizza (chicken, cheese, large)', factor: 1.5 })
check('"Pizza (chicken)" is a recent guess of its own; the plain preset "Pizza" stays out',
  Q.recentGuesses([line('Pizza (chicken)', 630, 2), line('Pizza', 540, 9)], ['Pizza']).map(x => x.title), ['Pizza (chicken)'])
check('chip hints: protein when it adds 5 g or more, else kcal, else nothing; a size its factor',
  [Q.choiceHint(groups[0].choices[1], 'one', 1), Q.choiceHint(groups[1].choices[1], 'any', 1), Q.choiceHint(groups[0].choices[0], 'one', 1), Q.choiceHint(groups[2].choices[0], 'size', 1), Q.choiceHint(groups[2].choices[1], 'size', 1)],
  ['+9 g protein', '+110 kcal', '', '×0.75', '×1½'])
check('chip hints follow the current size (×2: chicken adds 18 g protein)', Q.choiceHint(groups[0].choices[1], 'one', 2), '+18 g protein')

console.log('options: the editor\'s form')
const gd = groups.map(Q.groupToDraft)
check('a size choice opens with its factor and empty macros; an adding one with its macros', [gd[2].choices[1], gd[0].choices[1]],
  [{ name: 'Large', kcal: null, protein: null, carbs: null, fat: null, sugar: null, factor: 1.5 }, { name: 'Chicken', kcal: 90, protein: 9, carbs: 0, fat: 3, sugar: 0, factor: null }])
check('form → groups → form is the same', gd.map(Q.draftToGroup).map(Q.groupToDraft), gd)
check('empty macros are written as 0, names trimmed', Q.draftToGroup({ name: ' Extra ', pick: 'any', choices: [{ ...Q.EMPTY_CHOICE, name: ' Cheese ', kcal: 80 }] }),
  { name: 'Extra', pick: 'any', choices: [{ name: 'Cheese', factor: 1, kcal: 80, protein: 0, carbs: 0, fat: 0, sugar: 0 }] })
check('the row to write carries its options; the preset row opens with them',
  [Q.draftToInput({ ...ok, options: gd }, 0).options, Q.itemToDraft({ ...item, options: groups }).options], [groups, gd])
const okG = () => ({ name: 'Extra', pick: 'any', choices: [{ ...Q.EMPTY_CHOICE, name: 'Cheese', kcal: 80 }] })
const prob = gs => Q.optionsProblem(gs)
check('valid options pass; none pass', [prob(gd), prob([])], [null, null])
check('the form\'s problems in words', [
  prob([okG(), okG(), okG(), okG()]),
  prob([{ ...okG(), name: '  ' }]),
  prob([{ ...okG(), name: 'x'.repeat(31) }]),
  prob([{ ...okG(), pick: 'many' }]),
  prob([{ ...okG(), choices: [] }]),
  prob([{ ...okG(), choices: Array.from({ length: 7 }, () => ({ ...Q.EMPTY_CHOICE, name: 'c' })) }]),
  prob([{ ...okG(), choices: [{ ...Q.EMPTY_CHOICE }] }]),
  prob([{ ...okG(), choices: [{ ...Q.EMPTY_CHOICE, name: 'y'.repeat(31) }] }]),
  prob([{ name: 'Size', pick: 'size', choices: [{ ...Q.EMPTY_CHOICE, name: 'Large' }] }]),
  prob([{ name: 'Size', pick: 'size', choices: [{ ...Q.EMPTY_CHOICE, name: 'Giant', factor: 11 }] }]),
  prob([{ ...okG(), choices: [{ ...Q.EMPTY_CHOICE, name: 'Diet', kcal: -5 }] }]),
  prob([{ ...okG(), choices: [{ ...Q.EMPTY_CHOICE, name: 'Cake', kcal: 5001 }] }]),
  prob([{ ...okG(), choices: [{ ...Q.EMPTY_CHOICE, name: 'Shake', protein: 501 }] }]),
], [
  'At most 3 option groups',
  'Give option group 1 a name',
  'Keep option group 1\'s name to 30 characters',
  'Choose how “Extra” is picked',
  '“Extra” needs at least one choice',
  '“Extra” has at most 6 choices',
  'Give choice 1 in “Extra” a name',
  'Keep choice 1 in “Extra” to 30 characters',
  '“Large” needs a size above 0 (1.5 = half as much again)',
  '“Giant” is at most ×10',
  '“Diet” can\'t add less than 0 kcal',
  '“Cake” adds at most 5000 kcal',
  '“Shake”: protein is at most 500 g',
])
check('the limits are inclusive: 30 characters, ×10, 5000 kcal, 500 g protein', prob([
  { name: 'x'.repeat(30), pick: 'any', choices: [{ ...Q.EMPTY_CHOICE, name: 'y'.repeat(30), kcal: 5000, protein: 500, carbs: 1000, fat: 500, sugar: 1000 }] },
  { name: 'Size', pick: 'size', choices: [{ ...Q.EMPTY_CHOICE, name: 'Huge', factor: 10 }] },
]), null)
check('the preset\'s own check includes its options', Q.draftProblem({ ...ok, options: [{ ...okG(), choices: [] }] }), '“Extra” needs at least one choice')

console.log('options: the same limits as migration 159')
const sql159 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/159_quick_guess_options.sql'), 'utf8')
const fn = sql159.slice(sql159.indexOf('FUNCTION public.quick_guess_options_ok'))
check('groups: at most 3', [/jsonb_array_length\(p_options\) > (\d+)/.exec(fn)?.[1], Q.OPTION_LIMITS.groups], ['3', 3])
check('choices: 1 to 6', [/jsonb_array_length\(g -> 'choices'\) NOT BETWEEN 1 AND (\d+)/.exec(fn)?.[1], Q.OPTION_LIMITS.choices], ['6', 6])
check('names: at most 30, for groups and choices', [[...fn.matchAll(/char_length\([gc] ->> 'name'\) > (\d+)/g)].map(m => m[1]), Q.OPTION_LIMITS.name], [['30', '30'], 30])
check('factor: above 0, at most 10', [/::numeric > 0 AND \(c ->> 'factor'\)::numeric <= (\d+)/.exec(fn)?.[1], Q.OPTION_LIMITS.factor], ['10', 10])
const sqlMax = Object.fromEntries([...fn.matchAll(/\('(calories|protein_g|carbs_g|fat_g|sugar_g)', (\d+)\)/g)].map(m => [m[1], Number(m[2])]))
const jsMax = Object.fromEntries(Object.entries({ calories: 'kcal', protein_g: 'protein', carbs_g: 'carbs', fat_g: 'fat', sugar_g: 'sugar' }).map(([col, k]) => {
  // the largest value the form lets through for that macro
  const at = v => prob([{ name: 'G', pick: 'any', choices: [{ ...Q.EMPTY_CHOICE, name: 'C', [k]: v }] }]) === null
  let v = 0; for (const step of [1000, 100, 10, 1]) while (v + step <= 100000 && at(v + step)) v += step
  return [col, v]
}))
check('every adding macro\'s limit is the same in the form and in the database', jsMax, sqlMax)
check('…and the same as the preset\'s own (152) per-portion limits', sqlMax, { calories: 5000, protein_g: 500, carbs_g: 1000, fat_g: 500, sugar_g: 1000 })

console.log('"Save as Quick guess" from a diary line')
check('"Beer ×2" at 430 kcal → a Beer preset of one portion', Q.lineToDraft({ title: 'Beer ×2', calories: 430, protein_g: 4, carbs_g: 36, fat_g: 0, sugar_g: null }),
  { ...Q.EMPTY_DRAFT, name: 'Beer', kcal: 215, protein: 2, carbs: 18, fat: 0, sugar: null })
check('a title without a factor stays itself', Q.lineToDraft({ title: 'Office cake', calories: 350 }).name, 'Office cake')

console.log('"Describe it": the AI\'s estimate where it enters')
check('a full answer', Q.readGuessEstimate({ title: ' Pizza, pepperoni ', portion: '2 slices', calories: 619.6, protein_g: 31, carbs_g: 64, fat_g: 24, sugar_g: 6, assumptions: [' Medium pizza ', '', 'Regular cola'] }),
  { title: 'Pizza, pepperoni', portion: '2 slices', kcal: 620, protein: 31, carbs: 64, fat: 24, sugar: 6, assumptions: ['Medium pizza', 'Regular cola'] })
check('numbers kept inside the table\'s ranges, missing ones 0', Q.readGuessEstimate({ title: 'Feast', calories: 9000, protein_g: -3, carbs_g: 'lots' }),
  { title: 'Feast', portion: '', kcal: 5000, protein: 0, carbs: 0, fat: 0, sugar: 0, assumptions: [] })
check('text cut: title 60, portion 120, at most 4 assumptions of 200', (() => {
  const e = Q.readGuessEstimate({ title: 't'.repeat(80), portion: 'p'.repeat(200), assumptions: Array.from({ length: 6 }, () => 'a'.repeat(300)) })
  return [e.title.length, e.portion.length, e.assumptions.length, e.assumptions[0].length]
})(), [60, 120, 4, 200])
check('not an object → no estimate', [Q.readGuessEstimate(null), Q.readGuessEstimate('620 kcal'), Q.readGuessEstimate([1])], [null, null, null])

console.log('the diary\'s "≈"')
check('the mark', Q.GUESS_MARK, '≈')
check('a one-off line with kcal is a guess; a food, a recipe, no kcal or an unknown source is not', [
  Q.isGuessLine({ library_ingredient_id: null, recipe_id: null }, 620),
  Q.isGuessLine({ library_ingredient_id: 'lib-1', recipe_id: null }, 160),
  Q.isGuessLine({ library_ingredient_id: null, recipe_id: 'rec-1' }, 610),
  Q.isGuessLine({ library_ingredient_id: null, recipe_id: null }, 0),
  Q.isGuessLine({ library_ingredient_id: null, recipe_id: null }, null),
  Q.isGuessLine(undefined, 620),
], [true, false, false, false, false, false])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
