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
 * Home's transit glance: the next departures from where you are — a saved stop
 * near you (with its saved direction), else the nearest stop, else your saved
 * default when the location is off — one-tap trips to Home and Work, and the
 * full planner one tap away.
 */
export function TransitCard() {
  const ws = useWidgetState('ruter', { collapsed: false })
  const [open, setOpen] = useState(false)
  // A saved stop to plan to as the planner opens (To home / To work).
  const [planTo, setPlanTo] = useState<string | null>(null)
  const { stops, isLoading: stopsLoading } = useTransitStops()
  const saved = stops.find(s => s.is_default) ?? stops[0] ?? null
  const nearby = useNearbyStops({ enabled: !ws.collapsed })
  // Around you (EnTur's ≤ 6 stops within 1 km, nearest first): a SAVED stop
  // among them wins, with its saved direction; otherwise the nearest stop;
  // without a location, the saved default.
  const savedNearby = nearby.data?.map(n => stops.find(s => s.stop_id === n.id)).find(Boolean) ?? null
  const shown = savedNearby ?? saved
  const near = !savedNearby && nearby.data?.[0] ? nearby.data[0] : null
  const useNearest = !!near
  const stopId = near ? near.id : shown?.stop_id
  const isAddress = !useNearest && !!shown && !shown.stop_id.startsWith('NSR:')
  // Paused while the planner sheet is open — the sheet runs its own board.
  const { data, isLoading, error } = useDepartures(stopId, { enabled: !ws.collapsed && !open && !isAddress })

  const now = useNow(!ws.collapsed && !open)

  const groups = useMemo(() => {
    const all = data?.departures ?? []
    const scoped = !useNearest && shown?.quay_id ? all.filter(d => d.quayId === shown.quay_id) : all
    return buildLineGroups(scoped.length ? scoped : all).slice(0, MINI_ROWS)
  }, [data, shown, useNearest])

  const label = near
    ? `${near.name} · ${near.distance} m away`
    : shown ? `${shown.label ?? shown.stop_name}${shown.quay_description ? ` · ${shown.quay_description}` : ''}` : null
  const openPlanner = (stopIdToPlan: string | null) => { setPlanTo(stopIdToPlan); setOpen(true) }

  return (
    <>
      <WidgetShell title="Transit" icon={<Bus />} ws={ws}>
        {stops.length > 0 && (
          <div className="mb-3 empty:hidden">
            <PlaceButtons stops={stops} hideMissing onPick={s => openPlanner(s.id)} />
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
