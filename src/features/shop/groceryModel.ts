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
 * The product a scanned barcode is: the search hit carrying that EAN, or
 * null — never a hit that only happens to mention the digits.
 */
export function scanMatch(hits: readonly GroceryHit[] | undefined, code: string): GroceryHit | null {
  const key = eanKey(code)
  if (!key || !hits) return null
  return hits.find(h => eanKey(h.ean) === key) ?? null
}

/** Picking a product for a row: its EAN, and its picture only when the row has none yet. */
export function matchPatch(row: { image_url?: string | null }, hit: Pick<GroceryHit, 'ean' | 'image'>): { ean: string; image_url?: string } {
  return { ean: hit.ean, ...(!row.image_url && hit.image ? { image_url: hit.image } : {}) }
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
