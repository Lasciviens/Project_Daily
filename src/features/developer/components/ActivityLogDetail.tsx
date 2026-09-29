import { Link2 } from 'lucide-react'
import { Card } from '../../../shared/ui'
import type { AuditLog } from '../hooks/useLogs'
import { OP_META, agoLabel, fmtLogDate, friendlyTable, rowLabel } from './activityLogMeta'

// What one audit change did: the readable diff shown inline under a row on
// phones, and in the detail pane beside the timeline on wider pages
// (developerBoards.ts → LIST_DETAIL_BOARD).

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Keys not worth showing in a snapshot (plumbing).
const HIDDEN_KEYS = new Set(['id', 'user_id', 'created_at', 'updated_at', 'sort_order'])

// UPDATE → only the fields that changed (before → after). INSERT/DELETE → a
// key/value snapshot of the row. For a DELETE this snapshot IS the recovery
// source (migration 037 stores the full old row).
export function DiffView({ log }: { log: AuditLog }) {
  if (log.operation === 'UPDATE') {
    const keys = [...new Set([...Object.keys(log.old_data ?? {}), ...Object.keys(log.new_data ?? {})])]
      .filter(k => !HIDDEN_KEYS.has(k))
      .filter(k => fmtValue(log.old_data?.[k]) !== fmtValue(log.new_data?.[k]))
      .sort()
    if (keys.length === 0) return <p className="text-meta text-fg-muted">No visible field changes.</p>
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-meta">
          <thead>
            <tr className="section-label">
              <th className="py-1 pr-4 text-left font-semibold">Field</th>
              <th className="py-1 pr-4 text-left font-semibold">Before</th>
              <th className="py-1 text-left font-semibold">After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {keys.map(k => (
              <tr key={k}>
                <td className="whitespace-nowrap py-1 pr-4 align-top font-medium text-fg-2">{k}</td>
                <td className="break-all py-1 pr-4 align-top text-danger">{fmtValue(log.old_data?.[k])}</td>
                <td className="break-all py-1 align-top text-success">{fmtValue(log.new_data?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const data = (log.operation === 'DELETE' ? log.old_data : log.new_data) ?? {}
  const entries = Object.entries(data).filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== '')
  return (
    <div className="flex flex-col gap-0.5">
      {log.operation === 'DELETE' && (
        <p className="mb-1 text-meta text-fg-muted">Deleted row snapshot (recoverable within 30 days):</p>
      )}
      <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-0.5 text-meta">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-fg-muted">{k}</dt>
            <dd className="break-all text-fg">{fmtValue(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * The detail pane: the change as a sentence, when and by whom, and its diff.
 * Only rendered while the list shows something (an empty list has its own
 * empty state and no pane).
 */
export function ActivityLogDetail({ log, linkedCount }: { log: AuditLog; linkedCount: number }) {
  const op = OP_META[log.operation]
  return (
    <Card aria-label="Change details" className="flex max-h-[calc(100dvh-7rem)] flex-col gap-3 overflow-y-auto">
      <div className="flex flex-col gap-1">
        <p className="text-body text-fg-2">
          <span className="font-medium text-fg-muted">{log.actor === 'web' ? 'You' : 'AI / sync'}</span>{' '}
          <span data-tone={op.tone} className="tone-text font-medium">{op.verb}</span>{' '}
          {friendlyTable(log.table_name)}{' '}
          <span className="break-words font-semibold text-fg">«{rowLabel(log)}»</span>
        </p>
        <p className="text-meta tabular-nums text-fg-muted">{fmtLogDate(log.created_at)} · {agoLabel(log.created_at)}</p>
        {linkedCount > 1 && (
          <p className="flex items-center gap-1.5 text-meta text-fg-muted">
            <Link2 aria-hidden className="h-3.5 w-3.5" /> One of {linkedCount} linked changes in the same transaction
          </p>
        )}
      </div>
      <div className="border-t border-line pt-3">
        <DiffView log={log} />
      </div>
    </Card>
  )
}
