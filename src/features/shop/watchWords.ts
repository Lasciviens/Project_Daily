// What the price watch says on screen, in one vocabulary (owner, 10.11.2026: plain words, "apps", the true result):
// the note under a pasted link, what a price covers, why a watch has no price now (the card's line, the record's
// strip) and when the morning check tries a link again. shop-price writes the site's own answer ("finn.no doesn't
// let apps read its pages", "elkjop.no blocks apps with a browser check"); these add what to do about it.
// Pure — verify-shop-price-read runs it.
import { formatDate, formatTime } from '../../shared/utils/dateFormat'
import { osloDay } from './groceryModel'
import { addDays } from './ownModel'
import type { PriceCheckOutcome, PriceReadResult } from './api/shopPriceApi'
import type { ShopItem, ShopPricePoint, ShopPriceWatch } from './types'

/**
 * The note under a pasted link (the add sheet's and Add a model's): what was read and when, or why there is no
 * price and what to do instead — never "open it yourself" (the owner just pasted it). A read from the last hour
 * says its time ("read at 06:23").
 */
export function readNote(r: PriceReadResult): string {
  const readAt = r.reused ? ` (read at ${formatTime(r.at)})` : ''
  if (r.status === 'ok') {
    const what = r.source !== 'prisjakt' ? 'The shop\'s price'
      : r.condition === 'new' ? `Prisjakt's lowest new price${r.offers ? `, from ${r.offers} ${r.offers === 1 ? 'shop' : 'shops'}` : ''}`
      : 'Prisjakt\'s lowest, new and used offers alike'
    return `${what} — ${r.reused ? `read at ${formatTime(r.at)}` : 'read just now'}.`
  }
  if (r.status === 'not_allowed') {
    const why = r.reason ?? 'That site doesn\'t let apps read its pages'
    return `${why} — ${r.refusal === 'robots' ? 'paste the product\'s own page' : 'type the name and price yourself'}.`
  }
  const why = r.reason ?? (r.status === 'blocked' ? 'That site blocks apps with a browser check' : 'No price on the page')
  return `${why}${readAt} — type the price yourself.`
}

/**
 * What Check now says, in one toast that fits a phone's line: a price read is the result; a site's answer without
 * one (a bot check, no price, a refusal) is a warning in its own words — "Already checked at 06:23 — …" when it is
 * the check from the last hour. A failed check is not here: its error is the mutation's own.
 */
export function checkToast(results: readonly Pick<PriceCheckOutcome, 'status' | 'error' | 'reused' | 'checkedAt'>[]): { tone: 'success' | 'warning'; text: string } {
  if (results.length !== 1) return { tone: 'success', text: `Checked ${results.length} links · ${results.filter(x => x.status === 'ok').length} with a price` }
  const [r] = results
  const before = r.reused && r.checkedAt ? `Already checked at ${formatTime(r.checkedAt)}` : null
  // "Already checked at 06:23 — try after 07:23": 268 px in the toast's 13 px Inter, one line on a 375 px phone too.
  if (r.status === 'ok') return { tone: 'success', text: before ? `${before} — try after ${formatTime(Date.parse(r.checkedAt as string) + 3600_000)}` : 'Price checked' }
  const why = r.error ?? (r.status === 'blocked' ? 'The site blocks apps with a browser check' : r.status === 'not_allowed' ? 'The site doesn\'t let apps read its pages' : 'No price on the page')
  return { tone: 'warning', text: before ? `${before} — ${asTail(why)}` : why }
}

/** shop-price's sweep asks a link whose last answer was a bot check again on the 7th Oslo day after it (its BLOCKED_RETRY_DAYS). */
export const BLOCKED_RETRY_DAYS = 7

/** The day (yyyy-mm-dd) the morning check asks a link that answered with a bot check at `checkedAt` again. */
export function blockedRetryDay(checkedAt: string): string | null {
  const day = osloDay(checkedAt)
  return day ? addDays(day, BLOCKED_RETRY_DAYS) : null
}

/**
 * Whether the morning check reads a row's link (shop-price's dueItems): a thing to buy, or one you have that can
 * still go back. Anything else is read only when the owner taps Check now.
 */
export function morningReads(item: Pick<ShopItem, 'list' | 'kind' | 'status' | 'url' | 'disposal' | 'return_by'>, today: string): boolean {
  if ((item.list ?? 'wishlist') !== 'wishlist' || (item.kind ?? 'item') !== 'item' || !item.url) return false
  return item.status === 'wishlist' || (item.status === 'bought' && !item.disposal && !!item.return_by && item.return_by >= today)
}

/**
 * When the morning check tries a link that couldn't be checked again: "the morning check tries again on 17.11.2026"
 * after a bot check, "the morning check tries again" after a failed check — null when it doesn't (a refusal, a
 * page without a price, a row it doesn't read).
 */
export function retryWords(item: Pick<ShopItem, 'list' | 'kind' | 'status' | 'url' | 'disposal' | 'return_by'>, watch: Pick<ShopPriceWatch, 'status' | 'checked_at'>, today: string): string | null {
  if (!morningReads(item, today)) return null
  if (watch.status === 'error') return 'the morning check tries again'
  if (watch.status !== 'blocked') return null
  const day = blockedRetryDay(watch.checked_at)
  return day && day > today ? `the morning check tries again on ${formatDate(day)}` : 'the morning check tries again'
}

/** What a price covers: Prisjakt's new offers, its figures that mix in used ones, or a shop's own price. */
export type Covers = 'new' | 'mixed' | 'unknown'

/** What a watch's (or a point's) price covers; one read before 188 says nothing, and on Prisjakt it may mix in used offers. */
export function coversOf(w: { condition: Covers | null; source: string | null }): Covers {
  return w.condition ?? (w.source === 'prisjakt' ? 'mixed' : 'unknown')
}

/**
 * The price history the record draws and sums up: only the points of the watch's own kind, in its currency — a
 * Prisjakt point from before 188 counts as mixed — so "lowest" never sets a used price against a new one; and the
 * points of another kind it leaves out, with what they covered.
 */
export function historyOf<P extends Pick<ShopPricePoint, 'condition' | 'source' | 'currency'>>(points: readonly P[], covers: Covers, currency: string): { rows: P[]; leftOut: { count: number; covers: Covers[] } } {
  const ofCurrency = points.filter(p => (p.currency ?? currency).toUpperCase() === currency)
  const rows = ofCurrency.filter(p => coversOf(p) === covers)
  const other = ofCurrency.filter(p => coversOf(p) !== covers)
  return { rows, leftOut: { count: other.length, covers: [...new Set(other.map(coversOf))] } }
}

/** "Left out: 4 prices that mixed in used offers" under the history, or null when nothing was left out. */
export function leftOutWords(leftOut: { count: number; covers: Covers[] }): string | null {
  const n = leftOut.count
  if (!n) return null
  const what = leftOut.covers.length !== 1 ? 'of another kind'
    : leftOut.covers[0] === 'mixed' ? 'that mixed in used offers'
    : leftOut.covers[0] === 'new' ? 'of new offers only'
    : 'from the shop\'s own page'
  return `Left out: ${n} ${n === 1 ? 'price' : 'prices'} ${what}`
}

/** ", new and used" after "Prisjakt" when its price may be a used one (mixed, or read before 188), else nothing. */
export function mixedWords(w: Pick<ShopPriceWatch, 'condition' | 'source'>): string {
  return w.source === 'prisjakt' && coversOf(w) === 'mixed' ? ', new and used' : ''
}

/**
 * In a few words, why the price a watch keeps is an old one (the card's line): a refusal isn't a failure
 * (neutral), a page without a price neither; a bot check or a failed check is (`warn`), with when the morning
 * check tries again (`retry`). Null for a price now.
 */
export function stateWords(item: Pick<ShopItem, 'list' | 'kind' | 'status' | 'url' | 'disposal' | 'return_by'>, watch: Pick<ShopPriceWatch, 'status' | 'checked_at' | 'condition'>, today: string): { text: string; warn: boolean; retry: string | null } | null {
  if (watch.status === 'ok') return null
  if (watch.status === 'not_allowed') return { text: 'apps may not read it', warn: false, retry: null }
  if (watch.status === 'no_price') return { text: watch.condition === 'new' ? 'no new offer' : 'no price on the page', warn: false, retry: null }
  const retry = retryWords(item, watch, today)
  return { text: watch.status === 'blocked' ? 'blocks apps' : `couldn't check ${formatDate(watch.checked_at)}`, warn: true, retry }
}

/**
 * The strip's hint under "Price now" when there is no price: the refusal named, "no new offer", or "couldn't
 * check 10.11.2026" — never "not checked yet" for a link that was checked.
 */
export function noPriceHint(watch: Pick<ShopPriceWatch, 'status' | 'checked_at' | 'condition'>): string {
  if (watch.status === 'not_allowed') return 'apps may not read it'
  if (watch.status === 'no_price') return watch.condition === 'new' ? 'no new offer' : 'no price on the page'
  return `couldn't check ${formatDate(watch.checked_at)}`
}

/** A sentence from shop-price as the end of one of ours: "The site didn't answer" → "the site didn't answer" (a site's name stays). */
export function asTail(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s
}
