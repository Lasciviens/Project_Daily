/* The typical saves of the three old Shop screens (add: ShopCreate, open: ShopRecord, Just bought: JustBoughtSheet), as
 * data, for the "same data as before" check of the one body (scripts/verify-shop-one-body.mjs). Each scenario is run
 * through an `api` — the old code made `shop-one-body-payloads.json` (origin/main f207a3a1, 24.11.2026), the new code must
 * give the same payload, or a difference listed in that check with its reason. Made-up data only.
 *
 *   api.C        — createDraft (blankState, applyPreset, withReceipt, withShopPatch, inputOf)
 *   api.patchOf  — useRecordDraft.patchOf (the record's Save)
 *   api.justBought(item, form, ctx) → { patch, costs, done } | null — Just bought's Save
 *   api.formOf(item, ctx) — Just bought's form as it opens
 *   api.withReceipt(form, fill, read, boughtDay, today) — a read receipt on Just bought's form
 */
const { buildTables } = require('../harness/seed.cjs')
const R = require('../../src/features/shop/storeRows')

const TODAY = '2026-11-23'
const NOW = '2026-11-23T10:00:00.000Z'
const T = buildTables(new Date('2026-11-10T12:00:00Z'))
const stores = T.shop_stores.map(R.parseStore)
const rules = T.shop_store_rules.map(R.parseStoreRule)
const law = T.shop_law_rules.map(R.parseLawRule)
const CATS = [
  { id: 'c1', name: 'Electronics', parent_id: null }, { id: 'c2', name: 'Headphones', parent_id: 'c1' }, { id: 'c3', name: 'Garden', parent_id: null },
]
const ctx = { stores, rules, law, categories: CATS, today: TODAY }
const elkjop = stores.find(s => s.name === 'Elkjøp')

const row = (o = {}) => ({
  id: 'i1', user_id: 'u1', category_id: 'c2', title: 'Demo Headphones X5', notes: null, price: 3490, price_source: 'manual', platform: null, url: null,
  priority: 'medium', region: 'NO', planned_date: null, status: 'bought', source_type: 'manual', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-20T10:00:00Z',
  list: 'wishlist', currency: 'NOK', kind: 'item', approx_dates: false, disposal: null, accessory_of: null, option_for: null,
  bought_at: '2026-11-20T11:00:00.000Z', bought_channel: null, arrived_on: null, return_by: null, warranty_until: null, extra_warranty_until: null, receipt_note: null,
  discount_amount: null, discount_reason: null, market_price: null, market_currency: null, ...o,
})

const receipt = (o = {}) => ({
  fill: { storeId: elkjop.id, storeName: 'Elkjøp', storeLabel: 'Elkjøp', day: '2026-11-19', note: 'Order 1234', lines: ['Demo Headphones X5', 'Cable'], others: [], left: [],
    costs: [{ kind: 'shipping', label: 'Shipping', amount: 99, currency: 'NOK' }], warrantyUntil: '2028-11-19', channel: 'online', ...o.fill },
  read: { kind: 'bought', channel: 'online', currency: 'NOK', total: 3589, date: '2026-11-19', store: 'Elkjøp',
    items: [{ name: 'Demo Headphones X5', price: 2990, discount: 500, discount_reason: 'member', before: 3490 }, { name: 'Cable', price: 99 }], ...o.read },
})

const fillFor = (o = {}) => ({
  title: 'Demo Speaker', brand: 'Demo', model: 'S1', categoryId: 'c1', price: 1290, currency: 'NOK', day: '2026-11-18', storeId: elkjop.id, storeName: 'Elkjøp', storeLabel: 'Elkjøp',
  note: 'Receipt 99', lines: ['Demo Speaker'], others: [], left: [], costs: [], ...o,
})

/** Each add scenario: a preset, a parent, the draft typed on top, an optional receipt fill; the category made at save. */
function addScenarios(C) {
  const parent = row({ id: 'p1', title: 'Console', category_id: 'c1', platform: 'Demo Elektro', currency: 'EUR', bought_at: '2026-10-01T10:00:00Z', approx_dates: true })
  const wishParent = row({ id: 'g1', title: 'A tablet', status: 'wishlist', kind: 'general', bought_at: null })
  const make = (spec, draft = {}, extra) => {
    let s = C.blankState(spec, CATS, TODAY)
    if (extra && extra.receipt) s = C.withReceipt(spec, s, CATS, extra.receipt, NOW)
    if (extra && extra.had) s = { ...s, had: true }
    if (extra && extra.general) s = { ...s, general: true }
    s = { ...s, draft: C.applyDraftPatch(s.draft, draft) }
    return { spec, s }
  }
  return {
    'add · wish with a price, store and link': make({ preset: 'wish' }, { title: 'Demo Lamp', price: 499, platform: 'Jernia', url: 'https://example.com/lamp', priority: 'high', reason: 'need', category_id: 'c3' }),
    'add · wish, any model that fits': make({ preset: 'wish' }, { title: 'A tablet with a pen', price_min: 3000, price_max: 6000, requirements: 'Pen\n11 inch', category_id: 'c1' }, { general: true }),
    'add · general wish': make({ preset: 'general' }, { title: 'A rain jacket', price_max: 1500 }),
    'add · something I own, NOK': make({ preset: 'own' }, { title: 'Demo Kettle', price: 799, bought_day: '2026-11-02', approx_dates: false, platform: 'Power', category_id: 'c3' }),
    'add · something I own, EUR with a typed rate': make({ preset: 'own' }, { title: 'Demo Camera', price: 400, currency: 'EUR', fx_nok: 11.5, bought_day: '2026-06-02', category_id: 'c1', serial: 'SN-1' }),
    'add · something I own, a gift, used, to sell': make({ preset: 'own' }, { title: 'Demo Bike', got_as_gift: true, used: true, for_resale: true, bought_day: '2025-05-01', value_now: 1200, value_currency: 'NOK', value_on: '2026-11-20' }),
    'add · something I had, sold': make({ preset: 'had' }, { title: 'Old Phone', price: 5000, bought_day: '2022-01-10', disposal: 'sold', disposed_on: '2026-09-01', sale_price: 1500, sale_currency: 'NOK', sold_to: 'A neighbour' }, { had: true }),
    'add · something I had, given away': make({ preset: 'had' }, { title: 'Old Chair', bought_day: '2020-01-10', disposal: 'given', disposed_on: '2026-03-01' }, { had: true }),
    'add · accessory of something I own': make({ preset: 'accessory', parent }, { title: 'Controller', price: 59 }),
    'add · model of a general wish': make({ preset: 'model', parent: wishParent }, { title: 'Demo Tab 11', price: 4990, url: 'https://example.com/tab' }),
    'add · own from a receipt line': make({ preset: 'own' }, {}, { receipt: fillFor() }),
    'add · own from a receipt line with a discount and before price': make({ preset: 'own' }, {}, { receipt: fillFor({ before: 1590, discount: 300, discountReason: 'campaign', condition: 'used' }) }),
  }
}

/** Each open scenario: the row and the record's draft at Save. */
const openScenarios = {
  'open · rename': [row(), { title: 'Demo Headphones X5 (black)' }],
  'open · a new price is the owner\'s own': [row(), { price: 3290 }],
  'open · price cleared': [row(), { price: null }],
  'open · could sell for, typed today with its day': [row(), { value_now: 2000, value_on: '2026-11-23' }],
  'open · the day bought': [row(), { bought_day: '2026-11-18' }],
  'open · category and store': [row(), { category_id: 'c1', platform: 'Power' }],
  'open · picture': [row(), { image_url: 'https://example.com/x5.jpg' }],
}

/** Each Just bought scenario: the row, what the owner changed on the form, an optional receipt (put on the form first). */
const boughtScenarios = {
  'just bought · untouched': [row(), {}],
  'just bought · online at a store, arrived': [row({ url: 'https://www.elkjop.no/p/1' }), { channel: 'online', arrived: '2026-11-22' }],
  'just bought · in a shop, another store typed, own return date': [row(), { channel: 'in_store', storePick: 'other', otherName: 'Corner Shop', ownReturn: '2026-12-01', extra: '2028-11-20', note: '  Box in the attic  ' }],
  'just bought · another day, 5 years': [row({ platform: 'Power' }), { day: '2026-11-15', years: 5 }],
  'just bought · keeps a typed complaint day': [row({ warranty_until: '2027-03-01' }), { keepComplain: true }],
  'just bought · a receipt, its price used': [row({ price: 3490 }), { usePaid: true }, { receipt: receipt() }],
  'just bought · a receipt, the receipt\'s warranty': [row({ price: 2990 }), { useReceiptComplain: true, costOff: ['Shipping99'] }, { receipt: receipt() }],
  'just bought · a receipt with no matching line': [row({ title: 'Something else entirely' }), {}, { receipt: receipt() }],
  'just bought · a receipt with only a total, its price used': [row({ price: 3490 }), { usePaid: true }, { receipt: receipt({ fill: { lines: [], costs: [] }, read: { items: [], total: 3290 } }) }],
  'just bought · from Read a receipt (the hand-off), the store not one of yours': [row(), {}, { receipt: receipt({ fill: { storeId: null, storeName: 'Corner Shop', storeLabel: 'Corner Shop' } }) }],
}

module.exports = { TODAY, NOW, CATS, ctx, row, addScenarios, openScenarios, boughtScenarios }
