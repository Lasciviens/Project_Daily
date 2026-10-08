// What you own (migration 137): which rows are your things, what they cost in
// NOK at the rate of their own days, how long you have had them, what they
// cost you per month of use, what is coming up (return windows, complaint
// rights), accessories that ride with their item and a sale split across the
// things sold together. Pure — scripts/verify-shop-owned.cjs runs it.
//
// Money is never silently 0: every sum is an `Amount` — the known part plus
// how many amounts are missing or wait for their rate — so a screen says
// "Unknown · 1 price missing" instead of a number that looks complete.

import type { ShopCategory, ShopCurrency, ShopDisposal, ShopItem, ShopItemCost } from './types'
import { categoryPath, fold, listOf, localDay } from './shopModel'
import { nokPerUnit, type UsdRates } from './fx'

// ── What a row is ────────────────────────────────────────────────────────────

export const isGeneral = (i: Pick<ShopItem, 'kind'>): boolean => i.kind === 'general'
export const isModel = (i: Pick<ShopItem, 'option_for'>): boolean => !!i.option_for
export const isAccessory = (i: Pick<ShopItem, 'accessory_of'>): boolean => !!i.accessory_of

/**
 * A thing you have or had: a bought row on the wishlist side that you kept —
 * never a quick-list errand (groceries are used up), a general wish, or
 * something bought for someone else.
 */
export function isPossession(i: ShopItem): boolean {
  return listOf(i) === 'wishlist' && i.kind !== 'general' && i.status === 'bought' && i.kept !== false
}
/** Still yours. */
export const isMine = (i: ShopItem): boolean => isPossession(i) && !i.disposal
/** Sold, given away, broke, lost… — a returned thing never was yours, so it is not "gone". */
export const isGone = (i: ShopItem): boolean => isPossession(i) && !!i.disposal && i.disposal !== 'returned'
export const isReturned = (i: ShopItem): boolean => isPossession(i) && i.disposal === 'returned'

export type OwnState = 'to_buy' | 'mine' | 'gone' | 'returned' | 'not_kept' | 'dropped' | 'fulfilled'

export function ownState(i: ShopItem): OwnState {
  if (i.status === 'fulfilled') return 'fulfilled'
  if (i.status === 'dropped') return 'dropped'
  if (i.status !== 'bought') return 'to_buy'
  if (i.kept === false) return 'not_kept'
  if (i.disposal === 'returned') return 'returned'
  return i.disposal ? 'gone' : 'mine'
}

export const DISPOSAL_LABEL: Record<ShopDisposal, string> = {
  sold: 'Sold', traded_in: 'Traded in', returned: 'Returned', given: 'Given away', broken: 'Broke', lost: 'Lost', other: 'Gone',
}
/** Ways of parting with a thing that bring money back (a missing amount is then unknown, not 0). */
export const PAID_BACK: readonly ShopDisposal[] = ['sold', 'traded_in', 'returned']

// ── Days ─────────────────────────────────────────────────────────────────────

/** The local day it was bought (before migration 134 the last edit is all there is). */
export function boughtOn(i: Pick<ShopItem, 'status' | 'bought_at' | 'updated_at'>): string | null {
  if (i.status !== 'bought') return null
  const at = i.bought_at ?? i.updated_at
  return at ? localDay(at) : null
}

const DAY_MS = 86_400_000
function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS
}

/** Whole days from a to b (yyyy-mm-dd, calendar days, no time zone). */
export function daysBetween(a: string, b: string): number {
  return Math.round(dayNumber(b) - dayNumber(a))
}

/** Months from a to b, counted as calendar months plus the part-month in days. */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  let months = (yb - ya) * 12 + (mb - ma)
  let rest = db - da
  if (rest < 0) { months -= 1; rest += 30.4375 }
  return Math.max(0, months + rest / 30.4375)
}

/** "1 year 2 months", "3 months", "12 days", "today" — never "1 y 2 m". */
export function durationLabel(from: string, to: string): string {
  const days = daysBetween(from, to)
  if (days <= 0) return 'today'
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`
  const total = Math.floor(monthsBetween(from, to) + 1e-9)
  const years = Math.floor(total / 12)
  const months = total % 12
  const y = years ? `${years} year${years === 1 ? '' : 's'}` : ''
  const m = months ? `${months} month${months === 1 ? '' : 's'}` : ''
  return [y, m].filter(Boolean).join(' ') || '1 month'
}

/** A day in N months or years (complaint rights), clamped to the month's last day. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${first.getUTCFullYear()}-${p(first.getUTCMonth() + 1)}-${p(Math.min(d, last))}`
}

export function addDays(day: string, days: number): string {
  const t = new Date((dayNumber(day) + days) * DAY_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}

// ── Amounts ──────────────────────────────────────────────────────────────────

/**
 * A NOK sum: the known part, how many amounts are missing (never written
 * down) and how many wait for their day's rate. Only a complete sum (both 0)
 * is a number; anything else reads "Unknown" with the reason.
 */
export interface Amount { nok: number; missing: number; pending: number }

export const ZERO: Amount = { nok: 0, missing: 0, pending: 0 }
export const MISSING: Amount = { nok: 0, missing: 1, pending: 0 }
export const PENDING: Amount = { nok: 0, missing: 0, pending: 1 }

export function add(...xs: (Amount | null | undefined)[]): Amount {
  let nok = 0, missing = 0, pending = 0
  for (const x of xs) {
    if (!x) continue
    nok += x.nok; missing += x.missing; pending += x.pending
  }
  return { nok, missing, pending }
}
export function minus(a: Amount, b: Amount): Amount {
  return { nok: a.nok - b.nok, missing: a.missing + b.missing, pending: a.pending + b.pending }
}
export function scale(a: Amount, k: number): Amount {
  return { nok: a.nok * k, missing: a.missing, pending: a.pending }
}
export const complete = (a: Amount): boolean => a.missing === 0 && a.pending === 0
export const known = (nok: number): Amount => ({ nok, missing: 0, pending: 0 })

/**
 * A purchase, sale or cost in NOK at the rate frozen on its row: NOK is
 * itself, another currency needs its day's rate (pending until the database
 * has it — never today's rate), no amount is missing.
 */
export function nokAt(amount: number | null | undefined, currency: ShopCurrency | string | null | undefined, frozenRate: number | null | undefined): Amount {
  if (amount == null || !Number.isFinite(amount)) return MISSING
  if ((currency ?? 'NOK').toUpperCase() === 'NOK') return known(amount)
  return frozenRate != null && Number.isFinite(frozenRate) && frozenRate > 0 ? known(amount * frozenRate) : PENDING
}

/** What something is worth NOW in NOK, at today's rate (pending while today's rates are not loaded). */
export function nokNow(amount: number | null | undefined, currency: ShopCurrency | string | null | undefined, rates: UsdRates | null): Amount {
  if (amount == null || !Number.isFinite(amount)) return MISSING
  const r = nokPerUnit((currency ?? 'NOK').toUpperCase(), rates)
  return r == null ? PENDING : known(amount * r)
}

/**
 * What money sums need besides the rows: extra costs by item, and today's
 * rates for the values of now ("Could sell for", prices to buy).
 */
export interface MoneyCtx {
  costs: ReadonlyMap<string, readonly ShopItemCost[]>
  rates: UsdRates | null
}

export function moneyCtx(costs: readonly ShopItemCost[], rates: UsdRates | null): MoneyCtx {
  const map = new Map<string, ShopItemCost[]>()
  for (const c of costs) map.set(c.item_id, [...(map.get(c.item_id) ?? []), c])
  for (const list of map.values()) list.sort((a, b) => a.spent_on.localeCompare(b.spent_on) || a.created_at.localeCompare(b.created_at))
  return { costs: map, rates }
}
export const NO_MONEY: MoneyCtx = { costs: new Map(), rates: null }

const priceCurrency = (i: Pick<ShopItem, 'currency' | 'region'>): ShopCurrency => i.currency ?? (i.region === 'TR' ? 'TRY' : 'NOK')

/** What was paid for it, at the rate of the day it was bought. A gift is a real 0; no price is missing. */
export function paidOf(i: ShopItem): Amount {
  if (i.got_as_gift && (i.price == null || i.price === 0)) return ZERO
  return nokAt(i.price, priceCurrency(i), i.fx_nok)
}

/** Repairs, shipping, fees (a rebate takes off) — each at its own day's rate. */
export function extrasOf(i: Pick<ShopItem, 'id'>, ctx: MoneyCtx): Amount {
  return add(...(ctx.costs.get(i.id) ?? []).map(c => nokAt(c.amount, c.currency, c.fx_nok)))
}

/** Paid plus extras. */
export const costOf = (i: ShopItem, ctx: MoneyCtx): Amount => add(paidOf(i), extrasOf(i, ctx))

/**
 * Money got back when it left: the sale, trade-in or refund at that day's
 * rate. Given away / broke / lost bring 0 unless an amount was written down;
 * null while it is still yours.
 */
export function gotOf(i: ShopItem): Amount | null {
  if (!i.disposal) return null
  if (i.sale_price == null) return PAID_BACK.includes(i.disposal) ? MISSING : ZERO
  return nokAt(i.sale_price, i.sale_currency ?? priceCurrency(i), i.sale_fx_nok)
}

/** "Could sell for" in NOK at today's rate (it is today's estimate), or null when not set. */
export function valueNowOf(i: ShopItem, ctx: MoneyCtx): Amount | null {
  if (i.value_now == null || !isMine(i)) return null
  return nokNow(i.value_now, i.value_currency ?? 'NOK', ctx.rates)
}

/**
 * What it saved against the market price when it was bought (staff price, a
 * sale), or null. Only in the price's own currency (or NOK), where the day's
 * rate is known.
 */
export function savedOf(i: ShopItem): Amount | null {
  if (i.market_price == null || i.price == null || i.status !== 'bought') return null
  const mc = i.market_currency ?? priceCurrency(i)
  const market = mc === priceCurrency(i) ? nokAt(i.market_price, mc, i.fx_nok) : mc === 'NOK' ? known(i.market_price) : null
  if (!market) return null
  const s = minus(market, paidOf(i))
  return !complete(s) || s.nok <= 0 ? null : s
}

// ── An item and its accessories ──────────────────────────────────────────────

/** Possession accessories under each item id (a wished accessory is not on it yet). */
export function accessoriesByItem(items: readonly ShopItem[]): Map<string, ShopItem[]> {
  const out = new Map<string, ShopItem[]>()
  for (const i of items) {
    if (!i.accessory_of || !isPossession(i)) continue
    const list = out.get(i.accessory_of) ?? []
    list.push(i)
    out.set(i.accessory_of, list)
  }
  for (const list of out.values()) list.sort((a, b) => (boughtOn(a) ?? '').localeCompare(boughtOn(b) ?? '') || a.title.localeCompare(b.title))
  return out
}

/** An item with the accessories still on it — what "with its accessories" means for money. */
export interface Thing { item: ShopItem; accessories: ShopItem[] }

/** The thing's own cost and its accessories', and the two together. */
export function thingCost(t: Thing, ctx: MoneyCtx): { own: Amount; accessories: Amount; total: Amount } {
  const own = costOf(t.item, ctx)
  const accessories = add(...t.accessories.map(a => costOf(a, ctx)))
  return { own, accessories, total: add(own, accessories) }
}

// ── Per month ────────────────────────────────────────────────────────────────

export interface PerMonth {
  /** NOK per month of use. */
  nok: number
  months: number
  /** The cost of use behind it: paid (+ extras) − got back / could sell for. */
  used: Amount
}

/**
 * Cost of use per month. Gone: (cost − got back) ÷ months kept, with the
 * accessories sold in the same sale (their share of the money came back with
 * it). Still yours: (cost − could sell for) ÷ months so far — the item alone,
 * and only once "Could sell for" is set (without it there is no honest
 * number). Less than a month, or a sum with a missing amount: null.
 */
export function perMonth(i: ShopItem, ctx: MoneyCtx, today: string, accessories: readonly ShopItem[] = []): PerMonth | null {
  const from = boughtOn(i)
  if (!from) return null
  let cost: Amount
  let back: Amount | null
  let to: string
  if (isGone(i)) {
    const together = i.sale_group ? accessories.filter(a => a.sale_group === i.sale_group) : []
    cost = add(costOf(i, ctx), ...together.map(a => costOf(a, ctx)))
    back = add(gotOf(i), ...together.map(a => gotOf(a)))
    to = i.disposed_on ?? today
  } else if (isMine(i)) {
    cost = costOf(i, ctx)
    back = valueNowOf(i, ctx)
    to = today
  } else return null
  if (!back) return null
  const used = minus(cost, back)
  const months = monthsBetween(from, to)
  if (months < 1 || !complete(used)) return null
  return { nok: used.nok / months, months, used }
}

// ── The sale ─────────────────────────────────────────────────────────────────

/**
 * One amount split across the things sold together, by what each cost (in
 * NOK); without known costs, evenly. Shares are rounded to whole units and the
 * first row (the item itself) takes the rounding, so they add up exactly.
 */
export function splitSale(total: number, rows: readonly { id: string; weight: number | null }[]): Map<string, number> {
  const out = new Map<string, number>()
  if (!rows.length) return out
  const known = rows.every(r => r.weight != null && r.weight > 0)
  const weights = rows.map(r => (known ? (r.weight as number) : 1))
  const sum = weights.reduce((s, w) => s + w, 0)
  let given = 0
  rows.forEach((r, k) => {
    if (k === 0) return
    const share = Math.round((total * weights[k]) / sum)
    out.set(r.id, share)
    given += share
  })
  out.set(rows[0].id, Math.round((total - given) * 100) / 100)
  return out
}

/** The sale's whole amount from rows sold together (each holds its share). */
export function saleTotal(rows: readonly ShopItem[]): number | null {
  let sum = 0
  for (const r of rows) {
    if (r.sale_price == null) return null
    sum += r.sale_price
  }
  return sum
}

// ── Deadlines ────────────────────────────────────────────────────────────────

export type DeadlineKind = 'return' | 'complain'
export interface Deadline { item: ShopItem; kind: DeadlineKind; day: string; daysLeft: number }

/**
 * Return windows ending in the next 14 days and complaint rights ending in the
 * next 60, soonest first — for things you still have.
 */
export function comingUp(items: readonly ShopItem[], today: string): Deadline[] {
  const out: Deadline[] = []
  for (const i of items) {
    if (!isMine(i)) continue
    if (i.return_by) {
      const left = daysBetween(today, i.return_by)
      if (left >= 0 && left <= 14) out.push({ item: i, kind: 'return', day: i.return_by, daysLeft: left })
    }
    if (i.warranty_until) {
      const left = daysBetween(today, i.warranty_until)
      if (left >= 0 && left <= 60) out.push({ item: i, kind: 'complain', day: i.warranty_until, daysLeft: left })
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.item.title.localeCompare(b.item.title))
}

/**
 * Norway's complaint right (reklamasjon): 2 years, 5 for things meant to last
 * considerably longer — phones, computers, TVs, consoles. The suggestion only;
 * the owner can change it.
 */
export function complaintYears(categoryNames: readonly string[], region: ShopItem['region']): 2 | 5 {
  if (region === 'TR') return 2
  const text = fold(categoryNames.join(' '))
  return /electronic|phone|computer|laptop|console|tv|audio|camera|tablet|appliance|watch|elektronikk|mobil/.test(text) ? 5 : 2
}

// ── The Owned view ───────────────────────────────────────────────────────────

export type OwnedShow = 'mine' | 'gone' | 'all'
export interface OwnedFilters { q: string; category: string; show: OwnedShow; resaleOnly: boolean }
export const NO_OWNED_FILTERS: OwnedFilters = { q: '', category: 'all', show: 'mine', resaleOnly: false }

/** Things to show as cards: never an accessory on its own (it rides inside its item's card). */
export function ownedCards(items: readonly ShopItem[], categories: readonly ShopCategory[], f: OwnedFilters): ShopItem[] {
  const words = fold(f.q).split(/\s+/).filter(Boolean)
  const byId = new Map(items.map(i => [i.id, i]))
  return items.filter(i => {
    if (!isPossession(i) || i.disposal === 'returned') return false
    if (i.accessory_of && byId.get(i.accessory_of) && isPossession(byId.get(i.accessory_of) as ShopItem)) return false
    if (f.show === 'mine' && i.disposal) return false
    if (f.show === 'gone' && !i.disposal) return false
    if (f.resaleOnly && !i.for_resale) return false
    const path = categoryPath(i.category_id, categories)
    if (f.category === 'none' ? path.topId !== null : f.category !== 'all' && path.topId !== f.category) return false
    if (!words.length) return true
    const hay = fold([i.title, i.notes ?? '', i.platform ?? '', i.sold_to ?? '', i.serial ?? '', path.topName, path.subName ?? ''].join(' '))
    return words.every(w => hay.includes(w))
  })
}

export type OwnedSort = 'recent' | 'price' | 'month' | 'title' | 'kept'
export const OWNED_SORT_LABEL: Record<OwnedSort, string> = {
  recent: 'Newest first', price: 'Paid: most first', month: 'Per month: most first', title: 'A–Z', kept: 'Kept longest',
}

export function sortOwned(list: readonly ShopItem[], sort: OwnedSort, ctx: MoneyCtx, today: string, acc: Map<string, ShopItem[]>): ShopItem[] {
  const day = (i: ShopItem) => boughtOn(i) ?? ''
  const out = [...list]
  switch (sort) {
    case 'recent': return out.sort((a, b) => day(b).localeCompare(day(a)) || a.title.localeCompare(b.title))
    case 'title': return out.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))
    case 'price': return out.sort((a, b) => costOf(b, ctx).nok - costOf(a, ctx).nok || day(b).localeCompare(day(a)))
    case 'kept': {
      const kept = (i: ShopItem) => (day(i) ? daysBetween(day(i), i.disposed_on ?? today) : -1)
      return out.sort((a, b) => kept(b) - kept(a))
    }
    case 'month': {
      const pm = (i: ShopItem) => perMonth(i, ctx, today, acc.get(i.id) ?? [])?.nok ?? -Infinity
      return out.sort((a, b) => pm(b) - pm(a) || day(b).localeCompare(day(a)))
    }
  }
}

export interface OwnedSummary {
  mine: number
  accessories: number
  gone: number
  paid: Amount
  /** Could-sell-for of the things that have one. */
  worth: Amount
  valued: number
}

/** The rail's "What I own": things still yours (accessories counted apart), what they cost and are worth. */
export function ownedSummary(items: readonly ShopItem[], ctx: MoneyCtx): OwnedSummary {
  let mine = 0, accessories = 0, gone = 0, valued = 0
  const paid: Amount[] = []
  const worth: Amount[] = []
  for (const i of items) {
    if (!isPossession(i) || i.disposal === 'returned') continue
    if (i.disposal) { if (!i.accessory_of) gone++; continue }
    if (i.accessory_of) accessories++
    else mine++
    paid.push(costOf(i, ctx))
    const v = valueNowOf(i, ctx)
    if (v) { worth.push(v); valued++ }
  }
  return { mine, accessories, gone, paid: add(...paid), worth: add(...worth), valued }
}

/** How old "Could sell for" is, in days (shown beside it; warn after ~6 months). */
export function valueAgeDays(i: Pick<ShopItem, 'value_on'>, today: string): number | null {
  return i.value_on ? daysBetween(i.value_on, today) : null
}
export const VALUE_STALE_DAYS = 183

/**
 * True when a purchase, a sale or an extra cost waits for its day's NOK rate
 * (migration 137 applied — the column is on the row — and not in NOK). The
 * page then asks the shop-price function to fetch them once.
 */
export function ratesPending(items: readonly ShopItem[], costs: readonly ShopItemCost[]): boolean {
  const foreign = (c: string | null | undefined) => !!c && c.toUpperCase() !== 'NOK'
  return items.some(i => ('fx_nok' in i && i.status === 'bought' && i.price != null && foreign(i.currency) && i.fx_nok == null)
    || ('sale_fx_nok' in i && i.sale_price != null && foreign(i.sale_currency) && i.sale_fx_nok == null))
    || costs.some(c => foreign(c.currency) && c.fx_nok == null)
}
