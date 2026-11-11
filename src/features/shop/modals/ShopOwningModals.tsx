import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useShopItem } from '../hooks/useShop'
import { ComplaintSheet } from '../components/owned/ComplaintSheet'
import { InsuranceSheet } from '../components/owned/InsuranceSheet'
import type { ShopItem } from '../types'

// Owning (Shop step C): Something's wrong and the insurance list — their own chunk, loaded when opened.

export function ShopComplaintModal({ request, onClose }: EntityModalProps<'shop-complaint'>) {
  const query = useShopItem(request.id)
  const item = useFirstLoaded(query.data, query) as ShopItem | null | undefined
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return <ComplaintSheet item={item} onClose={onClose} />
}

export function ShopInsuranceModal({ onClose }: EntityModalProps<'shop-insurance'>) {
  return <InsuranceSheet onClose={onClose} />
}
