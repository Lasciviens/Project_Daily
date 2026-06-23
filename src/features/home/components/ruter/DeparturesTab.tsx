import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDepartures, TRANSPORT_ICON, TRANSPORT_COLOR, type Departure, type StopResult } from '../../api/ruterApi'
import { useTransitStops } from '../../hooks/useTransitStops'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { minsUntil, fmtTime, fmtLastUpdated } from './transitUtils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeparturesTabProps {
  ws:  WidgetStateResult
  now: number
}

// ─── DepartureRow ─────────────────────────────────────────────────────────────

function DepartureRow({ dep, now }: { dep: Departure; now: number }) {
  const mins       = minsUntil(dep.expected, now)
  const isNow      = mins <= 0
  const delayed    = Math.abs(new Date(dep.expected).getTime() - new Date(dep.aimed).getTime()) > 60_000
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
        <span className={`text-sm font-medium ${
          isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : delayed ? 'text-orange-500' : 'text-ink-700'
        }`}>
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
  const { stops, addStop } = useTransitStops()

  const defaultStop = stops.find(s => s.is_default) ?? stops[0] ?? null
  const [activeId, setActiveId]         = useState<string | null>(null)
  const [adHocStop, setAdHocStop]       = useState<StopResult | null>(null)
  const [saveMsg, setSaveMsg]           = useState<string | null>(null)
  const [lastUpdated, setLastUpdated]   = useState<number | null>(null)

  const activeSaved = activeId ? stops.find(s => s.id === activeId) ?? defaultStop : defaultStop
  const queryStop   = adHocStop ?? (activeSaved ? { id: activeSaved.stop_id, name: activeSaved.stop_name } : null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['departures', queryStop?.id ?? ''],
    queryFn: async () => {
      const result = await fetchDepartures(queryStop!.id)
      setLastUpdated(Date.now())
      return result
    },
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed && !!queryStop?.id,
  })

  // Group departures by quay for side-by-side column layout
  const quayGroups = useMemo(() => {
    if (!data?.departures) return []
    const map = new Map<string, { label: string; deps: Departure[] }>()
    for (const dep of data.departures) {
      const key   = dep.quayDescription ?? dep.quayCode ?? '__default__'
      const label = dep.quayDescription ?? (dep.quayCode ? `Plattform ${dep.quayCode}` : '')
      if (!map.has(key)) map.set(key, { label, deps: [] })
      map.get(key)!.deps.push(dep)
    }
    return Array.from(map.values())
  }, [data])

  function handleSearchSelect(stop: StopResult) {
    setAdHocStop(stop)
    setActiveId(null)
    setSaveMsg(null)
  }

  function handleSavedStopClick(id: string) {
    setActiveId(id)
    setAdHocStop(null)
    setSaveMsg(null)
  }

  async function handleSaveFavorite() {
    if (!adHocStop) return
    try {
      await addStop(adHocStop)
      setSaveMsg('Saved ✓')
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      setSaveMsg(`Failed: ${(e as Error).message}`)
    }
  }

  const alreadySaved = adHocStop ? stops.some(s => s.stop_id === adHocStop.id) : false

  return (
    <div>
      {/* ── Saved stops ── */}
      {stops.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">
            Saved stops
          </p>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {stops.map(s => (
              <button
                key={s.id}
                onClick={() => handleSavedStopClick(s.id)}
                className={`whitespace-nowrap text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                  !adHocStop && activeSaved?.id === s.id
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'text-ink-600 border-ink-200 hover:border-accent-300'
                }`}
              >
                {s.label ?? s.stop_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Search stop — always visible ── */}
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Search stop</p>
        <StopSearchInput placeholder="Search any stop…" onSelect={handleSearchSelect} />
      </div>

      {/* ── Active stop header + refresh ── */}
      {queryStop && (
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-[11px] text-ink-500 font-medium truncate">
              📍 {data?.stopName ?? queryStop.name}
            </span>
            {adHocStop && !alreadySaved && (
              <button
                onClick={handleSaveFavorite}
                className="text-[10px] text-accent-500 hover:text-accent-700 transition-colors duration-150 flex-shrink-0 min-h-[44px] flex items-center px-1"
              >
                + Save
              </button>
            )}
            {saveMsg && (
              <span className={`text-[10px] flex-shrink-0 ${saveMsg.startsWith('Failed') ? 'text-red-500' : 'text-green-600'}`}>
                {saveMsg}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {lastUpdated && (
              <span className="text-[10px] text-ink-400">{fmtLastUpdated(lastUpdated)}</span>
            )}
            <button
              onClick={() => { refetch(); ws.markSynced() }}
              className="text-[10px] text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-end"
            >
              ↻
            </button>
          </div>
        </div>
      )}

      {/* ── Empty / loading / error ── */}
      {!queryStop && (
        <div className="text-sm text-ink-400 py-2">Search a stop or choose a saved stop.</div>
      )}
      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error && (
        <div className="text-red-500 text-xs py-1">
          {(error as Error).message?.includes('Rate')
            ? '⏳ Rate limited — wait a moment'
            : `⚠ ${(error as Error).message}`
          }
        </div>
      )}

      {/* ── Departures grouped by quay ── */}
      {data && quayGroups.length > 0 && (
        <div className={quayGroups.length >= 2 ? 'grid grid-cols-2 gap-x-3' : ''}>
          {quayGroups.map((group, i) => (
            <div key={i}>
              {group.label && (
                <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1 truncate border-b border-ink-100 pb-1">
                  {group.label}
                </p>
              )}
              <div className="divide-y divide-ink-50">
                {group.deps.map((dep, j) => (
                  <DepartureRow key={j} dep={dep} now={now} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {data && quayGroups.length === 0 && (
        <div className="text-ink-400 text-sm py-2">No departures found</div>
      )}
    </div>
  )
}
