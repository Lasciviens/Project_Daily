import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useShopItem } from '../hooks/useShop'
import { ShopItemSheet } from '../components/ShopItemSheet'

/** `shop-item`: add (no id, optional defaults) or edit one Shop row, loaded by id from the shared items query. */
export function ShopItemEntityModal({ request, onClose }: EntityModalProps<'shop-item'>) {
  if (!request.id) return <ShopItemSheet defaults={request.defaults} onClose={onClose} />
  return <ShopItemByIdModal id={request.id} onClose={onClose} />
}

function ShopItemByIdModal({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useShopItem(id)
  const item = useFirstLoaded(query.data, query)
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return <ShopItemSheet item={item} onClose={onClose} />
}
