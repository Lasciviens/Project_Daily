import { useMemo, useState } from 'react'
import { Bus, MapPin } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton } from '../../../shared/ui'
import { useTransitStops } from '../hooks/useTransitStops'
import { useDepartures } from '../hooks/useTransitQueries'
import { useWidgetState } from '../hooks/useWidgetState'
import { useNow } from '../hooks/useNow'
import { WidgetShell } from './WidgetShell'
import { TransitPanel } from './TransitPanel'
import { DepartureRow } from './ruter/DeparturesTab'
import { buildLineGroups } from './ruter/transitUtils'

const MINI_ROWS = 3

/**
 * Home's transit glance: the next departures from the default saved stop
 * (scoped to its saved direction), with the full planner one tap away.
 */
export function TransitCard() {
  const ws = useWidgetState('ruter', { collapsed: false })
  const [open, setOpen] = useState(false)
  const { stops, isLoading: stopsLoading } = useTransitStops()
  const stop = stops.find(s => s.is_default) ?? stops[0] ?? null
  const isAddress = !!stop && !stop.stop_id.startsWith('NSR:')
  // Paused while the planner sheet is open — the sheet runs its own board.
  const { data, isLoading, error } = useDepartures(stop?.stop_id, { enabled: !ws.collapsed && !open && !isAddress })

  const now = useNow(!ws.collapsed && !open)

  const groups = useMemo(() => {
    const all = data?.departures ?? []
    const scoped = stop?.quay_id ? all.filter(d => d.quayId === stop.quay_id) : all
    return buildLineGroups(scoped.length ? scoped : all).slice(0, MINI_ROWS)
  }, [data, stop])

  return (
    <>
      <WidgetShell title="Transit" icon={<Bus />} ws={ws}>
        {stopsLoading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !stop ? (
          <p className="mb-3 text-body text-fg-muted">Save a stop to see its next departures here.</p>
        ) : (
          <>
            <p className="mb-1 flex min-w-0 items-center gap-1 text-meta text-fg-muted">
              <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{stop.label ?? stop.stop_name}{stop.quay_description ? ` · ${stop.quay_description}` : ''}</span>
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
          <Button size="sm" onClick={() => setOpen(true)} block>{stop ? 'Plan a trip' : 'Add a stop'}</Button>
        </div>
      </WidgetShell>

      <ModalShell open={open} onClose={() => setOpen(false)} title="Transit" size="xl" mobile="fullscreen">
        <TransitPanel active={open} initialTab={stop ? 'departures' : 'settings'} />
      </ModalShell>
    </>
  )
}
