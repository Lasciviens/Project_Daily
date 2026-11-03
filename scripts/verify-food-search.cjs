#!/usr/bin/env node
/* Verification — the food logger's search ranking and quick-add parsing
 * (src/features/recipes/foodSearch.ts), that Recents read every page of
 * the diary (foodLogApi.fetchRecentFoods, against a stand-in for Supabase), and
 * that the online search asks Open Food Facts' full-text endpoint and keeps only
 * products containing the typed words (openFoodFactsApi.searchFoodsByName,
 * against a stand-in fetch fed the real answers of 03.11.2026).
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
const { foldText, matchRank, rankMatches, parseQuickAdd, sortForSlot, usualForSlot, containsEveryWord } = require('../src/features/recipes/foodSearch')

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

  console.log('\n6 · Online search (Open Food Facts) — only products that contain the typed words')
  {
    check('every word, folded', containsEveryWord('Grovt brød', 'brod') && containsEveryWord('Coca-Cola Original Taste', 'coca cola'))
    check('a word inside a compound word', containsEveryWord('Kyllingfilet', 'kylling filet'))
    check('a word typed without the space', containsEveryWord('7 Up', '7up'))
    check('one missing word → no match', !containsEveryWord('Peanut Butter Smooth', 'gresham peanut butter'))
    check('an empty or punctuation-only query matches nothing', !containsEveryWord('Skyr', '  ') && !containsEveryWord('Skyr', ' – '))
    check('a number alone is never required (names write it their own way)', containsEveryWord('Skyr naturell', 'skyr 0%') && containsEveryWord('Coca-Cola Zero', 'cola 0'))
    check('…unless the query is only numbers', containsEveryWord('7 Up', '7') && !containsEveryWord('Skyr', '0'))

    const { searchFoodsByName } = require('../src/features/recipes/api/openFoodFactsApi')
    const urls = []
    let answer = []
    global.fetch = async url => { urls.push(String(url)); return { ok: true, status: 200, json: async () => ({ products: answer }) } }
    const off = (code, name, nameEn, brands, kcal) => ({ code, product_name: name, product_name_en: nameEn, brands, nutriments: kcal == null ? {} : { 'energy-kcal_100g': kcal } })
    // What /api/v2/search answered on 03.11.2026 for "skyr", "chicken breast" and
    // every other query: the most-scanned products (count 4,892,295 = all of OFF).
    const mostScanned = [
      off('6111246721261', 'Fromage Blanc Nature', 'Fromage Blanc Nature', 'Milky Food Professional, SODIPOL', 80.6),
      off('6111035000430', 'Sidi Ali', 'sidi ali', 'Sidi Ali, سيدي علي', 0),
      off('6111242100992', 'Perly', 'Perly', 'Jaouda, Perly', 97),
      off('5449000054227', 'Coca-Cola Original Taste', 'Coca-Cola Original Taste', 'Coca-Cola', 42),
    ]

    answer = mostScanned
    const r1 = await searchFoodsByName('skyr')
    const u = new URL(urls[0])
    check('asks the full-text endpoint /cgi/search.pl with the words (v2 /api/v2/search ignores search_terms)',
      u.pathname === '/cgi/search.pl' && u.searchParams.get('search_terms') === 'skyr' && u.searchParams.get('search_simple') === '1'
      && u.searchParams.get('action') === 'process' && u.searchParams.get('json') === '1', urls[0])
    check('the most-scanned products never fill a search for something else (the owner\'s three)', r1.length === 0, JSON.stringify(r1.map(p => p.name)))
    check('…nor a two-word search', (await searchFoodsByName('chicken breast')).length === 0)

    // /cgi/search.pl for "skyr" (live, 03.11.2026) ranks popular, loosely related products first.
    answer = [
      mostScanned[0],
      off('6111242100985', '', 'Fromage frais nature', 'Jaouda', 101),
      off('3329770077003', 'Skyr nature 0%', 'Skyr nature 0%', 'Yoplait', 57),
      mostScanned[1],
      off('3033491454080', 'SKYR', 'Skyr', 'Danone', 57.5),
      off('3023290030547', 'Skyr framboise', "siggi's Skyr Framboise", "siggi's", 87.9),
      off('1234567890128', 'Skyr', 'Skyr', 'Example Dairy', null),
    ]
    const r2 = await searchFoodsByName('Skyr')
    check('keeps the products that contain the word, in OFF\'s order, and still skips one with no kcal',
      JSON.stringify(r2.map(p => p.name)) === JSON.stringify(['Skyr nature 0%', 'Skyr', "siggi's Skyr Framboise"]), JSON.stringify(r2.map(p => p.name)))

    answer = [
      off('1', 'Peanut Butter Crunchy', 'Peanut Butter Crunchy', 'Gresham', 600),
      off('2', 'Peanut Butter Smooth', 'Peanut Butter Smooth', 'Example Spread', 590),
      off('3', 'Oat Biscuits', 'Oat Biscuits', 'Gresham', 480),
      off('4', 'Kyllingbrystfilet', 'Chicken breast fillet', 'Example Farm', 110),
    ]
    const r3 = await searchFoodsByName('gresham peanut butter')
    check('the words may sit in the name and the brand together', r3.length === 1 && r3[0].name === 'Peanut Butter Crunchy', JSON.stringify(r3.map(p => p.name)))
    const r4 = await searchFoodsByName('kyllingbryst')
    check('the product\'s own-language name counts too (shown by its English name)', r4.length === 1 && r4[0].name === 'Chicken breast fillet', JSON.stringify(r4.map(p => p.name)))
    check('asks for 50, so enough are left after the word check', new URL(urls[urls.length - 1]).searchParams.get('page_size') === '50')

    // OFF's busy 503 page has no CORS header: in a browser fetch throws instead of answering 503. That is retried as busy.
    let calls = 0
    global.fetch = async () => { calls++; throw new TypeError('Failed to fetch') }
    let said = ''
    try { await searchFoodsByName('skyr') } catch (e) { said = e.message }
    check('a request the browser reports as failed is tried 3 times, then says OFF is busy', calls === 3 && /busy/.test(said), `${calls} calls · ${said}`)
    calls = 0
    global.fetch = async () => { calls++; if (calls < 2) throw new TypeError('Load failed'); return { ok: true, status: 200, json: async () => ({ products: [off('1', 'Skyr naturell', 'Skyr', 'Q', 63)] }) } }
    const again = await searchFoodsByName('skyr')
    check('…and a later try that answers is used', calls === 2 && again.length === 1 && again[0].name === 'Skyr', JSON.stringify(again.map(p => p.name)))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.log(`  ✗ threw — ${e?.stack ?? e}`); process.exit(1) })
