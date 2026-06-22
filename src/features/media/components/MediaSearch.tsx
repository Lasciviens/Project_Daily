import { useState, useRef, useEffect } from 'react'
import {
  useSearchMovies, useSearchTV,
  useMovieGenres, useTVGenres,
  useDiscoverMovies, useDiscoverTV,
} from '../hooks/useTMDB'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { TMDBSearchMovie, TMDBSearchTV } from '../types'

type MediaType = 'movie' | 'tv'

function useDebounce(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

interface Props {
  onSelectResult: (id: number, type: 'movie' | 'tv') => void
}

export function MediaSearch({ onSelectResult }: Props) {
  const [mediaType,      setMediaType]      = useState<MediaType>('movie')
  const [query,          setQuery]          = useState('')
  const [focused,        setFocused]        = useState(false)
  const [filtersOpen,    setFiltersOpen]    = useState(false)
  const [selectedGenres, setSelectedGenres] = useState<{ id: number; name: string }[]>([])
  const [yearFrom,       setYearFrom]       = useState('')
  const [minRating,      setMinRating]      = useState('')
  const [genreDropOpen,  setGenreDropOpen]  = useState(false)

  const wrapperRef     = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 300)

  const hasFilters  = selectedGenres.length > 0 || !!yearFrom || !!minRating
  const activeCount = selectedGenres.length + (yearFrom ? 1 : 0) + (minRating ? 1 : 0)
  const useSearch   = debouncedQuery.trim().length > 1
  // Use discover when filters are active (whether or not there is a text query)
  const useDiscover = hasFilters

  // Build discover params
  const discoverParams: Record<string, string> = { sort_by: 'popularity.desc' }
  if (selectedGenres.length > 0) discoverParams.with_genres = selectedGenres.map(g => g.id).join(',')
  if (yearFrom) {
    discoverParams[mediaType === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = yearFrom
  }
  if (minRating) discoverParams['vote_average.gte'] = minRating

  const { data: movieGenres = [] } = useMovieGenres()
  const { data: tvGenres    = [] } = useTVGenres()
  const allGenres       = mediaType === 'movie' ? movieGenres : tvGenres
  const availableGenres = allGenres.filter(g => !selectedGenres.some(s => s.id === g.id))

  // Text search queries — only fetch for the active media type
  const { data: searchMoviesData = [], isFetching: moviesSearchLoading } = useSearchMovies(
    useSearch && mediaType === 'movie' ? debouncedQuery : ''
  )
  const { data: searchTVData = [], isFetching: tvSearchLoading } = useSearchTV(
    useSearch && mediaType === 'tv' ? debouncedQuery : ''
  )

  // Discover queries — used when filters active
  const { data: discoverMoviesData = [], isFetching: moviesDiscoverLoading } = useDiscoverMovies(
    discoverParams,
    mediaType === 'movie' && useDiscover
  )
  const { data: discoverTVData = [], isFetching: tvDiscoverLoading } = useDiscoverTV(
    discoverParams,
    mediaType === 'tv' && useDiscover
  )

  // Result resolution: prefer text-search when query present; fall back to discover when filters only
  const movies: TMDBSearchMovie[] = useSearch && mediaType === 'movie'
    ? searchMoviesData
    : (useDiscover && mediaType === 'movie' ? discoverMoviesData : [])
  const tvs: TMDBSearchTV[] = useSearch && mediaType === 'tv'
    ? searchTVData
    : (useDiscover && mediaType === 'tv' ? discoverTVData : [])

  const isLoading    = moviesSearchLoading || tvSearchLoading || moviesDiscoverLoading || tvDiscoverLoading
  const hasResults   = movies.length > 0 || tvs.length > 0
  const showDropdown = focused && (useSearch || useDiscover) && hasResults

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setFocused(false)
        setGenreDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function select(id: number, type: 'movie' | 'tv') {
    setFocused(false)
    setQuery('')
    onSelectResult(id, type)
  }

  function switchMediaType(type: MediaType) {
    setMediaType(type)
    setSelectedGenres([]) // genres differ per type
    setGenreDropOpen(false)
  }

  function addGenre(genre: { id: number; name: string }) {
    setSelectedGenres(prev => [...prev, genre])
    setGenreDropOpen(false)
    setFocused(true) // keep dropdown open after adding genre
  }

  function removeGenre(id: number) {
    setSelectedGenres(prev => prev.filter(g => g.id !== id))
  }

  function clearFilters() {
    setSelectedGenres([])
    setYearFrom('')
    setMinRating('')
  }

  return (
    <div ref={wrapperRef} className="relative space-y-2">
      {/* Movie / TV toggle */}
      <div className="flex gap-1 p-1 bg-cream-100 rounded-xl w-fit">
        <button
          onClick={() => switchMediaType('movie')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 min-h-[36px] ${
            mediaType === 'movie'
              ? 'bg-white text-ink-800 shadow-sm'
              : 'text-ink-500 hover:text-ink-700'
          }`}
        >
          Movies
        </button>
        <button
          onClick={() => switchMediaType('tv')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 min-h-[36px] ${
            mediaType === 'tv'
              ? 'bg-white text-ink-800 shadow-sm'
              : 'text-ink-500 hover:text-ink-700'
          }`}
        >
          TV Series
        </button>
      </div>

      {/* Search input row */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder={`Search ${mediaType === 'movie' ? 'movies' : 'TV series'}…`}
            className="input w-full pl-9 min-h-[44px]"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm pointer-events-none">⌕</span>
          {isLoading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 text-xs">…</span>
          )}
        </div>

        {/* Filters toggle button */}
        <button
          onClick={() => setFiltersOpen(prev => !prev)}
          className={`relative flex items-center gap-1.5 px-3 rounded-lg border text-sm font-medium transition-colors duration-150 min-h-[44px] flex-shrink-0 ${
            filtersOpen || hasFilters
              ? 'bg-accent-100 border-accent-300 text-accent-700'
              : 'bg-white border-ink-200 text-ink-600 hover:border-ink-300 hover:text-ink-800'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent-500 text-white text-[10px] font-bold leading-none">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Collapsible filter panel */}
      {filtersOpen && (
        <div className="border border-ink-200 rounded-xl p-3 space-y-3 bg-cream-50">
          {/* Genre multi-select */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">Genres</span>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-ink-400 hover:text-ink-600 underline min-h-[28px]"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Selected genre pills + add button */}
            <div className="flex flex-wrap gap-1.5">
              {selectedGenres.map(g => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent-100 text-accent-700 rounded-full text-xs font-medium"
                >
                  {g.name}
                  <button
                    onClick={() => removeGenre(g.id)}
                    className="text-accent-500 hover:text-accent-800 ml-0.5 flex items-center justify-center min-h-[20px] min-w-[16px]"
                    aria-label={`Remove ${g.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}

              {/* Add genre dropdown */}
              <div className="relative">
                <button
                  onClick={() => setGenreDropOpen(prev => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-dashed border-ink-300 text-ink-500 hover:text-ink-700 hover:border-ink-400 rounded-full text-xs font-medium transition-colors duration-150 min-h-[28px]"
                >
                  + Genre
                </button>
                {genreDropOpen && availableGenres.length > 0 && (
                  <div className="absolute z-30 top-full left-0 mt-1 w-48 bg-white border border-ink-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {availableGenres.map(g => (
                      <button
                        key={g.id}
                        onClick={() => addGenre(g)}
                        className="w-full text-left px-3 py-2 text-sm text-ink-700 hover:bg-cream-100 transition-colors duration-100 min-h-[36px]"
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Year from + Min rating row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500 mb-1">
                Year from
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={yearFrom}
                onChange={e => setYearFrom(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 2020"
                className="input w-full min-h-[44px] text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500 mb-1">
                Min rating
              </label>
              <select
                value={minRating}
                onChange={e => setMinRating(e.target.value)}
                className="input w-full min-h-[44px] text-sm"
              >
                <option value="">Any</option>
                <option value="6">6+</option>
                <option value="7">7+</option>
                <option value="8">8+</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Results dropdown */}
      {showDropdown && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 card shadow-lg max-h-80 overflow-y-auto">
          {movies.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 px-3 pt-3 pb-1">
                Movies
              </p>
              {movies.slice(0, 8).map((m: TMDBSearchMovie) => (
                <button
                  key={m.id}
                  onClick={() => select(m.id, 'movie')}
                  className="flex items-center gap-3 px-3 py-2.5 w-full text-left hover:bg-cream-100 transition-colors duration-150 min-h-[44px]"
                >
                  <img
                    src={posterUrl(m.poster_path, 'w92')}
                    alt={m.title}
                    className="w-8 h-12 object-cover rounded flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-800 truncate">{m.title}</p>
                    <p className="text-[11px] text-ink-400">
                      {m.release_date?.slice(0, 4)} · ★ {m.vote_average.toFixed(1)}
                    </p>
                  </div>
                </button>
              ))}
            </>
          )}
          {tvs.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 px-3 pt-3 pb-1">
                TV Series
              </p>
              {tvs.slice(0, 8).map((t: TMDBSearchTV) => (
                <button
                  key={t.id}
                  onClick={() => select(t.id, 'tv')}
                  className="flex items-center gap-3 px-3 py-2.5 w-full text-left hover:bg-cream-100 transition-colors duration-150 min-h-[44px]"
                >
                  <img
                    src={posterUrl(t.poster_path, 'w92')}
                    alt={t.name}
                    className="w-8 h-12 object-cover rounded flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-800 truncate">{t.name}</p>
                    <p className="text-[11px] text-ink-400">
                      {t.first_air_date?.slice(0, 4)} · ★ {t.vote_average.toFixed(1)}
                    </p>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
