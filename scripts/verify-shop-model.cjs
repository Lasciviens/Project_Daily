#!/usr/bin/env node
/* Verification — Shop's rules (src/features/shop/shopModel.ts, migration 134):
 * lists, currencies, search, wishlist filters / sort / groups / totals, the
 * quick list's stores, picked-up and buy-again rows, and the bought history.
 * Run: node scripts/verify-shop-model.cjs */
require('sucrase/register')
const M = require('../src/features/shop/shopModel')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

let n = 0
function item(p) {
  n++
  return {
    id: p.id ?? `i${n}`, user_id: 'u', category_id: null, title: `Item ${n}`, notes: null, price: null, price_source: null,
    platform: null, url: null, priority: 'medium', region: null, planned_date: null, status: 'wishlist', source_type: 'manual',
    created_at: `2026-09-${String(10 + n).padStart(2, '0')}T10:00:00.000Z`, updated_at: '2026-09-30T10:00:00.000Z',
    list: 'wishlist', currency: null, bought_at: null, task_id: null, ...p,
  }
}
const cats = [
  { id: 'tech', user_id: 'u', name: 'Tech', parent_id: null, created_at: '' },
  { id: 'tech-audio', user_id: 'u', name: 'Audio', parent_id: 'tech', created_at: '' },
  { id: 'tech-cams', user_id: 'u', name: 'Cameras', parent_id: 'tech', created_at: '' },
  { id: 'home', user_id: 'u', name: 'Home', parent_id: null, created_at: '' },
  { id: 'home-kitchen', user_id: 'u', name: 'Kitchen', parent_id: 'home', created_at: '' },
]
// USD-base rates, as Open Exchange Rates returns them.
const rates = { NOK: 10, TRY: 40, EUR: 0.9 }

console.log('lists and currencies')
check('a row without `list` (before 134) is a wishlist row', M.listOf({}) === 'wishlist' && M.listOf({ list: 'quick' }) === 'quick')
check('its own currency wins', M.currencyOf({ currency: 'EUR', region: 'TR' }) === 'EUR')
check('no currency: Turkey → TRY, otherwise NOK', M.currencyOf({ currency: null, region: 'TR' }) === 'TRY' && M.currencyOf({ currency: null, region: null }) === 'NOK' && M.currencyOf({ region: 'NO' }) === 'NOK')
check('the other currency beside NOK is TRY and back; EUR/USD show NOK', M.otherCurrency('NOK') === 'TRY' && M.otherCurrency('TRY') === 'NOK' && M.otherCurrency('EUR') === 'NOK' && M.otherCurrency('USD') === 'NOK')

console.log('search')
check('fold: accents and ø/æ/ı', M.fold('Kjøttdeig') === 'kjottdeig' && M.fold('Şeker') === 'seker' && M.fold('Iğdır') === 'igdir' && M.fold('Blåbær') === 'blabaer')
const kb = item({ title: 'Mechanical keyboard', notes: 'Brown switches', platform: 'Komplett' })
check('every word must appear (title + notes + store + category)', M.matchesSearch(kb, 'keyb brown') && M.matchesSearch(kb, 'komplett') && !M.matchesSearch(kb, 'keyboard blue'))
check('the category name is searched too', M.matchesSearch(kb, 'tech', 'Tech Audio') && !M.matchesSearch(kb, 'tech'))
check('an empty query matches', M.matchesSearch(kb, '   '))

console.log('categories')
check('a subcategory row: top + sub', eq(M.categoryPath('tech-audio', cats), { topId: 'tech', topName: 'Tech', subName: 'Audio' }))
check('a row on a top category itself has no sub', eq(M.categoryPath('home', cats), { topId: 'home', topName: 'Home', subName: null }))
check('no or unknown category → "No category"', M.categoryPath(null, cats).topId === null && M.categoryPath('gone', cats).topName === 'No category')

console.log('wishlist filters')
const w1 = item({ title: 'Headphones', category_id: 'tech-audio', region: 'NO', priority: 'high', price: 3000, currency: 'NOK' })
const w2 = item({ title: 'Çaydanlık', category_id: 'home-kitchen', region: 'TR', priority: 'low', price: 1200, currency: 'TRY' })
const w3 = item({ title: 'Camera strap', category_id: 'tech-cams', priority: 'medium' })
const w4 = item({ title: 'Lamp', category_id: null, priority: 'medium', price: 50, currency: 'EUR', planned_date: '2026-10-01' })
const q1 = item({ title: 'Milk', list: 'quick' })
const b1 = item({ title: 'Old phone', status: 'bought', bought_at: '2026-10-03T08:00:00.000Z', price: 4000, currency: 'NOK' })
const d1 = item({ title: 'Drone', status: 'dropped' })
const all = [w1, w2, w3, w4, q1, b1, d1]
const ids = list => list.map(i => i.id).sort()
check('only wishlist rows still to buy', eq(ids(M.filterWishlist(all, cats, M.NO_FILTERS)), ids([w1, w2, w3, w4])))
check('category filter is the top category', eq(ids(M.filterWishlist(all, cats, { ...M.NO_FILTERS, category: 'tech' })), ids([w1, w3])))
check('"No category" filter', eq(ids(M.filterWishlist(all, cats, { ...M.NO_FILTERS, category: 'none' })), ids([w4])))
check('region filter and "no country set"', eq(ids(M.filterWishlist(all, cats, { ...M.NO_FILTERS, region: 'TR' })), ids([w2]))
  && eq(ids(M.filterWishlist(all, cats, { ...M.NO_FILTERS, region: 'none' })), ids([w3, w4])))
check('priority filter', eq(ids(M.filterWishlist(all, cats, { ...M.NO_FILTERS, priority: 'medium' })), ids([w3, w4])))
check('search reaches the category name and folds accents', eq(ids(M.filterWishlist(all, cats, { ...M.NO_FILTERS, q: 'kitchen caydanlik' })), ids([w2])))
check('filtersActive', !M.filtersActive(M.NO_FILTERS) && M.filtersActive({ ...M.NO_FILTERS, q: ' x' }) && M.filtersActive({ ...M.NO_FILTERS, region: 'NO' }))

console.log('sort')
const open = [w1, w2, w3, w4]
check('priority: high first, then the buy-on date', eq(M.sortItems(open, 'priority').map(i => i.title), ['Headphones', 'Lamp', 'Camera strap', 'Çaydanlık']))
check('price high → low compares in NOK (1 200 TRY = 300 NOK < 50 EUR ≈ 556 NOK); no price last',
  eq(M.sortItems(open, 'price-desc', rates).map(i => i.title), ['Headphones', 'Lamp', 'Çaydanlık', 'Camera strap']))
check('price low → high still puts no price last', eq(M.sortItems(open, 'price-asc', rates).map(i => i.title), ['Çaydanlık', 'Lamp', 'Headphones', 'Camera strap']))
check('buy-on date: dated first', M.sortItems(open, 'planned')[0].title === 'Lamp')
check('A–Z', eq(M.sortItems(open, 'title').map(i => i.title), ['Camera strap', 'Çaydanlık', 'Headphones', 'Lamp']))
check('newest first', M.sortItems(open, 'newest')[0].id === w4.id)

console.log('totals')
const t = M.totalsIn(open, 'NOK', rates)
check('with rates every price converts into NOK, in whole kroner (3000 + 300 + 555.56)', t.amount === 3856 && t.unconverted.length === 0, JSON.stringify(t))
check('rows without a price are counted, never as 0 silently', t.count === 4 && t.unpriced === 1)
const t2 = M.totalsIn(open, 'NOK', null)
check('without rates only NOK prices add up; the rest stay per currency', t2.amount === 3000 && eq(t2.unconverted.map(u => u.currency).sort(), ['EUR', 'TRY']))
check('totalsLabel joins what could not convert', M.totalsLabel(t2) === '3 000 NOK + 1 200 TRY + 50 EUR', M.totalsLabel(t2))
check('no "0 NOK +" in front of sums that could not convert', M.totalsLabel(M.totalsIn([w4], 'NOK', null)) === '50 EUR' && M.totalsLabel(M.totalsIn([], 'NOK', null)) === '0 NOK')
check('≈ the other currency', M.approxOther(1000, 'NOK', rates) === '≈ 4 000 TRY' && M.approxOther(1000, 'NOK', null) === null && M.approxOther(0, 'NOK', rates) === null)
check('price label (+ est.)', M.priceLabel(w1) === '3 000 NOK' && M.priceLabel({ ...w1, price_source: 'ai_estimate' }) === '3 000 NOK (est.)' && M.priceLabel(w3) === null)

console.log('groups')
const topOwn = item({ title: 'Home sign', category_id: 'home' })
const g = M.groupByCategory(M.sortItems([w1, w2, w3, w4, topOwn], 'title'), cats)
check('tops A–Z, "No category" last', eq(g.map(x => x.title), ['Home', 'Tech', 'No category']))
check('a top\'s own rows lead its subcategories', eq(g[0].subs.map(s => s.title), [null, 'Kitchen']))
check('subs A–Z and rows keep their order', eq(g[1].subs.map(s => s.title), ['Audio', 'Cameras']) && g[1].items.length === 2)

check('category columns: one per 20rem, never more than the groups', M.groupColumnCount(22.5, 4) === 1 && M.groupColumnCount(48, 4) === 2 && M.groupColumnCount(109, 4) === 4 && M.groupColumnCount(109, 9) === 5 && M.groupColumnCount(10, 0) === 1)

console.log('quick list')
const qa = item({ title: 'Bread', list: 'quick', platform: 'Rema', created_at: '2026-10-01T08:00:00.000Z' })
const qb = item({ title: 'Eggs', list: 'quick', platform: 'rema ', created_at: '2026-10-02T08:00:00.000Z' })
const qc = item({ title: 'Batteries', list: 'quick', platform: null, created_at: '2026-09-30T08:00:00.000Z' })
const qd = item({ title: 'Plaster', list: 'quick', platform: 'Apotek', created_at: '2026-10-03T08:00:00.000Z' })
const quick = [qa, qb, qc, qd]
check('open rows in the order added', eq(M.quickOpen([...quick, w1]).map(i => i.title), ['Batteries', 'Bread', 'Eggs', 'Plaster']))
const stores = M.groupByStore(M.quickOpen(quick))
check('stores A–Z, folded together, "Any store" last', eq(stores.map(s => s.title), ['Apotek', 'rema', 'Any store']) && stores[1].items.length === 2, JSON.stringify(stores.map(s => s.title)))
check('a group is named by its newest spelling', stores[1].title === 'rema')
check('no store anywhere → one group without a heading', eq(M.groupByStore([qc]).map(s => s.title), [null]))
const today = '2026-10-07'
const p1 = item({ title: 'Milk', list: 'quick', status: 'bought', bought_at: '2026-10-07T09:00:00' })
const p2 = item({ title: 'milk ', list: 'quick', status: 'bought', bought_at: '2026-10-01T09:00:00' })
const p3 = item({ title: 'Coffee', list: 'quick', status: 'bought', bought_at: '2026-09-01T09:00:00' })
const p4 = item({ title: 'Bread', list: 'quick', status: 'bought', bought_at: '2026-09-20T09:00:00' })
const hist = [...quick, p1, p2, p3, p4]
check('picked up today (local day)', eq(M.pickedUpOn(hist, today).map(i => i.title), ['Milk']))
const again = M.buyAgain(hist)
check('buy again: most often bought first, not what is already open', eq(again.map(a => a.title), ['Milk', 'Coffee']) && again[0].count === 2, JSON.stringify(again.map(a => [a.title, a.count])))
check('buy again carries the latest purchase (its store/category go with a re-add)', again[0].row.id === p1.id)
check('store names by use (first spelling)', eq(M.storeNames(quick), ['Rema', 'Apotek']), JSON.stringify(M.storeNames(quick)))

console.log('bought')
const b2 = item({ title: 'Desk', status: 'bought', bought_at: '2026-10-05T12:00:00', price: 2000, currency: 'NOK' })
const b3 = item({ title: 'Lens', status: 'bought', bought_at: null, updated_at: '2025-12-24T12:00:00', price: 100, currency: 'EUR' })
const bl = M.boughtList([b1, b2, b3, p1, w1])
check('wishlist purchases only, latest first', eq(bl.map(i => i.title), ['Desk', 'Old phone', 'Lens']))
check('without bought_at the last edit is the date', M.boughtDay(b3) === '2025-12-24' && M.boughtDay(w1) === null)
const s = M.spentSummary(bl, today, 'NOK', rates)
check('spent this month / year / all time', s.month.amount === 6000 && s.year.amount === 6000 && s.all.amount === 7111, JSON.stringify([s.month.amount, s.year.amount, s.all.amount]))

console.log('planning')
check('"Buy <title>", due on its buy-on day, with its notes', eq(M.planDefaults({ title: ' Lamp ', planned_date: '2026-10-01', notes: 'the brass one' }), { title: 'Buy Lamp', dueDate: '2026-10-01', notes: 'the brass one' }))
check('no buy-on day → no due date', eq(M.planDefaults({ title: 'Lamp', planned_date: null, notes: null }), { title: 'Buy Lamp' }))

console.log('days near midnight UTC and dropped rows')
{
  // 22:30 UTC on 06.10 is already 07.10 in Oslo and Tokyo, still 06.10 in Los Angeles.
  const late = item({ title: 'Late buy', status: 'bought', bought_at: '2026-10-06T22:30:00.000Z' })
  const d = new Date('2026-10-06T22:30:00.000Z')
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  check('a purchase at 22:30 UTC files under the local day', M.boughtDay(late) === expected, `${M.boughtDay(late)} vs ${expected}`)
  check('picked up on that local day, not the UTC one', M.pickedUpOn([{ ...late, list: 'quick' }], expected).length === 1)
  const dq = item({ title: 'Old errand', list: 'quick', status: 'dropped' })
  const dw = item({ title: 'Old wish', status: 'dropped' })
  check('"Not any more" lists dropped rows of both lists', eq(M.droppedItems([dq, dw, item({})]).map(i => i.title).sort(), ['Old errand', 'Old wish']))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
