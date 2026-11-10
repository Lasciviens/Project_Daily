#!/usr/bin/env node
/* Verification — the selling screens' rules (src/features/shop/sellingModel.ts, Shop step C):
 *   1. A thing's open listing, its tag ("For sale · 12 days", "Listed") and its words; listings that ended.
 *   2. Price cuts: 5 % and 10 % of the owner's own price, rounded down, never 0 or the price itself.
 *   3. Update values: only things still yours with an estimate over six months old, the oldest first; Undo's patch.
 *   4. A small history of estimates: the value history and a pre-192 "Could sell for", newest first, this thing only.
 *   5. The ad: the marketplaces are the templates' hosts (data), a link out is built from the host only, the ad's
 *      facts never hold a serial, a store or a price paid, and its price is the listing's, else the owner's estimate.
 *   6. The hand-over checklist: steps edited as rows back to text, the limits, the ticks by the step's words (an
 *      edited step starts unticked), at most 20 things kept, a stored book read back safely.
 *   7. The screens: the record's new parts load in their own chunks, the ad is never posted (no fetch), a link out
 *      is no-referrer, sign-out clears the ticks.
 * Run: node scripts/verify-shop-selling.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const M = require('../src/features/shop/sellingModel')
const T = require('../src/features/shop/resaleTexts')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const TODAY = '2026-11-10'
const day = n => { const d = new Date(Date.UTC(2026, 10, 10 + n)); return d.toISOString().slice(0, 10) }
let n = 0
const listing = p => ({ id: `l${++n}`, user_id: 'u', item_id: 'a', marketplace: 'finn.no', ad_url: null, status: 'for_sale', listed_on: day(-13),
  for_sale_on: day(-12), ended_on: null, currency: 'NOK', prices: [{ on: day(-13), price: 2400 }], ad_text: null, closed_by_sale: false,
  created_at: `${day(-13)}T10:00:00Z`, updated_at: `${day(-13)}T10:00:00Z`, ...p })
const item = p => ({ id: `i${++n}`, title: `Thing ${n}`, list: 'wishlist', kind: 'item', status: 'bought', kept: true, disposal: null, bought_at: `${day(-300)}T12:00:00Z`,
  value_now: null, value_currency: null, value_on: null, approx_dates: false, serial: 'SN-1', platform: 'A store', price: 4990, ...p })

console.log('1. listings')
{
  const open = listing({})
  const gone = listing({ status: 'withdrawn', ended_on: day(-20), listed_on: day(-40), for_sale_on: day(-38) })
  const other = listing({ item_id: 'b' })
  check('the open listing is the thing\'s listed or for-sale one', M.openListingOf([gone, open, other], 'a') === open)
  check('none open: null', M.openListingOf([gone], 'a') === null)
  check('ended ones, newest first, only this thing\'s', eq(M.endedListingsOf([gone, open, other, listing({ status: 'sold', ended_on: day(-2) })], 'a').map(l => l.status), ['sold', 'withdrawn']))
  check('by thing: one open listing each', M.openListingsByItem([open, gone, other]).size === 2 && M.openListingsByItem([open, gone]).get('a') === open)
  check('"For sale · 12 days", info', eq(M.listingTag(open, TODAY), { text: 'For sale · 12 days', tone: 'info' }))
  check('"For sale · 1 day"', M.listingTag(listing({ for_sale_on: day(-1) }), TODAY).text === 'For sale · 1 day')
  check('"For sale · today"', M.listingTag(listing({ for_sale_on: TODAY }), TODAY).text === 'For sale · today')
  check('"Listed", neutral, while the ad is not up', eq(M.listingTag(listing({ status: 'listed', for_sale_on: null }), TODAY), { text: 'Listed', tone: 'neutral' }))
  check('an ended listing: no tag', M.listingTag(gone, TODAY) === null && M.listingTag(null, TODAY) === null)
  check('words: for sale on its marketplace and for how long', M.listingWords(open, TODAY) === 'For sale on finn.no · 12 days')
  check('words: taken down after its days', M.listingWords(gone, TODAY) === 'Taken down on finn.no after 18 days')
  check('words: sold the same day', M.listingWords(listing({ status: 'sold', for_sale_on: day(-2), ended_on: day(-2), marketplace: null }), TODAY) === 'Sold the same day')
  check('days for sale only while for sale', M.daysForSale(open, TODAY) === 12 && M.daysForSale(gone, TODAY) === null)
}

console.log('2. price cuts')
{
  check('from 1 000 to 50s: 2 400 → 2 250 and 2 150', eq(M.priceCuts(2400), [2250, 2150]), JSON.stringify(M.priceCuts(2400)))
  check('below 1 000 to 10s: 450 → 420 and 400', eq(M.priceCuts(450), [420, 400]))
  check('from 10 000 to 100s: 14 990 → 14 200 and 13 400', eq(M.priceCuts(14990), [14200, 13400]))
  check('never 0 and never the price itself: 10 has none', eq(M.priceCuts(10), []))
  check('nothing for 0, a negative or NaN', eq(M.priceCuts(0), []) && eq(M.priceCuts(-5), []) && eq(M.priceCuts(NaN), []))
}

console.log('3. Update values')
{
  const a = item({ title: 'B old', value_now: 900, value_on: day(-200) })
  const b = item({ title: 'A older', value_now: 400, value_on: day(-300) })
  const fresh = item({ value_now: 1000, value_on: day(-10) })
  const gone = item({ value_now: 100, value_on: day(-400), disposal: 'sold' })
  const none = item({})
  const wish = item({ status: 'wishlist', value_now: 5, value_on: day(-400) })
  const same = item({ title: 'A same day', value_now: 1, value_on: day(-300) })
  check('only old estimates of things still yours, the oldest first, then by name',
    eq(M.oldEstimates([a, fresh, gone, none, b, wish, same], TODAY).map(i => i.title), ['A older', 'A same day', 'B old']))
  check('the edge: 183 days is not old, 184 is', !M.hasOldEstimate(item({ value_now: 1, value_on: day(-183) }), TODAY) && M.hasOldEstimate(item({ value_now: 1, value_on: day(-184) }), TODAY))
  check('Undo\'s patch is the estimate as it was', eq(M.valueBefore(a), { id: a.id, value_now: 900, value_currency: null, value_on: day(-200) }))
  check('"3 estimates updated" / "1 estimate updated"', M.valuesSavedWords(3) === '3 estimates updated' && M.valuesSavedWords(1) === '1 estimate updated')
}

console.log('4. a history of estimates')
{
  const it = item({ id: 'x', value_now: 2400, value_currency: 'NOK', value_on: day(-1) })
  const pts = [
    { item_id: 'x', valued_on: day(-100), value: 3000, currency: 'NOK' },
    { item_id: 'x', valued_on: day(-1), value: 2400, currency: 'NOK' },
    { item_id: 'y', valued_on: day(-5), value: 9, currency: 'NOK' },
  ]
  check('this thing\'s only, newest first, no day twice', eq(M.estimateHistory(pts, it).map(h => h.value), [2400, 3000]))
  check('an estimate from before the history began joins it', eq(M.estimateHistory([], it), [{ on: day(-1), value: 2400, currency: 'NOK' }]))
  check('none: nothing', eq(M.estimateHistory([], item({ id: 'z' })), []))
}

console.log('5. the ad')
{
  const t = (marketplace, created_at) => ({ id: `t${++n}`, user_id: 'u', marketplace, category: null, language: 'nb', title: '{name}', body: 'Pris: {price}.', created_at, updated_at: created_at })
  check('marketplaces are the templates\' hosts, in the order made, once each',
    eq(M.marketplacesOf([t('tise.com', '2026-11-02'), t('finn.no', '2026-11-01'), t(null, '2026-11-03'), t('finn.no', '2026-11-04')]), ['finn.no', 'tise.com']))
  check('a host that is no host is left out', eq(M.marketplacesOf([t('javascript:alert(1)', '2026-11-01')]), []))
  check('the link out is built from the host only', M.marketplaceLink('finn.no') === 'https://finn.no' && M.marketplaceLink('evil.no/x?y') === null && M.marketplaceLink(null) === null)
  const thing = item({ title: 'Game console', approx_dates: true, bought_at: '2025-03-01T12:00:00Z' })
  const facts = M.adFactsOf(thing, { condition: 'good', price: 3400, currency: 'NOK', accessories: ['Two controllers'], bought: true })
  check('the ad\'s facts: name, condition, the day bought (ca.), price, accessories', facts.name === 'Game console' && facts.approx === true && facts.bought === '2025-03-01' && facts.price === 3400)
  const filled = T.fillAd({ title: '{name} – {condition}', body: 'Selger {name}.\nKjøpt {bought}.\nPris: {price}.', language: 'nb' }, facts)
  check('filled in Norwegian: "ca." and "kr"', filled.body.includes('Kjøpt ca. 01.03.2025') && filled.body.includes('3 400 kr') && filled.title === 'Game console – pent brukt', filled.body)
  check('never the serial, the store or what it cost', !JSON.stringify(facts).includes('SN-1') && !JSON.stringify(facts).includes('A store') && !JSON.stringify(facts).includes('4990'))
  check('not saying the day: no day', M.adFactsOf(thing, { condition: null, price: null, currency: 'NOK', accessories: [], bought: false }).bought === null)
  check('the price: the open listing\'s price now', eq(M.adPriceOf(item({ value_now: 1 }), listing({ prices: [{ on: day(-3), price: 2600 }, { on: day(-1), price: 2400 }] })), { price: 2400, currency: 'NOK', from: 'listing' }))
  check('… else the owner\'s own estimate', eq(M.adPriceOf(item({ value_now: 3500, value_currency: 'NOK' }), null), { price: 3500, currency: 'NOK', from: 'estimate' }))
  check('… else none (never invented)', eq(M.adPriceOf(item({}), null), { price: null, currency: 'NOK', from: null }))
  check('the clipboard text: title, a blank line, the text', M.adClipboardText(' A ', 'B\nC ') === 'A\n\nB\nC' && M.adClipboardText('A', '') === 'A')
}

console.log('6. the hand-over checklist')
{
  check('rows back to text: trimmed, blank ones out, inner spaces one', M.stepsText([' Back up ', '', 'Sign  out', '   ']) === 'Back up\nSign out')
  check('at least one step', M.stepsProblem(['', ' ']) === 'A checklist needs at least one step')
  check('at most 60 steps', M.stepsProblem(Array.from({ length: 61 }, (_, i) => `s${i}`)) !== null && M.stepsProblem(Array.from({ length: 60 }, (_, i) => `s${i}`)) === null)
  check('at most 4 000 characters', M.stepsProblem(['x'.repeat(4001)]) !== null)
  const steps = ['Back up', 'Factory reset']
  let book = M.withTicks({}, 'a', ['Back up'], TODAY)
  check('a tick is kept by the step\'s words', eq([...M.ticksOf(book, 'a', steps)], ['Back up']))
  check('an edited step starts unticked', M.ticksOf(book, 'a', ['Back up everything', 'Factory reset']).size === 0)
  check('another thing\'s ticks are its own', M.ticksOf(book, 'b', steps).size === 0)
  book = M.withTicks(book, 'a', [], TODAY)
  check('no ticks left: the thing\'s entry goes', !('a' in book))
  let big = {}
  for (let i = 0; i < 25; i++) big = M.withTicks(big, `t${i}`, ['x'], day(-25 + i))
  check(`at most ${M.TICK_BOOK_MAX} things, the newest kept`, Object.keys(big).length === M.TICK_BOOK_MAX && 't24' in big && !('t0' in big))
  check('a stored book is read back safely', eq(M.parseTickBook({ a: { on: TODAY, ticked: ['x', 5] }, b: 'junk', c: null }), { a: { on: TODAY, ticked: ['x'] } })
    && eq(M.parseTickBook('nope'), {}) && eq(M.parseTickBook(null), {}) && eq(M.parseTickBook([1]), {}))
  check('handed over: sold, traded in, given away, other — not broke, lost or returned', eq([...M.HANDED_OVER].sort(), ['given', 'other', 'sold', 'traded_in']))
}

console.log('7. the screens')
{
  const body = read('src/features/shop/components/record/RecordBody.tsx')
  const resale = read('src/features/shop/components/record/RecordResale.tsx')
  const listingUi = read('src/features/shop/components/record/RecordListing.tsx')
  const ad = read('src/features/shop/components/record/AdSheet.tsx')
  const link = read('src/features/shop/components/record/AddressLink.tsx')
  check('the record shows the Resale parts', body.includes('<RecordResale r={r} watch={watch} />'))
  check('the ad sheet loads in its own chunk', /lazyPart\('shop-ad-sheet', \(\) => import\('\.\/AdSheet'\)/.test(listingUi))
  check('the Update values sheet loads in its own chunk', /lazyPart\('shop-update-values', \(\) => import\('\.\/UpdateValuesSheet'\)/.test(resale))
  check('the ad is never posted: no fetch, no supabase in the ad sheet', !/fetch\(|supabase/.test(ad))
  check('… it goes to the clipboard', ad.includes('navigator.clipboard.writeText'))
  check('a link out opens in a new tab with no referrer and no opener', link.includes('rel="noopener noreferrer nofollow"') && link.includes('referrerPolicy="no-referrer"') && link.includes('webUrl('))
  check('Use fills the draft, never the row', resale.includes('d.set({ value_now: n, value_currency: \'NOK\' })') && !/useUpdateShopItem/.test(resale))
  check('sign-out clears the hand-over ticks', read('src/security/accountState.ts').includes("'lasci.shop.handover'")
    && read('src/features/shop/hooks/useShopSelling.ts').includes("HANDOVER_TICKS_KEY = 'lasci.shop.handover'"))
  check('Sold comes from the sell flow, never a listing write', !/status: 'sold'/.test(listingUi) && listingUi.includes("kind: 'shop-sell'"))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
