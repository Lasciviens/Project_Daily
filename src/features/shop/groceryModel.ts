// Grocery prices for the quick list (Kassalapp through the `food-search` edge
// function): a row matched to a product (its EAN) is priced at every chain
// Kassalapp follows — Coop, Kiwi, Meny, Spar, Joker, Oda, Bunnpris. REMA 1000
// publishes no prices online, so it never appears. Pure —
// scripts/verify-shop-owned.cjs runs it.

export interface GroceryStorePrice { code: string; name: string; price: number; checked: string | null }
export interface GroceryPrice { ean: string; name: string; stores: GroceryStorePrice[] }
export interface GroceryHit { ean: string; name: string; brand: string | null; image: string | null; price: number | null; store: string | null }

/** A chain's display name: Kassalapp's own, tidied ("SPAR" → "Spar", "KIWI" → "Kiwi"). */
export function chainName(s: Pick<GroceryStorePrice, 'code' | 'name'>): string {
  const raw = (s.name || s.code).trim()
  if (/^[A-ZÆØÅ0-9 ]+$/.test(raw) && raw.length > 3) return raw.charAt(0) + raw.slice(1).toLowerCase()
  return raw
}

/** The cheapest chain for one product (ties: A–Z), or null when no chain has a price. */
export function cheapestStore(p: GroceryPrice | undefined): GroceryStorePrice | null {
  if (!p) return null
  let best: GroceryStorePrice | null = null
  for (const s of p.stores) {
    if (!Number.isFinite(s.price)) continue
    if (!best || s.price < best.price || (s.price === best.price && chainName(s) < chainName(best))) best = s
  }
  return best
}

/** Each chain's lowest price for each product (a chain can list one product twice, e.g. two pack sizes with one EAN). */
function byChain(p: GroceryPrice): Map<string, GroceryStorePrice> {
  const out = new Map<string, GroceryStorePrice>()
  for (const s of p.stores) {
    const key = chainName(s).toLowerCase()
    const cur = out.get(key)
    if (!cur || s.price < cur.price) out.set(key, s)
  }
  return out
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
  /** Rows with a product (EAN) and at least one price. */
  priced: number
  /** Rows with no product picked yet. */
  unmatched: number
  /** The oldest price date among the prices used (yyyy-mm-dd), so the card can say how fresh they are. */
  oldest: string | null
}

/**
 * What the matched rows would cost at each chain. A chain is only comparable
 * on the rows it has, so `covered` leads the order (a full basket first),
 * then the total. A row picked twice (the same EAN) counts twice.
 */
export function basketByChain(rows: readonly { title: string; ean?: string | null }[], prices: ReadonlyMap<string, GroceryPrice>): Basket {
  const chains = new Map<string, BasketRow>()
  let priced = 0
  let unmatched = 0
  let oldest: string | null = null
  const pricedRows: { title: string; perChain: Map<string, GroceryStorePrice> }[] = []
  for (const r of rows) {
    if (!r.ean) { unmatched++; continue }
    const p = prices.get(r.ean)
    if (!p || !p.stores.length) continue
    priced++
    const perChain = byChain(p)
    pricedRows.push({ title: r.title, perChain })
    for (const s of perChain.values()) {
      const day = s.checked ? s.checked.slice(0, 10) : null
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
  return { rows: list, priced, unmatched, oldest }
}

/** Each chain's lowest price for one product, cheapest first (ties A–Z) — every chain at a glance. */
export function chainPrices(p: GroceryPrice | undefined): { chain: string; price: number; checked: string | null }[] {
  if (!p) return []
  return [...byChain(p).values()]
    .filter(s => Number.isFinite(s.price))
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
