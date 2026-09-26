import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import type { StopResult, TransitPlace } from '../../api/ruterApi'
import { useTrips } from '../../hooks/useTransitQueries'
import { Button, IconButton, Skeleton, cx } from '../../../../shared/ui'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'
import { fmtLastUpdated } from './transitUtils'

interface ViaTabProps {
  active: boolean
  now: number
}

function toTransitPlace(s: StopResult): TransitPlace | null {
  if (s.id.startsWith('NSR:')) return { kind: 'stop', id: s.id, name: s.name }
  if (s.lat !== undefined && s.lon !== undefined) return { kind: 'coords', lat: s.lat, lon: s.lon, name: s.name }
  return null
}

// Plainer than RoutesTab's PlaceDisplay: no quay-direction hints, this tab is about the waypoint chain.
function PlacePill({ place, dotColor, onClear }: { place: TransitPlace; dotColor: string; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 bg-surface-2 border border-line rounded-row min-h-[44px]">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
      <p className="flex-1 min-w-0 text-body font-medium text-fg truncate">{place.name}</p>
      <IconButton label={`Clear ${place.name}`} onClick={onClear}><X /></IconButton>
    </div>
  )
}

export function ViaTab({ active, now }: ViaTabProps) {
  const [from, setFrom]     = useState<TransitPlace | null>(null)
  const [via, setVia]       = useState<TransitPlace | null>(null)
  const [to, setTo]         = useState<TransitPlace | null>(null)
  const [version, setVersion] = useState(0)

  const canPlan = !!(from && via && to)
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useTrips(
    canPlan && version > 0 ? { from: from!, via, to: to!, version } : null,
    { enabled: active },
  )

  return (
    <div className="space-y-4">
      <p className="text-meta text-fg-muted">
        Plan a trip that passes through a stop on the way — e.g. dropping a kid off before continuing to work.
      </p>

      {/* FROM / VIA / TO — one card, ordered top to bottom */}
      <div className="rounded-row border border-line bg-surface overflow-hidden divide-y divide-line">
        <div className="px-3 pt-3 pb-3">
          {from ? (
            <PlacePill place={from} dotColor="bg-danger" onClear={() => setFrom(null)} />
          ) : (
            <StopSearchInput placeholder="From…" onSelect={s => { const p = toTransitPlace(s); if (p) setFrom(p) }} />
          )}
        </div>
        <div className="px-3 pt-3 pb-3">
          {via ? (
            <PlacePill place={via} dotColor="bg-warn" onClear={() => setVia(null)} />
          ) : (
            <StopSearchInput placeholder="Via — pass through this stop…" onSelect={s => { const p = toTransitPlace(s); if (p) setVia(p) }} />
          )}
        </div>
        <div className="px-3 pt-3 pb-3">
          {to ? (
            <PlacePill place={to} dotColor="bg-success" onClear={() => setTo(null)} />
          ) : (
            <StopSearchInput placeholder="To…" onSelect={s => { const p = toTransitPlace(s); if (p) setTo(p) }} />
          )}
        </div>
      </div>

      {canPlan && (
        <Button variant="primary" block onClick={() => setVersion(v => v + 1)}>Plan route</Button>
      )}

      {isLoading && <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-20 w-full" rounded="rounded-row" />)}</div>}

      {error && (
        <div className="flex flex-wrap items-center gap-2 py-1 text-meta text-danger">
          <span>{(error as Error).message?.includes('Rate') ? 'Rate limited — wait a moment and retry.' : (error as Error).message}</span>
          <button type="button" onClick={() => refetch()} className="min-h-[44px] font-semibold text-accent-600">Retry</button>
        </div>
      )}

      {data && version > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro tabular-nums text-fg-muted">{dataUpdatedAt ? `Updated ${fmtLastUpdated(dataUpdatedAt)}` : ''}</span>
            <IconButton label="Refresh routes" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cx(isFetching && 'animate-spin motion-reduce:animate-none')} />
            </IconButton>
          </div>

          {data.length === 0
            ? <p className="text-body text-fg-muted">No trips found via that stop</p>
            : data.map((trip, i) => <TripCard key={i} trip={trip} now={now} isBest={i === 0} />)
          }
        </div>
      )}
    </div>
  )
}
