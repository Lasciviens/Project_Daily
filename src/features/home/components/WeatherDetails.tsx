import { Droplets, Wind, CloudRain, MapPin } from 'lucide-react'
import { SectionLabel } from '../../../shared/ui'
import { weatherIcon, weatherLabel, type WeatherData } from '../api/weatherApi'

// Weather symbols are content (a forecast glyph), so the emoji from weatherIcon stays.

export function WeatherNow({ data }: { data: WeatherData }) {
  const c = data.current
  return (
    <div className="flex items-end gap-3">
      <span aria-hidden className="text-5xl leading-none">{weatherIcon(c.symbol)}</span>
      <div className="min-w-0">
        <div className="text-kpi font-bold tabular-nums tracking-tight text-fg">{c.temp}°C</div>
        <div className="truncate text-body text-fg-muted">{weatherLabel(c.symbol)}</div>
      </div>
      <div className="ml-auto shrink-0 space-y-1 text-right text-meta tabular-nums text-fg-muted">
        <div className="flex items-center justify-end gap-1"><Wind aria-hidden className="h-3.5 w-3.5" />{c.windSpeed} m/s {c.windDirection}</div>
        <div className="flex items-center justify-end gap-1"><Droplets aria-hidden className="h-3.5 w-3.5" />{c.humidity}%</div>
        {c.precip1h > 0 && <div className="flex items-center justify-end gap-1 text-info"><CloudRain aria-hidden className="h-3.5 w-3.5" />{c.precip1h.toFixed(1)} mm</div>}
      </div>
    </div>
  )
}

export function WeatherHours({ data }: { data: WeatherData }) {
  return (
    <div>
      <SectionLabel className="mb-1.5">Next hours</SectionLabel>
      <div className="scroll-x -mx-1 flex gap-1 px-1 pb-1">
        {data.hours.map(h => (
          <div key={h.time} className="flex min-w-[44px] flex-col items-center gap-0.5 rounded-control py-1">
            <span className="text-micro tabular-nums text-fg-muted">{h.time}</span>
            <span aria-hidden className="text-lg">{weatherIcon(h.symbol)}</span>
            <span className="text-meta font-medium tabular-nums text-fg-2">{h.temp}°</span>
            {h.precip > 0 && <span className="text-micro tabular-nums text-info">{h.precip.toFixed(1)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function WeatherDays({ data }: { data: WeatherData }) {
  if (data.daily.length === 0) return null
  return (
    <div>
      <SectionLabel className="mb-1.5">Next days</SectionLabel>
      <div className="grid grid-cols-5 gap-1.5">
        {data.daily.map(d => (
          <div key={d.date} className="flex flex-col items-center gap-0.5 rounded-control bg-surface-2 px-1 py-2">
            <span className="text-micro font-medium text-fg-muted">{d.label}</span>
            <span aria-hidden className="text-xl">{weatherIcon(d.symbol)}</span>
            <span className="text-meta font-semibold tabular-nums text-fg">{d.max}°</span>
            <span className="text-micro tabular-nums text-fg-muted">{d.min}°</span>
            {d.precip > 0 && <span className="text-micro tabular-nums text-info">{d.precip.toFixed(1)} mm</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function WeatherExtras({ data }: { data: WeatherData }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex items-center justify-between rounded-control bg-surface-2 px-2.5 py-1.5 text-meta text-fg-muted">
        <span>Pressure</span><span className="font-semibold tabular-nums text-fg">{data.current.pressure} hPa</span>
      </div>
      <div className="flex items-center justify-between rounded-control bg-surface-2 px-2.5 py-1.5 text-meta text-fg-muted">
        <span>Cloud cover</span><span className="font-semibold tabular-nums text-fg">{data.current.cloudCover}%</span>
      </div>
    </div>
  )
}

export function FallbackLocationNote() {
  return (
    <p className="flex items-center gap-1 text-meta text-fg-muted">
      <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />
      Showing Oslo — allow location access for your local forecast.
    </p>
  )
}

/** Everything the forecast has: used by the widget body and the phone popup. */
export function WeatherDetails({ data, fallbackLocation }: { data: WeatherData; fallbackLocation?: boolean }) {
  return (
    <div className="space-y-4">
      {fallbackLocation && <FallbackLocationNote />}
      <WeatherNow data={data} />
      <WeatherExtras data={data} />
      <WeatherHours data={data} />
      <WeatherDays data={data} />
    </div>
  )
}
