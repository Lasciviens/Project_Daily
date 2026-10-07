// Shop's rules (migration 134): which view a row is on, its currency, the
// wishlist's filters / sort / category groups / totals, the quick list's
// stores, picked-up and buy-again rows, and the bought history. Pure —
// scripts/verify-shop-model.cjs runs it against fixtures.
import type { ShopCategory, ShopCurrency, ShopItem, ShopList, ShopPriority, ShopRegion } from './types'
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

/** The other of the owner's two currencies, for the "≈" beside a total. */
export function otherCurrency(c: ShopCurrency): ShopCurrency {
  return c === 'TRY' ? 'NOK' : 'TRY'
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

/** Wishlist rows still to buy, narrowed by the filters. */
export function filterWishlist(items: readonly ShopItem[], categories: readonly ShopCategory[], f: WishlistFilters): ShopItem[] {
  return items.filter(item => {
    if (listOf(item) !== 'wishlist' || item.status !== 'wishlist') return false
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

const PRIORITY_RANK: Record<ShopPriority, number> = { high: 0, medium: 1, low: 2 }

/** The price in NOK when rates allow, else the bare number (so one currency still sorts right). */
function comparablePrice(item: ShopItem, rates: UsdRates | null): number | null {
  if (item.price == null) return null
  const c = currencyOf(item)
  if (!rates || c === 'NOK') return item.price
  return convertAmount(item.price, c, 'NOK', rates) ?? item.price
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
  /** The priced rows in `currency`. */
  amount: number
  currency: ShopCurrency
  /** Per-currency sums that had no exchange rate (shown beside, never dropped). */
  unconverted: Money[]
}

/** The rows' prices summed in `target`; without rates only `target`-priced rows convert. */
export function totalsIn(items: readonly ShopItem[], target: ShopCurrency, rates: UsdRates | null): Totals {
  let amount = 0
  let unpriced = 0
  const rest = new Map<ShopCurrency, number>()
  for (const item of items) {
    if (item.price == null) { unpriced++; continue }
    const c = currencyOf(item)
    const v = c === target ? item.price : rates ? convertAmount(item.price, c, target, rates) : null
    if (v == null) rest.set(c, (rest.get(c) ?? 0) + item.price)
    else amount += v
  }
  // Whole units: a converted sum's öre/kuruş are noise, not information.
  return {
    count: items.length,
    unpriced,
    amount: Math.round(amount),
    currency: target,
    unconverted: [...rest].map(([currency, a]) => ({ currency, amount: Math.round(a) })),
  }
}

/** "12 340 NOK" (+ "+ 300 EUR" for sums without a rate; no "0 NOK +" in front of those). */
export function totalsLabel(t: Totals): string {
  const parts = t.unconverted.map(u => formatMoney(u.amount, u.currency))
  return (t.amount !== 0 || !parts.length ? [formatMoney(t.amount, t.currency), ...parts] : parts).join(' + ')
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
 * How many category columns fit a width (rem): one per 20rem (a 17rem card
 * plus room), never more than there are groups — a group with the width to
 * itself lays its cards out side by side instead.
 */
export function groupColumnCount(widthRem: number, groups: number): number {
  return Math.max(1, Math.min(groups, Math.floor((widthRem + 1) / 20)))
}

/** Wishlist rows marked "Not any more" — kept, never deleted by the app. */
export function droppedItems(items: readonly ShopItem[]): ShopItem[] {
  return items.filter(i => listOf(i) === 'wishlist' && i.status === 'dropped').sort(byNewest)
}

// ── Quick list ───────────────────────────────────────────────────────────────

export interface StoreGroup { key: string; title: string | null; items: ShopItem[] }

/** Quick-list rows still to pick up, in the order they were added. */
export function quickOpen(items: readonly ShopItem[]): ShopItem[] {
  return items
    .filter(i => listOf(i) === 'quick' && i.status === 'wishlist')
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
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
  if (list.length === 1 && list[0].key === '') return [{ key: '', title: null, items: list[0].items }]
  return list
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : (a.title ?? '').localeCompare(b.title ?? '', 'en', { sensitivity: 'base' })))
    .map(({ key, title, items: rows }) => ({ key, title: key === '' ? 'Any store' : title, items: rows }))
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
