import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDepartures, fetchNearestStops, type Departure, type StopResult, type Situation } from '../../api/ruterApi'
import { useTransitStops, DuplicateStopError } from '../../hooks/useTransitStops'
import { useGeolocation } from '../../hooks/useGeolocation'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { QuaySavePanel } from './QuaySavePanel'
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
  situations:      Situation[]
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
        situations:    dep.situations,
        departures:    [dep],
      })
    } else {
      map.get(key)!.departures.push(dep)
    }
  }
  return Array.from(map.values())
}

// Colour by severity — grey/neutral for informational, amber for moderate,
// red for severe. Matches EnTur's own Severity enum.
function situationColor(severity: string): string {
  if (severity === 'severe' || severity === 'verySevere') return 'text-red-600 bg-red-50 border-red-200'
  if (severity === 'slight' || severity === 'normal')     return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-ink-500 bg-ink-50 border-ink-200'
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
        {/* Live disruption/alert for this line, e.g. "Cancelled today" —
            straight from EnTur's own situations feed, not just the
            aimed-vs-expected delay indicator on the right. */}
        {group.situations.length > 0 && (
          <div className={`text-[10px] px-1.5 py-0.5 rounded border mt-1 truncate ${situationColor(group.situations[0].severity)}`}>
            ⚠ {group.situations[0].summary}
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

// ─── Component ────────────────────────────────────────────────────────────────

export function DeparturesTab({ ws, now }: DeparturesTabProps) {
  const { stops, addStop, updateStop } = useTransitStops()
  const queryClient = useQueryClient()
  const { data: geo } = useGeolocation()

  const defaultStop = stops.find(s => s.is_default) ?? stops[0] ?? null
  const [activeId,      setActiveId]      = useState<string | null>(null)
  const [adHocStop,     setAdHocStop]     = useState<StopResult | null>(null)
  const [showSavePanel, setShowSavePanel] = useState(false)
  const [lastUpdated,   setLastUpdated]   = useState<number | null>(null)
  const [refreshing,    setRefreshing]    = useState(false)
  const [visibleCount,  setVisibleCount]  = useState(4)
  const [includeAddresses, setIncludeAddresses] = useState(false)

  // Real nearby stops from the user's actual location (EnTur's `nearest` query)
  // — only when location was actually granted, never suggested off the Oslo
  // fallback (that would silently point someone elsewhere at the wrong city).
  const { data: nearby = [] } = useQuery({
    queryKey:  ['nearby-stops', geo?.lat, geo?.lon],
    queryFn:   () => fetchNearestStops(geo!.lat, geo!.lon),
    enabled:   geo?.source === 'gps' && !ws.collapsed,
    staleTime: 5 * 60_000,
    retry:     false,
  })

  const activeSaved = activeId ? stops.find(s => s.id === activeId) ?? defaultStop : defaultStop
  const queryStop   = adHocStop ?? (activeSaved ? { id: activeSaved.stop_id, name: activeSaved.stop_name } : null)
  // An address favorite (or an address search result) has no NSR stop id, so
  // there's no departures board for it — only saving it for trip planning.
  const isAddressQuery = !!queryStop && !queryStop.id.startsWith('NSR:')

  // A saved favorite's quay_id (which direction/platform it was saved for) —
  // real bug this fixes: the board used to always show EVERY platform at the
  // stop regardless of which one was actually saved, so "kaydedildigi quay'dan
  // bagimsiz sorgu atiyor" (queries independent of the saved quay) was literally
  // true. null quay_id means the favorite was saved as "all directions" on
  // purpose, so that case still shows everything.
  const savedQuayId = (!adHocStop && activeSaved?.quay_id) ? activeSaved.quay_id : null
  const [showAllDirections, setShowAllDirections] = useState(false)

  // Reset the load-more window (and the all-directions override) whenever the
  // viewed stop changes.
  useEffect(() => { setVisibleCount(4); setShowAllDirections(false) }, [queryStop?.id])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['departures', queryStop?.id ?? ''],
    queryFn: async () => {
      const result = await fetchDepartures(queryStop!.id)
      setLastUpdated(Date.now())
      return result
    },
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed && !!queryStop?.id && !isAddressQuery,
  })

  const allQuayGroups = useMemo(() => {
    if (!data?.departures) return []
    const rawMap = new Map<string, { quayId?: string; code?: string; description?: string; deps: Departure[] }>()
    for (const dep of data.departures) {
      // Group by the physical quay (code) when known — NOT by description,
      // which is often missing (real bug: grouping by description first meant
      // a stop with no description data collapsed everything into one bucket
      // even when quayCode clearly distinguished separate platforms).
      const key = dep.quayCode ?? dep.quayDescription ?? '__default__'
      if (!rawMap.has(key)) {
        rawMap.set(key, { quayId: dep.quayId, code: dep.quayCode, description: dep.quayDescription, deps: [] })
      }
      rawMap.get(key)!.deps.push(dep)
    }
    return Array.from(rawMap.values()).map(({ quayId, code, description, deps }) => {
      // Derive "Toward X, Y" from the departures actually seen at this quay —
      // no extra API call needed, and it can't go stale/wrong the way a
      // single first-seen guess could (a platform often serves >1 destination).
      const destinations = [...new Set(deps.map(d => d.destination))]
      return { quayId, code, description, destinations, lineGroups: buildLineGroups(deps) }
    })
  }, [data])

  // Scope the board to the saved favorite's platform/direction, unless the
  // user explicitly asked to see every platform at the stop.
  const quayGroups = useMemo(() => {
    if (!savedQuayId || showAllDirections) return allQuayGroups
    const matched = allQuayGroups.filter(g => g.quayId === savedQuayId)
    // Fall back to showing everything if the saved quay id doesn't match any
    // currently-live quay (e.g. EnTur re-ids a quay) — a silently empty board
    // would look like "no departures" when really it's just a stale id.
    return matched.length > 0 ? matched : allQuayGroups
  }, [allQuayGroups, savedQuayId, showAllDirections])

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
    try {
      await addStop(adHocStop, quayId ?? undefined, quayDescription ?? undefined, label !== adHocStop.name ? label : undefined)
      toast.success('Stop saved ✓')
      setShowSavePanel(false)
    } catch (e) {
      // Same stop + direction already saved — offer to update it instead of a
      // raw "duplicate key" error (real bug this replaces).
      if (e instanceof DuplicateStopError) {
        const proceed = confirm(
          `You already have this saved as "${e.existing.label ?? e.existing.stop_name}". Update it with this direction and label instead?`
        )
        if (!proceed) return
        try {
          await updateStop(e.existing.id, { label, quayId, quayDescription })
          toast.success('Stop updated ✓')
          setShowSavePanel(false)
        } catch (e2) {
          toast.error((e2 as Error).message ?? 'Failed to update')
        }
        return
      }
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
            {stops.map(s => {
              const active = !adHocStop && activeSaved?.id === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => handleSavedStopClick(s.id)}
                  className={`flex-shrink-0 text-left text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                    active
                      ? 'bg-accent-500 text-white border-accent-500'
                      : 'text-ink-600 border-ink-200 hover:border-accent-300'
                  }`}
                >
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    {s.label ?? s.stop_name}
                    {/* Clarifies "why is this one pre-selected" — the default
                        is the first stop you ever saved, or whichever you
                        picked in Settings; it's not a fixed/hardcoded stop. */}
                    {s.is_default && (
                      <span className={`text-[9px] ${active ? 'text-white/80' : 'text-accent-500'}`} title="Default stop — shown first when you open Departures">★</span>
                    )}
                  </span>
                  {s.quay_description && (
                    <span className="block whitespace-nowrap text-[10px] opacity-70">{s.quay_description}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Nearby stops — real stops around the user's actual location, from
             EnTur's `nearest` query. Only shown when location was granted (not
             the Oslo fallback, which would misleadingly suggest Oslo stops to
             someone elsewhere). ── */}
      {nearby.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">📍 Nearby</p>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {nearby.map(n => (
              <button
                key={n.id}
                onClick={() => handleSearchSelect({ id: n.id, name: n.name, layer: 'venue' })}
                className="flex-shrink-0 text-left text-xs px-3 py-2 rounded-lg border border-ink-200 text-ink-600 hover:border-accent-300 transition-colors duration-150 min-h-[44px]"
              >
                <span className="block whitespace-nowrap">{n.name}</span>
                <span className="block whitespace-nowrap text-[10px] opacity-70">{n.distance} m</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Search stop — always visible ── */}
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Search stop</p>
        <StopSearchInput placeholder="Search any stop…" onSelect={handleSearchSelect} stopsOnly={!includeAddresses} />
        <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-ink-500 min-h-[28px]">
          <input
            type="checkbox"
            checked={includeAddresses}
            onChange={e => setIncludeAddresses(e.target.checked)}
            className="rounded border-ink-300"
          />
          Include addresses (for trip planning — no live departures)
        </label>
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

      {/* ── Saved-direction scope note — makes the filtering from savedQuayId
             visible instead of silently narrowing the board with no explanation ── */}
      {queryStop && !isAddressQuery && savedQuayId && (
        <div className="flex items-center gap-2 text-[11px] text-ink-400 mb-2">
          <span>
            Showing: {activeSaved?.quay_description ?? 'saved direction'}
          </span>
          <button
            onClick={() => setShowAllDirections(v => !v)}
            className="text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[28px]"
          >
            {showAllDirections ? 'Show saved direction only' : 'Show all directions'}
          </button>
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
      {queryStop && isAddressQuery && (
        <div className="text-sm text-ink-400 py-2">This is an address, not a transit stop — no departures board. Use "+ Save" above to keep it for trip planning.</div>
      )}
      {isLoading && (
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-cream-200 animate-pulse" />
          ))}
        </div>
      )}
      {error && (
        <div className="text-red-500 text-xs py-1">
          {(error as Error).message?.includes('Rate')
            ? '⏳ Rate limited — wait a moment'
            : `⚠ ${(error as Error).message}`
          }
        </div>
      )}

      {/* ── Departures: each platform/direction gets its own bordered box, in a
             2-col grid on stops with multiple platforms — so which lines belong
             to which platform is never ambiguous. ── */}
      {data && quayGroups.length > 0 && (
        <div className={quayGroups.length >= 2 ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
          {quayGroups.map((group, i) => (
            <div key={i} className={quayGroups.length >= 2 ? 'rounded-lg border border-ink-200 bg-ink-50/40 p-2' : ''}>
              {quayGroups.length >= 2 && (
                <div className="mb-1 pb-1.5 border-b border-ink-100">
                  <p className="text-[11px] font-bold text-ink-700 truncate leading-snug">
                    {group.code ? `Platform ${group.code}` : 'Platform'}
                  </p>
                  <p className="text-[10px] text-ink-400 truncate leading-tight">
                    {group.description ?? (group.destinations.length > 0
                      ? `Toward ${group.destinations.slice(0, 2).join(', ')}${group.destinations.length > 2 ? '…' : ''}`
                      : 'Direction unknown')}
                  </p>
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
