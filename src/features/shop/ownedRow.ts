// Owned's compact rows (step A, plan approved 10.11.2026): one row per thing —
// its picture, its name and what was paid on the first line; its facts (store,
// how long it has been yours, what it could sell for) and at most one tone
// tag on the second. Wide lists deal their categories into column stacks of
// rows (`rowStacks`), never wider than a content row may be (THEME W2).
// Pure — scripts/verify-shop-record.cjs.
import type { Tone } from '../../shared/ui/Tone'
import { formatDate } from '../../shared/utils/dateFormat'
import { formatMoney } from '../settings/subscriptionRules'
import {
  add, boughtOn, complete, costOf, daysBetween, gotOf, minus, monthsBetween, paidOf, valueAgeDays, valueNowOf, VALUE_STALE_DAYS,
  type MoneyCtx,
} from './ownModel'
import { currencyOf } from './shopModel'
import { cleanPrice } from './wishTile'
import { listingTag } from './sellingModel'
import type { ShopListing } from './resaleTypes'
import type { ShopItem, ShopPriceWatch } from './types'

/** A return window is counted down in days from two weeks ahead (as Needs a look lists it). */
export const RETURN_COUNT_DAYS = 14
/** A complaint right ending shows from 60 days ahead (Needs a look's `COMPLAINT_SOON_DAYS`). */
export const COMPLAINT_TAG_DAYS = 60

/**
 * Which fact a tag tells: money to claim, a return counted in days or by its date, an open listing, the complaint right
 * ending, an old estimate. `day` is the date a `return_by` or `complaint` tag counts to.
 */
export type RowTagKind = 'cheaper' | 'return_soon' | 'return_by' | 'listing' | 'complaint' | 'estimate'
export interface RowTag { kind: RowTagKind; text: string; tone: Tone; day?: string }
/** One fact of a row's second line; `tone` colours a result (a profit is green on every screen). */
export interface RowFact { text: string; tone?: 'success' }

const money = (n: number, currency = 'NOK') => formatMoney(Math.round(n), currency)
/** "4 490": whole units, a no-break space between thousands, a true minus. */
export const num = (n: number): string => {
  const r = Math.round(n)
  return `${r < 0 ? '−' : ''}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

/** A deadline's tone: danger today or tomorrow, warn within three days, else `later`. */
function deadlineTone(daysLeft: number, later: Tone): Tone {
  return daysLeft <= 1 ? 'danger' : daysLeft <= 3 ? 'warn' : later
}

/** "Return today", "Return tomorrow", "Return in 5 days", or past two weeks "Return by 15.01.2027". */
export function returnWords(daysLeft: number, day: string): string {
  if (daysLeft <= 0) return 'Return today'
  if (daysLeft === 1) return 'Return tomorrow'
  return daysLeft <= RETURN_COUNT_DAYS ? `Return in ${daysLeft} days` : `Return by ${formatDate(day)}`
}

/**
 * The one tag a row wears, the first that holds: how it left (a thing gone,
 * neutral); cheaper now than you paid while it can still go back (money to
 * claim — only from a clean price read at the last check, as Needs a look);
 * the return window (counted down from two weeks); its open listing ("For
 * sale · 12 days", "Listed" — step C); the complaint right ending (within 60
 * days); an estimate over six months old. Facts only: a snoozed Needs-a-look
 * row still has its deadline, so the tag stays.
 */
export function rowTag(i: ShopItem, watch: ShopPriceWatch | null | undefined, today: string, listing?: ShopListing | null): RowTag | null {
  // A thing that left says how on its picture (a banner or a corner badge), never as a tag.
  if (i.disposal) return null
  if (i.return_by && i.return_by >= today) {
    const left = daysBetween(today, i.return_by)
    const now = watch?.status === 'ok' ? cleanPrice(i, watch) : null
    if (now && i.price != null && now.currency === currencyOf(i) && now.amount < i.price) {
      return { kind: 'cheaper', text: `${money(i.price - now.amount, now.currency)} cheaper`, tone: deadlineTone(left, 'warn') }
    }
    const tone = deadlineTone(left, left <= RETURN_COUNT_DAYS ? 'info' : 'neutral')
    return left > RETURN_COUNT_DAYS
      ? { kind: 'return_by', day: i.return_by, text: returnWords(left, i.return_by), tone }
      : { kind: 'return_soon', text: returnWords(left, i.return_by), tone }
  }
  const selling = listing && listing.item_id === i.id ? listingTag(listing, today) : null
  if (selling) return { kind: 'listing', ...selling }
  if (i.warranty_until && i.warranty_until >= today) {
    const left = daysBetween(today, i.warranty_until)
    if (left <= COMPLAINT_TAG_DAYS) return { kind: 'complaint', day: i.warranty_until, text: `Complaint until ${formatDate(i.warranty_until)}`, tone: deadlineTone(left, 'info') }
  }
  const age = valueAgeDays(i, today)
  if (i.value_now != null && age != null && age > VALUE_STALE_DAYS) return { kind: 'estimate', text: 'Old estimate', tone: 'info' }
  return null
}

/** A tag as a big-picture card shows it: a date tag as an icon and its date (the whole words in its title and accessible name). */
export interface CardTag extends RowTag { icon?: 'return' | 'complaint'; short?: string }

/**
 * The row's tag for a 12rem card, where "Return by 03.01.2027" and "Complaint until 24.12.2026" are cut (owner, 24.11.2026):
 * a return window counted by its date shows the return icon and "03.01.2027", the complaint right the shield and its date —
 * the date whole (every visible date is DD.MM.YYYY). Every other tag is short already and stays as it is.
 */
export function cardTag(i: ShopItem, watch: ShopPriceWatch | null | undefined, today: string, listing?: ShopListing | null): CardTag | null {
  const tag = rowTag(i, watch, today, listing)
  if (!tag) return null
  if (tag.kind === 'return_by' && tag.day) return { ...tag, icon: 'return', short: formatDate(tag.day) }
  if (tag.kind === 'complaint' && tag.day) return { ...tag, icon: 'complaint', short: formatDate(tag.day) }
  return tag
}

/** How long, in a row's few letters: "12 days", "18 months", "3 years", "2½ years". */
export function heldWords(from: string, to: string): string {
  const days = daysBetween(from, to)
  if (days <= 0) return 'today'
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`
  const months = Math.max(1, Math.floor(monthsBetween(from, to) + 1e-9))
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`
  return `${Math.floor(months / 12)}${months % 12 >= 6 ? '½' : ''} years`
}

/**
 * A row's facts (its category is the label above it, so never repeated):
 * still yours — the store, how long it has been yours, "sells ≈ 7 500" (your
 * own estimate, never invented), bought to sell, its money chain; gone — what
 * it made (green) or cost you first, then what came back with the accessories
 * sold with it, to whom and after how long (how it left is its tag).
 */
export function rowFacts(i: ShopItem, accessories: readonly ShopItem[], ctx: MoneyCtx, today: string, chain: string | null): RowFact[] {
  const out: RowFact[] = []
  const from = boughtOn(i)
  const push = (text: string | null | false | undefined, tone?: 'success') => { if (text) out.push(tone ? { text, tone } : { text }) }
  if (i.disposal) {
    // The result first (a phone cuts the end of the line); how it left is the row's tag, the day in its Story.
    const together = i.sale_group ? accessories.filter(a => a.sale_group === i.sale_group) : []
    const got = add(gotOf(i), ...together.map(a => gotOf(a)))
    const result = minus(add(costOf(i, ctx), ...together.map(a => costOf(a, ctx))), got)
    if (complete(result) && i.disposed_on) {
      const n = Math.round(result.nok)
      if (n < 0) push(`made ${num(-n)}`, 'success')
      else push(`cost you ${num(n)}`)
    }
    if (i.sale_price != null && complete(got)) push(`got ${num(got.nok)}`)
    push(i.sold_to && `to ${i.sold_to}`)
    push(from && i.disposed_on && `after ${heldWords(from, i.disposed_on)}`)
  } else {
    push(i.platform)
    push(from && heldWords(from, today))
    const value = valueNowOf(i, ctx)
    if (value && complete(value)) push(`sells ≈ ${num(value.nok)}`)
    push(i.for_resale && 'to sell')
  }
  push(chain)
  return out
}

/**
 * What the price column says: what was paid, in NOK at its day's rate
 * ("13 990" — the record's "Paid"; extra costs are its Costs, never added
 * here); a price still waiting for its rate in its own currency ("4 500
 * TRY", `pending`); "Gift"; "—" with no price.
 */
export function rowPrice(i: ShopItem): { text: string; pending: boolean } {
  if (i.got_as_gift && !i.price) return { text: 'Gift', pending: false }
  if (i.price == null) return { text: '—', pending: false }
  const paid = paidOf(i)
  if (complete(paid)) return { text: num(paid.nok), pending: false }
  return { text: money(i.price, currencyOf(i)), pending: true }
}

/** The narrowest a column of rows gets (a name and a price on one line at 16px) and the gap between columns. */
export const ROW_MIN_REM = 21
export const ROW_GAP_REM = 1.5

/**
 * How many column stacks of rows a list `widthRem` wide holds: as many
 * 21rem columns as fit — one on a phone, two at 1469 (48rem) and on a phone
 * turned sideways, three at 1920, four at 2450. Before it is measured: one.
 */
export function rowStacks(widthRem: number | null): number {
  if (widthRem == null || widthRem <= 0) return 1
  return Math.max(1, Math.floor((widthRem + ROW_GAP_REM) / (ROW_MIN_REM + ROW_GAP_REM)))
}

/** How many columns a category's subcategories are dealt into: as many as there are room for, never more than there are subcategories. */
export const subColumns = (subs: number, stacks: number): number => Math.max(1, Math.min(stacks, subs))


// ── The filter bar's one row ─────────────────────────────────────────────────
// The bar above Owned's things is ONE line wherever it can be (owner, 23.11.2026): it measures its own width and
// folds what does not fit behind Filters, as `fitActions` does for the record's buttons. Widths in rem.

/** What each control of the bar takes (search at its smallest, the selects at their cap) and the gap between them. */
export const FILTER_ROW = { search: 12, seg: 11.5, sort: 10.5, tools: 9.5, filters: 7.5, select: 12, check: 2.75, clear: 5, gap: 0.5, roomy: 38 } as const

/**
 * `full`: every control in one line. `line`: one line with the category, money chain and Bought to sell (an icon) behind
 * Filters. `roomy`: two rows (search, Mine · Gone · All and the icons; then Sort and Filters) — a phone turned
 * sideways. `narrow`: three rows (a phone). Unmeasured: `full`.
 */
export type FilterRowMode = 'full' | 'line' | 'roomy' | 'narrow'

export function filterRowMode(widthRem: number | null, o: { chains: boolean; clear: boolean }): FilterRowMode {
  if (widthRem == null || !(widthRem > 0)) return 'full'
  const F = FILTER_ROW
  const base = F.search + F.seg + F.sort + F.tools + 3 * F.gap
  const extras = F.select + (o.chains ? F.select : 0) + F.check + (o.clear ? F.clear : 0) + (o.chains ? 4 : 3) * F.gap
  if (widthRem >= base + extras + (o.clear ? F.gap : 0)) return 'full'
  if (widthRem >= base + F.filters + (o.clear ? F.clear + F.gap : 0) + F.gap) return 'line'
  return widthRem >= F.roomy ? 'roomy' : 'narrow'
}
