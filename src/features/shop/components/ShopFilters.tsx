import { useState, type ReactNode } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { filtersActive, NO_FILTERS, SORT_LABEL, type ShopSort, type WishlistFilters } from '../shopModel'
import { SortSelect } from './shopKit'
import type { ShopCategory } from '../types'

/**
 * Search, sort and the three filters, and `fold` (fold all categories). On a
 * wide page they are one bar across the top (as Owned's), Fold all at its
 * end; on a phone or a short screen (`collapsible`) the filters fold behind
 * one button, beside the sort and Fold all as an icon, so the list starts on
 * the first screen.
 */
export function ShopFilters({ filters, onChange, sort, onSort, categories, collapsible = false, fold }: {
  filters: WishlistFilters
  onChange: (f: WishlistFilters) => void
  sort: ShopSort
  onSort: (s: ShopSort) => void
  categories: readonly ShopCategory[]
  collapsible?: boolean
  fold?: ReactNode
}) {
  // null until the Filters button is used: then it alone decides, so a tap
  // folds the selects away even while a filter is set.
  const [open, setOpen] = useState<boolean | null>(null)
  const tops = categories.filter(c => !c.parent_id)
  const set = (patch: Partial<WishlistFilters>) => onChange({ ...filters, ...patch })
  const picked = Number(filters.category !== 'all') + Number(filters.region !== 'all') + Number(filters.priority !== 'all')
  const showSelects = !collapsible || (open ?? picked > 0)

  const select = cx('select', collapsible ? 'w-full' : 'w-auto max-w-[16rem]')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className={cx('relative block', collapsible ? 'w-full' : 'min-w-[14rem] max-w-md flex-1')}>
        <span className="sr-only">Search the wishlist</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input type="search" value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Search the wishlist" className="input pl-9" />
      </label>
      <SortSelect value={sort} labels={SORT_LABEL} onChange={onSort} className={collapsible ? 'min-w-0 flex-1' : 'w-auto'} />
      {collapsible && (
        <button type="button" aria-expanded={showSelects} onClick={() => setOpen(!showSelects)}
          className={cx('btn-secondary min-w-0 flex-1 justify-center gap-1.5', picked > 0 && 'text-accent-600')}>
          <SlidersHorizontal aria-hidden className="h-4 w-4" /> Filters{picked > 0 ? ` · ${picked}` : ''}
        </button>
      )}
      {collapsible && fold}
      {showSelects && (
        <div className={collapsible ? 'grid w-full grid-cols-2 gap-2' : 'contents'}>
          <select value={filters.category} onChange={e => set({ category: e.target.value })} aria-label="Category" className={select}>
            <option value="all">All categories</option>
            {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="none">No category</option>
          </select>
          <select value={filters.region} onChange={e => set({ region: e.target.value as WishlistFilters['region'] })} aria-label="Where to buy" className={select}>
            <option value="all">Anywhere</option>
            <option value="NO">🇳🇴 Norway</option>
            <option value="TR">🇹🇷 Turkey</option>
            <option value="none">No country set</option>
          </select>
          <select value={filters.priority} onChange={e => set({ priority: e.target.value as WishlistFilters['priority'] })} aria-label="Priority" className={select}>
            <option value="all">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      )}
      {filtersActive(filters) && (
        <button type="button" onClick={() => onChange(NO_FILTERS)}
          className="flex min-h-[44px] w-fit items-center gap-1 text-meta font-medium text-fg-muted transition-colors hover:text-fg-2">
          <X aria-hidden className="h-4 w-4" /> Clear filters
        </button>
      )}
      {!collapsible && <span className="ml-2">{fold}</span>}
    </div>
  )
}
