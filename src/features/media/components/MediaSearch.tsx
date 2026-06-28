import { useState, useRef, useEffect } from 'react'
import { useSearchMovies, useSearchTV } from '../hooks/useTMDB'
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
  const [mediaType, setMediaType] = useState<MediaType>('movie')
  const [query,     setQuery]     = useState('')
  const [focused,   setFocused]   = useState(false)

  const wrapperRef     = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 300)

  const useSearch = debouncedQuery.trim().length > 1

  const { data: searchMoviesData = [], isFetching: moviesLoading } = useSearchMovies(
    useSearch && mediaType === 'movie' ? debouncedQuery : ''
  )
  const { data: searchTVData = [], isFetching: tvLoading } = useSearchTV(
    useSearch && mediaType === 'tv' ? debouncedQuery : ''
  )

  const movies: TMDBSearchMovie[] = mediaType === 'movie' ? searchMoviesData : []
  const tvs:    TMDBSearchTV[]    = mediaType === 'tv'    ? searchTVData     : []

  const isLoading    = moviesLoading || tvLoading
  const hasResults   = movies.length > 0 || tvs.length > 0
  const showDropdown = focused && useSearch && hasResults

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setFocused(false)
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

  return (
    <div ref={wrapperRef} className="relative">
      {/* Search input row with inline Movie/TV toggle */}
      <div className="flex gap-2 items-center">
        {/* Inline Movie/TV radio */}
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg flex-shrink-0">
          <button
            onClick={() => setMediaType('movie')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 min-h-[44px] ${
              mediaType === 'movie'
                ? 'bg-white text-ink-800 shadow-sm'
                : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            Movies
          </button>
          <button
            onClick={() => setMediaType('tv')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 min-h-[44px] ${
              mediaType === 'tv'
                ? 'bg-white text-ink-800 shadow-sm'
                : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            TV
          </button>
        </div>

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
      </div>

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
