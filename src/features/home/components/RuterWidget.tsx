import { useState, useEffect, useRef } from 'react'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { DeparturesTab } from './ruter/DeparturesTab'
import { RoutesTab } from './ruter/RoutesTab'
import { SettingsTab } from './ruter/SettingsTab'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab        = 'departures' | 'routes' | 'settings'
type LayoutMode = 'compact' | 'medium' | 'wide'

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

// Measures the actual rendered container width via ResizeObserver.
// More accurate than viewport breakpoints when the widget shares column space.
function useElementWidth<T extends HTMLElement>() {
  const ref   = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => setWidth(el.getBoundingClientRect().width)
    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

function getLayoutMode(width: number): LayoutMode {
  if (width >= 1100) return 'wide'
  if (width >= 700)  return 'medium'
  return 'compact'
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

  const { ref: bodyRef, width } = useElementWidth<HTMLDivElement>()
  const layout       = getLayoutMode(width)
  const isSettings   = tab === 'settings'
  const showSideBySide = layout === 'wide' && !isSettings

  const tabBar = (
    <div className="flex gap-1">
      {/* Narrow/medium: individual Departures + Routes tabs */}
      <button
        onClick={() => setTab('departures')}
        className={`${showSideBySide ? 'hidden' : ''} text-[10px] px-2 py-0.5 rounded font-medium capitalize transition-colors duration-150 min-h-[28px] ${
          tab === 'departures' ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        departures
      </button>
      <button
        onClick={() => setTab('routes')}
        className={`${showSideBySide ? 'hidden' : ''} text-[10px] px-2 py-0.5 rounded font-medium capitalize transition-colors duration-150 min-h-[28px] ${
          tab === 'routes' ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        routes
      </button>

      {/* Wide: single "Transit" button — both panels visible simultaneously */}
      {showSideBySide && (
        <button
          onClick={() => setTab('departures')}
          className="text-[10px] px-2 py-0.5 rounded font-medium transition-colors duration-150 min-h-[28px] bg-accent-500 text-white"
        >
          Transit
        </button>
      )}

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
      <div ref={bodyRef} className="w-full">

        {/* ── Settings ── */}
        {isSettings && (
          <div className="max-w-2xl mx-auto">
            <SettingsTab />
          </div>
        )}

        {/* ── Wide: side-by-side ── */}
        {showSideBySide && (
          <div className="mx-auto w-full max-w-[1180px]">
            <div className="grid grid-cols-[minmax(340px,420px)_minmax(520px,1fr)] gap-4">
              <Panel><DeparturesTab ws={ws} now={now} /></Panel>
              <Panel><RoutesTab ws={ws} now={now} /></Panel>
            </div>
          </div>
        )}

        {/* ── Compact / medium: tabbed ── */}
        {!isSettings && !showSideBySide && (
          <div className={layout === 'medium' ? 'mx-auto w-full max-w-[760px]' : 'w-full'}>
            {tab === 'departures' && <DeparturesTab ws={ws} now={now} />}
            {tab === 'routes'     && <RoutesTab ws={ws} now={now} />}
          </div>
        )}

      </div>
    </WidgetShell>
  )
}
