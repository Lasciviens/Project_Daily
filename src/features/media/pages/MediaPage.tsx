import { useState } from 'react'
import { MediaBackdrop } from '../components/MediaBackdrop'
import { MediaSearch } from '../components/MediaSearch'
import { DiscoveryTabs } from '../components/DiscoveryTabs'
import { MediaDetailModal } from '../components/MediaDetailModal'
import { TonightPicker } from '../components/TonightPicker'
import { MediaStats } from '../components/MediaStats'
import { ReleaseCalendar } from '../components/ReleaseCalendar'
import { CompactLibraryStrip } from '../components/CompactLibraryStrip'
import { useMovies } from '../hooks/useMovies'
import { useTVSeries } from '../hooks/useTVSeries'
import type { UserMovieEntry, UserTVEntry } from '../types'

type Tab = 'movies' | 'tv'

interface DetailState { tmdbId: number; type: 'movie' | 'tv' }

export function MediaPage() {
  const [tab,    setTab]    = useState<Tab>('movies')
  const [detail, setDetail] = useState<DetailState | null>(null)

  const { data: movieEntries = [], isLoading: moviesLoading } = useMovies()
  const { data: tvEntries    = [], isLoading: tvLoading      } = useTVSeries()

  function openDetail(id: number, type: 'movie' | 'tv') {
    setDetail({ tmdbId: id, type })
  }

  const userEntry: UserMovieEntry | UserTVEntry | null | undefined = detail
    ? detail.type === 'movie'
      ? movieEntries.find(e => e.movie.tmdb_id === detail.tmdbId)
      : tvEntries.find(e => e.tv_series.tmdb_id === detail.tmdbId)
    : null

  const hasLibrary = movieEntries.length > 0 || tvEntries.length > 0

  return (
    <div className="relative w-full px-4 sm:px-6 py-6">
      <MediaBackdrop />

      <div className="relative z-10">
      <h1 className="text-lg font-semibold text-ink-900 mb-5">Media</h1>

      <div className="flex gap-6 items-start">

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">
          <div className="mb-5">
            <MediaSearch onSelectResult={(id, type) => openDetail(id, type)} />
          </div>

          {/* Movies / TV Series tab */}
          <div className="flex gap-1 bg-cream-100 rounded-lg p-1 w-full sm:w-fit mb-4">
            {(['movies', 'tv'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 sm:flex-none px-4 min-h-[44px] rounded-md text-sm font-medium transition-colors duration-150 ${
                  tab === t
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink-500 hover:text-ink-700'
                }`}
              >
                {t === 'movies' ? 'Movies' : 'TV Series'}
              </button>
            ))}
          </div>

          {/* Compact library strip — above Discovery */}
          {!moviesLoading && !tvLoading && hasLibrary && (
            <CompactLibraryStrip
              tab={tab}
              movieEntries={movieEntries}
              tvEntries={tvEntries}
              onOpenDetail={openDetail}
            />
          )}

          {/* Discovery tabs */}
          <DiscoveryTabs
            mediaType={tab === 'movies' ? 'movie' : 'tv'}
            onOpenDetail={openDetail}
          />
        </div>

        {/* ── Right sidebar ── */}
        <aside className="hidden lg:flex flex-col gap-4 w-72 flex-shrink-0 sticky top-20">
          <TonightPicker
            movieEntries={movieEntries}
            tvEntries={tvEntries}
            onOpenDetail={openDetail}
          />
          <ReleaseCalendar
            movieEntries={movieEntries}
            tvEntries={tvEntries}
            onOpenDetail={openDetail}
          />
          {hasLibrary && (
            <MediaStats movieEntries={movieEntries} tvEntries={tvEntries} />
          )}
        </aside>
      </div>

      {detail && (
        <MediaDetailModal
          tmdbId={detail.tmdbId}
          mediaType={detail.type}
          userEntry={userEntry}
          onClose={() => setDetail(null)}
          onAdded={() => setDetail(null)}
          onOpenDetail={openDetail}
        />
      )}
      </div>
    </div>
  )
}
