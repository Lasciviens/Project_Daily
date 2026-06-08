import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDepartures, TRANSPORT_ICON, TRANSPORT_COLOR, type Departure } from '../../api/ruterApi'
import { useTransitStops } from '../../hooks/useTransitStops'
import type { WidgetStateResult } from '../../hooks/useWidgetState'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeparturesTabProps {
  ws:  WidgetStateResult
  now: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minsUntil(iso: string, now: number): number {
  return Math.round((new Date(iso).getTime() - now) / 60_000)
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ─── Sub-component ────────────────────────────────────────────────────────────

function DepartureRow({ dep, now }: { dep: Departure; now: number }) {
  const mins    = minsUntil(dep.expected, now)
  const isNow   = mins <= 0
  const delayed = Math.abs(new Date(dep.expected).getTime() - new Date(dep.aimed).getTime()) > 60_000
  const colorClass = TRANSPORT_COLOR[dep.transport] ?? 'bg-ink-100 text-ink-700'

  return (
    <div className="flex items-start gap-2 py-1.5 min-h-[44px]">
      <span className="text-base w-5 text-center flex-shrink-0 mt-0.5">
        {TRANSPORT_ICON[dep.transport] ?? '🚐'}
      </span>
      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md flex-shrink-0 self-start mt-0.5 ${colorClass}`}>
        {dep.line}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-700 truncate">{dep.destination}</div>
        {(dep.quayCode || dep.quayDescription) && (
          <div className="text-[10px] text-ink-400 mt-0.5">
            {dep.quayCode && `Platform ${dep.quayCode}`}
            {dep.quayCode && dep.quayDescription && ' · '}
            {dep.quayDescription}
          </div>
        )}
      </div>
      <div className="text-right flex-shrink-0 flex items-center gap-1.5">
        {delayed && (
          <span className="text-[10px] text-ink-300 line-through">{fmtTime(dep.aimed)}</span>
        )}
        <span className={`text-sm font-medium ${isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : delayed ? 'text-orange-500' : 'text-ink-700'}`}>
          {isNow ? 'Now' : `${mins} min`}
        </span>
        {dep.realtime
          ? <span className="w-2 h-2 rounded-full bg-green-500 inline-block flex-shrink-0" title="Realtime" />
          : <span className="text-[10px] text-ink-300 flex-shrink-0" title="Scheduled">~</span>
        }
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeparturesTab({ ws, now }: DeparturesTabProps) {
  const { stops, isLoading: stopsLoading } = useTransitStops()
  const defaultStop = stops.find(s => s.is_default) ?? stops[0]
  const [activeId, setActiveId] = useState<string | null>(null)

  const activeStopRow = activeId ? stops.find(s => s.id === activeId) : defaultStop
  const queryStopId   = activeStopRow?.stop_id ?? ''

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:        ['departures', queryStopId],
    queryFn:         () => fetchDepartures(queryStopId),
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed && queryStopId.length > 0,
  })

  if (stopsLoading) {
    return <div className="text-ink-400 text-sm">Loading stops…</div>
  }

  if (stops.length === 0) {
    return (
      <div className="text-ink-400 text-sm py-2 text-center">
        Add a stop in <span className="font-medium text-ink-600">⚙ Settings</span> to see departures
      </div>
    )
  }

  return (
    <div>
      {/* Stop selector */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {stops.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={`text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
              activeStopRow?.id === s.id
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-600 border-ink-200 hover:border-accent-300'
            }`}
          >
            {s.label ?? s.stop_name}
          </button>
        ))}
      </div>

      {/* Stop name + refresh */}
      <div className="flex items-center justify-between mb-2">
        {data && (
          <span className="text-[11px] text-ink-500 font-medium">📍 {data.stopName}</span>
        )}
        <button
          onClick={() => { refetch(); ws.markSynced() }}
          className="text-[10px] text-ink-400 hover:text-accent-600 transition-colors duration-150 ml-auto min-h-[44px] min-w-[44px] flex items-center justify-end"
        >
          ↻ Refresh
        </button>
      </div>

      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error && (
        <div className="text-ink-400 text-xs">
          {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : '⚠ Unavailable'}
        </div>
      )}
      {data && (
        <div className="divide-y divide-ink-50">
          {data.departures.length === 0 && (
            <div className="text-ink-400 text-sm py-2">No departures found</div>
          )}
          {data.departures.map((dep, i) => (
            <DepartureRow key={i} dep={dep} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
