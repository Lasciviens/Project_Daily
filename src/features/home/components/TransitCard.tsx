import { useMemo, useState } from 'react'
import { Bus, MapPin, Navigation } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton, Truncate } from '../../../shared/ui'
import { useTransitStops } from '../hooks/useTransitStops'
import { useDepartures, useNearbyStops } from '../hooks/useTransitQueries'
import { useWidgetState } from '../hooks/useWidgetState'
import { useNow } from '../hooks/useNow'
import { WidgetShell } from './WidgetShell'
import { TransitPanel } from './TransitPanel'
import { DepartureRow } from './ruter/DeparturesTab'
import { PlaceButtons } from './ruter/PlaceButtons'
import { buildLineGroups } from './ruter/transitUtils'

const MINI_ROWS = 3

/**
 * Home's transit glance: the next departures from the stop nearest to you
 * (your saved default stop when the location is off, or when the nearest
 * stop IS that saved stop — then its saved direction applies), one-tap trips
 * to Home and Work, and the full planner one tap away.
 */
export function TransitCard() {
  const ws = useWidgetState('ruter', { collapsed: false })
  const [open, setOpen] = useState(false)
  // A saved stop to plan to as the planner opens (To home / To work).
  const [planTo, setPlanTo] = useState<string | null>(null)
  const { stops, isLoading: stopsLoading } = useTransitStops()
  const saved = stops.find(s => s.is_default) ?? stops[0] ?? null
  const nearby = useNearbyStops({ enabled: !ws.collapsed })
  const nearest = nearby.data?.[0] ?? null
  // The nearest real stop wins over the saved default, unless they are the same stop.
  const near = nearest && nearest.id !== saved?.stop_id ? nearest : null
  const useNearest = !!near
  const stopId = near ? near.id : saved?.stop_id
  const isAddress = !useNearest && !!saved && !saved.stop_id.startsWith('NSR:')
  // Paused while the planner sheet is open — the sheet runs its own board.
  const { data, isLoading, error } = useDepartures(stopId, { enabled: !ws.collapsed && !open && !isAddress })

  const now = useNow(!ws.collapsed && !open)

  const groups = useMemo(() => {
    const all = data?.departures ?? []
    const scoped = !useNearest && saved?.quay_id ? all.filter(d => d.quayId === saved.quay_id) : all
    return buildLineGroups(scoped.length ? scoped : all).slice(0, MINI_ROWS)
  }, [data, saved, useNearest])

  const label = near
    ? `${near.name} · ${near.distance} m away`
    : saved ? `${saved.label ?? saved.stop_name}${saved.quay_description ? ` · ${saved.quay_description}` : ''}` : null
  const openPlanner = (stopIdToPlan: string | null) => { setPlanTo(stopIdToPlan); setOpen(true) }

  return (
    <>
      <WidgetShell title="Transit" icon={<Bus />} ws={ws}>
        {stops.length > 0 && (
          <div className="mb-3">
            <PlaceButtons stops={stops} onPick={s => openPlanner(s.id)} />
          </div>
        )}
        {stopsLoading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !label ? (
          <p className="mb-3 text-body text-fg-muted">Allow your location, or save a stop, to see departures here.</p>
        ) : (
          <>
            <p className="mb-1 flex min-w-0 items-center gap-1 text-meta text-fg-muted">
              {useNearest ? <Navigation aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />}
              <Truncate>{useNearest ? `Nearest stop: ${label}` : label}</Truncate>
            </p>
            {isAddress ? (
              <p className="py-2 text-body text-fg-muted">This favourite is an address, so it has no departures board.</p>
            ) : isLoading ? (
              <div className="space-y-2 py-1">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : error ? (
              <p className="py-2 text-meta text-danger">Departures unavailable — {(error as Error).message}</p>
            ) : groups.length === 0 ? (
              <p className="py-2 text-body text-fg-muted">No departures right now.</p>
            ) : (
              <div className="divide-y divide-line">
                {groups.map(g => <DepartureRow key={`${g.line}-${g.destination}`} group={g} now={now} />)}
              </div>
            )}
          </>
        )}
        <div className="mt-3 border-t border-line pt-3">
          <Button size="sm" onClick={() => openPlanner(null)} block>{stops.length ? 'Plan a trip' : 'Add a stop'}</Button>
        </div>
      </WidgetShell>

      <ModalShell open={open} onClose={() => setOpen(false)} title="Transit" size="xl" mobile="fullscreen">
        <TransitPanel key={planTo ?? 'plan'} active={open} initialTab={stops.length ? 'routes' : 'settings'} planToStopId={planTo} />
      </ModalShell>
    </>
  )
}
