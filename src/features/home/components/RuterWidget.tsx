import { useState, useEffect } from 'react'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { DeparturesTab } from './ruter/DeparturesTab'
import { RoutesTab } from './ruter/RoutesTab'
import { SettingsTab } from './ruter/SettingsTab'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'departures' | 'routes' | 'settings'

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Ticks every 30s so departure countdowns stay accurate without refetching
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RuterWidget() {
  const [tab, setTab] = useState<Tab>('departures')
  const ws  = useWidgetState('ruter', { collapsed: true, intervalMs: 60_000 })
  const now = useNow()

  const tabBar = (
    <div className="flex gap-1">
      {(['departures', 'routes', 'settings'] as Tab[]).map(t => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={`text-[10px] px-2 py-0.5 rounded font-medium capitalize transition-colors duration-150 min-h-[28px] ${
            tab === t ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
          }`}
        >
          {t === 'settings' ? '⚙' : t}
        </button>
      ))}
    </div>
  )

  return (
    <WidgetShell title="Transit" ws={ws} headerRight={tabBar}>
      {tab === 'departures' && <DeparturesTab ws={ws} now={now} />}
      {tab === 'routes'     && <RoutesTab ws={ws} now={now} />}
      {tab === 'settings'   && <SettingsTab />}
    </WidgetShell>
  )
}
