import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { TransitPlace, TripPattern } from '../../api/ruterApi'
import type { UserTransitStop } from '../../hooks/useTransitStops'
import { useGeolocation } from '../../hooks/useGeolocation'
import { useTrips } from '../../hooks/useTransitQueries'
import { findPlace, PLACE_LABEL, type PlaceKind } from '../../transitPlaces'
import { Button, IconButton, Skeleton, Truncate, cx } from '../../../../shared/ui'
import { JourneySummaryStrip } from './TripCard'
import { fmtTime, situationTone } from './transitUtils'

const TRIP_ROWS = 3
// Trips are planned for "now"; a new 3-minute bucket plans again, so coming
// back to the card later never shows trips that have long left.
const BUCKET_MS = 3 * 60_000

/** A saved stop as a trip endpoint — an address favourite has no NSR id, so it goes as coordinates. */
function placeOf(stop: UserTransitStop): TransitPlace | null {
  const name = stop.label ?? stop.stop_name
  if (stop.stop_id.startsWith('NSR:')) return { kind: 'stop', id: stop.stop_id, name }
  return stop.lat != null && stop.lon != null ? { kind: 'coords', lat: stop.lat, lon: stop.lon, name } : null
}

const SEVERITY_RANK = { danger: 2, warn: 1, neutral: 0 } as const

/** The worst live disruption on any leg of the trip, if there is one. */
function worstSituation(trip: TripPattern) {
  let best: { summary: string; tone: 'danger' | 'warn' | 'neutral' } | null = null
  for (const leg of trip.legs) {
    for (const s of leg.situations ?? []) {
      const tone = situationTone(s.severity)
      if (!best || SEVERITY_RANK[tone] > SEVERITY_RANK[best.tone]) best = { summary: s.summary, tone }
    }
  }
  return best
}

function CompactTrip({ trip, now, onOpen }: { trip: TripPattern; now: number; onOpen: () => void }) {
  const depMs = new Date(trip.departure).getTime()
  const diffMin = Math.round((depMs - now) / 60_000)
  const durationMin = Math.round((new Date(trip.arrival).getTime() - depMs) / 60_000)
  const transfers = Math.max(0, trip.legs.filter(l => l.mode !== 'foot').length - 1)
  const alert = worstSituation(trip)
  return (
    <button type="button" onClick={onOpen} className="block min-h-[44px] w-full py-2 text-left">
      <span className="flex items-baseline justify-between gap-2">
        <span className={cx('text-body font-semibold', diffMin <= 0 ? 'text-danger' : 'text-accent-700')}>
          {diffMin <= 0 ? 'Leaving now' : diffMin <= 90 ? `Leave in ${diffMin} min` : `Leave at ${fmtTime(trip.departure)}`}
        </span>
        <span className="shrink-0 text-meta tabular-nums text-fg-muted">
          {fmtTime(trip.departure)} → <span className="font-semibold text-fg">{fmtTime(trip.arrival)}</span>
        </span>
      </span>
      <span className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0"><JourneySummaryStrip legs={trip.legs} /></span>
        <span className="shrink-0 text-micro tabular-nums text-fg-muted">
          {durationMin} min{transfers > 0 ? ` · ${transfers} transfer${transfers === 1 ? '' : 's'}` : ''}
        </span>
      </span>
      {alert && (
        <span data-tone={alert.tone} className="tone-soft tone-text mt-1 flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-micro">
          <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" />
          <Truncate>{alert.summary}</Truncate>
        </span>
      )}
    </button>
  )
}

/**
 * Home's Transit card in a To home / To work view: the next few trips from
 * where you are (your location, else your default saved stop) to that saved
 * place, through the planner's own `useTrips` query. Tapping a trip or
 * "More options" opens the full planner on the same trip.
 */
export function CardTrips({ kind, stops, active, now, onMore }: {
  kind: PlaceKind
  stops: readonly UserTransitStop[]
  active: boolean
  now: number
  onMore: (stopId: string | null) => void
}) {
  const dest = findPlace(stops, kind)
  const geo = useGeolocation()
  const [version, setVersion] = useState(() => Math.floor(Date.now() / BUCKET_MS))
  // A new bucket on each visit; a cached search inside the same bucket is reused.
  const [seenKind, setSeenKind] = useState(kind)
  if (seenKind !== kind) { setSeenKind(kind); setVersion(Math.floor(now / BUCKET_MS)) }

  const to = dest ? placeOf(dest) : null
  const fallback = stops.find(s => s.is_default && s.id !== dest?.id && s.stop_id.startsWith('NSR:')) ?? null
  const from: TransitPlace | null = geo.data?.source === 'gps'
    ? { kind: 'coords', lat: geo.data.lat, lon: geo.data.lon, name: 'Current location' }
    : fallback ? placeOf(fallback) : null
  const search = from && to ? { from, to, arriveBy: false, version } : null
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useTrips(search, { enabled: active })

  const trips = useMemo(
    () => (data ?? []).filter(t => new Date(t.departure).getTime() >= now - 60_000).slice(0, TRIP_ROWS),
    [data, now],
  )

  if (!dest) {
    return (
      <p className="py-2 text-body text-fg-muted">
        {PLACE_LABEL[kind]} isn't set.{' '}
        <Link to="/settings?tab=places" className="inline-flex min-h-[44px] items-center font-semibold text-accent-600">Set it in Settings → Places</Link>
      </p>
    )
  }
  if (!to) return <p className="py-2 text-body text-fg-muted">This saved place has no stop or coordinates to plan to.</p>

  const placeName = dest.label ?? dest.stop_name
  const planned = dataUpdatedAt > 0 && !isLoading && !error ? ` · planned ${fmtTime(new Date(dataUpdatedAt).toISOString())}` : ''
  const header = (
    <div className="-mt-1 mb-0.5 flex min-w-0 items-center gap-1">
      <p className="min-w-0 flex-1 text-meta text-fg-muted">
        <Truncate>{`${from?.kind === 'coords' ? 'From your location' : `From ${from?.name ?? '…'}`} to ${placeName}${planned}`}</Truncate>
      </p>
      {search && !error && (
        <IconButton label="Refresh trips" onClick={() => { setVersion(Date.now()); void refetch() }} disabled={isFetching}>
          <RefreshCw className={cx(isFetching && 'animate-spin')} />
        </IconButton>
      )}
    </div>
  )

  if (geo.isLoading) return <>{header}<TripSkeleton /></>
  if (!from) {
    return (
      <p className="py-2 text-body text-fg-muted">Turn on location, or set a default stop, to plan from where you are.</p>
    )
  }

  return (
    <>
      {header}
      {isLoading ? <TripSkeleton /> : error ? (
        <div className="py-2">
          <p className="text-meta text-danger">Trips unavailable — {(error as Error).message}</p>
          <Button size="sm" className="mt-2" onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : trips.length === 0 ? (
        <p className="py-2 text-body text-fg-muted">No trips to {placeName} right now.</p>
      ) : (
        <div className="divide-y divide-line">
          {trips.map(t => <CompactTrip key={`${t.departure}-${t.arrival}-${t.legs.length}`} trip={t} now={now} onOpen={() => onMore(dest.id)} />)}
        </div>
      )}
    </>
  )
}

function TripSkeleton() {
  return <div className="space-y-2 py-1">{Array.from({ length: TRIP_ROWS }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
}
