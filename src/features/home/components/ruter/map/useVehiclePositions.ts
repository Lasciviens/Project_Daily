/**
 * useVehiclePositions
 *
 * Polls the EnTur Vehicles GraphQL REST endpoint for real-time vehicle
 * positions within a bounding box around the given stop.
 *
 * Why polling instead of WebSocket?
 *   The graphql-ws subscription protocol requires extra coordination and
 *   a library dependency.  REST polling at 15 s is simpler, reliable from
 *   any browser, and EnTur refreshes the data every ~15 s anyway — so
 *   there's no meaningful UX difference.
 *
 * To switch to WebSocket later:
 *   Replace the useEffect body with a graphql-ws client
 *   (npm install graphql-ws) and keep the same setState calls.
 */

import { useState, useEffect, useRef } from 'react'
import {
  VEHICLES_REST_URL,
  ET_CLIENT_NAME,
  RUTER_CODESPACE,
  POLL_INTERVAL_MS,
  VEHICLE_STALE_AFTER_MS,
  BBOX_PADDING_DEG,
} from './config'
import type { VehiclePosition, StopPin, RawVehicle, VehiclesApiResponse } from './types'

// ─── GraphQL query ────────────────────────────────────────────────────────────
// Fetch vehicles inside a bounding box around the selected stop.
// Requesting only the fields we actually render keeps the payload small.
function buildQuery(stop: StopPin): string {
  const minLat = stop.lat - BBOX_PADDING_DEG
  const maxLat = stop.lat + BBOX_PADDING_DEG
  const minLon = stop.lon - BBOX_PADDING_DEG
  const maxLon = stop.lon + BBOX_PADDING_DEG

  return `{
    vehicles(
      codespaceId: "${RUTER_CODESPACE}"
      boundingBox: {
        minLat: ${minLat}
        minLon: ${minLon}
        maxLat: ${maxLat}
        maxLon: ${maxLon}
      }
    ) {
      vehicleId
      line { lineRef publicCode }
      location { latitude longitude }
      bearing
      delay
      destinationName
      monitored
    }
  }`
}

// ─── Normalise raw API response into our VehiclePosition shape ───────────────
function normalise(raw: RawVehicle): VehiclePosition | null {
  // Skip vehicles without a location — can't put them on a map
  if (!raw.location) return null
  return {
    vehicleId:       raw.vehicleId,
    publicCode:      raw.line?.publicCode  ?? '?',
    lineRef:         raw.line?.lineRef     ?? '',
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
  isLoading:  boolean
  error:      string | null
  lastUpdate: number | null   // Date.now() of last successful fetch
}

export function useVehiclePositions(stop: StopPin | null): UseVehiclePositionsResult {
  const [vehicles,   setVehicles]   = useState<VehiclePosition[]>([])
  const [isLoading,  setIsLoading]  = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)

  // Keep a ref to the current vehicle map so the interval callback always
  // sees the latest state without a stale closure.
  const vehicleMapRef = useRef<Map<string, VehiclePosition>>(new Map())

  useEffect(() => {
    // Nothing to fetch when no stop is selected
    if (!stop) {
      setVehicles([])
      setError(null)
      return
    }

    let cancelled = false   // prevents state updates after unmount

    async function fetchVehicles() {
      try {
        const res = await fetch(VEHICLES_REST_URL, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'ET-Client-Name': ET_CLIENT_NAME,
          },
          body: JSON.stringify({ query: buildQuery(stop!) }),
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json: VehiclesApiResponse = await res.json()
        if (!json.data?.vehicles) throw new Error('Unexpected response shape')

        if (cancelled) return

        const now = Date.now()

        // Merge new data into our running map, keyed by vehicleId.
        // This way vehicles that temporarily leave the bbox stay visible
        // for VEHICLE_STALE_AFTER_MS before disappearing.
        const map = vehicleMapRef.current
        for (const raw of json.data.vehicles) {
          const v = normalise(raw)
          if (v) map.set(v.vehicleId, v)
        }

        // Evict stale vehicles (no update for > VEHICLE_STALE_AFTER_MS)
        for (const [id, v] of map) {
          if (now - v.lastSeenAt > VEHICLE_STALE_AFTER_MS) map.delete(id)
        }

        setVehicles(Array.from(map.values()))
        setLastUpdate(now)
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message ?? 'Failed to fetch vehicles')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    // Initial load
    setIsLoading(true)
    fetchVehicles()

    // Poll on interval
    const timer = setInterval(fetchVehicles, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
      // Clear the vehicle map so a new stop starts fresh
      vehicleMapRef.current = new Map()
      setVehicles([])
    }
  }, [stop?.id, stop?.lat, stop?.lon])  // re-run only when the stop changes

  return { vehicles, isLoading, error, lastUpdate }
}
