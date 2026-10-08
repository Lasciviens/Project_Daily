#!/usr/bin/env node
/* Verification — what you own, money chains, Stats, grocery prices and
 * Norges Bank's rates (src/features/shop/{fx,fxNorgesBank,ownModel,chainModel,
 * statsModel,groceryModel}.ts, migration 137) and the rate parser's hand
 * mirror in supabase/functions/shop-price/index.ts.
 * Run: node scripts/verify-shop-owned.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const F = require('../src/features/shop/fx')
const NB = require('../src/features/shop/fxNorgesBank')
const O = require('../src/features/shop/ownModel')
const C = require('../src/features/shop/chainModel')
const S = require('../src/features/shop/statsModel')
const G = require('../src/features/shop/groceryModel')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps
// Today's USD-base rates as OXR returns them: 1 TRY = 0.25 NOK, 1 EUR = 11.11 NOK.
const rates = { NOK: 10, TRY: 40, EUR: 0.9 }
const TODAY = '2026-10-08'

let n = 0
function item(p) {
  n++
  return {
    id: p.id ?? `i${n}`, user_id: 'u', category_id: null, title: p.title ?? `Item ${n}`, notes: null, price: null, price_source: null,
    platform: null, url: null, priority: 'medium', region: null, planned_date: null, status: 'bought', source_type: 'manual',
    created_at: `2026-01-${String(1 + (n % 27)).padStart(2, '0')}T10:00:00.000Z`, updated_at: '2026-09-30T10:00:00.000Z',
    list: 'wishlist', currency: 'NOK', bought_at: null, task_id: null, kind: 'item', kept: true, ...p,
  }
}
const cost = (item_id, amount, currency, spent_on, fx_nok = null) => ({ id: `c-${item_id}-${amount}`, user_id: 'u', item_id, label: 'Cost', amount, currency, spent_on, fx_nok, fx_source: null, created_at: '', updated_at: '' })
const at = day => `${day}T12:00:00.000Z`
const link = (from, to, amount = null) => ({ id: `${from}>${to}`, user_id: 'u', from_id: from, to_id: to, amount, created_at: '' })
const ctx = (costs = []) => O.moneyCtx(costs, rates)
const CTX = ctx()

console.log('\n1 · Rates: a transaction at its own day\'s rate, never today\'s')
check('NOK per TRY / EUR from USD-base rates (today\'s)', near(F.nokPerUnit('TRY', rates), 0.25) && near(F.nokPerUnit('EUR', rates), 11.111) && F.nokPerUnit('NOK', null) === 1)
check('a missing rate is null, not 0', F.nokPerUnit('TRY', { NOK: 10 }) === null && F.nokPerUnit('TRY', null) === null)
check('a purchase at its frozen rate', O.nokAt(30000, 'TRY', 0.4).nok === 12000 && O.complete(O.nokAt(30000, 'TRY', 0.4)))
check('no frozen rate yet: rate pending — today\'s rate never stands in', O.nokAt(30000, 'TRY', null).pending === 1 && O.nokAt(30000, 'TRY', null).nok === 0)
check('NOK needs no rate; no amount is missing', O.complete(O.nokAt(500, 'NOK', null)) && O.nokAt(null, 'NOK', 1).missing === 1)
check('a value of now at today\'s rate; pending while rates load', O.nokNow(1000, 'TRY', rates).nok === 250 && O.nokNow(1000, 'TRY', null).pending === 1)
check('rates are stored to 6 significant digits', F.roundRate(0.2512345678) === 0.251235)

console.log('\n2 · Norges Bank\'s answer (live shape, 08.10.2026) and the function\'s mirror')
{
  const block = (file) => {
    const s = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    const a = s.indexOf('// <fx-norges-bank>')
    const b = s.indexOf('// </fx-norges-bank>')
    return a >= 0 && b > a ? s.slice(a, b) : null
  }
  const src = block('src/features/shop/fxNorgesBank.ts')
  const fn = block('supabase/functions/shop-price/index.ts')
  check('shop-price carries the same parser', !!src && src === fn, 'copy the <fx-norges-bank> block from src/features/shop/fxNorgesBank.ts into the function')
  const LIVE = {"data":{"structure":{"dimensions":{"series":[{"id":"FREQ","values":[{"id":"B"}]},{"id":"BASE_CUR","values":[{"id":"TRY"},{"id":"USD"},{"id":"EUR"}]},{"id":"QUOTE_CUR","values":[{"id":"NOK"}]},{"id":"TENOR","values":[{"id":"SP"}]}],"observation":[{"id":"TIME_PERIOD","values":[{"id":"2023-05-30"},{"id":"2023-05-31"},{"id":"2023-06-01"},{"id":"2023-06-02"},{"id":"2023-06-05"}]}]},"attributes":{"series":[{"id":"DECIMALS","values":[{"id":"2"},{"id":"4"}]},{"id":"CALCULATED","values":[{"id":"false"}]},{"id":"UNIT_MULT","values":[{"id":"2"},{"id":"0"}]},{"id":"COLLECTION","values":[{"id":"C"}]}]}},"dataSets":[{"series":{"0:0:0:0":{"attributes":[0,0,0,0],"observations":{"0":["54.19"],"1":["54.24"],"2":["53.78"],"3":["52.7"],"4":["52.11"]}},"0:1:0:0":{"attributes":[1,0,1,0],"observations":{"0":["11.0522"],"1":["11.237"],"2":["11.1872"],"3":["11.0053"],"4":["11.0641"]}},"0:2:0:0":{"attributes":[1,0,1,0],"observations":{"0":["11.8745"],"1":["12.0045"],"2":["11.967"],"3":["11.845"],"4":["11.8275"]}}}}]}}
  const r = NB.parseNorgesBank(LIVE)
  const get = (c, d) => r.find(x => x.currency === c && x.day === d)?.nokPerUnit
  check('15 rates (3 currencies × 5 business days)', r.length === 15)
  check('TRY is quoted per 100: 53.78 → 0.5378 per lira', near(get('TRY', '2023-06-01'), 0.5378, 1e-9))
  check('USD and EUR per 1', get('USD', '2023-06-01') === 11.1872 && get('EUR', '2023-06-01') === 11.967)
  const cal = NB.calendarRates(r, '2023-05-30', '2023-06-05')
  const day = (c, d) => cal.find(x => x.currency === c && x.day === d)
  check('a weekend day carries Friday\'s rate (and says so)', day('TRY', '2023-06-03').nok_per_unit === 0.527 && day('TRY', '2023-06-04').rate_day === '2023-06-02')
  check('every calendar day is filled inside the published span', cal.filter(x => x.currency === 'EUR').length === 7)
  const ahead = NB.calendarRates(r, '2023-06-05', '2023-06-07')
  check('a weekday after the last published one waits (it may just not be out yet)', !ahead.some(x => x.day === '2023-06-06'))
  const fri = NB.calendarRates(NB.parseNorgesBank(LIVE).filter(x => x.day <= '2023-06-02'), '2023-06-02', '2023-06-04')
  check('…but a weekend right after it is filled', fri.filter(x => x.currency === 'TRY').map(x => x.day).join() === '2023-06-02,2023-06-03,2023-06-04')
  check('the query asks for the needed currencies only (never NOK)', NB.norgesBankUrl('2023-05-30', '2023-06-05', ['TRY', 'NOK']).includes('/EXR/B.TRY.NOK.SP?') && NB.norgesBankUrl('2023-05-30', '2023-06-05').includes('B.TRY+EUR+USD.NOK.SP'))
  check('garbage in: nothing out, no crash', NB.parseNorgesBank(null).length === 0 && NB.parseNorgesBank({ data: { dataSets: [{ series: { '0:0:0:0': { observations: { 0: ['x'] } } } }] } }).length === 0)
}

console.log('\n3 · What a row is')
{
  const mine = item({})
  check('a bought wishlist row you kept is yours', O.isPossession(mine) && O.isMine(mine) && O.ownState(mine) === 'mine')
  check('a quick-list errand is never a possession', !O.isPossession(item({ list: 'quick' })))
  check('a general wish is never a possession', !O.isPossession(item({ kind: 'general', status: 'fulfilled' })))
  check('bought for someone else: spending only', !O.isPossession(item({ kept: false })) && O.ownState(item({ kept: false })) === 'not_kept')
  check('sold = gone', O.isGone(item({ disposal: 'sold', disposed_on: '2026-01-01', sale_price: 10 })))
  check('returned is never "gone" (it never was yours)', !O.isGone(item({ disposal: 'returned' })) && O.ownState(item({ disposal: 'returned' })) === 'returned')
  check('to buy / dropped / fulfilled', O.ownState(item({ status: 'wishlist' })) === 'to_buy' && O.ownState(item({ status: 'dropped' })) === 'dropped' && O.ownState(item({ status: 'fulfilled' })) === 'fulfilled')
}
console.log('\n4 · Days and durations')
check('days between', O.daysBetween('2026-05-16', TODAY) === 145)
check('months between (part-month in days)', near(O.monthsBetween('2026-05-16', TODAY), 4 + 22 / 30.4375, 0.02))
check('"4 months", "2 years 2 months", "12 days", "1 year"', O.durationLabel('2026-05-16', TODAY) === '4 months' && O.durationLabel('2024-03-02', '2026-05-15') === '2 years 2 months'
  && O.durationLabel('2026-09-26', TODAY) === '12 days' && O.durationLabel('2025-10-08', TODAY) === '1 year')
check('"today" for the same day, "1 day"', O.durationLabel(TODAY, TODAY) === 'today' && O.durationLabel('2026-10-07', TODAY) === '1 day')
check('add months clamps to the month\'s end (leap day)', O.addMonths('2024-02-29', 12) === '2025-02-28' && O.addMonths('2026-10-08', 60) === '2031-10-08')
check('add days across a year', O.addDays('2026-12-25', 14) === '2027-01-08')

console.log('\n5 · Money is never silently 0')
{
  check('no price: missing', O.paidOf(item({ price: null })).missing === 1)
  check('a gift is a real 0', O.complete(O.paidOf(item({ price: null, got_as_gift: true }))) && O.paidOf(item({ price: null, got_as_gift: true })).nok === 0)
  check('came with it (price 0) is a real 0', O.paidOf(item({ price: 0 })).nok === 0 && O.complete(O.paidOf(item({ price: 0 }))))
  check('a TRY purchase at its own day\'s rate', O.paidOf(item({ price: 30000, currency: 'TRY', fx_nok: 0.4 })).nok === 12000)
  check('a TRY purchase without its rate yet: pending, not today\'s 7 500', O.paidOf(item({ price: 30000, currency: 'TRY', fx_nok: null })).pending === 1)
  const x = item({ id: 'x-extras' })
  const c = ctx([cost('x-extras', 500, 'NOK', '2026-01-01'), cost('x-extras', 40, 'EUR', '2026-02-01', 11.5), cost('x-extras', -100, 'NOK', '2026-03-01')])
  check('extras add up at their own rates; a rebate takes off', O.extrasOf(x, c).nok === 860 && O.complete(O.extrasOf(x, c)))
  check('an extra waiting for its rate makes the cost pending', O.extrasOf(x, ctx([cost('x-extras', 40, 'EUR', '2026-02-01')])).pending === 1)
  check('sold without an amount: missing', O.gotOf(item({ disposal: 'sold' })).missing === 1)
  check('given away / broke without an amount: 0', O.gotOf(item({ disposal: 'given' })).nok === 0 && O.complete(O.gotOf(item({ disposal: 'broken' }))))
  check('still yours: nothing got back yet', O.gotOf(item({})) === null)
  check('sums keep the missing and pending counts', (() => { const s = O.add(O.MISSING, O.known(5), O.PENDING, O.MISSING); return s.missing === 2 && s.pending === 1 && s.nok === 5 && !O.complete(s) })())
  const saved = O.savedOf(item({ price: 4490, market_price: 4990 }))
  check('saved against the market price at purchase', saved && saved.nok === 500)
  check('no saving when paid more or the same', O.savedOf(item({ price: 4990, market_price: 4990 })) === null)
  check('rates pending: a foreign purchase, sale or cost without its rate (never NOK, never before 137)',
    O.ratesPending([item({ price: 10, currency: 'TRY', fx_nok: null })], []) && O.ratesPending([item({ price: 10, disposal: 'sold', disposed_on: '2026-01-01', sale_price: 5, sale_currency: 'EUR', sale_fx_nok: null, fx_nok: 1 })], [])
    && O.ratesPending([], [cost('x', 5, 'EUR', '2026-01-01')]) && !O.ratesPending([item({ price: 10, currency: 'NOK', fx_nok: null })], [])
    && !O.ratesPending([(() => { const r = item({ price: 10, currency: 'TRY' }); delete r.fx_nok; return r })()], []))
  check('"Could sell for" is today\'s worth (today\'s rate)', O.valueNowOf(item({ value_now: 2000, value_currency: 'TRY' }), CTX).nok === 500)
}

console.log('\n6 · Cost of use per month')
{
  const rp6 = item({ id: 'rp6', price: 4490, bought_at: at('2026-05-16'), value_now: 4000, value_on: '2026-09-01' })
  const pm = O.perMonth(rp6, CTX, TODAY)
  check('still yours: (paid − could sell for) ÷ months', pm && near(pm.nok, 490 / O.monthsBetween('2026-05-16', TODAY)))
  check('no "Could sell for": no number', O.perMonth(item({ price: 4490, bought_at: at('2026-01-01') }), CTX, TODAY) === null)
  check('less than a month: no number', O.perMonth(item({ price: 100, bought_at: at('2026-09-20'), value_now: 50 }), CTX, TODAY) === null)
  const sold = item({ id: 's1', price: 2800, bought_at: at('2024-03-02'), disposal: 'sold', disposed_on: '2026-05-15', sale_price: 2342, sale_group: 'g1' })
  const caseA = item({ id: 'c1', price: 199, bought_at: at('2024-03-02'), accessory_of: 's1', disposal: 'sold', disposed_on: '2026-05-15', sale_price: 166, sale_group: 'g1' })
  const sd = item({ id: 'sd', price: 399, bought_at: at('2024-04-01'), accessory_of: 's1' })
  const pg = O.perMonth(sold, CTX, TODAY, [caseA, sd])
  check('gone: (cost − got) ÷ months, with only the accessories sold in the same sale', pg && near(pg.used.nok, 2800 + 199 - 2342 - 166) && near(pg.months, O.monthsBetween('2024-03-02', '2026-05-15')))
  check('a missing sale amount: no number', O.perMonth(item({ price: 100, bought_at: at('2025-01-01'), disposal: 'sold', disposed_on: '2026-01-01' }), CTX, TODAY) === null)
  check('a sale waiting for its rate: no number', O.perMonth(item({ price: 100, bought_at: at('2025-01-01'), disposal: 'sold', disposed_on: '2026-01-01', sale_price: 50, sale_currency: 'EUR' }), CTX, TODAY) === null)
}

console.log('\n7 · Selling things together')
{
  const split = O.splitSale(2800, [{ id: 'rp5', weight: 2800 }, { id: 'case', weight: 199 }, { id: 'grip', weight: 349 }])
  check('split by what each cost', split.get('case') === 166 && split.get('grip') === 292)
  check('the item itself takes the rounding; the shares add up exactly', split.get('rp5') === 2342 && [...split.values()].reduce((s, v) => s + v, 0) === 2800)
  const even = O.splitSale(100, [{ id: 'a', weight: null }, { id: 'b', weight: 50 }, { id: 'c', weight: 0 }])
  check('unknown costs: evenly', even.get('b') === 33 && even.get('c') === 33 && even.get('a') === 34)
  check('the sale\'s whole amount', O.saleTotal([item({ sale_price: 2342 }), item({ sale_price: 166 }), item({ sale_price: 292 })]) === 2800)
  check('a row without its share: unknown total', O.saleTotal([item({ sale_price: 10 }), item({ sale_price: null })]) === null)
}

console.log('\n8 · A money chain (RP4 → RP5 + accessories → RP6)')
const RP = [
  item({ id: 'rp4', title: 'RP4 Pro', price: 1990, bought_at: at('2023-01-10'), disposal: 'sold', disposed_on: '2024-03-01', sale_price: 1400 }),
  item({ id: 'rp5', title: 'RP5', price: 2800, bought_at: at('2024-03-02'), disposal: 'sold', disposed_on: '2026-05-15', sale_price: 2342, sale_group: 'g5' }),
  item({ id: 'case', title: 'Case', price: 199, bought_at: at('2024-03-02'), accessory_of: 'rp5', disposal: 'sold', disposed_on: '2026-05-15', sale_price: 166, sale_group: 'g5' }),
  item({ id: 'grip', title: 'Grip', price: 349, bought_at: at('2024-05-01'), accessory_of: 'rp5', disposal: 'sold', disposed_on: '2026-05-15', sale_price: 292, sale_group: 'g5' }),
  item({ id: 'rp6', title: 'RP6', price: 4490, bought_at: at('2026-05-16'), value_now: 4000, value_on: '2026-09-01' }),
  item({ id: 'sd', title: 'SD card', price: 399, bought_at: at('2024-04-01'), accessory_of: 'rp6' }),
]
const RP_LINKS = [link('rp4', 'rp5'), link('rp5', 'rp6')]
{
  const units = C.unitsOf(RP)
  check('accessories ride with their item: sold together, or still on it', units.get('case') === units.get('rp5') && units.get('rp5').accessories.map(x => x.id).join() === 'case,grip' && units.get('sd') === units.get('rp6'))
  const loose = C.unitsOf([...RP, item({ id: 'strap', price: 99, bought_at: at('2024-06-01'), accessory_of: 'rp5', disposal: 'sold', disposed_on: '2025-01-01', sale_price: 50 })])
  check('an accessory sold on its own stands alone', loose.get('strap').id === 'strap' && !loose.get('rp5').accessories.some(x => x.id === 'strap'))
  const chains = C.chainsOf(RP, RP_LINKS, CTX)
  check('one chain of three units', chains.length === 1 && chains[0].nodes.map(x => x.id).join(',') === 'rp4,rp5,rp6')
  const [a, b, c] = chains[0].nodes
  check('RP4 lost 590, passed on whole', a.result.nok === 590 && a.passedOn === 1 && a.ends.nok === 0 && b.carried.nok === 590)
  check('RP5 with its accessories: paid 3 348, got 2 800', b.paid.nok === 3348 && b.got.nok === 2800)
  check('RP5 passes 590 + 3 348 − 2 800 = 1 138 on', b.result.nok === 1138 && c.carried.nok === 1138)
  check('RP6 (with the SD card on it) has a route cost of 4 889 + 1 138 = 6 027', c.paid.nok === 4889 && c.basis.nok === 6027)
  check('…and 2 800 of its price came from the RP5', c.cashIn.nok === 2800 && b.cashIn.nok === 1400)
  check('chain: paid 10 227 − got 4 200 = 6 027 = what you hold', chains[0].net.nok === 6027 && chains[0].paid.nok === 10227 && chains[0].got.nok === 4200)
  check('a straight chain', chains[0].linear && !chains[0].projected)
  const fc = C.finalCostOf(chains[0], 'rp6')
  check('final cost on the RP6\'s card: own 4 889 + 1 138 from 2 earlier things', fc && fc.own.nok === 4889 && fc.carried.nok === 1138 && fc.total.nok === 6027 && fc.earlier === 2)
  check('…and how long the earlier ones were used (a straight chain only)', fc && near(fc.earlierMonths, O.monthsBetween('2023-01-10', '2026-05-16')))
  check('an accessory finds its item\'s final cost', C.finalCostOf(chains[0], 'sd').total.nok === 6027)
  check('the first thing in a chain has no carried cost', C.finalCostOf(chains[0], 'rp4') === null)
  const idx = C.chainIndex(chains)
  check('every member finds its chain, accessories too', idx.get('rp5') === chains[0] && idx.get('case') === chains[0] && idx.get('sd') === chains[0])
  const what = C.chainsOf(RP, RP_LINKS, CTX, { overrides: { rp5: { gotNok: 3600 } } })[0]
  check('"Try other prices": a better RP5 sale lowers the RP6\'s route cost by 800', what.nodes[2].basis.nok === 6027 - 800 && what.net.nok === 6027 - 800 && what.projected)
  check('…and nothing in the data changed', RP.find(x => x.id === 'rp5').sale_price === 2342)
  const cheaper = C.chainsOf(RP, RP_LINKS, CTX, { overrides: { rp4: { paidNok: 1490 } } })[0]
  check('"if I had bought the RP4 for 1 490": the RP6 really cost 500 less', cheaper.nodes[2].basis.nok === 5527)
  const viaSd = C.chainFor('sd', RP, RP_LINKS, CTX)
  check('an accessory opens its item\'s chain', viaSd && viaSd.nodes.length === 3)
  const solo = C.chainFor('x1', [item({ id: 'x1', price: 1000, bought_at: at('2025-01-01') })], [], CTX)
  check('a thing with no links is a chain of one (for "Try other prices")', solo && solo.nodes.length === 1 && solo.net.nok === 1000)
  const soloWhat = C.chainFor('x1', [item({ id: 'x1', price: 1000, bought_at: at('2025-01-01') })], [], CTX, { overrides: { x1: { paidNok: 800 } } })
  check('…and other prices work on it', soloWhat.net.nok === 800)
  const soldNow = C.chainFor('x1', [item({ id: 'x1', price: 1000, bought_at: at('2025-01-01') })], [], CTX, { overrides: { x1: { gotNok: 700 } } })
  check('"if I sold it for 700": it cost me 300', soldNow.nodes[0].state === 'gone' && soldNow.nodes[0].result.nok === 300 && soldNow.net.nok === 300)
}

console.log('\n9 · Chains that split, join, plan and do not know')
{
  const cam = [
    item({ id: 'cam', price: 6000, bought_at: at('2022-01-01'), disposal: 'sold', disposed_on: '2025-01-01', sale_price: 5000 }),
    item({ id: 'bike', price: 4000, bought_at: at('2025-01-02') }),
    item({ id: 'helmet', price: 1000, bought_at: at('2025-01-02') }),
  ]
  const [ch] = C.chainsOf(cam, [link('cam', 'bike'), link('cam', 'helmet')], CTX)
  const bike = ch.nodes.find(x => x.id === 'bike'), helmet = ch.nodes.find(x => x.id === 'helmet')
  check('one sale paid for two things: the loss is shared by their prices (800 / 200)', near(bike.carried.nok, 800) && near(helmet.carried.nok, 200))
  check('conservation: what you hold = Σ paid − Σ got', near(bike.basis.nok + helmet.basis.nok, ch.net.nok) && ch.net.nok === 6000 && !ch.linear)
  const [am] = C.chainsOf(cam, [link('cam', 'bike', 3000), link('cam', 'helmet')], CTX)
  check('an amount: 3 000 of 5 000 to the bike (60 %), the rest to the helmet', near(am.nodes.find(x => x.id === 'bike').carried.nok, 600) && near(am.nodes.find(x => x.id === 'helmet').carried.nok, 400))
  const [half] = C.chainsOf(cam.slice(0, 2), [link('cam', 'bike', 2500)], CTX)
  check('half of the money went on: half the loss carries, half ends with the camera', near(half.nodes[1].carried.nok, 500) && near(half.nodes[0].ends.nok, 500) && near(half.nodes[1].basis.nok + half.nodes[0].ends.nok, half.net.nok))
  const [over] = C.chainsOf(cam, [link('cam', 'bike', 4000), link('cam', 'helmet', 3000)], CTX)
  check('more than the sale brought: scaled down and flagged', over.flags.some(f => f.kind === 'over-allocated') && near(over.nodes.find(x => x.id === 'bike').carried.nok + over.nodes.find(x => x.id === 'helmet').carried.nok, 1000))

  const join = [
    item({ id: 'ps4', price: 3000, bought_at: at('2020-01-01'), disposal: 'sold', disposed_on: '2024-11-01', sale_price: 1500 }),
    item({ id: 'switch', price: 2500, bought_at: at('2021-01-01'), disposal: 'traded_in', disposed_on: '2024-11-14', sale_price: 1800 }),
    item({ id: 'ps5', price: 5990, bought_at: at('2024-11-14') }),
  ]
  const [j] = C.chainsOf(join, [link('ps4', 'ps5'), link('switch', 'ps5')], CTX)
  const ps5 = j.nodes.find(x => x.id === 'ps5')
  check('two sales paid for one thing: both losses carry (1 500 + 700)', ps5.carried.nok === 2200 && ps5.basis.nok === 8190 && j.net.nok === 8190)
  check('…and the earlier-months sentence is left out (not a straight line)', C.finalCostOf(j, 'ps5').earlierMonths === null)

  const profit = [
    item({ id: 'lego', price: 1000, bought_at: at('2023-01-01'), for_resale: true, disposal: 'sold', disposed_on: '2024-01-01', sale_price: 1500 }),
    item({ id: 'x', price: 2000, bought_at: at('2024-01-02') }),
  ]
  const [p] = C.chainsOf(profit, [link('lego', 'x')], CTX)
  check('a profit carries too: the next thing really cost 2 000 − 500', p.nodes[1].basis.nok === 1500 && p.net.nok === 1500)

  const plan = [item({ id: 'old', price: 9000, bought_at: at('2023-01-01'), value_now: 5000 }), item({ id: 'new', price: 12000, bought_at: at('2026-01-01') })]
  const [pl] = C.chainsOf(plan, [link('old', 'new')], CTX)
  check('a thing still yours passes nothing on (selling it is a plan)', pl.nodes[1].carried.nok === 0 && pl.net.nok === 21000 && !pl.edges[0].used && !pl.edges[0].realised)
  const [plp] = C.chainsOf(plan, [link('old', 'new')], CTX, { project: true })
  check('projected: sold at "Could sell for" 5 000, the new one would really cost 16 000', plp.nodes[1].basis.nok === 16000 && plp.projected && plp.nodes[0].projected)

  const wish = [item({ id: 'w-old', price: 5000, bought_at: at('2024-01-01'), value_now: 3000 }), item({ id: 'w-new', status: 'wishlist', price: 14000 })]
  const [w] = C.chainsOf(wish, [link('w-old', 'w-new')], CTX)
  check('a plan towards a wish is a chain with no money moved', w && w.nodes.length === 2 && w.nodes[1].state === 'wish' && w.net.nok === 5000)
  const [wp] = C.chainsOf(wish, [link('w-old', 'w-new')], CTX, { project: true })
  const need = C.cashNeeded(wp, 'w-new')
  check('after selling it for 3 000: the wish needs 11 000 more, and really costs 16 000', need && need.needed.nok === 11000 && need.fromSales.nok === 3000 && wp.nodes[1].basis.nok === 16000)

  const aside = [
    item({ id: 'sold', price: 2800, bought_at: at('2024-01-01'), disposal: 'sold', disposed_on: '2026-09-01', sale_price: 2000 }),
    item({ id: 'ipad', status: 'wishlist', price: 8000 }),
  ]
  const [as] = C.chainsOf(aside, [link('sold', 'ipad')], CTX)
  check('money set aside for a wish: the loss stays with the sold thing until the wish is bought', as.nodes[0].ends.nok === 800 && as.nodes[1].carried.nok === 0)
  check('…and the wish needs 6 000 more', C.cashNeeded(C.chainsOf(aside, [link('sold', 'ipad')], CTX, { project: true })[0], 'ipad').needed.nok === 6000)

  const general = [
    item({ id: 'tab-old', price: 4000, bought_at: at('2022-01-01'), disposal: 'sold', disposed_on: '2026-08-01', sale_price: 1500 }),
    item({ id: 'tablet', kind: 'general', status: 'fulfilled', price: null, price_min: 5000, price_max: 8000 }),
    item({ id: 'air', option_for: 'tablet', price: 6990, bought_at: at('2026-08-02') }),
    item({ id: 'fe', option_for: 'tablet', status: 'wishlist', price: 5490 }),
  ]
  const [gw] = C.chainsOf(general, [link('tab-old', 'tablet')], CTX)
  check('money towards a general wish moves to the model that was bought', gw && gw.nodes.map(x => x.id).join() === 'tab-old,air' && gw.nodes[1].carried.nok === 2500)
  const openWish = general.map(x => (x.id === 'tablet' ? { ...x, status: 'wishlist' } : x.id === 'air' ? { ...x, status: 'wishlist', bought_at: null } : x))
  const [gp] = C.chainsOf(openWish, [link('tab-old', 'tablet')], CTX, { project: true })
  check('an open general wish projects at the bottom of its range', gp.nodes.find(x => x.id === 'tablet').paid.nok === 5000 && C.cashNeeded(gp, 'tablet').needed.nok === 3500)

  const unknown = [
    item({ id: 'u1', price: 1000, bought_at: at('2023-01-01'), disposal: 'sold', disposed_on: '2024-01-01', sale_price: null }),
    item({ id: 'u2', price: 2000, bought_at: at('2024-01-02') }),
  ]
  const [u] = C.chainsOf(unknown, [link('u1', 'u2')], CTX)
  check('a missing sale amount makes the route cost unknown (never a number)', !O.complete(u.nodes[1].basis) && u.nodes[1].basis.missing >= 1 && !O.complete(u.net))
  const pending = [
    item({ id: 'p1', price: 1000, bought_at: at('2023-01-01'), disposal: 'sold', disposed_on: '2026-10-08', sale_price: 50, sale_currency: 'EUR', sale_fx_nok: null }),
    item({ id: 'p2', price: 2000, bought_at: at('2026-10-08') }),
  ]
  const [pp] = C.chainsOf(pending, [link('p1', 'p2')], CTX)
  check('a sale waiting for its rate makes it pending downstream', pp.nodes[1].basis.pending >= 1 && !O.complete(pp.nodes[1].basis))

  const cyc = [item({ id: 'c1', price: 100, bought_at: at('2024-01-01'), disposal: 'sold', disposed_on: '2024-06-01', sale_price: 50 }), item({ id: 'c2', price: 200, bought_at: at('2024-06-02'), disposal: 'sold', disposed_on: '2025-01-01', sale_price: 100 })]
  const cc = C.chainsOf(cyc, [link('c1', 'c2'), link('c2', 'c1')], CTX)
  check('a loop (refused by the database) does not hang, is flagged and still adds up', cc.length === 1 && cc[0].net.nok === 150 && cc[0].flags.some(f => f.kind === 'loop'))
  check('a loop is spotted before it is saved', C.wouldCycle('c2', 'c1', [link('c1', 'c2')]) && !C.wouldCycle('c1', 'c3', [link('c1', 'c2')]) && C.wouldCycle('a', 'a', []))
  const ids = C.linkedIds('rp5', RP_LINKS)
  check('paid with money from / money went to', ids.from.join() === 'rp4' && ids.to.join() === 'rp6')
  check('a link to a dropped wish or from an errand is ignored', C.chainsOf([item({ id: 'd1', price: 1, bought_at: at('2025-01-01') }), item({ id: 'd2', status: 'dropped', price: 5 })], [link('d1', 'd2')], CTX).length === 0)
}

console.log('\n10 · Invariants on 4 000 random chains')
{
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  let identity = 0, order = 0, shares = 0, plans = 0, unknownReach = 0, cases = 0
  const total = (c, f) => c.nodes.filter(f).reduce((s, x) => s + x.basis.nok, 0)
  for (let t = 0; t < 4000; t++) {
    const k = 2 + Math.floor(rnd() * 8)
    const its = []
    for (let i = 0; i < k; i++) {
      const gone = rnd() < 0.6
      const base = { id: `n${t}-${i}`, price: Math.round(rnd() * 20000), bought_at: at(`20${10 + i}-01-01`) }
      its.push(item(gone ? { ...base, disposal: rnd() < 0.8 ? 'sold' : 'given', disposed_on: `20${10 + i}-12-31`, sale_price: Math.round(rnd() * 15000) } : base))
      if (rnd() < 0.3) its.push(item({ id: `a${t}-${i}`, accessory_of: base.id, price: Math.round(rnd() * 900), bought_at: at(`20${10 + i}-02-01`), ...(gone && rnd() < 0.7 ? { disposal: 'sold', disposed_on: `20${10 + i}-12-31`, sale_price: Math.round(rnd() * 500) } : {}) }))
    }
    // Sold together: an accessory sold on the main's day shares its sale group.
    for (const x of its) if (x.accessory_of && x.disposal) { const m = its.find(y => y.id === x.accessory_of); if (m.disposal) { m.sale_group = `g${t}-${m.id}`; x.sale_group = m.sale_group } }
    const ls = []
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if (rnd() < 0.35) ls.push(link(`n${t}-${i}`, `n${t}-${j}`, rnd() < 0.4 ? Math.round(rnd() * 8000) + 1 : null))
    const chains = C.chainsOf(its, ls, CTX)
    for (const c of chains) {
      cases++
      const held = total(c, x => x.state === 'held')
      const ends = c.nodes.filter(x => x.state === 'gone').reduce((s, x) => s + x.ends.nok, 0)
      if (!near(held + ends, c.net.nok, 1e-6)) identity++
      for (const x of c.nodes.filter(y => y.state === 'gone')) if (x.passedOn > 1 + 1e-9) shares++
    }
    // Other prices and projected plans add up the same way.
    const pick = its[Math.floor(rnd() * its.length)]
    const over = { [pick.id]: rnd() < 0.5 ? { paidNok: Math.round(rnd() * 9000) } : { gotNok: Math.round(rnd() * 9000) } }
    for (const c of C.chainsOf(its.map(x => (rnd() < 0.3 && !x.disposal ? { ...x, value_now: Math.round(rnd() * 5000) } : x)), ls, CTX, { overrides: over, project: true })) {
      const held = total(c, x => x.state === 'held')
      const ends = c.nodes.filter(x => x.state === 'gone').reduce((s, x) => s + (x.ends?.nok ?? 0), 0)
      if (O.complete(c.net) && !near(held + ends, c.net.nok, 1e-6)) identity++
    }
    const back = C.chainsOf([...its].reverse(), [...ls].reverse(), CTX)
    const r6 = v => (Math.round(v * 1e6) / 1e6 + 0).toFixed(6)
    const key = cs => cs.flatMap(c => c.nodes.map(x => `${x.id}:${r6(x.basis.nok)}:${r6(x.ends?.nok ?? 0)}`)).sort().join('|')
    if (key(chains) !== key(back)) order++
    // A plan from a thing still yours changes no realised number.
    const heldIds = its.filter(x => !x.disposal && !x.accessory_of).map(x => x.id)
    if (heldIds.length) {
      const extra = [...ls, link(heldIds[0], `n${t}-${k - 1}`)].filter((l, i, all) => l.from_id !== l.to_id && all.findIndex(m => m.from_id === l.from_id && m.to_id === l.to_id) === i)
      const withPlan = C.chainsOf(its, extra, CTX)
      const real = cs => cs.flatMap(c => c.nodes.filter(x => x.id !== heldIds[0]).map(x => `${x.id}:${x.basis.nok.toFixed(6)}`)).sort().join('|')
      if (real(chains).split('|').some(r => r && !real(withPlan).includes(r))) plans++
    }
    // An unknown sale makes everything it reaches unknown.
    const goneMain = its.find(x => x.disposal && !x.accessory_of && ls.some(l => l.from_id === x.id))
    if (goneMain) {
      const blind = its.map(x => (x.id === goneMain.id ? { ...x, sale_price: null, disposal: 'sold' } : x))
      for (const c of C.chainsOf(blind, ls, CTX)) {
        const reach = new Set([goneMain.id])
        let grew = true
        while (grew) { grew = false; for (const e of c.edges) if (e.used && reach.has(e.from) && !reach.has(e.to) && (e.share ?? 0) > 0) { reach.add(e.to); grew = true } }
        for (const x of c.nodes) if (x.id !== goneMain.id && reach.has(x.id) && O.complete(x.basis)) unknownReach++
        const src = c.nodes.find(x => x.id === goneMain.id)
        if (src && (O.complete(src.result) || O.complete(src.got))) unknownReach++
      }
    }
  }
  check(`Σ route cost held + Σ ended = Σ paid − Σ got, in all ${cases} chains (and with other prices and projected plans)`, identity === 0, `${identity} broke it`)
  check('no sale passes on more than it brought (Σ shares ≤ 1)', shares === 0)
  check('the order rows and links come in never changes a number', order === 0, `${order} differ`)
  check('a plan from a thing still yours changes nothing that happened', plans === 0, `${plans} differ`)
  check('an unknown sale makes everything downstream unknown', unknownReach === 0, `${unknownReach} showed a number`)
}

console.log('\n11 · Deadlines and the Owned view')
{
  const items = [
    item({ id: 'r1', title: 'Headphones', return_by: '2026-10-13', bought_at: at('2026-09-13') }),
    item({ id: 'r2', title: 'TV', warranty_until: '2026-11-01', bought_at: at('2021-11-01') }),
    item({ id: 'r3', title: 'Old', return_by: '2026-10-01', bought_at: at('2026-09-01') }),
    item({ id: 'r4', title: 'Sold one', return_by: '2026-10-10', disposal: 'sold', disposed_on: '2026-10-01', sale_price: 1 }),
  ]
  const up = O.comingUp(items, TODAY)
  check('return windows (≤ 14 days) and complaint rights (≤ 60 days), soonest first', up.map(d => `${d.item.id}:${d.kind}:${d.daysLeft}`).join() === 'r1:return:5,r2:complain:24')
  check('passed deadlines and things you no longer have are left out', !up.some(d => d.item.id === 'r3' || d.item.id === 'r4'))
  check('complaint right: 5 years for electronics, 2 otherwise, 2 in Turkey', O.complaintYears(['Electronics', 'Phones'], 'NO') === 5 && O.complaintYears(['Home & Living', 'Kitchen'], 'NO') === 2 && O.complaintYears(['Electronics'], 'TR') === 2)
  const cats = [{ id: 'el', user_id: 'u', name: 'Electronics', parent_id: null, created_at: '' }, { id: 'gc', user_id: 'u', name: 'Game Consoles', parent_id: 'el', created_at: '' }]
  const RPc = RP.map(x => ({ ...x, category_id: 'gc' }))
  const mine = O.ownedCards(RPc, cats, O.NO_OWNED_FILTERS)
  check('Owned shows things, never an accessory on its own', mine.map(x => x.id).join() === 'rp6')
  check('"Sold or gone" lists the gone things', O.ownedCards(RPc, cats, { ...O.NO_OWNED_FILTERS, show: 'gone' }).map(x => x.id).join() === 'rp4,rp5')
  check('search reaches the category', O.ownedCards(RPc, cats, { ...O.NO_OWNED_FILTERS, show: 'all', q: 'consoles rp' }).length === 3)
  const sum = O.ownedSummary(RPc, CTX)
  check('summary: 1 thing + 1 accessory, 2 gone, paid 4 889, worth 4 000 (1 valued)', sum.mine === 1 && sum.accessories === 1 && sum.gone === 2 && sum.paid.nok === 4889 && sum.worth.nok === 4000 && sum.valued === 1)
  const acc = O.accessoriesByItem(RP)
  check('accessories by item (possessions only)', acc.get('rp5').map(x => x.id).join() === 'case,grip' && acc.get('rp6').map(x => x.id).join() === 'sd')
  const sorted = O.sortOwned([RP[0], RP[1], RP[4]], 'kept', CTX, TODAY, acc)
  check('sort by time kept', sorted.map(x => x.id).join() === 'rp5,rp4,rp6')
  check('the age of "Could sell for"', O.valueAgeDays({ value_on: '2026-09-01' }, TODAY) === 37 && O.valueAgeDays({ value_on: null }, TODAY) === null)
}

console.log('\n12 · Stats')
{
  const items = [
    ...RP,
    item({ id: 'tv', title: 'TV', platform: 'POWER', price: 9990, bought_at: at('2026-02-10') }),
    item({ id: 'ret', title: 'Returned speaker', platform: 'Elkjøp', price: 1500, bought_at: at('2026-03-05'), disposal: 'returned', disposed_on: '2026-03-20', sale_price: 1500 }),
    item({ id: 'gift', title: 'Gift for mum', platform: 'power', price: 600, bought_at: at('2026-03-10'), kept: false }),
    item({ id: 'milk', list: 'quick', price: 30, bought_at: at('2026-03-10') }),
    item({ id: 'trq', title: 'Turkish thing', platform: 'Trendyol', price: 4000, currency: 'TRY', fx_nok: 0.3, bought_at: at('2026-07-01') }),
  ]
  const SC = ctx([cost('tv', 790, 'NOK', '2026-03-01')])
  const months = S.moneyByMonth(items, SC, '2026-01', '2026-12')
  const m = mm => months.find(r => r.month === mm)
  check('12 months, in order', months.length === 12 && months[0].month === '2026-01' && months[11].month === '2026-12')
  check('February: the TV (9 990)', m('2026-02').spent.nok === 9990)
  check('March: wall mount 790 + speaker 1 500 + gift 600 − refund 1 500 (a return takes its purchase back out)', m('2026-03').spent.nok === 790 + 600)
  check('May: RP6 bought 4 490, RP5 and accessories got 2 800 back', m('2026-05').spent.nok === 4490 && m('2026-05').got.nok === 2800)
  check('July: a lira purchase at its own rate (4 000 × 0.3)', m('2026-07').spent.nok === 1200)
  check('quick-list errands never count', !months.some(r => r.ids.includes('milk')))
  const y = S.yearTotals(items, SC, '2026')
  check('the year: spent less refunds, got back, net', y.spent.nok === 9990 + 790 + 600 + 4490 + 1200 && y.got.nok === 2800 && y.net.nok === y.spent.nok - 2800)
  check('…and the rows behind them', y.boughtIds.includes('tv') && y.soldIds.includes('rp5') && !y.soldIds.includes('ret'))
  const stores = S.byStore(items)
  check('stores by spend; "POWER" and "power" are one store (named as last written); a returned purchase is left out', stores[0].key === 'power' && stores[0].title === 'power' && stores[0].count === 2 && stores[0].spent.nok === 9990 + 600 && !stores.some(s => s.key === 'elkjop'))
  const cats = [{ id: 'el', user_id: 'u', name: 'Electronics', parent_id: null, created_at: '' }]
  const byCat = S.ownedByCategory(items.map(x => (x.id === 'tv' ? { ...x, category_id: 'el' } : x)), cats, SC)
  check('owned now by category, with what the valued ones could sell for', byCat.find(r => r.key === 'el').paid.nok === 9990 + 790 && byCat.find(r => r.key === '__none__').worth.nok === 4000)
  const tl = S.timelineRows(items, [])
  check('timeline: one bar per thing, not per accessory, not returned or not kept', tl.rows.length === 5 && !tl.rows.some(r => ['case', 'grip', 'sd', 'ret', 'gift', 'milk'].includes(r.item.id)) && tl.start === '2023-01-10')
  check('…a gone thing ends on its day, a kept one runs on', tl.rows.find(r => r.item.id === 'rp4').to === '2024-03-01' && tl.rows.find(r => r.item.id === 'rp6').to === null)
  const value = S.valueRanking(items, SC, TODAY)
  check('value ranking only with honest numbers', value.length >= 2 && value.every(v => Number.isFinite(v.per.nok)) && !value.some(v => v.item.id === 'tv'))
  check('no resale things: no resale section', S.resaleSummary(items, SC) === null)
  const rs = S.resaleSummary([
    item({ id: 'f1', for_resale: true, price: 1000, bought_at: at('2026-01-01'), disposal: 'sold', disposed_on: '2026-01-21', sale_price: 1500 }),
    item({ id: 'f2', for_resale: true, price: 2000, bought_at: at('2026-02-01') }),
  ], SC)
  check('resale: bought 2, sold 1, +500, 20 days to sell, 1 still held', rs.bought === 2 && rs.sold === 1 && rs.result.nok === 500 && rs.avgDaysToSell === 20 && rs.holding === 1)
  check('average time kept (months)', near(S.averageKeptMonths(RP), (O.daysBetween('2023-01-10', '2024-03-01') + O.daysBetween('2024-03-02', '2026-05-15')) / 2 / 30.4375))

  // The Stats screen's own helpers.
  check('years with money moving, newest first (quick-list errands never count)', S.statsYears(items, SC).join() === '2026,2024,2023')
  const gaveAway = [item({ id: 'gv', price: 100, bought_at: at('2020-05-01'), disposal: 'given', disposed_on: '2021-01-01' })]
  check('giving a thing away moves no money: its year has no data of its own', S.statsYears(gaveAway, SC).join() === '2020')
  const all = S.periodTotals(items, SC, null)
  const sum = k => ['2023', '2024', '2026'].reduce((s, yy) => s + S.yearTotals(items, SC, yy)[k].nok, 0)
  check('All time = every year added up', all.spent.nok === sum('spent') && all.got.nok === sum('got') && all.net.nok === sum('spent') - sum('got') && all.year === 'all')
  check('…with every id behind it once', all.boughtIds.includes('rp4') && all.boughtIds.includes('tv') && all.soldIds.includes('rp4') && new Set(all.boughtIds).size === all.boughtIds.length)
  check('a picked year is that year\'s totals', S.periodTotals(items, SC, '2026').spent.nok === y.spent.nok)
  const ev = S.moneyEvents(items, SC, '2026-01', '2026-12')
  const evSum = kinds => ev.filter(e => kinds.includes(e.kind)).reduce((s, e) => s + (e.kind === 'refund' ? -e.amount.nok : e.amount.nok), 0)
  check('the year itemised: purchases + costs − refunds = spent, sales = got back', evSum(['bought', 'cost', 'refund']) === y.spent.nok && evSum(['sold']) === y.got.nok)
  check('…the extra cost keeps its label, the refund and the lira purchase are there, oldest first', ev.some(e => e.kind === 'cost' && e.label === 'Cost' && e.id === 'tv') && ev.some(e => e.kind === 'refund' && e.id === 'ret') && ev.find(e => e.id === 'trq').amount.nok === 1200 && ev.every((e, k) => k === 0 || ev[k - 1].day <= e.day))
  const evAll = S.moneyEvents(items, SC, '2023-01', '2026-12')
  const allSpent = evAll.reduce((s, e) => s + (e.kind === 'sold' ? 0 : e.kind === 'refund' ? -e.amount.nok : e.amount.nok), 0)
  check('every month itemised adds up to All time', allSpent === all.spent.nok && !evAll.some(e => e.id === 'milk'))
  check('a pending rate stays pending in its event', S.moneyEvents([item({ id: 'eu', price: 100, currency: 'EUR', fx_nok: null, bought_at: at('2026-02-01') })], SC, '2026-01', '2026-12')[0].amount.pending === 1)
  check('the chart: a year\'s 12 months, or the last 24', JSON.stringify(S.chartMonths('2025', TODAY)) === '{"from":"2025-01","to":"2025-12"}' && JSON.stringify(S.chartMonths(null, TODAY)) === '{"from":"2024-11","to":"2026-10"}' && S.moneyByMonth(items, SC, S.chartMonths(null, '2026-01-15').from, '2026-01').length === 24)
  check('a period\'s months for its drill-down', JSON.stringify(S.periodMonths(['2026', '2023', '2024'], null)) === '{"from":"2023-01","to":"2026-12"}' && S.periodMonths([], null) === null && S.periodMonths([], '2025').to === '2025-12')
  check('months in words', S.monthsLabel(21) === '1 year 9 months' && S.monthsLabel(12) === '1 year' && S.monthsLabel(1) === '1 month' && S.monthsLabel(25.2) === '2 years 1 month' && S.monthsLabel(0.4) === 'under a month')
  const use = S.costOfUseNow(items, SC, TODAY)
  check('cost of use now: only honest numbers count, of every thing still yours (not accessories, not gifts for others)', use.things.map(x => x.id).sort().join() === 'rp6,trq,tv' && use.rows.length === 1 && near(use.nok, O.perMonth(items.find(x => x.id === 'rp6'), SC, TODAY).nok))
  check('why a thing has no number yet', S.costOfUseGap(items.find(x => x.id === 'tv'), SC, TODAY) === 'no_value'
    && S.costOfUseGap(item({ price: 100, bought_at: at('2026-09-20'), value_now: 50 }), SC, TODAY) === 'new'
    && S.costOfUseGap(item({ price: 100, currency: 'EUR', fx_nok: null, bought_at: at('2025-01-01'), value_now: 50 }), SC, TODAY) === 'pending'
    && S.costOfUseGap(item({ price: null, bought_at: at('2025-01-01'), value_now: 50 }), SC, TODAY) === 'missing'
    && S.costOfUseGap(items.find(x => x.id === 'rp6'), SC, TODAY) === null)
  const ends = (k, n) => S.valueEnds(Array.from({ length: k }, (_, i) => i + 1), n)
  check('dearest and cheapest five, never one thing twice', ends(12, 5).dearest.join() === '1,2,3,4,5' && ends(12, 5).cheapest.join() === '12,11,10,9,8' && ends(7, 5).cheapest.join() === '7,6' && ends(3, 5).cheapest.length === 0)
  const kept = S.keptRows(RP)
  check('kept rows: the things that went (not their accessories), and their average is "Kept for"', kept.map(r => r.item.id).join() === 'rp5,rp4' && near(kept.reduce((s, r) => s + r.months, 0) / kept.length, S.averageKeptMonths(RP)))
  const rpChains = C.chainsOf(RP, RP_LINKS, CTX)
  const planOnly = C.chainsOf([item({ id: 'x', price: 500, bought_at: at('2025-01-01') }), item({ id: 'w', status: 'wishlist', price: 900 })], [link('x', 'w')], CTX)
  check('chains with two things you have or had (a plan towards a wish alone is not)', S.chainsWithThings(rpChains).length === 1 && planOnly.length === 1 && S.chainsWithThings(planOnly).length === 0)
  const flips = C.chainsOf([item({ id: 'f1', for_resale: true, price: 100, bought_at: at('2025-01-01'), disposal: 'sold', disposed_on: '2025-02-01', sale_price: 150 }), item({ id: 'f2', for_resale: true, price: 140, bought_at: at('2025-02-02') })], [link('f1', 'f2')], CTX)
  check('a profit is a profit only when the things were bought to sell', !S.boughtToSell(rpChains[0]) && S.boughtToSell(flips[0]))
  const axis = S.timelineAxis('2023-01-10', TODAY)
  check('timeline axis: 1 January of the first year to today, a mark per year', axis.from === '2023-01-01' && axis.to === TODAY && axis.years.map(x => x.year).join() === '2023,2024,2025,2026' && axis.years[0].at === 0 && near(axis.years[1].at, 365 / axis.days, 1e-9))
  const sp = S.timelineSpan(axis, '2023-01-10', '2024-03-01')
  check('a bar from bought to gone; one still yours runs to today', near(sp.left, 9 / axis.days, 1e-9) && near(sp.left + sp.width, O.daysBetween('2023-01-01', '2024-03-01') / axis.days, 1e-9) && near(S.timelineSpan(axis, '2026-05-16', null).width + S.timelineSpan(axis, '2026-05-16', null).left, 1, 1e-9))
  check('…clamped to the axis, never backwards', S.timelineSpan(axis, '2020-01-01', '2023-01-01').left === 0 && S.timelineSpan(axis, '2025-01-01', '2024-01-01').width === 0)
  check('year labels thin out on a narrow axis', S.yearLabelEvery(axis, 20) === 1 && S.yearLabelEvery(axis, 6) === 2 && S.yearLabelEvery(S.timelineAxis('2000-03-01', TODAY), 20) === 5 && S.yearLabelEvery(S.timelineAxis('2000-03-01', TODAY), 8) === 10)
}

console.log('\n13 · Grocery prices by chain')
{
  const prices = new Map([
    ['111', { ean: '111', name: 'Lettmelk', stores: [{ code: 'KIWI', name: 'KIWI', price: 20, checked: '2026-10-07T02:00:00Z' }, { code: 'MENY_NO', name: 'Meny', price: 22, checked: '2026-10-08T02:00:00Z' }, { code: 'SPAR_NO', name: 'SPAR', price: 21, checked: '2026-10-08T02:00:00Z' }] }],
    ['222', { ean: '222', name: 'Brød', stores: [{ code: 'KIWI', name: 'KIWI', price: 30, checked: '2026-10-08T02:00:00Z' }, { code: 'MENY_NO', name: 'Meny', price: 28, checked: '2026-10-08T02:00:00Z' }, { code: 'MENY_NO', name: 'Meny', price: 26, checked: '2026-10-08T02:00:00Z' }] }],
  ])
  const b = G.basketByChain([{ title: 'Milk', ean: '111' }, { title: 'Bread', ean: '222' }, { title: 'Tape', ean: null }], prices)
  check('chain names tidied ("KIWI" → "Kiwi", "SPAR" → "Spar")', G.chainName({ code: 'KIWI', name: 'KIWI' }) === 'Kiwi' && G.chainName({ code: 'SPAR_NO', name: 'SPAR' }) === 'Spar' && G.chainName({ code: 'MENY_NO', name: 'Meny' }) === 'Meny')
  check('full baskets first, then the cheapest (a chain\'s lowest of two listings)', b.rows.map(r => `${r.chain}:${r.total}:${r.covered}`).join() === 'Meny:48:2,Kiwi:50:2,Spar:21:1', JSON.stringify(b.rows))
  check('a chain missing a row names it', b.rows.find(r => r.chain === 'Spar').missing.join() === 'Bread')
  check('rows without a product are counted apart', b.priced === 2 && b.unmatched === 1)
  check('the oldest price date is reported', b.oldest === '2026-10-07')
  check('the cheapest chain for one product', G.cheapestStore(prices.get('111')).name === 'KIWI' && G.cheapestStore(undefined) === null)
  // The quick list's own reading of the basket (QuickListView).
  const lines = G.basketLines(b)
  check('the basket card: full baskets compare, the first is the cheapest, the next says how much more',
    lines.map(l => `${l.chain}:${l.full}:${l.cheapest}:${l.more}`).join() === 'Meny:true:true:null,Kiwi:true:false:2,Spar:false:false:null', JSON.stringify(lines))
  const lone = G.basketLines(G.basketByChain([{ title: 'Milk', ean: '111' }, { title: 'Bread', ean: '222' }], new Map([['111', prices.get('111')], ['222', { ean: '222', name: 'Brød', stores: [{ code: 'KIWI', name: 'KIWI', price: 30, checked: null }] }]])))
  check('…with only one full basket there is no "cheapest" (nothing to compare it with)', lone.every(l => !l.cheapest && l.more === null) && lone[0].chain === 'Kiwi' && lone[0].full)
  check('…nothing priced: no line is full', G.basketLines(G.basketByChain([{ title: 'Tape', ean: null }], prices)).length === 0)
  check('every chain for one product, cheapest first (a chain\'s lowest listing)', G.chainPrices(prices.get('222')).map(c => `${c.chain}:${c.price}`).join() === 'Meny:26,Kiwi:30' && G.chainPrices(undefined).length === 0)
  const hits = [{ ean: '7038010009457', name: 'Lettmelk laktosefri', brand: null, image: null, price: 27.5, store: 'Meny' }, { ean: '0012345678905', name: 'Scanned', brand: null, image: null, price: null, store: null }]
  check('a scan is the hit with that EAN — leading zeros aside (UPC-A ↔ EAN-13)', G.scanMatch(hits, '012345678905').name === 'Scanned' && G.scanMatch(hits, '7038010009457').name === 'Lettmelk laktosefri')
  check('…never a hit that only mentions the digits, and nothing without hits', G.scanMatch(hits, '7038010000737') === null && G.scanMatch(undefined, '123') === null && G.scanMatch(hits, '') === null)
  check('picking a product keeps a row\'s own picture', JSON.stringify(G.matchPatch({ image_url: 'mine' }, { ean: '1', image: 'theirs' })) === '{"ean":"1"}'
    && JSON.stringify(G.matchPatch({ image_url: null }, { ean: '1', image: 'theirs' })) === '{"ean":"1","image_url":"theirs"}' && JSON.stringify(G.matchPatch({}, { ean: '1', image: null })) === '{"ean":"1"}')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
