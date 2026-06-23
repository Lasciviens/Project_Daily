import { useState, useEffect, useRef } from 'react'
import {
  VEHICLES_REST_URL,
  ET_CLIENT_NAME,
  RUTER_CODESPACE,
  POLL_INTERVAL_MS,
  TRACKING_POLL_INTERVAL_MS,
  VEHICLE_STALE_AFTER_MS,
  BBOX_PADDING_DEG,
} from './config'
import type { VehiclePosition, VehicleTarget, RouteStop, RawVehicle, VehiclesApiResponse } from './types'

// ─── GraphQL query builders ───────────────────────────────────────────────────

const VEHICLE_FIELDS = `
  vehicleId
  line { lineRef publicCode }
  location { latitude longitude }
  bearing delay destinationName monitored
`

function queryByBbox(minLat: number, minLon: number, maxLat: number, maxLon: number): string {
  return `{ vehicles(codespaceId: "${RUTER_CODESPACE}" boundingBox: { minLat: ${minLat} minLon: ${minLon} maxLat: ${maxLat} maxLon: ${maxLon} }) { ${VEHICLE_FIELDS} } }`
}

function queryByJourney(serviceJourneyId: string): string {
  return `{ vehicles(serviceJourneyId: "${serviceJourneyId}") { ${VEHICLE_FIELDS} } }`
}

// Fetch route stops from Journey Planner (called once per tracked journey)
async function fetchRouteStops(serviceJourneyId: string): Promise<RouteStop[]> {
  const JOURNEY = 'https://api.entur.io/journey-planner/v3/graphql'
  const res = await fetch(JOURNEY, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ET_CLIENT_NAME },
    body: JSON.stringify({ query: `{ serviceJourney(id: "${serviceJourneyId}") { passingTimes { quay { name latitude longitude } } } }` }),
  })
  if (!res.ok) return []
  const json = await res.json() as {
    data?: { serviceJourney?: { passingTimes: Array<{ quay: { name: string; latitude: number; longitude: number } | null }> } | null }
  }
  return (json.data?.serviceJourney?.passingTimes ?? [])
    .map(pt => pt.quay)
    .filter((q): q is NonNullable<typeof q> => q !== null && typeof q.latitude === 'number')
    .map(q => ({ name: q.name, lat: q.latitude, lon: q.longitude }))
}

// ─── Normalise raw vehicle ───────────────────────────────────────────────────
function normalise(raw: RawVehicle): VehiclePosition | null {
  if (!raw.location) return null
  return {
    vehicleId:       raw.vehicleId,
    publicCode:      raw.line?.publicCode ?? '?',
    lineRef:         raw.line?.lineRef    ?? '',
    latitude:        raw.location.latitude,
    longitude:       raw.location.longitude,
    bearing:         raw.bearing,
    delay:           raw.delay,
    destinationName: raw.destinationName,
    monitored:       raw.monitored,
    lastSeenAt:      Date.now(),
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export interface UseVehiclePositionsResult {
  vehicles:   VehiclePosition[]
  routeStops: RouteStop[]
  isLoading:  boolean
  error:      string | null
  lastUpdate: number | null
}

export function useVehiclePositions(target: VehicleTarget): UseVehiclePositionsResult {
  const [vehicles,   setVehicles]   = useState<VehiclePosition[]>([])
  const [routeStops, setRouteStops] = useState<RouteStop[]>([])
  const [isLoading,  setIsLoading]  = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)

  const vehicleMapRef = useRef<Map<string, VehiclePosition>>(new Map())

  // Build a stable key so the effect only re-runs when the target meaningfully changes
  const targetKey = !target ? 'null'
    : target.kind === 'stop'    ? `stop:${target.stop.id}`
    : target.kind === 'journey' ? `journey:${target.serviceJourneyId}`
    : `bbox:${target.minLat},${target.minLon},${target.maxLat},${target.maxLon}`

  useEffect(() => {
    if (!target) {
      setVehicles([]); setRouteStops([]); setError(null)
      vehicleMapRef.current.clear()
      return
    }

    let cancelled = false
    const t = target   // non-null snapshot so TS can narrow inside closures

    // Build the GraphQL query for this target
    function buildQuery(): string {
      if (t.kind === 'journey') return queryByJourney(t.serviceJourneyId)
      if (t.kind === 'bbox')    return queryByBbox(t.minLat, t.minLon, t.maxLat, t.maxLon)
      // stop mode
      const { lat, lon } = t.stop
      return queryByBbox(lat - BBOX_PADDING_DEG, lon - BBOX_PADDING_DEG, lat + BBOX_PADDING_DEG, lon + BBOX_PADDING_DEG)
    }

    // Fetch route stops once for journey tracking
    if (t.kind === 'journey') {
      fetchRouteStops(t.serviceJourneyId)
        .then(stops => { if (!cancelled) setRouteStops(stops) })
        .catch(() => {})
    } else {
      setRouteStops([])
    }

    const pollInterval = t.kind === 'journey' ? TRACKING_POLL_INTERVAL_MS : POLL_INTERVAL_MS

    async function fetchVehicles() {
      try {
        const res = await fetch(VEHICLES_REST_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ET_CLIENT_NAME },
          body:    JSON.stringify({ query: buildQuery() }),
        })
        if (!res.ok) throw new Error(`Vehicles API: HTTP ${res.status}`)

        const json: VehiclesApiResponse = await res.json()
        const rawList = json.data?.vehicles ?? []

        if (cancelled) return

        const now = Date.now()
        const map = vehicleMapRef.current

        for (const raw of rawList) {
          const v = normalise(raw)
          if (v) map.set(v.vehicleId, v)
        }
        for (const [id, v] of map) {
          if (now - v.lastSeenAt > VEHICLE_STALE_AFTER_MS) map.delete(id)
        }

        setVehicles(Array.from(map.values()))
        setLastUpdate(now)
        setError(null)
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? 'Failed to fetch vehicles')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    setIsLoading(true)
    fetchVehicles()
    const timer = setInterval(fetchVehicles, pollInterval)

    return () => {
      cancelled = true
      clearInterval(timer)
      vehicleMapRef.current.clear()
      setVehicles([])
    }
  }, [targetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { vehicles, routeStops, isLoading, error, lastUpdate }
}
