#!/usr/bin/env node
/* Verification — the food logger's search ranking and quick-add parsing
 * (src/features/recipes/foodSearch.ts), and that Recents read every page of
 * the diary (foodLogApi.fetchRecentFoods, against a stand-in for Supabase).
 * Run: node scripts/verify-food-search.cjs */
require('sucrase/register')
// foodLogApi imports the live Supabase client: hand it a stand-in that serves
// pages of `diary` by .range() and records each query's calls.
const Module = require('module')
const queries = []
let diary = []
const fakeSupabase = {
  from(table) {
    const ops = []
    queries.push({ table, ops })
    const q = new Proxy({}, {
      get(_, k) {
        if (k === 'then') {
          const range = ops.find(o => o[0] === 'range')
          const data = table === 'food_log_entries' ? (range ? diary.slice(range[1], range[2] + 1) : diary.slice(0, 1000)) : []
          return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej)
        }
        return (...args) => { ops.push([k, ...args]); return q }
      },
    })
    return q
  },
}
const origLoad = Module._load
Module._load = function (request) {
  if (/integrations\/supabase\/client$/.test(request)) return { supabase: fakeSupabase }
  return origLoad.apply(this, arguments)
}
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
  check('"kebab 700" → bare amount, not kcal', a.title === 'kebab' && a.kcal === null && a.amount === 700, JSON.stringify(a))
  const b = parseQuickAdd('Big Mac 550 kcal')
  check('"Big Mac 550 kcal" → Big Mac / 550 kcal', b.title === 'Big Mac' && b.kcal === 550, JSON.stringify(b))
  const b2 = parseQuickAdd('kebab 700cal')
  check('"700cal" → kcal', b2.kcal === 700 && b2.title === 'kebab', JSON.stringify(b2))
  const g = parseQuickAdd('Chicken 150g')
  check('"Chicken 150g" → grams 150, no kcal', g.title === 'Chicken' && g.grams === 150 && g.kcal === null, JSON.stringify(g))
  const g2 = parseQuickAdd('Cola 330 ml')
  check('"Cola 330 ml" → grams 330', g2.grams === 330 && g2.kcal === null, JSON.stringify(g2))
  const h = parseQuickAdd('Chicken 150')
  check('"Chicken 150" → never kcal', h.kcal === null && h.amount === 150 && h.title === 'Chicken', JSON.stringify(h))
  const c = parseQuickAdd('pizza')
  check('no number → nothing parsed', c.title === 'pizza' && c.kcal === null && c.amount === null && c.grams === null)
  const d = parseQuickAdd('700')
  check('number alone → title only', d.title === '700' && d.kcal === null && d.amount === null, JSON.stringify(d))
  const e = parseQuickAdd('7 up')
  check('number first stays in the title', e.title === '7 up' && e.kcal === null, JSON.stringify(e))
  const f = parseQuickAdd('soup 120,5 kcal')
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

console.log('\n5 · Recents read every page of the 30 days')
;(async () => {
  const { fetchRecentFoods } = require('../src/features/recipes/api/foodLogApi')
  // 1,150 eaten lines, newest first: 1,000 chicken lines, then 150 older oats lines.
  const line = (i, o) => ({ meal_slot: 'lunch', library_ingredient_id: 'chicken', recipe_id: null, custom_title: null, quantity: 150, unit: 'g',
    calories: 248, protein_g: 46, carbs_g: 0, fat_g: 5, fiber_g: 0, sugar_g: 0, ingredient: { name: 'Chicken breast' }, recipe: null, ...o })
  diary = [...Array.from({ length: 1000 }, (_, i) => line(i)), ...Array.from({ length: 150 }, (_, i) => line(i, { meal_slot: 'breakfast', library_ingredient_id: 'oats', ingredient: { name: 'Oats' }, quantity: 60 }))]
  queries.length = 0
  const recents = await fetchRecentFoods('2026-09-28')
  const reads = queries.filter(q => q.table === 'food_log_entries')
  const oats = recents.find(r => r.key === 'oats')
  check('the oldest days past row 1,000 still count (was cut at PostgREST\'s 1,000)', oats?.count === 150 && recents.find(r => r.key === 'chicken')?.count === 1000, JSON.stringify(recents.map(r => [r.key, r.count])))
  check('read in two pages of 1,000, eaten only, in a stable order (created_at, id)', reads.length === 2
    && reads.every(q => q.ops.some(o => o[0] === 'eq' && o[1] === 'status' && o[2] === 'eaten'))
    && reads.every(q => q.ops.filter(o => o[0] === 'order').map(o => o[1]).join() === 'created_at,id')
    && reads[1].ops.some(o => o[0] === 'range' && o[1] === 1000 && o[2] === 1999), JSON.stringify(reads.map(q => q.ops.filter(o => o[0] === 'range'))))
  check('only the columns Recents use (no select *)', !reads[0].ops.find(o => o[0] === 'select')[1].includes('*'))

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.log(`  ✗ threw — ${e?.stack ?? e}`); process.exit(1) })
