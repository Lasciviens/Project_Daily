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
  useOnMyServices, useWatchProviders,
} from '../hooks/useTMDB'
import { useMediaPrefs } from '../mediaPrefsStore'
import type { MediaType, TMDBSearchMovie, TMDBSearchTV } from '../types'

type DiscoveryTab = 'today' | 'week' | 'popular' | 'upcoming' | 'norway' | 'services'

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
  { key: 'services', label: 'My services' },
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

// "On my services": what's included in the subscriptions you pick (Norway,
// TMDB's JustWatch data). The picks are this device's (mediaPrefsStore).
function ServicesSection({ mediaType, onOpenDetail }: Props) {
  const { services, toggleService } = useMediaPrefs()
  const [editing, setEditing] = useState(false)
  const picking = editing || services.length === 0
  const providers = useWatchProviders(mediaType, picking || services.length > 0)
  const titles = useOnMyServices(mediaType, services, !picking)
  const names = (providers.data ?? []).filter(p => services.includes(p.provider_id)).map(p => p.provider_name)

  if (picking) {
    return (
      <div className="space-y-2">
        <p className="text-meta text-fg-muted">Pick the services you pay for in Norway.</p>
        {providers.isLoading ? <SkeletonGrid count={8} /> : (
          <div className="flex flex-wrap gap-2">
            {(providers.data ?? []).slice(0, 24).map(p => (
              <button
                key={p.provider_id}
                type="button"
                aria-pressed={services.includes(p.provider_id)}
                onClick={() => toggleService(p.provider_id)}
                className="press-feedback flex min-h-[44px] items-center gap-2 rounded-control border border-line px-2 aria-pressed:border-accent-500 aria-pressed:bg-accent-50"
              >
                <img src={`https://image.tmdb.org/t/p/w92${p.logo_path}`} alt="" className="h-7 w-7 rounded-md" />
                <span className="text-meta font-medium text-fg">{p.provider_name}</span>
              </button>
            ))}
          </div>
        )}
        {services.length > 0 && <button type="button" onClick={() => setEditing(false)} className="btn-primary btn-sm">Show titles</button>}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-meta text-fg-muted">
        Included with {names.join(', ') || `${services.length} services`} · <button type="button" onClick={() => setEditing(true)} className="font-semibold text-accent-600">Edit</button>
      </p>
      {titles.isLoading ? <SkeletonGrid /> : <PosterGrid items={titles.data ?? []} mediaType={mediaType} onOpenDetail={onOpenDetail} limit={30} />}
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

  const activeQuery = tab === 'norway' || tab === 'services' ? null
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
        {tab !== 'norway' && tab !== 'services' && (
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
      ) : tab === 'services' ? (
        <ServicesSection mediaType={mediaType} onOpenDetail={onOpenDetail} />
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
