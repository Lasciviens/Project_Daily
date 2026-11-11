import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useShopItem } from '../hooks/useShop'
import { JustBoughtSheet } from '../components/purchase/JustBoughtSheet'
import { ClaimSheet } from '../components/purchase/ClaimSheet'
import type { ShopItem } from '../types'

// Just bought and Money to claim (migration 191's purchase facts and the stores' rules), each loading its thing by id.

function useRow(id: string) {
  const query = useShopItem(id)
  return { query, item: useFirstLoaded(query.data, query) as ShopItem | null | undefined }
}

export function ShopJustBoughtModal({ request, onClose }: EntityModalProps<'shop-just-bought'>) {
  const { query, item } = useRow(request.id)
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  // The form is seeded once; whether it is still bought follows the live row (Bought's Undo while it is open).
  return <JustBoughtSheet item={item} bought={(query.data ?? item).status === 'bought'} onClose={onClose} />
}

export function ShopClaimModal({ request, onClose }: EntityModalProps<'shop-claim'>) {
  const { query, item } = useRow(request.id)
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return <ClaimSheet item={item} onClose={onClose} />
}
