import { useState, useCallback } from 'react'
import { TMDBCard } from './TMDBCard'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV,
  useUpcomingMovies, useUpcomingTV,
} from '../hooks/useTMDB'

type DiscoveryTab = 'today' | 'week' | 'popular' | 'upcoming'

interface Props {
  mediaType: 'movie' | 'tv'
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

const TABS: { key: DiscoveryTab; label: string }[] = [
  { key: 'today',    label: 'Today'    },
  { key: 'week',     label: 'This Week' },
  { key: 'popular',  label: 'Popular'  },
  { key: 'upcoming', label: 'Upcoming' },
]

// Interval options — TMDB data is stable, no need for fast refresh
const INTERVALS = [
  { label: '1h',  ms: 60 * 60_000 },
  { label: '6h',  ms: 6 * 60 * 60_000 },
  { label: '24h', ms: 24 * 60 * 60_000 },
]

const GRID = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-6 gap-3'

function SkeletonGrid() {
  return (
    <div className={GRID}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-[2/3] rounded-lg bg-cream-200 animate-pulse" />
      ))}
    </div>
  )
}

export function DiscoveryTabs({ mediaType, onOpenDetail }: Props) {
  const [tab,         setTab]        = useState<DiscoveryTab>('today')
  const [syncActive,  setSyncActive] = useState(false)          // off by default — TMDB data is stable
  const [intervalMs,  setIntervalMs] = useState(INTERVALS[0].ms)
  const [lastSynced,  setLastSynced] = useState<Date | null>(null)

  const interval = syncActive ? intervalMs : (false as const)

  // Only the active tab fires a query — lazy loading prevents 8 simultaneous TMDB calls on mount
  const trendDay  = useTrendingMovies('day',  tab === 'today'    && mediaType === 'movie' ? interval : false)
  const trendWeek = useTrendingMovies('week', tab === 'week'     && mediaType === 'movie' ? interval : false)
  const popular   = usePopularMovies(         tab === 'popular'  && mediaType === 'movie' ? interval : false)
  const upcoming  = useUpcomingMovies(        tab === 'upcoming' && mediaType === 'movie' ? interval : false)

  const tvTrendDay  = useTrendingTV('day',  tab === 'today'    && mediaType === 'tv' ? interval : false)
  const tvTrendWeek = useTrendingTV('week', tab === 'week'     && mediaType === 'tv' ? interval : false)
  const tvPopular   = usePopularTV(         tab === 'popular'  && mediaType === 'tv' ? interval : false)
  const tvUpcoming  = useUpcomingTV(        tab === 'upcoming' && mediaType === 'tv' ? interval : false)

  const activeQuery = mediaType === 'movie'
    ? { today: trendDay, week: trendWeek, popular, upcoming }[tab]
    : { today: tvTrendDay, week: tvTrendWeek, popular: tvPopular, upcoming: tvUpcoming }[tab]

  const handleManualSync = useCallback(() => {
    activeQuery?.refetch()
    setLastSynced(new Date())
  }, [activeQuery])

  const syncLabel = lastSynced
    ? `Synced ${lastSynced.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : 'Not synced yet'

  return (
    <div className="mb-6">
      {/* Tab bar + sync controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 bg-cream-100 rounded-lg p-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 min-h-[44px] ${
                tab === t.key
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sync controls — right side */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px] text-ink-400 hidden sm:block">{syncLabel}</span>
          <button
            onClick={handleManualSync}
            title="Refresh now"
            className="text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150"
          >
            ↻
          </button>
          <button
            onClick={() => setSyncActive(v => !v)}
            title={syncActive ? 'Pause auto-sync' : 'Resume auto-sync'}
            className={`text-[11px] transition-colors duration-150 ${syncActive ? 'text-accent-500 hover:text-accent-700' : 'text-ink-300 hover:text-ink-500'}`}
          >
            {syncActive ? '⏸' : '▶'}
          </button>
          <select
            value={intervalMs}
            onChange={e => setIntervalMs(Number(e.target.value))}
            className="text-[10px] text-ink-500 bg-transparent border-none outline-none cursor-pointer"
            title="Refresh interval"
          >
            {INTERVALS.map(iv => (
              <option key={iv.label} value={iv.ms}>{iv.label}</option>
            ))}
          </select>
        </div>
      </div>

      {activeQuery?.isLoading ? <SkeletonGrid /> : (
        <div className={GRID}>
          {(activeQuery?.data ?? []).slice(0, 18).map(item => (
            <TMDBCard
              key={item.id}
              item={item}
              type={mediaType}
              onOpenDetail={id => onOpenDetail(id, mediaType)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
