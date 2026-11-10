// Grocery prices for the quick list (Kassalapp through the `food-search` edge
// function): a row matched to a product (its EAN) is priced at every chain
// with a current price for it. Kassalapp reads prices daily only from Meny,
// Spar, Joker, Oda, Bunnpris, Europris, Engrosnett, Havaristen, Holdbart,
// Fudi, Leske and FastCandy; REMA 1000, Kiwi and Coop come back with the last
// price it recorded, often from 2024 (its FAQ, 10.11.2026), and those are left
// out after 14 days: every price comes in through `byChain`, which keeps only
// what `isCurrent` takes. Pure — scripts/verify-shop-owned.cjs runs it.
import { addDaysToIso, wallClockIn } from '../calendar/calendarEventRules'

export interface GroceryStorePrice { code: string; name: string; price: number; checked: string | null }
export interface GroceryPrice { ean: string; name: string; stores: GroceryStorePrice[] }
export interface GroceryHit { ean: string; name: string; brand: string | null; image: string | null; price: number | null; store: string | null }

/** kassal.app counts a price as out of date after 14 days without a check (its FAQ, 10.11.2026). */
export const CURRENT_DAYS = 14

/** Kassalapp's prices are Norway's, so their days are Oslo's, whatever zone the phone is in. */
const PRICE_ZONE = 'Europe/Oslo'

// Each check time is read once: a zone-aware read is slow, and a row's chip and
// the basket read the same prices on every render.
const checkDays = new Map<string, string | null>()

/** The Oslo day (yyyy-mm-dd) of a check time, or null for a missing or unreadable one. */
export function osloDay(at: string | null | undefined): string | null {
  if (typeof at !== 'string' || !at) return null
  let day = checkDays.get(at)
  if (day === undefined) {
    if (checkDays.size >= 1000) checkDays.clear()
    day = wallClockIn(at, PRICE_ZONE)?.date ?? null
    checkDays.set(at, day)
  }
  return day
}

/** Today on Oslo's calendar: the day `isCurrent` counts back from. */
export function priceToday(now: Date = new Date()): string {
  return wallClockIn(now.toISOString(), PRICE_ZONE)?.date ?? ''
}

/**
 * Whether a chain's price counts: Kassalapp checked it today or on one of the
 * 14 Oslo days before (14 days old still counts, 15 does not). A price with no
 * check date, an unreadable one or one after today can't be trusted, so it
 * doesn't count either.
 */
export function isCurrent(s: Pick<GroceryStorePrice, 'checked'>, today: string): boolean {
  const day = osloDay(s.checked)
  return day != null && day <= today && day >= addDaysToIso(today, -CURRENT_DAYS)
}

/** A chain's display name: Kassalapp's own, tidied ("SPAR" → "Spar", "KIWI" → "Kiwi"). */
export function chainName(s: Pick<GroceryStorePrice, 'code' | 'name'>): string {
  const raw = (s.name || s.code).trim()
  if (/^[A-ZÆØÅ0-9 ]+$/.test(raw) && raw.length > 3) return raw.charAt(0) + raw.slice(1).toLowerCase()
  return raw
}

/**
 * Each chain's lowest current price for one product (a chain can list one
 * product twice, e.g. two pack sizes with one EAN). The one door prices come
 * in by: an old price never reaches a chip, a hover or a basket.
 */
function byChain(p: GroceryPrice, today: string): Map<string, GroceryStorePrice> {
  const out = new Map<string, GroceryStorePrice>()
  for (const s of p.stores) {
    if (!Number.isFinite(s.price) || !isCurrent(s, today)) continue
    const key = chainName(s).toLowerCase()
    const cur = out.get(key)
    if (!cur || s.price < cur.price) out.set(key, s)
  }
  return out
}

/** The cheapest chain for one product (ties: A–Z), or null when no chain has a current price. */
export function cheapestStore(p: GroceryPrice | undefined, today: string): GroceryStorePrice | null {
  if (!p) return null
  let best: GroceryStorePrice | null = null
  for (const s of byChain(p, today).values()) {
    if (!best || s.price < best.price || (s.price === best.price && chainName(s) < chainName(best))) best = s
  }
  return best
}

export interface BasketRow {
  chain: string
  /** The sum of this chain's prices for the products it has. */
  total: number
  /** How many of the priced rows this chain sells. */
  covered: number
  /** Titles of the priced rows it doesn't have. */
  missing: string[]
}

export interface Basket {
  rows: BasketRow[]
  /** Rows with a product (EAN) and at least one current price. */
  priced: number
  /** Rows with no product picked yet. */
  unmatched: number
  /** The oldest price date among the prices used (yyyy-mm-dd, Oslo), so the card can say how fresh they are. */
  oldest: string | null
  /** Old prices left out: one per product and chain that had only old ones, and those chains A–Z. */
  leftOut: { prices: number; chains: string[] }
}

/**
 * What the matched rows would cost at each chain. A chain is only comparable
 * on the rows it has, so `covered` leads the order (a full basket first),
 * then the total. A row picked twice (the same EAN) counts twice; its old
 * prices are left out once.
 */
export function basketByChain(rows: readonly { title: string; ean?: string | null }[], prices: ReadonlyMap<string, GroceryPrice>, today: string): Basket {
  const chains = new Map<string, BasketRow>()
  let priced = 0
  let unmatched = 0
  let oldest: string | null = null
  const oldKeys = new Set<string>()
  const oldChains = new Map<string, string>()
  const pricedRows: { title: string; perChain: Map<string, GroceryStorePrice> }[] = []
  for (const r of rows) {
    if (!r.ean) { unmatched++; continue }
    const p = prices.get(r.ean)
    if (!p || !p.stores.length) continue
    const perChain = byChain(p, today)
    // A chain with a current price for this product isn't left out, even when it also lists an old one.
    for (const s of p.stores) {
      const key = chainName(s).toLowerCase()
      if (perChain.has(key) || !Number.isFinite(s.price)) continue
      oldKeys.add(`${r.ean}|${key}`)
      oldChains.set(key, chainName(s))
    }
    if (!perChain.size) continue
    priced++
    pricedRows.push({ title: r.title, perChain })
    for (const s of perChain.values()) {
      const day = osloDay(s.checked)
      if (day && (!oldest || day < oldest)) oldest = day
      const name = chainName(s)
      if (!chains.has(name.toLowerCase())) chains.set(name.toLowerCase(), { chain: name, total: 0, covered: 0, missing: [] })
    }
  }
  for (const row of pricedRows) {
    for (const [key, b] of chains) {
      const s = row.perChain.get(key)
      if (s) { b.total += s.price; b.covered++ } else b.missing.push(row.title)
    }
  }
  const list = [...chains.values()].map(b => ({ ...b, total: Math.round(b.total * 100) / 100 }))
  list.sort((a, b) => b.covered - a.covered || a.total - b.total || a.chain.localeCompare(b.chain))
  const leftOut = { prices: oldKeys.size, chains: [...oldChains.values()].sort((a, b) => a.localeCompare(b)) }
  return { rows: list, priced, unmatched, oldest, leftOut }
}

/** The basket card's line on what it left out and why — "2 old prices left out — not checked in 14 days" (the chains: `leftOut.chains`, on a tap) — or null for nothing. */
export function leftOutNote(b: Pick<Basket, 'leftOut'>): string | null {
  const n = b.leftOut.prices
  return n ? `${n} old ${n === 1 ? 'price' : 'prices'} left out — not checked in ${CURRENT_DAYS} days` : null
}

/** Each chain's lowest current price for one product, cheapest first (ties A–Z) — every chain at a glance. */
export function chainPrices(p: GroceryPrice | undefined, today: string): { chain: string; price: number; checked: string | null }[] {
  if (!p) return []
  return [...byChain(p, today).values()]
    .map(s => ({ chain: chainName(s), price: s.price, checked: s.checked }))
    .sort((a, b) => a.price - b.price || a.chain.localeCompare(b.chain))
}

/** Digits only, leading zeros off: a 12-digit UPC-A scan meets its 13-digit EAN. */
const eanKey = (code: string) => code.replace(/\D/g, '').replace(/^0+/, '')

/**
 * The barcode a scan or a typed code may look up: digits only, 8 to 14 of
 * them (EAN-8, UPC-A, EAN-13, GTIN-14) — the same rule `food-search` checks
 * before the code goes into Kassalapp's address — else null.
 */
export function scanEan(code: string): string | null {
  const v = code.trim()
  return /^\d{8,14}$/.test(v) ? v : null
}

/**
 * The product a scanned barcode is: the hit carrying that EAN, or null —
 * never a hit that only happens to mention the digits.
 */
export function scanMatch(hits: readonly GroceryHit[] | undefined, code: string): GroceryHit | null {
  const key = eanKey(code)
  if (!key || !hits) return null
  return hits.find(h => eanKey(h.ean) === key) ?? null
}

/** The longest picture link kept (as the database's shop_web_link and priceRead's keptText keep one). */
const PICTURE_MAX = 2048

/**
 * A picture's link as a row may keep it: one http(s) web address of up to
 * 2 048 characters, "//cdn…" made https — never a path, a data:, blob: or
 * javascript: link, nor one with a space or a control character. The rule of
 * priceRead's `webImage` and the database's `shop_web_link`, for pictures
 * that come from Kassalapp.
 */
export function webPicture(s: unknown): string | null {
  const v = typeof s === 'string' ? s.trim() : ''
  if (!v || v.length > PICTURE_MAX || /\s/.test(v) || [...v].some(ch => ch < ' ' || ch === '\u007f')) return null
  if (/^https?:\/\/[^/?#]+/i.test(v)) return v
  return /^\/\/[^/?#]+/.test(v) ? `https:${v}` : null
}

/** Text from an answer: a string, trimmed and at most `max` characters, else null. */
function textOf(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut
}

/**
 * One product as `food-search` answers it (`grocery_search`, `grocery_ean`),
 * checked where it enters the app: an EAN of 8–14 digits and a name, or no
 * hit at all; a brand and a store as short text; a picture only as a web
 * link (`webPicture`); a price only as a finite amount of zero or more.
 */
export function groceryHitOf(raw: unknown): GroceryHit | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const ean = typeof r.ean === 'string' && /^\d{8,14}$/.test(r.ean) ? r.ean : null
  const name = textOf(r.name)
  if (!ean || !name) return null
  const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 0 ? r.price : null
  return { ean, name, brand: textOf(r.brand), image: webPicture(r.image), price, store: textOf(r.store, 100) }
}

/** The same picture link, compared exactly (a trailing space aside). */
const samePicture = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim() === b.trim()

/**
 * Picking a product for a row: its EAN, and its picture (a web link only)
 * when the row has none yet. `was` is the row's product until now, when the
 * search found it: a picture that is exactly that product's came with the
 * old match, not from the owner, so the new product's takes its place (or
 * none, when it has none). Any other picture is the row's own and stays.
 */
export function matchPatch(row: { image_url?: string | null }, hit: Pick<GroceryHit, 'ean' | 'image'>, was?: Pick<GroceryHit, 'image'> | null): { ean: string; image_url?: string | null } {
  const picture = webPicture(hit.image)
  if (row.image_url && samePicture(row.image_url, was?.image)) return { ean: hit.ean, image_url: picture }
  return { ean: hit.ean, ...(!row.image_url && picture ? { image_url: picture } : {}) }
}

/** "Remove match": the EAN goes, and the picture too when it is exactly the old product's (`was`). */
export function unmatchPatch(row: { image_url?: string | null }, was?: Pick<GroceryHit, 'image'> | null): { ean: null; image_url?: null } {
  return { ean: null, ...(row.image_url && samePicture(row.image_url, was?.image) ? { image_url: null } : {}) }
}

/** What the basket's first line answers: where the whole list (or the priced part of it) is cheapest. */
export interface WholeList {
  /** cheapest: two chains or more have every priced row · only: one has · none: no chain has them all. */
  kind: 'cheapest' | 'only' | 'none'
  /** The chain (or the tied chains, A–Z) the answer names: the cheapest full basket, or the one with the most rows. */
  chains: string[]
  /** That basket's total — for `none`, only of the rows that chain has. */
  total: number
  covered: number
  priced: number
  /** Every open row is priced, so the answer is about the whole list. */
  whole: boolean
}

/**
 * Where the list is cheapest in one go, from the per-chain basket (current
 * prices only — every price came in through `byChain`): the cheapest chain
 * that has every priced row, each tied one with it; else the chain that has
 * the most. `rows` is how many open rows the list has — fewer priced means
 * the answer is about the priced ones only. Null with nothing priced.
 */
export function wholeList(b: Basket, rows: number): WholeList | null {
  if (!b.priced || !b.rows.length) return null
  const whole = b.priced === rows
  const full = b.rows.filter(r => r.covered === b.priced)
  if (!full.length) {
    const most = b.rows[0]
    return { kind: 'none', chains: [most.chain], total: most.total, covered: most.covered, priced: b.priced, whole }
  }
  const best = full[0]
  const tied = full.filter(r => r.total === best.total).map(r => r.chain).sort((x, y) => x.localeCompare(y))
  return { kind: full.length === 1 ? 'only' : 'cheapest', chains: tied, total: best.total, covered: best.covered, priced: b.priced, whole }
}

/** "Oda", "Joker or Spar", "Joker, Meny or Spar". */
function chainList(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/**
 * The basket's first line in three parts — what it answers, the chain, and
 * the amount (or the share it has) — so a narrow card cuts the chain, never
 * the amount, and the lead stays short enough for a phone: "Cheapest for the
 * whole list:" · "Oda" · "137.70 NOK". With rows not priced yet it names the
 * priced ones ("Cheapest for 3 priced items:"); "Only one chain has all 3:";
 * "No chain has all 3 — most at" · "Meny" · "2 of 3".
 */
export function wholeListWords(w: WholeList, money: (n: number) => string): { lead: string; chain: string; value: string } {
  const chain = chainList(w.chains)
  const all = w.priced === 1 ? 'it' : w.priced === 2 ? 'both' : `all ${w.priced}`
  if (w.kind === 'none') return { lead: `No chain has ${all} — most at`, chain, value: `${w.covered} of ${w.priced}` }
  if (w.kind === 'only') return { lead: `Only one chain has ${all}:`, chain, value: money(w.total) }
  const scope = w.whole ? 'the whole list' : w.priced === 1 ? 'the priced item' : `${w.priced} priced items`
  return { lead: `Cheapest for ${scope}:`, chain, value: money(w.total) }
}

export interface BasketLine extends BasketRow {
  /** Sells every priced row — only these totals compare with each other. */
  full: boolean
  /** The cheapest full basket, once at least two chains have everything. */
  cheapest: boolean
  /** How much more than the cheapest full basket (other full baskets only; 0 = the same). */
  more: number | null
}

/** The basket's rows with what the card says about each: full or not, the cheapest, how much more. */
export function basketLines(b: Basket): BasketLine[] {
  const full = (r: BasketRow) => b.priced > 0 && r.covered === b.priced
  const fullRows = b.rows.filter(full)
  // basketByChain sorts full baskets first, then by total: the first full one is the cheapest.
  const best = fullRows.length >= 2 ? fullRows[0] : null
  return b.rows.map(r => ({
    ...r,
    full: full(r),
    cheapest: r === best,
    more: best && r !== best && full(r) ? Math.round((r.total - best.total) * 100) / 100 : null,
  }))
}
