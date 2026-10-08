// Shop's rules (migration 134): which view a row is on, its currency, the
// wishlist's filters / sort / category groups / totals, the quick list's
// stores, picked-up and buy-again rows, and the bought history. Pure —
// scripts/verify-shop-model.cjs runs it against fixtures.
import type { CreateShopItemInput, ShopCategory, ShopCurrency, ShopItem, ShopList, ShopPriceWatch, ShopPriority, ShopRegion } from './types'
import { convertAmount, formatMoney, type UsdRates } from '../settings/subscriptionRules'

export const SHOP_CURRENCIES: readonly ShopCurrency[] = ['NOK', 'TRY', 'EUR', 'USD']

/** A row without `list` (before migration 134) is a wishlist row. */
export function listOf(item: Pick<ShopItem, 'list'>): ShopList {
  return item.list === 'quick' ? 'quick' : 'wishlist'
}

/** Buying in Turkey means lira; anything else defaults to the home currency. */
export function defaultCurrencyFor(region: ShopRegion | null | undefined): ShopCurrency {
  return region === 'TR' ? 'TRY' : 'NOK'
}

/** The price's currency: its own, else what the region implied before migration 134. */
export function currencyOf(item: Pick<ShopItem, 'currency' | 'region'>): ShopCurrency {
  return item.currency ?? defaultCurrencyFor(item.region)
}

/** The "≈" beside a price: NOK ↔ TRY, and NOK for EUR/USD (the totals' currency). */
export function otherCurrency(c: ShopCurrency): ShopCurrency {
  return c === 'NOK' ? 'TRY' : 'NOK'
}

/** Local yyyy-MM-dd of a timestamp (a purchase at 00:30 Oslo is that day, not yesterday). */
export function localDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** When a bought row was bought (local day); before migration 134 its last edit is the only date. */
export function boughtDay(item: Pick<ShopItem, 'status' | 'bought_at' | 'updated_at'>): string | null {
  if (item.status !== 'bought') return null
  const at = item.bought_at ?? item.updated_at
  return at ? localDay(at) : null
}

// ── Text search ──────────────────────────────────────────────────────────────

const EXTRA_FOLD: Record<string, string> = { ø: 'o', æ: 'ae', ı: 'i', ß: 'ss', đ: 'd', ł: 'l' }

/** Lower-case, accents off, ø/æ/ı spelled out — "Kjøttdeig" matches "kjottdeig". */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[øæıßđł]/g, c => EXTRA_FOLD[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/** Every word of the query appears in the title, notes, store or category. */
export function matchesSearch(item: ShopItem, query: string, categoryText = ''): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold([item.title, item.notes ?? '', item.platform ?? '', categoryText].join(' '))
  return words.every(w => hay.includes(w))
}

// ── Categories ───────────────────────────────────────────────────────────────

export interface CategoryPath { topId: string | null; topName: string; subName: string | null }

/** Where a row sits in the two-level tree. A row on a top category itself has no sub. */
export function categoryPath(categoryId: string | null | undefined, categories: readonly ShopCategory[]): CategoryPath {
  const cat = categoryId ? categories.find(c => c.id === categoryId) : undefined
  if (!cat) return { topId: null, topName: 'No category', subName: null }
  if (!cat.parent_id) return { topId: cat.id, topName: cat.name, subName: null }
  const top = categories.find(c => c.id === cat.parent_id)
  return top ? { topId: top.id, topName: top.name, subName: cat.name } : { topId: cat.id, topName: cat.name, subName: null }
}

// ── Wishlist: filters, sort, groups ──────────────────────────────────────────

export type RegionFilter = 'all' | ShopRegion | 'none'
export type PriorityFilter = 'all' | ShopPriority
/** A top category id, 'all', or 'none' (rows without a category). */
export type CategoryFilter = string

export interface WishlistFilters {
  q: string
  category: CategoryFilter
  region: RegionFilter
  priority: PriorityFilter
}

export const NO_FILTERS: WishlistFilters = { q: '', category: 'all', region: 'all', priority: 'all' }

export function filtersActive(f: WishlistFilters): boolean {
  return f.q.trim() !== '' || f.category !== 'all' || f.region !== 'all' || f.priority !== 'all'
}

/**
 * Wishlist rows still to buy, narrowed by the filters. A general wish's
 * models are never wishes of their own (they show under it, and count once
 * through it — migration 137).
 */
export function filterWishlist(items: readonly ShopItem[], categories: readonly ShopCategory[], f: WishlistFilters): ShopItem[] {
  return items.filter(item => {
    if (listOf(item) !== 'wishlist' || item.status !== 'wishlist' || item.option_for) return false
    const path = categoryPath(item.category_id, categories)
    if (f.category === 'none' ? path.topId !== null : f.category !== 'all' && path.topId !== f.category) return false
    if (f.region === 'none' ? item.region != null : f.region !== 'all' && item.region !== f.region) return false
    if (f.priority !== 'all' && item.priority !== f.priority) return false
    return matchesSearch(item, f.q, [path.topName, path.subName ?? ''].join(' '))
  })
}

export type ShopSort = 'priority' | 'price-desc' | 'price-asc' | 'planned' | 'newest' | 'title'

export const SORT_LABEL: Record<ShopSort, string> = {
  priority: 'Priority',
  'price-desc': 'Price: high to low',
  'price-asc': 'Price: low to high',
  planned: 'Buy-on date',
  newest: 'Newest',
  title: 'A–Z',
}

export const PRIORITY_RANK: Record<ShopPriority, number> = { high: 0, medium: 1, low: 2 }

/** The price in NOK when rates allow, else the bare number (so one currency still sorts right). A general wish sorts by the top of its range. */
function comparablePrice(item: ShopItem, rates: UsdRates | null): number | null {
  const price = item.kind === 'general' ? (item.price_max ?? item.price_min ?? null) : item.price
  if (price == null) return null
  const c = currencyOf(item)
  if (!rates || c === 'NOK') return price
  return convertAmount(price, c, 'NOK', rates) ?? price
}

const byNewest = (a: ShopItem, b: ShopItem) => (b.created_at ?? '').localeCompare(a.created_at ?? '')
const byPlanned = (a: ShopItem, b: ShopItem) =>
  a.planned_date && b.planned_date ? a.planned_date.localeCompare(b.planned_date) : a.planned_date ? -1 : b.planned_date ? 1 : 0

export function sortItems(items: readonly ShopItem[], sort: ShopSort, rates: UsdRates | null = null): ShopItem[] {
  const out = [...items]
  switch (sort) {
    case 'priority':
      return out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byPlanned(a, b) || byNewest(a, b))
    case 'planned':
      return out.sort((a, b) => byPlanned(a, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byNewest(a, b))
    case 'newest':
      return out.sort(byNewest)
    case 'title':
      return out.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || byNewest(a, b))
    case 'price-desc':
    case 'price-asc': {
      const dir = sort === 'price-desc' ? -1 : 1
      return out.sort((a, b) => {
        const pa = comparablePrice(a, rates), pb = comparablePrice(b, rates)
        // Rows without a price go last in both directions.
        if (pa == null || pb == null) return pa == null && pb == null ? byNewest(a, b) : pa == null ? 1 : -1
        return (pa - pb) * dir || byNewest(a, b)
      })
    }
  }
}

export interface Money { currency: ShopCurrency; amount: number }

export interface Totals {
  /** Rows counted. */
  count: number
  /** Rows without a price — never silently counted as 0. */
  unpriced: number
  /** The priced rows in `currency` (a general wish: the bottom of its range). */
  amount: number
  /** With general wishes at the top of their ranges; equal to `amount` without any. */
  max: number
  currency: ShopCurrency
  /** Per-currency sums that had no exchange rate (shown beside, never dropped). */
  unconverted: Money[]
}

/** The last price read from a row's link — only while the watch is for the row's current link. */
export function watchedPrice(item: Pick<ShopItem, 'url'>, watch: ShopPriceWatch | null | undefined): Money | null {
  if (!watch || watch.low == null || !item.url || watch.url !== item.url) return null
  const c = (watch.currency ?? '').toUpperCase()
  return SHOP_CURRENCIES.includes(c as ShopCurrency) ? { amount: watch.low, currency: c as ShopCurrency } : null
}

/** What a row costs now: the last price read from its link, else its own price. */
export function priceNow(item: ShopItem, watch?: ShopPriceWatch | null): Money | null {
  return watchedPrice(item, watch) ?? (item.price == null ? null : { amount: item.price, currency: currencyOf(item) })
}

/**
 * A general wish's price range in its own currency: its own, else its open
 * models' cheapest to dearest now (a model in another currency converts at
 * today's rate, or is left out without rates), else none.
 */
export function wishRange(wish: ShopItem, models: readonly ShopItem[] = [], rates: UsdRates | null = null, watches?: ReadonlyMap<string, ShopPriceWatch>): { min: number; max: number } | null {
  if (wish.price_min != null || wish.price_max != null) {
    const min = wish.price_min ?? wish.price_max as number
    const max = wish.price_max ?? wish.price_min as number
    return { min: Math.min(min, max), max: Math.max(min, max) }
  }
  const target = currencyOf(wish)
  const prices = models
    .filter(m => m.status === 'wishlist')
    .map(m => priceNow(m, watches?.get(m.id)))
    .map(p => (!p ? null : p.currency === target ? p.amount : rates ? convertAmount(p.amount, p.currency, target, rates) : null))
    .filter((p): p is number => p != null)
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null
}

/** A general wish's open models (Not chosen ones kept apart), by id of the wish. */
export function modelsByWish(items: readonly ShopItem[]): Map<string, ShopItem[]> {
  const out = new Map<string, ShopItem[]>()
  for (const i of items) {
    if (!i.option_for) continue
    out.set(i.option_for, [...(out.get(i.option_for) ?? []), i])
  }
  return out
}

/**
 * The rows' prices summed in `target`; without rates only `target`-priced
 * rows convert. A general wish counts once, as its range (its models never
 * count on their own — `filterWishlist` leaves them out).
 */
export function totalsIn(items: readonly ShopItem[], target: ShopCurrency, rates: UsdRates | null, models?: ReadonlyMap<string, ShopItem[]>, watches?: ReadonlyMap<string, ShopPriceWatch>): Totals {
  let amount = 0
  let max = 0
  let unpriced = 0
  const rest = new Map<ShopCurrency, number>()
  for (const item of items) {
    const range = item.kind === 'general' ? wishRange(item, models?.get(item.id) ?? [], rates, watches) : item.price == null ? null : { min: item.price, max: item.price }
    if (!range) { unpriced++; continue }
    const c = currencyOf(item)
    const lo = c === target ? range.min : rates ? convertAmount(range.min, c, target, rates) : null
    const hi = c === target ? range.max : rates ? convertAmount(range.max, c, target, rates) : null
    if (lo == null || hi == null) rest.set(c, (rest.get(c) ?? 0) + range.max)
    else { amount += lo; max += hi }
  }
  // Whole units: a converted sum's öre/kuruş are noise, not information.
  return {
    count: items.length,
    unpriced,
    amount: Math.round(amount),
    max: Math.round(max),
    currency: target,
    unconverted: [...rest].map(([currency, a]) => ({ currency, amount: Math.round(a) })),
  }
}

/** "12 340 NOK" or "12 340–15 340 NOK" (+ "+ 300 EUR" for sums without a rate; no "0 NOK +" in front of those). */
export function totalsLabel(t: Totals): string {
  const parts = t.unconverted.map(u => formatMoney(u.amount, u.currency))
  const main = t.max > t.amount
    ? `${formatMoney(t.amount, t.currency).replace(` ${t.currency}`, '')}–${formatMoney(t.max, t.currency)}`
    : formatMoney(t.amount, t.currency)
  return (t.amount !== 0 || t.max !== 0 || !parts.length ? [main, ...parts] : parts).join(' + ')
}

/** "≈ 45 100 TRY" — the total in the other currency, rounded, or null without rates. */
export function approxOther(amount: number, from: ShopCurrency, rates: UsdRates | null): string | null {
  if (!rates || amount <= 0) return null
  const to = otherCurrency(from)
  const v = convertAmount(amount, from, to, rates)
  if (v == null) return null
  return `≈ ${formatMoney(Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100, to)}`
}

/** "1 299 NOK" / "1 299 NOK (est.)" for a card, or null without a price. */
export function priceLabel(item: ShopItem): string | null {
  if (item.price == null) return null
  return `${formatMoney(item.price, currencyOf(item))}${item.price_source === 'ai_estimate' ? ' (est.)' : ''}`
}

export interface SubGroup { key: string; title: string | null; items: ShopItem[] }
export interface CategoryGroup { key: string; topId: string | null; title: string; subs: SubGroup[]; items: ShopItem[] }

/**
 * Rows by top category, then subcategory, keeping the rows' order. Groups
 * and subs sort by name; "No category" comes last.
 */
export function groupByCategory(items: readonly ShopItem[], categories: readonly ShopCategory[]): CategoryGroup[] {
  const tops = new Map<string, CategoryGroup>()
  for (const item of items) {
    const path = categoryPath(item.category_id, categories)
    const topKey = path.topId ?? '__none__'
    let group = tops.get(topKey)
    if (!group) { group = { key: topKey, topId: path.topId, title: path.topName, subs: [], items: [] }; tops.set(topKey, group) }
    group.items.push(item)
    const subKey = `${topKey}/${path.subName ?? ''}`
    let sub = group.subs.find(s => s.key === subKey)
    if (!sub) { sub = { key: subKey, title: path.subName, items: [] }; group.subs.push(sub) }
    sub.items.push(item)
  }
  const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' })
  for (const g of tops.values()) {
    // The top's own rows (no subcategory) lead its subs.
    g.subs.sort((a, b) => (a.title == null ? -1 : b.title == null ? 1 : byName(a.title, b.title)))
  }
  return [...tops.values()].sort((a, b) => (a.topId == null ? 1 : b.topId == null ? -1 : byName(a.title, b.title)))
}

/**
 * Every "Not any more" row, either list (a quick row only gets here from the
 * AI or SQL) — kept, never deleted by the app. A model that was not chosen
 * stays under its general wish instead.
 */
export function droppedItems(items: readonly ShopItem[]): ShopItem[] {
  return items.filter(i => i.status === 'dropped' && !i.option_for).sort(byNewest)
}

// ── Quick list ───────────────────────────────────────────────────────────────

export interface StoreGroup { key: string; title: string | null; items: ShopItem[] }

/** Quick-list rows still to pick up, in the order they were added. */
export function quickOpen(items: readonly ShopItem[]): ShopItem[] {
  return items
    .filter(i => listOf(i) === 'quick' && i.status === 'wishlist')
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
}

/** "No rush" on the quick list is its low priority: sorted last in its store, kept off Daily. */
export const isNoRush = (i: Pick<ShopItem, 'priority'>): boolean => i.priority === 'low'

/** Quick-list rows to pick up that are not "No rush" (what Daily counts). */
export function quickDue(items: readonly ShopItem[]): ShopItem[] {
  return quickOpen(items).filter(i => !isNoRush(i))
}

/**
 * Wishlist rows that also show on the quick list (migration 137), never moved
 * there: one to pick up on the next errand, or a deal to check at its store
 * from its day on ("Check: earphones · deal from 14.10.2026"). Ticking one
 * there buys it — it stays a wishlist row, so it becomes yours.
 */
export function quickFromWishlist(items: readonly ShopItem[], today: string): ShopItem[] {
  return items
    .filter(i => listOf(i) === 'wishlist' && i.status === 'wishlist' && !i.option_for && i.kind !== 'general'
      && (i.errand || (i.wait_for_deal && !!i.platform?.trim() && !!i.planned_date && i.planned_date <= today)))
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
}

/** Inside a store: what is needed first, "No rush" last, each in the order added. */
export function sortForStore(rows: readonly ShopItem[]): ShopItem[] {
  return [...rows].sort((a, b) => Number(isNoRush(a)) - Number(isNoRush(b)) || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
}

/**
 * Open rows by store (`platform`, folded so "Rema" and "rema " meet; the
 * newest spelling names the group). Named stores A–Z, rows without a store
 * last — and when no row names a store, one group without a heading.
 */
export function groupByStore(items: readonly ShopItem[]): StoreGroup[] {
  const groups = new Map<string, StoreGroup & { latest: string }>()
  for (const item of items) {
    const name = (item.platform ?? '').trim()
    const key = fold(name)
    let g = groups.get(key)
    if (!g) { g = { key, title: name || null, items: [], latest: item.created_at ?? '' }; groups.set(key, g) }
    g.items.push(item)
    if (name && (item.created_at ?? '') >= g.latest) { g.title = name; g.latest = item.created_at ?? '' }
  }
  const list = [...groups.values()]
  if (list.length === 1 && list[0].key === '') return [{ key: '', title: null, items: sortForStore(list[0].items) }]
  return list
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : (a.title ?? '').localeCompare(b.title ?? '', 'en', { sensitivity: 'base' })))
    .map(({ key, title, items: rows }) => ({ key, title: key === '' ? 'Any store' : title, items: sortForStore(rows) }))
}

/** Quick-list rows ticked off today, last ticked first. */
export function pickedUpOn(items: readonly ShopItem[], today: string): ShopItem[] {
  return items
    .filter(i => listOf(i) === 'quick' && boughtDay(i) === today)
    .sort((a, b) => (b.bought_at ?? b.updated_at ?? '').localeCompare(a.bought_at ?? a.updated_at ?? ''))
}

export interface BuyAgain { title: string; count: number; row: ShopItem }

/**
 * Things bought from the quick list before and not on it now, most often
 * bought first. `row` is the latest such purchase (its store and category
 * go with a re-add).
 */
export function buyAgain(items: readonly ShopItem[], limit = 12): BuyAgain[] {
  const open = new Set(quickOpen(items).map(i => fold(i.title)))
  const seen = new Map<string, BuyAgain>()
  for (const item of items) {
    if (listOf(item) !== 'quick' || item.status !== 'bought') continue
    const key = fold(item.title)
    if (!key || open.has(key)) continue
    const at = item.bought_at ?? item.updated_at ?? ''
    const cur = seen.get(key)
    if (!cur) seen.set(key, { title: item.title.trim(), count: 1, row: item })
    else {
      cur.count++
      if (at > (cur.row.bought_at ?? cur.row.updated_at ?? '')) { cur.row = item; cur.title = item.title.trim() }
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || (b.row.bought_at ?? b.row.updated_at ?? '').localeCompare(a.row.bought_at ?? a.row.updated_at ?? ''))
    .slice(0, limit)
}

/** Store names used before, most used first (suggestions for the store field). */
export function storeNames(items: readonly ShopItem[]): string[] {
  const counts = new Map<string, { name: string; n: number }>()
  for (const item of items) {
    const name = (item.platform ?? '').trim()
    if (!name) continue
    const key = fold(name)
    const cur = counts.get(key)
    if (cur) cur.n++
    else counts.set(key, { name, n: 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map(c => c.name)
}

/**
 * What the quick list shows, by store: its open rows plus the wishlist rows
 * that go on it too (an errand, a deal that is due) — a wishlist row joins
 * its store's group, one without a store goes under "Any store".
 */
export function quickGroups(items: readonly ShopItem[], today: string): StoreGroup[] {
  return groupByStore([...quickOpen(items), ...quickFromWishlist(items, today)])
}

/**
 * A new quick-list row from the add box or a scanned product: the title,
 * the store (blank → none), "No rush" as low priority, the product's EAN and
 * picture when there is one. Nothing else — Tape needs no category.
 */
export function quickAddInput(p: { title: string; store?: string | null; noRush?: boolean; ean?: string | null; image?: string | null }): CreateShopItemInput {
  return {
    title: p.title.trim(),
    platform: p.store?.trim() || null,
    list: 'quick',
    ...(p.noRush ? { priority: 'low' as const } : {}),
    ...(p.ean ? { ean: p.ean } : {}),
    ...(p.image ? { image_url: p.image } : {}),
  }
}

/** A Buy-again chip's fresh row: the latest purchase's title, store, category and product (EAN, picture), so its price comes back with it. */
export function buyAgainInput(entry: BuyAgain): CreateShopItemInput {
  const r = entry.row
  return {
    title: entry.title,
    platform: r.platform,
    category_id: r.category_id,
    list: 'quick',
    ...(r.ean ? { ean: r.ean } : {}),
    ...(r.image_url ? { image_url: r.image_url } : {}),
  }
}

// ── Bought ───────────────────────────────────────────────────────────────────

/** Wishlist purchases, latest first (rows without a date last). */
export function boughtList(items: readonly ShopItem[]): ShopItem[] {
  return items
    .filter(i => listOf(i) === 'wishlist' && i.status === 'bought')
    .sort((a, b) => {
      const da = boughtDay(a), db = boughtDay(b)
      if (da && db) return db.localeCompare(da) || byNewest(a, b)
      return da ? -1 : db ? 1 : byNewest(a, b)
    })
}

export interface Spent { month: Totals; year: Totals; all: Totals }

/** What the bought wishlist rows cost this month, this year and in all. */
export function spentSummary(bought: readonly ShopItem[], today: string, target: ShopCurrency, rates: UsdRates | null): Spent {
  const month = bought.filter(i => boughtDay(i)?.slice(0, 7) === today.slice(0, 7))
  const year = bought.filter(i => boughtDay(i)?.slice(0, 4) === today.slice(0, 4))
  return { month: totalsIn(month, target, rates), year: totalsIn(year, target, rates), all: totalsIn(bought, target, rates) }
}

// ── Planning ─────────────────────────────────────────────────────────────────

/** The task a purchase becomes: "Buy <title>", due on its buy-on day when it has one. */
export function planDefaults(item: Pick<ShopItem, 'title' | 'planned_date' | 'notes'>): { title: string; dueDate?: string; notes?: string } {
  return {
    title: `Buy ${item.title.trim()}`,
    ...(item.planned_date ? { dueDate: item.planned_date } : {}),
    ...(item.notes?.trim() ? { notes: item.notes.trim() } : {}),
  }
}
