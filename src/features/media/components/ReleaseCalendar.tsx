import { CalendarClock, Film, Tv } from 'lucide-react'
import { CollapsibleCard } from './CollapsibleCard'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { MediaType, UserMovieEntry, UserTVEntry } from '../types'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

interface Props {
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
  onOpenDetail: (id: number, type: MediaType) => void
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
  return fmtDateEnGB(date, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ReleaseCalendar({ movieEntries, tvEntries, onOpenDetail }: Props) {
  const today = new Date()

  // Upcoming movies with future release dates. Status-filtered (real bug:
  // the comment always said "from wishlist" but nothing filtered, so
  // completed/dropped titles were listed too): wishlist = wants to watch,
  // upcoming = tracked unreleased, watching = in progress — all relevant;
  // completed/dropped are not.
  const RELEVANT = new Set(['wishlist', 'upcoming', 'watching'])
  const upcomingMovies: UpcomingItem[] = movieEntries
    .filter(e => RELEVANT.has(e.status) && e.movie.release_date && new Date(e.movie.release_date + 'T00:00:00') > today)
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
    .filter(e => RELEVANT.has(e.status) && e.tv_series.first_air_date && new Date(e.tv_series.first_air_date + 'T00:00:00') > today)
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
    <CollapsibleCard
      title="Coming soon"
      icon={<CalendarClock />}
      badge={items.length > 0 ? <span className="count-badge">{items.length}</span> : undefined}
    >
      {items.length === 0 ? (
        <p className="text-body text-fg-muted">
          No upcoming releases in your library. Add movies or series with a future release date.
        </p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenDetail(item.tmdbId, item.type)}
                className="row row-interactive w-full py-1.5 text-left"
              >
                <img src={posterUrl(item.poster, 'w92')} alt="" className="h-14 w-9 shrink-0 rounded-md bg-surface-2 object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-fg">{item.title}</span>
                  <span className="flex items-center gap-1 text-meta text-fg-muted tabular-nums">
                    {item.type === 'movie' ? <Film aria-hidden className="h-3 w-3" /> : <Tv aria-hidden className="h-3 w-3" />}
                    {item.dateLabel}
                  </span>
                </span>
                <span
                  data-tone={item.daysAway <= 7 ? 'warn' : undefined}
                  className={`shrink-0 text-meta font-semibold tabular-nums ${item.daysAway <= 7 ? 'tone-text' : 'text-fg-muted'}`}
                >
                  {item.daysAway <= 0 ? 'Today' : item.daysAway === 1 ? 'Tomorrow' : `${item.daysAway}d`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleCard>
  )
}
