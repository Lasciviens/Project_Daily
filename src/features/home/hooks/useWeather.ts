import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchWeather } from '../api/weatherApi'
import { useGeolocation } from './useGeolocation'

/**
 * The ONE weather read. Keyed by the real (or Oslo-fallback) coordinates from
 * useGeolocation, so the Home hero and the Weather widget share one request and
 * always show the same temperature. `refetchInterval` only while the widget is
 * expanded and syncing.
 */
export function useWeather({ enabled = true, refetchInterval = false }: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  const { data: geo } = useGeolocation()
  const query = useQuery({
    queryKey: qk.external.weather(geo?.lat ?? 0, geo?.lon ?? 0),
    queryFn:  () => fetchWeather(geo!.lat, geo!.lon),
    staleTime: STALE.long,
    refetchOnWindowFocus: false,
    refetchInterval,
    enabled: enabled && !!geo,
  })
  return { ...query, geo }
}
