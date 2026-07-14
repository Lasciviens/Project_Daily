import { useState, useEffect, useRef } from 'react'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { DeparturesTab } from './ruter/DeparturesTab'
import { RoutesTab } from './ruter/RoutesTab'
import { SettingsTab } from './ruter/SettingsTab'

type Tab        = 'departures' | 'routes' | 'settings'
type LayoutMode = 'compact' | 'medium' | 'wide'

function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

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
  if (width >= 860) return 'wide'
  if (width >= 560) return 'medium'
  return 'compact'
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-cream-50/60 p-2 sm:p-3 min-w-0 overflow-hidden">
      {children}
    </div>
  )
}

export function RuterWidget() {
  const [tab, setTab] = useState<Tab>('departures')
  const ws  = useWidgetState('ruter', { collapsed: true, intervalMs: 60_000 })
  const now = useNow()

  const { ref: bodyRef, width } = useElementWidth<HTMLDivElement>()
  const layout         = getLayoutMode(width)
  const isSettings     = tab === 'settings'
  const showSideBySide = layout === 'wide' && !isSettings

  const tabBar = (
    <div className="flex gap-1">
      <button
        onClick={() => setTab('departures')}
        className={`${showSideBySide ? 'hidden' : ''} text-[10px] px-2 rounded font-medium capitalize transition-colors duration-150 min-h-[44px] ${
          tab === 'departures' ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        departures
      </button>
      <button
        onClick={() => setTab('routes')}
        className={`${showSideBySide ? 'hidden' : ''} text-[10px] px-2 rounded font-medium capitalize transition-colors duration-150 min-h-[44px] ${
          tab === 'routes' ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        routes
      </button>

      {showSideBySide && (
        <button
          onClick={() => setTab('departures')}
          className="text-[10px] px-2 rounded font-medium transition-colors duration-150 min-h-[44px] bg-accent-500 text-white"
        >
          Transit
        </button>
      )}

      <button
        onClick={() => setTab('settings')}
        className={`text-[10px] px-2 rounded font-medium transition-colors duration-150 min-h-[44px] ${
          isSettings ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
        aria-label="Transit settings"
      >
        ⚙
      </button>
    </div>
  )

  return (
    <WidgetShell title="Transit" ws={ws} headerRight={tabBar}>
      <div ref={bodyRef} className="w-full overflow-x-hidden">
        {isSettings && (
          <div className="max-w-2xl mx-auto">
            <SettingsTab />
          </div>
        )}

        {showSideBySide && (
          <div className="grid grid-cols-[minmax(260px,2fr)_minmax(320px,3fr)] gap-3">
            <Panel>
              <DeparturesTab ws={ws} now={now} />
            </Panel>
            <Panel>
              <RoutesTab ws={ws} now={now} />
            </Panel>
          </div>
        )}

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
