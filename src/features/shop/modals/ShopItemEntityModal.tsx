import type { RecordFact } from '../shopSuggestions'
import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useShopItem } from '../hooks/useShop'
import { listOf } from '../shopModel'
import { ShopItemSheet } from '../components/ShopItemSheet'
import { ShopRecord } from '../components/record/ShopRecord'
import { ShopCreate } from '../components/record/ShopCreate'

/**
 * `shop-item`: add (no id, optional defaults) — a wish or a general wish in the record's own popup in create mode
 * (`ShopCreate`), a quick-list errand in its small sheet; open by id — a quick-list errand in the same sheet, a
 * wishlist-side row as its record (live, so a sale or a new accessory shows at once).
 */
export function ShopItemEntityModal({ request, onClose }: EntityModalProps<'shop-item'>) {
  if (!request.id) {
    const d = request.defaults
    if (d?.list === 'quick') return <ShopItemSheet defaults={d} onClose={onClose} />
    return <ShopCreate spec={{ preset: d?.general ? 'general' : 'wish', defaults: d }} onClose={onClose} />
  }
  return <ShopItemByIdModal id={request.id} fact={request.fact} section={request.section} onClose={onClose} />
}

function ShopItemByIdModal({ id, fact, section, onClose }: { id: string; fact?: RecordFact; section?: 'money' | 'purchase'; onClose: () => void }) {
  const query = useShopItem(id)
  const first = useFirstLoaded(query.data, query)
  const item = query.data ?? first
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return listOf(item) === 'quick' ? <ShopItemSheet item={item} onClose={onClose} /> : <ShopRecord item={item} openFact={fact} openSection={section} onClose={onClose} />
}
