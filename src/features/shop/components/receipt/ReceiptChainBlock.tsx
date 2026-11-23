import { Truncate } from '../../../../shared/ui'
import type { MergedLine } from '../../receiptBatch'
import type { useReceiptFlow } from './useReceiptFlow'

type Flow = ReturnType<typeof useReceiptFlow>

/**
 * The money chain of these receipts (owner, 23.11.2026): for each sold line, which bought lines its money went to. The
 * suggestion (code: dates, category, brand, a model word; the amount only breaks a tie) is ticked to start; the owner
 * ticks one, several or none. Nothing is linked here: the saves and the links come with the primary button.
 */
export function ReceiptChainBlock({ merged, flow }: { merged: readonly MergedLine[]; flow: Flow }) {
  const label = (key: string) => { const m = merged.find(x => x.key === key); return m ? (m.line.product ?? m.line.name) : '' }
  if (flow.soldKeys.length === 0 || flow.boughtKeys.length === 0) return null
  return (
    <section aria-label="Money chain" className="rounded-row border border-line p-3">
      <p className="section-label mb-1">Money went to</p>
      <ul className="flex flex-col gap-2">
        {flow.soldKeys.map(s => {
          const ticked = flow.ticksOf(s)
          return (
            <li key={s}>
              <p className="text-meta font-medium text-fg"><Truncate>{label(s)}</Truncate></p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {flow.boughtKeys.map(b => {
                  // A link that is already made shows ticked and cannot be unticked here: its own toast's Undo takes it back.
                  const made = flow.pairLinked(s, b)
                  return (
                    <label key={b} className={`inline-flex min-h-[32px] max-w-full items-center gap-1.5 rounded-row border border-line bg-surface-2 px-2 text-meta text-fg-2 ${made ? 'opacity-80' : 'cursor-pointer'}`}>
                      <input type="checkbox" checked={made || ticked.has(b)} disabled={made} onChange={() => flow.toggleTarget(s, b)} aria-label={`${label(s)} paid for ${label(b)}${made ? ' (linked)' : ''}`} className="h-4 w-4 shrink-0 accent-accent-500" />
                      <span className="min-w-0 max-w-[14rem]"><Truncate>{label(b)}</Truncate></span>
                    </label>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
      {flow.soldKeys.every(s => flow.ticksOf(s).size === 0) && <p className="mt-1 text-meta text-fg-muted">Tick what the money paid for, or leave it: nothing is linked then.</p>}
    </section>
  )
}
