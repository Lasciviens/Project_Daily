import { useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { TMDBCard } from './TMDBCard'
import { IconButton, SectionLabel, Skeleton } from '../../../shared/ui'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV,
  useUpcomingMovies, useUpcomingTV,
  useNorwegianMovies, useNorwegianTV,
  useNorwegianTopRatedMovies, useNorwegianTopRatedTV,
} from '../hooks/useTMDB'
import type { MediaType, TMDBSearchMovie, TMDBSearchTV } from '../types'

type DiscoveryTab = 'today' | 'week' | 'popular' | 'upcoming' | 'norway'

interface Props {
  mediaType:    MediaType
  onOpenDetail: (id: number, type: MediaType) => void
}

const TABS: { key: DiscoveryTab; label: string }[] = [
  { key: 'today',    label: 'Today' },
  { key: 'week',     label: 'This week' },
  { key: 'popular',  label: 'Popular' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'norway',   label: 'Norway' },
]

// Column flow: the count follows the width, posters keep their size.
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(6.5rem,9rem))] justify-start gap-3'

function SkeletonGrid({ count = 20 }: { count?: number }) {
  return (
    <div className={GRID}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <Skeleton rounded="rounded-row" className="aspect-[2/3] w-full" />
          <Skeleton className="mt-1.5 h-3 w-3/4" />
        </div>
      ))}
    </div>
  )
}

function PosterGrid({ items, mediaType, onOpenDetail, limit }: {
  items: (TMDBSearchMovie | TMDBSearchTV)[]
  mediaType: MediaType
  onOpenDetail: Props['onOpenDetail']
  limit: number
}) {
  if (items.length === 0) return <p className="text-body text-fg-muted">Nothing to show here right now.</p>
  return (
    <div className={GRID}>
      {items.slice(0, limit).map(item => (
        <TMDBCard key={item.id} item={item} type={mediaType} onOpenDetail={id => onOpenDetail(id, mediaType)} />
      ))}
    </div>
  )
}

function NorwaySection({ mediaType, onOpenDetail }: Props) {
  const popMovies = useNorwegianMovies()
  const topMovies = useNorwegianTopRatedMovies()
  const popTV     = useNorwegianTV()
  const topTV     = useNorwegianTopRatedTV()

  const popQ = mediaType === 'movie' ? popMovies : popTV
  const topQ = mediaType === 'movie' ? topMovies : topTV
  const popular = popQ.data ?? []

  // Top rated is deduped against popular so the two rows never repeat a title.
  const popularIds = new Set(popular.map(i => i.id))
  const uniqueTop  = (topQ.data ?? []).filter(i => !popularIds.has(i.id))

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">Popular in Norway</SectionLabel>
        {popQ.isLoading ? <SkeletonGrid count={10} /> : <PosterGrid items={popular} mediaType={mediaType} onOpenDetail={onOpenDetail} limit={20} />}
      </div>
      {(uniqueTop.length > 0 || topQ.isLoading) && (
        <div>
          <SectionLabel className="mb-2">Top rated in Norway</SectionLabel>
          {topQ.isLoading ? <SkeletonGrid count={10} /> : <PosterGrid items={uniqueTop} mediaType={mediaType} onOpenDetail={onOpenDetail} limit={20} />}
        </div>
      )}
    </div>
  )
}

export function DiscoveryTabs({ mediaType, onOpenDetail }: Props) {
  const [tab, setTab] = useState<DiscoveryTab>('today')
  const [lastSynced, setLastSynced] = useState<Date | null>(null)

  const trendDay  = useTrendingMovies('day')
  const trendWeek = useTrendingMovies('week')
  const popular   = usePopularMovies()
  const upcoming  = useUpcomingMovies()

  const tvTrendDay  = useTrendingTV('day')
  const tvTrendWeek = useTrendingTV('week')
  const tvPopular   = usePopularTV()
  const tvUpcoming  = useUpcomingTV()

  const activeQuery = tab === 'norway' ? null
    : mediaType === 'movie'
      ? { today: trendDay, week: trendWeek, popular, upcoming }[tab]
      : { today: tvTrendDay, week: tvTrendWeek, popular: tvPopular, upcoming: tvUpcoming }[tab]

  const handleManualSync = useCallback(() => {
    activeQuery?.refetch()
    setLastSynced(new Date())
  }, [activeQuery])

  const syncLabel = lastSynced
    ? `Refreshed ${lastSynced.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : null

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <div role="tablist" aria-label="Discover" className="scroll-x flex min-w-0 flex-1 gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className="pill-tab press-feedback shrink-0"
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== 'norway' && (
          <div className="flex shrink-0 items-center gap-1">
            {syncLabel && <span className="hidden text-meta text-fg-muted sm:block">{syncLabel}</span>}
            <IconButton label="Refresh now" onClick={handleManualSync}>
              <RefreshCw className={activeQuery?.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </div>
        )}
      </div>

      {tab === 'norway' ? (
        <NorwaySection mediaType={mediaType} onOpenDetail={onOpenDetail} />
      ) : activeQuery?.isLoading ? (
        <SkeletonGrid />
      ) : activeQuery?.isError ? (
        <p className="text-body text-fg-muted">Couldn't load this list. Try refreshing.</p>
      ) : (
        <PosterGrid items={activeQuery?.data ?? []} mediaType={mediaType} onOpenDetail={onOpenDetail} limit={30} />
      )}
    </section>
  )
}
