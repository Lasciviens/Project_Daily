// EnTur's place search (the geocoder), v3. Pure: the browser's stop search
// (ruterApi.searchStops) builds the query and reads the answer with this block
// (ai-proxy carried a verbatim copy until AI phase 5 removed it).
//
// v1/v2 are deprecated since 12.06.2026 (developer.entur.no → Geocoder →
// "Migration from v2 to v3"). Shape verified live on 26.10.2026, saved in
// scripts/fixtures/entur/ — see docs/integrations/entur.md.

// <entur-geocoder>
const GEOCODER_V3 = 'https://api.entur.io/geocoder/v3/autocomplete'

/** A place from the search: a transit stop, or somewhere else with coordinates. */
interface GeoPlace {
  id: string
  name: string
  locality?: string
  /** A stop's kinds in plain words, e.g. "Bus stop, Metro station" (`stopKinds`); never Entur's codes. */
  category?: string
  /** 'venue' = a transit stop; 'address' / 'street' = anywhere else (the app's names since v1). */
  layer: 'venue' | 'address' | 'street'
  lat?: number
  lon?: number
}

/** The query for up to `limit` stops and places in Norway. `countries` takes lowercase alpha-2: "NOR" matches nothing. */
function geocoderQuery(text: string, limit: number): string {
  return new URLSearchParams({
    q: text, lang: 'no', limit: String(limit), layers: 'stopPlace,address,street,poi,place', countries: 'no',
  }).toString()
}

/**
 * Entur's stop types (NeTEx `stopPlaceTypes`) in plain words, most important first.
 * The list is docs/integrations/entur.md's table; a type not on it (and "other") is dropped, never shown raw.
 */
const STOP_KIND: ReadonlyArray<readonly [string, string]> = [
  ['airport', 'Airport'], ['railStation', 'Train station'], ['metroStation', 'Metro station'],
  ['tramStation', 'Tram station'], ['busStation', 'Bus station'], ['coachStation', 'Coach station'],
  ['ferryPort', 'Ferry port'], ['harbourPort', 'Harbour'], ['ferryStop', 'Ferry stop'],
  ['liftStation', 'Cable car'], ['vehicleRailInterchange', 'Car train'],
  ['onstreetTram', 'Tram stop'], ['onstreetBus', 'Bus stop'],
]

/** A stop's types as one readable line ("Train station, Bus stop"), or undefined when none is known. */
function stopKinds(types: readonly string[]): string | undefined {
  const words = STOP_KIND.filter(([code]) => types.includes(code)).map(([, word]) => word)
  return words.length ? words.join(', ') : undefined
}

const PLACE_LAYER: Record<string, GeoPlace['layer']> = {
  street: 'street', address: 'address', poi: 'address', place: 'address', groupOfStopPlaces: 'address',
}

/** The answer's places: every stop, other places only with coordinates; anything odd is skipped. */
function parseGeocoderPlaces(json: unknown): GeoPlace[] {
  const features = (json as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return []
  const out: GeoPlace[] = []
  for (const f of features) {
    const p = (f as { properties?: Record<string, unknown> } | null)?.properties
    if (!p || typeof p.id !== 'string') continue
    const names = (p.names ?? {}) as { default?: unknown; display?: unknown }
    const name = typeof names.default === 'string' ? names.default : typeof names.display === 'string' ? names.display : ''
    if (!name) continue
    const address = (p.address ?? {}) as { locality?: unknown; county?: unknown }
    const locality = typeof address.locality === 'string' ? address.locality
      : typeof address.county === 'string' ? address.county : undefined
    const coords = (f as { geometry?: { coordinates?: unknown } }).geometry?.coordinates
    const point = Array.isArray(coords) && coords.length === 2 && coords.every(n => typeof n === 'number')
      ? coords as [number, number] : null
    const isStop = /^NSR:StopPlace:\d+$/.test(p.id)
    const layer = isStop ? 'venue' : PLACE_LAYER[String(p.layer)]
    if (!layer || (!isStop && !point)) continue
    const types = Array.isArray(p.stopPlaceTypes) ? p.stopPlaceTypes.filter((t): t is string => typeof t === 'string') : []
    out.push({
      id: p.id, name, locality, layer,
      category: isStop ? stopKinds(types) : undefined,
      lat: point?.[1], lon: point?.[0],
    })
  }
  return out
}
// </entur-geocoder>

/** A search result's second line: its town, and for a stop its kinds ("Oslo · Train station, Bus stop"). */
function placeLine(p: Pick<GeoPlace, 'locality' | 'category'>): string | undefined {
  return [p.locality, p.category].filter(Boolean).join(' · ') || undefined
}

export { GEOCODER_V3, geocoderQuery, parseGeocoderPlaces, placeLine, stopKinds }
export type { GeoPlace }
