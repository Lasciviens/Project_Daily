// Owned → Stats (migration 137): money in and out by month, the year's totals,
// what you own by category, where you buy, an ownership timeline, value for
// money per month and things bought to sell. Every figure carries the rows
// behind it so a tap can list them. Pure — scripts/verify-shop-owned.cjs.

import type { ShopCategory, ShopItem } from './types'
import { categoryPath, fold, localDay } from './shopModel'
import { rebateKind, type RebateKind } from './complaintModel'
import {
  add, addDays, boughtOn, complete, costOf, daysBetween, gotOf, isGone, isMine, isPossession, minus, monthsBetween, NO_CATEGORY, nokAt, paidOf, perMonth,
  valueNowOf, ZERO, accessoriesByItem, type Amount, type MoneyCtx, type OwnedShow, type PerMonth,
} from './ownModel'
import type { Chain } from './chainModel'

/** Rows that count as spending: things bought on the wishlist side (kept or not). Quick-list errands are left out. */
export function spendRows(items: readonly ShopItem[]): ShopItem[] {
  return items.filter(i => (i.list ?? 'wishlist') === 'wishlist' && i.kind !== 'general' && i.status === 'bought')
}

// ── The period: a year, or all time ──────────────────────────────────────────
//
// Every part of Stats follows the picked period (owner, 09.11.2026: "Follow
// the year"). A year is seen from its end — 31 December, or today for this
// year — and all time from today: what you had is counted on that day; money,
// sales and a chain's steps inside the period. "Could sell for" keeps no
// history, so for a past year it is known only for the things still yours
// today, at today's estimate — never made up for the rest.

export interface Period {
  /** The picked year, or null for all time. */
  year: string | null
  /** Its first day (1 January), or null for all time. */
  from: string | null
  /** The day it is seen from: 31 December of a past year, else today. */
  to: string
  today: string
  /** A year before this one: what its things could sell for then is not known. */
  past: boolean
}

export function periodOf(year: string | null, today: string): Period {
  if (!year) return { year: null, from: null, to: today, today, past: false }
  const end = `${year}-12-31`
  return { year, from: `${year}-01-01`, to: end < today ? end : today, today, past: end < today }
}

/** Had at the end of `day`: bought by then and not gone yet (it left after that day). A returned thing never was yours. */
export function hadOn(i: ShopItem, day: string): boolean {
  if (!isPossession(i) || i.disposal === 'returned') return false
  const from = boughtOn(i)
  if (!from || from > day) return false
  return !i.disposal || (!!i.disposed_on && i.disposed_on > day)
}

/** Had at some point in the period: bought by its end and not gone before it began. */
export function hadIn(i: ShopItem, p: Period): boolean {
  if (!isPossession(i) || i.disposal === 'returned') return false
  const from = boughtOn(i)
  if (!from || from > p.to) return false
  return !p.from || !i.disposal || (!!i.disposed_on && i.disposed_on > p.from)
}

/** Sold, given away, broke… (not returned) on a day inside the period. */
export function wentIn(i: ShopItem, p: Period): boolean {
  return isGone(i) && !!i.disposed_on && (!p.from || i.disposed_on >= p.from) && i.disposed_on <= p.to
}

/** What a thing had cost by `day`: what was paid, and its extra costs dated up to that day. */
export function costBy(i: ShopItem, ctx: MoneyCtx, day: string): Amount {
  return add(paidOf(i), ...(ctx.costs.get(i.id) ?? []).filter(c => c.spent_on <= day).map(c => nokAt(c.amount, c.currency, c.fx_nok)))
}

/** What a thing you had cost at the period's end: by 31 December for a past year; for now everything, as Owned counts it. */
export const costAt = (i: ShopItem, ctx: MoneyCtx, p: Period): Amount => (p.past ? costBy(i, ctx, p.to) : costOf(i, ctx))

export interface OwnedAt {
  /** The day: 31 December of a past year, else today. */
  day: string
  past: boolean
  things: number
  accessories: number
  /** What they had cost by that day. */
  paid: Amount
  /** How many of the things (not accessories) are still yours today. */
  stillYours: number
  /** "Could sell for" of the ones still yours that have one, at today's rate — known only for them. */
  worth: Amount
  valued: number
  ids: string[]
}

/** Stats' "You own": what you had at the period's end (now: what Owned's Mine shows with no filter). */
export function ownedAt(items: readonly ShopItem[], ctx: MoneyCtx, p: Period): OwnedAt {
  let things = 0, accessories = 0, stillYours = 0, valued = 0
  const paid: Amount[] = []
  const worth: Amount[] = []
  const ids: string[] = []
  for (const i of items) {
    if (!hadOn(i, p.to)) continue
    if (i.accessory_of) accessories++
    else things++
    ids.push(i.id)
    paid.push(costAt(i, ctx, p))
    if (!isMine(i)) continue
    if (!i.accessory_of) stillYours++
    const v = valueNowOf(i, ctx)
    if (v) { worth.push(v); valued++ }
  }
  return { day: p.to, past: p.past, things, accessories, paid: add(...paid), stillYours, worth: add(...worth), valued, ids }
}

export interface UseRow {
  item: ShopItem
  /** Its cost of use per month over all the time you had it (ownModel.perMonth). */
  per: PerMonth
  /** The months of the period you had it (its days in it ÷ 30.4375). */
  months: number
  /** Its cost of use in the period (≈). */
  nok: number
}

export interface UseIn {
  /** ≈ NOK of use in the period, over the counted things. */
  nok: number
  /** The months the period covers — a past year 12, this year to today, all time from the first thing's day — for "a month". */
  months: number
  /** The things with an honest number, the dearest in the period first. */
  rows: UseRow[]
  /** Every thing you had in the period (accessories ride with their item). */
  things: ShopItem[]
}

/**
 * Cost of use in the period: each thing's cost of use per month — its final
 * result for a thing that went (what it cost, less what came back), today's
 * estimate for one still yours (less "Could sell for") — times the months of
 * the period you had it. Both are counted in days (a month is 30.4375), so a
 * thing's share is its cost of use × its days in the period ÷ all its days,
 * and the years add up exactly to all time. Only an honest number counts
 * (ownModel.perMonth: a "Could sell for", a month or more, every amount known).
 */
export function costOfUseIn(items: readonly ShopItem[], ctx: MoneyCtx, p: Period): UseIn {
  const acc = accessoriesByItem(items)
  const stop = addDays(p.to, 1)
  const things: ShopItem[] = []
  const rows: UseRow[] = []
  let first: string | null = null
  for (const i of items) {
    if (i.accessory_of || !hadIn(i, p)) continue
    things.push(i)
    const from = boughtOn(i) as string
    if (!first || from < first) first = from
    const per = perMonth(i, ctx, p.today, acc.get(i.id) ?? [])
    if (!per) continue
    const end = (i.disposal ? i.disposed_on : null) ?? p.today
    const all = daysBetween(from, end)
    const inside = Math.max(0, daysBetween(p.from && p.from > from ? p.from : from, end < stop ? end : stop))
    if (all <= 0 || inside <= 0) continue
    rows.push({ item: i, per, months: inside / 30.4375, nok: (per.used.nok * inside) / all })
  }
  rows.sort((a, b) => b.nok - a.nok || a.item.title.localeCompare(b.item.title))
  const months = p.from ? monthsBetween(p.from, p.past ? stop : p.today) : first ? monthsBetween(first, p.today) : 0
  return { nok: rows.reduce((s, r) => s + r.nok, 0), months, rows, things }
}

/** Chains with a step in the period — a thing in them bought or gone then. All time: every chain. */
export function chainsIn(chains: readonly Chain[], p: Period): Chain[] {
  const start = p.from
  if (!start) return [...chains]
  const inside = (day: string | null) => !!day && day >= start && day <= p.to
  return chains.filter(c => c.nodes.some(nd => inside(nd.bought) || inside(nd.left)))
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

export interface CategoryRow {
  key: string; title: string; count: number; paid: Amount; worth: Amount; valued: number; ids: string[]
  /** How many of its things (not accessories) are still yours today — only what is still yours has a "Could sell for". */
  stillYours: number
}

/** The key of rows without a category (a scope pick, a category row) — one key with Owned's filter. */
export { NO_CATEGORY }

/** By top category, or by subcategory (a top category's own things — no subcategory — get a row of their own). */
export type CategoryLevel = 'top' | 'sub'

/**
 * Where a row counts at a level: its top category; or its subcategory
 * ("Electronics › Phones"), its top category's own row ("Electronics (no
 * subcategory)" — just "Hobbies" when the top category has none), or No category.
 */
export function categoryBucket(categoryId: string | null | undefined, categories: readonly ShopCategory[], level: CategoryLevel): { key: string; title: string } {
  const p = categoryPath(categoryId, categories)
  if (!p.topId) return { key: NO_CATEGORY, title: p.topName }
  if (level === 'top') return { key: p.topId, title: p.topName }
  if (p.subName && categoryId) return { key: categoryId, title: `${p.topName} › ${p.subName}` }
  const hasSubs = categories.some(c => c.parent_id === p.topId)
  return { key: `${p.topId}/own`, title: hasSubs ? `${p.topName} (no subcategory)` : p.topName }
}

/**
 * What you own by top category (or subcategory): how many, what they cost,
 * what the valued ones could sell for — now, or at the period's end (`p`): the
 * things you had that day, what they had cost by then, and "Could sell for"
 * only for those still yours today.
 */
export function ownedByCategory(items: readonly ShopItem[], categories: readonly ShopCategory[], ctx: MoneyCtx, level: CategoryLevel = 'top', p?: Period): CategoryRow[] {
  const out = new Map<string, CategoryRow>()
  for (const i of items) {
    if (p ? !hadOn(i, p.to) : !isMine(i)) continue
    const { key, title } = categoryBucket(i.category_id, categories, level)
    const row = out.get(key) ?? { key, title, count: 0, paid: ZERO, worth: ZERO, valued: 0, ids: [], stillYours: 0 }
    if (!i.accessory_of) row.count++
    row.paid = add(row.paid, p ? costAt(i, ctx, p) : costOf(i, ctx))
    if (isMine(i) && !i.accessory_of) row.stillYours++
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

export type StoreOrder = 'spent' | 'count'

/** Stores by what you spent there (as byStore gives them), or by how many purchases. */
export function orderStores(rows: readonly StoreRow[], by: StoreOrder): StoreRow[] {
  if (by === 'spent') return [...rows].sort((a, b) => b.spent.nok - a.spent.nok || b.count - a.count)
  return [...rows].sort((a, b) => b.count - a.count || b.spent.nok - a.spent.nok || a.title.localeCompare(b.title))
}

export interface TimelineRow {
  item: ShopItem; from: string; to: string | null; group: string; approx: boolean
  /** It went inside the period (its bar ends there); otherwise it was still yours at the period's end. */
  gone: boolean
}

/** Still yours (mine), sold or gone (gone), or either (all). */
export const showsIn = (i: Pick<ShopItem, 'disposal'>, show: OwnedShow): boolean => show === 'all' || (show === 'mine' ? !i.disposal : !!i.disposal)

/**
 * One bar per thing (accessories ride with theirs), from bought to gone or
 * today, grouped by top category. With a period (`p`): the things you had in
 * it, "gone" when they went inside it — one that went later was still yours
 * at its end, so its bar runs on.
 */
export function timelineRows(items: readonly ShopItem[], categories: readonly ShopCategory[], show: OwnedShow = 'all', p?: Period): { rows: TimelineRow[]; start: string | null } {
  const rows: TimelineRow[] = []
  for (const i of items) {
    if (i.accessory_of || (p ? !hadIn(i, p) : !isPossession(i) || i.disposal === 'returned')) continue
    const from = boughtOn(i)
    if (!from) continue
    const gone = p ? wentIn(i, p) : !!i.disposal
    if (show !== 'all' && (show === 'gone') !== gone) continue
    rows.push({ item: i, from, to: gone ? (i.disposed_on ?? null) : null, group: categoryPath(i.category_id, categories).topName, approx: !!i.approx_dates, gone })
  }
  rows.sort((a, b) => a.group.localeCompare(b.group) || a.from.localeCompare(b.from))
  const start = rows.reduce<string | null>((s, r) => (!s || r.from < s ? r.from : s), null)
  return { rows, start }
}

export interface ValueRow { item: ShopItem; per: PerMonth }

/** Things by cost of use per month (only those with an honest number), dearest first — with a period, the things you had in it. */
export function valueRanking(items: readonly ShopItem[], ctx: MoneyCtx, today: string, p?: Period): ValueRow[] {
  const acc = accessoriesByItem(items)
  const out: ValueRow[] = []
  for (const i of items) {
    if (i.accessory_of || (p ? !hadIn(i, p) : !isPossession(i) || i.disposal === 'returned')) continue
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

/**
 * Things bought to sell later, or null when there are none (the section
 * hides). With a period (`p`): the ones sold in it and the ones still held at
 * its end; the result and the days to sell over the sales made in it.
 */
export function resaleSummary(items: readonly ShopItem[], ctx: MoneyCtx, p?: Period): ResaleSummary | null {
  const rows = items.filter(i => isPossession(i) && i.for_resale && i.disposal !== 'returned' && (!p || wentIn(i, p) || hadOn(i, p.to)))
  if (!rows.length) return null
  const sold = rows.filter(i => (p ? wentIn(i, p) : !!i.disposal))
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

/** Why a thing has no cost of use per month: no "Could sell for" (still yours), a price or sale amount missing, a rate pending, under a month. */
export type UseGap = 'no_value' | 'missing' | 'pending' | 'new'

/** The reason, or null when it has an honest number (`accessories`: its own, for the ones that left in the same sale). */
export function costOfUseGap(i: ShopItem, ctx: MoneyCtx, today: string, accessories: readonly ShopItem[] = []): UseGap | null {
  if (perMonth(i, ctx, today, accessories)) return null
  let used: Amount
  if (isGone(i)) {
    const together = i.sale_group ? accessories.filter(a => a.sale_group === i.sale_group) : []
    used = minus(add(costOf(i, ctx), ...together.map(a => costOf(a, ctx))), add(gotOf(i), ...together.map(a => gotOf(a))))
  } else {
    const v = valueNowOf(i, ctx)
    if (!v) return 'no_value'
    used = minus(costOf(i, ctx), v)
  }
  if (used.missing) return 'missing'
  if (used.pending) return 'pending'
  return 'new'
}

/** The dearest `n` and, after them, the cheapest `n` (cheapest first) — never one thing twice. Takes a list sorted dearest first. */
export function valueEnds<T>(rows: readonly T[], n = 5): { dearest: T[]; cheapest: T[] } {
  return { dearest: rows.slice(0, n), cheapest: rows.slice(n).slice(-n).reverse() }
}

export interface KeptRow { item: ShopItem; from: string; to: string; months: number }

/** Things that went (not returned) — with a period, the ones that went in it — with how long each was kept. Longest first. */
export function keptRows(items: readonly ShopItem[], p?: Period): KeptRow[] {
  return items
    .filter(i => isPossession(i) && !i.accessory_of && i.disposal && i.disposal !== 'returned' && i.disposed_on && boughtOn(i) && (!p || wentIn(i, p)))
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

export type ChainShow = 'all' | 'going' | 'ended'

/** A chain has ended when every thing in it is sold or gone and no wish is left; else it is still going. */
export const chainEnded = (chain: Chain): boolean => chain.nodes.length > 0 && chain.nodes.every(n => n.state === 'gone')

export function filterChains(chains: readonly Chain[], show: ChainShow): Chain[] {
  return show === 'all' ? [...chains] : chains.filter(c => chainEnded(c) === (show === 'ended'))
}

export interface TimelineAxis {
  /** 1 January of the first year. */
  from: string
  /** Today (a past year's axis: 31 December). */
  to: string
  days: number
  /** Where each year starts, as a fraction of the axis (the first at 0). */
  years: { year: number; at: number }[]
  /** One year's axis: where each quarter starts (1 January, 1 April, 1 July, 1 October), up to its end. */
  quarters?: { day: string; at: number }[]
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

/** A year's axis (`p` with a year): 1 January to 31 December, or to today for this year, a mark at each quarter. */
export function yearAxis(p: Period & { from: string }): TimelineAxis {
  const days = Math.max(1, daysBetween(p.from, p.to))
  const quarters = ['01', '04', '07', '10']
    .map(m => `${p.from.slice(0, 4)}-${m}-01`)
    .filter(day => day <= p.to)
    .map(day => ({ day, at: daysBetween(p.from, day) / days }))
  return { from: p.from, to: p.to, days, years: [{ year: Number(p.from.slice(0, 4)), at: 0 }], quarters }
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

// ── The scope: the Stats screen's top filter ─────────────────────────────────

/**
 * What the whole Stats screen is narrowed to. Inside a section any pick will
 * do (OR); across sections every section must match (AND). An empty section
 * does not narrow.
 */
export interface StatsScope {
  /** Category ids: a top category takes everything under it, a subcategory only itself; NO_CATEGORY = rows without one. */
  categories: string[]
  /** Chain ids (Chain.id). */
  chains: string[]
  /** Thing ids: an item takes its accessories along; an accessory is only itself. */
  things: string[]
  /** Store keys — the folded name, as byStore keys a store. */
  stores: string[]
}

export type ScopeSection = keyof StatsScope

export const NO_SCOPE: StatsScope = { categories: [], chains: [], things: [], stores: [] }

export const scopeCount = (s: StatsScope): number => s.categories.length + s.chains.length + s.things.length + s.stores.length
export const scopeActive = (s: StatsScope): boolean => scopeCount(s) > 0

/** A store's key from the name written on a row ("POWER" and "power " are one store). */
export const storeKey = (name: string | null | undefined): string => fold(name ?? '')

/** Pick or unpick one key in a section. */
export function toggleScope(s: StatsScope, section: ScopeSection, key: string): StatsScope {
  const list = s[section]
  return { ...s, [section]: list.includes(key) ? list.filter(k => k !== key) : [...list, key] }
}

/**
 * The rows the scope leaves (in their order). An accessory follows its item
 * for categories, things and chains — it is in when its item is — but for
 * stores it is its own purchase (its own store). A chain takes every thing in
 * it with their accessories.
 */
export function scopeItems(items: readonly ShopItem[], scope: StatsScope, categories: readonly ShopCategory[], chains: readonly Chain[]): ShopItem[] {
  if (!scopeActive(scope)) return [...items]
  const byId = new Map(items.map(i => [i.id, i]))
  const ownerOf = (i: ShopItem): ShopItem => (i.accessory_of ? byId.get(i.accessory_of) ?? i : i)
  const cats = new Set(scope.categories)
  const things = new Set(scope.things)
  const stores = new Set(scope.stores)
  const inChains = new Set<string>()
  for (const c of chains) {
    if (!scope.chains.includes(c.id)) continue
    for (const nd of c.nodes) { inChains.add(nd.id); inChains.add(nd.item.id); for (const a of nd.accessories) inChains.add(a.id) }
  }
  const inCategory = (i: ShopItem) => {
    const o = ownerOf(i)
    const p = categoryPath(o.category_id, categories)
    if (!p.topId) return cats.has(NO_CATEGORY)
    return cats.has(p.topId) || (!!o.category_id && cats.has(o.category_id))
  }
  const follows = (set: Set<string>, i: ShopItem) => set.has(i.id) || (!!i.accessory_of && set.has(i.accessory_of))
  return items.filter(i => (!cats.size || inCategory(i))
    && (!things.size || follows(things, i))
    && (!scope.chains.length || follows(inChains, i))
    && (!stores.size || stores.has(storeKey(i.platform))))
}

/** The chains a scope touches: those with a thing (or one of its accessories) among the scoped rows — every chain when nothing is picked. */
export function scopeChains(chains: readonly Chain[], scoped: readonly ShopItem[], scope: StatsScope): Chain[] {
  if (!scopeActive(scope)) return [...chains]
  const ids = new Set(scoped.map(i => i.id))
  return chains.filter(c => c.nodes.some(nd => ids.has(nd.id) || nd.accessories.some(a => ids.has(a.id))))
}

/** Things you bought (kept or not) among the rows — what a scope leaves to count. Accessories ride with their item. */
export function scopeThingCount(items: readonly ShopItem[]): number {
  return spendRows(items).filter(i => !i.accessory_of).length
}

// ── Step C: why you buy, what watching saved, waiting, value kept, stores ────
//
// Every one follows the picked period: purchases bought in it (a returned one is left out — its money came back),
// money back dated in it, sales made in it, and what you had at its end.

/** Bought in the period (all time: ever), kept or not, a returned one left out. */
export function boughtIn(items: readonly ShopItem[], p: Period): ShopItem[] {
  return spendRows(items).filter(i => {
    const b = boughtOn(i)
    return !!b && i.disposal !== 'returned' && (!p.from || b >= p.from) && b <= p.to
  })
}

/** A day typed by hand is kept at noon on the dot (DateInput → middayIso); a Bought tap keeps the second it happened. */
const typedMoment = (iso: string): boolean => /:\d\d:00(?:\.0+)?(?:Z|[+-]\d\d:?\d\d)?$/.test(iso)

/**
 * When the thing was first wished for — the row made (a model: its general wish, when older) — or null when it
 * never was a wish: a thing added as owned. Like the record's Story, a wish is a row made on an earlier day than
 * it was bought; on the same day only when Bought was tapped after it was made (a typed day is noon on the dot).
 */
export function wishedSince(i: ShopItem, byId: ReadonlyMap<string, ShopItem>): string | null {
  if (i.status !== 'bought' || !i.bought_at || !i.created_at) return null
  const parent = i.option_for ? byId.get(i.option_for) : undefined
  const made = parent && parent.created_at < i.created_at ? parent.created_at : i.created_at
  const from = localDay(made), to = localDay(i.bought_at)
  if (from < to) return made
  return from === to && !typedMoment(i.bought_at) && new Date(i.bought_at).getTime() > new Date(i.created_at).getTime() ? made : null
}

export type WhyKey = 'need' | 'fun' | 'unsaid'
export type PriorityKey = 'high' | 'medium' | 'low'
export interface WhyRow { key: string; count: number; spent: Amount; ids: string[] }
export interface WhyIn { by: 'why' | 'priority'; rows: WhyRow[]; count: number; spent: Amount; leftOut: number }

const WHY_ORDER: readonly WhyKey[] = ['need', 'fun', 'unsaid']
const PRIORITY_ORDER: readonly PriorityKey[] = ['high', 'medium', 'low']

/**
 * Need it or just for fun: what was bought in the period by the reason it was on the list ("Need it" · "Just for
 * fun" · not said), or — for the things that were wishes first (a thing added as owned had no priority) — by the
 * wish's priority. What each cost at its own day's rate; returned ones are left out.
 */
export function needOrFun(items: readonly ShopItem[], p: Period, by: 'why' | 'priority' = 'why'): WhyIn {
  const byId = new Map(items.map(i => [i.id, i]))
  const rows = new Map<string, WhyRow>()
  let leftOut = 0
  for (const i of boughtIn(items, p)) {
    const key = by === 'why' ? (i.reason === 'need' || i.reason === 'fun' ? i.reason : 'unsaid') : wishedSince(i, byId) ? i.priority : null
    if (!key) { leftOut++; continue }
    const r = rows.get(key) ?? { key, count: 0, spent: ZERO, ids: [] }
    r.count++
    r.spent = add(r.spent, paidOf(i))
    r.ids.push(i.id)
    rows.set(key, r)
  }
  const order: readonly string[] = by === 'why' ? WHY_ORDER : PRIORITY_ORDER
  const list = order.map(k => rows.get(k)).filter((r): r is WhyRow => !!r)
  return { by, rows: list, count: list.reduce((s, r) => s + r.count, 0), spent: add(...list.map(r => r.spent)), leftOut }
}

export interface SavedRow { costId: string; id: string; day: string; label: string; kind: RebateKind; amount: Amount }
export interface SavedIn {
  /** Claims and price matches — what watching saved. */
  saved: Amount
  claims: Amount
  matches: Amount
  /** Other money back (cashback, a gift card…) — listed, not counted as saved. */
  other: Amount
  rows: SavedRow[]
}

/**
 * Saved by watching: the money back recorded in the period — a rebate on a thing (a negative extra cost, at its
 * own day's rate) — from a claim (a complaint) or a price match. Other money back is listed beside it, not counted.
 */
export function savedIn(items: readonly ShopItem[], ctx: MoneyCtx, p: Pick<Period, 'from' | 'to'>): SavedIn {
  const rows: SavedRow[] = []
  for (const i of spendRows(items)) {
    for (const c of ctx.costs.get(i.id) ?? []) {
      if (!(c.amount < 0) || (p.from && c.spent_on < p.from) || c.spent_on > p.to) continue
      rows.push({ costId: c.id, id: i.id, day: c.spent_on, label: c.label, kind: rebateKind(c.label), amount: nokAt(-c.amount, c.currency, c.fx_nok) })
    }
  }
  rows.sort((a, b) => b.day.localeCompare(a.day) || a.costId.localeCompare(b.costId))
  const sum = (k: RebateKind) => add(...rows.filter(r => r.kind === k).map(r => r.amount))
  const claims = sum('claim'), matches = sum('match')
  return { saved: add(claims, matches), claims, matches, other: sum('other'), rows }
}

export interface Between { spent: Amount; got: Amount; net: Amount; purchases: number; saved: Amount }

/** Money between two days (both in): spent (purchases + extra costs − refunds), got back, net, purchases, saved by watching. */
export function moneyBetween(items: readonly ShopItem[], ctx: MoneyCtx, from: string, to: string): Between {
  const events = moneyEvents(items, ctx, from.slice(0, 7), to.slice(0, 7)).filter(e => e.day >= from && e.day <= to)
  const spent = minus(add(...events.filter(e => e.kind === 'bought' || e.kind === 'cost').map(e => e.amount)), add(...events.filter(e => e.kind === 'refund').map(e => e.amount)))
  const got = add(...events.filter(e => e.kind === 'sold').map(e => e.amount))
  const purchases = events.filter(e => e.kind === 'bought').length
  return { spent, got, net: minus(spent, got), purchases, saved: savedIn(items, ctx, { from, to }).saved }
}

export interface YearVs {
  year: string
  last: string
  /** Both years are counted to this day of the year (MM-DD): today's for this year, 12-31 for a past one. */
  toDay: string
  /** This year, so far: last year is counted to the same day. */
  partial: boolean
  now: Between
  before: Between
}

/** The picked year against the one before (all time: this year against last), this year to the same day of both. */
export function yearVsLast(items: readonly ShopItem[], ctx: MoneyCtx, p: Period): YearVs {
  const year = p.year ?? p.today.slice(0, 4)
  const last = String(Number(year) - 1)
  const partial = `${year}-12-31` > p.today
  const toDay = partial ? p.today.slice(5) : '12-31'
  // 29 February in a year without one counts to the 28th.
  const end = (y: string) => (toDay === '02-29' && Number(y) % 4 !== 0 ? `${y}-02-28` : `${y}-${toDay}`)
  return { year, last, toDay, partial, now: moneyBetween(items, ctx, `${year}-01-01`, end(year)), before: moneyBetween(items, ctx, `${last}-01-01`, end(last)) }
}

export interface WaitRow { item: ShopItem; since: string; days: number }
export interface WaitIn {
  /** The things bought in the period that were wishes first, the longest wait first. */
  rows: WaitRow[]
  /** The middle wait in days (null without any). */
  median: number | null
  /** Bought within a day of being added: on the day or the next. */
  impulse: WaitRow[]
  buckets: { key: string; label: string; count: number; ids: string[] }[]
  /** Bought in the period but never a wish (added as owned). */
  notWished: number
}

export const IMPULSE_DAYS = 1
const WAIT_BUCKETS: readonly { key: string; label: string; max: number }[] = [
  { key: 'impulse', label: 'Within a day', max: IMPULSE_DAYS },
  { key: 'week', label: '2–7 days', max: 7 },
  { key: 'month', label: '8–30 days', max: 30 },
  { key: 'half', label: '1–6 months', max: 183 },
  { key: 'long', label: 'Over 6 months', max: Infinity },
]

/** Days from wish to purchase for what was bought in the period, and the impulse buys among them. */
export function wishToPurchase(items: readonly ShopItem[], p: Period): WaitIn {
  const byId = new Map(items.map(i => [i.id, i]))
  const rows: WaitRow[] = []
  let notWished = 0
  for (const i of boughtIn(items, p)) {
    const since = wishedSince(i, byId)
    if (!since) { notWished++; continue }
    rows.push({ item: i, since, days: Math.max(0, daysBetween(localDay(since), boughtOn(i) as string)) })
  }
  rows.sort((a, b) => b.days - a.days || a.item.title.localeCompare(b.item.title))
  const sorted = rows.map(r => r.days).sort((a, b) => a - b)
  const m = Math.floor(sorted.length / 2)
  const median = !sorted.length ? null : sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2)
  let low = -1
  const buckets = WAIT_BUCKETS.map(b => {
    const inside = rows.filter(r => r.days > low && r.days <= b.max)
    low = b.max
    return { key: b.key, label: b.label, count: inside.length, ids: inside.map(r => r.item.id) }
  })
  return { rows, median, impulse: rows.filter(r => r.days <= IMPULSE_DAYS), buckets, notWished }
}

export interface ValueKeptRow {
  key: string
  title: string
  /** Sold or traded in during the period: what they cost and what came back (complete amounts only). */
  sold: { count: number; paid: number; got: number; share: number | null; ids: string[] }
  /** Had at the period's end and still yours, with a "Could sell for" (today's estimate). */
  held: { count: number; paid: number; worth: number; share: number | null; ids: string[] }
}

/**
 * Value kept by category: of what left with money in the period (a sale or a trade-in), the share of the price
 * that came back — the kept % the new-vs-used costs use — and of what you had at its end that is still yours, the
 * share "Could sell for" keeps (today's estimate: it has no history). Gifts and amounts not complete are out.
 */
export function valueKeptByCategory(items: readonly ShopItem[], categories: readonly ShopCategory[], ctx: MoneyCtx, p: Period, level: CategoryLevel = 'top'): ValueKeptRow[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const out = new Map<string, ValueKeptRow>()
  const row = (i: ShopItem) => {
    const owner = i.accessory_of ? byId.get(i.accessory_of) ?? i : i
    const { key, title } = categoryBucket(owner.category_id, categories, level)
    const r = out.get(key) ?? { key, title, sold: { count: 0, paid: 0, got: 0, share: null, ids: [] }, held: { count: 0, paid: 0, worth: 0, share: null, ids: [] } }
    out.set(key, r)
    return r
  }
  for (const i of items) {
    if (!isPossession(i) || i.got_as_gift) continue
    const paid = paidOf(i)
    if (!complete(paid) || !(paid.nok > 0)) continue
    if ((i.disposal === 'sold' || i.disposal === 'traded_in') && wentIn(i, p)) {
      const got = gotOf(i)
      if (!got || !complete(got)) continue
      const r = row(i)
      r.sold.count++; r.sold.paid += paid.nok; r.sold.got += got.nok; r.sold.ids.push(i.id)
    } else if (isMine(i) && hadOn(i, p.to)) {
      const v = valueNowOf(i, ctx)
      if (!v || !complete(v)) continue
      const r = row(i)
      r.held.count++; r.held.paid += paid.nok; r.held.worth += v.nok; r.held.ids.push(i.id)
    }
  }
  for (const r of out.values()) {
    r.sold.share = r.sold.paid > 0 ? r.sold.got / r.sold.paid : null
    r.held.share = r.held.paid > 0 ? r.held.worth / r.held.paid : null
  }
  return [...out.values()].sort((a, b) => (b.sold.paid + b.held.paid) - (a.sold.paid + a.held.paid) || a.title.localeCompare(b.title))
}

export interface StoreScore {
  key: string
  /** Purchases there in the period (a returned one included: it is part of the store's record). */
  bought: number
  returned: number
  /** Claims and price matches recorded on those things (any day), and the money they brought back. */
  claims: number
  matches: number
  back: Amount
  /** Of those things that left with money: how many, and the share of the price that came back. */
  kept: number
  keptShare: number | null
}

/** A store scorecard: what was bought there in the period and what came of it — returns, claims, price matches, value kept. */
export function storeScores(items: readonly ShopItem[], ctx: MoneyCtx, p: Period): Map<string, StoreScore> {
  const out = new Map<string, StoreScore & { paid: number; got: number }>()
  for (const i of spendRows(items)) {
    const b = boughtOn(i)
    const name = (i.platform ?? '').trim()
    if (!b || !name || (p.from && b < p.from) || b > p.to) continue
    const key = fold(name)
    const s = out.get(key) ?? { key, bought: 0, returned: 0, claims: 0, matches: 0, back: ZERO, kept: 0, keptShare: null, paid: 0, got: 0 }
    s.bought++
    if (i.disposal === 'returned') s.returned++
    for (const c of ctx.costs.get(i.id) ?? []) {
      const kind = c.amount < 0 ? rebateKind(c.label) : 'other'
      if (kind === 'other') continue
      if (kind === 'claim') s.claims++; else s.matches++
      s.back = add(s.back, nokAt(-c.amount, c.currency, c.fx_nok))
    }
    if ((i.disposal === 'sold' || i.disposal === 'traded_in') && !i.got_as_gift) {
      const paid = paidOf(i), got = gotOf(i)
      if (got && complete(paid) && complete(got) && paid.nok > 0) { s.kept++; s.paid += paid.nok; s.got += got.nok }
    }
    out.set(key, s)
  }
  return new Map([...out].map(([k, { paid, got, ...s }]) => [k, { ...s, keptShare: paid > 0 ? got / paid : null }]))
}
