// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's place (186; owner, 02.11.2026: "Dont we have something for
//  entur entegration? Can we use that as location finding?"): one value on the
//  facts line ("📍 Jernbanetorget, Oslo", × takes it off) or "+ Place", which
//  opens a search — the saved Home/Work places (Settings → Places), EnTur's
//  stops, addresses and named places as you type (the transit card's own
//  search), and "Use … as typed" (a name, no map pin). Apple Calendar gets the
//  name and the pin; the pin is what lets the iPhone's Time to Leave work.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { Briefcase, Home, MapPin, Pencil, X } from 'lucide-react'
import { chipClass } from './fieldStyles'
import { Truncate } from '../../ui'
import { AddFact } from './ItemFacts'
import { placeFromGeo, placeFromSaved, placeFromText, placeLabel, type ItemPlace } from '../../../features/items/itemPlace'
import { useStopSearch } from '../../../features/home/hooks/useTransitQueries'
import { useTransitStops } from '../../../features/home/hooks/useTransitStops'
import { findPlace, PLACE_LABEL, type PlaceKind } from '../../../features/home/transitPlaces'

export function PlaceFact({ value, onChange }: { value: ItemPlace | null; onChange: (place: ItemPlace | null) => void }) {
  const [editing, setEditing] = useState(false)
  // A saved stop just picked has no pin of its own: look it up once (never for a place the sheet opened with).
  const [pinFor, setPinFor] = useState<string | null>(null)
  const pick = (p: ItemPlace) => {
    onChange(p)
    setPinFor(p.id && p.lat === undefined ? p.id : null)
    setEditing(false)
  }
  if (editing) return <PlaceSearch onPick={pick} onClose={() => setEditing(false)} />
  if (!value) return <AddFact label="Place" onClick={() => setEditing(true)} />
  const pinned = value.lat !== undefined && value.lon !== undefined
  return (
    <span className={chipClass('value', 'pr-0.5')}>
      <button type="button" onClick={() => setEditing(true)} className="inline-flex min-w-0 items-center gap-1"
        aria-label={`Place: ${placeLabel(value)}${pinned ? '' : ', no map pin'} — change it`}
        title={pinned ? 'Apple Calendar gets its map pin (Time to Leave)' : 'Typed by hand: no map pin'}>
        {pinned ? <MapPin aria-hidden /> : <Pencil aria-hidden />}
        <bdi className="min-w-0"><Truncate className="max-w-[12rem]">{placeLabel(value)}</Truncate></bdi>
      </button>
      <button type="button" onClick={() => onChange(null)} aria-label="Remove the place"
        className="grid h-6 w-6 place-items-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg">
        <X aria-hidden />
      </button>
      {pinFor && value.id === pinFor && !pinned && <PinLookup place={value} onFound={p => { onChange(p); setPinFor(null) }} />}
    </span>
  )
}

type Choice = { key: string; place: ItemPlace; label: string; sub?: string; kind: 'saved-home' | 'saved-work' | 'found' | 'typed' }

/** The search, mounted only while open (its queries run only then). */
function PlaceSearch({ onPick, onClose }: { onPick: (p: ItemPlace) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  // 300 ms: a search per pause in typing, not per key (as the transit card's).
  useEffect(() => { const id = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(id) }, [query])
  const found = useStopSearch(debounced)
  const { stops } = useTransitStops()

  const choices: Choice[] = []
  if (debounced.length < 2) {
    for (const kind of ['home', 'work'] as PlaceKind[]) {
      const s = findPlace(stops, kind)
      const place = s ? placeFromSaved(s) : null
      if (place) choices.push({ key: `saved-${kind}`, place, label: PLACE_LABEL[kind], sub: placeLabel(place), kind: `saved-${kind}` })
    }
  } else {
    const seen = new Set<string>()
    for (const g of found.data ?? []) {
      const place = placeFromGeo(g)
      // Two of EnTur's entries that read the same (a stop and its group) are one choice here: the first, a stop.
      const label = place ? placeLabel(place).toLowerCase() : ''
      if (!place || seen.has(label)) continue
      seen.add(label)
      choices.push({ key: `found-${g.id}`, place, label: place.name, sub: g.locality, kind: 'found' })
    }
  }
  const typed = placeFromText(query)
  if (typed) choices.push({ key: 'typed', place: typed, label: `Use “${typed.name}”`, sub: 'as typed · no map pin', kind: 'typed' })
  const note = debounced.length >= 2 && found.isError ? 'Place search is not answering — use what you typed'
    : debounced.length >= 2 && found.isSuccess && !found.data?.length ? 'Nothing found in Norway — use what you typed' : null

  return (
    <Combobox<Choice | null> value={null} onChange={c => { if (c) onPick(c.place) }} onClose={() => { if (!query) onClose() }} immediate>
      <div className="relative">
        <ComboboxInput
          autoFocus
          aria-label="Search a place"
          placeholder="Place or address"
          maxLength={120}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { if (query) setQuery(''); else onClose() } }}
          // Leaving the field keeps the place the item had: a half-typed search never becomes a place by itself.
          onBlur={() => onClose()}
          autoComplete="off"
          className="input input-sm h-8 w-52"
        />
        {(choices.length > 0 || note) && (
          // Not modal (as the sheet's other pickers): Save stays one tap away while the list is open. Upward: the place sits
          // near the bottom of the sheet, so below it a phone has room for one result at most.
          <ComboboxOptions modal={false} anchor={{ to: 'top start', gap: 6, padding: 12 }} className="menu z-toast max-h-72 min-w-[15rem] overflow-y-auto">
            {note && <p className="px-3 py-2 text-meta text-fg-muted">{note}</p>}
            {choices.map(c => (
              <ComboboxOption key={c.key} value={c} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                {c.kind === 'saved-home' ? <Home aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
                  : c.kind === 'saved-work' ? <Briefcase aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
                  : c.kind === 'typed' ? <Pencil aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
                  : <MapPin aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <bdi className="min-w-0"><Truncate>{c.label}</Truncate></bdi>
                  {c.sub && <bdi className="min-w-0 text-meta text-fg-muted"><Truncate>{c.sub}</Truncate></bdi>}
                </span>
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        )}
      </div>
    </Combobox>
  )
}

/** A saved stop has no coordinates of its own: EnTur's search by its name finds the same stop (by id) with them. */
function PinLookup({ place, onFound }: { place: ItemPlace; onFound: (p: ItemPlace) => void }) {
  const found = useStopSearch(place.name)
  useEffect(() => {
    const hit = found.data?.find(g => g.id === place.id)
    const pinned = hit ? placeFromGeo({ ...hit, name: place.name, locality: place.locality }) : null
    if (pinned?.lat !== undefined) onFound(pinned)
  }, [found.data, place, onFound])
  return null
}
