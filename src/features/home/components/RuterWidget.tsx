import { useState, useEffect, useRef } from 'react'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { DeparturesTab } from './ruter/DeparturesTab'
import { RoutesTab } from './ruter/RoutesTab'
import { SettingsTab } from './ruter/SettingsTab'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'departures' | 'routes' | 'settings'
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

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const updateWidth = () => setWidth(el.getBoundingClientRect().width)
    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
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
  if (width >= 700) return 'medium'
  return 'compact'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RuterWidget() {
  const [tab, setTab] = useState<Tab>('departures')
  const ws  = useWidgetState('ruter', { collapsed: true, intervalMs: 60_000 })
  const now = useNow()
  const { ref: bodyRef, width } = useElementWidth<HTMLDivElement>()
  const layoutMode = getLayoutMode(width)
  const showWideTransit = layoutMode === 'wide' && tab !== 'settings'

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
      <div ref={bodyRef} className="w-full">
        {tab === 'settings' && (
          <div className="mx-auto w-full max-w-2xl">
            <SettingsTab />
          </div>
        )}

        {showWideTransit && (
          <div className="mx-auto grid w-full max-w-[1180px] grid-cols-[minmax(340px,420px)_minmax(560px,1fr)] gap-4">
            <section className="rounded-xl border border-ink-100 bg-white/60 p-3">
              <DeparturesTab ws={ws} now={now} />
            </section>
            <section className="rounded-xl border border-ink-100 bg-white/60 p-3">
              <RoutesTab ws={ws} now={now} />
            </section>
          </div>
        )}

        {!showWideTransit && tab !== 'settings' && (
          <div className={layoutMode === 'medium' ? 'mx-auto w-full max-w-[760px]' : 'w-full'}>
            {tab === 'departures' && <DeparturesTab ws={ws} now={now} />}
            {tab === 'routes'     && <RoutesTab ws={ws} now={now} />}
          </div>
        )}
      </div>
    </WidgetShell>
  )
}
