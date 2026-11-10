// What the price watch says on screen, in one vocabulary (owner, 10.11.2026: plain words, "apps", the true result):
// the note under a pasted link, and when the morning check tries a link again. shop-price writes the site's own
// answer ("finn.no doesn't let apps read its pages", "elkjop.no blocks apps with a browser check"); these add what
// to do about it. Pure — verify-shop-price-read runs it.
import { formatDate, formatTime } from '../../shared/utils/dateFormat'
import { osloDay } from './groceryModel'
import { addDays } from './ownModel'
import type { PriceReadResult } from './api/shopPriceApi'
import type { ShopItem, ShopPriceWatch } from './types'

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

/** A sentence from shop-price as the end of one of ours: "The site didn't answer" → "the site didn't answer" (a site's name stays). */
export function asTail(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s
}
