import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
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
  stopsOnly?:   boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StopSearchInput({ placeholder = 'Search stop or address…', onSelect, autoFocus, favorites, stopsOnly }: StopSearchInputProps) {
  const [q, setQ]                 = useState('')
  const [debounced, setDebounced] = useState('')

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

  const hasFavorites   = (favorites?.length ?? 0) > 0
  const showFavorites  = debounced.length < 2 && hasFavorites
  const filteredResults = stopsOnly
    ? results?.filter(r => r.layer !== 'address' && r.layer !== 'street')
    : results

  // Combobox manages open/close state; removes click-outside listener boilerplate
  return (
    <Combobox
      onChange={(stop: StopResult | null) => {
        if (stop) {
          onSelect(stop)
          setQ('')
          setDebounced('')
        }
      }}
      onClose={() => {}}
    >
      <div className="relative">
        <div className="flex items-center gap-1.5">
          <ComboboxInput
            autoFocus={autoFocus}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={placeholder}
            displayValue={() => q}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-cream-50 min-h-[44px]"
          />
          {q && (
            <button
              onClick={() => { setQ(''); setDebounced('') }}
              className="text-ink-300 hover:text-ink-600 transition-colors duration-150 text-xs px-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Clear"
            >✕</button>
          )}
        </div>

        <ComboboxOptions className="absolute z-20 mt-1 w-full bg-cream-50 border border-ink-200 rounded-lg shadow-lg overflow-hidden text-sm empty:hidden">

          {/* ── Favorites (shown when input is focused, before typing) ── */}
          {showFavorites && hasFavorites && (
            <>
              <div className="px-3 pt-2 pb-1">
                <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">Saved stops</span>
              </div>
              {favorites!.map(fav => (
                <ComboboxOption
                  key={fav.id}
                  value={{ id: fav.id, name: fav.name, locality: fav.locality, layer: 'venue' } as StopResult}
                  className="w-full text-left px-3 py-2.5 data-[focus]:bg-cream-50 transition-colors duration-150 min-h-[44px] flex items-center gap-2 cursor-pointer"
                >
                  <span className="text-ink-400 text-xs flex-shrink-0">🚏</span>
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-ink-800">{fav.name}</span>
                    {fav.locality && (
                      <span className="text-ink-400 text-xs ml-2">{fav.locality}</span>
                    )}
                  </span>
                </ComboboxOption>
              ))}
              <div className="px-3 py-2 border-t border-ink-100 text-[10px] text-ink-400">
                {stopsOnly ? 'Type to search stops…' : 'Type to search stops or addresses…'}
              </div>
            </>
          )}

          {/* ── Search results ── */}
          {debounced.length >= 2 && (
            <>
              {isLoading && (
                <div className="px-3 py-2.5 text-ink-400 text-xs">Searching…</div>
              )}
              {error && (
                <div className="px-3 py-2.5 text-red-500 text-xs">
                  {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : `Error: ${(error as Error).message}`}
                </div>
              )}
              {!isLoading && !error && filteredResults && filteredResults.length === 0 && (
                <div className="px-3 py-2.5 text-ink-400 text-xs">No results for "{debounced}"</div>
              )}
              {!isLoading && filteredResults && filteredResults.length > 0 && filteredResults.slice(0, 7).map((r, i) => {
                const isAddress = r.layer === 'address' || r.layer === 'street'
                return (
                  <ComboboxOption
                    key={r.id || i}
                    value={r}
                    className="w-full text-left px-3 py-2.5 data-[focus]:bg-cream-50 transition-colors duration-150 min-h-[44px] flex items-center gap-2 cursor-pointer"
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
                  </ComboboxOption>
                )
              })}
            </>
          )}
        </ComboboxOptions>
      </div>
    </Combobox>
  )
}
