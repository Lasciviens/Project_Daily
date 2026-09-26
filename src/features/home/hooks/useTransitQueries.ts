import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import {
  fetchDepartures, fetchNearestStops, fetchStopDirections, fetchTrips, searchStops,
  type TransitPlace,
} from '../api/ruterApi'
import { useGeolocation } from './useGeolocation'
import { useTravelProfile, WALK_SPEED_MPS } from './useTravelProfile'

/** 24 departures (not the default 12): quay scoping filters client-side from this one pool. */
export const DEPARTURE_POOL = 24
export const DEPARTURES_INTERVAL_MS = 60_000

/** Live board for one stop. `live` = refetch every minute while shown. */
export function useDepartures(stopId: string | null | undefined, { enabled = true, live = true }: { enabled?: boolean; live?: boolean } = {}) {
  return useQuery({
    queryKey: qk.external.departures(stopId ?? ''),
    queryFn:  () => fetchDepartures(stopId!, DEPARTURE_POOL),
    staleTime: STALE.short,
    refetchInterval: enabled && live ? DEPARTURES_INTERVAL_MS : false,
    enabled:  enabled && !!stopId && stopId.startsWith('NSR:'),
  })
}

/**
 * Real stops around the user's actual position. Never suggested off the Oslo
 * fallback — that would point someone elsewhere at the wrong city.
 */
export function useNearbyStops({ enabled = true }: { enabled?: boolean } = {}) {
  const { data: geo } = useGeolocation()
  return useQuery({
    queryKey: qk.external.nearbyStops(geo?.lat ?? 0, geo?.lon ?? 0),
    queryFn:  () => fetchNearestStops(geo!.lat, geo!.lon),
    enabled:  enabled && geo?.source === 'gps',
    staleTime: STALE.default,
    retry:    false,
  })
}

export function useStopSearch(query: string) {
  return useQuery({
    queryKey: qk.external.stopSearch(query),
    queryFn:  () => searchStops(query),
    enabled:  query.length >= 2,
    staleTime: STALE.default,
    retry:    false,
  })
}

export function useStopDirections(stopId: string | null) {
  return useQuery({
    queryKey: qk.external.stopDirections(stopId ?? ''),
    queryFn:  () => fetchStopDirections(stopId!),
    enabled:  !!stopId,
    staleTime: STALE.long,
    retry:    false,
  })
}

const placeKey = (p: TransitPlace | null | undefined) =>
  !p ? '' : p.kind === 'stop' ? p.id : `${p.lat},${p.lon}`

interface TripSearch {
  from: TransitPlace
  to: TransitPlace
  via?: TransitPlace | null
  dateTime?: string
  arriveBy?: boolean
  /** Bumped by the caller to force a fresh search for the same places. */
  version: number
}

/** Trip plans with the saved travel profile applied. Results never go stale by themselves — refresh is explicit. */
export function useTrips(search: TripSearch | null, { enabled = true }: { enabled?: boolean } = {}) {
  const { profile } = useTravelProfile()
  const parts = search
    ? [placeKey(search.from), placeKey(search.to), search.arriveBy, search.dateTime ?? 'now', search.version, profile]
    : []
  const via = search?.via ?? null
  return useQuery({
    queryKey: via ? qk.external.tripVia([placeKey(search!.from), placeKey(via), placeKey(search!.to), search!.version, profile]) : qk.external.trip(parts),
    queryFn:  () => fetchTrips(search!.from, search!.to, undefined, search!.dateTime, search!.arriveBy ?? false, {
      walkSpeed:            WALK_SPEED_MPS[profile.walkPace],
      maximumTransfers:     profile.maximumTransfers,
      wheelchairAccessible: profile.wheelchairAccessible,
    }, via ? [via] : undefined),
    staleTime: STALE.never,
    enabled:  enabled && !!search,
  })
}
