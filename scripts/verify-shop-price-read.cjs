#!/usr/bin/env node
/*
 * Verification — Shop's price watch reader (src/features/shop/priceRead.ts)
 * and its hand mirror in supabase/functions/shop-price/index.ts.
 * The fixtures are the JSON-LD blocks of real pages, fetched 08.10.2026 and
 * trimmed (Prisjakt product group + product, an Elkjøp product page, a
 * Cloudflare check page). Run: node scripts/verify-shop-price-read.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const { readPrice, parsePrice, isChallengePage, isPrisjaktUrl, jsonLdNodes } = require('../src/features/shop/priceRead')

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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
