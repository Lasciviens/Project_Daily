import { useState } from 'react'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { UserMovieEntry, UserTVEntry } from '../types'

interface Props {
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

interface UpcomingItem {
  id:        string
  tmdbId:    number
  type:      'movie' | 'tv'
  title:     string
  poster:    string | null
  date:      Date
  dateLabel: string
  daysAway:  number
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ReleaseCalendar({ movieEntries, tvEntries, onOpenDetail }: Props) {
  const [open, setOpen] = useState(false)

  const today = new Date()

  // Upcoming movies from wishlist with future release dates
  const upcomingMovies: UpcomingItem[] = movieEntries
    .filter(e => e.movie.release_date && new Date(e.movie.release_date + 'T00:00:00') > today)
    .map(e => {
      const d = new Date(e.movie.release_date! + 'T00:00:00')
      return {
        id:        e.id,
        tmdbId:    e.movie.tmdb_id,
        type:      'movie' as const,
        title:     e.movie.title,
        poster:    e.movie.poster_path,
        date:      d,
        dateLabel: formatDate(d),
        daysAway:  daysUntil(d),
      }
    })

  // Upcoming TV from wishlist with future first air dates
  const upcomingTV: UpcomingItem[] = tvEntries
    .filter(e => e.tv_series.first_air_date && new Date(e.tv_series.first_air_date + 'T00:00:00') > today)
    .map(e => {
      const d = new Date(e.tv_series.first_air_date! + 'T00:00:00')
      return {
        id:        e.id,
        tmdbId:    e.tv_series.tmdb_id,
        type:      'tv' as const,
        title:     e.tv_series.title,
        poster:    e.tv_series.poster_path,
        date:      d,
        dateLabel: formatDate(d),
        daysAway:  daysUntil(d),
      }
    })

  const items = [...upcomingMovies, ...upcomingTV].sort((a, b) => a.daysAway - b.daysAway)

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 mb-3 w-full text-left group"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          📅 Coming Soon
        </span>
        {items.length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-600">
            {items.length}
          </span>
        )}
        <span className={`ml-auto text-ink-400 text-xs transition-transform duration-150 ${open ? 'rotate-0' : '-rotate-90'}`}>
          ▾
        </span>
      </button>

      {open && (
        items.length === 0 ? (
          <p className="text-xs text-ink-400 px-1">
            No upcoming releases in your library. Add movies or TV series with future release dates.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div
                key={item.id}
                onClick={() => onOpenDetail(item.tmdbId, item.type)}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-ink-100 hover:border-accent-200 hover:bg-accent-50/30 cursor-pointer transition-colors duration-150"
              >
                <img
                  src={posterUrl(item.poster, 'w92')}
                  alt={item.title}
                  className="w-9 h-14 object-cover rounded-md flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-800 truncate">{item.title}</p>
                  <p className="text-[10px] text-ink-400">{item.type === 'movie' ? '🎬' : '📺'} {item.dateLabel}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className={`text-xs font-bold ${item.daysAway <= 7 ? 'text-accent-600' : 'text-ink-500'}`}>
                    {item.daysAway === 0 ? 'Today!' : item.daysAway === 1 ? 'Tomorrow' : `${item.daysAway}d`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
