import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ArrowUpDown, Building2, ListFilter, Tags } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import {
  DEFAULT_SORT, SORT_LABEL, STATUS_FILTERS, STATUS_TEXT, genreKey, multiLabel,
  type StatusCounts, type TgSort, type TgStatusFilter,
} from '../testGameModel'
import type { PlayStatus } from '../../types'
import { TgDropdown, type TgOption } from './TgDropdown'
import { TgMultiDropdown } from './TgMultiDropdown'
import { TgRandomButton } from './TgRandomButton'
import { TgTopBarSearch } from './TgTopBarSearch'
import { TgTopBarViews } from './TgTopBarViews'
import { TgLibraryMenu } from './TgLibraryMenu'

const SORT_OPTIONS = (Object.keys(SORT_LABEL) as TgSort[]).map(s => ({ value: s, label: SORT_LABEL[s] }))
const ICON = 'h-4 w-4'
// The design's pills sit on the panel colour (the phone's use the softer panel-2).
// On a narrow toolbar they turn icon-only and tighten so the row never
// overflows — decided by the toolbar's OWN width, which depends on the app
// sidebar and the page's navigation panel (each can be folded), not the viewport.
const PILL = '!bg-[var(--tg-panel)]'
const PILL_COMPACT = '!gap-1.5 !px-2'
const PILL_FULL = 'min-w-[104px]'
/** Below this the labels no longer fit beside the search field (≈ the full row's natural width). */
const COMPACT_BELOW = 1100

function useCompact(ref: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(true)
  // Measured before paint, so a wide screen never flashes the icon-only pills.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setCompact(el.clientWidth < COMPACT_BELOW)
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < COMPACT_BELOW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return compact
}

/**
 * The page's toolbar under the app's top bar, in the game sections: search,
 * random, filters, sort, view switch and the library's ⋯ menu. The page hides
 * whatever does nothing in the current section (Sort and the view switch on
 * the queue, which is always a list in play order; Status outside the Library).
 */
export function TgToolbar({
  genres, studios = [], statusCounts, showStatus, showViews, showSearch = true, showGenre = true, showSort = true, onRandom, randomCount,
}: {
  /** How many games Random picks from (the tooltip says it). */
  randomCount?: number
  /** Developer/publisher options (the Studio filter). */
  studios?: { studio: string; count: number }[]
  /** Opens a random game from the visible list; absent when the list is empty. */
  onRandom?: () => void
  genres: { genre: string; count: number }[]
  statusCounts: StatusCounts
  showStatus: boolean
  showViews: boolean
  showSearch?: boolean
  showGenre?: boolean
  showSort?: boolean
}) {
  const statuses = useTestGameStore(s => s.statuses)
  const setStatuses = useTestGameStore(s => s.setStatuses)
  const pickedGenres = useTestGameStore(s => s.genres)
  const setGenres = useTestGameStore(s => s.setGenres)
  const pickedStudios = useTestGameStore(s => s.studios)
  const setStudios = useTestGameStore(s => s.setStudios)
  const sort = useTestGameStore(s => s.sort)
  const setSort = useTestGameStore(s => s.setSort)
  const barRef = useRef<HTMLDivElement>(null)
  const compact = useCompact(barRef)
  const pill = `${PILL} ${compact ? PILL_COMPACT : PILL_FULL}`
  const gap = compact ? 'gap-1.5' : 'gap-2.5'

  const statusOptions: TgOption<PlayStatus>[] = STATUS_FILTERS.filter(s => s !== 'all').map(s => ({
    value: s as PlayStatus, label: STATUS_TEXT[s], count: statusCounts[s], status: s,
  }))

  // A genre picked on another platform stays selectable (at 0) so it can be cleared.
  const missing = pickedGenres.filter(p => !genres.some(g => genreKey(g.genre) === genreKey(p))).map(genre => ({ genre, count: 0 }))
  const genreOptions: TgOption<string>[] = [...genres, ...missing].map(g => ({ value: g.genre, label: g.genre, count: g.count }))
  const missingStudios = pickedStudios.filter(p => !studios.some(x => genreKey(x.studio) === genreKey(p))).map(studio => ({ studio, count: 0 }))
  const studioOpts: TgOption<string>[] = [...studios, ...missingStudios].map(x => ({ value: x.studio, label: x.studio, count: x.count }))

  return (
    // The app's top bar above already clears the status bar; the right inset
    // keeps a notch off the ⋯ menu.
    <div ref={barRef} className={`relative z-10 flex h-14 shrink-0 items-center ${gap} pl-5 pr-[max(1.25rem,env(safe-area-inset-right))] xl:pl-6 xl:pr-[max(1.5rem,env(safe-area-inset-right))]`}>
      {showSearch && <TgTopBarSearch className="min-w-[96px] max-w-md flex-1" />}
      {showSearch && <TgRandomButton onPick={onRandom} count={randomCount} className={compact ? '-ml-0.5' : ''} />}

      <div className={`ml-auto flex shrink-0 items-center ${gap}`}>
        {showStatus && (
          <TgMultiDropdown
            values={statuses}
            options={statusOptions}
            allLabel="All statuses"
            onChange={setStatuses}
            buttonLabel={multiLabel(statuses, 'All Status', 'statuses', s => STATUS_TEXT[s as TgStatusFilter])}
            ariaLabel="Filter by status"
            align="end"
            className={pill}
            compact={compact}
            icon={<ListFilter className={ICON} strokeWidth={2} />}
          />
        )}
        {showGenre && (
          <TgMultiDropdown
            values={pickedGenres}
            options={genreOptions}
            allLabel="All genres"
            onChange={setGenres}
            buttonLabel={multiLabel(pickedGenres, 'All Genres', 'genres')}
            ariaLabel="Filter by genre"
            align="end"
            className={`${pill} ${compact ? '' : 'max-w-[180px]'}`}
            compact={compact}
            icon={<Tags className={ICON} strokeWidth={2} />}
          />
        )}
        {showGenre && studioOpts.length > 0 && !compact && (
          <TgMultiDropdown
            values={pickedStudios}
            options={studioOpts}
            allLabel="All studios"
            onChange={setStudios}
            buttonLabel={multiLabel(pickedStudios, 'All Studios', 'studios')}
            ariaLabel="Filter by developer or publisher"
            align="end"
            className={`${pill} max-w-[180px]`}
            icon={<Building2 className={ICON} strokeWidth={2} />}
          />
        )}
        {showSort && (
          <TgDropdown
            value={sort}
            options={SORT_OPTIONS}
            onChange={setSort}
            buttonLabel={`Sort: ${SORT_LABEL[sort]}`}
            ariaLabel="Sort games"
            align="end"
            className={`${pill} ${compact ? '' : 'min-w-[118px] max-w-[210px]'}`}
            compact={compact}
            icon={<ArrowUpDown className={ICON} strokeWidth={2} />}
            active={sort !== DEFAULT_SORT}
          />
        )}
      </div>

      {showViews && <TgTopBarViews compact={compact} className={`shrink-0 ${compact ? 'ml-1.5' : 'ml-4'}`} />}
      <TgLibraryMenu className={`-mr-1 ${showSearch || showViews ? (compact ? 'ml-1' : 'ml-2.5') : 'ml-auto'}`} />
    </div>
  )
}
