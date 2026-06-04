import { differenceInCalendarDays } from 'date-fns'
import { useMovies } from '../../media/hooks/useMovies'
import { useTVSeries } from '../../media/hooks/useTVSeries'

type ReleaseItem = {
  key: string
  type: 'movie' | 'tv'
  title: string
  daysUntil: number
}

export function UpcomingReleasesBanner() {
  const { data: movies   = [] } = useMovies()
  const { data: tvSeries = [] } = useTVSeries()

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const releases: ReleaseItem[] = []

  for (const entry of movies) {
    const rd = entry.movie?.release_date
    if (!rd) continue
    const days = differenceInCalendarDays(new Date(rd), today)
    if (days >= 0 && days <= 14) {
      releases.push({ key: entry.id, type: 'movie', title: entry.movie!.title, daysUntil: days })
    }
  }

  for (const entry of tvSeries) {
    const rd = entry.tv_series?.first_air_date
    if (!rd) continue
    const days = differenceInCalendarDays(new Date(rd), today)
    if (days >= 0 && days <= 14) {
      releases.push({ key: entry.id, type: 'tv', title: entry.tv_series!.title, daysUntil: days })
    }
  }

  releases.sort((a, b) => a.daysUntil - b.daysUntil)

  if (releases.length === 0) return null

  return (
    <div className="mb-5 flex flex-wrap gap-2 items-center">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-600 mr-1">
        Releasing soon
      </span>
      {releases.map(r => (
        <div
          key={r.key}
          className="flex items-center gap-1.5 bg-accent-50 border border-accent-200 rounded-full px-3 py-1"
        >
          <span className="text-xs">{r.type === 'movie' ? '🎬' : '📺'}</span>
          <span className="text-xs font-medium text-ink-800">{r.title}</span>
          <span className="text-xs font-semibold text-accent-600">
            {r.daysUntil === 0 ? 'Today!' : r.daysUntil === 1 ? 'Tomorrow' : `${r.daysUntil}d`}
          </span>
        </div>
      ))}
    </div>
  )
}
