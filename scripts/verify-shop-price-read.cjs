#!/usr/bin/env node
/*
 * Verification — Shop's price watch reader (src/features/shop/priceRead.ts)
 * and its hand mirror in supabase/functions/shop-price/index.ts.
 * The fixtures are the JSON-LD blocks of real pages, fetched 08.10.2026 and
 * trimmed (Prisjakt product group + product, an Elkjøp product page, a
 * Cloudflare check page), and a Prisjakt product page fetched once on
 * 10.11.2026 (scripts/fixtures/prisjakt/: its schema.org block and its own
 * offer list, where each offer says New, Refurbished or Used).
 * Run: node scripts/verify-shop-price-read.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const { readPrice, parsePrice, isChallengePage, isPrisjaktUrl, jsonLdNodes, listedSite } = require('../src/features/shop/priceRead')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const page = (...blocks) => `<!doctype html><html><head><title>Page</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>${blocks.map(b => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('')}</head><body></body></html>`

console.log('\n1 · The edge function carries the same reader')
{
  const block = (file) => {
    const s = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    const a = s.indexOf('// <price-read>')
    const b = s.indexOf('// </price-read>')
    return a >= 0 && b > a ? s.slice(a, b) : null
  }
  const src = block('src/features/shop/priceRead.ts')
  const fn = block('supabase/functions/shop-price/index.ts')
  check('both files have the <price-read> block', !!src && !!fn)
  check('shop-price mirror is identical to src/features/shop/priceRead.ts', src === fn, 'copy the block from the src file into the function')
}

const ORG = { '@context': 'https://schema.org', '@type': 'Organization', legalName: 'Prisjakt Norge AS', url: 'https://www.prisjakt.no' }
const offer = (url, low, high, count) => ({ '@type': 'AggregateOffer', url, lowPrice: low, highPrice: high, offerCount: count, priceCurrency: 'NOK' })
const PIXEL = {
  '@context': 'https://schema.org', '@type': 'ProductGroup', name: 'Google Pixel 11 5G 12GB RAM 256GB',
  image: 'https://media.pji.nu/4407af80-ecce-4cb7-b83e-e13007cbf1be.webp', productGroupID: '16929131', variesBy: ['https://schema.org/color'],
  brand: { '@type': 'Brand', name: 'Google' },
  hasVariant: [
    { '@type': 'Product', name: 'Google Pixel 11 5G 12GB RAM 256GB - Hibiscus', image: 'https://media.pji.nu/56be9069.webp', url: 'https://www.prisjakt.no/product.php?p=16929131&a-116257=Hibiscus', offers: offer('https://www.prisjakt.no/product.php?p=16929131&a-116257=Hibiscus', 11940, 12554, 8), color: 'Hibiscus' },
    { '@type': 'Product', name: 'Google Pixel 11 5G 12GB RAM 256GB - Frost', image: 'https://media.pji.nu/4407af80.webp', url: 'https://www.prisjakt.no/product.php?p=16929131&a-116257=Frost', offers: offer('https://www.prisjakt.no/product.php?p=16929131&a-116257=Frost', 11888, 11990, 8), color: 'Frost' },
    { '@type': 'Product', name: 'Google Pixel 11 5G 12GB RAM 256GB - Obsidian', image: 'https://media.pji.nu/6e7cbbf5.webp', url: 'https://www.prisjakt.no/product.php?p=16929131&a-116257=Obsidian', offers: offer('https://www.prisjakt.no/product.php?p=16929131&a-116257=Obsidian', 10457, 11990, 10), color: 'Obsidian' },
  ],
}
const KARCHER = {
  '@context': 'https://schema.org', '@type': 'Product', name: 'Kärcher Puzzi 8/1', image: 'https://cdn.pji.nu/product/standard/800/11802129.jpg',
  brand: { '@type': 'Brand', name: 'Kärcher' }, offers: offer('https://www.prisjakt.no/product.php?p=11802129', 5499, 8990, 11),
}
const policy = (name, days, member) => ({ '@type': 'MerchantReturnPolicy', merchantReturnDays: days, name, ...(member ? { validForMemberTier: { '@type': 'MemberProgramTier', '@id': 'https://www.elkjop.no/kundeklubb' } } : {}) })
const TCL = {
  '@context': 'https://schema.org', '@type': 'Product', name: 'TCL 65" MQLED75K 4K MINI-LED TV (2025)',
  image: 'https://next-media.elkjop.com/image/dv_web_D18000136421836/899848/tcl-65-mqled75k-4k-mini-led-tv-2025.jpg',
  brand: { '@type': 'Brand', name: 'TCL', url: 'https://www.elkjop.no/brand/tcl' }, sku: '899848', gtin13: '5901292527556',
  offers: [
    { '@type': 'Offer', name: 'Standard Price', price: '9990', priceCurrency: 'NOK', availability: 'https://schema.org/InStock',
      eligibleCustomerType: { '@type': 'BusinessEntityType', '@id': 'https://schema.org/Public' },
      priceSpecification: [
        { '@type': 'UnitPriceSpecification', price: '9990', priceCurrency: 'NOK', priceType: 'https://schema.org/SalePrice', name: 'Current price' },
        { '@type': 'UnitPriceSpecification', price: '14999', priceCurrency: 'NOK', priceType: 'https://schema.org/StrikethroughPrice', name: 'Original price' },
      ],
      hasMerchantReturnPolicy: [policy('30-dagers åpent kjøp', 30), policy('50-dagers åpent kjøp (klubbmedlem)', 50, true)] },
    { '@type': 'Offer', name: 'Business Price (Excl. VAT)', price: '7992', priceCurrency: 'NOK', availability: 'https://schema.org/InStock',
      eligibleCustomerType: { '@type': 'BusinessEntityType', '@id': 'https://schema.org/Business' } },
  ],
}

console.log('\n2 · Prisjakt')
{
  const html = page(ORG, PIXEL)
  const g = readPrice(html, 'https://www.prisjakt.no/product.php?p=16929131')
  check('a product group reads ok', g.status === 'ok' && g.source === 'prisjakt')
  check('no colour picked: the cheapest variant is the low, the dearest the high', g.low === 10457 && g.high === 12554, JSON.stringify(g))
  check('shop count is the most any colour has, never a sum', g.offers === 10)
  check('the group keeps its own name and picture', g.name === 'Google Pixel 11 5G 12GB RAM 256GB' && g.image.endsWith('4407af80-ecce-4cb7-b83e-e13007cbf1be.webp'))
  check('brand from the group', g.brand === 'Google')
  const f = readPrice(html, 'https://www.prisjakt.no/product.php?p=16929131&a-116257=Frost')
  check('a colour in the link picks that variant', f.low === 11888 && f.high === 11990 && f.offers === 8 && /Frost$/.test(f.name), JSON.stringify(f))
  const enc = readPrice(html, 'https://www.prisjakt.no/product.php?p=16929131&a-116257=Hibiscus&utm=x')
  check('extra parameters do not stop the match', enc.low === 11940)
  const k = readPrice(page(ORG, KARCHER), 'https://www.prisjakt.no/product.php?p=11802129')
  check('a single product: low, high, shops, NOK', k.status === 'ok' && k.low === 5499 && k.high === 8990 && k.offers === 11 && k.currency === 'NOK')
  check('Prisjakt has no "was" price or return window', k.was === null && k.returnDays === null)
}

console.log('\n3 · A shop page (Elkjøp)')
{
  const t = readPrice(page(TCL), 'https://www.elkjop.no/product/tv/899848')
  check('reads the public price, not the business price without VAT', t.status === 'ok' && t.low === 9990, JSON.stringify(t))
  check('source store, NOK, in stock', t.source === 'store' && t.currency === 'NOK' && t.inStock === true)
  check('the struck-through price is the "was"', t.was === 14999)
  check('the return window open to everyone, not the members-only one', t.returnDays === 30)
  check('gtin and brand', t.gtin === '5901292527556' && t.brand === 'TCL')
  const graph = readPrice(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Product"],"name":"Lamp","offers":{"@type":"Offer","price":"499.00","priceCurrency":"nok"}}]}</script>`, 'https://shop.example/lamp')
  check('@graph and @type arrays are understood; currency upper-cased', graph.status === 'ok' && graph.low === 499 && graph.currency === 'NOK')
  const only = readPrice(page({ '@type': 'Product', name: 'Members only', offers: [{ '@type': 'Offer', price: 100, priceCurrency: 'NOK', eligibleCustomerType: 'https://schema.org/Business' }] }), 'https://x.example/a')
  check('only a restricted offer: it is still read (better than nothing)', only.low === 100)
  const was = readPrice(page({ '@type': 'Product', name: 'Odd', offers: { '@type': 'Offer', price: 900, priceCurrency: 'NOK', priceSpecification: { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/StrikethroughPrice', price: 800 } } }), 'https://x.example/b')
  check('a "was" price lower than the price is ignored', was.was === null)
}

console.log('\n4 · Pages without a price')
{
  const challenge = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body><script>(function(){window._cf_chl_opt = {cType: "managed"}})();</script></body></html>'
  check('a Cloudflare check is "blocked"', readPrice(challenge, 'https://www.prisjakt.no/product.php?p=1').status === 'blocked')
  check('…but Cloudflare\'s script on a real page is not', !isChallengePage(page(KARCHER)))
  const nameOnly = readPrice(page({ '@type': 'Product', name: 'Sold out thing' }), 'https://x.example/c')
  check('a product with no offer: no_price, name kept', nameOnly.status === 'no_price' && nameOnly.name === 'Sold out thing')
  check('a page with no product: no_price', readPrice(page(ORG), 'https://www.prisjakt.no/').status === 'no_price')
  check('broken JSON-LD is skipped, not thrown', jsonLdNodes('<script type="application/ld+json">{oops</script>').length === 0)
}

console.log('\n5 · Numbers and links')
for (const [raw, want] of [['9990', 9990], ['9 990,00', 9990], ['9.990', 9990], ['1.299,50', 1299.5], ['1,299.50', 1299.5], ['9,990', 9990], ['kr 1.299,-', 1299], ['1,5', 1.5], ['1.234.567', 1234567], [2490, 2490], ['abc', null], ['', null], [null, null], [-5, null]]) {
  check(`parsePrice(${JSON.stringify(raw)}) = ${want}`, parsePrice(raw) === want, String(parsePrice(raw)))
}
check('a Prisjakt product link is recognised', isPrisjaktUrl('https://www.prisjakt.no/product.php?p=16929131&a-116257=Frost') && isPrisjaktUrl('https://prisjakt.no/produkt.php?p=1'))
check('a Prisjakt search or a shop is not a product link', !isPrisjaktUrl('https://www.prisjakt.no/search?search=x') && !isPrisjaktUrl('https://www.elkjop.no/product/x/1') && !isPrisjaktUrl('not a url'))

console.log('\n6 · Prisjakt\'s own offer list: the price now is its new offers (live page, 10.11.2026)')
{
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/prisjakt/iphone-15-pro-128gb.html'), 'utf8')
  const link = 'https://www.prisjakt.no/product.php?p=12105530'
  const push = s => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`
  // The page's offer rows, to build variants of it from.
  const flightOf = h => [...h.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map(m => JSON.parse(m[1])).join('')
  const flight = flightOf(html)
  const at = flight.indexOf('"offerRows":') + '"offerRows":'.length
  const end = flight.indexOf(',"trackingScope"', at)
  const rows = JSON.parse(flight.slice(at, end))
  const withRows = list => html.replace(/<body>[\s\S]*<\/body>/, `<body>${push(flight.slice(0, at) + JSON.stringify(list) + flight.slice(end))}</body>`)
  check('the fixture is the live page\'s list: 159 offers — 2 new, 107 refurbished, 50 used', rows.length === 159
    && rows.filter(r => r.condition === 'New').length === 2 && rows.filter(r => r.condition === 'Refurbished').length === 107 && rows.filter(r => r.condition === 'Used').length === 50)

  const g = readPrice(html, link)
  check('the price now is the cheapest NEW offer, the high the dearest new one, from 2 shops', g.status === 'ok' && g.low === 16115 && g.high === 16252 && g.offers === 2 && g.currency === 'NOK', JSON.stringify(g))
  check('…it says so (condition new), with the cheapest used and refurbished offers beside it', g.condition === 'new' && g.usedLow === 5990 && g.refurbishedLow === 6490)
  check('…and the name and picture still come from the page\'s schema.org block', g.name === 'Apple iPhone 15 Pro 128GB' && g.image.endsWith('/12105530.jpg') && g.brand === 'Apple' && g.source === 'prisjakt')
  const schemaOnly = readPrice(html.replace(/<body>[\s\S]*<\/body>/, '<body></body>'), link)
  check('the bug it fixes: the schema.org figures alone read a refurbished 6 590 as the lowest (now marked mixed)', schemaOnly.low === 6590 && schemaOnly.condition === 'mixed' && schemaOnly.usedLow === null, JSON.stringify(schemaOnly))
  const split = html.replace(/<body>[\s\S]*<\/body>/, `<body>${push(flight.slice(0, at + 4000))}${push(flight.slice(at + 4000))}</body>`)
  check('the list split over two of the page\'s chunks reads the same', readPrice(split, link).low === 16115 && readPrice(split, link).refurbishedLow === 6490)
  const colour = readPrice(html, `${link}&a-116257=Blue`)
  check('a link to one colour on a page that lists every colour: the rows don\'t say their colour, so its schema.org figures, marked mixed', colour.condition === 'mixed' && colour.low === 6758 && /Blue$/.test(colour.name), JSON.stringify(colour))
  const one = readPrice(withRows(rows.filter(r => r.variantId === 17634616)), `${link}&a-116257=Black+Titanium`)
  check('a colour\'s link on a page that lists that one colour: its new offers', one.condition === 'new' && one.low === 16115 && one.usedLow === 5990 && one.refurbishedLow === 6490, JSON.stringify(one))
  const usedOnly = readPrice(withRows(rows.filter(r => r.condition !== 'New')), link)
  check('no new offer: no price now (never a used or refurbished one), the used and refurbished lows kept', usedOnly.status === 'no_price' && usedOnly.low === null && usedOnly.condition === 'new'
    && usedOnly.usedLow === 5990 && usedOnly.refurbishedLow === 6490 && usedOnly.name === 'Apple iPhone 15 Pro 128GB', JSON.stringify(usedOnly))
  const none = readPrice(withRows([]), link)
  check('an empty offer list: no price, nothing made up', none.status === 'no_price' && none.condition === 'new' && none.usedLow === null && none.refurbishedLow === null)
  const other = readPrice(withRows(rows.map(r => ({ ...r, productId: 999 }))), link)
  check('rows of another product are not this one\'s: its schema.org figures, marked mixed', other.condition === 'mixed' && other.low === 6590)
  const odd = readPrice(withRows([{ ...rows[0], condition: 'New', price: { amount: 'NaN', currency: 'NOK' } }, { ...rows[1], condition: 'New', price: { amount: -5, currency: 'NOK' } }, { ...rows[2], condition: 'New', price: { amount: 15990, currency: 'NOK' } }]), link)
  check('a row without a real price is left out', odd.low === 15990 && odd.offers === 1, JSON.stringify(odd))
  const broken = readPrice(html.replace(/<body>[\s\S]*<\/body>/, `<body>${push(flight.slice(0, at + 5000))}</body>`), link)
  check('a list cut short (not JSON) is not read: its schema.org figures, marked mixed', broken.condition === 'mixed' && broken.low === 6590)
  check('a shop\'s own page says nothing about its condition: unknown', readPrice(page(TCL), 'https://www.elkjop.no/product/tv/899848').condition === 'unknown')
  check('a Prisjakt page without the list (the 08.10.2026 fixtures): mixed, as before', readPrice(page(ORG, PIXEL), 'https://www.prisjakt.no/product.php?p=16929131').condition === 'mixed')
}

console.log('\n7 · Sites whose terms forbid automated reading (shop_site_policies)')
{
  const hosts = ['finn.no', 'tise.com', 'ads.finn.no']
  check('the exact host', listedSite('https://finn.no/', hosts) === 'finn.no')
  check('www, m. and any subdomain of it', listedSite('https://www.finn.no/recommerce/forsale/item/1', hosts) === 'finn.no' && listedSite('https://m.finn.no/x', hosts) === 'finn.no')
  check('capitals, a trailing dot and a port change nothing', listedSite('https://WWW.Finn.NO./a', hosts) === 'finn.no' && listedSite('https://tise.com:443/p', hosts) === 'tise.com')
  check('the most specific listed host wins', listedSite('https://x.ads.finn.no/', hosts) === 'ads.finn.no')
  check('not a look-alike: notfinn.no, finn.no.example.com', listedSite('https://notfinn.no/', hosts) === null && listedSite('https://finn.no.example.com/', hosts) === null)
  check('not a link that only names it in its path or query', listedSite('https://www.prisjakt.no/search?q=finn.no', hosts) === null && listedSite('https://shop.example/finn.no', hosts) === null)
  check('not a link that is no URL; an empty list lists nothing', listedSite('finn.no', hosts) === null && listedSite('https://finn.no/', []) === null)
}

// ── 8 · The real shop-price handler never fetches a listed site ──────────────
// Every outside call is scripted (as verify-ssrf-guard does): the database answers from `db`, fetch from `pages`.
const { transform } = require('sucrase')
function shopPrice({ db, pages, fetched, writes }) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/shop-price/index.ts'), 'utf8')
    .replace(/^import .*createClient.*$/m, '').replace(/^export /gm, '')
  const code = transform(src, { transforms: ['typescript'] }).code
  const builder = (table) => {
    const ops = []
    const q = new Proxy({}, {
      get: (_, op) => {
        if (op === 'then') return (res, rej) => Promise.resolve(db(table, ops)).then(res, rej)
        return (...args) => { ops.push([op, ...args]); if (['insert', 'upsert', 'update', 'delete'].includes(op)) writes.push({ table, op, row: args[0] }); return q }
      },
    })
    return q
  }
  const client = { from: builder, auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) } }
  const fetchStub = async (url) => {
    fetched.push(String(url))
    const page = pages[String(url)]
    if (!page) throw new TypeError(`unexpected fetch ${url}`)
    return new Response(page.status >= 300 && page.status < 400 ? null : (page.body ?? '<html><title>t</title></html>'),
      { status: page.status ?? 200, headers: page.headers ?? { 'content-type': 'text/html; charset=utf-8' } })
  }
  const env = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a', HEVY_USER_ID: 'owner', SHOP_PRICE_CRON_SECRET: 'cron-secret' }
  const deno = { env: { get: k => env[k] }, errors: {}, serve: f => { handler = f } }
  let handler
  new Function('Deno', 'createClient', 'fetch', 'console', code)(deno, () => client, fetchStub, { ...console, log: () => {}, warn: () => {} })
  return (body, headers = { authorization: 'Bearer owner-jwt' }) =>
    handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })).then(r => r.json())
}
const FINN = 'https://www.finn.no/recommerce/forsale/item/1'
const listed = [{ host: 'finn.no' }, { host: 'tise.com' }]
/** The database: the listed sites, one item on `itemUrl`, no watch, nothing waiting for a rate. */
const dbWith = (itemUrl, policies = { data: listed, error: null }) => (table, ops) => {
  if (table === 'shop_site_policies') return policies
  if (table === 'shop_items') {
    if (ops.some(([op]) => op === 'maybeSingle')) return { data: { url: itemUrl }, error: null }
    if (ops.some(([op, a]) => op === 'select' && /option_for/.test(String(a)))) return { data: [{ id: 'i1', url: itemUrl, status: 'wishlist', option_for: null }], error: null }
    if (ops.some(([op, a]) => op === 'select' && a === 'id, url')) return { data: [{ id: 'i1', url: itemUrl }], error: null }
    return { data: [], error: null }
  }
  return { data: [], error: null }
}

async function handlerChecks() {
  console.log('\n8 · shop-price never fetches a site whose terms forbid automated reading (the real handler, scripted)')
  let fetched = [], writes = []
  let call = shopPrice({ db: dbWith(FINN), pages: {}, fetched, writes })
  let r = await call({ action: 'read', url: FINN })
  check('read: a FINN ad is not_allowed, names finn.no, and nothing is fetched', r.result?.status === 'not_allowed' && r.result?.site === 'finn.no' && fetched.length === 0, JSON.stringify(r) + ' ' + fetched.join(' '))
  r = await call({ action: 'read', url: 'https://M.TISE.COM/p/1' })
  check('read: a subdomain of a listed site in capitals too', r.result?.status === 'not_allowed' && r.result?.site === 'tise.com' && fetched.length === 0)

  fetched = []; writes = []
  const short = 'https://go.example/x'
  call = shopPrice({ db: dbWith(short), pages: { [short]: { status: 302, headers: { location: FINN } } }, fetched, writes })
  r = await call({ action: 'read', url: short })
  check('read: a link that redirects to a listed site is refused at that hop — the site itself is never asked', r.result?.status === 'not_allowed' && r.result?.site === 'finn.no'
    && fetched.length === 1 && fetched[0] === short, JSON.stringify(r) + ' fetched ' + fetched.join(' '))

  fetched = []; writes = []
  call = shopPrice({ db: dbWith(FINN), pages: {}, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  const watch = writes.find(w => w.table === 'shop_price_watch' && w.op === 'upsert')?.row
  check('check: no fetch; the watch says not_allowed in plain words, and no price point is added', r.results?.[0]?.status === 'not_allowed' && fetched.length === 0
    && watch?.status === 'not_allowed' && watch?.error === "finn.no's terms don't allow automated reading" && !writes.some(w => w.table === 'shop_price_points'),
    JSON.stringify(r) + ' ' + JSON.stringify(watch))

  fetched = []; writes = []
  call = shopPrice({ db: dbWith(FINN), pages: {}, fetched, writes })
  r = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
  check('sweep: a due FINN link is not fetched either; its watch says not_allowed', r.checked === 1 && r.results?.[0]?.status === 'not_allowed' && fetched.length === 0
    && writes.some(w => w.table === 'shop_price_watch' && w.row?.status === 'not_allowed'), JSON.stringify(r) + ' fetched ' + fetched.join(' '))

  fetched = []; writes = []
  const shop = 'https://shop.example/p'
  call = shopPrice({ db: dbWith(shop, { data: null, error: { code: 'XX000', message: 'boom' } }), pages: { [shop]: { status: 200, body: page(TCL) } }, fetched, writes })
  r = await call({ action: 'read', url: shop })
  const c = await call({ action: 'check', ids: ['i1'] })
  const sw = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
  check('the list can\'t be read: read, check and the sweep fetch nothing (fail closed) and say why', fetched.length === 0 && /nothing was fetched/.test(r.error ?? '')
    && /nothing was fetched/.test(c.error ?? '') && /nothing was fetched/.test(sw.error ?? ''), JSON.stringify([r, c, sw]))

  fetched = []; writes = []
  call = shopPrice({ db: dbWith(shop), pages: { [shop]: { status: 200, body: page(TCL) } }, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  const point = writes.find(w => w.table === 'shop_price_points')?.row
  const w2 = writes.find(w => w.table === 'shop_price_watch')?.row
  check('a shop that is not listed is still read: its price, condition unknown, on the watch and its point', r.results?.[0]?.status === 'ok' && fetched.length === 1
    && w2?.low === 9990 && w2?.condition === 'unknown' && point?.condition === 'unknown' && point?.low === 9990, JSON.stringify(r) + JSON.stringify(w2))
}

handlerChecks().catch(e => { failed++; console.log(`  ✗ the handler checks threw: ${e.stack}`) }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})
