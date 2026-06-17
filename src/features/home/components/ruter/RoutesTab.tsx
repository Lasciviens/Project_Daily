import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTrips, fetchDepartures, type StopResult, type TransitPlace } from '../../api/ruterApi'
import { useTransitRoutes, type UserTransitRoute } from '../../hooks/useTransitRoutes'
import { useTransitStops } from '../../hooks/useTransitStops'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'
import { fmtLastUpdated, fmtTime } from './transitUtils'

interface RoutesTabProps {
  ws:  WidgetStateResult
  now: number
}

type LocationState = 'idle' | 'loading' | 'granted' | 'denied' | 'error'
type WhenPreset    = 'now' | '+15' | '+30' | '+1h' | 'arriveBy' | 'custom'
type TripMode      = 'departAt' | 'arriveBy'

interface SearchParams {
  from:           TransitPlace
  to:             TransitPlace
  dateTime?:      string
  arriveBy:       boolean
  label:          string
  preferredLine?: string
  version:        number
}

function getCurrentLocation(): Promise<TransitPlace> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ kind: 'coords', lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Current location' }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  })
}

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nowTimeString(): string {
  const d = new Date()
  const mins = Math.ceil(d.getMinutes() / 15) * 15
  const rounded = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), mins)
  return `${String(rounded.getHours()).padStart(2, '0')}:${String(rounded.getMinutes()).padStart(2, '0')}`
}

function timeSlots(): string[] {
  const slots: string[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return slots
}
const TIME_SLOTS = timeSlots()

function offsetISO(now: number, offsetMins: number): string {
  return new Date(now + offsetMins * 60_000).toISOString()
}

function toTransitPlace(s: StopResult): TransitPlace | null {
  if (s.id.startsWith('NSR:')) return { kind: 'stop', id: s.id, name: s.name }
  if (s.lat !== undefined && s.lon !== undefined) return { kind: 'coords', lat: s.lat, lon: s.lon, name: s.name }
  return null
}

function planningLabel(preset: WhenPreset, mode: TripMode, dateTime: string | undefined): string {
  const modeLabel = (preset === 'arriveBy' || mode === 'arriveBy') ? 'Arrive by' : 'Leave'
  if (preset === 'now') return 'Leave now'
  if (dateTime) {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return `${modeLabel} ${DAYS[new Date(dateTime).getDay()]} ${fmtTime(dateTime)}`
  }
  return `${modeLabel} now`
}

function suggestLabel(from: TransitPlace, to: TransitPlace): string {
  return `${from.name.split(',')[0].trim()} → ${to.name.split(',')[0].trim()}`
}

// Stop card that shows direction hints by fetching a few real departures
function PlaceDisplay({ place, onClear }: { place: TransitPlace; onClear: () => void }) {
  const { data: depData } = useQuery({
    queryKey:  ['stop-directions', place.kind === 'stop' ? place.id : null],
    queryFn:   () => fetchDepartures((place as { id: string }).id, 8),
    enabled:   place.kind === 'stop',
    staleTime: 5 * 60_000,
    retry:     false,
  })

  // Extract unique quay directions from real departure data
  const directions = useMemo(() => {
    if (!depData?.departures) return []
    const seen = new Set<string>()
    const dirs: string[] = []
    for (const dep of depData.departures) {
      const d = dep.quayDescription
      if (d && !seen.has(d)) { seen.add(d); dirs.push(d) }
    }
    return dirs
  }, [depData])

  return (
    <div className="flex items-start gap-2 px-3 py-2.5 bg-ink-50 border border-ink-200 rounded-xl min-h-[48px]">
      <span className="text-base flex-shrink-0 mt-0.5">{place.kind === 'coords' ? '📍' : '🚏'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-800 leading-snug">{place.name}</p>
        {directions.length > 0 && (
          <p className="text-[10px] text-ink-400 mt-0.5">{directions.join(' · ')}</p>
        )}
      </div>
      <button
        onClick={onClear}
        className="text-ink-300 hover:text-ink-600 transition-colors duration-150 flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
      >✕</button>
    </div>
  )
}

function SavedRouteChip({ route, active, onSelect, onDelete }: {
  route: UserTransitRoute; active: boolean; onSelect: () => void; onDelete: () => void
}) {
  return (
    <div className="relative group inline-flex">
      <button
        onClick={onSelect}
        className={`flex flex-col text-left px-3 py-2 rounded-xl border transition-colors duration-150 min-h-[44px] pr-7 ${
          active
            ? 'bg-accent-500 text-white border-accent-500'
            : 'bg-white text-ink-700 border-ink-200 hover:border-accent-300'
        }`}
      >
        <span className="text-xs font-semibold leading-tight">{route.label}</span>
        <span className={`text-[10px] leading-tight mt-0.5 max-w-[130px] truncate ${active ? 'text-white/70' : 'text-ink-400'}`}>
          {route.from_stop_name.split(',')[0]} → {route.to_stop_name.split(',')[0]}
        </span>
      </button>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Remove"
        className={`absolute top-1 right-1 w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center transition-opacity duration-150 opacity-0 group-hover:opacity-100 ${
          active ? 'bg-white/30 text-white' : 'bg-ink-100 text-ink-500 hover:bg-red-100 hover:text-red-600'
        }`}
      >✕</button>
    </div>
  )
}

export function RoutesTab({ ws, now }: RoutesTabProps) {
  const { routes, addRoute, removeRoute } = useTransitRoutes()
  const { stops: savedStops } = useTransitStops()

  const [draftFrom,      setDraftFrom]      = useState<TransitPlace | null>(null)
  const [draftTo,        setDraftTo]        = useState<TransitPlace | null>(null)
  const [fromLocState,   setFromLocState]   = useState<LocationState>('idle')
  const [toLocState,     setToLocState]     = useState<LocationState>('idle')
  const [draftWhen,      setDraftWhen]      = useState<WhenPreset>('now')
  const [draftDate,      setDraftDate]      = useState(todayString)
  const [draftTime,      setDraftTime]      = useState(nowTimeString)
  const [draftMode,      setDraftMode]      = useState<TripMode>('departAt')
  const [draftLine,      setDraftLine]      = useState('')
  const [showLineFilter, setShowLineFilter] = useState(false)
  const [formCollapsed,  setFormCollapsed]  = useState(false)
  const [search,         setSearch]         = useState<SearchParams | null>(null)
  const [lastUpdated,    setLastUpdated]    = useState<number | null>(null)
  const [saveLabel,      setSaveLabel]      = useState('')
  const [showSaveForm,   setShowSaveForm]   = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [saveMsg,        setSaveMsg]        = useState<string | null>(null)

  const favoriteStops = useMemo(() => {
    const seen = new Set<string>()
    const stops: { id: string; name: string }[] = []
    for (const r of routes) {
      if (!seen.has(r.from_stop_id)) { seen.add(r.from_stop_id); stops.push({ id: r.from_stop_id, name: r.from_stop_name }) }
      if (!seen.has(r.to_stop_id))   { seen.add(r.to_stop_id);   stops.push({ id: r.to_stop_id,   name: r.to_stop_name   }) }
    }
    return stops
  }, [routes])

  function applyPreset(r: UserTransitRoute) {
    const from: TransitPlace = { kind: 'stop', id: r.from_stop_id, name: r.from_stop_name }
    const to:   TransitPlace = { kind: 'stop', id: r.to_stop_id,   name: r.to_stop_name   }
    setDraftFrom(from); setDraftTo(to); setDraftWhen('now'); setSaveMsg(null); setShowSaveForm(false)
    setSearch({ from, to, dateTime: undefined, arriveBy: false, label: 'Leave now',
      preferredLine: draftLine.trim() || undefined, version: (search?.version ?? 0) + 1 })
    setFormCollapsed(true)
  }

  function swapStops() { setDraftFrom(draftTo); setDraftTo(draftFrom) }

  async function planGpsToStop(stopId: string, stopName: string) {
    setFromLocState('loading')
    try {
      const gpsPlace = await getCurrentLocation()
      const toPlace: TransitPlace = { kind: 'stop', id: stopId, name: stopName }
      setDraftFrom(gpsPlace); setDraftTo(toPlace); setFromLocState('granted')
      setSearch({
        from: gpsPlace, to: toPlace, dateTime: undefined, arriveBy: false,
        label: 'Leave now', preferredLine: undefined,
        version: (search?.version ?? 0) + 1,
      })
      setShowSaveForm(false); setSaveMsg(null); setFormCollapsed(true)
    } catch (e) {
      const err = e as GeolocationPositionError
      setFromLocState(err.code === 1 ? 'denied' : 'error')
    }
  }

  async function locateFor(side: 'from' | 'to') {
    const setState = side === 'from' ? setFromLocState : setToLocState
    const setPlace = side === 'from' ? setDraftFrom    : setDraftTo
    setState('loading')
    try {
      const place = await getCurrentLocation()
      setPlace(place); setState('granted')
    } catch (e) {
      const err = e as GeolocationPositionError
      setState(err.code === 1 ? 'denied' : 'error')
    }
  }

  function handlePlan() {
    if (!draftFrom || !draftTo) return
    let dateTime: string | undefined
    if      (draftWhen === '+15')      dateTime = offsetISO(now, 15)
    else if (draftWhen === '+30')      dateTime = offsetISO(now, 30)
    else if (draftWhen === '+1h')      dateTime = offsetISO(now, 60)
    else if (draftWhen === 'arriveBy') dateTime = new Date(`${todayString()}T${draftTime}`).toISOString()
    else if (draftWhen === 'custom')   dateTime = new Date(`${draftDate}T${draftTime}`).toISOString()
    setSearch({
      from: draftFrom, to: draftTo, dateTime,
      arriveBy: draftWhen === 'arriveBy' || draftMode === 'arriveBy',
      label: planningLabel(draftWhen, draftMode, dateTime),
      preferredLine: draftLine.trim() || undefined,
      version: (search?.version ?? 0) + 1,
    })
    setShowSaveForm(false); setSaveMsg(null); setFormCollapsed(true)
  }

  const fromKey = search?.from.kind === 'stop' ? search.from.id
    : search ? `${(search.from as { lat: number }).lat},${(search.from as { lon: number }).lon}` : ''
  const toKey = search?.to.kind === 'stop' ? search.to.id
    : search ? `${(search.to as { lat: number }).lat},${(search.to as { lon: number }).lon}` : ''

  const { data, isLoading, error } = useQuery({
    queryKey: ['trip', fromKey, toKey, search?.arriveBy, search?.dateTime ?? 'now', search?.version],
    queryFn:  async () => {
      const result = await fetchTrips(search!.from, search!.to, undefined, search!.dateTime, search!.arriveBy)
      setLastUpdated(Date.now())
      return result
    },
    staleTime: Infinity, refetchInterval: false, enabled: !ws.collapsed && !!search,
  })

  const { filteredData, lineFilterActive, lineMatchCount } = useMemo(() => {
    if (!data) return { filteredData: undefined, lineFilterActive: false, lineMatchCount: 0 }
    const pref = search?.preferredLine?.trim().toLowerCase()
    if (!pref) return { filteredData: data, lineFilterActive: false, lineMatchCount: 0 }
    const matched = data.filter(trip =>
      trip.legs.some(leg => leg.line?.toLowerCase() === pref || leg.line?.toLowerCase().includes(pref))
    )
    return { filteredData: matched.length > 0 ? matched : data, lineFilterActive: true, lineMatchCount: matched.length }
  }, [data, search?.preferredLine])

  const canSave = !!(search?.from.kind === 'stop' && search.to.kind === 'stop')
  const alreadySaved = canSave && routes.some(
    r => r.from_stop_id === (search!.from as { id: string }).id && r.to_stop_id === (search!.to as { id: string }).id
  )
  // Can save directly from draft (before planning) when both stops are NSR stops
  const draftCanSave = !formCollapsed && !!(draftFrom?.kind === 'stop' && draftTo?.kind === 'stop')
  const draftAlreadySaved = draftCanSave && routes.some(
    r => r.from_stop_id === (draftFrom as { id: string }).id && r.to_stop_id === (draftTo as { id: string }).id
  )

  async function handleSaveRoute() {
    if (!saveLabel.trim()) return
    // Use search state if available, fall back to draft state (before planning)
    const from = search?.from.kind === 'stop' ? search.from : draftFrom
    const to   = search?.to.kind   === 'stop' ? search.to   : draftTo
    if (!from || !to || from.kind !== 'stop' || to.kind !== 'stop') return
    setSaving(true)
    try {
      await addRoute(saveLabel.trim(), from as StopResult, to as StopResult)
      setSaveMsg('Saved ✓'); setSaveLabel(''); setShowSaveForm(false)
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      setSaveMsg(`Failed: ${(e as Error).message}`)
    } finally { setSaving(false) }
  }

  const canPlan = !!(draftFrom && draftTo)

  return (
    <div className="space-y-4">

      {/* Saved routes */}
      {routes.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-2">Saved routes</p>
          <div className="flex flex-wrap gap-2">
            {routes.map(r => {
              const active = draftFrom?.kind === 'stop' && draftFrom.id === r.from_stop_id &&
                             draftTo?.kind   === 'stop' && draftTo.id   === r.to_stop_id
              return (
                <SavedRouteChip key={r.id} route={r} active={active}
                  onSelect={() => applyPreset(r)} onDelete={() => removeRoute(r.id)} />
              )
            })}
          </div>
        </div>
      )}

      {/* GPS → saved stop quick chips */}
      {savedStops.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-2">Quick route from here</p>
          <div className="flex flex-wrap gap-2">
            {savedStops.map(s => (
              <button
                key={s.id}
                onClick={() => planGpsToStop(s.stop_id, s.label ?? s.stop_name)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-ink-200 text-ink-700 hover:border-accent-300 transition-colors duration-150 min-h-[44px]"
              >
                <span>📍</span>
                <span>→</span>
                <span>{s.label ?? s.stop_name.split(',')[0]}</span>
              </button>
            ))}
          </div>
          {fromLocState === 'denied' && (
            <p className="text-[11px] text-red-500 mt-1">Location permission denied</p>
          )}
          {fromLocState === 'loading' && (
            <p className="text-[11px] text-ink-400 mt-1">Getting location…</p>
          )}
        </div>
      )}

      {/* Planner form — collapses to a summary bar after planning */}
      {formCollapsed && search ? (
        <div className="flex items-center gap-3 px-3 py-3 bg-accent-50 border border-accent-200 rounded-xl">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink-900 truncate">
              {search.from.name.split(',')[0]} → {search.to.name.split(',')[0]}
            </p>
            <p className="text-[11px] text-accent-600 mt-0.5">{search.label}</p>
          </div>
          <button
            onClick={() => setFormCollapsed(false)}
            className="text-xs font-medium text-accent-600 hover:text-accent-800 transition-colors duration-150 flex-shrink-0 min-h-[44px] px-2 flex items-center"
          >Edit</button>
        </div>
      ) : (
        <div className="space-y-3">

          {/* FROM */}
          <div>
            <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">From</p>
            {draftFrom ? (
              <PlaceDisplay place={draftFrom} onClear={() => { setDraftFrom(null); setFromLocState('idle') }} />
            ) : (
              <div className="space-y-1">
                <StopSearchInput placeholder="Stop or address…" favorites={favoriteStops}
                  onSelect={s => { const p = toTransitPlace(s); if (p) setDraftFrom(p) }} />
                {fromLocState === 'loading' ? (
                  <span className="text-[11px] text-ink-400 py-1 block">Locating…</span>
                ) : fromLocState === 'denied' ? (
                  <span className="text-[11px] text-red-500 py-1 block">Location permission denied</span>
                ) : (
                  <button onClick={() => locateFor('from')}
                    className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150 py-1">
                    📍 Use current location
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Swap — only when both stops are set */}
          {draftFrom && draftTo && (
            <div className="flex justify-end -mt-1">
              <button onClick={swapStops}
                className="text-xs text-ink-400 hover:text-accent-600 transition-colors duration-150 flex items-center gap-1 min-h-[36px] px-2">
                ⇅ Swap
              </button>
            </div>
          )}

          {/* TO */}
          <div>
            <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">To</p>
            {draftTo ? (
              <PlaceDisplay place={draftTo} onClear={() => { setDraftTo(null); setToLocState('idle') }} />
            ) : (
              <div className="space-y-1">
                <StopSearchInput placeholder="Stop or address…" favorites={favoriteStops}
                  onSelect={s => { const p = toTransitPlace(s); if (p) setDraftTo(p) }} />
                {toLocState === 'loading' ? (
                  <span className="text-[11px] text-ink-400 py-1 block">Locating…</span>
                ) : toLocState === 'denied' ? (
                  <span className="text-[11px] text-red-500 py-1 block">Location permission denied</span>
                ) : (
                  <button onClick={() => locateFor('to')}
                    className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150 py-1">
                    📍 Use current location
                  </button>
                )}
              </div>
            )}
          </div>

          {/* When chips */}
          <div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(['now', '+15', '+30', '+1h', 'arriveBy', 'custom'] as WhenPreset[]).map(p => (
                <button key={p} onClick={() => setDraftWhen(p)}
                  className={`text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[40px] ${
                    draftWhen === p
                      ? 'bg-accent-500 text-white border-accent-500'
                      : 'text-ink-600 border-ink-200 hover:border-accent-300'
                  }`}>
                  {p === 'now' ? 'Now' : p === 'arriveBy' ? 'Arrive by…' : p === 'custom' ? 'Custom…' : p}
                </button>
              ))}
            </div>

            {draftWhen === 'arriveBy' && (
              <div className="space-y-1">
                <select value={draftTime} onChange={e => setDraftTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]">
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <p className="text-[10px] text-ink-400">Arrive by this time today</p>
              </div>
            )}

            {draftWhen === 'custom' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {(['departAt', 'arriveBy'] as TripMode[]).map(m => (
                    <button key={m} onClick={() => setDraftMode(m)}
                      className={`flex-1 text-xs py-2 rounded-lg border transition-colors duration-150 min-h-[40px] ${
                        draftMode === m ? 'bg-ink-700 text-white border-ink-700' : 'text-ink-500 border-ink-200 hover:border-ink-400'
                      }`}>
                      {m === 'departAt' ? 'Leave at' : 'Arrive by'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="date" value={draftDate} min={todayString()} onChange={e => setDraftDate(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]" />
                  <select value={draftTime} onChange={e => setDraftTime(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]">
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Plan button — grey with hint text when disabled, solid accent when ready */}
          <button onClick={handlePlan} disabled={!canPlan}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors duration-150 min-h-[48px] ${
              canPlan
                ? 'bg-accent-500 text-white hover:bg-accent-600'
                : 'bg-ink-100 text-ink-400 cursor-not-allowed'
            }`}>
            {canPlan ? 'Plan route' : 'Select From and To first'}
          </button>

          {/* Save as favorite — available as soon as both stops are NSR stops */}
          {draftCanSave && !draftAlreadySaved && !showSaveForm && (
            <button
              onClick={() => {
                setSaveLabel(suggestLabel(draftFrom!, draftTo!))
                setShowSaveForm(true)
              }}
              className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150"
            >
              💾 Save as favorite route
            </button>
          )}
          {draftCanSave && !draftAlreadySaved && showSaveForm && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">Name this route</p>
              <div className="flex items-center gap-2">
                <input
                  value={saveLabel} onChange={e => setSaveLabel(e.target.value)}
                  placeholder="e.g. İşten eve" autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleSaveRoute()}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
                />
                <button onClick={handleSaveRoute} disabled={!saveLabel.trim() || saving}
                  className="text-xs px-3 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150 disabled:opacity-50 min-h-[44px]">
                  {saving ? '…' : 'Save'}
                </button>
                <button onClick={() => { setShowSaveForm(false); setSaveLabel('') }}
                  className="text-ink-400 hover:text-ink-600 min-w-[44px] min-h-[44px] flex items-center justify-center">✕</button>
              </div>
            </div>
          )}
          {saveMsg && !showSaveForm && (
            <p className={`text-xs ${saveMsg.startsWith('Failed') ? 'text-red-500' : 'text-green-600'}`}>{saveMsg}</p>
          )}

          {/* Line filter — hidden by default */}
          <div>
            {!showLineFilter ? (
              <button onClick={() => setShowLineFilter(true)}
                className="text-[11px] text-ink-400 hover:text-ink-600 transition-colors duration-150">
                + Filter by line number
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input value={draftLine} onChange={e => setDraftLine(e.target.value)}
                  placeholder="e.g. 68, 31E" autoFocus
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px] placeholder:text-ink-300" />
                <button onClick={() => { setDraftLine(''); setShowLineFilter(false) }}
                  className="text-ink-300 hover:text-ink-600 transition-colors duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center">✕</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading && <div className="text-sm text-ink-400 py-2">Loading trips…</div>}

      {error && (
        <div className="text-xs text-red-500 py-1">
          {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : `⚠ ${(error as Error).message}`}
        </div>
      )}

      {filteredData && search && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-ink-400">{lastUpdated ? fmtLastUpdated(lastUpdated) : ''}</span>
            {canSave && !alreadySaved && !showSaveForm && (
              <button onClick={() => { setSaveLabel(suggestLabel(search.from, search.to)); setShowSaveForm(true) }}
                className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150">
                + Save this route
              </button>
            )}
          </div>

          {lineFilterActive && (
            <div className="text-[11px] px-3 py-2 rounded-lg bg-accent-50 border border-accent-100 text-accent-700">
              {lineMatchCount > 0
                ? `Showing ${lineMatchCount} trip${lineMatchCount !== 1 ? 's' : ''} using line ${search.preferredLine}`
                : `No trips found with line ${search.preferredLine} — showing all`}
            </div>
          )}

          {canSave && !alreadySaved && showSaveForm && (
            <div className="flex items-center gap-2">
              <input value={saveLabel} onChange={e => setSaveLabel(e.target.value)}
                placeholder="Name this route…" autoFocus onKeyDown={e => e.key === 'Enter' && handleSaveRoute()}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]" />
              <button onClick={handleSaveRoute} disabled={!saveLabel.trim() || saving}
                className="text-xs px-3 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150 disabled:opacity-50 min-h-[44px]">
                {saving ? '…' : 'Save'}
              </button>
              <button onClick={() => { setShowSaveForm(false); setSaveLabel('') }}
                className="text-ink-400 hover:text-ink-600 min-w-[44px] min-h-[44px] flex items-center justify-center">✕</button>
            </div>
          )}
          {saveMsg && <p className={`text-xs ${saveMsg.startsWith('Failed') ? 'text-red-500' : 'text-green-600'}`}>{saveMsg}</p>}

          {filteredData.length === 0
            ? <p className="text-sm text-ink-400">No trips found</p>
            : filteredData.map((trip, i) => <TripCard key={i} trip={trip} now={now} isBest={i === 0} />)
          }
        </div>
      )}
    </div>
  )
}
