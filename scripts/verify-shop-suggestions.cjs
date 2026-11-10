#!/usr/bin/env node
/* Verification — Shop's phase 2 prototype rules: "Needs a look"
 * (src/features/shop/shopSuggestions.ts) and the Wishlist's picture tiles
 * (src/features/shop/wishTile.ts): which rows show, their tone, words and
 * order; the tile's one belt, its price history, initials, tints, and how the
 * tiles and categories fill the width.
 * Run: node scripts/verify-shop-suggestions.cjs */
require('sucrase/register')
const S = require('../src/features/shop/shopSuggestions')
const T = require('../src/features/shop/wishTile')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sp = s => String(s).replace(/\s/g, ' ')

const TODAY = '2026-11-10'
const day = n => { const d = new Date(Date.UTC(2026, 10, 10 + n)); return d.toISOString().slice(0, 10) }
// Noon on that day in the machine's own zone: the day the app reads back (localDay) in every zone.
const at = n => new Date(2026, 10, 10 + n, 12).toISOString()
let n = 0
function item(p) {
  n++
  return {
    id: p.id ?? `i${n}`, user_id: 'u', category_id: null, title: p.title ?? `Thing ${n}`, notes: null, price: null, price_source: 'manual',
    platform: null, url: null, priority: 'medium', region: 'NO', planned_date: null, status: 'wishlist', source_type: 'manual',
    created_at: at(-10), updated_at: at(-10), list: 'wishlist', currency: 'NOK', bought_at: null, task_id: null, kind: 'item',
    option_for: null, reason: null, wait_for_deal: false, target_price: null, fx_nok: 1, kept: true, disposal: null, sale_price: null,
    return_by: null, warranty_until: null, value_now: null, value_currency: null, value_on: null, ...p,
  }
}
const mine = p => item({ status: 'bought', bought_at: at(-20), price: 1000, ...p })
function watch(i, low, p = {}) {
  return { item_id: i.id, user_id: 'u', url: i.url, checked_at: at(0), status: 'ok', error: null, source: 'store', name: null, image: null,
    low, high: null, offers: null, currency: 'NOK', in_stock: true, was: null, return_days: null, last_ok_at: at(0), prev_low: null, prev_at: null, ...p }
}
const looks = (items, watches = []) => S.needsALook(items, new Map(watches.map(w => [w.item_id, w])), TODAY)
const kinds = ls => ls.map(l => l.kind)

console.log('at your target')
{
  const hp = item({ title: 'Headphones', url: 'https://www.elkjop.no/p/1', target_price: 2990, price: 3490 })
  const ls = looks([hp], [watch(hp, 2990)])
  check('a read price at or under the target is a success row with Bought', eq(kinds(ls), ['at_target']) && ls[0].tone === 'success' && ls[0].action === 'bought')
  check('its words: "At your target" · the price, and where it was read apart (from the link, any length: the part that may wrap)',
    eq(ls[0].facts.map(sp), ['At your target', '2 990 NOK']) && ls[0].where === 'at elkjop.no', JSON.stringify(ls[0]))
  check('Prisjakt says Prisjakt', looks([hp], [watch(hp, 2900, { source: 'prisjakt' })])[0].where === 'at Prisjakt')
  check('no other row carries a site', looks([mine({ return_by: day(1) })]).every(l => l.where === null))
  check('a typed price at the target is never "at target" (no read, no row)', looks([item({ price: 2990, target_price: 2990 })]).length === 0)
  check('a read of an older link is not this link\'s price', looks([hp], [watch({ ...hp, url: 'https://old.example.com/x' }, 2000)]).length === 0)
  check('a read in another currency is not compared with the target', looks([hp], [watch(hp, 2000, { currency: 'EUR' })]).length === 0)
  check('above the target: nothing', looks([hp], [watch(hp, 3000)]).length === 0)
  check('a javascript: link never becomes a site name', looks([{ ...hp, url: 'javascript:alert(1)' }], [watch({ ...hp, url: 'javascript:alert(1)' }, 2990)])[0].where === null)
}

console.log('owned things: money to claim, returns, complaint rights, old estimates')
{
  const espresso = mine({ title: 'Espresso machine', price: 4490, url: 'https://www.kitchn.no/p/3', return_by: day(5) })
  const ls = looks([espresso], [watch(espresso, 3990)])
  check('cheaper than you paid while it can be returned: warn, 500 NOK to claim', eq(kinds(ls), ['cheaper']) && ls[0].tone === 'warn' && ls[0].claim && ls[0].claim.amount === 500)
  check('its words name the money and the return day', sp(ls[0].facts.join(' · ')) === '500 NOK cheaper than you paid · return by 15.11.2026 · in 5 days', sp(ls[0].facts.join(' · ')))
  check('a claim due tomorrow is danger', looks([{ ...espresso, return_by: day(1) }], [watch(espresso, 3990)])[0].tone === 'danger')
  check('the return day passed: nothing to claim', looks([{ ...espresso, return_by: day(-1) }], [watch(espresso, 3990)]).length === 0)
  check('a claim row covers its return window (no second row)', looks([{ ...espresso, return_by: day(2) }], [watch(espresso, 3990)]).length === 1)
  const ret = d => looks([mine({ title: 'Earbuds', price: 1990, return_by: day(d) })])
  check('a return window closing tomorrow: danger, "tomorrow", what you paid', ret(1)[0].kind === 'return' && ret(1)[0].tone === 'danger' && sp(ret(1)[0].facts.join(' · ')) === 'Return by 11.11.2026 · tomorrow · paid 1 990 NOK')
  check('today is danger too; in three days warn; in four nothing', ret(0)[0].tone === 'danger' && ret(0)[0].facts[1] === 'today' && ret(3)[0].tone === 'warn' && ret(4).length === 0)
  const comp = d => looks([mine({ title: 'Toothbrush', price: 899, warranty_until: day(d) })])
  check('a complaint right ending within 60 days: info with its day', comp(38)[0].kind === 'complaint' && comp(38)[0].tone === 'info' && sp(comp(38)[0].facts.join(' · ')) === 'Can complain until 18.12.2026 · in 38 days · paid 899 NOK')
  check('…in 61 days nothing; in two days warn; tomorrow danger', comp(61).length === 0 && comp(2)[0].tone === 'warn' && comp(1)[0].tone === 'danger')
  const val = age => looks([mine({ title: 'Vacuum', value_now: 1500, value_currency: 'NOK', value_on: day(-age) })])
  check('"Could sell for" older than six months: info, opens at that fact', val(200)[0].kind === 'value' && val(200)[0].action === 'value' && sp(val(200)[0].facts[0]) === 'Could sell for 1 500 NOK')
  check('…a newer one, or none at all: nothing', val(100).length === 0 && looks([mine({ value_on: day(-300) })]).length === 0)
  const sold = mine({ title: 'Old watch', disposal: 'sold', disposed_on: day(-30), sale_price: 900, return_by: day(2), warranty_until: day(10), value_now: 500, value_on: day(-300) })
  check('a thing that is gone has no deadlines and no estimate to update', looks([sold]).length === 0)
  check('quick-list rows never count', looks([item({ list: 'quick', status: 'bought', bought_at: null, return_by: day(1) })]).length === 0)
}

console.log('old wishes and tidy-up')
{
  const old = item({ title: 'Grinder', price: 1290, created_at: at(-200) })
  const ls = looks([old])
  check('a wish older than six months: info, since when and its price', eq(kinds(ls), ['wish']) && sp(ls[0].facts.join(' · ')) === 'On the wishlist since 24.04.2026 · 1 290 NOK', sp(ls[0].facts.join(' · ')))
  check('…a newer one nothing; a general wish\'s model never on its own', looks([item({ created_at: at(-100) })]).length === 0 && looks([item({ option_for: 'w1', created_at: at(-300) })]).length === 0)
  check('a general wish shows its range', sp(looks([item({ kind: 'general', price_min: 1500, price_max: 3500, created_at: at(-300) })])[0].facts[1]) === '1 500–3 500 NOK')
  const noDay = mine({ title: 'Chair', bought_at: null })
  const rate = mine({ title: 'Carpet', currency: 'TRY', price: 2400, fx_nok: null, bought_at: at(-20) })
  const fresh = mine({ title: 'Jacket', currency: 'TRY', price: 4500, fx_nok: null, bought_at: at(-1) })
  const noSum = mine({ title: 'Monitor', disposal: 'sold', disposed_on: day(-40), sale_price: null })
  const tidy = looks([noDay, rate, fresh, noSum])
  check('one tidy-up row counts the things and says what each lacks', eq(kinds(tidy), ['tidy']) && tidy[0].title === '3 things to tidy up'
    && eq(tidy[0].facts, ['1 without a purchase day', '1 rate pending', '1 sale without an amount']), JSON.stringify(tidy[0] && tidy[0].facts))
  check('a rate is pending only after three days (Norges Bank publishes after 16:00; the page fetches it)', looks([fresh]).length === 0)
  check('a column that is absent (before migration 134) is not "missing"', looks([mine({ bought_at: undefined })]).length === 0)
  check('the tidy-up row opens the first of them', tidy[0].itemId === noDay.id && tidy[0].action === 'open')
}

console.log('the order and the phone\'s line')
{
  const hp = item({ title: 'Headphones', url: 'https://www.elkjop.no/p/1', target_price: 2990 })
  const espresso = mine({ title: 'Espresso', price: 4490, url: 'https://www.kitchn.no/p/3', return_by: day(5) })
  const all = looks([
    item({ title: 'Grinder', created_at: at(-200) }), mine({ title: 'Vacuum', value_now: 1, value_on: day(-300) }), mine({ title: 'Chair', bought_at: null }),
    mine({ title: 'Brush', warranty_until: day(38) }), hp, espresso, mine({ title: 'Earbuds', return_by: day(1) }),
  ], [watch(hp, 2990), watch(espresso, 3990)])
  check('danger, then warn (money to claim), success, then info: dates, estimates, wishes, tidy-up',
    eq(kinds(all), ['return', 'cheaper', 'at_target', 'complaint', 'value', 'wish', 'tidy']), kinds(all).join(','))
  const line = S.lookLine(all)
  check('the line: "7 need a look · 500 NOK to claim", in the first row\'s tone', line.count === 7 && line.words === '7 need a look' && sp(line.claim) === '500 NOK to claim' && line.tone === 'danger')
  check('one: "1 needs a look"; none: "Nothing needs a look", no tone', S.lookLine(all.slice(0, 1)).words === '1 needs a look' && S.lookLine([]).words === 'Nothing needs a look' && S.lookLine([]).tone === null)
  check('no money to claim: no claim words', S.lookLine(all.filter(l => l.kind !== 'cheaper')).claim === null)
  check('keys are unique', new Set(all.map(l => l.key)).size === all.length)
}

console.log('the tile: one belt, the price history')
{
  const pts = lows => lows.map((low, i) => ({ id: `p${i}`, item_id: 'x', checked_at: at(-i), low, high: null, offers: null, currency: 'NOK', source: 'store' }))
  check('no history: one read, or one price all along', T.priceSpan(pts([100]), 'NOK') === null && T.priceSpan(pts([100, 100, 100]), 'NOK') === null)
  check('a history: lowest, highest, reads', eq(T.priceSpan(pts([120, 100, 140]), 'NOK'), { low: 100, high: 140, reads: 3, currency: 'NOK' }))
  check('reads in another currency are left out', T.priceSpan([...pts([100, 140]), { ...pts([10])[0], currency: 'EUR' }], 'NOK').reads === 2)
  const span = T.priceSpan(pts([100, 140]), 'NOK')
  check('today\'s place, clamped to the ends', T.spanPosition(120, span) === 0.5 && T.spanPosition(90, span) === 0 && T.spanPosition(150, span) === 1)
  const hp = item({ url: 'https://www.elkjop.no/p/1', target_price: 2990, wait_for_deal: true, reason: 'need' })
  const ctx = (low, s) => ({ watch: watch(hp, low), span: s, today: TODAY })
  const hist = T.priceSpan(pts([2990, 3490]), 'NOK')
  check('the order: at target, then lowest seen, then deal on, then need it', T.beltOf(hp, ctx(2990, hist)) === 'at_target'
    && T.beltOf({ ...hp, target_price: 2000 }, ctx(2990, hist)) === 'lowest'
    && T.beltOf({ ...hp, target_price: 2000 }, ctx(3100, hist)) === 'deal'
    && T.beltOf({ ...hp, target_price: 2000, wait_for_deal: false }, ctx(3100, hist)) === 'need'
    && T.beltOf({ ...hp, target_price: 2000, wait_for_deal: false, reason: 'fun' }, ctx(3100, hist)) === null)
  check('lowest seen needs a history: one read is not "lowest"', T.beltOf({ ...hp, target_price: null, wait_for_deal: false, reason: null }, ctx(2990, null)) === null)
  check('a deal starts on its day (none set: on now)', T.dealOn({ wait_for_deal: true, planned_date: day(1) }, TODAY) === false
    && T.dealOn({ wait_for_deal: true, planned_date: TODAY }, TODAY) && T.dealOn({ wait_for_deal: true, planned_date: null }, TODAY) && !T.dealOn({ wait_for_deal: false, planned_date: null }, TODAY))
  check('a general wish never wears a price belt', T.beltOf({ ...hp, kind: 'general' }, ctx(2990, hist)) === 'deal')
  check('every belt is a tone, never the accent', Object.values(T.BELT).every(b => b.tone !== 'accent'))
}

console.log('the tile without a picture, and the width')
{
  check('initials: the first letter or digit of two words', T.initialsOf('Coffee grinder') === 'CG' && T.initialsOf('retroid pocket 6 pro') === 'RP' && T.initialsOf('Øl') === 'Ø' && T.initialsOf('  ') === '?')
  const tints = ['a', 'b', 'c', 'top-1', 'top-2', '5a5b0000-0000-4000-8000-000000000001'].map(T.tintOf)
  check('a tint is 1–5 for a category (stable), 6 without one', tints.every(t => t >= 1 && t <= 5) && T.tintOf('top-1') === T.tintOf('top-1') && T.tintOf(null) === 6)
  check('tiles: two a row on a 375–402px phone, more as the track widens', T.tileColumns(343 / 16) === 2 && T.tileColumns(370 / 16) === 2 && T.tileColumns(773 / 16) === 4 && T.tileColumns(1) === 1)
  check('category stacks: one on a phone and the 1469 laptop, two at 1920, three at 2450', T.categoryColumns(null) === 1 && T.categoryColumns(23) === 1
    && T.categoryColumns(773 / 16) === 1 && T.categoryColumns(81) === 2 && T.categoryColumns(106) === 3)
  const pack = T.packGroups([1, 3], 4)
  check('a small subcategory shares the row: two labels on line 1, four tiles on line 2', eq(pack.filter(p => p.label).map(p => [p.line, p.col, p.span]), [[1, 0, 1], [1, 1, 3]])
    && pack.filter(p => !p.label).every(p => p.line === 2))
  const two = T.packGroups([1, 3], 2)
  check('…never split to fill a gap: on two columns the second starts its own row', eq(two.filter(p => p.label).map(p => [p.group, p.line, p.col]), [[0, 1, 0], [1, 3, 0]])
    && eq(two.filter(p => !p.label && p.group === 1).map(p => [p.line, p.col]), [[4, 0], [4, 1], [5, 0]]))
  const long = T.packGroups([5, 1], 2)
  check('a group longer than a row fills rows; the next may share its last row', eq(long.filter(p => p.label).map(p => [p.group, p.line, p.col]), [[0, 1, 0], [1, 4, 1]])
    && long.filter(p => !p.label).length === 6)
  check('every tile once, in order; empty groups skipped', eq(T.packGroups([2, 0, 2], 3).filter(p => !p.label).map(p => [p.group, p.index]), [[0, 0], [0, 1], [2, 0], [2, 1]]))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
