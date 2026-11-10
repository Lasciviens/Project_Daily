// What the price watch says on screen, in one vocabulary (owner, 10.11.2026: plain words, "apps", the true result):
// the note under a pasted link. shop-price writes the site's own answer ("finn.no doesn't let apps read its pages",
// "elkjop.no blocks apps with a browser check"); these add what to do about it. Pure — verify-shop-price-read runs it.
import { formatTime } from '../../shared/utils/dateFormat'
import type { PriceReadResult } from './api/shopPriceApi'

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
