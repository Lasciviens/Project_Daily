import type { RecordFact } from '../../shopSuggestions'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { TonePill } from '../../../../shared/ui'
import { RecordBody, RecordFooter } from './RecordBody'
import { useShopRecord } from './useShopRecord'
import type { ShopItem } from '../../types'

/**
 * A wishlist-side row as a record in a popup (xl; full screen on a phone):
 * its life as a story — the actions, the money strip, the nudge, the Story
 * and the sections that open in place (RecordBody). Every screen opens this
 * popup — Owned's rows, the lists, the chains, the links inside a record
 * (owner, 23.11.2026: no side pane). It is one of the one body's three frames (mode open); `ShopCreate` (add) and
 * `JustBought` (bought) are the others — a frame holds no field, picture or finder of its own (`verify-shop-one-body`).
 */
export function ShopRecord({ item, openFact, openSection, onClose }: { item: ShopItem; openFact?: RecordFact; openSection?: 'money'; onClose: () => void }) {
  const r = useShopRecord(item, openFact, onClose)
  return (
    <ModalShell
      onClose={() => { void r.close() }}
      title={item.title}
      subtitle={r.subtitle}
      wrapTitle
      headerActions={r.pill && <TonePill tone={r.pill.tone} className="shrink-0 max-sm:hidden">{r.pill.label}</TonePill>}
      size="xl"
      mobile="fullscreen"
      dismissible={!r.saving}
      footer={r.d.dirty ? <RecordFooter r={r} /> : undefined}
    >
      <RecordBody mode="open" r={r} openFact={openFact} openSection={openSection} pill="phone" />
    </ModalShell>
  )
}
