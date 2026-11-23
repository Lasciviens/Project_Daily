import { AlertTriangle, Check, Clock, Loader2 } from 'lucide-react'
import { Button, Truncate } from '../../../../shared/ui'
import { costNote } from '../../../ai/claude/featureRules'
import type { FileRow } from './useReceiptFiles'

/** The files of the queue, one row each: waiting, reading, "N lines · ≈ $x", or failed with the function's own sentence and Try again. */
export function ReceiptFiles({ rows, dupes, running, onRetry }: { rows: readonly FileRow[]; dupes: readonly number[]; running: boolean; onRetry: (id: number) => void }) {
  if (rows.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Files">
      {rows.map((r, i) => {
        const lines = r.read?.items?.length ?? 0
        const cost = r.read ? costNote(r.read.costUsd) : ''
        const dup = dupes[i] >= 0
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
                  : r.status === 'done' ? [`${lines} ${lines === 1 ? 'line' : 'lines'}`, cost].filter(Boolean).join(' · ') : 'Failed'}
              </span>
              {r.status === 'failed' && <Button size="sm" disabled={running} onClick={() => onRetry(r.id)}>Try again</Button>}
              {r.status === 'stopped' && <Button size="sm" disabled={running} onClick={() => onRetry(r.id)}>Read</Button>}
            </div>
            {(r.status === 'failed' || r.status === 'refused' || r.status === 'stopped') && r.error && <p className="mt-1 text-meta text-warn">{r.error}</p>}
            {dup && <p className="mt-1 text-meta text-fg-muted">Looks like file {dupes[i] + 1}: its lines start unticked.</p>}
          </li>
        )
      })}
    </ul>
  )
}
