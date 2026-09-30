import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MediaHeroArt } from '../components/MediaHeroArt'
import { MediaSearch } from '../components/MediaSearch'
import { DiscoveryTabs } from '../components/DiscoveryTabs'
import { TonightPicker } from '../components/TonightPicker'
import { MediaStats } from '../components/MediaStats'
import { ReleaseCalendar } from '../components/ReleaseCalendar'
import { LibrarySummary } from '../components/LibrarySummary'
import { LibraryView } from '../components/LibraryView'
import { ListsView } from '../components/ListsView'
import { YearInReview } from '../components/YearInReview'
import { ContinueWatching } from '../components/ContinueWatching'
import { BUCKET_ORDER, libraryItems, type LibraryBucket } from '../libraryModel'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useMovies } from '../hooks/useMovies'
import { useTVSeries } from '../hooks/useTVSeries'
import { useCinemaMovieIds } from '../hooks/useLibraryIndex'
import { useEntityModal } from '../../../shared/modals'
import { PageBoard, PageContainer, PageHeader, SegmentedControl } from '../../../shared/ui'
import { MEDIA_BOARD, type MediaSection } from '../mediaBoard'
import type { MediaType } from '../types'

type Tab = 'movies' | 'tv'
type View = 'overview' | 'library' | 'lists' | 'year'

const isBucket = (v: string | null): v is LibraryBucket => !!v && (BUCKET_ORDER as string[]).includes(v)

/**
 * Media, laid out by PageBoard (mediaBoard.ts says which card goes where at
 * each width). Only the sections a step places are mounted.
 */
export function MediaPage() {
  const [tab, setTab] = useState<Tab>('movies')
  const [params, setParams] = useSearchParams()
  const viewParam = params.get('view')
  const view: View = viewParam === 'library' || viewParam === 'lists' || viewParam === 'year' ? viewParam : 'overview'
  const statusParam = params.get('status')
  const bucket: LibraryBucket | 'all' = isBucket(statusParam) ? statusParam : 'all'
  const modal = useEntityModal()

  // The Library view lives in the address (?view=library&status=…) so Back returns to the overview.
  const openLibrary = (b?: LibraryBucket) => setParams(p => {
    const next = new URLSearchParams(p)
    next.set('view', 'library')
    if (b) next.set('status', b); else next.delete('status')
    return next
  })
  const setView = (v: View) => (v === 'library' ? openLibrary() : setParams(p => {
    const next = new URLSearchParams(p)
    next.delete('status')
    if (v === 'lists' || v === 'year') next.set('view', v); else next.delete('view')
    return next
  }))
  const setBucket = (b: LibraryBucket | 'all') => setParams(p => {
    const next = new URLSearchParams(p)
    if (b === 'all') next.delete('status'); else next.set('status', b)
    return next
  }, { replace: true })

  const { data: movieEntries = [], isLoading: moviesLoading } = useMovies()
  const { data: tvEntries = [], isLoading: tvLoading } = useTVSeries()

  const openDetail = (tmdbId: number, mediaType: MediaType) => modal.open({ kind: 'media', tmdbId, mediaType })
  const hasLibrary = movieEntries.length > 0 || tvEntries.length > 0
  const mediaType: MediaType = tab === 'movies' ? 'movie' : 'tv'

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
  const stats = hasLibrary ? <MediaStats movieEntries={movieEntries} tvEntries={tvEntries} loading={libraryLoading} /> : null

  const sections: Record<MediaSection, ReactNode> = {
    // A still film-strip motif sits behind the search + library card only.
    library: (
      <section className="card relative p-4 sm:p-5">
        <MediaHeroArt />
        <div className="relative z-10 flex flex-col gap-4">
          <MediaSearch mediaType={mediaType} onSelectResult={openDetail} />
          <ContinueWatching posters={posters} onOpenDetail={openDetail} />
          {!libraryLoading && hasLibrary && (
            <LibrarySummary items={items} mediaType={mediaType} onOpenDetail={openDetail} onOpenLibrary={openLibrary} />
          )}
        </div>
      </section>
    ),
    discovery: <DiscoveryTabs mediaType={mediaType} onOpenDetail={openDetail} />,
    // Phones and tablets: the three tools under the main cards, one column
    // on a phone and two once the grid itself is 36rem wide.
    tools: (
      <div className="@container">
        <div className="grid grid-cols-1 items-start gap-4 @[36rem]:grid-cols-2">{tonight}{calendar}{stats}</div>
      </div>
    ),
    tonight,
    calendar,
    stats,
  }

  return (
    <PageContainer>
      <PageHeader title="Media">
        <div className="flex flex-wrap gap-2">
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[{ value: 'movies', label: 'Movies' }, { value: 'tv', label: 'TV' }]}
          />
          <SegmentedControl<View>
            value={view}
            onChange={setView}
            options={[{ value: 'overview', label: 'Overview' }, { value: 'library', label: 'Library' }, { value: 'lists', label: 'Lists' }, { value: 'year', label: 'Year' }]}
          />
        </div>
      </PageHeader>

      {view === 'library'
        ? <LibraryView items={items} mediaType={mediaType} bucket={bucket} onBucketChange={setBucket} onOpenDetail={openDetail} />
        : view === 'lists'
        ? <ListsView onOpenDetail={openDetail} />
        : view === 'year'
        ? <YearInReview onOpenDetail={openDetail} />
        : <PageBoard sections={sections} layout={MEDIA_BOARD} stackGap="gap-5" stackClassName="stagger-in" />}
    </PageContainer>
  )
}
