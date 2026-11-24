import { useState, type ReactNode } from 'react'
import { LayoutGrid, LayoutList, List, Search, SlidersHorizontal, Tag, X } from 'lucide-react'
import { Button, SegmentedControl, cx } from '../../../../shared/ui'
import { useElementWidthRem } from '../../../../shared/hooks/useElementWidth'
import { NO_OWNED_FILTERS, OWNED_SORT_LABEL, ownedFilterCount, type OwnedFilters, type OwnedShow, type OwnedSort } from '../../ownModel'
import { filterRowMode } from '../../ownedRow'
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
 * The bar above your things — every control one height (36px, 44 on touch; owner, 23.11.2026): search, what to show
 * (yours / sold or gone / all — a tab, not a filter), the order, category or subcategory, money chain and "bought to
 * sell". It measures its own width (`filterRowMode`) and is ONE line wherever it can be: the controls that do not
 * fit fold behind Filters; a phone turned sideways takes two rows, a phone three. The view switch (rows · list · big
 * pictures) and Fold all are icons in this row, never a line of their own, at its end — the list's own edge.
 */
export function OwnedFiltersCard({ filters, onChange, sort, onSort, categories, chains, fold, layout, onLayout }: {
  filters: OwnedFilters
  onChange: (f: OwnedFilters) => void
  sort: OwnedSort
  onSort: (s: OwnedSort) => void
  categories: readonly ShopCategory[]
  /** The money chains to pick from: id and name (or path). */
  chains: readonly { id: string; title: string }[]
  /** Fold / open all categories: an icon button. */
  fold?: ReactNode
  layout: OwnedLayout
  onLayout: (l: OwnedLayout) => void
}) {
  const [open, setOpen] = useState<boolean | null>(null)
  const { ref, width } = useElementWidthRem<HTMLDivElement>()
  const set = (patch: Partial<OwnedFilters>) => onChange({ ...filters, ...patch })
  const picked = Number(filters.category !== 'all') + Number(filters.resaleOnly) + Number(filters.chain !== 'all')
  const cleared = ownedFilterCount(filters) > 0
  const mode = filterRowMode(width, { chains: chains.length > 0, clear: cleared })
  const oneLine = mode === 'full' || mode === 'line'
  const behind = mode !== 'full'
  const showMore = !behind || (open ?? picked > 0)
  const tops = categories.filter(c => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name))
  // Content-sized (W3), up to a cap: the long "Electronics › Computers & Laptops" never takes the row.
  // Folded, the selects share one wrapping row with To sell (a select grows, so the toggle never takes a line alone).
  const select = cx('select input-bar w-auto max-w-[12rem]', (mode === 'roomy' || mode === 'narrow') && 'min-w-0 max-w-none flex-1 basis-40')
  // Folded: `order` puts the icons beside the search though they come last in the markup.
  const o = mode === 'narrow'
    ? { search: 'order-1', group: 'order-2', seg: 'order-3 w-full', sort: 'order-4', filters: 'order-5', more: 'order-6', clear: 'order-7' }
    : mode === 'roomy'
      ? { search: 'order-1', group: 'order-3', seg: 'order-2', sort: 'order-4', filters: 'order-5', more: 'order-6', clear: 'order-7' }
      : { search: '', group: '', seg: '', sort: '', filters: '', more: '', clear: '' }
  const views = (
    <SegmentedControl<OwnedLayout> size="sm" label="How to show your things" value={layout} onChange={onLayout}
      options={LAYOUTS.map(l => ({ value: l.value, tip: l.label, label: <span className="flex items-center">{l.icon}</span> }))} />
  )
  const extras = (
    <div className={cx(mode === 'full' ? 'contents' : mode === 'line' ? 'mt-2 flex flex-wrap items-center gap-2' : cx('flex w-full flex-wrap items-center gap-2', o.more))}>
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
          <option value="all">All chains</option>
          {chains.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      )}
      {/* A switch as a short word (owner, 24.11.2026: short buttons; critic: an icon alone was unclear): its words in the tooltip. */}
      <Button size="sm" icon={<Tag />} aria-pressed={filters.resaleOnly} onClick={() => set({ resaleOnly: !filters.resaleOnly })} tip="To sell — only things bought to sell"
        className={cx('shrink-0', filters.resaleOnly && '!border-accent-500 !bg-accent-50 !text-accent-600')}>To sell</Button>
    </div>
  )
  return (
    <div ref={ref} className="min-w-0">
      <div className={cx('flex items-center gap-2', oneLine ? 'flex-nowrap' : 'flex-wrap')}>
        <label className={cx('relative block min-w-0', mode === 'narrow' || mode === 'roomy' ? 'flex-1 basis-40' : 'flex-[0_1_16rem]', o.search)}>
          <span className="sr-only">Search your things</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input type="search" value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Search" className="input input-bar pl-8" />
        </label>
        <div className={cx('shrink-0', o.seg)}>
          <SegmentedControl<OwnedShow> size="sm" fullWidth={mode === 'narrow'} value={filters.show} onChange={show => set({ show })}
            options={[{ value: 'mine', label: 'Mine', tip: 'Mine — still yours' }, { value: 'gone', label: 'Gone', tip: 'Gone — sold or gone' }, { value: 'all', label: 'All', tip: 'All — yours and gone' }]} />
        </div>
        <SortSelect value={sort} labels={OWNED_SORT_LABEL} onChange={onSort} className={cx(oneLine ? 'w-auto shrink-0' : 'min-w-0 flex-1 basis-32', o.sort)} />
        {behind && (
          <Button size="sm" aria-expanded={showMore} onClick={() => setOpen(!showMore)}
            className={cx(oneLine ? 'shrink-0' : 'min-w-0 flex-1 basis-24 justify-center', o.filters, picked > 0 && 'text-accent-600')} icon={<SlidersHorizontal />}>
            Filters{picked > 0 ? ` · ${picked}` : ''}
          </Button>
        )}
        {showMore && mode !== 'line' && extras}
        {cleared && (
          <button type="button" onClick={() => onChange({ ...NO_OWNED_FILTERS, show: filters.show })} title="Clear filters" aria-label="Clear filters"
            className={cx('flex min-h-[36px] w-fit shrink-0 items-center gap-1 whitespace-nowrap text-meta font-medium text-fg-muted transition-colors hover:text-fg-2 [@media(pointer:coarse)]:min-h-[44px]', o.clear)}>
            <X aria-hidden className="h-4 w-4" /> Clear
          </button>
        )}
        <div className={cx('flex shrink-0 items-center gap-2', oneLine ? 'ml-auto' : o.group)}>
          {fold}
          {views}
        </div>
      </div>
      {showMore && mode === 'line' && extras}
    </div>
  )
}
