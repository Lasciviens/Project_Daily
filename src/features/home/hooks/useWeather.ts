import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchWeather, weatherCoord } from '../api/weatherApi'
import { useGeolocation } from './useGeolocation'

/**
 * The ONE weather read. Keyed by the real (or Oslo-fallback) coordinates from
 * useGeolocation, rounded by weatherCoord, so the Home hero and the Weather widget share one request and
 * always show the same temperature. `refetchInterval` only while the widget is
 * expanded and syncing.
 */
export function useWeather({ enabled = true, refetchInterval = false }: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  const { data: geo } = useGeolocation()
  const lat = weatherCoord(geo?.lat ?? 0)
  const lon = weatherCoord(geo?.lon ?? 0)
  const query = useQuery({
    queryKey: qk.external.weather(lat, lon),
    queryFn:  () => fetchWeather(lat, lon),
    staleTime: STALE.long,
    // MET updates hourly; an open app (the installed PWA stays open for
    // days) refreshes when it comes back to the front and every 30 min while
    // visible, so the brief and the tiles never read a morning forecast at night.
    refetchOnWindowFocus: true,
    refetchInterval: refetchInterval || 30 * 60_000,
    enabled: enabled && !!geo,
  })
  return { ...query, geo }
}
