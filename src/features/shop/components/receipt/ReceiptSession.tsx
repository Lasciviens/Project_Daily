import { Undo2, Workflow } from 'lucide-react'
import { Button } from '../../../../shared/ui'
import type { useReceiptFlow } from './useReceiptFlow'

type Flow = ReturnType<typeof useReceiptFlow>

/** What these receipts have written so far, with "Open the chain" and "Undo all from these receipts" (takes back only what this popup wrote). */
export function ReceiptSession({ flow, onChain }: { flow: Flow; onChain: (id: string) => void }) {
  const w = flow.written
  if (w.created.length + w.sales.length + w.links.length === 0) return null
  const parts = [
    w.created.length ? `${w.created.length} added` : null,
    w.sales.length ? `${w.sales.length} sold` : null,
    flow.written.pairs.length || w.links.length ? `${Math.max(w.pairs.length, w.links.length)} money ${Math.max(w.pairs.length, w.links.length) === 1 ? 'link' : 'links'}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <section aria-label="Saved from these receipts" className="rounded-row border border-line bg-surface-2 p-3">
      <p className="text-meta text-fg-muted"><span className="font-medium text-success">Saved: </span>{parts}</p>
      {flow.linkNote && <p className="mt-1 text-meta text-warn">{flow.linkNote}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {flow.chainId && <Button size="sm" icon={<Workflow />} onClick={() => onChain(flow.chainId as string)}>Open the chain</Button>}
        <Button size="sm" variant="ghost" icon={<Undo2 />} loading={flow.undoing} onClick={() => { void flow.undoAll() }}>Undo all from these receipts</Button>
      </div>
    </section>
  )
}
