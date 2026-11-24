import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button } from '../../../../shared/ui'
import { RecordBody } from './RecordBody'
import { usePurchaseEdit } from './usePurchaseEdit'
import { useShopRecord } from './useShopRecord'
import type { ReceiptFill, ReceiptRead } from '../../../ai/claude/featureRules'
import type { ShopItem } from '../../types'

/**
 * Just bought — the one body in mode bought: the thing's Purchase editor, opened (where and how it was bought, Arrived, the
 * return and complaint days with their reasons, an extra warranty, the receipt), and Find picture. This frame is the popup and
 * its Later / Save; Save writes what Just bought always wrote (`purchaseWrite` → `savePurchase`, "Purchase saved · Undo").
 */
export function JustBought({ item, live, bought, receipt, onClose }: { item: ShopItem; /** The row as it is now (the form is seeded once from `item`). */ live: ShopItem; bought: boolean; receipt?: { fill: ReceiptFill; read: ReceiptRead }; onClose: () => void }) {
  const r = useShopRecord(live, undefined, onClose)
  const p = usePurchaseEdit(item, receipt)
  const gone = !bought
  return (
    <ModalShell onClose={onClose} title="Just bought" subtitle={item.title} size="md" compact dismissible={!p.saving}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto" disabled={p.saving} tip={gone ? undefined : 'Later — fill it in from its record'}>{gone ? 'Close' : 'Later'}</Button>
          {!gone && <Button variant="primary" size="sm" onClick={() => p.submit(onClose)} disabled={!p.valid} loading={p.saving}>Save</Button>}
        </div>
      }>
      <RecordBody mode="bought" r={r} p={p} bought={bought} />
    </ModalShell>
  )
}
