import { useState, useEffect } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { MapPin, Signpost, X } from 'lucide-react'
import type { StopResult } from '../../api/ruterApi'
import { useStopSearch } from '../../hooks/useTransitQueries'
import { IconButton } from '../../../../shared/ui'

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

  const { data: results, isLoading, error } = useStopSearch(debounced)

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
            className="input min-w-0 flex-1"
          />
          {q && (
            <IconButton label="Clear search" onClick={() => { setQ(''); setDebounced('') }}>
              <X />
            </IconButton>
          )}
        </div>

        <ComboboxOptions className="menu absolute z-popover mt-1 w-full overflow-hidden text-body empty:hidden">

          {/* ── Favorites (shown when input is focused, before typing) ── */}
          {showFavorites && hasFavorites && (
            <>
              <div className="px-3 pt-2 pb-1">
                <span className="section-label">Saved stops</span>
              </div>
              {favorites!.map(fav => (
                <ComboboxOption
                  key={fav.id}
                  value={{ id: fav.id, name: fav.name, locality: fav.locality, layer: 'venue' } as StopResult}
                  className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-left transition-colors duration-150 data-[focus]:bg-surface-hover"
                >
                  <Signpost aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-fg">{fav.name}</span>
                    {fav.locality && (
                      <span className="text-fg-muted text-meta ml-2">{fav.locality}</span>
                    )}
                  </span>
                </ComboboxOption>
              ))}
              <div className="px-3 py-2 border-t border-line text-micro text-fg-muted">
                {stopsOnly ? 'Type to search stops…' : 'Type to search stops or addresses…'}
              </div>
            </>
          )}

          {/* ── Search results ── */}
          {debounced.length >= 2 && (
            <>
              {isLoading && (
                <div className="px-3 py-2.5 text-fg-muted text-meta">Searching…</div>
              )}
              {error && (
                <div className="px-3 py-2.5 text-danger text-meta">
                  {(error as Error).message?.includes('Rate') ? 'Rate limited — wait a moment' : (error as Error).message}
                </div>
              )}
              {!isLoading && !error && filteredResults && filteredResults.length === 0 && (
                <div className="px-3 py-2.5 text-fg-muted text-meta">No results for "{debounced}"</div>
              )}
              {!isLoading && filteredResults && filteredResults.length > 0 && filteredResults.slice(0, 7).map((r, i) => {
                const isAddress = r.layer === 'address' || r.layer === 'street'
                return (
                  <ComboboxOption
                    key={r.id || i}
                    value={r}
                    className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-left transition-colors duration-150 data-[focus]:bg-surface-hover"
                  >
                    {isAddress
                      ? <MapPin aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                      : <Signpost aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />}
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-fg">{r.name}</span>
                      {(r.locality || r.category) && (
                        <span className="text-fg-muted text-meta ml-2">
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
