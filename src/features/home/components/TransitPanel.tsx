import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { useNow } from '../hooks/useNow'
import { DeparturesTab } from './ruter/DeparturesTab'
import { RoutesTab } from './ruter/RoutesTab'
import { ViaTab } from './ruter/ViaTab'
import { SettingsTab } from './ruter/SettingsTab'

type Tab = 'departures' | 'routes' | 'via' | 'settings'
type LayoutMode = 'compact' | 'wide'

// A callback ref, not useRef + a mount-only effect: the measured node mounts
// later than this hook (inside a sheet that opens on demand), and the old
// effect never saw it — the planner was stuck in its compact layout.
function useElementWidth() {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.current.observe(el)
  }, [])
  return { ref, width }
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="min-w-0 overflow-hidden rounded-row border border-line p-3">{children}</div>
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'departures', label: 'Departures' },
  { id: 'routes', label: 'Routes' },
  { id: 'via', label: 'Via' },
]

/**
 * The full transit tool: live departures, trip planner, via-trips and saved
 * stops/routes. Opened from Home's transit card in a sheet; `active` is false
 * while that sheet is closed so nothing fetches or ticks in the background.
 */
export function TransitPanel({ active, initialTab = 'departures' }: { active: boolean; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const now = useNow(active)
  // A favourite route picked in Settings jumps to Routes with it applied once.
  const [pendingRouteId, setPendingRouteId] = useState<string | null>(null)

  const { ref: bodyRef, width } = useElementWidth()
  const layout: LayoutMode = width >= 760 ? 'wide' : 'compact'
  const sideBySide = layout === 'wide' && (tab === 'departures' || tab === 'routes')

  const routes = <RoutesTab active={active} now={now} pendingRouteId={pendingRouteId} onRouteConsumed={() => setPendingRouteId(null)} />

  return (
    <div ref={bodyRef} className="min-w-0">
      <div role="tablist" aria-label="Transit views" className="scroll-x -mx-1 mb-4 flex items-center gap-1 px-1">
        {TABS.map(t => {
          const selected = sideBySide ? t.id !== 'via' && (tab === 'departures' || tab === 'routes') : tab === t.id
          if (sideBySide && t.id === 'routes') return null
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              className="pill-tab"
            >
              {sideBySide && t.id === 'departures' ? 'Departures & routes' : t.label}
            </button>
          )
        })}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'settings'}
          aria-label="Transit settings"
          onClick={() => setTab('settings')}
          className={cx('pill-tab ml-auto px-3')}
        >
          <Settings aria-hidden className="h-4 w-4" />
          <span className="hidden sm:inline">Settings</span>
        </button>
      </div>

      {tab === 'settings' && (
        <div className="max-w-2xl">
          <SettingsTab active={active} onSelectRoute={id => { setPendingRouteId(id); setTab('routes') }} />
        </div>
      )}

      {sideBySide && (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
          <Panel><DeparturesTab active={active} now={now} /></Panel>
          <Panel>{routes}</Panel>
        </div>
      )}

      {!sideBySide && tab !== 'settings' && (
        <div className="max-w-2xl">
          {tab === 'departures' && <DeparturesTab active={active} now={now} />}
          {tab === 'routes' && routes}
          {tab === 'via' && <ViaTab active={active} now={now} />}
        </div>
      )}
    </div>
  )
}
