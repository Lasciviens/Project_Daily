import { useQuery } from '@tanstack/react-query'

export interface GeoPosition {
  lat:    number
  lon:    number
  source: 'gps' | 'default'
}

// Oslo — used when geolocation is denied, unsupported, or times out, so every
// consumer still gets a sensible forecast/nearby-stop location instead of an
// error state.
const OSLO_DEFAULT: GeoPosition = { lat: 59.9139, lon: 10.7522, source: 'default' }

async function requestPosition(): Promise<GeoPosition> {
  if (!('geolocation' in navigator)) return OSLO_DEFAULT
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'gps' }),
      () => resolve(OSLO_DEFAULT),
      { maximumAge: 30 * 60_000, timeout: 10_000 },
    )
  })
}

// Requests the browser's location ONCE per session — React Query dedupes
// concurrent callers (Weather + Transit can both use this without triggering
// two separate permission prompts or GPS reads) and caches the result for the
// rest of the session. Falls back to Oslo rather than erroring, so a denial
// degrades gracefully instead of breaking the widgets that depend on it.
export function useGeolocation() {
  return useQuery({
    queryKey:  ['geolocation'],
    queryFn:   requestPosition,
    staleTime: Infinity,
    gcTime:    Infinity,
    retry:     false,
  })
}
