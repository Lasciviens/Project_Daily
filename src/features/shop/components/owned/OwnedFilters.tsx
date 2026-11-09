import { useState, type ReactNode } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { SegmentedControl, cx } from '../../../../shared/ui'
import { NO_OWNED_FILTERS, OWNED_SORT_LABEL, ownedFilterCount, type OwnedFilters, type OwnedShow, type OwnedSort } from '../../ownModel'
import { SortSelect } from '../shopKit'
import type { ShopCategory } from '../../types'

/**
 * The bar above your things: search, what to show (yours / sold or gone /
 * all — a tab, not a filter), the order, and — folded on a phone or a short
 * screen — category or subcategory, money chain and "bought to sell".
 */
export function OwnedFiltersCard({ filters, onChange, sort, onSort, categories, chains, collapsible, fold }: {
  filters: OwnedFilters
  onChange: (f: OwnedFilters) => void
  sort: OwnedSort
  onSort: (s: OwnedSort) => void
  categories: readonly ShopCategory[]
  /** The money chains to pick from: id and name (or path). */
  chains: readonly { id: string; title: string }[]
  collapsible: boolean
  /** Fold / open all categories, at the end of the folded row. */
  fold?: ReactNode
}) {
  const [open, setOpen] = useState<boolean | null>(null)
  const set = (patch: Partial<OwnedFilters>) => onChange({ ...filters, ...patch })
  const picked = Number(filters.category !== 'all') + Number(filters.resaleOnly) + Number(filters.chain !== 'all')
  const showMore = !collapsible || (open ?? picked > 0)
  const tops = categories.filter(c => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative block w-full sm:w-auto sm:min-w-[14rem] sm:max-w-md sm:flex-1">
        <span className="sr-only">Search your things</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input type="search" value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Search your things" className="input pl-9" />
      </label>
      <div className="w-full sm:w-auto">
        <SegmentedControl<OwnedShow> size="sm" fullWidth={collapsible} value={filters.show} onChange={show => set({ show })}
          options={[{ value: 'mine', label: 'Mine' }, { value: 'gone', label: 'Sold or gone' }, { value: 'all', label: 'All' }]} />
      </div>
      <SortSelect value={sort} labels={OWNED_SORT_LABEL} onChange={onSort} className={collapsible ? 'min-w-0 flex-1' : 'w-auto'} />
      {collapsible && (
        <button type="button" aria-expanded={showMore} onClick={() => setOpen(!showMore)}
          className={cx('btn-secondary min-w-0 flex-1 justify-center gap-1.5', picked > 0 && 'text-accent-600')}>
          <SlidersHorizontal aria-hidden className="h-4 w-4" /> Filters{picked > 0 ? ` · ${picked}` : ''}
        </button>
      )}
      {collapsible && fold}
      {showMore && <>
        <select value={filters.category} onChange={e => set({ category: e.target.value })} aria-label="Category" className={cx('select', collapsible ? 'w-full' : 'w-auto max-w-[16rem]')}>
          <option value="all">All categories</option>
          {tops.map(t => [
            <option key={t.id} value={t.id}>{t.name}</option>,
            ...categories.filter(c => c.parent_id === t.id).sort((a, b) => a.name.localeCompare(b.name))
              .map(c => <option key={c.id} value={c.id}>{`${t.name} › ${c.name}`}</option>),
          ])}
          <option value="none">No category</option>
        </select>
        {chains.length > 0 && (
          <select value={filters.chain} onChange={e => set({ chain: e.target.value })} aria-label="Money chain" className={cx('select', collapsible ? 'w-full' : 'w-auto max-w-[16rem]')}>
            <option value="all">All money chains</option>
            {chains.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        <label className="flex min-h-[44px] items-center gap-2 text-body text-fg-2">
          <input type="checkbox" checked={filters.resaleOnly} onChange={e => set({ resaleOnly: e.target.checked })} className="h-[18px] w-[18px] accent-accent-500" />
          Bought to sell
        </label>
      </>}
      {ownedFilterCount(filters) > 0 && (
        <button type="button" onClick={() => onChange({ ...NO_OWNED_FILTERS, show: filters.show })}
          className="flex min-h-[44px] w-fit items-center gap-1 text-meta font-medium text-fg-muted transition-colors hover:text-fg-2">
          <X aria-hidden className="h-4 w-4" /> Clear filters
        </button>
      )}
    </div>
  )
}
