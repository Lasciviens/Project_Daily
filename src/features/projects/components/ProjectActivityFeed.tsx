import { Card, CardHeader, SkeletonText, ToneDot, type Tone } from '../../../shared/ui'
import { useProjectActivity, type AuditLog } from '../../developer/hooks/useLogs'

// Recent activity for one project: the audit_logs rows (written by DB
// triggers) for the project itself, its phases and its items.

const OP_LABEL: Record<AuditLog['operation'], string> = { INSERT: 'added', UPDATE: 'updated', DELETE: 'removed' }
const OP_TONE: Record<AuditLog['operation'], Tone> = { INSERT: 'success', UPDATE: 'info', DELETE: 'danger' }

function rowLabel(log: AuditLog): string {
  const d = (log.new_data ?? log.old_data ?? {}) as Record<string, unknown>
  const v = d['title'] ?? d['name']
  return typeof v === 'string' && v.trim() ? v : '—'
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ProjectActivityFeed({ projectId, itemIds, phaseIds }: { projectId: string; itemIds: string[]; phaseIds: string[] }) {
  const { data: logs = [], isLoading, isError, refetch } = useProjectActivity(projectId, itemIds, phaseIds)

  return (
    <Card>
      <CardHeader title="Activity" variant="label" />
      {isLoading ? (
        <SkeletonText lines={3} />
      ) : isError ? (
        <p className="text-meta text-fg-muted">
          Couldn't load activity. <button type="button" onClick={() => { void refetch() }} className="font-semibold text-accent-600">Try again</button>
        </p>
      ) : logs.length === 0 ? (
        <p className="text-meta text-fg-muted">No recent activity yet.</p>
      ) : (
        <ul className="flex max-h-[280px] flex-col gap-2 overflow-y-auto scroll-y">
          {logs.map(log => (
            <li key={log.id} className="flex items-start gap-2">
              <ToneDot tone={OP_TONE[log.operation]} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-fg-2">
                  <span className="font-medium text-fg">{rowLabel(log)}</span> {OP_LABEL[log.operation]}
                </p>
                <p className="text-micro text-fg-muted tabular-nums">{fmtWhen(log.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
