import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, EmptyState, PageBoard, Skeleton } from '../../../shared/ui'
import { useErrorLogs, useClearErrorLogs } from '../hooks/useLogs'
import { ErrorDetail, ErrorList } from './ErrorLogRows'
import { LIST_DETAIL_BOARD, paneSelection, type ListDetailSection } from '../developerBoards'

// app_error_logs (last 2 days). On a wide page the picked error's message and
// context open in a pane beside the list (developerBoards.ts); on phones the
// context opens in place under its row.

export function ErrorLogTab() {
  const { data: logs = [], isLoading, isFetching, error, refetch } = useErrorLogs()
  const clearLogs = useClearErrorLogs()
  const modal = useEntityModal()
  const [picked, setPicked] = useState<string | null>(null)

  const shownId = paneSelection(logs.map(l => l.id), picked)
  const shown = logs.find(l => l.id === shownId) ?? null

  async function handleClear() {
    if (!(await modal.confirm({ title: 'Clear the error log?', message: 'Every logged error is deleted.', confirmLabel: 'Clear all', destructive: true }))) return
    clearLogs.mutate()
  }

  let list: ReactNode
  if (isLoading) {
    list = (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-14" />)}
      </div>
    )
  } else if (error) {
    list = (
      <EmptyState
        bordered
        icon={<AlertTriangle />}
        title="Couldn't load the error log"
        description={(error as Error).message}
        action={<Button size="sm" onClick={() => { void refetch() }}>Try again</Button>}
      />
    )
  } else if (logs.length === 0) {
    list = <EmptyState bordered icon={<CheckCircle2 />} title="No errors in the last 2 days" />
  } else {
    list = <ErrorList logs={logs} picked={shownId} onPick={setPicked} />
  }

  const sections: Record<ListDetailSection, ReactNode> = {
    toolbar: (
      <div className="flex flex-wrap items-center justify-between gap-2">
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
    ),
    list,
    detail: shown ? <ErrorDetail log={shown} /> : null,
  }

  return <PageBoard sections={sections} layout={LIST_DETAIL_BOARD} stackGap="gap-3" stackClassName="max-w-4xl" />
}
