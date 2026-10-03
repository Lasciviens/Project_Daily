import { useEffect, useMemo, useRef, useState } from 'react'
import { useScrollEdges } from '../../../shared/hooks/useScrollEdges'
import { ChevronRight, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { Button, IconButton, SegmentedControl } from '../../../shared/ui'
import { useDiscoverList } from '../hooks/useDiscover'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { useMediaPrefs } from '../mediaPrefsStore'
import { libraryKey } from '../listModel'
import { DISCOVER_TABS, NO_FILTERS, activeFilterCount, applyClientFilters, isTrending, type DiscoverFilters, type DiscoverTab } from '../discoverModel'
import { FilterRow, ServicesPicker, SkeletonGrid } from './DiscoverFilters'
import type { MediaType, OpenMediaDetail } from '../types'
import { POSTER_GRID, PosterTile } from './PosterTile'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'

// Up to 6 steps (240 titles) fetched by themselves while too few match.
const AUTO_STEPS = 6

/** 1.2k, 34k — how many people the TMDB score comes from. */
const votes = (n?: number) => (!n ? '' : n >= 1000 ? ` (${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k)` : ` (${n})`)

interface Props {
  mediaType: MediaType
  onOpenDetail: OpenMediaDetail
}

/**
 * Discover: trending, popular, top rated, in cinemas / on the air, upcoming,
 * Norway and your streaming services — filtered by genre, year and score,
 * 40 more per "Show more", each cover with its library status.
 */
export function DiscoveryTabs({ mediaType, onOpenDetail }: Props) {
  const [tab, setTab] = useState<DiscoverTab>('popular')
  const [picked, setFilters] = useState<DiscoverFilters>(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [editingServices, setEditingServices] = useState(false)
  const { services, hideGenres, hideLanguages, setHidden } = useMediaPrefs()
  // Hidden genres and languages are kept on this device (per type for genres).
  const typeHidden = hideGenres[mediaType]
  const filters = useMemo<DiscoverFilters>(() => ({ ...picked, hideGenres: typeHidden, hideLanguages }), [picked, typeHidden, hideLanguages])
  const changeFilters = (f: DiscoverFilters) => { setFilters(f); setHidden(mediaType, f.hideGenres, f.hideLanguages) }
  const index = useLibraryIndex()
  // Movie and TV genre ids differ: switching type drops the genre filter.
  const [filtersFor, setFiltersFor] = useState(mediaType)
  if (filtersFor !== mediaType) { setFiltersFor(mediaType); setFilters(f => ({ ...f, genre: null })) }

  // Today / This week share one "Trending" pill (a toggle under it).
  const tabs = DISCOVER_TABS.filter(t => t.types.includes(mediaType) && t.key !== 'week')
  const current = tab === 'week' || tabs.some(t => t.key === tab) ? tab : 'popular'
  const picking = current === 'services' && (editingServices || services.length === 0)
  const list = useDiscoverList(current, mediaType, filters, services, !picking)
  const items = useMemo(
    () => applyClientFilters(current, (list.data?.pages ?? []).flatMap(p => p.results), filters, id => index.has(libraryKey(mediaType, id)), todayStr()),
    [current, list.data, filters, index, mediaType],
  )
  const count = activeFilterCount(filters, current)
  // The tab row scrolls sideways on a phone; a › button says more lists sit beyond the edge.
  const tabsRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(tabsRef)
  // Filters applied here (hidden languages, trending's genre/score…) can empty
  // a whole step; look a few steps further before saying nothing matches.
  const pages = list.data?.pages.length ?? 0
  const lookingFurther = !picking && !!list.hasNextPage && items.length < 12 && pages > 0 && pages < AUTO_STEPS
  const { isFetching, fetchNextPage } = list
  useEffect(() => {
    if (lookingFurther && !isFetching) void fetchNextPage()
  }, [lookingFurther, isFetching, fetchNextPage])

  return (
    <section className="@container">
      <div className="mb-3 flex items-center gap-2">
        <div ref={tabsRef} role="tablist" aria-label="Discover" className="scroll-x flex min-w-0 flex-1 gap-1">
          {tabs.map(t => {
            const on = t.key === 'today' ? isTrending(current) : current === t.key
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key === 'today' && isTrending(current) ? current : t.key)} className="pill-tab press-feedback shrink-0">
                {t.key === 'today' ? 'Trending' : t.label}
              </button>
            )
          })}
        </div>
        {edges.right && (
          <IconButton label="More lists" onClick={() => tabsRef.current?.scrollBy({ left: tabsRef.current.clientWidth * 0.7, behavior: 'smooth' })}>
            <ChevronRight />
          </IconButton>
        )}
        {/* Icon (+ count) on a narrow board, so more tabs fit beside it. */}
        <Button size="sm" variant={count ? 'primary' : 'ghost'} icon={<SlidersHorizontal />} aria-expanded={showFilters} aria-label={`Filters${count ? ` (${count} on)` : ''}`} onClick={() => setShowFilters(v => !v)}>
          <span className="hidden @[36rem]:inline">Filters</span>{count ? <span className="tabular-nums"><span className="hidden @[36rem]:inline"> · </span>{count}</span> : null}
        </Button>
        <IconButton label="Refresh now" onClick={() => { void list.refetch() }}>
          <RefreshCw className={list.isFetching ? 'animate-spin' : ''} />
        </IconButton>
      </div>

      {isTrending(current) && (
        <div className="mb-3">
          <SegmentedControl<DiscoverTab> value={current} onChange={setTab} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }]} />
        </div>
      )}
      {showFilters && <div className="mb-3"><FilterRow key={mediaType} type={mediaType} filters={filters} onApply={changeFilters} tab={current} trending={isTrending(current)} /></div>}

      {current === 'services' && !picking && (
        <p className="mb-2 text-meta text-fg-muted">
          On your services · <button type="button" className="font-semibold text-accent-600" onClick={() => setEditingServices(true)}>Edit services</button>
        </p>
      )}

      {picking ? (
        <ServicesPicker type={mediaType} onDone={() => setEditingServices(false)} />
      ) : list.isLoading ? (
        <SkeletonGrid />
      ) : list.isError ? (
        <p className="text-body text-fg-muted">Couldn't load this list. {(list.error as Error)?.message} <button type="button" className="font-semibold text-accent-600" onClick={() => { void list.refetch() }}>Try again</button></p>
      ) : (
        <>
          {items.length === 0 ? (
            lookingFurther || list.isFetchingNextPage ? <SkeletonGrid count={6} />
              : <p className="text-body text-fg-muted">{list.hasNextPage ? `Nothing in the first ${list.data?.pages.flatMap(p => p.results).length ?? 0} titles matches — try Show more, or loosen the filters.` : 'Nothing matches — loosen the filters.'}</p>
          ) : (
          <ul className={POSTER_GRID}>
            {items.map(item => {
              const lib = index.get(libraryKey(mediaType, item.id))
              const date = mediaType === 'movie' ? item.release_date : item.first_air_date
              return (
                <li key={item.id} className="min-w-0">
                  <PosterTile
                    posterPath={item.poster_path}
                    title={mediaType === 'movie' ? item.title : item.name}
                    meta={[current === 'upcoming' && date ? formatDate(date) : date?.slice(0, 4), item.vote_average > 0 ? `TMDB ${item.vote_average.toFixed(1)}${votes(item.vote_count)}` : null].filter(Boolean).join(' · ') || undefined}
                    language={item.original_language}
                    bucket={lib?.bucket}
                    rt={lib?.rt}
                    favorite={lib?.favorite}
                    cinema={lib?.cinema}
                    onOpen={() => onOpenDetail(item.id, mediaType, items.map(x => ({ tmdbId: x.id, mediaType })))}
                  />
                </li>
              )
            })}
          </ul>
          )}
          {list.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => { void list.fetchNextPage() }} loading={list.isFetchingNextPage}>Show more</Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
