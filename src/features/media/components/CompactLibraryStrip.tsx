import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { MediaType, UserMovieEntry, UserTVEntry } from '../types'

interface Item { id: number; title: string; poster_path: string | null; date: string | null }
interface Group {
  label:   string
  entries: Item[]
}

interface Props {
  tab:          'movies' | 'tv'
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
  onOpenDetail: (id: number, type: MediaType) => void
}

// "Coming soon" is a DATE fact (not yet released), not a manual label. Keeping
// the two apart was the whole point of the user's request: Wishlist = "want to
// watch, and it's out"; Coming soon = "not out yet". Deriving it from the
// release/air date also auto-resolves the old `upcoming` movie status — a film
// tagged upcoming that has since released simply falls back into Wishlist once
// its date is in the past, instead of staying pinned under a stale label
// forever (the previous behaviour, since nothing ever migrated the status).
// yyyy-mm-dd string compare — no Date parsing needed.
function isUnreleased(date: string | null): boolean {
  return !!date && date > todayStr()
}

export function CompactLibraryStrip({ tab, movieEntries, tvEntries, onOpenDetail }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  const groups: Group[] = tab === 'movies'
    ? (() => {
        const toItem = (e: UserMovieEntry): Item => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path, date: e.movie.release_date })
        // wishlist + the legacy manual `upcoming` status share one pool, then
        // split purely by whether the film is out yet.
        const wanted = movieEntries.filter(e => e.status === 'wishlist' || e.status === 'upcoming').map(toItem)
        return [
          { label: 'Coming soon', entries: wanted.filter(i => isUnreleased(i.date)) },
          { label: 'Wishlist',    entries: wanted.filter(i => !isUnreleased(i.date)) },
          { label: 'Watching',    entries: movieEntries.filter(e => e.status === 'watching').map(toItem) },
          { label: 'Completed',   entries: movieEntries.filter(e => e.status === 'completed').map(toItem) },
          { label: 'Dropped',     entries: movieEntries.filter(e => e.status === 'dropped').map(toItem) },
        ]
      })()
    : (() => {
        const toItem = (e: UserTVEntry): Item => ({ id: e.tv_series.tmdb_id, title: e.tv_series.title, poster_path: e.tv_series.poster_path, date: e.tv_series.first_air_date })
        const wanted = tvEntries.filter(e => e.status === 'wishlist').map(toItem)
        return [
          { label: 'Coming soon', entries: wanted.filter(i => isUnreleased(i.date)) },
          { label: 'Wishlist',    entries: wanted.filter(i => !isUnreleased(i.date)) },
          { label: 'Watching',    entries: tvEntries.filter(e => e.status === 'watching').map(toItem) },
          { label: 'Paused',      entries: tvEntries.filter(e => e.status === 'paused').map(toItem) },
          { label: 'Completed',   entries: tvEntries.filter(e => e.status === 'completed').map(toItem) },
          { label: 'Dropped',     entries: tvEntries.filter(e => e.status === 'dropped').map(toItem) },
        ]
      })()

  const filledGroups = groups.filter(g => g.entries.length > 0)
  if (filledGroups.length === 0) return null

  const type: MediaType = tab === 'movies' ? 'movie' : 'tv'
  const total = filledGroups.reduce((n, g) => n + g.entries.length, 0)

  // Split groups into two columns: left = even indices, right = odd indices
  const leftGroups  = filledGroups.filter((_, i) => i % 2 === 0)
  const rightGroups = filledGroups.filter((_, i) => i % 2 === 1)

  function renderGroup(group: Group) {
    return (
      <div key={group.label} className="min-w-0">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="section-label">{group.label}</span>
          <span className="text-micro text-fg-faint tabular-nums">{group.entries.length}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {group.entries.map(e => (
            <button
              key={e.id}
              type="button"
              onClick={() => onOpenDetail(e.id, type)}
              title={e.title}
              aria-label={e.title}
              className="press-feedback rounded-md focus-visible:outline-accent-500"
            >
              <img
                src={posterUrl(e.poster_path, 'w185')}
                alt=""
                loading="lazy"
                className="h-[120px] w-[80px] rounded-md bg-surface-2 object-cover transition-opacity hover:opacity-85"
              />
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-row border border-line bg-surface/70">
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        aria-expanded={!collapsed}
        className="row row-interactive w-full text-left"
      >
        <span className="section-label flex-1">
          My library <span className="ml-1 font-normal normal-case tracking-normal text-fg-faint tabular-nums">({total})</span>
        </span>
        <ChevronDown aria-hidden className={`h-4 w-4 text-fg-faint transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      {!collapsed && (
        <>
          {/* Phones: one column in status order (an even/odd split stacked
              column-then-column and scrambled the reading order). */}
          <div className="space-y-4 px-3 pb-3 sm:hidden">{filledGroups.map(renderGroup)}</div>
          {/* sm+: two balanced columns, reading down then across. */}
          <div className="hidden grid-cols-2 gap-4 px-3 pb-3 sm:grid">
            <div className="space-y-4">{leftGroups.map(renderGroup)}</div>
            <div className="space-y-4">{rightGroups.map(renderGroup)}</div>
          </div>
        </>
      )}
    </div>
  )
}
