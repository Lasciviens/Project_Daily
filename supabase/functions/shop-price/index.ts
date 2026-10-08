// shop-price — Shop's price watch and its exchange rates (migration 137).
//
// 1. Prices. Reads the schema.org Product / Offer / AggregateOffer data that
//    shops and Prisjakt publish for search engines (Prisjakt: the lowest price,
//    the highest and how many shops; a shop page: its own price, a struck-out
//    "before" price and its return days). Prisjakt has no public API — this is
//    the page's public data, read at most once a day per item; it can stop
//    working if they change their pages or block servers, and a Cloudflare
//    check ("Just a moment…") is reported as `blocked`, never as a price. The
//    block between the <price-read> markers is a HAND MIRROR of
//    src/features/shop/priceRead.ts (scripts/verify-shop-price-read.cjs fails
//    while the two differ).
//    Each check upserts shop_price_watch (the last result; a failed check
//    keeps the last price read and says why) and, when a price was read, adds
//    one shop_price_points row. It never writes shop_items.
// 2. Rates. Norges Bank's daily rates to NOK (data.norges-bank.no, no key) for
//    the purchases, sales and extra costs still waiting for theirs: fetched,
//    cached in fx_rates_nok, then those rows are touched so the database's own
//    trigger fills them. The block between the <fx-norges-bank> markers is a
//    HAND MIRROR of src/features/shop/fxNorgesBank.ts
//    (scripts/verify-shop-owned.cjs checks it).
//
// Auth (verify_jwt OFF — the cron sends no JWT):
//   · a browser JWT, resolved with getUser (the trakt-api pattern), or
//   · the daily cron's `x-cron-secret: <SHOP_PRICE_CRON_SECRET>` (acts as
//     HEVY_USER_ID; only the `sweep` action).
//
// POST { action: 'read', url }          → { result }   a preview, nothing stored
// POST { action: 'check', ids: [≤ 10] } → { results }  the caller's own rows with a link
// POST { action: 'rates' }              → { rates }    fill the caller's pending rates
// POST { action: 'sweep' }  (cron)      → { rates, checked, left, results }
//   rates first, then the due links: things to buy (a model only while its
//   general wish is open) and things you own that can still be returned —
//   no check in 20 h, oldest first, ≤ 40 per run, 1.5 s between two calls to
//   one host, stopping after 100 s (the rest wait for tomorrow).
//
// Fetch safety is news-article's: http/https only, private hosts refused on
// every redirect hop (≤ 5), 8 s, 3 MB, text/html only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UA = 'Mozilla/5.0 (compatible; LascisBoard/1.0; +https://lasciviens.github.io/Project_Daily)'
const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 8000
const USER_LIMIT = 10
const SWEEP_LIMIT = 40
const DUE_HOURS = 20
const HOST_GAP_MS = 1500

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateHost(hostname: string): boolean {
  let h = hostname.toLowerCase().trim()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true
    const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mapped) return isPrivateIPv4(mapped[1])
    if (/^f[cd]/.test(h)) return true
    if (/^fe[89ab]/.test(h)) return true
    return false
  }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return isPrivateIPv4(h)
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true
  return false
}

class FetchError extends Error { constructor(public code: string, message: string) { super(message) } }

async function readCapped(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BYTES) { await reader.cancel(); break }
    chunks.push(value)
  }
  const out = new Uint8Array(Math.min(total, MAX_BYTES))
  let off = 0
  for (const c of chunks) { out.set(c.subarray(0, out.length - off), off); off += c.length; if (off >= out.length) break }
  return out
}

function decode(bytes: Uint8Array, contentType: string | null): string {
  let charset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
  }
  try { return new TextDecoder((charset ?? 'utf-8').toLowerCase()).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

/** The page's HTML; a 403/503 with a Cloudflare check comes back as HTML too, so the reader can say "blocked". */
async function fetchPage(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    let current = rawUrl
    for (let hop = 0; ; hop++) {
      let url: URL
      try { url = new URL(current) } catch { throw new FetchError('bad_url', 'Not a link') }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('bad_url', 'Only http and https links can be read')
      if (url.username || url.password || isPrivateHost(url.hostname)) throw new FetchError('not_allowed', 'This address is not allowed')
      const res = await fetch(url.toString(), {
        signal: ctl.signal,
        redirect: 'manual',
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.8,tr;q=0.7' },
      })
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (location) {
        await res.body?.cancel()
        if (hop >= 5) throw new FetchError('upstream', 'Too many redirects')
        current = new URL(location, url).toString()
        continue
      }
      const type = res.headers.get('content-type')
      const html = type && !/text\/html|application\/xhtml/i.test(type) ? null : decode(await readCapped(res), type)
      if (html == null) { await res.body?.cancel(); throw new FetchError('not_html', 'The link is not a web page') }
      if (!res.ok && !isChallengePage(html)) throw new FetchError('upstream', `The site answered ${res.status}`)
      return { html, finalUrl: url.toString() }
    }
  } catch (e) {
    if (e instanceof FetchError) throw e
    if ((e as Error).name === 'AbortError') throw new FetchError('timeout', 'The site took too long to answer')
    throw new FetchError('upstream', 'Could not reach the site')
  } finally {
    clearTimeout(timer)
  }
}

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

// <fx-norges-bank>
export const NB_CURRENCIES = ['TRY', 'EUR', 'USD'] as const

/** The query for every currency we need over a range of days (yyyy-mm-dd). */
export function norgesBankUrl(from: string, to: string, currencies: readonly string[] = NB_CURRENCIES): string {
  const list = currencies.filter(c => (NB_CURRENCIES as readonly string[]).includes(c))
  return `https://data.norges-bank.no/api/data/EXR/B.${(list.length ? list : NB_CURRENCIES).join('+')}.NOK.SP?format=sdmx-json&startPeriod=${from}&endPeriod=${to}&locale=en`
}

export interface NbRate { currency: string; day: string; nokPerUnit: number }

type J = Record<string, unknown>
const obj = (v: unknown): J => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as J : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Every published rate in a Norges Bank SDMX-JSON answer, as NOK per ONE unit (TRY's per-100 quote divided). */
export function parseNorgesBank(json: unknown): NbRate[] {
  const data = obj(obj(json).data)
  const structure = obj(data.structure)
  const dims = obj(structure.dimensions)
  const seriesDims = arr(dims.series).map(obj)
  const timeValues = arr(obj(arr(dims.observation)[0]).values).map(v => String(obj(v).id ?? ''))
  const baseIdx = seriesDims.findIndex(d => d.id === 'BASE_CUR')
  const quoteIdx = seriesDims.findIndex(d => d.id === 'QUOTE_CUR')
  const seriesAttrs = arr(obj(structure.attributes).series).map(obj)
  const multIdx = seriesAttrs.findIndex(a => a.id === 'UNIT_MULT')
  const out: NbRate[] = []
  const sets = arr(data.dataSets)
  for (const [key, raw] of Object.entries(obj(obj(sets[0]).series))) {
    const parts = key.split(':').map(Number)
    const base = String(obj(arr(seriesDims[baseIdx]?.values)[parts[baseIdx]]).id ?? '')
    const quote = quoteIdx >= 0 ? String(obj(arr(seriesDims[quoteIdx]?.values)[parts[quoteIdx]]).id ?? '') : 'NOK'
    if (!base || quote !== 'NOK') continue
    const s = obj(raw)
    const attrIdx = arr(s.attributes)[multIdx]
    const multRaw = multIdx >= 0 && typeof attrIdx === 'number' ? obj(arr(seriesAttrs[multIdx].values)[attrIdx]).id : '0'
    const mult = Math.pow(10, Number(multRaw ?? 0) || 0)
    for (const [t, o] of Object.entries(obj(s.observations))) {
      const day = timeValues[Number(t)]
      const value = Number(String(arr(o)[0] ?? '').replace(',', '.'))
      if (!day || !Number.isFinite(value) || value <= 0) continue
      out.push({ currency: base, day, nokPerUnit: value / mult })
    }
  }
  return out.sort((a, b) => a.currency.localeCompare(b.currency) || a.day.localeCompare(b.day))
}

function addDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
const isWeekend = (day: string) => { const [y, m, d] = day.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w === 0 || w === 6 }

export interface CalendarRate { day: string; currency: string; nok_per_unit: number; rate_day: string }

/**
 * One rate per calendar day from `from` to `to`: a business day its own, any
 * other day the last business day's before it. A day after the last published
 * one is filled only across a weekend — a weekday may simply not be published
 * yet (or be a holiday the next answer will show), so it waits.
 */
export function calendarRates(rates: readonly NbRate[], from: string, to: string): CalendarRate[] {
  const out: CalendarRate[] = []
  const byCur = new Map<string, NbRate[]>()
  for (const r of rates) byCur.set(r.currency, [...(byCur.get(r.currency) ?? []), r])
  for (const [currency, list] of byCur) {
    list.sort((a, b) => a.day.localeCompare(b.day))
    const lastPublished = list[list.length - 1].day
    let k = -1
    for (let day = from; day <= to; day = addDay(day, 1)) {
      while (k + 1 < list.length && list[k + 1].day <= day) k++
      if (k < 0) continue
      if (day > lastPublished) {
        let ok = true
        for (let d = addDay(lastPublished, 1); d <= day; d = addDay(d, 1)) if (!isWeekend(d)) { ok = false; break }
        if (!ok) continue
      }
      out.push({ day, currency, nok_per_unit: list[k].nokPerUnit, rate_day: list[k].day })
    }
  }
  return out
}
// </fx-norges-bank>

type Item = { id: string; url: string | null }
type Watch = {
  item_id: string; url: string | null; checked_at: string; status: string; error: string | null; source: string | null
  name: string | null; image: string | null; low: number | null; high: number | null; offers: number | null
  currency: string | null; in_stock: boolean | null; was: number | null; return_days: number | null
  last_ok_at: string | null; prev_low: number | null; prev_at: string | null
}

interface CheckOutcome {
  id: string
  status: PriceReadStatus | 'error'
  low: number | null
  currency: string | null
  error?: string
}

const WATCH_COLUMNS = 'item_id, url, checked_at, status, error, source, name, image, low, high, offers, currency, in_stock, was, return_days, last_ok_at, prev_low, prev_at'
const POINTS_KEEP_DAYS = 730
const SWEEP_BUDGET_MS = 100_000
const NOT_MIGRATED = 'Apply migration 137 first'
const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|Could not find the table/i.test(e.message ?? ''))

const lastByHost = new Map<string, number>()

async function politeRead(url: string): Promise<PriceRead & { finalUrl: string }> {
  let host = ''
  try { host = new URL(url).hostname } catch { /* checked by fetchPage */ }
  const last = lastByHost.get(host) ?? 0
  const wait = last + HOST_GAP_MS - Date.now()
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastByHost.set(host, Date.now())
  const { html, finalUrl } = await fetchPage(url)
  return { ...readPrice(html, finalUrl), finalUrl }
}

/**
 * One check. The watch keeps the last price really read: a blocked or failed
 * check updates only its time, status and error. `prev_low` is the last
 * DIFFERENT price before the current one (the card's "↓ 500 since …"), and a
 * point is added for every price read — except a repeat within the hour with
 * nothing changed (a second tap on Check now).
 */
// deno-lint-ignore no-explicit-any
async function checkRow(supabase: any, userId: string, item: Item, prev: Watch | null): Promise<CheckOutcome> {
  const at = new Date().toISOString()
  const url = String(item.url)
  let read: (PriceRead & { finalUrl: string }) | null = null
  let failure: string | null = null
  try { read = await politeRead(url) } catch (e) { failure = e instanceof FetchError ? e.message : 'Could not read the page' }

  // The link may have changed while the page was read (that deletes the watch); never save a price for the old one.
  const { data: now } = await supabase.from('shop_items').select('url').eq('id', item.id).eq('user_id', userId).maybeSingle()
  if (!now || now.url !== url) return { id: item.id, status: 'error', low: null, currency: null, error: 'The link changed while it was checked' }

  const same = prev && prev.url === url ? prev : null
  const kept = {
    source: same?.source ?? null, name: same?.name ?? null, image: same?.image ?? null, low: same?.low ?? null, high: same?.high ?? null,
    offers: same?.offers ?? null, currency: same?.currency ?? null, in_stock: same?.in_stock ?? null, was: same?.was ?? null,
    return_days: same?.return_days ?? null, last_ok_at: same?.last_ok_at ?? null, prev_low: same?.prev_low ?? null, prev_at: same?.prev_at ?? null,
  }
  let row: Record<string, unknown>
  let outcome: CheckOutcome
  if (read && read.status === 'ok' && read.low != null) {
    const changed = kept.low != null && kept.low !== read.low
    row = {
      source: read.source, name: read.name, image: read.image, low: read.low, high: read.high, offers: read.offers,
      currency: read.currency, in_stock: read.inStock, was: read.was, return_days: read.returnDays, last_ok_at: at,
      prev_low: changed ? kept.low : kept.prev_low, prev_at: changed ? kept.last_ok_at : kept.prev_at,
      status: 'ok', error: null,
    }
    outcome = { id: item.id, status: 'ok', low: read.low, currency: read.currency }
    const repeat = same && same.status === 'ok' && same.last_ok_at && Date.parse(at) - Date.parse(same.last_ok_at) < 3600_000
      && same.low === read.low && same.high === read.high && same.offers === read.offers
    if (!repeat) {
      const { error } = await supabase.from('shop_price_points').insert({
        user_id: userId, item_id: item.id, checked_at: at, low: read.low, high: read.high, offers: read.offers, currency: read.currency, source: read.source,
      })
      if (error) return { ...outcome, status: 'error', error: missingTable(error) ? NOT_MIGRATED : error.message }
    }
  } else {
    const status = read ? read.status : 'error'
    const error = read
      ? (read.status === 'blocked' ? 'The site asked for a browser check — it blocks automatic reads' : 'No price found on the page')
      : failure
    // A page that answered without a price still tells its name and picture.
    row = { ...kept, name: read?.name ?? kept.name, image: read?.image ?? kept.image, status, error }
    outcome = { id: item.id, status, low: null, currency: null, error: error ?? undefined }
  }
  const { error } = await supabase.from('shop_price_watch').upsert({ item_id: item.id, user_id: userId, url, checked_at: at, ...row }, { onConflict: 'item_id' })
  if (error) return { ...outcome, status: 'error', error: missingTable(error) ? NOT_MIGRATED : error.message }
  return outcome
}

// deno-lint-ignore no-explicit-any
async function watchesFor(supabase: any, ids: string[]): Promise<Map<string, Watch>> {
  const out = new Map<string, Watch>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('shop_price_watch').select(WATCH_COLUMNS).in('item_id', ids.slice(i, i + 200))
    if (error) throw error
    for (const w of (data ?? []) as Watch[]) out.set(w.item_id, w)
  }
  return out
}

const osloDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

/** The links due a check: things to buy (a model while its wish is open) and things you own that can still go back. */
// deno-lint-ignore no-explicit-any
async function dueItems(supabase: any, userId: string): Promise<Item[]> {
  const today = osloDay(new Date().toISOString())
  const { data, error } = await supabase
    .from('shop_items')
    .select('id, url, status, kind, option_for, disposal, return_by')
    .eq('user_id', userId)
    .eq('list', 'wishlist')
    .in('status', ['wishlist', 'bought'])
    .not('url', 'is', null)
    .limit(1000)
  if (error) throw error
  type R = Item & { status: string; kind: string; option_for: string | null; disposal: string | null; return_by: string | null }
  const rows = (data ?? []) as R[]
  const wishIds = [...new Set(rows.map(r => r.option_for).filter((x): x is string => !!x))]
  const openWish = new Set<string>()
  if (wishIds.length) {
    const { data: wishes, error: wErr } = await supabase.from('shop_items').select('id').in('id', wishIds).eq('status', 'wishlist')
    if (wErr) throw wErr
    for (const w of (wishes ?? []) as { id: string }[]) openWish.add(w.id)
  }
  return rows.filter(r => /^https?:\/\//i.test(String(r.url)) && r.kind === 'item' && (
    r.status === 'wishlist' ? (!r.option_for || openWish.has(r.option_for)) : (!r.disposal && !!r.return_by && r.return_by >= today)
  ))
}

interface RatesResult { needed: number; filled: number; pending: number; error?: string }

/**
 * Fills the rates the caller's rows wait for: which (currency, day) pairs are
 * missing, Norges Bank's answer for that span (a week before it, so a weekend
 * or a holiday at the start has a business day to carry), cached in
 * fx_rates_nok, then each waiting row is touched with its own rate column set
 * to NULL (it already is) — the trigger looks the rate up again. A rate typed
 * by hand is never in the list (its column is not NULL), so nothing else
 * changes.
 */
// deno-lint-ignore no-explicit-any
async function fillRates(supabase: any, userId: string): Promise<RatesResult> {
  const need = new Map<string, Set<string>>() // currency → days
  const want = (currency: string | null, day: string | null) => {
    if (!currency || currency === 'NOK' || !day) return
    need.set(currency, (need.get(currency) ?? new Set()).add(day))
  }
  const bought = await supabase.from('shop_items').select('id, currency, bought_at').eq('user_id', userId)
    .eq('status', 'bought').not('price', 'is', null).neq('currency', 'NOK').is('fx_nok', null).limit(1000)
  if (bought.error) return { needed: 0, filled: 0, pending: 0, error: missingTable(bought.error) || /fx_nok/.test(bought.error.message ?? '') ? NOT_MIGRATED : bought.error.message }
  const sold = await supabase.from('shop_items').select('id, sale_currency, disposed_on').eq('user_id', userId)
    .not('sale_price', 'is', null).neq('sale_currency', 'NOK').is('sale_fx_nok', null).limit(1000)
  const costs = await supabase.from('shop_item_costs').select('id, currency, spent_on').eq('user_id', userId)
    .neq('currency', 'NOK').is('fx_nok', null).limit(1000)
  if (sold.error || costs.error) return { needed: 0, filled: 0, pending: 0, error: (sold.error ?? costs.error).message }
  const boughtRows = (bought.data ?? []) as { id: string; currency: string; bought_at: string | null }[]
  const soldRows = (sold.data ?? []) as { id: string; sale_currency: string; disposed_on: string | null }[]
  const costRows = (costs.data ?? []) as { id: string; currency: string; spent_on: string }[]
  for (const r of boughtRows) want(r.currency, r.bought_at ? osloDay(r.bought_at) : null)
  for (const r of soldRows) want(r.sale_currency, r.disposed_on)
  for (const r of costRows) want(r.currency, r.spent_on)
  const pairs = [...need].flatMap(([c, days]) => [...days].map(d => ({ c, d })))
  if (!pairs.length) return { needed: 0, filled: 0, pending: 0 }

  // Already cached (a day another row filled): only the rows need touching.
  const days = pairs.map(p => p.d).sort()
  const today = osloDay(new Date().toISOString())
  const to = days[days.length - 1] > today ? today : days[days.length - 1]
  const from = days[0]
  const { data: cached } = await supabase.from('fx_rates_nok').select('day, currency').gte('day', from).lte('day', to)
  const have = new Set(((cached ?? []) as { day: string; currency: string }[]).map(r => `${r.currency}|${r.day}`))
  const missing = pairs.filter(p => !have.has(`${p.c}|${p.d}`))

  let error: string | undefined
  if (missing.length) {
    const start = new Date(Date.parse(`${missing.map(p => p.d).sort()[0]}T00:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10)
    const end = missing.map(p => p.d).sort().pop() as string
    const currencies = [...new Set(missing.map(p => p.c))]
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 10_000)
      const res = await fetch(norgesBankUrl(start, end > today ? today : end, currencies), { signal: ctl.signal, headers: { Accept: 'application/vnd.sdmx.data+json, application/json' } })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`Norges Bank answered ${res.status}`)
      const calendar = calendarRates(parseNorgesBank(await res.json()), start, end > today ? today : end)
      const wanted = new Set(missing.map(p => `${p.c}|${p.d}`))
      const rows = calendar.filter(r => wanted.has(`${r.currency}|${r.day}`))
      for (let i = 0; i < rows.length; i += 500) {
        const { error: upErr } = await supabase.from('fx_rates_nok').upsert(rows.slice(i, i + 500), { onConflict: 'day,currency' })
        if (upErr) throw upErr
      }
      for (const r of rows) have.add(`${r.currency}|${r.day}`)
    } catch (e) {
      error = (e as Error).name === 'AbortError' ? 'Norges Bank took too long to answer' : (e as Error).message
    }
  }

  // Touch the rows whose rate is now cached.
  const ready = (c: string | null, d: string | null) => !!c && !!d && have.has(`${c}|${d}`)
  const ids = (list: { id: string }[]) => list.map(r => r.id)
  const boughtReady = ids(boughtRows.filter(r => ready(r.currency, r.bought_at ? osloDay(r.bought_at) : null)))
  const soldReady = ids(soldRows.filter(r => ready(r.sale_currency, r.disposed_on)))
  const costReady = ids(costRows.filter(r => ready(r.currency, r.spent_on)))
  let filled = 0
  for (let i = 0; i < boughtReady.length; i += 200) {
    const { data, error: e } = await supabase.from('shop_items').update({ fx_nok: null }).eq('user_id', userId).in('id', boughtReady.slice(i, i + 200)).is('fx_nok', null).select('id, fx_nok')
    if (e) { error = e.message; break }
    filled += ((data ?? []) as { fx_nok: number | null }[]).filter(r => r.fx_nok != null).length
  }
  for (let i = 0; i < soldReady.length; i += 200) {
    const { data, error: e } = await supabase.from('shop_items').update({ sale_fx_nok: null }).eq('user_id', userId).in('id', soldReady.slice(i, i + 200)).is('sale_fx_nok', null).select('id, sale_fx_nok')
    if (e) { error = e.message; break }
    filled += ((data ?? []) as { sale_fx_nok: number | null }[]).filter(r => r.sale_fx_nok != null).length
  }
  for (let i = 0; i < costReady.length; i += 200) {
    const { data, error: e } = await supabase.from('shop_item_costs').update({ fx_nok: null }).eq('user_id', userId).in('id', costReady.slice(i, i + 200)).is('fx_nok', null).select('id, fx_nok')
    if (e) { error = e.message; break }
    filled += ((data ?? []) as { fx_nok: number | null }[]).filter(r => r.fx_nok != null).length
  }
  const total = boughtRows.length + soldRows.length + costRows.length
  return { needed: total, filled, pending: total - filled, ...(error ? { error } : {}) }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const started = Date.now()
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let body: { action?: string; url?: unknown; ids?: unknown } = {}
  try { body = await req.json() } catch { /* empty */ }

  let userId: string
  const sentSecret = req.headers.get('x-cron-secret')
  if (sentSecret) {
    const secret = Deno.env.get('SHOP_PRICE_CRON_SECRET')
    if (!secret || sentSecret !== secret) return json({ error: 'Invalid cron secret' }, 401)
    const owner = Deno.env.get('HEVY_USER_ID')
    if (!owner) return json({ error: 'HEVY_USER_ID is not set' }, 500)
    userId = owner
    body.action = 'sweep'
  } else {
    const auth = req.headers.get('authorization')
    if (!auth) return json({ error: 'Missing authorization header' }, 401)
    const { data: { user }, error } = await supabase.auth.getUser(auth.replace('Bearer ', ''))
    if (error || !user) return json({ error: 'Invalid token' }, 401)
    userId = user.id
    if (body.action === 'sweep') return json({ error: 'The sweep runs from the cron only' }, 403)
  }

  if (body.action === 'read') {
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) return json({ error: 'url required' }, 400)
    try {
      const r = await politeRead(url)
      return json({ result: { ...r, at: new Date().toISOString() } })
    } catch (e) {
      return json({ error: e instanceof FetchError ? e.message : 'Could not read the page', code: e instanceof FetchError ? e.code : 'upstream' }, 200)
    }
  }

  if (body.action === 'rates') return json({ rates: await fillRates(supabase, userId) })

  if (body.action === 'check') {
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === 'string').slice(0, USER_LIMIT)
    if (!ids.length) return json({ error: 'ids required' }, 400)
    const { data, error } = await supabase.from('shop_items').select('id, url').eq('user_id', userId).in('id', ids)
    if (error) return json({ error: error.message }, 200)
    let watches: Map<string, Watch>
    try { watches = await watchesFor(supabase, ids) } catch (e) { return json({ error: missingTable(e as { code?: string }) ? NOT_MIGRATED : (e as Error).message }, 200) }
    const results: CheckOutcome[] = []
    for (const item of (data ?? []) as Item[]) {
      if (!item.url || !/^https?:\/\//i.test(item.url)) { results.push({ id: item.id, status: 'error', low: null, currency: null, error: 'No link to check' }); continue }
      results.push(await checkRow(supabase, userId, item, watches.get(item.id) ?? null))
    }
    return json({ results })
  }

  if (body.action === 'sweep') {
    const rates = await fillRates(supabase, userId)
    let items: Item[]
    let watches: Map<string, Watch>
    try {
      items = await dueItems(supabase, userId)
      watches = await watchesFor(supabase, items.map(i => i.id))
    } catch (e) {
      return json({ rates, error: missingTable(e as { code?: string }) ? NOT_MIGRATED : (e as Error).message }, 500)
    }
    const due = Date.now() - DUE_HOURS * 3600_000
    const queue = items
      .filter(i => { const w = watches.get(i.id); return !w || w.url !== i.url || Date.parse(w.checked_at) < due })
      .sort((a, b) => (watches.get(a.id)?.checked_at ?? '').localeCompare(watches.get(b.id)?.checked_at ?? ''))
      .slice(0, SWEEP_LIMIT)
    const results: CheckOutcome[] = []
    for (const item of queue) {
      if (Date.now() - started > SWEEP_BUDGET_MS) break
      results.push(await checkRow(supabase, userId, item, watches.get(item.id) ?? null))
    }
    // History older than two years goes.
    const cutoff = new Date(Date.now() - POINTS_KEEP_DAYS * 86400_000).toISOString()
    await supabase.from('shop_price_points').delete().eq('user_id', userId).lt('checked_at', cutoff)
    return json({ rates, checked: results.length, left: queue.length - results.length, results })
  }

  return json({ error: 'Unknown action' }, 400)
})
