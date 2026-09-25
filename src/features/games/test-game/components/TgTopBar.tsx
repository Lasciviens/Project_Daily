import { ArrowUpDown, ListFilter, Tags } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import {
  SORT_LABEL, STATUS_FILTERS, STATUS_TEXT,
  type StatusCounts, type TgSort, type TgStatusFilter,
} from '../testGameModel'
import { TgDropdown, type TgOption } from './TgDropdown'
import { TgTopBarSearch } from './TgTopBarSearch'
import { TgTopBarViews } from './TgTopBarViews'
import { TgUserMenu } from './TgUserMenu'

/** Listbox values are strings; genres are never empty, so '' can mean "all". */
const ALL_GENRES = ''
const DEFAULT_SORT: TgSort = 'title'
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
  genres, statusCounts, showStatus, showViews, showSearch = true, showGenre = true, showSort = true,
}: {
  genres: { genre: string; count: number }[]
  statusCounts: StatusCounts
  showStatus: boolean
  showViews: boolean
  showSearch?: boolean
  showGenre?: boolean
  showSort?: boolean
}) {
  const status = useTestGameStore(s => s.status)
  const setStatus = useTestGameStore(s => s.setStatus)
  const genre = useTestGameStore(s => s.genre)
  const setGenre = useTestGameStore(s => s.setGenre)
  const sort = useTestGameStore(s => s.sort)
  const setSort = useTestGameStore(s => s.setSort)

  const statusOptions: TgOption<TgStatusFilter>[] = STATUS_FILTERS.map(s => ({
    value: s,
    label: s === 'all' ? 'All statuses' : STATUS_TEXT[s],
    count: statusCounts[s],
    status: s === 'all' ? undefined : s,
  }))

  // A genre picked on another platform stays selectable (at 0) so it can be cleared.
  const genreList = genre && !genres.some(g => g.genre === genre) ? [...genres, { genre, count: 0 }] : genres
  const genreOptions: TgOption<string>[] = [
    { value: ALL_GENRES, label: 'All genres' },
    ...genreList.map(g => ({ value: g.genre, label: g.genre, count: g.count })),
  ]

  return (
    // The top inset keeps an installed iPad PWA's status bar off the controls,
    // the right one a landscape phone's notch off the avatar.
    <div className="relative z-10 flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-center gap-1.5 pl-5 pr-[max(1.25rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] lg:gap-2.5 xl:pl-6 xl:pr-[max(1.5rem,env(safe-area-inset-right))]">
      {showSearch && <TgTopBarSearch className="min-w-[96px] max-w-[460px] flex-1" />}

      <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:gap-2.5">
        {showStatus && (
          <TgDropdown
            value={status}
            options={statusOptions}
            onChange={setStatus}
            buttonLabel={status === 'all' ? 'All Status' : STATUS_TEXT[status]}
            ariaLabel="Filter by status"
            align="end"
            className={PILL}
            icon={<ListFilter className={ICON} strokeWidth={2} />}
            active={status !== 'all'}
          />
        )}
        {showGenre && (
          <TgDropdown
            value={genre ?? ALL_GENRES}
            options={genreOptions}
            onChange={v => setGenre(v === ALL_GENRES ? null : v)}
            buttonLabel={genre ?? 'All Genres'}
            ariaLabel="Filter by genre"
            align="end"
            className={`${PILL} lg:max-w-[140px] xl:max-w-[180px]`}
            icon={<Tags className={ICON} strokeWidth={2} />}
            active={genre != null}
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
