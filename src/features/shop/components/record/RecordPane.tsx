import { useEffect, useRef, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { IconButton, TonePill, Truncate } from '../../../../shared/ui'
import { useHistoryDismiss } from '../../../../shared/hooks/useHistoryDismiss'
import { useShopItem } from '../../hooks/useShop'
import { PANE_HEIGHT, RecordPaneSkeleton } from '../owned/paneSkeleton'
import { RecordBody, RecordFooter } from './RecordBody'
import { RecordOpenContext } from './recordOpen'
import { useShopRecord } from './useShopRecord'
import type { ShopItem } from '../../types'


/**
 * Owned's side pane from a board width of 60rem (step A, 10.11.2026): the
 * tapped thing's record, sticky beside the list in the rail's place — the
 * list keeps its scroll and its place; a phone keeps the full-screen record.
 * Back closes it (useHistoryDismiss), as do × and Esc — asking first when a
 * fact is changed and not saved. A link inside it (an accessory, the thing
 * it belongs to, a money link) opens that thing here too (`onOpen`). Loaded
 * on its own, so the Shop page keeps its budget.
 */
export function RecordPane({ id, fact, onClose, onOpen, onDirty }: {
  id: string
  fact?: 'value'
  onClose: () => void
  onOpen: (id: string) => void
  /** Whether it holds unsaved changes: the list asks before it opens another thing. */
  onDirty: (dirty: boolean) => void
}) {
  const query = useShopItem(id)
  const item = query.data
  // Deleted (here or elsewhere): nothing left to show.
  useEffect(() => { if (item === null) onClose() }, [item, onClose])
  return (
    <RecordOpenContext.Provider value={onOpen}>
      {item ? <PaneRecord item={item} fact={fact} onClose={onClose} onDirty={onDirty} /> : <RecordPaneSkeleton />}
    </RecordOpenContext.Provider>
  )
}

function PaneRecord({ item, fact, onClose, onDirty }: { item: ShopItem; fact?: 'value'; onClose: () => void; onDirty: (dirty: boolean) => void }) {
  const r = useShopRecord(item, fact, onClose)
  const ref = useRef<HTMLElement>(null)
  useHistoryDismiss(true, () => { void r.close() }, !r.saving)
  useEffect(() => { onDirty(r.d.dirty) }, [r.d.dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])
  // The record takes the focus as it opens, without scrolling the page (the list keeps its place).
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.stopPropagation()
    void r.close()
  }
  return (
    <section ref={ref} tabIndex={-1} aria-label={item.title} onKeyDown={onKeyDown} data-record-pane
      className={`card flex ${PANE_HEIGHT} flex-col overflow-hidden outline-none`}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line py-2 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <Truncate as="h2" className="text-lead font-semibold text-fg">{item.title}</Truncate>
          {r.subtitle && <Truncate as="p" className="text-meta text-fg-muted">{r.subtitle}</Truncate>}
        </div>
        <TonePill tone={r.pill.tone} className="shrink-0">{r.pill.label}</TonePill>
        <IconButton label="Close" onClick={() => { void r.close() }}><X aria-hidden /></IconButton>
      </header>
      <div className="scroll-y min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <RecordBody r={r} openFact={fact} pill="none" />
      </div>
      <footer className="shrink-0 border-t border-line px-4 py-2.5">
        <RecordFooter r={r} />
      </footer>
    </section>
  )
}
