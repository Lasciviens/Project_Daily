#!/usr/bin/env node
/* Verification — the food logger's search ranking and quick-add parsing
 * (src/features/recipes/foodSearch.ts). Run: node scripts/verify-food-search.cjs */
require('sucrase/register')
const { foldText, matchRank, rankMatches, parseQuickAdd, sortForSlot, usualForSlot } = require('../src/features/recipes/foodSearch')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n1 · Folding')
check('ø → o', foldText('Brød') === 'brod')
check('æ → ae', foldText('Smør og Æble') === 'smor og aeble')
check('å → a', foldText('Rå') === 'ra')
check('Turkish ş/ç/ğ/ı/ö/ü', foldText('Şiş Çorba Ğ ılık Ölçü') === 'sis corba g ilik olcu')
check('trims + lower-cases', foldText('  Kebab ') === 'kebab')

console.log('\n2 · Ranking')
check('exact = 0', matchRank('Egg', 'egg') === 0)
check('prefix = 1', matchRank('Eggs, boiled', 'egg') === 1)
check('word start = 2', matchRank('Boiled egg', 'egg') === 2)
check('contains = 3', matchRank('Nutmeg', 'meg') === 3)
check('no match = null', matchRank('Rice', 'egg') === null)
check('accent-insensitive', matchRank('Brød, grovt', 'brod') === 1)
{
  const items = ['Scrambled eggs', 'Nutmeg', 'Egg', 'Eggplant', 'Boiled egg']
  const r = rankMatches(items, 'egg', s => s)
  check('order exact → prefix (shorter first) → word start', JSON.stringify(r) === JSON.stringify(['Egg', 'Eggplant', 'Boiled egg', 'Scrambled eggs']), JSON.stringify(r))
  check('empty query → []', rankMatches(items, '  ', s => s).length === 0)
  check('limit respected', rankMatches(items, 'e', s => s, 2).length === 2)
}

console.log('\n3 · Quick-add parsing')
{
  const a = parseQuickAdd('kebab 700')
  check('"kebab 700" → kebab / 700', a.title === 'kebab' && a.kcal === 700, JSON.stringify(a))
  const b = parseQuickAdd('Big Mac 550 kcal')
  check('"Big Mac 550 kcal" → Big Mac / 550', b.title === 'Big Mac' && b.kcal === 550, JSON.stringify(b))
  const c = parseQuickAdd('pizza')
  check('no number → kcal null', c.title === 'pizza' && c.kcal === null)
  const d = parseQuickAdd('700')
  check('number alone → title only (not kcal)', d.title === '700' && d.kcal === null, JSON.stringify(d))
  const e = parseQuickAdd('7 up')
  check('number first stays in the title', e.title === '7 up' && e.kcal === null, JSON.stringify(e))
  const f = parseQuickAdd('soup 120,5')
  check('decimal comma rounded', f.title === 'soup' && f.kcal === 121, JSON.stringify(f))
}

console.log('\n4 · Slot-aware recents')
{
  const items = [
    { key: 'rice', count: 10, slotCounts: { lunch: 6, dinner: 4 } },
    { key: 'creatine', count: 12, slotCounts: { supplement: 12 } },
    { key: 'omega', count: 5, slotCounts: { supplement: 4, breakfast: 1 } },
    { key: 'oats', count: 7, slotCounts: { breakfast: 7 } },
    { key: 'shake', count: 6, slotCounts: { snack: 4, supplement: 2 } },
  ]
  const s = sortForSlot(items, 'supplement').map(i => i.key)
  check('supplement slot first, then overall', JSON.stringify(s) === JSON.stringify(['creatine', 'omega', 'shake', 'rice', 'oats']), JSON.stringify(s))
  const u = usualForSlot(items, 'supplement').map(i => i.key)
  check('usual = mostly logged there, ≥3 times', JSON.stringify(u) === JSON.stringify(['creatine', 'omega']), JSON.stringify(u))
  check('no slotCounts → never usual', usualForSlot([{ key: 'x', count: 9 }], 'lunch').length === 0)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
