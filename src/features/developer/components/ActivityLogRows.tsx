import { ChevronDown, Link2 } from 'lucide-react'
import { cx, Truncate } from '../../../shared/ui'
import { relativeTime } from '../../../shared/utils/relativeTime'
import type { AuditLog } from '../hooks/useLogs'
import { OP_META, fmtLogDate, friendlyTable, rowLabel } from './activityLogMeta'
import { DiffView } from './ActivityLogDetail'

// Rows of the CRUD audit timeline (audit_logs, written by DB triggers —
// migration 037, +052 added dev_requests): a plain-language sentence per
// change, same-transaction cascades grouped. A row either opens its diff in
// place (phones, tablets) or picks it for the detail pane beside the list
// (wider pages — pass `onSelect`).

interface RowProps {
  log: AuditLog
  /** In-place mode: the diff is open under the row. */
  expanded?: boolean
  onToggle?: () => void
  /** Pane mode: picking the row shows it in the detail pane. */
  onSelect?: () => void
  selected?: boolean
  nested?: boolean
}

export function LogRow({ log, expanded = false, onToggle, onSelect, selected = false, nested }: RowProps) {
  const op = OP_META[log.operation]
  const paneMode = !!onSelect
  return (
    <div className={nested ? undefined : 'card overflow-hidden'}>
      <button
        type="button"
        onClick={paneMode ? onSelect : onToggle}
        aria-expanded={paneMode ? undefined : expanded}
        aria-current={paneMode && selected ? 'true' : undefined}
        className={cx(
          'flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
          selected ? 'bg-accent-50' : '[@media(hover:hover)]:hover:bg-surface-hover',
        )}
      >
        <span data-tone={op.tone} className="tone-dot" aria-hidden />
        <Truncate className="flex-1 text-body text-fg-2">
          <span className="font-medium text-fg-muted">{log.actor === 'web' ? 'You' : 'AI / sync'}</span>{' '}
          <span data-tone={op.tone} className="tone-text font-medium">{op.verb}</span>{' '}
          {friendlyTable(log.table_name)}{' '}
          <span className="font-semibold text-fg">«{rowLabel(log)}»</span>
        </Truncate>
        <span className="hidden shrink-0 text-meta tabular-nums text-fg-muted sm:block">{fmtLogDate(log.created_at)}</span>
        {!paneMode && <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', expanded && 'rotate-180')} />}
      </button>
      {!paneMode && expanded && (
        <div className="border-t border-line bg-surface-2 px-3 py-2">
          <p className="mb-1.5 text-meta text-fg-muted sm:hidden">{relativeTime(log.created_at)}</p>
          <DiffView log={log} />
        </div>
      )}
    </div>
  )
}

// Same-transaction group (>1 change) — a cascade, stacked with a left rail so
// "this change triggered those" reads top-to-bottom.
export function CascadeBlock({ group, expandedId, onToggle, selectedId, onSelect }: {
  group: AuditLog[]
  expandedId?: string | null
  onToggle?: (id: string) => void
  selectedId?: string | null
  onSelect?: (id: string) => void
}) {
  return (
    <div className="card overflow-hidden">
      <p className="section-label flex items-center gap-1.5 border-b border-line px-3 py-2">
        <Link2 aria-hidden className="h-3.5 w-3.5" /> Linked · same transaction · {group.length} changes
      </p>
      <div className="my-1 ml-3 divide-y divide-line border-l-2 border-accent-500/30 pl-2">
        {group.map(log => (
          <LogRow
            key={log.id}
            log={log}
            nested
            expanded={expandedId === log.id}
            onToggle={onToggle ? () => onToggle(log.id) : undefined}
            onSelect={onSelect ? () => onSelect(log.id) : undefined}
            selected={selectedId === log.id}
          />
        ))}
      </div>
    </div>
  )
}
