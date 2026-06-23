import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchTrips, type StopResult, type TransitPlace } from '../../api/ruterApi'
import { useTransitRoutes, type UserTransitRoute } from '../../hooks/useTransitRoutes'
import { useTransitRecentSearches } from '../../hooks/useTransitRecentSearches'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'
import { fmtLastUpdated, fmtTime } from './transitUtils'
import { toast } from '../../../../app/store'
import { DateInput } from '../../../../shared/components/DateInput'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutesTabProps {
  ws:  WidgetStateResult
  now: number
}

type LocationState = 'idle' | 'loading' | 'granted' | 'denied' | 'error'
type WhenPreset    = 'now' | '+15' | '+30' | '+1h' | 'arriveBy' | 'custom'
type TripMode      = 'departAt' | 'arriveBy'

interface SearchParams {
  from:      TransitPlace
  to:        TransitPlace
  dateTime?: string
  arriveBy:  boolean
  label:     string
  version:   number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function planLabel(preset: WhenPreset, mode: TripMode, dateTime: string | undefined): string {
  if (preset === 'now') return 'Leave now'
  const modeLabel = (preset === 'arriveBy' || mode === 'arriveBy') ? 'Arrive by' : 'Leave'
  if (dateTime) {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return `${modeLabel} ${DAYS[new Date(dateTime).getDay()]} ${fmtTime(dateTime)}`
  }
  return `${modeLabel} now`
}

function useContainerWidth() {
  const ref  = useRef<HTMLDivElement | null>(null)
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
    const ro = new ResizeObserver(e => { const r = e[0]; if (r) setWidth(r.contentRect.width) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Compact filled-stop display in the horizontal form bar
function PlaceChip({ place, isFrom, onClear }: { place: TransitPlace; isFrom: boolean; onClear: () => void }) {
  return (
    <div className="flex items-center gap-1.5 min-h-[40px] px-2.5 py-1.5 bg-cream-50 rounded-lg border border-ink-100 min-w-0 flex-1">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isFrom ? 'bg-red-500' : 'bg-green-500'}`} />
      <span className="text-sm font-medium text-ink-800 truncate flex-1 leading-snug">
        {place.name.split(',')[0]}
      </span>
      <button
        onClick={onClear}
        className="text-ink-300 hover:text-red-400 transition-colors duration-150 flex-shrink-0 min-w-[28px] min-h-[28px] flex items-center justify-center"
        aria-label={`Clear ${isFrom ? 'from' : 'to'} stop`}
      >✕</button>
    </div>
  )
}

// Vertical stacked place display (for narrow layout)
function PlaceDisplayFull({ place, label, onClear }: { place: TransitPlace; label: string; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">{label}</span>
      <div className="flex items-start gap-2 px-3 py-2.5 bg-ink-50 border border-ink-200 rounded-xl min-h-[52px]">
        <span className={`w-3 h-3 rounded-full flex-shrink-0 mt-1.5 ${label.toLowerCase() === 'from' ? 'bg-red-500' : 'bg-green-500'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-900 leading-snug">{place.name}</p>
        </div>
        <button
          onClick={onClear}
          className="text-ink-300 hover:text-red-400 transition-colors duration-150 flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label={`Clear ${label} stop`}
        >✕</button>
      </div>
    </div>
  )
}

// Quick route chip (saved routes)
function QuickRouteChip({ route, active, onSelect, onDelete }: {
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

// ─── Main component ───────────────────────────────────────────────────────────

export function RoutesTab({ ws, now }: RoutesTabProps) {
  const { routes, addRoute, removeRoute }       = useTransitRoutes()
  const { searches, addSearch, removeSearch }   = useTransitRecentSearches()
  const queryClient                              = useQueryClient()
  const { ref: containerRef, width }            = useContainerWidth()

  const wide = width >= 560

  const [draftFrom,      setDraftFrom]      = useState<TransitPlace | null>(null)
  const [draftTo,        setDraftTo]        = useState<TransitPlace | null>(null)
  const [fromLocState,   setFromLocState]   = useState<LocationState>('idle')
  const [toLocState,     setToLocState]     = useState<LocationState>('idle')
  const [draftWhen,      setDraftWhen]      = useState<WhenPreset>('now')
  const [draftDate,      setDraftDate]      = useState(todayString)
  const [draftTime,      setDraftTime]      = useState(nowTimeString)
  const [draftMode,      setDraftMode]      = useState<TripMode>('departAt')
  const [showTimePanel,  setShowTimePanel]  = useState(false)
  const [formCollapsed,  setFormCollapsed]  = useState(false)
  const [search,         setSearch]         = useState<SearchParams | null>(null)
  const [lastUpdated,    setLastUpdated]    = useState<number | null>(null)
  const [saveLabel,      setSaveLabel]      = useState('')
  const [showSaveForm,   setShowSaveForm]   = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [saveMsg,        setSaveMsg]        = useState<string | null>(null)
  const [refreshing,     setRefreshing]     = useState(false)

  function swapStops() { setDraftFrom(draftTo); setDraftTo(draftFrom) }

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

  function applyRoute(r: UserTransitRoute) {
    const from: TransitPlace = { kind: 'stop', id: r.from_stop_id, name: r.from_stop_name }
    const to:   TransitPlace = { kind: 'stop', id: r.to_stop_id,   name: r.to_stop_name   }
    setDraftFrom(from); setDraftTo(to); setDraftWhen('now')
    setSaveMsg(null); setShowSaveForm(false)
    triggerSearch(from, to, 'now')
  }

  function applyRecent(fromId: string, fromName: string, toId: string, toName: string) {
    const from: TransitPlace = { kind: 'stop', id: fromId, name: fromName }
    const to:   TransitPlace = { kind: 'stop', id: toId,   name: toName   }
    setDraftFrom(from); setDraftTo(to); setDraftWhen('now')
    setSaveMsg(null); setShowSaveForm(false)
    triggerSearch(from, to, 'now')
  }

  function triggerSearch(from: TransitPlace, to: TransitPlace, when: WhenPreset) {
    let dateTime: string | undefined
    if      (when === '+15') dateTime = offsetISO(now, 15)
    else if (when === '+30') dateTime = offsetISO(now, 30)
    else if (when === '+1h') dateTime = offsetISO(now, 60)
    setSearch({
      from, to, dateTime,
      arriveBy: false,
      label: planLabel(when, 'departAt', dateTime),
      version: (search?.version ?? 0) + 1,
    })
    setFormCollapsed(true)
  }

  function handlePlan() {
    if (!draftFrom || !draftTo) return
    let dateTime: string | undefined
    if      (draftWhen === '+15')      dateTime = offsetISO(now, 15)
    else if (draftWhen === '+30')      dateTime = offsetISO(now, 30)
    else if (draftWhen === '+1h')      dateTime = offsetISO(now, 60)
    else if (draftWhen === 'arriveBy') dateTime = new Date(`${todayString()}T${draftTime}`).toISOString()
    else if (draftWhen === 'custom')   dateTime = new Date(`${draftDate}T${draftTime}`).toISOString()

    const arriveBy = draftWhen === 'arriveBy' || draftMode === 'arriveBy'
    setSearch({
      from: draftFrom, to: draftTo, dateTime, arriveBy,
      label: planLabel(draftWhen, draftMode, dateTime),
      version: (search?.version ?? 0) + 1,
    })
    setShowSaveForm(false); setSaveMsg(null); setFormCollapsed(true)
    setShowTimePanel(false)
    // Save to recent searches when both are NSR stops
    if (draftFrom.kind === 'stop' && draftTo.kind === 'stop') {
      addSearch(draftFrom.id, draftFrom.name, draftTo.id, draftTo.name)
    }
  }

  const fromKey = search?.from.kind === 'stop' ? search.from.id
    : search ? `${(search.from as { lat: number }).lat},${(search.from as { lon: number }).lon}` : ''
  const toKey = search?.to.kind === 'stop' ? search.to.id
    : search ? `${(search.to as { lat: number }).lat},${(search.to as { lon: number }).lon}` : ''

  const tripQueryKey = ['trip', fromKey, toKey, search?.arriveBy, search?.dateTime ?? 'now', search?.version]

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: tripQueryKey,
    queryFn:  async () => {
      const result = await fetchTrips(search!.from, search!.to, undefined, search!.dateTime, search!.arriveBy)
      setLastUpdated(Date.now())
      return result
    },
    staleTime: Infinity, refetchInterval: false, enabled: !ws.collapsed && !!search,
  })

  const handleRefresh = useCallback(async () => {
    if (!search || refreshing) return
    setRefreshing(true)
    const tid = toast.loading('Refreshing routes…')
    try {
      await queryClient.invalidateQueries({ queryKey: tripQueryKey })
      await refetch()
      toast.dismiss(tid)
      toast.success('Routes updated ✓')
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to refresh')
    } finally {
      setRefreshing(false)
    }
  }, [search, refreshing, queryClient, tripQueryKey, refetch])

  const canPlan     = !!(draftFrom && draftTo)
  const canSave     = !!(search?.from.kind === 'stop' && search.to.kind === 'stop')
  const alreadySaved = canSave && routes.some(
    r => r.from_stop_id === (search!.from as { id: string }).id && r.to_stop_id === (search!.to as { id: string }).id
  )
  const draftCanSave = !!(draftFrom?.kind === 'stop' && draftTo?.kind === 'stop')
  const draftAlreadySaved = draftCanSave && routes.some(
    r => r.from_stop_id === (draftFrom as { id: string }).id && r.to_stop_id === (draftTo as { id: string }).id
  )

  async function handleSaveRoute() {
    if (!saveLabel.trim()) return
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

  const activeRouteId = useMemo(() => {
    if (!draftFrom || !draftTo) return null
    const r = routes.find(
      r => r.from_stop_id === (draftFrom as { id?: string }).id &&
           r.to_stop_id   === (draftTo   as { id?: string }).id
    )
    return r?.id ?? null
  }, [routes, draftFrom, draftTo])

  // ── Collapsed summary bar ────────────────────────────────────────────────────
  if (formCollapsed && search) {
    return (
      <div ref={containerRef} className="space-y-4">
        <div className="flex items-center gap-2 px-3 py-3 bg-accent-50 border border-accent-200 rounded-xl">
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
              <p className="text-xs font-medium text-ink-700 truncate">{search.from.name.split(',')[0]}</p>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              <p className="text-xs font-medium text-ink-700 truncate">{search.to.name.split(',')[0]}</p>
            </div>
            <p className="text-[10px] text-accent-600 pl-3.5">{search.label}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {lastUpdated && (
              <span className="text-[10px] text-ink-400">{fmtLastUpdated(lastUpdated)}</span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh routes"
              className={`flex items-center justify-center rounded-lg bg-accent-500 text-white transition-colors duration-150 flex-shrink-0 min-h-[44px] min-w-[44px] ${
                refreshing ? 'opacity-70 cursor-not-allowed' : 'hover:bg-accent-600'
              }`}
            >
              <span className={`text-base leading-none select-none ${refreshing ? 'animate-spin' : ''}`}>↻</span>
            </button>
            <button
              onClick={() => setFormCollapsed(false)}
              className="text-xs font-medium text-accent-600 hover:text-accent-800 transition-colors duration-150 flex-shrink-0 min-h-[44px] px-2 flex items-center"
            >Edit</button>
          </div>
        </div>

        {/* Route results */}
        {isLoading && <div className="text-sm text-ink-400 py-2">Loading trips…</div>}
        {error && (
          <div className="text-xs text-red-500 py-1">
            {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : `⚠ ${(error as Error).message}`}
          </div>
        )}

        {data && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              {canSave && !alreadySaved && !showSaveForm && (
                <button
                  onClick={() => { setSaveLabel(`${search.from.name.split(',')[0]} → ${search.to.name.split(',')[0]}`); setShowSaveForm(true) }}
                  className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[44px] flex items-center"
                >
                  + Save this route
                </button>
              )}
            </div>
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
            {data.length === 0
              ? <p className="text-sm text-ink-400">No trips found</p>
              : data.map((trip, i) => <TripCard key={i} trip={trip} now={now} isBest={i === 0} />)
            }
          </div>
        )}
      </div>
    )
  }

  // ── Planner form ─────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="space-y-3">

      {/* Quick routes (saved) */}
      {routes.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-2">Quick routes</p>
          <div className="flex flex-wrap gap-2">
            {routes.map(r => (
              <QuickRouteChip
                key={r.id}
                route={r}
                active={activeRouteId === r.id}
                onSelect={() => applyRoute(r)}
                onDelete={() => removeRoute(r.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent searches */}
      {searches.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Recent</p>
          <div className="space-y-0">
            {searches.map(s => (
              <div key={s.id} className="group flex items-center gap-2 min-h-[40px]">
                <button
                  onClick={() => applyRecent(s.from_stop_id, s.from_stop_name, s.to_stop_id, s.to_stop_name)}
                  className="flex-1 flex items-center gap-2 py-1.5 text-left hover:text-accent-600 transition-colors duration-150 min-h-[40px]"
                >
                  <span className="text-ink-300 text-xs flex-shrink-0">↗</span>
                  <span className="text-xs text-ink-700 truncate">
                    {s.from_stop_name.split(',')[0]} → {s.to_stop_name.split(',')[0]}
                  </span>
                </button>
                <button
                  onClick={() => removeSearch(s.id)}
                  className="text-ink-200 hover:text-red-400 transition-colors duration-150 opacity-0 group-hover:opacity-100 min-w-[28px] min-h-[28px] flex items-center justify-center flex-shrink-0"
                  aria-label="Remove"
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── FROM / TO form ── */}
      {wide ? (
        /* Wide: horizontal bar */
        <div className="rounded-xl border border-ink-200 bg-white overflow-hidden">
          <div className="flex items-stretch gap-0 divide-x divide-ink-100">
            {/* Fra */}
            <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">Fra</span>
              {draftFrom ? (
                <PlaceChip place={draftFrom} isFrom onClear={() => { setDraftFrom(null); setFromLocState('idle') }} />
              ) : (
                <div className="flex flex-col gap-1">
                  <StopSearchInput
                    placeholder="Stop or address…"
                    onSelect={s => { const p = toTransitPlace(s); if (p) setDraftFrom(p) }}
                  />
                  {fromLocState === 'loading' ? (
                    <span className="text-[10px] text-ink-400">Locating…</span>
                  ) : fromLocState === 'denied' ? (
                    <span className="text-[10px] text-red-500">Location denied</span>
                  ) : (
                    <button onClick={() => locateFor('from')}
                      className="text-[10px] text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[28px] flex items-center gap-1">
                      📍 Current location
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Swap */}
            <div className="flex items-center px-2">
              <button
                onClick={swapStops}
                title="Swap"
                className="text-ink-300 hover:text-accent-500 transition-colors duration-150 min-w-[36px] min-h-[44px] flex items-center justify-center text-lg"
              >⇅</button>
            </div>

            {/* Til */}
            <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">Til</span>
              {draftTo ? (
                <PlaceChip place={draftTo} isFrom={false} onClear={() => { setDraftTo(null); setToLocState('idle') }} />
              ) : (
                <div className="flex flex-col gap-1">
                  <StopSearchInput
                    placeholder="Stop or address…"
                    onSelect={s => { const p = toTransitPlace(s); if (p) setDraftTo(p) }}
                  />
                  {toLocState === 'loading' ? (
                    <span className="text-[10px] text-ink-400">Locating…</span>
                  ) : toLocState === 'denied' ? (
                    <span className="text-[10px] text-red-500">Location denied</span>
                  ) : (
                    <button onClick={() => locateFor('to')}
                      className="text-[10px] text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[28px] flex items-center gap-1">
                      📍 Current location
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Time + Plan row */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-ink-100 bg-ink-50/50">
            <div className="flex gap-1.5">
              {(['now', '+15', '+30'] as WhenPreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => { setDraftWhen(p); setShowTimePanel(false) }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors duration-150 min-h-[36px] ${
                    draftWhen === p && !showTimePanel
                      ? 'bg-accent-500 text-white border-accent-500'
                      : 'text-ink-600 border-ink-200 hover:border-accent-300 bg-white'
                  }`}
                >
                  {p === 'now' ? 'Nå' : p}
                </button>
              ))}
              <button
                onClick={() => setShowTimePanel(v => !v)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors duration-150 min-h-[36px] ${
                  showTimePanel
                    ? 'bg-ink-800 text-white border-ink-800'
                    : 'text-ink-600 border-ink-200 hover:border-ink-400 bg-white'
                }`}
              >⋯</button>
            </div>
            <div className="flex-1" />
            {/* Save (quick access) */}
            {draftCanSave && !draftAlreadySaved && !showSaveForm && (
              <button
                onClick={() => {
                  setSaveLabel(`${draftFrom!.name.split(',')[0]} → ${draftTo!.name.split(',')[0]}`)
                  setShowSaveForm(true)
                }}
                className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[36px] flex items-center px-1"
              >
                + Save
              </button>
            )}
            <button
              onClick={handlePlan}
              disabled={!canPlan}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 min-h-[40px] ${
                canPlan
                  ? 'bg-ink-900 text-white hover:bg-ink-700'
                  : 'bg-ink-100 text-ink-400 cursor-not-allowed'
              }`}
            >
              Planlegg
            </button>
          </div>
        </div>
      ) : (
        /* Narrow: stacked layout */
        <div className="space-y-3">
          <div className="rounded-xl border border-ink-200 bg-white overflow-hidden divide-y divide-ink-100">
            {/* FROM */}
            <div className="px-3 pt-3 pb-3">
              {draftFrom ? (
                <PlaceDisplayFull place={draftFrom} label="From" onClear={() => { setDraftFrom(null); setFromLocState('idle') }} />
              ) : (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">From</span>
                  <StopSearchInput placeholder="Stop or address…"
                    onSelect={s => { const p = toTransitPlace(s); if (p) setDraftFrom(p) }} />
                  {fromLocState === 'loading' ? (
                    <span className="text-[11px] text-ink-400 py-1 block">Locating…</span>
                  ) : fromLocState === 'denied' ? (
                    <span className="text-[11px] text-red-500 py-1 block">Location permission denied</span>
                  ) : (
                    <button onClick={() => locateFor('from')}
                      className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150 py-1 min-h-[44px] flex items-center gap-1">
                      📍 Use current location
                    </button>
                  )}
                </div>
              )}
            </div>
            {draftFrom && draftTo && (
              <div className="flex items-center px-3 bg-ink-50">
                <div className="flex-1 border-t border-ink-100" />
                <button onClick={swapStops}
                  className="text-xs text-ink-400 hover:text-accent-600 transition-colors duration-150 flex items-center gap-1 min-h-[44px] px-3">
                  ⇅ Swap
                </button>
                <div className="flex-1 border-t border-ink-100" />
              </div>
            )}
            {/* TO */}
            <div className="px-3 pt-3 pb-3">
              {draftTo ? (
                <PlaceDisplayFull place={draftTo} label="To" onClear={() => { setDraftTo(null); setToLocState('idle') }} />
              ) : (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">To</span>
                  <StopSearchInput placeholder="Stop or address…"
                    onSelect={s => { const p = toTransitPlace(s); if (p) setDraftTo(p) }} />
                  {toLocState === 'loading' ? (
                    <span className="text-[11px] text-ink-400 py-1 block">Locating…</span>
                  ) : toLocState === 'denied' ? (
                    <span className="text-[11px] text-red-500 py-1 block">Location permission denied</span>
                  ) : (
                    <button onClick={() => locateFor('to')}
                      className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150 py-1 min-h-[44px] flex items-center gap-1">
                      📍 Use current location
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* When chips */}
          <div className="flex flex-wrap gap-1.5">
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

          <button onClick={handlePlan} disabled={!canPlan}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors duration-150 min-h-[48px] ${
              canPlan ? 'bg-ink-900 text-white hover:bg-ink-700' : 'bg-ink-100 text-ink-400 cursor-not-allowed'
            }`}>
            Planlegg
          </button>

          {draftCanSave && !draftAlreadySaved && !showSaveForm && (
            <button
              onClick={() => {
                setSaveLabel(`${draftFrom!.name.split(',')[0]} → ${draftTo!.name.split(',')[0]}`)
                setShowSaveForm(true)
              }}
              className="text-[11px] text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[44px] flex items-center"
            >
              💾 Save as quick route
            </button>
          )}
        </div>
      )}

      {/* Time panel (shared for both layouts) */}
      {showTimePanel && wide && (
        <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(['now', '+15', '+30', '+1h', 'arriveBy', 'custom'] as WhenPreset[]).map(p => (
              <button key={p} onClick={() => { setDraftWhen(p); if (p !== 'arriveBy' && p !== 'custom') setShowTimePanel(false) }}
                className={`text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[36px] ${
                  draftWhen === p ? 'bg-accent-500 text-white border-accent-500' : 'text-ink-600 border-ink-200 hover:border-accent-300'
                }`}>
                {p === 'now' ? 'Now' : p === 'arriveBy' ? 'Arrive by…' : p === 'custom' ? 'Custom…' : p}
              </button>
            ))}
          </div>
          {draftWhen === 'arriveBy' && (
            <select value={draftTime} onChange={e => setDraftTime(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]">
              {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
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
                <DateInput value={draftDate} onChange={setDraftDate} min={todayString()}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]" />
                <select value={draftTime} onChange={e => setDraftTime(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]">
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save form */}
      {showSaveForm && (
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
      {saveMsg && !showSaveForm && (
        <p className={`text-xs ${saveMsg.startsWith('Failed') ? 'text-red-500' : 'text-green-600'}`}>{saveMsg}</p>
      )}
    </div>
  )
}
