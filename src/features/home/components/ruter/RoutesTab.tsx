import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTrips } from '../../api/ruterApi'
import { useTransitRoutes } from '../../hooks/useTransitRoutes'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { TripCard } from './TripCard'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutesTabProps {
  ws:  WidgetStateResult
  now: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RoutesTab({ ws, now }: RoutesTabProps) {
  const { routes, isLoading: routesLoading } = useTransitRoutes()
  const [activeRouteId, setActiveRouteId]   = useState<string | null>(null)

  const activeRoute = activeRouteId
    ? routes.find(r => r.id === activeRouteId)
    : routes[0] ?? null

  const { data, isLoading, error } = useQuery({
    queryKey:        ['trip', activeRoute?.from_stop_id, activeRoute?.to_stop_id],
    queryFn:         () => fetchTrips(activeRoute!.from_stop_id, activeRoute!.to_stop_id),
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed && !!activeRoute,
  })

  if (routesLoading) {
    return <div className="text-ink-400 text-sm">Loading routes…</div>
  }

  if (routes.length === 0) {
    return (
      <div className="text-ink-400 text-sm py-2 text-center">
        Add a route in <span className="font-medium text-ink-600">⚙ Settings</span> to see trips
      </div>
    )
  }

  return (
    <div>
      {/* Route selector pills */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {routes.map(r => (
          <button
            key={r.id}
            onClick={() => setActiveRouteId(r.id)}
            className={`text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
              activeRoute?.id === r.id
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-600 border-ink-200 hover:border-accent-300'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {activeRoute && (
        <p className="text-[11px] text-ink-400 mb-3">
          {activeRoute.from_stop_name} → {activeRoute.to_stop_name}
        </p>
      )}

      {isLoading && <div className="text-ink-400 text-sm">Loading trips…</div>}
      {error && (
        <div className="text-ink-400 text-xs">
          {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : '⚠ Unavailable'}
        </div>
      )}
      {data && (
        <div className="space-y-3">
          {data.length === 0 && <div className="text-ink-400 text-sm">No trips found</div>}
          {data.map((trip, i) => (
            <TripCard key={i} trip={trip} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
