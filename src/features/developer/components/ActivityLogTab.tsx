import { useMemo, useState } from 'react'
import { AlertTriangle, History, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import { ModalShell, useEntityModal } from '../../../shared/modals'
import { Button, EmptyState, IconButton, Skeleton } from '../../../shared/ui'
import { haptic } from '../../../shared/utils/haptics'
import { useAuditLogs, useClearAuditLogs, type AuditLog } from '../hooks/useLogs'
import { CascadeBlock, LogRow } from './ActivityLogRows'
import { friendlyTable } from './activityLogMeta'

// CRUD audit trail as a readable timeline. Range is a preset (incl. 1h) OR an
// explicit from/to window; type/operation/actor filter the loaded rows.

const RANGES = [
  { label: 'Last 1h',      hours: 1 },
  { label: 'Last 24h',     hours: 24 },
  { label: 'Last 7 days',  hours: 168 },
  { label: 'Last 30 days', hours: 720 },
]

export function ActivityLogTab() {
  const [rangeHours, setRangeHours] = useState(168)
  const [customFrom, setCustomFrom] = useState('')   // datetime-local
  const [customTo, setCustomTo] = useState('')
  const [tableFilter, setTableFilter] = useState('all')
  const [opFilter, setOpFilter] = useState('all')
  const [actorFilter, setActorFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const usingCustom = !!(customFrom || customTo)
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

  const activeFilterCount =
    (tableFilter !== 'all' ? 1 : 0) + (opFilter !== 'all' ? 1 : 0) +
    (actorFilter !== 'all' ? 1 : 0) + (usingCustom ? 1 : 0)
  const toggle = (id: string) => setExpanded(e => e === id ? null : id)

  async function handleClear() {
    if (!(await modal.confirm({ title: 'Clear the activity log?', message: 'Deleted-row snapshots go with it, so nothing here can be recovered afterwards.', confirmLabel: 'Clear all', destructive: true }))) return
    clearLogs.mutate()
  }

  const rangeSelect = (className: string) => (
    <select
      value={rangeHours}
      onChange={e => { setRangeHours(Number(e.target.value)); setCustomFrom(''); setCustomTo('') }}
      aria-label="Time range"
      className={`select ${className} ${usingCustom ? 'opacity-50' : ''}`}
    >
      {RANGES.map(r => <option key={r.hours} value={r.hours}>{r.label}</option>)}
    </select>
  )

  const typeSelect = (className: string) => (
    <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} aria-label="Type" className={`select ${className}`}>
      <option value="all">All types</option>
      {tables.map(t => <option key={t} value={t}>{friendlyTable(t)}</option>)}
    </select>
  )
  const opSelect = (className: string) => (
    <select value={opFilter} onChange={e => setOpFilter(e.target.value)} aria-label="Operation" className={`select ${className}`}>
      <option value="all">All operations</option>
      <option value="INSERT">Created</option>
      <option value="UPDATE">Updated</option>
      <option value="DELETE">Deleted</option>
    </select>
  )
  const actorSelect = (className: string) => (
    <select value={actorFilter} onChange={e => setActorFilter(e.target.value)} aria-label="Actor" className={`select ${className}`}>
      <option value="all">All actors</option>
      <option value="web">You</option>
      <option value="service">AI / sync</option>
    </select>
  )

  const refreshButton = (
    <IconButton label="Refresh" bordered onClick={() => { void refetch() }} disabled={isFetching}>
      <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
    </IconButton>
  )

  return (
    <div className="max-w-4xl">
      {/* Filter bar — sm and up: everything inline */}
      <div className="mb-3 hidden flex-col gap-2 sm:flex">
        <div className="flex flex-wrap items-center gap-2">
          {typeSelect('w-auto')}
          {opSelect('w-auto')}
          {actorSelect('w-auto')}
          {rangeSelect('w-auto')}
          <div className="ml-auto flex items-center gap-1.5">
            {refreshButton}
            {logs.length > 0 && (
              <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => { void handleClear() }} loading={clearLogs.isPending} className="text-danger">
                Clear all
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
          <span>Or an exact window:</span>
          <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input w-auto max-w-[13rem]" aria-label="From" />
          <span aria-hidden>→</span>
          <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input w-auto max-w-[13rem]" aria-label="To" />
          {usingCustom && (
            <Button size="sm" variant="ghost" onClick={() => { setCustomFrom(''); setCustomTo('') }} className="text-accent-600">Clear window</Button>
          )}
        </div>
      </div>

      {/* Filter bar — phones: range + Filters + Refresh; the rest lives in a sheet */}
      <div className="mb-3 flex items-center gap-2 sm:hidden">
        {rangeSelect('min-w-0 flex-1')}
        <Button size="sm" icon={<SlidersHorizontal />} onClick={() => { haptic('light'); setFiltersOpen(true) }}>
          Filters
          {activeFilterCount > 0 && <span className="count-badge bg-accent-500 text-on-accent">{activeFilterCount}</span>}
        </Button>
        {refreshButton}
      </div>

      <ModalShell
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        size="sm"
        footer={
          <div className="flex items-center gap-2">
            {logs.length > 0 && (
              <Button variant="ghost" icon={<Trash2 />} onClick={() => { void handleClear() }} loading={clearLogs.isPending} className="text-danger">Clear all</Button>
            )}
            <Button variant="primary" onClick={() => setFiltersOpen(false)} className="ml-auto">Done</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <label><span className="field-label">Type</span>{typeSelect('')}</label>
          <label><span className="field-label">Operation</span>{opSelect('')}</label>
          <label><span className="field-label">Actor</span>{actorSelect('')}</label>
          <div className="flex flex-col gap-2">
            <span className="field-label mb-0">Exact window</span>
            <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input" aria-label="From" />
            <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input" aria-label="To" />
            {usingCustom && (
              <Button size="sm" variant="ghost" onClick={() => { setCustomFrom(''); setCustomTo('') }} className="self-start text-accent-600">Clear window</Button>
            )}
          </div>
        </div>
      </ModalShell>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-11" />)}
        </div>
      ) : error ? (
        <EmptyState
          bordered
          icon={<AlertTriangle />}
          title="Couldn't load the activity log"
          description={(error as Error).message}
          action={<Button size="sm" onClick={() => { void refetch() }}>Try again</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState bordered icon={<History />} title="No activity in this window" description={logs.length > 0 ? 'Loosen the filters to see more.' : undefined} />
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map(group => (
            group.length === 1
              ? <LogRow key={group[0].id} log={group[0]} expanded={expanded === group[0].id} onToggle={() => toggle(group[0].id)} />
              : <CascadeBlock key={group[0].id} group={group} expandedId={expanded} onToggle={toggle} />
          ))}
        </div>
      )}

      <p className="mt-3 text-meta tabular-nums text-fg-muted">{filtered.length} / {logs.length} entries · retention 30 days</p>
    </div>
  )
}
