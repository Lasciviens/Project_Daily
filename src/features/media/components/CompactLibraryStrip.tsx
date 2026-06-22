import { posterUrl } from '../../../integrations/tmdb/client'
import type { UserMovieEntry, UserTVEntry } from '../types'

interface MovieGroup {
  label: string
  entries: { id: number; title: string; poster_path: string | null }[]
}

interface Props {
  tab: 'movies' | 'tv'
  movieEntries: UserMovieEntry[]
  tvEntries: UserTVEntry[]
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

export function CompactLibraryStrip({ tab, movieEntries, tvEntries, onOpenDetail }: Props) {
  const groups: MovieGroup[] = tab === 'movies'
    ? [
        {
          label: 'Wishlist',
          entries: movieEntries
            .filter(e => e.status === 'wishlist')
            .map(e => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path })),
        },
        {
          label: 'Watching',
          entries: movieEntries
            .filter(e => e.status === 'watching')
            .map(e => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path })),
        },
        {
          label: 'Done',
          entries: movieEntries
            .filter(e => e.status === 'completed' || e.status === 'dropped')
            .map(e => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path })),
        },
      ]
    : [
        {
          label: 'Wishlist',
          entries: tvEntries
            .filter(e => e.status === 'wishlist')
            .map(e => ({ id: e.tv_series.tmdb_id, title: e.tv_series.title, poster_path: e.tv_series.poster_path })),
        },
        {
          label: 'Watching',
          entries: tvEntries
            .filter(e => e.status === 'watching' || e.status === 'paused')
            .map(e => ({ id: e.tv_series.tmdb_id, title: e.tv_series.title, poster_path: e.tv_series.poster_path })),
        },
        {
          label: 'Done',
          entries: tvEntries
            .filter(e => e.status === 'completed' || e.status === 'dropped')
            .map(e => ({ id: e.tv_series.tmdb_id, title: e.tv_series.title, poster_path: e.tv_series.poster_path })),
        },
      ]

  const filledGroups = groups.filter(g => g.entries.length > 0)
  if (filledGroups.length === 0) return null

  const type = tab === 'movies' ? 'movie' : 'tv'

  return (
    <div className="mb-4 rounded-xl border border-ink-100 bg-cream-50/60 px-3 py-2.5 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">My Library</p>
      {filledGroups.map(group => (
        <div key={group.label} className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-ink-400 w-14 flex-shrink-0">{group.label}</span>
          <div className="flex gap-1 overflow-x-auto no-scrollbar pb-0.5">
            {group.entries.map(e => (
              <button
                key={e.id}
                onClick={() => onOpenDetail(e.id, type)}
                title={e.title}
                className="flex-shrink-0 min-h-[44px] flex items-center"
              >
                <img
                  src={posterUrl(e.poster_path, 'w92')}
                  alt={e.title}
                  className="w-8 h-11 rounded object-cover hover:opacity-80 hover:ring-2 hover:ring-accent-400 transition-all"
                />
              </button>
            ))}
          </div>
          <span className="text-[10px] text-ink-300 flex-shrink-0">{group.entries.length}</span>
        </div>
      ))}
    </div>
  )
}
