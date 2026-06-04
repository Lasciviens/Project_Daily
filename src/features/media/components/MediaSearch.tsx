import { useState, useRef, useEffect } from 'react'
import { useSearchMovies, useSearchTV, useMovieDetails, useTVDetails } from '../hooks/useTMDB'
import { useAddMovie } from '../hooks/useMovies'
import { useAddTV } from '../hooks/useTVSeries'
import { posterUrl } from '../../../integrations/tmdb/client'
import { AddMediaConfirm } from './AddMediaConfirm'
import type { TMDBMovie, TMDBTVSeries, TMDBSearchMovie, TMDBSearchTV, MediaStatus, UserMovieEntry, UserTVEntry } from '../types'

function useDebounce(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function MediaSearch() {
  const [query, setQuery]           = useState('')
  const [focused, setFocused]       = useState(false)
  const [confirmItem, setConfirmItem] = useState<{ tmdb: TMDBMovie | TMDBTVSeries; type: 'movie' | 'tv' } | null>(null)
  const [detailId, setDetailId]     = useState<{ id: number; type: 'movie' | 'tv' } | null>(null)
  const wrapperRef                  = useRef<HTMLDivElement>(null)
  const debouncedQuery              = useDebounce(query, 300)

  const { data: movies = [], isFetching: moviesLoading } = useSearchMovies(debouncedQuery)
  const { data: tvs   = [], isFetching: tvLoading      } = useSearchTV(debouncedQuery)
  const { data: movieDetail } = useMovieDetails(detailId?.type === 'movie' ? detailId.id : null)
  const { data: tvDetail    } = useTVDetails(detailId?.type === 'tv' ? detailId.id : null)

  const addMovie = useAddMovie()
  const addTV    = useAddTV()

  const showDropdown = focused && debouncedQuery.trim().length > 1 && (movies.length > 0 || tvs.length > 0)

  useEffect(() => {
    if (movieDetail && detailId?.type === 'movie') {
      setConfirmItem({ tmdb: movieDetail, type: 'movie' })
      setDetailId(null)
    }
  }, [movieDetail, detailId])

  useEffect(() => {
    if (tvDetail && detailId?.type === 'tv') {
      setConfirmItem({ tmdb: tvDetail, type: 'tv' })
      setDetailId(null)
    }
  }, [tvDetail, detailId])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setFocused(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function selectMovie(result: TMDBSearchMovie) {
    setFocused(false)
    setDetailId({ id: result.id, type: 'movie' })
  }

  function selectTV(result: TMDBSearchTV) {
    setFocused(false)
    setDetailId({ id: result.id, type: 'tv' })
  }

  async function handleConfirm(status: MediaStatus) {
    if (!confirmItem) return
    if (confirmItem.type === 'movie') {
      await addMovie.mutateAsync({ tmdb: confirmItem.tmdb as TMDBMovie, status: status as UserMovieEntry['status'] })
    } else {
      await addTV.mutateAsync({ tmdb: confirmItem.tmdb as TMDBTVSeries, status: status as UserTVEntry['status'] })
    }
    setConfirmItem(null)
    setQuery('')
  }

  const isPending = addMovie.isPending || addTV.isPending

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search movies or TV series…"
            className="input w-full pl-9"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm">⌕</span>
          {(moviesLoading || tvLoading) && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 text-xs">…</span>
          )}
        </div>

        {showDropdown && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 card shadow-lg max-h-80 overflow-y-auto">
            {movies.length > 0 && (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 px-3 pt-3 pb-1">
                  Movies
                </p>
                {movies.slice(0, 5).map(m => (
                  <button
                    key={m.id}
                    onClick={() => selectMovie(m)}
                    className="flex items-center gap-3 px-3 py-2 w-full text-left hover:bg-cream-100 transition-colors duration-150"
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
                {tvs.slice(0, 5).map(t => (
                  <button
                    key={t.id}
                    onClick={() => selectTV(t)}
                    className="flex items-center gap-3 px-3 py-2 w-full text-left hover:bg-cream-100 transition-colors duration-150"
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

      {confirmItem && (
        <AddMediaConfirm
          item={confirmItem.tmdb}
          mediaType={confirmItem.type}
          onConfirm={handleConfirm}
          onClose={() => setConfirmItem(null)}
          isPending={isPending}
        />
      )}
    </>
  )
}
