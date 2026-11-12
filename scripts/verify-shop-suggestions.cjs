#!/usr/bin/env node
/* Verification — Shop's "Needs a look" (src/features/shop/shopSuggestions.ts)
 * and the Wishlist's picture tiles (src/features/shop/wishTile.ts): which rows
 * show, their tone, words, action and order, under migration 190's signal
 * keys; what a snooze or Got it hides and what brings a row back (its
 * signature); the clean price figures (shop_price_stats: a used, refurbished
 * or pre-188 price never counts); the tile's one belt, its history bar,
 * initials, tints, and how the tiles and categories fill the width.
 * Run: node scripts/verify-shop-suggestions.cjs */
require('sucrase/register')
const S = require('../src/features/shop/shopSuggestions')
const T = require('../src/features/shop/wishTile')
const D = require('../src/features/shop/dealDays')

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
    low, high: null, offers: null, currency: 'NOK', in_stock: true, was: null, return_days: null, last_ok_at: at(0), prev_low: null, prev_at: null,
    condition: 'unknown', used_low: null, refurbished_low: null, ...p }
}
const facts = p => ({ currency: 'NOK', lowAll: null, highAll: null, readsAll: 0, low60: null, high60: null, reads60: 0, since60: null, backInStock: false, restockedAt: null, ...p })
const looks = (items, watches = [], more = {}) => S.needsALook(items, {
  watches: new Map(watches.map(w => [w.item_id, w])), facts: new Map(Object.entries(more.facts ?? {})), deals: more.deals ?? [],
}, TODAY)
const kinds = ls => ls.map(l => l.kind)
// Deal days as 190 seeds them, seen from TODAY through dealDays.dealsAhead (as useNeedsALook does).
const dealRow = (slug, name, rule) => ({ id: slug, slug, name, day: null, weekday: null, nth: null, offset_days: 0, length_days: 1, source_url: null,
  checked_on: TODAY, created_at: TODAY, updated_at: TODAY, ...rule })
const BF = dealRow('black_friday', 'Black Friday', { rule_kind: 'nth_weekday', month: 11, weekday: 4, nth: 4, offset_days: 1 })
const SINGLES = dealRow('singles_day', "Singles' Day", { rule_kind: 'fixed', month: 11, day: 11 })
const MELLOM = dealRow('mellomdagssalg', 'Christmas sales (mellomdagssalg)', { rule_kind: 'fixed', month: 12, day: 27, length_days: 5 })
const ahead = (rows, today = TODAY) => D.dealsAhead(rows, today, S.DEAL_AHEAD_DAYS)
const BLACK_FRIDAY = ahead([BF])

console.log('at your target')
{
  const hp = item({ title: 'Headphones', url: 'https://www.elkjop.no/p/1', target_price: 2990, price: 3490 })
  const ls = looks([hp], [watch(hp, 2990)])
  check('a clean read price at or under the target is a success row with Bought', eq(kinds(ls), ['at_target']) && ls[0].tone === 'success' && ls[0].action === 'bought')
  check('its words: "At your target" · the price, and where it was read apart (from the link, any length: the part that may wrap)',
    eq(ls[0].facts.map(sp), ['At your target', '2 990 NOK']) && sp(ls[0].where) === 'at elkjop.no', JSON.stringify(ls[0]))
  check('"at" stays with its site (a no-break space)', ls[0].where === 'at' + String.fromCharCode(160) + 'elkjop.no')
  check('Prisjakt\'s new offers say Prisjakt', sp(looks([hp], [watch(hp, 2900, { source: 'prisjakt', condition: 'new' })])[0].where) === 'at Prisjakt')
  check('a Prisjakt figure for new and used together is never "at target"', looks([hp], [watch(hp, 2500, { source: 'prisjakt', condition: 'mixed' })]).length === 0)
  check('…nor a read from before migration 188 (no condition)', looks([hp], [watch(hp, 2500, { condition: null })]).length === 0)
  check('…nor a link whose site refuses automated reading (not_allowed: never read, so no price now)', looks([hp], [watch(hp, 2500, { status: 'not_allowed' })]).length === 0
    && T.readPrice(hp, watch(hp, 2500, { status: 'not_allowed' })) === null && T.readPrice(hp, watch(hp, 2500, { status: 'blocked' })).amount === 2500)
  check('no other row carries a site', looks([mine({ return_by: day(1) })]).every(l => l.where === null))
  check('a typed price at the target is never "at target" (no read, no row)', looks([item({ price: 2990, target_price: 2990 })]).length === 0)
  check('a read of an older link is not this link\'s price', looks([hp], [watch({ ...hp, url: 'https://old.example.com/x' }, 2000)]).length === 0)
  check('a read in another currency is not compared with the target', looks([hp], [watch(hp, 2000, { currency: 'EUR' })]).length === 0)
  check('above the target: nothing', looks([hp], [watch(hp, 3000)]).length === 0)
  check('a javascript: link never becomes a site name', looks([{ ...hp, url: 'javascript:alert(1)' }], [watch({ ...hp, url: 'javascript:alert(1)' }, 2990)])[0].where === null)
  check('its signature is the currency and the price (signalSignature): a lower one is news again', ls[0].signature === 'at_target|NOK|2990' && looks([hp], [watch(hp, 2790)])[0].signature === 'at_target|NOK|2790')
}

console.log('the wish\'s price history: lowest in 60 days, back in stock, a "before" never seen')
{
  const tv = item({ title: 'OLED TV', url: 'https://www.power.no/p/2', price: 18990 })
  const f60 = facts({ lowAll: 16990, highAll: 19990, readsAll: 9, low60: 17490, high60: 18990, reads60: 6, since60: day(-58) })
  const low = looks([tv], [watch(tv, 17490)], { facts: { [tv.id]: f60 } })
  check('today at the lowest of the last 60 days: "60-day low" · the price, Bought — the belt\'s words', eq(kinds(low), ['lowest_seen']) && low[0].action === 'bought'
    && eq(low[0].facts.map(sp), ['60-day low', '17 490 NOK']) && low[0].tone === 'success' && T.BELT.lowest.label === '60-day low')
  check('…a price not read today says the day it was read ("read 08.11.2026"): an old price never looks current',
    eq(looks([tv], [watch(tv, 17490, { checked_at: at(-2), last_ok_at: at(-2) })], { facts: { [tv.id]: f60 } })[0].facts.map(sp), ['60-day low', 'read 08.11.2026', '17 490 NOK']))
  check('…not when it was the same price all along, or with one read', looks([tv], [watch(tv, 17490)], { facts: { [tv.id]: facts({ low60: 17490, high60: 17490, reads60: 4 }) } }).length === 0
    && looks([tv], [watch(tv, 17490)], { facts: { [tv.id]: facts({ low60: 17490, high60: 17490, reads60: 1 }) } }).length === 0)
  check('…not above the 60 days\' low', looks([tv], [watch(tv, 17990)], { facts: { [tv.id]: f60 } }).length === 0)
  check('…and not on a mixed Prisjakt figure', looks([tv], [watch(tv, 17490, { source: 'prisjakt', condition: 'mixed' })], { facts: { [tv.id]: f60 } }).length === 0)
  const both = looks([{ ...tv, target_price: 17500 }], [watch(tv, 17490)], { facts: { [tv.id]: f60 } })
  check('one buy row a wish: at target wins over the lowest', eq(kinds(both), ['at_target']))
  const back = looks([tv], [watch(tv, 17990)], { facts: { [tv.id]: facts({ backInStock: true }) } })
  check('back in stock after a read without: "Restocked" · the price, Bought — the belt\'s words', eq(kinds(back), ['back_in_stock']) && sp(back[0].facts.join(' · ')) === 'Restocked · 17 990 NOK' && T.BELT.back.label === 'Restocked')
  check('…not while the watch says out of stock', looks([tv], [watch(tv, 17990, { in_stock: false })], { facts: { [tv.id]: facts({ backInStock: true }) } }).length === 0)
  const fake = looks([tv], [watch(tv, 17490, { was: 21990 })], { facts: { [tv.id]: { ...f60, low60: 16990 } } })
  check('a "before" price above every clean price in 60 days: a warn row, Open', kinds(fake).includes('fake_before')
    && fake.find(l => l.kind === 'fake_before').tone === 'warn' && fake.find(l => l.kind === 'fake_before').action === 'open')
  check('its words name the "before", since when the history reaches (its first read, not "60 days"), and the price now', sp(fake.find(l => l.kind === 'fake_before').facts.join(' · ')) === '"Before" 21 990 NOK · not seen since 13.09.2026 · now 17 490 NOK',
    sp(fake.find(l => l.kind === 'fake_before').facts.join(' · ')))
  check('a "before" that was seen: nothing', !kinds(looks([tv], [watch(tv, 17490, { was: 18990 })], { facts: { [tv.id]: f60 } })).includes('fake_before'))
  check('a history shorter than a month never says "never seen"', !kinds(looks([tv], [watch(tv, 17490, { was: 21990 })], { facts: { [tv.id]: { ...f60, since60: day(-20) } } })).includes('fake_before'))
}

console.log('a deal day ahead')
{
  const hp = item({ title: 'Headphones', target_price: 2990, price: 3490 })
  const fryer = item({ title: 'Air fryer', wait_for_deal: true, price: 1790 })
  const plain = item({ title: 'Foam roller', price: 299 })
  const ls = looks([hp, fryer, plain], [], { deals: ahead([BF, MELLOM]) })
  const deal = ls.find(l => l.kind === 'deal_day')
  check('one row for the next deal day within three weeks: Black Friday 27.11.2026, in 17 days', !!deal && ls.filter(l => l.kind === 'deal_day').length === 1
    && deal.title === 'Black Friday' && sp(deal.facts.join(' · ')) === '27.11.2026 · in 17 days · 2 wishes to watch', deal && sp(deal.facts.join(' · ')))
  check('it lists the wishes with a target or waiting for a deal (never the others), Show', deal.action === 'list' && eq(deal.things.map(t => t.title), ['Headphones', 'Air fryer'])
    && eq(deal.things[0].facts.map(sp), ['now 3 490 NOK', 'target 2 990 NOK']) && eq(deal.things[1].facts.map(sp), ['now 1 790 NOK', 'waiting for a deal']))
  check('a row about no one thing; its signature the deal and its day', deal.itemId === null && deal.key === 'deal_day:black_friday' && deal.signature === 'deal_day|black_friday|2026-11-27')
  check('no wish to watch: no row', !looks([plain], [], { deals: BLACK_FRIDAY }).some(l => l.kind === 'deal_day'))
  check('a deal day more than three weeks ahead: no row (mellomdagssalg is 47 days off)', !looks([hp], [], { deals: ahead([MELLOM]) }).some(l => l.kind === 'deal_day'))
  check('the nearest first: 11.11 tomorrow before Black Friday', looks([hp], [], { deals: ahead([BF, SINGLES]) }).find(l => l.kind === 'deal_day').title === "Singles' Day")
  const running = S.needsALook([hp], { watches: new Map(), deals: ahead([MELLOM], '2026-12-28') }, '2026-12-28').find(l => l.kind === 'deal_day')
  check('a deal that runs for days, while it runs: "On now · until 31.12.2026"', running && sp(running.facts.slice(0, 2).join(' · ')) === 'On now · until 31.12.2026', running && running.facts.join(' · '))
}

console.log('owned things: money to claim, returns, complaint rights, old estimates')
{
  const espresso = mine({ title: 'Espresso machine', price: 4490, url: 'https://www.kitchn.no/p/3', return_by: day(5) })
  const ls = looks([espresso], [watch(espresso, 3990)])
  check('cheaper than you paid while it can be returned: warn, 500 NOK to claim', eq(kinds(ls), ['cheaper_returnable']) && ls[0].tone === 'warn' && ls[0].claim && ls[0].claim.amount === 500)
  check('its words name the money and the return day', sp(ls[0].facts.join(' · ')) === '500 NOK cheaper than you paid · return by 15.11.2026 · in 5 days', sp(ls[0].facts.join(' · ')))
  check('a claim due tomorrow is danger', looks([{ ...espresso, return_by: day(1) }], [watch(espresso, 3990)])[0].tone === 'danger')
  check('the return day passed: nothing to claim', looks([{ ...espresso, return_by: day(-1) }], [watch(espresso, 3990)]).length === 0)
  check('a claim row covers its return window (no second row)', looks([{ ...espresso, return_by: day(2) }], [watch(espresso, 3990)]).length === 1)
  check('a refused link\'s old price is no money to claim (its return window still shows)', !kinds(looks([espresso], [watch(espresso, 3990, { status: 'not_allowed' })])).includes('cheaper_returnable'))
  check('bought new for 16 115, Prisjakt\'s mixed figure of 6 590: no money to claim — it may be a used price', !kinds(looks([{ ...espresso, price: 16115 }],
    [watch(espresso, 6590, { source: 'prisjakt', condition: 'mixed' })])).includes('cheaper_returnable')
    && !kinds(looks([{ ...espresso, price: 16115 }], [watch(espresso, 6590, { source: 'prisjakt', condition: null })])).includes('cheaper_returnable'))
  check('…nor a price kept from an older read (the last check was a bot check)', !kinds(looks([espresso], [watch(espresso, 3990, { status: 'blocked' })])).includes('cheaper_returnable'))
  const ret = d => looks([mine({ title: 'Earbuds', price: 1990, return_by: day(d) })])
  check('a return window closing tomorrow: danger, "tomorrow", what you paid', ret(1)[0].kind === 'return_closing' && ret(1)[0].tone === 'danger' && sp(ret(1)[0].facts.join(' · ')) === 'Return by 11.11.2026 · tomorrow · paid 1 990 NOK')
  check('today is danger too; in three days warn; from four to fourteen days info (Coming up\'s two weeks); in fifteen nothing', ret(0)[0].tone === 'danger' && ret(0)[0].facts[1] === 'today'
    && ret(3)[0].tone === 'warn' && ret(4)[0].tone === 'info' && ret(14)[0].tone === 'info' && sp(ret(14)[0].facts.join(' · ')) === 'Return by 24.11.2026 · in 14 days · paid 1 990 NOK' && ret(15).length === 0)
  check('Snooze lasts a week, or until the day before the deadline: due in 5 days → 14.11.2026; due tomorrow → no snooze; no deadline → a week',
    ret(5)[0].snoozeTo === day(4) && ret(1)[0].snoozeTo === null && ret(10)[0].snoozeTo === day(7) && S.snoozeUntil(TODAY, 2) === day(1) && S.snoozeUntil(TODAY) === day(7))
  const comp = d => looks([mine({ title: 'Toothbrush', price: 899, warranty_until: day(d) })])
  check('a complaint right ending within 60 days: info with its day', comp(38)[0].kind === 'complaint_ending' && comp(38)[0].tone === 'info' && sp(comp(38)[0].facts.join(' · ')) === 'Complain by 18.12.2026 · in 38 days · paid 899 NOK')
  check('…in 61 days nothing; in two days warn; tomorrow danger', comp(61).length === 0 && comp(2)[0].tone === 'warn' && comp(1)[0].tone === 'danger')
  const val = age => looks([mine({ title: 'Vacuum', value_now: 1500, value_currency: 'NOK', value_on: day(-age) })])
  check('"Could sell for" older than six months: info, opens at that fact', val(200)[0].kind === 'old_value' && val(200)[0].action === 'value' && sp(val(200)[0].facts[0]) === 'Could sell for 1 500 NOK')
  check('…a newer one, or none at all: nothing', val(100).length === 0 && looks([mine({ value_on: day(-300) })]).length === 0)
  const sold = mine({ title: 'Old watch', disposal: 'sold', disposed_on: day(-30), sale_price: 900, return_by: day(2), warranty_until: day(10), value_now: 500, value_on: day(-300) })
  check('a thing that is gone has no deadlines and no estimate to update', looks([sold]).length === 0)
  check('quick-list rows never count', looks([item({ list: 'quick', status: 'bought', bought_at: null, return_by: day(1) })]).length === 0)
}

console.log('old wishes and tidy-up')
{
  const old = item({ title: 'Grinder', price: 1290, created_at: at(-200) })
  const ls = looks([old])
  check('a wish older than six months: info, since when and its price', eq(kinds(ls), ['old_wish']) && sp(ls[0].facts.join(' · ')) === 'On the wishlist since 24.04.2026 · 1 290 NOK', sp(ls[0].facts.join(' · ')))
  check('…a newer one nothing; a general wish\'s model never on its own', looks([item({ created_at: at(-100) })]).length === 0 && looks([item({ option_for: 'w1', created_at: at(-300) })]).length === 0)
  check('a general wish shows its range', sp(looks([item({ kind: 'general', price_min: 1500, price_max: 3500, created_at: at(-300) })])[0].facts[1]) === '1 500–3 500 NOK')
  const priced = old => looks([old], [watch(old, 990)])[0]
  check('an old wish is signed by its first day only: a price that moves never brings it back after Got it',
    ls[0].signature === `old_wish|${day(-200)}` && priced({ ...old, url: 'https://shop.example/g' }).signature === ls[0].signature)
  check('…its price from a Prisjakt figure that may be a used one says so (", new and used")',
    sp(looks([{ ...old, url: 'https://www.prisjakt.no/p/1' }], [watch({ ...old, url: 'https://www.prisjakt.no/p/1' }, 990, { source: 'prisjakt', condition: 'mixed' })])[0].facts[1]) === '990 NOK, new and used')
  const noDay = mine({ title: 'Chair', bought_at: null })
  const rate = mine({ title: 'Carpet', currency: 'TRY', price: 2400, fx_nok: null, bought_at: at(-20) })
  const fresh = mine({ title: 'Jacket', currency: 'TRY', price: 4500, fx_nok: null, bought_at: at(-1) })
  const noSum = mine({ title: 'Monitor', disposal: 'sold', disposed_on: day(-40), sale_price: null })
  const tidy = looks([noDay, rate, fresh, noSum])
  check('one tidy-up row counts the things and says what each lacks', eq(kinds(tidy), ['tidy_up']) && tidy[0].title === '3 things to tidy up'
    && eq(tidy[0].facts, ['1 without a purchase day', '1 rate pending', '1 sale without an amount']), JSON.stringify(tidy[0] && tidy[0].facts))
  check('…and lists every one of them with its reason (Show), not only the first', tidy[0].action === 'list' && tidy[0].itemId === null
    && eq(tidy[0].things.map(t => [t.title, t.facts.join()]), [['Chair', 'no purchase day'], ['Carpet', 'rate pending'], ['Monitor', 'sale without an amount']]))
  check('a rate is pending only after three days (Norges Bank publishes after 16:00; the page fetches it)', looks([fresh]).length === 0)
  check('a column that is absent (before migration 134) is not "missing"', looks([mine({ bought_at: undefined })]).length === 0)
  check('a new thing to tidy up changes its signature (so Got it lets it back)', looks([noDay])[0].signature !== tidy[0].signature)
}

console.log('the order and the phone\'s line')
{
  const hp = item({ title: 'Headphones', url: 'https://www.elkjop.no/p/1', target_price: 2990 })
  const espresso = mine({ title: 'Espresso', price: 4490, url: 'https://www.kitchn.no/p/3', return_by: day(5) })
  const all = looks([
    item({ title: 'Grinder', created_at: at(-200) }), mine({ title: 'Vacuum', value_now: 1, value_on: day(-300) }), mine({ title: 'Chair', bought_at: null }),
    mine({ title: 'Brush', warranty_until: day(38) }), hp, espresso, mine({ title: 'Earbuds', return_by: day(1) }),
  ], [watch(hp, 2990), watch(espresso, 3990)], { deals: BLACK_FRIDAY })
  check('danger, then warn (money to claim), success, then info: the deal day, dates, estimates, wishes, tidy-up',
    eq(kinds(all), ['return_closing', 'cheaper_returnable', 'at_target', 'deal_day', 'complaint_ending', 'old_value', 'old_wish', 'tidy_up']), kinds(all).join(','))
  const line = S.lookLine(all)
  check('the line: "8 need a look · 500 NOK to claim", in the first row\'s tone', line.count === 8 && line.words === '8 need a look' && sp(line.claim) === '500 NOK to claim' && line.tone === 'danger')
  check('one: "1 needs a look"; none: "Nothing needs a look", no tone', S.lookLine(all.slice(0, 1)).words === '1 needs a look' && S.lookLine([]).words === 'Nothing needs a look' && S.lookLine([]).tone === null)
  check('no money to claim: no claim words', S.lookLine(all.filter(l => l.kind !== 'cheaper_returnable')).claim === null)
  check('keys are unique', new Set(all.map(l => l.key)).size === all.length)
  check('every row has a signature', all.every(l => typeof l.signature === 'string' && l.signature.length > 0))
}

console.log('Snooze and Got it')
{
  const hp = item({ id: 'hp', title: 'Headphones', url: 'https://www.elkjop.no/p/1', target_price: 2990 })
  const earbuds = mine({ id: 'eb', title: 'Earbuds', return_by: day(1) })
  const ls = looks([hp, earbuds], [watch(hp, 2990)])
  check('a snooze lasts a week: from 10.11.2026 to 17.11.2026', S.snoozeUntil(TODAY) === '2026-11-17')
  const split = st => S.splitLooks(ls, st, TODAY)
  const state = (item_id, signal, p) => ({ id: `${item_id}-${signal}`, user_id: 'u', item_id, signal, signature: null, snoozed_until: null, dismissed_at: null, created_at: at(0), updated_at: at(0), ...p })
  const snoozed = split([state('hp', 'at_target', { snoozed_until: day(7) })])
  check('a snoozed row is hidden until its day, the others show', eq(kinds(snoozed.shown), ['return_closing']) && eq(kinds(snoozed.hidden), ['at_target']))
  check('…on its day it shows again', S.splitLooks(ls, [state('hp', 'at_target', { snoozed_until: TODAY })], TODAY).hidden.length === 0)
  const returning = ls.find(l => l.kind === 'return_closing')
  check('the return row\'s signature is its day', returning.signature === `return_closing|${earbuds.return_by}`)
  const gotIt = split([state('eb', 'return_closing', { signature: returning.signature, dismissed_at: at(0) })])
  check('Got it hides a row while it says the same', eq(kinds(gotIt.shown), ['at_target']) && eq(kinds(gotIt.hidden), ['return_closing']))
  const cheaper = looks([hp], [watch(hp, 2790)])
  check('…and lets it back when it says something new (a lower price)', S.splitLooks(cheaper, [state('hp', 'at_target', { signature: 'at_target|NOK|2990', dismissed_at: at(0) })], TODAY).shown.length === 1)
  check('a state for another thing or another kind of row hides nothing', split([state('eb', 'at_target', { snoozed_until: day(7) }), state('hp', 'return_closing', { snoozed_until: day(7) })]).hidden.length === 0)
  const tidy = looks([mine({ title: 'Chair', bought_at: null })])
  check('a row about no one thing is kept by its kind alone (tidy-up)', S.splitLooks(tidy, [state(null, 'tidy_up', { snoozed_until: day(3) })], TODAY).hidden.length === 1)
  check('every signature is one the database takes (190\'s CHECK)', [...ls, ...tidy].every(l => /^[A-Za-z0-9._:,;=|@#+/-]{1,120}$/.test(l.signature)))
  // Deal days: each its own key (its slug as the subject), so snoozing one never hides the next.
  const deals = looks([hp], [], { deals: ahead([BF, SINGLES]) }).filter(l => l.kind === 'deal_day')
  const dealState = (slug, p) => ({ ...state(null, 'deal_day', p), id: slug, subject: slug })
  check('each deal day ahead is a row of its own, keyed by its slug; only the next one shows', eq(deals.map(l => l.subject), ['singles_day', 'black_friday'])
    && eq(S.splitLooks(deals, [], TODAY).shown.map(l => l.subject), ['singles_day']))
  const nextOne = S.splitLooks(deals, [dealState('singles_day', { snoozed_until: day(1) })], TODAY)
  check('snoozing Singles\' Day shows Black Friday (a snooze on one deal row never hides the others)', eq(nextOne.shown.map(l => l.subject), ['black_friday'])
    && eq(nextOne.hidden.map(l => l.subject), ['singles_day']))
  check('…and a state with no subject (a deal row from before) hides none of them', S.splitLooks(deals, [state(null, 'deal_day', { snoozed_until: day(7) })], TODAY).hidden.length === 0)
  check('a deal day\'s snooze ends the day before it starts: Singles\' Day tomorrow can\'t be snoozed, Black Friday (17 days) a week',
    deals[0].snoozeTo === null && deals[1].snoozeTo === day(7))
}

console.log('the clean price figures (shop_price_stats)')
{
  const spark = steps => Array.from({ length: 12 }, (_, i) => (steps.includes(i) ? 100 : null))
  const stats = p => ({ item_id: 'x', currency: 'NOK', points: 4, low_all: 15990, high_all: 17990, points_60d: 3, low_60d: 16990, high_60d: 17990,
    last_price: 17490, last_in_stock: true, last_at: at(0), back_in_stock: false, restocked_at: null, spark: spark([2, 6, 11]), first_60d: at(-47), ...p })
  const f = T.factsOf(stats())
  check('the figures as the tile and Needs a look read them', f.lowAll === 15990 && f.highAll === 17990 && f.readsAll === 4 && f.low60 === 16990
    && f.high60 === 17990 && f.reads60 === 3 && f.currency === 'NOK' && !f.backInStock, JSON.stringify(f))
  check('how far back the 60 days reach: the day of their first clean read (first_60d), never the sparkline\'s 5-day step', f.since60 === day(-47) && T.factsOf(stats({ first_60d: null })).since60 === null)
  check('back in stock and since when', T.factsOf(stats({ back_in_stock: true, restocked_at: at(-2) })).restockedAt === at(-2))
  check('no history: one clean read, or one price all along', T.spanOf(T.factsOf(stats({ points: 1 }))) === null && T.spanOf(T.factsOf(stats({ low_all: 100, high_all: 100 }))) === null)
  check('a history: lowest, highest, reads', eq(T.spanOf(f), { low: 15990, high: 17990, reads: 4, currency: 'NOK' }))
  check('…never without its currency (a read that named none places nothing)', T.spanOf(T.factsOf(stats({ currency: null }))) === null)
  const span = T.spanOf(facts({ lowAll: 100, highAll: 140, readsAll: 2 }))
  check('today\'s place, clamped to the ends', T.spanPosition(120, span) === 0.5 && T.spanPosition(90, span) === 0 && T.spanPosition(150, span) === 1)
  const ids = T.watchedWishIds([item({ id: 'b', url: 'https://x.example.com/1' }), item({ id: 'a', url: 'https://x.example.com/2' }), item({ id: 'c', url: 'javascript:x' }),
    item({ id: 'd', url: 'https://x.example.com/3', option_for: 'w' }), item({ id: 'e', url: 'https://x.example.com/4', kind: 'general' }), mine({ id: 'f', url: 'https://x.example.com/5' })])
  check('the figures asked for: open wishes with a web link, sorted (never a model, a general wish or a thing you own)', eq(ids, ['a', 'b']))
}

console.log('the tile: one belt')
{
  const hp = item({ url: 'https://www.elkjop.no/p/1', target_price: 2990, wait_for_deal: true, reason: 'need' })
  const hist = facts({ lowAll: 2990, highAll: 3490, readsAll: 2, low60: 2990, high60: 3490, reads60: 2 })
  const ctx = (low, f, w = {}) => ({ watch: watch(hp, low, w), facts: f, today: TODAY })
  check('the order: at target, 60-day low, restocked, deal on, need it', T.beltOf(hp, ctx(2990, hist)) === 'at_target'
    && T.beltOf({ ...hp, target_price: 2000 }, ctx(2990, hist)) === 'lowest'
    && T.beltOf({ ...hp, target_price: 2000 }, ctx(3100, { ...hist, backInStock: true })) === 'back'
    && T.beltOf({ ...hp, target_price: 2000 }, ctx(3100, hist)) === 'deal'
    && T.beltOf({ ...hp, target_price: 2000, wait_for_deal: false }, ctx(3100, hist)) === 'need'
    && T.beltOf({ ...hp, target_price: 2000, wait_for_deal: false, reason: 'fun' }, ctx(3100, hist)) === null)
  check('a 60-day low needs a history in the 60 days: one read is not "lowest"', T.beltOf({ ...hp, target_price: null, wait_for_deal: false, reason: null }, ctx(2990, facts({ lowAll: 2990, highAll: 2990, readsAll: 1, low60: 2990, high60: 2990, reads60: 1 }))) === null)
  check('…and the belt follows the same 60-day rule as Needs a look: the lowest of all time, but one read in the 60 days, is no belt', T.beltOf({ ...hp, target_price: null, wait_for_deal: false, reason: null },
    ctx(2990, facts({ lowAll: 2990, highAll: 3490, readsAll: 5, low60: 2990, high60: 2990, reads60: 1 }))) === null)
  check('a mixed or pre-188 price wears no price belt', T.beltOf({ ...hp, wait_for_deal: false, reason: null }, ctx(2990, hist, { condition: 'mixed' })) === null
    && T.beltOf({ ...hp, wait_for_deal: false, reason: null }, ctx(2990, hist, { condition: null })) === null)
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
