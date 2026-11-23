#!/usr/bin/env node
/*
 * Verification — a product's picture from its own page, and a receipt's extra costs and discounts (owner, 23.11.2026).
 * Two halves, both against the REAL code:
 *   the function (supabase/functions/claude/index.ts, compiled with sucrase as the harness does): a page link is kept only
 *     when it is an address that call's own web search returned (exact, https, ≤ 2 048, no user name, password or port), up to 3
 *     candidates on different hosts, never a link the model typed; costs and discounts are checked values;
 *   the app (featureRules, productPicture, tidyModel, watchWords): the second check, the picture rules, the tidy review's
 *     picture field and its write and Undo, the draft costs on the dearest line, the notes that keep a discount apart from the
 *     normal price. Made-up receipts only.
 *
 * Run: node scripts/verify-shop-picture.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const fs = require('node:fs'), path = require('node:path')
const sucrase = require('sucrase')

let ok = 0, bad = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : `— ${JSON.stringify(detail)}`.slice(0, 600)) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── the function ─────────────────────────────────────────────────────────────
const root = path.join(__dirname, '..')
const SDK = require(path.join(root, 'node_modules/@anthropic-ai/sdk'))
const names = ['Anthropic', 'APIConnectionError', 'APIConnectionTimeoutError', 'APIError', 'AuthenticationError', 'BadRequestError', 'ContentTooLargeError', 'InternalServerError', 'NotFoundError', 'OverloadedError', 'PermissionDeniedError', 'RateLimitError', 'UnprocessableEntityError']
const source = fs.readFileSync(path.join(root, 'supabase/functions/claude/index.ts'), 'utf8')
const code = sucrase.transform(source.replace(/^import .*npm:@anthropic-ai\/sdk@.*$/m, '').replace(/^import .*npm:@supabase\/supabase-js@.*$/m, ''), { transforms: ['typescript'] }).code
const quiet = { error() {}, log() {}, warn() {}, info() {} }
const { findJob, worstCostOf } = new Function('Deno', 'createClient', 'fetch', 'console', ...names, `${code}\nreturn { findJob, worstCostOf }`)({ env: { get: () => undefined }, serve() {}, errors: {} }, () => ({}), async () => { throw new Error('no network') }, quiet, ...names.map(n => SDK[n]))

const F = { worstCostOf }
const NOW = new Date('2026-11-23T10:00:00Z')
const P1 = 'https://shop.example.com/demo-headphones-x1'
const P2 = 'https://other.example.org/review/x1'
const P3 = 'https://maker.example.net/x1'
const P1B = 'https://shop.example.com/another-page'
const results = [P1, P2, P3, P1B]
const receipt = findJob('receipt_read')
const tidy = findJob('shop_tidy')
const prepReceipt = receipt.prepare({ document: { media_type: 'application/pdf', data: Buffer.from('%PDF-1.4\n' + '% made-up receipt\n'.repeat(20)).toString('base64') } }, NOW)
const readR = (answer, urls) => prepReceipt.read(JSON.stringify(answer), { thinking: '', servedModel: 'm', webSearches: 1, searchUrls: urls })
const base = { kind: 'bought', currency: 'NOK', date: '2026-11-20', total: 6057, store: 'Demo Elektro' }

console.log('\nthe function: a page link comes only from the search')
check('the receipt job has no problem preparing', !('problem' in prepReceipt), prepReceipt)
let r = readR({ ...base, items: [{ name: 'X1', page: P1, price: 3290 }] }, results)
check('a link the search returned is kept (named: true), then up to two more addresses from it on other hosts (never the same host twice)', r.ok && same(r.result.items[0].page_urls, [P1, P2, P3]) && r.result.items[0].page_named === true, r)
r = readR({ ...base, items: [{ name: 'X1', page: 'https://typed.example.com/x1', price: 3290 }] }, results)
check('a link the model typed that no search returned is never kept: the pages are search results only, marked as not named (the app then checks each shows the same product)', r.ok && !r.result.items[0].page_urls.includes('https://typed.example.com/x1') && r.result.items[0].page_urls.every(u => results.includes(u)) && r.result.items[0].page_named === false, r)
r = readR({ ...base, items: [{ name: 'X1', page: P1 + '/', price: 3290 }] }, results)
check('a link changed by one character is not the search result: not kept as the named page', r.ok && r.result.items[0].page_named === false && !r.result.items[0].page_urls.includes(P1 + '/'), r)
r = readR({ ...base, items: [{ name: 'X1', page: P1, price: 3290 }] }, [])
check('no search ran (no results): no page', r.ok && r.result.items[0].page_urls === undefined, r)
for (const bad of ['http://shop.example.com/x', 'https://user:pw@shop.example.com/x', 'https://shop.example.com:8443/x', 'https://shop.example.com/a b', 'javascript:alert(1)', 'https://shop.example.com/' + 'a'.repeat(2100), 'https://shop.example.com/​x']) {
  r = readR({ ...base, items: [{ name: 'X1', page: bad, price: 3290 }] }, [bad, ...results])
  check(`a search result that is not a plain https address is never a candidate: ${bad.slice(0, 40)}`, r.ok && !(r.result.items[0].page_urls ?? []).includes(bad) && r.result.items[0].page_named === false, r)
}
const t = tidy.prepare({ item: { name: 'Demo Headphones X1 black' }, categories: [] }, NOW)
const readT = (answer, urls) => t.read(JSON.stringify(answer), { thinking: '', servedModel: 'm', webSearches: 1, searchUrls: urls })
let tr = readT({ name: 'Demo Headphones X1, black', page: P3 }, results)
check('shop_tidy: the page is kept the same way (from the search only)', tr.ok && tr.result.page_urls[0] === P3, tr)
tr = readT({ name: 'Demo Headphones X1, black', page: 'https://typed.example.com/' }, results)
check('shop_tidy: a typed link is never kept (search results only, not named)', tr.ok && !tr.result.page_urls.includes('https://typed.example.com/') && tr.result.page_named === false, tr)
check('the answer never asks for a picture address: no image key in either answer shape', !JSON.stringify(receipt.answerSchema).includes('image') && !JSON.stringify(tidy.answerSchema).includes('image'))

console.log('\nthe function: costs and discounts')
r = readR({ ...base, items: [{ name: 'A', price: 3290, before: 3790, discount: 500, discount_reason: 'member' }, { name: 'B', price: 2499 }], costs: [{ kind: 'shipping', name: 'Frakt', amount: 69 }, { kind: 'warranty', name: 'Utvidet garanti', amount: 299 }, { kind: 'discount', amount: 100, reason: 'points' }, { kind: 'discount', amount: 50, reason: 'because' }] }, [])
check('a line keeps its price, its normal price and its discount with a reason from the list', r.ok && r.result.items[0].before === 3790 && r.result.items[0].discount === 500 && r.result.items[0].discount_reason === 'member' && r.result.items[1].before === undefined, r)
check('costs keep their kind and amount; a discount keeps its reason (an unknown reason is "other")', r.ok && r.result.costs.length === 4 && r.result.costs[2].reason === 'points' && r.result.costs[3].reason === 'other' && r.result.costs[0].reason === null, r.ok && r.result.costs)
r = readR({ ...base, items: [{ name: 'A', price: 3290, before: 3000, discount: 500 }] }, [])
check('a normal price below what was paid is not believed: both dropped, nothing worked out', r.ok && r.result.items[0].before === undefined && r.result.items[0].discount === undefined, r)
r = readR({ ...base, items: [{ name: 'A', price: 3290, discount: 500 }] }, [])
check('a discount alone stays alone (reason "other" when none is printed): the normal price is never worked out', r.ok && r.result.items[0].before === undefined && r.result.items[0].discount === 500 && r.result.items[0].discount_reason === 'other', r)
r = readR({ ...base, items: [{ name: 'A', price: 3290 }], costs: [{ kind: 'gift', amount: 5 }, { kind: 'fee', amount: -4 }, { kind: 'fee', amount: 0.01 }, { kind: 'shipping', amount: 99999999 }, 'x', { kind: 'fee', name: 'https://evil.example.com', amount: 10 }] }, [])
check('an unknown kind, a negative, 0,01 and an absurd amount are dropped; a link as a name loses its name', r.ok && r.result.costs.length === 1 && r.result.costs[0].name === null && r.result.costs[0].amount === 10, r.ok && r.result.costs)
r = readR({ ...base, items: [{ name: 'Frakt', price: 69 }, { name: 'A', price: 100 }] }, [])
check('a shipping line that slipped into the items is still not a product', r.ok && r.result.items.length === 1, r)
r = readR({ ...base, items: [{ name: 'A', price: 100 }], costs: Array.from({ length: 20 }, () => ({ kind: 'fee', amount: 5 })) }, [])
check('at most 8 costs', r.ok && r.result.costs.length === 8, r.ok && r.result.costs.length)

// ── the app ──────────────────────────────────────────────────────────────────
const R = require('../src/features/ai/claude/featureRules')
const P = require('../src/features/shop/productPicture')
const T = require('../src/features/shop/tidyModel')
const W = require('../src/features/shop/watchWords')
const TODAY = '2026-11-23'

console.log('\nthe app: the second check of a page and a picture')
check('pageLink: https only, no user, password, port, space or invisible mark, ≤ 2 048', R.pageLink(P1) === P1 && !R.pageLink('http://a.example.com/') && !R.pageLink('https://u:p@a.example.com/') && !R.pageLink('https://a.example.com:81/') && !R.pageLink('https://a.example.com/a b') && !R.pageLink('https://a.example.com/‮') && !R.pageLink(`https://a.example.com/${'x'.repeat(2100)}`) && !R.pageLink(7))
const seen = R.readReceipt({ ...base, items: [{ name: 'X1', price: 3290, page_urls: [P1, 'http://bad.example.com/', P2, P3, 'https://a.example.com/4'], before: 3790, discount: 500, discount_reason: 'member' }], costs: [{ kind: 'shipping', amount: 69 }, { kind: 'discount', amount: 100, reason: 'points' }, { kind: 'fee', amount: 0.01 }] }, TODAY)
check('readReceipt looks at only the first 3 page links and keeps the clean ones, the discount with its reason, the costs', seen && same(seen.items[0].page_urls, [P1, P2]) && seen.items[0].discount_reason === 'member' && seen.costs.length === 2 && seen.costs[1].reason === 'points', seen)
check('shownPicture: https on a public host only', P.shownPicture('https://img.example.net/x.jpg') && !P.shownPicture('http://img.example.net/x.jpg') && !P.shownPicture('https://127.0.0.1/x.jpg') && !P.shownPicture('https://localhost/x.jpg') && !P.shownPicture('https://printer.local/x.jpg') && !P.shownPicture('https://intranet/x.jpg') && !P.shownPicture('https://u:p@img.example.net/x.jpg') && !P.shownPicture('data:image/png;base64,AAAA') && !P.shownPicture('//img.example.net/x.jpg') && !P.shownPicture('https://10.0.0.1/x.jpg'))
const refused = P.pictureOf({ status: 'not_allowed', refusal: 'terms', site: 'shop.example.com', reason: "shop.example.com doesn't let apps read its pages", image: 'https://img.example.net/leak.jpg', finalUrl: P1 })
check('a site that does not let apps read it gives no picture (even if an image came with the answer) and says so in the shared words', refused.image === null && refused.note === "shop.example.com doesn't let apps read its pages — no picture.", refused)
const robots = P.pictureOf({ status: 'not_allowed', refusal: 'robots', site: 'x.example.com', reason: 'x.example.com asks apps not to read this page', finalUrl: P1 })
check('a robots.txt refusal uses its own words', robots.note === 'x.example.com asks apps not to read this page — no picture.', robots)
check('a bot check says so, a page without a picture says so', P.pictureOf({ status: 'blocked', reason: 'elkjop.no blocks apps with a browser check', finalUrl: P1 }).note === 'elkjop.no blocks apps with a browser check — no picture.' && P.pictureOf({ status: 'no_price', finalUrl: P1, image: null }).note === 'The product page has no picture.')
const ok1 = P.pictureOf({ status: 'ok', image: 'https://img.example.net/x1.jpg', finalUrl: 'https://www.maker.example.net/x1' })
const fact = P.pictureFact(ok1, 'now')
check('a picture is a fact "product page (host)", check, ticked', fact && fact.key === 'image' && fact.source.label === 'product page (maker.example.net)' && fact.source.origin === 'page' && fact.confidence === 'check' && fact.on === true, fact)
check('no picture, no fact', P.pictureFact(refused, 'now') === null)
check('a later page must be about the same product (a model-like word, or two words)', P.samePage('Demo Headphones X1 black wireless', 'Demo Headphones X1, black') && !P.samePage('Some other review page', 'Demo Headphones X1, black') && !P.samePage(null, 'Demo Headphones X1') && P.samePage('WH-1000XM5 headphones', 'Sony WH-1000XM5'))
check('watchWords.pictureNote: nothing to say when there is a picture', W.pictureNote({ status: 'ok' }, true) === null)

console.log('\nthe app: the tidy review\'s picture')
const item = (o = {}) => ({ id: 'i1', user_id: 'u', category_id: null, title: 'Demo Headphones X1 black', list: 'wishlist', kind: 'item', status: 'wishlist', facts: null, image_url: null, ...o })
let s = T.readTidySuggestion({ name: 'Demo Headphones X1, black', page_urls: [P1, 'http://bad.example.com/'] }, item(), new Set())
check('the suggestion keeps the clean page links', s && same(s.page_urls, [P1]), s)
s = T.readTidySuggestion({ name: 'Demo Headphones X1, black', page_urls: [P1] }, item({ image_url: 'https://img.example.net/own.jpg' }), new Set())
check('a thing that has a picture never gets another one offered: no page is read for it', s && s.page_urls === undefined, s)
s = T.withPagePicture({ name: 'Demo Headphones X1, black', page_urls: [P3] }, ok1)
const changes = T.tidyChanges(item(), s, () => '')
check('the review has a Picture field: before none, after "product page (host)", with the picture', changes.some(c => c.key === 'picture' && c.before === 'none' && c.after === 'product page (maker.example.net)' && c.image === 'https://img.example.net/x1.jpg'), changes)
check('ticked: the write has image_url, nothing else of a link or price', same(T.tidyPatch(item(), s, new Set(['picture'])), { image_url: 'https://img.example.net/x1.jpg' }) && T.tidyPatch(item(), s, new Set(['name'])).image_url === undefined)
check('unticked: no picture is written', same(T.tidyPatch(item(), s, new Set()), {}))
check('Undo puts the picture back as it was (none)', same(T.tidyUndoPatch(item(), T.tidyPatch(item(), s, new Set(['picture']))), { image_url: null }))
check('a picture is not offered once the thing has one (checked again at the review)', !T.tidyChanges(item({ image_url: 'https://img.example.net/own.jpg' }), s, () => '').some(c => c.key === 'picture'))
const none = T.withPagePicture({ name: 'Demo Headphones X1, black' }, refused)
check('no picture: the reason is kept on the suggestion, no field', none.pictureNote === refused.note && !T.tidyChanges(item(), none, () => '').some(c => c.key === 'picture'))

console.log('\nthe app: extra costs and discounts in the drafts')
const read = R.readReceipt({ ...base, items: [{ name: 'A', product: 'Demo Headphones X1, black', price: 3290, before: 3790, discount: 500, discount_reason: 'member' }, { name: 'B', product: 'Demo Speaker S2', price: 2499 }], costs: [{ kind: 'shipping', name: 'Frakt', amount: 69 }, { kind: 'warranty', name: 'Utvidet garanti 3 år', amount: 299 }, { kind: 'discount', amount: 100, reason: 'points' }] }, TODAY)
const stores = []
const f0 = R.receiptFill(read, stores, 0), f1 = R.receiptFill(read, stores, 1), ft = R.receiptFill(read, stores, 'total')
const RR = require('../src/features/shop/receiptRead')
const placed = RR.placeCosts([f0, f1], [read, read], [3290, 2499], [true, true])
check('the extra costs ride on the dearest BOUGHT line only', placed[0].costs.length === 3 && placed[1].costs.length === 0, [placed[0].costs.length, placed[1].costs.length])
const placedSold = RR.placeCosts([f0, f1], [read, read], [3290, 2499], [false, true])
check('when the dearest line is sold, the other bought line carries them (they are not lost)', placedSold[0].costs.length === 0 && placedSold[1].costs.length === 3)
check('a receipt with no bought line carries none', RR.placeCosts([f0], [read], [3290], [false])[0].costs.length === 0)
check('a discount on the whole receipt is a negative cost named in English with its reason; shipping and the warranty are positive; a printed "Frakt" only repeats the kind', same(f0.costs.map(c => [c.label, c.amount, c.currency]), [['Shipping', 69, 'NOK'], ['Extended warranty · Utvidet garanti 3 år', 299, 'NOK'], ['Points discount', -100, 'NOK']]), f0.costs)
check('the paid sum stays exact: lines + costs = the receipt total', f0.price + f1.price + f0.costs.reduce((n, c) => n + c.amount, 0) === read.total, [f0.price, f1.price])
check('the total is never given the costs (it already holds them)', ft.costs.length === 0)
check('the normal price is only what the receipt printed; the paid price stays the price', f0.before === 3790 && f0.price === 3290 && f1.before === undefined)
check('the discount and its reason are their own fields on the fill (stored on the thing), apart from the normal price and the paid price; the note does not repeat them', f0.discount === 500 && f0.discountReason === 'member' && f0.before === 3790 && !/discount|normal price/.test(f0.note), f0)
const only = R.readReceipt({ ...base, items: [{ name: 'A', price: 3290, discount: 500, discount_reason: 'coupon' }] }, TODAY)
const fo = R.receiptFill(only, stores, 0)
check('a discount with no printed normal price sets no normal price (it is its own value)', fo.before === undefined && fo.discount === 500 && fo.discountReason === 'coupon', fo)
const noCur = R.receiptFill(R.readReceipt({ kind: 'bought', total: 100, items: [{ name: 'A', price: 100 }], costs: [{ kind: 'fee', amount: 5 }] }, TODAY), stores, 0)
check('costs without a currency this app holds are left out and said', noCur.costs.length === 0 && noCur.left.some(l => /extra costs/.test(l)), noCur)


console.log('\nthe app: the draft stores the discount apart from the paid price')
const CD = require('../src/features/shop/components/record/createDraft')
const SPEC = { preset: 'own' }
const blank = CD.blankState(SPEC, [], TODAY)
const filled = CD.withReceipt(SPEC, blank, [], f0, '2026-11-23T10:00:00Z')
const input = CD.inputOf(SPEC, filled, null, [])
check('the draft holds the paid price, the normal price and the discount with its reason', filled.draft.price === 3290 && filled.draft.market_price === 3790 && filled.draft.discount_amount === 500 && filled.draft.discount_reason === 'member', filled.draft)
check('what is saved: price 3290 (paid), market_price 3790, discount_amount 500 and its reason; the total of price is untouched', input.price === 3290 && input.market_price === 3790 && input.discount_amount === 500 && input.discount_reason === 'member', input)
const again = CD.withReceipt(SPEC, filled, [], f1, '2026-11-23T10:01:00Z')
check('a new pick of a line without a discount takes the earlier receipt\'s discount off (never over what was typed)', again.draft.discount_amount == null && again.draft.discount_reason == null && again.draft.market_price == null, again.draft)
const typed = CD.withReceipt(SPEC, { ...filled, draft: { ...filled.draft, discount_amount: 77, discount_reason: 'staff' } }, [], f1, '2026-11-23T10:01:00Z')
check('a discount the owner typed is kept', typed.draft.discount_amount === 77 && typed.draft.discount_reason === 'staff', typed.draft)
const hadDraft = CD.withReceipt({ preset: 'had' }, CD.blankState({ preset: 'had' }, [], TODAY), [], CD.hadFill(f0), 'now')
check('a sold line made as "something I had" carries no discount', hadDraft.draft.discount_amount == null, hadDraft.draft)

console.log('\nthe app: which page is read first (the picture memory)')
const src = (host, ok, fail, reason, state = 'on') => ({ host, ok_count: ok, fail_count: fail, last_reason: reason, state })
const pages = [P1, P2, P3]
let rk = P.rankPages(pages, [])
check('no memory: the order the function gave', same(rk.read, pages) && rk.refused.length === 0, rk)
rk = P.rankPages(pages, [src('maker.example.net', 4, 0, null), src('shop.example.com', 0, 2, 'not_allowed')])
check('a host that gave pictures goes first, one that refused apps is left out and named, the rest keep their order', same(rk.read, [P3, P2]) && same(rk.refused, ['shop.example.com']), rk)
rk = P.rankPages(pages, [src('maker.example.net', 1, 3, 'no_picture'), src('other.example.org', 5, 1, null)])
check('a host that mostly failed goes last; the best host first', same(rk.read, [P2, P1, P3]), rk)
rk = P.rankPages(pages, [src('shop.example.com', 0, 5, 'not_allowed', 'ignored')])
check('a host the owner cleared counts as unknown again', same(rk.read, pages) && rk.refused.length === 0, rk)
rk = P.rankPages(['https://WWW.Shop.Example.com/a', 'http://x.example.com/'], [src('shop.example.com', 0, 1, 'not_allowed')])
check('hosts are matched without capitals or www; an http address has no host in the memory', same(rk.refused, ['shop.example.com']) && same(rk.read, ['http://x.example.com/']), rk)
check('the ranking only orders: it never adds an address', P.rankPages([P1], [src('maker.example.net', 9, 0, null)]).read.every(u => [P1].includes(u)))

console.log('\nthe function: the reservation stays under the long-prompt line')
const fnCost = (tokens, text) => F.worstCostOf(receipt.defaults.model, receipt.instructions.length + text.length, receipt.defaults.maxOutputTokens, 'live', { imageTokens: tokens, webSearches: 2 })
const photoPrompt = receipt.instructions.length + 'Read the photo.'.length + 1000 + 46 * 46
check('a photo call without categories: three rounds of the prompt plus two searches stay below 100 000 tokens, so no long-prompt price (reserved cost below $0.06)', 3 * photoPrompt + 75_000 < 100_000 && fnCost(46 * 46, 'Read the photo.') < 0.06, [3 * photoPrompt + 75_000, fnCost(46 * 46, 'Read the photo.')])


console.log('\nreview fixes: preferred sites, host and picture rules, totals, labels, Stats')
r = readR({ ...base, items: [{ name: 'X1', price: 3290 }] }, results)
check('with no page named, the first three search results on separate hosts are the candidates, marked not named', r.ok && same(r.result.items[0].page_urls, [P1, P2, P3]) && r.result.items[0].page_named === false, r)
const prepWith = (hosts) => receipt.prepare({ document: { media_type: 'application/pdf', data: Buffer.from('%PDF-1.4\n' + '% made-up receipt\n'.repeat(20)).toString('base64') }, preferred_hosts: hosts }, NOW)
let pw = prepWith(['maker.example.net', 'bad host', 'https://x.example.com', '10.0.0.1', 'maker.example.net', 'shop.example.com', 'a.example.org', 'b.example.org'])
check('preferred sites: at most 3 clean host names, in their own tag (no address, no IP, no repeat)', pw.userText.includes('<preferred>\nmaker.example.net\nshop.example.com\na.example.org\n</preferred>') && !pw.userText.includes('b.example.org') && !/bad host|https:|10\.0/.test(pw.userText), pw.userText)
check('no preferred sites: no tag', !prepWith([]).userText.includes('<preferred>') && !prepWith('x').userText.includes('<preferred>'))
const tp = tidy.prepare({ item: { name: 'Demo Headphones X1' }, categories: [], preferred_hosts: ['maker.example.net', '<b>x</b>.example.com'] }, NOW)
check('shop_tidy takes the same hint in its own tag', tp.userText.includes('<preferred>\nmaker.example.net\n</preferred>') && !tp.userText.includes('<b>'), tp.userText)
check('the instructions say how to use them in one short line', /<preferred>/.test(receipt.instructions) && /<preferred>/.test(tidy.instructions))
for (const host of ['printer.lan', 'nas.home', 'x.home.arpa', 'files.corp', 'wiki.intranet', 'pc.localdomain', 'a.local', 'a.internal']) check(`a picture on ${host} is never shown`, P.shownPicture(`https://${host}/x.jpg`) === null)
const spSrc = fs.readFileSync(path.join(root, 'supabase/functions/shop-price/index.ts'), 'utf8')
check('shop-price: a picture read gives on only a public https picture (publicPicture, isPrivateHost), credits the host after redirects, and remembers an unreachable site', /function publicPicture\([\s\S]*?isPrivateHost\(u\.hostname\)/.test(spSrc) && /asked \? publicPicture\(got\.read\.image\)/.test(spSrc) && /notePictureHost\(supabase, userId, got\.read\.finalUrl \?\? url/.test(spSrc) && /body\.for === 'picture'\) await notePictureHost\(supabase, userId, url, false, 'error'\)/.test(spSrc))
check('shop-price: the memory keeps at most 200 hosts counting every state and prunes the oldest by updated_at, so learning never stops', /PICTURE_HOSTS_MAX = 200/.test(spSrc) && /order\('updated_at', \{ ascending: true \}\)/.test(spSrc) && /\.delete\(\)\.eq\('user_id', userId\)/.test(spSrc))
const migSrc = fs.readFileSync(path.join(root, 'supabase/migrations/203_shop_receipt_discount_picture_memory.sql'), 'utf8')
check('203: a cleared host comes back on with the next read and its counts restart', /state = 'on'/.test(migSrc) && /case when public\.ai_source_stats\.state = 'ignored' then case when p_ok then 1 else 0 end/.test(migSrc))
const B = require('../src/features/shop/receiptBatch')
const sums = B.receiptSums(read)
check('lines + costs equal the receipt total: no difference shown', sums && sums.sum === 6057 && sums.total === 6057 && sums.differs === false, sums)
const off = B.receiptSums({ ...read, total: 6157 })
check('a total 100 higher than lines + costs (the points discount was taken off twice) shows the difference, and flags a discount counted twice (it equals the points discount)', off && off.differs === true && off.doubled === true, off)
const higher = B.receiptSums({ ...read, total: 6200 })
check('a total that differs by no discount amount is a difference but not "counted twice"', higher.differs && !higher.doubled, higher)
check('rounding up to one unit is not a difference; no total or a line with no price is nothing to compare', B.receiptSums({ ...read, total: 6057.4 }).differs === false && B.receiptSums({ kind: 'bought', items: [{ name: 'A', price: 1 }] }) === null && B.receiptSums({ ...read, items: [{ name: 'A', price: null }] }) === null)
const CM = require('../src/features/shop/complaintModel')
check('a receipt discount is a purchase discount in Stats, never money back (rebateKind), while a claim and a price match stay', ['Discount', 'Points discount', 'Member discount', 'Coupon discount'].every(l => CM.rebateKind(l) === 'discount') && CM.rebateKind('Complaint: money back') === 'claim' && CM.rebateKind('Price match: money back') === 'match' && CM.rebateKind('Money back') === 'other' && CM.rebateKind('Cashback') === 'other')
const SM = require('../src/features/shop/statsModel')
const rowItem = { id: 'i1', user_id: 'u', title: 'Demo', list: 'wishlist', kind: 'item', status: 'bought', price: 3290, currency: 'NOK', fx_nok: 1, bought_at: '2026-11-20T12:00:00Z' }
const costRow = (id, label, amount) => ({ id, item_id: 'i1', label, amount, currency: 'NOK', spent_on: '2026-11-20', fx_nok: 1 })
const saved = SM.savedIn([rowItem], { costs: new Map([['i1', [costRow('c1', 'Points discount', -100), costRow('c2', 'Complaint: money back', -50), costRow('c3', 'Cashback', -10)]]]), rates: {}, today: '2026-11-23' }, { from: '2026-01-01', to: '2026-12-31' })
check('Stats: the discount is listed apart ("purchase discounts"), the claim is the only thing saved, the cashback is other money back', saved.saved.nok === 50 && saved.discounts.nok === 100 && saved.other.nok === 10, saved)
const f0b = R.receiptFill(read, [], 0)
check('the receipt discount is a ticked Discount fact of the create popup (exact, its field holds it)', require('../src/features/shop/receiptFacts').receiptFacts(f0b, 'now').some(f => f.key === 'discount' && f.value.amount === 500 && f.value.reason === 'member' && f.confidence === 'exact' && f.on))

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
