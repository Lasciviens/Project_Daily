#!/usr/bin/env node
/* Verification — Shop's resale and selling (migration 192, step C), on the real modules:
 *   1. The rows (resaleRows.ts): the condition, status, language and currency lists and the ad-link and host
 *      patterns are 192's own (read from the migration); an ad's link is one https address; a link is on a
 *      marketplace only by its host or a subdomain; a pasted link finds its marketplace from the data; a price story
 *      is checked as 192 checks it; rows read back are checked where they enter.
 *   2. The evidence (resaleEvidence.ts): your own sales of the same model, the asks and sales you noted, a dealer's
 *      used and refurbished prices, trade-in quotes and your estimates — each with its source, day and condition,
 *      newest first; what counts and why not; the suggested range (prices span it, the trade-in floor lifts it, a
 *      dealer's price caps it); estimates shown, never counted; nothing filled in, nothing changed.
 *   3. The nudge (listingNudge.ts): "12 days, no sale; yours usually go in 9 — lower it?" — the median of your own
 *      sold listings (the category's from three, else all of yours from three), a price cut starts the wait again,
 *      two weeks with no "usually"; a price change keeps the story in order.
 *   4. New vs used vs refurbished (ownershipCost.ts): your own kept % (the median share that came back, at each
 *      day's rate; gifts, rate-pending and price-less sales left out), the category's from three, new and used apart;
 *      each option's net cost, per month, the cheapest, and the reason when one is missing.
 *   5. The ad and the checklist (resaleTexts.ts): 192's seeded templates (read from the migration) are Norwegian and
 *      name only fields the app fills; a filled ad drops a line with nothing to say and never holds a private fact;
 *      a thing finds its marketplace's template and its category's checklist through other names for it.
 *   6. The data layer (shopResaleApi.ts, useShopResale.ts): reads page in one total order and answer nothing before
 *      192; writes are the caller's own rows, refused here first when 192 would refuse them, and say "migration 192"
 *      by name before it; Sold is never written by hand; every hook goes through useMutationWithFeedback, deletes
 *      through the one delete flow, keys from qk; the assistant's catalogue lists the six tables as designed.
 * Run: node scripts/verify-shop-resale.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const Module = require('module')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const sql = read('supabase/migrations/192_shop_resale.sql')

// The api module reads supabase and the session: both stand-ins (below) before it loads.
const tables = {}
const calls = []
const failing = {}
const MAX_ROWS = 1000
function from(table) {
  const st = { table, op: 'select', eqs: [], orders: [], range: null, patch: null, row: null, returning: false, single: false }
  const b = {
    select() { if (st.op !== 'select') st.returning = true; return b },
    insert(row) { st.op = 'insert'; st.row = row; return b },
    update(patch) { st.op = 'update'; st.patch = patch; return b },
    eq(c, v) { st.eqs.push([c, v]); return b },
    order(c, o = {}) { st.orders.push([c, o.ascending !== false]); return b },
    range(f, t) { st.range = [f, t]; return b },
    single() { st.single = true; return b },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej) },
  }
  function run() {
    calls.push(st)
    if (failing[table]) return { data: null, error: failing[table] }
    const rows = (tables[table] ??= [])
    if (st.op === 'insert') {
      const row = { id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`, created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-10T10:00:00Z',
        currency: 'NOK', asking: true, closed_by_sale: false, noted_on: '2026-11-10', quoted_on: '2026-11-10', language: 'nb', condition: null, note: null,
        marketplace: null, ad_url: null, ad_text: null, for_sale_on: null, ended_on: null, ...st.row }
      rows.push(row)
      return { data: { ...row }, error: null }
    }
    const hit = rows.filter(r => st.eqs.every(([c, v]) => r[c] === v))
    if (st.op === 'update') {
      for (const r of hit) Object.assign(r, st.patch)
      return { data: hit.map(r => ({ ...r })), error: null }
    }
    const cmp = (a, c) => {
      for (const [k, asc] of st.orders) {
        const x = a[k] ?? '', y = c[k] ?? ''
        if (x < y) return asc ? -1 : 1
        if (x > y) return asc ? 1 : -1
      }
      return 0
    }
    let out = [...hit].sort(cmp)
    if (st.range) out = out.slice(st.range[0], st.range[1] + 1)
    return { data: out.slice(0, MAX_ROWS).map(r => ({ ...r })), error: null }
  }
  return b
}
const rpcCalls = []
let rpcAnswer = () => ({ data: 0, error: null })
const rpc = async (fn, args) => { rpcCalls.push({ fn, args }); return rpcAnswer(fn, args) }
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (/integrations\/supabase\/client$/.test(request)) return 'stub:supabase'
  if (/shared\/utils\/requireUser$/.test(request)) return 'stub:requireUser'
  return origResolve.call(this, request, parent, ...rest)
}
const USER = '00000000-0000-4000-8000-0000000000aa'
require.cache['stub:supabase'] = { id: 'stub:supabase', filename: 'stub:supabase', loaded: true, exports: { supabase: { from, rpc } } }
require.cache['stub:requireUser'] = { id: 'stub:requireUser', filename: 'stub:requireUser', loaded: true, exports: { requireUser: async () => ({ id: USER }) } }
const API = require('../src/features/shop/api/shopResaleApi.ts')
Module._resolveFilename = origResolve

const RR = require('../src/features/shop/resaleRows')
const EV = require('../src/features/shop/resaleEvidence')
const LN = require('../src/features/shop/listingNudge')
const OC = require('../src/features/shop/ownershipCost')
const TX = require('../src/features/shop/resaleTexts')

const TODAY = '2026-11-10'
const rates = { NOK: 10, TRY: 40, EUR: 0.9 }
let n = 0
const uid = k => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`
function item(p) {
  n++
  return {
    id: p.id ?? uid(100 + n), user_id: USER, category_id: null, title: p.title ?? `Item ${n}`, notes: null, price: null, price_source: null,
    platform: null, url: null, priority: 'medium', region: null, planned_date: null, status: 'bought', source_type: 'manual',
    created_at: '2025-01-01T10:00:00.000Z', updated_at: '2026-09-30T10:00:00.000Z', list: 'wishlist', currency: 'NOK',
    bought_at: '2025-05-10T12:00:00.000Z', task_id: null, kind: 'item', kept: true, ...p,
  }
}
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v) } return o }
const T = '2026-11-01T10:00:00Z'

;(async () => {
// ── 1. Rows ──────────────────────────────────────────────────────────────────
console.log('\n1 · The rows: 192\'s own lists and patterns')
const checkList = (col) => {
  const m = sql.match(new RegExp(`${col}\\s+text check \\(${col} is null or ${col} in \\(([^)]*)\\)\\)`)) || sql.match(new RegExp(`${col}\\s+text not null default '\\w+' check \\(${col} in \\(([^)]*)\\)\\)`))
  return m ? [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1]) : null
}
check('the conditions are 192\'s (ad notes and quotes alike)', eq(checkList('condition'), [...RR.RESALE_CONDITIONS])
  && (sql.match(/condition in \('new', 'like_new', 'good', 'fair', 'for_parts'\)/g) || []).length === 2, JSON.stringify(checkList('condition')))
check('the listing states are 192\'s', eq(checkList('status'), [...RR.LISTING_STATUSES]), JSON.stringify(checkList('status')))
check('the template languages are 192\'s', eq(checkList('language'), [...RR.AD_LANGUAGES]), JSON.stringify(checkList('language')))
check('every amount\'s currency is the Shop\'s four (192 on each table)', (sql.match(/currency in \('NOK', 'TRY', 'EUR', 'USD'\)/g) || []).length === 4)
{
  const pg = [...sql.matchAll(/ad_url ~ '([^']+)'/g)].map(m => m[1])
  const js = RR.AD_URL_RE.source.replace(/\\\//g, '/')
  check('an ad\'s link pattern is 192\'s, on both tables', pg.length === 2 && pg.every(p => p === js), `${pg[0]} vs ${js}`)
  const hosts = [...sql.matchAll(/marketplace ~ '([^']+)'/g)].map(m => m[1])
  check('a marketplace is a host in shop_site_policies\' form (192\'s pattern, three tables)', hosts.length === 3 && hosts.every(h => h === RR.HOST_RE.source), hosts[0])
}
{
  // The shared cases (verify-db-shop-rules runs the same ones through 192's real CHECK).
  const LINKS = [...JSON.parse(read('scripts/fixtures/shop-ad-links.json')).cases,
    { raw: 'https://finn.no' + '/x'.repeat(1030), stored: false, accepted: false, why: 'over 2 048 characters' }]
  const odd = ['‮', '​', ' ', '\u0085']
  check('the shared ad-link cases hold U+202E, U+200B, U+00A0 and U+0085 (each in a path), and a direction change in a host',
    odd.every(ch => LINKS.some(c => c.raw.includes(ch) && c.raw.startsWith('https://finn.no/'))) && LINKS.some(c => c.raw.startsWith('https://fi‮')) && LINKS.length >= 25)
  const storedWrong = LINKS.filter(c => RR.isAdUrl(c.raw) !== c.stored)
  check('an ad\'s link as stored: printable ASCII after the host, nothing else — the app\'s pattern gives every shared case its answer', !storedWrong.length, storedWrong.map(c => c.why).join('; '))
  const sentWrong = LINKS.filter(c => (RR.normalizeAdUrl(c.raw) !== null) !== c.accepted)
  check('a pasted link is sent as the URL parser writes it (an invisible or direction-changing character encoded), then checked — every shared case', !sentWrong.length, sentWrong.map(c => c.why).join('; '))
  check('…what is sent is one the stored check takes, the same href the database is asked about', LINKS.every(c => {
    const n = RR.normalizeAdUrl(c.raw)
    return n === null || (RR.isAdUrl(n) && n === new URL(c.raw.trim()).href && !/[^!-~]/.test(n))
  }) && RR.normalizeAdUrl('https://finn.no/a‮b') === 'https://finn.no/a%E2%80%AEb')
}
check('a link is on a marketplace by its host or a subdomain — never by a name that only starts or ends the same',
  RR.linkOnHost('https://www.finn.no/x', 'finn.no') && RR.linkOnHost('https://finn.no/x', 'finn.no') && !RR.linkOnHost('https://finn.no.evil.example/x', 'finn.no')
  && !RR.linkOnHost('https://evilfinn.no/x', 'finn.no') && !RR.linkOnHost('https://tise.com/finn.no', 'finn.no') && !RR.linkOnHost('javascript:finn.no', 'finn.no'))
check('a pasted link\'s marketplace: a known host it is on (the longest), else its own host without www. or m.',
  RR.marketplaceOf('https://www.finn.no/recommerce/1', ['tise.com', 'finn.no']) === 'finn.no' && RR.marketplaceOf('https://m.tise.com/p', []) === 'tise.com'
  && RR.marketplaceOf('https://www.blocket.se/annons/1') === 'blocket.se' && RR.marketplaceOf('http://finn.no/x') === null
  && RR.marketplaceOf('https://a.b.example/x', ['b.example', 'a.b.example']) === 'a.b.example')
check('a price story: 1–100 steps in order from the listing\'s day up to tomorrow, prices from 0 below a billion',
  RR.pricesProblem([{ on: '2026-11-01', price: 5000 }, { on: '2026-11-05', price: 4500 }], '2026-11-01', '2026-11-11') === null
  && RR.pricesProblem([], '2026-11-01', '2026-11-11') !== null
  && RR.pricesProblem([{ on: '2026-10-31', price: 1 }], '2026-11-01', '2026-11-11') !== null
  && RR.pricesProblem([{ on: '2026-11-05', price: 1 }, { on: '2026-11-04', price: 1 }], '2026-11-01', '2026-11-11') !== null
  && RR.pricesProblem([{ on: '2026-11-12', price: 1 }], '2026-11-01', '2026-11-11') !== null
  && RR.pricesProblem([{ on: '2026-11-01', price: NaN }], '2026-11-01', '2026-11-11') !== null
  && RR.pricesProblem([{ on: '2026-11-01', price: 1e9 }], '2026-11-01', '2026-11-11') !== null
  && RR.pricesProblem([{ on: '2026-02-30', price: 1 }], '2026-01-01', '2026-11-11') !== null
  && RR.pricesProblem(Array.from({ length: 101 }, () => ({ on: '2026-11-01', price: 1 })), '2026-11-01', '2026-11-11') !== null)
check('…with at most two decimals (192 refuses a third); every amount below a billion, here and in 192',
  RR.pricesProblem([{ on: '2026-11-01', price: 4999.995 }], '2026-11-01', '2026-11-11') !== null && RR.pricesProblem([{ on: '2026-11-01', price: 19.99 }], '2026-11-01', '2026-11-11') === null
  && !RR.isPrice(1e9) && RR.isPrice(999999999.99) && !RR.isPrice(1e300) && RR.MAX_AMOUNT === 1e9
  && /price\s+numeric not null check \(price >= 0 and price < 1000000000\)/.test(sql) && /amount < 1000000000/.test(sql) && /value < 1000000000/.test(sql)
  && /pg_catalog\.scale\(v_price\) > 2/.test(sql))
{
  const note = { id: uid(1), user_id: USER, item_id: uid(2), ad_url: 'https://finn.no/x', marketplace: 'finn.no', price: '2400', currency: 'NOK', condition: 'good',
    asking: true, noted_on: '2026-11-01', created_at: T, updated_at: T }
  const listing = { id: uid(3), user_id: USER, item_id: uid(2), marketplace: null, ad_url: null, status: 'for_sale', listed_on: '2026-11-01', for_sale_on: '2026-11-02',
    ended_on: null, currency: 'NOK', prices: [{ on: '2026-11-01', price: 5000 }], ad_text: null, closed_by_sale: false, created_at: T, updated_at: T }
  check('rows read back are checked: a numeric as text is a number; an unknown condition, a forged link, NaN, a bad day or a strange status is no row',
    RR.parseAdNote(note)?.price === 2400 && RR.parseAdNote({ ...note, condition: 'mint' }) === null && RR.parseAdNote({ ...note, ad_url: 'javascript:x' }) === null
    && RR.parseAdNote({ ...note, price: 'NaN' }) === null && RR.parseAdNote({ ...note, noted_on: '2026-02-30' }) === null && RR.parseAdNote({ ...note, id: 'x' }) === null
    && RR.parseListing(listing)?.prices.length === 1 && RR.parseListing({ ...listing, status: 'gone' }) === null
    && RR.parseListing({ ...listing, prices: [{ on: 'x', price: 1 }] }) === null && RR.parseListing({ ...listing, prices: [] }) === null
    && RR.parseValuePoint({ id: uid(4), user_id: USER, item_id: uid(2), valued_on: '2026-11-01', value: '1500.50', currency: 'EUR', created_at: T, updated_at: T })?.value === 1500.5
    && RR.parseTradeInQuote({ id: uid(5), user_id: USER, item_id: uid(2), dealer: '  ', amount: 1, currency: 'NOK', condition: null, quoted_on: '2026-11-01', note: null, created_at: T, updated_at: T }) === null)
  check('a checklist\'s steps: one per line, blank lines left out', eq(RR.checklistSteps(' One \n\nTwo\n  \nThree'), ['One', 'Two', 'Three']))
}

// ── 2. Evidence ──────────────────────────────────────────────────────────────
console.log('\n2 · The evidence and the suggested range')
const phone = item({ id: uid(10), title: 'Sony WH-1000XM5', price: 3490, value_now: 2600, value_currency: 'NOK', value_on: '2026-04-01' })
const others = [
  item({ id: uid(11), title: 'Sony  WH 1000-XM5', price: 3990, disposal: 'sold', disposed_on: '2026-08-01', sale_price: 2500, sale_currency: 'NOK' }),
  item({ id: uid(12), title: 'Other headphones', ean: '4548736132610', price: 3000, disposal: 'traded_in', disposed_on: '2026-09-01', sale_price: 1200, sale_currency: 'NOK' }),
  item({ id: uid(13), title: 'Sony WH-1000XM5', price: 3490, disposal: 'sold', disposed_on: '2026-07-01', sale_price: 200, sale_currency: 'EUR', sale_fx_nok: null }),
  item({ id: uid(14), title: 'Sony WH-1000XM4', price: 2990, disposal: 'sold', disposed_on: '2026-08-01', sale_price: 1500, sale_currency: 'NOK' }),
  item({ id: uid(15), title: 'Sony WH-1000XM5', price: 3490, list: 'quick', disposal: 'sold', disposed_on: '2026-08-01', sale_price: 9999, sale_currency: 'NOK' }),
]
const notes = [
  { id: uid(20), user_id: USER, item_id: phone.id, ad_url: 'https://www.finn.no/1', marketplace: 'finn.no', price: 2800, currency: 'NOK', condition: 'good', asking: true, noted_on: '2026-11-02', created_at: T, updated_at: T },
  { id: uid(21), user_id: USER, item_id: phone.id, ad_url: 'https://www.finn.no/2', marketplace: 'finn.no', price: 2300, currency: 'NOK', condition: 'like_new', asking: false, noted_on: '2026-11-05', created_at: T, updated_at: T },
  { id: uid(22), user_id: USER, item_id: phone.id, ad_url: 'https://www.finn.no/3', marketplace: 'finn.no', price: 500, currency: 'NOK', condition: 'for_parts', asking: true, noted_on: '2026-11-06', created_at: T, updated_at: T },
  { id: uid(23), user_id: USER, item_id: phone.id, ad_url: 'https://tise.com/4', marketplace: 'tise.com', price: 3200, currency: 'NOK', condition: 'good', asking: true, noted_on: '2026-03-01', created_at: T, updated_at: T },
  { id: uid(24), user_id: USER, item_id: uid(99), ad_url: 'https://finn.no/5', marketplace: 'finn.no', price: 100, currency: 'NOK', condition: null, asking: true, noted_on: '2026-11-06', created_at: T, updated_at: T },
]
const quotes = [{ id: uid(30), user_id: USER, item_id: phone.id, dealer: 'A store', amount: 1400, currency: 'NOK', condition: 'good', quoted_on: '2026-11-03', note: null, created_at: T, updated_at: T }]
const values = [{ id: uid(40), user_id: USER, item_id: phone.id, valued_on: '2026-10-01', value: 2700, currency: 'NOK', created_at: T, updated_at: T }]
const watch = { item_id: phone.id, user_id: USER, url: 'https://www.prisjakt.no/product.php?p=1', checked_at: '2026-11-08T05:23:00Z', status: 'ok', error: null, source: 'prisjakt',
  name: null, image: null, low: 3290, high: 3990, offers: 5, currency: 'NOK', in_stock: null, was: null, return_days: null, last_ok_at: '2026-11-08T05:23:00Z',
  prev_low: null, prev_at: null, condition: 'new', used_low: 2600, refurbished_low: 2900 }
const input = deepFreeze({ item: phone, items: [phone, ...others], adNotes: notes, quotes, values, watch, rates, today: TODAY })
const ev = EV.resaleEvidence(input)
const kinds = ev.rows.map(r => `${r.kind}:${r.amount}:${r.counts ? 'y' : r.why}`)
check('the list: own sales of the same model (by name or barcode), asks and sales noted, Prisjakt\'s used and refurbished, the quote, your estimates — newest first',
  eq(kinds, ['dealer_refurbished:2900:y', 'dealer_used:2600:y', 'ad_ask:500:for parts', 'ad_sold:2300:y', 'trade_in:1400:y', 'ad_ask:2800:y',
    'estimate:2700:your own estimate', 'own_sale:2500:y', 'own_sale:200:no rate yet', 'estimate:2600:your own estimate', 'ad_ask:3200:older than six months']), kinds.join(' | '))
check('…another model, a quick-list tick and another thing\'s note are not evidence; the thing\'s own barcode needs one to compare (none here)',
  !ev.rows.some(r => r.ref === uid(14) || r.ref === uid(15) || r.ref === uid(24) || r.ref === uid(12)))
{
  const withEan = EV.evidenceRows({ ...input, item: { ...phone, ean: '4548736132610' } })
  check('…a barcode match is the same model whatever its name says (a trade-in of yours: a floor); without a barcode on both, the name decides',
    withEan.some(r => r.ref === uid(12) && r.kind === 'own_trade_in' && r.counts) && withEan.some(r => r.ref === uid(11))
    && !EV.sameModel({ id: 'a', title: 'Sony WH-1000XM5', ean: '1' }, { id: 'b', title: 'Sony WH-1000XM5', ean: '2' }), withEan.map(r => r.ref.slice(-2)).join(','))
}
const firstNote = ev.rows.find(r => r.ref === uid(21))
check('each row says where it is from, its day and its condition; an ad keeps its link (never fetched)',
  firstNote.source === 'finn.no ad, sold' && firstNote.on === '2026-11-05' && firstNote.condition === 'like_new' && firstNote.link === 'https://www.finn.no/2'
  && ev.rows.find(r => r.kind === 'trade_in').source === 'A store\'s trade-in quote' && ev.rows.find(r => r.kind === 'dealer_used').on === '2026-11-08')
check('the current "Could sell for" (from before the history) is listed beside the history\'s estimates, never counted',
  ev.rows.filter(r => r.kind === 'estimate').map(r => r.on).join() === '2026-10-01,2026-04-01' && ev.rows.filter(r => r.kind === 'estimate').every(r => !r.counts))
check('the range: sold and asked prices span it (2 300–2 800), the dealer\'s used 2 600 caps it, the trade-in floor 1 400 is below — 2 300–2 600, Use offers 2 450',
  ev.range && ev.range.low === 2300 && ev.range.high === 2600 && ev.range.mid === 2450 && ev.range.count === 6, JSON.stringify(ev.range))
check('…and says what it is from', ev.range.basis === 'From 1 sale of yours, 1 sold ad, 1 ask, 1 trade-in quote, 1 used offer and 1 refurbished offer', ev.range.basis)
check('nothing is filled in and nothing changed: the input is frozen and the thing keeps its own "Could sell for"', phone.value_now === 2600 && Object.isFrozen(input.item))
{
  const row = (kind, nok) => ({ kind, amount: nok, currency: 'NOK', nok, on: TODAY, condition: null, source: '', link: null, ref: kind + nok, counts: true, why: null })
  const r = rows => EV.suggestedRange(rows)
  check('a trade-in above every price seen is the range (a dealer pays at least that)', eq(r([row('ad_ask', 1000), row('trade_in', 1500)]), { low: 1500, high: 1500, mid: 1500, count: 2, basis: 'From 1 ask and 1 trade-in quote' }))
  check('a floor inside the span lifts its low end; a cap below the low end leaves one price', (() => { const a = r([row('ad_ask', 1000), row('ad_ask', 2000), row('trade_in', 1200)]); const b = r([row('ad_ask', 1000), row('ad_ask', 2000), row('dealer_used', 800)]); return a.low === 1200 && a.high === 2000 && b.low === 1000 && b.high === 1000 })())
  check('only a quote: at least that; only a dealer\'s price: up to that; a quote and a cap make the range',
    eq([r([row('trade_in', 900)]).low, r([row('trade_in', 900)]).high, r([row('trade_in', 900)]).mid], [900, null, null])
    && eq([r([row('dealer_used', 2000)]).low, r([row('dealer_used', 2000)]).high], [null, 2000])
    && eq([r([row('trade_in', 900), row('dealer_refurbished', 2000)]).low, r([row('trade_in', 900), row('dealer_refurbished', 2000)]).high], [900, 2000]))
  check('no row that counts, no range (estimates alone never make one)', r([]) === null && r([{ ...row('estimate', 2000), counts: false, why: 'your own estimate' }]) === null)
  const onlyEstimates = EV.resaleEvidence({ ...input, items: [phone], adNotes: [], quotes: [], watch: null })
  check('a thing with only your estimates has its list and no range', onlyEstimates.range === null && onlyEstimates.rows.length === 2)
}
check('an amount in another currency counts at today\'s rate; a sale\'s at its own day\'s (pending: not counted)',
  EV.evidenceRows({ ...input, adNotes: [{ ...notes[0], price: 250, currency: 'EUR' }] }).find(r => r.ref === uid(20)).nok.toFixed(2) === '2777.78'
  && ev.rows.find(r => r.ref === uid(13)).nok === null)
check('a model\'s name is compared without case, accents, spaces or signs', EV.modelKey('Sony  WH-1000XM5') === EV.modelKey('sony wh 1000xm5') && EV.modelKey('Kjøkkenvekt Ø') === 'kjøkkenvektø'.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  && !EV.sameModel(phone, phone))

// ── 3. The nudge ─────────────────────────────────────────────────────────────
console.log('\n3 · The nudge: "12 days, no sale; yours usually go in 9 — lower it?"')
const L = (p) => ({ id: p.id, user_id: USER, item_id: p.item_id ?? uid(200), marketplace: 'finn.no', ad_url: null, status: p.status ?? 'sold', listed_on: p.listed_on ?? '2026-01-01',
  for_sale_on: p.for_sale_on ?? null, ended_on: p.ended_on ?? null, currency: 'NOK', prices: p.prices ?? [{ on: p.listed_on ?? '2026-01-01', price: 1000 }], ad_text: null,
  closed_by_sale: p.status === 'sold', created_at: T, updated_at: T })
const sold = [
  L({ id: 's1', item_id: uid(201), for_sale_on: '2026-01-02', ended_on: '2026-01-10' }),
  L({ id: 's2', item_id: uid(202), for_sale_on: '2026-02-01', ended_on: '2026-02-10' }),
  L({ id: 's3', item_id: uid(203), for_sale_on: '2026-03-01', ended_on: '2026-03-20' }),
  L({ id: 's4', item_id: uid(204), status: 'withdrawn', for_sale_on: '2026-04-01', ended_on: '2026-06-01' }),
  L({ id: 's5', item_id: uid(205), listed_on: '2026-05-01', ended_on: '2026-05-04' }),
]
const up = L({ id: 'now', item_id: uid(206), status: 'for_sale', listed_on: '2026-10-28', for_sale_on: '2026-10-29' })
check('"yours usually go in": the median days from going up to the sale, of your sold listings (a withdrawn one never counts; one sold from Listed counts from its day)',
  eq(LN.typicalDaysToSell(sold), { days: 9, count: 4, scope: 'all' }) && LN.daysToSell(sold[4]) === 3 && LN.daysToSell(sold[3]) === null, JSON.stringify(LN.typicalDaysToSell(sold)))
check('…the category\'s own from three sold, else all of yours from three, else none',
  eq(LN.typicalDaysToSell(sold, new Set([uid(201), uid(202), uid(205)])), { days: 8, count: 3, scope: 'category' })
  && LN.typicalDaysToSell(sold, new Set([uid(201)])).scope === 'all' && LN.typicalDaysToSell(sold.slice(0, 2)) === null)
{
  const nudge = LN.listingNudge(up, [...sold, up], TODAY)
  check('12 days for sale with no sale, yours usually 9: the owner\'s words', nudge && nudge.words === '12 days, no sale; yours usually go in 9 — lower it?' && nudge.days === 12, nudge?.words)
  check('…not before it waited longer than usual (9 days: none)', LN.listingNudge(up, sold, '2026-11-07') === null && LN.listingNudge(up, sold, '2026-11-08') !== null)
  const cut = { ...up, prices: [{ on: '2026-10-28', price: 1000 }, { on: '2026-11-06', price: 900 }] }
  check('a price cut starts the wait again (4 days at this price: none), and later says "at this price"',
    LN.listingNudge(cut, sold, TODAY) === null && LN.listingNudge(cut, sold, '2026-11-16')?.words === '10 days at this price, no sale; yours usually go in 9 — lower it?')
  check('with fewer than three sold: two weeks, and no "usually"', LN.listingNudge(up, sold.slice(0, 2), '2026-11-12') === null
    && LN.listingNudge(up, sold.slice(0, 2), '2026-11-13')?.words === '15 days, no sale — lower it?')
  check('only a listing for sale is nudged (listed, sold, withdrawn: never)', ['listed', 'sold', 'withdrawn'].every(s => LN.listingNudge({ ...up, status: s }, sold, '2027-01-01') === null))
  check('the price now is the story\'s last step; a change on the last step\'s day replaces it, an earlier one is refused',
    LN.priceNow(cut) === 900 && LN.firstPrice(cut) === 1000 && eq(LN.withPriceChange(cut.prices, 800, '2026-11-06'), [{ on: '2026-10-28', price: 1000 }, { on: '2026-11-06', price: 800 }])
    && LN.withPriceChange(cut.prices, 800, '2026-11-01') === null && LN.withPriceChange(cut.prices, 800, TODAY).length === 3)
}

// ── 4. New vs used vs refurbished ────────────────────────────────────────────
console.log('\n4 · New vs used vs refurbished, from your own kept %')
const CAT = uid(300), SUB = uid(301)
const own = [
  item({ category_id: SUB, price: 10000, disposal: 'sold', disposed_on: '2026-05-10', sale_price: 6000, sale_currency: 'NOK' }),
  item({ category_id: SUB, price: 5000, disposal: 'sold', disposed_on: '2026-11-10', sale_price: 2500, sale_currency: 'NOK' }),
  item({ category_id: CAT, price: 4000, disposal: 'traded_in', disposed_on: '2026-02-10', sale_price: 2800, sale_currency: 'NOK' }),
  item({ category_id: CAT, price: 2000, used: true, disposal: 'sold', disposed_on: '2026-05-10', sale_price: 1600, sale_currency: 'NOK' }),
  item({ category_id: null, price: 3000, disposal: 'sold', disposed_on: '2026-05-10', sale_price: 300, sale_currency: 'NOK' }),
  item({ category_id: SUB, price: 0, got_as_gift: true, disposal: 'sold', disposed_on: '2026-05-10', sale_price: 900, sale_currency: 'NOK' }),
  item({ category_id: SUB, price: 1000, currency: 'EUR', fx_nok: null, disposal: 'sold', disposed_on: '2026-05-10', sale_price: 500, sale_currency: 'EUR' }),
  item({ category_id: SUB, price: 1000, disposal: 'given', disposed_on: '2026-05-10' }),
  item({ category_id: SUB, price: 1000 }),
]
const scope = new Set([CAT, SUB])
check('kept %: the share that came back, for things sold or traded in with a price — never a gift, a rate still pending, given away or still yours',
  OC.keptSales(own).length === 5 && OC.keptSales(own).every(s => s.share > 0))
{
  const k = OC.keptShare(own, scope, false)
  check('…the category\'s own when three of yours left there: new ones apart (60 %, 50 %, 70 % → 60 %, about 9 months)',
    k && k.scope === 'category' && k.bought === 'new' && k.pct === 60 && k.count === 3 && Math.round(k.months) === 12, JSON.stringify(k))
  const u = OC.keptShare(own, scope, true)
  check('…used ones apart only with three of them there; else both kinds (4 sales: 60–80 % → 65 %)', u && u.bought === 'any' && u.count === 4 && u.pct === 65, JSON.stringify(u))
  const all = OC.keptShare(own, new Set([uid(399)]), false)
  check('…a category with fewer than three: all of yours (median of five)', all && all.scope === 'all' && all.count === 4 && all.bought === 'new', JSON.stringify(all))
  check('…no sale at all: none', OC.keptShare([item({ price: 100 })], null, false) === null)
}
{
  const c = OC.ownershipCost({ items: own, categoryIds: scope, prices: { new: 8000, used: 5000, refurbished: 6000 }, currency: 'NOK', rates })
  const by = Object.fromEntries(c.options.map(o => [o.kind, o]))
  check('the net cost of each: new 8 000 keeping 60 % = 3 200; used and refurbished at the both-kinds 65 % = 1 750 and 2 100',
    by.new.net === 3200 && by.new.getBack === 4800 && by.used.net === 1750 && by.refurbished.net === 2100 && c.cheapest === 'used' && c.note === null, JSON.stringify(c.options.map(o => [o.kind, o.net])))
  check('…per month over the months yours were usually kept', by.new.perMonth === Math.round(3200 / by.new.kept.months))
  const eur = OC.ownershipCost({ items: own, categoryIds: scope, prices: { new: 700 }, currency: 'EUR', rates: null })
  check('a price waiting for today\'s rate has no net cost, and says so', eur.options[0].net === null && eur.note === 'A price waits for today\'s rate')
  const none = OC.ownershipCost({ items: [], categoryIds: null, prices: { new: 1000, used: null }, currency: 'NOK', rates })
  check('no sale of yours yet: no kept %, no net cost — the note says where it comes from; a missing price is left out',
    none.options.length === 1 && none.options[0].net === null && /kept % comes from those/.test(none.note) && none.cheapest === null)
}

// ── 5. The ad and the checklist ──────────────────────────────────────────────
console.log('\n5 · The ad and the hand-over checklist')
const unE = s => s.replace(/\\n/g, '\n').replace(/''/g, "'")
const tplBlock = sql.match(/function public\.shop_resale_default_templates\(\)[\s\S]*?\$\$;/)?.[0] ?? ''
const seeds = [...tplBlock.matchAll(/\((null::text|'[^']*'), (null::text|'[^']*'), '(nb|en)', '((?:[^']|'')*)',\s*E'((?:[^'\\]|\\.|'')*)'\)/g)].map(m => ({
  id: m[1], user_id: USER, marketplace: m[1] === 'null::text' ? null : m[1].slice(1, -1), category: m[2] === 'null::text' ? null : m[2].slice(1, -1),
  language: m[3], title: unE(m[4]), body: unE(m[5]), created_at: T, updated_at: T,
}))
check('192 seeds three templates, in Norwegian: finn.no, tise.com and any other marketplace, for any category',
  eq(seeds.map(s => `${s.marketplace}:${s.category}:${s.language}`), ['finn.no:null:nb', 'tise.com:null:nb', 'null:null:nb']), JSON.stringify(seeds.map(s => s.marketplace)))
check('…each names only fields the app fills, and every field the app has', seeds.every(s => !TX.unknownFields(s.title + s.body).length)
  && TX.AD_FIELDS.every(f => seeds.some(s => (s.title + s.body).includes(`{${f}}`))))
check('…in Norwegian, with its letters (æ ø å) as they are', seeds.every(s => /Kjøpt \{bought\}/.test(s.body) && /Medfølger: \{accessories\}/.test(s.body)) && /Selger \{name\}/.test(seeds[0].body))
{
  const facts = { name: 'Sony WH-1000XM5', condition: 'good', bought: '2025-05-10', price: 2400, currency: 'NOK', accessories: ['etui', 'ladekabel', 'eske'] }
  const ad = TX.fillAd(seeds[0], facts)
  check('a filled FINN ad: title "name – condition", the day DD.MM.YYYY, the price in kr, the accessories with "og"',
    ad.title === 'Sony WH-1000XM5 – pent brukt'
    && ad.body === 'Selger Sony WH-1000XM5.\nTilstand: pent brukt.\nKjøpt 10.05.2025.\nMedfølger: etui, ladekabel og eske.\n\nPris: 2 400 kr.\nKan hentes eller sendes. Send gjerne en melding hvis du lurer på noe.'
    && !ad.unknown.length, JSON.stringify(ad))
  const bare = TX.fillAd(seeds[0], { name: 'Kettle' })
  check('…a line whose field has nothing to say goes (no condition, day, accessories or price); a title without its field falls back to the name',
    bare.title === 'Kettle' && bare.body === 'Selger Kettle.\n\nKan hentes eller sendes. Send gjerne en melding hvis du lurer på noe.', JSON.stringify(bare))
  check('…an approximate day says "ca.", another currency its code; English says "about", "and", NOK',
    TX.fillAd(seeds[1], { ...facts, approx: true, price: 100, currency: 'EUR' }).body.includes('Kjøpt ca. 10.05.2025.') && TX.fillAd(seeds[1], { ...facts, price: 100, currency: 'EUR' }).body.includes('Pris: 100 EUR.')
    && TX.fillAd({ title: '{name}', body: 'Bought {bought}. With {accessories}. {price}. {condition}.', language: 'en' }, { ...facts, approx: true }).body === 'Bought about 10.05.2025. With etui, ladekabel and eske. 2 400 NOK. good.')
  check('an accessory\'s name stays on one line (a newline or a tab in it is a space), as the thing\'s name does',
    TX.fillAd(seeds[0], { ...facts, accessories: ['etui\nmed glidelås', '  lader\t ', ''] }).body.includes('Medfølger: etui med glidelås og lader.')
    && !TX.fillAd(seeds[0], { ...facts, accessories: ['a\nPris: 1 kr'] }).body.includes('\nPris: 1 kr'))
  check('…a field the app doesn\'t know stays as typed and is named', eq(TX.fillAd({ title: '{name}', body: 'Serial: {serial}', language: 'nb' }, facts), { title: 'Sony WH-1000XM5', body: 'Serial: {serial}', unknown: ['serial'] }))
  check('the ad holds only what the owner chose: the fields are the five, never a serial number or who bought it', eq(Object.keys(TX.fieldValues(facts, 'nb')), [...TX.AD_FIELDS]))
}
{
  const own = [...seeds, { ...seeds[0], id: 'phones-finn', category: 'Phones', title: '{name}', created_at: '2026-11-11T00:00:00Z' },
    { ...seeds[2], id: 'phones-any', category: 'Mobile phones', created_at: '2026-11-11T00:00:00Z' }]
  check('the template: its marketplace\'s for its category, then its marketplace\'s, then any marketplace\'s for its category, then any',
    TX.templateFor(own, 'finn.no', ['Smartphones', 'Electronics'])?.id === 'phones-finn' && TX.templateFor(own, 'finn.no', ['Laptops', 'Electronics'])?.id === "'finn.no'"
    && TX.templateFor(own, 'dba.dk', ['Phones'])?.id === 'phones-any' && TX.templateFor(own, null, ['Bikes'])?.id === 'null::text' && TX.templateFor([], 'finn.no', []) === null)
  const blockC = sql.match(/function public\.shop_resale_default_checklists\(\)[\s\S]*?\$\$;/)?.[0] ?? ''
  const lists = [...blockC.matchAll(/\('([^']+)',\s*((?:E?'(?:[^']|'')*'\s*)+)\)/g)].map(m => ({
    id: m[1], user_id: USER, category: m[1], steps: unE([...m[2].matchAll(/E?'((?:[^']|'')*)'/g)].map(x => x[1]).join('')), created_at: T, updated_at: T,
  }))
  check('192 seeds checklists for phones, game consoles and computers — the taxonomy\'s names', eq(lists.map(l => l.category), ['Phones', 'Game Consoles', 'Computers & Laptops']))
  const phoneSteps = RR.checklistSteps(lists[0].steps).join(' | ')
  check('…a phone\'s: back up, BankID, sign out of iCloud / Google, factory reset, the SIM and the memory card, the charger and the box',
    /Back up/.test(phoneSteps) && /BankID/.test(phoneSteps) && /iCloud/.test(phoneSteps) && /Google/.test(phoneSteps) && /Factory reset/.test(phoneSteps) && /SIM card and the memory card/.test(phoneSteps) && /charger/.test(phoneSteps) && /box/.test(phoneSteps)
    && RR.checklistSteps(lists[0].steps).length === 8 && /PlayStation Network/.test(lists[1].steps) && /Reset this PC/.test(lists[2].steps), phoneSteps)
  check('…in English (the owner reads them in the app)', lists.every(l => !/[æøå]/i.test(l.steps)))
  check('a thing finds its checklist through other names for its category, its subcategory\'s before its top\'s',
    TX.checklistFor(lists, ['Mobile phones', 'Electronics'])?.id === 'Phones' && TX.checklistFor(lists, ['Consoles'])?.id === 'Game Consoles'
    && TX.checklistFor(lists, ['laptops', 'Tech'])?.id === 'Computers & Laptops' && TX.checklistFor(lists, ['Headphones', 'Electronics']) === null && TX.checklistFor(lists, []) === null)
  check('categories match without case, spaces or "&"/"and" — never a top for one of its subcategories',
    TX.sameCategory('computers and laptops', 'Computers & Laptops') && TX.sameCategory('Tech', 'Electronics') && !TX.sameCategory('Electronics', 'Phones') && !TX.sameCategory('Gaming', 'Game Consoles'))
}

// ── 6. The data layer ────────────────────────────────────────────────────────
console.log('\n6 · The data layer')
const ITEM = uid(500)
{
  const note = await API.createAdNote({ item_id: ITEM, ad_url: ' HTTPS://www.FINN.no/recommerce/1 a\u202eb', price: 2400, marketplace: 'FINN.no ', condition: 'good' })
  const sent = calls[calls.length - 1].row
  check('a noted ad is the caller\'s own row, its link as the URL parser writes it and its marketplace tidied, and its answer read back', sent.user_id === USER && sent.ad_url === 'https://www.finn.no/recommerce/1%20a%E2%80%AEb'
    && sent.marketplace === 'finn.no' && note.price === 2400 && note.item_id === ITEM, JSON.stringify(sent))
  const before = calls.length
  const refusals = await Promise.all([
    API.createAdNote({ item_id: ITEM, ad_url: 'http://finn.no/x', price: 1 }),
    API.createAdNote({ item_id: ITEM, ad_url: 'https://tise.com/x', price: 1, marketplace: 'finn.no' }),
    API.createAdNote({ item_id: ITEM, ad_url: 'https://finn.no/x', price: NaN }),
    API.createAdNote({ item_id: ITEM, ad_url: 'https://finn.no/x', price: 1, currency: 'SEK' }),
    API.createAdNote({ item_id: ITEM, ad_url: 'https://finn.no/x', price: 1, condition: 'mint' }),
    API.createTradeInQuote({ item_id: ITEM, dealer: '  ', amount: 1 }),
    API.createListing({ item_id: ITEM, price: 1, status: 'sold' }, TODAY),
    API.createListing({ item_id: ITEM, price: 1, listed_on: '2026-11-12' }, TODAY),
    API.createChecklist({ category: 'Drones', steps: 'x\n'.repeat(61) }),
    API.createAdTemplate({ title: 'x', body: 'y', language: 'de' }),
    API.createAdNote({ item_id: ITEM, ad_url: 'https://finn.no/x', price: 1e9 }),
    API.createTradeInQuote({ item_id: ITEM, dealer: 'A store', amount: 1e300 }),
    API.createListing({ item_id: ITEM, price: 10.005 }, TODAY),
  ].map(p => p.then(() => 'sent', e => e.message)))
  check('what 192 would refuse is refused here first, in plain words, and nothing is sent', refusals.every(r => r !== 'sent') && calls.length === before, refusals.join(' | '))
  const listing = await API.createListing({ item_id: ITEM, price: 5000, marketplace: 'finn.no', status: 'for_sale' }, TODAY)
  const sentL = calls[calls.length - 1].row
  check('a listing starts with its asking price as the price story\'s first step, on its day', eq(sentL.prices, [{ on: TODAY, price: 5000 }]) && sentL.listed_on === TODAY && sentL.status === 'for_sale' && listing.prices.length === 1)
  const soldRefused = await API.updateListing(listing, { status: 'sold' }, TODAY).then(() => 'sent', e => e.message)
  check('Sold is never written by hand: it comes from recording the sale', /recording the sale/.test(soldRefused))
  await API.updateListing(listing, { status: 'withdrawn' }, TODAY)
  const up = calls[calls.length - 1]
  check('a change is scoped to the caller\'s own row and sends only what it names', up.op === 'update' && eq(up.eqs, [['id', listing.id], ['user_id', USER]]) && eq(up.patch, { status: 'withdrawn' }), JSON.stringify(up))
  const gone = await API.updateTradeInQuote(uid(999), { amount: 5 }).then(() => 'sent', e => e.message)
  check('a change of a row that isn\'t there (or is someone else\'s) is an error, never a silent no-op', /not there any more/.test(gone))
  tables.shop_ad_notes = Array.from({ length: 2300 }, (_, k) => ({ id: uid(10000 + k), user_id: USER, item_id: ITEM, ad_url: 'https://finn.no/x', marketplace: null, price: k, currency: 'NOK',
    condition: null, asking: true, noted_on: '2026-11-01', created_at: T, updated_at: T }))
  calls.length = 0
  const all = await API.fetchAdNotes()
  check('a read takes every page (2 300 rows over three) in one total order, the id last', all.length === 2300 && calls.length === 3 && calls.every(c => c.orders[c.orders.length - 1][0] === 'id'))
  failing.shop_listings = { code: 'PGRST205', message: 'Could not find the table' }
  const none = await API.fetchListings()
  const named = await API.createListing({ item_id: ITEM, price: 1 }, TODAY).then(() => 'sent', e => e.message)
  check('before 192 a read answers nothing and a write says so by name', eq(none, []) && named === API.NEEDS_192, named)
  delete failing.shop_listings
  rpcAnswer = () => ({ data: 6, error: null })
  check('Put back the defaults is one call that answers how many came back', (await API.addResaleDefaults()) === 6 && rpcCalls[rpcCalls.length - 1].fn === 'shop_add_resale_defaults')
}
{
  const hooks = read('src/features/shop/hooks/useShopResale.ts')
  check('every hook mutation goes through useMutationWithFeedback, each with its words or the reason it is silent',
    !/useMutation\(/.test(hooks) && (hooks.match(/useMutationWithFeedback\(\{/g) || []).length === (hooks.match(/successMessage:|silent:/g) || []).length
    && (hooks.match(/useMutationWithFeedback\(\{/g) || []).length >= 12)
  check('every delete asks and offers Undo (the one delete flow), for each of the five tables the app deletes from',
    ['shop_ad_notes', 'shop_trade_in_quotes', 'shop_listings', 'shop_ad_templates', 'shop_handover_checklists'].every(t => new RegExp(`useRowsDelete\\(\\{ table: '${t}'`).test(hooks)) && !/\.delete\(/.test(hooks))
  check('keys only from qk; no supabase in the hooks; a listing\'s change says its result with Undo', !/queryKey: \[/.test(hooks) && !/integrations\/supabase/.test(hooks) && /toast\.undo\(v\.done/.test(hooks))
  const keys = read('src/shared/query/keys.ts')
  check('the value history sits under the items\' key (a value edit refreshes it); every resale list under one root that a delete or a sale refreshes',
    /valueHistory: \(\) => \['shop', 'items', 'value-history'\]/.test(keys) && /SHOP_ROWS = \[[^\]]*qk\.shop\.resale\(\)/.test(read('src/features/shop/hooks/useShop.ts')))
  const ai = read('supabase/functions/ai-proxy/index.ts')
  const access = t => ai.match(new RegExp(`\\n  ${t}: \\{\\n    access: '(rw|ro)'`))?.[1]
  check('the database\'s text bounds count every character and need one that is not a space (never char_length(btrim(…)))',
    !/char_length\(btrim\(/.test(sql.replace(/--.*$/gm, '')) && (sql.match(/ ~ '\\S'/g) || []).length === 6)
  check('the assistant: ad notes, quotes and listings as the owner types them (rw); the value history, templates and checklists read only',
    access('shop_ad_notes') === 'rw' && access('shop_trade_in_quotes') === 'rw' && access('shop_listings') === 'rw'
    && access('shop_value_history') === 'ro' && access('shop_ad_templates') === 'ro' && access('shop_handover_checklists') === 'ro')
  const noWrite = new RegExp(ai.match(/const AI_NO_WRITE = \/(.+)\/\n/)?.[1] ?? '$^')
  check('…and never an ad\'s link, an ad\'s text or a listing\'s closed_by_sale (AI_NO_WRITE)', noWrite.test('ad_url') && noWrite.test('ad_text') && noWrite.test('closed_by_sale') && !noWrite.test('url'))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
