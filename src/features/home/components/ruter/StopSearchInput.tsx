import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchStops, type StopResult } from '../../api/ruterApi'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FavoriteStop {
  id:        string
  name:      string
  locality?: string
}

interface StopSearchInputProps {
  placeholder?: string
  onSelect:     (stop: StopResult) => void
  autoFocus?:   boolean
  favorites?:   FavoriteStop[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StopSearchInput({ placeholder = 'Search stop or address…', onSelect, autoFocus, favorites }: StopSearchInputProps) {
  const [q, setQ]                 = useState('')
  const [open, setOpen]           = useState(false)
  const [debounced, setDebounced] = useState('')
  const inputRef                  = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // 300ms debounce — avoids hammering geocoder on every keystroke
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300)
    return () => clearTimeout(id)
  }, [q])

  const { data: results, isLoading, error } = useQuery({
    queryKey:  ['stopSearch', debounced],
    queryFn:   () => searchStops(debounced),
    enabled:   debounced.length >= 2,
    staleTime: 5 * 60_000,
    retry:     false,
  })

  function handleSelect(stop: StopResult) {
    onSelect(stop)
    setQ('')
    setOpen(false)
  }

  function handleFavoriteSelect(fav: FavoriteStop) {
    // Favorites are always transit stops (NSR:StopPlace)
    onSelect({ id: fav.id, name: fav.name, locality: fav.locality, layer: 'venue' })
    setQ('')
    setOpen(false)
  }

  const hasFavorites   = (favorites?.length ?? 0) > 0
  const showFavorites  = open && debounced.length < 2 && hasFavorites
  const showSearch     = open && debounced.length >= 2
  const dropdownOpen   = showFavorites || showSearch

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
        />
        {q && (
          <button
            onClick={() => { setQ(''); setOpen(false) }}
            className="text-ink-300 hover:text-ink-600 transition-colors duration-150 text-xs px-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Clear"
          >✕</button>
        )}
      </div>

      {dropdownOpen && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-ink-200 rounded-lg shadow-lg overflow-hidden text-sm">

          {/* ── Favorites (shown when input is focused, before typing) ── */}
          {showFavorites && (
            <>
              <div className="px-3 pt-2 pb-1">
                <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">Saved stops</span>
              </div>
              <ul>
                {favorites!.map(fav => (
                  <li key={fav.id}>
                    <button
                      onMouseDown={() => handleFavoriteSelect(fav)}
                      className="w-full text-left px-3 py-2.5 hover:bg-cream-50 transition-colors duration-150 min-h-[44px] flex items-center gap-2"
                    >
                      <span className="text-ink-400 text-xs flex-shrink-0">🚏</span>
                      <span className="flex-1 min-w-0">
                        <span className="font-medium text-ink-800">{fav.name}</span>
                        {fav.locality && (
                          <span className="text-ink-400 text-xs ml-2">{fav.locality}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="px-3 py-2 border-t border-ink-100 text-[10px] text-ink-400">
                Type to search stops or addresses…
              </div>
            </>
          )}

          {/* ── Search results ── */}
          {showSearch && (
            <>
              {isLoading && (
                <div className="px-3 py-2.5 text-ink-400 text-xs">Searching…</div>
              )}
              {error && (
                <div className="px-3 py-2.5 text-red-500 text-xs">
                  {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : `Error: ${(error as Error).message}`}
                </div>
              )}
              {!isLoading && !error && results && results.length === 0 && (
                <div className="px-3 py-2.5 text-ink-400 text-xs">No results for "{debounced}"</div>
              )}
              {!isLoading && results && results.length > 0 && (
                <ul>
                  {results.slice(0, 7).map((r, i) => {
                    const isAddress = r.layer === 'address' || r.layer === 'street'
                    return (
                      <li key={r.id || i}>
                        <button
                          onMouseDown={() => handleSelect(r)}
                          className="w-full text-left px-3 py-2.5 hover:bg-cream-50 transition-colors duration-150 min-h-[44px] flex items-center gap-2"
                        >
                          <span className="text-ink-400 text-xs flex-shrink-0">{isAddress ? '📍' : '🚏'}</span>
                          <span className="flex-1 min-w-0">
                            <span className="font-medium text-ink-800">{r.name}</span>
                            {(r.locality || r.category) && (
                              <span className="text-ink-400 text-xs ml-2">
                                {[r.locality, !isAddress ? r.category : undefined].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
