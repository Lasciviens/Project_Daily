import { useState, useEffect, useRef, type RefObject } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { MapPin, Signpost, X } from 'lucide-react'
import type { StopResult } from '../../api/ruterApi'
import { useStopSearch } from '../../hooks/useTransitQueries'
import { IconButton, Truncate } from '../../../../shared/ui'
import { placeLine } from '../../api/enturGeocoder'

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
  /**
   * The list is as wide as this box (Routes' From/Via/To card), inset from its right edge as
   * far as the field is from its left — not only the field, which shares its row with buttons.
   */
  widthFrom?:   RefObject<HTMLElement | null>
}

/** The list's width under `box`, or undefined to follow the field (`--input-width`). */
function useListWidth(input: RefObject<HTMLElement | null>, box?: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number>()
  useEffect(() => {
    const field = input.current
    const outer = box?.current
    if (!field || !outer) return
    const measure = () => {
      const b = outer.getBoundingClientRect()
      const inset = field.getBoundingClientRect().left - b.left
      setWidth(Math.max(0, Math.round(b.width - 2 * inset)))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    ro.observe(field)
    return () => ro.disconnect()
  }, [input, box])
  return width
}

// ─── Component ────────────────────────────────────────────────────────────────

/** A result's two lines: the place, then its town and kind ("Oslo · Train station, Bus stop"). */
function PlaceText({ name, line }: { name: string; line?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col py-1">
      <bdi className="min-w-0"><Truncate className="text-fg">{name}</Truncate></bdi>
      {line && <bdi className="min-w-0"><Truncate className="text-meta font-normal text-fg-muted">{line}</Truncate></bdi>}
    </span>
  )
}

export function StopSearchInput({ placeholder = 'Search stop or address…', onSelect, autoFocus, favorites, stopsOnly, widthFrom }: StopSearchInputProps) {
  const field = useRef<HTMLInputElement>(null)
  const listWidth = useListWidth(field, widthFrom)
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
            ref={field}
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

        {/* Anchored (portalled, placed by Floating UI): the field sits in a card that clips (overflow-hidden) inside a
            popup that scrolls, so an absolute list was cut off over the fields below it (owner, 24.11.2026). */}
        <ComboboxOptions modal={false} anchor={{ to: 'bottom start', gap: 4, padding: 12 }}
          style={listWidth ? { width: listWidth } : undefined}
          className="menu z-toast max-h-72 w-[var(--input-width)] min-w-[15rem] overflow-y-auto empty:hidden">

          {/* ── Favorites (shown when input is focused, before typing) ── */}
          {showFavorites && hasFavorites && (
            <>
              <div className="menu-label">Saved stops</div>
              {favorites!.map(fav => (
                <ComboboxOption
                  key={fav.id}
                  value={{ id: fav.id, name: fav.name, locality: fav.locality, layer: 'venue' } as StopResult}
                  className="menu-item"
                >
                  <Signpost aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                  <PlaceText name={fav.name} line={fav.locality} />
                </ComboboxOption>
              ))}
              <div className="mt-1 border-t border-line px-2.5 pt-2 pb-1 text-micro text-fg-muted">
                {stopsOnly ? 'Type to search stops…' : 'Type to search stops or addresses…'}
              </div>
            </>
          )}

          {/* ── Search results ── */}
          {debounced.length >= 2 && (
            <>
              {isLoading && (
                <div className="px-2.5 py-2 text-fg-muted text-meta">Searching…</div>
              )}
              {error && (
                <div className="px-2.5 py-2 text-danger text-meta">
                  {(error as Error).message?.includes('Rate') ? 'Rate limited — wait a moment' : (error as Error).message}
                </div>
              )}
              {!isLoading && !error && filteredResults && filteredResults.length === 0 && (
                <div className="px-2.5 py-2 text-fg-muted text-meta">No results for "{debounced}"</div>
              )}
              {!isLoading && filteredResults && filteredResults.length > 0 && filteredResults.slice(0, 7).map((r, i) => {
                const isAddress = r.layer === 'address' || r.layer === 'street'
                return (
                  <ComboboxOption key={r.id || i} value={r} className="menu-item">
                    {isAddress
                      ? <MapPin aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                      : <Signpost aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />}
                    <PlaceText name={r.name} line={placeLine(r)} />
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
