import { useState } from 'react'
import { MediaSearch } from '../components/MediaSearch'
import { MediaSection } from '../components/MediaSection'
import { MovieCard } from '../components/MovieCard'
import { TVCard } from '../components/TVCard'
import { DiscoveryTabs } from '../components/DiscoveryTabs'
import { MediaDetailModal } from '../components/MediaDetailModal'
import { TonightPicker } from '../components/TonightPicker'
import { MediaStats } from '../components/MediaStats'
import { ReleaseCalendar } from '../components/ReleaseCalendar'
import { useMovies } from '../hooks/useMovies'
import { useTVSeries } from '../hooks/useTVSeries'
import type { UserMovieEntry, UserTVEntry } from '../types'

type Tab = 'movies' | 'tv'

interface DetailState { tmdbId: number; type: 'movie' | 'tv' }

const GRID = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-6 gap-3'

export function MediaPage() {
  const [tab, setTab]         = useState<Tab>('movies')
  const [detail, setDetail]   = useState<DetailState | null>(null)

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

  const watchingMovies  = movieEntries.filter(e => e.status === 'watching')
  const wishlistMovies  = movieEntries.filter(e => e.status === 'wishlist')
  const completedMovies = movieEntries.filter(e => e.status === 'completed' || e.status === 'dropped')

  const watchingTV  = tvEntries.filter(e => e.status === 'watching' || e.status === 'paused')
  const wishlistTV  = tvEntries.filter(e => e.status === 'wishlist')
  const completedTV = tvEntries.filter(e => e.status === 'completed' || e.status === 'dropped')

  const hasLibrary = movieEntries.length > 0 || tvEntries.length > 0

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-semibold text-ink-900">Media</h1>
      </div>

      <div className="mb-5">
        <MediaSearch onSelectResult={(id, type) => openDetail(id, type)} />
      </div>

      {/* Tonight's pick + release calendar — only when library has content */}
      {hasLibrary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
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
        </div>
      )}

      {/* Stats — collapsed by default, only when there's something to show */}
      {hasLibrary && (
        <MediaStats movieEntries={movieEntries} tvEntries={tvEntries} />
      )}

      {/* Main tab switcher */}
      <div className="flex gap-1 mb-6 bg-cream-100 rounded-lg p-1 w-fit">
        {(['movies', 'tv'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 ${
              tab === t
                ? 'bg-white text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {t === 'movies' ? 'Movies' : 'TV Series'}
          </button>
        ))}
      </div>

      {/* Discovery */}
      <DiscoveryTabs
        mediaType={tab === 'movies' ? 'movie' : 'tv'}
        onOpenDetail={openDetail}
      />

      {/* User library */}
      {tab === 'movies' ? (
        <>
          {(wishlistMovies.length > 0 || moviesLoading) && (
            <MediaSection title="Wishlist" count={wishlistMovies.length} loading={moviesLoading}>
              <div className={GRID}>
                {wishlistMovies.map(e => (
                  <MovieCard key={e.id} entry={e}
                    onOpenDetail={() => openDetail(e.movie.tmdb_id, 'movie')} />
                ))}
              </div>
            </MediaSection>
          )}
          {(watchingMovies.length > 0 || moviesLoading) && (
            <MediaSection title="Watching" count={watchingMovies.length} loading={moviesLoading}>
              <div className={GRID}>
                {watchingMovies.map(e => (
                  <MovieCard key={e.id} entry={e}
                    onOpenDetail={() => openDetail(e.movie.tmdb_id, 'movie')} />
                ))}
              </div>
            </MediaSection>
          )}
          {completedMovies.length > 0 && (
            <MediaSection title="Completed" count={completedMovies.length} defaultOpen={false}>
              <div className={GRID}>
                {completedMovies.map(e => (
                  <MovieCard key={e.id} entry={e}
                    onOpenDetail={() => openDetail(e.movie.tmdb_id, 'movie')} />
                ))}
              </div>
            </MediaSection>
          )}
        </>
      ) : (
        <>
          {(wishlistTV.length > 0 || tvLoading) && (
            <MediaSection title="Wishlist" count={wishlistTV.length} loading={tvLoading}>
              <div className={GRID}>
                {wishlistTV.map(e => (
                  <TVCard key={e.id} entry={e}
                    onOpenDetail={() => openDetail(e.tv_series.tmdb_id, 'tv')} />
                ))}
              </div>
            </MediaSection>
          )}
          {(watchingTV.length > 0 || tvLoading) && (
            <MediaSection title="Watching / Paused" count={watchingTV.length} loading={tvLoading}>
              <div className={GRID}>
                {watchingTV.map(e => (
                  <TVCard key={e.id} entry={e}
                    onOpenDetail={() => openDetail(e.tv_series.tmdb_id, 'tv')} />
                ))}
              </div>
            </MediaSection>
          )}
          {completedTV.length > 0 && (
            <MediaSection title="Completed" count={completedTV.length} defaultOpen={false}>
              <div className={GRID}>
                {completedTV.map(e => (
                  <TVCard key={e.id} entry={e}
                    onOpenDetail={() => openDetail(e.tv_series.tmdb_id, 'tv')} />
                ))}
              </div>
            </MediaSection>
          )}
        </>
      )}

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
  )
}
