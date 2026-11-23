#!/usr/bin/env node
/* Verification — a new Shop thing in the record's own popup (src/features/shop/components/record/createDraft.ts):
 * the draft each preset starts from, what the add form's autofill writes into it (and back), what a read receipt line
 * fills — never over what was typed, its category among them —, what Save waits for, and the row a save writes
 * for every kind (wish, general wish, own, had, accessory, model), so every field the record edits is one a new thing can hold.
 * Run: node scripts/verify-shop-create.cjs */
require('sucrase/register')
const C = require('../src/features/shop/components/record/createDraft')
const R = require('../src/features/ai/claude/featureRules')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const TODAY = '2026-11-23'
const CATS = [
  { id: 'c1', name: 'Electronics', parent_id: null }, { id: 'c2', name: 'Headphones', parent_id: 'c1' }, { id: 'c3', name: 'Garden', parent_id: null },
]
const blank = (spec) => C.blankState(spec, CATS, TODAY)
const set = (spec, s, patch) => ({ ...s, draft: { ...s.draft, ...patch } })

console.log('the presets')
{
  const wish = blank({ preset: 'wish' }), general = blank({ preset: 'general' }), own = blank({ preset: 'own' }), had = blank({ preset: 'had' })
  check('a wish is to buy, a general wish a general wish, own and had are yours or gone', C.stateOf({ preset: 'wish' }, false) === 'buy' && C.stateOf({ preset: 'general' }, false) === 'general'
    && C.stateOf({ preset: 'own' }, false) === 'mine' && C.stateOf({ preset: 'had' }, true) === 'gone' && C.stateOf({ preset: 'own' }, true) === 'gone')
  check('a thing you own starts with its day empty and "roughly" on; a wish has no day', own.draft.bought_day === '' && own.draft.approx_dates === true && !('bought_day' in wish.draft) && !('bought_day' in general.draft))
  check('the base row is of the kind: wishlist, general, bought, bought and gone', C.baseItem({ preset: 'wish' }, false).status === 'wishlist' && C.baseItem({ preset: 'general' }, false).kind === 'general'
    && C.baseItem({ preset: 'own' }, false).status === 'bought' && C.baseItem({ preset: 'had' }, true).disposal === 'sold' && C.baseItem({ preset: 'own' }, false).disposal === null)
  check('a blank draft is not dirty; typing makes it so', !C.isDirty(wish) && C.isDirty(set({ preset: 'wish' }, wish, { title: 'x' })) && had.had === true && !C.isDirty(had))
  const parent = { id: 'p1', status: 'bought', category_id: 'c1', region: 'NO', currency: 'EUR', platform: 'Demo Elektro', bought_at: '2026-10-01T10:00:00Z', approx_dates: true, title: 'Console' }
  const acc = C.blankState({ preset: 'accessory', parent }, CATS, TODAY)
  check('an accessory of something you own starts with its parent\'s category, store, currency, day and "roughly", and belongs to it', acc.draft.category_id === 'c1' && acc.draft.platform === 'Demo Elektro'
    && acc.draft.currency === 'EUR' && acc.draft.bought_day === '2026-10-01' && acc.draft.approx_dates === true && acc.draft.accessory_of === 'p1' && C.stateOf({ preset: 'accessory', parent }, false) === 'mine')
  const wishParent = { ...parent, status: 'wishlist', kind: 'general' }
  const model = C.blankState({ preset: 'model', parent: wishParent }, CATS, TODAY)
  check('a model of a general wish is a wish of the wish\'s category with option_for', C.stateOf({ preset: 'model', parent: wishParent }, false) === 'buy' && model.draft.option_for === 'p1' && model.draft.category_id === 'c1' && !('bought_day' in model.draft))
  check('an accessory of a wish is to buy (it is a wish too)', C.stateOf({ preset: 'accessory', parent: wishParent }, false) === 'buy')
  check('a category from the place that opened it is kept only when it exists', C.blankState({ preset: 'wish', defaults: { categoryId: 'c3' } }, CATS, TODAY).draft.category_id === 'c3'
    && !('category_id' in C.blankState({ preset: 'wish', defaults: { categoryId: 'nope' } }, CATS, TODAY).draft))
}

console.log('the autofill\'s draft, both ways')
{
  const spec = { preset: 'own' }
  let s = set(spec, blank(spec), { title: 'Demo Headphones', category_id: 'c2', price: 100, currency: 'EUR', platform: 'Demo Elektro', url: 'https://example.com/a', image_url: 'https://example.com/a.jpg', notes: 'n' })
  const view = C.shopDraftOf(spec, s, CATS)
  check('the add form sees the same fields: title, category pair, price, currency, store, link, picture, note', view.title === 'Demo Headphones' && view.topId === 'c1' && view.subId === 'c2' && view.price === 100
    && view.currency === 'EUR' && view.platform === 'Demo Elektro' && view.url === 'https://example.com/a' && view.image === 'https://example.com/a.jpg' && view.notes === 'n')
  s = C.withShopPatch(spec, s, CATS, { title: 'Better', price: null, topId: 'c3', subId: '', platform: '', image: null })
  check('what it writes lands in the record\'s columns: empty text is null, a category pair is one id', s.draft.title === 'Better' && s.draft.price === null && s.draft.category_id === 'c3' && s.draft.platform === null && s.draft.image_url === null)
  s = C.withShopPatch(spec, s, CATS, { topId: '__new__', subId: '' })
  check('a "+ New category…" from the form is the record\'s own "new:" pick, named later', s.draft.category_id === 'new:__new__\n' && C.missingFor({ preset: 'own' }, { ...s, draft: { ...s.draft, bought_day: '2026-11-01' } }, TODAY) === 'the new category\'s name')
  check('an empty patch changes nothing', C.withShopPatch(spec, s, CATS, {}) === s)
}

console.log('a read receipt line')
{
  const spec = { preset: 'own' }
  const fill = { title: 'Demo Headphones X1', price: 2990, currency: 'NOK', day: '2026-11-08', storeId: null, storeName: 'Demo Elektro', storeLabel: 'Demo Elektro', note: 'From the receipt: 24 months warranty.', lines: [], others: [], left: [], categoryId: 'c2', condition: 'used' }
  let s = C.withReceipt(spec, blank(spec), CATS, fill, '2026-11-23T10:00:00Z')
  const v = C.viewOf(spec, s)
  check('it fills the name, price, store, day, note and — by the receipt\'s own pick — the subcategory', v.title === 'Demo Headphones X1' && v.price === 2990 && v.platform === 'Demo Elektro' && s.draft.bought_day === '2026-11-08'
    && s.draft.approx_dates === false && v.notes.includes('24 months') && v.category_id === 'c2' && v.used === true, v)
  check('the category is a fact "from the receipt" to check, listed in "Filled in for you"', s.facts.some(f => f.key === 'category' && f.value.subId === 'c2' && f.confidence === 'check' && f.source.label === 'the receipt'))
  const typed = set(spec, blank(spec), { title: 'My own name', category_id: 'c3', bought_day: '2026-11-01', approx_dates: true })
  const t = C.withReceipt(spec, typed, CATS, fill, 'x')
  check('never over what was typed: a typed name, category and day stay', C.viewOf(spec, t).title === 'My own name' && t.draft.category_id === 'c3' && t.draft.bought_day === '2026-11-01')
  const second = C.withReceipt(spec, s, CATS, { ...fill, title: 'Another', day: '2026-11-09', categoryId: 'c1' }, 'x')
  check('a second receipt replaces the first one\'s values (they were not typed)', C.viewOf(spec, second).title === 'Another' && second.draft.bought_day === '2026-11-09' && C.viewOf(spec, second).category_id === 'c1')
  check('a line that was filled but not saved is unsaved work', C.isDirty(s))
  check('with no category in the list (a read without one) the fill still works', !C.withReceipt(spec, blank(spec), CATS, { ...fill, categoryId: undefined }, 'x').facts.some(f => f.key === 'category'))
}

console.log('Save waits for what it needs')
{
  const own = { preset: 'own' }, had = { preset: 'had' }
  check('a name first', C.missingFor({ preset: 'wish' }, blank({ preset: 'wish' }), TODAY) === 'a name')
  check('a wish needs only a name', C.missingFor({ preset: 'wish' }, set({ preset: 'wish' }, blank({ preset: 'wish' }), { title: 'x' }), TODAY) === null)
  check('something you own needs its day, not in the future', C.missingFor(own, set(own, blank(own), { title: 'x' }), TODAY) === 'the day it was bought'
    && C.missingFor(own, set(own, blank(own), { title: 'x', bought_day: '2026-12-01' }), TODAY) === 'a day that is not in the future'
    && C.missingFor(own, set(own, blank(own), { title: 'x', bought_day: '2026-11-01' }), TODAY) === null)
  check('something you had also needs the day it left, not before it was bought', C.missingFor(had, set(had, blank(had), { title: 'x', bought_day: '2026-11-01' }), TODAY) === 'the day it left'
    && C.missingFor(had, set(had, blank(had), { title: 'x', bought_day: '2026-11-05', disposed_on: '2026-11-01' }), TODAY) === 'a day it left that is not before it was bought'
    && C.missingFor(had, set(had, blank(had), { title: 'x', bought_day: '2026-11-01', disposed_on: '2026-11-05' }), TODAY) === null)
  check('switching "I had it" back to "I still have it" no longer asks for the day it left', C.missingFor(had, { ...set(had, blank(had), { title: 'x', bought_day: '2026-11-01' }), had: false }, TODAY) === null)
}

console.log('the row a save writes')
{
  const wish = set({ preset: 'wish' }, blank({ preset: 'wish' }), { title: ' Demo Speaker ', price: 500, currency: 'EUR', platform: 'Demo Elektro', url: 'https://example.com/s', priority: 'high', planned_date: '2026-12-01', reason: 'need', target_price: 400, wait_for_deal: true, deal_note: 'Black Week', errand: true, notes: 'n', region: 'NO', image_url: 'https://example.com/s.jpg' })
  let i = C.inputOf({ preset: 'wish' }, wish, 'c1', CATS)
  check('a wish: every field of the record\'s buy facts', i.title === 'Demo Speaker' && i.list === 'wishlist' && i.category_id === 'c1' && i.price === 500 && i.currency === 'EUR' && i.platform === 'Demo Elektro' && i.url === 'https://example.com/s'
    && i.priority === 'high' && i.planned_date === '2026-12-01' && i.reason === 'need' && i.target_price === 400 && i.wait_for_deal === true && i.deal_note === 'Black Week' && i.errand === true && i.notes === 'n' && i.region === 'NO' && i.image_url === 'https://example.com/s.jpg' && !('status' in i), i)
  const gen = set({ preset: 'general' }, blank({ preset: 'general' }), { title: 'A tablet', price_min: 2000, price_max: 4000, requirements: ' Pen support ', priority: 'low', reason: 'fun', category_id: 'c1' })
  i = C.inputOf({ preset: 'general' }, gen, 'c1', CATS)
  check('a general wish: its range, must-haves, reason and priority, no price, link or store', i.kind === 'general' && i.price_min === 2000 && i.price_max === 4000 && i.requirements === 'Pen support' && i.priority === 'low' && i.reason === 'fun' && i.price === null && i.url === null && i.platform === null)
  const own = set({ preset: 'own' }, blank({ preset: 'own' }), { title: 'Console', price: 100, currency: 'EUR', bought_day: '2026-11-01', approx_dates: false, platform: 'Demo Elektro', serial: 'SN1', market_price: 150, value_now: 90, for_resale: true, used: true, got_as_gift: false, fx_nok: 11.5, notes: 'n', accessory_of: 'p9', kept: false })
  i = C.inputOf({ preset: 'own' }, own, 'c1', CATS)
  check('something you own: bought, its day at midday, rate typed as the owner\'s own, price before discount, serial, "could sell for" dated, bought to sell, used, not mine to keep, accessory of', i.status === 'bought' && /^2026-11-01T/.test(i.bought_at) && i.approx_dates === false && i.fx_nok === 11.5 && i.fx_source === 'manual'
    && i.market_price === 150 && i.market_currency === 'EUR' && i.serial === 'SN1' && i.value_now === 90 && i.value_currency === 'NOK' && /^\d{4}-\d{2}-\d{2}$/.test(i.value_on) && i.for_resale === true && i.used === true && i.kept === false && i.accessory_of === 'p9' && !('disposal' in i), i)
  const gift = set({ preset: 'own' }, blank({ preset: 'own' }), { title: 'Gift', bought_day: '2026-11-01', got_as_gift: true })
  check('a gift with no price is saved as 0 (it came with it)', C.inputOf({ preset: 'own' }, gift, null, CATS).price === 0 && C.inputOf({ preset: 'own' }, gift, null, CATS).category_id === null)
  const had = set({ preset: 'had' }, blank({ preset: 'had' }), { title: 'Old phone', bought_day: '2026-01-01', disposed_on: '2026-06-01', disposal: 'sold', sold_to: ' Demo Market ', sale_price: 40, sale_currency: 'NOK' })
  i = C.inputOf({ preset: 'had' }, had, null, CATS)
  check('something you had: how it left, the day, to whom, and the money back', i.disposal === 'sold' && i.disposed_on === '2026-06-01' && i.sold_to === 'Demo Market' && i.sale_price === 40 && i.sale_currency === 'NOK')
  const given = set({ preset: 'had' }, blank({ preset: 'had' }), { title: 'Old phone', bought_day: '2026-01-01', disposed_on: '2026-06-01', disposal: 'given', sale_price: 40 })
  check('given away keeps no money back', !('sale_price' in C.inputOf({ preset: 'had' }, given, null, CATS)))
  const acc = C.blankState({ preset: 'accessory', parent: { id: 'p1', status: 'bought', category_id: 'c1', bought_at: '2026-10-01T10:00:00Z', currency: 'NOK', title: 'Console' } }, CATS, TODAY)
  i = C.inputOf({ preset: 'accessory', parent: { id: 'p1', status: 'bought', title: 'Console' } }, set({}, acc, { title: 'Case', price: 0 }), 'c1', CATS)
  check('an accessory: belongs to its parent, bought on the parent\'s day', i.accessory_of === 'p1' && i.status === 'bought' && /^2026-10-01T/.test(i.bought_at) && i.price === 0 && C.quietSave({ preset: 'accessory' }) && !C.quietSave({ preset: 'own' }))
  const mdl = C.blankState({ preset: 'model', parent: { id: 'w1', status: 'wishlist', category_id: 'c1', region: 'NO', currency: 'NOK', title: 'Tablet' } }, CATS, TODAY)
  i = C.inputOf({ preset: 'model', parent: { id: 'w1', title: 'Tablet' } }, set({}, mdl, { title: 'Tab X', price: 3000 }), 'c1', CATS)
  check('a model: a wish of the general wish', i.option_for === 'w1' && i.status === undefined && i.price === 3000 && i.list === 'wishlist')
  const kept = C.blankState({ preset: 'wish' }, CATS, TODAY)
  const withFacts = { ...set({}, kept, { title: 'Demo Phone' }), facts: [{ key: 'brand', value: 'Demo', source: { origin: 'link', label: 'example.com' }, confidence: 'exact', on: true, at: 'x' }, { key: 'ean', value: '4006381333931', source: { origin: 'scan', label: 'the barcode' }, confidence: 'exact', on: true, at: 'x' }] }
  i = C.inputOf({ preset: 'wish' }, withFacts, null, CATS)
  check('the facts the owner kept go with their sources, the EAN in its own column', i.ean === '4006381333931' && i.facts?.brand?.value === 'Demo' && i.facts.brand.source === 'example.com')
  const unticked = { ...withFacts, facts: withFacts.facts.map(f => ({ ...f, on: false })) }
  check('an unticked fact is not saved', !('facts' in C.inputOf({ preset: 'wish' }, unticked, null, CATS)) && !('ean' in C.inputOf({ preset: 'wish' }, unticked, null, CATS)))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
