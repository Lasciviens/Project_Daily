import { isPossession } from '../../ownModel'
import type { ShopItem } from '../../types'

export type RecordState = 'buy' | 'general' | 'mine' | 'gone' | 'other'

/** Where a row is in its life: to buy, a general wish, yours, sold or gone, or something else (returned, dropped, fulfilled, not kept). */
export function recordState(i: ShopItem): RecordState {
  if (i.kind === 'general') return 'general'
  if (i.status === 'wishlist') return 'buy'
  if (i.status === 'bought' && isPossession(i)) return i.disposal && i.disposal !== 'returned' ? 'gone' : i.disposal ? 'other' : 'mine'
  return 'other'
}
