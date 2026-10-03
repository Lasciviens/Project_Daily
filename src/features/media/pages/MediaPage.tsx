import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MediaHeroArt } from '../components/MediaHeroArt'
import { MediaSearch } from '../components/MediaSearch'
import { MediaSearchResults } from '../components/MediaSearchResults'
import { MediaTypePills } from '../components/MediaTypePills'
import { useSearchTitles } from '../hooks/useTMDB'
import { useMediaSearchSession } from '../hooks/useMediaSearchSession'
import { DiscoveryTabs } from '../components/DiscoveryTabs'
import { TonightPicker } from '../components/TonightPicker'
import { ReleaseCalendar } from '../components/ReleaseCalendar'
import { LibrarySummary } from '../components/LibrarySummary'
import { LibraryView } from '../components/LibraryView'
import { ListsView } from '../components/ListsView'
import { MediaStatsView } from '../components/stats/MediaStatsView'
import { ContinueWatching } from '../components/ContinueWatching'
import { BUCKET_ORDER, libraryItems, type LibraryBucket } from '../libraryModel'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useMovies } from '../hooks/useMovies'
import { useTVSeries } from '../hooks/useTVSeries'
import { useCinemaMovieIds } from '../hooks/useLibraryIndex'
import { useEntityModal } from '../../../shared/modals'
import { PageBoard, PageContainer, PageHeader, SegmentedControl } from '../../../shared/ui'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { MEDIA_BOARD, type MediaSection } from '../mediaBoard'
import type { MediaType, OpenMediaDetail } from '../types'

type Tab = 'movies' | 'tv'
type View = 'overview' | 'library' | 'lists' | 'stats'

const isBucket = (v: string | null): v is LibraryBucket => !!v && (BUCKET_ORDER as string[]).includes(v)

/**
 * Media, laid out by PageBoard (mediaBoard.ts says which card goes where at
 * each width). Only the sections a step places are mounted.
 */
export function MediaPage() {
  const [tab, setTab] = useState<Tab>('movies')
  const [params, setParams] = useSearchParams()
  const viewParam = params.get('view')
  // ?view=year is the old address of Stats.
  const view: View = viewParam === 'library' || viewParam === 'lists' ? viewParam : viewParam === 'stats' || viewParam === 'year' ? 'stats' : 'overview'
  const statusParam = params.get('status')
  const bucket: LibraryBucket | 'all' = isBucket(statusParam) ? statusParam : 'all'
  const modal = useEntityModal()

  const search = useMediaSearchSession()
  const searching = view === 'overview' && search.inSearch
  // Each type's result count rides on the type switch (the results read the same queries).
  const searchedMovies = useSearchTitles('movie', searching && !search.pending ? search.settled : '')
  const searchedTv = useSearchTitles('tv', searching && !search.pending ? search.settled : '')
  const countOf = (r: typeof searchedMovies) => {
    const n = r.data?.pages[0]?.total
    return r.isError ? '!' : n == null ? '…' : n.toLocaleString('en-GB')
  }
  const searchCounts = searching && !search.pending && search.settled.trim()
    ? { movie: countOf(searchedMovies), tv: countOf(searchedTv) }
    : undefined

  // The Library view lives in the address (?view=library&status=…) so Back returns to the overview.
  const openLibrary = (b?: LibraryBucket) => setParams(p => {
    const next = new URLSearchParams(p)
    next.set('view', 'library')
    next.delete('q')
    if (b) next.set('status', b); else next.delete('status')
    return next
  })
  // Overview while searching leaves the search (one Back), like ✕.
  const setView = (v: View) => (v === 'overview' && search.inSearch ? search.leave() : v === 'library' ? openLibrary() : setParams(p => {
    const next = new URLSearchParams(p)
    next.delete('status')
    next.delete('q')
    if (v === 'lists' || v === 'stats') next.set('view', v); else next.delete('view')
    return next
  }))
  const setBucket = (b: LibraryBucket | 'all') => setParams(p => {
    const next = new URLSearchParams(p)
    if (b === 'all') next.delete('status'); else next.set('status', b)
    return next
  }, { replace: true })

  const { data: movieEntries = [], isLoading: moviesLoading } = useMovies()
  const { data: tvEntries = [], isLoading: tvLoading } = useTVSeries()

  const openDetail: OpenMediaDetail = (tmdbId, mediaType, sequence) => modal.open({ kind: 'media', tmdbId, mediaType, sequence })
  const hasLibrary = movieEntries.length > 0 || tvEntries.length > 0
  const mediaType: MediaType = tab === 'movies' ? 'movie' : 'tv'
  const setMediaType = (t: MediaType) => setTab(t === 'movie' ? 'movies' : 'tv')
  const typePills = (counts?: Partial<Record<MediaType, string>>) => <MediaTypePills value={mediaType} onChange={setMediaType} counts={counts} />
  const isPhone = useBreakpoint() === 'phone'

  const libraryLoading = moviesLoading || tvLoading
  const cinema = useCinemaMovieIds()
  const items = useMemo(() => libraryItems(tab, movieEntries, tvEntries, todayStr(), cinema), [tab, movieEntries, tvEntries, cinema])
  // Library posters by type:tmdb, so Trakt-only tiles (Continue watching) skip a TMDB read when the title is known.
  const posters = useMemo(() => new Map<string, string | null>([
    ...movieEntries.map(e => [`movie:${e.movie.tmdb_id}`, e.movie.poster_path] as const),
    ...tvEntries.map(e => [`tv:${e.tv_series.tmdb_id}`, e.tv_series.poster_path] as const),
  ]), [movieEntries, tvEntries])

  const tonight = <TonightPicker movieEntries={movieEntries} tvEntries={tvEntries} onOpenDetail={openDetail} />
  const calendar = <ReleaseCalendar movieEntries={movieEntries} tvEntries={tvEntries} onOpenDetail={openDetail} loading={libraryLoading} />

  const sections: Record<MediaSection, ReactNode> = {
    // The search box is its own card (a still film-strip motif behind it);
    // Continue watching is a separate card under it, hidden while searching.
    library: (
      <div className="flex flex-col gap-4">
        <section className="card relative p-3 sm:p-4">
          <MediaHeroArt />
          {/* One row from the tablet up; on a phone the type switch wraps under the box. */}
          <div className="relative z-10 flex flex-wrap items-center gap-2">
            <MediaSearch value={search.text} onChange={search.change} onClear={search.leave} active={searching} />
            {typePills(searchCounts)}
          </div>
        </section>
        {!searching && <ContinueWatching posters={posters} onOpenDetail={openDetail} />}
      </div>
    ),
    // Your library: under search on a phone, in the right-hand column from the laptop.
    summary: !libraryLoading && hasLibrary
      ? <LibrarySummary items={items} mediaType={mediaType} onOpenDetail={openDetail} onOpenLibrary={openLibrary} />
      : null,
    discovery: <DiscoveryTabs mediaType={mediaType} onOpenDetail={openDetail} />,
    // Phones and tablets: the two tools under the main cards, one column
    // on a phone and two once the grid itself is 36rem wide.
    tools: (
      <div className="@container">
        <div className="grid grid-cols-1 items-start gap-4 @[36rem]:grid-cols-2">{tonight}{calendar}</div>
      </div>
    ),
    tonight,
    calendar,
  }
  // While searching, the results take Discover's place (the search card stays
  // mounted, so typing keeps focus). A phone drops the tools under them; wider
  // pages keep their side columns.
  const shown: Record<MediaSection, ReactNode> = searching
    ? {
        ...sections,
        tools: null,
        discovery: <MediaSearchResults query={search.settled} pending={search.pending} mediaType={mediaType} onOpenDetail={openDetail} onClear={search.leave} />,
      }
    : sections

  return (
    <PageContainer>
      {/* One control in the header; the Movies | TV switch sits with what it
          scopes (the search card, the Library view). */}
      <PageHeader title="Media">
        <SegmentedControl<View>
          value={view}
          onChange={setView}
          fullWidth={isPhone}
          options={[{ value: 'overview', label: 'Overview' }, { value: 'library', label: 'Library' }, { value: 'lists', label: 'Lists' }, { value: 'stats', label: 'Stats' }]}
        />
      </PageHeader>

      {view === 'library'
        ? <LibraryView items={items} mediaType={mediaType} typeSwitch={typePills()} bucket={bucket} onBucketChange={setBucket} onOpenDetail={openDetail} />
        : view === 'lists'
        ? <ListsView onOpenDetail={openDetail} />
        : view === 'stats'
        ? <MediaStatsView onOpenDetail={openDetail} />
        : <PageBoard sections={shown} layout={MEDIA_BOARD} stackGap="gap-5" stackClassName="stagger-in" />}
    </PageContainer>
  )
}
