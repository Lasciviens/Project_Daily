import { useState } from 'react'
import { MapPin, Settings } from 'lucide-react'
import { useAskLocation, useGeolocation } from '../hooks/useGeolocation'
import { useNow } from '../hooks/useNow'
import { DeparturesTab } from './ruter/DeparturesTab'
import { RoutesTab } from './ruter/RoutesTab'
import { SettingsTab } from './ruter/SettingsTab'
import { fmtMinsAgo } from './ruter/transitUtils'

type Tab = 'routes' | 'departures' | 'settings'

const TABS: { id: Exclude<Tab, 'settings'>; label: string }[] = [
  { id: 'routes', label: 'Routes' },
  { id: 'departures', label: 'Departures' },
]

/**
 * The full transit tool: the trip planner (with an optional via stop), live
 * departures and saved stops/routes. Opened from Home's transit card in a
 * sheet; `active` is false while that sheet is closed so nothing fetches or
 * ticks in the background.
 */
export function TransitPanel({ active, initialTab = 'routes', planToStopId = null }: { active: boolean; initialTab?: Tab; planToStopId?: string | null }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const now = useNow(active)
  // A favourite route picked in Settings jumps to Routes with it applied once.
  const [pendingRouteId, setPendingRouteId] = useState<string | null>(null)
  // A saved stop to plan to on open (Home's To home / To work), applied once.
  const [pendingStopId, setPendingStopId] = useState<string | null>(planToStopId)

  return (
    <div className="min-w-0">
      <div className="mb-4 flex max-w-2xl flex-wrap items-center gap-x-2 gap-y-1">
        <div role="tablist" aria-label="Transit views" className="flex items-center gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className="pill-tab"
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'settings'}
            aria-label="Transit settings"
            onClick={() => setTab('settings')}
            className="pill-tab px-3"
          >
            <Settings aria-hidden className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
        {tab === 'routes' && <LocationAge now={now} />}
      </div>

      <div className="max-w-2xl">
        {tab === 'routes' && (
          <RoutesTab active={active} now={now}
            pendingRouteId={pendingRouteId} onRouteConsumed={() => setPendingRouteId(null)}
            pendingStopId={pendingStopId} onStopConsumed={() => setPendingStopId(null)} />
        )}
        {tab === 'departures' && <DeparturesTab active={active} now={now} />}
        {tab === 'settings' && (
          <SettingsTab active={active} onSelectRoute={id => { setPendingRouteId(id); setTab('routes') }} />
        )}
      </div>
    </div>
  )
}

/**
 * How old the shared location fix is, with a refresh. Routes plans "from
 * here" with it (RoutesTab follows a refresh), so it sits beside the tabs.
 */
function LocationAge({ now }: { now: number }) {
  const { data: geo, dataUpdatedAt, refetch, isFetching } = useGeolocation()
  const askLocation = useAskLocation()
  // The phone is never asked on opening the app: a tap asks it (and its prompt, once).
  if (geo && geo.source !== 'gps') {
    return (
      <button type="button" onClick={() => void askLocation()} disabled={isFetching}
        className="ml-auto inline-flex min-h-[44px] items-center gap-1 px-2 text-micro font-semibold text-accent-600 disabled:opacity-50">
        <MapPin aria-hidden className="h-3 w-3" />{isFetching ? 'Locating…' : 'Use my location'}
      </button>
    )
  }
  if (geo?.source !== 'gps') return null
  return (
    <p className="ml-auto flex items-center gap-1.5 text-micro text-fg-muted" title={`Location from ${fmtMinsAgo(dataUpdatedAt, now)}`}>
      <MapPin aria-hidden className="h-3 w-3" /><span className="hidden sm:inline">Location from</span> {fmtMinsAgo(dataUpdatedAt, now)}
      <button
        type="button"
        onClick={() => void refetch()}
        disabled={isFetching}
        className="min-h-[44px] min-w-[44px] px-2 font-semibold text-accent-600 disabled:opacity-50"
      >
        {isFetching ? 'Updating…' : 'Update'}
      </button>
    </p>
  )
}
