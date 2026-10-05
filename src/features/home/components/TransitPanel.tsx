import { useState } from 'react'
import { Settings } from 'lucide-react'
import { useNow } from '../hooks/useNow'
import { DeparturesTab } from './ruter/DeparturesTab'
import { RoutesTab } from './ruter/RoutesTab'
import { SettingsTab } from './ruter/SettingsTab'

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
      <div role="tablist" aria-label="Transit views" className="mb-4 flex items-center gap-1">
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
          className="pill-tab ml-auto px-3"
        >
          <Settings aria-hidden className="h-4 w-4" />
          <span className="hidden sm:inline">Settings</span>
        </button>
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
