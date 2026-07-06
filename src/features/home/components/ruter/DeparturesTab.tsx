import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDepartures, fetchStopDirections, type Departure, type StopResult, type QuayDirectionHint } from '../../api/ruterApi'
import { useTransitStops } from '../../hooks/useTransitStops'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { minsUntil, fmtTime, fmtLastUpdated, lineStyle, MODE_FALLBACK_BG } from './transitUtils'
import { toast } from '../../../../app/store'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeparturesTabProps {
  ws:  WidgetStateResult
  now: number
}

interface LineGroup {
  line:            string
  destination:     string
  transport:       string
  lineColour?:     string
  lineTextColour?: string
  realtime:        boolean
  aimed:           string
  expected:        string
  departures:      Departure[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLineGroups(deps: Departure[]): LineGroup[] {
  const map = new Map<string, LineGroup>()
  for (const dep of deps) {
    const key = `${dep.line}::${dep.destination}`
    if (!map.has(key)) {
      map.set(key, {
        line:          dep.line,
        destination:   dep.destination,
        transport:     dep.transport,
        lineColour:    dep.lineColour,
        lineTextColour:dep.lineTextColour,
        realtime:      dep.realtime,
        aimed:         dep.aimed,
        expected:      dep.expected,
        departures:    [dep],
      })
    } else {
      map.get(key)!.departures.push(dep)
    }
  }
  return Array.from(map.values())
}

// ─── DepartureRow ─────────────────────────────────────────────────────────────

function DepartureRow({ group, now }: { group: LineGroup; now: number }) {
  const first    = group.departures[0]
  const mins     = minsUntil(first.expected, now)
  const isNow    = mins <= 0
  const delayed  = Math.abs(new Date(first.expected).getTime() - new Date(first.aimed).getTime()) > 60_000
  const style    = lineStyle(group.lineColour, group.lineTextColour)
  const fallback = { backgroundColor: MODE_FALLBACK_BG[group.transport] ?? '#555', color: '#fff' }
  const nextTimes = group.departures.slice(1, 4).map(d => fmtTime(d.expected))

  return (
    <div className="w-full flex items-center gap-2.5 py-2.5 min-h-[44px]">
      <span
        className="text-xs font-bold px-2 py-1 rounded flex-shrink-0 min-w-[2.25rem] text-center leading-tight"
        style={style ?? fallback}
      >
        {group.line}
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-900 truncate leading-snug">{group.destination}</div>
        {nextTimes.length > 0 && (
          <div className="text-[10px] text-ink-400 truncate leading-tight mt-0.5">
            Next: {nextTimes.join(', ')}
          </div>
        )}
      </div>

      <div className="text-right flex-shrink-0 flex items-center gap-1.5">
        {delayed && (
          <span className="text-[10px] text-ink-300 line-through tabular-nums">{fmtTime(first.aimed)}</span>
        )}
        <span className={`text-sm font-bold tabular-nums ${
          isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : delayed ? 'text-orange-500' : 'text-ink-900'
        }`}>
          {isNow ? 'Now' : `${mins} min`}
        </span>
        {group.realtime
          ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block flex-shrink-0" title="Realtime" />
          : <span className="text-[10px] text-ink-300 flex-shrink-0" title="Scheduled">~</span>
        }
      </div>
    </div>
  )
}

// ─── QuaySavePanel ────────────────────────────────────────────────────────────

interface QuaySavePanelProps {
  stopId:   string
  stopName: string
  onSave:   (quayId: string | null, quayDescription: string | null, label: string) => Promise<void>
  onCancel: () => void
}

function QuaySavePanel({ stopId, stopName, onSave, onCancel }: QuaySavePanelProps) {
  const [quays, setQuays]           = useState<QuayDirectionHint[]>([])
  const [loading, setLoading]       = useState(true)
  const [selectedQuay, setSelected] = useState<QuayDirectionHint | 'all' | null>(null)
  const [label, setLabel]           = useState(stopName)
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchStopDirections(stopId)
      .then(data => { if (!cancelled) { setQuays(data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [stopId])

  async function handleSave() {
    if (!selectedQuay) return
    setSaving(true)
    const quayId   = selectedQuay === 'all' ? null : selectedQuay.quayId
    const quayDesc = selectedQuay === 'all' ? null : (selectedQuay.description ?? selectedQuay.fallback ?? (selectedQuay.publicCode ? `Platform ${selectedQuay.publicCode}` : null))
    await onSave(quayId, quayDesc, label)
    setSaving(false)
  }

  return (
    <div className="mt-2 p-3 rounded-xl border border-ink-200 bg-cream-50 space-y-3">
      <p className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide">Choose direction to save</p>

      {loading && <p className="text-xs text-ink-400">Loading quays…</p>}

      {!loading && (
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => setSelected('all')}
            className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
              selectedQuay === 'all'
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-700 border-ink-200 hover:border-accent-300 bg-white'
            }`}
          >
            All quays
          </button>
          {quays.map(q => {
            const label2 = q.description ?? q.fallback ?? (q.publicCode ? `Platform ${q.publicCode}` : q.quayId)
            const hint   = q.lines.length > 0 ? q.lines.slice(0, 4).join(', ') : null
            return (
              <button
                key={q.quayId}
                onClick={() => setSelected(q)}
                className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                  selectedQuay !== 'all' && (selectedQuay as QuayDirectionHint)?.quayId === q.quayId
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'text-ink-700 border-ink-200 hover:border-accent-300 bg-white'
                }`}
              >
                <span className="font-medium">{label2}</span>
                {hint && <span className="ml-1.5 opacity-70">{hint}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div>
        <label className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide block mb-1">Label</label>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!selectedQuay || saving}
          className="flex-1 text-sm font-medium px-3 py-2 rounded-lg bg-accent-500 text-white min-h-[44px] disabled:opacity-50 hover:bg-accent-600 transition-colors duration-150"
        >
          {saving ? 'Saving…' : 'Save stop'}
        </button>
        <button
          onClick={onCancel}
          className="text-sm px-3 py-2 rounded-lg border border-ink-200 text-ink-600 min-h-[44px] hover:border-ink-400 transition-colors duration-150"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeparturesTab({ ws, now }: DeparturesTabProps) {
  const { stops, addStop } = useTransitStops()
  const queryClient = useQueryClient()

  const defaultStop = stops.find(s => s.is_default) ?? stops[0] ?? null
  const [activeId,      setActiveId]      = useState<string | null>(null)
  const [adHocStop,     setAdHocStop]     = useState<StopResult | null>(null)
  const [showSavePanel, setShowSavePanel] = useState(false)
  const [lastUpdated,   setLastUpdated]   = useState<number | null>(null)
  const [refreshing,    setRefreshing]    = useState(false)
  const [visibleCount,  setVisibleCount]  = useState(4)

  const activeSaved = activeId ? stops.find(s => s.id === activeId) ?? defaultStop : defaultStop
  const queryStop   = adHocStop ?? (activeSaved ? { id: activeSaved.stop_id, name: activeSaved.stop_name } : null)

  // Reset the load-more window whenever the viewed stop changes.
  useEffect(() => { setVisibleCount(4) }, [queryStop?.id])

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

  const quayGroups = useMemo(() => {
    if (!data?.departures) return []
    const rawMap = new Map<string, { code?: string; description?: string; deps: Departure[] }>()
    for (const dep of data.departures) {
      const key = dep.quayDescription ?? dep.quayCode ?? '__default__'
      if (!rawMap.has(key)) {
        rawMap.set(key, { code: dep.quayCode, description: dep.quayDescription, deps: [] })
      }
      rawMap.get(key)!.deps.push(dep)
    }
    return Array.from(rawMap.values()).map(({ code, description, deps }) => ({
      code,
      description,
      lineGroups: buildLineGroups(deps),
    }))
  }, [data])

  const departuresQueryKey = ['departures', queryStop?.id ?? '']

  const handleRefresh = useCallback(async () => {
    if (!queryStop || refreshing) return
    setRefreshing(true)
    const tid = toast.loading('Refreshing departures…')
    try {
      await queryClient.invalidateQueries({ queryKey: departuresQueryKey })
      await refetch()
      toast.dismiss(tid)
      toast.success('Departures updated ✓')
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to refresh')
    } finally {
      setRefreshing(false)
    }
  }, [queryStop, refreshing, queryClient, departuresQueryKey, refetch])

  function handleSearchSelect(stop: StopResult) {
    setAdHocStop(stop); setActiveId(null); setShowSavePanel(false)
  }

  function handleSavedStopClick(id: string) {
    setActiveId(id); setAdHocStop(null); setShowSavePanel(false)
  }

  async function handleSaveFromPanel(quayId: string | null, quayDescription: string | null, label: string) {
    if (!adHocStop) return
    const tid = toast.loading('Saving stop…')
    try {
      await addStop(adHocStop, quayId ?? undefined, quayDescription ?? undefined, label !== adHocStop.name ? label : undefined)
      toast.dismiss(tid)
      toast.success('Stop saved ✓')
      setShowSavePanel(false)
    } catch (e) {
      toast.dismiss(tid)
      toast.error((e as Error).message ?? 'Failed to save')
    }
  }

  const alreadySaved = adHocStop ? stops.some(s => s.stop_id === adHocStop.id) : false

  return (
    <div>
      {/* ── Saved stops ── */}
      {stops.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Saved stops</p>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {stops.map(s => (
              <button
                key={s.id}
                onClick={() => handleSavedStopClick(s.id)}
                className={`flex-shrink-0 text-left text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                  !adHocStop && activeSaved?.id === s.id
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'text-ink-600 border-ink-200 hover:border-accent-300'
                }`}
              >
                <span className="block whitespace-nowrap">{s.label ?? s.stop_name}</span>
                {s.quay_description && (
                  <span className="block whitespace-nowrap text-[10px] opacity-70">{s.quay_description}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Search stop — always visible ── */}
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Search stop</p>
        <StopSearchInput placeholder="Search any stop…" onSelect={handleSearchSelect} stopsOnly={true} />
      </div>

      {/* ── Active stop header + refresh ── */}
      {queryStop && (
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-[11px] text-ink-500 font-medium truncate">
              📍 {data?.stopName ?? queryStop.name}
            </span>
            {adHocStop && !alreadySaved && !showSavePanel && (
              <button
                onClick={() => setShowSavePanel(true)}
                className="text-[10px] text-accent-500 hover:text-accent-700 transition-colors duration-150 flex-shrink-0 min-h-[44px] flex items-center px-1"
              >
                + Save
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {lastUpdated && (
              <span className="text-[10px] text-ink-400">{fmtLastUpdated(lastUpdated)}</span>
            )}
            <button
              onClick={() => { handleRefresh(); ws.markSynced() }}
              disabled={refreshing}
              title="Refresh departures"
              aria-label="Refresh departures"
              className={`flex items-center justify-center rounded-lg bg-accent-500 text-white transition-colors duration-150 flex-shrink-0 min-h-[44px] min-w-[44px] ${
                refreshing ? 'opacity-70 cursor-not-allowed' : 'hover:bg-accent-600'
              }`}
            >
              <span className={`text-base leading-none select-none ${refreshing ? 'animate-spin' : ''}`}>↻</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Quay save panel ── */}
      {showSavePanel && adHocStop && (
        <QuaySavePanel
          stopId={adHocStop.id}
          stopName={adHocStop.name}
          onSave={handleSaveFromPanel}
          onCancel={() => setShowSavePanel(false)}
        />
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

      {/* ── Departures: 2-col quay grid, lines grouped within each quay ── */}
      {data && quayGroups.length > 0 && (
        <div className={quayGroups.length >= 2 ? 'grid grid-cols-2 gap-x-4' : ''}>
          {quayGroups.map((group, i) => (
            <div key={i}>
              {(group.code || group.description) && (
                <div className="mb-1 pb-1 border-b border-ink-100">
                  <p className="text-[11px] font-bold text-ink-700 truncate leading-snug">
                    {group.code ? `Platform ${group.code}` : group.description}
                  </p>
                  {group.code && group.description && (
                    <p className="text-[10px] text-ink-400 truncate leading-tight">{group.description}</p>
                  )}
                </div>
              )}
              <div className="divide-y divide-ink-50">
                {group.lineGroups.slice(0, visibleCount).map((lg, j) => (
                  <DepartureRow key={j} group={lg} now={now} />
                ))}
              </div>
              {group.lineGroups.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(c => c + 4)}
                  className="w-full text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[36px] border-t border-ink-100 pt-1 mt-1"
                >
                  Show {Math.min(4, group.lineGroups.length - visibleCount)} more ▾
                </button>
              )}
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
