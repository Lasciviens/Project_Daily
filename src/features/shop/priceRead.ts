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
// Verified live on 10.11.2026 (scripts/fixtures/prisjakt/): Prisjakt's
// AggregateOffer mixes new, refurbished and used offers (an iPhone 15 Pro read
// 6 590 while its only new offers were 16 115 and 16 252). Its page also
// streams its own offer list to React (`self.__next_f.push([1, "…"])`):
// `offerRows`, one row per offer with `productId`, `variantId`, `condition`
// ("New" | "Refurbished" | "Used"), `price {amount, currency}`, `shopId` and
// `stockStatus`. The price now is read from its new offers only — from the
// stream's JSON rows, never a raw text row (a long review), and only when one
// list alone holds the product's offers (guardian review, 10.11.2026).
// A Cloudflare challenge page ("Just a moment…") is reported as `blocked`,
// never as a missing price.
//
// The block between the <price-read> markers is a HAND MIRROR in
// supabase/functions/shop-price/index.ts (Deno cannot import from src/).

// <price-read>
/** 'not_allowed': the link's site doesn't let apps read it — its terms (shop_site_policies, migration 188) or its robots.txt — never fetched. */
export type PriceReadStatus = 'ok' | 'no_price' | 'blocked' | 'not_allowed'

/**
 * What `low`, `high` and `offers` cover: 'new' — Prisjakt's own offer list,
 * new offers only; 'mixed' — Prisjakt's schema.org figures, read when its page
 * has no offer list (they mix new, refurbished and used offers); 'unknown' —
 * a shop's own page, which doesn't say.
 */
export type PriceCondition = 'new' | 'mixed' | 'unknown'

export interface PriceRead {
  status: PriceReadStatus
  /** The product's name as the page gives it. */
  name: string | null
  image: string | null
  brand: string | null
  gtin: string | null
  /** The lowest price on the page (Prisjakt: the cheapest new offer). */
  low: number | null
  /** The highest offer (Prisjakt: the dearest new one) — equal to `low` for a single shop. */
  high: number | null
  /** How many shops sell it (Prisjakt: new), else null. */
  offers: number | null
  currency: string | null
  inStock: boolean | null
  /** The struck-through "before" price a shop shows beside a sale price (Elkjøp's StrikethroughPrice). */
  was: number | null
  /** The shop's own return window for everyone (not a members-only one), in days — "30-day open purchase". */
  returnDays: number | null
  /** What low, high and offers cover. */
  condition: PriceCondition
  /** The cheapest used offer in Prisjakt's offer list, else null (evidence for resale). */
  usedLow: number | null
  /** The cheapest refurbished offer in Prisjakt's offer list, else null. */
  refurbishedLow: number | null
  /** 'prisjakt' when the page is Prisjakt's, else 'store'. */
  source: 'prisjakt' | 'store'
}

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function types(node: Json): string[] {
  const t = node['@type']
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string').map(x => x.replace(/^https?:\/\/schema\.org\//, ''))
}

/** The longest text read as a price: "kr 1 234 567,00" and the like are far shorter (a page's longer text is no price). */
const PRICE_TEXT_MAX = 64

/**
 * Parses "9 990,00", "9990.00", "kr 1.299,-", 2490 → a number, else null. A text longer than PRICE_TEXT_MAX is
 * none, before any pattern runs on it (80 000 dashes took 4.9 s through the trailing-dash pattern).
 */
export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  if (typeof v !== 'string' || v.length > PRICE_TEXT_MAX) return null
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

/**
 * Every JSON-LD node on the page, flattening arrays and `@graph`. One pass over the page: each `<script` tag, its
 * `>` and its `</script>` are found in turn, and the scan stops at the first tag that never ends or never closes —
 * one pattern over the whole page took 6.4 s on 256 KiB of unclosed "<script " (it rescanned the rest for each).
 */
export function jsonLdNodes(html: string): Json[] {
  const out: Json[] = []
  const open = /<script/gi, close = /<\/script>/gi
  for (let at = 0; ;) {
    open.lastIndex = at
    const tag = open.exec(html)
    if (!tag) break
    const tagEnd = html.indexOf('>', tag.index)
    if (tagEnd < 0) break
    close.lastIndex = tagEnd + 1
    const end = close.exec(html)
    if (!end) break
    at = end.index + end[0].length
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(html.slice(tag.index, tagEnd))) continue
    const raw = html.slice(tagEnd + 1, end.index).trim().replace(/^<!--/, '').replace(/-->$/, '').replace(/^\/\/<!\[CDATA\[/, '').replace(/\/\/\]\]>$/, '').trim()
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

/** The variant a Prisjakt link names (`a-116257=Frost`), as `a-116257=frost`. */
function linkAttrs(pageUrl: string): string[] {
  try { return [...new URL(pageUrl).searchParams.entries()].filter(([k]) => /^a-\d+$/.test(k)).map(([k, v]) => `${k}=${v}`.toLowerCase()) } catch { return [] }
}

/** The Prisjakt variant the link points at (`a-116257=Frost`), matched on the variant's own url. */
function variantFor(variants: Json[], pageUrl: string): Json | null {
  const attrs = linkAttrs(pageUrl)
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

/**
 * The listed site a link is on — its host, or a subdomain of it ("m.finn.no"
 * is on finn.no) — out of `hosts` (shop_site_policies, migration 188), else
 * null. The most specific listed host wins.
 */
export function listedSite(url: string, hosts: readonly string[]): string | null {
  let host: string
  try { host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '') } catch { return null }
  let best: string | null = null
  for (const raw of hosts) {
    const h = String(raw).trim().toLowerCase().replace(/\.+$/, '')
    if (h && (host === h || host.endsWith(`.${h}`)) && (!best || h.length > best.length)) best = h
  }
  return best
}

/** One rule of a robots.txt group: allow or disallow the paths a pattern matches (`*` any characters, a final `$` the end). */
export interface RobotsRule { allow: boolean; pattern: string }

/** The product token our User-Agent names (`LascisBoard/1.0`): robots.txt's group for it applies, else its `*` group. */
export const ROBOTS_TOKEN = 'LascisBoard'

/** At most this many rules are read from one robots.txt (a hostile file can't make every check slow). */
const ROBOTS_RULE_CAP = 5000

/** A robots.txt path, or a URL's path + query, with its octets percent-encoded one way (RFC 9309 §2.2.2): non-ASCII, spaces and controls encoded, hex in capitals. */
function robotsPath(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) as number
    if (code > 0x20 && code < 0x7f) out += ch
    else { try { out += encodeURIComponent(ch) } catch { out += '%EF%BF%BD' } }
  }
  return out.replace(/%[0-9a-f]{2}/gi, m => m.toUpperCase())
}

/**
 * The rules a robots.txt gives `token` (RFC 9309): the groups that name it (any case, a version after "/"
 * left out), else those for `*`, their rules combined; [] when there are none — nothing is disallowed. An
 * empty `Disallow:` disallows nothing. Rules before any user-agent line, and records robots.txt doesn't
 * define (Sitemap, Crawl-delay …), are left out and end no group.
 */
export function robotsRules(text: string, token: string = ROBOTS_TOKEN): RobotsRule[] {
  type Group = { agents: string[]; rules: RobotsRule[]; ruled: boolean }
  const groups: Group[] = []
  let current: Group | null = null
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      if (!current || current.ruled) { current = { agents: [], rules: [], ruled: false }; groups.push(current) }
      current.agents.push(value.split('/')[0].trim().toLowerCase())
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.ruled = true
      if (value) current.rules.push({ allow: key === 'allow', pattern: robotsPath(value) })
    }
  }
  const named = groups.filter(g => g.agents.includes(token.toLowerCase()))
  const chosen = named.length ? named : groups.filter(g => g.agents.includes('*'))
  return chosen.flatMap(g => g.rules).slice(0, ROBOTS_RULE_CAP)
}

/**
 * Does robots `pattern` match `path` from its start (`*` any characters; a final `$` the end)? Leftmost-greedy over
 * the pieces between the `*`s: the first piece must start the path, each next one is found once, after where the
 * last one ended (for `*` alone the leftmost find is always a match if any is), and the last one must end the path
 * when the pattern ends in `$`. One search per piece — a two-pointer match that retried took a minute on 5 000
 * hostile rules and a 16 000-character path.
 */
function robotsMatch(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const pieces = (anchored ? pattern.slice(0, -1) : pattern).split('*')
  if (!path.startsWith(pieces[0])) return false
  let pos = pieces[0].length
  if (pieces.length === 1) return !anchored || pos === path.length
  for (let k = 1; k < pieces.length - 1; k++) {
    const at = path.indexOf(pieces[k], pos)
    if (at < 0) return false
    pos = at + pieces[k].length
  }
  const last = pieces[pieces.length - 1]
  return anchored ? path.length - last.length >= pos && path.endsWith(last) : path.indexOf(last, pos) >= 0
}

/** The longest path + query matched against robots rules and read (as a link is kept, 2 048 characters): a longer one is not read now. */
export const MAX_PATH_CHARS = 2048

/**
 * Whether robots rules let us read `pathAndQuery` (RFC 9309 §2.2.2): the longest matching pattern decides,
 * Allow wins a tie, no match is allowed, and /robots.txt itself always is.
 */
export function robotsAllows(rules: readonly RobotsRule[], pathAndQuery: string): boolean {
  const path = robotsPath(pathAndQuery || '/')
  if (path === '/robots.txt') return true
  let best: RobotsRule | null = null
  for (const r of rules) {
    if (!robotsMatch(r.pattern, path)) continue
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r
  }
  return !best || best.allow
}

/**
 * The rows a Next.js page streams to React: every `self.__next_f.push([1, "…"])` chunk, decoded and joined in
 * order, then read row by row (`<hex id>:<data>` up to its newline). A row React sends by length —
 * `<id>:T<hex bytes>,<text>`, a string of 1 024 characters or more such as a user's review, sent raw, so its quotes
 * are real quotes and it could pass for the page's own data — is left out, and so are the binary rows sent the same
 * way; where the stream stops being rows, the rest is left out too.
 */
function nextFlight(html: string): string {
  const chunks: string[] = []
  const marker = 'self.__next_f.push([1,"'
  let at = html.indexOf(marker)
  while (at >= 0) {
    const start = at + marker.length - 1
    let end = start + 1
    while (end < html.length && html[end] !== '"') end += html[end] === '\\' ? 2 : 1
    if (end >= html.length) break
    try { const s: unknown = JSON.parse(html.slice(start, end + 1)); if (typeof s === 'string') chunks.push(s) } catch { /* not a JSON string: skipped */ }
    at = html.indexOf(marker, end)
  }
  return flightRows(chunks.join(''))
}

/** The row tags React's Flight stream sends by length (its client's list): `T` a long text, the others binary arrays. */
const FLIGHT_BY_LENGTH = 'TAOobUSsLlGgMmV'

const isHexCode = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)

/** The rows of a Flight stream that carry JSON, joined; a row sent by length is stepped over by its byte count. */
function flightRows(stream: string): string {
  const out: string[] = []
  let i = 0
  while (i < stream.length) {
    let j = i
    while (j < stream.length && isHexCode(stream.charCodeAt(j))) j++
    if (stream[j] !== ':') break
    if (j + 1 < stream.length && FLIGHT_BY_LENGTH.includes(stream[j + 1])) {
      let k = j + 2, bytes = 0
      while (k < stream.length && isHexCode(stream.charCodeAt(k)) && k - j < 11) { bytes = bytes * 16 + parseInt(stream[k], 16); k++ }
      if (stream[k] !== ',') break
      i = afterUtf8Bytes(stream, k + 1, bytes)
      continue
    }
    const nl = stream.indexOf('\n', j)
    const end = nl < 0 ? stream.length : nl + 1
    out.push(stream.slice(i, end))
    i = end
  }
  return out.join('')
}

/** Where `bytes` UTF-8 bytes from `at` end in a decoded string (React counts a row sent by length in bytes). */
function afterUtf8Bytes(s: string, at: number, bytes: number): number {
  let i = at
  for (let n = 0; n < bytes && i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++ }
    else n += 3
  }
  return i
}

/**
 * The JSON array or object that starts at text[start]: its value (undefined when there is none there, or it isn't
 * JSON) and the index after it — -1 when it never closes.
 */
function jsonAt(text: string, start: number): { value: unknown; end: number } {
  if (text[start] !== '[' && text[start] !== '{') return { value: undefined, end: start }
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
    } else if (ch === '[' || ch === '{') {
      depth++
    } else if ((ch === ']' || ch === '}') && --depth === 0) {
      let value: unknown
      try { value = JSON.parse(text.slice(start, i + 1)) } catch { value = undefined }
      return { value, end: i + 1 }
    }
  }
  return { value: undefined, end: -1 }
}

interface OfferRow { condition: string; price: number; currency: string | null; shop: string | null; variant: string | null }

/**
 * Prisjakt's own offer list for product `productId`: the `offerRows` its product page streams (one row per offer).
 * Every `"offerRows":` in the stream's rows is read, and a list counts only when it is the one list that holds this
 * product's offers — with none, or two (which is the page's own can't be told), only the page's schema.org figures
 * are known (null). A row of another product, or one without a condition or a price, is left out.
 */
function prisjaktOfferRows(html: string, productId: string): OfferRow[] | null {
  const flight = nextFlight(html)
  const key = '"offerRows":'
  let found: OfferRow[] | null = null
  for (let at = flight.indexOf(key); at >= 0;) {
    const list = jsonAt(flight, at + key.length)
    const mine = Array.isArray(list.value) ? productRows(list.value, productId) : []
    if (mine.length) {
      if (found) return null
      found = mine
    }
    // A list that never closes holds the rest of the stream; otherwise the next one is looked for after it.
    if (list.end < 0) break
    at = flight.indexOf(key, Math.max(list.end, at + key.length))
  }
  return found
}

/** The offer rows of product `productId` in one list, as read. */
function productRows(rows: unknown[], productId: string): OfferRow[] {
  const out: OfferRow[] = []
  for (const r of rows) {
    if (!isObj(r) || String(r.productId) !== productId || typeof r.condition !== 'string' || !isObj(r.price)) continue
    const price = parsePrice(r.price.amount)
    if (price == null) continue
    out.push({
      condition: r.condition.toLowerCase(), price, currency: firstString(r.price.currency)?.toUpperCase() ?? null,
      shop: r.shopId == null ? null : String(r.shopId),
      variant: /^\d+$/.test(String(r.variantId ?? '')) ? String(r.variantId) : null,
    })
  }
  return out
}

/**
 * The rows a link's price comes from: all of them, or — for a link that names
 * a variant (a colour) — that variant's, known only when the page lists one
 * variant (a row doesn't say its colour); null when that can't be told.
 */
function offersFor(rows: OfferRow[], pageUrl: string): OfferRow[] | null {
  if (!rows.length || !linkAttrs(pageUrl).length) return rows
  const variants = new Set(rows.map(r => r.variant).filter(v => v != null))
  return variants.size === 1 ? rows.filter(r => r.variant != null) : null
}

/** The new offers' low, high and shops, and the cheapest used and refurbished offer. */
function byCondition(rows: OfferRow[]): { low: number | null; high: number | null; offers: number | null; currency: string | null; usedLow: number | null; refurbishedLow: number | null } {
  const cheapest = (c: string): OfferRow | null => rows.filter(r => r.condition === c).reduce<OfferRow | null>((m, r) => (!m || r.price < m.price ? r : m), null)
  const fresh = rows.filter(r => r.condition === 'new')
  const best = cheapest('new')
  return {
    low: best?.price ?? null,
    high: fresh.length ? fresh.reduce((m, r) => Math.max(m, r.price), 0) : null,
    offers: fresh.length ? new Set(fresh.map((r, i) => r.shop ?? `row ${i}`)).size : null,
    currency: best?.currency ?? rows[0]?.currency ?? null,
    usedLow: cheapest('used')?.price ?? null,
    refurbishedLow: cheapest('refurbished')?.price ?? null,
  }
}

/** The price a product page shows, or why there is none. */
export function readPrice(html: string, pageUrl: string): PriceRead {
  const source: PriceRead['source'] = /prisjakt\.no/i.test(pageUrl) ? 'prisjakt' : 'store'
  const empty: PriceRead = {
    status: 'no_price', name: null, image: null, brand: null, gtin: null, low: null, high: null, offers: null, currency: null, inStock: null,
    was: null, returnDays: null, condition: source === 'prisjakt' ? 'mixed' : 'unknown', usedLow: null, refurbishedLow: null, source,
  }
  if (isChallengePage(html)) return { ...empty, status: 'blocked' }
  const fromSchema = schemaPrice(html, pageUrl, empty)
  const product = isPrisjaktUrl(pageUrl) ? new URL(pageUrl).searchParams.get('p') : null
  const rows = product ? prisjaktOfferRows(html, product) : null
  const scope = rows ? offersFor(rows, pageUrl) : null
  if (!scope) return fromSchema
  const c = byCondition(scope)
  return {
    ...fromSchema, status: c.low != null ? 'ok' : 'no_price', low: c.low, high: c.high, offers: c.offers,
    currency: c.currency ?? fromSchema.currency, inStock: null, was: null, returnDays: null,
    condition: 'new', usedLow: c.usedLow, refurbishedLow: c.refurbishedLow,
  }
}

/** What the page's schema.org data says: a product's (or the linked variant's) offers. */
function schemaPrice(html: string, pageUrl: string, empty: PriceRead): PriceRead {
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
