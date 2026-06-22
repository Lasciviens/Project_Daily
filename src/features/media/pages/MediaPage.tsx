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
import { CompactLibraryStrip } from '../components/CompactLibraryStrip'
import { useMovies } from '../hooks/useMovies'
import { useTVSeries } from '../hooks/useTVSeries'
import type { UserMovieEntry, UserTVEntry } from '../types'

type Tab    = 'movies' | 'tv'
type SortBy = 'added' | 'rating' | 'alpha'

interface DetailState { tmdbId: number; type: 'movie' | 'tv' }

const GRID = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-9 gap-3'

function sortMovies(entries: UserMovieEntry[], by: SortBy): UserMovieEntry[] {
  return [...entries].sort((a, b) => {
    if (by === 'rating') return (b.movie.tmdb_rating ?? 0) - (a.movie.tmdb_rating ?? 0)
    if (by === 'alpha')  return a.movie.title.localeCompare(b.movie.title)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function sortTV(entries: UserTVEntry[], by: SortBy): UserTVEntry[] {
  return [...entries].sort((a, b) => {
    if (by === 'rating') return (b.tv_series.tmdb_rating ?? 0) - (a.tv_series.tmdb_rating ?? 0)
    if (by === 'alpha')  return a.tv_series.title.localeCompare(b.tv_series.title)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function MediaPage() {
  const [tab,    setTab]    = useState<Tab>('movies')
  const [sortBy, setSortBy] = useState<SortBy>('added')
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

  const watchingMovies  = sortMovies(movieEntries.filter(e => e.status === 'watching'), sortBy)
  const wishlistMovies  = sortMovies(movieEntries.filter(e => e.status === 'wishlist'), sortBy)
  const completedMovies = sortMovies(movieEntries.filter(e => e.status === 'completed' || e.status === 'dropped'), sortBy)

  const watchingTV  = sortTV(tvEntries.filter(e => e.status === 'watching' || e.status === 'paused'), sortBy)
  const wishlistTV  = sortTV(tvEntries.filter(e => e.status === 'wishlist'), sortBy)
  const completedTV = sortTV(tvEntries.filter(e => e.status === 'completed' || e.status === 'dropped'), sortBy)

  const hasLibrary = movieEntries.length > 0 || tvEntries.length > 0

  const compactLibrary = hasLibrary ? (
    <CompactLibraryStrip
      tab={tab}
      movieEntries={movieEntries}
      tvEntries={tvEntries}
      onOpenDetail={openDetail}
    />
  ) : null

  return (
    <div className="w-full px-4 sm:px-6 py-6">
      <h1 className="text-lg font-semibold text-ink-900 mb-5">Media</h1>

      <div className="flex gap-6 items-start">

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">
          <div className="mb-5">
            <MediaSearch onSelectResult={(id, type) => openDetail(id, type)} />
          </div>

          {/* Tab switcher + sort */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
            <div className="flex gap-1 bg-cream-100 rounded-lg p-1 w-full sm:w-fit">
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
            {hasLibrary && (
              <div className="flex items-center gap-1 sm:ml-auto flex-wrap">
                <span className="text-[11px] text-ink-400 mr-1">Sort:</span>
                {(['added', 'rating', 'alpha'] as SortBy[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`text-[11px] min-h-[44px] px-3 rounded-lg transition-colors duration-150 ${
                      sortBy === s ? 'bg-accent-100 text-accent-700 font-medium' : 'text-ink-500 hover:bg-ink-100'
                    }`}
                  >
                    {s === 'added' ? 'Latest' : s === 'rating' ? '★ Rating' : 'A–Z'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Discovery + compact library injected between tab bar and content */}
          <DiscoveryTabs
            mediaType={tab === 'movies' ? 'movie' : 'tv'}
            onOpenDetail={openDetail}
            librarySlot={compactLibrary}
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
        </div>

        {/* ── Right sidebar ── */}
        <aside className="hidden lg:flex flex-col gap-4 w-56 flex-shrink-0 sticky top-20">
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
  )
}
