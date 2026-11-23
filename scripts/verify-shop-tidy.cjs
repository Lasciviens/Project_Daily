#!/usr/bin/env node
/*
 * Verification — Shop's "Tidy up info" (src/features/shop/tidyModel.ts), against the REAL module via sucrase: what
 * is sent, the app's second check of the AI's answer (only name, brand, model and a category that was sent can come
 * through), the fields to review, the write that saves the ticked ones, the write that puts back exactly what was
 * there, and the worst-case cost shown before "all" starts. Made-up things only.
 *
 * Run: node scripts/verify-shop-tidy.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const T = require('../src/features/shop/tidyModel')

let ok = 0, bad = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : `— ${JSON.stringify(detail)}`.slice(0, 500)) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const item = (over = {}) => ({ id: 'i1', user_id: 'u', category_id: 'c-home', title: '  SONY wh-1000xm5   trådløse hodetelefoner NYHET ', list: 'wishlist', kind: 'item', status: 'bought', facts: null, ...over })
const CATS = [
  { id: 'c-el', name: 'Electronics', parent_id: null }, { id: 'c-hp', name: 'Headphones', parent_id: 'c-el' }, { id: 'c-home', name: 'Home', parent_id: null },
  { id: 'c-blank', name: '   ', parent_id: null },
]
const list = T.tidyCategories(CATS)
const allowed = new Set(list.map(c => c.id))
const pathOf = id => (id === 'c-hp' ? 'Electronics / Headphones' : id === 'c-home' ? 'Home' : id === 'c-el' ? 'Electronics' : 'No category')

console.log('\nwhat is sent')
check('categories are the owner\'s own: tops first, then "Top / Sub", a blank name left out, each with its id', same(list, [{ id: 'c-el', path: 'Electronics' }, { id: 'c-home', path: 'Home' }, { id: 'c-hp', path: 'Electronics / Headphones' }]), list)
check('at most 120 categories, a path cut at 60 characters', T.tidyCategories(Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}`, parent_id: null }))).length === 120 && [...T.tidyCategories([{ id: 'x', name: 'N'.repeat(100), parent_id: null }])[0].path].length === 60)
const input = T.tidyInputFor(item({ facts: { brand: { value: 'Sony', source: 'you', confidence: 'exact' } } }), list, pathOf)
check('the input is the thing\'s name (spaces squeezed), brand, model and category now, and the category list', input.item.name === 'SONY wh-1000xm5 trådløse hodetelefoner NYHET' && input.item.brand === 'Sony' && input.item.model === '' && input.item.category === 'Home' && input.categories === list, input)
check('only a thing\'s name, brand, model and category are in the input: no link, picture, price or date', same(Object.keys(input.item).sort(), ['brand', 'category', 'model', 'name']) && same(Object.keys(input).sort(), ['categories', 'item']))

console.log('\nthe second check')
const good = { name: 'Sony WH-1000XM5 trådløse hodetelefoner', brand: 'Sony', model: 'WH-1000XM5', category_id: 'c-hp' }
check('a good answer comes through as it is', same(T.readTidySuggestion(good, item(), allowed), good))
for (const [label, patch, key] of [
  ['a name that shares no word with the old one', { name: 'Garden hose 20 m' }, 'name'], ['a name with a web address', { name: 'Sony WH-1000XM5 evil.example' }, 'name'], ['a name with a path', { name: 'Sony wh-1000xm5 / evil' }, 'name'],
  ['a name of 121 characters', { name: `Sony ${'x'.repeat(116)}` }, 'name'], ['a name that is not text', { name: 5 }, 'name'], ['a name equal to the old one', { name: 'SONY wh-1000xm5 trådløse hodetelefoner NYHET' }, 'name'],
  ['a brand that is a link', { brand: 'evil.example' }, 'brand'], ['a brand of 61 characters', { brand: 'B'.repeat(61) }, 'brand'], ['a model with a slash', { model: 'a/b' }, 'model'],
  ['a category that was never sent', { category_id: 'c-evil' }, 'category_id'], ['a category that is the one it has', { category_id: 'c-home' }, 'category_id'], ['a category that is a number', { category_id: 1 }, 'category_id'],
]) {
  const r = T.readTidySuggestion({ ...good, ...patch }, item(), allowed)
  check(`${label}: that field is dropped, never repaired; the rest stays`, r && !(key in r) && Object.keys(good).filter(k => k !== key).every(k => k in r), r)
}
check('unknown keys (a link, a picture, a price, a date) never come through', same(Object.keys(T.readTidySuggestion({ ...good, url: 'https://evil.example', image_url: 'x', price: 1, bought_at: '2026-01-01', notes: 'x' }, item(), allowed)).sort(), ['brand', 'category_id', 'model', 'name']))
check('nothing to suggest, a list, null and text are null', T.readTidySuggestion({}, item(), allowed) === null && T.readTidySuggestion([good], item(), allowed) === null && T.readTidySuggestion(null, item(), allowed) === null && T.readTidySuggestion('x', item(), allowed) === null)
check('zero-width characters cannot hide a link or a word', T.readTidySuggestion({ name: 'Sony WH-1000XM5 evil​.example' }, item(), allowed) === null && T.readTidySuggestion({ brand: 'ev‮il.example' }, item(), allowed) === null)
check('a name that shares a word only with the brand or model it has is still a tidy of this thing', T.readTidySuggestion({ name: 'Walkman Pro' }, item({ title: 'Audio player', facts: { model: { value: 'Walkman', source: 'x', confidence: 'check' } } }), allowed)?.name === 'Walkman Pro')

console.log('\nthe review')
const ch = T.tidyChanges(item(), good, pathOf)
check('the fields: name, brand, model and category, before → after (a missing brand or model reads "—")', same(ch.map(c => [c.key, c.before, c.after]), [['name', 'SONY wh-1000xm5 trådløse hodetelefoner NYHET', good.name], ['brand', '—', 'Sony'], ['model', '—', 'WH-1000XM5'], ['category', 'Home', 'Electronics / Headphones']]), ch)
check('a brand or model the owner typed (source "you") is never offered a replacement', same(T.tidyChanges(item({ facts: { brand: { value: 'Sonny', source: 'you', confidence: 'exact' }, model: { value: 'X', source: 'the receipt', confidence: 'check' } } }), good, pathOf).map(c => c.key), ['name', 'model', 'category']))

console.log('\nthe write, and the Undo')
const withFacts = item({ facts: { ean: { value: '1234567890123', source: 'Kassalapp', confidence: 'exact' } } })
const all = new Set(['name', 'brand', 'model', 'category'])
const patch = T.tidyPatch(withFacts, good, all)
check('all ticked: the title and category columns and the brand and model facts (source "Tidy up (AI)", confidence "check"), keeping the facts it had', patch.title === good.name && patch.category_id === 'c-hp' && same(patch.facts.brand, { value: 'Sony', source: 'Tidy up (AI)', confidence: 'check' }) && same(patch.facts.model, { value: 'WH-1000XM5', source: 'Tidy up (AI)', confidence: 'check' }) && patch.facts.ean.value === '1234567890123', patch)
check('nothing but title, category_id and facts is ever written', same(Object.keys(patch).sort(), ['category_id', 'facts', 'title']))
check('an unticked field is never written', same(Object.keys(T.tidyPatch(item(), good, new Set(['brand']))), ['facts']) && same(Object.keys(T.tidyPatch(item(), good, new Set(['name']))), ['title']) && same(T.tidyPatch(item(), good, new Set()), {}))
check('facts are left out of the write unless brand or model is ticked', !('facts' in T.tidyPatch(item(), good, new Set(['name', 'category']))))
const back = T.tidyUndoPatch(withFacts, patch)
check('Undo writes back exactly what was there, for exactly the fields written (the facts whole, or none)', back.title === withFacts.title && back.category_id === 'c-home' && same(back.facts, withFacts.facts) && same(T.tidyUndoPatch(item(), T.tidyPatch(item(), good, new Set(['brand']))), { facts: null }) && same(Object.keys(T.tidyUndoPatch(item(), T.tidyPatch(item(), good, new Set(['name'])))), ['title']))

console.log('\nthe scope and the cost')
const rows = [item({ id: 'a' }), item({ id: 'b', list: 'quick' }), item({ id: 'c', kind: 'general' }), item({ id: 'd', status: 'dropped' }), item({ id: 'e', status: 'wishlist' })]
check('"all" is wishes and things you own: never the quick list, a general wish or a thing dropped', same(T.tidyScope(rows).map(r => r.id), ['a', 'e']), T.tidyScope(rows).map(r => r.id))
const prices = { webSearchUsdEach: 0.01, longPromptOverTokens: 200_000, longPromptMultiplier: 5, model: { cacheWrite1hPerMTok: 0.2, outputPerMTok: 0.5 } }
const each = T.tidyWorstCost(prices, { instructions: 1800, input: 3000 }, 1500)
// reads = 3 × (1800 + 3000 + 1000) + 3 × 25,000 = 92,400 tokens; × 0.2 / 1e6 = 0.01848; output 1500 × 0.5 / 1e6 = 0.00075; + 2 × 0.01
check('the worst case of one call is the function\'s reservation formula: 3 rounds of the prompt, 75,000 result tokens, the answer limit and 2 searches', Math.abs(each - (0.01848 + 0.00075 + 0.02)) < 1e-6, each)
check('past the long-prompt line the multiplier applies to the tokens, never to the searches', Math.abs(T.tidyWorstCost({ ...prices, longPromptOverTokens: 1000 }, { instructions: 1800, input: 3000 }, 1500) - ((0.01848 + 0.00075) * 5 + 0.02)) < 1e-6)
check('the limits are the function\'s: 2 searches, name 120, brand and model 60', T.TIDY_LIMITS.searches === 2 && T.TIDY_LIMITS.name === 120 && T.TIDY_LIMITS.word === 60)

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
