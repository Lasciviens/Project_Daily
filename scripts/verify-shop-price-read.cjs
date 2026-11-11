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
const { readPrice, parsePrice, isChallengePage, isPrisjaktUrl, jsonLdNodes, listedSite, robotsRules, robotsAllows, MAX_PATH_CHARS, ROBOTS_RULE_CAP } = require('../src/features/shop/priceRead')
const W = require('../src/features/shop/watchWords')
const { formatTime } = require('../src/shared/utils/dateFormat')

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
{
  const store = readPrice(page(TCL), 'https://www.elkjop.no/product/tv/899848?utm_source=prisjakt.no&ref=www.prisjakt.no')
  check('a shop\'s link that only names prisjakt.no (utm_source) is the shop\'s, not Prisjakt\'s: its own price, condition unknown', store.source === 'store' && store.condition === 'unknown' && store.low === 9990)
  check('…while Prisjakt on any of its own hosts is Prisjakt', readPrice(page(ORG, KARCHER), 'https://m.prisjakt.no/product.php?p=11802129').source === 'prisjakt'
    && readPrice(page(ORG, KARCHER), 'https://PRISJAKT.NO./product.php?p=11802129').source === 'prisjakt' && readPrice(page(KARCHER), 'https://prisjakt.no.example.com/p').source === 'store')
  const odd = (extra) => readPrice(page({ '@type': 'Product', name: 'Lamp', offers: { '@type': 'Offer', price: 499, priceCurrency: 'NOK' }, ...extra }), 'https://shop.example/lamp')
  check('page text is kept as Delete\'s Undo keeps it: a name of up to 300 characters', odd({ name: 'L'.repeat(400) }).name.length === 300 && odd({}).name === 'Lamp')
  check('…a picture only as a web link of up to 2 048 characters ("//cdn…" made https) — never a path, data: or javascript:',
    odd({ image: '//cdn.example/l.jpg' }).image === 'https://cdn.example/l.jpg' && odd({ image: 'https://cdn.example/l.jpg' }).image === 'https://cdn.example/l.jpg'
    && odd({ image: '/img/l.jpg' }).image === null && odd({ image: 'javascript:alert(1)' }).image === null && odd({ image: 'data:image/png;base64,AAAA' }).image === null
    && odd({ image: 'https://cdn.example/' + 'x'.repeat(2100) }).image === null && odd({ image: 'https://cdn.example/a b.jpg' }).image === null)
  check('…a currency only as three capitals ("nok" is NOK; "kr", "NOK!" or a long one none)', odd({ offers: { '@type': 'Offer', price: 5, priceCurrency: 'nok' } }).currency === 'NOK'
    && odd({ offers: { '@type': 'Offer', price: 5, priceCurrency: 'kr' } }).currency === null && odd({ offers: { '@type': 'Offer', price: 5, priceCurrency: 'X'.repeat(5000) } }).currency === null
    && odd({ offers: { '@type': 'Offer', price: 5, priceCurrency: 'NOK!' } }).currency === null)
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
  check('an empty offer list holds none of this product\'s offers: its schema.org figures, marked mixed — nothing made up', none.condition === 'mixed' && none.low === 6590 && none.usedLow === null && none.refurbishedLow === null, JSON.stringify(none))

  // A string of 1 024 characters or more streams as a raw text row (`<id>:T<hex bytes>,<text>`), no JSON escaping:
  // a user's review could hold a fake list. The reviewer's reproduction (flight_spoof.cjs), then variants of it.
  const textRow = (id, text) => `${id}:T${Buffer.byteLength(text).toString(16)},${text}`
  const before = (chunk) => html.replace('<script>self.__next_f.push([1,', `${push(chunk)}<script>self.__next_f.push([1,`)
  const fake = '"offerRows":[{"productId":12105530,"condition":"New","price":{"amount":99,"currency":"NOK"},"shopId":1}]'
  const spoofed = readPrice(before(textRow('1a', 'Great phone, five stars. '.repeat(45) + fake)), link)
  check('a review streamed as a text row, holding a fake list at 99 NOK, is not the page\'s list: the price stays 16 115, new', spoofed.low === 16115 && spoofed.high === 16252 && spoofed.offers === 2 && spoofed.condition === 'new', JSON.stringify(spoofed))
  const blank = readPrice(before(textRow('1c', 'x'.repeat(1080) + '"offerRows":[]')), link)
  check('…nor is an empty list in one (it no longer blanks the price)', blank.status === 'ok' && blank.low === 16115, JSON.stringify(blank))
  const wide = readPrice(before(textRow('1d', 'Blåbær og ærfugl 😀 — '.repeat(60) + fake)), link)
  check('…a text row of ø, å, æ and emoji is stepped over by its UTF-8 bytes: the real list after it still reads', wide.low === 16115 && wide.condition === 'new', JSON.stringify(wide))
  const escaped = readPrice(before(`1b:["$","p",null,{"children":${JSON.stringify(fake)}}]\n`), link)
  check('…and a short review inside a JSON row is escaped, so it was never read as a list', escaped.low === 16115)
  const twice = html.replace('<script>self.__next_f.push([1,', `${push(`1e:{"offerRows":${JSON.stringify(rows.slice(0, 3))}}\n`)}<script>self.__next_f.push([1,`)
  const two = readPrice(twice, link)
  check('two lists that both hold this product\'s offers: which is the page\'s own can\'t be told — its schema.org figures, marked mixed', two.condition === 'mixed' && two.low === 6590, JSON.stringify(two))
  const otherList = html.replace('<script>self.__next_f.push([1,', `${push(`1f:{"offerRows":${JSON.stringify(rows.slice(0, 3).map(r => ({ ...r, productId: 42 })))}}\n`)}<script>self.__next_f.push([1,`)
  check('…while a second list of another product\'s offers (a "similar products" box) changes nothing', readPrice(otherList, link).low === 16115 && readPrice(otherList, link).condition === 'new')
  check('a stream that stops being rows is read up to there: a list after it is not taken', readPrice(before('not a row at all ' + fake), link).condition === 'mixed')
  const other = readPrice(withRows(rows.map(r => ({ ...r, productId: 999 }))), link)
  check('rows of another product are not this one\'s: its schema.org figures, marked mixed', other.condition === 'mixed' && other.low === 6590)
  const odd = readPrice(withRows([{ ...rows[0], condition: 'New', price: { amount: 'NaN', currency: 'NOK' } }, { ...rows[1], condition: 'New', price: { amount: -5, currency: 'NOK' } }, { ...rows[2], condition: 'New', price: { amount: 15990, currency: 'NOK' } }]), link)
  check('a row without a real price is left out', odd.low === 15990 && odd.offers === 1, JSON.stringify(odd))
  const broken = readPrice(html.replace(/<body>[\s\S]*<\/body>/, `<body>${push(flight.slice(0, at + 5000))}</body>`), link)
  check('a list cut short (not JSON) is not read: its schema.org figures, marked mixed', broken.condition === 'mixed' && broken.low === 6590)
  // Prisjakt's new offers, one per shop, for price match (migration 191's shop_price_watch.new_offers): the shop's
  // number and name come from the row itself (shop.name, seen on four saved product pages, 10.11.2026).
  const eqj = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  check('the new offers: CDON 16 115 and CS MEGASTORE 16 252, both in stock — each with Prisjakt\'s shop number and the row\'s own shop name',
    eqj(g.newOffers, [{ shop_id: 9738, shop_name: 'CDON', price: 16115, currency: 'NOK', in_stock: true }, { shop_id: 35222, shop_name: 'CS MEGASTORE', price: 16252, currency: 'NOK', in_stock: true }]), JSON.stringify(g.newOffers))
  check('…none without the list (null: not read), none but used and refurbished ones ([]: read, no new offer), none from a shop\'s own page',
    schemaOnly.newOffers === null && eqj(usedOnly.newOffers, []) && readPrice(page(TCL), 'https://www.elkjop.no/product/tv/899848').newOffers === null)
  const row = (shopId, price, extra = {}) => ({ productId: 12105530, condition: 'New', price: { amount: price, currency: 'NOK' }, shopId, stockStatus: 'InStock', shop: { name: `Shop ${shopId}` }, ...extra })
  const dup = readPrice(withRows([row(1, 3000), row(1, 2900), row(2, 2950), row(1, 3100)]), link).newOffers
  check('one per shop — its cheapest — cheapest first', eqj(dup.map(o => [o.shop_id, o.price]), [[1, 2900], [2, 2950]]), JSON.stringify(dup))
  const many = readPrice(withRows(Array.from({ length: 70 }, (_, k) => row(1000 + k, 5000 - k))), link).newOffers
  check('at most 50 (the cheapest 50), as 191 bounds them', many.length === 50 && many[0].price === 4931 && many[49].price === 4980)
  const stock = readPrice(withRows([row(1, 10, { stockStatus: 'OutOfStock' }), row(2, 11, { stockStatus: 'Backorder' }), row(3, 12, { stockStatus: 'PreOrder' }),
    row(4, 13, { stockStatus: 'Unknown' }), row(5, 14, { stockStatus: undefined }), row(6, 15)]), link).newOffers
  check('in stock: InStock true; OutOfStock, Backorder, PreOrder false; anything else not said (null)', eqj(stock.map(o => o.in_stock), [false, false, false, null, null, true]), JSON.stringify(stock))
  const names = readPrice(withRows([row(1, 10, { shop: { name: 'x'.repeat(121) } }), row(2, 11, { shop: { name: 'Evil‮9 0 9 1' } }), row(3, 12, { shop: { name: '  Power  \n Norge ' } }),
    row(4, 13, { shop: { name: 42 } }), row(5, 14, { shop: 'Power' }), row(6, 15, { shop: { name: 'Zero​width' } }), row(7, 16, { shop: { name: 'Bell\u0007' } })]), link).newOffers
  check('a shop\'s name: over 120 characters, with a direction, zero-width or control character, or not text is none; whitespace is squeezed to one line',
    eqj(names.map(o => o.shop_name), [null, null, 'Power Norge', null, null, null, null]) && names.length === 7, JSON.stringify(names))
  const ids = readPrice(withRows([row('324', 10), row(0, 11), row(-5, 12), row(1.5, 13), row(1e12, 14), row(null, 15), row(9, 1e9), row(10, 999999999)]), link).newOffers
  check('an offer without a whole shop number above 0, or with a price of a billion or more, is left out', eqj(ids.map(o => o.shop_id), [10]), JSON.stringify(ids))
  check('…every offer has exactly the five keys 191 checks', g.newOffers.concat(dup, many, stock, names).every(o => Object.keys(o).sort().join() === 'currency,in_stock,price,shop_id,shop_name'))
  {
    const t0 = Date.now()
    const big = readPrice(withRows(Array.from({ length: 10000 }, (_, k) => row(k + 1, 1000 + (k % 97), { shop: { name: 'Butikk '.repeat(68) } }))), link)
    const ms = Date.now() - t0
    check(`a hostile page with 10 000 offers and 476-character names costs a moment (${ms} ms), and keeps 50 without a name`, ms < 4000 && big.newOffers.length === 50 && big.newOffers.every(o => o.shop_name === null), `${ms} ms`)
  }
  check('a shop\'s own page says nothing about its condition: unknown', readPrice(page(TCL), 'https://www.elkjop.no/product/tv/899848').condition === 'unknown')
  check('a Prisjakt page without the list (the 08.10.2026 fixtures): mixed, as before', readPrice(page(ORG, PIXEL), 'https://www.prisjakt.no/product.php?p=16929131').condition === 'mixed')
}

/** The trimmed iPhone 15 Pro page with its offer list changed by `edit` (the handler scenarios read it as a live page). */
function iphonePage(edit) {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/prisjakt/iphone-15-pro-128gb.html'), 'utf8')
  const flight = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map(m => JSON.parse(m[1])).join('')
  const at = flight.indexOf('"offerRows":') + '"offerRows":'.length
  const end = flight.indexOf(',"trackingScope"', at)
  const list = edit(JSON.parse(flight.slice(at, end)))
  return html.replace(/<body>[\s\S]*<\/body>/, `<body><script>self.__next_f.push([1,${JSON.stringify(flight.slice(0, at) + JSON.stringify(list) + flight.slice(end))}])</script></body>`)
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

console.log('\n9 · robots.txt (RFC 9309), on the files the sites served on 10.11.2026')
{
  const file = name => fs.readFileSync(path.join(__dirname, 'fixtures/robots', name), 'utf8')
  const may = (text, p) => robotsAllows(robotsRules(text), p)
  const prisjakt = file('www.prisjakt.no.txt'), elkjop = file('www.elkjop.no.txt'), power = file('www.power.no.txt'), jernia = file('www.jernia.no.txt'), finn = file('www.finn.no.txt')
  check('Prisjakt: a product page may be read', may(prisjakt, '/product.php?p=12105530'))
  check('Prisjakt: …a link to one colour too (&a-116257=Frost)', may(prisjakt, '/product.php?p=16929131&a-116257=Frost'))
  check('Prisjakt: a search may not (Disallow: /search?*)', !may(prisjakt, '/search?search=iphone+15') && !may(prisjakt, '/search?q=x'))
  check('Prisjakt: a product\'s offer pages may not (/product.php?o=*&offset=*)', !may(prisjakt, '/product.php?o=1&offset=20'))
  check('Prisjakt: the bots it names are not us (their Disallow: / is not ours)', may(prisjakt, '/c/mobiltelefoner'))
  check('Elkjøp: a product page may be read', may(elkjop, '/product/tv-lyd-og-smarte-hjem/tv/899848/tcl-65-mqled75k'))
  check('Elkjøp: its search may not — /search, /search/…, /search?…', !may(elkjop, '/search') && !may(elkjop, '/search?q=tv') && !may(elkjop, '/search/tv'))
  check('Elkjøp: …while /searchlight is another path ($ ends the match)', may(elkjop, '/searchlight'))
  check('Elkjøp: the * group, not AdsBot-Google\'s (which allows ?utm_ links)', !may(elkjop, '/cart?utm_source=x'))
  check('Power: its search may not, a product page may', !may(power, '/search/?q=tv') && may(power, '/tv-og-lyd/tv/tcl-65-mqled75k/p-3701020/'))
  check('Jernia: Allow: / lets every page be read', may(jernia, '/search?q=x') && may(jernia, '/'))
  check('FINN, as its file says: an ad page itself is not disallowed there (its terms forbid it — shop_site_policies)', may(finn, '/recommerce/forsale/item/123456789'))
  check('FINN: Disallow: /privacy$ refuses /privacy, not /privacy-policy', !may(finn, '/privacy') && may(finn, '/privacy-policy'))
  check('FINN: an Allow beside a Disallow — homes ad pages allowed, new-building ones refused', may(finn, '/realestate/homes/ad.html?finnkode=1') && !may(finn, '/realestate/newbuildings/ad.html?finnkode=1'))
  check('FINN: wildcards (/*?sort=, */gallery.html, /profile*)', !may(finn, '/bap/forsale/search.html?sort=1') && !may(finn, '/x/gallery.html') && !may(finn, '/profile/ads'))
  check('an empty file allows everything', may('', '/anything?x=1'))
  check('our own group wins over *, any case, its version left out', !may('User-agent: *\nAllow: /\n\nUser-agent: lascisboard/2.0\nDisallow: /p', '/p?x') && may('User-agent: *\nDisallow: /\n\nUser-Agent: LascisBoard\nAllow: /', '/x'))
  check('two groups for one agent are combined; user-agent lines in a row share their rules',
    !may('User-agent: *\nDisallow: /a\n\nUser-agent: *\nDisallow: /b', '/b') && !may('User-agent: x\nUser-agent: *\nDisallow: /c', '/c'))
  check('an empty Disallow disallows nothing — and still ends its group', may('User-agent: *\nDisallow:', '/x') && may('User-agent: *\nDisallow:\nUser-agent: other\nDisallow: /', '/x'))
  check('the longest match decides; on a tie Allow wins', may('User-agent: *\nDisallow: /shop\nAllow: /shop/item', '/shop/item/1') && !may('User-agent: *\nAllow: /shop\nDisallow: /shop/cart', '/shop/cart')
    && may('User-agent: *\nDisallow: /x\nAllow: /x', '/x'))
  check('Sitemap and Crawl-delay lines end no group; rules before any user-agent are ignored; comments, CRLF and a BOM are fine',
    !may('User-agent: *\nSitemap: https://x.example/s.xml\nDisallow: /a', '/a') && may('Disallow: /a\nUser-agent: *\nAllow: /', '/a')
    && !may('\uFEFFUser-agent: * # all\r\nDisallow: /a # not a\r\n', '/a'))
  check('octets compared one way: an encoded path matches its pattern, whatever the case of its hex', !may('User-agent: *\nDisallow: /blåbær', '/bl%C3%A5b%C3%A6r') && !may('User-agent: *\nDisallow: /a%2fb', '/a%2Fb'))
  check('/robots.txt itself is always allowed', may('User-agent: *\nDisallow: /', '/robots.txt'))
  // RFC 9309 §2.2.2: an encoded unreserved character is the character (the reviewer's robots_enc.cjs: these passed).
  const seen = u => { const x = new URL(u); return x.pathname + x.search }
  const shopRules = 'User-agent: *\nDisallow: /private\nDisallow: /~staff\nDisallow: /search\nDisallow: /*?q=\n'
  check('a link that spells a refused path with encoded letters is refused too: /%70rivate, /%7Estaff, /%73earch, ?%71=',
    ['https://shop.example/%70rivate/x', 'https://shop.example/%7Estaff', 'https://shop.example/%73earch?x', 'https://shop.example/p?%71=1']
      .every(u => !may(shopRules, seen(u))), ['https://shop.example/%70rivate/x', 'https://shop.example/%7Estaff', 'https://shop.example/%73earch?x', 'https://shop.example/p?%71=1'].map(u => `${seen(u)}:${may(shopRules, seen(u))}`).join(' '))
  check('…Prisjakt\'s own Disallow: /search?* refuses /%73earch?search=x', !may(prisjakt, seen('https://www.prisjakt.no/%73earch?search=x')))
  check('…while case still counts (/PRIVATE is another path), and a reserved %2F stays itself', may(shopRules, seen('https://shop.example/PRIVATE/x'))
    && may('User-agent: *\nDisallow: /a/b', '/a%2Fb') && !may('User-agent: *\nDisallow: /a%2fb', '/a%2Fb'))
  check('a rule with " < > { } ` or \' meets the link the URL parser encoded, in the path and in the query',
    !may('User-agent: *\nDisallow: /a"b', seen('https://shop.example/a"b')) && !may('User-agent: *\nDisallow: /x{y}', seen('https://shop.example/x{y}'))
    && !may('User-agent: *\nDisallow: /<p>', seen('https://shop.example/<p>')) && !may('User-agent: *\nDisallow: /`t`', seen('https://shop.example/`t`'))
    && !may('User-agent: *\nDisallow: /*?q={x}', seen('https://shop.example/s?q={x}')) && !may("User-agent: *\nDisallow: /*?q='x'", seen("https://shop.example/s?q='x'"))
    && !may('User-agent: *\nDisallow: /a%22b', seen('https://shop.example/a"b')), ['/a"b', '/x{y}', '/s?q={x}', "/s?q='x'"].map(p => seen('https://shop.example' + p)).join(' '))
  const many = n => 'User-agent: *\n' + Array.from({ length: n }, (_, i) => `Disallow: /p${i}`).join('\n')
  check(`a file with more than ${ROBOTS_RULE_CAP} rules for us is not read (null: the page isn't read now) — never rules dropped past a cap`,
    robotsRules(many(ROBOTS_RULE_CAP + 1)) === null && robotsRules(many(ROBOTS_RULE_CAP))?.length === ROBOTS_RULE_CAP
    && robotsRules('User-agent: other\n' + many(ROBOTS_RULE_CAP + 1).replace('User-agent: *\n', '') + '\nUser-agent: *\nDisallow: /x')?.length === 1)
  const hostile = 'User-agent: *\n' + Array.from({ length: 3000 }, () => 'Disallow: /*a*a*a*a*a*a*a*a*a*a*b').join('\n')
  const t0 = Date.now()
  const slow = may(hostile, '/' + 'a'.repeat(2000))
  check('a hostile file (3 000 rules of nested wildcards on a 2 000-letter path) is answered in time, without backtracking blow-up', slow === true && Date.now() - t0 < 3000, `${Date.now() - t0} ms`)
}

console.log('\n17 · A hostile page or robots.txt costs no more than a moment (the guardian review, 10.11.2026)')
{
  const timed = (fn) => { const t = process.hrtime.bigint(); const r = fn(); return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 } }
  const may = (text, p) => robotsAllows(robotsRules(text), p)
  // (a) 5 000 rules "*a…ab" against a long path of a's: the old two-pointer matcher retried every star (9.3 s on 2 000 characters, 59 s on 16 000).
  const rules = robotsRules('User-agent: *\n' + Array.from({ length: 5000 }, () => `Disallow: *${'a'.repeat(90)}b`).join('\n'))
  // A link's path is cut at 2 048 characters before it is ever matched (fetchPage); 16 000 shows the matcher stays linear past that.
  for (const [n, bound] of [[2000, 1500], [16000, 4000]]) {
    const { r, ms } = timed(() => robotsAllows(rules, '/' + 'a'.repeat(n)))
    check(`5 000 hostile rules against a ${n}-character path: answered (allowed — no b) in ${Math.round(ms)} ms (bound ${bound} ms)`, r === true && ms < bound, `${ms} ms`)
  }
  const { r: hit, ms: hitMs } = timed(() => robotsAllows(rules, '/' + 'a'.repeat(1999) + 'b'))
  check('…and the same rules still disallow the path they match, as fast', hit === false && hitMs < 1500, `${hitMs} ms`)
  check('the matcher keeps its answers: anchored, wildcards, pieces in order', !may('User-agent: *\nDisallow: /a*b*c$', '/axxbyyc') && may('User-agent: *\nDisallow: /a*b*c$', '/axxbyycd')
    && may('User-agent: *\nDisallow: /a*c*b', '/abc') && !may('User-agent: *\nDisallow: /*.pdf$', '/x/y.pdf') && may('User-agent: *\nDisallow: /*.pdf$', '/x/y.pdf?z') && !may('User-agent: *\nDisallow: /p*', '/p'))
  check('a link longer than a kept one is never matched: the fetch refuses a path + query over 2 048 characters (MAX_PATH_CHARS)', MAX_PATH_CHARS === 2048)
  // (c) a price text far longer than any price: 80 000 dashes cost 4.9 s through the trailing-dash pattern.
  const { r: dashes, ms: dashMs } = timed(() => parsePrice('-'.repeat(80000) + '1'))
  check(`a price text of 80 000 dashes is no price, in ${Math.round(dashMs)} ms (bound 200 ms)`, dashes === null && dashMs < 200, `${dashMs} ms`)
  const sixtyFour = ('kr 1 299,-').padStart(64, ' ')
  check('…a price text of 64 characters still reads, 65 does not', parsePrice(sixtyFour) === 1299 && parsePrice(' ' + sixtyFour) === null)
  const { r: viaPage, ms: pageMs } = timed(() => readPrice(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'x', offers: { '@type': 'Offer', price: '-'.repeat(80000) + '1' } })}</script>`, 'https://shop.example/p'))
  check(`…through a page too: no price, in ${Math.round(pageMs)} ms (bound 200 ms)`, viaPage.status === 'no_price' && pageMs < 200, `${pageMs} ms`)
  // (d) 256 KiB of "<script " with no ">": one pattern over the whole page rescanned the rest for each (6.4 s).
  const { r: tags, ms: tagMs } = timed(() => jsonLdNodes('<script '.repeat(32768)))
  check(`256 KiB of unclosed "<script " is read in one pass: nothing, in ${Math.round(tagMs)} ms (bound 300 ms)`, tags.length === 0 && tagMs < 300, `${tagMs} ms`)
  const { r: tagsPage, ms: tagsPageMs } = timed(() => readPrice('<script '.repeat(32768), 'https://shop.example/p'))
  check(`…the same page through readPrice: no price, in ${Math.round(tagsPageMs)} ms (bound 300 ms)`, tagsPage.status === 'no_price' && tagsPageMs < 300, `${tagsPageMs} ms`)
  const block = b => `<script type="application/ld+json">${JSON.stringify(b)}</script>`
  check('the one-pass reader still takes every block, in any case and with other scripts between', jsonLdNodes(`<SCRIPT TYPE='application/ld+json'>{"@type":"Product","name":"A"}</SCRIPT><script>var x = "<b>"</script>${block({ '@type': 'Product', name: 'B' })}`).map(n => n.name).join() === 'A,B')
  check('…and stops at the first script that never closes (what follows it is not read)', jsonLdNodes(`${block({ '@type': 'Product', name: 'A' })}<script>never closed${block({ '@type': 'Product', name: 'B' })}`).map(n => n.name).join() === 'A')
}

console.log('\n13 · What the app says under a pasted link (watchWords.readNote, the add sheet and Add a model alike)')
{
  const at = '2026-11-10T05:23:00.000Z'
  const hhmm = formatTime(at)
  const base = { name: null, image: null, brand: null, gtin: null, low: null, high: null, offers: null, currency: null, inStock: null, was: null,
    returnDays: null, condition: 'unknown', usedLow: null, refurbishedLow: null, source: 'store', at, finalUrl: 'https://shop.example/p' }
  const note = extra => W.readNote({ ...base, ...extra })
  check('a Prisjakt price: its lowest new price, from how many shops, read just now', note({ status: 'ok', source: 'prisjakt', condition: 'new', low: 16115, offers: 2 })
    === "Prisjakt's lowest new price, from 2 shops — read just now.", note({ status: 'ok', source: 'prisjakt', condition: 'new', low: 16115, offers: 2 }))
  check('…one shop in the singular; Prisjakt\'s mixed figures say so', note({ status: 'ok', source: 'prisjakt', condition: 'new', low: 1, offers: 1 }) === "Prisjakt's lowest new price, from 1 shop — read just now."
    && note({ status: 'ok', source: 'prisjakt', condition: 'mixed', low: 6590 }) === "Prisjakt's lowest, new and used offers alike — read just now.")
  check('a shop\'s price read within the hour says when ("read at HH:MM")', note({ status: 'ok', low: 9990, reused: true }) === `The shop's price — read at ${hhmm}.`)
  check('a site\'s terms: what it says and what to do — never "open it yourself"', note({ status: 'not_allowed', refusal: 'terms', reason: "finn.no doesn't let apps read its pages" })
    === "finn.no doesn't let apps read its pages — type the name and price yourself.")
  check('a robots refusal: paste the product\'s own page', note({ status: 'not_allowed', refusal: 'robots', reason: 'prisjakt.no asks apps not to read this page' })
    === "prisjakt.no asks apps not to read this page — paste the product's own page.")
  check('a bot check, and one read within the hour (its time)', note({ status: 'blocked', reason: 'elkjop.no blocks apps with a browser check' }) === 'elkjop.no blocks apps with a browser check — type the price yourself.'
    && note({ status: 'blocked', reason: 'elkjop.no blocks apps with a browser check', reused: true }) === `elkjop.no blocks apps with a browser check (read at ${hhmm}) — type the price yourself.`)
  check('no price, and Prisjakt without a new offer (read within the hour too)', note({ status: 'no_price', reason: 'No price on the page' }) === 'No price on the page — type the price yourself.'
    && note({ status: 'no_price', reason: 'No new offer on Prisjakt, only used or refurbished ones', reused: true }) === `No new offer on Prisjakt, only used or refurbished ones (read at ${hhmm}) — type the price yourself.`)
  check('an answer without its reason (an older function) still says something true', note({ status: 'blocked' }) === 'That site blocks apps with a browser check — type the price yourself.'
    && note({ status: 'not_allowed' }) === "That site doesn't let apps read its pages — type the name and price yourself.")
}

console.log('\n15 · When the morning check tries a link again (watchWords, the card and the record)')
{
  const fn = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/shop-price/index.ts'), 'utf8')
  check('the app and shop-price wait the same 7 days after a bot check', Number(/const BLOCKED_RETRY_DAYS = (\d+)/.exec(fn)?.[1]) === W.BLOCKED_RETRY_DAYS && W.BLOCKED_RETRY_DAYS === 7)
  check('…counted in Oslo days: a check at 23:30 Oslo time on 09.11 (22:30 UTC) is asked again on 16.11', W.blockedRetryDay('2026-11-09T22:30:00Z') === '2026-11-16'
    && W.blockedRetryDay('2026-11-09T23:30:00Z') === '2026-11-17')
  const toBuy = { list: 'wishlist', kind: 'item', status: 'wishlist', url: 'https://shop.example/p', disposal: null, return_by: null }
  const today = '2026-11-10'
  check('the morning check reads a thing to buy, and one you have while it can still go back — nothing else',
    W.morningReads(toBuy, today) && W.morningReads({ ...toBuy, status: 'bought', return_by: '2026-11-10' }, today)
    && !W.morningReads({ ...toBuy, status: 'bought', return_by: '2026-11-09' }, today) && !W.morningReads({ ...toBuy, status: 'bought', return_by: '2026-12-01', disposal: 'sold' }, today)
    && !W.morningReads({ ...toBuy, status: 'bought' }, today) && !W.morningReads({ ...toBuy, kind: 'general' }, today) && !W.morningReads({ ...toBuy, list: 'quick' }, today) && !W.morningReads({ ...toBuy, url: null }, today))
  const at = '2026-11-10T05:23:00Z'
  check('a bot check: "the morning check tries again on 17.11.2026"', W.retryWords(toBuy, { status: 'blocked', checked_at: at }, today) === 'the morning check tries again on 17.11.2026')
  check('…once that day has come, without a date; a failed check: "the morning check tries again"', W.retryWords(toBuy, { status: 'blocked', checked_at: at }, '2026-11-17') === 'the morning check tries again'
    && W.retryWords(toBuy, { status: 'error', checked_at: at }, today) === 'the morning check tries again')
  check('…nothing for a refusal or a page without a price, nor for a row the morning check doesn\'t read', W.retryWords(toBuy, { status: 'not_allowed', checked_at: at }, today) === null
    && W.retryWords(toBuy, { status: 'no_price', checked_at: at }, today) === null && W.retryWords({ ...toBuy, status: 'bought', return_by: '2026-10-01' }, { status: 'blocked', checked_at: at }, today) === null)
  check('a sentence from shop-price ends one of ours: its first word in small letters, a site\'s name as it is', W.asTail("The site didn't answer") === "the site didn't answer" && W.asTail('elkjop.no blocks apps') === 'elkjop.no blocks apps')
}

console.log('\n16 · What a price covers, and why a watch shows no price now (the card\'s line, the record\'s strip)')
{
  check('a Prisjakt price read before 188 (no condition) counts as mixed; a shop\'s as unknown', W.coversOf({ condition: null, source: 'prisjakt' }) === 'mixed'
    && W.coversOf({ condition: null, source: 'store' }) === 'unknown' && W.coversOf({ condition: 'new', source: 'prisjakt' }) === 'new')
  check('a Prisjakt price that may be a used one says ", new and used" — a new one or a shop\'s says nothing more', W.mixedWords({ condition: 'mixed', source: 'prisjakt' }) === ', new and used'
    && W.mixedWords({ condition: null, source: 'prisjakt' }) === ', new and used' && W.mixedWords({ condition: 'new', source: 'prisjakt' }) === '' && W.mixedWords({ condition: 'unknown', source: 'store' }) === '')
  const toBuy = { list: 'wishlist', kind: 'item', status: 'wishlist', url: 'https://shop.example/p', disposal: null, return_by: null }
  const at = '2026-11-10T05:23:00Z', today = '2026-11-10'
  const st = (status, condition = null) => W.stateWords(toBuy, { status, checked_at: at, condition }, today)
  check('a price now needs no words', st('ok') === null)
  check('a refusal is the site\'s answer, not a failure: "apps may not read it", neutral', JSON.stringify(st('not_allowed')) === JSON.stringify({ text: 'apps may not read it', warn: false, retry: null }))
  check('a page without a price is an answer too: "no new offer" (Prisjakt\'s list), "no price on the page", neutral', st('no_price', 'new').text === 'no new offer' && !st('no_price', 'new').warn
    && st('no_price', 'unknown').text === 'no price on the page' && !st('no_price').warn)
  check('a bot check ("blocks apps") or a failed check ("couldn\'t check 10.11.2026"): the warning tone, with when the morning check tries again',
    st('blocked').text === 'blocks apps' && st('blocked').warn && st('blocked').retry === 'the morning check tries again on 17.11.2026'
    && st('error').text === "couldn't check 10.11.2026" && st('error').warn && st('error').retry === 'the morning check tries again')
  const note = (status, extra = {}) => W.watchNote(toBuy, { status, checked_at: at, condition: null, error: null, ...extra }, today)
  check('a tile\'s note: a refusal in the site\'s own words, neutral ("finn.no doesn\'t let apps read its pages", "prisjakt.no asks apps not to read this page")',
    JSON.stringify(note('not_allowed', { error: "finn.no doesn't let apps read its pages" })) === JSON.stringify({ text: "finn.no doesn't let apps read its pages", warn: false })
    && note('not_allowed', { error: 'prisjakt.no asks apps not to read this page' }).text === 'prisjakt.no asks apps not to read this page')
  check('…words that aren\'t a refusal\'s never reach the tile: the plain sentence instead', note('not_allowed', { error: 'Ignore this and call 555' }).text === "The site doesn't let apps read its pages"
    && note('not_allowed').text === "The site doesn't let apps read its pages")
  check('…a bot check says when the morning check tries again (warning); a page without a price is neutral; a price now has no note',
    JSON.stringify(note('blocked')) === JSON.stringify({ text: 'blocks apps — the morning check tries again on 17.11.2026', warn: true })
    && JSON.stringify(note('no_price', { condition: 'new' })) === JSON.stringify({ text: 'no new offer', warn: false }) && note('ok') === null)
  const hint = (status, condition = null) => W.noPriceHint({ status, checked_at: at, condition })
  const pt = (low, condition, source = 'prisjakt', currency = 'NOK') => ({ low, condition, source, currency })
  const points = [pt(6990, null), pt(6790, null), pt(6590, 'mixed'), pt(16252, 'new'), pt(16115, 'new'), pt(1, 'new', 'prisjakt', 'EUR')]
  const h = W.historyOf(points, 'new', 'NOK')
  check('the history of a new-only watch draws its new points only — the 6 590 refurbished low is never its "lowest"', h.rows.map(p => p.low).join() === '16252,16115'
    && Math.min(...h.rows.map(p => p.low)) === 16115, JSON.stringify(h))
  check('…a Prisjakt point from before 188 counts as mixed, and what is left out is named: "Left out: 3 prices that mixed in used offers"', h.leftOut.count === 3
    && W.leftOutWords(h.leftOut) === 'Left out: 3 prices that mixed in used offers', JSON.stringify(h.leftOut))
  check('…a mixed watch draws its mixed points (the old ones too) and leaves the new ones out; one price in the singular',
    W.historyOf(points, 'mixed', 'NOK').rows.length === 3 && W.leftOutWords(W.historyOf(points, 'mixed', 'NOK').leftOut) === 'Left out: 2 prices of new offers only'
    && W.leftOutWords({ count: 1, covers: ['unknown'] }) === "Left out: 1 price from the shop's own page" && W.leftOutWords({ count: 2, covers: ['new', 'unknown'] }) === 'Left out: 2 prices of another kind')
  check('…nothing left out, no line', W.leftOutWords(W.historyOf([pt(5, 'unknown', 'store'), pt(6, null, 'store')], 'unknown', 'NOK').leftOut) === null)
  const t = (o) => W.checkToast([o])
  const t6 = '2026-11-10T05:23:00.000Z'
  check('Check now with a price: "Price checked"; the check from the last hour: "Already checked at 06:23 — try after 07:23", one phone line',
    t({ status: 'ok' }).text === 'Price checked' && t({ status: 'ok', reused: true, checkedAt: t6 }).tone === 'success'
    && t({ status: 'ok', reused: true, checkedAt: t6 }).text === `Already checked at ${formatTime(t6)} — try after ${formatTime(Date.parse(t6) + 3600_000)}`
    && t({ status: 'ok', reused: true, checkedAt: t6 }).text.length <= 42)
  check('…a bot check, fresh or from the last hour, is a warning in its own words — never a green "checked"',
    JSON.stringify(t({ status: 'blocked', error: 'elkjop.no blocks apps with a browser check' })) === JSON.stringify({ tone: 'warning', text: 'elkjop.no blocks apps with a browser check' })
    && JSON.stringify(t({ status: 'blocked', error: 'elkjop.no blocks apps with a browser check', reused: true, checkedAt: t6 })) === JSON.stringify({ tone: 'warning', text: `Already checked at ${formatTime(t6)} — elkjop.no blocks apps with a browser check` }))
  check('…no price is a warning too ("No new offer on Prisjakt, …"); several links: a count', t({ status: 'no_price', error: 'No new offer on Prisjakt, only used or refurbished ones' }).tone === 'warning'
    && W.checkToast([{ status: 'ok' }, { status: 'blocked' }]).text === 'Checked 2 links · 1 with a price')
  check('the strip without a price names the refusal, "no new offer", or "couldn\'t check 10.11.2026" — never "not checked yet" for a link that was checked',
    hint('not_allowed') === 'apps may not read it' && hint('no_price', 'new') === 'no new offer' && hint('no_price') === 'no price on the page'
    && hint('blocked') === "couldn't check 10.11.2026" && hint('error') === "couldn't check 10.11.2026")
}

// ── 8 · The real shop-price handler never fetches a listed site ──────────────
// Every outside call is scripted (as verify-ssrf-guard does): the database answers from `db`, fetch from `pages`;
// a robots.txt from `robots` (an unscripted one answers 404: no rules), counted apart in `robotsAsked`.
const { transform } = require('sucrase')
function shopPrice({ db, pages, fetched, writes, robots = {}, robotsAsked = [] }) {
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
  // The JWT names the account: 'Bearer other-jwt' is a second app user, anything else the owner.
  const client = { from: builder, auth: { getUser: async (t) => ({ data: { user: { id: t === 'other-jwt' ? 'other' : 'owner' } }, error: null }) } }
  const fetchStub = async (url) => {
    if (new URL(String(url)).pathname === '/robots.txt') {
      robotsAsked.push(String(url))
      const r = robots[String(url)]
      if (r instanceof Error) throw r
      if (!r) return new Response('Not found', { status: 404 })
      return new Response(r.status >= 300 && r.status < 400 ? null : (r.body ?? ''), { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/plain' } })
    }
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
/** The database: the listed sites, one item on `itemUrl`, its watch (none by default), nothing waiting for a rate. */
const dbWith = (itemUrl, policies = { data: listed, error: null }, watch = null) => (table, ops) => {
  if (table === 'shop_site_policies') return policies
  if (table === 'shop_price_watch' && watch) return { data: [watch], error: null }
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
  check('…said in plain words: its terms (refusal terms), "finn.no doesn\'t let apps read its pages"', r.result?.refusal === 'terms' && r.result?.reason === "finn.no doesn't let apps read its pages", JSON.stringify(r.result))
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
    && watch?.status === 'not_allowed' && watch?.error === "finn.no doesn't let apps read its pages" && !writes.some(w => w.table === 'shop_price_points'),
    JSON.stringify(r) + ' ' + JSON.stringify(watch))

  fetched = []; writes = []
  call = shopPrice({ db: dbWith(FINN), pages: {}, fetched, writes })
  r = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
  check('sweep: a due FINN link is not fetched either; its watch says not_allowed', r.checked === 1 && r.results?.[0]?.status === 'not_allowed' && fetched.length === 0
    && writes.some(w => w.table === 'shop_price_watch' && w.row?.status === 'not_allowed'), JSON.stringify(r) + ' fetched ' + fetched.join(' '))

  fetched = []; writes = []
  const gate = 'https://www.gate.example/p'
  const challenge = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt = {}</script></body></html>'
  call = shopPrice({ db: dbWith(gate), pages: { [gate]: { status: 403, body: challenge } }, fetched, writes })
  r = await call({ action: 'read', url: gate })
  const gc = await call({ action: 'check', ids: ['i1'] })
  const gw = writes.find(w => w.table === 'shop_price_watch')?.row
  check('a bot check is blocked, said with the site\'s name ("gate.example blocks apps with a browser check") in the preview and on the watch', r.result?.status === 'blocked'
    && r.result?.reason === 'gate.example blocks apps with a browser check' && gc.results?.[0]?.status === 'blocked' && gw?.error === 'gate.example blocks apps with a browser check', JSON.stringify([r, gc, gw]))

  fetched = []; writes = []
  // More listed sites than one page of PostgREST's answer (1 000): the list is read to its end, so finn.no on page 2 still counts.
  const longList = (table, ops) => {
    if (table !== 'shop_site_policies') return dbWith(FINN)(table, ops)
    const from = ops.find(([op]) => op === 'range')?.[1] ?? 0
    return { data: from === 0 ? Array.from({ length: 1000 }, (_, i) => ({ host: `site${i}.example` })) : from === 1000 ? [{ host: 'finn.no' }] : [], error: null }
  }
  call = shopPrice({ db: longList, pages: {}, fetched, writes })
  r = await call({ action: 'read', url: FINN })
  check('a list of more than 1 000 sites is read to its end (page by page): finn.no on the second page is still refused, nothing fetched', r.result?.status === 'not_allowed'
    && r.result?.site === 'finn.no' && fetched.length === 0, JSON.stringify(r))
  const endless = (table, ops) => table === 'shop_site_policies' ? { data: Array.from({ length: 1000 }, (_, i) => ({ host: `site${i}.example` })), error: null } : dbWith(FINN)(table, ops)
  call = shopPrice({ db: endless, pages: {}, fetched, writes })
  r = await call({ action: 'read', url: 'https://shop.example/p' })
  check('…and one that never ends is no list: nothing is fetched (fail closed)', /nothing was read/.test(r.error ?? '') && fetched.length === 0, JSON.stringify(r))

  fetched = []; writes = []
  const shop = 'https://shop.example/p'
  call = shopPrice({ db: dbWith(shop, { data: null, error: { code: 'XX000', message: 'boom' } }), pages: { [shop]: { status: 200, body: page(TCL) } }, fetched, writes })
  r = await call({ action: 'read', url: shop })
  const c = await call({ action: 'check', ids: ['i1'] })
  const sw = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
  check('the list can\'t be read: read, check and the sweep fetch nothing (fail closed) and say why', fetched.length === 0 && /nothing was read/.test(r.error ?? '')
    && /nothing was read/.test(c.error ?? '') && /nothing was read/.test(sw.error ?? ''), JSON.stringify([r, c, sw]))

  fetched = []; writes = []
  call = shopPrice({ db: dbWith(shop), pages: { [shop]: { status: 200, body: page(TCL) } }, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  const point = writes.find(w => w.table === 'shop_price_points')?.row
  const w2 = writes.find(w => w.table === 'shop_price_watch')?.row
  check('a shop that is not listed is still read: its price, condition unknown, on the watch and its point', r.results?.[0]?.status === 'ok' && fetched.length === 1
    && w2?.low === 9990 && w2?.condition === 'unknown' && point?.condition === 'unknown' && point?.low === 9990, JSON.stringify(r) + JSON.stringify(w2))

  console.log('\n10 · …and reads a page only where the site\'s robots.txt allows it (the real handler, scripted)')
  const PJ_ROBOTS = { 'https://www.prisjakt.no/robots.txt': { body: fs.readFileSync(path.join(__dirname, 'fixtures/robots/www.prisjakt.no.txt'), 'utf8') } }
  const search = 'https://www.prisjakt.no/search?search=iphone'
  let robotsAsked = []
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(search), pages: {}, fetched, writes, robots: PJ_ROBOTS, robotsAsked })
  r = await call({ action: 'read', url: search })
  check('read: a Prisjakt search is not_allowed by its robots rules — said so in plain words (refusal robots), the page never fetched', r.result?.status === 'not_allowed' && r.result?.site === 'www.prisjakt.no'
    && r.result?.refusal === 'robots' && r.result?.reason === 'prisjakt.no asks apps not to read this page' && fetched.length === 0 && robotsAsked.length === 1, JSON.stringify(r))
  const product = 'https://www.prisjakt.no/product.php?p=12105530'
  const iphone = { body: fs.readFileSync(path.join(__dirname, 'fixtures/prisjakt/iphone-15-pro-128gb.html'), 'utf8') }
  call = shopPrice({ db: dbWith(product), pages: { [product]: iphone, [`${product}&a-116257=Frost`]: iphone }, fetched, writes, robots: PJ_ROBOTS, robotsAsked: (robotsAsked = []) })
  r = await call({ action: 'read', url: product })
  const again = await call({ action: 'read', url: `${product}&a-116257=Frost` })
  check('read: a product page it allows is read (its new offers), and the rules come from memory the next time', r.result?.status === 'ok' && r.result?.low === 16115
    && again.result?.status === 'ok' && robotsAsked.length === 1 && fetched.length === 2, JSON.stringify([r.result?.status, again.result?.status, robotsAsked]))
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(search), pages: {}, fetched, writes, robots: PJ_ROBOTS })
  r = await call({ action: 'check', ids: ['i1'] })
  const robotsWatch = writes.find(w => w.table === 'shop_price_watch')?.row
  check('check: the same — no fetch; the watch says not_allowed with the robots wording', r.results?.[0]?.status === 'not_allowed' && fetched.length === 0
    && robotsWatch?.status === 'not_allowed' && robotsWatch?.error === 'prisjakt.no asks apps not to read this page', JSON.stringify(robotsWatch))
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(search), pages: {}, fetched, writes, robots: PJ_ROBOTS })
  r = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
  check('sweep: the same — no fetch, not_allowed', r.results?.[0]?.status === 'not_allowed' && fetched.length === 0, JSON.stringify(r))

  const plain = 'https://plain.example/p'
  for (const [what, answer, expect] of [['answers 503', { status: 503 }, /^The site answered with an error \(503\)$/],
    ['gives no answer (a network error)', new TypeError('network'), /^The site didn't answer$/]]) {
    fetched = []; writes = []; robotsAsked = []
    call = shopPrice({ db: dbWith(plain), pages: { [plain]: { body: page(TCL) } }, fetched, writes, robots: { 'https://plain.example/robots.txt': answer }, robotsAsked })
    const c1 = await call({ action: 'check', ids: ['i1'] })
    const c2 = await call({ action: 'read', url: plain })
    const w = writes.find(x => x.table === 'shop_price_watch')?.row
    check(`a robots.txt that ${what}: the page is not read now (status error, in plain words), and the answer is kept for a while`, c1.results?.[0]?.status === 'error'
      && expect.test(w?.error ?? '') && expect.test(c2.error ?? '') && fetched.length === 0 && robotsAsked.length === 1, JSON.stringify([c1, c2, robotsAsked]))
  }
  fetched = []; writes = []; robotsAsked = []
  call = shopPrice({ db: dbWith(plain), pages: { [plain]: { body: page(TCL) } }, fetched, writes, robotsAsked })
  r = await call({ action: 'read', url: plain })
  check('a robots.txt that answers 404 sets no rules: the page is read', r.result?.status === 'ok' && r.result?.low === 9990 && robotsAsked.length === 1 && fetched.length === 1)

  const long = `https://plain.example/p?${'q'.repeat(3000)}`
  fetched = []; writes = []; robotsAsked = []
  call = shopPrice({ db: dbWith(long), pages: { [long]: { body: page(TCL) } }, fetched, writes, robotsAsked })
  r = await call({ action: 'read', url: long })
  const lc = await call({ action: 'check', ids: ['i1'] })
  check('a link with a path + query over 2 048 characters is not read now: status error, "The link is too long to read" — no robots.txt asked, no page fetched',
    r.error === 'The link is too long to read' && lc.results?.[0]?.status === 'error' && lc.results?.[0]?.error === 'The link is too long to read' && fetched.length === 0 && robotsAsked.length === 0, JSON.stringify([r, lc]))

  fetched = []; writes = []; robotsAsked = []
  const tooMany = 'User-agent: *\n' + Array.from({ length: 5001 }, (_, i) => `Disallow: /p${i}`).join('\n')
  call = shopPrice({ db: dbWith(plain), pages: { [plain]: { body: page(TCL) } }, fetched, writes, robotsAsked, robots: { 'https://plain.example/robots.txt': { body: tooMany } } })
  r = await call({ action: 'check', ids: ['i1'] })
  const tw = writes.find(x => x.table === 'shop_price_watch')?.row
  check('a robots.txt with more rules for us than 5 000 is "not read now": status error, "The site\'s rules for apps are too long to read", the page never fetched',
    r.results?.[0]?.status === 'error' && tw?.error === "The site's rules for apps are too long to read" && fetched.length === 0, JSON.stringify([r, tw?.error]))

  const hop = 'https://other.example/item'
  fetched = []; writes = []; robotsAsked = []
  call = shopPrice({ db: dbWith(plain), pages: { [plain]: { status: 302, headers: { location: hop } }, [hop]: { body: page(TCL) } }, fetched, writes, robotsAsked,
    robots: { 'https://other.example/robots.txt': { body: 'User-agent: *\nDisallow: /item' } } })
  r = await call({ action: 'read', url: plain })
  check('a redirect to another host asks that host\'s robots.txt and keeps to it: its page is never fetched', r.result?.status === 'not_allowed' && r.result?.site === 'other.example'
    && fetched.length === 1 && fetched[0] === plain && robotsAsked.includes('https://other.example/robots.txt'), JSON.stringify(r) + ' ' + fetched.join(' '))
  fetched = []; writes = []; robotsAsked = []
  call = shopPrice({ db: dbWith(plain), pages: { [plain]: { body: page(TCL) } }, fetched, writes, robotsAsked,
    robots: { 'https://plain.example/robots.txt': { status: 301, headers: { location: 'http://127.0.0.1/robots.txt' } } } })
  r = await call({ action: 'read', url: plain })
  check('a robots.txt that redirects to a private address is refused like a page would be — nothing fetched there', /not allowed/i.test(r.error ?? '')
    && fetched.length === 0 && !robotsAsked.some(u => u.includes('127.0.0.1')), JSON.stringify(r) + ' ' + robotsAsked.join(' '))

  console.log('\n11 · A read the owner starts reuses one from the last hour (the real handler, scripted)')
  const watchOf = (minutesAgo, url = plain, extra = {}) => ({ item_id: 'i1', url, checked_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), status: 'ok', error: null,
    source: 'store', name: 'TV', image: null, low: 9490, high: null, offers: null, currency: 'NOK', in_stock: true, was: null, return_days: null,
    last_ok_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), prev_low: null, prev_at: null, condition: 'unknown', used_low: null, refurbished_low: null, ...extra })
  const tv = { [plain]: { body: page(TCL) } }
  fetched = []; writes = []
  const recent = watchOf(10)
  call = shopPrice({ db: dbWith(plain, undefined, recent), pages: tv, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  check('check: a watch of the same link checked 10 minutes ago is the answer — no fetch, nothing written, said so (reused, checkedAt)',
    fetched.length === 0 && writes.length === 0 && r.results?.[0]?.reused === true && r.results?.[0]?.low === 9490 && r.results?.[0]?.checkedAt === recent.checked_at, JSON.stringify(r))
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain, undefined, watchOf(10, plain, { status: 'blocked', low: null })), pages: tv, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  check('…the same when that check was blocked: Check now tries again only after the hour', fetched.length === 0 && r.results?.[0]?.status === 'blocked' && r.results?.[0]?.reused === true)
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain, undefined, watchOf(10, plain, { status: 'error', error: "The site didn't answer in time", low: 9490 })), pages: tv, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  check('…but a check that failed 10 minutes ago read nothing: Check now reads again at once (never "already checked")', fetched.length === 1
    && r.results?.[0]?.status === 'ok' && !r.results?.[0]?.reused && r.results?.[0]?.low === 9990, JSON.stringify(r))
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(FINN, undefined, watchOf(10, FINN, { status: 'not_allowed', low: null, error: "finn.no doesn't let apps read its pages" })), pages: {}, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  check('…but a refusal is answered as itself, never "the next read can be after …" (and still nothing is fetched)', fetched.length === 0
    && r.results?.[0]?.status === 'not_allowed' && !r.results?.[0]?.reused && r.results?.[0]?.error === "finn.no doesn't let apps read its pages", JSON.stringify(r))
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain, undefined, watchOf(70)), pages: tv, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  check('check: a watch from over an hour ago is read again', fetched.length === 1 && r.results?.[0]?.status === 'ok' && !r.results?.[0]?.reused && r.results?.[0]?.low === 9990)
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain, undefined, watchOf(10, 'https://plain.example/old')), pages: tv, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  check('check: a watch of another (older) link is no answer: the new link is read', fetched.length === 1 && r.results?.[0]?.status === 'ok' && !r.results?.[0]?.reused)
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain), pages: tv, fetched, writes })
  const pasted = await call({ action: 'read', url: plain })
  const twice = await call({ action: 'read', url: plain })
  r = await call({ action: 'check', ids: ['i1'] })
  const saved = writes.find(w => w.table === 'shop_price_watch')?.row
  check('paste, paste again, then save: one read — the second preview and the check after the save reuse it (said so), stored as of when it was read',
    fetched.length === 1 && pasted.result?.status === 'ok' && !pasted.result?.reused && twice.result?.reused === true && twice.result?.at === pasted.result?.at
    && r.results?.[0]?.reused === true && r.results?.[0]?.status === 'ok' && saved?.checked_at === pasted.result?.at && saved?.low === 9990, JSON.stringify([pasted.result?.at, twice.result, r, saved?.checked_at]))
  const other = await call({ action: 'read', url: plain }, { authorization: 'Bearer other-jwt' })
  check('…another account\'s read of the same link is its own', fetched.length === 2 && other.result?.status === 'ok' && !other.result?.reused)
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain, undefined, watchOf(10)), pages: tv, fetched, writes })
  r = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
  check('the sweep keeps its own rule: a link checked under 20 h ago is not due', r.checked === 0 && fetched.length === 0, JSON.stringify(r))

  console.log('\n12 · The sweep doesn\'t ask again what said no, and asks a bot check again after a week (the real handler, scripted)')
  for (const [status, days, asked] of [['blocked', 6, false], ['blocked', 7, true], ['not_allowed', 7, false], ['not_allowed', 60, false]]) {
    fetched = []; writes = []
    call = shopPrice({ db: dbWith(plain, undefined, watchOf(days * 24 * 60, plain, { status, low: null })), pages: tv, fetched, writes })
    r = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
    check(`a ${status} answer ${days} days ago is ${asked ? '' : 'not '}asked again by the sweep${status === 'blocked' ? ' (a bot check: on the 7th Oslo day)' : ' (a refusal: never, while the link is unchanged)'}`,
      r.checked === (asked ? 1 : 0) && fetched.length === (asked ? 1 : 0), JSON.stringify(r))
  }
  for (const status of ['blocked', 'not_allowed']) {
    fetched = []; writes = []
    call = shopPrice({ db: dbWith(plain, undefined, watchOf(2 * 24 * 60, plain, { status, low: null })), pages: tv, fetched, writes })
    r = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
    check(`a link whose last answer was ${status} is not asked again by the sweep while it is unchanged (two days on)`, r.checked === 0 && fetched.length === 0 && writes.filter(w => w.table !== 'shop_price_points').length === 0, JSON.stringify(r))
    fetched = []; writes = []
    call = shopPrice({ db: dbWith(plain, undefined, watchOf(2 * 24 * 60, 'https://plain.example/old', { status, low: null })), pages: tv, fetched, writes })
    r = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
    check(`…but a new link is (the old one said ${status})`, r.checked === 1 && fetched.length === 1, JSON.stringify(r))
    fetched = []; writes = []
    call = shopPrice({ db: dbWith(plain, undefined, watchOf(2 * 60, plain, { status, low: null })), pages: tv, fetched, writes })
    r = await call({ action: 'check', ids: ['i1'] })
    check(`…and Check now still tries (its ${status} answer is over an hour old)`, fetched.length === 1 && r.results?.[0]?.status === 'ok', JSON.stringify(r))
  }
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain, undefined, watchOf(2 * 24 * 60, plain, { status: 'error', error: "The site didn't answer", low: null })), pages: tv, fetched, writes })
  r = await call({ action: 'sweep' }, { 'x-cron-secret': 'cron-secret' })
  check('a link whose last check failed (an error — robots.txt unreachable, say) is tried again the next morning', r.checked === 1 && fetched.length === 1, JSON.stringify(r))

  console.log('\n14 · No new offer on Prisjakt: a used price never stays as the price (the real handler, scripted)')
  const usedOnly = { [product]: { body: iphonePage(rows => rows.filter(r => r.condition !== 'New')) } }
  const old = (extra = {}) => watchOf(26 * 60, product, { source: 'prisjakt', name: 'Apple iPhone 15 Pro 128GB', image: 'https://cdn.example/old.jpg', low: 4990, high: 7504,
    offers: 13, currency: 'NOK', in_stock: null, prev_low: 5200, prev_at: new Date(Date.now() - 9 * 86400_000).toISOString(), condition: null, ...extra })
  for (const [what, kept] of [['read before 188 (no condition)', old()], ['Prisjakt\'s mixed figures', old({ condition: 'mixed' })]]) {
    fetched = []; writes = []
    call = shopPrice({ db: dbWith(product, undefined, kept), pages: usedOnly, fetched, writes })
    r = await call({ action: 'check', ids: ['i1'] })
    const w = writes.find(x => x.table === 'shop_price_watch')?.row
    check(`a kept price ${what} goes when the offer list has no new offer: no low, high, shops, "was", trend or price day`, r.results?.[0]?.status === 'no_price'
      && w?.low === null && w?.high === null && w?.offers === null && w?.was === null && w?.prev_low === null && w?.prev_at === null && w?.last_ok_at === null, JSON.stringify(w))
    check('…the name, the picture and the used and refurbished lows stay; condition new; said plainly; no price point',
      w?.name === 'Apple iPhone 15 Pro 128GB' && /12105530\.jpg$/.test(w?.image ?? '') && w?.used_low === 5990 && w?.refurbished_low === 6490 && w?.condition === 'new'
      && w?.error === 'No new offer on Prisjakt, only used or refurbished ones' && !writes.some(x => x.table === 'shop_price_points'), JSON.stringify(w))
  }
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(product, undefined, old({ condition: 'new', low: 16115, high: 16252, offers: 2, prev_low: null, prev_at: null })), pages: usedOnly, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  let w = writes.find(x => x.table === 'shop_price_watch')?.row
  check('a kept NEW price stays as the last new price read (with its day), the status says there is no new offer now', r.results?.[0]?.status === 'no_price'
    && w?.low === 16115 && w?.high === 16252 && w?.offers === 2 && w?.last_ok_at != null && w?.condition === 'new' && w?.used_low === 5990, JSON.stringify(w))
  fetched = []; writes = []
  const botCheck = { [product]: { status: 503, body: '<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>' } }
  call = shopPrice({ db: dbWith(product, undefined, old()), pages: botCheck, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  w = writes.find(x => x.table === 'shop_price_watch')?.row
  check('a bot check reads no offer list: the kept price stays as the last one read (the screens say what it covers)', r.results?.[0]?.status === 'blocked'
    && w?.low === 4990 && w?.condition === null && w?.last_ok_at != null, JSON.stringify(w))

  console.log('\n18 · Each price point keeps the read\'s stock (migration 190; the real handler, scripted)')
  const soldOut = JSON.parse(JSON.stringify(TCL))
  soldOut.offers[0].availability = 'https://schema.org/OutOfStock'
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain), pages: tv, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  let pt = writes.find(w => w.table === 'shop_price_points')?.row
  const seen = writes.find(w => w.table === 'shop_price_watch')?.row
  check('a shop page that says in stock: its point says so (in_stock true)', r.results?.[0]?.status === 'ok' && pt?.in_stock === true && seen?.in_stock === true, JSON.stringify(pt))
  fetched = []; writes = []
  call = shopPrice({ db: dbWith(plain), pages: { [plain]: { body: page(soldOut) } }, fetched, writes })
  r = await call({ action: 'check', ids: ['i1'] })
  pt = writes.find(w => w.table === 'shop_price_points')?.row
  check('…out of stock: its price is still read, and its point says out of stock (in_stock false)', r.results?.[0]?.status === 'ok' && pt?.in_stock === false && pt?.low === 9990, JSON.stringify(pt))
  // A read repeated within the hour adds no point only when nothing changed — the stock is part of that now. (Made
  // here with a watch whose last price is 20 minutes old while its last check is over an hour old.)
  const lastOk = watchOf(70, plain, { low: seen.low, high: seen.high, offers: seen.offers, condition: seen.condition, last_ok_at: new Date(Date.now() - 20 * 60_000).toISOString() })
  for (const [was, adds] of [[true, false], [false, true]]) {
    fetched = []; writes = []
    call = shopPrice({ db: dbWith(plain, undefined, { ...lastOk, in_stock: was }), pages: tv, fetched, writes })
    r = await call({ action: 'check', ids: ['i1'] })
    check(adds ? '…and a repeat within the hour that is back in stock adds a point' : 'a repeat within the hour with the same price and stock adds no point',
      fetched.length === 1 && r.results?.[0]?.status === 'ok' && writes.some(w => w.table === 'shop_price_points') === adds, JSON.stringify(writes.map(w => w.table)))
  }
}

handlerChecks().catch(e => { failed++; console.log(`  ✗ the handler checks threw: ${e.stack}`) }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})
