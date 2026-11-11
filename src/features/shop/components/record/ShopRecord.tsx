import { ModalShell } from '../../../../shared/modals/ModalShell'
import { TonePill } from '../../../../shared/ui'
import { RecordBody, RecordFooter } from './RecordBody'
import { useShopRecord } from './useShopRecord'
import type { ShopItem } from '../../types'

/**
 * A wishlist-side row as a record in a popup (xl; full screen on a phone):
 * its life as a story — the actions, the money strip, the nudge, the Story
 * and the sections that open in place (RecordBody). Owned from 60rem opens
 * the same record in its side pane instead (RecordPane).
 */
export function ShopRecord({ item, openFact, onClose }: { item: ShopItem; openFact?: 'value'; onClose: () => void }) {
  const r = useShopRecord(item, openFact, onClose)
  return (
    <ModalShell
      onClose={() => { void r.close() }}
      title={item.title}
      subtitle={r.subtitle}
      headerActions={<TonePill tone={r.pill.tone} className="shrink-0 max-sm:hidden">{r.pill.label}</TonePill>}
      size="xl"
      mobile="fullscreen"
      dismissible={!r.saving}
      footer={<RecordFooter r={r} />}
    >
      <RecordBody r={r} openFact={openFact} pill="phone" />
    </ModalShell>
  )
}
