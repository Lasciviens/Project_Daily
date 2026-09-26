import { useState, useRef, useEffect } from 'react'
import { Loader2, Search } from 'lucide-react'
import { useSearchMovies, useSearchTV } from '../hooks/useTMDB'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { MediaType } from '../types'

function useDebounce(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

interface Result { id: number; title: string; poster: string | null; year?: string; rating: number }

interface Props {
  /** Follows the page's Movies / TV switch. */
  mediaType: MediaType
  onSelectResult: (id: number, type: MediaType) => void
}

export function MediaSearch({ mediaType, onSelectResult }: Props) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 300)
  const active = debouncedQuery.trim().length > 1

  const movies = useSearchMovies(active && mediaType === 'movie' ? debouncedQuery : '')
  const tvs = useSearchTV(active && mediaType === 'tv' ? debouncedQuery : '')

  const results: Result[] = mediaType === 'movie'
    ? (movies.data ?? []).map(m => ({ id: m.id, title: m.title, poster: m.poster_path, year: m.release_date?.slice(0, 4), rating: m.vote_average }))
    : (tvs.data ?? []).map(t => ({ id: t.id, title: t.name, poster: t.poster_path, year: t.first_air_date?.slice(0, 4), rating: t.vote_average }))

  const isLoading = movies.isFetching || tvs.isFetching
  const showDropdown = focused && active && results.length > 0

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setFocused(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function select(id: number) {
    setFocused(false)
    setQuery('')
    onSelectResult(id, mediaType)
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder={`Search ${mediaType === 'movie' ? 'movies' : 'TV series'}…`}
        aria-label={`Search ${mediaType === 'movie' ? 'movies' : 'TV series'}`}
        className="input w-full pl-9"
      />
      {isLoading && (
        <Loader2 aria-hidden className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-fg-faint" />
      )}

      {showDropdown && (
        <div className="menu absolute left-0 right-0 top-full mt-1 max-h-80 overflow-y-auto">
          {results.slice(0, 8).map(r => (
            <button key={r.id} type="button" onClick={() => select(r.id)} className="menu-item py-1.5">
              <img src={posterUrl(r.poster, 'w92')} alt="" className="h-12 w-8 shrink-0 rounded-md bg-surface-2 object-cover" />
              <span className="min-w-0">
                <span className="block truncate text-body font-medium text-fg">{r.title}</span>
                <span className="block text-meta text-fg-muted tabular-nums">
                  {r.year && `${r.year} · `}★ {r.rating.toFixed(1)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
