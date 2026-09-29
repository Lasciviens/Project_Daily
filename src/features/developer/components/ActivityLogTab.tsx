import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, History } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, EmptyState, PageBoard, Skeleton, useBoardStep } from '../../../shared/ui'
import { useAuditLogs, useClearAuditLogs, type AuditLog } from '../hooks/useLogs'
import { CascadeBlock, LogRow } from './ActivityLogRows'
import { ActivityLogDetail } from './ActivityLogDetail'
import { ActivityLogFilters, type ActivityFilterState } from './ActivityLogFilters'
import { DETAIL_PANE_FROM, LIST_DETAIL_BOARD, paneSelection, type ListDetailSection } from '../developerBoards'

// CRUD audit trail as a readable timeline. Range is a preset (incl. 1h) OR an
// explicit from/to window; type/operation/actor filter the loaded rows. On a
// wide page the picked change opens in a pane beside the list
// (developerBoards.ts → LIST_DETAIL_BOARD); on phones it opens in place.

function Timeline({ groups, expanded, onToggle, picked, onPick }: {
  groups: AuditLog[][]
  expanded: string | null
  onToggle: (id: string) => void
  picked: string | null
  onPick: (id: string) => void
}) {
  const paneMode = useBoardStep() >= DETAIL_PANE_FROM
  return (
    <div className="flex flex-col gap-2">
      {groups.map(group => (
        group.length === 1
          ? paneMode
            ? <LogRow key={group[0].id} log={group[0]} onSelect={() => onPick(group[0].id)} selected={picked === group[0].id} />
            : <LogRow key={group[0].id} log={group[0]} expanded={expanded === group[0].id} onToggle={() => onToggle(group[0].id)} />
          : paneMode
            ? <CascadeBlock key={group[0].id} group={group} selectedId={picked} onSelect={onPick} />
            : <CascadeBlock key={group[0].id} group={group} expandedId={expanded} onToggle={onToggle} />
      ))}
    </div>
  )
}

export function ActivityLogTab() {
  const [filters, setFilters] = useState<ActivityFilterState>({
    rangeHours: 168, customFrom: '', customTo: '', tableFilter: 'all', opFilter: 'all', actorFilter: 'all',
  })
  const { rangeHours, customFrom, customTo, tableFilter, opFilter, actorFilter } = filters
  const [expanded, setExpanded] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const { data: logs = [], isLoading, isFetching, error, refetch } = useAuditLogs({ rangeHours, customFrom, customTo })
  const clearLogs = useClearAuditLogs()
  const modal = useEntityModal()

  const tables = useMemo(() => [...new Set(logs.map(l => l.table_name))].sort(), [logs])

  const filtered = useMemo(() => logs.filter(l =>
    (tableFilter === 'all' || l.table_name === tableFilter) &&
    (opFilter === 'all' || l.operation === opFilter) &&
    (actorFilter === 'all' || l.actor === actorFilter)
  ), [logs, tableFilter, opFilter, actorFilter])

  const groups = useMemo(() => {
    const out: AuditLog[][] = []
    for (const log of filtered) {
      const last = out[out.length - 1]
      if (last && last[0].tx_id === log.tx_id) last.push(log)
      else out.push([log])
    }
    return out
  }, [filtered])

  const shownId = paneSelection(filtered.map(l => l.id), picked)
  const shown = filtered.find(l => l.id === shownId) ?? null
  const linkedCount = shown ? (groups.find(g => g.some(l => l.id === shown.id))?.length ?? 1) : 0

  async function handleClear() {
    if (!(await modal.confirm({ title: 'Clear the activity log?', message: 'Deleted-row snapshots go with it, so nothing here can be recovered afterwards.', confirmLabel: 'Clear all', destructive: true }))) return
    clearLogs.mutate()
  }

  let list: ReactNode
  if (isLoading) {
    list = (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-11" />)}
      </div>
    )
  } else if (error) {
    list = (
      <EmptyState
        bordered
        icon={<AlertTriangle />}
        title="Couldn't load the activity log"
        description={(error as Error).message}
        action={<Button size="sm" onClick={() => { void refetch() }}>Try again</Button>}
      />
    )
  } else if (filtered.length === 0) {
    list = <EmptyState bordered icon={<History />} title="No activity in this window" description={logs.length > 0 ? 'Loosen the filters to see more.' : undefined} />
  } else {
    list = <Timeline groups={groups} expanded={expanded} onToggle={id => setExpanded(e => e === id ? null : id)} picked={shownId} onPick={setPicked} />
  }

  const sections: Record<ListDetailSection, ReactNode> = {
    toolbar: (
      <ActivityLogFilters
        {...filters}
        set={patch => setFilters(f => ({ ...f, ...patch }))}
        tables={tables}
        hasLogs={logs.length > 0}
        isFetching={isFetching}
        onRefresh={() => { void refetch() }}
        onClear={() => { void handleClear() }}
        clearing={clearLogs.isPending}
      />
    ),
    list: (
      <div>
        {list}
        <p className="mt-3 text-meta tabular-nums text-fg-muted">{filtered.length} / {logs.length} entries · retention 30 days</p>
      </div>
    ),
    // Nothing listed → no pane: the list's own empty state already says so.
    detail: isLoading || error || !shown ? null : <ActivityLogDetail log={shown} linkedCount={linkedCount} />,
  }

  return <PageBoard sections={sections} layout={LIST_DETAIL_BOARD} stackGap="gap-3" stackClassName="max-w-4xl" />
}
