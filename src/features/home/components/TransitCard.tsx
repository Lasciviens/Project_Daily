import { useMemo, useState } from 'react'
import { Bus, MapPin, Navigation } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, SegmentedControl, Skeleton, Truncate } from '../../../shared/ui'
import { useTransitStops } from '../hooks/useTransitStops'
import { useDepartures, useNearbyStops } from '../hooks/useTransitQueries'
import { useWidgetState } from '../hooks/useWidgetState'
import { useNow } from '../hooks/useNow'
import { WidgetShell } from './WidgetShell'
import { TransitPanel } from './TransitPanel'
import { DepartureRow } from './ruter/DeparturesTab'
import { CardTrips } from './ruter/CardTrips'
import { findPlace } from '../transitPlaces'
import { buildLineGroups } from './ruter/transitUtils'

const MINI_ROWS = 3

type CardView = 'departures' | 'home' | 'work'
const VIEWS: { value: CardView; label: string }[] = [
  { value: 'departures', label: 'Departures' },
  { value: 'home', label: 'To home' },
  { value: 'work', label: 'To work' },
]
// The last view, on this device only (a convenience — it may come back empty).
const VIEW_KEY = 'lasci.transitCard.view'
function readView(): CardView {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'home' || v === 'work' ? v : 'departures'
  } catch { return 'departures' }
}
function writeView(v: CardView) {
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* storage blocked */ }
}

/**
 * Home's transit glance: the next departures from where you are — a saved stop
 * near you (with its saved direction), else the nearest stop, else your saved
 * default when the location is off — or, one tap away in the same card, the
 * next trips To home / To work (Settings → Places). The full planner opens in
 * a popup from "Plan a trip" / "More options" or a tapped trip.
 */
export function TransitCard() {
  const ws = useWidgetState('ruter', { collapsed: false })
  const [open, setOpen] = useState(false)
  const [view, setViewState] = useState<CardView>(readView)
  const setView = (v: CardView) => { setViewState(v); writeView(v) }
  const showDepartures = view === 'departures'
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
  const { data, isLoading, error } = useDepartures(stopId, { enabled: !ws.collapsed && !open && !isAddress && showDepartures })

  const now = useNow(!ws.collapsed && !open)

  const groups = useMemo(() => {
    const all = data?.departures ?? []
    const scoped = !useNearest && shown?.quay_id ? all.filter(d => d.quayId === shown.quay_id) : all
    return buildLineGroups(scoped.length ? scoped : all).slice(0, MINI_ROWS)
  }, [data, shown, useNearest])

  const label = near
    ? `${near.name} · ${near.distance} m away`
    : shown ? `${shown.label ?? shown.stop_name}${shown.quay_description ? ` · ${shown.quay_description}` : ''}` : null
  const tripPlace = showDepartures ? null : findPlace(stops, view)
  const openPlanner = (stopIdToPlan: string | null) => { setPlanTo(stopIdToPlan); setOpen(true) }

  return (
    <>
      <WidgetShell title="Transit" icon={<Bus />} ws={ws}>
        <div className="mb-3">
          <SegmentedControl options={VIEWS} value={view} onChange={setView} fullWidth size="sm" />
        </div>
        {!showDepartures ? (
          stopsLoading
            ? <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
            : <CardTrips kind={view} stops={stops} active={!ws.collapsed && !open} now={now} onMore={openPlanner} />
        ) : stopsLoading ? (
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
          {showDepartures || !tripPlace
            ? <Button size="sm" onClick={() => openPlanner(null)} block>{stops.length ? 'Plan a trip' : 'Add a stop'}</Button>
            : <Button size="sm" onClick={() => openPlanner(tripPlace.id)} block>More options</Button>}
        </div>
      </WidgetShell>

      <ModalShell open={open} onClose={() => setOpen(false)} title="Transit" size="xl" mobile="fullscreen">
        <TransitPanel key={planTo ?? 'plan'} active={open} initialTab={stops.length ? 'routes' : 'settings'} planToStopId={planTo} />
      </ModalShell>
    </>
  )
}
