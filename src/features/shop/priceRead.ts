// Reads a product's price from a shop or price-comparison page — the
// schema.org data every big shop publishes for search engines. Pure: the
// `shop-price` edge function fetches the page and runs this; the app only
// reads the stored result. scripts/verify-shop-price-read.cjs runs it against
// fixtures copied from real pages and checks the mirror below is identical.
//
// Shapes verified live on 08.10.2026:
//   · Prisjakt (www.prisjakt.no/product.php?p=…): `Product` with
//     `offers: AggregateOffer {lowPrice, highPrice, offerCount, priceCurrency}`,
//     or a `ProductGroup` whose `hasVariant[]` each carry that AggregateOffer
//     (a link with `a-NNN=Colour` picks that variant). Prices are numbers.
//   · Elkjøp: `Product` with `offers: [Offer {price: "9990", priceCurrency,
//     availability, eligibleCustomerType}]` and `gtin13`.
// A Cloudflare challenge page ("Just a moment…") is reported as `blocked`,
// never as a missing price.
//
// The block between the <price-read> markers is a HAND MIRROR in
// supabase/functions/shop-price/index.ts (Deno cannot import from src/).

// <price-read>
export type PriceReadStatus = 'ok' | 'no_price' | 'blocked'

export interface PriceRead {
  status: PriceReadStatus
  /** The product's name as the page gives it. */
  name: string | null
  image: string | null
  brand: string | null
  gtin: string | null
  /** The lowest price on the page (Prisjakt: the cheapest shop). */
  low: number | null
  /** The highest offer (Prisjakt) — equal to `low` for a single shop. */
  high: number | null
  /** How many shops sell it (Prisjakt), else null. */
  offers: number | null
  currency: string | null
  inStock: boolean | null
  /** The struck-through "before" price a shop shows beside a sale price (Elkjøp's StrikethroughPrice). */
  was: number | null
  /** The shop's own return window for everyone (not a members-only one), in days — "30-day open purchase". */
  returnDays: number | null
  /** 'prisjakt' when the page is Prisjakt's, else 'store'. */
  source: 'prisjakt' | 'store'
}

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function types(node: Json): string[] {
  const t = node['@type']
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string').map(x => x.replace(/^https?:\/\/schema\.org\//, ''))
}

/** Parses "9 990,00", "9990.00", "kr 1.299,-", 2490 → a number, else null. */
export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  if (typeof v !== 'string') return null
  let s = v.replace(/[^\d.,-]/g, '').replace(/,-$/, '').replace(/-+$/, '')
  if (!/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // The later separator is the decimal one: "1.299,50" / "1,299.50".
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma > -1) {
    // "1299,50" is a decimal; "9,990" (three digits after) is a thousands mark.
    s = /,\d{3}$/.test(s) && s.indexOf(',') === lastComma ? s.replace(',', '') : s.replace(',', '.')
  } else if (lastDot > -1 && /\.\d{3}$/.test(s) && s.indexOf('.') !== lastDot) {
    s = s.replace(/\./g, '')
  } else if (lastDot > -1 && /^\d{1,3}\.\d{3}$/.test(s)) {
    // "9.990" in Norwegian is nine thousand nine hundred and ninety.
    s = s.replace('.', '')
  }
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Every JSON-LD node on the page, flattening arrays and `@graph`. */
export function jsonLdNodes(html: string): Json[] {
  const out: Json[] = []
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const raw = m[1].trim().replace(/^<!--/, '').replace(/-->$/, '').replace(/^\/\/<!\[CDATA\[/, '').replace(/\/\/\]\]>$/, '').trim()
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { continue }
    const stack: unknown[] = [parsed]
    while (stack.length) {
      const v = stack.pop()
      if (Array.isArray(v)) { stack.push(...v); continue }
      if (!isObj(v)) continue
      out.push(v)
      if (Array.isArray(v['@graph'])) stack.push(...(v['@graph'] as unknown[]))
    }
  }
  return out
}

function firstString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (Array.isArray(v)) { for (const x of v) { const s = firstString(x); if (s) return s } return null }
  if (isObj(v)) return firstString(v.url ?? v.contentUrl ?? v['@id'] ?? v.name)
  return null
}

interface OfferSummary {
  low: number | null; high: number | null; count: number | null; currency: string | null; inStock: boolean | null
  was: number | null; returnDays: number | null
}

const asList = (v: unknown): Json[] => (Array.isArray(v) ? v : v == null ? [] : [v]).filter(isObj)

/** A struck-through list price among an offer's price specifications ("was 14 999"). */
function wasPrice(o: Json): number | null {
  for (const spec of asList(o.priceSpecification)) {
    if (/Strikethrough|ListPrice|MSRP/i.test(String(spec.priceType ?? ''))) {
      const v = parsePrice(spec.price)
      if (v != null) return v
    }
  }
  return null
}

/** The shortest return window open to everyone (a members-only policy has `validForMemberTier`). */
function returnDays(o: Json): number | null {
  let best: number | null = null
  for (const p of asList(o.hasMerchantReturnPolicy)) {
    if (p.validForMemberTier) continue
    const d = typeof p.merchantReturnDays === 'number' ? p.merchantReturnDays : parsePrice(p.merchantReturnDays)
    if (d != null && d > 0 && d < 400) best = best == null ? d : Math.min(best, d)
  }
  return best
}

/** Offers that only a member / business may use are left out when public ones exist. */
function isPublic(o: Json): boolean {
  const t = o.eligibleCustomerType
  const s = JSON.stringify(t ?? '').toLowerCase()
  return !t || s.includes('public')
}

function offerSummary(offers: unknown): OfferSummary | null {
  const list = (Array.isArray(offers) ? offers : [offers]).filter(isObj)
  if (!list.length) return null
  const agg = list.find(o => types(o).includes('AggregateOffer'))
  if (agg) {
    const low = parsePrice(agg.lowPrice ?? agg.price)
    const high = parsePrice(agg.highPrice) ?? low
    const count = typeof agg.offerCount === 'number' ? agg.offerCount : parsePrice(agg.offerCount)
    return { low, high, count: count == null ? null : Math.round(count), currency: firstString(agg.priceCurrency), inStock: null, was: null, returnDays: null }
  }
  const pub = list.filter(isPublic)
  const pool = pub.length ? pub : list
  let best: { price: number; currency: string | null; inStock: boolean | null; offer: Json } | null = null
  let high: number | null = null
  for (const o of pool) {
    const spec = asList(o.priceSpecification)[0] ?? null
    const price = parsePrice(o.price ?? o.lowPrice ?? spec?.price)
    if (price == null) continue
    const avail = String(o.availability ?? '')
    const inStock = avail ? /InStock|LimitedAvailability|OnlineOnly|InStoreOnly/i.test(avail) : null
    const currency = firstString(o.priceCurrency ?? spec?.priceCurrency)
    if (!best || price < best.price) best = { price, currency, inStock, offer: o }
    high = high == null ? price : Math.max(high, price)
  }
  if (!best) return null
  const was = wasPrice(best.offer)
  return {
    low: best.price, high, count: null, currency: best.currency, inStock: best.inStock,
    was: was != null && was > best.price ? was : null,
    returnDays: returnDays(best.offer),
  }
}

/**
 * A product group with no variant picked: the cheapest variant's price is the
 * group's low, the dearest its high, and the most shops any variant has its count
 * (the same shops sell several colours, so counts are never added up).
 */
function groupSummary(variants: Json[]): OfferSummary | null {
  let out: OfferSummary | null = null
  for (const v of variants) {
    const s = offerSummary(v.offers)
    if (s?.low == null) continue
    if (!out) { out = { ...s }; continue }
    if (s.low < (out.low ?? Infinity)) { out.low = s.low; out.currency = s.currency ?? out.currency }
    out.high = Math.max(out.high ?? s.low, s.high ?? s.low)
    out.count = s.count == null ? out.count : Math.max(out.count ?? 0, s.count)
  }
  return out
}

/** The Prisjakt variant the link points at (`a-116257=Frost`), matched on the variant's own url. */
function variantFor(variants: Json[], pageUrl: string): Json | null {
  let attrs: string[] = []
  try { attrs = [...new URL(pageUrl).searchParams.entries()].filter(([k]) => /^a-\d+$/.test(k)).map(([k, v]) => `${k}=${v}`.toLowerCase()) } catch { attrs = [] }
  if (!attrs.length) return null
  return variants.find(v => {
    const u = String(v.url ?? '').toLowerCase()
    let decoded = u
    try { decoded = decodeURIComponent(u) } catch { decoded = u }
    return attrs.every(a => decoded.includes(a) || u.includes(a))
  }) ?? null
}

/**
 * A bot check instead of the page: Cloudflare's "Just a moment…" /
 * "Attention Required!" (Prisjakt's search, Proshop) or a "Client Challenge"
 * (Clas Ohlson, seen 08.10.2026). Only the check itself carries these —
 * Cloudflare's `challenge-platform` script is on every Prisjakt page, real
 * ones included, so it proves nothing.
 */
export function isChallengePage(html: string): boolean {
  return /<title>\s*(Just a moment|Attention Required!|Client Challenge)/i.test(html) || /window\._cf_chl_opt|cf-browser-verification/i.test(html)
}

export function isPrisjaktUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return /(^|\.)prisjakt\.no$/i.test(u.hostname) && /^\/(product|produkt)\.php$/i.test(u.pathname) && /^\d+$/.test(u.searchParams.get('p') ?? '')
  } catch { return false }
}

/** The price a product page shows, or why there is none. */
export function readPrice(html: string, pageUrl: string): PriceRead {
  const source: PriceRead['source'] = /prisjakt\.no/i.test(pageUrl) ? 'prisjakt' : 'store'
  const empty: PriceRead = { status: 'no_price', name: null, image: null, brand: null, gtin: null, low: null, high: null, offers: null, currency: null, inStock: null, was: null, returnDays: null, source }
  if (isChallengePage(html)) return { ...empty, status: 'blocked' }
  const nodes = jsonLdNodes(html)
  const products = nodes.filter(n => { const t = types(n); return t.includes('Product') || t.includes('ProductGroup') })
  for (const p of products) {
    const variants = Array.isArray(p.hasVariant) ? (p.hasVariant as unknown[]).filter(isObj) : []
    const picked = variants.length ? variantFor(variants, pageUrl) : null
    let summary: OfferSummary | null = null
    let from: Json = p
    if (picked) { summary = offerSummary(picked.offers); from = picked }
    if (!summary) summary = offerSummary(p.offers)
    if (!summary && variants.length) summary = groupSummary(variants)
    const brand = isObj(p.brand) ? firstString(p.brand.name) : firstString(p.brand)
    const gtin = firstString(p.gtin13 ?? p.gtin ?? p.gtin12 ?? p.gtin14 ?? p.gtin8 ?? from.gtin13)
    const result: PriceRead = {
      ...empty,
      name: firstString(from.name) ?? firstString(p.name),
      image: firstString(from.image) ?? firstString(p.image),
      brand,
      gtin,
    }
    if (summary?.low != null) {
      return {
        ...result, status: 'ok', low: summary.low, high: summary.high, offers: summary.count,
        currency: summary.currency?.toUpperCase() ?? null, inStock: summary.inStock, was: summary.was, returnDays: summary.returnDays,
      }
    }
    if (result.name) return result
  }
  return empty
}
// </price-read>
