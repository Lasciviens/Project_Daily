import { useQuery } from '@tanstack/react-query'
import { fetchWeather, weatherIcon, weatherLabel } from '../api/weatherApi'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'

const OSLO = { lat: 59.9139, lon: 10.7522 }

// ─── Component ────────────────────────────────────────────────────────────────

export function WeatherWidget() {
  // Weather changes slowly — 10m default is fine; 30m is also acceptable
  const ws = useWidgetState('weather', { collapsed: false, intervalMs: 10 * 60_000 })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['weather', 'oslo'],
    queryFn:  () => fetchWeather(OSLO.lat, OSLO.lon),
    staleTime: ws.intervalMs,
    // Disable refetch entirely when collapsed or sync is paused
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled: !ws.collapsed,
  })

  function handleManualSync() {
    refetch()
    ws.markSynced()
  }

  return (
    <WidgetShell title="Oslo Weather" ws={ws} onManualSync={handleManualSync}>
      {isLoading && (
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-cream-200 animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-16 rounded bg-cream-200 animate-pulse" />
            <div className="h-3 w-24 rounded bg-cream-200 animate-pulse" />
          </div>
        </div>
      )}
      {error    && <div className="text-ink-400 text-sm">Unavailable</div>}

      {data && (
        <>
          {/* Current conditions */}
          <div className="flex items-end gap-3 mb-4">
            <span className="text-5xl leading-none">{weatherIcon(data.current.symbol)}</span>
            <div>
              <div className="text-3xl font-bold text-ink-900">{data.current.temp}°C</div>
              <div className="text-sm text-ink-500">{weatherLabel(data.current.symbol)}</div>
            </div>
            <div className="ml-auto text-right text-xs text-ink-400 space-y-1">
              <div>💨 {data.current.windSpeed} m/s</div>
              <div>💧 {data.current.humidity}%</div>
              {data.current.precip1h > 0 && (
                <div>🌧 {data.current.precip1h.toFixed(1)} mm</div>
              )}
            </div>
          </div>

          {/* 12-hour hourly forecast */}
          <div className="flex gap-3 overflow-x-auto pb-1">
            {data.hours.map((h, i) => (
              <div key={i} className="flex flex-col items-center gap-1 min-w-[44px]">
                <span className="text-xs text-ink-400">{h.time}</span>
                <span className="text-lg">{weatherIcon(h.symbol)}</span>
                <span className="text-xs font-medium text-ink-700">{h.temp}°</span>
                {h.precip > 0 && (
                  <span className="text-[10px] text-blue-500">{h.precip.toFixed(1)}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </WidgetShell>
  )
}
