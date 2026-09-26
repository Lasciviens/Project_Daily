import { ChevronDown, Link2 } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { relativeTime } from '../../../shared/utils/relativeTime'
import type { AuditLog } from '../hooks/useLogs'
import { OP_META, friendlyTable } from './activityLogMeta'

// Rows of the CRUD audit timeline (audit_logs, written by DB triggers —
// migration 037, +052 added dev_requests): a plain-language sentence per
// change, same-transaction cascades grouped, a readable diff on expand.

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// Best-effort human name for the affected row.
function rowLabel(log: AuditLog): string {
  const d = log.new_data ?? log.old_data ?? {}
  for (const key of ['title', 'name', 'label', 'message', 'content']) {
    const v = d[key]
    if (typeof v === 'string' && v.trim()) return v.length > 60 ? v.slice(0, 60) + '…' : v
  }
  return log.row_id ? `#${log.row_id.slice(0, 8)}` : '—'
}

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
function DiffView({ log }: { log: AuditLog }) {
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

export function LogRow({ log, expanded, onToggle, nested }: { log: AuditLog; expanded: boolean; onToggle: () => void; nested?: boolean }) {
  const op = OP_META[log.operation]
  return (
    <div className={nested ? undefined : 'card overflow-hidden'}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left transition-colors [@media(hover:hover)]:hover:bg-surface-hover"
      >
        <span data-tone={op.tone} className="tone-dot" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-body text-fg-2">
          <span className="font-medium text-fg-muted">{log.actor === 'web' ? 'You' : 'AI / sync'}</span>{' '}
          <span data-tone={op.tone} className="tone-text font-medium">{op.verb}</span>{' '}
          {friendlyTable(log.table_name)}{' '}
          <span className="font-semibold text-fg">«{rowLabel(log)}»</span>
        </span>
        <span className="hidden shrink-0 text-meta tabular-nums text-fg-muted sm:block">{fmtDate(log.created_at)}</span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
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
export function CascadeBlock({ group, expandedId, onToggle }: { group: AuditLog[]; expandedId: string | null; onToggle: (id: string) => void }) {
  return (
    <div className="card overflow-hidden">
      <p className="section-label flex items-center gap-1.5 border-b border-line px-3 py-2">
        <Link2 aria-hidden className="h-3.5 w-3.5" /> Linked · same transaction · {group.length} changes
      </p>
      <div className="my-1 ml-3 divide-y divide-line border-l-2 border-accent-500/30 pl-2">
        {group.map(log => (
          <LogRow key={log.id} log={log} nested expanded={expandedId === log.id} onToggle={() => onToggle(log.id)} />
        ))}
      </div>
    </div>
  )
}
