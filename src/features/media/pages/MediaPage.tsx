import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MediaBackdrop } from '../components/MediaBackdrop'
import { MediaSearch } from '../components/MediaSearch'
import { DiscoveryTabs } from '../components/DiscoveryTabs'
import { TonightPicker } from '../components/TonightPicker'
import { MediaStats } from '../components/MediaStats'
import { ReleaseCalendar } from '../components/ReleaseCalendar'
import { LibrarySummary } from '../components/LibrarySummary'
import { LibraryView } from '../components/LibraryView'
import { BUCKET_ORDER, libraryItems, type LibraryBucket } from '../libraryModel'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useMovies } from '../hooks/useMovies'
import { useTVSeries } from '../hooks/useTVSeries'
import { useEntityModal } from '../../../shared/modals'
import { PageBoard, PageContainer, PageHeader, SegmentedControl } from '../../../shared/ui'
import { MEDIA_BOARD, type MediaSection } from '../mediaBoard'
import type { MediaType } from '../types'

type Tab = 'movies' | 'tv'
type View = 'overview' | 'library'

const isBucket = (v: string | null): v is LibraryBucket => !!v && (BUCKET_ORDER as string[]).includes(v)

/**
 * Media, laid out by PageBoard (mediaBoard.ts says which card goes where at
 * each width). Only the sections a step places are mounted.
 */
export function MediaPage() {
  const [tab, setTab] = useState<Tab>('movies')
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'library' ? 'library' : 'overview'
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
    next.delete('view'); next.delete('status')
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
  const items = useMemo(() => libraryItems(tab, movieEntries, tvEntries, todayStr()), [tab, movieEntries, tvEntries])

  const tonight = <TonightPicker movieEntries={movieEntries} tvEntries={tvEntries} onOpenDetail={openDetail} />
  const calendar = <ReleaseCalendar movieEntries={movieEntries} tvEntries={tvEntries} onOpenDetail={openDetail} loading={libraryLoading} />
  const stats = hasLibrary ? <MediaStats movieEntries={movieEntries} tvEntries={tvEntries} loading={libraryLoading} /> : null

  const sections: Record<MediaSection, ReactNode> = {
    // The rotating backdrop is scoped to the search + library card only.
    library: (
      <section className="card relative p-4 sm:p-5">
        <MediaBackdrop />
        <div className="relative z-10 flex flex-col gap-4">
          <MediaSearch mediaType={mediaType} onSelectResult={openDetail} />
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
            options={[{ value: 'movies', label: 'Movies' }, { value: 'tv', label: 'TV series' }]}
          />
          <SegmentedControl<View>
            value={view}
            onChange={setView}
            options={[{ value: 'overview', label: 'Overview' }, { value: 'library', label: 'Library' }]}
          />
        </div>
      </PageHeader>

      {view === 'library'
        ? <LibraryView items={items} mediaType={mediaType} bucket={bucket} onBucketChange={setBucket} onOpenDetail={openDetail} />
        : <PageBoard sections={sections} layout={MEDIA_BOARD} stackGap="gap-5" stackClassName="stagger-in" />}
    </PageContainer>
  )
}
