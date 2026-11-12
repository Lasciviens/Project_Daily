#!/usr/bin/env node
/* Verification — Owned's compact rows (src/features/shop/ownedRow.ts) and the
 * record's life story (src/features/shop/recordStory.ts): a row's one tone tag,
 * its facts and price column, how many column stacks a list holds; the Story's
 * steps — only from facts the Shop has, each with its own day, never a guessed
 * one — and the nudge line, the most useful next step from Needs a look.
 * Run: node scripts/verify-shop-record.cjs */
require('sucrase/register')
const R = require('../src/features/shop/ownedRow')
const St = require('../src/features/shop/recordStory')
const S = require('../src/features/shop/shopSuggestions')
const O = require('../src/features/shop/ownModel')

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
const atDay = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, 12).toISOString() }
let n = 0
function item(p) {
  n++
  return {
    id: p.id ?? `i${n}`, user_id: 'u', category_id: null, title: p.title ?? `Thing ${n}`, notes: null, price: null, price_source: 'manual',
    platform: null, url: null, priority: 'medium', region: 'NO', planned_date: null, status: 'wishlist', source_type: 'manual',
    created_at: at(-400), updated_at: at(-10), list: 'wishlist', currency: 'NOK', bought_at: null, task_id: null, kind: 'item',
    option_for: null, accessory_of: null, reason: null, wait_for_deal: false, target_price: null, fx_nok: 1, kept: true, disposal: null,
    sale_price: null, sale_currency: null, sale_fx_nok: null, sold_to: null, sale_group: null, return_by: null, warranty_until: null,
    value_now: null, value_currency: null, value_on: null, disposed_on: null, got_as_gift: false, used: false, for_resale: false, approx_dates: false, ...p,
  }
}
const mine = p => item({ status: 'bought', bought_at: at(-20), price: 1000, created_at: at(-20), ...p })
function watch(i, low, p = {}) {
  return { item_id: i.id, user_id: 'u', url: i.url, checked_at: at(0), status: 'ok', error: null, source: 'store', name: null, image: null,
    low, high: null, offers: null, currency: 'NOK', in_stock: true, was: null, return_days: null, last_ok_at: at(0), prev_low: null, prev_at: null,
    condition: 'unknown', used_low: null, refurbished_low: null, ...p }
}
const cost = (i, label, amount, spent_on, id = `c${++n}`) => ({ id, user_id: 'u', item_id: i.id, label, amount, currency: 'NOK', spent_on, fx_nok: 1, fx_source: 'fixed', created_at: at(-1), updated_at: at(-1) })
const ctxOf = (costs = []) => O.moneyCtx(costs, null)

console.log('a row\'s one tag')
{
  const tag = (i, w) => R.rowTag(i, w ?? null, TODAY)
  check('a thing gone wears how it left, neutral', eq(tag(mine({ disposal: 'sold', disposed_on: day(-3) })), { text: 'Sold', tone: 'neutral' }))
  check('given away reads as such', tag(mine({ disposal: 'given', disposed_on: day(-3) })).text === 'Given away')
  check('return today: danger', eq(tag(mine({ return_by: TODAY })), { text: 'Return today', tone: 'danger' }))
  check('return tomorrow: danger', eq(tag(mine({ return_by: day(1) })), { text: 'Return tomorrow', tone: 'danger' }))
  check('return in 3 days: warn', eq(tag(mine({ return_by: day(3) })), { text: 'Return in 3 days', tone: 'warn' }))
  check('return in 10 days: info, counted down', eq(tag(mine({ return_by: day(10) })), { text: 'Return in 10 days', tone: 'info' }))
  check('return past two weeks: its day, neutral', eq(tag(mine({ return_by: '2027-01-15' })), { text: 'Return by 15.01.2027', tone: 'neutral' }))
  check('a passed return window wears no tag', tag(mine({ return_by: day(-1) })) === null)
  const hp = mine({ url: 'https://www.elkjop.no/p/1', price: 3490, return_by: day(5) })
  check('cheaper now while returnable: the money to claim, warn', sp(tag(hp, watch(hp, 3190)).text) === '300 NOK cheaper' && tag(hp, watch(hp, 3190)).tone === 'warn')
  check('… danger when the window closes tomorrow', tag({ ...hp, return_by: day(1) }, watch(hp, 3190)).tone === 'danger')
  check('… never from a mixed Prisjakt figure (may be a used price)', tag(hp, watch(hp, 3190, { source: 'prisjakt', condition: 'mixed' })).text === 'Return in 5 days')
  check('… never from a read before 188 (condition NULL)', tag(hp, watch(hp, 3190, { condition: null })).text === 'Return in 5 days')
  check('… never from a failed check (a kept price)', tag(hp, watch(hp, 3190, { status: 'blocked' })).text === 'Return in 5 days')
  check('… never in another currency', tag(hp, watch(hp, 3190, { currency: 'EUR' })).text === 'Return in 5 days')
  check('… never a price for another link', tag(hp, { ...watch(hp, 3190), url: 'https://www.power.no/p/2' }).text === 'Return in 5 days')
  check('complaint right ending within 60 days: info with its day', eq(tag(mine({ warranty_until: day(40) })), { text: 'Complaint until 20.12.2026', tone: 'info' }))
  check('complaint right ending tomorrow: danger', tag(mine({ warranty_until: day(1) })).tone === 'danger')
  check('a complaint right further out wears no tag (the record says it)', tag(mine({ warranty_until: day(61) })) === null)
  check('a return window comes before the complaint right', tag(mine({ return_by: day(4), warranty_until: day(2) })).text === 'Return in 4 days')
  check('an estimate over six months old: "Old estimate", info', eq(tag(mine({ value_now: 500, value_on: day(-200) })), { text: 'Old estimate', tone: 'info' }))
  // Step C: the open listing's tag, from the listing's facts only.
  const lst = (i, p) => ({ id: `l${++n}`, user_id: 'u', item_id: i.id, marketplace: 'finn.no', ad_url: null, status: 'for_sale', listed_on: day(-13),
    for_sale_on: day(-12), ended_on: null, currency: 'NOK', prices: [{ on: day(-13), price: 2400 }], ad_text: null, closed_by_sale: false,
    created_at: at(-13), updated_at: at(-13), ...p })
  const forSale = mine({ value_now: 500, value_on: day(-200) })
  check('for sale 12 days: "For sale · 12 days", info — before an old estimate', eq(R.rowTag(forSale, null, TODAY, lst(forSale)), { text: 'For sale · 12 days', tone: 'info' }))
  check('… "For sale · today" on the day it went up', R.rowTag(forSale, null, TODAY, lst(forSale, { for_sale_on: TODAY, listed_on: TODAY })).text === 'For sale · today')
  check('the ad written, not up: "Listed", neutral', eq(R.rowTag(forSale, null, TODAY, lst(forSale, { status: 'listed', for_sale_on: null })), { text: 'Listed', tone: 'neutral' }))
  check('a listing taken down wears no listing tag', R.rowTag(forSale, null, TODAY, lst(forSale, { status: 'withdrawn', ended_on: day(-1) })).text === 'Old estimate')
  check('another thing\'s listing is never this row\'s tag', R.rowTag(forSale, null, TODAY, lst(mine({}))).text === 'Old estimate')
  check('a return window still comes first', R.rowTag(mine({ return_by: day(3) }), null, TODAY, lst(forSale)).text !== 'For sale · 12 days')
  const ret = mine({ return_by: day(3) })
  check('… (its own listing too)', R.rowTag(ret, null, TODAY, lst(ret)).text === 'Return in 3 days')
  check('a fresh estimate wears none', tag(mine({ value_now: 500, value_on: day(-20) })) === null)
  check('nothing due: no tag', tag(mine({})) === null)
}

console.log('a row\'s facts and price')
{
  const facts = (i, acc = [], costs = [], chain = null) => R.rowFacts(i, acc, ctxOf(costs), TODAY, chain).map(f => sp(f.text) + (f.tone ? `(${f.tone})` : ''))
  check('held words: days, then months up to two years, then years with a half', R.heldWords(day(-12), TODAY) === '12 days'
    && R.heldWords('2025-05-10', TODAY) === '18 months' && R.heldWords('2023-11-10', TODAY) === '3 years' && R.heldWords('2024-05-01', TODAY) === '2½ years')
  check('held words: today, one day, one month', R.heldWords(TODAY, TODAY) === 'today' && R.heldWords(day(-1), TODAY) === '1 day' && R.heldWords(day(-31), TODAY) === '1 month')
  const sony = mine({ title: 'Sony WH-1000XM5', platform: 'Elkjøp', bought_at: atDay('2025-05-10'), price: 3490, value_now: 2400, value_currency: 'NOK', value_on: day(-10) })
  check('still yours: store · held · sells ≈ (the owner\'s own example)', eq(facts(sony), ['Elkjøp', '18 months', 'sells ≈ 2 400']), JSON.stringify(facts(sony)))
  check('no "Could sell for": none invented', eq(facts(mine({ platform: 'XXL' })), ['XXL', '20 days']))
  check('bought to sell and its money chain', eq(facts(mine({ for_resale: true }), [], [], 'Tablet chain'), ['20 days', 'to sell', 'Tablet chain']))
  check('a "Could sell for" in another currency with no rate today: left out, never at a guessed rate', eq(facts(mine({ value_now: 900, value_currency: 'TRY', value_on: day(-5) })), ['20 days']))
  const sold = mine({ bought_at: atDay('2024-04-02'), price: 3999, disposal: 'sold', disposed_on: '2026-01-15', sale_price: 1500, sold_to: 'FINN' })
  check('gone: the result first (a phone cuts the end), then got · to whom · held', eq(facts(sold), ['cost you 2 499', 'got 1 500', 'to FINN', 'after 21 months']), JSON.stringify(facts(sold)))
  const flip = mine({ price: 2200, disposal: 'sold', disposed_on: day(-5), sale_price: 2900, sold_to: 'FINN' })
  check('a profit is green', eq(facts(flip), ['made 700(success)', 'got 2 900', 'to FINN', 'after 15 days']), JSON.stringify(facts(flip)))
  check('a sale with no amount: no "got", no result', eq(facts(mine({ disposal: 'sold', disposed_on: day(-5), sold_to: 'A friend' })), ['to A friend', 'after 15 days']))
  check('given away: what it cost you', eq(facts(mine({ disposal: 'given', disposed_on: day(-5) })), ['cost you 1 000', 'after 15 days']))
  const phone = mine({ price: 4000, disposal: 'sold', disposed_on: day(-5), sale_price: 2000, sale_group: 'g1' })
  const cas = mine({ price: 400, accessory_of: phone.id, disposal: 'sold', disposed_on: day(-5), sale_price: 200, sale_group: 'g1' })
  check('accessories sold with it count in what came back and what it cost', eq(facts(phone, [cas]), ['cost you 2 200', 'got 2 200', 'after 15 days']), JSON.stringify(facts(phone, [cas])))
  check('extra costs count in the result', eq(facts(mine({ price: 1000, disposal: 'given', disposed_on: day(-5), id: 'x1' }), [], [cost({ id: 'x1' }, 'Repair', 300, day(-10))]), ['cost you 1 300', 'after 15 days']))
  const price = i => R.rowPrice(i)
  check('price column: what was paid in NOK — the record\'s Paid; extra costs stay in its Costs (review, 10.11.2026)', sp(price(mine({ id: 'p1', price: 13990 })).text) === '13 990')
  check('a gift', eq(price(mine({ price: 0, got_as_gift: true })), { text: 'Gift', pending: false }))
  check('no price: a dash', eq(price(mine({ price: null })), { text: '—', pending: false }))
  check('a price waiting for its rate: in its own currency, pending', (() => { const p = price(mine({ price: 4500, currency: 'TRY', region: 'TR', fx_nok: null })); return p.pending && sp(p.text) === '4 500 TRY' })())
  check('a foreign price at its day\'s rate: NOK', sp(price(mine({ price: 4500, currency: 'TRY', region: 'TR', fx_nok: 0.3 })).text) === '1 350')
}

console.log('column stacks of rows')
check('a phone (23rem): one stack', R.rowStacks(23.1) === 1)
check('before it is measured: one', R.rowStacks(null) === 1)
check('1469 main (48rem) and a phone sideways (52rem): two', R.rowStacks(48.3) === 2 && R.rowStacks(52.6) === 2)
check('1920 (75rem): three; 2450 (106rem): four', R.rowStacks(75.5) === 3 && R.rowStacks(106) === 4)
check('a stack is never narrower than 21rem', [23, 43, 44, 48, 66, 75, 90, 106, 131].every(w => {
  const k = R.rowStacks(w)
  return (w - (k - 1) * R.ROW_GAP_REM) / k >= R.ROW_MIN_REM
}))

console.log('the Story')
{
  const story = (i, more = {}) => St.storyOf(i, { items: more.items ?? [i], links: more.links ?? [], costs: more.costs ?? [], today: TODAY })
  const kinds = s => s.map(x => x.kind)
  const wish = item({ title: 'Headphones', created_at: at(-30), planned_date: day(10) })
  check('a wish: on the wishlist since its day, the plan ahead', eq(kinds(story(wish)), ['wished', 'planned']) && story(wish)[1].ahead && story(wish)[0].day === day(-30))
  check('… waiting for a deal says so', story({ ...wish, wait_for_deal: true })[1].title === 'Waiting for a deal from')
  const bought = mine({ title: 'Headphones', created_at: at(-30), bought_at: at(-5), platform: 'Elkjøp', price: 3490 })
  check('a wish that was bought: wished, then bought where and for what', eq(kinds(story(bought)), ['wished', 'bought'])
    && story(bought)[1].title === 'Bought at Elkjøp' && sp(story(bought)[1].detail) === '3 490 NOK')
  const added = mine({ created_at: at(-5), bought_at: at(-200) })
  check('a thing added as owned (made after it was bought) was never a wish: no wished step', eq(kinds(story(added)), ['bought']))
  check('… nor one made the day it was bought', eq(kinds(story(mine({ created_at: at(-5), bought_at: at(-5) }))), ['bought']))
  check('no purchase day (bought_at NULL): no bought step, never the last edit', eq(kinds(story(mine({ bought_at: null, created_at: at(-50) }))), []))
  check('a gift', story(mine({ price: 0, got_as_gift: true, created_at: at(-20) }))[0].title === 'Got it as a gift')
  check('a day added from memory is marked ≈', story(mine({ approx_dates: true, created_at: at(-5), bought_at: at(-300) }))[0].approx)
  check('used, and the money it was paid with', (() => {
    const old = mine({ id: 'old', title: 'Galaxy Tab', disposal: 'sold', disposed_on: day(-21) })
    const ipad = mine({ id: 'ipad', title: 'iPad Air', used: true, price: 2500, created_at: at(-20) })
    const s = story(ipad, { items: [old, ipad], links: [{ id: 'l', user_id: 'u', from_id: 'old', to_id: 'ipad', amount: null, created_at: at(-20) }] })
    return sp(s[0].detail) === '2 500 NOK · used · paid with money from Galaxy Tab'
  })())
  const phone = mine({ id: 'ph', title: 'iPhone', created_at: at(-400), bought_at: at(-400), price: 13990, value_now: 7500, value_currency: 'NOK', value_on: day(-20), warranty_until: '2029-10-04', return_by: day(4) })
  const cas = mine({ id: 'case', title: 'Phone case', accessory_of: 'ph', bought_at: at(-380), price: 399 })
  const wishedCase = item({ id: 'case2', title: 'Screen protector', accessory_of: 'ph' })
  const s = story(phone, { items: [phone, cas, wishedCase], costs: [cost(phone, 'AppleCare+', 1790, day(-399)), cost(phone, 'Rebate', -500, day(-300))] })
  check('yours: bought, the accessories bought for it (not a wished one), each cost and rebate, the estimate, the deadlines ahead, in day order',
    eq(kinds(s), ['bought', 'cost', 'accessory', 'cost', 'value', 'return', 'complaint']), JSON.stringify(kinds(s)))
  check('… a rebate reads as money back', sp(s.find(x => x.title === 'Rebate').detail) === '500 NOK back')
  check('… the estimate says it is yours', sp(s.find(x => x.kind === 'value').title) === 'Could sell for 7 500 NOK' && s.find(x => x.kind === 'value').detail === 'your estimate')
  check('… the deadlines are ahead', s.filter(x => x.ahead).map(x => x.kind).join() === 'return,complaint')
  check('a passed complaint right is told as ended; a passed return window is left out', eq(story(mine({ warranty_until: day(-35), return_by: day(-786), created_at: at(-800), bought_at: at(-800) })).map(x => x.title), ['Bought', 'Complaint right ended']))
  const gone = mine({ id: 'g', title: 'Running watch', created_at: at(-600), bought_at: at(-600), price: 3999, disposal: 'sold', disposed_on: day(-30), sale_price: 1500, sold_to: 'FINN', warranty_until: day(100), value_now: 900, value_on: day(-60) })
  const next = mine({ id: 'n', title: 'New watch' })
  const gs = story(gone, { items: [gone, next], links: [{ id: 'l2', user_id: 'u', from_id: 'g', to_id: 'n', amount: null, created_at: at(-1) }] })
  check('gone: how it left, to whom, what came back and where its money went; no deadlines, no estimate after it left',
    eq(kinds(gs), ['bought', 'gone']) && gs[1].title === 'Sold to FINN' && sp(gs[1].detail) === 'got 1 500 NOK · its money went to New watch', JSON.stringify(gs))
  const together = mine({ id: 'acc', accessory_of: 'g', sale_group: 'sg', disposal: 'sold', disposed_on: day(-30) })
  check('… with the accessories sold with it', sp(story({ ...gone, sale_group: 'sg' }, { items: [gone, together] }).find(x => x.kind === 'gone').detail).includes('with 1 accessory'))
  const jacket = item({ id: 'j', title: 'Winter jacket', kind: 'general', status: 'fulfilled', created_at: at(-90) })
  const parka = mine({ id: 'pk', title: 'Parka', option_for: 'j', platform: 'XXL', price: 2799, created_at: at(-80), bought_at: at(-10) })
  check('a fulfilled general wish tells the model bought', eq(story(jacket, { items: [jacket, parka] }).map(x => x.title), ['Bought Parka']))
  check('… and the model was a model for it before', eq(story(parka, { items: [jacket, parka] }).map(x => x.title), ['A model for Winter jacket', 'Bought at XXL']))
  check('every step has a day', [...s, ...gs].every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.day)))
}

console.log('the nudge line')
{
  const phone = mine({ id: 'ph', title: 'iPhone', price: 13990, return_by: day(2), value_now: 7000, value_on: day(-10) })
  const sofa = mine({ id: 'sofa', title: 'Sofa', bought_at: null })
  const vac = mine({ id: 'vac', title: 'Vacuum', value_now: null })
  const looks = S.needsALook([phone, sofa, vac], { watches: new Map() }, TODAY)
  check('its own Needs-a-look row, the most urgent first', St.nudgeFor(phone, looks, TODAY).kind === 'return_closing' && St.nudgeFor(phone, looks, TODAY).tone === 'warn')
  check('… snoozed or put away: none (only the rows still shown are passed)', St.nudgeFor(phone, looks.filter(l => l.itemId !== 'ph'), TODAY) === null)
  check('the tidy-up row\'s words for it, with the purchase day to add', (() => { const x = St.nudgeFor(sofa, looks, TODAY); return x.kind === 'tidy_up' && x.action === 'day' && x.facts.includes('no purchase day') })())
  check('still yours with no "Could sell for": the fact that gives its cost per month', St.nudgeFor(vac, looks, TODAY).action === 'value')
  check('an accessory, a thing gone or a wish with nothing due: no nudge', St.nudgeFor(mine({ accessory_of: 'ph' }), [], TODAY) === null
    && St.nudgeFor(mine({ disposal: 'sold', disposed_on: day(-2) }), [], TODAY) === null && St.nudgeFor(item({}), [], TODAY) === null)
  const old = mine({ id: 'old', title: 'Tablet', value_now: 2000, value_on: day(-200) })
  const oldNudge = St.nudgeFor(old, S.needsALook([old], { watches: new Map() }, TODAY), TODAY)
  check('an old estimate says only how old it is: the strip above shows its amount and day', oldNudge.kind === 'old_value' && oldNudge.action === 'value'
    && oldNudge.facts.length === 1 && /is 6 months old$/.test(oldNudge.facts[0]) && !/2 000|\d{2}\.\d{2}\.\d{4}/.test(oldNudge.facts.join(' ')), JSON.stringify(oldNudge.facts))
  const hp = item({ id: 'hp', title: 'Headphones', url: 'https://www.elkjop.no/p/1', target_price: 2990 })
  const wl = S.needsALook([hp], { watches: new Map([['hp', watch(hp, 2990)]]) }, TODAY)
  check('a wish at its target: Bought, with where it was read', St.nudgeFor(hp, wl, TODAY).action === 'bought' && /elkjop\.no/.test(St.nudgeFor(hp, wl, TODAY).where))
}

console.log('the record\'s draft: "+ New category…" (made on Save, as the add sheet does)')
{
  const D = require('../src/features/shop/components/record/useRecordDraft')
  const NEW = D.NEW_CATEGORY
  const top = D.newCategoryId({ topId: NEW, subId: '' })
  const sub = D.newCategoryId({ topId: 'c1', subId: NEW })
  check('a pick without "+ New" is no new category', D.newCategoryId({ topId: 'c1', subId: 'c2' }) === null && !D.isNewCategory('c1') && !D.isNewCategory(null))
  check('a new top and a new subcategory under one of yours go there and back', D.isNewCategory(top) && eq(D.newPickOf(top), { topId: NEW, subId: '' }) && eq(D.newPickOf(sub), { topId: 'c1', subId: NEW }))
  check('Save waits for a new category\'s name', D.newCategoryMissing({ category_id: top }) === 'top' && D.newCategoryMissing({ category_id: top, new_top: '  ' }) === 'top'
    && D.newCategoryMissing({ category_id: sub }) === 'sub' && D.newCategoryMissing({ category_id: top, new_top: 'Garden' }) === null
    && D.newCategoryMissing({ category_id: 'c1' }) === null)
  const row = item({ category_id: 'c1' })
  const p = D.patchOf(row, { category_id: top, new_top: 'Garden', new_sub: 'Tools', bought_day: undefined })
  check('the typed names are never sent as columns', eq(Object.keys(p), ['category_id']) && p.category_id === top, JSON.stringify(p))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
