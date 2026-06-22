import { useState } from 'react'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { UserMovieEntry, UserTVEntry } from '../types'

interface Group {
  label:   string
  entries: { id: number; title: string; poster_path: string | null }[]
}

interface Props {
  tab:          'movies' | 'tv'
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

export function CompactLibraryStrip({ tab, movieEntries, tvEntries, onOpenDetail }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  const groups: Group[] = tab === 'movies'
    ? [
        {
          label:   'Upcoming',
          entries: movieEntries.filter(e => e.status === 'upcoming')
            .map(e => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path })),
        },
        {
          label:   'Wishlist',
          entries: movieEntries.filter(e => e.status === 'wishlist')
            .map(e => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path })),
        },
        {
          label:   'Watching',
          entries: movieEntries.filter(e => e.status === 'watching')
            .map(e => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path })),
        },
        {
          label:   'Completed',
          entries: movieEntries.filter(e => e.status === 'completed')
            .map(e => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path })),
        },
        {
          label:   'Dropped',
          entries: movieEntries.filter(e => e.status === 'dropped')
            .map(e => ({ id: e.movie.tmdb_id, title: e.movie.title, poster_path: e.movie.poster_path })),
        },
      ]
    : [
        {
          label:   'Wishlist',
          entries: tvEntries.filter(e => e.status === 'wishlist')
            .map(e => ({ id: e.tv_series.tmdb_id, title: e.tv_series.title, poster_path: e.tv_series.poster_path })),
        },
        {
          label:   'Watching',
          entries: tvEntries.filter(e => e.status === 'watching')
            .map(e => ({ id: e.tv_series.tmdb_id, title: e.tv_series.title, poster_path: e.tv_series.poster_path })),
        },
        {
          label:   'Paused',
          entries: tvEntries.filter(e => e.status === 'paused')
            .map(e => ({ id: e.tv_series.tmdb_id, title: e.tv_series.title, poster_path: e.tv_series.poster_path })),
        },
        {
          label:   'Completed',
          entries: tvEntries.filter(e => e.status === 'completed')
            .map(e => ({ id: e.tv_series.tmdb_id, title: e.tv_series.title, poster_path: e.tv_series.poster_path })),
        },
      ]

  const filledGroups = groups.filter(g => g.entries.length > 0)
  if (filledGroups.length === 0) return null

  const type = tab === 'movies' ? 'movie' : 'tv'
  const total = filledGroups.reduce((n, g) => n + g.entries.length, 0)

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
        <div className="px-3 pb-2.5 space-y-2">
          {filledGroups.map(group => (
            <div key={group.label} className="flex items-start gap-2 min-w-0">
              <span className="text-[10px] text-ink-400 w-16 flex-shrink-0 pt-1">{group.label}</span>
              <div className="flex-1 grid grid-cols-4 gap-1.5">
                {group.entries.map(e => (
                  <button
                    key={e.id}
                    onClick={() => onOpenDetail(e.id, type)}
                    title={e.title}
                    className="min-h-[44px] flex items-center justify-center"
                  >
                    <img
                      src={posterUrl(e.poster_path, 'w92')}
                      alt={e.title}
                      className="w-[43px] h-[60px] rounded object-cover hover:opacity-80 hover:ring-2 hover:ring-accent-400 transition-all"
                    />
                  </button>
                ))}
              </div>
              <span className="text-[9px] text-ink-300 flex-shrink-0 pt-1">{group.entries.length}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
