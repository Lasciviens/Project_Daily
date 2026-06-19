import { format, formatDistanceToNow, isPast } from 'date-fns'
import type { Fixture } from '../types'

interface Props {
  fixture: Fixture
  teamId:  number
}

export function NextMatchHero({ fixture }: Props) {
  const { home, away } = fixture.teams
  const matchDate   = new Date(fixture.fixture.date)
  const isToday     = new Date().toDateString() === matchDate.toDateString()
  const isLive      = ['1H', '2H', 'HT', 'ET', 'P'].includes(fixture.fixture.status.short)
  const isPastMatch = isPast(matchDate) && fixture.fixture.status.short === 'FT'

  return (
    <div className="card overflow-hidden">
      <div className="h-1 bg-accent-500" />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            {isPastMatch ? 'Last Match' : 'Next Match'}
          </span>
          <div className="flex items-center gap-1.5">
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-red-500 uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                Live {fixture.fixture.status.elapsed}'
              </span>
            )}
            <span className="text-[10px] bg-ink-100 text-ink-600 rounded-full px-2 py-0.5 font-medium">
              {fixture.league.name}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Home team */}
          <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
            <img src={home.logo} alt={home.name} className="w-12 h-12 object-contain" />
            <p className="text-xs font-semibold text-ink-800 text-center truncate w-full">{home.name}</p>
          </div>

          {/* Score / time */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            {fixture.fixture.status.short === 'FT' ? (
              <p className="text-2xl font-bold text-ink-900 tabular-nums">
                {fixture.goals.home} – {fixture.goals.away}
              </p>
            ) : (
              <>
                <p className="text-lg font-bold text-ink-900 tabular-nums font-mono">
                  {isToday ? format(matchDate, 'HH:mm') : format(matchDate, 'HH:mm')}
                </p>
                <p className="text-[11px] text-ink-500">
                  {isToday ? 'Today' : format(matchDate, 'd MMM')}
                </p>
                {!isToday && !isPast(matchDate) && (
                  <p className="text-[10px] text-ink-400">
                    {formatDistanceToNow(matchDate, { addSuffix: true })}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Away team */}
          <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
            <img src={away.logo} alt={away.name} className="w-12 h-12 object-contain" />
            <p className="text-xs font-semibold text-ink-800 text-center truncate w-full">{away.name}</p>
          </div>
        </div>

        {fixture.fixture.venue.name && (
          <p className="text-[11px] text-ink-400 text-center mt-3">
            {fixture.fixture.venue.name}{fixture.fixture.venue.city ? `, ${fixture.fixture.venue.city}` : ''}
          </p>
        )}

        <p className="text-[11px] text-ink-400 text-center mt-1">{fixture.league.round}</p>
      </div>
    </div>
  )
}

interface SkeletonProps { label: string }
export function NextMatchSkeleton({ label }: SkeletonProps) {
  return (
    <div className="card overflow-hidden">
      <div className="h-1 bg-accent-500" />
      <div className="p-4">
        <div className="h-3 w-20 bg-cream-200 rounded animate-pulse mb-4" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="w-12 h-12 rounded-full bg-cream-200 animate-pulse" />
            <div className="h-3 w-16 bg-cream-200 rounded animate-pulse" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="h-6 w-16 bg-cream-200 rounded animate-pulse" />
            <div className="h-3 w-10 bg-cream-200 rounded animate-pulse" />
          </div>
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="w-12 h-12 rounded-full bg-cream-200 animate-pulse" />
            <div className="h-3 w-16 bg-cream-200 rounded animate-pulse" />
          </div>
        </div>
        <p className="text-xs text-ink-400 text-center mt-3">{label}</p>
      </div>
    </div>
  )
}
