import { useState } from 'react'
import { ArrowUpDown, SlidersHorizontal } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import { SORT_LABEL, type StatusCounts } from '../testGameModel'
import { TgMobileFilterSheet } from './TgMobileFilterSheet'
import { TgMobileSortSheet } from './TgMobileSortSheet'

/**
 * The phone's Sort and Filter buttons, right of the scope pill, with the
 * sheets they open. Sort is its own button (an order is not a narrowing), so
 * only status and genre picks light the filter button's dot.
 */
export function TgMobileListTools({ genres, statusCounts, showStatus, showSort }: {
  genres: { genre: string; count: number }[]
  statusCounts: StatusCounts
  showStatus: boolean
  showSort: boolean
}) {
  const statuses = useTestGameStore(s => s.statuses)
  const pickedGenres = useTestGameStore(s => s.genres)
  const sort = useTestGameStore(s => s.sort)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const filtered = (showStatus && statuses.length > 0) || pickedGenres.length > 0

  return (
    <div className="flex min-w-0 shrink items-center gap-2">
      {showSort && (
        <button
          type="button"
          onClick={() => setSortOpen(true)}
          aria-label={`Sort: ${SORT_LABEL[sort]}`}
          className="tg-select min-h-[44px] min-w-[44px] max-w-[9.5rem] justify-center !bg-[var(--tg-panel-2)] max-[359px]:!px-0"
        >
          <ArrowUpDown aria-hidden size={16} strokeWidth={2} className="shrink-0" />
          <span className="min-w-0 truncate max-[359px]:hidden">{SORT_LABEL[sort]}</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setFiltersOpen(true)}
        aria-label={filtered ? 'Filters (active)' : 'Filters'}
        className="tg-icon-btn is-bordered relative shrink-0"
      >
        <SlidersHorizontal size={18} strokeWidth={1.9} />
        {filtered && (
          <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--tg-accent)] ring-2 ring-[var(--tg-panel-2)]" />
        )}
      </button>

      <TgMobileFilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        genres={genres}
        statusCounts={statusCounts}
        showStatus={showStatus}
      />
      {showSort && <TgMobileSortSheet open={sortOpen} onClose={() => setSortOpen(false)} />}
    </div>
  )
}
