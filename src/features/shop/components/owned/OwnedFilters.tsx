import { useState, type ReactNode } from 'react'
import { LayoutGrid, LayoutList, List, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button, SegmentedControl, cx } from '../../../../shared/ui'
import { NO_OWNED_FILTERS, OWNED_SORT_LABEL, ownedFilterCount, type OwnedFilters, type OwnedShow, type OwnedSort } from '../../ownModel'
import { SortSelect } from '../shopKit'
import type { OwnedLayout } from '../../hooks/useOwnedLayout'
import type { ShopCategory } from '../../types'

/** The three ways to see Owned's things: the compact rows (the default), a line each, or big pictures. */
const LAYOUTS: { value: OwnedLayout; label: string; icon: ReactNode }[] = [
  { value: 'rows', label: 'Rows', icon: <LayoutList aria-hidden className="h-4 w-4" /> },
  { value: 'lines', label: 'List', icon: <List aria-hidden className="h-4 w-4" /> },
  { value: 'pictures', label: 'Big pictures', icon: <LayoutGrid aria-hidden className="h-4 w-4" /> },
]

/**
 * The bar above your things — all small controls (the primitives' small sizes; owner, 23.11.2026): search, what to
 * show (yours / sold or gone / all — a tab, not a filter), the order and — folded on a phone or a short screen —
 * category or subcategory, money chain and "bought to sell". The view switch (rows · list · big pictures) and Fold
 * all are icons in this row, never a line of their own: on a wide screen they sit at the row's end, which is the
 * list's own edge, so the row uses the room the list has.
 */
export function OwnedFiltersCard({ filters, onChange, sort, onSort, categories, chains, collapsible, fold, layout, onLayout }: {
  filters: OwnedFilters
  onChange: (f: OwnedFilters) => void
  sort: OwnedSort
  onSort: (s: OwnedSort) => void
  categories: readonly ShopCategory[]
  /** The money chains to pick from: id and name (or path). */
  chains: readonly { id: string; title: string }[]
  collapsible: boolean
  /** Fold / open all categories: an icon button. */
  fold?: ReactNode
  layout: OwnedLayout
  onLayout: (l: OwnedLayout) => void
}) {
  const [open, setOpen] = useState<boolean | null>(null)
  const set = (patch: Partial<OwnedFilters>) => onChange({ ...filters, ...patch })
  const picked = Number(filters.category !== 'all') + Number(filters.resaleOnly) + Number(filters.chain !== 'all')
  const showMore = !collapsible || (open ?? picked > 0)
  const tops = categories.filter(c => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name))
  const select = cx('select input-sm', collapsible ? 'w-full' : 'w-[12rem] max-w-full')
  // Folded (a phone, a short screen): three rows — search with the icons at its end, Mine · Sold or gone · All, then the
  // sort and Filters. `order` puts the icons beside the search though they come last in the markup.
  const o = collapsible
    ? { search: 'order-1', group: 'order-2', seg: 'order-3', sort: 'order-4', filters: 'order-5', more: 'order-6', clear: 'order-7' }
    : { search: '', group: '', seg: '', sort: '', filters: '', more: '', clear: '' }
  const views = (
    <SegmentedControl<OwnedLayout> size="xs" label="How to show your things" value={layout} onChange={onLayout}
      options={LAYOUTS.map(l => ({ value: l.value, label: <span title={l.label} className="flex items-center">{l.icon}<span className="sr-only">{l.label}</span></span> }))} />
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className={cx('relative block min-w-0', collapsible ? 'flex-1 basis-40 sm:max-w-md' : 'flex-[0_1_16rem]', o.search)}>
        <span className="sr-only">Search your things</span>
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input type="search" value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Search things" className="input input-sm pl-8" />
      </label>
      <div className={cx('min-w-0', collapsible ? 'w-full' : 'w-auto', o.seg)}>
        <SegmentedControl<OwnedShow> size="xs" fullWidth={collapsible} value={filters.show} onChange={show => set({ show })}
          options={[{ value: 'mine', label: 'Mine' }, { value: 'gone', label: 'Sold or gone' }, { value: 'all', label: 'All' }]} />
      </div>
      <SortSelect value={sort} labels={OWNED_SORT_LABEL} onChange={onSort} className={cx(collapsible ? 'min-w-0 flex-1' : 'w-auto', o.sort)} />
      {collapsible && (
        <Button size="sm" aria-expanded={showMore} onClick={() => setOpen(!showMore)}
          className={cx('min-w-0 flex-1 justify-center gap-1.5', o.filters, picked > 0 && 'text-accent-600')} icon={<SlidersHorizontal />}>
          Filters{picked > 0 ? ` · ${picked}` : ''}
        </Button>
      )}
      {showMore && <div className={collapsible ? 'order-6 flex w-full flex-col gap-2' : 'contents'}>
        <select value={filters.category} onChange={e => set({ category: e.target.value })} aria-label="Category" className={select}>
          <option value="all">All categories</option>
          {tops.map(t => [
            <option key={t.id} value={t.id}>{t.name}</option>,
            ...categories.filter(c => c.parent_id === t.id).sort((a, b) => a.name.localeCompare(b.name))
              .map(c => <option key={c.id} value={c.id}>{`${t.name} › ${c.name}`}</option>),
          ])}
          <option value="none">No category</option>
        </select>
        {chains.length > 0 && (
          <select value={filters.chain} onChange={e => set({ chain: e.target.value })} aria-label="Money chain" className={select}>
            <option value="all">All money chains</option>
            {chains.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        <label className="flex min-h-[32px] items-center gap-2 text-body text-fg-2">
          <input type="checkbox" checked={filters.resaleOnly} onChange={e => set({ resaleOnly: e.target.checked })} className="h-[18px] w-[18px] accent-accent-500" />
          Bought to sell
        </label>
      </div>}
      {ownedFilterCount(filters) > 0 && (
        <button type="button" onClick={() => onChange({ ...NO_OWNED_FILTERS, show: filters.show })}
          className={cx('flex min-h-[32px] w-fit items-center gap-1 text-meta font-medium text-fg-muted transition-colors hover:text-fg-2', o.clear)}>
          <X aria-hidden className="h-4 w-4" /> Clear filters
        </button>
      )}
      {/* The row's end is the list's edge: the view switch and Fold all sit there on a wide screen (ml-auto). */}
      <div className={cx('flex shrink-0 items-center gap-2', collapsible ? o.group : 'ml-auto')}>
        {fold}
        {views}
      </div>
    </div>
  )
}
