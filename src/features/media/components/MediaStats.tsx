import { useState } from 'react'
import { computeMediaStats } from '../hooks/useMediaStats'
import type { UserMovieEntry, UserTVEntry } from '../types'

interface Props {
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
}

export function MediaStats({ movieEntries, tvEntries }: Props) {
  const [open, setOpen] = useState(false)

  // Stats are pure computation — no API calls
  const s = computeMediaStats(movieEntries, tvEntries)

  const hasData = s.moviesWatched > 0 || s.tvSeriesTracked > 0

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 mb-3 w-full text-left group min-h-[44px]"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          📊 Your Stats
        </span>
        <span className={`ml-auto text-ink-400 text-xs transition-transform duration-150 ${open ? 'rotate-0' : '-rotate-90'}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="rounded-xl border border-ink-100 bg-cream-50 p-4">
          {!hasData ? (
            <p className="text-xs text-ink-400">Add some movies or TV series to your library to see stats.</p>
          ) : (
            <div className="space-y-4">
              {/* Numbers row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatBox label="Films watched" value={s.moviesWatched} icon="🎬" />
                <StatBox label="Watch hours" value={`${s.hoursWatched + s.tvHoursWatched}h`} icon="⏱" />
                <StatBox label="TV series" value={s.tvSeriesTracked} icon="📺" />
                <StatBox label="Episodes" value={s.tvEpisodesWatched} icon="▶" />
              </div>

              {/* Ratings comparison */}
              {s.avgMyRating !== null && (
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <p className="text-[10px] text-ink-400 mb-0.5">Your avg rating</p>
                    <p className="text-base font-bold text-accent-600">⭐ {s.avgMyRating}/10</p>
                  </div>
                  {s.avgTMDBRating !== null && (
                    <>
                      <div className="text-ink-200 text-lg">vs</div>
                      <div>
                        <p className="text-[10px] text-ink-400 mb-0.5">TMDB avg</p>
                        <p className="text-base font-bold text-ink-600">★ {s.avgTMDBRating}/10</p>
                      </div>
                      <div className="text-xs text-ink-400">
                        {s.avgMyRating > s.avgTMDBRating
                          ? '↑ You rate higher than TMDB'
                          : s.avgMyRating < s.avgTMDBRating
                          ? '↓ You rate lower than TMDB'
                          : 'Spot on with TMDB'}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Genre breakdown */}
              {s.topGenres.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Top genres</p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.topGenres.map(g => (
                      <span key={g.name} className="text-xs px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 font-medium">
                        {g.name} <span className="text-accent-400">{g.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-cream-50 border border-ink-100">
      <div className="text-lg">{icon}</div>
      <div className="text-base font-bold text-ink-900">{value}</div>
      <div className="text-[10px] text-ink-400 leading-tight">{label}</div>
    </div>
  )
}
