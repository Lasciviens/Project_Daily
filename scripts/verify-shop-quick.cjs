#!/usr/bin/env node
/* Verification — the quick list's step C (Shop renovation, 10.11.2026):
 *   1. Buy again from your own past ticks (src/features/shop/buyAgainModel.ts):
 *      the rhythm, when it is due, what is never suggested, the words.
 *   2. Where the whole list is cheapest (groceryModel.wholeList / wholeListWords),
 *      on current prices only (the 14-day rule).
 *   3. Product pictures: only a web link, only when the row has none
 *      (webPicture, matchPatch, unmatchPatch).
 *   4. The scan by EAN: the code's check (scanEan), every field of a hit where it
 *      enters (groceryHitOf), the app asking `food-search`'s `grocery_ean` (against
 *      a stand-in Supabase), and the function's own mapping — its <grocery-ean>
 *      block run on Kassalapp's example answer (scripts/fixtures/kassalapp/, from
 *      kassal.app/api, 10.11.2026; no live sample) and on the spec's list shape.
 * Run: node scripts/verify-shop-quick.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { transform } = require('sucrase')

// groceryApi imports the live Supabase client: a stand-in records each function call and answers from `answer`.
const invoked = []
let answer = () => ({ data: null, error: null })
const fakeSupabase = { functions: { invoke: async (name, opts) => { invoked.push({ name, body: opts.body }); return answer(name, opts.body) } } }
const origLoad = Module._load
Module._load = function (request) {
  if (/integrations\/supabase\/client$/.test(request)) return { supabase: fakeSupabase }
  return origLoad.apply(this, arguments)
}

const B = require('../src/features/shop/buyAgainModel')
const M = require('../src/features/shop/shopModel')
const G = require('../src/features/shop/groceryModel')
const API = require('../src/features/shop/api/groceryApi')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const TODAY = '2026-11-10'
const [ty, tm, td] = TODAY.split('-').map(Number)
const dayAgo = n => new Date(Date.UTC(ty, tm - 1, td - n)).toISOString().slice(0, 10)
// Local noon, so the phone's zone never moves a tick to another day.
const tick = n => { const d = new Date(ty, tm - 1, td - n, 12, 0, 0); return d.toISOString() }

let n = 0
function row(p) {
  n++
  return {
    id: p.id ?? `r${n}`, user_id: 'u', category_id: null, title: p.title ?? `Row ${n}`, notes: null, price: null, price_source: null,
    platform: null, url: null, priority: 'medium', region: null, planned_date: null, status: 'wishlist', source_type: 'manual',
    created_at: `2026-01-01T10:00:${String(n % 60).padStart(2, '0')}.000Z`, updated_at: '2026-01-01T10:00:00.000Z',
    list: 'quick', currency: null, bought_at: null, task_id: null, kind: 'item', kept: true, ean: null, image_url: null, ...p,
  }
}
const ticks = (title, agos, extra = {}) => agos.map(a => row({ title, status: 'bought', bought_at: tick(a), ...extra }))

console.log('\n1 · Buy again: a rhythm from your own ticks')
{
  check('three purchase days give a rhythm: the median gap', B.rhythmOf([dayAgo(17), dayAgo(11), dayAgo(5)]) === 6)
  check('…two days are one gap — a coincidence, no rhythm', B.rhythmOf([dayAgo(11), dayAgo(5)]) === null && B.rhythmOf([]) === null)
  check('an odd gap (a holiday) doesn\'t break it: 7, 7, 30 is every 7 days', B.rhythmOf([dayAgo(60), dayAgo(53), dayAgo(46), dayAgo(16)]) === 7)
  check('gaps that disagree are no rhythm: 2 and 40', B.rhythmOf([dayAgo(42), dayAgo(40), dayAgo(0)]) === null)
  check('…5 and 8 agree: every 7 days (6.5 rounded)', B.rhythmOf([dayAgo(13), dayAgo(8), dayAgo(0)]) === 7)
  const old = Array.from({ length: 12 }, (_, i) => dayAgo(200 - i * 14))            // every 14 days, long ago …
  const recent = Array.from({ length: 9 }, (_, i) => dayAgo(40 - i * 5))             // … then every 5 days
  check('only the latest 8 gaps count: the habit of now, not last year\'s', B.rhythmOf([...old, ...recent]) === 5)
  check('due from 80 % of the gap: every 6 days is due on day 5, not day 4', B.isDue(6, 5) && !B.isDue(6, 4))
  check('…every day is due the next day; every 30 days from day 24', B.isDue(1, 1) && !B.isDue(1, 0) && B.isDue(30, 24) && !B.isDue(30, 23))
  check('…past three gaps the habit has stopped: no longer suggested', B.isDue(6, 18) && !B.isDue(6, 19))

  const items = [
    ...ticks('Milk', [17, 11, 5], { platform: 'Kiwi', category_id: 'groc', ean: '7038010000737', image_url: 'https://img.example.com/melk.jpg' }),
    ...ticks('milk ', [23]),                                               // the same thing, another spelling: one purchase day more
    ...ticks('Coffee', [29, 22, 15, 8]),                                   // every week, 8 days ago: more overdue than milk
    ...ticks('Bread', [7, 4, 1]),                                          // every 3 days, yesterday: not due yet
    ...ticks('Oats', [20, 15, 10, 5]),                                     // due — but on the list now
    row({ title: 'oats', status: 'wishlist' }),
    ...ticks('Lettmelk', [30, 20, 10], { ean: '7038010009457' }),          // due — but its product is on the list under another name
    row({ title: 'Melk 1 l', status: 'wishlist', ean: '7038010009457' }),
    ...ticks('Eggs', [12, 12, 6, 6, 0]),                                   // two ticks a day count once: 12, 6, 0 → every 6, bought today
    ...ticks('Tape', [40]),                                                // once: Bought before only
    ...ticks('Candles', [100, 93, 86]),                                    // every week, 86 days ago: lapsed
    row({ title: 'Plaster', status: 'bought', bought_at: tick(-3), list: 'quick' }), // a day after today is not a purchase yet
    row({ title: 'Plaster', status: 'bought', bought_at: tick(9) }), row({ title: 'Plaster', status: 'bought', bought_at: tick(6) }),
    ...ticks('Headphones', [40, 30, 20], { list: 'wishlist' }),            // wishlist purchases are things you own, never Buy again
  ]
  const due = B.dueAgain(items, TODAY)
  check('due now, most overdue first (days since ÷ the usual gap): Coffee 8/7, then Milk 5/6',
    eq(due.map(d => d.title), ['Coffee', 'Milk']), JSON.stringify(due.map(d => [d.title, d.every, d.since])))
  const milk = due.find(d => d.title === 'Milk')
  check('Milk: four purchase days (two spellings folded), every 6 days, last 5 days ago',
    milk.count === 4 && milk.every === 6 && milk.since === 5 && milk.last === dayAgo(5), JSON.stringify(milk && { ...milk, row: undefined }))
  check('…its words, the owner\'s: "Usually every 6 days, last 5 days ago"', B.rhythmWords(milk) === 'Usually every 6 days, last 5 days ago')
  check('…a tap re-adds the latest purchase: its store, category, product and picture',
    eq(M.buyAgainInput(milk), { title: 'Milk', platform: 'Kiwi', category_id: 'groc', list: 'quick', ean: '7038010000737', image_url: 'https://img.example.com/melk.jpg' }))
  check('never suggested: on the list by name (oats) or by product (Lettmelk), not due yet (bread), bought today (eggs), lapsed (candles), wishlist purchases',
    !due.some(d => ['Oats', 'Lettmelk', 'Bread', 'Eggs', 'Candles', 'Headphones'].includes(d.title)))
  check('a tick dated after today is not a purchase yet (Plaster: two days only)', !due.some(d => d.title === 'Plaster'))
  const before = B.boughtBefore(items, due)
  check('Bought before keeps the rest, without what Buy again shows', !before.some(b => b.title === 'Coffee' || b.title === 'Milk') && before.some(b => b.title === 'Tape') && before.some(b => b.title === 'Bread'))
  check('nothing bought yet: nothing suggested', B.dueAgain([row({ title: 'Milk' })], TODAY).length === 0 && B.dueAgain([], TODAY).length === 0)
  check('words: every day, every week, every 3 weeks; yesterday, 17 days ago, 4 weeks ago',
    B.rhythmWords({ every: 1, since: 1 }) === 'Usually every day, last bought yesterday' && B.rhythmWords({ every: 7, since: 6 }) === 'Usually every week, last 6 days ago'
    && B.rhythmWords({ every: 21, since: 17 }) === 'Usually every 3 weeks, last 17 days ago' && B.rhythmWords({ every: 30, since: 28 }) === 'Usually every 4 weeks, last 4 weeks ago')
}

console.log('\n2 · Where the whole list is cheapest (current prices only)')
{
  const fresh = '2026-11-10T07:00:00Z'
  const stale = '2026-10-01T07:00:00Z'                                   // 40 days: left out (the 14-day rule)
  const s = (name, price, checked = fresh) => ({ code: name.toUpperCase(), name, price, checked })
  const prices = new Map([
    ['1', { ean: '1', name: 'Melk', stores: [s('Oda', 21.9), s('Meny', 23.9), s('Spar', 23.9), s('Kiwi', 15, stale)] }],
    ['2', { ean: '2', name: 'Brød', stores: [s('Oda', 39.9), s('Meny', 42.5), s('Spar', 42.5)] }],
    ['3', { ean: '3', name: 'Kaffe', stores: [s('Oda', 75.9), s('Meny', 79.9), s('Spar', 79.9), s('Kiwi', 50, stale)] }],
  ])
  const rows = [{ title: 'Milk', ean: '1' }, { title: 'Bread', ean: '2' }, { title: 'Coffee', ean: '3' }]
  const money = v => `${v.toFixed(2)} NOK`
  const w = G.wholeList(G.basketByChain(rows, prices, TODAY), rows.length)
  check('the cheapest chain with every row: Oda, 137.70 — Kiwi\'s 40-day-old prices never count',
    w.kind === 'cheapest' && eq(w.chains, ['Oda']) && w.total === 137.7 && w.covered === 3 && w.whole, JSON.stringify(w))
  check('…one line: "Cheapest for the whole list: Oda · 137.70 NOK"', eq(G.wholeListWords(w, money), { lead: 'Cheapest for the whole list:', chain: 'Oda', value: '137.70 NOK' }))
  const tied = new Map([...prices].map(([k, p]) => [k, { ...p, stores: p.stores.filter(x => x.name !== 'Oda') }]))
  const t = G.wholeList(G.basketByChain(rows, tied, TODAY), rows.length)
  check('a tie names both, A–Z: "Meny or Spar"', t.kind === 'cheapest' && eq(t.chains, ['Meny', 'Spar']) && G.wholeListWords(t, money).chain === 'Meny or Spar' && t.total === 146.3, JSON.stringify(t))
  const onlyOda = new Map([['1', prices.get('1')], ['2', prices.get('2')], ['3', { ...prices.get('3'), stores: [s('Oda', 75.9)] }]])
  const o = G.wholeList(G.basketByChain(rows, onlyOda, TODAY), rows.length)
  check('one chain has everything: "Only one chain has all 3:" Oda', o.kind === 'only' && G.wholeListWords(o, money).lead === 'Only one chain has all 3:' && G.wholeListWords(o, money).chain === 'Oda')
  const split = new Map([['1', { ...prices.get('1'), stores: [s('Meny', 23.9)] }], ['2', { ...prices.get('2'), stores: [s('Oda', 39.9)] }], ['3', { ...prices.get('3'), stores: [s('Meny', 79.9)] }]])
  const none = G.wholeList(G.basketByChain(rows, split, TODAY), rows.length)
  check('no chain has it all: the one with the most, never a total that isn\'t comparable',
    none.kind === 'none' && eq(G.wholeListWords(none, money), { lead: 'No chain has all 3 — most at', chain: 'Meny', value: '2 of 3' }), JSON.stringify(none))
  const part = G.wholeList(G.basketByChain([...rows, { title: 'Tape', ean: null }], prices, TODAY), rows.length + 1)
  check('with a row not priced yet it says what it covers: "Cheapest for 3 priced items:"', !part.whole && G.wholeListWords(part, money).lead === 'Cheapest for 3 priced items:')
  const onlyStale = new Map([['1', { ...prices.get('1'), stores: [s('Kiwi', 15, stale)] }]])
  check('only old prices: no answer at all (nothing to say is cheapest)', G.wholeList(G.basketByChain([rows[0]], onlyStale, TODAY), 1) === null)
  check('two rows: "has both"; one row: "has it"', G.wholeListWords({ ...o, priced: 2 }, money).lead === 'Only one chain has both:' && G.wholeListWords({ ...none, priced: 1, covered: 1 }, money).lead === 'No chain has it — most at')
}

console.log('\n3 · Product pictures: a web link, only when the row has none')
{
  check('a web link is kept; "//cdn…" is made https', G.webPicture('https://res.cloudinary.com/x/7039010019828.jpg') === 'https://res.cloudinary.com/x/7039010019828.jpg'
    && G.webPicture('http://bilder.ngdata.no/7039010576963/meny/large.jpg') === 'http://bilder.ngdata.no/7039010576963/meny/large.jpg' && G.webPicture('//cdn.example.com/a.png') === 'https://cdn.example.com/a.png')
  check('never a data:, javascript:, blob: or relative link, nor one with a space, a control character or over 2 048 characters',
    [
      'data:image/png;base64,AAAA', 'javascript:alert(1)', 'blob:https://x/1', '/img/a.png', 'img.png', 'https://a b/c.png', 'https://x/\u0000.png',
      `https://x.example/${'a'.repeat(2048)}`, 12, null, undefined, { url: 'https://x/a.png' },
    ].every(v => G.webPicture(v) === null))
  const was = { image: 'https://img.example.com/old.jpg' }
  const hit = { ean: '7039010019828', image: 'https://img.example.com/new.jpg' }
  check('a row without a picture takes the product\'s', eq(G.matchPatch({ image_url: null }, hit), { ean: hit.ean, image_url: hit.image }))
  check('a picture of the row\'s own stays, whatever the product', eq(G.matchPatch({ image_url: 'https://example.com/mine.jpg' }, hit, was), { ean: hit.ean }))
  check('Change product: the old product\'s picture gives way to the new one\'s (or to none)',
    eq(G.matchPatch({ image_url: was.image }, hit, was), { ean: hit.ean, image_url: hit.image }) && eq(G.matchPatch({ image_url: was.image }, { ean: '1', image: null }, was), { ean: '1', image_url: null }))
  check('…a picture that isn\'t a web link is never taken', eq(G.matchPatch({}, { ean: '1', image: 'javascript:alert(1)' }), { ean: '1' }))
  check('Remove match: the old product\'s picture goes with it; the row\'s own stays',
    eq(G.unmatchPatch({ image_url: was.image }, was), { ean: null, image_url: null }) && eq(G.unmatchPatch({ image_url: 'https://example.com/mine.jpg' }, was), { ean: null }) && eq(G.unmatchPatch({ image_url: was.image }), { ean: null }))
}

console.log('\n4 · The scan by EAN')
{
  check('a code is looked up only as 8–14 digits', G.scanEan('7039010019828') === '7039010019828' && G.scanEan('12345678') === '12345678' && G.scanEan('12345678901234') === '12345678901234')
  check('…never shorter, longer, or with anything but digits', ['1234567', '123456789012345', '7039010019828/../x', '70390100 19828', '', 'abc12345678', '７０３９０１００１９８２８'].every(c => G.scanEan(c) === null))
  const good = { ean: '7039010019828', name: 'Grandiosa Pizza Pepperoni 500g Stabburet', brand: 'Grandiosa', image: 'https://res.cloudinary.com/norgesgruppen/image/upload/v1642055086/Product/7039010019828.jpg', price: 69.9, store: 'SPAR' }
  check('a hit as the function answers it enters whole', eq(G.groceryHitOf(good), good))
  check('…a hit without an EAN of 8–14 digits or a name is no hit',
    [{ ...good, ean: '123' }, { ...good, ean: 7039010019828 }, { ...good, ean: '7039010019828x' }, { ...good, name: '  ' }, { ...good, name: 5 }, null, 'x', []].every(h => G.groceryHitOf(h) === null))
  const odd = G.groceryHitOf({ ...good, brand: 7, image: 'javascript:alert(1)', price: -1, store: { name: 'SPAR' } })
  check('…the other fields are checked one by one: a brand and store only as text, a picture only as a web link, a price only ≥ 0',
    odd && odd.brand === null && odd.image === null && odd.price === null && odd.store === null)
  check('…long text is cut (300 characters, a store 100)', G.groceryHitOf({ ...good, name: 'x'.repeat(400), store: 'y'.repeat(200) }).name.length === 300 && G.groceryHitOf({ ...good, store: 'y'.repeat(200) }).store.length === 100)
}

// The function's own mapping, run as it is in the function (TypeScript stripped).
const fnSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/food-search/index.ts'), 'utf8')
const a = fnSrc.indexOf('// <grocery-ean>'), z = fnSrc.indexOf('// </grocery-ean>')
const block = a >= 0 && z > a ? fnSrc.slice(a, z) : ''
const F = block ? new Function(`${transform(block, { transforms: ['typescript'] }).code}\nreturn { eanHit, webPicture, EAN_RE }`)() : null
const example = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/kassalapp/products-ean-example.json'), 'utf8'))

console.log('\n5 · food-search grocery_ean: Kassalapp\'s own example (kassal.app/api, 10.11.2026) and its spec\'s shape')
check('the function has its <grocery-ean> block', !!F)
if (F) {
  const hit = F.eanHit(example.data, '7039010019828')
  check('the example maps to one hit: the EAN, the name, the brand, the newest-dated chain\'s price and name (Spar 69.90, 27.01.2023 over Meny\'s 26.01)',
    eq(hit, { ean: '7039010019828', name: 'Grandiosa Pizza Pepperoni 500g Stabburet', brand: 'Grandiosa', image: 'https://res.cloudinary.com/norgesgruppen/image/upload/v1642055086/Product/7039010019828.jpg', price: 69.9, store: 'SPAR' }), JSON.stringify(hit))
  check('…and the app takes that hit whole', eq(G.groceryHitOf(hit), hit))
  const spec = { ...example.data, products: example.data.products.map(p => ({ ...p, store: [p.store], current_price: [p.current_price] })) }
  check('the spec\'s shape (store and current_price as lists) maps the same', eq(F.eanHit(spec, '7039010019828'), hit))
  check('an answer about another EAN is no hit; Kassalapp\'s own spelling of the same number is kept',
    F.eanHit(example.data, '7039010019835') === null && F.eanHit({ ...example.data, ean: '07039010019828' }, '7039010019828').ean === '07039010019828')
  check('…an EAN field that isn\'t digits is no hit; none (null) is the EAN asked for',
    F.eanHit({ ...example.data, ean: 7039010019828 }, '7039010019828') === null && F.eanHit({ ...example.data, ean: null }, '7039010019828').ean === '7039010019828')
  check('no product rows, or none with a name: no hit', F.eanHit({ ean: '7039010019828', products: [] }, '7039010019828') === null
    && F.eanHit({ ean: '7039010019828', products: [{ name: '' }, null, 'x', [{ name: 'In a list' }]] }, '7039010019828') === null && F.eanHit(null, '7039010019828') === null)
  const hostile = { ean: '7039010019828', products: [
    { name: 'A', brand: { x: 1 }, image: 'javascript:alert(1)', store: { name: 42 }, current_price: { price: '1e309', date: 'yesterday' } },
    { name: 'B', image: 'https://img.example.com/b.jpg', current_price: { price: -5, date: '2026-11-09T07:00:00Z' } },
  ] }
  const h = F.eanHit(hostile, '7039010019828')
  check('every field checked where it enters: a dated row wins, a negative price is none, a bad picture gives way to another chain\'s web picture',
    h && h.name === 'B' && h.brand === null && h.price === null && h.store === null && h.image === 'https://img.example.com/b.jpg', JSON.stringify(h))
  const h2 = F.eanHit({ ean: '7039010019828', products: [{ name: 'A', brand: { x: 1 }, image: 'javascript:alert(1)', store: { name: 42 }, current_price: { price: '1e309' } }] }, '7039010019828')
  check('…an object for a brand, a number for a store, "1e309" for a price and a javascript: picture all become none',
    h2 && h2.brand === null && h2.store === null && h2.price === null && h2.image === null, JSON.stringify(h2))
  check('its picture and EAN rules are the app\'s', ['https://x.example/a.jpg', '//cdn.example.com/a.png', 'javascript:alert(1)', 'data:,x', `https://x.example/${'a'.repeat(2048)}`].every(v => F.webPicture(v) === G.webPicture(v))
    && ['7039010019828', '1234567', '123456789012345', '7039010019828/x'].every(c => F.EAN_RE.test(c) === (G.scanEan(c) != null)))
}

console.log('\n6 · food-search: the mode, its guard, and what stays as it was')
{
  const serve = fnSrc.slice(fnSrc.indexOf('Deno.serve('))
  const firstMode = serve.indexOf("body.mode ===")
  check('the caller is checked first: auth.getUser, then isAppUser, before any mode', /auth\.getUser\(/.test(serve.slice(0, firstMode)) && /isAppUser\(user\.id\)/.test(serve.slice(0, firstMode)))
  const m = serve.slice(serve.indexOf("body.mode === 'grocery_ean'"), serve.indexOf("body.mode === 'grocery_prices'"))
  check('grocery_ean exists and calls GET /products/ean/{ean}', m.length > 0 && /kassal\(`\/products\/ean\/\$\{ean\}`, key\)/.test(m))
  check('…the EAN is tested as sent (8–14 digits) before it goes into the address — never cleaned into shape',
    m.indexOf('EAN_RE.test(ean)') > 0 && m.indexOf('EAN_RE.test(ean)') < m.indexOf('/products/ean/') && !/replace\(/.test(m.slice(0, m.indexOf('/products/ean/'))))
  check('…no key: not_configured; an unknown EAN (404): no product, not a failure; every answer names the mode',
    /if \(!key\) return json\(\{ mode: 'grocery_ean', products: \[\], error: 'not_configured' \}\)/.test(m) && /status === 404\) return json\(\{ mode: 'grocery_ean', products: \[\] \}\)/.test(m))
  check('the key travels only as a Bearer header, never in the address', /Authorization: `Bearer \$\{key\}`/.test(fnSrc) && !/[?&](api_?key|token|key)=/i.test(fnSrc))
  check('Food\'s own { ean } lookup is still there, unchanged in shape', /if \(body\.ean\) \{\s*const j = await kassal\(`\/products\/ean\/\$\{encodeURIComponent\(String\(body\.ean\)\.replace\(\/\\D\/g, ''\)\)\}`, key\)/.test(serve))
  const hook = fs.readFileSync(path.join(__dirname, '..', 'src/features/shop/hooks/useGrocery.ts'), 'utf8')
  const scan = hook.slice(hook.indexOf('export function useScanLookup'))
  check('useScanLookup asks by EAN (lookUpGroceryEan), never the name search', /lookUpGroceryEan\(ean\)/.test(scan) && !/searchGroceries/.test(scan) && /scanEan\(code\)/.test(scan))
}

async function main() {
  console.log('\n7 · The app asks grocery_ean (a stand-in Supabase)')
  const example7 = { ean: '7039010019828', name: 'Grandiosa Pizza Pepperoni 500g Stabburet', brand: 'Grandiosa', image: null, price: 69.9, store: 'SPAR' }
  answer = () => ({ data: { mode: 'grocery_ean', products: [example7] }, error: null })
  invoked.length = 0
  const hit = await API.lookUpGroceryEan('7039010019828')
  check('one call: food-search, mode grocery_ean, the EAN', invoked.length === 1 && invoked[0].name === 'food-search' && eq(invoked[0].body, { mode: 'grocery_ean', ean: '7039010019828' }) && hit && hit.name === example7.name)
  invoked.length = 0
  check('a code that isn\'t an EAN is never sent', (await API.lookUpGroceryEan('12345')) === null && (await API.lookUpGroceryEan('https://example.com/x')) === null && invoked.length === 0)
  answer = () => ({ data: { mode: 'grocery_ean', products: [] }, error: null })
  check('Kassalapp doesn\'t know it: null ("No product found")', (await API.lookUpGroceryEan('7039010019828')) === null)
  answer = () => ({ data: { products: [{ code: '7039010019828', name: 'Food\'s shape' }] }, error: null })
  const old = await API.lookUpGroceryEan('7039010019828').then(() => null, e => e.message)
  check('a function deployed before the mode (Food\'s answer) says to redeploy, never "no product"', /Redeploy the food-search function/.test(old ?? ''), old)
  answer = () => ({ data: { mode: 'grocery_ean', products: [], error: 'not_configured' }, error: null })
  const nk = await API.lookUpGroceryEan('7039010019828').then(() => null, e => e.message)
  check('no key on the server: says which', /KASSALAPP_API_KEY/.test(nk ?? ''), nk)
  answer = () => ({ data: { products: [example7, { ...example7, ean: 'x' }, { ...example7, image: 'javascript:alert(1)', ean: '7039010019835' }] }, error: null })
  const found = await API.searchGroceries('grandiosa')
  check('Find a price\'s hits are checked too: a bad EAN is dropped, a bad picture becomes none', found.length === 2 && found[1].image === null)
}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}, e => { console.error(e); process.exit(1) })
