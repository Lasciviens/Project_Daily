import { createContext, useContext } from 'react'
import { useEntityModal } from '../../../../shared/modals'

/** Open another thing's record from inside one: an accessory, the thing it belongs to, a money link, a model. */
export type OpenRecord = (id: string) => void

/**
 * Where a record opens the records it links to: in its own place — the side
 * pane switches to the other thing (Owned from 60rem), a popup record opens
 * another popup on top (the default, `null`).
 */
export const RecordOpenContext = createContext<OpenRecord | null>(null)

export function useOpenRecord(): OpenRecord {
  const modal = useEntityModal()
  const inPane = useContext(RecordOpenContext)
  return inPane ?? (id => modal.open({ kind: 'shop-item', id }))
}
