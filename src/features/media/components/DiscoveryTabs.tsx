import { useState, useCallback } from 'react'
import { TMDBCard } from './TMDBCard'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV,
  useUpcomingMovies, useUpcomingTV,
  useNorwegianMovies, useNorwegianTV,
} from '../hooks/useTMDB'

type DiscoveryTab = 'today' | 'week' | 'popular' | 'upcoming' | 'norway'

interface Props {
  mediaType:   'movie' | 'tv'
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
  librarySlot?: React.ReactNode
}

const TABS: { key: DiscoveryTab; label: string }[] = [
  { key: 'today',    label: 'Today'     },
  { key: 'week',     label: 'This Week' },
  { key: 'popular',  label: 'Popular'   },
  { key: 'upcoming', label: 'Upcoming'  },
  { key: 'norway',   label: '🇳🇴 Norway' },
]

const INTERVALS = [
  { label: '1h',  ms: 60 * 60_000 },
  { label: '6h',  ms: 6 * 60 * 60_000 },
  { label: '24h', ms: 24 * 60 * 60_000 },
]

const GRID = 'grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-10 gap-3'

function SkeletonGrid() {
  return (
    <div className={GRID}>
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={i} className="aspect-[2/3] rounded-lg bg-cream-200 animate-pulse" />
      ))}
    </div>
  )
}

export function DiscoveryTabs({ mediaType, onOpenDetail, librarySlot }: Props) {
  const [tab,         setTab]        = useState<DiscoveryTab>('today')
  const [syncActive,  setSyncActive] = useState(false)
  const [intervalMs,  setIntervalMs] = useState(INTERVALS[0].ms)
  const [lastSynced,  setLastSynced] = useState<Date | null>(null)

  const interval = syncActive ? intervalMs : (false as const)

  const trendDay   = useTrendingMovies('day',  tab === 'today'    && mediaType === 'movie' ? interval : false)
  const trendWeek  = useTrendingMovies('week', tab === 'week'     && mediaType === 'movie' ? interval : false)
  const popular    = usePopularMovies(         tab === 'popular'  && mediaType === 'movie' ? interval : false)
  const upcoming   = useUpcomingMovies(        tab === 'upcoming' && mediaType === 'movie' ? interval : false)
  const norMovie   = useNorwegianMovies(       tab === 'norway'   && mediaType === 'movie' ? interval : false)

  const tvTrendDay  = useTrendingTV('day',  tab === 'today'    && mediaType === 'tv' ? interval : false)
  const tvTrendWeek = useTrendingTV('week', tab === 'week'     && mediaType === 'tv' ? interval : false)
  const tvPopular   = usePopularTV(         tab === 'popular'  && mediaType === 'tv' ? interval : false)
  const tvUpcoming  = useUpcomingTV(        tab === 'upcoming' && mediaType === 'tv' ? interval : false)
  const norTV       = useNorwegianTV(       tab === 'norway'   && mediaType === 'tv' ? interval : false)

  const activeQuery = mediaType === 'movie'
    ? { today: trendDay, week: trendWeek, popular, upcoming, norway: norMovie }[tab]
    : { today: tvTrendDay, week: tvTrendWeek, popular: tvPopular, upcoming: tvUpcoming, norway: norTV }[tab]

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
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <div className="flex gap-1 bg-cream-100 rounded-lg p-1 w-full sm:w-auto overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 min-h-[44px] whitespace-nowrap ${
                tab === t.key
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 sm:ml-auto">
          <span className="text-[10px] text-ink-400 hidden sm:block">{syncLabel}</span>
          <button
            onClick={handleManualSync}
            title="Refresh now"
            className="text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ↻
          </button>
          <button
            onClick={() => setSyncActive(v => !v)}
            title={syncActive ? 'Pause auto-sync' : 'Resume auto-sync'}
            className={`text-[11px] transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-center ${syncActive ? 'text-accent-500 hover:text-accent-700' : 'text-ink-300 hover:text-ink-500'}`}
          >
            {syncActive ? '⏸' : '▶'}
          </button>
          <select
            value={intervalMs}
            onChange={e => setIntervalMs(Number(e.target.value))}
            className="text-[10px] text-ink-500 bg-transparent border-none outline-none cursor-pointer min-h-[44px]"
            title="Refresh interval"
          >
            {INTERVALS.map(iv => (
              <option key={iv.label} value={iv.ms}>{iv.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Compact library slot — between tab bar and content */}
      {librarySlot}

      {activeQuery?.isLoading ? <SkeletonGrid /> : (
        <div className={GRID}>
          {(activeQuery?.data ?? []).slice(0, 30).map(item => (
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
