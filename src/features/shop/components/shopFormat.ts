import { formatMoney } from '../../settings/subscriptionRules'
import { complete, waitingParts, type Amount } from '../ownModel'
import type { ShopItem, ShopPriceWatch } from '../types'

// Shop's display helpers (not components): money in whole units, why a sum
// is unknown, the picture to show, the final-cost sentence.

/** A space a line never breaks at: in a number, between it and its unit, after "≈". */
export const NBSP = '\u00a0'

/** "2 500 NOK" — whole units (øre and kuruş are noise in these sums), one unbreakable piece. */
export function money(n: number, currency = 'NOK'): string {
  return formatMoney(Math.round(n), currency)
}

/** "≈ 2 500 NOK": the sign stays with its number. */
export const approx = (text: string): string => `≈${NBSP}${text}`

/** "5 000–8 000 NOK": a range in one currency, the unit once. */
export function moneyRange(min: number, max: number, currency = 'NOK'): string {
  return `${money(min, currency).slice(0, -(currency.length + 1))}–${money(max, currency)}`
}

/**
 * A sum that only waits for a rate, in two parts: the known NOK (null when
 * nothing is known yet) and what waits, in its own currency — "20 100 NOK" and
 * "+ 4 500 TRY pending". Null when the sum is complete, a price is missing,
 * or the waiting amounts are not known. Never at today's rate.
 */
export function pendingWords(a: Amount, signed = false): { known: string | null; waiting: string } | null {
  if (complete(a)) return null
  const parts = waitingParts(a)
  if (!parts) return null
  const n = Math.round(a.nok)
  const known = n !== 0 ? `${signed && n > 0 ? '+' : ''}${money(n)}` : null
  const each = parts.map((p, i) => {
    const m = money(Math.abs(p.amount), p.currency)
    if (i === 0 && !known) return p.amount < 0 ? `−${m}` : signed ? `+${m}` : m
    return `${p.amount < 0 ? '−' : '+'} ${m}`
  })
  return { known, waiting: `${each.join(' ')} pending` }
}

/** "4 500 NOK", "20 100 NOK + 4 500 TRY pending", or null for a sum with a price missing. */
export function amountWords(a: Amount, signed = false): string | null {
  if (complete(a)) {
    const n = Math.round(a.nok)
    return `${signed && n > 0 ? '+' : ''}${money(n)}`
  }
  const p = pendingWords(a, signed)
  return p ? [p.known, p.waiting].filter(Boolean).join(' ') : null
}

/** Why a sum is not a number: "1 price missing · 1 rate pending". */
export function amountReason(a: Amount): string {
  const parts: string[] = []
  if (a.missing) parts.push(`${a.missing} price${a.missing === 1 ? '' : 's'} missing`)
  if (a.pending) parts.push(`${a.pending} exchange rate${a.pending === 1 ? '' : 's'} pending (Norges Bank publishes after 16:00 on weekdays)`)
  return parts.join(' · ')
}

/** The link when it is a web page (http or https), else null — a link never runs code (javascript:, data:). */
export function webUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/** "power.no" — the site of a web link, without "www."; null for anything else. */
export function hostOf(url: string | null | undefined): string | null {
  const u = webUrl(url)
  return u ? new URL(u).hostname.replace(/^www\./, '') : null
}

/** The picture to show: the row's own, else its price watch's (when the watch is for the current link). */
export function imageOf(item: Pick<ShopItem, 'image_url' | 'url'>, watch?: ShopPriceWatch | null): string | null {
  if (item.image_url) return item.image_url
  return watch?.image && watch.url === item.url ? watch.image : null
}

/** "4 889 + 1 138 lost on earlier things" — the parts of a final cost. */
export function finalCostWords(own: number, carried: number): string {
  return finalCostParts(own, carried).join(' ')
}

/** The same in two pieces — the sum and what the earlier things did — so a narrow line breaks between them. */
export function finalCostParts(own: number, carried: number): [string, string] {
  return carried < 0 ? [`${money(own)} − ${money(-carried)}`, 'made on earlier things'] : [`${money(own)} + ${money(carried)}`, 'lost on earlier things']
}

/** "≈ 01.03.2022" for a day added from memory, else the day. */
export function dayLabel(day: string | null | undefined, approx: boolean | undefined, format: (d: string) => string): string {
  if (!day) return ''
  return `${approx ? '≈ ' : ''}${format(day)}`
}
