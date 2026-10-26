// EnTur's place search (the geocoder), v3. Pure: the browser's stop search
// (ruterApi.searchStops) and ai-proxy's trip planning both build the query and
// read the answer with this block; ai-proxy carries a verbatim copy and
// scripts/verify-entur-geocoder.cjs checks the two are identical.
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
  /** A stop's NeTEx types, e.g. "onstreetBus, metroStation". */
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
      category: isStop && types.length ? types.join(', ') : undefined,
      lat: point?.[1], lon: point?.[0],
    })
  }
  return out
}
// </entur-geocoder>

// The block has no `export` of its own: ai-proxy runs it as plain code.
export { GEOCODER_V3, geocoderQuery, parseGeocoderPlaces }
export type { GeoPlace }
