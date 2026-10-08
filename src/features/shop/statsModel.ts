// Owned → Stats (migration 137): money in and out by month, the year's totals,
// what you own by category, where you buy, an ownership timeline, value for
// money per month and things bought to sell. Every figure carries the rows
// behind it so a tap can list them. Pure — scripts/verify-shop-owned.cjs.

import type { ShopCategory, ShopItem } from './types'
import { categoryPath, fold } from './shopModel'
import {
  add, boughtOn, costOf, daysBetween, gotOf, isMine, isPossession, minus, nokAt, paidOf, perMonth, valueNowOf, ZERO,
  accessoriesByItem, type Amount, type MoneyCtx, type PerMonth,
} from './ownModel'
import type { Chain } from './chainModel'

/** Rows that count as spending: things bought on the wishlist side (kept or not). Quick-list errands are left out. */
function spendRows(items: readonly ShopItem[]): ShopItem[] {
  return items.filter(i => (i.list ?? 'wishlist') === 'wishlist' && i.kind !== 'general' && i.status === 'bought')
}

const monthOf = (day: string | null | undefined) => (day ? day.slice(0, 7) : null)

export interface MonthRow {
  /** yyyy-mm */
  month: string
  /** Bought this month (+ extra costs dated this month), less refunds. */
  spent: Amount
  /** Sold or traded in this month. */
  got: Amount
  ids: string[]
}

/**
 * Money out and in per month from `fromMonth` to `toMonth` (yyyy-mm, both in).
 * A refund (returned) takes its purchase back out of the month it came back in.
 */
export function moneyByMonth(items: readonly ShopItem[], ctx: MoneyCtx, fromMonth: string, toMonth: string): MonthRow[] {
  const months: string[] = []
  let [y, m] = fromMonth.split('-').map(Number)
  const [ty, tm] = toMonth.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  const rows = new Map(months.map(mm => [mm, { month: mm, spent: ZERO, got: ZERO, ids: [] as string[] }]))
  const touch = (mm: string | null, id: string) => { const r = mm ? rows.get(mm) : undefined; if (r && !r.ids.includes(id)) r.ids.push(id); return r }
  for (const i of spendRows(items)) {
    const b = touch(monthOf(boughtOn(i)), i.id)
    if (b) b.spent = add(b.spent, paidOf(i))
    for (const c of ctx.costs.get(i.id) ?? []) {
      const r = touch(monthOf(c.spent_on), i.id)
      if (r) r.spent = add(r.spent, nokAt(c.amount, c.currency, c.fx_nok))
    }
    if (i.disposal) {
      const r = touch(monthOf(i.disposed_on), i.id)
      const g = gotOf(i)
      if (r && g) {
        if (i.disposal === 'returned') r.spent = minus(r.spent, g)
        else r.got = add(r.got, g)
      }
    }
  }
  return months.map(mm => rows.get(mm) as MonthRow)
}

export interface YearTotals { year: string; spent: Amount; got: Amount; net: Amount; boughtIds: string[]; soldIds: string[] }

/** One year's spending (less refunds), what came back from sales, and the difference. */
export function yearTotals(items: readonly ShopItem[], ctx: MoneyCtx, year: string): YearTotals {
  const rows = moneyByMonth(items, ctx, `${year}-01`, `${year}-12`)
  const spent = add(...rows.map(r => r.spent))
  const got = add(...rows.map(r => r.got))
  const boughtIds = spendRows(items).filter(i => boughtOn(i)?.startsWith(year)).map(i => i.id)
  const soldIds = spendRows(items).filter(i => i.disposed_on?.startsWith(year) && i.disposal && i.disposal !== 'returned' && i.sale_price).map(i => i.id)
  return { year, spent, got, net: minus(spent, got), boughtIds, soldIds }
}

export interface CategoryRow { key: string; title: string; count: number; paid: Amount; worth: Amount; valued: number; ids: string[] }

/** What you own now by top category: how many, what they cost, what the valued ones could sell for. */
export function ownedByCategory(items: readonly ShopItem[], categories: readonly ShopCategory[], ctx: MoneyCtx): CategoryRow[] {
  const out = new Map<string, CategoryRow>()
  for (const i of items) {
    if (!isPossession(i) || i.disposal) continue
    const p = categoryPath(i.category_id, categories)
    const key = p.topId ?? '__none__'
    const row = out.get(key) ?? { key, title: p.topName, count: 0, paid: ZERO, worth: ZERO, valued: 0, ids: [] }
    if (!i.accessory_of) row.count++
    row.paid = add(row.paid, costOf(i, ctx))
    const v = valueNowOf(i, ctx)
    if (v) { row.worth = add(row.worth, v); row.valued++ }
    row.ids.push(i.id)
    out.set(key, row)
  }
  return [...out.values()].sort((a, b) => b.paid.nok - a.paid.nok || a.title.localeCompare(b.title))
}

export interface StoreRow { key: string; title: string; count: number; spent: Amount; currencies: Record<string, number>; ids: string[] }

/** Where you buy: stores by what you spent there (the name as you wrote it most recently). */
export function byStore(items: readonly ShopItem[], year?: string): StoreRow[] {
  const out = new Map<string, StoreRow & { latest: string }>()
  for (const i of spendRows(items)) {
    if (year && !boughtOn(i)?.startsWith(year)) continue
    if (i.disposal === 'returned') continue
    const name = (i.platform ?? '').trim()
    if (!name) continue
    const key = fold(name)
    const row = out.get(key) ?? { key, title: name, count: 0, spent: ZERO, currencies: {}, ids: [], latest: '' }
    row.count++
    row.spent = add(row.spent, paidOf(i))
    const c = i.currency ?? 'NOK'
    row.currencies[c] = (row.currencies[c] ?? 0) + 1
    row.ids.push(i.id)
    const at = boughtOn(i) ?? ''
    if (at >= row.latest) { row.title = name; row.latest = at }
    out.set(key, row)
  }
  return [...out.values()]
    .map(r => ({ key: r.key, title: r.title, count: r.count, spent: r.spent, currencies: r.currencies, ids: r.ids }))
    .sort((a, b) => b.spent.nok - a.spent.nok || b.count - a.count)
}

export interface TimelineRow { item: ShopItem; from: string; to: string | null; group: string; approx: boolean }

/** One bar per thing (accessories ride with theirs), from bought to gone or today, grouped by top category. */
export function timelineRows(items: readonly ShopItem[], categories: readonly ShopCategory[]): { rows: TimelineRow[]; start: string | null } {
  const rows: TimelineRow[] = []
  for (const i of items) {
    if (!isPossession(i) || i.accessory_of || i.disposal === 'returned') continue
    const from = boughtOn(i)
    if (!from) continue
    rows.push({ item: i, from, to: i.disposal ? (i.disposed_on ?? null) : null, group: categoryPath(i.category_id, categories).topName, approx: !!i.approx_dates })
  }
  rows.sort((a, b) => a.group.localeCompare(b.group) || a.from.localeCompare(b.from))
  const start = rows.reduce<string | null>((s, r) => (!s || r.from < s ? r.from : s), null)
  return { rows, start }
}

export interface ValueRow { item: ShopItem; per: PerMonth }

/** Things by cost of use per month (only those with an honest number), dearest first. */
export function valueRanking(items: readonly ShopItem[], ctx: MoneyCtx, today: string): ValueRow[] {
  const acc = accessoriesByItem(items)
  const out: ValueRow[] = []
  for (const i of items) {
    if (!isPossession(i) || i.accessory_of || i.disposal === 'returned') continue
    const per = perMonth(i, ctx, today, acc.get(i.id) ?? [])
    if (per) out.push({ item: i, per })
  }
  return out.sort((a, b) => b.per.nok - a.per.nok)
}

export interface ResaleSummary {
  bought: number
  sold: number
  holding: number
  /** Got back − cost, over the sold ones. */
  result: Amount
  avgDaysToSell: number | null
  ids: string[]
}

/** Things bought to sell later, or null when there are none (the section hides). */
export function resaleSummary(items: readonly ShopItem[], ctx: MoneyCtx): ResaleSummary | null {
  const rows = items.filter(i => isPossession(i) && i.for_resale && i.disposal !== 'returned')
  if (!rows.length) return null
  const sold = rows.filter(i => i.disposal)
  const days = sold.map(i => (boughtOn(i) && i.disposed_on ? daysBetween(boughtOn(i) as string, i.disposed_on) : null)).filter((d): d is number => d != null)
  const result = add(...sold.map(i => minus(gotOf(i) ?? ZERO, costOf(i, ctx))))
  return {
    bought: rows.length,
    sold: sold.length,
    holding: rows.length - sold.length,
    result,
    avgDaysToSell: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null,
    ids: rows.map(i => i.id),
  }
}

/** The average time things were kept before they went (months), or null. */
export function averageKeptMonths(items: readonly ShopItem[]): number | null {
  const kept = items
    .filter(i => isPossession(i) && !i.accessory_of && i.disposal && i.disposal !== 'returned' && i.disposed_on && boughtOn(i))
    .map(i => daysBetween(boughtOn(i) as string, i.disposed_on as string) / 30.4375)
  return kept.length ? kept.reduce((s, m) => s + m, 0) / kept.length : null
}

// ── The Stats screen ─────────────────────────────────────────────────────────

/** The years money moved in — bought, sold, refunded or an extra cost — newest first. */
export function statsYears(items: readonly ShopItem[], ctx: MoneyCtx): string[] {
  const years = new Set<string>()
  for (const i of spendRows(items)) {
    const b = boughtOn(i)
    if (b) years.add(b.slice(0, 4))
    const g = i.disposal ? gotOf(i) : null
    if (g && i.disposed_on && (g.nok !== 0 || g.missing || g.pending)) years.add(i.disposed_on.slice(0, 4))
    for (const c of ctx.costs.get(i.id) ?? []) years.add(c.spent_on.slice(0, 4))
  }
  return [...years].sort((a, b) => b.localeCompare(a))
}

/** A year's totals, or every year's together (null). */
export function periodTotals(items: readonly ShopItem[], ctx: MoneyCtx, year: string | null): YearTotals {
  if (year) return yearTotals(items, ctx, year)
  const parts = statsYears(items, ctx).map(y => yearTotals(items, ctx, y))
  const spent = add(...parts.map(p => p.spent))
  const got = add(...parts.map(p => p.got))
  return {
    year: 'all', spent, got, net: minus(spent, got),
    boughtIds: [...new Set(parts.flatMap(p => p.boughtIds))],
    soldIds: [...new Set(parts.flatMap(p => p.soldIds))],
  }
}

/** The months the money chart shows (yyyy-mm, both in): the picked year's twelve, or the last 24 up to this month. */
export function chartMonths(year: string | null, today: string): { from: string; to: string } {
  if (year) return { from: `${year}-01`, to: `${year}-12` }
  const [y, m] = today.split('-').map(Number)
  const first = y * 12 + (m - 1) - 23
  return { from: `${Math.floor(first / 12)}-${String((first % 12) + 1).padStart(2, '0')}`, to: today.slice(0, 7) }
}

/** The months a year (or every year with data, null) covers — what a drill-down of the period lists. */
export function periodMonths(years: readonly string[], year: string | null): { from: string; to: string } | null {
  if (year) return { from: `${year}-01`, to: `${year}-12` }
  if (!years.length) return null
  const sorted = [...years].sort()
  return { from: `${sorted[0]}-01`, to: `${sorted[sorted.length - 1]}-12` }
}

export type MoneyEventKind = 'bought' | 'cost' | 'sold' | 'refund'

export interface MoneyEvent {
  key: string
  /** The thing it belongs to. */
  id: string
  day: string
  kind: MoneyEventKind
  /** An extra cost's own label ("Wall mount"); else null. */
  label: string | null
  /** As it happened, in NOK at its own day's rate: a purchase, a cost (a rebate is below 0), money got back, a refund. */
  amount: Amount
}

/**
 * Every money movement from `fromMonth` to `toMonth` (yyyy-mm, both in),
 * oldest first — moneyByMonth itemised: a month's spent is its purchases +
 * costs − refunds, its got back is its sales and trade-ins. Giving a thing
 * away moves no money and is left out.
 */
export function moneyEvents(items: readonly ShopItem[], ctx: MoneyCtx, fromMonth: string, toMonth: string): MoneyEvent[] {
  const inRange = (day: string | null | undefined): day is string => !!day && day.slice(0, 7) >= fromMonth && day.slice(0, 7) <= toMonth
  const out: MoneyEvent[] = []
  for (const i of spendRows(items)) {
    const b = boughtOn(i)
    if (inRange(b)) out.push({ key: `b:${i.id}`, id: i.id, day: b, kind: 'bought', label: null, amount: paidOf(i) })
    for (const c of ctx.costs.get(i.id) ?? []) {
      if (inRange(c.spent_on)) out.push({ key: `c:${c.id}`, id: i.id, day: c.spent_on, kind: 'cost', label: c.label, amount: nokAt(c.amount, c.currency, c.fx_nok) })
    }
    const g = i.disposal ? gotOf(i) : null
    if (g && inRange(i.disposed_on) && (g.nok !== 0 || g.missing || g.pending)) {
      out.push({ key: `g:${i.id}`, id: i.id, day: i.disposed_on, kind: i.disposal === 'returned' ? 'refund' : 'sold', label: null, amount: g })
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key))
}

/** "1 year 9 months" for a number of months (whole months; under one: "under a month"). */
export function monthsLabel(months: number): string {
  const total = Math.round(months)
  if (total < 1) return 'under a month'
  const y = Math.floor(total / 12)
  const m = total % 12
  return [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ')
}

/** Why a thing still yours has no cost of use per month yet. */
export type UseGap = 'no_value' | 'missing' | 'pending' | 'new'

/** The reason, or null when it has an honest number. */
export function costOfUseGap(i: ShopItem, ctx: MoneyCtx, today: string): UseGap | null {
  if (perMonth(i, ctx, today)) return null
  const v = valueNowOf(i, ctx)
  if (!v) return 'no_value'
  const used = minus(costOf(i, ctx), v)
  if (used.missing) return 'missing'
  if (used.pending) return 'pending'
  return 'new'
}

export interface UseNow {
  /** NOK per month, over `rows` only. */
  nok: number
  /** The things with an honest number, dearest first. */
  rows: ValueRow[]
  /** Every thing still yours (accessories ride with their item). */
  things: ShopItem[]
}

/** Cost of use per month of the things still yours: the sum of the honest numbers, the things behind it, and of how many. */
export function costOfUseNow(items: readonly ShopItem[], ctx: MoneyCtx, today: string): UseNow {
  const things = items.filter(i => isMine(i) && !i.accessory_of)
  const rows: ValueRow[] = []
  for (const i of things) {
    const per = perMonth(i, ctx, today)
    if (per) rows.push({ item: i, per })
  }
  rows.sort((a, b) => b.per.nok - a.per.nok)
  return { nok: rows.reduce((s, r) => s + r.per.nok, 0), rows, things }
}

/** The dearest `n` and, after them, the cheapest `n` (cheapest first) — never one thing twice. Takes a list sorted dearest first. */
export function valueEnds<T>(rows: readonly T[], n = 5): { dearest: T[]; cheapest: T[] } {
  return { dearest: rows.slice(0, n), cheapest: rows.slice(n).slice(-n).reverse() }
}

export interface KeptRow { item: ShopItem; from: string; to: string; months: number }

/** Things that went (not returned), with how long each was kept — what averageKeptMonths averages. Longest first. */
export function keptRows(items: readonly ShopItem[]): KeptRow[] {
  return items
    .filter(i => isPossession(i) && !i.accessory_of && i.disposal && i.disposal !== 'returned' && i.disposed_on && boughtOn(i))
    .map(i => {
      const from = boughtOn(i) as string
      const to = i.disposed_on as string
      return { item: i, from, to, months: daysBetween(from, to) / 30.4375 }
    })
    .sort((a, b) => b.months - a.months || a.item.title.localeCompare(b.item.title))
}

/** Chains with at least `min` things you have or had (a link to a wish alone is only a plan). */
export function chainsWithThings(chains: readonly Chain[], min = 2): Chain[] {
  return chains.filter(c => c.nodes.filter(n => n.state !== 'wish').length >= min)
}

/** Every thing in the chain you have or had was bought to sell later — only then is its result a profit or a loss. */
export function boughtToSell(chain: Chain): boolean {
  const things = chain.nodes.filter(n => n.state !== 'wish')
  return things.length > 0 && things.every(n => !!n.item.for_resale)
}

export interface TimelineAxis {
  /** 1 January of the first year. */
  from: string
  /** Today. */
  to: string
  days: number
  /** Where each year starts, as a fraction of the axis (the first at 0). */
  years: { year: number; at: number }[]
}

/** The ownership timeline's axis: 1 January of the first purchase's year to today. */
export function timelineAxis(start: string, today: string): TimelineAxis {
  const from = `${start.slice(0, 4)}-01-01`
  const to = today > from ? today : `${start.slice(0, 4)}-12-31`
  const days = Math.max(1, daysBetween(from, to))
  const years: { year: number; at: number }[] = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push({ year: y, at: daysBetween(from, `${y}-01-01`) / days })
  return { from, to, days, years }
}

/** Where a bar sits on the axis, as fractions of its width (0–1); no end day = today. */
export function timelineSpan(axis: TimelineAxis, from: string, to: string | null): { left: number; width: number } {
  const at = (d: string) => Math.min(1, Math.max(0, daysBetween(axis.from, d) / axis.days))
  const left = at(from)
  return { left, width: Math.max(left, at(to ?? axis.to)) - left }
}

/** Label every k-th year (1, 2, 5 or 10) so each label keeps at least `minRem` of the axis's `widthRem`. */
export function yearLabelEvery(axis: TimelineAxis, widthRem: number, minRem = 2.5): number {
  const perYear = (widthRem * 365.25) / axis.days
  for (const k of [1, 2, 5]) if (perYear * k >= minRem) return k
  return 10
}
