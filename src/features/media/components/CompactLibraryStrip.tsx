import { useState } from 'react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { UserMovieEntry, UserTVEntry } from '../types'

interface Item { id: number; title: string; poster_path: string | null; date: string | null }
interface Group {
  label:   string
  entries: Item[]
}

interface Props {
  tab:          'movies' | 'tv'
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
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

  const type  = tab === 'movies' ? 'movie' : 'tv'
  const total = filledGroups.reduce((n, g) => n + g.entries.length, 0)

  // Split groups into two columns: left = even indices, right = odd indices
  const leftGroups  = filledGroups.filter((_, i) => i % 2 === 0)
  const rightGroups = filledGroups.filter((_, i) => i % 2 === 1)

  function renderGroup(group: Group) {
    return (
      <div key={group.label} className="min-w-0">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{group.label}</span>
          <span className="text-[9px] text-ink-300">{group.entries.length}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {group.entries.map(e => (
            <button
              key={e.id}
              onClick={() => onOpenDetail(e.id, type)}
              title={e.title}
              className="min-h-[44px] flex items-center justify-center press-feedback"
            >
              <img
                src={posterUrl(e.poster_path, 'w185')}
                alt={e.title}
                className="w-[86px] h-[120px] rounded object-cover hover:opacity-80 hover:ring-2 hover:ring-accent-400 transition-all"
              />
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border border-ink-100 bg-cream-50/60">
      {/* Header */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 min-h-[44px] text-left hover:bg-cream-100 rounded-xl transition-colors"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400 flex-1">
          My Library
          <span className="ml-1.5 normal-case font-normal text-ink-300">({total})</span>
        </span>
        <span className="text-[10px] text-ink-400">{collapsed ? '▶' : '▼'}</span>
      </button>

      {!collapsed && (
        // grid-cols-1 on mobile — the fixed 86px-wide posters in a 2-column
        // split left each column only ~159px wide at 390px viewports (barely
        // over one poster), which risked overflow at narrower devices too.
        // Single column below sm gives posters the full card width to wrap
        // multiple per row instead.
        <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-4">{leftGroups.map(renderGroup)}</div>
          <div className="space-y-4">{rightGroups.map(renderGroup)}</div>
        </div>
      )}
    </div>
  )
}
