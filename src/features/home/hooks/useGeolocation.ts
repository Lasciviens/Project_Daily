import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchTransitStops } from '../api/transitStoreApi'
import { findPlace } from '../transitPlaces'

export interface GeoPosition {
  lat:    number
  lon:    number
  /** gps: the phone's position · saved: the Home place (Settings → Places) · default: Oslo. */
  source: 'gps' | 'saved' | 'default'
}

// Oslo — used when there is no position and no saved Home place with a map
// point, so every consumer still gets a sensible forecast/nearby-stop location
// instead of an error state.
const OSLO_DEFAULT: GeoPosition = { lat: 59.9139, lon: 10.7522, source: 'default' }

/** The owner tapped "Use my location" in this session: the phone may be asked. */
let askedThisSession = false

/** Whether the phone already allows the position without asking (no prompt when it says so). */
async function allowedWithoutAsking(): Promise<boolean> {
  try {
    const state = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return state?.state === 'granted'
  } catch {
    return false
  }
}

async function requestPosition(): Promise<GeoPosition | null> {
  if (!('geolocation' in navigator)) return null
  // Never a prompt on opening the app (owner, 31.10.2026: "boring to click on yes … every single time"): the phone is
  // asked only when it already allows it, or after "Use my location".
  if (!askedThisSession && !(await allowedWithoutAsking())) return null
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'gps' }),
      () => resolve(null),
      { maximumAge: 30 * 60_000, timeout: 10_000 },
    )
  })
}

// One answer per session — React Query dedupes concurrent callers (Weather +
// Transit share it) and caches it. No position: the saved Home place when it
// has a map point (an address saved in Places), else Oslo — never an error, so
// a widget that depends on it still works.
export function useGeolocation() {
  const gps = useQuery({
    queryKey:  qk.external.geolocation(),
    queryFn:   requestPosition,
    staleTime: STALE.never,
    gcTime:    Infinity,
    retry:     false,
  })
  const { data: stops = [] } = useQuery({ queryKey: qk.transit.stops(), queryFn: fetchTransitStops, staleTime: STALE.default })
  const home = findPlace(stops, 'home')
  const saved: GeoPosition | null = home?.lat != null && home?.lon != null ? { lat: home.lat, lon: home.lon, source: 'saved' } : null
  const data: GeoPosition | undefined = gps.isPending ? undefined : gps.data ?? saved ?? OSLO_DEFAULT
  return { ...gps, data }
}

/** "Use my location": asks the phone now (its prompt, if it has one) and shares the answer with every card. */
export function useAskLocation() {
  const qc = useQueryClient()
  return () => {
    askedThisSession = true
    return qc.refetchQueries({ queryKey: qk.external.geolocation() })
  }
}
