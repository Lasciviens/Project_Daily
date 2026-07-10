import { useState, useCallback } from 'react'
import { TMDBCard } from './TMDBCard'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV,
  useUpcomingMovies, useUpcomingTV,
  useNorwegianMovies, useNorwegianTV,
  useNorwegianTopRatedMovies, useNorwegianTopRatedTV,
} from '../hooks/useTMDB'
import type { TMDBSearchMovie, TMDBSearchTV } from '../types'

type DiscoveryTab = 'today' | 'week' | 'popular' | 'upcoming' | 'norway'

interface Props {
  mediaType:    'movie' | 'tv'
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

const TABS: { key: DiscoveryTab; label: string }[] = [
  { key: 'today',    label: 'Today'     },
  { key: 'week',     label: 'This Week' },
  { key: 'popular',  label: 'Popular'   },
  { key: 'upcoming', label: 'Upcoming'  },
  { key: 'norway',   label: '🇳🇴 Norway' },
]

const GRID = 'grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-10 gap-3'

function SkeletonGrid({ count = 20 }: { count?: number }) {
  return (
    <div className={GRID}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-[2/3] rounded-lg bg-cream-200 animate-pulse" />
      ))}
    </div>
  )
}

function NorwaySection({ mediaType, onOpenDetail }: { mediaType: 'movie' | 'tv'; onOpenDetail: (id: number, type: 'movie' | 'tv') => void }) {
  const popMovies  = useNorwegianMovies()
  const topMovies  = useNorwegianTopRatedMovies()
  const popTV      = useNorwegianTV()
  const topTV      = useNorwegianTopRatedTV()

  const popular    = (mediaType === 'movie' ? popMovies.data : popTV.data) ?? []
  const topRated   = (mediaType === 'movie' ? topMovies.data : topTV.data) ?? []

  const popLoading = mediaType === 'movie' ? popMovies.isLoading  : popTV.isLoading
  const topLoading = mediaType === 'movie' ? topMovies.isLoading : topTV.isLoading

  // Dedup top-rated against popular
  const popularIds = new Set(popular.map(i => i.id))
  const uniqueTop  = topRated.filter(i => !popularIds.has(i.id))

  function renderGrid(items: (TMDBSearchMovie | TMDBSearchTV)[], loading: boolean) {
    if (loading) return <SkeletonGrid count={10} />
    return (
      <div className={GRID}>
        {items.slice(0, 20).map(item => (
          <TMDBCard
            key={item.id}
            item={item}
            type={mediaType}
            onOpenDetail={id => onOpenDetail(id, mediaType)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-2">Popular in Norway</p>
        {renderGrid(popular, popLoading)}
      </div>
      {(uniqueTop.length > 0 || topLoading) && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-2">Top Rated in Norway</p>
          {renderGrid(uniqueTop, topLoading)}
        </div>
      )}
    </div>
  )
}

export function DiscoveryTabs({ mediaType, onOpenDetail }: Props) {
  const [tab,        setTab]       = useState<DiscoveryTab>('today')
  const [lastSynced, setLastSynced] = useState<Date | null>(null)

  const trendDay  = useTrendingMovies('day',  false)
  const trendWeek = useTrendingMovies('week', false)
  const popular   = usePopularMovies(false)
  const upcoming  = useUpcomingMovies(false)

  const tvTrendDay  = useTrendingTV('day',  false)
  const tvTrendWeek = useTrendingTV('week', false)
  const tvPopular   = usePopularTV(false)
  const tvUpcoming  = useUpcomingTV(false)

  const activeQuery = tab === 'norway' ? null
    : mediaType === 'movie'
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <div className="flex gap-1 bg-cream-100 rounded-lg p-1 w-full sm:w-auto overflow-x-auto scrollbar-none scroll-fade-x snap-x-mandatory">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-shrink-0 sm:flex-none px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 min-h-[44px] whitespace-nowrap press-feedback snap-start ${
                tab === t.key
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'norway' && (
          <div className="flex items-center gap-1.5 sm:ml-auto">
            <span className="text-[10px] text-ink-400 hidden sm:block">{syncLabel}</span>
            <button
              onClick={handleManualSync}
              title="Refresh now"
              className="text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              ↻
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {tab === 'norway' ? (
        <NorwaySection mediaType={mediaType} onOpenDetail={onOpenDetail} />
      ) : activeQuery?.isLoading ? (
        <SkeletonGrid />
      ) : (
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
