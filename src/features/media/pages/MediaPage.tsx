import { useState } from 'react'
import { MediaBackdrop } from '../components/MediaBackdrop'
import { MediaSearch } from '../components/MediaSearch'
import { DiscoveryTabs } from '../components/DiscoveryTabs'
import { TonightPicker } from '../components/TonightPicker'
import { MediaStats } from '../components/MediaStats'
import { ReleaseCalendar } from '../components/ReleaseCalendar'
import { CompactLibraryStrip } from '../components/CompactLibraryStrip'
import { useMovies } from '../hooks/useMovies'
import { useTVSeries } from '../hooks/useTVSeries'
import { useEntityModal } from '../../../shared/modals'
import { PageContainer, PageHeader, SegmentedControl } from '../../../shared/ui'
import type { MediaType } from '../types'

type Tab = 'movies' | 'tv'

export function MediaPage() {
  const [tab, setTab] = useState<Tab>('movies')
  const modal = useEntityModal()

  const { data: movieEntries = [], isLoading: moviesLoading } = useMovies()
  const { data: tvEntries = [], isLoading: tvLoading } = useTVSeries()

  const openDetail = (tmdbId: number, mediaType: MediaType) => modal.open({ kind: 'media', tmdbId, mediaType })
  const hasLibrary = movieEntries.length > 0 || tvEntries.length > 0

  const sideWidgets = (
    <>
      <TonightPicker movieEntries={movieEntries} tvEntries={tvEntries} onOpenDetail={openDetail} />
      <ReleaseCalendar movieEntries={movieEntries} tvEntries={tvEntries} onOpenDetail={openDetail} />
      {hasLibrary && <MediaStats movieEntries={movieEntries} tvEntries={tvEntries} />}
    </>
  )

  return (
    <PageContainer width="full">
      <PageHeader
        // Ends where the column + rail end, not at the viewport edge.
        className="max-w-[93.25rem]"
        title="Media"
        actions={
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[{ value: 'movies', label: 'Movies' }, { value: 'tv', label: 'TV series' }]}
          />
        }
      />

      <div className="flex items-start gap-5">
        {/* Capped so a monitor doesn't smear a two-poster library across
            2,000px; the rail then sits right beside the column. */}
        <div className="stagger-in flex min-w-0 max-w-[72rem] flex-1 flex-col gap-5">
          {/* The rotating backdrop is scoped to the search + library card only. */}
          <section className="card relative p-4 sm:p-5">
            <MediaBackdrop />
            <div className="relative z-10 flex flex-col gap-4">
              <MediaSearch mediaType={tab === 'movies' ? 'movie' : 'tv'} onSelectResult={openDetail} />
              {!moviesLoading && !tvLoading && hasLibrary && (
                <CompactLibraryStrip tab={tab} movieEntries={movieEntries} tvEntries={tvEntries} onOpenDetail={openDetail} />
              )}
            </div>
          </section>

          <DiscoveryTabs mediaType={tab === 'movies' ? 'movie' : 'tv'} onOpenDetail={openDetail} />
        </div>

        <aside className="sticky top-4 hidden w-80 shrink-0 flex-col gap-4 lg:flex">{sideWidgets}</aside>
      </div>

      {/* Below the main column on narrower screens; two columns from sm. */}
      <div className="mt-5 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:hidden">{sideWidgets}</div>
    </PageContainer>
  )
}
