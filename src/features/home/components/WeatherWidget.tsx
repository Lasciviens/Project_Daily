import { useState } from 'react'
import { CloudSun } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton } from '../../../shared/ui'
import { weatherIcon, weatherLabel } from '../api/weatherApi'
import { useWeather } from '../hooks/useWeather'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'
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

/** Phone glance tile; the full forecast opens in a sheet. */
export function WeatherTile() {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error, refetch, geo } = useWeather()
  const today = data?.daily[0]
  return (
    <>
      <GlanceTile
        label="Weather"
        icon={<CloudSun />}
        loading={isLoading}
        value={data ? <span className="flex items-center gap-1.5"><span aria-hidden>{weatherIcon(data.current.symbol)}</span>{data.current.temp}°</span> : '—'}
        hint={data ? `${weatherLabel(data.current.symbol)}${today ? ` · ${today.min}°/${today.max}°` : ''}` : error ? 'Unavailable' : undefined}
        onClick={() => setOpen(true)}
      />
      <ModalShell open={open} onClose={() => setOpen(false)} title="Weather" size="sm">
        {isLoading && <WeatherSkeleton />}
        {error && !data && <WeatherError message={(error as Error).message} onRetry={() => refetch()} />}
        {data && <WeatherDetails data={data} fallbackLocation={geo?.source === 'default'} />}
      </ModalShell>
    </>
  )
}
