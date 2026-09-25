import { useTestGameStore } from '../testGameStore'
import {
  SORT_LABEL, STATUS_FILTERS, STATUS_TEXT,
  type StatusCounts, type TgSort, type TgStatusFilter,
} from '../testGameModel'
import { TgMobileSheet } from './TgMobileSheet'

const SORTS = Object.keys(SORT_LABEL) as TgSort[]
// Genre is nullable in the store; the chip row needs a string key for "All".
const ALL_GENRES = ''

function ChipGroup<T extends string>({ label, options, value, onChange }: {
  label: string
  options: { value: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <section className="mt-5 first:mt-1">
      <h3 className="tg-section-label mb-2.5">{label}</h3>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(o => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={`tg-tab border ${
                active ? 'is-active border-transparent' : 'border-[var(--tg-border)] bg-[var(--tg-panel-2)]'
              }`}
            >
              <span>{o.label}</span>
              {o.count != null && <span className="tg-tab-count">{o.count}</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** Status (Library only), Genre and Sort — bound live to the store; "Done" only closes. */
export function TgMobileFilterSheet({ open, onClose, genres, statusCounts, showStatus, showSort }: {
  open: boolean
  onClose: () => void
  genres: { genre: string; count: number }[]
  statusCounts: StatusCounts
  showStatus: boolean
  showSort: boolean
}) {
  const status = useTestGameStore(s => s.status)
  const genre = useTestGameStore(s => s.genre)
  const sort = useTestGameStore(s => s.sort)
  const setStatus = useTestGameStore(s => s.setStatus)
  const setGenre = useTestGameStore(s => s.setGenre)
  const setSort = useTestGameStore(s => s.setSort)

  const changed = (showStatus && status !== 'all') || genre != null || (showSort && sort !== 'title')
  function reset() {
    if (showStatus) setStatus('all')
    setGenre(null)
    if (showSort) setSort('title')
  }

  // A genre picked on another shelf may have no games here; keep it listed
  // (at 0) so the empty grid it causes can be undone from this sheet.
  const genreList = genre && !genres.some(g => g.genre === genre) ? [{ genre, count: 0 }, ...genres] : genres

  return (
    <TgMobileSheet
      open={open}
      onClose={onClose}
      title="Filters"
      action={changed && (
        <button
          type="button"
          onClick={reset}
          className="-mr-3 min-h-[44px] rounded-lg px-3 text-[14px] font-semibold text-[var(--tg-accent)]"
        >
          Reset
        </button>
      )}
      footer={
        <button type="button" onClick={onClose} className="tg-btn tg-btn-primary w-full">
          Done
        </button>
      }
    >
      {showStatus && (
        <ChipGroup<TgStatusFilter>
          label="Status"
          value={status}
          onChange={setStatus}
          options={STATUS_FILTERS.map(s => ({ value: s, label: STATUS_TEXT[s], count: statusCounts[s] }))}
        />
      )}
      <ChipGroup<string>
        label="Genre"
        value={genre ?? ALL_GENRES}
        onChange={v => setGenre(v === ALL_GENRES ? null : v)}
        options={[
          { value: ALL_GENRES, label: 'All genres' },
          ...genreList.map(g => ({ value: g.genre, label: g.genre, count: g.count })),
        ]}
      />
      {showSort && (
        <ChipGroup<TgSort>
          label="Sort by"
          value={sort}
          onChange={setSort}
          options={SORTS.map(s => ({ value: s, label: SORT_LABEL[s] }))}
        />
      )}
    </TgMobileSheet>
  )
}
