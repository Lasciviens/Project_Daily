import { useState } from 'react'
import { RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, IconButton } from '../../../shared/ui'
import { haptic } from '../../../shared/utils/haptics'
import { friendlyTable } from './activityLogMeta'

// The Activity tab's filter bar: everything inline from sm, a range select +
// a Filters sheet on phones.

const RANGES = [
  { label: 'Last 1h',      hours: 1 },
  { label: 'Last 24h',     hours: 24 },
  { label: 'Last 7 days',  hours: 168 },
  { label: 'Last 30 days', hours: 720 },
]

export interface ActivityFilterState {
  rangeHours: number
  customFrom: string
  customTo: string
  tableFilter: string
  opFilter: string
  actorFilter: string
}

interface Props extends ActivityFilterState {
  set: (patch: Partial<ActivityFilterState>) => void
  tables: string[]
  hasLogs: boolean
  isFetching: boolean
  onRefresh: () => void
  onClear: () => void
  clearing: boolean
}

export function ActivityLogFilters({
  rangeHours, customFrom, customTo, tableFilter, opFilter, actorFilter,
  set, tables, hasLogs, isFetching, onRefresh, onClear, clearing,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const usingCustom = !!(customFrom || customTo)
  const activeFilterCount =
    (tableFilter !== 'all' ? 1 : 0) + (opFilter !== 'all' ? 1 : 0) +
    (actorFilter !== 'all' ? 1 : 0) + (usingCustom ? 1 : 0)

  const rangeSelect = (className: string) => (
    <select
      value={rangeHours}
      onChange={e => set({ rangeHours: Number(e.target.value), customFrom: '', customTo: '' })}
      aria-label="Time range"
      className={`select ${className} ${usingCustom ? 'opacity-50' : ''}`}
    >
      {RANGES.map(r => <option key={r.hours} value={r.hours}>{r.label}</option>)}
    </select>
  )
  const typeSelect = (className: string) => (
    <select value={tableFilter} onChange={e => set({ tableFilter: e.target.value })} aria-label="Type" className={`select ${className}`}>
      <option value="all">All types</option>
      {tables.map(t => <option key={t} value={t}>{friendlyTable(t)}</option>)}
    </select>
  )
  const opSelect = (className: string) => (
    <select value={opFilter} onChange={e => set({ opFilter: e.target.value })} aria-label="Operation" className={`select ${className}`}>
      <option value="all">All operations</option>
      <option value="INSERT">Created</option>
      <option value="UPDATE">Updated</option>
      <option value="DELETE">Deleted</option>
    </select>
  )
  const actorSelect = (className: string) => (
    <select value={actorFilter} onChange={e => set({ actorFilter: e.target.value })} aria-label="Actor" className={`select ${className}`}>
      <option value="all">All actors</option>
      <option value="web">You</option>
      <option value="service">AI / sync</option>
    </select>
  )
  const refreshButton = (
    <IconButton label="Refresh" bordered onClick={onRefresh} disabled={isFetching}>
      <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
    </IconButton>
  )
  const clearWindow = () => set({ customFrom: '', customTo: '' })

  return (
    <div>
      {/* sm and up: everything inline */}
      <div className="hidden flex-col gap-2 sm:flex">
        <div className="flex flex-wrap items-center gap-2">
          {typeSelect('w-auto')}
          {opSelect('w-auto')}
          {actorSelect('w-auto')}
          {rangeSelect('w-auto')}
          <div className="ml-auto flex items-center gap-1.5">
            {refreshButton}
            {hasLogs && (
              <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={onClear} loading={clearing} className="text-danger">
                Clear all
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
          <span>Or an exact window:</span>
          <input type="datetime-local" value={customFrom} onChange={e => set({ customFrom: e.target.value })} className="input w-auto max-w-[13rem]" aria-label="From" />
          <span aria-hidden>→</span>
          <input type="datetime-local" value={customTo} onChange={e => set({ customTo: e.target.value })} className="input w-auto max-w-[13rem]" aria-label="To" />
          {usingCustom && (
            <Button size="sm" variant="ghost" onClick={clearWindow} className="text-accent-600">Clear window</Button>
          )}
        </div>
      </div>

      {/* Phones: range + Filters + Refresh; the rest lives in a sheet */}
      <div className="flex items-center gap-2 sm:hidden">
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
            {hasLogs && (
              <Button variant="ghost" icon={<Trash2 />} onClick={onClear} loading={clearing} className="text-danger">Clear all</Button>
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
            <input type="datetime-local" value={customFrom} onChange={e => set({ customFrom: e.target.value })} className="input" aria-label="From" />
            <input type="datetime-local" value={customTo} onChange={e => set({ customTo: e.target.value })} className="input" aria-label="To" />
            {usingCustom && (
              <Button size="sm" variant="ghost" onClick={clearWindow} className="self-start text-accent-600">Clear window</Button>
            )}
          </div>
        </div>
      </ModalShell>
    </div>
  )
}
