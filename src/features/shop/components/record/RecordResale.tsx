import { formatDate } from '../../../../shared/utils/dateFormat'
import { money } from '../shopFormat'
import type { ShopItem, ShopPriceWatch } from '../../types'

/**
 * Beside "Could sell for" in the Resale section: the cheapest used and
 * refurbished offers Prisjakt listed for it at the last read — shops' asking
 * prices, shown as offers seen and never as what yours would sell for (what
 * selling at your estimate means is the money strip's net).
 */
export function RecordResaleOffers({ item, watch }: { item: ShopItem; watch: ShopPriceWatch | null }) {
  const w = watch && watch.url === item.url && watch.source === 'prisjakt' ? watch : null
  if (item.disposal || !w || (w.used_low == null && w.refurbished_low == null)) return null
  const cur = w.currency ?? 'NOK'
  return (
    <p className="text-meta tabular-nums text-fg-muted">
      On Prisjakt {formatDate(w.last_ok_at ?? w.checked_at)}:{' '}
      {[w.used_low != null && `used from ${money(w.used_low, cur)}`, w.refurbished_low != null && `refurbished from ${money(w.refurbished_low, cur)}`].filter(Boolean).join(', ')}
      {' '}— shops' asking prices, not what yours would sell for.
    </p>
  )
}
