#!/usr/bin/env node
/*
 * Verification — Shop's "Read several receipts" (src/features/shop/receiptBatch.ts, receiptChain.ts, createDraft.ts),
 * against the REAL modules via sucrase: the browser's check of a pick, the same receipt twice, the merged lines, the
 * worst-case cost (equal to the function's own `worstCostOf` for a photo and a PDF), when the queue stops, the money
 * chain's suggestion (window, tie → none, many targets), which write makes each link, and the required fields of a sold
 * line that matches none of your things. Made-up receipts only.
 *
 * Run: node scripts/verify-shop-receipt-batch.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const sucrase = require('sucrase')
const SDK = require('@anthropic-ai/sdk')
const B = require('../src/features/shop/receiptBatch')
const C = require('../src/features/shop/receiptChain')
const D = require('../src/features/shop/components/record/createDraft')
const R = require('../src/features/shop/receiptRead')

let ok = 0, bad = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : `— ${JSON.stringify(detail)}`.slice(0, 500)) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const near = (a, b) => Math.abs(a - b) < 1e-6

// ── the function, loaded the way verify-claude-function loads it ─────────────
const SDK_NAMES = ['Anthropic', 'APIConnectionError', 'APIConnectionTimeoutError', 'APIError', 'AuthenticationError', 'BadRequestError',
  'ContentTooLargeError', 'InternalServerError', 'NotFoundError', 'OverloadedError', 'PermissionDeniedError', 'RateLimitError', 'UnprocessableEntityError']
const built = sucrase.transform(
  fs.readFileSync(path.join(__dirname, '../supabase/functions/claude/index.ts'), 'utf8')
    .replace(/^import .*npm:@anthropic-ai\/sdk@.*$/m, '').replace(/^import .*npm:@supabase\/supabase-js@.*$/m, ''),
  { transforms: ['typescript'] },
).code
class NotFound extends Error {}
const Deno = { env: { get: () => undefined }, serve: () => {}, resolveDns: async () => [], errors: { NotFound } }
const F = new Function('Deno', 'createClient', 'fetch', 'Date', 'console', ...SDK_NAMES,
  `${built}\nreturn { RECEIPT_READ_JOB, worstCostOf, pdfTokensHeld, MODEL_PRICES, describeFunction }`)(Deno, () => ({}), async () => { throw new Error('no network') }, Date, console, ...SDK_NAMES.map(n => SDK[n]))
const JOB = F.RECEIPT_READ_JOB

console.log('\nthe pick')
const f = (name, type, size) => ({ name, type, size })
const pick = B.checkPicked([f('a.jpg', 'image/jpeg', 300_000), f('b.pdf', 'application/pdf', 400_000), f('big.pdf', 'application/pdf', 1_000_001), f('c.txt', 'text/plain', 10), f('d', '', 5), f('x.PDF', '', 900_000), f('e.png', 'image/png', 0), f('g.jpg', 'image/jpeg', 1), f('h.jpg', 'image/jpeg', 1)])
check('a photo and a PDF are taken; a PDF over 1 MB, a text file and a file with no type or name are refused', same(pick.accepted.map(x => x.name), ['a.jpg', 'b.pdf']) && pick.refused.length === 3, pick)
check('an empty file is refused; a ".PDF" with no type is taken', B.checkPicked([f('e.png', 'image/png', 0), f('x.PDF', '', 900_000)]).refused[0].why === 'That file is empty' && B.checkPicked([f('x.PDF', '', 900_000)]).accepted.length === 1)
check('at most 5 files are looked at in one pick; the rest are counted, never read', pick.accepted.length + pick.refused.length === 5 && pick.cut === 4, pick)
check('refusals: too large, wrong type, empty', same(pick.refused.map(r => r.why), ['That PDF is too large (at most 1 MB)', 'Pick a photo or a PDF', 'Pick a photo or a PDF']), pick.refused)
check('a file named .pdf with no type is a PDF (the same rule as the single pick)', B.isPdf(f('x.PDF', '', 1)) && !B.isPdf(f('x.jpg', '', 1)))
check('a shown name is one line, no path, no control, zero-width or direction character', B.shownName('C:\\scans\\re\u202Ece\u200Bipt\n1.pdf') === 'receipt1.pdf', B.shownName('C:\\scans\\re\u202Ece\u200Bipt\n1.pdf'))
check('a name of 100 characters is cut to 60 with …, an empty one reads "receipt"', [...B.shownName('n'.repeat(100))].length === 60 && B.shownName('  ') === 'receipt')

console.log('\nthe same receipt twice')
const read = (over = {}) => ({ kind: 'bought', store: 'Elkjøp Norge', date: '2026-11-10', currency: 'NOK', total: 5990, items: [{ name: 'PHONE X1 128GB', price: 5990 }], ...over })
check('same store (folded), day and total is the same receipt', B.sameReceipt(read(), read({ store: 'ELKJOP norge', total: 5990.001 })))
check('another day, total or store is not', !B.sameReceipt(read(), read({ date: '2026-11-11' })) && !B.sameReceipt(read(), read({ total: 5991 })) && !B.sameReceipt(read(), read({ store: 'Power' })))
check('a receipt with no printed store, day or total is never called the same', !B.sameReceipt(read({ store: undefined }), read({ store: undefined })) && !B.sameReceipt(read({ date: undefined }), read({ date: undefined })) && !B.sameReceipt(read({ total: undefined }), read({ total: undefined })))
check('the second one points at the first ("Looks like file 1"); a failed file is -1', same(B.duplicatesOf([read(), null, read(), read({ total: 1 })]), [-1, -1, 0, -1]))
const files = [{ id: 0, read: read(), duplicateOf: -1 }, { id: 1, read: null, duplicateOf: -1 }, { id: 2, read: read({ items: [{ name: 'CASE', price: 199 }, { name: 'CABLE', price: 99 }] }), duplicateOf: 0 }]
const merged = B.mergedLines(files)
check('lines of every read file in file order, keyed by file and place; a failed file adds none; a repeat is marked', same(merged.map(m => [m.key, m.duplicate]), [['0:0', false], ['2:0', true], ['2:1', true]]), merged.map(m => m.key))
check('a line\'s side starts from its file\'s kind; unknown is Bought', B.sidePreset(read({ kind: 'sold' })) === 'sold' && B.sidePreset(read({ kind: 'unknown' })) === 'bought' && B.sidePreset(read({ kind: undefined })) === 'bought')

console.log('\nthe worst-case cost')
const prices = { webSearchUsdEach: 0.01, longPromptOverTokens: 200_000, longPromptMultiplier: 5, model: { cacheWrite1hPerMTok: 0.2, outputPerMTok: 0.5 } }
const job = { instructionsChars: JOB.instructions.length, maxOutputTokens: JOB.defaults.maxOutputTokens }
const haiku = F.MODEL_PRICES.find(p => p.model === JOB.defaults.model)
const real = { webSearchUsdEach: 0.01, longPromptOverTokens: 100_000, longPromptMultiplier: 5, model: haiku }
const described = F.describeFunction ? null : null
void described
// What the function reserves for a photo: the largest the browser sends (1280 × 1280 → 46 × 46 tokens) and for a PDF at its most.
const catPaths = ['Electronics', 'Electronics / Phones', 'Home & garden']
const cat = B.categoriesChars(catPaths)
const catText = `\n<categories>\n${catPaths.map((p, i) => `${i + 1} | ${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`).join('\n')}\n</categories>`
check('the category list\'s characters are what the function puts in the prompt (the wrapper, rows and escaped characters)', cat + '\n<categories>\n'.length + '\n</categories>'.length === catText.length, [cat, catText.length])
for (const [kind, text, tokens] of [['photo', 'Read the photo.', 46 * 46], ['pdf', 'Read the PDF.', F.pdfTokensHeld(32_000)]]) {
  for (const withCats of [false, true]) {
    const want = F.worstCostOf(JOB.defaults.model, JOB.instructions.length + text.length + (withCats ? catText.length : 0), JOB.defaults.maxOutputTokens, 'live', { imageTokens: tokens, webSearches: 2 })
    const got = B.receiptWorstCost(real, job, kind, withCats ? cat : 0)
    check(`${kind}${withCats ? ' with the owner\'s categories' : ''}: equal to the function's own worstCostOf (${want})`, near(got, want), { want, got })
  }
}
check('the other models are never lower than the function\'s reservation (it applies the long-prompt price to one model only)', ['claude-sonnet-5-5', 'claude-opus-5-5'].every(model => {
  const p = F.MODEL_PRICES.find(x => x.model === model)
  return ['photo', 'pdf'].every(kind => B.receiptWorstCost({ ...real, model: p }, job, kind) + 1e-9 >= F.worstCostOf(model, JOB.instructions.length + 15, JOB.defaults.maxOutputTokens, 'live', { imageTokens: kind === 'photo' ? 46 * 46 : F.pdfTokensHeld(32_000), webSearches: 2 }))
}))
check('a PDF can cost more than a photo, and a queue is the sum of its files', B.receiptWorstCost(real, job, 'pdf') > B.receiptWorstCost(real, job, 'photo') && near(B.queueWorstCost(real, job, ['photo', 'pdf', 'photo']), 2 * B.receiptWorstCost(real, job, 'photo') + B.receiptWorstCost(real, job, 'pdf')))
check('the formula: 3 rounds of the prompt, 75,000 result tokens, the answer limit and 2 searches', (() => {
  const prompt = 1000 + 15 + 1000 + 46 * 46
  const exp = Math.round(((3 * prompt + 75_000) * 0.2 + 2500 * 0.5) / 1e6 * 1e6) / 1e6 + 0.02
  return near(B.receiptWorstCost(prices, { instructionsChars: 1000, maxOutputTokens: 2500 }, 'photo'), exp)
})())
check('the limits are the function\'s: 2 searches, 5 files, 1 MB PDF', B.RECEIPT_SEARCHES === 2 && B.RECEIPT_FILES_MAX === 5)

console.log('\nwhen the queue stops')
check('a switch off, the budget out and "not set up" stop it; busy waits; the provider\'s billing sentence stops it; anything else is that file\'s own', B.haltFor('off', 'x') === 'stop' && B.haltFor('budget', 'x') === 'stop' && B.haltFor('not_configured', 'x') === 'stop' && B.haltFor('busy', 'x') === 'busy'
  && B.haltFor('error', "Anthropic stopped the request for a billing reason: the account's spend limit") === 'stop' && B.haltFor('invalid', 'x') === 'failed' && B.haltFor(undefined, 'That PDF is too large') === 'failed')
check('two failures in a row end it', B.FAILS_IN_A_ROW === 2)

console.log('\nthe money chain')
const ln = (key, file, day, top, text, amount = null, extra = {}) => ({ key, file, day, topCategory: top, text, amount, currency: amount == null ? null : 'NOK', ...extra })
const oldPhone = ln('s1', 0, '2026-11-10', 'el', 'Phone Z9 64GB', 3000, { brand: 'Acme' })
const newPhone = ln('b1', 1, '2026-11-12', 'el', 'Phone X1 128GB', 6000, { brand: 'Acme' })
const phoneCase = ln('b2', 1, '2026-11-12', 'el', 'Case for X1', 199)
const garden = ln('b3', 1, '2026-11-12', 'home', 'Garden hose', 300)
let sug = C.suggestChainPairs([oldPhone], [newPhone, phoneCase, garden])
check('the old phone is suggested to the new phone: same category, brand and window beat the case and the hose', sug.get('s1') === 'b1', [...sug])
check('the amount never decides alone: with a clear score winner a closer amount does not change it', C.suggestChainPairs([ln('s', 0, '2026-11-10', 'el', 'Old Z9', 199, { brand: 'Acme' })], [newPhone, phoneCase]).get('s') === 'b1')
sug = C.suggestChainPairs([ln('s', 0, '2026-11-10', 'el', 'Old tablet', 3000)], [ln('b1', 1, '2026-11-12', 'el', 'Tablet', 3100), ln('b2', 1, '2026-11-12', 'el', 'Laptop', 9000)])
check('a tie on score is broken by the amount, only when both are printed in one currency', sug.get('s') === 'b1', [...sug])
sug = C.suggestChainPairs([ln('s', 0, '2026-11-10', 'el', 'Old tablet')], [ln('b1', 1, '2026-11-12', 'el', 'Tablet', 3100), ln('b2', 1, '2026-11-12', 'el', 'Laptop', 9000)])
check('a tie with no amount to separate it is no suggestion', sug.get('s') === null)
sug = C.suggestChainPairs([ln('s', 0, '2026-11-10', 'el', 'Old tablet', 3000)], [ln('b1', 1, '2026-11-12', 'el', 'Tablet', 3000), ln('b2', 1, '2026-11-12', 'el', 'Laptop', 3000)])
check('a tie that the amount does not separate is no suggestion', sug.get('s') === null)
check('the window: a sale 30 days before the purchase counts, 31 does not; 60 days after counts, 61 does not', C.pairScore(ln('s', 0, '2026-10-13', 'el', 'a'), ln('b', 1, '2026-11-12', 'el', 'b')) !== null && C.pairScore(ln('s', 0, '2026-10-12', 'el', 'a'), ln('b', 1, '2026-11-12', 'el', 'b')) === null
  && C.pairScore(ln('s', 0, '2027-01-11', 'el', 'a'), ln('b', 1, '2026-11-12', 'el', 'b')) !== null && C.pairScore(ln('s', 0, '2027-01-12', 'el', 'a'), ln('b', 1, '2026-11-12', 'el', 'b')) === null)
check('same file and same day scores highest', C.pairScore(ln('s', 0, '2026-11-12', null, 'a'), ln('b', 0, '2026-11-12', null, 'b')) > C.pairScore(ln('s', 0, '2026-11-12', null, 'a'), ln('b', 1, '2026-11-12', null, 'b')) && C.pairScore(ln('s', 0, '2026-11-12', 'el', 'a'), ln('b', 0, '2026-11-12', 'el', 'b')) > C.pairScore(ln('s', 0, '2026-11-12', 'el', 'a'), ln('b', 1, '2026-11-12', 'el', 'b')))
check('a missing day passes only inside one file', C.pairScore(ln('s', 0, null, 'el', 'a'), ln('b', 1, '2026-11-12', 'el', 'b')) === null && C.pairScore(ln('s', 0, null, 'el', 'a'), ln('b', 0, '2026-11-12', 'el', 'b')) !== null)
check('nothing in common (other category, no shared word, other file) is no suggestion', C.suggestChainPairs([ln('s', 0, '2026-11-10', 'home', 'Lamp')], [ln('b', 1, '2026-11-12', 'el', 'Phone X1')]).get('s') === null)
check('a shared model-like word ("x1") counts, a shared plain word ("phone") does not', C.pairScore(ln('s', 0, '2026-11-10', null, 'Case X1'), ln('b', 1, '2026-11-12', null, 'Phone X1')) === 3 && C.pairScore(ln('s', 0, '2026-11-10', null, 'Old phone'), ln('b', 1, '2026-11-12', null, 'New phone')) === 1)

console.log('\nwhich write makes each link')
const ticks = new Map([['s1', new Set(['b2', 'b1'])], ['s2', new Set(['b3'])], ['s3', new Set(['b1'])], ['s4', new Set()]])
const plan = C.chainPlan(ticks, ['b1', 'b2', 'b3'], new Set(['s3']))
check('a sold line\'s first ticked target (in screen order) is linked by its own write (the sale, or the saved "I had it" thing)', plan.first.get('s1') === 'b1' && plan.first.get('s2') === 'b3' && !plan.first.has('s4'), [...plan.first])
check('the others are one link each; a sold line with no tick makes none', same(plan.extras, [{ soldKey: 's1', boughtKey: 'b2' }]), plan.extras)
check('a thing already sold in the app is linked by the bought thing\'s own "Paid with money from"; a second source for the same thing is a link', plan.paidFrom.get('b1') === 's3' && plan.paidFrom.size === 1 && !plan.first.has('s3'))
const plan2 = C.chainPlan(new Map([['sa', new Set(['b1'])], ['sb', new Set(['b1'])]]), ['b1'], new Set(['sa', 'sb']))
check('two already-sold sources for one bought line: the first is paid-from, the second an extra link', plan2.paidFrom.get('b1') === 'sa' && same(plan2.extras, [{ soldKey: 'sb', boughtKey: 'b1' }]))
const ids = new Map([['s1', 'T1'], ['s2', 'T2'], ['b1', 'N1'], ['b2', 'N2']])
const made = C.linksToMake(ticks, ids, new Set([C.pairKey('s1', 'b1'), C.pairKey('s3', 'b1')]), [{ from_id: 'T9', to_id: 'N9' }])
check('links still to make: only pairs no write made, both ends known; an unsaved end is counted as missing, never guessed', same(made.make.map(m => [m.from_id, m.to_id]), [['T1', 'N2']]) && made.missing === 1, made)
check('a link that exists is not made again, and a thing is never linked to itself', C.linksToMake(new Map([['s', new Set(['b'])]]), new Map([['s', 'A'], ['b', 'B']]), new Set(), [{ from_id: 'A', to_id: 'B' }]).make.length === 0 && C.linksToMake(new Map([['s', new Set(['b'])]]), new Map([['s', 'A'], ['b', 'A']]), new Set(), []).make.length === 0)

console.log('\na sold line that matches none of your things ("Something I had")')
const spec = { preset: 'own' }
const blank = D.blankState(spec, [], '2026-11-23')
const hadState = D.applyPreset(blank, { had: { amount: 3000, currency: 'NOK', day: '2026-11-10', to: 'Elkjøp' } })
check('it starts as "I had it", sold, with the receipt\'s day, amount and buyer', hadState.had && hadState.needSale && hadState.draft.disposal === 'sold' && hadState.draft.disposed_on === '2026-11-10' && hadState.draft.sale_price === 3000 && hadState.draft.sold_to === 'Elkjøp', hadState)
const soldFill = { title: 'Old phone', brand: 'Demo', model: 'Z9', categoryId: 'c1', price: 3000, currency: 'NOK', day: '2026-11-10', storeId: 's1', storeName: 'Demo Marketplace', storeLabel: 'Demo Marketplace', channel: 'online', condition: 'used', warrantyUntil: '2028-11-10', note: 'x', lines: [], others: [], left: [], searched: false }
const hf = D.hadFill(soldFill)
check('the fill of a sold line describes the SALE: no price, day, store, channel, condition or warranty goes on the thing as where, when or how it was bought', hf.price === undefined && hf.currency === undefined && hf.day === undefined && hf.storeId === null && hf.storeName === null && hf.storeLabel === null && hf.channel === undefined && hf.condition === undefined && hf.warrantyUntil === undefined, hf)
check('what stays is the name, brand, model and category', hf.title === 'Old phone' && hf.brand === 'Demo' && hf.model === 'Z9' && hf.categoryId === 'c1')
const savedHad = D.withReceipt(spec, hadState, [], hf, '2026-11-23T10:00:00Z')
check('saved from a sold receipt, the draft has no store fact and no bought day or price; the buyer is only "Sold to"', !savedHad.facts.some(f => f.key === 'store' || f.key === 'price') && !savedHad.draft.bought_day && savedHad.draft.price == null && savedHad.draft.sold_to === 'Elkjøp', savedHad)
const mk = (paidFrom, moneyTo) => ({ paidFrom, moneyTo })
const L = (st, money, src, tgt) => D.linksAtSave(st, money, new Set(src), new Set(tgt))
check('a link is made only to what the popup itself offers: paid-from in the sold things, money-to in the targets', same(L(mk('S1', 'T1'), true, ['S1'], ['T1']), { from: 'S1', to: 'T1' }) && same(L(mk('X', 'Y'), true, ['S1'], ['T1']), { from: null, to: null }) && same(L(mk('', ''), true, ['S1'], ['T1']), { from: null, to: null }))
check('"Money went to" needs money back (a thing given away links nothing), whatever a preset says', same(L(mk('', 'T1'), false, [], ['T1']), { from: null, to: null }))
check('it needs the day it was bought first', D.missingFor(spec, { ...hadState, draft: { ...hadState.draft, title: 'Old phone' } }, '2026-11-23') === 'the day it was bought')
const withBought = (s, over) => ({ ...s, draft: { ...s.draft, bought_day: '2026-01-05', ...over } })
check('the sold day and the amount are REQUIRED: both missing says both, one says that one', D.missingFor(spec, withBought(blank.had ? blank : D.applyPreset(blank, { had: {} }), { title: 'Old phone' }), '2026-11-23') === 'the day it left and what it sold for'
  && D.missingFor(spec, withBought(D.applyPreset(blank, { had: { day: '2026-11-10' } }), { title: 'Old phone' }), '2026-11-23') === 'what it sold for'
  && D.missingFor(spec, withBought(D.applyPreset(blank, { had: { amount: 5, currency: 'NOK' } }), { title: 'Old phone' }), '2026-11-23') === 'the day it left')
check('with both filled (and a name and a bought day) Save can go', D.missingFor(spec, withBought(hadState, { title: 'Old phone' }), '2026-11-23') === null)
check('with nothing filled it names all three at once, in plain words', D.missingFor(spec, { ...D.applyPreset(blank, { had: {} }), draft: { ...D.applyPreset(blank, { had: {} }).draft, title: 'Old phone' } }, '2026-11-23') === 'the day it was bought, the day it left and what it sold for')
check('a sale before it was bought is still refused', D.missingFor(spec, withBought(hadState, { title: 'Old phone', bought_day: '2026-11-12' }), '2026-11-23') === 'a day it left that is not before it was bought')
check('given away (no money) needs no amount', D.missingFor(spec, withBought(hadState, { title: 'Old phone', disposal: 'given_away', sale_price: undefined }), '2026-11-23') === null)
check('an ordinary "I had it" (no receipt) still asks for no amount', D.missingFor({ preset: 'had' }, withBought(D.blankState({ preset: 'had' }, [], '2026-11-23'), { title: 'x', disposed_on: '2026-11-10' }), '2026-11-23') === null)
const linked = D.applyPreset(blank, { paidFrom: 'SOLD1', moneyTo: 'NEW1' })
check('the money links are only carried: paid-from and money-to ids', linked.paidFrom === 'SOLD1' && linked.moneyTo === 'NEW1' && !linked.had)

console.log('\nthe writes (the source, since they need a database)')
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const api = src('src/features/shop/api/shopApi.ts')
const link = api.slice(api.indexOf('export async function createShopLink'), api.indexOf('// ─── Extra costs'))
check('createShopLink leaves a link that exists exactly as it is (answers before the upsert) unless the caller passes an amount, and reads and deletes only the caller\'s own rows', /existing && input\.amount === undefined\) return/.test(link) && link.indexOf('return { id: existing') < link.indexOf('.upsert(') && /\.eq\('user_id', user\.id\)\.eq\('from_id'/.test(link) && /delete\(\)\.eq\('user_id', user\.id\)\.in\('id'/.test(link))
const flow = src('src/features/shop/components/receipt/useReceiptFlow.ts')
check('Undo all takes a sale back only while the row still looks like the one this popup made (way, day and group), one stale sale never stops the links and the deleted things, and the deleted things come back with an Undo', /it\.disposal === s\.done\.how && it\.disposed_on === s\.done\.on/.test(flow) && /groupSeen\.current\[s\.id\]/.test(flow) && /try \{ await undoSale\(s\.id\) \} catch \{ skipped\+\+ \}/.test(flow) && /restoreShopItems\(snapshot\)/.test(flow) && /toast\.undo\(words/.test(flow))
check('a planned first link is settled by the write whatever target was saved, so a changed or cleared target is never linked again', /handle\(next, \[\.\.\.plannedPairs\(key\)/.test(flow) && /handle\(next, \[\.\.\.plannedPairs\(k\)/.test(flow))
check('what the screen shows as written follows the live data (things, sales and links that are still there), and Undo all un-buys the wishes bought here', /const live = useMemo/.test(flow) && /status: 'wishlist'/.test(flow))
const create = src('src/features/shop/components/record/ShopCreate.tsx')
check('the create popup links only through linksAtSave (to what it offers)', /linksAtSave\(s, hasMoney\(spec, s\)/.test(create) && !/if \(s\.paidFrom\) await link/.test(create))

console.log('\nthe sale sheet\'s start')
check('a sale\'s defaults can name the thing the money went to', (() => { const d = R.saleFor({ currency: 'NOK', date: '2026-11-10' }, { name: 'x', price: 5 }, []); return d.amount === 5 && !('moneyTo' in d) })())

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
