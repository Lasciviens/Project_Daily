import { useState } from 'react'
import { MediaSearch } from '../components/MediaSearch'
import { MediaSection } from '../components/MediaSection'
import { MovieCard } from '../components/MovieCard'
import { TVCard } from '../components/TVCard'
import { TMDBCard } from '../components/TMDBCard'
import { useMovies } from '../hooks/useMovies'
import { useTVSeries } from '../hooks/useTVSeries'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV,
} from '../hooks/useTMDB'

type Tab = 'movies' | 'tv'

const CARD_GRID = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-6 gap-3'

export function MediaPage() {
  const [tab, setTab] = useState<Tab>('movies')

  const { data: movieEntries = [], isLoading: moviesLoading } = useMovies()
  const { data: tvEntries    = [], isLoading: tvLoading      } = useTVSeries()

  const { data: trendingMoviesDay,  isLoading: tmdLoading  } = useTrendingMovies('day')
  const { data: trendingMoviesWeek, isLoading: tmwLoading  } = useTrendingMovies('week')
  const { data: popularMovies,      isLoading: pmLoading   } = usePopularMovies()
  const { data: trendingTVDay,      isLoading: ttdLoading  } = useTrendingTV('day')
  const { data: trendingTVWeek,     isLoading: ttwLoading  } = useTrendingTV('week')
  const { data: popularTV,          isLoading: ptLoading   } = usePopularTV()

  const watchingMovies  = movieEntries.filter(e => e.status === 'watching')
  const wishlistMovies  = movieEntries.filter(e => e.status === 'wishlist')
  const completedMovies = movieEntries.filter(e => e.status === 'completed' || e.status === 'dropped')

  const watchingTV  = tvEntries.filter(e => e.status === 'watching' || e.status === 'paused')
  const wishlistTV  = tvEntries.filter(e => e.status === 'wishlist')
  const completedTV = tvEntries.filter(e => e.status === 'completed' || e.status === 'dropped')

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-ink-900">Media</h1>
      </div>

      {/* Search */}
      <div className="mb-6">
        <MediaSearch />
      </div>

      {/* Tab switcher */}
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

      {tab === 'movies' ? (
        <>
          {/* Trending Today */}
          <MediaSection title="Trending Today" loading={tmdLoading}>
            <div className={CARD_GRID}>
              {(trendingMoviesDay ?? []).slice(0, 10).map(m => (
                <TMDBCard key={m.id} item={m} type="movie" />
              ))}
            </div>
          </MediaSection>

          {/* Trending This Week */}
          <MediaSection title="Trending This Week" loading={tmwLoading}>
            <div className={CARD_GRID}>
              {(trendingMoviesWeek ?? []).slice(0, 10).map(m => (
                <TMDBCard key={m.id} item={m} type="movie" />
              ))}
            </div>
          </MediaSection>

          {/* Popular */}
          <MediaSection title="Popular" loading={pmLoading}>
            <div className={CARD_GRID}>
              {(popularMovies ?? []).slice(0, 10).map(m => (
                <TMDBCard key={m.id} item={m} type="movie" />
              ))}
            </div>
          </MediaSection>

          {/* User: Watching */}
          {(watchingMovies.length > 0 || moviesLoading) && (
            <MediaSection title="Watching" count={watchingMovies.length} loading={moviesLoading}>
              <div className={CARD_GRID}>
                {watchingMovies.map(e => <MovieCard key={e.id} entry={e} />)}
              </div>
            </MediaSection>
          )}

          {/* User: Wishlist */}
          {(wishlistMovies.length > 0 || moviesLoading) && (
            <MediaSection title="Wishlist" count={wishlistMovies.length} loading={moviesLoading}>
              <div className={CARD_GRID}>
                {wishlistMovies.map(e => <MovieCard key={e.id} entry={e} />)}
              </div>
            </MediaSection>
          )}

          {/* User: Completed */}
          {completedMovies.length > 0 && (
            <MediaSection title="Completed" count={completedMovies.length} defaultOpen={false}>
              <div className={CARD_GRID}>
                {completedMovies.map(e => <MovieCard key={e.id} entry={e} />)}
              </div>
            </MediaSection>
          )}
        </>
      ) : (
        <>
          {/* Trending Today */}
          <MediaSection title="Trending Today" loading={ttdLoading}>
            <div className={CARD_GRID}>
              {(trendingTVDay ?? []).slice(0, 10).map(t => (
                <TMDBCard key={t.id} item={t} type="tv" />
              ))}
            </div>
          </MediaSection>

          {/* Trending This Week */}
          <MediaSection title="Trending This Week" loading={ttwLoading}>
            <div className={CARD_GRID}>
              {(trendingTVWeek ?? []).slice(0, 10).map(t => (
                <TMDBCard key={t.id} item={t} type="tv" />
              ))}
            </div>
          </MediaSection>

          {/* Popular */}
          <MediaSection title="Popular" loading={ptLoading}>
            <div className={CARD_GRID}>
              {(popularTV ?? []).slice(0, 10).map(t => (
                <TMDBCard key={t.id} item={t} type="tv" />
              ))}
            </div>
          </MediaSection>

          {/* User: Watching */}
          {(watchingTV.length > 0 || tvLoading) && (
            <MediaSection title="Watching / Paused" count={watchingTV.length} loading={tvLoading}>
              <div className={CARD_GRID}>
                {watchingTV.map(e => <TVCard key={e.id} entry={e} />)}
              </div>
            </MediaSection>
          )}

          {/* User: Wishlist */}
          {(wishlistTV.length > 0 || tvLoading) && (
            <MediaSection title="Wishlist" count={wishlistTV.length} loading={tvLoading}>
              <div className={CARD_GRID}>
                {wishlistTV.map(e => <TVCard key={e.id} entry={e} />)}
              </div>
            </MediaSection>
          )}

          {/* User: Completed */}
          {completedTV.length > 0 && (
            <MediaSection title="Completed" count={completedTV.length} defaultOpen={false}>
              <div className={CARD_GRID}>
                {completedTV.map(e => <TVCard key={e.id} entry={e} />)}
              </div>
            </MediaSection>
          )}
        </>
      )}
    </div>
  )
}
