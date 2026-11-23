import { useEntityModal } from '../../../../shared/modals'

/** Open another thing's record from inside one: an accessory, the thing it belongs to, a money link, a model. */
export type OpenRecord = (id: string) => void

/** Another thing's record opens as another popup on top (owner, 23.11.2026: one popup everywhere, no side pane). */
export function useOpenRecord(): OpenRecord {
  const modal = useEntityModal()
  return id => modal.open({ kind: 'shop-item', id })
}
