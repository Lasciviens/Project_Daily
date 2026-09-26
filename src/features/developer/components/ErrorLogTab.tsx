import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from '../../../app/store'
import { useEntityModal } from '../../../shared/modals'
import { Button, EmptyState, IconButton, Skeleton, ToneDot, cx } from '../../../shared/ui'
import { useErrorLogs, useClearErrorLogs } from '../hooks/useLogs'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => toast.success('Copied'))
    .catch(() => toast.error('Copy failed'))
}

export function ErrorLogTab() {
  const { data: logs = [], isLoading, isFetching, error, refetch } = useErrorLogs()
  const clearLogs = useClearErrorLogs()
  const modal = useEntityModal()
  const [expanded, setExpanded] = useState<string | null>(null)

  async function handleClear() {
    if (!(await modal.confirm({ title: 'Clear the error log?', message: 'Every logged error is deleted.', confirmLabel: 'Clear all', destructive: true }))) return
    clearLogs.mutate()
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-fg-muted tabular-nums">Last 2 days · {logs.length} entr{logs.length === 1 ? 'y' : 'ies'}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" icon={<RefreshCw className={isFetching ? 'animate-spin' : undefined} />} onClick={() => { void refetch() }} disabled={isFetching}>
            Refresh
          </Button>
          {logs.length > 0 && (
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => { void handleClear() }} loading={clearLogs.isPending} className="text-danger">
              Clear all
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-14" />)}
        </div>
      ) : error ? (
        <EmptyState
          bordered
          icon={<AlertTriangle />}
          title="Couldn't load the error log"
          description={(error as Error).message}
          action={<Button size="sm" onClick={() => { void refetch() }}>Try again</Button>}
        />
      ) : logs.length === 0 ? (
        <EmptyState bordered icon={<CheckCircle2 />} title="No errors in the last 2 days" />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {logs.map(log => {
            const isOpen = expanded === log.id
            const hasContext = !!log.context && Object.keys(log.context).length > 0
            return (
              <li key={log.id}>
                <div className="flex items-start gap-3 py-2 pl-4 pr-2">
                  <ToneDot tone="danger" className="mt-2" />
                  <div className="min-w-0 flex-1 py-1">
                    <p className="break-words text-body text-fg">{log.message}</p>
                    <p className="mt-0.5 text-meta tabular-nums text-fg-muted">{fmtDate(log.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <IconButton label="Copy message" onClick={() => copyText(log.message)}><Copy /></IconButton>
                    {hasContext && (
                      <IconButton label={isOpen ? 'Hide context' : 'Show context'} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : log.id)}>
                        <ChevronDown className={cx('transition-transform', isOpen && 'rotate-180')} />
                      </IconButton>
                    )}
                  </div>
                </div>
                {isOpen && hasContext && (
                  <div className="border-t border-line bg-surface-2 px-4 py-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="section-label">Context</span>
                      <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => copyText(JSON.stringify(log.context, null, 2))}>Copy JSON</Button>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-meta text-fg-2">
                      {JSON.stringify(log.context, null, 2)}
                    </pre>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
