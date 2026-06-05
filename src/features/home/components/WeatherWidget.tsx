import { useWeather } from '../hooks/useHomeData'
import { weatherIcon, weatherLabel } from '../api/weatherApi'

export function WeatherWidget() {
  const { data, isLoading, error } = useWeather()

  if (isLoading) return <WidgetShell title="Weather"><div className="text-ink-400 text-sm">Loading…</div></WidgetShell>
  if (error || !data) return <WidgetShell title="Weather"><div className="text-ink-400 text-sm">Unavailable</div></WidgetShell>

  const { current, hours } = data

  return (
    <WidgetShell title="Oslo Weather">
      {/* Current conditions */}
      <div className="flex items-end gap-3 mb-4">
        <span className="text-5xl leading-none">{weatherIcon(current.symbol)}</span>
        <div>
          <div className="text-3xl font-bold text-ink-900">{current.temp}°C</div>
          <div className="text-sm text-ink-500">{weatherLabel(current.symbol)}</div>
        </div>
        <div className="ml-auto text-right text-xs text-ink-400 space-y-1">
          <div>💨 {current.windSpeed} m/s</div>
          <div>💧 {current.humidity}%</div>
          {current.precip1h > 0 && <div>🌧 {current.precip1h.toFixed(1)} mm</div>}
        </div>
      </div>

      {/* Hourly row */}
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {hours.map((h, i) => (
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
    </WidgetShell>
  )
}

function WidgetShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-ink-200 p-4 shadow-sm">
      <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  )
}
