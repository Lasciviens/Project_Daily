import { useTestGameStore } from '../testGameStore'
import { STATUS_FILTERS, STATUS_TEXT, type StatusCounts } from '../testGameModel'
import type { PlayStatus } from '../../types'
import { TgMobileSheet } from './TgMobileSheet'

/**
 * A multi-select chip row: each chip toggles on its own, the leading "All"
 * chip is lit while nothing is picked and clears the picks when tapped.
 */
function ChipGroup<T extends string>({ label, allLabel, options, values, onToggle, onClear }: {
  label: string
  allLabel: string
  options: { value: T; label: string; count?: number }[]
  values: readonly T[]
  onToggle: (v: T) => void
  onClear: () => void
}) {
  const chip = (key: string, text: string, active: boolean, onClick: () => void, count?: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`tg-tab border ${
        active ? 'is-active border-transparent' : 'border-[var(--tg-border)] bg-[var(--tg-panel-2)]'
      }`}
    >
      <span>{text}</span>
      {count != null && <span className="tg-tab-count">{count}</span>}
    </button>
  )
  return (
    <section className="mt-5 first:mt-1">
      <h3 className="tg-section-label mb-2.5">
        {label}
        {values.length > 1 && <span className="ml-1.5 normal-case tracking-normal tg-muted">· {values.length} picked</span>}
      </h3>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {chip('__all', allLabel, values.length === 0, onClear)}
        {options.map(o => chip(o.value, o.label, values.includes(o.value), () => onToggle(o.value), o.count))}
      </div>
    </section>
  )
}

/** Status (Library only) and Genre, multi-select and bound live to the store; "Done" only closes. */
export function TgMobileFilterSheet({ open, onClose, genres, statusCounts, showStatus }: {
  open: boolean
  onClose: () => void
  genres: { genre: string; count: number }[]
  statusCounts: StatusCounts
  showStatus: boolean
}) {
  const statuses = useTestGameStore(s => s.statuses)
  const picked = useTestGameStore(s => s.genres)
  const toggleStatus = useTestGameStore(s => s.toggleStatus)
  const toggleGenre = useTestGameStore(s => s.toggleGenre)
  const setStatuses = useTestGameStore(s => s.setStatuses)
  const setGenres = useTestGameStore(s => s.setGenres)

  const changed = (showStatus && statuses.length > 0) || picked.length > 0
  function reset() {
    if (showStatus) setStatuses([])
    setGenres([])
  }

  // A genre picked on another shelf may have no games here; keep it listed
  // (at 0) so the empty grid it causes can be undone from this sheet.
  const missing = picked.filter(p => !genres.some(g => g.genre === p)).map(genre => ({ genre, count: 0 }))
  const genreList = [...missing, ...genres]

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
        <ChipGroup<PlayStatus>
          label="Status"
          allLabel="All"
          values={statuses}
          onToggle={toggleStatus}
          onClear={() => setStatuses([])}
          options={STATUS_FILTERS.filter(s => s !== 'all').map(s => ({
            value: s as PlayStatus, label: STATUS_TEXT[s], count: statusCounts[s],
          }))}
        />
      )}
      <ChipGroup<string>
        label="Genre"
        allLabel="All genres"
        values={picked}
        onToggle={toggleGenre}
        onClear={() => setGenres([])}
        options={genreList.map(g => ({ value: g.genre, label: g.genre, count: g.count }))}
      />
    </TgMobileSheet>
  )
}
