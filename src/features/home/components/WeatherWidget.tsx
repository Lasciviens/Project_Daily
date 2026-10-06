import { useState } from 'react'
import { CloudSun } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton } from '../../../shared/ui'
import { hoursFromNow, weatherIcon, weatherLabel, type WeatherData, type WeatherHour } from '../api/weatherApi'
import { useWeather } from '../hooks/useWeather'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceCarousel, type GlanceScreen } from './GlanceCarousel'
import { WeatherDetails } from './WeatherDetails'

function WeatherSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <Skeleton rounded="rounded-full" className="h-12 w-12" />
        <div className="space-y-2"><Skeleton className="h-7 w-20" /><Skeleton className="h-3 w-24" /></div>
      </div>
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

function WeatherError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-body text-fg-muted">
      <span>Forecast unavailable — {message || 'could not load it'}.</span>
      <Button size="sm" onClick={onRetry}>Retry</Button>
    </div>
  )
}

/** Desktop side-column card. Collapsing it stops its forecast query. */
export function WeatherWidget() {
  const ws = useWidgetState('weather')
  const { data, isLoading, error, refetch, isFetching, geo } = useWeather({ enabled: !ws.collapsed })
  return (
    <WidgetShell title="Weather" icon={<CloudSun />} ws={ws} onRefresh={() => refetch()} refreshing={isFetching}>
      {isLoading && <WeatherSkeleton />}
      {error && !data && <WeatherError message={(error as Error).message} onRetry={() => refetch()} />}
      {data && <WeatherDetails data={data} fallbackLocation={geo?.source === 'default'} />}
    </WidgetShell>
  )
}

/** The tile's screens: now · the next hours · the next days · wind and rain. */
function weatherScreens(data: WeatherData): GlanceScreen[] {
  const ahead = hoursFromNow(data)
  const strip = [1, 3, 5, 7].map(i => ahead[i]).filter((h): h is WeatherHour => !!h)
  const rain12 = ahead.slice(0, 12).reduce((sum, h) => sum + h.precip, 0)
  const c = data.current
  const screens: GlanceScreen[] = [{
    key: 'now',
    name: 'Now',
    value: <span className="flex items-center gap-1.5"><span aria-hidden>{weatherIcon(c.symbol)}</span>{c.temp}°</span>,
    hint: `${weatherLabel(c.symbol)}${data.today ? ` · today ${data.today.min}–${data.today.max}°` : ''}`,
  }]
  if (strip.length >= 3) {
    screens.push({
      key: 'hours',
      name: 'Next hours',
      body: (
        <div className="grid grid-cols-4 gap-1 text-center">
          {strip.map(h => (
            <div key={h.time} className="min-w-0">
              <div className="text-micro tabular-nums text-fg-muted">{h.time}</div>
              <div aria-hidden className="text-base leading-6">{weatherIcon(h.symbol)}</div>
              <div className="text-meta font-semibold tabular-nums text-fg">{h.temp}°</div>
            </div>
          ))}
        </div>
      ),
    })
  }
  if (data.daily.length > 0) {
    screens.push({
      key: 'days',
      name: 'Next days',
      body: (
        <ul className="space-y-0.5">
          {data.daily.slice(0, 3).map(d => (
            <li key={d.date} className="flex items-center gap-1.5 text-meta tabular-nums">
              <span className="w-8 shrink-0 text-fg-muted">{d.label}</span>
              <span aria-hidden className="shrink-0">{weatherIcon(d.symbol)}</span>
              <span className="min-w-0 flex-1 truncate text-right font-semibold text-fg">{d.min}–{d.max}°</span>
            </li>
          ))}
        </ul>
      ),
    })
  }
  screens.push({
    key: 'wind',
    name: 'Wind & rain',
    value: <span className="flex items-baseline gap-1">{c.windSpeed}<span className="text-meta font-medium text-fg-muted">m/s {c.windDirection !== '—' ? c.windDirection : ''}</span></span>,
    hint: rain12 >= 0.1 ? `${rain12.toFixed(1)} mm rain in the next 12 h · humidity ${c.humidity}%` : `Dry for the next 12 h · humidity ${c.humidity}%`,
  })
  return screens
}

/** Glance tile with swipeable screens; the full forecast opens in a sheet. */
export function WeatherTile() {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error, refetch, geo } = useWeather()
  const screens = data ? weatherScreens(data) : [{ key: 'none', name: 'Now', value: '—', hint: error ? 'Unavailable' : undefined }]
  return (
    <>
      <GlanceCarousel id="weather" label="Weather" icon={<CloudSun />} loading={isLoading} screens={screens} onClick={() => setOpen(true)} />
      <ModalShell open={open} onClose={() => setOpen(false)} title="Weather" size="sm">
        {isLoading && <WeatherSkeleton />}
        {error && !data && <WeatherError message={(error as Error).message} onRetry={() => refetch()} />}
        {data && <WeatherDetails data={data} fallbackLocation={geo?.source === 'default'} />}
      </ModalShell>
    </>
  )
}
