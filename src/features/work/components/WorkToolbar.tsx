import { useState } from 'react'
import { LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react'
import type { TaskPriority } from '../../todo/types'
import { Button, IconButton, SegmentedControl } from '../../../shared/ui'
import { ModalShell } from '../../../shared/modals'

export type ViewMode = 'board' | 'list'
export type PrioFilter = 'all' | TaskPriority

interface Props {
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  search: string
  onSearchChange: (v: string) => void
  prio: PrioFilter
  onPrioChange: (v: PrioFilter) => void
  onQuickAdd: (title: string) => void
  quickAddBusy: boolean
}

const PRIO_OPTIONS: { value: PrioFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
]

// View switch + quick add + filters. Search and priority sit inline from sm:
// and collapse into one filter sheet on phones.
export default function WorkToolbar({
  view, onViewChange, search, onSearchChange, prio, onPrioChange, onQuickAdd, quickAddBusy,
}: Props) {
  const [quickTitle, setQuickTitle] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const filtersActive = search.trim() !== '' || prio !== 'all'

  function submitQuickAdd(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !quickTitle.trim()) return
    onQuickAdd(quickTitle.trim())
    setQuickTitle('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl<ViewMode>
        value={view}
        onChange={onViewChange}
        options={[
          { value: 'board', label: <><LayoutGrid aria-hidden className="h-4 w-4" />Board</> },
          { value: 'list', label: <><List aria-hidden className="h-4 w-4" />List</> },
        ]}
      />

      <input
        value={quickTitle}
        onChange={e => setQuickTitle(e.target.value)}
        onKeyDown={submitQuickAdd}
        placeholder="Quick add a task… (Enter)"
        aria-label="Quick add a work task"
        disabled={quickAddBusy}
        className="input order-last w-full disabled:opacity-50 sm:order-none sm:w-auto sm:min-w-[14rem] sm:max-w-md sm:flex-1"
      />

      <label className="relative hidden w-56 sm:block">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="input pl-9"
        />
      </label>
      <select
        value={prio}
        onChange={e => onPrioChange(e.target.value as PrioFilter)}
        aria-label="Priority filter"
        className="select hidden w-auto sm:block"
      >
        <option value="all">All priorities</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>

      <IconButton label="Filter tasks" bordered onClick={() => setFilterOpen(true)} className="relative ml-auto sm:hidden">
        <SlidersHorizontal />
        {filtersActive && <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent-500" />}
      </IconButton>

      <ModalShell
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filter tasks"
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => { onSearchChange(''); onPrioChange('all') }} disabled={!filtersActive}>Clear</Button>
            <Button variant="primary" onClick={() => setFilterOpen(false)}>Done</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="work-filter-search" className="field-label">Search</label>
            <input id="work-filter-search" value={search} onChange={e => onSearchChange(e.target.value)} placeholder="Search tasks" className="input" />
          </div>
          <div>
            <span className="field-label">Priority</span>
            <SegmentedControl<PrioFilter> fullWidth size="sm" value={prio} onChange={onPrioChange} options={PRIO_OPTIONS} />
          </div>
        </div>
      </ModalShell>
    </div>
  )
}
