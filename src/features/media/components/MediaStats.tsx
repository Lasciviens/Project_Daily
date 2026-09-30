import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { qk, STALE } from '../../../shared/query'
import { fetchEpisodeTally } from '../api/watchedEpisodesApi'
import { computeMediaStats } from '../hooks/useMediaStats'
import { SectionLabel } from '../../../shared/ui'
import { CollapsibleCard } from './CollapsibleCard'
import type { UserMovieEntry, UserTVEntry } from '../types'

interface Props {
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
  /** Part of the library is still loading: placeholders, not a count of 0. */
  loading?:     boolean
}

export function MediaStats({ movieEntries, tvEntries, loading = false }: Props) {
  const tally = useQuery({ queryKey: qk.media.episodeTally(), queryFn: fetchEpisodeTally, staleTime: STALE.default })
  const s = computeMediaStats(movieEntries, tvEntries, tally.data)
  const hasData = s.moviesWatched > 0 || s.tvSeriesTracked > 0

  return (
    <CollapsibleCard title="Your stats" icon={<BarChart3 />} loading={loading || tally.isLoading}>
      {!hasData ? (
        <p className="text-body text-fg-muted">Add some movies or series to your library to see stats.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Films watched" value={s.moviesWatched} sub={plays(s.moviePlays, s.moviesWatched)} />
            <StatBox label="Watch hours" value={`${s.hoursWatched + s.tvHoursWatched}h`} />
            <StatBox label="TV series" value={s.tvSeriesTracked} />
            <StatBox label="Episodes" value={s.tvEpisodesWatched} sub={plays(s.tvEpisodePlays, s.tvEpisodesWatched)} />
          </div>

          {s.avgMyRating !== null && (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <div>
                <p className="text-meta text-fg-muted">Your average</p>
                <p className="text-lead font-bold text-fg tabular-nums"><span data-tone="star" className="tone-text">★</span> {s.avgMyRating}/10</p>
              </div>
              {s.avgTMDBRating !== null && (
                <>
                  <div>
                    <p className="text-meta text-fg-muted">TMDB average</p>
                    <p className="text-lead font-bold text-fg-2 tabular-nums">★ {s.avgTMDBRating}/10</p>
                  </div>
                  <p className="text-meta text-fg-muted">
                    {s.avgMyRating > s.avgTMDBRating
                      ? 'You rate higher than TMDB'
                      : s.avgMyRating < s.avgTMDBRating
                        ? 'You rate lower than TMDB'
                        : 'Spot on with TMDB'}
                  </p>
                </>
              )}
            </div>
          )}

          {s.topGenres.length > 0 && (
            <div>
              <SectionLabel className="mb-2">Top genres</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {s.topGenres.map(g => (
                  <span key={g.name} className="chip">
                    {g.name} <span className="text-fg-muted tabular-nums">{g.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </CollapsibleCard>
  )
}

/** "62 plays" when rewatches make plays differ from the distinct count. */
const plays = (count: number, distinct: number) => (count > distinct ? `${count.toLocaleString('en-GB')} plays` : undefined)

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-row bg-surface-2 px-3 py-2">
      <div className="text-lead font-bold text-fg tabular-nums">{typeof value === 'number' ? value.toLocaleString('en-GB') : value}</div>
      <div className="text-meta text-fg-muted">{label}{sub && <span className="text-fg-faint"> · {sub}</span>}</div>
    </div>
  )
}
