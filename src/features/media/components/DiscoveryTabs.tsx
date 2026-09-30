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

// Column flow, compact: posters stay ~5.5–7rem (three or four across on a
// phone); from 36rem the columns share the row so no strip is left empty.
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2.5 @[36rem]:grid-cols-[repeat(auto-fill,minmax(6rem,7.5rem))] @[36rem]:justify-start'

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

  // Only the list on screen is fetched (it used to load all eight at once).
  const on = (t: DiscoveryTab, type: MediaType) => tab === t && mediaType === type
  const trendDay  = useTrendingMovies('day', on('today', 'movie'))
  const trendWeek = useTrendingMovies('week', on('week', 'movie'))
  const popular   = usePopularMovies(on('popular', 'movie'))
  const upcoming  = useUpcomingMovies(on('upcoming', 'movie'))

  const tvTrendDay  = useTrendingTV('day', on('today', 'tv'))
  const tvTrendWeek = useTrendingTV('week', on('week', 'tv'))
  const tvPopular   = usePopularTV(on('popular', 'tv'))
  const tvUpcoming  = useUpcomingTV(on('upcoming', 'tv'))

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
    <section className="@container">
      {/* The tab row scrolls sideways; the refresh icon stays at its end. */}
      <div className="mb-3 flex items-center gap-2">
        <div role="tablist" aria-label="Discover" className="scroll-x scroll-fade-x flex min-w-0 flex-1 gap-1">
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
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
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
