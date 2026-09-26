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
import { TgUserMenu } from './TgUserMenu'

const SORT_OPTIONS = (Object.keys(SORT_LABEL) as TgSort[]).map(s => ({ value: s, label: SORT_LABEL[s] }))
const ICON = 'h-4 w-4'
// The design's pills sit on the panel colour (the phone's use the softer panel-2).
// Below lg they turn icon-only and tighten so the tablet row never overflows
// (not even a landscape phone's, with 44px touch targets and notch insets).
const PILL = '!bg-[var(--tg-panel)] max-lg:!gap-1.5 max-lg:!px-2 lg:min-w-[104px]'

/**
 * Search, filters, view switch and account — across the main and detail
 * columns. The shell hides whatever does nothing in the current section
 * (Sort on the queue, which is always in play order; everything but the
 * account menu on Analytics and Advanced).
 */
export function TgTopBar({
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

  const statusOptions: TgOption<PlayStatus>[] = STATUS_FILTERS.filter(s => s !== 'all').map(s => ({
    value: s as PlayStatus, label: STATUS_TEXT[s], count: statusCounts[s], status: s,
  }))

  // A genre picked on another platform stays selectable (at 0) so it can be cleared.
  const missing = pickedGenres.filter(p => !genres.some(g => genreKey(g.genre) === genreKey(p))).map(genre => ({ genre, count: 0 }))
  const genreOptions: TgOption<string>[] = [...genres, ...missing].map(g => ({ value: g.genre, label: g.genre, count: g.count }))
  const missingStudios = pickedStudios.filter(p => !studios.some(x => genreKey(x.studio) === genreKey(p))).map(studio => ({ studio, count: 0 }))
  const studioOpts: TgOption<string>[] = [...studios, ...missingStudios].map(x => ({ value: x.studio, label: x.studio, count: x.count }))

  return (
    // The top inset keeps an installed iPad PWA's status bar off the controls,
    // the right one a landscape phone's notch off the avatar.
    <div className="relative z-10 flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-center gap-1.5 pl-5 pr-[max(1.25rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] lg:gap-2.5 xl:pl-6 xl:pr-[max(1.5rem,env(safe-area-inset-right))]">
      {showSearch && <TgTopBarSearch className="min-w-[96px] max-w-[460px] flex-1" />}
      {showSearch && <TgRandomButton onPick={onRandom} count={randomCount} className="-ml-0.5 lg:ml-0" />}

      <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:gap-2.5">
        {showStatus && (
          <TgMultiDropdown
            values={statuses}
            options={statusOptions}
            allLabel="All statuses"
            onChange={setStatuses}
            buttonLabel={multiLabel(statuses, 'All Status', 'statuses', s => STATUS_TEXT[s as TgStatusFilter])}
            ariaLabel="Filter by status"
            align="end"
            className={PILL}
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
            className={`${PILL} lg:max-w-[140px] xl:max-w-[180px]`}
            icon={<Tags className={ICON} strokeWidth={2} />}
          />
        )}
        {showGenre && studioOpts.length > 0 && (
          <TgMultiDropdown
            values={pickedStudios}
            options={studioOpts}
            allLabel="All studios"
            onChange={setStudios}
            buttonLabel={multiLabel(pickedStudios, 'All Studios', 'studios')}
            ariaLabel="Filter by developer or publisher"
            align="end"
            className={`${PILL} max-lg:hidden lg:max-w-[140px] xl:max-w-[180px]`}
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
            className={`${PILL} lg:min-w-[118px] lg:max-w-[150px] xl:max-w-[210px]`}
            icon={<ArrowUpDown className={ICON} strokeWidth={2} />}
            active={sort !== DEFAULT_SORT}
          />
        )}
      </div>

      {showViews && <TgTopBarViews className="ml-1.5 shrink-0 lg:ml-4" />}
      <TgUserMenu className="-mr-1 ml-1 lg:ml-2.5" />
    </div>
  )
}
