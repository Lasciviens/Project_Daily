import { useState, type ReactNode } from 'react'
import { CloudRain, CloudSun, Droplets, Wind } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton, Truncate } from '../../../shared/ui'
import { hoursFromNow, weatherIcon, weatherLabel, type WeatherData, type WeatherHour } from '../api/weatherApi'
import { feelsLike } from '../briefRules'
import { useWeather } from '../hooks/useWeather'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceCarousel, type GlanceScreen } from './GlanceCarousel'
import { WeatherGlanceArt } from './glanceMotifs'
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

/** One fact under the large tile's "now": a small label over its value. */
function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-control bg-surface-2 px-2 py-1.5">
      <p className="flex items-center gap-1 text-micro text-fg-muted"><span aria-hidden className="[&_svg]:h-3 [&_svg]:w-3">{icon}</span>{label}</p>
      <Truncate className="text-meta font-semibold tabular-nums text-fg">{value}</Truncate>
    </div>
  )
}

/**
 * The large tile's one screen (beside the tasks on Home's split laptop board,
 * as tall as they are): now with feels-like and today's range; wind, rain
 * and humidity; the next eight hours; the next five days. Top-aligned; the
 * day rows share whatever height the tile has to spare (up to a cap), so no
 * gaps open between the blocks.
 */
function weatherOverview(data: WeatherData): GlanceScreen {
  const c = data.current
  const ahead = hoursFromNow(data)
  const hours = ahead.slice(1, 9)
  const wet = hours.some(h => h.precip >= 0.1)
  const rain12 = ahead.slice(0, 12).reduce((sum, h) => sum + h.precip, 0)
  const fl = feelsLike(c.temp, c.windSpeed)
  const feels = fl != null && c.temp - Math.round(fl) >= 2 ? Math.round(fl) : null
  return {
    key: 'overview',
    name: 'Now',
    body: (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="text-5xl leading-none">{weatherIcon(c.symbol)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-kpi font-bold leading-none tabular-nums text-fg">{c.temp}°</p>
            <Truncate className="mt-1 text-meta text-fg-muted">{weatherLabel(c.symbol)}{feels != null ? ` · feels like ${feels}°` : ''}</Truncate>
          </div>
          {data.today && (
            <div className="shrink-0 text-right">
              <p className="text-micro text-fg-muted">Today</p>
              <p className="text-ui font-semibold tabular-nums text-fg">{data.today.min}–{data.today.max}°</p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Fact icon={<Wind />} label="Wind" value={`${c.windSpeed} m/s${c.windDirection !== '—' ? ` ${c.windDirection}` : ''}`} />
          <Fact icon={<CloudRain />} label="Next 12 h" value={rain12 >= 0.1 ? `${rain12.toFixed(1)} mm` : 'Dry'} />
          <Fact icon={<Droplets />} label="Humidity" value={`${c.humidity}%`} />
        </div>
        {hours.length > 0 && (
          <div className="min-w-0">
            <p className="mb-1 text-micro font-medium text-fg-muted">Next hours</p>
            <div className="grid grid-cols-8 gap-0.5 text-center">
              {hours.map(h => (
                <div key={h.time} className="min-w-0">
                  <div className="text-micro tabular-nums text-fg-muted">{h.time}</div>
                  <div aria-hidden className="text-xl leading-8">{weatherIcon(h.symbol)}</div>
                  <div className="text-meta font-semibold tabular-nums text-fg">{h.temp}°</div>
                  {wet && <div className="h-4 text-micro tabular-nums text-info">{h.precip >= 0.1 ? h.precip.toFixed(1) : ''}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {data.daily.length > 0 && (
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="mb-1 text-micro font-medium text-fg-muted">Next days</p>
            <ul className="flex max-h-72 flex-1 flex-col divide-y divide-line">
              {data.daily.slice(0, 5).map(d => (
                <li key={d.date} className="flex min-h-9 flex-1 items-center gap-2 tabular-nums">
                  <span className="w-10 shrink-0 text-meta font-medium text-fg-muted">{d.label}</span>
                  <span aria-hidden className="shrink-0 text-xl leading-none">{weatherIcon(d.symbol)}</span>
                  <span className="min-w-0 flex-1 text-micro text-info">{d.precip >= 0.1 ? `${d.precip.toFixed(1)} mm` : ''}</span>
                  <span className="shrink-0 text-meta text-fg-muted">{d.min}°</span>
                  <span className="w-9 shrink-0 text-right text-meta font-semibold text-fg">{d.max}°</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    ),
  }
}

/**
 * Glance tile with swipeable screens; the full forecast opens in a sheet.
 * `large` (beside the tasks on the split laptop board): one screen with
 * everything at once (`weatherOverview`).
 */
export function WeatherTile({ large = false }: { large?: boolean }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error, refetch, geo } = useWeather()
  const screens = data ? (large ? [weatherOverview(data)] : weatherScreens(data)) : [{ key: 'none', name: 'Now', value: '—', hint: error ? 'Unavailable' : undefined }]
  return (
    <>
      <GlanceCarousel id="weather" label="Weather" icon={<CloudSun />} art={<WeatherGlanceArt />} loading={isLoading} screens={screens} onClick={() => setOpen(true)} />
      <ModalShell open={open} onClose={() => setOpen(false)} title="Weather" size="sm">
        {isLoading && <WeatherSkeleton />}
        {error && !data && <WeatherError message={(error as Error).message} onRetry={() => refetch()} />}
        {data && <WeatherDetails data={data} fallbackLocation={geo?.source === 'default'} />}
      </ModalShell>
    </>
  )
}
