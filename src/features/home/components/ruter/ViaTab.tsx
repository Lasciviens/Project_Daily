import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchTrips, type StopResult, type TransitPlace } from '../../api/ruterApi'
import { useTravelProfile, WALK_SPEED_MPS } from '../../hooks/useTravelProfile'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'
import { fmtLastUpdated } from './transitUtils'
import { toast } from '../../../../app/store'

interface ViaTabProps {
  ws:  WidgetStateResult
  now: number
}

function toTransitPlace(s: StopResult): TransitPlace | null {
  if (s.id.startsWith('NSR:')) return { kind: 'stop', id: s.id, name: s.name }
  if (s.lat !== undefined && s.lon !== undefined) return { kind: 'coords', lat: s.lat, lon: s.lon, name: s.name }
  return null
}

// Small pill for a picked place — simpler than RoutesTab's PlaceDisplay
// (no quay-direction hints here; this tab is about the waypoint chain, not
// platform detail) per "dikkatli çalış, abartma" — keep it careful but plain.
function PlacePill({ place, dotColor, onClear }: { place: TransitPlace; dotColor: string; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 bg-ink-50 border border-ink-200 rounded-xl min-h-[44px]">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
      <p className="flex-1 min-w-0 text-sm font-medium text-ink-900 truncate">{place.name}</p>
      <button
        onClick={onClear}
        className="text-ink-300 hover:text-red-400 transition-colors duration-150 flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center text-sm"
        aria-label="Clear"
      >✕</button>
    </div>
  )
}

export function ViaTab({ ws, now }: ViaTabProps) {
  const { profile: travelProfile } = useTravelProfile()
  const queryClient = useQueryClient()

  const [from, setFrom]     = useState<TransitPlace | null>(null)
  const [via, setVia]       = useState<TransitPlace | null>(null)
  const [to, setTo]         = useState<TransitPlace | null>(null)
  const [version, setVersion] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const canPlan = !!(from && via && to)

  const fromKey = from?.kind === 'stop' ? from.id : from ? `${from.lat},${from.lon}` : ''
  const viaKey  = via?.kind  === 'stop' ? via.id  : via  ? `${via.lat},${via.lon}`   : ''
  const toKey   = to?.kind   === 'stop' ? to.id   : to   ? `${to.lat},${to.lon}`     : ''

  const tripQueryKey = ['trip-via', fromKey, viaKey, toKey, version, travelProfile]

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: tripQueryKey,
    queryFn:  async () => {
      const result = await fetchTrips(from!, to!, undefined, undefined, false, {
        walkSpeed:            WALK_SPEED_MPS[travelProfile.walkPace],
        maximumTransfers:     travelProfile.maximumTransfers,
        wheelchairAccessible: travelProfile.wheelchairAccessible,
      }, [via!])
      setLastUpdated(Date.now())
      return result
    },
    staleTime: Infinity, refetchInterval: false, enabled: !ws.collapsed && canPlan && version > 0,
  })

  const handleRefresh = useCallback(async () => {
    if (!canPlan || refreshing) return
    setRefreshing(true)
    const tid = toast.loading('Refreshing routes…')
    try {
      await queryClient.invalidateQueries({ queryKey: tripQueryKey })
      await refetch()
      toast.dismiss(tid)
      toast.success('Routes updated ✓')
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to refresh')
    } finally {
      setRefreshing(false)
    }
  }, [canPlan, refreshing, queryClient, tripQueryKey, refetch])

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-500">
        Plan a trip that passes through a stop on the way — e.g. dropping a kid off before continuing to work.
      </p>

      {/* FROM / VIA / TO — one card, ordered top to bottom */}
      <div className="rounded-xl border border-ink-200 bg-cream-50 overflow-hidden divide-y divide-ink-100">
        <div className="px-3 pt-3 pb-3">
          {from ? (
            <PlacePill place={from} dotColor="bg-red-500" onClear={() => setFrom(null)} />
          ) : (
            <StopSearchInput placeholder="From…" onSelect={s => { const p = toTransitPlace(s); if (p) setFrom(p) }} />
          )}
        </div>
        <div className="px-3 pt-3 pb-3">
          {via ? (
            <PlacePill place={via} dotColor="bg-amber-500" onClear={() => setVia(null)} />
          ) : (
            <StopSearchInput placeholder="Via — pass through this stop…" onSelect={s => { const p = toTransitPlace(s); if (p) setVia(p) }} />
          )}
        </div>
        <div className="px-3 pt-3 pb-3">
          {to ? (
            <PlacePill place={to} dotColor="bg-green-500" onClear={() => setTo(null)} />
          ) : (
            <StopSearchInput placeholder="To…" onSelect={s => { const p = toTransitPlace(s); if (p) setTo(p) }} />
          )}
        </div>
      </div>

      {canPlan && (
        <button
          onClick={() => setVersion(v => v + 1)}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-colors duration-150 min-h-[48px] bg-accent-500 text-white hover:bg-accent-600"
        >
          Plan route
        </button>
      )}

      {isLoading && <div className="text-sm text-ink-400 py-2">Loading trips…</div>}

      {error && (
        <div className="text-xs text-red-500 py-1">
          {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : `⚠ ${(error as Error).message}`}
        </div>
      )}

      {data && version > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-ink-400">{lastUpdated ? `Updated ${fmtLastUpdated(lastUpdated)}` : ''}</span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[36px] flex items-center disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>

          {data.length === 0
            ? <p className="text-sm text-ink-400">No trips found via that stop</p>
            : data.map((trip, i) => <TripCard key={i} trip={trip} now={now} isBest={i === 0} />)
          }
        </div>
      )}
    </div>
  )
}
