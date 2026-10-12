#!/usr/bin/env node
/* Verification — building a money chain in one go (src/features/shop/chainDraft.ts):
 * the draft becomes the rows a save writes, the live numbers are chainModel's
 * own on those rows, and they equal what the saved rows give once the
 * database has filled each day's rate. Copy-from-previous, rates (pending,
 * Norges Bank's, typed), accessories, partial link amounts, continuing an
 * existing chain, checks, undo of a removed step and the kept draft.
 * Run: node scripts/verify-shop-chain-draft.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const D = require('../src/features/shop/chainDraft')
const O = require('../src/features/shop/ownModel')
const C = require('../src/features/shop/chainModel')
const M = require('../src/features/shop/shopModel')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps
const TODAY = '2026-10-12'
const NOW = '2026-10-12T10:00:00.000Z'
const rates = { NOK: 10, TRY: 400, EUR: 0.9 } // today's: 1 TRY = 0.025 NOK, 1 EUR = 11.11 NOK
const CTX = O.moneyCtx([], rates)
let seq = 0
const newId = () => `id-${++seq}`
const live = (draft, base = null, dayRates = new Map()) => D.draftRows(draft, base, { mode: 'live', userId: 'u', nowIso: NOW, today: TODAY, newId, rates: dayRates })
const save = (draft, base = null) => D.draftRows(draft, base, { mode: 'save', userId: 'u', nowIso: NOW, today: TODAY, newId })
const chainOf = (draft, base = null, dayRates, existing = { items: [], links: [] }, ctx = CTX) => D.draftChain(draft, live(draft, base, dayRates), existing, ctx)
const node = (chain, key) => chain.nodes.find(n => n.id === key)

/** Steps by hand: the draft a user types (bought → sold → bought → …). */
function rp(overrides = {}) {
  let d = D.newDraft('rp5')
  d.steps[0] = { ...d.steps[0], title: 'RP5', categoryId: 'cat-handheld', platform: 'Elkjøp', price: 2000, boughtOn: '2023-03-01' }
  d = D.addStep(d, 'rp6')
  d.steps[0] = { ...d.steps[0], leftOn: '2024-03-01', got: 1800, soldTo: 'FINN' }
  d.steps[1] = { ...d.steps[1], title: 'RP6', price: 2800, boughtOn: '2024-03-02' }
  d = D.addStep(d, 'deck')
  d.steps[1] = { ...d.steps[1], leftOn: '2025-05-01', got: 2500 }
  d.steps[2] = { ...d.steps[2], title: 'Steam Deck', price: 4000, boughtOn: '2025-05-02' }
  return { ...d, ...overrides }
}

console.log('\n1 · Building: bought → sold → bought → sold → bought')
{
  const d = rp()
  check('+ Add next thing marks the one before as sold and pays the new one with its money', d.steps[0].left && d.steps[0].disposal === 'sold' && d.steps[1].fromPrev && d.steps[2].fromPrev && !d.steps[2].left)
  const rows = live(d)
  check('three things, two "Paid with money from" links', rows.items.length === 3 && rows.links.length === 2
    && rows.links[0].from_id === 'rp5' && rows.links[0].to_id === 'rp6' && rows.links[1].from_id === 'rp6' && rows.links[1].to_id === 'deck')
  check('each is a possession (wishlist, item, bought, kept)', rows.items.every(O.isPossession))
  check('the sale facts on the things that left; the last one is still yours', rows.items[0].disposal === 'sold' && rows.items[0].disposed_on === '2024-03-01'
    && rows.items[0].sale_price === 1800 && rows.items[0].sold_to === 'FINN' && rows.items[2].disposal === null && rows.items[2].sale_price === null)
  check('bought on the typed day (local noon), created in step order', O.boughtOn(rows.items[1]) === '2024-03-02' && rows.items[0].created_at < rows.items[1].created_at)
  const ch = chainOf(d)
  check('one chain of three, linear, nothing projected', ch && ch.nodes.length === 3 && ch.linear && !ch.projected)
  check('chainModel: paid 8 800, got back 4 300, net 4 500', ch.paid.nok === 8800 && ch.got.nok === 4300 && ch.net.nok === 4500 && O.complete(ch.net))
  check('RP5 lost 200, all of it moves on to the RP6 (route cost 3 000)', node(ch, 'rp5').result.nok === 200 && near(node(ch, 'rp5').passedOn, 1) && node(ch, 'rp6').basis.nok === 3000)
  check('the Steam Deck really cost 4 500 (4 000 + 500 lost on the earlier ones)', node(ch, 'deck').basis.nok === 4500 && C.finalCostOf(ch, 'deck').carried.nok === 500)
  const v = D.stepView(ch, 'rp6')
  check('step view: RP6 lost 300 on its own, 1 800 from the sale went in, 1 000 of your own', v.own.nok === -300 && v.fromSales.nok === 1800 && v.ownCash.nok === 1000)
  const out = D.draftOutcome(ch, CTX)
  check('outcome while the last thing is yours: holding, no overall result yet', out.kind === 'holding' && out.result === null && out.held.length === 1 && out.held[0].value === null)
  check('…on the things that left: −500 (paid 4 800, got 4 300)', out.onLeft.nok === -500 && out.leftCount === 2)
  check('…your own money put in: 2 000 + 1 000 + 1 500 = 4 500; nothing left in hand', out.ownMoney.nok === 4500 && out.inHand.nok === 0)
  check('identity: own money − in hand = paid − got back', out.ownMoney.nok - out.inHand.nok === ch.paid.nok - ch.got.nok)
  check('…of which added along the way (on top of the sales): 1 000 + 1 500', out.addedAlong.nok === 2500)
  const valued = rp()
  valued.steps[2] = { ...valued.steps[2], valueNow: 3000 }
  const vo = D.draftOutcome(chainOf(valued), CTX)
  check('a "Could sell for" on the thing still yours: if sold, −1 500 overall (4 300 + 3 000 − 8 800)', vo.kind === 'if-sold' && vo.result.nok === -1500 && vo.held[0].value.nok === 3000)
  check('…dated today, in its own currency', live(valued).items[2].value_on === TODAY && live(valued).items[2].value_currency === 'NOK')
  const done = rp()
  done.steps[2] = { ...done.steps[2], left: true, leftOn: '2026-01-10', got: 3500 }
  const dc = chainOf(done)
  const doneOut = D.draftOutcome(dc, CTX)
  check('everything sold: done, lost 1 000 = −net', doneOut.kind === 'done' && doneOut.result.nok === -1000 && dc.net.nok === 1000)
  const gain = rp()
  gain.steps[2] = { ...gain.steps[2], left: true, leftOn: '2026-01-10', got: 6000 }
  const go = D.draftOutcome(chainOf(gain), CTX)
  check('…a good last sale: gained 1 500 — 4 500 of your own in, the last 6 000 back in hand', go.result.nok === 1500 && go.inHand.nok === 6000 && go.ownMoney.nok === 4500)
}

console.log('\n2 · The live numbers equal the saved rows once the database filled the rates')
{
  // The database (migration 137, shop_items_rules d/e): NOK = 1, a typed rate is kept, else Norges Bank's rate of the day.
  const table = new Map([['TRY|2023-03-01', 0.5], ['TRY|2024-03-01', 0.33], ['EUR|2024-03-02', 11.5], ['EUR|2025-05-01', 11.9]])
  const dbFill = r => {
    const out = { ...r }
    if (out.status !== 'bought' || out.price == null) { out.fx_nok = null; out.fx_source = null }
    else if (out.currency === 'NOK') { out.fx_nok = 1; out.fx_source = 'fixed' }
    else if (out.fx_nok != null) out.fx_source = 'manual'
    else { out.fx_nok = table.get(`${out.currency}|${M.localDay(out.bought_at)}`) ?? null; out.fx_source = out.fx_nok == null ? null : 'norges_bank' }
    if (out.sale_price == null) { out.sale_fx_nok = null; out.sale_fx_source = null }
    else if (out.sale_currency === 'NOK') { out.sale_fx_nok = 1; out.sale_fx_source = 'fixed' }
    else if (out.sale_fx_nok != null) out.sale_fx_source = 'manual'
    else { out.sale_fx_nok = table.get(`${out.sale_currency}|${out.disposed_on}`) ?? null; out.sale_fx_source = out.sale_fx_nok == null ? null : 'norges_bank' }
    return out
  }
  const d = rp()
  d.steps[0] = { ...d.steps[0], currency: 'TRY', price: 4000, got: 3000, gotCurrency: 'TRY' }
  d.steps[1] = { ...d.steps[1], copyPrev: false, currency: 'EUR', price: 250, got: 200, gotCurrency: 'EUR', accessories: [{ key: 'case', title: 'Case', price: 50 }] }
  d.steps[2] = { ...d.steps[2], copyPrev: false, currency: 'NOK', rate: null, valueNow: 3000 }
  const liveChain = chainOf(d, null, table)
  const saved = save(d)
  check('save rows: no rate sent for NOK or Norges Bank days (the database fills them)', saved.items.every(r => r.fx_nok === null && r.sale_fx_nok === null))
  check('save rows: links and sale groups get fresh ids', saved.links.every(l => /^id-\d+$/.test(l.id)) && saved.items.filter(r => r.sale_group).every(r => /^id-\d+$/.test(r.sale_group)))
  const filled = saved.items.map(dbFill)
  const savedChain = C.chainFor('rp5', filled, saved.links, CTX)
  check('same chain: paid, got back and net', savedChain.paid.nok === liveChain.paid.nok && savedChain.got.nok === liveChain.got.nok && savedChain.net.nok === liveChain.net.nok && O.complete(liveChain.net))
  check('same per thing: paid, got, carried, route cost, result', liveChain.nodes.every(n => {
    const s = node(savedChain, n.id)
    return s && near(s.paid.nok, n.paid.nok) && near((s.got?.nok ?? 0), (n.got?.nok ?? 0)) && near(s.carried.nok, n.carried.nok) && near(s.basis.nok, n.basis.nok) && near(s.result?.nok ?? 0, n.result?.nok ?? 0)
  }))
  check('same outcome', JSON.stringify(D.draftOutcome(savedChain, CTX).result) === JSON.stringify(D.draftOutcome(liveChain, CTX).result))
  check('TRY at the day\'s rate: RP5 2 000 NOK paid, 990 NOK back', node(liveChain, 'rp5').paid.nok === 2000 && near(node(liveChain, 'rp5').got.nok, 990))
  check('the accessory rides with the RP6 and was sold with it', node(liveChain, 'rp6').accessories.length === 1 && node(liveChain, 'rp6').paid.nok === 300 * 11.5)
}

console.log('\n3 · Rates: a day\'s rate, never today\'s')
{
  const nok = s => ({ ...s, copyPrev: false, currency: 'NOK' })
  const d = rp()
  d.steps[0] = { ...d.steps[0], currency: 'TRY', price: 4000, gotCurrency: 'EUR', got: 100 }
  d.steps[1] = nok(d.steps[1]); d.steps[2] = nok(d.steps[2])
  check('a currency is never copied live: a later NOK price stays NOK when an earlier step turns TRY', D.resolveSteps({ ...d, steps: [d.steps[0], { ...d.steps[1], copyPrev: true }] }, null)[1].currency === 'NOK')
  {
    let t = D.newDraft('t1')
    t.steps[0] = { ...t.steps[0], currency: 'TRY', gotCurrency: 'EUR' }
    t = D.addStep(t, 't2')
    check('…a new step starts in the currency the money before it came in (the sale\'s)', t.steps[1].currency === 'EUR')
    check('…going on from a saved sale: its currency', D.newDraft('x', 'old', 'TRY').steps[0].currency === 'TRY')
  }
  const pairs = D.ratePairs(d, null)
  check('the pairs the draft needs: TRY on the purchase day, EUR on the sale day (NOK needs none)', pairs.map(p => D.rateKey(p.currency, p.day)).join() === 'EUR|2024-03-01,TRY|2023-03-01')
  const pending = chainOf(d)
  check('without them: rate pending — the chain reads Unknown, today\'s rate never stands in', node(pending, 'rp5').paid.pending === 1 && !O.complete(pending.net))
  check('…and the outcome says so (not a number)', !O.complete(D.draftOutcome(pending, CTX).onLeft))
  const known = chainOf(d, null, new Map([['TRY|2023-03-01', 0.5], ['EUR|2024-03-01', 11]]))
  check('with them: 2 000 NOK paid, 1 100 NOK back', node(known, 'rp5').paid.nok === 2000 && node(known, 'rp5').got.nok === 1100 && O.complete(known.net))
  const typed = rp()
  typed.steps[0] = { ...typed.steps[0], currency: 'TRY', price: 4000, rate: 0.4, gotCurrency: 'NOK' }
  typed.steps[1] = nok(typed.steps[1]); typed.steps[2] = nok(typed.steps[2])
  check('a typed rate wins and is no longer asked for', D.ratePairs(typed, null).length === 0 && node(chainOf(typed), 'rp5').paid.nok === 1600)
  check('…and is sent with the save as typed by hand', save(typed).items[0].fx_nok === 0.4 && save(typed).items[0].fx_source === 'manual')
  check('live rows: NOK is 1 (fixed) as the database stores it', live(rp()).items.every(r => r.fx_nok === 1 && r.fx_source === 'fixed'))
  const gift = rp()
  gift.steps[0] = { ...gift.steps[0], price: null, gift: true, currency: 'TRY' }
  check('a gift with no price costs 0 (no rate needed)', node(chainOf(gift), 'rp5').paid.nok === 0 && O.complete(node(chainOf(gift), 'rp5').paid) && live(gift).items[0].price === 0)
  const unpriced = rp()
  unpriced.steps[1] = { ...unpriced.steps[1], price: null }
  check('a missing price is Unknown, never 0', node(chainOf(unpriced), 'rp6').paid.missing === 1 && !O.complete(chainOf(unpriced).net))
  const noGot = rp()
  noGot.steps[0] = { ...noGot.steps[0], got: null }
  check('sold with no amount: Unknown; given away: 0 back', !O.complete(node(chainOf(noGot), 'rp5').got)
    && (() => { const g = rp(); g.steps[0] = { ...g.steps[0], disposal: 'given', got: 500 }; return node(chainOf(g), 'rp5').got.nok === 0 && live(g).items[0].sale_price === null })())
}

console.log('\n4 · Copy category, subcategory and details from the previous thing')
{
  const d = rp()
  const r = D.resolveSteps(d, null)
  check('a new step copies by default', d.steps[1].copyPrev && d.steps[2].copyPrev && !d.steps[0].copyPrev)
  check('…category, store, country and flags come from the one before', r[1].categoryId === 'cat-handheld' && r[2].platform === 'Elkjøp')
  check('…the title, price and days do not', r[1].title === 'RP6' && r[1].price === 2800 && r[1].boughtOn === '2024-03-02')
  const changed = { ...d, steps: d.steps.map((s, i) => (i === 0 ? { ...s, categoryId: 'cat-console', used: true } : s)) }
  const r2 = D.resolveSteps(changed, null)
  check('live: changing the first one changes the copies after it', r2[1].categoryId === 'cat-console' && r2[2].categoryId === 'cat-console' && r2[2].used)
  const off = D.setCopy(changed, 2, false, null)
  check('turning the copy off keeps what it showed, now its own', !off.steps[2].copyPrev && off.steps[2].categoryId === 'cat-console' && off.steps[2].used && off.steps[2].platform === 'Elkjøp')
  const own = { ...off, steps: off.steps.map((s, i) => (i === 2 ? { ...s, categoryId: 'cat-pc' } : s)) }
  check('…then it is free to differ', D.resolveSteps(own, null)[2].categoryId === 'cat-pc' && D.resolveSteps(own, null)[1].categoryId === 'cat-console')
  const back = D.setCopy(own, 2, true, null)
  check('…and on again it follows the one before', D.resolveSteps(back, null)[2].categoryId === 'cat-console')
  check('the rows carry the copied facts', live(changed).items[2].category_id === 'cat-console' && live(changed).items[2].platform === 'Elkjøp' && live(changed).items[2].used)
}

console.log('\n5 · Accessories go with the thing')
{
  const d = rp()
  d.steps[0] = { ...d.steps[0], price: 1500, accessories: [{ key: 'grip', title: 'Grip', price: 500 }, { key: 'blank', title: '  ', price: 99 }] }
  const rows = live(d)
  const grip = rows.items.find(r => r.id === 'grip')
  check('a nameless accessory is left out', !rows.items.some(r => r.id === 'blank'))
  check('the accessory: same day, currency, category; accessory of the thing', grip.accessory_of === 'rp5' && grip.bought_at === rows.items[0].bought_at && grip.category_id === 'cat-handheld' && O.isPossession(grip))
  check('sold together: one sale group, the 1 800 split by price (1 350 + 450)', grip.sale_group && grip.sale_group === rows.items[0].sale_group && rows.items[0].sale_price === 1350 && grip.sale_price === 450)
  const ch = chainOf(d)
  check('the unit: paid 2 000, got 1 800 — the same chain as without the split', node(ch, 'rp5').paid.nok === 2000 && node(ch, 'rp5').got.nok === 1800 && ch.net.nok === 4500)
  const held = rp()
  held.steps[2] = { ...held.steps[2], accessories: [{ key: 'dock', title: 'Dock', price: 600 }] }
  check('on a thing still yours it rides along, no sale facts', live(held).items.find(r => r.id === 'dock').disposal === null && node(chainOf(held), 'deck').accessories.length === 1)
}

console.log('\n6 · How much of the money went on')
{
  const d = rp()
  d.steps[1] = { ...d.steps[1], fromAmount: 900 }
  const rows = live(d)
  check('the link carries the amount', rows.links[0].amount === 900)
  const ch = chainOf(d)
  check('half the sale went on: half of the RP5\'s loss (100) moves on, 900 into the RP6', near(node(ch, 'rp5').passedOn, 0.5) && near(node(ch, 'rp6').carried.nok, 100) && near(node(ch, 'rp6').cashIn.nok, 900))
  check('…the other 900 is back in hand', near(D.draftOutcome(ch, CTX).inHand.nok, 900))
  const none = rp()
  none.steps[1] = { ...none.steps[1], fromPrev: false }
  check('not paid from it: no link, two chains apart', live(none).links.length === 1 && chainOf(none).nodes.length === 1)
}

console.log('\n7 · Continuing an existing chain')
{
  const old = {
    id: 'rp4', user_id: 'u', category_id: 'cat-old', title: 'RP4 Pro', notes: null, price: 1500, price_source: 'manual', platform: 'AliExpress', url: null, priority: 'medium',
    region: 'TR', planned_date: null, status: 'bought', source_type: 'manual', created_at: '2022-01-01T10:00:00Z', updated_at: '2022-01-01T10:00:00Z',
    list: 'wishlist', currency: 'NOK', bought_at: '2022-01-01T11:00:00Z', task_id: null, kind: 'item', kept: true, fx_nok: 1,
    disposal: 'sold', disposed_on: '2023-02-20', sale_price: 1200, sale_currency: 'NOK', sale_fx_nok: 1, chain_name: 'Handhelds',
  }
  const base = D.copiedOf(old)
  let d = D.newDraft('rp5', 'rp4')
  check('the first step copies the thing it continues and is paid with its money', d.fromId === 'rp4' && d.steps[0].copyPrev && d.steps[0].fromPrev)
  d.steps[0] = { ...d.steps[0], title: 'RP5', price: 2000, boughtOn: '2023-03-01' }
  check('…its category and store', D.resolveSteps(d, base)[0].categoryId === 'cat-old' && D.resolveSteps(d, base)[0].platform === 'AliExpress' && D.resolveSteps(d, base)[0].region === 'TR')
  const rows = live(d, base)
  check('a link from the existing thing; the chain keeps its own name', rows.links.length === 1 && rows.links[0].from_id === 'rp4' && rows.items[0].chain_name === null)
  const ch = D.draftChain(d, rows, { items: [old], links: [] }, CTX)
  check('the chain includes the saved thing: RP4 Pro → RP5, net 2 300', ch.nodes.map(n => n.id).join() === 'rp4,rp5' && ch.net.nok === 2300 && ch.name === 'Handhelds')
  check('the RP4 Pro\'s 300 loss moves on to the RP5', node(ch, 'rp5').carried.nok === 300)
  const named = rp({ name: '  Handheld ladder  ' })
  check('a new chain\'s name sits on its first thing', live(named).items[0].chain_name === 'Handheld ladder' && live(named).items[1].chain_name === null && chainOf(named).name === 'Handheld ladder')
}

console.log('\n8 · Checks before a save')
{
  check('a complete draft has none', D.draftProblems(rp(), TODAY).length === 0)
  const fresh = D.newDraft('a')
  const p = D.draftProblems(fresh, TODAY)
  check('an empty step needs a name and a day', p.some(x => x.field === 'title') && p.some(x => x.field === 'boughtOn') && p.length === 2)
  const bad = rp()
  bad.steps[0] = { ...bad.steps[0], leftOn: '2023-02-01' }
  bad.steps[1] = { ...bad.steps[1], boughtOn: '2027-01-01', fromAmount: 0 }
  bad.steps[2] = { ...bad.steps[2], left: true, leftOn: '' }
  const q = D.draftProblems(bad, TODAY)
  check('leaving before buying, a future day, a 0 amount, a missing leave day', ['leftOn', 'boughtOn', 'fromAmount'].every(f => q.some(x => x.field === f)) && q.filter(x => x.key === 'deck' && x.field === 'leftOn').length === 1)
  check('a missing price is no problem (the chain reads Unknown)', D.draftProblems({ ...rp(), steps: rp().steps.map(s => ({ ...s, price: null })) }, TODAY).length === 0)
}

console.log('\n9 · Remove a step, undo it')
{
  const d = rp()
  const { draft, removed } = D.removeStep(d, 1)
  check('removed: two steps left; the next one is now paid from the first', draft.steps.length === 2 && live(draft).links[0].from_id === 'rp5' && live(draft).links[0].to_id === 'deck')
  const again = D.restoreStep(draft, removed)
  check('undo puts it back where it was', again.steps.map(s => s.key).join() === 'rp5,rp6,deck' && JSON.stringify(again) === JSON.stringify(d))
  check('undo twice changes nothing', D.restoreStep(again, removed).steps.length === 3)
  check('the last step left cannot be removed', D.removeStep(D.newDraft('x'), 0).removed === null)
  check('an untouched draft has no content; a typed one has', !D.hasContent(D.newDraft('x')) && D.hasContent(rp()))
}

console.log('\n10 · The draft kept on this device')
{
  const d = rp({ name: 'Ladder' })
  check('a round trip through JSON is the same draft', JSON.stringify(D.parseDraft(JSON.parse(JSON.stringify(d)))) === JSON.stringify(d))
  check('garbage is null, never a crash', D.parseDraft(null) === null && D.parseDraft('x') === null && D.parseDraft({ steps: [] }) === null && D.parseDraft({ steps: [{ key: '' }] }) === null)
  const odd = D.parseDraft({ steps: [{ key: 'k1', price: 'many', currency: 'GBP', boughtOn: '01.03.2023', disposal: 'exploded', accessories: [{ key: 'a', title: 5 }] }] })
  check('odd fields fall back to their defaults', odd && odd.steps[0].price === null && odd.steps[0].currency === 'NOK' && odd.steps[0].boughtOn === '' && odd.steps[0].disposal === 'sold' && odd.steps[0].accessories[0].title === '')
  check('two steps with one key are refused', D.parseDraft({ steps: [{ key: 'k' }, { key: 'k' }] }) === null)
}

console.log('\n11 · A row carries every column (shop_restore_items reads them all)')
{
  const dir = path.join(__dirname, '..', 'supabase', 'migrations')
  const files = fs.readdirSync(dir).filter(f => /\.sql$/.test(f))
  const cols = new Set()
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8')
    const create = /create table if not exists shop_items \(([\s\S]*?)\n\);/i.exec(sql)
    if (create) for (const m of create[1].matchAll(/^\s+(\w+)\s+\w/gm)) cols.add(m[1])
    for (const block of sql.matchAll(/ALTER TABLE public\.shop_items([\s\S]*?);/gi)) for (const m of block[1].matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/gi)) cols.add(m[1])
  }
  const row = live(rp()).items[0]
  const missing = [...cols].filter(c => !(c in row))
  check(`every shop_items column the migrations add is on the row (${cols.size})`, cols.size >= 55 && missing.length === 0, missing.join(', '))
  const linkKeys = Object.keys(live(rp()).links[0]).sort().join()
  check('a link carries id, user_id, from_id, to_id, amount, created_at', linkKeys === 'amount,created_at,from_id,id,to_id,user_id')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
