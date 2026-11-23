import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { useEntityModal } from '../../../shared/modals'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, Truncate } from '../../../shared/ui'
import { PhotoButton } from '../../ai/claude/components/PhotoButton'
import { SHOP_CURRENCIES } from '../shopModel'
import { mergedLines, RECEIPT_FILES_MAX } from '../receiptBatch'
import { ReceiptChainBlock } from '../components/receipt/ReceiptChainBlock'
import { ReceiptFiles } from '../components/receipt/ReceiptFiles'
import { ReceiptLines } from '../components/receipt/ReceiptLines'
import { ReceiptSession } from '../components/receipt/ReceiptSession'
import { useReceiptFiles } from '../components/receipt/useReceiptFiles'
import { useReceiptFlow } from '../components/receipt/useReceiptFlow'

const ACCEPT = 'image/*,application/pdf'

/**
 * Read a receipt (owner, 23.11.2026: "read from receipt, either to sell or save a purchase — a physical receipt and a
 * digital one, a PDF"; "add option to add multiple pdf reading … sold, purchased and … a money chain of them"): up to 5
 * photos or PDFs at once, each read by the model in its own call, one after another (never kept), then ONE list of their
 * lines — each Bought or Sold. Bought lines open the create popup together ("1 of 3"); a Sold line that is one of your things
 * opens Sell, one that is none opens as "Something I had" (the day and the amount it sold for required); the sold lines'
 * money can be linked to the bought ones. This popup writes nothing itself: every save is its own popup with its own toast
 * and Undo, and "Undo all from these receipts" takes back only what they wrote.
 */
export function ShopReceiptModal({ onClose }: EntityModalProps<'shop-receipt'>) {
  const modal = useEntityModal()
  const queue = useReceiptFiles()
  const fileReads = useMemo(() => queue.rows.map((r, i) => ({ id: r.id, read: r.status === 'done' ? r.read : null, duplicateOf: queue.dupes[i] })), [queue.rows, queue.dupes])
  const merged = useMemo(() => mergedLines(fileReads), [fileReads])
  const flow = useReceiptFlow(merged)
  const busy = queue.running || flow.undoing
  const anyRead = queue.rows.some(r => r.status === 'done')
  const noCurrency = queue.rows.some(r => r.read && !(r.read.currency && SHOP_CURRENCIES.includes(r.read.currency as (typeof SHOP_CURRENCIES)[number])))
  // "Save and link" only where there is a bought line for the money to go to.
  const linking = flow.soldKeys.length > 0 && flow.boughtKeys.length > 0
  const label = linking ? 'Save and link' : 'Next'

  return (
    <ModalShell onClose={onClose} title="Read receipts" size="md" dismissible={!busy}
      footer={
        <div className="flex items-center gap-2">
          {queue.rows.length > 0 && <PhotoButton iconOnly accept={ACCEPT} multiple onFiles={queue.add} disabled={busy}>Another receipt</PhotoButton>}
          <Button onClick={onClose} className="ml-auto" disabled={busy}>Close</Button>
          {anyRead && flow.pending > 0 && <Button variant="primary" onClick={flow.go} disabled={busy}>{label} · {flow.pending}</Button>}
        </div>
      }>
      <div className="flex flex-col gap-3">
        {queue.rows.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body text-fg-muted">Pick up to {RECEIPT_FILES_MAX} photos or PDFs of receipts (a till slip, an invoice, an order, a payout). AI reads each one and lists what was bought or sold; you then add each line yourself. The files are not kept.</p>
            <PhotoButton accept={ACCEPT} multiple variant="primary" onFiles={queue.add}>Choose photos or PDFs</PhotoButton>
          </div>
        )}
        {queue.note && <p className="text-meta text-warn">{queue.note}</p>}
        <ReceiptFiles rows={queue.rows} dupes={queue.dupes} running={queue.running} onRetry={queue.retry} onDrop={queue.drop} worstOf={queue.worstOf} />
        {queue.waiting > 0 && !queue.running && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* One file may be read without the estimate; several files need it, so the owner sees the most they could cost first. */}
            <Button variant="primary" onClick={() => queue.start()} disabled={queue.estimate == null && queue.waiting > 1}>Read {queue.waiting} {queue.waiting === 1 ? 'file' : 'files'}</Button>
            <span className="text-meta text-fg-muted">
              {queue.estimate != null ? `Up to ≈ $${queue.estimate.toFixed(2)} in all; usually far less.` : queue.estimateFailed ? (queue.waiting > 1 ? "The cost couldn't be worked out — try again later." : "The most it could cost couldn't be worked out.") : 'Working out the cost…'}
            </span>
          </div>
        )}
        {queue.running && (
          <div role="status" className="flex items-center gap-2 text-body text-fg-muted">
            <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1"><Truncate>{queue.progress ? `${queue.progress.done + 1} of ${queue.progress.total} · reading…` : 'Starting…'}</Truncate></span>
            <Button size="sm" onClick={queue.stop}>Stop</Button>
          </div>
        )}
        {queue.result?.halted && <p role="status" className="text-meta text-warn">{queue.result.halted}</p>}
        {anyRead && (
          <>
            {noCurrency && <p className="text-meta text-warn">A receipt has no clear currency this app holds (NOK, TRY, EUR, USD): its amounts are left out of the sheets.</p>}
            <ReceiptLines files={queue.rows} merged={merged} flow={flow} />
            <ReceiptChainBlock merged={merged} flow={flow} />
            <ReceiptSession flow={flow} onChain={id => modal.open({ kind: 'shop-chain', id })} />
            {flow.wishesLeft > 0 && flow.pending === 0 && <p className="text-meta text-fg-muted">A line on your wishlist has its own Bought button.</p>}
          </>
        )}
      </div>
    </ModalShell>
  )
}
