// Owned's compact rows (step A, plan approved 10.11.2026): one row per thing —
// its picture, its name and what it cost on the first line; its facts (store,
// how long it has been yours, what it could sell for) and at most one tone
// tag on the second. Wide lists deal their categories into column stacks of
// rows (`rowStacks`), never wider than a content row may be (THEME W2).
// Pure — scripts/verify-shop-record.cjs.
import type { Tone } from '../../shared/ui/Tone'
import { formatDate } from '../../shared/utils/dateFormat'
import { formatMoney } from '../settings/subscriptionRules'
import {
  add, boughtOn, complete, costOf, daysBetween, DISPOSAL_LABEL, gotOf, minus, monthsBetween, valueAgeDays, valueNowOf, VALUE_STALE_DAYS,
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

export interface RowTag { text: string; tone: Tone }
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
  if (i.disposal) return { text: DISPOSAL_LABEL[i.disposal], tone: 'neutral' }
  if (i.return_by && i.return_by >= today) {
    const left = daysBetween(today, i.return_by)
    const now = watch?.status === 'ok' ? cleanPrice(i, watch) : null
    if (now && i.price != null && now.currency === currencyOf(i) && now.amount < i.price) {
      return { text: `${money(i.price - now.amount, now.currency)} cheaper`, tone: deadlineTone(left, 'warn') }
    }
    return { text: returnWords(left, i.return_by), tone: deadlineTone(left, left <= RETURN_COUNT_DAYS ? 'info' : 'neutral') }
  }
  const selling = listing && listing.item_id === i.id ? listingTag(listing, today) : null
  if (selling) return selling
  if (i.warranty_until && i.warranty_until >= today) {
    const left = daysBetween(today, i.warranty_until)
    if (left <= COMPLAINT_TAG_DAYS) return { text: `Complaint until ${formatDate(i.warranty_until)}`, tone: deadlineTone(left, 'info') }
  }
  const age = valueAgeDays(i, today)
  if (i.value_now != null && age != null && age > VALUE_STALE_DAYS) return { text: 'Old estimate', tone: 'info' }
  return null
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
 * What the price column says: what it cost, in NOK at its day's rate
 * ("13 990"); a price still waiting for its rate in its own currency ("4 500
 * TRY", `pending`); "Gift"; "—" with no price.
 */
export function rowPrice(i: ShopItem, ctx: MoneyCtx): { text: string; pending: boolean } {
  if (i.got_as_gift && !i.price) return { text: 'Gift', pending: false }
  if (i.price == null) return { text: '—', pending: false }
  const paid = costOf(i, ctx)
  if (complete(paid)) return { text: num(paid.nok), pending: false }
  return { text: money(i.price, currencyOf(i)), pending: true }
}

/** The narrowest a column of rows gets (a name and a price on one line at 16px) and the gap between columns. */
export const ROW_MIN_REM = 21
export const ROW_GAP_REM = 1.5
/** A content row is never wider than this (THEME W2). */
export const ROW_MAX_REM = 40

/**
 * How many column stacks of rows a list `widthRem` wide holds: as many
 * 21rem columns as fit — one on a phone, two at 1469 (48rem) and on a phone
 * turned sideways, three at 1920, four at 2450. Before it is measured: one.
 */
export function rowStacks(widthRem: number | null): number {
  if (widthRem == null || widthRem <= 0) return 1
  return Math.max(1, Math.floor((widthRem + ROW_GAP_REM) / (ROW_MIN_REM + ROW_GAP_REM)))
}
