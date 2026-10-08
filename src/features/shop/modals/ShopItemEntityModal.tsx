import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useShopItem } from '../hooks/useShop'
import { listOf } from '../shopModel'
import { ShopItemSheet } from '../components/ShopItemSheet'
import { ShopRecord } from '../components/record/ShopRecord'

/**
 * `shop-item`: add (no id, optional defaults) in the small sheet; open by id —
 * a quick-list errand in the same sheet, a wishlist-side row as its record
 * (live, so a sale or a new accessory shows at once).
 */
export function ShopItemEntityModal({ request, onClose }: EntityModalProps<'shop-item'>) {
  if (!request.id) return <ShopItemSheet defaults={request.defaults} onClose={onClose} />
  return <ShopItemByIdModal id={request.id} onClose={onClose} />
}

function ShopItemByIdModal({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useShopItem(id)
  const first = useFirstLoaded(query.data, query)
  const item = query.data ?? first
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return listOf(item) === 'quick' ? <ShopItemSheet item={item} onClose={onClose} /> : <ShopRecord item={item} onClose={onClose} />
}
