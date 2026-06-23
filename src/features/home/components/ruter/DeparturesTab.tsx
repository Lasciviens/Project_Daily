import { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDepartures, type Departure, type StopResult } from '../../api/ruterApi'
import { useTransitStops } from '../../hooks/useTransitStops'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { minsUntil, fmtTime, fmtLastUpdated, lineStyle } from './transitUtils'
import { toast } from '../../../../app/store'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeparturesTabProps {
  ws:  WidgetStateResult
  now: number
}

const MODE_FALLBACK_BG: Record<string, string> = {
  bus:   '#E8112D',
  tram:  '#E8112D',
  metro: '#E8112D',
  rail:  '#4A4A4A',
  ferry: '#0066CC',
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
        line:            dep.line,
        destination:     dep.destination,
        transport:       dep.transport,
        lineColour:      dep.lineColour,
        lineTextColour:  dep.lineTextColour,
        realtime:        dep.realtime,
        aimed:           dep.aimed,
        expected:        dep.expected,
        departures:      [dep],
      })
    } else {
      map.get(key)!.departures.push(dep)
    }
  }
  return Array.from(map.values())
}

// ─── DepartureRow ─────────────────────────────────────────────────────────────

function DepartureRow({ group, now }: { group: LineGroup; now: number }) {
  const first   = group.departures[0]
  const mins    = minsUntil(first.expected, now)
  const isNow   = mins <= 0
  const delayed = Math.abs(new Date(first.expected).getTime() - new Date(first.aimed).getTime()) > 60_000
  const style   = lineStyle(group.lineColour, group.lineTextColour)
  const fallback = { backgroundColor: MODE_FALLBACK_BG[group.transport] ?? '#555', color: '#fff' }

  const nextTimes = group.departures.slice(1, 4).map(d => fmtTime(d.expected))

  return (
    <div className="flex items-center gap-2.5 py-2.5 min-h-[44px]">
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
            Neste {nextTimes.join(', ')}
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
          {isNow ? 'Nå' : `${mins} min`}
        </span>
        {group.realtime
          ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block flex-shrink-0" title="Realtime" />
          : <span className="text-[10px] text-ink-300 flex-shrink-0" title="Scheduled">~</span>
        }
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeparturesTab({ ws, now }: DeparturesTabProps) {
  const { stops, addStop } = useTransitStops()
  const queryClient = useQueryClient()

  const defaultStop = stops.find(s => s.is_default) ?? stops[0] ?? null
  const [activeId,    setActiveId]    = useState<string | null>(null)
  const [adHocStop,   setAdHocStop]   = useState<StopResult | null>(null)
  const [saveMsg,     setSaveMsg]     = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [refreshing,  setRefreshing]  = useState(false)

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

  // Group by quay, then within each quay group by line+destination
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
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Saved stops</p>
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
        <div className="flex items-center justify-between mb-3 gap-2">
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
                {group.lineGroups.map((lg, j) => (
                  <DepartureRow key={j} group={lg} now={now} />
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
