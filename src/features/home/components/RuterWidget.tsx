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

// ─── Panel wrapper ────────────────────────────────────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white/60 p-3 min-w-0 overflow-hidden">
      {children}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RuterWidget() {
  const [tab, setTab] = useState<Tab>('departures')
  const ws  = useWidgetState('ruter', { collapsed: true, intervalMs: 60_000 })
  const now = useNow()

  const isSettings = tab === 'settings'

  const tabBar = (
    <div className="flex gap-1">
      {/* Narrow: three separate tabs */}
      <button
        onClick={() => setTab('departures')}
        className={`xl:hidden text-[10px] px-2 py-0.5 rounded font-medium capitalize transition-colors duration-150 min-h-[28px] ${
          tab === 'departures' ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        departures
      </button>
      <button
        onClick={() => setTab('routes')}
        className={`xl:hidden text-[10px] px-2 py-0.5 rounded font-medium capitalize transition-colors duration-150 min-h-[28px] ${
          tab === 'routes' ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        routes
      </button>

      {/* Wide: single "Transit" button representing the split dashboard */}
      <button
        onClick={() => setTab('departures')}
        className={`hidden xl:block text-[10px] px-2 py-0.5 rounded font-medium transition-colors duration-150 min-h-[28px] ${
          !isSettings ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        Transit
      </button>

      {/* Settings — always visible */}
      <button
        onClick={() => setTab('settings')}
        className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors duration-150 min-h-[28px] ${
          isSettings ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        ⚙
      </button>
    </div>
  )

  return (
    <WidgetShell title="Transit" ws={ws} headerRight={tabBar}>

      {/* ── Settings: full-width centered, all screen sizes ── */}
      {isSettings && (
        <div className="max-w-2xl mx-auto">
          <SettingsTab />
        </div>
      )}

      {!isSettings && (
        <>
          {/* ── Wide: side-by-side panels ── */}
          <div className="hidden xl:block">
            <div className="mx-auto w-full max-w-[1180px]">
              <div className="grid grid-cols-[minmax(340px,420px)_minmax(520px,1fr)] gap-4">
                <Panel>
                  <DeparturesTab ws={ws} now={now} />
                </Panel>
                <Panel>
                  <RoutesTab ws={ws} now={now} />
                </Panel>
              </div>
            </div>
          </div>

          {/* ── Narrow: tab-driven ── */}
          <div className="xl:hidden">
            {tab === 'departures' && <DeparturesTab ws={ws} now={now} />}
            {tab === 'routes'     && <RoutesTab ws={ws} now={now} />}
          </div>
        </>
      )}

    </WidgetShell>
  )
}
