import { formatMoney } from '../../settings/subscriptionRules'
import type { Amount } from '../ownModel'
import type { ShopItem, ShopPriceWatch } from '../types'

// Shop's display helpers (not components): money in whole units, why a sum
// is unknown, the picture to show, the final-cost sentence.

/** "2 500 NOK" — whole units (øre and kuruş are noise in these sums). */
export function money(n: number, currency = 'NOK'): string {
  return formatMoney(Math.round(n), currency)
}

/** Why a sum is not a number: "1 price missing · 1 rate pending". */
export function amountReason(a: Amount): string {
  const parts: string[] = []
  if (a.missing) parts.push(`${a.missing} price${a.missing === 1 ? '' : 's'} missing`)
  if (a.pending) parts.push(`${a.pending} exchange rate${a.pending === 1 ? '' : 's'} pending (Norges Bank publishes after 16:00 on weekdays)`)
  return parts.join(' · ')
}

/** The picture to show: the row's own, else its price watch's (when the watch is for the current link). */
export function imageOf(item: Pick<ShopItem, 'image_url' | 'url'>, watch?: ShopPriceWatch | null): string | null {
  if (item.image_url) return item.image_url
  return watch?.image && watch.url === item.url ? watch.image : null
}

/** "4 889 + 1 138 lost on earlier things" — the parts of a final cost. */
export function finalCostWords(own: number, carried: number): string {
  return carried < 0 ? `${money(own)} − ${money(-carried)} made on earlier things` : `${money(own)} + ${money(carried)} lost on earlier things`
}

/** "≈ 01.03.2022" for a day added from memory, else the day. */
export function dayLabel(day: string | null | undefined, approx: boolean | undefined, format: (d: string) => string): string {
  if (!day) return ''
  return `${approx ? '≈ ' : ''}${format(day)}`
}
