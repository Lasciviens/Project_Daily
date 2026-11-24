import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Clock, Loader2, X } from 'lucide-react'
import { Button, IconButton, Truncate } from '../../../../shared/ui'
import { costNote } from '../../../ai/claude/featureRules'
import type { FileKind } from '../../receiptBatch'
import type { FileRow } from './useReceiptFiles'

/**
 * The files of the queue, one row each: waiting, reading, "N lines · ≈ $x", failed with the function's own sentence and Try again
 * (with the most that try could cost), or skipped (refused in the browser: nothing was sent). Once every file is read the rows
 * fold into one line ("4 read · 1 failed · show"). A file that has not been read can be taken off the list with its ×.
 */
export function ReceiptFiles({ rows, dupes, running, onRetry, onDrop, worstOf }: {
  rows: readonly FileRow[]; dupes: readonly number[]; running: boolean
  onRetry: (id: number) => void; onDrop: (id: number) => void; worstOf: (kind: FileKind) => number | null
}) {
  const [shown, setShown] = useState(false)
  if (rows.length === 0) return null
  const finished = rows.every(r => r.status === 'done' || r.status === 'failed' || r.status === 'refused')
  const read = rows.filter(r => r.status === 'done').length
  const failed = rows.filter(r => r.status === 'failed').length
  const skipped = rows.filter(r => r.status === 'refused').length
  if (finished && read > 0 && !shown) {
    const words = [`${read} read`, failed ? `${failed} failed` : null, skipped ? `${skipped} skipped` : null].filter(Boolean).join(' · ')
    return (
      <button type="button" onClick={() => setShown(true)} aria-expanded={false}
        className={`flex min-h-[36px] w-full items-center gap-2 rounded-row border border-line bg-surface-2 px-3 text-left text-body ${failed ? 'text-warn' : 'text-fg-muted'}`}>
        {failed ? <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" /> : <Check aria-hidden className="h-4 w-4 shrink-0 text-success" />}
        <span className="min-w-0 flex-1"><Truncate>{words}</Truncate></span>
        <span className="inline-flex shrink-0 items-center gap-1 text-meta">show <ChevronDown aria-hidden className="h-4 w-4" /></span>
      </button>
    )
  }
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Files">
      {rows.map((r, i) => {
        const lines = r.read?.items?.length ?? 0
        const cost = r.read ? costNote(r.read.costUsd) : ''
        const dup = dupes[i] >= 0
        const worst = r.status === 'failed' ? worstOf(r.kind) : null
        return (
          <li key={r.id} className="rounded-row border border-line bg-surface-2 px-3 py-2">
            <div className="flex items-center gap-2 text-body">
              <span aria-hidden className="shrink-0 text-fg-muted">
                {r.status === 'reading' ? <Loader2 className="h-4 w-4 animate-spin" /> : r.status === 'done' ? <Check className="h-4 w-4 text-success" />
                  : r.status === 'waiting' || r.status === 'stopped' ? <Clock className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4 text-warn" />}
              </span>
              <span className="min-w-0 flex-1 font-medium"><Truncate>{`${i + 1} · ${r.name}`}</Truncate></span>
              <span className="shrink-0 text-meta tabular-nums text-fg-muted">
                {r.status === 'waiting' ? 'Waiting' : r.status === 'stopped' ? 'Not read' : r.status === 'reading' ? 'Reading…'
                  : r.status === 'done' ? [`${lines} ${lines === 1 ? 'line' : 'lines'}`, cost].filter(Boolean).join(' · ') : r.status === 'refused' ? 'Skipped' : 'Failed'}
              </span>
              {r.status === 'failed' && <Button size="sm" disabled={running} onClick={() => onRetry(r.id)}>Try again</Button>}
              {r.status === 'stopped' && <Button size="sm" disabled={running} onClick={() => onRetry(r.id)}>Read</Button>}
              {(r.status === 'waiting' || r.status === 'stopped' || r.status === 'failed' || r.status === 'refused') && (
                <IconButton size="sm" label={`Take ${r.name} off the list`} disabled={running} onClick={() => onDrop(r.id)}><X aria-hidden /></IconButton>
              )}
            </div>
            {(r.status === 'failed' || r.status === 'refused' || r.status === 'stopped') && r.error && <p className="mt-1 text-meta text-warn">{r.error}</p>}
            {worst != null && <p className="mt-1 text-meta text-fg-muted">Another try could cost up to ≈ ${worst.toFixed(2)}; usually far less.</p>}
            {dup && <p className="mt-1 text-meta text-fg-muted">Looks like file {dupes[i] + 1}: its lines start unticked.</p>}
          </li>
        )
      })}
      {finished && read > 0 && (
        <li><button type="button" onClick={() => setShown(false)} title="Fold the files" className="text-meta text-fg-muted underline">Fold</button></li>
      )}
    </ul>
  )
}
