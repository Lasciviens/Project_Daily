import type { EntityModalProps } from '../../../shared/modals/types'
import { StoresDrawer } from '../components/stores/StoresDrawer'

/** The Stores drawer as a popup kind (its own chunk; the Shop page's first download has no room for it). */
export function ShopStoresModal({ onClose }: EntityModalProps<'shop-stores'>) {
  return <StoresDrawer onClose={onClose} />
}
