import { useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { SegmentedControl, cx } from '../../../../shared/ui'
import { NO_OWNED_FILTERS, OWNED_SORT_LABEL, type OwnedFilters, type OwnedShow, type OwnedSort } from '../../ownModel'
import type { ShopCategory } from '../../types'

const SORTS = Object.keys(OWNED_SORT_LABEL) as OwnedSort[]
const active = (f: OwnedFilters) => f.q.trim() !== '' || f.category !== 'all' || f.show !== 'mine' || f.resaleOnly

/** Search, what to show (yours / sold or gone / all), category, "bought to sell" and the order. */
export function OwnedFiltersCard({ filters, onChange, sort, onSort, categories, collapsible }: {
  filters: OwnedFilters
  onChange: (f: OwnedFilters) => void
  sort: OwnedSort
  onSort: (s: OwnedSort) => void
  categories: readonly ShopCategory[]
  collapsible: boolean
}) {
  const [open, setOpen] = useState<boolean | null>(null)
  const set = (patch: Partial<OwnedFilters>) => onChange({ ...filters, ...patch })
  const picked = Number(filters.category !== 'all') + Number(filters.resaleOnly)
  const showMore = !collapsible || (open ?? picked > 0)
  const tops = categories.filter(c => !c.parent_id)
  return (
    <div className="flex flex-col gap-2">
      <label className="relative block max-w-md">
        <span className="sr-only">Search your things</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input type="search" value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Search your things" className="input pl-9" />
      </label>
      <SegmentedControl<OwnedShow> size="sm" fullWidth value={filters.show} onChange={show => set({ show })}
        options={[{ value: 'mine', label: 'Mine' }, { value: 'gone', label: 'Sold or gone' }, { value: 'all', label: 'All' }]} />
      <div className="grid grid-cols-2 gap-2">
        <select value={sort} onChange={e => onSort(e.target.value as OwnedSort)} aria-label="Sort" className="select">
          {SORTS.map(s => <option key={s} value={s}>{OWNED_SORT_LABEL[s]}</option>)}
        </select>
        {collapsible && (
          <button type="button" aria-expanded={showMore} onClick={() => setOpen(!showMore)}
            className={cx('btn-secondary justify-center gap-1.5', picked > 0 && 'text-accent-600')}>
            <SlidersHorizontal aria-hidden className="h-4 w-4" /> Filters{picked > 0 ? ` · ${picked}` : ''}
          </button>
        )}
        {showMore && <>
          <select value={filters.category} onChange={e => set({ category: e.target.value })} aria-label="Category" className="select">
            <option value="all">All categories</option>
            {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="none">No category</option>
          </select>
          <label className="flex min-h-[44px] items-center gap-2 text-body text-fg-2">
            <input type="checkbox" checked={filters.resaleOnly} onChange={e => set({ resaleOnly: e.target.checked })} className="h-4 w-4 accent-accent-500" />
            Bought to sell
          </label>
        </>}
      </div>
      {active(filters) && (
        <button type="button" onClick={() => onChange(NO_OWNED_FILTERS)}
          className="flex min-h-[44px] w-fit items-center gap-1 text-meta font-medium text-fg-muted transition-colors hover:text-fg-2">
          <X aria-hidden className="h-4 w-4" /> Clear filters
        </button>
      )}
    </div>
  )
}
