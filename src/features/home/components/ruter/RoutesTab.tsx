import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTrips, fetchStopQuays, type StopResult, type TransitPlace } from '../../api/ruterApi'
import { useTransitRoutes, type UserTransitRoute } from '../../hooks/useTransitRoutes'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'
import { fmtLastUpdated, fmtTime } from './transitUtils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutesTabProps {
  ws:  WidgetStateResult
  now: number
}

type LocationState = 'idle' | 'loading' | 'granted' | 'denied' | 'error'
type WhenPreset    = 'now' | '+15' | '+30' | '+1h' | 'arriveBy' | 'custom'
type TripMode      = 'departAt' | 'arriveBy'

interface SearchParams {
  from:          TransitPlace
  to:            TransitPlace
  dateTime?:     string
  arriveBy:      boolean
  label:         string
  preferredLine?: string  // filter results to trips using this line
  version:       number
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

// Converts a geocoder result to a TransitPlace; returns null if coords are missing for address results
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function LocationButton({ onLocate, state }: { onLocate: () => void; state: LocationState }) {
  if (state === 'loading') return <span className="text-xs text-ink-400 py-1 block">Locating…</span>
  if (state === 'denied')  return <span className="text-xs text-red-500 py-1 block">Location permission denied</span>
  if (state === 'error')   return <span className="text-xs text-red-500 py-1 block">Could not get location</span>
  return (
    <button onClick={onLocate} className="text-xs text-accent-500 hover:text-accent-700 transition-colors duration-150 py-1">
      📍 Use current location
    </button>
  )
}

function PlaceDisplay({ place, onClear }: { place: TransitPlace; onClear: () => void }) {
  // Fetch quay directions for transit stops so user knows which platforms this stop serves
  const { data: quays } = useQuery({
    queryKey:  ['stopQuays', place.kind === 'stop' ? place.id : null],
    queryFn:   () => fetchStopQuays((place as { id: string }).id),
    enabled:   place.kind === 'stop',
    staleTime: 10 * 60_000,
    retry:     false,
  })

  const directions = quays
    ?.map(q => q.description)
    .filter((d): d is string => Boolean(d))
    .filter((d, i, arr) => arr.indexOf(d) === i)  // unique
    ?? []

  return (
    <div className="px-3 py-2 bg-white border border-ink-200 rounded-lg">
      <div className="flex items-center gap-2 min-h-[36px]">
        <span className="flex-1 text-sm text-ink-700 truncate">
          {place.kind === 'coords' ? '📍 ' : '🚏 '}{place.name}
        </span>
        <button onClick={onClear} className="text-ink-300 hover:text-ink-600 text-xs min-w-[32px] flex items-center justify-center flex-shrink-0">✕</button>
      </div>
      {directions.length > 0 && (
        <p className="text-[10px] text-ink-400 mt-0.5 truncate">
          {directions.join(' · ')}
        </p>
      )}
    </div>
  )
}

function SavedRouteChip({
  route,
  active,
  onSelect,
  onDelete,
}: {
  route:    UserTransitRoute
  active:   boolean
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div className="relative group inline-flex">
      <button
        onClick={onSelect}
        className={`text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] pr-6 ${
          active
            ? 'bg-accent-500 text-white border-accent-500'
            : 'text-ink-600 border-ink-200 hover:border-accent-300'
        }`}
      >
        {route.label}
      </button>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Remove"
        className={`absolute top-0.5 right-0.5 w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center transition-opacity duration-150 opacity-0 group-hover:opacity-100 ${
          active ? 'bg-white/30 text-white' : 'bg-ink-200 text-ink-500 hover:bg-red-100 hover:text-red-600'
        }`}
      >
        ✕
      </button>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RoutesTab({ ws, now }: RoutesTabProps) {
  // Mobile audit: 2026-06-15 — WhenPreset buttons raised from min-h-[36px]/py-1.5 to min-h-[44px]/py-2.5; flex-wrap verified OK for 6 buttons at 375px; "Arrive by…" wraps cleanly as full-width row if needed
  const { routes, addRoute, removeRoute } = useTransitRoutes()

  // ── Draft state ──
  const [draftFrom,     setDraftFrom]     = useState<TransitPlace | null>(null)
  const [draftTo,       setDraftTo]       = useState<TransitPlace | null>(null)
  const [fromLocState,  setFromLocState]  = useState<LocationState>('idle')
  const [toLocState,    setToLocState]    = useState<LocationState>('idle')
  const [draftWhen,     setDraftWhen]     = useState<WhenPreset>('now')
  const [draftDate,     setDraftDate]     = useState(todayString)
  const [draftTime,     setDraftTime]     = useState(nowTimeString)
  const [draftMode,     setDraftMode]     = useState<TripMode>('departAt')
  const [draftLine,     setDraftLine]     = useState('')

  // ── Submitted / results state ──
  const [search,      setSearch]      = useState<SearchParams | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  // ── Save form state ──
  const [saveLabel,     setSaveLabel]     = useState('')
  const [showSaveForm,  setShowSaveForm]  = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [saveMsg,       setSaveMsg]       = useState<string | null>(null)

  // Unique stops extracted from saved routes — shown in search dropdown as quick picks
  const favoriteStops = useMemo(() => {
    const seen = new Set<string>()
    const stops: { id: string; name: string }[] = []
    for (const r of routes) {
      if (!seen.has(r.from_stop_id)) {
        seen.add(r.from_stop_id)
        stops.push({ id: r.from_stop_id, name: r.from_stop_name })
      }
      if (!seen.has(r.to_stop_id)) {
        seen.add(r.to_stop_id)
        stops.push({ id: r.to_stop_id, name: r.to_stop_name })
      }
    }
    return stops
  }, [routes])

  // ─── Saved route presets ──────────────────────────────────────────────────

  // Clicking a saved route fills the form AND immediately triggers the search
  function applyPreset(r: UserTransitRoute) {
    const from: TransitPlace = { kind: 'stop', id: r.from_stop_id, name: r.from_stop_name }
    const to:   TransitPlace = { kind: 'stop', id: r.to_stop_id,   name: r.to_stop_name   }
    setDraftFrom(from)
    setDraftTo(to)
    setDraftWhen('now')
    setSaveMsg(null)
    setShowSaveForm(false)
    setSearch({
      from,
      to,
      dateTime:      undefined,
      arriveBy:      false,
      label:         'Leave now',
      preferredLine: draftLine.trim() || undefined,
      version:       (search?.version ?? 0) + 1,
    })
  }

  function swapStops() {
    setDraftFrom(draftTo)
    setDraftTo(draftFrom)
  }

  async function locateFor(side: 'from' | 'to') {
    const setState = side === 'from' ? setFromLocState : setToLocState
    const setPlace = side === 'from' ? setDraftFrom    : setDraftTo
    setState('loading')
    try {
      const place = await getCurrentLocation()
      setPlace(place)
      setState('granted')
    } catch (e) {
      const err = e as GeolocationPositionError
      setState(err.code === 1 ? 'denied' : 'error')
    }
  }

  // ─── Plan route ───────────────────────────────────────────────────────────

  function handlePlan() {
    if (!draftFrom || !draftTo) return

    let dateTime: string | undefined
    if      (draftWhen === '+15')    dateTime = offsetISO(now, 15)
    else if (draftWhen === '+30')    dateTime = offsetISO(now, 30)
    else if (draftWhen === '+1h')    dateTime = offsetISO(now, 60)
    else if (draftWhen === 'arriveBy') dateTime = new Date(`${todayString()}T${draftTime}`).toISOString()
    else if (draftWhen === 'custom')   dateTime = new Date(`${draftDate}T${draftTime}`).toISOString()

    setSearch({
      from:          draftFrom,
      to:            draftTo,
      dateTime,
      arriveBy:      draftWhen === 'arriveBy' || draftMode === 'arriveBy',
      label:         planningLabel(draftWhen, draftMode, dateTime),
      preferredLine: draftLine.trim() || undefined,
      version:       (search?.version ?? 0) + 1,
    })
    setShowSaveForm(false)
    setSaveMsg(null)
  }

  // ─── TanStack Query ───────────────────────────────────────────────────────

  const fromKey = search?.from.kind === 'stop'
    ? search.from.id
    : search ? `${(search.from as { lat: number }).lat},${(search.from as { lon: number }).lon}` : ''
  const toKey = search?.to.kind === 'stop'
    ? search.to.id
    : search ? `${(search.to as { lat: number }).lat},${(search.to as { lon: number }).lon}` : ''

  const { data, isLoading, error } = useQuery({
    queryKey: ['trip', fromKey, toKey, search?.arriveBy, search?.dateTime ?? 'now', search?.version],
    queryFn:  async () => {
      const result = await fetchTrips(search!.from, search!.to, undefined, search!.dateTime, search!.arriveBy)
      setLastUpdated(Date.now())
      return result
    },
    staleTime:       Infinity,
    refetchInterval: false,
    enabled:         !ws.collapsed && !!search,
  })

  // Client-side line filter — keeps all trips if preferred line matches none
  const { filteredData, lineFilterActive, lineMatchCount } = useMemo(() => {
    if (!data) return { filteredData: undefined, lineFilterActive: false, lineMatchCount: 0 }
    const pref = search?.preferredLine?.trim().toLowerCase()
    if (!pref) return { filteredData: data, lineFilterActive: false, lineMatchCount: 0 }

    const matched = data.filter(trip =>
      trip.legs.some(leg => leg.line?.toLowerCase() === pref || leg.line?.toLowerCase().includes(pref))
    )
    return {
      filteredData:    matched.length > 0 ? matched : data,
      lineFilterActive: true,
      lineMatchCount:   matched.length,
    }
  }, [data, search?.preferredLine])

  // ─── Save route ───────────────────────────────────────────────────────────

  const canSave = !!(search?.from.kind === 'stop' && search.to.kind === 'stop')
  const alreadySaved = canSave && routes.some(
    r => r.from_stop_id === (search!.from as { id: string }).id &&
         r.to_stop_id   === (search!.to   as { id: string }).id
  )

  async function handleSaveRoute() {
    if (!saveLabel.trim() || !canSave) return
    setSaving(true)
    try {
      await addRoute(saveLabel.trim(), search!.from as StopResult, search!.to as StopResult)
      setSaveMsg('Saved ✓')
      setSaveLabel('')
      setShowSaveForm(false)
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      setSaveMsg(`Failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  function openSaveForm() {
    setSaveLabel(suggestLabel(search!.from, search!.to))
    setShowSaveForm(true)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const canPlan = !!(draftFrom && draftTo)

  return (
    <div>
      {/* ── Saved routes ── */}
      {routes.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Saved routes</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {routes.map(r => {
              const active =
                draftFrom?.kind === 'stop' && draftFrom.id === r.from_stop_id &&
                draftTo?.kind   === 'stop' && draftTo.id   === r.to_stop_id
              return (
                <SavedRouteChip
                  key={r.id}
                  route={r}
                  active={active}
                  onSelect={() => applyPreset(r)}
                  onDelete={() => removeRoute(r.id)}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Plan route form ── */}
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-2">Plan route</p>

        {/* FROM */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-semibold text-ink-400 uppercase w-8 flex-shrink-0">From</span>
          <div className="flex-1 space-y-1">
            {draftFrom
              ? <PlaceDisplay place={draftFrom} onClear={() => { setDraftFrom(null); setFromLocState('idle') }} />
              : <>
                  <StopSearchInput
                    placeholder="Stop or address…"
                    favorites={favoriteStops}
                    onSelect={s => { const p = toTransitPlace(s); if (p) setDraftFrom(p) }}
                  />
                  <LocationButton state={fromLocState} onLocate={() => locateFor('from')} />
                </>
            }
          </div>
        </div>

        {/* TO + swap */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-semibold text-ink-400 uppercase w-8 flex-shrink-0">To</span>
          <div className="flex-1 space-y-1">
            {draftTo
              ? <PlaceDisplay place={draftTo} onClear={() => { setDraftTo(null); setToLocState('idle') }} />
              : <>
                  <StopSearchInput
                    placeholder="Stop or address…"
                    favorites={favoriteStops}
                    onSelect={s => { const p = toTransitPlace(s); if (p) setDraftTo(p) }}
                  />
                  <LocationButton state={toLocState} onLocate={() => locateFor('to')} />
                </>
            }
          </div>
          <button
            onClick={swapStops}
            disabled={!draftFrom && !draftTo}
            title="Swap"
            className="text-ink-400 hover:text-accent-600 transition-colors duration-150 text-sm flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-30"
          >⇅</button>
        </div>

        {/* WHEN */}
        <div className="mb-2">
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {(['now', '+15', '+30', '+1h', 'arriveBy', 'custom'] as WhenPreset[]).map(p => (
              <button
                key={p}
                onClick={() => setDraftWhen(p)}
                className={`text-xs px-2.5 py-2.5 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                  draftWhen === p
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'text-ink-600 border-ink-200 hover:border-accent-300'
                }`}
              >
                {p === 'now' ? 'Now' : p === 'arriveBy' ? 'Arrive by…' : p === 'custom' ? 'Custom…' : p}
              </button>
            ))}
          </div>

          {/* Arrive by: today only, just pick a time */}
          {draftWhen === 'arriveBy' && (
            <div className="mb-2">
              <select
                value={draftTime}
                onChange={e => setDraftTime(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-accent-300 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-accent-50 min-h-[44px]"
              >
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <p className="text-[10px] text-ink-400 mt-1">I want to be there by this time today</p>
            </div>
          )}

          {draftWhen === 'custom' && (
            <div className="space-y-2 mb-2">
              <div className="flex gap-1.5">
                {(['departAt', 'arriveBy'] as TripMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setDraftMode(m)}
                    className={`text-xs px-2.5 py-2.5 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                      draftMode === m
                        ? 'bg-ink-700 text-white border-ink-700'
                        : 'text-ink-500 border-ink-200 hover:border-ink-400'
                    }`}
                  >
                    {m === 'departAt' ? 'Leave at' : 'Arrive by'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={draftDate}
                  min={todayString()}
                  onChange={e => setDraftDate(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
                />
                <select
                  value={draftTime}
                  onChange={e => setDraftTime(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
                >
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Preferred line filter */}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <input
              value={draftLine}
              onChange={e => setDraftLine(e.target.value)}
              placeholder="Prefer a line? e.g. 68, 31E (optional)"
              className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px] placeholder:text-ink-300"
            />
            {draftLine && (
              <button
                onClick={() => setDraftLine('')}
                className="text-ink-300 hover:text-ink-600 text-xs min-w-[32px] flex items-center justify-center"
              >✕</button>
            )}
          </div>
          {draftLine && (
            <p className="text-[10px] text-ink-400 mt-1">Results will be filtered to trips using line {draftLine.trim()}</p>
          )}
        </div>

        {/* Plan route button */}
        <button
          onClick={handlePlan}
          disabled={!canPlan}
          className="w-full py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors duration-150 disabled:opacity-40 min-h-[44px]"
        >
          Plan route
        </button>

        {!canPlan && (
          <p className="text-xs text-ink-400 mt-2">Choose From and To to see route options.</p>
        )}
      </div>

      {/* ── Results ── */}
      {isLoading && <div className="text-ink-400 text-sm">Loading trips…</div>}

      {error && (
        <div className="text-red-500 text-xs py-1">
          {(error as Error).message?.includes('Rate')
            ? '⏳ Rate limited — wait a moment'
            : `⚠ ${(error as Error).message}`
          }
        </div>
      )}

      {filteredData && search && (
        <>
          {/* Result meta */}
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <span className="text-[10px] text-ink-500">
              Planning: <span className="font-medium">{search.label}</span>
              {!canSave && ' · GPS routes cannot be saved'}
            </span>
            <span className="text-[10px] text-ink-400 flex-shrink-0">
              {lastUpdated ? `Updated ${fmtLastUpdated(lastUpdated)}` : ''}
            </span>
          </div>

          {/* Line filter note */}
          {lineFilterActive && (
            <div className="mb-2 text-[10px] px-2.5 py-1.5 rounded-lg bg-accent-50 border border-accent-100 text-accent-700">
              {lineMatchCount > 0
                ? `Showing ${lineMatchCount} trip${lineMatchCount !== 1 ? 's' : ''} using line ${search.preferredLine}`
                : `No trips found with line ${search.preferredLine} — showing all options`
              }
            </div>
          )}

          {/* Save route */}
          {canSave && !alreadySaved && (
            <div className="mb-3">
              {!showSaveForm ? (
                <button onClick={openSaveForm} className="text-xs text-accent-500 hover:text-accent-700 transition-colors duration-150">
                  + Save this route
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={saveLabel}
                    onChange={e => setSaveLabel(e.target.value)}
                    placeholder="Route label…"
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
                    onKeyDown={e => e.key === 'Enter' && handleSaveRoute()}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveRoute}
                    disabled={!saveLabel.trim() || saving}
                    className="text-xs px-3 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150 disabled:opacity-40 min-h-[44px]"
                  >
                    {saving ? '…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setShowSaveForm(false); setSaveLabel('') }}
                    className="text-ink-400 hover:text-ink-600 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >✕</button>
                </div>
              )}
              {saveMsg && (
                <p className={`text-xs mt-1 ${saveMsg.startsWith('Failed') ? 'text-red-500' : 'text-green-600'}`}>
                  {saveMsg}
                </p>
              )}
            </div>
          )}

          {/* Trip cards */}
          <div className="space-y-3">
            {filteredData.length === 0
              ? <div className="text-ink-400 text-sm">No trips found</div>
              : filteredData.map((trip, i) => (
                  <TripCard key={i} trip={trip} now={now} isBest={i === 0} />
                ))
            }
          </div>
        </>
      )}
    </div>
  )
}
