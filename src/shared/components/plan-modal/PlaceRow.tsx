// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's Location row (186; owner, 02.11.2026: "Can we use that
//  [EnTur] as location finding?"): a field with no edges, "Location" — the
//  saved Home/Work places (Settings → Places) as it opens, EnTur's stops,
//  addresses and named places as you type (the transit card's own search),
//  and "Use … as typed" (a name, no map pin). A picked place reads
//  "Jernbanetorget, Oslo" with a pin (a crossed-out pin: no map pin); × takes
//  it off, a tap searches again. Apple Calendar gets the name and the pin; the
//  pin is what lets the iPhone's Time to Leave work.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from 'react'
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { Briefcase, Home, MapPin, MapPinOff, Pencil, X } from 'lucide-react'
import { Truncate } from '../../ui'
import { placeFromGeo, placeFromSaved, placeFromText, placeLabel, type ItemPlace } from '../../../features/items/itemPlace'
import { useStopSearch } from '../../../features/home/hooks/useTransitQueries'
import { useTransitStops } from '../../../features/home/hooks/useTransitStops'
import { findPlace, PLACE_LABEL, type PlaceKind } from '../../../features/home/transitPlaces'

const ROW = 'flex min-h-11 w-full items-center gap-2.5 px-3.5 text-lead'

export function PlaceRow({ value, onChange, mark }: { value: ItemPlace | null; onChange: (place: ItemPlace | null) => void; mark?: ReactNode }) {
  const [editing, setEditing] = useState(false)
  // A saved stop just picked has no pin of its own: look it up once (never for a place the screen opened with).
  const [pinFor, setPinFor] = useState<string | null>(null)
  const pick = (p: ItemPlace) => {
    onChange(p)
    setPinFor(p.id && p.lat === undefined ? p.id : null)
    setEditing(false)
  }
  if (editing || !value) {
    return (
      <div className={ROW}>
        <MapPin aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
        <PlaceSearch autoFocus={editing} onPick={pick} onClose={() => setEditing(false)} />
        {mark}
      </div>
    )
  }
  const pinned = value.lat !== undefined && value.lon !== undefined
  const looking = !!pinFor && value.id === pinFor && !pinned
  return (
    <div className={ROW}>
      {pinned || looking ? <MapPin aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" /> : <MapPinOff aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />}
      <button type="button" onClick={() => setEditing(true)} className="min-w-0 flex-1 py-2 text-left text-fg"
        aria-label={`Location: ${placeLabel(value)}${pinned ? '' : ', no map pin'} — change it`}
        title={pinned ? 'Apple Calendar gets its map pin (Time to Leave)' : looking ? 'Finding its map pin…' : 'No map pin'}>
        <bdi className="block min-w-0"><Truncate>{placeLabel(value)}</Truncate></bdi>
      </button>
      <button type="button" onClick={() => onChange(null)} aria-label="Remove the location"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-faint hover:bg-surface-hover hover:text-fg">
        <X aria-hidden className="h-4 w-4" />
      </button>
      {mark}
      {looking && <PinLookup place={value} onFound={p => { onChange(p); setPinFor(null) }} />}
    </div>
  )
}

type Choice = { key: string; place: ItemPlace; label: string; sub?: string; kind: 'saved-home' | 'saved-work' | 'found' | 'typed' }

/** The search, in the row; its queries run only once something is typed (the saved places are read with the page). */
function PlaceSearch({ onPick, onClose, autoFocus }: { onPick: (p: ItemPlace) => void; onClose: () => void; autoFocus: boolean }) {
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
      <div className="relative min-w-0 flex-1">
        <ComboboxInput
          autoFocus={autoFocus}
          aria-label="Location: search a place"
          placeholder="Location"
          maxLength={120}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') } }}
          // Leaving the field with words typed and nothing picked (another row, closing the screen) keeps them as a typed
          // place — never dropped without a word (as the labels do); a picked option keeps the focus here, so it never adds twice.
          onBlur={() => { if (typed) onPick(typed); else onClose() }}
          autoComplete="off"
          enterKeyHint="search"
          className="input-bare pb-0 text-lead"
        />
        {(choices.length > 0 || note) && (
          // Not modal (as the screen's other pickers). Below the row: the Location group sits near the top of the screen.
          <ComboboxOptions modal={false} anchor={{ to: 'bottom start', gap: 8, padding: 12 }} className="menu z-toast max-h-72 min-w-[15rem] overflow-y-auto">
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
